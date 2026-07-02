import { Clipboard, FileDown, Plus, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AssetLibrarySnapshot, ContentBatchDetail, ContentBatchSnapshot, ContentOpsQueueSnapshot, ContentPost, ContentPostPhase, ContentTargetSnapshot, GrowthAsset } from '../../shared/types';
import { formatDate } from '../../shared/format';
import { api } from '../api';
import { ContentAssetCandidates } from './ContentAssetCandidates';
import { ContentPostCard } from './ContentPostCard';
import { ContentPostFilters, type AssetFilter } from './ContentPostFilters';
import { ContentPostPreview } from './ContentPostPreview';
import { ContentOpsQueuePanel } from './ContentOpsQueuePanel';
import { ContentTargetPanel } from './ContentTargetPanel';
import './ContentBatchesView.css';

const phases: ContentPostPhase[] = ['draft', 'review', 'scheduled', 'posted', 'skipped', 'archived'];

export function ContentBatchesView({
  onCopy,
  onOpenAsset,
  onToast,
  onWorkTargetsChanged,
  project,
  selectedAsset,
}: {
  onCopy: (text: string, label: string) => Promise<void>;
  onOpenAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  onWorkTargetsChanged?: () => void;
  project: string;
  selectedAsset?: GrowthAsset;
}) {
  const [snapshot, setSnapshot] = useState<ContentBatchSnapshot | null>(null);
  const [detail, setDetail] = useState<ContentBatchDetail | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [batchForm, setBatchForm] = useState({ batchId: '', campaign: '2026-06-organic-traffic-test', channel: '', title: '' });
  const [postForm, setPostForm] = useState({ channel: 'tiktok', phase: 'draft' as ContentPostPhase, postId: '', title: '' });
  const [importForm, setImportForm] = useState({ batchId: 'demo-2026-06-priority', kind: 'drafts', title: 'Demo imported drafts' });
  const [filters, setFilters] = useState({ asset: 'all' as AssetFilter, channel: 'all', phase: 'all' as ContentPostPhase | 'all' });
  const [attachForm, setAttachForm] = useState({ assetId: '', postId: '', role: 'primary' });
  const [phaseInputs, setPhaseInputs] = useState<Record<string, { phase: ContentPostPhase; scheduledAt: string; postedAt: string; url: string }>>({});
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [previewPostId, setPreviewPostId] = useState('');
  const [candidateSnapshot, setCandidateSnapshot] = useState<AssetLibrarySnapshot | null>(null);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [targetSnapshot, setTargetSnapshot] = useState<ContentTargetSnapshot | null>(null);
  const [queueSnapshot, setQueueSnapshot] = useState<ContentOpsQueueSnapshot | null>(null);

  const batches = snapshot?.batches || [];
  const selectedBatch = useMemo(() => batches.find(batch => batch.id === selectedBatchId) || batches[0], [batches, selectedBatchId]);
  const channels = useMemo(() => [...new Set((detail?.posts || []).map(post => post.channel))].sort(), [detail]);
  const filteredPosts = useMemo(() => {
    return (detail?.posts || []).filter(post => {
      const matchesPhase = filters.phase === 'all' || post.phase === filters.phase;
      const matchesChannel = filters.channel === 'all' || post.channel === filters.channel;
      const matchesAssets =
        filters.asset === 'all' ||
        (filters.asset === 'has-assets' && post.assets.length > 0) ||
        (filters.asset === 'needs-assets' && post.assets.length === 0);
      return matchesPhase && matchesChannel && matchesAssets;
    });
  }, [detail, filters]);
  const needsAssetCount = useMemo(() => (detail?.posts || []).filter(post => post.assets.length === 0).length, [detail]);
  const previewPost = useMemo(
    () => (detail?.posts || []).find(post => post.id === previewPostId) || filteredPosts[0],
    [detail, filteredPosts, previewPostId]
  );
  const candidateAssets = candidateSnapshot?.assets || [];
  const assetLookup = useMemo(() => Object.fromEntries(candidateAssets.map(asset => [asset.asset_id, asset])), [candidateAssets]);

  async function refresh(nextBatchId = selectedBatch?.id || selectedBatchId) {
    setLoading(true);
    setError(null);
    try {
      const [next, target, queue] = await Promise.all([
        api<ContentBatchSnapshot>(`/api/content/batches?${new URLSearchParams({ project })}`),
        api<ContentTargetSnapshot>(`/api/content/target?${new URLSearchParams({ project })}`),
        api<ContentOpsQueueSnapshot>(`/api/content/queue?${new URLSearchParams({ project })}`),
      ]);
      setSnapshot(next);
      setTargetSnapshot(target);
      setQueueSnapshot(queue);
      const batchId = nextBatchId || next.batches[0]?.id || '';
      setSelectedBatchId(batchId);
      setDetail(batchId ? await api<ContentBatchDetail>(`/api/content/batches/${batchId}?${new URLSearchParams({ project })}`) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh('');
  }, [project]);

  useEffect(() => {
    setSelectedPostIds([]);
    setPreviewPostId('');
    setCandidatePage(1);
  }, [detail?.batch.id]);

  useEffect(() => {
    setCandidatePage(1);
  }, [previewPost?.id]);

  useEffect(() => {
    if (!previewPost) {
      setCandidateSnapshot(null);
      return;
    }
    const params = new URLSearchParams({
      channel: previewPost.channel,
      page: String(candidatePage),
      pageSize: '6',
      placementStatus: 'not-posted',
      project,
      source: 'all',
    });
    setCandidatesLoading(true);
    api<AssetLibrarySnapshot>(`/api/assets?${params}`)
      .then(setCandidateSnapshot)
      .catch(error => onToast('error', error instanceof Error ? error.message : String(error)))
      .finally(() => setCandidatesLoading(false));
  }, [candidatePage, onToast, previewPost, project]);

  async function mutate(label: string, action: () => Promise<unknown>, nextBatchId = selectedBatch?.id || '') {
    setPending(label);
    try {
      await action();
      onToast('ok', label);
      await refresh(nextBatchId);
      onWorkTargetsChanged?.();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setPending('');
    }
  }

  async function createBatch() {
    await mutate('Saved content batch', () => api('/api/content/batches', {
      body: JSON.stringify({ ...batchForm, confirmWrite: true, project }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }), batchForm.batchId);
    setBatchForm(current => ({ ...current, batchId: '', title: '' }));
  }

  async function createPost() {
    if (!selectedBatch) return;
    await mutate('Saved content post', () => api('/api/content/posts', {
      body: JSON.stringify({ ...postForm, batchId: selectedBatch.id, confirmWrite: true, project }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
    setPostForm(current => ({ ...current, postId: '', title: '' }));
  }

  async function importDemoBatch() {
    await mutate('Imported demo content batch', () => api('/api/content/import/demo', {
      body: JSON.stringify({ ...importForm, confirmWrite: true, project }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }), importForm.batchId);
  }

  function togglePost(postId: string, checked: boolean) {
    setSelectedPostIds(current => checked ? [...new Set([...current, postId])] : current.filter(id => id !== postId));
  }

  async function bulkSetPhase(phase: ContentPostPhase) {
    const selected = (detail?.posts || []).filter(post => selectedPostIds.includes(post.id));
    if (selected.length === 0) return;
    const postedAt = phase === 'posted' ? new Date().toISOString() : undefined;
    await mutate(`Marked ${selected.length} posts ${phase}`, () => Promise.all(selected.map(post => api(`/api/content/posts/${post.id}`, {
      body: JSON.stringify({ confirmWrite: true, phase, postedAt, project }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }))));
    setSelectedPostIds([]);
  }

  async function attachAsset(postId: string) {
    const assetId = attachForm.assetId || selectedAsset?.asset_id || '';
    await mutate('Attached asset to post', () => api(`/api/content/posts/${postId}/assets`, {
      body: JSON.stringify({ assetId, confirmWrite: true, project, role: attachForm.role }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
    setAttachForm(current => ({ ...current, assetId: '', postId: '' }));
  }

  async function attachCandidateAsset(postId: string, assetId: string) {
    await mutate('Attached candidate asset to post', () => api(`/api/content/posts/${postId}/assets`, {
      body: JSON.stringify({ assetId, confirmWrite: true, project, role: 'primary' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
  }

  async function selectTarget(post: ContentPost) {
    await mutate('Selected next content target', () => api('/api/content/target', {
      body: JSON.stringify({ confirmWrite: true, notes: `Selected from ${post.batch_id}`, postId: post.id, project }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
  }

  async function clearTarget() {
    await mutate('Cleared next content target', () => api('/api/content/target/clear', {
      body: JSON.stringify({ confirmWrite: true, project }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
  }

  async function focusQueuePost(post: ContentPost) {
    setFilters({ asset: 'all', channel: post.channel, phase: post.phase });
    await refresh(post.batch_id);
    setPreviewPostId(post.id);
  }

  async function setPhase(post: ContentPost, phase: ContentPostPhase) {
    const inputs = phaseInputs[post.id] || { phase, postedAt: '', scheduledAt: '', url: '' };
    const scheduledAt = inputs.scheduledAt ? new Date(inputs.scheduledAt).toISOString() : undefined;
    const postedAt = phase === 'posted' ? inputs.postedAt || new Date().toISOString() : inputs.postedAt || undefined;
    await mutate(`Marked ${post.id} ${phase}`, () => api(`/api/content/posts/${post.id}`, {
      body: JSON.stringify({ confirmWrite: true, phase, postedAt, project, scheduledAt, url: inputs.url || undefined }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }));
  }

  return (
    <section className="content-view">
      <header className="content-head">
        <div>
          <h2>Content batches</h2>
          <p>{project} post drafts, attached assets, and phase state in SQLite.</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={() => void refresh()}>
          <RefreshCcw className={loading ? 'spin' : ''} size={17} /> Refresh
        </button>
      </header>
      {error && <div className="content-error">{error}</div>}
      <div className="content-grid">
        <aside className="content-panel content-sidebar">
          <CreateBatchForm form={batchForm} pending={Boolean(pending)} setForm={setBatchForm} submit={createBatch} />
          <ImportBatchForm form={importForm} pending={Boolean(pending)} setForm={setImportForm} submit={importDemoBatch} />
          <div className="batch-list">
            {batches.map(batch => (
              <button aria-pressed={selectedBatch?.id === batch.id} key={batch.id} onClick={() => void refresh(batch.id)} type="button">
                <strong>{batch.title}</strong>
                <code>{batch.id}</code>
                <span>{batch.post_count} posts · {phaseSummary(batch.phase_counts)}</span>
              </button>
            ))}
            {batches.length === 0 && <p className="content-empty">No content batches yet.</p>}
          </div>
        </aside>
        <div className="content-panel batch-detail">
          {detail ? (
            <>
              <BatchHeader detail={detail} onCopy={onCopy} />
              <ContentTargetPanel onClear={clearTarget} onCopy={onCopy} pending={Boolean(pending)} target={targetSnapshot} />
              <ContentOpsQueuePanel onCopy={onCopy} onFocusPost={focusQueuePost} queue={queueSnapshot} />
              <CreatePostForm form={postForm} pending={Boolean(pending)} setForm={setPostForm} submit={createPost} />
              <ContentPostFilters
                channels={channels}
                filters={filters}
                filteredCount={filteredPosts.length}
                needsAssetCount={needsAssetCount}
                selectedCount={selectedPostIds.length}
                setFilters={setFilters}
                setPhase={bulkSetPhase}
                totalCount={detail.posts.length}
              />
              {previewPost && (
                <div className="post-workbench">
                  <ContentPostPreview post={previewPost} onCopy={onCopy} />
                  <ContentAssetCandidates loading={candidatesLoading} onAttach={assetId => attachCandidateAsset(previewPost.id, assetId)} onOpenAsset={onOpenAsset} onPage={setCandidatePage} page={candidatePage} post={previewPost} snapshot={candidateSnapshot} />
                </div>
              )}
              <div className="post-list">
                {filteredPosts.map(post => (
                  <ContentPostCard
                    attachAsset={() => attachAsset(post.id)}
                    attachForm={attachForm}
                    assetLookup={assetLookup}
                    checked={selectedPostIds.includes(post.id)}
                    key={post.id}
                    isTarget={targetSnapshot?.target?.post.id === post.id}
                    onCopy={onCopy}
                    onOpenAsset={onOpenAsset}
                    onPreview={() => setPreviewPostId(post.id)}
                    onSetTarget={() => selectTarget(post)}
                    onToggleSelected={checked => togglePost(post.id, checked)}
                    phaseInputs={phaseInputs[post.id] || { phase: post.phase, postedAt: '', scheduledAt: '', url: '' }}
                    post={post}
                    selectedAsset={selectedAsset}
                    setAttachForm={setAttachForm}
                    setPhase={setPhase}
                    setPhaseInputs={value => setPhaseInputs(current => ({ ...current, [post.id]: value }))}
                  />
                ))}
                {detail.posts.length === 0 && <p className="content-empty">No posts in this batch yet.</p>}
                {detail.posts.length > 0 && filteredPosts.length === 0 && <p className="content-empty">No posts match these filters.</p>}
              </div>
            </>
          ) : (
            <div className="content-empty-state">
              <h3>No batch selected</h3>
              <p>Create a batch or seed one with the CLI, then it will appear here.</p>
              <code>npm run studio:cli -- content batch create --project {project} --batch-id &lt;id&gt; --title &lt;title&gt; --confirm-write --json</code>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CreateBatchForm({ form, pending, setForm, submit }: {
  form: { batchId: string; campaign: string; channel: string; title: string };
  pending: boolean;
  setForm: (value: { batchId: string; campaign: string; channel: string; title: string }) => void;
  submit: () => Promise<void>;
}) {
  return (
    <form className="content-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h3>New batch</h3>
      <input aria-label="Batch id" onChange={event => setForm({ ...form, batchId: event.target.value })} placeholder="batch-id" required value={form.batchId} />
      <input aria-label="Batch title" onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Title" required value={form.title} />
      <input aria-label="Batch campaign" onChange={event => setForm({ ...form, campaign: event.target.value })} placeholder="Campaign" value={form.campaign} />
      <input aria-label="Batch channel" onChange={event => setForm({ ...form, channel: event.target.value })} placeholder="Optional channel" value={form.channel} />
      <button className="primary-button" disabled={pending} type="submit"><Plus size={16} />Create</button>
    </form>
  );
}

function ImportBatchForm({ form, pending, setForm, submit }: {
  form: { batchId: string; kind: string; title: string };
  pending: boolean;
  setForm: (value: { batchId: string; kind: string; title: string }) => void;
  submit: () => Promise<void>;
}) {
  return (
    <form className="content-form compact" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h3>Import markdown</h3>
      <input aria-label="Import batch id" onChange={event => setForm({ ...form, batchId: event.target.value })} placeholder="batch-id" required value={form.batchId} />
      <input aria-label="Import batch title" onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Title" value={form.title} />
      <select aria-label="Import kind" onChange={event => setForm({ ...form, kind: event.target.value })} value={form.kind}>
        <option value="drafts">drafts</option>
        <option value="concepts">concepts</option>
        <option value="all">all</option>
      </select>
      <button className="secondary-button" disabled={pending} type="submit"><FileDown size={16} />Import demo</button>
    </form>
  );
}

function CreatePostForm({ form, pending, setForm, submit }: {
  form: { channel: string; phase: ContentPostPhase; postId: string; title: string };
  pending: boolean;
  setForm: (value: { channel: string; phase: ContentPostPhase; postId: string; title: string }) => void;
  submit: () => Promise<void>;
}) {
  return (
    <form className="content-form inline" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h3>New post</h3>
      <input aria-label="Post id" onChange={event => setForm({ ...form, postId: event.target.value })} placeholder="post-id" required value={form.postId} />
      <input aria-label="Post title" onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Title" required value={form.title} />
      <input aria-label="Post channel" onChange={event => setForm({ ...form, channel: event.target.value })} placeholder="Channel" required value={form.channel} />
      <select aria-label="Post phase" onChange={event => setForm({ ...form, phase: event.target.value as ContentPostPhase })} value={form.phase}>
        {phases.map(phase => <option key={phase} value={phase}>{phase}</option>)}
      </select>
      <button className="primary-button" disabled={pending} type="submit"><Plus size={16} />Add post</button>
    </form>
  );
}

function BatchHeader({ detail, onCopy }: { detail: ContentBatchDetail; onCopy: (text: string, label: string) => Promise<void> }) {
  return (
    <div className="batch-header">
      <div><h3>{detail.batch.title}</h3><p>{detail.batch.id} · {detail.batch.campaign || 'no campaign'} · updated {formatDate(detail.batch.updated_at)}</p></div>
      <button className="secondary-button" onClick={() => void onCopy(detail.handoff.inspectCommand, 'content batch inspect command')}>
        <Clipboard size={16} />Copy handoff
      </button>
    </div>
  );
}

function phaseSummary(counts: Record<ContentPostPhase, number>): string {
  return phases.filter(phase => counts[phase] > 0).map(phase => `${counts[phase]} ${phase}`).join(', ') || 'empty';
}
