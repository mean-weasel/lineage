import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { primaryViews, secondaryViews } from './Topbar.navigation';

describe('Topbar navigation groups', () => {
  it('keeps workflow views in the primary tab group', () => {
    expect(primaryViews.map(item => item.view)).toEqual(['lineage', 'review', 'assets', 'settings']);
  });

  it('keeps Ledger, Content, Agents, and Backup reachable as secondary views', () => {
    expect(secondaryViews.map(item => item.view)).toEqual(['ledger', 'content', 'agents', 'backup']);
  });

  it('keeps live cloud inventory out of the global topbar', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/Topbar.tsx'), 'utf8');

    expect(source).not.toContain('liveSync');
    expect(source).not.toContain('setLiveSync');
    expect(source).not.toContain("'Synced'");
    expect(source).not.toContain("'Sync'");
    expect(source).not.toContain('Sync S3');
    expect(source).not.toContain('S3 synced');
  });
});
