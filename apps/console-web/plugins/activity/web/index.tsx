/**
 * Activity console plugin (ai.amberx.axf.console.activity).
 *
 * A banner at the top of every view while anything is in progress: GitHub Actions runs, the console's own update,
 * AI assistant replies, VPS Auto fix jobs, Claude Code sessions on the VPS and anything else that reports itself
 * (activity@1, server/feed.py). Tap it to expand every item; tap an item for all its details (what it's doing, steps,
 * time, who started it, the link). When everything finishes it says so for 20 s, counted from the moment the console
 * is visible and focused (a build that ends while you're elsewhere waits for you), then goes away.
 *
 * Polls GET /api/plugins/activity/items every 4 s while the page is visible (and on focus). Hiding it with ✕ lasts
 * until something new starts.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './activity.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.activity';
const FOLDER = 'activity';
const VERSION = '0.1.0';
const POLL_MS = 4_000;
const DONE_FLASH_MS = 20_000;
const ACTIVE = new Set(['queued', 'running', 'waiting']);

type State = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled' | 'stale';
interface Step { name: string; state: State }
interface Item { id: string; source: string; kind: string; title: string; detail: string; state: State; progress?: number; startedAt: number; updatedAt: number; finishedAt?: number; url?: string; by?: string; steps?: Step[]; origin?: string; reported?: boolean }
interface Feed { items: Item[]; active: number; errors: string[]; checkedAt: number; sources: Record<string, { label: string; on: boolean }> }
interface Job { name: string; state: State; startedAt?: number; finishedAt?: number; url?: string; steps: Step[] }
interface Detail { id: string; jobs?: Job[]; progress?: number | null }
interface Store { feed: Feed | null; error: string; hiddenFor: string; open: boolean }

let runtime: AxfRuntime | null = null;
let st: Store = { feed: null, error: '', hiddenFor: '', open: false };
const subs = new Set<() => void>();
const set = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useStore = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof (j as { detail?: unknown }).detail === 'string' ? (j as { detail: string }).detail : `HTTP ${r.status}`);
  return j as T;
}

let inflight = false;
export async function refresh(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try { set({ feed: await call<Feed>('items'), error: '' }); } catch (e) { set({ error: (e as Error).message }); } finally { inflight = false; }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void refresh();
  setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
  globalThis.addEventListener('focus', () => void refresh());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
}

/* ---------------- time ---------------- */

/**
 * The "All done" / "Finished, with N failed" line counts its 20 s only while the console is on screen: the timer for a
 * finished item starts the first time this tab is visible *and* focused after it finished, so a build that ends while
 * you're in another tab or app is still waiting for you when you come back (Brett, Oct 21 2026).
 */
const seenAt = new Map<string, number>();
const onScreen = () => document.visibilityState === 'visible' && document.hasFocus();
function markSeen(items: Item[], now: number) {
  if (!onScreen()) return;
  for (const i of items) if (!seenAt.has(i.id)) seenAt.set(i.id, now);
  for (const id of [...seenAt.keys()]) if (!items.some((i) => i.id === id)) seenAt.delete(id);
}
/** Re-render when the tab is shown, hidden, focused or blurred, so the timer starts the moment it becomes visible. */
function useOnScreen() {
  const [v, setV] = useState(onScreen);
  useEffect(() => {
    const upd = () => setV(onScreen());
    globalThis.addEventListener('focus', upd);
    globalThis.addEventListener('blur', upd);
    document.addEventListener('visibilitychange', upd);
    return () => { globalThis.removeEventListener('focus', upd); globalThis.removeEventListener('blur', upd); document.removeEventListener('visibilitychange', upd); };
  }, []);
  return v;
}

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, [on]);
  return now;
}
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const ago = (ms: number, now: number) => `${dur(now - ms).split(' ')[0]} ago`;

/* ---------------- pieces ---------------- */

const STATE_LABEL: Record<State, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', stale: 'No word' };
const STATE_ICON: Record<State, string> = { queued: 'clock', running: 'refresh', waiting: 'pause', done: 'check-circle', failed: 'x-circle', cancelled: 'minus', stale: 'alert' };
const SOURCE_ICON: Record<string, string> = { github: 'github', update: 'rocket', assistant: 'sparkles', 'claude-code': 'terminal', reports: 'list', 'axf.syscheck@1': 'shield' };

function StateIcon({ state, size = 16 }: { state: State; size?: number }) {
  return <span className={`axp-activity__state axp-activity__state--${state}`} title={STATE_LABEL[state]} aria-label={STATE_LABEL[state]}><Icon name={STATE_ICON[state]} size={size} /></span>;
}

function Progress({ value }: { value: number }) {
  return <div className="axp-activity__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}><span style={{ width: `${Math.round(value * 100)}%` }} /></div>;
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="axp-activity__steps">
      {steps.map((s, i) => <li key={`${i}-${s.name}`}><StateIcon state={s.state} size={14} /><span>{s.name}</span></li>)}
    </ol>
  );
}

function ItemDetail({ it, now }: { it: Item; now: number }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const gh = it.id.startsWith('gh:');
  useEffect(() => {
    if (!gh) return;
    let live = true;
    const load = () => call<Detail>(`detail?id=${encodeURIComponent(it.id)}`).then((x) => { if (live) { setD(x); setErr(''); } }, (e: Error) => live && setErr(e.message));
    void load();
    const t = ACTIVE.has(it.state) ? setInterval(load, 8_000) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [it.id, it.state, gh]);
  const end = it.finishedAt ?? now;
  return (
    <div className="axp-activity__detail">
      {it.detail && <p className="axp-activity__text">{it.detail}</p>}
      <dl className="axp-activity__facts">
        <dt>Status</dt><dd>{STATE_LABEL[it.state]}{it.progress != null ? ` · ${Math.round(it.progress * 100)}%` : ''}</dd>
        <dt>Started</dt><dd>{clock(it.startedAt)} · {ACTIVE.has(it.state) ? `${dur(now - it.startedAt)} so far` : `took ${dur(end - it.startedAt)}`}</dd>
        {it.finishedAt ? <><dt>Finished</dt><dd>{clock(it.finishedAt)} ({ago(it.finishedAt, now)})</dd></> : null}
        <dt>Last update</dt><dd>{ago(it.updatedAt, now)}</dd>
        {it.by ? <><dt>By</dt><dd>{it.by}</dd></> : null}
        <dt>From</dt><dd>{st.feed?.sources[it.source]?.label ?? it.source}</dd>
      </dl>
      {it.steps?.length ? <Steps steps={it.steps} /> : null}
      {gh && (d?.jobs?.length ? (
        <div className="axp-activity__jobs">
          {d.progress != null && <Progress value={d.progress} />}
          {d.jobs.map((j) => (
            <details key={j.name} open={ACTIVE.has(j.state) || j.state === 'failed'}>
              <summary><StateIcon state={j.state} size={14} /> <strong>{j.name}</strong>{j.startedAt ? <span className="fx-muted"> · {dur((j.finishedAt ?? now) - j.startedAt)}</span> : null}</summary>
              {j.steps.length ? <Steps steps={j.steps} /> : <p className="fx-small fx-muted">No steps yet.</p>}
            </details>
          ))}
        </div>
      ) : <p className="fx-small fx-muted">{err ? `Couldn't load the steps: ${err}` : 'Loading jobs and steps…'}</p>)}
      <div className="fx-row fx-row--wrap">
        {it.url && <a className="fx-btn fx-btn--neutral axp-activity__link" href={it.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> {gh ? 'Open on GitHub' : 'Open'}</a>}
        {it.reported && !ACTIVE.has(it.state)
          ? <Button tone="neutral" icon="trash" onClick={() => void call(`item?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' }).then(refresh)}>Clear</Button> : null}
      </div>
    </div>
  );
}

function Row({ it, now }: { it: Item; now: number }) {
  const [open, setOpen] = useState(false);
  const icon = SOURCE_ICON[it.source] ?? 'zap';
  const time = ACTIVE.has(it.state) ? dur(now - it.startedAt) : ago(it.finishedAt ?? it.updatedAt, now);
  const last = it.steps?.filter((s) => s.state === 'running').pop()?.name;
  return (
    <li className={`axp-activity__item axp-activity__item--${it.state}`}>
      <button type="button" className="axp-activity__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StateIcon state={it.state} />
        <Icon name={icon} size={14} />
        <span className="axp-activity__title">
          <span>{it.title}</span>
          {!open && (last || it.detail) && <span className="axp-activity__sub">{last ?? it.detail.split('\n')[0]}</span>}
        </span>
        <span className="axp-activity__time">{time}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {it.progress != null && ACTIVE.has(it.state) && <Progress value={it.progress} />}
      {open && <ItemDetail it={it} now={now} />}
    </li>
  );
}

/* ---------------- the banner ---------------- */

function ActivityBanner() {
  const s = useStore();
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { start(); }, []);
  const items = s.feed?.items ?? [];
  const active = items.filter((i) => ACTIVE.has(i.state));
  const finished = items.filter((i) => !ACTIVE.has(i.state));
  const visible = useOnScreen();
  const waiting = finished.some((i) => !seenAt.has(i.id) || Date.now() - (seenAt.get(i.id) ?? 0) < DONE_FLASH_MS);
  const now = useNow(active.length > 0 || s.open || (visible && waiting));
  // Everything the feed still lists as finished (it keeps them 10 min) counts until you've had it on screen for 20 s.
  if (visible) markSeen(finished, now);
  const justDone = finished.filter((i) => { const t = seenAt.get(i.id); return t === undefined || now - t < DONE_FLASH_MS; });
  const key = active.map((i) => i.id).join(',');
  if (!active.length && !justDone.length && !s.open) return null;
  if (key && key === s.hiddenFor) return null;
  if (!active.length && !justDone.length && s.open && !finished.length) return null;

  const failed = (active.length ? [] : justDone).some((i) => i.state === 'failed' || i.state === 'stale');
  const first = active[0];
  const summary = active.length
    ? `${active.length} in progress`
    : failed ? `Finished, with ${justDone.filter((i) => i.state === 'failed' || i.state === 'stale').length} failed` : 'All done';
  const oldest = active.reduce((m, i) => Math.min(m, i.startedAt), Infinity);

  return (
    <div className={`axp-activity${failed ? ' axp-activity--failed' : ''}${active.length ? '' : ' axp-activity--idle'}`} role="status" aria-live="polite">
      <div className="axp-activity__row">
        <span className={active.length ? 'axp-activity__spin' : ''}><Icon name={active.length ? 'refresh' : failed ? 'alert' : 'check-circle'} size={18} /></span>
        <button type="button" className="axp-activity__summary" aria-expanded={s.open} onClick={() => set({ open: !s.open })}>
          <span className="axp-activity__top">
            <strong>{summary}</strong>
            {active.length > 0 && Number.isFinite(oldest) && <span className="axp-activity__time">{dur(now - oldest)}</span>}
            <Icon name={s.open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          {first && <span className="axp-activity__lead">{first.title}{active.length > 1 ? ` +${active.length - 1} more` : ''}</span>}
        </button>
        <button type="button" className="fx-iconbtn" aria-label="Hide until something new starts" title="Hide until something new starts" onClick={() => { if (!key) for (const i of finished) seenAt.set(i.id, 0); set({ hiddenFor: key || 'idle', open: false }); }}><Icon name="x" size={16} /></button>
      </div>
      {s.open && (
        <div className="axp-activity__body">
          {active.length ? <ul className="axp-activity__list">{active.map((i) => <Row key={i.id} it={i} now={now} />)}</ul>
            : <p className="fx-small fx-muted" style={{ margin: 0 }}>Nothing is running right now.</p>}
          {finished.length > 0 && (
            <>
              <button type="button" className="axp-activity__more" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                Just finished ({finished.length}) <Icon name={showDone ? 'chevron-up' : 'chevron-down'} size={14} />
              </button>
              {showDone && <ul className="axp-activity__list">{finished.map((i) => <Row key={i.id} it={i} now={now} />)}</ul>}
            </>
          )}
          {s.feed?.errors.length ? <p className="fx-small fx-muted axp-activity__errors">Couldn't check: {s.feed.errors.join(' · ')}</p> : null}
        </div>
      )}
    </div>
  );
}

/* ---------------- settings ---------------- */

interface Config { sources: Record<string, boolean>; repos: string[]; lingerS: number; reportTtlS: number; sourceLabels: Record<string, string> }

function SettingsPanel() {
  const s = useStore();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [repos, setRepos] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { start(); void call<Config>('config').then((c) => { setCfg(c); setRepos(c.repos.join('\n')); }, (e: Error) => setMsg(e.message)); }, []);
  const save = async (patch: Partial<Config>) => {
    try { const c = await call<Config>('config', { method: 'PUT', body: JSON.stringify(patch) }); setCfg((p) => ({ ...(p as Config), ...c })); setMsg('Saved.'); void refresh(); } catch (e) { setMsg((e as Error).message); }
  };
  const script = '/opt/axf/apps/console-web/plugins/activity/activity.mjs';
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>A banner at the top of the console whenever something is in progress. Tap it to see everything; tap an item for its details.</p>
      <p className="fx-small" style={{ margin: 0 }}><strong>{s.feed ? `${s.feed.active} in progress now.` : s.error ? `Couldn't check: ${s.error}` : 'Checking…'}</strong></p>
      {cfg && (
        <>
          <h4 style={{ margin: 0 }}>Show</h4>
          {Object.entries(cfg.sourceLabels).map(([k, label]) => (
            <label key={k} className="fx-row"><input type="checkbox" checked={cfg.sources[k] ?? true} onChange={(e) => void save({ sources: { ...cfg.sources, [k]: e.target.checked } })} /> {label}</label>
          ))}
          <label className="fx-stack">
            <span><strong>GitHub repos to watch</strong> <span className="fx-small fx-muted">(one owner/name per line)</span></span>
            <textarea className="fx-input" rows={3} value={repos} onChange={(e) => setRepos(e.target.value)} />
          </label>
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="save" onClick={() => void save({ repos: repos.split(/\s+/).filter(Boolean) })}>Save repos</Button>
            <Button tone="neutral" icon="refresh" onClick={() => void refresh()}>Check now</Button>
            {msg && <Chip>{msg}</Chip>}
          </div>
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Finished items stay under "Just finished" for {Math.round(cfg.lingerS / 60)} min. A reported item with no news for {Math.round(cfg.reportTtlS / 60)} min is marked "No word".</p>
        </>
      )}
      <h4 style={{ margin: 0 }}>Claude Code on the VPS</h4>
      <p className="fx-small" style={{ margin: 0 }}>Run this once on the VPS so every Claude Code session shows here while it works (what you asked, each step, when it's waiting for you):</p>
      <pre className="axp-activity__cmd">node {script} hooks install</pre>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Remove with <code>hooks remove</code>. Scripts can report too: <code>node {script} start my-job "Backing up" --steps "copy,upload"</code>, then <code>update my-job --step "upload=running"</code> and <code>done my-job</code>.</p>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Plugins show their work here by giving their capability service an <code>activity()</code> method (the systems check does, for VPS Auto fix).</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Activity',
  version: VERSION,
  appMenu,
  register(rt) {
    runtime = rt;
    start();
    rt.actions.register('activity.open', () => { set({ open: true, hiddenFor: '' }); void refresh(); }, { label: 'Show what\'s in progress' });
    rt.actions.register('activity.check', () => void refresh(), { label: 'Check activity now' });
  },
  banners: [{ id: 'activity', order: 4, render: () => <ActivityBanner /> }],
  settingsTabs: [{ id: 'activity', label: 'Activity', icon: 'refresh', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'activity.settings', tab: 'activity', title: 'Activity banner', icon: 'refresh', order: 5, render: () => <SettingsPanel /> },
    { id: 'activity.lifecycle', tab: 'activity', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
void runtime;
