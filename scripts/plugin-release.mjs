#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const json = args.includes('--json');

function readOption(name) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8', ...options });
}

const temporary = mkdtempSync(join(tmpdir(), 'lineage-plugin-release-'));
const requestedOut = readOption('--out-dir');
const outDir = resolve(requestedOut || join(temporary, 'dist'));
const target = join(temporary, 'installed');

try {
  const lineagePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pluginPackage = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', '.codex-plugin', 'plugin.json'), 'utf8'));
  const skillPath = join(root, 'plugins', 'lineage-codex-plugin', 'skills', 'lineage-package-operator', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  const failures = [];
  if (pluginPackage.version !== lineagePackage.version) failures.push(`plugin package ${pluginPackage.version} != Lineage ${lineagePackage.version}`);
  if (manifest.version !== lineagePackage.version) failures.push(`plugin manifest ${manifest.version} != Lineage ${lineagePackage.version}`);
  if (manifest.lineage?.package !== lineagePackage.name || manifest.lineage?.version !== lineagePackage.version) {
    failures.push('plugin lineage compatibility metadata does not exactly match the root package');
  }
  for (const required of [
    'lineage-stable runtime doctor --json',
    'profile doctor --profile',
    'db info --profile',
    'LINEAGE_PROD_PROFILE',
    'LINEAGE_PREVIEW_PROFILE',
    'LINEAGE_DEV_PROFILE',
    'agent heartbeat --profile',
    'agent release --profile',
    'link-child --profile',
    'profile clone --source-db',
    'profile clone-assets --source-asset-root',
    'profile repin-runtime',
    '--checkout-root',
    'make repin-dev',
    'lineage-stable-service',
    'Legacy-unbound access is diagnostic/read-only',
  ]) {
    if (!skill.includes(required)) failures.push(`operator skill is missing required guidance: ${required}`);
  }
  for (const forbidden of ['npm install -g @mean-weasel/lineage', 'npx @mean-weasel/lineage', 'make start-local-prod', 'fall back to PID/log files']) {
    if (skill.includes(forbidden)) failures.push(`operator skill contains unsafe/stale guidance: ${forbidden}`);
  }
  const unsafeWriteExample = skill.split('\n').some(line => {
    const command = line.trim();
    return /^(lineage-|npm run lineage:dev)/.test(command)
      && command.includes('--db')
      && command.includes('--confirm-write');
  });
  if (unsafeWriteExample) failures.push('operator skill contains a direct-database confirmed-write example');
  if (failures.length > 0) throw new Error(failures.join('\n'));

  const packed = JSON.parse(run(process.execPath, [
    'packages/lineage-plugin-installer/scripts/pack-plugin.mjs',
    '--plugin', 'plugins/lineage-codex-plugin',
    '--version', lineagePackage.version,
    '--out-dir', outDir,
    '--json',
  ]));
  const artifact = packed.artifactPath;
  const checksumFile = `${artifact}.sha256`;
  if (!existsSync(artifact) || !existsSync(checksumFile)) throw new Error('plugin pack did not produce artifact and checksum');
  const checksumText = readFileSync(checksumFile, 'utf8');
  if (!checksumText.includes(sha256(artifact))) throw new Error('plugin checksum file does not match the packed artifact');

  const installed = JSON.parse(run(process.execPath, [
    'packages/lineage-plugin-installer/bin/lineage-plugin-installer.mjs',
    'install',
    '--version', lineagePackage.version,
    '--artifact-file', artifact,
    '--checksum-file', checksumFile,
    '--target-dir', target,
    '--json',
  ]));
  const installedRoot = join(target, manifest.name);
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const installedSkill = readFileSync(join(installedRoot, 'skills', 'lineage-package-operator', 'SKILL.md'), 'utf8');
  if (installedManifest.version !== lineagePackage.version || installedSkill !== skill) {
    throw new Error('installed plugin tree does not exactly match the version-locked source skill');
  }

  const result = {
    artifact: requestedOut ? artifact : packed.artifactName,
    checksum: packed.sha256,
    installed_plugin: installed.plugin,
    lineage_version: lineagePackage.version,
    ok: true,
    source_files: packed.files,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`plugin release smoke passed for Lineage ${lineagePackage.version}`);
} catch (error) {
  if (json) console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), ok: false }, null, 2));
  else console.error(`plugin-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
