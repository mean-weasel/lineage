#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredBuildFiles = [
  'dist/server.js',
  'dist/web/index.html',
  'dist/cli/lineage.js',
  'dist/cli/lineage-dev.js',
];

for (const file of requiredBuildFiles) {
  if (!existsSync(join(root, file))) {
    console.error(`Missing build artifact: ${file}`);
    console.error('Run npm run build before npm run package:smoke.');
    process.exit(1);
  }
}

const packOutput = execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' });
const [pack] = JSON.parse(packOutput);
const packedFiles = new Set(pack.files.map(file => file.path));
for (const file of requiredBuildFiles) {
  if (!packedFiles.has(file)) {
    console.error(`Packed tarball is missing ${file}`);
    process.exit(1);
  }
}

const tmpProject = mkdtempSync(join(tmpdir(), 'lineage-package-smoke-'));
const tarball = join(root, pack.filename);

try {
  execFileSync('npm', ['init', '-y'], { cwd: tmpProject, stdio: 'ignore' });
  execFileSync('npm', ['install', tarball], { cwd: tmpProject, stdio: 'ignore' });

  const binDir = join(tmpProject, 'node_modules', '.bin');
  execFileSync(join(binDir, 'lineage'), ['--help'], { cwd: tmpProject, stdio: 'ignore' });
  execFileSync(join(binDir, 'lineage-dev'), ['--help'], { cwd: tmpProject, stdio: 'ignore' });

  console.log('package smoke passed');
} finally {
  rmSync(tmpProject, { force: true, recursive: true });
  rmSync(tarball, { force: true });
}
