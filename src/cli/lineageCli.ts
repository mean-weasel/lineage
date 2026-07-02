import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

  const [command] = args;
  if (command === 'start') {
    start(config, args.slice(1));
    return;
  }

  const json = args.includes('--json');
  const message = `Unknown command: ${command}`;
  if (json) console.error(JSON.stringify({ ok: false, command, error: message }, null, 2));
  else console.error(`${config.binName}: ${message}`);
  process.exit(1);
}
