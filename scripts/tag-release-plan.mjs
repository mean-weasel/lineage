#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function planTagRelease({
  changelog,
  packageInfo,
  packageLock,
  pluginManifest,
  pluginPackage,
  tag,
}) {
  const failures = [];
  const version = packageInfo.version;

  if (packageInfo.name !== '@mean-weasel/lineage') failures.push(`Unexpected package name: ${packageInfo.name || '(missing)'}`);
  if (typeof version !== 'string' || !releaseVersionPattern.test(version)) failures.push(`Invalid release version: ${version || '(missing)'}`);
  if (tag !== `v${version}`) failures.push(`Release tag ${tag || '(missing)'} must exactly match v${version || '(missing)'}`);
  if (packageLock.version !== version) failures.push('package-lock.json version does not match package.json');
  if (packageLock.packages?.['']?.version !== version) failures.push('package-lock root package version does not match package.json');
  if (pluginPackage.version !== version) failures.push('plugin package version does not match package.json');
  if (pluginManifest.version !== version) failures.push('plugin manifest version does not match package.json');
  if (pluginManifest.lineage?.version !== version) failures.push('plugin lineage.version does not match package.json');
  if (pluginManifest.lineage?.package !== packageInfo.name) failures.push('plugin lineage.package does not match package.json');
  if (!changelog.includes(`## ${version}`)) failures.push(`CHANGELOG.md is missing ## ${version}`);

  if (failures.length > 0) throw new Error(failures.join('\n'));

  const prerelease = version.includes('-');
  return {
    github_channel: prerelease ? 'next' : 'latest',
    github_prerelease: prerelease,
    npm_tag: prerelease ? 'next' : 'latest',
    package: packageInfo.name,
    tag,
    version,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readOption(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run() {
  const plan = planTagRelease({
    changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    packageInfo: readJson(join(root, 'package.json')),
    packageLock: readJson(join(root, 'package-lock.json')),
    pluginManifest: readJson(join(root, 'plugins', 'lineage-codex-plugin', '.codex-plugin', 'plugin.json')),
    pluginPackage: readJson(join(root, 'plugins', 'lineage-codex-plugin', 'package.json')),
    tag: readOption('--tag') || process.env.GITHUB_REF_NAME,
  });
  console.log(JSON.stringify(plan));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
