/**
 * Claude plugin (claude-settings@1): the Claude page, Settings → Plugins → Claude, the 'Claude settings' context-menu
 * entry everywhere and the No wait banner chip. Values live on axHub; this UI reads them from the plugin's server and
 * saves each change there at once (owner-only settings save only from Brett's signed-in session; the server says no
 * otherwise and the message shows under the row).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Container, Icon, Note, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { CHROME_INSTANCE_KEY, type AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { ApprovalsPanel } from './approvals';
import { DEFAULT_VIEW, LABEL_DISPLAY, TAB_GROUP_ID, displayLabel, matches, normView, tabsFor, type TabIn, type ViewPrefs } from './view-core.mjs';
import './claude-settings.css';

const FOLDER = 'claude-settings';
const VIEW = 'claude-settings';
const POLL_MS = 15000;
const VIEW_KEY = 'axf.claude-settings.view';
const DEVICE_KEY = 'axf.claude-settings.device';
const ROW_KEY = CHROME_INSTANCE_KEY('tab-group', TAB_GROUP_ID);

type Value = boolean | string | number;
interface Setting {
  key: string; group: string; label: string; kind: 'toggle' | 'choice' | 'number' | 'text' | 'time'; value: Value; default: Value;
  owner: boolean | 'raise'; locked: boolean; who: string; description: string; level: string;
  options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; shared?: string;
  changed?: { at: string; by: string; via: string; why?: string };
}
interface Group { id: string; label: string; icon: string; description: string }
interface NoWait { active: boolean; remainingMs: number; expiresAt?: string; include_irreversible?: boolean; text?: string }
interface View { ok: boolean; live: boolean; store: string; groups: Group[]; tabs?: TabIn[]; settings: Setting[]; values: Record<string, Value>; noWait?: NoWait; message?: string }

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

async function save(values: Record<string, Value>): Promise<void> {
  const r = await pluginFetch(FOLDER, 'settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
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

/* ---------------- views ---------------- */

/** This browser's id: the name the view is saved under, so a phone and a desktop each keep their own. */
function deviceId(rt: AxfRuntime): string {
  const saved = rt.settings.get(DEVICE_KEY);
  if (typeof saved === 'string' && saved) return saved;
  const id = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  rt.settings.set(DEVICE_KEY, id);
  return id;
}
const deviceName = () => (window.matchMedia('(pointer: coarse)').matches ? 'Phone' : 'Computer');

/** The tab row's position and labels are the row's own overrides, so its right-click settings and this are one thing. */
function applyRow(rt: AxfRuntime, v: ViewPrefs) {
  const cur = (rt.settings.get(ROW_KEY) ?? {}) as Record<string, unknown>;
  const display = LABEL_DISPLAY[v.labels];
  if (cur.position !== v.position || cur.display !== display) rt.settings.set(ROW_KEY, { ...cur, position: v.position, display } as never);
}

function useViewPrefs() {
  const rt = useRuntime();
  const device = useMemo(() => deviceId(rt), [rt]);
  const [prefs, setPrefs] = useState<ViewPrefs>(() => normView(rt.settings.get(VIEW_KEY) ?? DEFAULT_VIEW));
  const now = useRef(prefs); // what is in force, ahead of the next render: the row's onChange below compares against it
  const push = useCallback((values: Partial<ViewPrefs>) => {
    void pluginFetch(FOLDER, 'view', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, name: deviceName(), values }) }).catch(() => undefined);
  }, [device]);
  const local = useCallback((v: ViewPrefs) => { now.current = v; setPrefs(v); rt.settings.set(VIEW_KEY, v as never); applyRow(rt, v); }, [rt]);
  const change = useCallback((patch: Partial<ViewPrefs>) => { local(normView({ ...now.current, ...patch })); push(patch); }, [local, push]);
  // what was saved for this device wins on load (a session may have changed it through MCP or the CLI)
  useEffect(() => {
    let live = true;
    void pluginFetch(FOLDER, `view?device=${encodeURIComponent(device)}`).then((r) => r.json()).then((j: { ok?: boolean; view?: ViewPrefs & { saved?: boolean } }) => {
      if (!live || !j.ok || !j.view) return;
      if (j.view.saved) local(normView(j.view)); else { const v = normView(rt.settings.get(VIEW_KEY) ?? DEFAULT_VIEW); applyRow(rt, v); }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [device, rt, local]);
  // the row's own right-click settings changed it: keep the view in step
  useEffect(() => rt.settings.onChange(ROW_KEY, (raw: unknown) => {
    const o = (raw ?? {}) as { position?: string; display?: string };
    const p = now.current;
    const v = normView({ ...p, position: o.position ?? p.position, labels: o.display ? displayLabel(o.display) : p.labels });
    if (v.position === p.position && v.labels === p.labels) return;
    local(v);
    push({ position: v.position, labels: v.labels });
  }), [rt, local, push]);
  return { prefs, change, device };
}

function ViewControls({ prefs, change, device }: { prefs: ViewPrefs; change: (p: Partial<ViewPrefs>) => void; device: string }) {
  return (
    <Container title="View" icon="layout" collapsible defaultOpen={false}>
      <div className="fx-stack">
        <SelectField label="View" value={prefs.mode} options={[{ value: 'tabbed', label: 'Tabs' }, { value: 'classic', label: 'Classic (one page)' }]} onChange={(v) => change({ mode: v as ViewPrefs['mode'] })} />
        {prefs.mode === 'tabbed' && <>
          <SelectField label="Tabs sit on the" value={prefs.position} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(v) => change({ position: v as ViewPrefs['position'] })} />
          <SelectField label="Tabs show" value={prefs.labels} options={[{ value: 'both', label: 'Words and icons' }, { value: 'words', label: 'Words' }, { value: 'icons', label: 'Icons' }]} onChange={(v) => change({ labels: v as ViewPrefs['labels'] })} />
        </>}
        <p className="axp-cs-group__desc">Saved for this device only ({device}).</p>
      </div>
    </Container>
  );
}

function TabBody({ view, tab }: { view: View; tab: ReturnType<typeof tabsFor<Group>>[number] }) {
  return (
    <div className="fx-stack">
      {tab.description && <p className="axp-cs-group__desc">{tab.description}</p>}
      {tab.groups.map((g) => (tab.groups.length > 1 ? <section key={g.id} className="fx-stack"><h3 className="axp-cs-group__title">{g.label}</h3><GroupBody view={view} group={g} /></section> : <GroupBody key={g.id} view={view} group={g} />))}
      {tab.id === 'approvals' && <ApprovalsPanel />}
    </div>
  );
}

/** One interface, wherever it opens (the Claude page, Settings → Plugins → Claude): find, View, then the settings. */
function ClaudeInterface({ view }: { view: View }) {
  const { prefs, change, device } = useViewPrefs();
  const [find, setFind] = useState('');
  const tabs = useMemo(() => tabsFor(view.groups, view.tabs, view.settings), [view]);
  const hits = find.trim() ? view.settings.filter((s) => matches(s, find)) : null;
  const active = tabs.find((t) => t.id === prefs.tab) ?? tabs[0];
  return (
    <div className="fx-stack">
      <TextField label="Find a setting" value={find} onChange={setFind} />
      <ViewControls prefs={prefs} change={change} device={device} />
      {hits ? (hits.length ? hits.map((s) => <SettingRow key={s.key} s={s} />) : <p className="axp-cs-group__desc">No setting matches.</p>)
        : prefs.mode === 'classic' ? tabs.map((t) => <Container key={t.id} title={t.label} icon={t.icon} collapsible><TabBody view={view} tab={t} /></Container>)
          : active ? (
            <TabGroup id={TAB_GROUP_ID} label="Claude settings" value={active.id} onChange={(id) => change({ tab: id })} tabs={tabs.map((t) => ({ value: t.id, label: t.label, icon: t.icon, title: t.label }))}>
              <TabBody view={view} tab={active} />
            </TabGroup>
          ) : null}
    </div>
  );
}

/** The whole interface as one settings panel: the view it draws is the one picked for this device. */
function InterfacePanel() {
  const { view, error } = useClaudeSettings();
  return <div className="fx-stack"><Status view={view} error={error} />{view && <ClaudeInterface view={view} />}</div>;
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
      {view && <ClaudeInterface view={view} />}
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

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.claude-settings',
  label: 'Claude',
  version: '0.2.0',
  appMenu,
  register(rt) {
    rt.actions.register('claude-settings.open', () => rt.dispatch(`settings.open:${VIEW}`), { label: 'Claude settings' });
  },
  views: { [VIEW]: { title: 'Claude', icon: 'sparkles', render: () => <ClaudePage /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Claude', icon: 'sparkles', view: VIEW }] },
  contextMenu: [{ id: 'claude-settings.ctx', target: '*', order: 70, items: [{ id: 'claude-settings.open', label: 'Claude settings', icon: 'sparkles', action: 'claude-settings.open' }] }],
  banners: [{ id: 'claude-no-wait', label: 'No wait', icon: 'zap', order: 4.9, render: () => <NoWaitBanner /> }],
  settingsTabs: [{ id: VIEW, label: 'Claude', icon: 'sparkles', order: 12, parent: 'plugins', description: 'Settings every Claude session reads on axHub before it acts: approvals and veto, builds, talking, notifications, memory.' }],
  settingsPanels: [
    { id: 'claude-settings.interface', tab: VIEW, title: 'Claude settings', icon: 'sparkles', order: 1, render: () => <InterfacePanel /> },
    { id: 'claude-settings.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
