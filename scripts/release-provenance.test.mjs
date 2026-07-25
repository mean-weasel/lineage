import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsRoot);

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

test('documentation build caches do not dirty packaged runtime provenance', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'lineage-release-provenance-'));
  try {
    mkdirSync(join(temporary, 'scripts'), { recursive: true });
    copyFileSync(join(repoRoot, '.gitignore'), join(temporary, '.gitignore'));
    copyFileSync(join(scriptsRoot, 'write-runtime-build.mjs'), join(temporary, 'scripts', 'write-runtime-build.mjs'));
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({
      name: '@mean-weasel/lineage',
      version: '1.2.3',
    }));

    git(temporary, ['init']);
    git(temporary, ['add', '.gitignore', 'package.json', 'scripts/write-runtime-build.mjs']);
    git(temporary, [
      '-c', 'user.name=Lineage release test',
      '-c', 'user.email=lineage-release-test@example.invalid',
      'commit', '-m', 'fixture',
    ]);

    mkdirSync(join(temporary, 'docs-site', '.astro'), { recursive: true });
    mkdirSync(join(temporary, 'docs-site', 'node_modules', '.vite', 'deps'), { recursive: true });
    writeFileSync(join(temporary, 'docs-site', '.astro', 'content.d.ts'), 'generated');
    writeFileSync(join(temporary, 'docs-site', 'node_modules', '.vite', 'deps', '_metadata.json'), '{}');

    execFileSync(process.execPath, [join(temporary, 'scripts', 'write-runtime-build.mjs')], {
      cwd: temporary,
      stdio: 'ignore',
    });
    const build = JSON.parse(readFileSync(join(temporary, 'dist', 'runtime-build.json'), 'utf8'));

    assert.equal(build.source_dirty, false);
    assert.equal(git(temporary, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
