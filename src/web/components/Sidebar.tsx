import {
  ArchiveRestore,
  Bot,
  BookOpen,
  FileStack,
  Images,
  ListChecks,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import type { ProjectSummary } from '../../shared/types';
import { appDescription, appName } from '../../shared/appConstants';
import { placementFilters, sourceFilters, statusFilters, type PlacementFilter, type SourceFilter, type StudioView, type StatusFilter } from '../assetUi';
import { lineageReleaseInfo } from '../releaseInfo';
import { navigationViews } from './Topbar.navigation';
import { RuntimeIdentityBadge } from './Topbar';
import './Sidebar.css';

const navigationIcons = {
  lineage: Network,
  assets: Images,
  content: FileStack,
  review: ListChecks,
  backup: ArchiveRestore,
  agents: Bot,
  ledger: BookOpen,
  settings: Settings,
} satisfies Record<StudioView, typeof Network>;

export function Sidebar(props: {
  channel: string;
  channels: string[];
  children: ReactNode;
  contextOpen: boolean;
  mobileContextOpen: boolean;
  onContextOpenChange: (open: boolean) => void;
  onMobileContextOpenChange: (open: boolean) => void;
  placementStatus: PlacementFilter;
  project: string;
  projects: ProjectSummary[];
  runtime: LineageRuntimeInfo | null;
  runtimeIdentityUnavailable: boolean;
  setChannel: (value: string) => void;
  setPlacementStatus: (value: PlacementFilter) => void;
  setProject: (value: string) => void;
  setSource: (value: SourceFilter) => void;
  setStatus: (value: StatusFilter) => void;
  setUploadOpen: (value: boolean) => void;
  setView: (view: StudioView) => void;
  showBackupQueue: () => void;
  source: SourceFilter;
  status: StatusFilter;
  view: StudioView;
}) {
  const {
    channel,
    channels,
    mobileContextOpen,
    placementStatus,
    project,
    projects,
    setChannel,
    setPlacementStatus,
    setProject,
    setSource,
    setStatus,
    source,
    status,
  } = props;
  const projectValues = projects.length ? projects.map(item => item.project) : [project];
  const showAssetFilters = props.view === 'assets' || props.view === 'review' || props.view === 'backup';
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileCloseRef = useRef<HTMLButtonElement | null>(null);
  const mobileWasOpen = useRef(mobileContextOpen);

  useEffect(() => {
    if (mobileContextOpen) mobileCloseRef.current?.focus();
    else if (mobileWasOpen.current) mobileTriggerRef.current?.focus();
    mobileWasOpen.current = mobileContextOpen;
  }, [mobileContextOpen]);

  function openView(view: StudioView) {
    if (view === 'backup') props.showBackupQueue();
    else props.setView(view);
    props.onMobileContextOpenChange(false);
  }

  return (
    <>
      <aside className="navigation-shell" aria-label="Application navigation">
        <nav className="navigation-rail" aria-label={`${appName} destinations`}>
          <div className="rail-brand">
            <div className="brand-mark" aria-label={appDescription}>L</div>
          </div>
          <button
            aria-label="Expand contextual panel"
            className="rail-button context-expand-toggle"
            onClick={() => props.onContextOpenChange(true)}
            title="Expand contextual panel"
            type="button"
          >
            <PanelLeftOpen size={18} />
          </button>
          <button
            aria-controls="contextual-navigation-panel"
            aria-expanded={mobileContextOpen}
            aria-label="Open navigation panel"
            className="rail-button mobile-navigation-toggle"
            onClick={() => props.onMobileContextOpenChange(!mobileContextOpen)}
            ref={mobileTriggerRef}
            type="button"
          >
            <Menu size={21} />
          </button>
          <div className="rail-destinations">
            {navigationViews.filter(item => item.view !== 'settings').map(item => {
              const Icon = navigationIcons[item.view];
              return (
                <button
                  aria-current={props.view === item.view ? 'page' : undefined}
                  aria-label={item.label}
                  className={`rail-button ${props.view === item.view ? 'active' : ''}`}
                  key={item.view}
                  onClick={() => openView(item.view)}
                  title={item.label}
                  type="button"
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
          <div className="rail-bottom">
            <button
              aria-label="Create or upload"
              className="rail-button rail-upload"
              onClick={() => props.setUploadOpen(true)}
              title="Create or upload"
              type="button"
            >
              <Upload size={20} />
            </button>
            <button
              aria-current={props.view === 'settings' ? 'page' : undefined}
              aria-label="Settings"
              className={`rail-button ${props.view === 'settings' ? 'active' : ''}`}
              onClick={() => openView('settings')}
              title="Settings"
              type="button"
            >
              <Settings size={20} />
            </button>
            <RuntimeIdentityBadge
              compact
              runtime={props.runtime}
              unavailable={props.runtimeIdentityUnavailable}
            />
          </div>
        </nav>

        <section
          aria-label="Contextual navigation panel"
          aria-modal={mobileContextOpen || undefined}
          className="context-panel"
          id="contextual-navigation-panel"
          role={mobileContextOpen ? 'dialog' : undefined}
        >
          <header className="context-panel-header">
            <div className="context-brand">
              <strong>{appName}</strong>
              <span className="brand-version" title={`${lineageReleaseInfo.channel} channel`}>v{lineageReleaseInfo.version}</span>
            </div>
            <button
              aria-label="Close navigation panel"
              className="context-close mobile-context-close"
              onClick={() => props.onMobileContextOpenChange(false)}
              ref={mobileCloseRef}
              type="button"
            >
              <X size={18} />
            </button>
            <button
              aria-label="Collapse contextual panel"
              className="context-close desktop-context-close"
              onClick={() => props.onContextOpenChange(false)}
              type="button"
            >
              <PanelLeftClose size={18} />
            </button>
          </header>

          <div className="context-panel-scroll">
            <nav className="mobile-context-destinations" aria-label="Mobile destinations">
              {navigationViews.map(item => {
                const Icon = navigationIcons[item.view];
                return (
                  <button
                    aria-current={props.view === item.view ? 'page' : undefined}
                    key={item.view}
                    onClick={() => openView(item.view)}
                    type="button"
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}
              <button
                onClick={() => {
                  props.setUploadOpen(true);
                  props.onMobileContextOpenChange(false);
                }}
                type="button"
              >
                <Upload size={18} />
                Create or upload
              </button>
            </nav>

            <section className="mobile-runtime-identity" aria-label="Mobile runtime identity">
              <h2>Runtime</h2>
              <RuntimeIdentityBadge
                runtime={props.runtime}
                unavailable={props.runtimeIdentityUnavailable}
              />
            </section>

            <section className="side-section">
              <h2>Project</h2>
              <FilterSelect id="asset-project-filter" label="Project" value={project} values={projectValues} onChange={setProject} />
            </section>

            {props.children}
            {props.view === 'lineage' && (
              <section
                aria-label="Canvas workspace tools"
                className="canvas-context-tools-host"
                id="canvas-context-tools"
              />
            )}

            {showAssetFilters && (
              <section className="side-section asset-filter-section">
                <h2>Asset filters</h2>
                <div id="context-asset-filters">
                  <FilterSelect id="asset-source-filter" label="Source" value={source} values={sourceFilters} onChange={value => setSource(value as SourceFilter)} />
                  <FilterSelect id="asset-status-filter" label="Status" value={status} values={statusFilters} onChange={value => setStatus(value as StatusFilter)} />
                  <FilterSelect id="asset-channel-filter" label="Channel" value={channel} values={channels} onChange={setChannel} />
                  <FilterSelect id="asset-placement-filter" label="Placement" value={placementStatus} values={placementFilters} onChange={value => setPlacementStatus(value as PlacementFilter)} />
                </div>
              </section>
            )}
          </div>
        </section>

      </aside>
      {mobileContextOpen && (
        <button
          aria-label="Close navigation panel"
          className="navigation-backdrop"
          onClick={() => props.onMobileContextOpenChange(false)}
          type="button"
        />
      )}
    </>
  );
}

function FilterSelect({
  id,
  label,
  value,
  values,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id}>
      {label}
      <select aria-label={label} id={id} value={value} onChange={event => onChange(event.target.value)}>
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
}
