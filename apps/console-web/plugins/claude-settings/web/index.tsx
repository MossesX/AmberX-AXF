/**
 * Claude plugin (claude-settings@1): the Claude page, Settings → Plugins → Claude, the 'Claude settings' context-menu
 * entry everywhere and the No wait banner chip. Values live on axHub; this UI reads them from the plugin's server and
 * saves each change there at once (owner-only settings save only from Brett's signed-in session; the server says no
 * otherwise and the message shows under the row).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Container, Icon, Note, SelectField, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { ownerFetch, pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './claude-settings.css';

const FOLDER = 'claude-settings';
const VIEW = 'claude-settings';
const POLL_MS = 15000;

type Value = boolean | string | number;
interface Setting {
  key: string; group: string; label: string; kind: 'toggle' | 'choice' | 'number' | 'text' | 'time'; value: Value; default: Value;
  owner: boolean | 'raise'; locked: boolean; who: string; description: string; level: string;
  options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; shared?: string;
  changed?: { at: string; by: string; via: string; why?: string };
}
interface Group { id: string; label: string; icon: string; description: string }
interface NoWait { active: boolean; remainingMs: number; expiresAt?: string; include_irreversible?: boolean; text?: string }
interface View { ok: boolean; live: boolean; store: string; groups: Group[]; settings: Setting[]; values: Record<string, Value>; noWait?: NoWait; message?: string }

/* ---------------- data ---------------- */

let shared: View | null = null;
const listeners = new Set<(v: View | null) => void>();
function publish(v: View | null) { shared = v; for (const l of listeners) l(v); }

async function load(): Promise<View> {
  const r = await pluginFetch(FOLDER, 'settings');
  const j = (await r.json()) as View;
  if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
  publish(j);
  return j;
}

/** Saves go out as Brett's own click (his signed-in session, not the console token): owner-only switches need it. */
async function save(values: Record<string, Value>): Promise<void> {
  const r = await ownerFetch(FOLDER, 'settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
  const j = (await r.json().catch(() => ({}))) as View;
  if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
  publish(j);
}

function useClaudeSettings() {
  const [view, setView] = useState<View | null>(shared);
  const [error, setError] = useState('');
  const refresh = useCallback(() => load().then(() => setError(''), (e: Error) => setError(e.message)), []);
  useEffect(() => {
    listeners.add(setView);
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { listeners.delete(setView); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  return { view, error, refresh };
}

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}
const left = (iso: string | undefined, now: number) => {
  const s = Math.max(0, Math.round(((iso ? Date.parse(iso) : now) - now) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

/* ---------------- one setting ---------------- */

function SettingRow({ s }: { s: Setting }) {
  const [draft, setDraft] = useState(String(s.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(s.value)); }, [s.value]);
  const put = (v: Value) => { setBusy(true); setError(''); save({ [s.key]: v }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  const badge = s.locked ? <span className="fx-chip"><Icon name="lock" size={12} /> Locked</span>
    : s.owner === true ? <span className="fx-chip fx-chip--warning"><Icon name="key" size={12} /> Owner only</span>
      : s.owner === 'raise' ? <span className="fx-chip"><Icon name="key" size={12} /> Only Brett raises</span>
        : s.shared ? <span className="fx-chip fx-chip--accent"><Icon name="layers" size={12} /> Shared with {s.shared}</span> : null;
  const hint = <>{s.description}{s.changed ? <span className="axp-cs-row__when"> Last changed by {s.changed.by}{s.changed.why ? ` (${s.changed.why})` : ''}, {new Date(s.changed.at).toLocaleString()}.</span> : null}</>;
  const disabled = busy || s.locked;
  let control;
  if (s.kind === 'toggle') control = <Switch label={s.label} checked={s.value === true} disabled={disabled} hint={hint} onChange={(v) => put(v)} />;
  else if (s.kind === 'choice') control = <SelectField label={s.label} value={String(s.value)} options={(s.options ?? []).map((o) => ({ value: o.value, label: o.label }))} disabled={disabled} hint={hint} onChange={(v) => put(v)} />;
  else {
    const typed: Value = s.kind === 'number' ? Number(draft) : draft;
    control = (
      <div className="axp-cs-row__edit">
        <TextField label={s.label} value={draft} type={s.kind === 'number' ? 'number' : s.kind === 'time' ? 'time' : 'text'} disabled={disabled} hint={hint} onChange={setDraft} />
        {draft !== String(s.value) && <Button size="sm" tone="primary" icon="save" disabled={busy} onClick={() => put(typed)}>Save</Button>}
      </div>
    );
  }
  return (
    <div className="axp-cs-row" data-key={s.key}>
      <div className="axp-cs-row__control">{control}</div>
      {(badge || busy) && <div className="axp-cs-row__badge">{busy ? <span className="axp-cs-row__when" role="status">Saving…</span> : badge}</div>}
      {error && <Note tone="danger">{error}</Note>}
    </div>
  );
}

function NoWaitState({ view }: { view: View }) {
  const nw = view.noWait;
  const on = view.values['noWait.enabled'] === true;
  const now = useNow(on);
  if (!on) return <Note tone="info">No wait is off: held calls wait on the 90 s veto. Only Brett's own click here turns it on.</Note>;
  const until = view.values['noWait.duration'] === 'untilOff' ? 'until you turn it off' : nw?.active ? `${left(nw.expiresAt, now)} left` : 'pass not on';
  return <Note tone="warning" icon="zap">No wait is ON ({until}){nw?.include_irreversible ? ', irreversible calls included' : ''}: Amber's held calls run at once.</Note>;
}

function GroupBody({ view, group }: { view: View; group: Group }) {
  const rows = view.settings.filter((s) => s.group === group.id);
  return (
    <div className="fx-stack">
      {group.description && <p className="axp-cs-group__desc">{group.description}</p>}
      {group.id === 'no-wait' && <NoWaitState view={view} />}
      {rows.map((s) => <SettingRow key={s.key} s={s} />)}
    </div>
  );
}

function Status({ view, error }: { view: View | null; error: string }) {
  if (error) return <Note tone="danger">Claude settings unavailable: {error}</Note>;
  if (!view) return <p className="axp-cs-group__desc">Loading Claude settings…</p>;
  return view.live ? null : <Note tone="warning">Not live on axHub: this console keeps them in {view.store}. Claude sessions elsewhere won't see changes.</Note>;
}

/** One settings panel per group (the level toolbar and the settings search see them like any other panel). */
function GroupPanel({ id }: { id: string }) {
  const { view, error } = useClaudeSettings();
  const group = view?.groups.find((g) => g.id === id);
  return (
    <div className="fx-stack">
      {id === 'no-wait' && <Status view={view} error={error} />}
      {view && group ? <GroupBody view={view} group={group} /> : null}
    </div>
  );
}

function ClaudePage() {
  const { view, error, refresh } = useClaudeSettings();
  return (
    <div className="fx-stack fx-stack--lg axp-cs">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins · Claude</p>
          <h1>Claude</h1>
          <p className="fx-muted">Settings every Claude session reads on axHub before it acts; owner-only ones change only with your own click here.</p>
        </div>
        <Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Refresh</Button>
      </header>
      <Status view={view} error={error} />
      {view?.groups.filter((g) => view.settings.some((s) => s.group === g.id)).map((g) => (
        <Container key={g.id} title={g.label} icon={g.icon}><GroupBody view={view} group={g} /></Container>
      ))}
    </div>
  );
}

/** Banner chip while No wait is on: what's on, time left, Turn off. */
function NoWaitBanner() {
  const { view } = useClaudeSettings();
  const on = view?.values['noWait.enabled'] === true;
  const now = useNow(on);
  const [busy, setBusy] = useState(false);
  if (!view || !on) return null;
  const nw = view.noWait;
  const time = view.values['noWait.duration'] === 'untilOff' ? 'until off' : nw?.active ? left(nw.expiresAt, now) : '…';
  return (
    <div className="axp-cs-banner" role="status" aria-live="polite">
      <span className="fx-chip fx-chip--warning" title="Claude settings → No wait: Amber's held calls run at once (a standing veto pass)">
        <Icon name="zap" size={14} /> <b>No wait</b>{nw?.include_irreversible ? ' +irreversible' : ''} · {time}
      </span>
      <Button size="sm" tone="ghost" icon="x" disabled={busy} onClick={() => { setBusy(true); save({ 'noWait.enabled': false }).catch(() => undefined).finally(() => setBusy(false)); }}>Turn off</Button>
    </div>
  );
}

const GROUP_PANELS: { id: string; title: string; icon: string }[] = [
  { id: 'no-wait', title: 'No wait', icon: 'zap' },
  { id: 'follow', title: 'Follow Amber', icon: 'eye' },
  { id: 'builds', title: 'Builds', icon: 'layers' },
  { id: 'headless', title: 'Headless sessions', icon: 'terminal' },
  { id: 'verification', title: 'Verification', icon: 'shield' },
  { id: 'talking', title: 'Talking', icon: 'mic' },
  { id: 'notifications', title: 'Notifications', icon: 'bell' },
  { id: 'recording', title: 'Session recording', icon: 'mic' },
  { id: 'memory', title: 'Memory and notes', icon: 'file' },
];

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.claude-settings',
  label: 'Claude',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('claude-settings.open', () => rt.dispatch(`settings.open:${VIEW}`), { label: 'Claude settings' });
  },
  views: { [VIEW]: { title: 'Claude', icon: 'sparkles', render: () => <ClaudePage /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Claude', icon: 'sparkles', view: VIEW }] },
  contextMenu: [{ id: 'claude-settings.ctx', target: '*', order: 70, items: [{ id: 'claude-settings.open', label: 'Claude settings', icon: 'sparkles', action: 'claude-settings.open' }] }],
  banners: [{ id: 'claude-no-wait', label: 'No wait', icon: 'zap', order: 4.9, render: () => <NoWaitBanner /> }],
  settingsTabs: [{ id: VIEW, label: 'Claude', icon: 'sparkles', order: 12, parent: 'plugins', description: 'Settings every Claude session reads on axHub before it acts: No wait, builds, headless sessions, talking, notifications, memory.' }],
  settingsPanels: [
    ...GROUP_PANELS.map((g, i) => ({ id: `claude-settings.${g.id}`, tab: VIEW, title: g.title, icon: g.icon, order: i + 1, render: () => <GroupPanel id={g.id} /> })),
    { id: 'claude-settings.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
