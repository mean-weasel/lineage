import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createAgentClaim,
  heartbeatAgentClaim,
  inspectAgentClaim,
  isAgentClaimError,
  listAgentClaims,
  parseClaimTtl,
  redactAgentClaimTokens,
  releaseAgentClaim,
  revokeAgentClaim,
  transferAgentClaim,
  type AgentClaimScopeType,
} from '../server/agentClaims';
import { defaultProduct } from '../server/assetCore';
import { getLineageNextAsset, getLineageSnapshot, listLineageRerollRequests } from '../server/assetLineage';
import { getLineageBrief, linkSelectedLineageChild } from '../server/assetLineageHandoff';
import { importImageRerollOutput, planImageReroll } from '../server/generationReceipts';

export interface LineageCliConfig {
  binName: 'lineage' | 'lineage-dev';
  channel: 'stable' | 'development';
  defaultHost: string;
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
  claimToken?: string;
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
    host: readOption(args, '--host') || process.env.HOST || config.defaultHost,
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
  ${config.binName} link-child --root <asset-id> --child <asset-id> [--project <project>] [--claim-token <claim-id.secret>] [--confirm-write] [--db <path>] [--json]
  ${config.binName} reroll list --root <asset-id> [--project <project>] [--db <path>] [--json]
  ${config.binName} reroll plan --root <asset-id> --target <asset-id> --prompt <text> [--project <project>] [--db <path>] [--json]
  ${config.binName} reroll import --job-id <job-id> --file <scratch-file> --confirm-write [--project <project>] [--db <path>] [--json]
  ${config.binName} agent claim --project <project> --scope <scope> --target <target-id> --agent-name <name> [--channel <channel>] [--ttl 20m] [--json]
  ${config.binName} agent status [--project <project>] [--json]
  ${config.binName} agent inspect --claim <claim-id> [--project <project>] [--json]
  ${config.binName} agent heartbeat --claim-token <claim-id.secret> [--json]
  ${config.binName} agent release --claim-token <claim-id.secret> [--json]
  ${config.binName} agent revoke --claim <claim-id> --project <project> --reason <text> --confirm-write [--json]
  ${config.binName} agent transfer --claim <claim-id> --to-agent-name <name> --confirm-write [--project <project>] [--json]
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
    claimToken: readOption(args, '--claim-token') || process.env.LINEAGE_CLAIM_TOKEN,
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
      claimToken: options.claimToken,
      confirmWrite: options.confirmWrite,
      rootAssetId: options.rootAssetId || options.assetId,
    });
  }
  if (command === 'reroll') {
    const subcommand = positionalArgs(args)[0] || '';
    if (subcommand === 'list') {
      if (!options.rootAssetId) throw new Error('lineage reroll list requires --root');
      return listLineageRerollRequests(options.project, options.rootAssetId);
    }
    if (subcommand === 'plan') {
      const targetAssetId = readOption(args, '--target');
      const prompt = readOption(args, '--prompt');
      if (!options.rootAssetId) throw new Error('lineage reroll plan requires --root');
      if (!targetAssetId) throw new Error('lineage reroll plan requires --target');
      if (!prompt) throw new Error('lineage reroll plan requires --prompt');
      return planImageReroll(options.project, {
        rootAssetId: options.rootAssetId,
        targetAssetId,
        prompt,
        dryRun: args.includes('--dry-run'),
      });
    }
    if (subcommand === 'import') {
      const jobId = readOption(args, '--job-id');
      const file = readOption(args, '--file');
      if (!jobId) throw new Error('lineage reroll import requires --job-id');
      if (!file) throw new Error('lineage reroll import requires --file');
      return importImageRerollOutput(options.project, { jobId, file, confirmWrite: options.confirmWrite });
    }
    throw new Error(`Unknown reroll command: ${subcommand}`);
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
  if (command === 'reroll' && result && typeof result === 'object') {
    if ('requests' in result) {
      const listed = result as { requests: Array<{ node_asset_id: string; notes?: string }> };
      console.log(`${listed.requests.length} pending re-roll target(s)`);
      for (const request of listed.requests) console.log(`${request.node_asset_id}${request.notes ? `: ${request.notes}` : ''}`);
      return;
    }
    if ('job' in result) {
      const planned = result as { imported?: unknown[]; job?: { id: string; status: string } };
      console.log(planned.imported ? `Imported re-roll for ${planned.job?.id || 'job'}` : `Planned re-roll ${planned.job?.id || 'job'}`);
      return;
    }
  }
  console.log(String(result));
}

export function runLineageAgentCommand(command: string, args: string[]): unknown {
  const dbPath = readOption(args, '--db');
  if (dbPath) process.env.LINEAGE_DB = dbPath;
  const project = readOption(args, '--project') || process.env.LINEAGE_DEFAULT_PRODUCT || defaultProduct;
  const claimId = readOption(args, '--claim');
  const claimToken = readOption(args, '--claim-token') || process.env.LINEAGE_CLAIM_TOKEN;
  if (command === 'claim') {
    return createAgentClaim({
      agentId: readOption(args, '--agent-id'),
      agentKind: readOption(args, '--agent-kind'),
      agentName: readOption(args, '--agent-name') || '',
      channel: readOption(args, '--channel'),
      force: args.includes('--force'),
      project,
      reason: readOption(args, '--reason'),
      scopeType: (readOption(args, '--scope') || '') as AgentClaimScopeType,
      targetId: readOption(args, '--target') || '',
      targetTitle: readOption(args, '--target-title'),
      threadId: readOption(args, '--thread-id'),
      ttlSeconds: parseClaimTtl(readOption(args, '--ttl')),
    });
  }
  if (command === 'status') return listAgentClaims(project);
  if (command === 'inspect') {
    if (!claimId) throw new Error('lineage agent inspect requires --claim');
    return inspectAgentClaim(claimId, project);
  }
  if (command === 'heartbeat') {
    if (!claimToken) throw new Error('lineage agent heartbeat requires --claim-token');
    return heartbeatAgentClaim(claimToken, parseClaimTtl(readOption(args, '--ttl')));
  }
  if (command === 'release') {
    if (!claimToken) throw new Error('lineage agent release requires --claim-token');
    return releaseAgentClaim(claimToken);
  }
  if (command === 'revoke') {
    if (!claimId) throw new Error('lineage agent revoke requires --claim');
    return revokeAgentClaim(project, claimId, {
      actor: readOption(args, '--actor') || 'human',
      confirmWrite: args.includes('--confirm-write'),
      reason: readOption(args, '--reason'),
    });
  }
  if (command === 'transfer') {
    if (!claimId) throw new Error('lineage agent transfer requires --claim');
    return transferAgentClaim(project, claimId, {
      actor: readOption(args, '--actor') || 'human',
      confirmWrite: args.includes('--confirm-write'),
      reason: readOption(args, '--reason'),
      toAgentName: readOption(args, '--to-agent-name') || '',
    });
  }
  throw new Error(`Unknown agent command: ${command}`);
}

function printAgentResult(command: string, result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'claim' && result && typeof result === 'object' && 'claim' in result) {
    const created = result as { claim?: { id: string; target_id: string }; claim_token?: string };
    console.log(`Claimed ${created.claim?.target_id || 'target'} as ${created.claim?.id || 'claim'}`);
    if (created.claim_token) console.log(`Token: ${created.claim_token}`);
    return;
  }
  if (command === 'status' && result && typeof result === 'object' && 'claims' in result) {
    const status = result as { claims: Array<{ agent_name: string; derived_state: string; target_id: string }> };
    if (status.claims.length === 0) {
      console.log('No agent claims.');
      return;
    }
    for (const claim of status.claims) console.log(`${claim.agent_name} ${claim.derived_state} ${claim.target_id}`);
    return;
  }
  if (result && typeof result === 'object' && 'claim' in result) {
    const inspected = result as { claim?: { id: string; status: string; target_id: string } };
    console.log(`${inspected.claim?.id || 'claim'} ${inspected.claim?.status || 'unknown'} ${inspected.claim?.target_id || ''}`.trim());
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

  if (command === 'next' || command === 'brief' || command === 'inspect' || command === 'link-child' || command === 'reroll') {
    const commandArgs = normalizedArgs.slice(1);
    const json = commandArgs.includes('--json');
    try {
      printDataResult(command, runLineageDataCommand(command, commandArgs), json);
    } catch (error) {
      const message = redactAgentClaimTokens(error instanceof Error ? error.message : String(error));
      if (json) {
        const output = isAgentClaimError(error)
          ? { ok: false, command, error: error.code, message, conflicts: error.conflicts }
          : { ok: false, command, error: message };
        console.error(JSON.stringify(output, null, 2));
      }
      else console.error(`${config.binName}: ${message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === 'agent') {
    const commandArgs = normalizedArgs.slice(2);
    const agentCommand = normalizedArgs[1] || '';
    const json = commandArgs.includes('--json');
    try {
      printAgentResult(agentCommand, runLineageAgentCommand(agentCommand, commandArgs), json);
    } catch (error) {
      const message = redactAgentClaimTokens(error instanceof Error ? error.message : String(error));
      if (json) {
        const output = isAgentClaimError(error)
          ? { ok: false, command: `agent ${agentCommand}`, error: error.code, message, conflicts: error.conflicts }
          : { ok: false, command: `agent ${agentCommand}`, error: message };
        console.error(JSON.stringify(output, null, 2));
      } else {
        console.error(`${config.binName}: ${message}`);
      }
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
