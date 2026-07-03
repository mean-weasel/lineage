import { AlertCircle, CheckCircle2, Cloud, ImagePlus, Loader2, RefreshCcw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdapterSetting, AdapterSettingsSnapshot, AdapterType } from '../../shared/adapterSettingsTypes';
import { api } from '../api';
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
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      setSnapshot(await api<AdapterSettingsSnapshot>(`/api/adapters/settings?project=${encodeURIComponent(props.project)}`));
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
              <dd>{lineageReleaseInfo.version}</dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>{lineageReleaseInfo.channel}</dd>
            </div>
          </dl>
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
