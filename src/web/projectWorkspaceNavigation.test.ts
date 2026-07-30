import { describe, expect, it } from 'vitest';
import {
  parseProjectWorkspaceLocation,
  projectRouteIsUnavailable,
  projectWorkspaceHref,
  rememberProjectSummary,
  sameProjectWorkspaceDestination,
} from './projectWorkspaceNavigation';

describe('project workspace navigation', () => {
  it('parses the stable organization and exact Canvas routes', () => {
    expect(parse('/')).toEqual({ kind: 'projects' });
    expect(parse('/projects')).toEqual({ kind: 'projects' });
    expect(parse('/projects/summer-launch')).toEqual({ kind: 'project', projectId: 'summer-launch' });
    expect(parse('/projects/summer-launch/workspaces')).toEqual({ kind: 'project', projectId: 'summer-launch' });
    expect(parse('/projects/summer-launch/workspaces/workspace%3Aportrait')).toEqual({
      kind: 'canvas',
      projectId: 'summer-launch',
      workspaceId: 'workspace:portrait',
    });
    expect(parse('/projects/summer-launch/new-workspace')).toEqual({
      kind: 'new-workspace',
      projectId: 'summer-launch',
    });
    expect(parse('/projects/summer-launch/studio/assets')).toEqual({
      kind: 'studio',
      projectId: 'summer-launch',
      view: 'assets',
    });
  });

  it('builds encoded routes and preserves only Canvas presentation state', () => {
    expect(projectWorkspaceHref({ kind: 'projects' })).toBe('/projects');
    expect(projectWorkspaceHref({ kind: 'project', projectId: 'spring / launch' })).toBe('/projects/spring%20%2F%20launch/workspaces');
    expect(projectWorkspaceHref(
      { kind: 'canvas', projectId: 'spring', workspaceId: 'root:a/b' },
      '?project=legacy&lineageCanvas=portrait&secret=no'
    )).toBe('/projects/spring/workspaces/root%3Aa%2Fb?lineageCanvas=portrait');
    expect(projectWorkspaceHref({ kind: 'studio', projectId: 'spring', view: 'settings' }))
      .toBe('/projects/spring/studio/settings');
  });

  it('fails visibly on malformed, incomplete, and unrelated routes', () => {
    expect(parse('/projects/summer/workspaces/one/extra').kind).toBe('invalid');
    expect(parse('/assets').kind).toBe('invalid');
    expect(parse('/projects/summer/studio/lineage').kind).toBe('invalid');
    expect(parse('/projects/%E0%A4%A').kind).toBe('invalid');
  });

  it('compares exact workspace identity rather than project alone', () => {
    expect(sameProjectWorkspaceDestination(
      { kind: 'canvas', projectId: 'p', workspaceId: 'a' },
      { kind: 'canvas', projectId: 'p', workspaceId: 'a' }
    )).toBe(true);
    expect(sameProjectWorkspaceDestination(
      { kind: 'canvas', projectId: 'p', workspaceId: 'a' },
      { kind: 'canvas', projectId: 'p', workspaceId: 'b' }
    )).toBe(false);
    expect(sameProjectWorkspaceDestination(
      { kind: 'studio', projectId: 'p', view: 'assets' },
      { kind: 'studio', projectId: 'p', view: 'settings' }
    )).toBe(false);
  });

  it('identifies project-scoped routes whose project no longer exists', () => {
    const projects = [{ id: 'survivor' }] as Parameters<typeof projectRouteIsUnavailable>[1];
    expect(projectRouteIsUnavailable({ kind: 'studio', projectId: 'deleted', view: 'assets' }, projects)).toBe(true);
    expect(projectRouteIsUnavailable({ kind: 'canvas', projectId: 'survivor', workspaceId: 'root' }, projects)).toBe(false);
    expect(projectRouteIsUnavailable({ kind: 'projects' }, projects)).toBe(false);
  });

  it('remembers newly created and restored projects without discarding the known collection', () => {
    const known = [
      { id: 'first', display_name: 'First' },
      { id: 'swissifier-demo', display_name: 'Old demo' },
    ] as Parameters<typeof rememberProjectSummary>[0];
    const created = { id: 'created', display_name: 'Created' } as Parameters<typeof rememberProjectSummary>[1];
    const restored = { id: 'swissifier-demo', display_name: 'Swissifier Demo' } as Parameters<typeof rememberProjectSummary>[1];

    expect(rememberProjectSummary(known, created).map(project => project.id))
      .toEqual(['first', 'swissifier-demo', 'created']);
    expect(rememberProjectSummary(known, restored).map(project => project.display_name))
      .toEqual(['First', 'Swissifier Demo']);
  });
});

function parse(pathname: string) {
  return parseProjectWorkspaceLocation({ pathname, search: '' });
}
