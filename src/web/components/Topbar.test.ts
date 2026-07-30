import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { navigationViews } from './Topbar.navigation';

describe('navigation destinations', () => {
  it('exposes every destination directly in the agreed rail order', () => {
    expect(navigationViews).toEqual([
      { label: 'Workspaces', view: 'lineage' },
      { label: 'Assets', view: 'assets' },
      { label: 'Content batches', view: 'content' },
      { label: 'Review', view: 'review' },
      { label: 'Backup queue', view: 'backup' },
      { label: 'Agents', view: 'agents' },
      { label: 'Ledger', view: 'ledger' },
      { label: 'Settings', view: 'settings' },
    ]);
  });

  it('has no hidden secondary More destinations', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/Topbar.navigation.ts'), 'utf8');

    expect(source).not.toContain('primaryViews');
    expect(source).not.toContain('secondaryViews');
    expect(new Set(navigationViews.map(item => item.view)).size).toBe(navigationViews.length);
  });

  it('keeps navigation and upload out of the contextual utility component', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/Topbar.tsx'), 'utf8');

    expect(source).toContain("if (props.view === 'lineage') return null");
    expect(source).toContain('Search ${activeLabel}');
    expect(source).toContain('Refresh ${activeLabel}');
    expect(source).toContain('Details');
    expect(source).not.toContain('MoreHorizontal');
    expect(source).not.toContain('setUploadOpen');
  });
});
