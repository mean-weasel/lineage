import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LineageRuntimeChannel } from '../shared/runtimeInfoTypes';
import type { ResolvedLineageProfile } from '../shared/lineageProfileTypes';
import type { DatabaseSync } from './assetLineageDb';
import { assertProfileChannel } from './lineageProfiles';

const writerLeaseSchemaVersion = 'lineage.profile_writer_lease.v1' as const;
const ownerFileName = 'owner.json';

interface WriterLeaseOwner {
  acquired_at: string;
  environment: ResolvedLineageProfile['environment'];
  pid: number;
  profile_fingerprint: string;
  profile_id: string;
  role: 'service' | 'cli';
  schema_version: typeof writerLeaseSchemaVersion;
  token: string;
}

export interface ProfileWriterLease {
  lock_path: string;
  owner: Omit<WriterLeaseOwner, 'token'>;
  release: () => void;
}

export function profileWriterLockPath(profile: Pick<ResolvedLineageProfile, 'manifest_path'>): string {
  return join(dirname(profile.manifest_path), 'writer.lock');
}

function ownerPath(lockPath: string): string {
  return join(lockPath, ownerFileName);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined;
}

function readOwner(lockPath: string): WriterLeaseOwner {
  const stat = lstatSync(lockPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Writer lease path is not a safe directory: ${lockPath}; manual inspection is required`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(ownerPath(lockPath), 'utf8'));
  } catch (error) {
    throw new Error(`Writer lease metadata is unreadable at ${lockPath}; refusing automatic recovery`, { cause: error });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Writer lease metadata is invalid at ${lockPath}; refusing automatic recovery`);
  }
  const owner = raw as Partial<WriterLeaseOwner>;
  if (
    owner.schema_version !== writerLeaseSchemaVersion
    || typeof owner.profile_id !== 'string'
    || typeof owner.profile_fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(owner.profile_fingerprint)
    || (owner.environment !== 'production' && owner.environment !== 'preview' && owner.environment !== 'development')
    || (owner.role !== 'service' && owner.role !== 'cli')
    || !Number.isSafeInteger(owner.pid)
    || Number(owner.pid) <= 0
    || typeof owner.acquired_at !== 'string'
    || Number.isNaN(Date.parse(owner.acquired_at))
    || typeof owner.token !== 'string'
    || owner.token.length < 16
  ) {
    throw new Error(`Writer lease metadata is invalid at ${lockPath}; refusing automatic recovery`);
  }
  return owner as WriterLeaseOwner;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    return true;
  }
}

function createLeaseDirectory(lockPath: string, owner: WriterLeaseOwner): void {
  mkdirSync(lockPath, { mode: 0o700 });
  try {
    writeFileSync(ownerPath(lockPath), `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    rmSync(lockPath, { force: true, recursive: true });
    throw error;
  }
}

function reclaimDeadOwner(lockPath: string, owner: WriterLeaseOwner): void {
  if (processIsAlive(owner.pid)) {
    throw new Error(
      `Lineage profile ${owner.profile_id} already has an active ${owner.role} writer (pid ${owner.pid}); use that managed service or stop it before starting another writer`
    );
  }
  const tombstone = `${lockPath}.stale-${owner.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, tombstone);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }
  rmSync(tombstone, { force: true, recursive: true });
}

export function acquireProfileWriterLease(
  profile: ResolvedLineageProfile,
  channel: LineageRuntimeChannel,
  role: WriterLeaseOwner['role'] = 'service'
): ProfileWriterLease {
  assertProfileChannel(profile, channel);
  const lockPath = profileWriterLockPath(profile);
  const owner: WriterLeaseOwner = {
    acquired_at: new Date().toISOString(),
    environment: profile.environment,
    pid: process.pid,
    profile_fingerprint: profile.profile_fingerprint,
    profile_id: profile.profile_id,
    role,
    schema_version: writerLeaseSchemaVersion,
    token: randomUUID(),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      createLeaseDirectory(lockPath, owner);
      process.env.LINEAGE_WRITER_LEASE_TOKEN = owner.token;
      process.env.LINEAGE_WRITER_LOCK_PATH = lockPath;
      const { token: _token, ...publicOwner } = owner;
      let released = false;
      return {
        lock_path: lockPath,
        owner: publicOwner,
        release: () => {
          if (released) return;
          released = true;
          try {
            const current = readOwner(lockPath);
            if (current.token === owner.token && current.pid === owner.pid) rmSync(lockPath, { force: true, recursive: true });
          } catch {
            // Never remove a lock whose ownership cannot be proven.
          }
          if (process.env.LINEAGE_WRITER_LEASE_TOKEN === owner.token) delete process.env.LINEAGE_WRITER_LEASE_TOKEN;
          if (process.env.LINEAGE_WRITER_LOCK_PATH === lockPath) delete process.env.LINEAGE_WRITER_LOCK_PATH;
        },
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      let existing: WriterLeaseOwner;
      try {
        existing = readOwner(lockPath);
      } catch (readError) {
        if (errorCode(readError) === 'ENOENT') continue;
        throw readError;
      }
      if (
        existing.profile_id !== profile.profile_id
        || existing.environment !== profile.environment
        || existing.profile_fingerprint !== profile.profile_fingerprint
      ) {
        throw new Error(`Writer lease identity at ${lockPath} does not match ${profile.profile_id}/${profile.environment}; manual inspection is required`, { cause: error });
      }
      reclaimDeadOwner(lockPath, existing);
    }
  }
  throw new Error(`Could not acquire writer lease for Lineage profile ${profile.profile_id}; another writer is racing for ownership`);
}

export function assertProfileWriterLeaseHeld(): void {
  if (!process.env.LINEAGE_PROFILE) {
    throw new Error('Persistent writes require a selected named Lineage profile and its writer lease; legacy-unbound access is read-only');
  }
  const profileId = process.env.LINEAGE_PROFILE_ID;
  const profileFingerprint = process.env.LINEAGE_PROFILE_FINGERPRINT;
  const environment = process.env.LINEAGE_PROFILE_ENVIRONMENT;
  const manifestPath = process.env.LINEAGE_PROFILE_MANIFEST;
  const lockPath = process.env.LINEAGE_WRITER_LOCK_PATH;
  const token = process.env.LINEAGE_WRITER_LEASE_TOKEN;
  if (!profileId || !profileFingerprint || !environment || !manifestPath || !lockPath || !token) {
    throw new Error('Named Lineage profiles may write only through a process holding the profile writer lease');
  }
  const expectedLockPath = join(dirname(resolve(manifestPath)), 'writer.lock');
  if (resolve(lockPath) !== expectedLockPath) throw new Error('Profile writer lease path does not match the selected profile manifest');
  const owner = readOwner(lockPath);
  if (
    owner.pid !== process.pid
    || owner.token !== token
    || owner.profile_id !== profileId
    || owner.profile_fingerprint !== profileFingerprint
    || owner.environment !== environment
  ) {
    throw new Error('Current process does not own the selected Lineage profile writer lease');
  }
}

export function assertSelectedProfileDatabaseIdentity(database: DatabaseSync): void {
  const profileId = process.env.LINEAGE_PROFILE_ID;
  const environment = process.env.LINEAGE_PROFILE_ENVIRONMENT;
  const profileFingerprint = process.env.LINEAGE_PROFILE_FINGERPRINT;
  if (!process.env.LINEAGE_PROFILE || !profileId || !environment || !profileFingerprint) {
    throw new Error('Writable SQLite identity validation requires a fully resolved named Lineage profile');
  }
  const table = database.prepare("select name from sqlite_master where type = 'table' and name = 'lineage_profile_identity'").get();
  if (!table) throw new Error(`Refusing writable open: database is not bound to Lineage profile ${profileId}`);
  const columns = new Set((database.prepare('pragma table_info(lineage_profile_identity)').all() as Array<{ name: string }>).map(row => row.name));
  if (!columns.has('profile_id') || !columns.has('environment') || !columns.has('profile_fingerprint')) {
    throw new Error(`Refusing writable open: database identity for ${profileId} is missing required fingerprint fields`);
  }
  const rows = database.prepare('select profile_id, environment, profile_fingerprint from lineage_profile_identity').all() as Array<Record<string, unknown>>;
  if (rows.length !== 1) throw new Error(`Refusing writable open: expected exactly one database profile identity, found ${rows.length}`);
  const identity = rows[0];
  if (
    identity.profile_id !== profileId
    || identity.environment !== environment
    || identity.profile_fingerprint !== profileFingerprint
  ) {
    throw new Error(
      `Refusing writable open: database identity ${String(identity.profile_id)}/${String(identity.environment)}/${String(identity.profile_fingerprint)} does not match selected profile ${profileId}/${environment}/${profileFingerprint}`
    );
  }
}

export function inspectProfileWriterLease(profile: ResolvedLineageProfile): Omit<WriterLeaseOwner, 'token'> | undefined {
  const lockPath = profileWriterLockPath(profile);
  if (!existsSync(lockPath)) return undefined;
  const { token: _token, ...owner } = readOwner(lockPath);
  return owner;
}
