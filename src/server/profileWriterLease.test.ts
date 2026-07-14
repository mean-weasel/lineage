import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResolvedLineageProfile } from '../shared/lineageProfileTypes';
import { lineageDb } from './assetLineageDb';
import { repoRoot } from './assetCore';
import { listLineageWorkspaces } from './assetLineageWorkspaces';
import { acquireProfileWriterLease, getProfileWriterDelegation, inspectProfileWriterLease, profileWriterLockPath } from './profileWriterLease';
import { lineageCliCanDelegateMutation, lineageCliRequiresWriterLease } from '../cli/lineageCli';
import { managedWriterRequestSchemaVersion, managedWriterRoute, managedWriterTimeoutMs } from './managedWriterRouting';

const scratchRoot = join(repoRoot, '.asset-scratch', 'vitest-profile-writer-lease');
const originalEnv = { ...process.env };
const liveChildren = new Set<ChildProcess>();
const childSource = `
  const { acquireProfileWriterLease } = await import('./src/server/profileWriterLease.ts');
  const profile = JSON.parse(Buffer.from(process.env.TEST_PROFILE_B64, 'base64').toString('utf8'));
  try {
    const lease = acquireProfileWriterLease(profile, process.env.TEST_CHANNEL, 'service');
    process.stdout.write('ACQUIRED\\n');
    if (process.env.TEST_HOLD === '1') setInterval(() => {}, 1000);
    else { lease.release(); process.exit(0); }
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\\n');
    process.exit(23);
  }
`;

beforeEach(() => {
  process.env = { ...originalEnv };
  clearProfileEnvironment();
  rmSync(scratchRoot, { force: true, recursive: true });
  mkdirSync(scratchRoot, { recursive: true });
});

afterEach(async () => {
  const children = [...liveChildren];
  for (const child of children) child.kill('SIGKILL');
  await Promise.all(children.map(child => once(child, 'exit').catch(() => undefined)));
  process.env = { ...originalEnv };
  rmSync(scratchRoot, { force: true, recursive: true });
});

describe('profile writer lease', () => {
  it('lets one managed service own the profile, refuses a second, and cleans up on SIGTERM', async () => {
    const port = await availablePort();
    const profile = testProfile('development-main', 'development', `http://127.0.0.1:${port}`);
    bindProfileDatabase(profile);
    const owner = spawnService(profile, 'dev');
    await waitForLine(owner, `Lineage listening on http://127.0.0.1:${port}`);

    const reader = await collectExit(spawnCli(profile, ['agent', 'status', '--json']));
    expect(reader, reader.stderr).toMatchObject({ code: 0 });
    expect(reader.stdout).toContain('"claims": []');
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);

    const routedWriter = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'demo-project:lineage-workspace:root', '--agent-name', 'contender', '--json',
    ]));
    expect(routedWriter, routedWriter.stderr).toMatchObject({ code: 0 });
    expect(routedWriter.stdout).toContain('"agent_name": "contender"');
    const conflict = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'demo-project:lineage-workspace:root', '--agent-name', 'second', '--json',
    ]));
    expect(conflict.code).toBe(1);
    expect(JSON.parse(conflict.stderr)).toMatchObject({
      error: 'target_already_claimed',
      conflicts: [expect.objectContaining({ agent_name: 'contender' })],
    });

    const contender = spawnService(profile, 'dev');
    const rejected = await collectExit(contender);
    expect(rejected.code).toBe(1);
    expect(rejected.stderr).toContain('already has an active service writer');

    owner.kill('SIGTERM');
    const stopped = await collectExit(owner);
    expect(stopped.code).toBe(143);
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  });

  it('runs a generated claimed link-child handoff through the managed service and rejects a direct Lineage writer', async () => {
    const port = await availablePort();
    const profile = testProfile('generated-handoff', 'development', `http://127.0.0.1:${port}`);
    writeTestCatalog(profile);
    bindProfileDatabase(profile);
    const owner = spawnService(profile, 'dev');
    await waitForLine(owner, `Lineage listening on http://127.0.0.1:${port}`);

    await postJson(profile.service_origin, '/api/lineage-workspaces', {
      activate: true,
      confirmWrite: true,
      project: 'demo-project',
      rootAssetId: 'root',
      title: 'Managed writer acceptance',
    });
    await postJson(profile.service_origin, '/api/selection', {
      assetId: 'root',
      confirmWrite: true,
      project: 'demo-project',
      rootAssetId: 'root',
    });
    const brief = await getJson<{ handoff: { link_child_command: string } }>(
      profile.service_origin,
      '/api/lineage/root/brief?project=demo-project',
    );
    expect(brief.handoff.link_child_command).toContain(`--profile '${profile.manifest_path}'`);

    const claimed = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--project', 'demo-project', '--scope', 'lineage_workspace',
      '--target', 'demo-project:lineage-workspace:root', '--agent-name', 'handoff-agent', '--json',
    ]));
    expect(claimed, claimed.stderr).toMatchObject({ code: 0 });
    const claimToken = (JSON.parse(claimed.stdout) as { claim_token: string }).claim_token;

    const heartbeat = await collectExit(spawnCli(profile, [
      'agent', 'heartbeat', '--claim-token', claimToken, '--json',
    ]));
    expect(heartbeat, heartbeat.stderr).toMatchObject({ code: 0 });
    expect(heartbeat.stdout).toContain('"derived_state": "active"');

    const wrongToken = await collectExit(spawnGeneratedHandoff(brief.handoff.link_child_command, 'child', 'claim_wrong.secret'));
    expect(wrongToken.code).toBe(1);
    expect(wrongToken.stderr).toMatch(/invalid claim token|claim_token_invalid/i);
    expect(JSON.parse(wrongToken.stderr)).toMatchObject({ error: 'claim_token_invalid', conflicts: [] });
    expect((await getJson<{ edges: unknown[] }>(profile.service_origin, '/api/lineage/root?project=demo-project')).edges).toHaveLength(0);

    const linked = await collectExit(spawnGeneratedHandoff(brief.handoff.link_child_command, 'child', claimToken));
    expect(linked, linked.stderr).toMatchObject({ code: 0 });
    expect(linked.stdout).toContain('"child_asset_id": "child"');
    expect((await getJson<{ edges: Array<{ child_asset_id: string }> }>(profile.service_origin, '/api/lineage/root?project=demo-project')).edges)
      .toContainEqual(expect.objectContaining({ child_asset_id: 'child' }));

    const directWriter = await collectExit(spawnDirectLineageWriter(profile));
    expect(directWriter.code).toBe(24);
    expect(directWriter.stderr).toContain('holding the profile writer lease');
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);

    owner.kill('SIGTERM');
    await collectExit(owner);
  });

  it('rejects wrong profile/service identity before dispatch', async () => {
    const port = await availablePort();
    const profile = testProfile('identity-owner', 'development', `http://127.0.0.1:${port}`);
    bindProfileDatabase(profile);
    const owner = spawnService(profile, 'dev');
    await waitForLine(owner, `Lineage listening on http://127.0.0.1:${port}`);
    const delegation = getProfileWriterDelegation(profile);

    const response = await fetch(new URL(managedWriterRoute, profile.service_origin), {
      body: JSON.stringify({
        args: ['claim', '--scope', 'lineage_workspace', '--target', 'wrong', '--agent-name', 'wrong-service'],
        channel: 'dev',
        command: 'agent',
        environment: 'development',
        profile_id: 'wrong-profile',
        schema_version: managedWriterRequestSchemaVersion,
        service_origin: profile.service_origin,
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Lineage-Writer-Delegation': delegation.token,
      },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('identity does not match') });

    const identity = {
      channel: 'dev',
      environment: profile.environment,
      profile_id: profile.profile_id,
      schema_version: managedWriterRequestSchemaVersion,
      service_origin: profile.service_origin,
    };
    const missingAuth = await fetch(new URL(managedWriterRoute, profile.service_origin), {
      body: JSON.stringify({ ...identity, args: ['claim'], command: 'agent' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(missingAuth.status).toBe(401);
    const unsupported = await fetch(new URL(managedWriterRoute, profile.service_origin), {
      body: JSON.stringify({ ...identity, args: ['status'], command: 'agent' }),
      headers: { 'Content-Type': 'application/json', 'X-Lineage-Writer-Delegation': delegation.token },
      method: 'POST',
    });
    expect(unsupported.status).toBe(400);
    const override = await fetch(new URL(managedWriterRoute, profile.service_origin), {
      body: JSON.stringify({ ...identity, args: ['claim', '--db', '/tmp/forbidden.sqlite'], command: 'agent' }),
      headers: { 'Content-Type': 'application/json', 'X-Lineage-Writer-Delegation': delegation.token },
      method: 'POST',
    });
    expect(override.status).toBe(400);
    expect((await getJson<{ claims: unknown[] }>(profile.service_origin, '/api/agent-claims?project=demo-project')).claims).toHaveLength(0);
    owner.kill('SIGTERM');
    await collectExit(owner);
  });

  it('fails closed when a live managed-service lease has no available listener', async () => {
    const port = await availablePort();
    const profile = testProfile('unavailable-service', 'development', `http://127.0.0.1:${port}`);
    bindProfileDatabase(profile);
    const before = createHash('sha256').update(readFileSync(profile.database_path)).digest('hex');
    const owner = spawnLeaseChild(profile, true, 'dev');
    await waitForLine(owner, 'ACQUIRED');

    const result = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'never-written', '--agent-name', 'offline', '--json',
    ]));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is unavailable');
    expect(result.stderr).toContain('no direct fallback was attempted');
    expect(result.stderr).toContain('outcome is unknown');
    expect(createHash('sha256').update(readFileSync(profile.database_path)).digest('hex')).toBe(before);
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);
    owner.kill('SIGKILL');
    await collectExit(owner);
  });

  it('routes claim and heartbeat through a bracketed IPv6 service origin', async () => {
    const port = await availablePort('::1');
    const profile = testProfile('ipv6-service', 'development', `http://[::1]:${port}`);
    bindProfileDatabase(profile);
    const owner = spawnService(profile, 'dev');
    await waitForLine(owner, `Lineage listening on http://[::1]:${port}`);

    const claimed = await collectExit(spawnCli(profile, [
      'agent', 'claim', '--scope', 'lineage_workspace', '--target', 'ipv6-target', '--agent-name', 'ipv6-agent', '--json',
    ]));
    expect(claimed, claimed.stderr).toMatchObject({ code: 0 });
    const claimToken = (JSON.parse(claimed.stdout) as { claim_token: string }).claim_token;
    const heartbeat = await collectExit(spawnCli(profile, ['agent', 'heartbeat', '--claim-token', claimToken, '--json']));
    expect(heartbeat, heartbeat.stderr).toMatchObject({ code: 0 });

    owner.kill('SIGTERM');
    await collectExit(owner);
  }, 15_000);

  it('refuses a second writer in another process while the owner is alive', async () => {
    const profile = testProfile('development-main', 'development');
    const owner = spawnLeaseChild(profile, true, 'dev');
    await waitForLine(owner, 'ACQUIRED');

    const contender = spawnLeaseChild(profile, false, 'dev');
    const result = await collectExit(contender);

    expect(result.code).toBe(23);
    expect(result.stderr).toContain('already has an active service writer');
    expect(inspectProfileWriterLease(profile)?.pid).toBe(owner.pid);
    owner.kill('SIGKILL');
    await collectExit(owner);
  });

  it('keys writer ownership to the canonical database path across manifest aliases', () => {
    const ownerProfile = testProfile('development-main', 'development');
    const aliasProfile = {
      ...testProfile('development-alias', 'development'),
      database_path: ownerProfile.database_path,
      environment: ownerProfile.environment,
      profile_id: ownerProfile.profile_id,
    };
    const owner = acquireProfileWriterLease(ownerProfile, 'dev');

    expect(profileWriterLockPath(aliasProfile)).toBe(profileWriterLockPath(ownerProfile));
    expect(() => acquireProfileWriterLease(aliasProfile, 'dev')).toThrow('already has an active service writer');

    owner.release();
  });

  it('canonicalizes database file symlinks before acquiring writer ownership', () => {
    const ownerProfile = testProfile('development-main', 'development');
    bindProfileDatabase(ownerProfile);
    const aliasProfile = {
      ...testProfile('development-alias', 'development'),
      environment: ownerProfile.environment,
      profile_id: ownerProfile.profile_id,
    };
    symlinkSync(ownerProfile.database_path, aliasProfile.database_path);
    const owner = acquireProfileWriterLease(ownerProfile, 'dev');

    expect(profileWriterLockPath(aliasProfile)).toBe(profileWriterLockPath(ownerProfile));
    expect(() => acquireProfileWriterLease(aliasProfile, 'dev')).toThrow('already has an active service writer');

    owner.release();
  });

  it('canonicalizes missing database files through symlinked parent directories', () => {
    const realParent = join(scratchRoot, 'real-database-parent');
    const aliasParent = join(scratchRoot, 'alias-database-parent');
    mkdirSync(join(realParent, 'nested'), { recursive: true });
    symlinkSync(realParent, aliasParent);
    const ownerProfile = {
      ...testProfile('development-main', 'development'),
      database_path: join(realParent, 'nested', 'lineage.sqlite'),
    };
    const aliasProfile = {
      ...ownerProfile,
      database_path: join(aliasParent, 'nested', 'lineage.sqlite'),
    };

    const owner = acquireProfileWriterLease(ownerProfile, 'dev');
    expect(profileWriterLockPath(aliasProfile)).toBe(profileWriterLockPath(ownerProfile));
    expect(() => acquireProfileWriterLease(aliasProfile, 'dev')).toThrow('already has an active service writer');

    owner.release();
  });

  it('reclaims a lock after an owner crashes, but not while its PID is live', async () => {
    const profile = testProfile('development-main', 'development');
    const owner = spawnLeaseChild(profile, true, 'dev');
    await waitForLine(owner, 'ACQUIRED');
    expect(() => acquireProfileWriterLease(profile, 'dev')).toThrow('already has an active service writer');

    owner.kill('SIGKILL');
    await collectExit(owner);
    const replacement = acquireProfileWriterLease(profile, 'dev');

    expect(inspectProfileWriterLease(profile)).toMatchObject({ pid: process.pid, profile_id: profile.profile_id });
    expect(readdirSync(join(scratchRoot, profile.profile_id)).some(entry => entry.startsWith('lineage.sqlite.writer.lock.stale-'))).toBe(true);
    replacement.release();
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  });

  it('refuses automatic recovery when lock metadata is malformed', () => {
    const profile = testProfile('development-main', 'development');
    const lockPath = profileWriterLockPath(profile);
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), '{"pid":"not-a-pid"}\n');

    expect(() => acquireProfileWriterLease(profile, 'dev')).toThrow('refusing automatic recovery');
    expect(readFileSync(join(lockPath, 'owner.json'), 'utf8')).toContain('not-a-pid');
  });

  it('does not let a former owner delete a lock whose token changed', () => {
    const profile = testProfile('development-main', 'development');
    const lease = acquireProfileWriterLease(profile, 'dev');
    const ownerPath = join(lease.lock_path, 'owner.json');
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(ownerPath, `${JSON.stringify({ ...owner, token: 'replacement-token-value' })}\n`);

    lease.release();

    expect(existsSync(lease.lock_path)).toBe(true);
  });

  it('refuses dev and preview acquisition of a production profile before creating a lock', () => {
    const profile = testProfile('production-main', 'production');

    expect(() => acquireProfileWriterLease(profile, 'dev')).toThrow('Refusing to open production profile production-main from dev code');
    expect(() => acquireProfileWriterLease(profile, 'preview')).toThrow('Refusing to open production profile production-main from preview code');
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  });
});

describe('profile database writer enforcement', () => {
  it('rejects a named-profile database open without its lease and does not create the database', () => {
    const profile = testProfile('development-main', 'development');
    selectProfile(profile);

    expect(() => lineageDb()).toThrow('holding the profile writer lease');
    expect(existsSync(profile.database_path)).toBe(false);
  });

  it('opens a leased profile database with WAL and a bounded busy timeout', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    const lease = acquireProfileWriterLease(profile, 'dev');
    const database = lineageDb();

    const journal = database.prepare('pragma journal_mode').get() as { journal_mode: string };
    const timeout = database.prepare('pragma busy_timeout').get() as { timeout: number };

    expect(journal.journal_mode).toBe('wal');
    expect(timeout.timeout).toBe(5000);
    database.close();
    lease.release();
  });

  it('rejects a profile database replaced after lease acquisition before schema writes', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    const lease = acquireProfileWriterLease(profile, 'dev');
    rmSync(profile.database_path, { force: true });
    const replacement = new DatabaseSync(profile.database_path);
    replacement.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, bound_at text not null)');
    replacement.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
      .run('different-profile', profile.environment, '2026-07-14T00:00:00.000Z');
    replacement.close();

    expect(() => lineageDb()).toThrow('is bound to different-profile/development');
    const inspected = new DatabaseSync(profile.database_path, { readOnly: true });
    expect(inspected.prepare("select name from sqlite_master where type = 'table' order by name").all())
      .toEqual([{ name: 'lineage_profile_identity' }]);
    inspected.close();
    lease.release();
  });

  it('does not recreate a profile database deleted after lease acquisition', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    const lease = acquireProfileWriterLease(profile, 'dev');
    rmSync(profile.database_path, { force: true });

    expect(() => lineageDb()).toThrow('bind the profile before opening it');
    expect(existsSync(profile.database_path)).toBe(false);
    lease.release();
  });

  it('preserves legacy-unbound database compatibility while enabling WAL', () => {
    const databasePath = join(scratchRoot, 'legacy.sqlite');
    process.env.LINEAGE_DB = databasePath;
    const database = lineageDb();

    expect((database.prepare('pragma journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    database.close();
    expect(existsSync(databasePath)).toBe(true);
  });

  it('allows a named-profile read-only connection without the writer lease and enforces SQLite read-only mode', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    process.env.LINEAGE_DB_ACCESS = 'read-only';

    const database = lineageDb();

    expect(database.prepare('select profile_id from lineage_profile_identity').get()).toMatchObject({ profile_id: profile.profile_id });
    expect(() => database.exec('create table forbidden_write (id text)')).toThrow(/read-only|readonly/i);
    database.close();
    expect(existsSync(profileWriterLockPath(profile))).toBe(false);
  });

  it('lists existing workspaces through a named-profile read-only connection without legacy seed writes', () => {
    const profile = testProfile('development-main', 'development');
    bindProfileDatabase(profile);
    selectProfile(profile);
    const lease = acquireProfileWriterLease(profile, 'dev');
    const writable = lineageDb();
    writable.prepare('insert into projects (id, product, created_at, updated_at) values (?, ?, ?, ?)')
      .run('demo-project', 'demo-project', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z');
    writable.prepare(`
      insert into assets (
        id, project_id, source, media_type, title, status, created_at, updated_at, last_seen_at
      ) values (?, ?, 'local', 'image', ?, 'working', ?, ?, ?)
    `).run(
      'root',
      'demo-project',
      'Read-only root',
      '2026-07-14T00:00:00.000Z',
      '2026-07-14T00:00:00.000Z',
      '2026-07-14T00:00:00.000Z'
    );
    writable.prepare(`
      insert into lineage_workspaces (
        id, project_id, root_asset_id, title, status, created_by, active_at, created_at, updated_at
      ) values (?, ?, ?, ?, 'active', 'human', ?, ?, ?)
    `).run(
      'demo-project:lineage-workspace:root',
      'demo-project',
      'root',
      'Read-only packet workspace',
      '2026-07-14T00:00:00.000Z',
      '2026-07-14T00:00:00.000Z',
      '2026-07-14T00:00:00.000Z'
    );
    writable.close();
    lease.release();
    process.env.LINEAGE_DB_ACCESS = 'read-only';

    expect(listLineageWorkspaces('demo-project')).toMatchObject({
      active_workspace: { root_asset_id: 'root' },
      workspaces: [{ root_asset_id: 'root' }],
    });
  });
});

describe('CLI writer classification', () => {
  it('allows slow import handoffs to finish while bounding ordinary routed writes', () => {
    expect(managedWriterTimeoutMs('reroll', ['import', '--job-id', 'job'])).toBe(300_000);
    expect(managedWriterTimeoutMs('agent', ['claim'])).toBe(30_000);
  });

  it('keeps read commands concurrent while requiring leases for mutations', () => {
    expect(lineageCliRequiresWriterLease('db', ['info'])).toBe(false);
    expect(lineageCliRequiresWriterLease('next', ['--root', 'root'])).toBe(false);
    expect(lineageCliRequiresWriterLease('selection', ['packet'])).toBe(false);
    expect(lineageCliRequiresWriterLease('reroll', ['list'])).toBe(false);
    expect(lineageCliRequiresWriterLease('tasks', ['inspect'])).toBe(false);
    expect(lineageCliRequiresWriterLease('agent', ['status'])).toBe(false);
    expect(lineageCliRequiresWriterLease('link-child', ['--confirm-write'])).toBe(true);
    expect(lineageCliRequiresWriterLease('reroll', ['mark'])).toBe(true);
    expect(lineageCliRequiresWriterLease('tasks', ['claim'])).toBe(true);
    expect(lineageCliRequiresWriterLease('agent', ['claim'])).toBe(true);
  });

  it('allowlists every current delegated mutator and rejects reads or unknown writes', () => {
    for (const [command, args] of [
      ['link-child', ['--confirm-write']],
      ['reroll', ['mark']], ['reroll', ['cancel']], ['reroll', ['plan']], ['reroll', ['import']],
      ['tasks', ['claim']], ['tasks', ['start']], ['tasks', ['comment']], ['tasks', ['cancel']], ['tasks', ['override']], ['tasks', ['instructions']],
      ['agent', ['claim']], ['agent', ['heartbeat']], ['agent', ['release']], ['agent', ['revoke']], ['agent', ['transfer']],
    ] as Array<[string, string[]]>) {
      expect(lineageCliCanDelegateMutation(command, args), `${command} ${args.join(' ')}`).toBe(true);
    }
    expect(lineageCliCanDelegateMutation('agent', ['status'])).toBe(false);
    expect(lineageCliCanDelegateMutation('tasks', ['unknown-write'])).toBe(false);
    expect(lineageCliCanDelegateMutation('unknown', ['write'])).toBe(false);
  });
});

function testProfile(
  profileId: string,
  environment: ResolvedLineageProfile['environment'],
  serviceOrigin = 'http://lineage-test.localhost:5199'
): ResolvedLineageProfile {
  const profileRoot = join(scratchRoot, profileId);
  mkdirSync(join(profileRoot, 'media'), { recursive: true });
  const profile: ResolvedLineageProfile = {
    asset_root: join(profileRoot, 'media'),
    database_path: join(profileRoot, 'lineage.sqlite'),
    environment,
    manifest_path: join(profileRoot, 'profile.json'),
    profile_id: profileId,
    schema_version: 'lineage.profile.v1',
    service_origin: serviceOrigin,
  };
  writeFileSync(profile.manifest_path, `${JSON.stringify(profile)}\n`);
  return profile;
}

function bindProfileDatabase(profile: ResolvedLineageProfile): void {
  const database = new DatabaseSync(profile.database_path);
  database.exec('create table lineage_profile_identity (profile_id text primary key, environment text not null, bound_at text not null)');
  database.prepare('insert into lineage_profile_identity (profile_id, environment, bound_at) values (?, ?, ?)')
    .run(profile.profile_id, profile.environment, '2026-07-14T00:00:00.000Z');
  database.close();
}

function writeTestCatalog(profile: ResolvedLineageProfile): void {
  const directory = join(profile.asset_root, 'demo-project', 'assets');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'catalog.json'), `${JSON.stringify({
    assets: [
      testCatalogAsset('root', 'Root asset'),
      testCatalogAsset('child', 'Child asset'),
    ],
    product: 'demo-project',
  }, null, 2)}\n`);
}

function testCatalogAsset(assetId: string, title: string) {
  return {
    asset_id: assetId,
    content_type: 'image',
    product: 'demo-project',
    project: 'demo-project',
    s3: {
      bucket: 'lineage-test-assets',
      content_type: 'image/png',
      key: `tests/${assetId}.png`,
      region: 'us-east-1',
      size_bytes: 16,
      updated_at: '2026-07-14T00:00:00.000Z',
    },
    source: 'catalog',
    status: 'working',
    title,
  };
}

function selectProfile(profile: ResolvedLineageProfile): void {
  process.env.LINEAGE_PROFILE = profile.manifest_path;
  process.env.LINEAGE_PROFILE_ID = profile.profile_id;
  process.env.LINEAGE_PROFILE_ENVIRONMENT = profile.environment;
  process.env.LINEAGE_PROFILE_MANIFEST = profile.manifest_path;
  process.env.LINEAGE_DB = profile.database_path;
}

function clearProfileEnvironment(): void {
  for (const key of [
    'LINEAGE_PROFILE',
    'LINEAGE_PROFILE_ID',
    'LINEAGE_PROFILE_ENVIRONMENT',
    'LINEAGE_PROFILE_MANIFEST',
    'LINEAGE_WRITER_LEASE_TOKEN',
    'LINEAGE_WRITER_LOCK_PATH',
    'LINEAGE_DB',
    'LINEAGE_DB_ACCESS',
  ]) delete process.env[key];
}

function spawnLeaseChild(profile: ResolvedLineageProfile, hold: boolean, channel: 'stable' | 'preview' | 'dev'): ChildProcess {
  return trackChild(spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource], {
    cwd: repoRoot,
    env: {
      ...originalEnv,
      TEST_CHANNEL: channel,
      TEST_HOLD: hold ? '1' : '0',
      TEST_PROFILE_B64: Buffer.from(JSON.stringify(profile)).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function spawnService(profile: ResolvedLineageProfile, channel: 'stable' | 'preview' | 'dev'): ChildProcess {
  const origin = new URL(profile.service_origin);
  return trackChild(spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: repoRoot,
    env: {
      ...originalEnv,
      HOST: origin.hostname.replace(/^\[|\]$/g, ''),
      LINEAGE_ASSET_ROOT: profile.asset_root,
      LINEAGE_CHANNEL: channel,
      LINEAGE_DB: profile.database_path,
      LINEAGE_PROFILE: profile.manifest_path,
      LINEAGE_PROFILE_ENVIRONMENT: profile.environment,
      LINEAGE_PROFILE_ID: profile.profile_id,
      LINEAGE_PROFILE_MANIFEST: profile.manifest_path,
      LINEAGE_PROFILE_SERVICE_ORIGIN: profile.service_origin,
      NODE_ENV: 'production',
      PORT: origin.port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function spawnCli(profile: ResolvedLineageProfile, args: string[]): ChildProcess {
  return trackChild(spawn(process.execPath, ['--import', 'tsx', 'src/cli/lineage-dev.ts', ...args, '--profile', profile.manifest_path], {
    cwd: repoRoot,
    env: { ...originalEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function spawnGeneratedHandoff(command: string, childAssetId: string, claimToken: string): ChildProcess {
  const launcher = `${shellQuote(process.execPath)} --import tsx src/cli/lineage-dev.ts`;
  const localCommand = command
    .replace(/^npx --package @mean-weasel\/lineage lineage-dev/, launcher)
    .replace(/^LINEAGE_CHANNEL=preview npx --package @mean-weasel\/lineage lineage-dev/, `LINEAGE_CHANNEL=preview ${launcher}`)
    .replace(/^npx @mean-weasel\/lineage/, launcher)
    .replace('<asset-id>', shellQuote(childAssetId))
    .replace(/ --json$/, ` --claim-token ${shellQuote(claimToken)} --json`);
  return trackChild(spawn(localCommand, {
    cwd: repoRoot,
    env: { ...originalEnv },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function spawnDirectLineageWriter(profile: ResolvedLineageProfile): ChildProcess {
  const source = `
    const { lineageDb } = await import('./src/server/assetLineageDb.ts');
    try { lineageDb(); process.exit(0); }
    catch (error) { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\\n'); process.exit(24); }
  `;
  return trackChild(spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: repoRoot,
    env: {
      ...originalEnv,
      LINEAGE_ASSET_ROOT: profile.asset_root,
      LINEAGE_DB: profile.database_path,
      LINEAGE_PROFILE: profile.manifest_path,
      LINEAGE_PROFILE_ENVIRONMENT: profile.environment,
      LINEAGE_PROFILE_ID: profile.profile_id,
      LINEAGE_PROFILE_MANIFEST: profile.manifest_path,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function trackChild(child: ChildProcess): ChildProcess {
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  return child;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function availablePort(host = '127.0.0.1'): Promise<number> {
  const probe = createServer();
  probe.listen(0, host);
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port');
  const { port } = address;
  probe.close();
  await once(probe, 'close');
  return port;
}

function waitForLine(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for child output: ${expected}`));
    }, 10_000);
    child.stdout?.on('data', chunk => {
      output += String(chunk);
      if (!output.includes(expected)) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Child exited with ${code} before emitting ${expected}`));
    });
  });
}

async function getJson<T>(origin: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, origin));
  const body = await response.json() as T;
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function postJson<T>(origin: string, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json() as T;
  if (!response.ok) throw new Error(`POST ${path} failed with ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

function collectExit(child: ChildProcess): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('exit', code => resolve({ code, stderr, stdout }));
  });
}
