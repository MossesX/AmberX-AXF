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
 *
 * Oct 24 2026 (Brett): every kind of work shows with what it is (building, editing, deleting, pushing, pulling,
 * merging, thinking); ✕ on a finished item moves it to the Codebase changes banner (or deletes it); when something
 * finishes it can push to the phone through axHub (server, server/complete.py), chime, pop up, open the banner or the
 * result (this browser), and leave by itself N minutes later. All settings sit in one collapsible card.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Container, Icon, Section, SelectField, Slot, Switch, TextField, BannerIcon, BANNER_PREFS_KEY } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './activity.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.activity';
const FOLDER = 'activity';
const VERSION = '0.4.0';
const POLL_MS = 4_000;
const DONE_FLASH_MS = 20_000;
const ACTIVE = new Set(['queued', 'running', 'waiting']);

type State = 'queued' | 'running' | 'waiting' | 'held' | 'done' | 'failed' | 'cancelled' | 'stale';
/** A button an item carries (the feed checked it): the first one on a held item is its Continue. */
interface ItemAction { label: string; action: string; icon?: string }
interface Step { name: string; state: State }
/** `change` = the session's Codebase changes entry, folded into its row by the feed (one row per session). */
interface Item { id: string; source: string; kind: string; title: string; detail: string; state: State; progress?: number; startedAt: number; updatedAt: number; finishedAt?: number; url?: string; by?: string; steps?: Step[]; origin?: string; reported?: boolean; actions?: ItemAction[]; pending?: string; change?: { id: string; title: string; state: State } }
/** What the browser does when something finishes (stored with the feed's settings, same on every device). */
interface OnDone { sound: 'off' | 'all' | 'failed'; toast: boolean; expandOnDone: boolean; openResult: boolean; onClose: 'changes' | 'delete' }
interface Feed { items: Item[]; active: number; held?: number; errors: string[]; checkedAt: number; sources: Record<string, { label: string; on: boolean }>; complete?: OnDone }
interface Job { name: string; state: State; startedAt?: number; finishedAt?: number; url?: string; steps: Step[] }
interface Detail { id: string; jobs?: Job[]; progress?: number | null }
/**
 * `open` = the banner is expanded. It launches folded to its one counts line (Brett, Oct 31 2026: the open list took
 * almost half the phone screen); only this banner's own "When it appears: Open" choice launches it open. "_" folds it
 * again. `pinned` = shown on request (action) even when idle.
 */
interface Store { feed: Feed | null; error: string; hiddenFor: string; open: boolean; pinned: boolean }

let runtime: AxfRuntime | null = null;
let st: Store = { feed: null, error: '', hiddenFor: '', open: false, pinned: false };
/** This banner's own saved launch choice (not the all-banners default): 'expanded' opens it at launch. */
export const launchesOpen = (prefs: unknown) => {
  const own = prefs && typeof prefs === 'object' ? (prefs as Record<string, { launch?: unknown } | undefined>).activity : undefined;
  return own?.launch === 'expanded';
};
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
  try { const feed = await call<Feed>('items'); finished(feed); set({ feed, error: '' }); } catch (e) { set({ error: (e as Error).message }); } finally { inflight = false; }
}

/* ---------------- when something finishes (Brett, Oct 24 2026) ---------------- */

/** Last state seen per id in this tab: an item seen active and now finished is "just completed". */
const lastState = new Map<string, State>();
let primed = false;
function finished(feed: Feed) {
  const now: Item[] = [];
  for (const it of feed.items) {
    const was = lastState.get(it.id);
    if (primed && was && ACTIVE.has(was) && !ACTIVE.has(it.state)) now.push(it);
    lastState.set(it.id, it.state);
  }
  primed = true;
  const c = feed.complete;
  if (!now.length || !c) return;
  const failed = now.filter((i) => i.state === 'failed' || i.state === 'stale');
  if (c.sound === 'all' || (c.sound === 'failed' && failed.length)) chime(failed.length > 0);
  if (c.expandOnDone) set({ open: true, hiddenFor: '' });
  if (c.toast && runtime) {
    for (const i of now.slice(0, 3)) runtime.toast(i.detail.split('\n')[0] || STATE_LABEL[i.state], i.state === 'done' ? 'success' : i.state === 'cancelled' ? 'info' : 'danger', `${STATE_LABEL[i.state]}: ${i.title}`);
    if (now.length > 3) runtime.toast(`${now.length - 3} more finished`, 'info', 'Activity');
  }
  if (c.openResult) for (const i of now) if (i.url) globalThis.open(i.url, '_blank', 'noopener,noreferrer');
}

/** A short chime: two rising notes when done, one low note when something failed (Web Audio; silent when blocked). */
export function chime(failed: boolean) {
  try {
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = failed ? [220, 196] : [660, 880];
    notes.forEach((f, n) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      const t = ctx.currentTime + n * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.32);
    });
    setTimeout(() => void ctx.close(), 1_000);
  } catch { /* no sound here */ }
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

const STATE_LABEL: Record<State, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting', held: 'On hold', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', stale: 'No word' };
const STATE_ICON: Record<State, string> = { queued: 'clock', running: 'refresh', waiting: 'pause', held: 'lock', done: 'check-circle', failed: 'x-circle', cancelled: 'minus', stale: 'alert' };
const SOURCE_ICON: Record<string, string> = { github: 'github', update: 'rocket', assistant: 'sparkles', 'claude-code': 'terminal', reports: 'list', 'axf.syscheck@1': 'shield', changes: 'branch', git: 'branch' };
/** What kind of work an item is: building, editing, deleting, pushing, pulling, merging, thinking … (open set: anything else shows its source's icon). */
export const KIND_LABEL: Record<string, string> = { build: 'Building', edit: 'Editing', delete: 'Deleting', push: 'Pushing', pull: 'Pulling', merge: 'Merging', thinking: 'Thinking', fix: 'Fixing', ci: 'CI', deploy: 'Deploying', ai: 'Thinking', claude: 'Working' };
const KIND_ICON: Record<string, string> = { build: 'hammer', edit: 'edit', delete: 'trash', push: 'upload', pull: 'download', merge: 'branch', thinking: 'sparkles', fix: 'zap', ci: 'github', deploy: 'rocket', ai: 'sparkles', claude: 'terminal' };

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
        {it.change ? <><dt>Change log</dt><dd>{it.change.title} · {STATE_LABEL[it.change.state] ?? it.change.state}</dd></> : null}
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
        {!ACTIVE.has(it.state) && <CloseButton it={it} label />}
      </div>
    </div>
  );
}

/** Stuck = "No word" (the source went quiet), or still active 30 min after it started (Brett, Oct 22 2026). */
const STUCK_MS = 30 * 60_000;
export const isStuck = (it: Pick<Item, 'state' | 'startedAt'>, now: number) => it.state === 'stale' || (ACTIVE.has(it.state) && now - it.startedAt >= STUCK_MS);

/** Takes a stuck item off the banner on every device (the feed deletes a report, or remembers it as dismissed). */
function Trash({ it }: { it: Item }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="fx-iconbtn axp-activity__trash" disabled={busy} aria-label={`Remove "${it.title}"`} title="Stuck: remove it from the banners on every device"
      onClick={() => { setBusy(true); void call(`item?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' }).then(refresh, () => setBusy(false)); }}>
      <Icon name="trash" size={14} />
    </button>
  );
}

/**
 * ✕ on a finished item: closes it on every device and moves it to the Codebase changes banner, or deletes it,
 * per Settings → Plugins → Activity → "Closing an item" (Brett, Oct 24 2026).
 */
function CloseButton({ it, label }: { it: Item; label?: boolean }) {
  const [busy, setBusy] = useState(false);
  const toChanges = (st.feed?.complete?.onClose ?? 'changes') === 'changes' && it.source !== 'changes';
  const title = toChanges ? 'Close: move it to the Codebase changes banner' : it.source === 'changes' ? 'Close here (it stays in Codebase changes)' : 'Close: delete it';
  const go = () => {
    setBusy(true);
    void call<{ movedTo?: string | null; note?: string }>('close', { method: 'POST', body: JSON.stringify({ id: it.id }) }).then((r) => {
      if (r.movedTo) runtime?.toast(`"${it.title}" is in the Codebase changes banner now.`, 'info', 'Moved');
      else if (r.note) runtime?.toast(r.note, 'info', 'Removed');
      void refresh();
    }, (e: Error) => { setBusy(false); runtime?.toast(e.message, 'danger', 'Couldn\'t close it'); });
  };
  return label
    ? <Button tone="neutral" icon={toChanges ? 'branch' : 'x'} disabled={busy} onClick={go}>{toChanges ? 'Close and move to Changes' : 'Close'}</Button>
    : <button type="button" className="fx-iconbtn" disabled={busy} aria-label={`Close "${it.title}"`} title={title} onClick={go}><Icon name="x" size={14} /></button>;
}

/**
 * An item's buttons. On a held item the first one is Continue: the feed marks it continued (every device) and hands
 * back its action, which runs here (e.g. Start build now in the Build manager). The others just run their action.
 */
function ItemActions({ it }: { it: Item }) {
  const [busy, setBusy] = useState(false);
  const acts = it.actions ?? [];
  if (!acts.length) return null;
  const run = (spec: string | null | undefined) => { if (spec) runtime?.dispatch(spec); };
  const go = (a: ItemAction, i: number) => {
    if (it.state !== 'held' || i > 0) { run(a.action); return; }
    setBusy(true);
    void call<{ action?: string | null }>('continue', { method: 'POST', body: JSON.stringify({ id: it.id }) }).then((r) => {
      run(r.action ?? a.action);
      runtime?.toast(`"${it.title}" is off hold.`, 'info', 'Continued');
      void refresh();
    }, (e: Error) => { setBusy(false); runtime?.toast(e.message, 'danger', 'Couldn\'t continue it'); });
  };
  return (
    <div className="axp-activity__actions">
      {acts.map((a, i) => (
        <Button key={a.action} size="sm" tone={i === 0 && it.state === 'held' ? 'primary' : 'neutral'} icon={a.icon} disabled={busy} onClick={() => go(a, i)}>{a.label}</Button>
      ))}
    </div>
  );
}

function Row({ it, now }: { it: Item; now: number }) {
  const [open, setOpen] = useState(false);
  const icon = KIND_ICON[it.kind] ?? SOURCE_ICON[it.source] ?? 'zap';
  const kind = KIND_LABEL[it.kind];
  const stuck = isStuck(it, now);
  // a running timer on every active or stuck item: how long since it started (and, when stuck, how long it's been quiet)
  const time = ACTIVE.has(it.state) || it.state === 'stale'
    ? `${dur(now - it.startedAt)}${stuck ? ` · quiet ${dur(now - it.updatedAt)}` : ''}`
    : it.state === 'held' ? `on hold ${dur(now - it.startedAt)}` : ago(it.finishedAt ?? it.updatedAt, now);
  const last = it.steps?.filter((s) => s.state === 'running').pop()?.name;
  return (
    <li className={`axp-activity__item axp-activity__item--${it.state}`}>
      <div className="axp-activity__headrow">
      <button type="button" data-fx-row className="axp-activity__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StateIcon state={it.state} />
        <span title={kind ?? it.kind}><Icon name={icon} size={14} /></span>
        <span className="axp-activity__title">
          <span>{kind && ACTIVE.has(it.state) && !it.title.startsWith(kind) ? <span className="axp-activity__kind">{kind} · </span> : null}{it.title}</span>
          {!open && (last || it.detail) && <span className="axp-activity__sub">{last ?? it.detail.split('\n')[0]}</span>}
        </span>
        <span className={`axp-activity__time${stuck ? ' is-stuck' : ''}`}><Icon name={stuck ? 'alert' : 'clock'} size={12} />{time}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {stuck && <Trash it={it} />}
      {!ACTIVE.has(it.state) && it.state !== 'stale' && it.state !== 'held' && <CloseButton it={it} />}
      </div>
      {it.state === 'held' && <ItemActions it={it} />}
      {it.progress != null && ACTIVE.has(it.state) && <Progress value={it.progress} />}
      {open && <ItemDetail it={it} now={now} />}
    </li>
  );
}

/* ---------------- the banner ---------------- */

function ActivityBanner() {
  const s = useStore();
  const [showDone, setShowDone] = useState(false);
  // Folded at launch unless this banner's own Banner settings say "When it appears: Open".
  useEffect(() => { start(); if (runtime && launchesOpen(runtime.settings.get(BANNER_PREFS_KEY))) set({ open: true }); }, []);
  const items = s.feed?.items ?? [];
  const active = items.filter((i) => ACTIVE.has(i.state));
  const held = items.filter((i) => i.state === 'held');
  const finished = items.filter((i) => !ACTIVE.has(i.state) && i.state !== 'held');
  const visible = useOnScreen();
  const waiting = finished.some((i) => !seenAt.has(i.id) || Date.now() - (seenAt.get(i.id) ?? 0) < DONE_FLASH_MS);
  const now = useNow(active.length > 0 || items.some((i) => i.state === 'stale') || s.pinned || (visible && waiting));
  // Everything the feed still lists as finished (it keeps them 10 min) counts until you've had it on screen for 20 s.
  if (visible) markSeen(finished, now);
  const justDone = finished.filter((i) => { const t = seenAt.get(i.id); return t === undefined || now - t < DONE_FLASH_MS; });
  const key = active.map((i) => i.id).join(',');
  // held work keeps the banner up (it waits for you); ✕-hiding covers what's running and on hold together
  const hideKey = [key, ...held.map((i) => i.id)].filter(Boolean).join(',');
  if (!active.length && !held.length && !justDone.length && !s.pinned) return null;
  if (hideKey && hideKey === s.hiddenFor) return null;
  if (!active.length && !held.length && !justDone.length && s.pinned && !finished.length) return null;

  const failed = (active.length ? [] : justDone).some((i) => i.state === 'failed' || i.state === 'stale');
  const stuckN = items.filter((i) => isStuck(i, now)).length;
  const heldNote = held.length ? `${held.length} on hold` : '';
  const summary = active.length
    ? `${active.length} in progress${stuckN ? ` · ${stuckN} stuck` : ''}${heldNote ? ` · ${heldNote}` : ''}`
    : held.length && !justDone.length ? heldNote
    : failed ? `Finished, with ${justDone.filter((i) => i.state === 'failed' || i.state === 'stale').length} failed` : 'All done';
  const oldest = active.reduce((m, i) => Math.min(m, i.startedAt), Infinity);

  return (
    <div className={`axp-activity${failed ? ' axp-activity--failed' : ''}${active.length ? '' : ' axp-activity--idle'}`} role="status" aria-live="polite">
      <div className="axp-activity__row">
        <BannerIcon icon={failed ? 'alert' : 'check-circle'} working={active.length > 0} />
        <button type="button" data-fx-row className="axp-activity__summary" aria-expanded={s.open} onClick={() => set({ open: !s.open })}>
          <span className="axp-activity__top">
            <strong>{summary}</strong>
            {/* one-line extras from other plugins (agent-slots: "slots 4/6 · 2 queued") */}
            <Slot name="activity.summary" props={{ active: active.length }} />
            {active.length > 0 && Number.isFinite(oldest) && <span className="axp-activity__time">{dur(now - oldest)}</span>}
            <Icon name={s.open ? 'chevron-up' : 'chevron-down'} size={16} />
          </span>
          {/* one line, counts only (Brett, Oct 31 2026): what each item is shows when it's opened */}
        </button>
        {/* "_" minimizes (folds the banner to its one-line summary; tap the summary to expand it again). It never hides the banner (Brett, Oct 21 2026). */}
        {s.open && <button type="button" className="fx-iconbtn" aria-label="Minimize" title="Minimize to one line" onClick={() => set({ open: false })}><Icon name="minimize" size={16} /></button>}
      </div>
      {s.open && (
        <div className="axp-activity__body">
          {active.length ? <ul className="axp-activity__list">{active.map((i) => <Row key={i.id} it={i} now={now} />)}</ul>
            : <p className="fx-small fx-muted" style={{ margin: 0 }}>Nothing is running right now.</p>}
          {held.length > 0 && (
            <>
              <p className="fx-small fx-muted axp-activity__group">On hold ({held.length})</p>
              <ul className="axp-activity__list">{held.map((i) => <Row key={i.id} it={i} now={now} />)}</ul>
            </>
          )}
          {finished.length > 0 && (
            <>
              <button type="button" data-fx-row className="axp-activity__more" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
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

interface PushResult { at: number; title: string; hub: string | null; alert: string | null }
interface Config extends OnDone {
  sources: Record<string, boolean>; repos: string[]; lingerS: number; reportTtlS: number; childTtlS: number; sourceLabels: Record<string, string>;
  autoRemove: boolean; keepFailed: boolean; onAutoRemove: 'changes' | 'delete';
  push: 'off' | 'all' | 'done' | 'failed'; pushLevel: 'info' | 'warning' | 'error'; pushMinS: number;
  lastPush?: PushResult | null; hubInbox?: string | null; changesOn?: boolean;
}

const pushText = (p: PushResult) => `${clock(p.at)} · axHub: ${p.hub ?? '?'} · alert: ${p.alert ?? '?'}`;

/** Whole numbers only; empty while typing. */
function NumberField({ label, value, hint, onSave }: { label: string; value: number; hint?: string; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  const bad = v === '' || !Number.isFinite(n) || n < 0;
  return (
    <div className="fx-row fx-row--wrap" style={{ alignItems: 'flex-end' }}>
      <TextField label={label} value={v} onChange={(x) => setV(x.replace(/[^0-9]/g, ''))} hint={hint} error={v !== '' && bad ? 'A whole number' : undefined} />
      {!bad && n !== value && <Button tone="primary" icon="save" onClick={() => onSave(n)}>Save</Button>}
    </div>
  );
}

function SettingsPanel() {
  const s = useStore();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [repos, setRepos] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => call<Config>('config').then((c) => { setCfg(c); setRepos(c.repos.join('\n')); }, (e: Error) => setMsg(e.message));
  useEffect(() => { start(); void load(); }, []);
  const save = async (patch: Partial<Config>) => {
    try { const c = await call<Config>('config', { method: 'PUT', body: JSON.stringify(patch) }); setCfg((p) => ({ ...(p as Config), ...c })); setMsg('Saved.'); void refresh(); } catch (e) { setMsg((e as Error).message); }
  };
  const testPush = async () => {
    try { const r = await call<PushResult>('notify/test', { method: 'POST' }); setCfg((p) => (p ? { ...p, lastPush: r } : p)); setMsg('Test sent.'); } catch (e) { setMsg((e as Error).message); }
  };
  const script = '/opt/axf/apps/console-web/plugins/activity/activity.mjs';
  const status = s.feed ? `${s.feed.active} in progress now.` : s.error ? `Couldn't check: ${s.error}` : 'Checking…';
  // Every setting in one collapsible card (Brett, Oct 24 2026).
  return (
    <Container title="Activity banner settings" icon="sliders" collapsible className="axp-activity__settings"
      actions={<Chip>{status}</Chip>}>
      <div className="fx-stack">
        <p style={{ margin: 0 }}>A banner at the top of the console whenever something is built, edited, deleted, pushed, pulled, merged or thought about, queued or running. Tap it to see everything; tap an item for its details.</p>
        {cfg ? (
          <>
            <Section title="Show">
              <div className="fx-stack">
                {Object.entries(cfg.sourceLabels).map(([k, label]) => (
                  <Switch key={k} label={label} checked={cfg.sources[k] ?? true} onChange={(on) => void save({ sources: { ...cfg.sources, [k]: on } })} />
                ))}
                <TextField label="GitHub repos to watch" hint="One owner/name per line." rows={3} value={repos} onChange={setRepos} />
                <div className="fx-row fx-row--wrap">
                  <Button tone="primary" icon="save" onClick={() => void save({ repos: repos.split(/\s+/).filter(Boolean) })}>Save repos</Button>
                  <Button tone="neutral" icon="refresh" onClick={() => void refresh()}>Check now</Button>
                </div>
                <NumberField label="Mark a reported item “No word” after (minutes)" value={Math.round(cfg.reportTtlS / 60)} onSave={(n) => void save({ reportTtlS: Math.max(1, n) * 60 })} />
                <NumberField label="Drop a Claude Code command line with no word after (minutes)" value={Math.round(cfg.childTtlS / 60)} hint="A push, pull, merge, delete or build line whose tool never said it finished. Lines also go once their session stops." onSave={(n) => void save({ childTtlS: Math.max(1, n) * 60 })} />
              </div>
            </Section>

            <Section title="When something finishes">
              <div className="fx-stack">
                <SelectField label="Push a notification to the phone through axHub" value={cfg.push}
                  options={[{ value: 'off', label: 'Off' }, { value: 'all', label: 'Everything that finishes' }, { value: 'done', label: 'Only what finished well' }, { value: 'failed', label: 'Only failures' }]}
                  hint={cfg.hubInbox ? `Written to axHub's notifications inbox and raised as a console alert (Patches, ntfy and web push deliver it to the phone).` : 'axHub\'s shared folder isn\'t mounted here: only the console alert goes out.'}
                  onChange={(v) => void save({ push: v as Config['push'] })} />
                {cfg.push !== 'off' && (
                  <>
                    <SelectField label="Alert level for work that finished well" value={cfg.pushLevel}
                      options={[{ value: 'error', label: 'High (reaches the phone by default)' }, { value: 'warning', label: 'Normal' }, { value: 'info', label: 'Low (bell only by default)' }]}
                      hint="Failures are always high. Which levels reach the phone is set in Settings → Alerts."
                      onChange={(v) => void save({ pushLevel: v as Config['pushLevel'] })} />
                    <NumberField label="Only for work that ran at least (seconds)" value={cfg.pushMinS} hint="0 = everything." onSave={(n) => void save({ pushMinS: n })} />
                  </>
                )}
                <div className="fx-row fx-row--wrap">
                  <Button tone="neutral" icon="bell" onClick={() => void testPush()}>Send a test push</Button>
                  {cfg.lastPush && <span className="fx-small fx-muted">Last: {pushText(cfg.lastPush)}</span>}
                </div>
                <Switch label="Remove it from the banner by itself" checked={cfg.autoRemove} onChange={(on) => void save({ autoRemove: on })}
                  hint={cfg.autoRemove ? undefined : 'It stays until you close it (a day at most).'} />
                {cfg.autoRemove && (
                  <>
                    <NumberField label="Remove it this many minutes after it finished" value={Math.round(cfg.lingerS / 60)} onSave={(n) => void save({ lingerS: n * 60 })} />
                    <Switch label="Keep failures until I close them" checked={cfg.keepFailed} onChange={(on) => void save({ keepFailed: on })} />
                    <SelectField label="When it removes itself" value={cfg.onAutoRemove}
                      options={[{ value: 'delete', label: 'Delete it' }, { value: 'changes', label: 'Move it to the Codebase changes banner' }]}
                      onChange={(v) => void save({ onAutoRemove: v as Config['onAutoRemove'] })} />
                  </>
                )}
                <SelectField label="Play a sound" value={cfg.sound}
                  options={[{ value: 'off', label: 'Off' }, { value: 'all', label: 'When anything finishes' }, { value: 'failed', label: 'Only when something fails' }]}
                  onChange={(v) => void save({ sound: v as Config['sound'] })} />
                {cfg.sound !== 'off' && <div><Button tone="neutral" icon="play" onClick={() => chime(false)}>Hear it</Button></div>}
                <Switch label="Show a pop-up message" checked={cfg.toast} onChange={(on) => void save({ toast: on })} />
                <Switch label="Open the banner" hint="Expands it (even when minimized or hidden) so you see what finished." checked={cfg.expandOnDone} onChange={(on) => void save({ expandOnDone: on })} />
                <Switch label="Open the result" hint="Opens its link (a GitHub run, a pull request …) in a new tab. Your browser may ask to allow pop-ups." checked={cfg.openResult} onChange={(on) => void save({ openResult: on })} />
              </div>
            </Section>

            <Section title="Closing an item">
              <SelectField label="When I close a finished item (✕)" value={cfg.onClose}
                options={[{ value: 'changes', label: 'Move it to the Codebase changes banner' }, { value: 'delete', label: 'Delete it' }]}
                hint={cfg.changesOn === false ? 'The Codebase changes plugin is off, so closed items are deleted for now.' : 'Items that came from the Codebase changes log stay there either way.'}
                onChange={(v) => void save({ onClose: v as Config['onClose'] })} />
            </Section>
            {msg && <div><Chip>{msg}</Chip></div>}
          </>
        ) : <p className="fx-small fx-muted">{msg || 'Loading…'}</p>}

        <Section title="Claude Code on the VPS">
          <div className="fx-stack">
            <p className="fx-small" style={{ margin: 0 }}>Run this once on the VPS so every Claude Code session shows here while it works: thinking, editing, building, deleting, pushing, pulling and merging (each push, pull, merge, delete or build gets its own line), and when it's waiting for you:</p>
            <pre className="axp-activity__cmd">node {script} hooks install</pre>
            <p className="fx-small fx-muted" style={{ margin: 0 }}>Already installed? Run it again to add the new hook. Remove with <code>hooks remove</code>. Scripts can report too: <code>node {script} start my-job "Backing up" --steps "copy,upload"</code>, then <code>update my-job --step "upload=running"</code> and <code>done my-job</code>.</p>
            <p className="fx-small fx-muted" style={{ margin: 0 }}>Plugins show their work here by giving their capability service an <code>activity()</code> method (the systems check and the Codebase changes log do; the push banner reports its pushes, pulls and merges).</p>
          </div>
        </Section>
      </div>
    </Container>
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
    rt.actions.register('activity.open', () => { set({ open: true, pinned: true, hiddenFor: '' }); void refresh(); }, { label: 'Show what\'s in progress' });
    rt.actions.register('activity.check', () => void refresh(), { label: 'Check activity now' });
  },
  banners: [{ id: 'activity', label: 'Activity', icon: 'refresh', settingsTab: 'activity', order: 4, render: () => <ActivityBanner /> }],
  settingsTabs: [{ id: 'activity', label: 'Activity', icon: 'refresh', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'activity.settings', tab: 'activity', title: 'Activity banner', icon: 'refresh', order: 5, render: () => <SettingsPanel /> },
    { id: 'activity.lifecycle', tab: 'activity', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
void runtime;
