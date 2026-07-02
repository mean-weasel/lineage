#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let tarball;
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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Unable to allocate a free port'));
      });
    });
  });
}

async function waitForProjects(url) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.projects) && body.projects.some(project => project.project === 'demo-project')) return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

const tmpProject = mkdtempSync(join(tmpdir(), 'lineage-package-smoke-'));

try {
  const packOutput = execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' });
  const [pack] = JSON.parse(packOutput);
  tarball = join(root, pack.filename);
  const packedFiles = new Set(pack.files.map(file => file.path));
  for (const file of requiredBuildFiles) {
    if (!packedFiles.has(file)) {
      throw new Error(`Packed tarball is missing ${file}`);
    }
  }

  execFileSync('npm', ['init', '-y'], { cwd: tmpProject, stdio: 'ignore' });
  execFileSync('npm', ['install', tarball], { cwd: tmpProject, stdio: 'ignore' });

  const binDir = join(tmpProject, 'node_modules', '.bin');
  execFileSync(join(binDir, 'lineage'), ['--help'], { cwd: tmpProject, stdio: 'ignore' });
  execFileSync(join(binDir, 'lineage-dev'), ['--help'], { cwd: tmpProject, stdio: 'ignore' });

  for (const binName of ['lineage', 'lineage-dev']) {
    const port = await freePort();
    const dbPath = join(tmpProject, `${binName}-smoke.sqlite`);
    let stdout = '';
    let stderr = '';
    const server = spawn(join(binDir, binName), ['start', '--host', '127.0.0.1', '--port', String(port), '--db', dbPath, '--json'], {
      cwd: tmpProject,
      env: { ...process.env, LINEAGE_HOME: join(tmpProject, `${binName}-home`) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    server.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    try {
      await waitForProjects(`http://127.0.0.1:${port}/api/projects`);
    } catch (error) {
      console.error(`${binName} stdout:\n${stdout.trim() || '(empty)'}`);
      console.error(`${binName} stderr:\n${stderr.trim() || '(empty)'}`);
      throw error;
    } finally {
      await stopServer(server);
    }
  }

  console.log('package smoke passed');
} finally {
  rmSync(tmpProject, { force: true, recursive: true });
  if (tarball) rmSync(tarball, { force: true });
}
