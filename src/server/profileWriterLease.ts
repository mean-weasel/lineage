import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { LineageRuntimeChannel } from '../shared/runtimeInfoTypes';
import type { ResolvedLineageProfile } from '../shared/lineageProfileTypes';
import { assertProfileChannel } from './lineageProfiles';

const writerLeaseSchemaVersion = 'lineage.profile_writer_lease.v1' as const;
const ownerFileName = 'owner.json';

interface WriterLeaseOwner {
  acquired_at: string;
  environment: ResolvedLineageProfile['environment'];
  pid: number;
  profile_id: string;
  role: 'service' | 'cli';
  schema_version: typeof writerLeaseSchemaVersion;
  service_origin?: string;
  token: string;
}

export interface ProfileWriterLease {
  authenticate: (token: string | undefined) => boolean;
  lock_path: string;
  owner: Omit<WriterLeaseOwner, 'token'>;
  release: () => void;
}

export interface ProfileWriterDelegation {
  owner: Omit<WriterLeaseOwner, 'token'>;
  service_origin: string;
  token: string;
}

export class ProfileWriterLeaseConflictError extends Error {
  constructor(
    message: string,
    public readonly owner: Omit<WriterLeaseOwner, 'token'>,
  ) {
    super(message);
    this.name = 'ProfileWriterLeaseConflictError';
  }
}

function canonicalDatabasePath(databasePath: string): string {
  const resolved = resolve(databasePath);
  const missingSegments: string[] = [];
  let candidate = resolved;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return resolved;
    missingSegments.unshift(basename(candidate));
    candidate = parent;
  }
  try {
    return join(realpathSync(candidate), ...missingSegments);
  } catch {
    return resolved;
  }
}

export function profileWriterLockPath(profile: Pick<ResolvedLineageProfile, 'database_path'>): string {
  return `${canonicalDatabasePath(profile.database_path)}.writer.lock`;
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
    || (owner.environment !== 'production' && owner.environment !== 'preview' && owner.environment !== 'development')
    || (owner.role !== 'service' && owner.role !== 'cli')
    || !Number.isSafeInteger(owner.pid)
    || Number(owner.pid) <= 0
    || typeof owner.acquired_at !== 'string'
    || Number.isNaN(Date.parse(owner.acquired_at))
    || (owner.role === 'service' && (typeof owner.service_origin !== 'string' || !owner.service_origin))
    || (owner.role === 'cli' && owner.service_origin !== undefined)
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
    const { token: _token, ...publicOwner } = owner;
    throw new ProfileWriterLeaseConflictError(
      `Lineage profile ${owner.profile_id} already has an active ${owner.role} writer (pid ${owner.pid}); use that managed service or stop it before starting another writer`,
      publicOwner,
    );
  }
  // Keep a deterministic fence for this exact dead token. A delayed concurrent
  // reclaimer can then never rename a replacement lease to a fresh tombstone.
  const tokenFence = createHash('sha256').update(owner.token).digest('hex').slice(0, 24);
  const tombstone = `${lockPath}.stale-${owner.pid}-${tokenFence}`;
  try {
    renameSync(lockPath, tombstone);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EEXIST' || errorCode(error) === 'ENOTEMPTY') return;
    throw error;
  }
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
    profile_id: profile.profile_id,
    role,
    schema_version: writerLeaseSchemaVersion,
    ...(role === 'service' ? { service_origin: profile.service_origin } : {}),
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
        authenticate: candidate => {
          if (!candidate) return false;
          const expected = Buffer.from(owner.token);
          const actual = Buffer.from(candidate);
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        },
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
      if (existing.profile_id !== profile.profile_id || existing.environment !== profile.environment) {
        throw new Error(`Writer lease identity at ${lockPath} does not match ${profile.profile_id}/${profile.environment}; manual inspection is required`, { cause: error });
      }
      reclaimDeadOwner(lockPath, existing);
    }
  }
  throw new Error(`Could not acquire writer lease for Lineage profile ${profile.profile_id}; another writer is racing for ownership`);
}

export function assertProfileWriterLeaseHeld(): void {
  if (!process.env.LINEAGE_PROFILE) return;
  const profileId = process.env.LINEAGE_PROFILE_ID;
  const environment = process.env.LINEAGE_PROFILE_ENVIRONMENT;
  const manifestPath = process.env.LINEAGE_PROFILE_MANIFEST;
  const databasePath = process.env.LINEAGE_DB;
  const lockPath = process.env.LINEAGE_WRITER_LOCK_PATH;
  const token = process.env.LINEAGE_WRITER_LEASE_TOKEN;
  if (!profileId || !environment || !manifestPath || !databasePath || !lockPath || !token) {
    throw new Error('Named Lineage profiles may write only through a process holding the profile writer lease');
  }
  const expectedLockPath = `${canonicalDatabasePath(databasePath)}.writer.lock`;
  if (resolve(lockPath) !== expectedLockPath) throw new Error('Profile writer lease path does not match the selected profile database');
  const owner = readOwner(lockPath);
  if (owner.pid !== process.pid || owner.token !== token || owner.profile_id !== profileId || owner.environment !== environment) {
    throw new Error('Current process does not own the selected Lineage profile writer lease');
  }
}

export function inspectProfileWriterLease(profile: ResolvedLineageProfile): Omit<WriterLeaseOwner, 'token'> | undefined {
  const lockPath = profileWriterLockPath(profile);
  if (!existsSync(lockPath)) return undefined;
  const { token: _token, ...owner } = readOwner(lockPath);
  return owner;
}

export function getProfileWriterDelegation(profile: ResolvedLineageProfile): ProfileWriterDelegation {
  const lockPath = profileWriterLockPath(profile);
  if (!existsSync(lockPath)) {
    throw new Error(
      `Lineage profile ${profile.profile_id} mutating commands require its managed service at ${profile.service_origin}; no active service writer lease was found`
    );
  }
  const owner = readOwner(lockPath);
  if (owner.profile_id !== profile.profile_id || owner.environment !== profile.environment) {
    throw new Error(`Writer lease identity at ${lockPath} does not match ${profile.profile_id}/${profile.environment}; refusing delegation`);
  }
  if (owner.role !== 'service' || owner.service_origin !== profile.service_origin) {
    throw new Error(`Writer lease for Lineage profile ${profile.profile_id} is not the configured managed service at ${profile.service_origin}`);
  }
  if (!processIsAlive(owner.pid)) {
    throw new Error(`Managed service writer lease for Lineage profile ${profile.profile_id} is stale; refusing delegation`);
  }
  const { token, ...publicOwner } = owner;
  return { owner: publicOwner, service_origin: owner.service_origin, token };
}
