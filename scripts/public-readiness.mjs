#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const filesToScan = [
  'README.md',
  'package.json',
  'playwright.config.ts',
  'src',
  'scripts',
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

if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log('public readiness clean');
