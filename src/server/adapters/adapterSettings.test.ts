import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from '../assetCore';
import { getAdapterSettings, updateAdapterSetting } from './adapterSettings';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-adapter-settings');
const dbFile = join(scratchDir, 'adapter-settings.sqlite');

describe('adapter settings', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    process.env.ASSET_STUDIO_DB = dbFile;
  });

  it('creates safe default settings for each adapter type', () => {
    const snapshot = getAdapterSettings(defaultProject, {
      AWS_PROFILE: 'growth-ops',
      BUFFER_API_KEY: 'buffer-secret',
      BUFFER_ORGANIZATION_ID: 'buffer-org',
    });

    expect(snapshot.settings.map(setting => [setting.adapter_type, setting.provider, setting.enabled])).toEqual([
      ['cloud', 's3', true],
      ['scheduler', 'buffer', false],
      ['image_generator', 'codex-handoff', true],
    ]);
    expect(snapshot.settings.find(setting => setting.provider === 's3')).toMatchObject({
      credential: { detected: true, label: 'AWS default credential chain (delegated)', secret_ref: 'aws:default-chain' },
      health_status: 'not_tested',
      safe_config: { bucket: expect.any(String), region: expect.any(String) },
    });
    expect(snapshot.settings.find(setting => setting.provider === 'buffer')).toMatchObject({
      credential: { detected: true, label: 'BUFFER_API_KEY + BUFFER_ORGANIZATION_ID', secret_ref: 'env:BUFFER_API_KEY' },
      health_status: 'live_disabled',
    });
    expect(JSON.stringify(snapshot)).not.toContain('buffer-secret');
    expect(JSON.stringify(snapshot)).not.toContain('buffer-org');
  });

  it('persists enabled state and non-secret config in sqlite', () => {
    updateAdapterSetting(defaultProject, {
      adapterType: 'scheduler',
      confirmWrite: true,
      enabled: true,
      provider: 'buffer',
      safeConfig: { defaultMode: 'dry-run' },
    });

    const snapshot = getAdapterSettings(defaultProject, {});
    expect(snapshot.settings.find(setting => setting.provider === 'buffer')).toMatchObject({
      adapter_type: 'scheduler',
      enabled: true,
      health_status: 'dry_run_available',
      provider: 'buffer',
      safe_config: { defaultMode: 'dry-run' },
    });
  });

  it('does not report configured S3 catalog storage as missing credentials before live testing', () => {
    const snapshot = getAdapterSettings(defaultProject, {});

    expect(snapshot.settings.find(setting => setting.provider === 's3')).toMatchObject({
      enabled: true,
      health_status: 'not_tested',
      safe_config: {
        bucket: 'mean-weasel-growth-assets-production',
        region: 'us-east-1',
      },
    });
  });

  it('rejects raw secret-looking values in safe config', () => {
    expect(() =>
      updateAdapterSetting(defaultProject, {
        adapterType: 'scheduler',
        confirmWrite: true,
        enabled: true,
        provider: 'buffer',
        safeConfig: { apiKey: 'buffer-secret' },
      })
    ).toThrow('Adapter settings cannot store secret-like keys');
  });
});
