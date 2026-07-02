import { ChevronDown, FileSearch, Loader2, MoreHorizontal, RefreshCcw, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import type { StudioView } from '../assetUi';
import { primaryViews, secondaryViews } from './Topbar.navigation';
import './Topbar.css';

export function Topbar(props: {
  assetDetailsOpen: boolean;
  canInspectAsset: boolean;
  loading: boolean;
  query: string;
  refresh: () => Promise<void>;
  setAssetDetailsOpen: (value: boolean) => void;
  setQuery: (value: string) => void;
  setUploadOpen: (value: boolean) => void;
  setView: (view: StudioView) => void;
  view: StudioView;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const secondaryActive = secondaryViews.some(item => item.view === props.view);

  function openPrimary(view: StudioView) {
    props.setView(view);
    setMoreOpen(false);
  }

  function openSecondary(view: StudioView) {
    props.setView(view);
    setMoreOpen(false);
  }

  return (
    <header className="topbar">
      <div className="view-tabs" role="tablist" aria-label="Lineage views">
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
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-pressed={secondaryActive}
            className={secondaryActive ? 'active' : ''}
            onClick={() => setMoreOpen(value => !value)}
            type="button"
          >
            <MoreHorizontal size={16} /> More <ChevronDown className={moreOpen ? 'open' : ''} size={15} />
          </button>
          {moreOpen && (
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
            setMoreOpen(false);
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
