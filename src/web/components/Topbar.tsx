import { ChevronDown, FileSearch, Loader2, MoreHorizontal, RefreshCcw, Search, Upload } from 'lucide-react';
import { appName } from '../../shared/appConstants';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import type { StudioView } from '../assetUi';
import { primaryViews, secondaryViews } from './Topbar.navigation';
import './Topbar.css';

export function Topbar(props: {
  assetDetailsOpen: boolean;
  canInspectAsset: boolean;
  loading: boolean;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
  query: string;
  refresh: () => Promise<void>;
  runtime: LineageRuntimeInfo | null;
  runtimeIdentityUnavailable: boolean;
  setAssetDetailsOpen: (value: boolean) => void;
  setQuery: (value: string) => void;
  setUploadOpen: (value: boolean) => void;
  setView: (view: StudioView) => void;
  view: StudioView;
}) {
  const secondaryActive = secondaryViews.some(item => item.view === props.view);

  function openPrimary(view: StudioView) {
    props.setView(view);
    props.onMoreOpenChange(false);
  }

  function openSecondary(view: StudioView) {
    props.setView(view);
    props.onMoreOpenChange(false);
  }

  return (
    <header className="topbar">
      <div className="view-tabs" role="tablist" aria-label={`${appName} views`}>
        {primaryViews.map(item => (
          <button
            aria-pressed={props.view === item.view}
            className={props.view === item.view ? 'active' : ''}
            key={item.view}
            onClick={() => openPrimary(item.view)}
            type="button"
          >
            {item.label}
          </button>
        ))}
        <div className="more-menu">
          <button
            aria-expanded={props.moreOpen}
            aria-haspopup="menu"
            aria-pressed={secondaryActive}
            className={secondaryActive ? 'active' : ''}
            onClick={() => props.onMoreOpenChange(!props.moreOpen)}
            type="button"
          >
            <MoreHorizontal size={16} /> More <ChevronDown className={props.moreOpen ? 'open' : ''} size={15} />
          </button>
          {props.moreOpen && (
            <div className="more-menu-popover" role="menu">
              {secondaryViews.map(item => (
                <button
                  aria-pressed={props.view === item.view}
                  key={item.view}
                  onClick={() => openSecondary(item.view)}
                  role="menuitem"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <RuntimeIdentityBadge runtime={props.runtime} unavailable={props.runtimeIdentityUnavailable} />
      <div className="searchbox">
        <Search size={17} />
        <input onChange={event => props.setQuery(event.target.value)} placeholder="Search assets, campaigns, hooks" value={props.query} />
      </div>
      {props.view !== 'lineage' && (
        <button
          aria-expanded={props.assetDetailsOpen}
          className="secondary-button"
          disabled={!props.canInspectAsset}
          onClick={() => {
            props.onMoreOpenChange(false);
            props.setAssetDetailsOpen(!props.assetDetailsOpen);
          }}
          type="button"
        >
          <FileSearch size={17} />
          Details
        </button>
      )}
      <button className="icon-button" disabled={props.loading} onClick={() => void props.refresh()} title="Refresh current page">
        {props.loading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
      </button>
      <button className="primary-button" onClick={() => props.setUploadOpen(true)}>
        <Upload size={17} />
        Upload
      </button>
    </header>
  );
}

export function RuntimeIdentityBadge(props: { runtime: LineageRuntimeInfo | null; unavailable?: boolean }) {
  if (props.unavailable) {
    return <div aria-label="Lineage runtime identity unavailable" className="runtime-identity-badge unavailable">IDENTITY UNAVAILABLE</div>;
  }
  if (!props.runtime) {
    return <div aria-label="Loading Lineage runtime identity" className="runtime-identity-badge loading">IDENTITY LOADING</div>;
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
      className={`runtime-identity-badge ${profile.environment} ${profile.bound ? 'bound' : 'unbound'}`}
      data-profile-id={profile.id}
      title={title}
    >
      <strong>{profile.environment.toUpperCase()}</strong>
      <span>{profile.id}{binding}</span>
    </div>
  );
}
