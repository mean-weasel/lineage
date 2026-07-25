import { describe, expect, it } from 'vitest';
import { adapterCatalog, findAdapterCatalogEntry } from './adapterCatalog';

describe('public adapter catalog', () => {
  it('lists the supported provider for every settings capability', () => {
    expect(adapterCatalog.map(entry => [
      entry.adapterType,
      entry.providerId,
      entry.maturity,
      entry.liveBehavior,
    ])).toEqual([
      ['cloud', 's3', 'Available', 'available'],
      ['scheduler', 'buffer', 'Preview', 'disabled'],
      ['image_generator', 'codex-handoff', 'Available', 'handoff'],
    ]);
  });

  it('contains only stable public metadata', () => {
    const serialized = JSON.stringify(adapterCatalog);

    expect(serialized).not.toMatch(/credential|password|secret|token|apiKey/i);
    expect(findAdapterCatalogEntry('cloud', 's3').providerLabel).toBe('Amazon S3');
    expect(findAdapterCatalogEntry('scheduler', 'buffer').description).toContain('without publishing');
  });
});
