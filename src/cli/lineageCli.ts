import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultProduct } from '../server/assetCore';
import { getLineageNextAsset, getLineageSnapshot } from '../server/assetLineage';
import { getLineageBrief, linkSelectedLineageChild } from '../server/assetLineageHandoff';

export interface LineageCliConfig {
  binName: 'lineage' | 'lineage-dev';
  channel: 'stable' | 'development';
  defaultPort: number;
  displayName: string;
}

interface StartOptions {
  dbPath: string;
  host: string;
  json: boolean;
  open: boolean;
  port: number;
}

interface DataCommandOptions {
  assetId?: string;
  childAssetId?: string;
  confirmWrite: boolean;
  dbPath?: string;
  json: boolean;
  project: string;
  rootAssetId?: string;
}

const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function packageVersion(): string {
  try {
    const packageInfo = JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version?: string };
    return packageInfo.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function dataRoot(displayName: string): string {
  if (process.env.LINEAGE_HOME) return process.env.LINEAGE_HOME;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', displayName);
  if (platform() === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), displayName);
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), displayName.toLowerCase().replace(/\s+/g, '-'));
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

export function resolveStartOptions(config: LineageCliConfig, args: string[]): StartOptions {
  const runtimeDir = dataRoot(config.displayName);
  const rawPort = readOption(args, '--port') || process.env.PORT || String(config.defaultPort);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return {
    dbPath: readOption(args, '--db') || process.env.LINEAGE_DB || join(runtimeDir, `${config.binName}.sqlite`),
    host: readOption(args, '--host') || process.env.HOST || '127.0.0.1',
    json: args.includes('--json'),
    open: args.includes('--open'),
    port,
  };
}

function printHelp(config: LineageCliConfig): void {
  console.log(`${config.binName} ${packageVersion()}

Usage:
  ${config.binName} start [--port <port>] [--host <host>] [--db <path>] [--open] [--json]
  ${config.binName} next [--project <project>] [--root <asset-id>] [--db <path>] [--json]
  ${config.binName} brief [--project <project>] [--root <asset-id>] [--db <path>] [--json]
  ${config.binName} inspect --asset-id <asset-id> [--project <project>] [--db <path>] [--json]
  ${config.binName} link-child --root <asset-id> --child <asset-id> [--project <project>] [--confirm-write] [--db <path>] [--json]
  ${config.binName} --help
  ${config.binName} --version

${config.displayName} runs the bundled Lineage server for the ${config.channel} channel.`);
}

function openBrowser(url: string): void {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

function positionalArgs(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && args[index + 1] && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function resolveDataCommandOptions(args: string[]): DataCommandOptions {
  const positions = positionalArgs(args);
  const options = {
    assetId: readOption(args, '--asset-id') || positions[0],
    childAssetId: readOption(args, '--child'),
    confirmWrite: args.includes('--confirm-write'),
    dbPath: readOption(args, '--db'),
    json: args.includes('--json'),
    project: readOption(args, '--project') || process.env.LINEAGE_DEFAULT_PRODUCT || defaultProduct,
    rootAssetId: readOption(args, '--root'),
  };
  if (options.dbPath) process.env.LINEAGE_DB = options.dbPath;
  return options;
}

export function runLineageDataCommand(command: string, args: string[]): unknown {
  const options = resolveDataCommandOptions(args);
  if (command === 'next') return getLineageNextAsset(options.project, options.rootAssetId || options.assetId);
  if (command === 'brief') return getLineageBrief(options.project, options.rootAssetId || options.assetId);
  if (command === 'inspect') {
    if (!options.assetId) throw new Error('lineage inspect requires --asset-id');
    return getLineageSnapshot(options.project, options.assetId);
  }
  if (command === 'link-child') {
    if (!options.childAssetId) throw new Error('lineage link-child requires --child');
    return linkSelectedLineageChild(options.project, {
      childAssetId: options.childAssetId,
      confirmWrite: options.confirmWrite,
      rootAssetId: options.rootAssetId || options.assetId,
    });
  }
  throw new Error(`Unknown command: ${command}`);
}

function printDataResult(command: string, result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'next' && result && typeof result === 'object' && 'reason' in result) {
    const next = result as { next_asset?: { asset_id: string; title: string } | null; reason: string; root_asset_id: string };
    console.log(next.next_asset ? `${next.next_asset.asset_id}: ${next.next_asset.title}` : `No next asset: ${next.reason}`);
    console.log(`Root: ${next.root_asset_id}`);
    return;
  }
  if (command === 'brief' && result && typeof result === 'object' && 'brief' in result) {
    const brief = result as { brief: { title: string; prompt: string } };
    console.log(brief.brief.title);
    console.log(brief.brief.prompt);
    return;
  }
  if (command === 'inspect' && result && typeof result === 'object' && 'nodes' in result) {
    const snapshot = result as { active_asset_id: string; edges: unknown[]; nodes: unknown[]; root_asset_id: string };
    console.log(`${snapshot.root_asset_id}: ${snapshot.nodes.length} node(s), ${snapshot.edges.length} edge(s)`);
    console.log(`Active: ${snapshot.active_asset_id}`);
    return;
  }
  if (command === 'link-child' && result && typeof result === 'object') {
    const link = result as { dryRun?: boolean; edge?: { child_asset_id: string; parent_asset_id: string }; message?: string };
    console.log(link.message || `${link.dryRun ? 'Dry run: ' : ''}Link ${link.edge?.child_asset_id || 'child'} from ${link.edge?.parent_asset_id || 'parent'}`);
    return;
  }
  console.log(String(result));
}

function start(config: LineageCliConfig, args: string[]): void {
  let options: StartOptions;
  const json = args.includes('--json');
  try {
    options = resolveStartOptions(config, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(`${config.binName}: ${message}`);
    process.exit(1);
  }
  const serverPath = join(packageRoot(), 'dist', 'server.js');
  if (!existsSync(serverPath)) {
    const message = `Missing bundled server at ${serverPath}. Run npm run build before using ${config.binName} start from a source checkout.`;
    if (options.json) console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(`${config.binName}: ${message}`);
    process.exit(1);
  }

  mkdirSync(dirname(options.dbPath), { recursive: true });
  const url = `http://${options.host}:${options.port}`;
  if (options.json) {
    console.log(JSON.stringify({ channel: config.channel, dbPath: options.dbPath, host: options.host, port: options.port, status: 'starting', url }, null, 2));
  } else {
    console.log(`${config.displayName} starting at ${url}`);
    console.log(`SQLite: ${options.dbPath}`);
  }
  if (options.open) openBrowser(url);

  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      HOST: options.host,
      LINEAGE_CHANNEL: config.channel,
      LINEAGE_DB: options.dbPath,
      NODE_ENV: 'production',
      PORT: String(options.port),
    },
    stdio: 'inherit',
  });

  let forwardedSignal: NodeJS.Signals | undefined;
  const stop = (signal: NodeJS.Signals) => {
    forwardedSignal = signal;
    child.kill(signal);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.on('exit', code => process.exit(code ?? (forwardedSignal ? signalExitCodes[forwardedSignal] || 1 : 0)));
  child.on('error', error => {
    console.error(`${config.binName}: failed to start server: ${error.message}`);
    process.exit(1);
  });
}

export function runLineageCli(config: LineageCliConfig, args = process.argv.slice(2)): void {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp(config);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(packageVersion());
    process.exit(0);
  }

  const normalizedArgs = args[0] === 'lineage' ? args.slice(1) : args;
  const [command] = normalizedArgs;
  if (command === 'start') {
    start(config, normalizedArgs.slice(1));
    return;
  }

  if (command === 'next' || command === 'brief' || command === 'inspect' || command === 'link-child') {
    const commandArgs = normalizedArgs.slice(1);
    const json = commandArgs.includes('--json');
    try {
      printDataResult(command, runLineageDataCommand(command, commandArgs), json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) console.error(JSON.stringify({ ok: false, command, error: message }, null, 2));
      else console.error(`${config.binName}: ${message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  const json = args.includes('--json');
  const message = `Unknown command: ${command}`;
  if (json) console.error(JSON.stringify({ ok: false, command, error: message }, null, 2));
  else console.error(`${config.binName}: ${message}`);
  process.exit(1);
}
