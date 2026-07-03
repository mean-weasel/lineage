import { describe, expect, it } from 'vitest';
import { lineageReleaseInfo } from './releaseInfo';

describe('release info', () => {
  it('exposes a version and channel for the UI', () => {
    expect(lineageReleaseInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(lineageReleaseInfo.channel).toBeTruthy();
  });
});
