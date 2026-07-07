import { ChevronDown, PanelLeftClose, PanelLeftOpen, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { AssetLibrarySnapshot, ProjectSummary } from '../../shared/types';
import { appDescription, appName } from '../../shared/appConstants';
import { formatBytes } from '../../shared/format';
import { placementFilters, sourceFilters, statusFilters, type PlacementFilter, type SourceFilter, type StudioView, type StatusFilter } from '../assetUi';
import { lineageReleaseInfo } from '../releaseInfo';
import './Sidebar.css';

export function Sidebar({
  channel,
  channels,
  liveSync,
  placementStatus,
  project,
  projects,
  setChannel,
  setPlacementStatus,
  setProject,
  setSource,
  setStatus,
  setView,
  showBackupQueue,
  source,
  snapshot,
  status,
  totals,
}: {
  channel: string;
  channels: string[];
  liveSync: boolean;
  placementStatus: PlacementFilter;
  project: string;
  projects: ProjectSummary[];
  setChannel: (value: string) => void;
  setPlacementStatus: (value: PlacementFilter) => void;
  setProject: (value: string) => void;
  setSource: (value: SourceFilter) => void;
  setStatus: (value: StatusFilter) => void;
  setView: (view: StudioView) => void;
  showBackupQueue: () => void;
  snapshot: AssetLibrarySnapshot | null;
  source: SourceFilter;
  status: StatusFilter;
  totals: { assets: number; live: number; orphan: number; size: number };
}) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const projectValues = projects.length ? projects.map(item => item.project) : [project];
  function showAssets(action: () => void) {
    setView('assets');
    action();
  }
  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <button
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        className="sidebar-collapse-toggle"
        onClick={() => setSidebarOpen(value => !value)}
        type="button"
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
      <div className="brand">
        <div className="brand-mark" aria-label={appDescription}>L</div>
        <div className="brand-copy">
          <h1>{appName}</h1>
          <p>
            <span>{project}</span>
            <span
              aria-label={`Lineage version ${lineageReleaseInfo.version}`}
              className="brand-version"
              title={`Lineage version ${lineageReleaseInfo.version}, ${lineageReleaseInfo.channel} channel`}
            >
              v{lineageReleaseInfo.version}
            </span>
          </p>
        </div>
      </div>
      <button
        aria-controls="mobile-sidebar-controls"
        aria-expanded={mobileFiltersOpen}
        className="mobile-filter-toggle"
        onClick={() => setMobileFiltersOpen(value => !value)}
        type="button"
      >
        <SlidersHorizontal size={16} />
        Filters and quick sets
        <ChevronDown className={mobileFiltersOpen ? 'open' : ''} size={16} />
      </button>
      <div className="sidebar-mobile-collapse" data-open={mobileFiltersOpen} id="mobile-sidebar-controls">
        <div className="side-section">
          <h2>Project</h2>
          <FilterSelect id="asset-project-filter" label="Project" value={project} values={projectValues} onChange={setProject} />
        </div>
        <section className="side-section">
          <h2>Filters</h2>
          <FilterSelect id="asset-source-filter" label="Source" value={source} values={sourceFilters} onChange={value => setSource(value as SourceFilter)} />
          <FilterSelect id="asset-status-filter" label="Status" value={status} values={statusFilters} onChange={value => setStatus(value as StatusFilter)} />
          <FilterSelect id="asset-channel-filter" label="Channel" value={channel} values={channels} onChange={setChannel} />
          <FilterSelect id="asset-placement-filter" label="Placement" value={placementStatus} values={placementFilters} onChange={value => setPlacementStatus(value as PlacementFilter)} />
        </section>
        <section className="side-section health">
          <h2>Bucket</h2>
          <div className="health-line"><ShieldCheck size={16} /><span>{snapshot?.identity?.account || 'not checked'}</span></div>
          <dl>
            <div><dt>Catalog</dt><dd>{totals.assets}</dd></div>
            <div><dt>Live</dt><dd>{liveSync ? totals.live : 'off'}</dd></div>
            <div><dt>Loose</dt><dd>{liveSync ? totals.orphan : 'off'}</dd></div>
            <div><dt>Size</dt><dd>{formatBytes(totals.size)}</dd></div>
          </dl>
        </section>
        <section className="side-section">
          <h2>Quick Sets</h2>
          <button className="text-button" onClick={() => setView('review')}>Review queue</button>
          <button className="text-button" onClick={() => setView('ledger')}>Ledger workflow</button>
          <button className="text-button" onClick={() => setView('content')}>Content batches</button>
          <button className="text-button" onClick={() => setView('agents')}>Agents</button>
          <button className="text-button" onClick={showBackupQueue}>Backup queue</button>
          <button className="text-button" onClick={() => showAssets(() => setSource('local'))}>Local review</button>
          <button className="text-button" onClick={() => showAssets(() => setSource('catalog'))}>Catalog assets</button>
          <button className="text-button" onClick={() => showAssets(() => setStatus('working'))}>Working assets</button>
          <button className="text-button" onClick={() => showAssets(() => setStatus('published'))}>Published assets</button>
          <button className="text-button" onClick={() => showAssets(() => setPlacementStatus('scheduled'))}>Scheduled</button>
          <button className="text-button" onClick={() => showAssets(() => setPlacementStatus('posted'))}>Posted</button>
          <button className="text-button" onClick={() => showAssets(() => setChannel('tiktok'))}>TikTok queue</button>
          <button className="text-button" onClick={() => showAssets(() => setChannel('x-twitter'))}>X/Twitter queue</button>
          <button className="text-button" onClick={() => showAssets(() => setChannel('youtube'))}>YouTube queue</button>
        </section>
      </div>
    </aside>
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
