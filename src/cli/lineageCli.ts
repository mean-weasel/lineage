import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
import { defaultProduct, packageRoot as lineagePackageRoot, setLineageAssetRoot } from '../server/assetCore';
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
import { getLineageSelectionPacket } from '../server/lineageSelectionPacket';
import { assertLineageCodeOrigin, getLineageCodeIdentity, getLineageRuntimeInfo } from '../server/runtimeInfo';
import {
  assertProfileChannel,
  assertUnselectedDatabaseIsUnbound,
  bindLineageProfileDatabase,
  cloneLineageProfileAssets,
  cloneLineageProfileDatabase,
  doctorLineageProfile,
  resolveLineageProfile,
} from '../server/lineageProfiles';
import { acquireProfileWriterLease } from '../server/profileWriterLease';
import type {
  LineageProfileAssetsCloneResult,
  LineageProfileBindResult,
  LineageProfileCloneResult,
  LineageProfileDoctorResult,
  ResolvedLineageProfile,
} from '../shared/lineageProfileTypes';
import type { LineageRuntimeCodeIdentity, LineageRuntimeInfo } from '../shared/runtimeInfoTypes';

export interface LineageCliConfig {
  binName: 'lineage' | 'lineage-dev' | 'lineage-preview';
  channel: 'stable' | 'preview' | 'dev';
  defaultHost: string;
  defaultPort: number;
  displayName: string;
}

interface StartOptions {
  assetRoot: string;
  dbPath: string;
  host: string;
  json: boolean;
  open: boolean;
  port: number;
  profile?: ResolvedLineageProfile;
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

function readOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(prefix)) values.push(arg.slice(prefix.length));
    else if (arg === name && args[index + 1] && !args[index + 1].startsWith('--')) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

export function resolveStartOptions(config: LineageCliConfig, args: string[]): StartOptions {
  const profile = prepareCliProfile(config, args);
  const serviceUrl = profile ? new URL(profile.service_origin) : undefined;
  const rawPort = readOption(args, '--port') || process.env.PORT || serviceUrl?.port || String(config.defaultPort);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  const host = readOption(args, '--host') || process.env.HOST || serviceUrl?.hostname || config.defaultHost;
  if (profile && serviceUrl && (host !== serviceUrl.hostname || port !== Number(serviceUrl.port || 80))) {
    throw new Error(`Profile ${profile.profile_id} service_origin ${profile.service_origin} conflicts with requested host/port ${host}:${port}`);
  }
  return {
    assetRoot: profile?.asset_root || resolveCliAssetRoot(args),
    dbPath: profile?.database_path || resolveCliDbPath(config, args),
    host,
    json: args.includes('--json'),
    open: args.includes('--open'),
    port,
    profile,
  };
}

function resolveCliAssetRoot(args: string[]): string {
  return resolve(readOption(args, '--asset-root') || process.env.LINEAGE_ASSET_ROOT || lineagePackageRoot);
}

function configureCliAssetRoot(args: string[]): string {
  const assetRoot = resolveCliAssetRoot(args);
  process.env.LINEAGE_ASSET_ROOT = assetRoot;
  return setLineageAssetRoot(assetRoot);
}

function resolveCliDbPath(config: LineageCliConfig, args: string[]): string {
  return readOption(args, '--db') || process.env.LINEAGE_DB || join(dataRoot(config.displayName), `${config.binName}.sqlite`);
}

function hasOption(args: string[], name: string): boolean {
  return args.includes(name) || args.some(arg => arg.startsWith(`${name}=`));
}

function profileSelector(args: string[]): string | undefined {
  const option = readOption(args, '--profile');
  if (option && process.env.LINEAGE_PROFILE && option !== process.env.LINEAGE_PROFILE) {
    throw new Error(`--profile ${option} conflicts with LINEAGE_PROFILE ${process.env.LINEAGE_PROFILE}`);
  }
  return option || process.env.LINEAGE_PROFILE;
}

function doctorFailures(result: LineageProfileDoctorResult): string {
  return result.checks.filter(check => check.status === 'fail').map(check => `${check.id}: ${check.message}`).join('; ');
}

function prepareCliProfile(config: LineageCliConfig, args: string[]): ResolvedLineageProfile | undefined {
  const selector = profileSelector(args);
  if (!selector) {
    assertUnselectedDatabaseIsUnbound(getLineageRuntimeInfo({ channel: config.channel, dbPath: resolveCliDbPath(config, args) }));
    return undefined;
  }
  if (hasOption(args, '--db')) throw new Error('A named profile cannot be combined with --db');
  if (hasOption(args, '--asset-root')) throw new Error('A named profile cannot be combined with --asset-root');
  const profile = resolveLineageProfile(selector);
  if (process.env.LINEAGE_DB && resolve(process.env.LINEAGE_DB) !== profile.database_path) {
    throw new Error(`Profile ${profile.profile_id} database_path conflicts with LINEAGE_DB`);
  }
  if (process.env.LINEAGE_ASSET_ROOT && resolve(process.env.LINEAGE_ASSET_ROOT) !== profile.asset_root) {
    throw new Error(`Profile ${profile.profile_id} asset_root conflicts with LINEAGE_ASSET_ROOT`);
  }
  assertProfileChannel(profile, config.channel);
  const runtime = getLineageRuntimeInfo({ channel: config.channel, dbPath: profile.database_path });
  const doctor = doctorLineageProfile(selector, { channel: config.channel, code: runtime.code, gitSha: runtime.git_sha, version: runtime.version });
  if (!doctor.ok) throw new Error(`Profile ${profile.profile_id} failed doctor: ${doctorFailures(doctor)}`);
  process.env.LINEAGE_ASSET_ROOT = profile.asset_root;
  process.env.LINEAGE_DB = profile.database_path;
  process.env.LINEAGE_PROFILE = selector;
  process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
  process.env.LINEAGE_PROFILE_FINGERPRINT = profile.profile_fingerprint;
  process.env.LINEAGE_PROFILE_ID = profile.profile_id;
  process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
  process.env.LINEAGE_PROFILE_SERVICE_ORIGIN = profile.service_origin;
  setLineageAssetRoot(profile.asset_root);
  return profile;
}

export function formatLineageHelp(config: LineageCliConfig): string {
  return `${config.binName} ${packageVersion()}

Usage:
  ${config.binName} start [--profile <id-or-manifest>] [--port <port>] [--host <host>] [--db <path>] [--asset-root <path>] [--open] [--json]
  ${config.binName} profile doctor --profile <id-or-manifest> [--json]
  ${config.binName} profile bind --profile <id-or-manifest> --confirm-write [--json]
  ${config.binName} profile clone --source-db <snapshot-source> --target-profile <id-or-manifest> --confirm-write [--json]
  ${config.binName} profile clone-assets --source-asset-root <path> --target-profile <id-or-manifest> --confirm-write [--json]
  ${config.binName} runtime info [--json]
  ${config.binName} runtime doctor [--json]
  ${config.binName} next [--project <project>] [--root <asset-id>] [--db <path>] [--json]
  ${config.binName} brief [--project <project>] [--root <asset-id>] [--db <path>] [--json]
  ${config.binName} inspect --asset-id <asset-id> [--project <project>] [--db <path>] [--json]
  ${config.binName} selection packet [--project <project>] [--workspace <id-or-root>|--root <asset-id>] [--channel <channel>] [--campaign <campaign>] [--context-notes <text>] [--label <label>] [--schema v2] [--out <path>] [--strict] [--db <path>] [--json]
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
  ${config.binName} tasks cancel --task <task-id> [--confirm-write] [--override] [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks override --task <task-id> --reason <text> [--instructions <text>] [--project <project>] [--db <path>] [--json]
  ${config.binName} tasks instructions --task <task-id> --instructions <text> [--project <project>] [--db <path>] [--json]
  ${config.binName} db info [--db <path>] [--json]
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

Asset catalogs and local media default to the installed package root. Pass
--asset-root <path> or LINEAGE_ASSET_ROOT to use an external project root.

All commands accept --profile <id-or-manifest> or LINEAGE_PROFILE. Named
profiles are authoritative for database, asset root, environment, and origin;
they cannot be combined with direct --db or --asset-root overrides. Commands
without a profile run in legacy-unbound diagnostic/read-only mode.

Operational commands also require an attested code origin. Stable and preview
run from separate lineage-channel install receipts. Dev runs only from a Git
checkout/worktree through npm run lineage:dev.

Server startup independently verifies code origin. When --open is requested,
the browser opens only after /api/runtime matches the expected code, profile,
database, and unique service instance.

Variation vs re-roll:
  link-child creates a new visible child variation edge.
  reroll mark -> reroll plan -> reroll import updates the same node with a new attempt.`;
}

function printHelp(config: LineageCliConfig): void {
  console.log(formatLineageHelp(config));
}

function openBrowser(url: string): void {
  const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.unref();
}

export function lineageServiceIdentityErrors(
  runtime: LineageRuntimeInfo,
  expected: {
    channel: LineageRuntimeInfo['channel'];
    code_fingerprint: string;
    database_path: string;
    instance_id: string;
    launcher_pid: number;
    profile?: ResolvedLineageProfile;
  },
): string[] {
  const errors: string[] = [];
  if (runtime.channel !== expected.channel) errors.push(`channel ${runtime.channel} != ${expected.channel}`);
  if (!runtime.code?.verified) errors.push('service code identity is not verified');
  if (runtime.code?.fingerprint !== expected.code_fingerprint) errors.push(`code fingerprint ${runtime.code?.fingerprint || 'missing'} != ${expected.code_fingerprint}`);
  if (resolve(runtime.database.path) !== resolve(expected.database_path)) errors.push(`database ${runtime.database.path} != ${expected.database_path}`);
  if (runtime.service?.instance_id !== expected.instance_id) errors.push(`service instance ${runtime.service?.instance_id || 'missing'} != ${expected.instance_id}`);
  if (runtime.service?.launcher_pid !== expected.launcher_pid) errors.push(`launcher pid ${runtime.service?.launcher_pid || 'missing'} != ${expected.launcher_pid}`);
  if (expected.profile) {
    if (!runtime.profile.bound) errors.push('service profile is unbound');
    if (runtime.profile.id !== expected.profile.profile_id) errors.push(`profile ${runtime.profile.id} != ${expected.profile.profile_id}`);
    if (runtime.profile.environment !== expected.profile.environment) errors.push(`environment ${runtime.profile.environment} != ${expected.profile.environment}`);
    if (runtime.profile.fingerprint !== expected.profile.profile_fingerprint) errors.push(`profile fingerprint ${runtime.profile.fingerprint || 'missing'} != ${expected.profile.profile_fingerprint}`);
    if (runtime.schema.profile_id !== expected.profile.profile_id) errors.push(`database profile ${runtime.schema.profile_id || 'missing'} != ${expected.profile.profile_id}`);
    if (runtime.schema.profile_fingerprint !== expected.profile.profile_fingerprint) errors.push(`database fingerprint ${runtime.schema.profile_fingerprint || 'missing'} != ${expected.profile.profile_fingerprint}`);
  }
  return errors;
}

async function openBrowserAfterReadiness(
  url: string,
  expected: Parameters<typeof lineageServiceIdentityErrors>[1],
  child: ReturnType<typeof spawn>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = 'service did not respond';
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${url}/api/runtime`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const body = await response.json() as { runtime?: LineageRuntimeInfo };
        if (body.runtime) {
          const errors = lineageServiceIdentityErrors(body.runtime, expected);
          if (errors.length === 0) {
            openBrowser(url);
            return;
          }
          lastError = errors.join('; ');
        }
      } else lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Service readiness failed; browser was not opened: ${lastError}`);
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
  configureCliAssetRoot(args);
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
  if (command === 'selection') {
    const subcommand = positionalArgs(args)[0] || '';
    if (subcommand !== 'packet') throw new Error(`Unknown selection command: ${subcommand}`);
    const schema = readOption(args, '--schema');
    if (schema && schema !== 'v2') throw new Error(`Unsupported selection packet schema: ${schema}. Omit --schema for v1 or pass --schema v2.`);
    const labels = readOptions(args, '--label')
      .flatMap(label => label.split(','))
      .map(label => label.trim())
      .filter(Boolean);
    const packet = getLineageSelectionPacket(options.project, {
      campaign: readOption(args, '--campaign'),
      channel: readOption(args, '--channel'),
      command: 'lineage selection packet',
      contextNotes: readOption(args, '--context-notes') || readOption(args, '--notes'),
      dbPath: options.dbPath,
      labels,
      packageVersion: packageVersion(),
      rootAssetId: options.rootAssetId,
      schema: schema === 'v2' ? 'v2' : undefined,
      strict: args.includes('--strict'),
      workspaceId: readOption(args, '--workspace') || readOption(args, '--workspace-id'),
    });
    const out = readOption(args, '--out');
    if (out) {
      const outPath = resolve(out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(packet, null, 2)}\n`);
    }
    return packet;
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
  if (command === 'selection' && result && typeof result === 'object' && 'packet_id' in result) {
    const packet = result as { assets?: unknown[]; packet_id: string; selection?: { count: number }; warnings?: string[]; workspace?: { root_asset_id: string } };
    console.log(`${packet.packet_id}: ${packet.selection?.count || packet.assets?.length || 0} selected asset(s)`);
    if (packet.workspace?.root_asset_id) console.log(`Root: ${packet.workspace.root_asset_id}`);
    for (const warning of packet.warnings || []) console.log(`Warning: ${warning}`);
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
      if ('claim_token' in mutation && typeof mutation.claim_token === 'string') console.log(`Token: ${mutation.claim_token}`);
      if (mutation.events && mutation.events.length > 0) console.log(`Events: ${mutation.events.map(event => event.event_type).join(', ')}`);
      return;
    }
  }
  console.log(String(result));
}

export function runLineageDbCommand(config: LineageCliConfig, command: string, args: string[]): unknown {
  configureCliAssetRoot(args);
  const dbPath = resolveCliDbPath(config, args);
  process.env.LINEAGE_DB = dbPath;
  if (command === 'info') return getLineageRuntimeInfo({ channel: config.channel, dbPath });
  throw new Error(`Unknown db command: ${command}`);
}

export function runLineageProfileCommand(config: LineageCliConfig, command: 'doctor', args: string[]): LineageProfileDoctorResult;
export function runLineageProfileCommand(config: LineageCliConfig, command: 'bind', args: string[]): LineageProfileBindResult;
export function runLineageProfileCommand(config: LineageCliConfig, command: 'clone', args: string[]): Promise<LineageProfileCloneResult>;
export function runLineageProfileCommand(config: LineageCliConfig, command: 'clone-assets', args: string[]): LineageProfileAssetsCloneResult;
export function runLineageProfileCommand(config: LineageCliConfig, command: string, args: string[]): LineageProfileDoctorResult | LineageProfileBindResult | LineageProfileAssetsCloneResult | Promise<LineageProfileCloneResult>;
export function runLineageProfileCommand(
  config: LineageCliConfig,
  command: string,
  args: string[],
): LineageProfileDoctorResult | LineageProfileBindResult | LineageProfileAssetsCloneResult | Promise<LineageProfileCloneResult> {
  const runtime = getLineageRuntimeInfo({ channel: config.channel });
  const runtimeIdentity = { channel: config.channel, code: runtime.code, gitSha: runtime.git_sha, version: runtime.version };
  if (command === 'clone') {
    const source = readOption(args, '--source-db');
    const target = readOption(args, '--target-profile');
    if (!source || !target) throw new Error('lineage profile clone requires --source-db and --target-profile');
    if (hasOption(args, '--profile')) throw new Error('Profile clone uses --target-profile, not --profile');
    if (!args.includes('--confirm-write')) throw new Error('Profile clone requires --confirm-write');
    const targetProfile = resolveLineageProfile(target);
    const writerLease = acquireProfileWriterLease(targetProfile, config.channel, 'cli');
    return cloneLineageProfileDatabase(source, target, runtimeIdentity, true)
      .finally(writerLease.release);
  }
  if (command === 'clone-assets') {
    const source = readOption(args, '--source-asset-root');
    const target = readOption(args, '--target-profile');
    if (!source || !target) throw new Error('lineage profile clone-assets requires --source-asset-root and --target-profile');
    if (hasOption(args, '--profile')) throw new Error('Profile asset clone uses --target-profile, not --profile');
    if (!args.includes('--confirm-write')) throw new Error('Profile asset clone requires --confirm-write');
    const targetProfile = resolveLineageProfile(target);
    const writerLease = acquireProfileWriterLease(targetProfile, config.channel, 'cli');
    try {
      return cloneLineageProfileAssets(source, target, runtimeIdentity, true);
    } finally {
      writerLease.release();
    }
  }
  if (hasOption(args, '--db')) throw new Error(`Profile ${command} cannot be combined with --db`);
  if (hasOption(args, '--asset-root')) throw new Error(`Profile ${command} cannot be combined with --asset-root`);
  const selector = profileSelector(args);
  if (!selector) throw new Error(`lineage profile ${command} requires --profile or LINEAGE_PROFILE`);
  if (command === 'doctor') return doctorLineageProfile(selector, runtimeIdentity);
  if (command === 'bind') {
    if (!args.includes('--confirm-write')) throw new Error('Profile bind requires --confirm-write');
    const profile = resolveLineageProfile(selector);
    const writerLease = acquireProfileWriterLease(profile, config.channel, 'cli');
    try {
      return bindLineageProfileDatabase(selector, runtimeIdentity, true);
    } finally {
      writerLease.release();
    }
  }
  throw new Error(`Unknown profile command: ${command}`);
}

function printProfileResult(result: LineageProfileDoctorResult | LineageProfileBindResult | LineageProfileCloneResult | LineageProfileAssetsCloneResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.schema_version === 'lineage.profile_doctor.v1') {
    console.log(`Profile doctor: ${result.ok ? 'ok' : 'failed'}`);
    for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  } else if (result.schema_version === 'lineage.profile_bind.v1') {
    console.log(`${result.already_bound ? 'Already bound' : 'Bound'} ${result.database_path} to ${result.identity.profile_id}`);
  } else if (result.schema_version === 'lineage.profile_clone_receipt.v1') {
    console.log(`Cloned ${result.source_database_path} to ${result.database_path} for ${result.target_identity.profile_id}`);
    console.log(`Receipt: ${result.receipt_path}`);
  } else {
    console.log(`Cloned ${result.files_copied} referenced asset file(s) into ${result.asset_root}`);
    console.log(`Receipt: ${result.receipt_path}`);
  }
}

export function lineageProfileDoctorExitCode(result: LineageProfileDoctorResult): 0 | 1 {
  return result.ok ? 0 : 1;
}

export function runLineageRuntimeCommand(config: LineageCliConfig, command: string): LineageRuntimeCodeIdentity {
  if (command === 'info') return getLineageCodeIdentity(config.channel);
  if (command === 'doctor') return assertLineageCodeOrigin(config.channel);
  throw new Error(`Unknown runtime command: ${command}`);
}

function printRuntimeResult(result: LineageRuntimeCodeIdentity, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Code origin: ${result.origin}`);
  console.log(`Code root: ${result.root}`);
  console.log(`Channel: ${result.channel}`);
  console.log(`Version: ${result.package_version}`);
  if (result.git_sha) console.log(`Git: ${result.git_sha}`);
  if (result.dirty !== undefined) console.log(`Dirty: ${result.dirty ? 'yes' : 'no'}`);
  console.log(`Fingerprint: ${result.fingerprint}`);
  console.log(`Verified: ${result.verified ? 'yes' : 'no'}`);
  for (const error of result.errors) console.log(`FAIL: ${error}`);
}

export function lineageCliRequiresWriterLease(command: string, args: string[]): boolean {
  if (command === 'next' || command === 'brief' || command === 'inspect' || command === 'selection') return false;
  const subcommand = positionalArgs(args)[0] || '';
  if (command === 'reroll') return subcommand !== 'list';
  if (command === 'tasks') return subcommand !== 'list' && subcommand !== 'inspect';
  if (command === 'db') return subcommand !== 'info';
  if (command === 'agent') return subcommand !== 'status' && subcommand !== 'graph' && subcommand !== 'inspect';
  return true;
}

function printDbResult(command: string, result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'info' && result && typeof result === 'object' && 'database' in result) {
    const runtime = result as {
      asset_root: string;
      channel: string;
      code?: LineageRuntimeCodeIdentity;
      database: { error?: string; exists: boolean; modified_at?: string; path: string; projects?: number; size_bytes?: number; workspaces?: number };
      git_sha?: string;
      node_env?: string;
      version: string;
    };
    console.log(`Channel: ${runtime.channel}`);
    console.log(`Version: ${runtime.version}`);
    if (runtime.code) {
      console.log(`Code: ${runtime.code.origin} ${runtime.code.verified ? 'verified' : 'unverified'} ${runtime.code.fingerprint}`);
      console.log(`Code root: ${runtime.code.root}`);
    }
    if (runtime.git_sha) console.log(`Git: ${runtime.git_sha}`);
    if (runtime.node_env) console.log(`Node env: ${runtime.node_env}`);
    console.log(`Assets: ${runtime.asset_root}`);
    console.log(`SQLite: ${runtime.database.path}`);
    console.log(`Exists: ${runtime.database.exists ? 'yes' : 'no'}`);
    if (runtime.database.size_bytes !== undefined) console.log(`Size: ${runtime.database.size_bytes} bytes`);
    if (runtime.database.modified_at) console.log(`Modified: ${runtime.database.modified_at}`);
    if (runtime.database.projects !== undefined) console.log(`Projects: ${runtime.database.projects}`);
    if (runtime.database.workspaces !== undefined) console.log(`Workspaces: ${runtime.database.workspaces}`);
    if (runtime.database.error) console.log(`Warning: ${runtime.database.error}`);
    return;
  }
  console.log(String(result));
}

export function runLineageAgentCommand(command: string, args: string[]): unknown {
  configureCliAssetRoot(args);
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
    console.log(JSON.stringify({ assetRoot: options.assetRoot, channel: config.channel, dbPath: options.dbPath, host: options.host, port: options.port, profile: options.profile ? { environment: options.profile.environment, id: options.profile.profile_id } : { bound: false, id: 'legacy-unbound' }, status: 'starting', url }, null, 2));
  } else {
    console.log(`${config.displayName} starting at ${url}`);
    if (options.profile) console.log(`Profile: ${options.profile.profile_id} (${options.profile.environment})`);
    else console.warn('Warning: legacy-unbound runtime; database and asset paths are not protected by a named profile.');
    console.log(`SQLite: ${options.dbPath}`);
    console.log(`Assets: ${options.assetRoot}`);
  }
  const code = getLineageCodeIdentity(config.channel);
  const serviceInstanceId = process.env.LINEAGE_SERVICE_INSTANCE_ID || randomUUID();

  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      HOST: options.host,
      LINEAGE_ASSET_ROOT: options.assetRoot,
      LINEAGE_CHANNEL: config.channel,
      LINEAGE_DB: options.dbPath,
      LINEAGE_PROFILE: options.profile ? process.env.LINEAGE_PROFILE : undefined,
      LINEAGE_PROFILE_ENVIRONMENT: options.profile?.environment,
      LINEAGE_PROFILE_FINGERPRINT: options.profile?.profile_fingerprint,
      LINEAGE_PROFILE_ID: options.profile?.profile_id,
      LINEAGE_PROFILE_MANIFEST: options.profile?.manifest_path,
      LINEAGE_PROFILE_SERVICE_ORIGIN: options.profile?.service_origin,
      LINEAGE_LAUNCHER_PID: String(process.pid),
      LINEAGE_SERVICE_INSTANCE_ID: serviceInstanceId,
      LINEAGE_DB_ACCESS: options.profile ? undefined : 'read-only',
      NODE_ENV: 'production',
      PORT: String(options.port),
    },
    stdio: 'inherit',
  });

  if (options.open) {
    void openBrowserAfterReadiness(url, {
      channel: config.channel,
      code_fingerprint: code.fingerprint,
      database_path: options.dbPath,
      instance_id: serviceInstanceId,
      launcher_pid: process.pid,
      profile: options.profile,
    }, child).catch(error => {
      console.error(`${config.binName}: ${error instanceof Error ? error.message : String(error)}`);
      child.kill('SIGTERM');
    });
  }

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

  if (command === 'profile') {
    const commandArgs = normalizedArgs.slice(2);
    const profileCommand = normalizedArgs[1] || '';
    const json = commandArgs.includes('--json');
    try {
      const result = runLineageProfileCommand(config, profileCommand, commandArgs);
      if (result instanceof Promise) {
        result.then(value => {
          printProfileResult(value, json);
          process.exit(0);
        }).catch(error => {
          const message = error instanceof Error ? error.message : String(error);
          if (json) console.error(JSON.stringify({ ok: false, command: `profile ${profileCommand}`, error: message }, null, 2));
          else console.error(`${config.binName}: ${message}`);
          process.exit(1);
        });
        return;
      }
      printProfileResult(result, json);
      process.exit(result.schema_version === 'lineage.profile_doctor.v1' ? lineageProfileDoctorExitCode(result) : 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) console.error(JSON.stringify({ ok: false, command: `profile ${profileCommand}`, error: message }, null, 2));
      else console.error(`${config.binName}: ${message}`);
      process.exit(1);
    }
  }

  if (command === 'runtime') {
    const runtimeCommand = normalizedArgs[1] || '';
    const commandArgs = normalizedArgs.slice(2);
    const json = commandArgs.includes('--json');
    try {
      printRuntimeResult(runLineageRuntimeCommand(config, runtimeCommand), json);
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) console.error(JSON.stringify({ ok: false, command: `runtime ${runtimeCommand}`, error: message }, null, 2));
      else console.error(`${config.binName}: ${message}`);
      process.exit(1);
    }
  }

  const originDiagnosticOnly = command === 'db' && normalizedArgs[1] === 'info';
  if (!originDiagnosticOnly) {
    try {
      assertLineageCodeOrigin(config.channel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const json = normalizedArgs.includes('--json');
      if (json) console.error(JSON.stringify({ ok: false, command, error: message }, null, 2));
      else console.error(`${config.binName}: ${message}`);
      process.exit(1);
    }
  }

  if (command === 'start') {
    start(config, normalizedArgs.slice(1));
    return;
  }

  try {
    const profile = prepareCliProfile(config, normalizedArgs.slice(1));
    const requiresWriter = lineageCliRequiresWriterLease(command, normalizedArgs.slice(1));
    if (profile) {
      if (requiresWriter) {
        delete process.env.LINEAGE_DB_ACCESS;
        const writerLease = acquireProfileWriterLease(profile, config.channel, 'cli');
        process.once('exit', writerLease.release);
      } else {
        process.env.LINEAGE_DB_ACCESS = 'read-only';
      }
    } else if (requiresWriter) {
      throw new Error('Persistent writes require --profile; legacy-unbound access is read-only');
    } else {
      process.env.LINEAGE_DB_ACCESS = 'read-only';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const json = normalizedArgs.includes('--json');
    if (json) console.error(JSON.stringify({ ok: false, command, error: message }, null, 2));
    else console.error(`${config.binName}: ${message}`);
    process.exit(1);
  }

  if (command === 'next' || command === 'brief' || command === 'inspect' || command === 'selection' || command === 'link-child' || command === 'reroll' || command === 'tasks') {
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

  if (command === 'db') {
    const commandArgs = normalizedArgs.slice(2);
    const dbCommand = normalizedArgs[1] || '';
    const json = commandArgs.includes('--json');
    try {
      printDbResult(dbCommand, runLineageDbCommand(config, dbCommand, commandArgs), json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) console.error(JSON.stringify({ ok: false, command: `db ${dbCommand}`, error: message }, null, 2));
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
