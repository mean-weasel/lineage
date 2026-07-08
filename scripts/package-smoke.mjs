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

async function postJson(url) {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}`);
  return response.json();
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

function parsePackMetadata(packOutput) {
  const metadata = JSON.parse(packOutput);
  const pack = Array.isArray(metadata) ? metadata[0] : metadata?.filename ? metadata : Object.values(metadata ?? {})[0];
  if (!pack || typeof pack.filename !== 'string' || !Array.isArray(pack.files)) {
    throw new Error('npm pack returned unexpected JSON metadata');
  }
  return pack;
}

try {
  const packOutput = execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' });
  const pack = parsePackMetadata(packOutput);
  tarball = join(root, pack.filename);
  const packedFiles = new Set(pack.files.map(file => file.path));
  const forbiddenPackedFiles = pack.files
    .map(file => file.path)
    .filter(file => file.startsWith('docs/') || file.includes('/.goalbuddy-board/') || file.startsWith('.goalbuddy-board/'));
  if (forbiddenPackedFiles.length > 0) {
    throw new Error(`Packed tarball includes local planning artifacts: ${forbiddenPackedFiles.join(', ')}`);
  }
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
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForProjects(`${baseUrl}/api/projects`);
      await postJson(`${baseUrl}/api/index/local?project=demo-project`);

      const rootAsset = 'demo-meta-short-form-upload-demo-post-static';
      const childAsset = 'demo-linkedin-ledger-catalog-shared';
      const next = JSON.parse(execFileSync(join(binDir, binName), ['next', '--project', 'demo-project', '--root', rootAsset, '--db', dbPath, '--json'], { cwd: tmpProject, encoding: 'utf8' }));
      if (next.root_asset_id !== rootAsset || next.next_asset?.asset_id !== rootAsset) {
        throw new Error(`${binName} next returned an unexpected lineage base`);
      }
      const inspect = JSON.parse(execFileSync(join(binDir, binName), ['inspect', '--project', 'demo-project', '--asset-id', rootAsset, '--db', dbPath, '--json'], { cwd: tmpProject, encoding: 'utf8' }));
      if (inspect.active_asset_id !== rootAsset || !inspect.nodes?.some(node => node.asset_id === rootAsset)) {
        throw new Error(`${binName} inspect did not return the requested asset`);
      }
      const link = JSON.parse(execFileSync(join(binDir, binName), ['link-child', '--project', 'demo-project', '--root', rootAsset, '--child', childAsset, '--db', dbPath, '--json'], { cwd: tmpProject, encoding: 'utf8' }));
      if (link.dryRun !== true || link.edge?.parent_asset_id !== rootAsset || link.edge?.child_asset_id !== childAsset) {
        throw new Error(`${binName} link-child did not dry-run the expected edge`);
      }
      if (binName === 'lineage') {
        const legacy = JSON.parse(execFileSync(join(binDir, binName), ['lineage', 'next', '--project', 'demo-project', '--root', rootAsset, '--db', dbPath, '--json'], { cwd: tmpProject, encoding: 'utf8' }));
        if (legacy.root_asset_id !== rootAsset) throw new Error('legacy lineage namespace compatibility failed');
      }
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
