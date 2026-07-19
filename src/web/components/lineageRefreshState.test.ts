import { describe, expect, it } from 'vitest';
import { activeNodeIdAfterRefresh } from './lineageRefreshState';

const nodes = [{ asset_id: 'root' }, { asset_id: 'child' }];

describe('activeNodeIdAfterRefresh', () => {
  it('preserves an existing active node across every refresh', () => {
    expect(activeNodeIdAfterRefresh('child', nodes, 'root', true)).toBe('child');
    expect(activeNodeIdAfterRefresh('child', nodes, 'root', false)).toBe('child');
  });

  it('keeps cleared focus cleared during quiet background refreshes', () => {
    expect(activeNodeIdAfterRefresh(null, nodes, 'root', true)).toBeNull();
    expect(activeNodeIdAfterRefresh('removed', nodes, 'root', true)).toBeNull();
  });

  it('selects the snapshot active node during an explicit refresh', () => {
    expect(activeNodeIdAfterRefresh(null, nodes, 'root', false)).toBe('root');
    expect(activeNodeIdAfterRefresh('removed', nodes, 'root', false)).toBe('root');
  });
});
