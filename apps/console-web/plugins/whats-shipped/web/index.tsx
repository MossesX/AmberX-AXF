/**
 * What's new console plugin (ai.amberx.axf.console.whats-shipped).
 *
 * A banner widget with the newest features merged to main: a short ticker that steps through the unread titles and an
 * unread count ("3 new · Theme Editor plugin…"), accent dot while anything is unread. It is a framework `status` widget
 * (no new asset type; the framework ships `status/whats-shipped` for the banner editor and gallery): the plugin registers
 * its own copy, repainted on every tick, and attaches it to the banner's right side. The console detaches it when the
 * plugin is switched off (origin = the plugin id). Counter for other widgets: `shipped.unread`.
 *
 * Tap → the What's new panel: grouped by date (Today / Yesterday / This week / Older), by build or by app (segmented
 * switch, remembered), search, per-item details (what it does, where to find it, PR and report links), mark read /
 * mark all read, and items merged since the last visit highlighted.
 *
 * The browser only talks to the console (`GET /api/plugins/whats-shipped/feed`); the server builds the whats-new@1 feed
 * from merged pull requests, the builds store, build reports and Codebase changes entries (no model tokens). Read marks
 * and the last visit are kept per device.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Checkbox, Chip, Icon, Segmented, SelectField, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './whats-shipped.css';
import { GROUPS, ID, KEYS, ago, firstRunRead, groupItems, isNewSince, markRead, paintWhatsNew, readSet, search, unread, type Feed, type FeedItem, type GroupBy } from './core';
import { appMenu } from './menu';

const FOLDER = 'whats-shipped';
const POLL_MS = 120_000;
const TICK_MS = 6_000;
const REPO_URL = 'https://github.com/MossesX/AmberX-AXF';
const api = pluginApi(FOLDER, "What's new");

interface AppChoice { id: string; label: string; kind: string }
interface Config { days: number; apps: string[]; deployedOnly: boolean; deployWorkflows: string[]; daysChoices: number[]; appChoices: AppChoice[]; defaults: Omit<Config, 'defaults' | 'daysChoices' | 'appChoices'> }

/* ---------------- store ---------------- */

interface State { feed: Feed | null; error: string; loading: boolean; tick: number }
let st: State = { feed: null, error: '', loading: false, tick: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useFeed = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

let runtime: AxfRuntime | null = null;
const items = () => st.feed?.items ?? [];
const shown = (rt: AxfRuntime) => rt.settings.get(KEYS.show) !== false;
const reads = (rt: AxfRuntime | null) => readSet(rt?.settings.get(KEYS.read));
const tickerOn = (rt: AxfRuntime) => rt.settings.get(KEYS.ticker) !== false;

function paint(rt: AxfRuntime) { paintWhatsNew(rt, items(), reads(rt), tickerOn(rt) ? st.tick : 0, shown(rt), st.loading); }

function setRead(rt: AxfRuntime, ids: string[]) {
  rt.settings.set(KEYS.read, markRead(reads(rt), ids, items().map((i) => i.id)));
  paint(rt);
  set({});
}
function markUnread(rt: AxfRuntime, id: string) {
  const r = reads(rt); r.delete(id);
  rt.settings.set(KEYS.read, [...r]);
  paint(rt);
  set({});
}

let inflight = false;
export async function refresh(force = false): Promise<void> {
  if (inflight) return;
  inflight = true;
  set({ loading: true });
  try {
    const feed = await api.call<Feed>(`feed${force ? '?refresh=true' : ''}`);
    set({ feed, error: feed.error ?? '', loading: false });
    if (runtime && !Array.isArray(runtime.settings.get(KEYS.read))) runtime.settings.set(KEYS.read, firstRunRead(feed.items));
  } catch (e) {
    set({ error: (e as Error).message, loading: false });
  } finally {
    inflight = false;
    if (runtime && stillOn(runtime)) paint(runtime);
  }
}

let poll: ReturnType<typeof setInterval> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
/** Still on? The console detaches a switched-off plugin's banner items, so a missing item (while shown) means off. */
const stillOn = (rt: AxfRuntime) => !shown(rt) || rt.hostAttachments('banner').some((a) => a.origin === ID);
const onFocus = () => { if (runtime && stillOn(runtime)) void refresh(); };
const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };

function start(rt: AxfRuntime) {
  runtime = rt;
  paint(rt);
  if (poll) return;
  void refresh();
  poll = setInterval(() => {
    if (!stillOn(rt)) { stop(); return; }
    if (document.visibilityState === 'visible') void refresh();
  }, POLL_MS);
  ticker = setInterval(() => {
    if (!stillOn(rt)) { stop(); return; }
    if (document.visibilityState === 'visible' && tickerOn(rt) && unread(items(), reads(rt)).length > 1) { st = { ...st, tick: st.tick + 1 }; paint(rt); }
  }, TICK_MS);
  globalThis.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
}
function stop() {
  if (poll) clearInterval(poll);
  if (ticker) clearInterval(ticker);
  poll = ticker = null;
  globalThis.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onVisible);
}

/* ---------------- the panel ---------------- */

const GROUP_LABEL: Record<GroupBy, string> = { date: 'By date', build: 'By build', app: 'By app' };
const GROUP_ICON: Record<GroupBy, string> = { date: 'clock', build: 'hammer', app: 'grid' };
const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString() : ''; };

function ItemRow({ it, isRead, fresh, open, onToggle }: { it: FeedItem; isRead: boolean; fresh: boolean; open: boolean; onToggle: () => void }) {
  const rt = runtime;
  return (
    <li className={`axp-whats-shipped__item${isRead ? '' : ' is-unread'}${fresh ? ' is-fresh' : ''}`}>
      <button type="button" data-fx-row className="axp-whats-shipped__head" aria-expanded={open} onClick={() => { onToggle(); if (!isRead && rt) setRead(rt, [it.id]); }}>
        <span className="axp-whats-shipped__dot" aria-hidden="true" />
        <span className="axp-whats-shipped__title">{it.title}</span>
        <span className="fx-small fx-muted axp-whats-shipped__when">{ago(it.mergedAt)}</span>
      </button>
      <div className="fx-row fx-row--wrap axp-whats-shipped__chips">
        {fresh && <Chip tone="accent">New since last visit</Chip>}
        {it.deployed === true ? <Chip tone="success">Deployed</Chip> : it.deployed === false ? <Chip tone="warning">Merged, not deployed yet</Chip> : <Chip>Merged</Chip>}
        {it.apps.slice(0, 4).map((a) => <Chip key={a.id}>{a.label}</Chip>)}
        {it.apps.length > 4 && <Chip>+{it.apps.length - 4}</Chip>}
      </div>
      {open && (
        <div className="axp-whats-shipped__body">
          {it.summary && <p className="axp-whats-shipped__text">{it.summary}</p>}
          {it.details.length > 0 && <ul className="axp-whats-shipped__details">{it.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          {it.where && <p className="fx-small axp-whats-shipped__text"><Icon name="search" size={12} /> <strong>Where to find it:</strong> {it.where}</p>}
          <p className="fx-small fx-muted axp-whats-shipped__text">
            Merged {when(it.mergedAt)}{it.deployedAt ? ` · deployed ${when(it.deployedAt)}` : ''}
            {it.build ? <> · build <span className="fx-mono">{it.build.id}</span>{it.build.profile ? ` (${it.build.profile})` : ''}</> : null}
            {it.branch ? <> · <span className="fx-mono">{it.branch}</span></> : null}
          </p>
          <div className="fx-row fx-row--wrap">
            {it.pr?.url && <a className="fx-btn fx-btn--neutral axp-whats-shipped__link" href={it.pr.url} target="_blank" rel="noopener noreferrer"><Icon name="github" size={14} /> PR #{it.pr.number}</a>}
            {it.report && <a className="fx-btn fx-btn--neutral axp-whats-shipped__link" href={`${REPO_URL}/blob/main/${it.report}`} target="_blank" rel="noopener noreferrer"><Icon name="file" size={14} /> Build report</a>}
            {rt && (isRead
              ? <Button icon="eye" onClick={() => markUnread(rt, it.id)}>Mark unread</Button>
              : <Button icon="check" onClick={() => setRead(rt, [it.id])}>Mark read</Button>)}
          </div>
        </div>
      )}
    </li>
  );
}

function Panel() {
  const s = useFeed();
  const rt = runtime;
  const [by, setBy] = useState<GroupBy>(() => (GROUPS.includes(rt?.settings.get(KEYS.group) as GroupBy) ? rt?.settings.get(KEYS.group) as GroupBy : 'date'));
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string>('');
  // the last visit as it was when the panel opened: items after it are highlighted for this visit
  const [lastVisit] = useState(() => String(rt?.settings.get(KEYS.lastVisit) ?? ''));
  useEffect(() => {
    void refresh();
    return () => { runtime?.settings.set(KEYS.lastVisit, new Date().toISOString()); };
  }, []);
  const read = reads(rt);
  const list = useMemo(() => search(s.feed?.items ?? [], q), [s.feed, q]);
  const groups = useMemo(() => groupItems(list, by), [list, by]);
  const left = unread(s.feed?.items ?? [], read).length;
  const pick = (g: GroupBy) => { setBy(g); rt?.settings.set(KEYS.group, g); };
  return (
    <div className="fx-stack axp-whats-shipped">
      <div className="fx-row fx-row--wrap axp-whats-shipped__bar">
        <Segmented label="Group" value={by} onChange={pick} options={GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g], icon: GROUP_ICON[g] }))} />
        <TextField label="Search" value={q} onChange={setQ} placeholder="Search features, builds, apps" className="axp-whats-shipped__search" />
      </div>
      <div className="fx-row fx-row--wrap">
        <span className="fx-small fx-muted">{left ? `${left} unread` : 'All read'} · {s.feed?.items.length ?? 0} shipped</span>
        <Button icon="check" disabled={!left} onClick={() => rt && setRead(rt, (s.feed?.items ?? []).map((i) => i.id))}>Mark all read</Button>
        <Button icon="refresh" disabled={s.loading} onClick={() => void refresh(true)}>{s.loading ? 'Checking…' : 'Check now'}</Button>
        <Button icon="settings" onClick={() => { rt?.closeDialog(); rt?.dispatch('settings.open:whats-shipped'); }}>Settings</Button>
      </div>
      {s.error && <p className="fx-small fx-muted axp-whats-shipped__text" role="status"><Icon name="info" size={12} /> {s.error}</p>}
      {!groups.length && <p className="fx-muted">{s.loading ? 'Reading what shipped…' : q ? 'Nothing matches.' : 'Nothing shipped in this window.'}</p>}
      {groups.map((g) => (
        <section key={g.key} className="axp-whats-shipped__group">
          <h4 className="axp-whats-shipped__group-title">{g.label} <span className="fx-small fx-muted">{g.items.length}</span></h4>
          <ul className="axp-whats-shipped__list">
            {g.items.map((it) => (
              <ItemRow key={it.id} it={it} isRead={read.has(it.id)} fresh={isNewSince(it, lastVisit)} open={open === `${g.key}|${it.id}`}
                onToggle={() => setOpen(open === `${g.key}|${it.id}` ? '' : `${g.key}|${it.id}`)} />
            ))}
          </ul>
        </section>
      ))}
      {s.feed && <p className="fx-small fx-muted axp-whats-shipped__text">From {s.feed.source === 'github' ? 'GitHub' : s.feed.source === 'git' ? 'the repo\'s git history' : 'nothing yet'} · {s.feed.deploysKnown ? 'deploys checked' : 'deploys unknown'} · built {ago(s.feed.builtAt)}</p>}
    </div>
  );
}

/* ---------------- settings ---------------- */

function FilterPanel() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.call<Config>('config').then(setCfg).catch((e: Error) => setMsg(e.message)); }, []);
  if (!cfg) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  const save = async (patch: Partial<Config> | { reset: true }) => {
    setBusy(true); setMsg('');
    try {
      const body = 'reset' in patch ? patch : { days: cfg.days, apps: cfg.apps, deployedOnly: cfg.deployedOnly, deployWorkflows: cfg.deployWorkflows, ...patch };
      setCfg(await api.put<Config>('config', body)); setMsg('Saved.');
      await refresh(true);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const want = new Set(cfg.apps);
  const toggle = (id: string, on: boolean) => void save({ apps: on ? [...want, id] : [...want].filter((x) => x !== id) });
  const kinds: { kind: string; label: string }[] = [{ kind: 'framework', label: 'Framework' }, { kind: 'app', label: 'Apps' }, { kind: 'plugin', label: 'Console plugins' }];
  return (
    <div className="fx-stack">
      <SelectField label="How far back" value={String(cfg.days)} disabled={busy} onChange={(v) => void save({ days: Number(v) })}
        options={cfg.daysChoices.map((d) => ({ value: String(d), label: d === 1 ? 'Last day' : d === 365 ? 'Last year' : `Last ${d} days` }))} />
      <Switch label="Only what is deployed" hint="Off: everything merged to main. On: only what a deploy has carried out since." checked={cfg.deployedOnly} disabled={busy} onChange={(v) => void save({ deployedOnly: v })} />
      <p className="fx-small fx-muted axp-whats-shipped__text">Which apps to include ({want.size ? `${want.size} picked` : 'all'}): nothing picked shows everything.</p>
      {kinds.map((k) => (
        <details key={k.kind} className="axp-whats-shipped__apps" open={k.kind !== 'plugin'}>
          <summary>{k.label}</summary>
          <div className="axp-whats-shipped__app-grid">
            {cfg.appChoices.filter((a) => a.kind === k.kind).map((a) => <Checkbox key={a.id} label={a.label} checked={want.has(a.id)} disabled={busy} onChange={(v) => toggle(a.id, v)} />)}
          </div>
        </details>
      ))}
      <div className="fx-row fx-row--wrap">
        <Button icon="x" disabled={busy || !want.size} onClick={() => void save({ apps: [] })}>Include every app</Button>
        <Button icon="refresh" disabled={busy} onClick={() => void save({ reset: true })}>Back to the defaults</Button>
      </div>
      {msg && <p className="fx-small axp-whats-shipped__text" role="status">{msg}</p>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID,
  label: "What's new",
  version: '0.1.0',
  provides: ['banner.status.whats-shipped'],
  register(rt) {
    rt.actions.register('whats-shipped.open', () => rt.openDialog('whats-shipped.panel'), { label: "Show what's new" });
    // the app-wide "open What's new" hook: anything else that says What's new (the systems check's strip) opens this
    // panel through it without naming this plugin
    rt.actions.register('whats-new.open', () => rt.openDialog('whats-shipped.panel'), { label: "Open the What's new panel", searchable: false });
    rt.actions.register('whats-shipped.read-all', () => setRead(rt, items().map((i) => i.id)), { label: "Mark everything in What's new read" });
    rt.actions.register('whats-shipped.check', () => void refresh(true), { label: "Check what's new now" });
    if (!runtime) for (const k of [KEYS.show, KEYS.ticker, KEYS.read]) rt.settings.onChange(k, () => { if (runtime) paint(runtime); });
    start(rt);
  },
  dialogs: {
    'whats-shipped.panel': { title: "What's new", icon: 'sparkles', render: () => <Panel /> },
  },
  settingsTabs: [{ id: 'whats-shipped', label: "What's new", icon: 'sparkles', parent: 'plugins', order: 48, description: 'The banner ticker of features merged to main.' }],
  settings: [{
    id: 'whats-shipped.look', label: 'On the banner', icon: 'eye', tab: 'whats-shipped', order: 5,
    settings: [
      { key: KEYS.show, label: "Show What's new on the banner", kind: 'toggle', default: true, scope: 'device' },
      { key: KEYS.ticker, label: 'Step through the unread titles', kind: 'toggle', default: true, scope: 'device', description: 'Off: the banner shows only the newest one.' },
    ],
  }],
  settingsPanels: [
    { id: 'whats-shipped.filter', tab: 'whats-shipped', title: 'What it shows', icon: 'search', order: 10, render: () => <FilterPanel /> },
    { id: 'whats-shipped.lifecycle', tab: 'whats-shipped', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
