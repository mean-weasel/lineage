import { FileSearch, Loader2, RefreshCcw, Search } from 'lucide-react';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import type { StudioView } from '../assetUi';
import { navigationViews } from './Topbar.navigation';
import './Topbar.css';

export function Topbar(props: {
  assetDetailsOpen: boolean;
  canInspectAsset: boolean;
  loading: boolean;
  query: string;
  refresh: () => Promise<void>;
  setAssetDetailsOpen: (value: boolean) => void;
  setQuery: (value: string) => void;
  view: StudioView;
}) {
  const activeLabel = navigationViews.find(item => item.view === props.view)?.label || 'Workspace';
  const canShowDetails = props.view !== 'lineage';

  if (props.view === 'lineage') return null;

  return (
    <div className="context-utilities">
      <div className="context-panel-heading">
        <span>Current view</span>
        <strong>{activeLabel}</strong>
      </div>
      <label className="searchbox">
        <span className="sr-only">Search {activeLabel}</span>
        <Search aria-hidden="true" size={17} />
        <input
          aria-label={`Search ${activeLabel}`}
          onChange={event => props.setQuery(event.target.value)}
          placeholder={`Search ${activeLabel.toLowerCase()}`}
          value={props.query}
        />
      </label>
      <div className="context-utility-actions">
        {canShowDetails && (
          <button
            aria-expanded={props.assetDetailsOpen}
            className="secondary-button"
            disabled={!props.canInspectAsset}
            onClick={() => props.setAssetDetailsOpen(!props.assetDetailsOpen)}
            type="button"
          >
            <FileSearch size={17} />
            Details
          </button>
        )}
        <button
          aria-label={`Refresh ${activeLabel}`}
          className="secondary-button"
          disabled={props.loading}
          onClick={() => void props.refresh()}
          type="button"
        >
          {props.loading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
          Refresh
        </button>
      </div>
    </div>
  );
}

export function RuntimeIdentityBadge(props: { runtime: LineageRuntimeInfo | null; unavailable?: boolean; compact?: boolean }) {
  if (props.unavailable) {
    return (
      <div
        aria-label="Lineage runtime identity unavailable"
        className={`runtime-identity-badge unavailable ${props.compact ? 'compact' : ''}`}
      >
        {props.compact ? 'N/A' : 'IDENTITY UNAVAILABLE'}
      </div>
    );
  }
  if (!props.runtime) {
    return (
      <div
        aria-label="Loading Lineage runtime identity"
        className={`runtime-identity-badge loading ${props.compact ? 'compact' : ''}`}
      >
        {props.compact ? '…' : 'IDENTITY LOADING'}
      </div>
    );
  }
  const { profile } = props.runtime;
  const binding = profile.bound ? '' : ' · UNBOUND';
  const title = [
    `${profile.environment.toUpperCase()} profile ${profile.id}${profile.bound ? '' : ' (unbound)'}`,
    `Channel ${props.runtime.channel}`,
    `Version ${props.runtime.version}`,
    profile.warning,
  ].filter(Boolean).join(' · ');
  return (
    <div
      aria-label={`Lineage ${profile.environment} profile ${profile.id}${profile.bound ? '' : ' unbound'}`}
      className={`runtime-identity-badge ${profile.environment} ${profile.bound ? 'bound' : 'unbound'} ${props.compact ? 'compact' : ''}`}
      data-profile-id={profile.id}
      title={title}
    >
      <strong>{profile.environment.toUpperCase()}</strong>
      {!props.compact && <span>{profile.id}{binding}</span>}
    </div>
  );
}
