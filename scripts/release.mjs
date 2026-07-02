#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipCi = args.includes('--skip-ci');

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

if (!skipCi) {
  execFileSync('npm', ['run', 'prepare-release'], { cwd: root, stdio: 'inherit' });
}

const publishArgs = ['publish', '--access', 'public', '--tag', tag];
if (dryRun) publishArgs.push('--dry-run');
execFileSync('npm', publishArgs, { cwd: root, stdio: 'inherit' });
console.log(`${dryRun ? 'Dry-run prepared' : 'Published'} ${packageInfo.name}@${packageInfo.version} with npm tag ${tag}`);
