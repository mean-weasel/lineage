import { useEffect, useState } from 'react';
import { Bot, ChevronDown, Clipboard, Crosshair, FileSearch, Flag, ListChecks, RefreshCcw } from 'lucide-react';
import type { AssetSelectionSnapshot, ContentOpsQueueSnapshot, ContentTargetSnapshot, GrowthAsset } from '../../shared/types';
import { api } from '../api';
import { assetStorageState, type StudioView } from '../assetUi';
import './CurrentWorkTargetPanel.css';

function agentSelectedCommand(project: string): string {
  return `npx lineage agent selected --project ${project}`;
}

function agentSelectedPromptCommand(project: string): string {
  return `npx lineage agent work on the selected target for ${project} --project ${project}`;
}

function agentNextCommand(project: string): string {
  return `npx lineage agent next --project ${project}`;
}

function agentSelectionsCommand(project: string): string {
  return `npx lineage agent selections --project ${project}`;
}

export function CurrentWorkTarget({
  onCopy,
  project,
  refreshKey,
  selectedAsset,
  view,
}: {
  onCopy: (text: string, label: string) => Promise<void>;
  project: string;
  refreshKey: number;
  selectedAsset?: GrowthAsset;
  view: StudioView;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<AssetSelectionSnapshot | null>(null);
  const [target, setTarget] = useState<ContentTargetSnapshot | null>(null);
  const [queue, setQueue] = useState<ContentOpsQueueSnapshot | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ project });
      const [nextTarget, nextQueue, nextSelection] = await Promise.all([
        api<ContentTargetSnapshot>(`/api/content/target?${params}`),
        api<ContentOpsQueueSnapshot>(`/api/content/queue?${params}`),
        api<AssetSelectionSnapshot>(`/api/selections?${params}`),
      ]);
      setTarget(nextTarget);
      setQueue(nextQueue);
      setSelection(nextSelection);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [project, refreshKey]);

  useEffect(() => {
    const listener = () => { void refresh(); };
    window.addEventListener('asset-selection-updated', listener);
    return () => window.removeEventListener('asset-selection-updated', listener);
  }, [project]);

  return <CurrentWorkTargetPanel drawerOpen={drawerOpen} error={error} loading={loading} onCopy={onCopy} onRefresh={() => void refresh()} onToggleDrawer={() => setDrawerOpen(current => !current)} project={project} queue={queue} selectedAsset={selectedAsset} selection={selection} target={target} view={view} />;
}

export function CurrentWorkTargetPanel({
  drawerOpen = false,
  error,
  loading,
  onCopy,
  onRefresh,
  onToggleDrawer,
  project,
  queue,
  selectedAsset,
  selection,
  target,
  view,
}: {
  drawerOpen?: boolean;
  error?: string | null;
  loading: boolean;
  onCopy: (text: string, label: string) => Promise<void>;
  onRefresh: () => void;
  onToggleDrawer?: () => void;
  project: string;
  queue: ContentOpsQueueSnapshot | null;
  selectedAsset?: GrowthAsset;
  selection?: AssetSelectionSnapshot | null;
  target: ContentTargetSnapshot | null;
  view: StudioView;
}) {
  const lineageContext = view === 'lineage';
  const selectedTarget = target?.target;
  const nextItem = queue?.next_action;
  const selectedAssets = selection?.current.items.filter(item => item.selected_at && !item.deselected_at) || [];
  const drawerSummary = selectedAssets.length > 0
    ? `${selectedAssets.length} selected asset${selectedAssets.length === 1 ? '' : 's'}`
    : selectedTarget
      ? 'Selected content target'
      : nextItem
        ? 'Next content item ready'
        : 'Natural language handoff ready';
  return (
    <section className={`current-work-panel ${lineageContext ? 'lineage-context' : ''} ${drawerOpen ? 'open' : 'collapsed'}`} aria-label="Agent context drawer" data-testid="agent-context-drawer">
      <header>
        <button
          aria-controls="agent-context-drawer-body"
          aria-expanded={drawerOpen}
          className="work-target-toggle"
          data-testid="agent-context-toggle"
          onClick={onToggleDrawer}
          type="button"
        >
          <span className="work-target-toggle-icon"><Bot size={16} /></span>
          <span>
            <strong>Agent context</strong>
            <small>{drawerSummary}</small>
          </span>
          <ChevronDown className="work-target-chevron" size={17} />
        </button>
        <button className="secondary-button" disabled={loading} onClick={onRefresh} type="button">
          <RefreshCcw className={loading ? 'spin' : ''} size={15} />Refresh
        </button>
      </header>
      <div
        className={`work-target-drawer-body ${drawerOpen ? 'open' : 'collapsed'}`}
        data-testid="agent-context-drawer-body"
        id="agent-context-drawer-body"
        style={{
          height: drawerOpen ? 360 : 0,
          opacity: drawerOpen ? 1 : 0,
          transform: drawerOpen ? 'translateY(0)' : 'translateY(10px)',
        }}
      >
        <div className="work-target-drawer-content">
          <p className="work-target-intro">Use plain English in the agent session, or keep the exact CLI commands here when precision helps.</p>
          {error && <p className="work-target-error">{error}</p>}
          <div className="work-target-grid">
        <article className={selectedTarget ? 'work-target-card primary' : 'work-target-card'}>
          <div className="work-target-title">
            <Flag size={16} />
            <div>
              <span>Content selected target</span>
              <small>SQLite content target</small>
            </div>
          </div>
          {selectedTarget ? (
            <>
              <strong>{selectedTarget.post.title}</strong>
              <code>{selectedTarget.post.id}</code>
              <p>{selectedTarget.post.channel} · {selectedTarget.readiness} · {selectedTarget.post.assets.length} asset{selectedTarget.post.assets.length === 1 ? '' : 's'}</p>
              <code className="command-line">{agentSelectedCommand(project)}</code>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(agentSelectedCommand(project), 'agent selected command')} type="button"><Clipboard size={14} />Copy selected</button>
                <button onClick={() => void onCopy(agentSelectedPromptCommand(project), 'agent selected prompt')} type="button"><Clipboard size={14} />Copy prompt</button>
              </div>
            </>
          ) : (
            <>
              <strong>No selected content target</strong>
              <p>Say: work on the selected target for Demo.</p>
              <code className="command-line">{agentSelectedCommand(project)}</code>
            </>
          )}
        </article>
        <article className="work-target-card">
          <div className="work-target-title">
            <Crosshair size={16} />
            <div>
              <span>Content queue next</span>
              <small>Computed next action</small>
            </div>
          </div>
          {nextItem ? (
            <>
              <strong>{nextItem.post.title}</strong>
              <code>{nextItem.post.id}</code>
              <p>{nextItem.post.channel} · {nextItem.readiness} · {storageSummary(nextItem.asset_storage)}</p>
              <code className="command-line">{agentNextCommand(project)}</code>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(agentNextCommand(project), 'agent next command')} type="button"><Clipboard size={14} />Copy next</button>
              </div>
            </>
          ) : (
            <>
              <strong>No actionable queue item</strong>
              <p>{queue?.warning || 'Say: what should I work on next for Demo.'}</p>
              <code className="command-line">{agentNextCommand(project)}</code>
            </>
          )}
        </article>
        <article className="work-target-card context">
          <div className="work-target-title">
            <FileSearch size={16} />
            <div>
              <span>Selected asset</span>
              <small>UI context, not an agent target</small>
            </div>
          </div>
          {selectedAsset ? (
            <>
              <strong>{selectedAsset.title}</strong>
              <code>{selectedAsset.asset_id}</code>
              <p>{selectedAsset.channel || 'no channel'} · {selectedAsset.status} · {assetStorageState(selectedAsset).label}</p>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(selectedAsset.asset_id, 'selected asset ID')} type="button"><Clipboard size={14} />Copy asset ID</button>
              </div>
            </>
          ) : (
            <>
              <strong>No asset selected</strong>
              <p>Select an asset to use as context for content attachment, backup, or lineage work.</p>
            </>
          )}
        </article>
        <article className={selectedAssets.length > 0 ? 'work-target-card asset-selection' : 'work-target-card'} data-testid="agent-context-asset-selections">
          <div className="work-target-title">
            <ListChecks size={16} />
            <div>
              <span>Asset selections</span>
              <small>SQLite current set</small>
            </div>
          </div>
          {selectedAssets.length > 0 ? (
            <>
              <strong>{selectedAssets.length} selected asset{selectedAssets.length === 1 ? '' : 's'}</strong>
              <code>{selectedAssets.map(item => item.variation_label ? `${item.variation_label}:${item.asset_id}` : item.asset_id).join(', ')}</code>
              <code className="command-line">{agentSelectionsCommand(project)}</code>
              <div className="work-target-actions">
                <button onClick={() => void onCopy(agentSelectionsCommand(project), 'agent selections command')} type="button"><Clipboard size={14} />Copy selections</button>
              </div>
            </>
          ) : (
            <>
              <strong>No selected assets</strong>
              <p>Say: keep working on my selections.</p>
              <code className="command-line">{agentSelectionsCommand(project)}</code>
            </>
          )}
        </article>
          </div>
        </div>
      </div>
    </section>
  );
}

function storageSummary(storage: ContentOpsQueueSnapshot['totals']['storage']): string {
  if (storage.total === 0) return 'no assets';
  return [
    storage.local ? `${storage.local} local` : '',
    storage.s3 ? `${storage.s3} S3` : '',
    storage.unresolved ? `${storage.unresolved} unresolved` : '',
  ].filter(Boolean).join(' · ');
}
