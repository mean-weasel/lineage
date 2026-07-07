import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineageReleaseInfo } from './releaseInfo';

describe('release info', () => {
  it('exposes a version and channel for the UI', () => {
    expect(lineageReleaseInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(lineageReleaseInfo.channel).toBeTruthy();
  });

  it('keeps release details visible in the sidebar brand and settings view', () => {
    const sidebarSource = readFileSync(join(process.cwd(), 'src/web/components/Sidebar.tsx'), 'utf8');
    const settingsSource = readFileSync(join(process.cwd(), 'src/web/components/SettingsView.tsx'), 'utf8');

    expect(sidebarSource).toContain('lineageReleaseInfo.version');
    expect(sidebarSource).toContain('className="brand-version"');
    expect(settingsSource).toContain('aria-label="Release information"');
    expect(settingsSource).toContain('lineageReleaseInfo.channel');
  });
});
