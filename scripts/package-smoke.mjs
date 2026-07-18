#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let tarball;
const requiredBuildFiles = [
  'dist/server.js',
  'dist/web/index.html',
  'dist/web/landing/index.html',
  'dist/runtime-build.json',
  'dist/cli/lineage.js',
  'dist/cli/lineage-channel.js',
  'dist/cli/lineage-dev.js',
  'dist/cli/managed-service.js',
  'dist/cli/lineage-preview.js',
];

for (const file of requiredBuildFiles) {
  if (!existsSync(join(root, file))) {
    console.error(`Missing build artifact: ${file}`);
    console.error('Run npm run build before npm run package:smoke.');
    process.exit(1);
  }
}

function parsePackMetadata(packOutput) {
  const metadata = JSON.parse(packOutput);
  const pack = Array.isArray(metadata) ? metadata[0] : metadata?.filename ? metadata : Object.values(metadata ?? {})[0];
  if (!pack || typeof pack.filename !== 'string' || !Array.isArray(pack.files)) {
    throw new Error('npm pack returned unexpected JSON metadata');
  }
  return pack;
}

const tmpProject = mkdtempSync(join(tmpdir(), 'lineage-package-smoke-'));

try {
  const pack = parsePackMetadata(execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' }));
  tarball = join(root, pack.filename);
  const packedFiles = new Set(pack.files.map(file => file.path));
  const forbiddenPackedFiles = pack.files
    .map(file => file.path)
    .filter(file => file.startsWith('docs/') || file.includes('/.goalbuddy-board/') || file.startsWith('.goalbuddy-board/'));
  if (forbiddenPackedFiles.length > 0) throw new Error(`Packed tarball includes local planning artifacts: ${forbiddenPackedFiles.join(', ')}`);
  for (const file of requiredBuildFiles) {
    if (!packedFiles.has(file)) throw new Error(`Packed tarball is missing ${file}`);
  }

  execFileSync('npm', ['init', '-y'], { cwd: tmpProject, stdio: 'ignore' });
  execFileSync('npm', ['install', tarball], { cwd: tmpProject, stdio: 'ignore' });
  const packageRoot = join(tmpProject, 'node_modules', '@mean-weasel', 'lineage');
  const binDir = join(tmpProject, 'node_modules', '.bin');

  for (const binName of ['lineage', 'lineage-preview', 'lineage-channel', 'lineage-service']) {
    execFileSync(join(binDir, binName), ['--help'], { cwd: tmpProject, stdio: 'ignore' });
  }
  const packagedDev = spawnSync(join(binDir, 'lineage-dev'), ['--help'], { cwd: tmpProject, encoding: 'utf8' });
  if (packagedDev.status === 0 || !packagedDev.stderr.includes('published package execution is disabled')) {
    throw new Error('Packaged lineage-dev did not fail closed with checkout guidance');
  }
  for (const binName of ['lineage', 'lineage-preview']) {
    const identity = JSON.parse(execFileSync(join(binDir, binName), ['runtime', 'info', '--json'], { cwd: tmpProject, encoding: 'utf8' }));
    if (identity.origin !== 'package' || identity.verified !== false || !identity.errors.some(error => error.includes('install receipt'))) {
      throw new Error(`${binName} did not report an unverified package without a channel receipt`);
    }
  }

  for (const channel of ['stable', 'preview']) {
    const dbPath = join(tmpProject, `${channel}-server-smoke.sqlite`);
    let stdout = '';
    let stderr = '';
    const server = spawn(process.execPath, [join(packageRoot, 'dist', 'server.js')], {
      cwd: tmpProject,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        LINEAGE_CHANNEL: channel,
        LINEAGE_DB: dbPath,
        LINEAGE_HOME: join(tmpProject, `${channel}-home`),
        NODE_ENV: 'production',
        PORT: channel === 'stable' ? '5197' : '5199',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    server.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    await Promise.race([
      new Promise(resolveExit => server.once('exit', resolveExit)),
      new Promise(resolveDelay => setTimeout(resolveDelay, 5_000)),
    ]);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGKILL');
      console.error(`${channel} stdout:\n${stdout.trim() || '(empty)'}`);
      console.error(`${channel} stderr:\n${stderr.trim() || '(empty)'}`);
      throw new Error(`${channel} direct packaged server unexpectedly remained running`);
    }
    if (!stderr.includes(`Unverified ${channel} code origin`) || existsSync(dbPath)) {
      throw new Error(`${channel} direct packaged server did not fail closed before database creation: ${stderr}`);
    }
  }

  console.log('package smoke passed');
} finally {
  rmSync(tmpProject, { force: true, recursive: true });
  if (tarball) rmSync(tarball, { force: true });
}
