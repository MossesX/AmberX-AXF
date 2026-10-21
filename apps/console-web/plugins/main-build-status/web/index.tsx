/**
 * Main build status console plugin (ai.amberx.axf.console.main-build-status).
 *
 * A banner widget with the last CI result of a branch (default: MossesX/AmberX-AXF, main, android.yml = "Android
 * framework + console"): a green / red / accent dot and short text like "main ✓ 2m ago", "main ✗ 5m ago",
 * "main ⟳ 3m" or "main ?". It is a framework `status` widget (existing widget kind, no new asset type): the plugin
 * registers its own `status/main-build` asset, repainted on every answer, and attaches it to the banner's right side
 * next to the clock. The console detaches it when the plugin is switched off (origin = the plugin id, as every
 * plugin's banner items). Tap → a small dialog with the run title, commit, time and failed jobs, and a link to the run.
 *
 * Runtime counters for other widgets: `build.main.known` (1 once an answer came), `build.main.running`,
 * `build.main.failing`.
 *
 * The browser only ever talks to the console (`GET /api/plugins/main-build-status/status`, console token); the server
 * reads GitHub with its own token (lib-github: api.github.com only, no redirects). Polls every 30 s while the page is
 * visible, and again on focus.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './main-build-status.css';
import { ID, TONE, WORD, bannerText, paintBuild, shortAgo, type BuildItem } from './core';

const FOLDER = 'main-build-status';
const POLL_MS = 30_000;
const SHOW_KEY = 'main-build-status.show';
const api = pluginApi(FOLDER, 'Main build status');

interface StatusReply { checkedAt: number; cacheS: number; items: BuildItem[] }
interface Watch { repo: string; branch: string; workflow: string }
interface ConfigReply { watch: Watch[]; defaults: Watch[]; cacheS: number }

/* ---------------- store ---------------- */

interface State { reply: StatusReply | null; error: string; loading: boolean }
let st: State = { reply: null, error: '', loading: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useStatus = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

let runtime: AxfRuntime | null = null;
let watching = false;
const primary = (): BuildItem | null => st.reply?.items[0] ?? null;
const shown = (rt: AxfRuntime) => rt.settings.get(SHOW_KEY) !== false;

/** Repaint the widget and the counters, and attach it (or take it off when hidden). */
function paint(rt: AxfRuntime) { paintBuild(rt, primary(), st.error, shown(rt)); }

let inflight = false;
export async function checkNow(refresh = false): Promise<void> {
  if (inflight) return;
  inflight = true;
  set({ loading: true });
  try {
    const reply = await api.call<StatusReply>(`status${refresh ? '?refresh=true' : ''}`);
    set({ reply, error: '', loading: false });
  } catch (e) {
    set({ error: (e as Error).message, loading: false });
  } finally {
    inflight = false;
    if (runtime && stillOn(runtime)) paint(runtime); // switched off meanwhile: the console took it off, leave it off
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Still on? The console detaches a switched-off plugin's banner items, so a missing item (while shown) means off. */
const stillOn = (rt: AxfRuntime) => !shown(rt) || rt.hostAttachments('banner').some((a) => a.origin === ID);
const onFocus = () => { if (runtime && stillOn(runtime)) void checkNow(); };
const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };

function start(rt: AxfRuntime) {
  runtime = rt;
  paint(rt);
  if (timer) return;
  void checkNow();
  timer = setInterval(() => {
    if (!stillOn(rt)) { stop(); return; }
    if (document.visibilityState === 'visible') void checkNow(); else paint(rt);
  }, POLL_MS);
  globalThis.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  globalThis.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onVisible);
}

/* ---------------- the dialog (tap on the widget) ---------------- */

const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString() : ''; };

function RunCard({ it }: { it: BuildItem }) {
  return (
    <div className="axp-main-build-status__run">
      <div className="fx-row fx-row--wrap">
        <span className="axp-main-build-status__dot" data-tone={TONE[it.state]} aria-hidden="true" />
        <strong>{it.repo}</strong>
        <span className="fx-mono fx-small">{it.branch}</span>
        <Chip tone={it.state === 'success' ? 'success' : it.state === 'failure' ? 'danger' : it.state === 'running' ? 'accent' : undefined}>{WORD[it.state]}</Chip>
      </div>
      {it.title && <p className="axp-main-build-status__title">{it.title}</p>}
      <p className="fx-small fx-muted axp-main-build-status__meta">
        {it.name || it.workflow}{it.runNumber ? ` #${it.runNumber}` : ''}
        {it.sha ? <> · <span className="fx-mono">{it.sha.slice(0, 7)}</span></> : null}
        {it.event ? ` · ${it.event}` : ''}
        {it.state === 'running' && it.startedAt ? ` · started ${when(it.startedAt)} (${shortAgo(it.startedAt)})` : it.updatedAt ? ` · ${when(it.updatedAt)} (${shortAgo(it.updatedAt)} ago)` : ''}
      </p>
      {it.previous && <p className="fx-small fx-muted axp-main-build-status__meta">Before this: {it.previous.state === 'success' ? 'passed' : 'failed'} {it.previous.updatedAt ? `${shortAgo(it.previous.updatedAt)} ago` : ''}</p>}
      {it.failedJobs.length > 0 && (
        <div>
          <p className="fx-small axp-main-build-status__meta"><strong>Failed jobs</strong></p>
          <ul className="axp-main-build-status__jobs">
            {it.failedJobs.map((j) => (
              <li key={j.name + j.url}>{j.url ? <a href={j.url} target="_blank" rel="noopener noreferrer">{j.name} <Icon name="external" size={12} /></a> : j.name}</li>
            ))}
          </ul>
        </div>
      )}
      {it.error && <p className="fx-small fx-muted axp-main-build-status__meta"><Icon name="info" size={12} /> {it.error}</p>}
      {it.url && <a className="fx-btn fx-btn--neutral axp-main-build-status__go" href={it.url} target="_blank" rel="noopener noreferrer"><Icon name="github" size={14} /> Open on GitHub</a>}
    </div>
  );
}

function RunDialog() {
  const s = useStatus();
  useEffect(() => { void checkNow(); }, []);
  const items = s.reply?.items ?? [];
  return (
    <div className="fx-stack axp-main-build-status">
      {s.error && <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {s.error}</p>}
      {!items.length && !s.error && <p className="fx-muted">{s.loading ? 'Checking…' : 'Nothing watched yet.'}</p>}
      {items.map((it) => <RunCard key={`${it.repo}|${it.branch}|${it.workflow}`} it={it} />)}
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={s.loading} onClick={() => void checkNow(true)}>{s.loading ? 'Checking…' : 'Check now'}</Button>
        <Button icon="settings" onClick={() => { runtime?.closeDialog(); runtime?.dispatch('settings.open:main-build-status'); }}>Settings</Button>
      </div>
      {s.reply && <p className="fx-small fx-muted" style={{ margin: 0 }}>Checked {shortAgo(new Date(s.reply.checkedAt).toISOString())} ago · every {POLL_MS / 1000} s while the console is open</p>}
    </div>
  );
}

/* ---------------- settings ---------------- */

function WatchPanel() {
  const [cfg, setCfg] = useState<ConfigReply | null>(null);
  const [rows, setRows] = useState<Watch[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.call<ConfigReply>('config').then((c) => { setCfg(c); setRows(c.watch.map((w) => ({ ...w }))); }).catch((e: Error) => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  const edit = (i: number, k: keyof Watch, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async (body: unknown) => {
    setBusy(true); setMsg('');
    try {
      const c = await api.put<ConfigReply>('config', body);
      setCfg(c); setRows(c.watch.map((w) => ({ ...w }))); setMsg('Saved.');
      await checkNow(true);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (!cfg) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>The banner shows the first one; the dialog lists them all. Workflow = its file name (android.yml), its id, or its name as GitHub shows it.</p>
      {rows.map((r, i) => (
        <div key={i} className="axp-main-build-status__watch">
          <TextField label="Repository" value={r.repo} mono placeholder="owner/name" onChange={(v) => edit(i, 'repo', v)} />
          <TextField label="Branch" value={r.branch} mono placeholder="main" onChange={(v) => edit(i, 'branch', v)} />
          <TextField label="Workflow" value={r.workflow} mono placeholder="android.yml" onChange={(v) => edit(i, 'workflow', v)} />
          {rows.length > 1 && <Button icon="x" disabled={busy} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>}
        </div>
      ))}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="check" disabled={busy} onClick={() => void save({ watch: rows })}>Save</Button>
        {rows.length < 10 && <Button icon="plus" disabled={busy} onClick={() => setRows([...rows, { repo: '', branch: 'main', workflow: '' }])}>Add another</Button>}
        <Button icon="refresh" disabled={busy} onClick={() => void save({ reset: true })}>Back to the default</Button>
      </div>
      {msg && <p className="fx-small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}

function StatusPanel() {
  const s = useStatus();
  const it = s.reply?.items[0] ?? null;
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>A small dot on the banner with the last CI result: green passed, red failed, accent while it runs, grey when unknown. Tap it for the run.</p>
      <div className="fx-row fx-row--wrap">
        <span className="axp-main-build-status__dot" data-tone={TONE[it?.state ?? 'unknown']} aria-hidden="true" />
        <span>{bannerText(it)}</span>
        <Button icon="refresh" disabled={s.loading} onClick={() => void checkNow(true)}>Check now</Button>
        <Button icon="external" onClick={() => runtime?.dispatch('main-build-status.open')}>Show the run</Button>
      </div>
      {(s.error || it?.error) && <p className="fx-small fx-muted" style={{ margin: 0 }}>{s.error || it?.error}</p>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Main build status',
  version: '0.1.0',
  provides: ['banner.status.main-build'],
  register(rt) {
    rt.actions.register('main-build-status.open', () => rt.openDialog('main-build-status.run'), { label: 'Show the main build' });
    rt.actions.register('main-build-status.github', () => { const u = primary()?.url; if (u) globalThis.open(u, '_blank', 'noopener'); }, { label: 'Open the main build on GitHub' });
    rt.actions.register('main-build-status.check', () => void checkNow(true), { label: 'Check the main build now' });
    if (!watching) { watching = true; rt.settings.onChange(SHOW_KEY, () => { if (runtime) paint(runtime); }); }
    start(rt);
  },
  dialogs: {
    'main-build-status.run': { title: 'Main build', icon: 'play', render: () => <RunDialog /> },
  },
  settingsTabs: [{ id: 'main-build-status', label: 'Main build status', icon: 'play', parent: 'plugins', order: 47, description: 'The CI result dot on the banner.' }],
  settings: [{
    id: 'main-build-status.look', label: 'On the banner', icon: 'eye', tab: 'main-build-status', order: 5,
    settings: [{ key: SHOW_KEY, label: 'Show the build status on the banner', kind: 'toggle', default: true, scope: 'device' }],
  }],
  settingsPanels: [
    { id: 'main-build-status.status', tab: 'main-build-status', title: 'Now', icon: 'play', order: 10, render: () => <StatusPanel /> },
    { id: 'main-build-status.watch', tab: 'main-build-status', title: 'What it watches', icon: 'branch', order: 20, render: () => <WatchPanel /> },
    { id: 'main-build-status.lifecycle', tab: 'main-build-status', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
