import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import type { GrowthAsset, MutationResponse } from '../../shared/types';
import { formatBytes, slug } from '../../shared/format';
import { api } from '../api';
import { contentTypes } from '../assetUi';

const maxUploadBytes = 200 * 1024 * 1024;

export function UploadDrawer({
  channels,
  project,
  onClose,
  onUploaded,
  onError,
}: {
  channels: string[];
  project: string;
  onClose: () => void;
  onUploaded: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    assetId: '',
    audience: 'short-form-creators',
    campaign: '2026-06-organic-traffic-test',
    channel: channels[0] || 'meta',
    cta: '',
    hook: '',
    status: 'working' as 'working' | 'published',
    title: '',
    type: 'image' as GrowthAsset['content_type'],
    utmContent: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [busy, setBusy] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function syncTitle(value: string) {
    setForm(current => ({
      ...current,
      assetId: current.assetId || slug(`bleep-${current.channel}-${value}`),
      title: value,
      utmContent: current.utmContent || slug(value).replaceAll('-', '_'),
    }));
  }

  function chooseFile(nextFile?: File) {
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (nextFile.size > maxUploadBytes) {
      onError(`File is larger than ${formatBytes(maxUploadBytes)}`);
      return;
    }
    setFile(nextFile);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return onError('Choose a file before uploading');
    setBusy(true);
    try {
      const body = new FormData();
      Object.entries({ project, ...form, confirmWrite: String(confirmWrite) }).forEach(([key, value]) => body.append(key, value));
      body.append('file', file);
      const result = await api<MutationResponse>('/api/assets/upload', { method: 'POST', body });
      await onUploaded(result.message);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop">
      <form className="upload-drawer" onSubmit={submit}>
        <header><div><h2>Upload asset</h2><p>{project}</p></div><button type="button" onClick={onClose}>Close</button></header>
        <label className="file-drop"><Upload size={20} /><span>{file ? file.name : `Choose creative export up to ${formatBytes(maxUploadBytes)}`}</span><input type="file" onChange={event => chooseFile(event.target.files?.[0])} /></label>
        <div className="form-grid">
          <label>Title<input value={form.title} onChange={event => syncTitle(event.target.value)} required /></label>
          <label>Asset ID<input value={form.assetId} onChange={event => update('assetId', event.target.value)} required /></label>
          <label>Campaign<input value={form.campaign} onChange={event => update('campaign', event.target.value)} required /></label>
          <label>Channel<select value={form.channel} onChange={event => update('channel', event.target.value)}>{channels.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Audience<input value={form.audience} onChange={event => update('audience', event.target.value)} required /></label>
          <label>Status<select value={form.status} onChange={event => update('status', event.target.value)}><option>working</option><option>published</option></select></label>
          <label>Type<select value={form.type} onChange={event => update('type', event.target.value)}>{contentTypes.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>UTM content<input value={form.utmContent} onChange={event => update('utmContent', event.target.value)} required /></label>
          <label className="wide">Hook<input value={form.hook} onChange={event => update('hook', event.target.value)} /></label>
          <label className="wide">CTA<input value={form.cta} onChange={event => update('cta', event.target.value)} required /></label>
        </div>
        <label className="confirm-line"><input type="checkbox" checked={confirmWrite} onChange={event => setConfirmWrite(event.target.checked)} /><span>Confirm write to the production asset bucket</span></label>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy || !confirmWrite}>{busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}Upload</button>
        </footer>
      </form>
    </div>
  );
}
