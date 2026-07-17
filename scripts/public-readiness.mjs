#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const filesToScan = [
  'AGENTS.md',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'eslint.config.js',
  'knip.json',
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'tsconfig.build.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  '.github',
  'fixtures',
  'src',
  'e2e',
  'scripts',
  'plugins/lineage-codex-plugin',
  'packages/lineage-plugin-installer',
];

const privatePatterns = [
  ['bleep', '-that-shit'],
  ['debt', '-is-fun'],
  ['mean-weasel-growth', '-assets-production'],
  ['growth', '_ops'],
  ['Dopp', 'ler'],
  ['BUFFER', '_API_KEY'],
];

const legacyPatterns = [
  ['Asset', ' Studio'],
  ['Asset', 'Studio'],
  ['Growth Asset', ' Studio'],
  ['asset_studio', '.agent_handoff.v1'],
  ['studio', ':cli'],
  ['ASSET', '_STUDIO_'],
];

const forbidden = [...privatePatterns, ...legacyPatterns].map(parts => parts.join(''));

function walk(path, results = []) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.asset-scratch') continue;
      walk(join(path, entry), results);
    }
  } else {
    results.push(path);
  }
  return results;
}

const files = [];
for (const target of filesToScan) {
  const path = join(root, target);
  try {
    files.push(...await walk(path));
  } catch {
    // Missing optional paths are ignored here; package-smoke verifies build output.
  }
}

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (text.includes(pattern)) {
      hits.push(`${relative(root, file)} contains forbidden public-readiness pattern`);
    }
  }
}

const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pluginPackage = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', 'package.json'), 'utf8'));
const pluginManifest = JSON.parse(readFileSync(join(root, 'plugins', 'lineage-codex-plugin', '.codex-plugin', 'plugin.json'), 'utf8'));
if (pluginPackage.version !== packageInfo.version) hits.push('plugin package version does not match Lineage package version');
if (pluginManifest.version !== packageInfo.version || pluginManifest.lineage?.version !== packageInfo.version) {
  hits.push('plugin manifest compatibility version does not match Lineage package version');
}
if (pluginManifest.lineage?.package !== packageInfo.name) hits.push('plugin manifest package identity does not match Lineage');
const operatorSkill = readFileSync(join(root, 'plugins', 'lineage-codex-plugin', 'skills', 'lineage-package-operator', 'SKILL.md'), 'utf8');
if (operatorSkill.split('\n').some(line => {
  const command = line.trim();
  return /^(lineage-|npm run lineage:dev)/.test(command)
    && command.includes('--db')
    && command.includes('--confirm-write');
})) hits.push('plugin operator skill contains a direct-database confirmed-write example');
for (const required of [
  'runtime doctor --json',
  'profile doctor --profile',
  'db info --profile',
  'agent heartbeat --profile',
  'agent release --profile',
  'link-child --profile',
  'profile clone --source-db',
  'profile clone-assets --source-asset-root',
  'profile repin-runtime',
  '--checkout-root',
  'make repin-dev',
  'lineage-stable-service',
]) {
  if (!operatorSkill.includes(required)) hits.push(`plugin operator skill is missing ${required}`);
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log('public readiness clean');
