#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const schemaVersion = 'lineage.runtime_build.v1';

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const sourceGitSha = git(['rev-parse', 'HEAD']).trim();
const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
const diff = git(['diff', '--binary', 'HEAD', '--']);
const sourceHash = createHash('sha256');
sourceHash.update(sourceGitSha);
sourceHash.update('\0');
sourceHash.update(sha256(diff));
sourceHash.update('\0');
sourceHash.update(status);
for (const relativePath of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort()) {
  sourceHash.update('\0');
  sourceHash.update(relativePath);
  const path = join(root, relativePath);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) sourceHash.update(readlinkSync(path));
  else if (stat.isFile()) sourceHash.update(readFileSync(path));
  else sourceHash.update(`[${stat.mode}:${stat.size}]`);
}

const buildWithoutFingerprint = {
  package_name: packageInfo.name,
  package_version: packageInfo.version,
  schema_version: schemaVersion,
  source_dirty: status.length > 0,
  source_fingerprint: sourceHash.digest('hex'),
  source_git_sha: sourceGitSha,
};
const build = {
  build_fingerprint: sha256(JSON.stringify(buildWithoutFingerprint)),
  ...buildWithoutFingerprint,
};
const outputPath = join(root, 'dist', 'runtime-build.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(build, null, 2)}\n`, { mode: 0o644 });
console.log(`Wrote ${outputPath} (${build.build_fingerprint.slice(0, 12)}, ${build.source_dirty ? 'dirty' : 'clean'})`);
