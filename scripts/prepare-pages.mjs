#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function preparePages({
  docsRoot = join(root, 'dist', 'docs-site'),
  pagesRoot = join(root, 'dist', 'pages'),
  webRoot = join(root, 'dist', 'web'),
} = {}) {
  const landingIndex = join(webRoot, 'landing', 'index.html');
  const docsIndex = join(docsRoot, 'index.html');
  if (!existsSync(landingIndex)) {
    throw new Error(`Missing landing build: ${landingIndex}`);
  }
  if (!existsSync(docsIndex)) {
    throw new Error(`Missing documentation build: ${docsIndex}`);
  }
  if (existsSync(join(webRoot, 'docs'))) {
    throw new Error(`Pages output collision: ${join(webRoot, 'docs')}`);
  }

  rmSync(pagesRoot, { force: true, recursive: true });
  mkdirSync(pagesRoot, { recursive: true });
  cpSync(webRoot, pagesRoot, { recursive: true });
  cpSync(docsRoot, join(pagesRoot, 'docs'), { recursive: true });
  writeFileSync(join(pagesRoot, 'index.html'), readFileSync(landingIndex));
  writeFileSync(join(pagesRoot, '.nojekyll'), '');

  return {
    docsIndex: join(pagesRoot, 'docs', 'index.html'),
    landingIndex: join(pagesRoot, 'landing', 'index.html'),
    pagesRoot,
    rootIndex: join(pagesRoot, 'index.html'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = preparePages();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
