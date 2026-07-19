import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { preparePages } from './prepare-pages.mjs';

test('promotes the landing build to the Pages root and preserves its subpath', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'lineage-pages-'));
  const webRoot = join(temporary, 'web');
  const pagesRoot = join(temporary, 'pages');

  try {
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    mkdirSync(join(webRoot, 'landing'), { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), '<p>application</p>');
    writeFileSync(join(webRoot, 'landing', 'index.html'), '<p>landing</p>');
    writeFileSync(join(webRoot, 'assets', 'landing.js'), 'export {};');

    preparePages({ pagesRoot, webRoot });

    assert.equal(readFileSync(join(pagesRoot, 'index.html'), 'utf8'), '<p>landing</p>');
    assert.equal(readFileSync(join(pagesRoot, 'landing', 'index.html'), 'utf8'), '<p>landing</p>');
    assert.equal(readFileSync(join(pagesRoot, 'assets', 'landing.js'), 'utf8'), 'export {};');
    assert.equal(existsSync(join(pagesRoot, '.nojekyll')), true);
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

test('fails before replacing output when the landing build is missing', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'lineage-pages-missing-'));
  const webRoot = join(temporary, 'web');
  const pagesRoot = join(temporary, 'pages');

  try {
    mkdirSync(webRoot, { recursive: true });
    mkdirSync(pagesRoot, { recursive: true });
    writeFileSync(join(pagesRoot, 'sentinel'), 'keep');

    assert.throws(() => preparePages({ pagesRoot, webRoot }), /Missing landing build/);
    assert.equal(readFileSync(join(pagesRoot, 'sentinel'), 'utf8'), 'keep');
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
