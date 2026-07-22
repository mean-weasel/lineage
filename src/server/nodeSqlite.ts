import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqliteExperimentalWarning = 'SQLite is an experimental feature and might change at any time';

export function loadNodeSqlite(): typeof import('node:sqlite') {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = warning instanceof Error ? warning.message : warning;
    const type = typeof args[0] === 'string' ? args[0] : warning instanceof Error ? warning.name : undefined;
    if (message === sqliteExperimentalWarning && type === 'ExperimentalWarning') return;
    return Reflect.apply(emitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  try {
    return require('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}
