import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { packageRoot } from './assetCore';
import { lineageDbPath } from './assetLineageDb';

const require = createRequire(import.meta.url);

export function lineagePublicPackageCommand(): string {
  if (process.env.LINEAGE_CHANNEL === 'dev') {
    const sourceCli = join(packageRoot, 'src', 'cli', 'lineage-dev.ts');
    const builtCli = join(packageRoot, 'dist', 'cli', 'lineage-dev.js');
    return existsSync(sourceCli)
      ? `${shellQuote(process.execPath)} --import ${shellQuote(require.resolve('tsx'))} ${shellQuote(sourceCli)}`
      : `${shellQuote(process.execPath)} ${shellQuote(builtCli)}`;
  }
  if (process.env.LINEAGE_CHANNEL === 'preview') return 'LINEAGE_CHANNEL=preview npx --package @mean-weasel/lineage@next lineage-dev';
  return 'npx @mean-weasel/lineage';
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function lineageRuntimeSelector(): string {
  const manifest = process.env.LINEAGE_PROFILE_MANIFEST?.trim();
  return manifest ? `--profile ${shellQuote(manifest)}` : `--db ${shellQuote(lineageDbPath())}`;
}
