/**
 * Settings → Plugins → Phone Connect. Tabs: Phone (device card, pair with QR or code, revoke), Notifications (one
 * switch per type), Recorder, Auto-approval, Overlay. The Settings host draws the level toolbar above every tab.
 * Every control carries a data-axf-target so console_show / console-control reach it; every action is a REST route.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Container, Chip, Note, SelectField, Switch, TabGroup, useRuntime } from '@console/axf/react';
import { TAB_GROUP_LAST_KEY } from '@console/axf/core';
import { api, errText, NOTIFY_KINDS, qrObjectUrl, when, type NotifyKind, type Settings, type Status } from './api';
import { RecorderPanel } from './RecorderView';
import { RulesPanel } from './RulesView';
import { OverlaySettings } from './OverlaySettings';
import './phone-connect.css';

export type PhoneTab = 'phone' | 'notifications' | 'recorder' | 'rules' | 'overlay';
export const PHONE_TABS: { value: PhoneTab; label: string; icon: string }[] = [
  { value: 'phone', label: 'Phone', icon: 'smartphone' },
  { value: 'notifications', label: 'Notifications', icon: 'bell' },
  { value: 'recorder', label: 'Recorder', icon: 'mic' },
  { value: 'rules', label: 'Auto-approval', icon: 'check' },
  { value: 'overlay', label: 'Overlay', icon: 'layers' },
];

export function useStatus(pollMs = 5000) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.call<Status>('status').then((s) => { setStatus(s); setError(''); }, (e) => setError(errText(e))), []);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, pollMs); return () => clearInterval(t); }, [load, pollMs]);
  return { status, error, load };
}

export function DevicePanel() {
  const { status, error, load } = useStatus();
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [qr, setQr] = useState('');
  const code = status?.pairing?.code ?? '';
  useEffect(() => {
    let url = '';
    if (code) void qrObjectUrl().then((u) => { url = u; setQr(u); });
    else setQr('');
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [code]);
  const act = (what: string, fn: () => Promise<unknown>) => { setBusy(what); setNote(''); fn().then(() => load(), (e) => setNote(errText(e))).finally(() => setBusy('')); };
  const d = status?.device;
  return (
    <div className="axp-phone-stack" data-axf-target="phone-connect.device">
      {error && <Note tone="danger">{error}</Note>}
      <Container title={d ? d.name || 'Phone' : 'No phone paired'} icon="smartphone">
        {d ? (
          <div className="axp-phone-card">
            <div className="axp-phone-row">
              <Chip tone={d.online ? "success" : "warning"}>{d.online ? "Online" : "Offline"}</Chip>
              <span className="axp-phone-muted">{d.presence}</span>
            </div>
            <dl className="axp-phone-facts">
              <dt>Last seen</dt><dd>{when(d.lastSeenAt)}</dd>
              <dt>Paired</dt><dd>{when(d.pairedAt)} by {d.owner}</dd>
              <dt>App</dt><dd>{d.app} {d.appVersion}</dd>
              <dt>Can do</dt><dd>{d.capabilities.join(', ') || 'nothing yet'}</dd>
            </dl>
            <div className="axp-phone-actions">
              <Button icon="refresh" onClick={() => void load()} data-axf-target="phone-connect.refresh">Refresh</Button>
              <Button icon="x" tone="danger" confirm="Revoke this phone? It is refused from now on and must pair again." disabled={!!busy} onClick={() => act('revoke', () => api.post(`devices/${encodeURIComponent(d.deviceId)}/revoke`, { why: 'revoked in Settings' }))} data-axf-target="phone-connect.revoke">Revoke</Button>
            </div>
          </div>
        ) : (
          <p className="axp-phone-muted">Install Phone Connect on the phone, sign in with your hub account, then scan the code below or type it.</p>
        )}
      </Container>
      <Container title="Pair a phone" icon="key">
        {code ? (
          <div className="axp-phone-pair" data-axf-target="phone-connect.pair-code">
            {qr && <img className="axp-phone-qr" src={qr} alt={`Pairing QR for code ${code}`} />}
            <div className="axp-phone-stack">
              <span className="axp-phone-code" aria-label="Pairing code">{code}</span>
              <span className="axp-phone-muted">Good until {when(status?.pairing?.expiresAt ?? '')}. Only your own hub sign-in on the phone can claim it.</span>
              <div className="axp-phone-actions">
                <Button icon="refresh" disabled={!!busy} onClick={() => act('pair', () => api.post('pair', {}))} data-axf-target="phone-connect.pair-new">New code</Button>
                <Button icon="x" disabled={!!busy} onClick={() => act('cancel', () => api.del('pair'))} data-axf-target="phone-connect.pair-cancel">Cancel</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button icon="plus" disabled={!!busy} onClick={() => act('pair', () => api.post('pair', {}))} data-axf-target="phone-connect.pair">Pair a phone</Button>
        )}
      </Container>
      {note && <Note tone="warning">{note}</Note>}
    </div>
  );
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.call<Settings>('settings').then(setSettings, (e) => setError(errText(e))), []);
  useEffect(() => { void load(); }, [load]);
  const save = (patch: Partial<Settings>) => api.post<Settings>('settings', patch).then((s) => { setSettings(s); setError(''); }, (e) => setError(errText(e)));
  return { settings, error, save };
}

export function NotificationsPanel() {
  const { settings, error, save } = useSettings();
  return (
    <Container title="What reaches the phone" icon="bell">
      <div className="axp-phone-stack" data-axf-target="phone-connect.notifications">
        {error && <Note tone="danger">{error}</Note>}
        {NOTIFY_KINDS.map((k) => (
          <div key={k.id} data-axf-target={`phone-connect.notify.${k.id}`}>
            <Switch label={k.label} hint={k.hint} checked={settings?.notify[k.id] ?? true} disabled={!settings}
              onChange={(v) => void save({ notify: { ...(settings?.notify ?? {}), [k.id]: v } as Record<NotifyKind, boolean> })} />
          </div>
        ))}
        <div data-axf-target="phone-connect.browser">
          <SelectField label="Open pages in" value={settings?.browser ?? 'chrome'} disabled={!settings}
            options={[{ value: 'chrome', label: 'Chrome' }, { value: 'default', label: 'The default browser' }]}
            onChange={(v) => void save({ browser: v as Settings['browser'] })} hint="Only https pages on amberxai.com ever open." />
        </div>
        <div data-axf-target="phone-connect.monitor">
          <Switch label="Monitor" hint="The phone watches axHub with the screen off: approvals, alerts and your auto-approval rules." checked={settings?.monitor ?? true}
            disabled={!settings} onChange={(v) => void save({ monitor: v })} />
        </div>
      </div>
    </Container>
  );
}

export function PhoneConnectSettings({ tab: initial }: { tab?: PhoneTab }) {
  const rt = useRuntime();
  // a deep link (phone-connect.open <tab>, console_show …tabs=<tab>) leaves the tab in the row's remembered key
  const saved = rt.settings.get(TAB_GROUP_LAST_KEY('phone-connect.tabs'));
  const [tab, setTab] = useState<PhoneTab>(initial ?? (PHONE_TABS.some((t) => t.value === saved) ? (saved as PhoneTab) : 'phone'));
  return (
    <div className="axp-phone-stack" data-axf-target="phone-connect.settings">
      <TabGroup id="phone-connect.tabs" label="Phone Connect" value={tab} onChange={setTab} tabs={PHONE_TABS} />
      {tab === 'phone' && <DevicePanel />}
      {tab === 'notifications' && <NotificationsPanel />}
      {tab === 'recorder' && <RecorderPanel />}
      {tab === 'rules' && <RulesPanel />}
      {tab === 'overlay' && <OverlaySettings />}
    </div>
  );
}
