import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lineageDbPath, nowIso, type DatabaseSync } from './assetLineageDb';
import { packageRoot, repoRoot } from './assetCore';
import { runtimeProfileIdentity } from './lineageProfiles';
import type { LineageRuntimeChannel, LineageRuntimeInfo } from '../shared/runtimeInfoTypes';

const require = createRequire(import.meta.url);

function packageInfo(): { name: string; version: string } {
  try {
    const info = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name?: string; version?: string };
    return { name: info.name || '@mean-weasel/lineage', version: info.version || '0.0.0' };
  } catch {
    return { name: '@mean-weasel/lineage', version: '0.0.0' };
  }
}

export function normalizeRuntimeChannel(value?: string): LineageRuntimeChannel {
  if (value === 'stable' || value === 'preview' || value === 'dev') return value;
  if (value === 'production') return 'stable';
  if (value === 'next') return 'preview';
  if (value === 'development') return 'dev';
  return process.env.NODE_ENV === 'production' ? 'stable' : 'dev';
}

function gitSha(): string | undefined {
  const envSha = process.env.LINEAGE_GIT_SHA || process.env.GITHUB_SHA;
  if (envSha) return envSha.slice(0, 40);
  if (!existsSync(join(packageRoot, '.git'))) return undefined;
  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table));
}

function tableCount(database: DatabaseSync, table: string): number | undefined {
  if (!tableExists(database, table)) return undefined;
  const row = database.prepare(`select count(*) count from ${table}`).get() as { count?: number } | undefined;
  return typeof row?.count === 'number' ? row.count : undefined;
}

function migrationKeys(database: DatabaseSync): string[] {
  if (!tableExists(database, 'lineage_schema_migrations')) return [];
  return (database.prepare('select key from lineage_schema_migrations order by key').all() as Array<{ key: string }>).map(row => row.key);
}

export function getLineageRuntimeInfo(options: { channel?: string; dbPath?: string } = {}): LineageRuntimeInfo {
  const info = packageInfo();
  const dbPath = options.dbPath || lineageDbPath();
  const channel = normalizeRuntimeChannel(options.channel || process.env.LINEAGE_CHANNEL || process.env.LINEAGE_RELEASE_CHANNEL);
  const databaseInfo: LineageRuntimeInfo['database'] = { exists: existsSync(dbPath), path: dbPath };
  const schema: LineageRuntimeInfo['schema'] = { migration_keys: [] };

  if (databaseInfo.exists) {
    try {
      const stat = statSync(dbPath);
      databaseInfo.modified_at = stat.mtime.toISOString();
      databaseInfo.size_bytes = stat.size;
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const database = new DatabaseSync(dbPath, { readOnly: true });
      try {
        databaseInfo.projects = tableCount(database, 'projects');
        databaseInfo.workspaces = tableCount(database, 'lineage_workspaces');
        schema.migration_keys = migrationKeys(database);
        if (tableExists(database, 'lineage_profile_identity')) {
          const rows = database.prepare('select profile_id, environment from lineage_profile_identity').all() as Array<{ environment: LineageRuntimeInfo['profile']['environment']; profile_id: string }>;
          schema.profile_identity_rows = rows.length;
          if (rows.length === 1) {
            schema.profile_id = rows[0].profile_id;
            schema.profile_environment = rows[0].environment;
          }
        }
      } finally {
        database.close();
      }
    } catch (error) {
      databaseInfo.error = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    asset_root: repoRoot,
    channel,
    database: databaseInfo,
    fetchedAt: nowIso(),
    git_sha: gitSha(),
    node_env: process.env.NODE_ENV,
    package_name: info.name,
    profile: runtimeProfileIdentity(channel),
    schema,
    version: info.version,
  };
}
