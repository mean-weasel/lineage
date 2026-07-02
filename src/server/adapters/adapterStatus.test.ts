import { describe, expect, it } from 'vitest';
import { defaultProject } from '../assetCore';
import { getAdapterStatus } from './adapterStatus';

describe('adapter status', () => {
  it('reports S3 storage and dry-run-only Buffer posting adapters without credentials', () => {
    const status = getAdapterStatus(defaultProject, {});

    expect(status.project).toBe(defaultProject);
    expect(status.storage).toEqual([
      expect.objectContaining({
        can_list: true,
        can_upload: true,
        configured: true,
        mode: 'catalog-backed',
        provider: 's3',
      }),
    ]);
    expect(status.posting).toEqual([
      {
        can_dry_run: true,
        can_post: false,
        configured: false,
        missing: ['LINEAGE_SCHEDULER_TOKEN', 'LINEAGE_SCHEDULER_ORGANIZATION_ID'],
        mode: 'dry-run-only',
        provider: 'buffer',
      },
    ]);
  });

  it('reports Buffer configured status while keeping live posting disabled', () => {
    const status = getAdapterStatus(defaultProject, { LINEAGE_SCHEDULER_TOKEN: 'token', LINEAGE_SCHEDULER_ORGANIZATION_ID: 'org' });

    expect(status.posting[0]).toMatchObject({
      can_dry_run: true,
      can_post: false,
      configured: true,
      missing: [],
      provider: 'buffer',
    });
  });
});
