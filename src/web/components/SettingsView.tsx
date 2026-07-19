import { AlertCircle, CheckCircle2, Cloud, Eye, ImagePlus, Loader2, RefreshCcw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdapterSetting, AdapterSettingsSnapshot, AdapterType } from '../../shared/adapterSettingsTypes';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import { api } from '../api';
import { readHoverPreviewsEnabled, writeHoverPreviewsEnabled } from '../lineagePreferences';
import { lineageReleaseInfo } from '../releaseInfo';
import './SettingsView.css';

const iconFor: Record<AdapterType, typeof Cloud> = {
  cloud: Cloud,
  image_generator: ImagePlus,
  scheduler: Send,
};

const titleFor: Record<AdapterType, string> = {
  cloud: 'Cloud storage',
  image_generator: 'Image generation',
  scheduler: 'Social scheduling',
};

const sections: Array<{ adapterType: AdapterType; ariaLabel: string }> = [
  { adapterType: 'cloud', ariaLabel: 'Cloud storage settings' },
  { adapterType: 'scheduler', ariaLabel: 'Social scheduling settings' },
  { adapterType: 'image_generator', ariaLabel: 'Image generation settings' },
];

function valueText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || 'not set';
  return JSON.stringify(value);
}

function configEntries(setting: AdapterSetting) {
  return Object.entries(setting.safe_config).filter(([key]) => !['secret', 'token', 'password', 'credential', 'apiKey'].includes(key));
}

function statusClass(setting: AdapterSetting) {
  if (setting.health_status === 'configured') return 'ok';
  if (setting.health_status === 'missing_config') return 'warn';
  return 'muted';
}

function Switch(props: { checked: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-checked={props.checked}
      aria-label={props.label}
      className={`settings-switch ${props.checked ? 'on' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

export function SettingsView(props: { project: string; onToast: (type: 'ok' | 'error', message: string) => void }) {
  const [snapshot, setSnapshot] = useState<AdapterSettingsSnapshot | null>(null);
  const [runtime, setRuntime] = useState<LineageRuntimeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [hoverPreviewsEnabled, setHoverPreviewsEnabled] = useState(readHoverPreviewsEnabled);

  function toggleHoverPreviews() {
    const enabled = !hoverPreviewsEnabled;
    if (!writeHoverPreviewsEnabled(enabled)) {
      props.onToast('error', 'Browser storage is unavailable, so the hover preview preference could not be saved');
      return;
    }
    setHoverPreviewsEnabled(enabled);
    props.onToast('ok', `Lineage hover previews ${enabled ? 'enabled' : 'disabled'}`);
  }

  async function refresh() {
    setLoading(true);
    try {
      const [settings, runtimeInfo] = await Promise.all([
        api<AdapterSettingsSnapshot>(`/api/adapters/settings?project=${encodeURIComponent(props.project)}`),
        api<{ runtime: LineageRuntimeInfo }>('/api/runtime'),
      ]);
      setSnapshot(settings);
      setRuntime(runtimeInfo.runtime);
    } catch (error) {
      props.onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function toggle(setting: AdapterSetting) {
    const key = `${setting.adapter_type}:${setting.provider}`;
    setSavingKey(key);
    try {
      const result = await api<{ setting: AdapterSetting }>(`/api/adapters/settings/${setting.adapter_type}/${setting.provider}`, {
        body: JSON.stringify({
          confirmWrite: true,
          enabled: !setting.enabled,
          project: props.project,
          safeConfig: setting.safe_config,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setSnapshot(current => current && {
        ...current,
        settings: current.settings.map(item => item.adapter_type === result.setting.adapter_type && item.provider === result.setting.provider ? result.setting : item),
      });
      props.onToast('ok', `${titleFor[setting.adapter_type]} ${result.setting.enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      props.onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSavingKey('');
    }
  }

  useEffect(() => {
    void refresh();
  }, [props.project]);

  return (
    <section className="settings-view">
      <header className="settings-header">
        <div>
          <h2>Settings</h2>
          <p>Adapter switches, safe local preferences, and credential-source status for {props.project}.</p>
        </div>
        <button className="secondary-button" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
          Refresh
        </button>
      </header>
      <div className="settings-sections">
        <section aria-label="Release information" className="settings-section">
          <h3>Release</h3>
          <dl className="settings-release">
            <div>
              <dt>Version</dt>
              <dd>{runtime?.version || lineageReleaseInfo.version}</dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>{runtime?.channel || lineageReleaseInfo.channel}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{runtime?.profile.id || 'loading'}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{runtime?.profile.environment || 'loading'}</dd>
            </div>
            <div>
              <dt>Binding</dt>
              <dd>{runtime ? (runtime.profile.bound ? 'bound' : 'legacy unbound') : 'loading'}</dd>
            </div>
            <div>
              <dt>Git</dt>
              <dd>{runtime?.git_sha || 'not available'}</dd>
            </div>
            <div>
              <dt>Assets</dt>
              <dd className="settings-path">{runtime?.asset_root || 'loading'}</dd>
            </div>
            <div>
              <dt>SQLite</dt>
              <dd className="settings-path">{runtime?.database.path || 'loading'}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{runtime?.database.exists ? `${runtime.database.projects ?? 0} projects / ${runtime.database.workspaces ?? 0} workspaces` : 'not created yet'}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{runtime ? `${runtime.schema.migration_keys.length} migration marker(s)` : 'loading'}</dd>
            </div>
          </dl>
        </section>
        <section aria-label="Lineage experience settings" className="settings-section">
          <h3>Lineage experience</h3>
          <div className="settings-grid">
            <article className="settings-card">
              <div className="settings-card-head">
                <span className="settings-icon"><Eye size={19} /></span>
                <div>
                  <h4>Hover previews</h4>
                  <p>Show the full asset image when hovering over or focusing a lineage node. Double-click details remain available when this is off.</p>
                </div>
                <Switch checked={hoverPreviewsEnabled} label="Enable lineage hover previews" onClick={toggleHoverPreviews} />
              </div>
            </article>
          </div>
        </section>
        {sections.map(section => (
          <section aria-label={section.ariaLabel} className="settings-section" key={section.adapterType}>
            <h3>{titleFor[section.adapterType]}</h3>
            <div className="settings-grid">
              {(snapshot?.settings || []).filter(setting => setting.adapter_type === section.adapterType).map(setting => {
                const Icon = iconFor[setting.adapter_type];
                const switchLabel = `Enable ${setting.label === 'Buffer' ? 'Buffer scheduling' : setting.label}`;
                const saving = savingKey === `${setting.adapter_type}:${setting.provider}`;
                return (
                  <article className="settings-card" key={`${setting.adapter_type}:${setting.provider}`}>
                    <div className="settings-card-head">
                      <span className="settings-icon"><Icon size={19} /></span>
                      <div>
                        <h4>{setting.label}</h4>
                        <p>{setting.description}</p>
                      </div>
                      <Switch checked={setting.enabled} disabled={saving} label={switchLabel} onClick={() => void toggle(setting)} />
                    </div>
                    <dl className="settings-meta">
                      <div>
                        <dt>Status</dt>
                        <dd className={statusClass(setting)}>
                          {setting.health_status === 'configured' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          {setting.health_status.replace(/_/g, ' ')}
                        </dd>
                      </div>
                      <div>
                        <dt>Credential source</dt>
                        <dd>{setting.credential.label}</dd>
                      </div>
                      <div>
                        <dt>Secret ref</dt>
                        <dd>{setting.credential.secret_ref || 'none'}</dd>
                      </div>
                    </dl>
                    {configEntries(setting).length > 0 && (
                      <div className="settings-config">
                        {configEntries(setting).map(([key, value]) => (
                          <span key={key}><strong>{key}</strong>{valueText(value)}</span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {loading && !snapshot && <div className="settings-loading">Loading settings...</div>}
      </div>
    </section>
  );
}
