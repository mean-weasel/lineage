import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('node:sqlite warning handling', () => {
  it('suppresses only the built-in SQLite experimental warning', () => {
    const moduleUrl = new URL(`file://${resolve('src/server/nodeSqlite.ts')}`).href;
    const script = [
      `import { loadNodeSqlite } from ${JSON.stringify(moduleUrl)};`,
      'loadNodeSqlite();',
      "process.emitWarning('an unrelated experimental feature', { type: 'ExperimentalWarning' });",
      "process.emitWarning('an ordinary warning');",
    ].join('\n');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('SQLite is an experimental feature');
    expect(result.stderr).toContain('ExperimentalWarning: an unrelated experimental feature');
    expect(result.stderr).toContain('Warning: an ordinary warning');
  });
});
