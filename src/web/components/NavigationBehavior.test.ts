import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'asset-studio/src/App.tsx'), 'utf8');

function snippetBetween(start: string, end: string): string {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  return appSource.slice(startIndex, endIndex);
}

describe('Asset Studio navigation behavior', () => {
  it('keeps Review asset inspection in the current view instead of redirecting to Assets', () => {
    const reviewSnippet = snippetBetween('<ReviewQueue', 'project={project}');

    expect(reviewSnippet).toContain('inspectAssetInContext(asset)');
    expect(reviewSnippet).not.toContain("setView('assets')");
  });

  it('keeps shared asset details decoupled from the Assets tab', () => {
    const openDetailsSnippet = snippetBetween('async function openAssetDetails', 'function showBackupQueue');

    expect(openDetailsSnippet).toContain('setAssetDetailsOpen(true)');
    expect(openDetailsSnippet).not.toContain("setView('assets')");
  });
});
