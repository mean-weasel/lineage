#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return fallback;
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
}

function capture(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function maybeCapture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function releaseNotes(changelog, version) {
  const match = changelog.match(new RegExp(`(^|\\n)## ${version.replaceAll('.', '\\.')}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[2]?.trim();
}

const repo = readOption('--repo', process.env.GITHUB_REPOSITORY || 'mean-weasel/lineage');
const target = readOption('--target', process.env.GITHUB_SHA || 'HEAD');
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
const notes = releaseNotes(changelog, packageInfo.version);
const tag = `v${packageInfo.version}`;
const title = `Lineage ${tag}`;
const targetCommit = capture('git', ['rev-parse', '--verify', `${target}^{commit}`]);

if (!notes) {
  console.error(`CHANGELOG.md is missing release notes for ${packageInfo.version}`);
  process.exit(1);
}

const remoteTag = maybeCapture('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
const localTag = maybeCapture('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
const release = maybeCapture('gh', ['release', 'view', tag, '--repo', repo, '--json', 'tagName']);

if (dryRun) {
  console.log(`Dry-run would sync GitHub release ${tag} for ${repo}`);
  console.log(`Target commit: ${targetCommit}`);
  console.log(`Remote tag: ${remoteTag.ok ? 'present' : 'missing'}`);
  console.log(`Local tag: ${localTag.ok ? localTag.stdout : 'missing'}`);
  console.log(`GitHub release: ${release.ok ? 'present' : 'missing'}`);
  console.log('Release notes:');
  console.log(notes);
  process.exit(0);
}

if (remoteTag.ok) {
  run('git', ['fetch', '--tags', 'origin']);
  const fetchedTagCommit = capture('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (fetchedTagCommit !== targetCommit) {
    console.error(`Refusing to sync ${tag}: existing tag points to ${fetchedTagCommit}, expected ${targetCommit}`);
    process.exit(1);
  }
} else if (localTag.ok) {
  if (localTag.stdout !== targetCommit) {
    console.error(`Refusing to push ${tag}: local tag points to ${localTag.stdout}, expected ${targetCommit}`);
    process.exit(1);
  }
  run('git', ['push', 'origin', tag]);
} else {
  run('git', ['tag', '-a', tag, targetCommit, '-m', title]);
  run('git', ['push', 'origin', tag]);
}

const tempDir = mkdtempSync(join(tmpdir(), 'lineage-release-'));
const notesFile = join(tempDir, `${tag}.md`);
writeFileSync(notesFile, `${notes}\n`);

if (release.ok) {
  run('gh', ['release', 'edit', tag, '--repo', repo, '--title', title, '--notes-file', notesFile, '--latest']);
  console.log(`Updated GitHub release ${tag}`);
} else {
  run('gh', ['release', 'create', tag, '--repo', repo, '--title', title, '--notes-file', notesFile, '--latest']);
  console.log(`Created GitHub release ${tag}`);
}
