import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { packageRoot } from './assetCore';

const require = createRequire(import.meta.url);

export function lineageCliLauncher(channel = process.env.LINEAGE_CHANNEL): string {
  if (channel === 'dev') {
    const sourceCli = join(packageRoot, 'src', 'cli', 'lineage-dev.ts');
    const builtCli = join(packageRoot, 'dist', 'cli', 'lineage-dev.js');
    return existsSync(sourceCli)
      ? `${shellQuote(process.execPath)} --import ${shellQuote(require.resolve('tsx'))} ${shellQuote(sourceCli)}`
      : `${shellQuote(process.execPath)} ${shellQuote(builtCli)}`;
  }
  if (channel === 'preview') return 'lineage-preview';
  if (channel === 'stable') return 'lineage-stable';
  throw new Error('LINEAGE_CHANNEL must be stable, preview, or dev before generating a Lineage command');
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function lineageRuntimeSelector(databasePath?: string): string {
  const manifest = process.env.LINEAGE_PROFILE_MANIFEST?.trim();
  const database = databasePath || process.env.LINEAGE_DB || join(packageRoot, '.lineage', 'asset-lineage.sqlite');
  return manifest ? `--profile ${shellQuote(manifest)}` : `--db ${shellQuote(database)}`;
}

export function lineageCliCommand(command: string): string {
  const normalized = command.trim().replace(/\s+--json$/, '');
  return `${lineageCliLauncher()} ${normalized} ${lineageRuntimeSelector()} --json`;
}
