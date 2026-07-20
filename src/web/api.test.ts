import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('preserves response status and payload on an API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict', message: 'Edge changed' }),
    }));

    await expect(api('/api/test')).rejects.toMatchObject({
      message: 'Edge changed',
      name: 'ApiError',
      payload: { error: 'conflict', message: 'Edge changed' },
      status: 409,
    } satisfies Partial<ApiError>);
  });
});
