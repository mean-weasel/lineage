import type { StudioView } from './assetUi';
import type { ProjectWorkspaceSummary } from '../shared/projectWorkspaceTypes';

type ProjectStudioView = Exclude<StudioView, 'lineage'>;

export type ProjectWorkspaceDestination =
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string }
  | { kind: 'canvas'; projectId: string; workspaceId: string }
  | { kind: 'new-workspace'; projectId: string }
  | { kind: 'studio'; projectId: string; view: ProjectStudioView }
  | { kind: 'invalid'; reason: string };

const projectStudioViews = new Set<ProjectStudioView>([
  'assets',
  'content',
  'review',
  'backup',
  'agents',
  'ledger',
  'settings',
]);

export function projectFor(destination: ProjectWorkspaceDestination): string {
  return destination.kind === 'project' || destination.kind === 'canvas' || destination.kind === 'new-workspace' || destination.kind === 'studio'
    ? destination.projectId
    : '';
}

export function availableProjectSelection(current: string, projects: ProjectWorkspaceSummary[]): string {
  return projects.some(item => item.id === current) ? current : projects[0]?.id || '';
}

export function rememberProjectSummary(
  projects: ProjectWorkspaceSummary[],
  project: ProjectWorkspaceSummary
): ProjectWorkspaceSummary[] {
  const existingIndex = projects.findIndex(item => item.id === project.id);
  if (existingIndex < 0) return [...projects, project];
  return projects.map((item, index) => index === existingIndex ? project : item);
}

export function projectRouteIsUnavailable(
  destination: ProjectWorkspaceDestination,
  projects: ProjectWorkspaceSummary[]
): boolean {
  const project = projectFor(destination);
  return Boolean(project && !projects.some(item => item.id === project));
}

export function parseProjectWorkspaceLocation(location: Pick<Location, 'pathname' | 'search'>): ProjectWorkspaceDestination {
  const segments = location.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return { kind: 'projects' };
  if (segments.length === 1 && segments[0] === 'projects') return { kind: 'projects' };
  if (segments[0] !== 'projects') return { kind: 'invalid', reason: 'Unknown Lineage route' };
  try {
    if (segments.length === 2) {
      const projectId = decodeURIComponent(segments[1]);
      return projectId ? { kind: 'project', projectId } : { kind: 'invalid', reason: 'Project ID is missing' };
    }
    if (segments.length === 3 && segments[2] === 'new-workspace') {
      const projectId = decodeURIComponent(segments[1]);
      return projectId ? { kind: 'new-workspace', projectId } : { kind: 'invalid', reason: 'Project ID is missing' };
    }
    if (segments.length === 4 && segments[2] === 'studio') {
      const projectId = decodeURIComponent(segments[1]);
      const view = decodeURIComponent(segments[3]) as ProjectStudioView;
      return projectId && projectStudioViews.has(view)
        ? { kind: 'studio', projectId, view }
        : { kind: 'invalid', reason: 'Project or studio destination is invalid' };
    }
    if (segments.length === 4 && segments[2] === 'workspaces') {
      const projectId = decodeURIComponent(segments[1]);
      const workspaceId = decodeURIComponent(segments[3]);
      return projectId && workspaceId
        ? { kind: 'canvas', projectId, workspaceId }
        : { kind: 'invalid', reason: 'Project or workspace ID is missing' };
    }
  } catch {
    return { kind: 'invalid', reason: 'The route contains invalid encoding' };
  }
  return { kind: 'invalid', reason: 'Unknown project route' };
}

export function projectWorkspaceHref(
  destination: Exclude<ProjectWorkspaceDestination, { kind: 'invalid' }>,
  currentSearch = ''
): string {
  if (destination.kind === 'projects') return '/projects';
  const projectPath = `/projects/${encodeURIComponent(destination.projectId)}`;
  if (destination.kind === 'project') return projectPath;
  if (destination.kind === 'new-workspace') return `${projectPath}/new-workspace`;
  if (destination.kind === 'studio') return `${projectPath}/studio/${encodeURIComponent(destination.view)}`;
  const params = new URLSearchParams(currentSearch);
  const canvasPresentation = params.get('lineageCanvas');
  const search = canvasPresentation === 'portrait' || canvasPresentation === 'compact'
    ? `?${new URLSearchParams({ lineageCanvas: canvasPresentation }).toString()}`
    : '';
  return `${projectPath}/workspaces/${encodeURIComponent(destination.workspaceId)}${search}`;
}

export function sameProjectWorkspaceDestination(
  left: ProjectWorkspaceDestination,
  right: ProjectWorkspaceDestination
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'invalid') return right.kind === 'invalid' && left.reason === right.reason;
  if (right.kind === 'invalid') return false;
  if (left.kind === 'projects' || right.kind === 'projects') return left.kind === right.kind;
  if (left.projectId !== right.projectId) return false;
  if (left.kind === 'canvas' && right.kind === 'canvas') return left.workspaceId === right.workspaceId;
  if (left.kind === 'studio' && right.kind === 'studio') return left.view === right.view;
  return left.kind === right.kind;
}
