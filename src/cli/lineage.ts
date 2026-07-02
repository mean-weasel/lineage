#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliName = 'lineage';

function packageVersion(): string {
  try {
    const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const packageInfo = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return packageInfo.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(): void {
  console.log(`${cliName} ${packageVersion()}

Usage:
  ${cliName} --help
  ${cliName} --version
  ${cliName} <command> [--json]

This package includes a public CLI bridge, but command implementations are not bundled yet.
Task 6 will add the real Lineage CLI identities and commands.`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(packageVersion());
  process.exit(0);
}

const message = 'Lineage CLI bridge is installed, but this command is not implemented in the public package yet.';
if (args.includes('--json')) {
  console.log(JSON.stringify({ ok: false, command: args.filter(arg => arg !== '--json'), message, status: 'install_incomplete' }, null, 2));
} else {
  console.error(`${cliName}: ${message}`);
}
process.exit(1);
