import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultProject, repoRoot } from '../server/assetCore';
import { indexLineageAssets, markLineageRerollRequest, updateSelectedAsset } from '../server/assetLineage';
import { lineageWorkspaceId } from '../server/assetLineageWorkspaces';
import { fileSha256 } from '../server/localReview';
import { lineagePublicPackageCommand } from '../server/lineageRuntimeCommand';
import { formatAgentGraphDigest, formatLineageHelp, printDataResult, resolveStartOptions, runLineageAgentCommand, runLineageCli, runLineageDataCommand, runLineageDbCommand } from './lineageCli';

const originalEnv = { ...process.env };
const cliScratchDir = join(repoRoot, '.asset-scratch', 'vitest-cli');
const cliDbFile = join(cliScratchDir, 'lineage-cli.sqlite');
const fixtureRootAssetId = 'demo-meta-short-form-upload-demo-post-static';
const fixtureChildAssetId = 'demo-linkedin-ledger-catalog-shared';

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

function seedCliDb() {
  rmSync(cliScratchDir, { force: true, recursive: true });
  process.env.LINEAGE_DB = cliDbFile;
  indexLineageAssets(defaultProject);
}

describe('lineage CLI start options', () => {
  it('sets the configured channel before direct dev commands generate handoffs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit:0'); });

    await expect(runLineageCli(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      ['--help'],
    )).rejects.toThrow('process.exit:0');

    expect(process.env.LINEAGE_CHANNEL).toBe('dev');
    expect(lineagePublicPackageCommand()).toContain(" --import '");
    expect(lineagePublicPackageCommand()).toContain('/node_modules/tsx/dist/loader.mjs');
    expect(lineagePublicPackageCommand()).toContain('/src/cli/lineage-dev.ts');
  });

  it('pins generated preview handoffs to the published next channel', () => {
    process.env.LINEAGE_CHANNEL = 'preview';

    expect(lineagePublicPackageCommand()).toBe('LINEAGE_CHANNEL=preview npx --package @mean-weasel/lineage@next lineage-dev');
  });

  it('shows accurate task cancel help with dry-run and override options', () => {
    const help = formatLineageHelp({ binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' });

    expect(help).toContain('lineage tasks cancel --task <task-id> [--confirm-write] [--override] [--project <project>] [--db <path>] [--json]');
    expect(help).toContain('lineage selection packet [--project <project>] [--workspace <id-or-root>|--root <asset-id>]');
    expect(help).toContain('[--schema v2]');
    expect(help).toContain('lineage db info [--db <path>] [--json]');
    expect(help).toContain('--asset-root <path>');
    expect(help).not.toContain('lineage tasks cancel --task <task-id> --confirm-write [--project <project>] [--db <path>] [--json]');
  });

  it('uses stable channel defaults with an isolated runtime home', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-home';
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.LINEAGE_DB;

    const options = resolveStartOptions({ binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' }, []);

    expect(options).toMatchObject({
      dbPath: join('/tmp/lineage-home', 'lineage.sqlite'),
      host: 'lineage.localhost',
      json: false,
      open: false,
      port: 5197,
    });
  });

  it('keeps the development channel on a separate default port and database', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-dev-home';

    const options = resolveStartOptions({ binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' }, ['--json']);

    expect(options).toMatchObject({
      dbPath: join('/tmp/lineage-dev-home', 'lineage-dev.sqlite'),
      host: 'lineage-dev.localhost',
      json: true,
      port: 5198,
    });
  });

  it('reports database runtime info without requiring a server', () => {
    seedCliDb();

    const info = runLineageDbCommand(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      'info',
      ['--db', cliDbFile, '--json']
    ) as { channel: string; database: { exists: boolean; path: string; projects?: number }; version: string };

    expect(info.channel).toBe('dev');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.database).toMatchObject({ exists: true, path: cliDbFile });
    expect(info.database.projects).toBeGreaterThanOrEqual(1);
  });

  it('uses the CLI runtime database default for db info', () => {
    process.env.LINEAGE_HOME = '/tmp/lineage-runtime-info';
    delete process.env.LINEAGE_DB;

    const info = runLineageDbCommand(
      { binName: 'lineage-dev', channel: 'dev', defaultHost: 'lineage-dev.localhost', defaultPort: 5198, displayName: 'Lineage Dev' },
      'info',
      ['--json']
    ) as { database: { path: string } };

    expect(info.database.path).toBe(join('/tmp/lineage-runtime-info', 'lineage-dev.sqlite'));
  });

  it('accepts explicit host, port, database, and open flags', () => {
    const options = resolveStartOptions(
      { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
      ['--host', '0.0.0.0', '--port=6123', '--db', '/tmp/custom.sqlite', '--asset-root', '/tmp/growth-ops', '--open']
    );

    expect(options).toMatchObject({
      assetRoot: '/tmp/growth-ops',
      dbPath: '/tmp/custom.sqlite',
      host: '0.0.0.0',
      open: true,
      port: 6123,
    });
  });

  it('rejects invalid ports before spawning a server', () => {
    expect(() =>
      resolveStartOptions(
        { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
        ['--port', 'not-a-port']
      )
    ).toThrow('Invalid port: not-a-port');

    expect(() =>
      resolveStartOptions(
        { binName: 'lineage', channel: 'stable', defaultHost: 'lineage.localhost', defaultPort: 5197, displayName: 'Lineage' },
        ['--port', '70000']
      )
    ).toThrow('Invalid port: 70000');
  });
});

describe('lineage CLI handoff commands', () => {
  it('returns the next lineage base from the packaged CLI contract', () => {
    seedCliDb();

    const result = runLineageDataCommand('next', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { next_asset?: { asset_id: string } | null; root_asset_id: string };

    expect(result.root_asset_id).toBe(fixtureRootAssetId);
    expect(result.next_asset?.asset_id).toBe(fixtureRootAssetId);
  });

  it('inspects an indexed asset and supports the legacy doubled lineage namespace', () => {
    seedCliDb();

    const inspected = runLineageDataCommand('inspect', [
      '--project', defaultProject,
      '--asset-id', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { active_asset_id: string; nodes: Array<{ asset_id: string }> };
    const legacyNext = runLineageDataCommand('next', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { root_asset_id: string };

    expect(inspected.active_asset_id).toBe(fixtureRootAssetId);
    expect(inspected.nodes.map(node => node.asset_id)).toContain(fixtureRootAssetId);
    expect(legacyNext.root_asset_id).toBe(fixtureRootAssetId);
  });

  it('returns a lineage graph snapshot from the agent CLI namespace', () => {
    seedCliDb();

    const graph = runLineageAgentCommand('graph', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { active_asset_id: string; edges: unknown[]; nodes: Array<{ asset_id: string }>; root_asset_id: string };

    expect(graph.root_asset_id).toBe(fixtureRootAssetId);
    expect(graph.active_asset_id).toBe(fixtureRootAssetId);
    expect(graph.nodes.map(node => node.asset_id)).toContain(fixtureRootAssetId);
    expect(Array.isArray(graph.edges)).toBe(true);
  });

  it('exports a durable active lineage selection packet from the CLI contract', () => {
    seedCliDb();
    updateSelectedAsset(defaultProject, {
      assetId: fixtureRootAssetId,
      confirmWrite: true,
      notes: 'Use this catalog image for GrowthOps.',
      rootAssetId: fixtureRootAssetId,
    });
    const out = join(cliScratchDir, 'selection-packet.json');

    const packet = runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--db', cliDbFile,
      '--channel', 'linkedin',
      '--campaign', '2026-07-launch',
      '--context-notes', 'Create GrowthOps posts from selected images.',
      '--label', 'launch',
      '--label', 'agent-ready',
      '--out', out,
      '--json',
    ]) as {
      assets: Array<{ asset_id: string; s3: { key?: string }; selection_note?: string; storage_state: string }>;
      context: { labels: string[]; notes?: string };
      packet_id: string;
      schema_version: string;
      selection: { asset_ids: string[]; count: number };
      workspace: { root_asset_id: string };
    };

    const saved = JSON.parse(readFileSync(out, 'utf8')) as typeof packet;
    expect(packet.schema_version).toBe('lineage.selection_packet.v1');
    expect(packet.packet_id).toMatch(/^lineage_packet_[a-f0-9]{24}$/);
    expect(saved.packet_id).toBe(packet.packet_id);
    expect(packet.workspace.root_asset_id).toBe(fixtureRootAssetId);
    expect(packet.selection).toMatchObject({ asset_ids: [fixtureRootAssetId], count: 1 });
    expect(packet.context.labels).toEqual(['launch', 'agent-ready']);
    expect(packet.context.notes).toBe('Create GrowthOps posts from selected images.');
    expect(packet.assets[0]).toMatchObject({
      asset_id: fixtureRootAssetId,
      selection_note: 'Use this catalog image for GrowthOps.',
      storage_state: 's3_backed',
    });
    expect(packet.assets[0].s3.key).toContain(fixtureRootAssetId);
  });

  it('exports v2 only when explicitly selected and rejects unsupported packet schemas', () => {
    seedCliDb();
    const localFile = join(cliScratchDir, 'v2-cli-selection.png');
    writeFileSync(localFile, Buffer.from('v2-cli-selection'));
    indexLineageAssets(defaultProject);
    const localAssetId = `local-${fileSha256(localFile).slice(0, 12)}`;
    updateSelectedAsset(defaultProject, {
      assetId: localAssetId,
      confirmWrite: true,
      rootAssetId: localAssetId,
    });

    const packet = runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', localAssetId,
      '--db', cliDbFile,
      '--schema', 'v2',
      '--json',
    ]) as { identity_sha256: string; packet_id: string; schema_version: string };

    expect(packet.schema_version).toBe('lineage.selection_packet.v2');
    expect(packet.identity_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.packet_id).toBe(`lineage_packet_${packet.identity_sha256.slice(0, 24)}`);
    expect(() => runLineageDataCommand('selection', [
      'packet',
      '--project', defaultProject,
      '--root', localAssetId,
      '--db', cliDbFile,
      '--schema', 'v1',
    ])).toThrow('Unsupported selection packet schema: v1');
  });

  it('formats a readable agent graph digest for non-json CLI output', () => {
    const output = formatAgentGraphDigest({
      active_asset_id: 'root',
      edges: [{ parent_asset_id: 'root', child_asset_id: 'child' }],
      latest: ['child'],
      nodes: [
        { asset_id: 'root', title: 'Swissifier root' },
        { asset_id: 'child', is_latest: true, title: 'Swissifier child' },
      ],
      root_asset_id: 'root',
      selected: ['child'],
    });

    expect(output).toContain('Lineage graph: Swissifier root');
    expect(output).toContain('Root: root');
    expect(output).toContain('Active: Swissifier root (root)');
    expect(output).toContain('Nodes: 2  Edges: 1');
    expect(output).toContain('Next variation:\n- Swissifier child (child)');
    expect(output).toContain('Latest leaves:\n- Swissifier child (child)');
    expect(output).toContain('Edges:\n- Swissifier root (root) -> Swissifier child (child)');
  });

  it('requires a root for agent graph snapshots', () => {
    seedCliDb();

    expect(() =>
      runLineageAgentCommand('graph', [
        '--project', defaultProject,
        '--db', cliDbFile,
        '--json',
      ])
    ).toThrow('lineage agent graph requires --root');
  });

  it('dry-runs link-child and rejects unknown children before writing', () => {
    seedCliDb();

    const dryRun = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { dryRun?: boolean; edge?: { child_asset_id: string; parent_asset_id: string } };

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.edge).toMatchObject({
      child_asset_id: fixtureChildAssetId,
      parent_asset_id: fixtureRootAssetId,
    });
    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', 'missing-child',
        '--db', cliDbFile,
        '--json',
      ])
    ).toThrow('Unknown indexed asset: missing-child');
  });

  it('requires a matching claim token for confirmed link-child writes', () => {
    seedCliDb();

    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', fixtureChildAssetId,
        '--db', cliDbFile,
        '--confirm-write',
        '--json',
      ])
    ).toThrow('Mutating agent write requires a matching claim token');

    const claimed = runLineageAgentCommand('claim', [
      '--project', defaultProject,
      '--scope', 'lineage_workspace',
      '--target', lineageWorkspaceId(defaultProject, fixtureRootAssetId),
      '--target-title', 'CLI test lineage',
      '--agent-name', 'CLI test agent',
      '--db', cliDbFile,
      '--json',
    ]) as { claim_token: string };
    const linked = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--db', cliDbFile,
      '--claim-token', claimed.claim_token,
      '--confirm-write',
      '--json',
    ]) as { child_asset_id: string; edge?: { child_asset_id: string }; message?: string };

    expect(linked.child_asset_id).toBe(fixtureChildAssetId);
    expect(linked.edge?.child_asset_id).toBe(fixtureChildAssetId);
    expect(linked.message).toContain('Linked');
  });

  it('warns and blocks link-child when the selected parent has a pending re-roll', () => {
    seedCliDb();
    markLineageRerollRequest(defaultProject, {
      rootAssetId: fixtureRootAssetId,
      nodeAssetId: fixtureRootAssetId,
      notes: 'Fix distorted headline',
      requestedBy: 'human',
      confirmWrite: true,
    });

    const dryRun = runLineageDataCommand('link-child', [
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--child', fixtureChildAssetId,
      '--db', cliDbFile,
      '--json',
    ]) as { dryRun?: boolean; warning?: string };

    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.warning).toContain('Pending re-roll exists');
    expect(dryRun.warning).toContain('link-child would create a visible child variation');

    expect(() =>
      runLineageDataCommand('link-child', [
        '--project', defaultProject,
        '--root', fixtureRootAssetId,
        '--child', fixtureChildAssetId,
        '--db', cliDbFile,
        '--confirm-write',
        '--json',
      ])
    ).toThrow('link-child creates a visible child variation edge');
  });

  it('prints link-child warnings in non-json output', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => logs.push(String(value));
    try {
      printDataResult('link-child', {
        dryRun: true,
        edge: { child_asset_id: 'local-child', parent_asset_id: 'local-parent' },
        warning: 'Pending re-roll exists for local-parent. Use reroll plan/import.',
      }, false);
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([
      'Dry run: Link local-child from local-parent',
      'Warning: Pending re-roll exists for local-parent. Use reroll plan/import.',
    ]);
  });

  it('lists, plans, and imports re-roll targets from the packaged CLI contract', () => {
    seedCliDb();
    markLineageRerollRequest(defaultProject, {
      rootAssetId: fixtureRootAssetId,
      nodeAssetId: fixtureRootAssetId,
      notes: 'Fix broken text',
      requestedBy: 'human',
      confirmWrite: true,
    });

    const listed = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(listed.requests?.map(request => request.node_asset_id)).toEqual([fixtureRootAssetId]);

    const planned = runLineageDataCommand('reroll', [
      'plan',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--prompt', 'Regenerate with clean readable text.',
      '--json',
    ]) as { job?: { id: string; source_mode: string } };
    expect(planned.job).toMatchObject({ source_mode: 'lineage_reroll' });

    mkdirSync(cliScratchDir, { recursive: true });
    const outputFile = join(cliScratchDir, 'reroll-cli-output.png');
    writeFileSync(outputFile, 'reroll-cli-output');
    const imported = runLineageDataCommand('reroll', [
      'import',
      '--project', defaultProject,
      '--job-id', planned.job?.id || '',
      '--file', outputFile,
      '--confirm-write',
      '--json',
    ]) as { imported?: Array<{ parent_asset_id: string }>; job?: { status: string } };

    expect(imported.job?.status).toBe('imported');
    expect(imported.imported?.[0].parent_asset_id).toBe(fixtureRootAssetId);
  });

  it('marks and cancels re-roll targets from the packaged CLI contract', () => {
    seedCliDb();

    const dryMarked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Fix distorted headline',
      '--json',
    ]) as { dryRun?: boolean; request?: { node_asset_id: string; requested_by: string } };
    expect(dryMarked).toMatchObject({
      dryRun: true,
      request: {
        node_asset_id: fixtureRootAssetId,
        requested_by: 'agent',
      },
    });

    const emptyList = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(emptyList.requests).toEqual([]);

    const marked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Fix distorted headline',
      '--confirm-write',
      '--json',
    ]) as { request?: { node_asset_id: string; notes?: string; requested_by: string; status: string } };
    expect(marked.request).toMatchObject({
      node_asset_id: fixtureRootAssetId,
      notes: 'Fix distorted headline',
      requested_by: 'agent',
      status: 'pending',
    });

    const listed = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string; notes?: string }> };
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests?.[0]).toMatchObject({ node_asset_id: fixtureRootAssetId, notes: 'Fix distorted headline' });

    const dryCancelled = runLineageDataCommand('reroll', [
      'cancel',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--json',
    ]) as { dryRun?: boolean; request?: { status: string } };
    expect(dryCancelled).toMatchObject({ dryRun: true, request: { status: 'cancelled' } });

    const stillListed = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(stillListed.requests?.map(request => request.node_asset_id)).toEqual([fixtureRootAssetId]);

    const cancelled = runLineageDataCommand('reroll', [
      'cancel',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--confirm-write',
      '--json',
    ]) as { request?: { node_asset_id: string; status: string } };
    expect(cancelled.request).toMatchObject({ node_asset_id: fixtureRootAssetId, status: 'cancelled' });

    const finalList = runLineageDataCommand('reroll', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { requests?: Array<{ node_asset_id: string }> };
    expect(finalList.requests).toEqual([]);
  });

  it('manages lineage task queue commands from the packaged CLI contract', () => {
    seedCliDb();
    const marked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Fix distorted task text',
      '--confirm-write',
      '--json',
    ]) as { task?: { id: string; status: string; task_type: string } };
    const taskId = marked.task?.id || '';

    const listed = runLineageDataCommand('tasks', [
      'list',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--json',
    ]) as { tasks: Array<{ id: string; status: string; task_type: string }> };
    expect(listed.tasks.map(task => ({ id: task.id, status: task.status, task_type: task.task_type }))).toEqual([
      { id: taskId, status: 'pending', task_type: 'reroll' },
    ]);

    const instructed = runLineageDataCommand('tasks', [
      'instructions',
      '--project', defaultProject,
      '--task', taskId,
      '--instructions', 'Preserve the palette while replacing unreadable text.',
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { instructions?: string; status: string } };
    expect(instructed.task.instructions).toBe('Preserve the palette while replacing unreadable text.');
    expect(instructed.events.map(event => event.event_type)).toContain('instructions_updated');

    const inspected = runLineageDataCommand('tasks', [
      'inspect',
      '--project', defaultProject,
      '--task', taskId,
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { id: string; status: string; task_type: string } };
    expect(inspected.task).toMatchObject({ id: taskId, status: 'pending', task_type: 'reroll' });
    expect(inspected.events.map(event => event.event_type)).toContain('created');

    const claimed = runLineageDataCommand('tasks', [
      'claim',
      '--project', defaultProject,
      '--task', taskId,
      '--agent-name', 'CLI task worker',
      '--json',
    ]) as { claim_token: string; task: { status: string } };
    expect(claimed.claim_token).toMatch(/^claim_[a-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(claimed.task.status).toBe('claimed');

    const started = runLineageDataCommand('tasks', [
      'start',
      '--project', defaultProject,
      '--task', taskId,
      '--claim-token', claimed.claim_token,
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { status: string } };
    expect(started.task.status).toBe('in_progress');
    expect(JSON.stringify(started)).not.toContain(claimed.claim_token);

    const commented = runLineageDataCommand('tasks', [
      'comment',
      '--project', defaultProject,
      '--task', taskId,
      '--message', 'Comment from the CLI contract test.',
      '--json',
    ]) as { events: Array<{ event_type: string; message?: string }>; task: { status: string } };
    expect(commented.events.map(event => event.event_type)).toContain('comment_added');
    expect(commented.events.find(event => event.event_type === 'comment_added')?.message).toBe('Comment from the CLI contract test.');

    const dryCancelled = runLineageDataCommand('tasks', [
      'cancel',
      '--project', defaultProject,
      '--task', taskId,
      '--override',
      '--json',
    ]) as { dryRun?: boolean; task: { status: string } };
    expect(dryCancelled).toMatchObject({ dryRun: true, task: { status: 'cancelled' } });

    const cancelled = runLineageDataCommand('tasks', [
      'cancel',
      '--project', defaultProject,
      '--task', taskId,
      '--confirm-write',
      '--override',
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { status: string } };
    expect(cancelled.task.status).toBe('cancelled');
    expect(cancelled.events.map(event => event.event_type)).toContain('cancelled');

    expect(() => runLineageDataCommand('tasks', ['list', '--project', defaultProject, '--json'])).toThrow('lineage tasks list requires --root');
    expect(() => runLineageDataCommand('tasks', ['inspect', '--project', defaultProject, '--json'])).toThrow('lineage tasks inspect requires --task');
    expect(() => runLineageDataCommand('tasks', ['claim', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks claim requires --agent-name');
    expect(() => runLineageDataCommand('tasks', ['start', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks start requires --claim-token');
    expect(() => runLineageDataCommand('tasks', ['comment', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks comment requires --message');
    expect(() => runLineageDataCommand('tasks', ['cancel', '--project', defaultProject, '--json'])).toThrow('lineage tasks cancel requires --task');
    expect(() => runLineageDataCommand('tasks', ['override', '--project', defaultProject, '--json'])).toThrow('lineage tasks override requires --task');
    expect(() => runLineageDataCommand('tasks', ['override', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks override requires --reason');
    expect(() => runLineageDataCommand('tasks', ['instructions', '--project', defaultProject, '--task', taskId, '--json'])).toThrow('lineage tasks instructions requires --instructions');
  });

  it('overrides an active lineage task from the CLI back to pending with updated instructions', () => {
    seedCliDb();
    const marked = runLineageDataCommand('reroll', [
      'mark',
      '--project', defaultProject,
      '--root', fixtureRootAssetId,
      '--target', fixtureRootAssetId,
      '--notes', 'Original task instructions',
      '--confirm-write',
      '--json',
    ]) as { task?: { id: string } };
    const taskId = marked.task?.id || '';

    const claimed = runLineageDataCommand('tasks', [
      'claim',
      '--project', defaultProject,
      '--task', taskId,
      '--agent-name', 'CLI override worker',
      '--json',
    ]) as { claim_token: string };
    runLineageDataCommand('tasks', [
      'start',
      '--project', defaultProject,
      '--task', taskId,
      '--claim-token', claimed.claim_token,
      '--json',
    ]);

    const overridden = runLineageDataCommand('tasks', [
      'override',
      '--project', defaultProject,
      '--task', taskId,
      '--reason', 'Human is reassigning this task.',
      '--instructions', 'Use the updated override instructions.',
      '--json',
    ]) as { events: Array<{ event_type: string }>; task: { instructions?: string; status: string } };

    expect(overridden.task).toMatchObject({
      instructions: 'Use the updated override instructions.',
      status: 'pending',
    });
    expect(overridden.events.map(event => event.event_type)).toContain('human_override');
  });

  it('prints readable task queue results in non-json output', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => logs.push(String(value));
    try {
      printDataResult('tasks', {
        tasks: [
          { id: 'task-1', status: 'pending', task_type: 'reroll', target_asset_id: 'asset-1' },
          { id: 'task-2', status: 'in_progress', task_type: 'iterate', target_asset_id: 'asset-2' },
        ],
      }, false);
      printDataResult('tasks', {
        task: { id: 'task-1', status: 'claimed', task_type: 'reroll', target_asset_id: 'asset-1' },
        events: [{ event_type: 'created' }, { event_type: 'claimed' }],
        claim_token: 'claim_task.secret_123',
      }, false);
    } finally {
      console.log = originalLog;
    }

    expect(logs).toEqual([
      '2 lineage task(s)',
      'task-1 reroll pending asset-1',
      'task-2 iterate in_progress asset-2',
      'task-1 reroll claimed asset-1',
      'Token: claim_task.secret_123',
      'Events: created, claimed',
    ]);
  });

  it('keeps package docs aligned with claim-aware mutating command contracts', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const operator = readFileSync(join(repoRoot, 'plugins/lineage-codex-plugin/skills/lineage-package-operator/SKILL.md'), 'utf8');

    expect(readme).toContain('lineage agent claim --project demo-project --scope lineage_workspace');
    expect(readme).toContain('lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json');
    expect(operator).toContain('lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN"');
    expect(operator).toContain('lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --db /absolute/path/to/lineage.sqlite --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json');
    expect(readme).toContain('lineage reroll mark --project demo-project --root <root-asset-id> --target <target-asset-id> --notes "Fix distorted text" --confirm-write --json');
    expect(readme).toContain('lineage reroll cancel --project demo-project --root <root-asset-id> --target <target-asset-id> --confirm-write --json');
    expect(operator).toContain('lineage reroll mark --project demo-project --root <root-asset-id> --target <target-asset-id> --notes "Fix distorted text" --db /absolute/path/to/lineage.sqlite --confirm-write --json');
    expect(operator).toContain('lineage reroll cancel --project demo-project --root <root-asset-id> --target <target-asset-id> --db /absolute/path/to/lineage.sqlite --confirm-write --json');
    expect(readme).toContain('`lineage link-child` creates a new visible descendant');
    expect(readme).toContain('`lineage reroll import` updates the target node');
    expect(operator).toContain('Do not use it for re-rolls.');
    expect(readme).toContain('Use `project_channel` only for rare work');
    expect(operator).toContain('Use `project_channel` claims only for rare');
  });
});
