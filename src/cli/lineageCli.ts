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
import {
  clearLineageRerollRequest,
  getLineageNextAsset,
  getLineageSnapshot,
  listLineageRerollRequests,
  markLineageRerollRequest,
} from '../server/assetLineage';
import { getLineageBrief, linkSelectedLineageChild } from '../server/assetLineageHandoff';
import {
  addLineageTaskComment,
  cancelLineageTask,
  claimLineageTask,
  getLineageTask,
  listLineageTasks,
  overrideLineageTask,
  startLineageTask,
  updateLineageTaskInstructions,
} from '../server/assetLineageTasks';
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
  ${config.binName} reroll mark --root <asset-id> --target <asset-id> [--notes <text>] [--requested-by agent|human|system] [--project <project>] [--confirm-write] [--db <path>] [--json]
  ${config.binName} reroll cancel --root <asset-id> --target <asset-id> [--project <project>] [--confirm-write] [--db <path>] [--json]
  ${config.binName} reroll plan --root <asset-id> --target <asset-id> --prompt <text> [--project <project>] [--db <path>] [--json]
  ${config.binName} reroll import --job-id <job-id> --file <scratch-file> --confirm-write [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks list --root <asset-id> [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks inspect --task <task-id> [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks claim --task <task-id> --agent-name <name> [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks start --task <task-id> --claim-token <claim-id.secret> [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks comment --task <task-id> --message <text> [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks cancel --task <task-id> --confirm-write [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks override --task <task-id> --reason <text> [--instructions <text>] [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks instructions --task <task-id> --instructions <text> [--project <project>] [--db <path>] [--json]
  ${config.binName} agent claim --project <project> --scope <scope> --target <target-id> --agent-name <name> [--channel <channel>] [--ttl 20m] [--json]
  ${config.binName} agent graph --root <asset-id> [--project <project>] [--db <path>] [--json]
  ${config.binName} agent status [--project <project>] [--json]
  ${config.binName} agent inspect --claim <claim-id> [--project <project>] [--json]
  ${config.binName} agent heartbeat --claim-token <claim-id.secret> [--json]
  ${config.binName} agent release --claim-token <claim-id.secret> [--json]
  ${config.binName} agent revoke --claim <claim-id> --project <project> --reason <text> --confirm-write [--json]
  ${config.binName} agent transfer --claim <claim-id> --to-agent-name <name> --confirm-write [--project <project>] [--json]
  ${config.binName} --help
  ${config.binName} --version

${config.displayName} runs the bundled Lineage server for the ${config.channel} channel.

Variation vs re-roll:
  link-child creates a new visible child variation edge.
  reroll mark -> reroll plan -> reroll import updates the same node with a new attempt.`);
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
    if (subcommand === 'mark') {
      const targetAssetId = readOption(args, '--target');
      const requestedBy = rerollRequestedBy(readOption(args, '--requested-by') || 'agent');
      if (!options.rootAssetId) throw new Error('lineage reroll mark requires --root');
      if (!targetAssetId) throw new Error('lineage reroll mark requires --target');
      return markLineageRerollRequest(options.project, {
        rootAssetId: options.rootAssetId,
        nodeAssetId: targetAssetId,
        notes: readOption(args, '--notes'),
        requestedBy,
        confirmWrite: options.confirmWrite,
      });
    }
    if (subcommand === 'cancel') {
      const targetAssetId = readOption(args, '--target');
      if (!options.rootAssetId) throw new Error('lineage reroll cancel requires --root');
      if (!targetAssetId) throw new Error('lineage reroll cancel requires --target');
      return clearLineageRerollRequest(options.project, {
        rootAssetId: options.rootAssetId,
        nodeAssetId: targetAssetId,
        confirmWrite: options.confirmWrite,
      });
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
  if (command === 'tasks') {
    const subcommand = positionalArgs(args)[0] || '';
    const taskId = readOption(args, '--task');
    if (subcommand === 'list') {
      if (!options.rootAssetId) throw new Error('lineage tasks list requires --root');
      return listLineageTasks(options.project, options.rootAssetId);
    }
    if (subcommand === 'inspect') {
      if (!taskId) throw new Error('lineage tasks inspect requires --task');
      return getLineageTask(options.project, taskId);
    }
    if (subcommand === 'claim') {
      const agentName = readOption(args, '--agent-name');
      if (!taskId) throw new Error('lineage tasks claim requires --task');
      if (!agentName) throw new Error('lineage tasks claim requires --agent-name');
      return claimLineageTask(options.project, { taskId, agentName });
    }
    if (subcommand === 'start') {
      if (!taskId) throw new Error('lineage tasks start requires --task');
      if (!options.claimToken) throw new Error('lineage tasks start requires --claim-token');
      return startLineageTask(options.project, { taskId, claimToken: options.claimToken });
    }
    if (subcommand === 'comment') {
      const message = readOption(args, '--message');
      if (!taskId) throw new Error('lineage tasks comment requires --task');
      if (!message) throw new Error('lineage tasks comment requires --message');
      return addLineageTaskComment(options.project, {
        actor: readOption(args, '--actor') || 'human',
        message,
        taskId,
      });
    }
    if (subcommand === 'cancel') {
      if (!taskId) throw new Error('lineage tasks cancel requires --task');
      return cancelLineageTask(options.project, {
        actor: readOption(args, '--actor') || 'human',
        confirmWrite: options.confirmWrite,
        override: args.includes('--override'),
        taskId,
      });
    }
    if (subcommand === 'override') {
      const reason = readOption(args, '--reason');
      if (!taskId) throw new Error('lineage tasks override requires --task');
      if (!reason) throw new Error('lineage tasks override requires --reason');
      return overrideLineageTask(options.project, {
        actor: readOption(args, '--actor') || 'human',
        instructions: readOption(args, '--instructions'),
        reason,
        taskId,
      });
    }
    if (subcommand === 'instructions') {
      const instructions = readOption(args, '--instructions');
      if (!taskId) throw new Error('lineage tasks instructions requires --task');
      if (instructions === undefined) throw new Error('lineage tasks instructions requires --instructions');
      return updateLineageTaskInstructions(options.project, { instructions, taskId });
    }
    throw new Error(`Unknown tasks command: ${subcommand}`);
  }
  throw new Error(`Unknown command: ${command}`);
}

function rerollRequestedBy(value: string): 'agent' | 'human' | 'system' {
  if (value === 'agent' || value === 'human' || value === 'system') return value;
  throw new Error(`Invalid re-roll requester: ${value}`);
}

export function printDataResult(command: string, result: unknown, json: boolean): void {
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
    const link = result as { dryRun?: boolean; edge?: { child_asset_id: string; parent_asset_id: string }; message?: string; warning?: string };
    console.log(link.message || `${link.dryRun ? 'Dry run: ' : ''}Link ${link.edge?.child_asset_id || 'child'} from ${link.edge?.parent_asset_id || 'parent'}`);
    if (link.warning) console.log(`Warning: ${link.warning}`);
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
    if ('request' in result) {
      const mutation = result as { dryRun?: boolean; request?: { node_asset_id: string; status: string } };
      console.log(`${mutation.dryRun ? 'Dry run: ' : ''}Re-roll ${mutation.request?.status || 'request'} for ${mutation.request?.node_asset_id || 'target'}`);
      return;
    }
  }
  if (command === 'tasks' && result && typeof result === 'object') {
    if ('tasks' in result) {
      const listed = result as { tasks: Array<{ id: string; status: string; target_asset_id: string; task_type: string }> };
      console.log(`${listed.tasks.length} lineage task(s)`);
      for (const task of listed.tasks) console.log(`${task.id} ${task.task_type} ${task.status} ${task.target_asset_id}`);
      return;
    }
    if ('task' in result) {
      const mutation = result as {
        dryRun?: boolean;
        events?: Array<{ event_type: string }>;
        task?: { id: string; status: string; target_asset_id: string; task_type: string };
      };
      const prefix = mutation.dryRun ? 'Dry run: ' : '';
      console.log(`${prefix}${mutation.task?.id || 'task'} ${mutation.task?.task_type || 'task'} ${mutation.task?.status || 'unknown'} ${mutation.task?.target_asset_id || ''}`.trim());
      if (mutation.events && mutation.events.length > 0) console.log(`Events: ${mutation.events.map(event => event.event_type).join(', ')}`);
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
  if (command === 'graph') {
    const rootAssetId = readOption(args, '--root') || readOption(args, '--asset-id') || positionalArgs(args)[0];
    if (!rootAssetId) throw new Error('lineage agent graph requires --root');
    return getLineageSnapshot(project, rootAssetId);
  }
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
  if (command === 'graph' && result && typeof result === 'object' && 'nodes' in result) {
    console.log(formatAgentGraphDigest(result as AgentGraphDigestSnapshot));
    return;
  }
  console.log(String(result));
}

interface AgentGraphDigestSnapshot {
  active_asset_id: string;
  edges: Array<{ child_asset_id: string; parent_asset_id: string }>;
  latest?: string[];
  nodes: Array<{ asset_id: string; is_latest?: boolean; title?: string }>;
  root_asset_id: string;
  selected?: string[];
}

export function formatAgentGraphDigest(snapshot: AgentGraphDigestSnapshot): string {
  const lines: string[] = [];
  const titleFor = (assetId: string) => {
    const node = snapshot.nodes.find(item => item.asset_id === assetId);
    return node?.title ? `${node.title} (${assetId})` : assetId;
  };
  const root = snapshot.nodes.find(node => node.asset_id === snapshot.root_asset_id);
  lines.push(`Lineage graph: ${root?.title || snapshot.root_asset_id}`);
  lines.push(`Root: ${snapshot.root_asset_id}`);
  lines.push(`Active: ${titleFor(snapshot.active_asset_id)}`);
  lines.push(`Nodes: ${snapshot.nodes.length}  Edges: ${snapshot.edges.length}`);
  const selected = snapshot.selected || [];
  if (selected.length > 0) {
    lines.push('Next variation:');
    for (const assetId of selected) lines.push(`- ${titleFor(assetId)}`);
  }
  const latest = snapshot.latest || snapshot.nodes.filter(node => node.is_latest).map(node => node.asset_id);
  if (latest.length > 0) {
    lines.push('Latest leaves:');
    for (const assetId of latest) lines.push(`- ${titleFor(assetId)}`);
  }
  lines.push('Edges:');
  for (const edge of snapshot.edges) lines.push(`- ${titleFor(edge.parent_asset_id)} -> ${titleFor(edge.child_asset_id)}`);
  return lines.join('\n');
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

  if (command === 'next' || command === 'brief' || command === 'inspect' || command === 'link-child' || command === 'reroll' || command === 'tasks') {
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
