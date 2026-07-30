import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldRevealCopiedText } from './copyFallback';
import { availableProjectSelection, projectFor, projectRouteIsUnavailable } from './projectWorkspaceNavigation';

describe('shouldRevealCopiedText', () => {
  it('reveals agent handoff commands as a visible fallback', () => {
    expect(shouldRevealCopiedText('next context command', 'npx lineage agent "keep working on my selections"')).toBe(true);
  });

  it('keeps ordinary copied links out of the fallback panel', () => {
    expect(shouldRevealCopiedText('preview link', 'https://example.com/asset.png')).toBe(false);
  });

  it('keeps the Agents view read-only and tokenless', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/components/AgentsView.tsx'), 'utf8');

    expect(source).toContain('/api/agent-claims');
    expect(source).toContain('Open graph');
    expect(source).toContain('Copy briefing');
    expect(source).toContain('onDoubleClick={openWork}');
    expect(source).toContain('agent-row-open-graph');
    expect(source).toContain('agent-row-copy-briefing');
    expect(source).toContain('agentBriefingText');
    expect(source).toContain("view: 'lineage'");
    expect(source).not.toContain('/api/agent-claims/${selectedClaimId}');
    expect(source).not.toContain('ClaimDetailPanel');
    expect(source).not.toContain("view: 'content'");
    expect(source).not.toContain('Open work');
    expect(source).not.toContain('Copy handoff');
    expect(source).not.toContain('Transfer');
    expect(source).not.toContain('claim_token');
    expect(source).not.toContain('claimToken');
    expect(source).not.toContain('metadata');
    expect(source).not.toContain("method: 'POST'");
  });

  it('opens agent work only through a canonical destination', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    const start = source.indexOf('async function openAgentWork');
    const end = source.indexOf('function toggleLocalBackup', start);
    const handoff = source.slice(start, end);

    expect(handoff).toContain("if (!target.workspaceId)");
    expect(handoff).toContain('is not linked to an exact Canvas workspace');
    expect(handoff).toContain("navigate({ kind: 'canvas', projectId: target.claim.project, workspaceId: target.workspaceId })");
    expect(handoff).toContain("navigate({ kind: 'studio', projectId: target.claim.project, view: target.view })");
    expect(handoff).not.toContain('setView(target.view)');
  });

  it('composes the rail and contextual utilities outside the workspace', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    const sidebarStart = source.indexOf('<Sidebar');
    const sidebarEnd = source.indexOf('</Sidebar>');
    const workspaceStart = source.indexOf('<main className="workspace">');

    expect(sidebarStart).toBeGreaterThan(-1);
    expect(source.slice(sidebarStart, sidebarEnd)).toContain('<Topbar');
    expect(sidebarEnd).toBeLessThan(workspaceStart);
    expect(source).toContain('context-panel-collapsed');
    expect(source).toContain('mobile-context-open');
    expect(source).not.toContain('CurrentWorkTarget');
    expect(source).not.toContain('Agent context');
  });

  it('does not preload a catalog while the lineage canvas owns the workspace surface', () => {
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');

    expect(source).toContain("return surface === 'studio' && view !== 'lineage'");
    expect(source).toContain('if (shouldRefreshAssetLibrary(surface, view)) void refresh()');
  });

  it('starts Projects without a phantom default and replaces deleted selections deterministically', () => {
    const projects = [
      { id: 'survivor' },
      { id: 'second' },
    ] as Parameters<typeof availableProjectSelection>[1];

    expect(projectFor({ kind: 'projects' })).toBe('');
    expect(availableProjectSelection('deleted-project', projects)).toBe('survivor');
    expect(availableProjectSelection('second', projects)).toBe('second');
    expect(availableProjectSelection('deleted-project', [])).toBe('');
    expect(projectRouteIsUnavailable({ kind: 'project', projectId: 'deleted-project' }, projects)).toBe(true);
    expect(projectRouteIsUnavailable({ kind: 'project', projectId: 'survivor' }, projects)).toBe(false);
    const source = readFileSync(join(process.cwd(), 'src/web/App.tsx'), 'utf8');
    expect(source).toContain("`/api/projects/${encodeURIComponent(unavailableProject)}`");
    expect(source).toContain('availableProjects = [...result.projects, detail.project]');
    expect(source).not.toContain('onOpenDemo=');
    expect(source).toContain('setProjects(current => rememberProjectSummary(current, nextProject))');
  });
});
