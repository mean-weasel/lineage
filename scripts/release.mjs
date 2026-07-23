#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipCi = args.includes('--skip-ci');
if (args.includes('--promote-latest')) {
  console.error('Dist-tag promotion is no longer a release authority. Publish a new immutable annotated version tag instead.');
  process.exit(1);
}

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return fallback;
}

const tag = readOption('--tag', 'next');
if (!['latest', 'next'].includes(tag)) {
  console.error(`Unsupported npm dist-tag: ${tag}`);
  process.exit(1);
}
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

const failures = [];
if (packageInfo.name !== '@mean-weasel/lineage') failures.push(`Unexpected package name: ${packageInfo.name}`);
if (packageInfo.publishConfig?.access !== 'public') failures.push('publishConfig.access must be public');
if (packageLock.version !== packageInfo.version) failures.push('package-lock.json version does not match package.json');
if (packageLock.packages?.['']?.version !== packageInfo.version) failures.push('package-lock root package version does not match package.json');
if (!changelog.includes(`## ${packageInfo.version}`)) failures.push(`CHANGELOG.md is missing ## ${packageInfo.version}`);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

if (!dryRun) {
  const expectedTag = `v${packageInfo.version}`;
  if (process.env.LINEAGE_RELEASE_TAG !== expectedTag) {
    console.error(`Refusing npm mutation outside the tag-triggered Release workflow: LINEAGE_RELEASE_TAG must be ${expectedTag}`);
    process.exit(1);
  }
}

execFileSync(process.execPath, ['scripts/plugin-release.mjs'], { cwd: root, stdio: 'inherit' });

function assertRemotePluginAssets() {
  const tag = `v${packageInfo.version}`;
  let release;
  try {
    release = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--json', 'assets'], { cwd: root, encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`Refusing npm mutation: GitHub release ${tag} with plugin assets must exist first`, { cause: error });
  }
  const names = new Set((release.assets || []).map(asset => asset.name));
  const artifact = `lineage-codex-plugin-${packageInfo.version}.tgz`;
  for (const required of [artifact, `${artifact}.sha256`]) {
    if (!names.has(required)) throw new Error(`Refusing npm mutation: GitHub release ${tag} is missing ${required}`);
  }
}

if (!dryRun) assertRemotePluginAssets();

if (!skipCi) {
  execFileSync('npm', ['run', 'prepare-release'], { cwd: root, stdio: 'inherit' });
}

function publishedVersionExists(spec) {
  try {
    execFileSync('npm', ['view', spec, 'version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

const spec = `${packageInfo.name}@${packageInfo.version}`;
const publishArgs = ['publish', '--access', 'public', '--tag', tag];
if (dryRun) publishArgs.push('--dry-run');
if (dryRun && publishedVersionExists(spec)) {
  execFileSync('npm', ['pack', '--dry-run'], { cwd: root, stdio: 'inherit' });
  console.log(`Dry-run package ${spec} is already published; npm publish --dry-run would reject an overwrite.`);
} else {
  execFileSync('npm', publishArgs, { cwd: root, stdio: 'inherit' });
}
console.log(`${dryRun ? 'Dry-run prepared' : 'Published'} ${packageInfo.name}@${packageInfo.version} with npm tag ${tag}`);
