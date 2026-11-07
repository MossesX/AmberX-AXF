/**
 * Follow Amber console plugin (ai.amberx.axf.console.follow-amber).
 *
 * One switch (Brett, Nov 3 2026). On:
 *   - whatever Amber talks about opens on his screen: a Claude session calls `console_show` (MCP, REST or CLI), the
 *     server opens it through Console commands (navigate only) and sends this client a `show` frame, and the client
 *     highlights it (the search flash: a CSS selector or exact visible text) and shows what Amber said as a toast;
 *   - every axHub held / confirm call for Brett pops up here as the `follow-amber.approval` dialog: title + plain
 *     description, the exact call folded away, the countdown on a veto call, big Approve (green) and Deny (red) that act
 *     on one tap, a queue when several wait. The feed is read with his own hub session (lib-approvals), every few
 *     seconds and at once when the server says one is waiting (`approval` frame). Decisions go through the app's host
 *     (the console's relay with this browser's hub session, AmberX's hub session), else directly from a page on the
 *     hub's origin, and the result shows in the pop-up. The console server never decides by itself.
 * Off: nothing opens by itself; approvals stay in the approvals banner.
 *
 * The switch is one value for all of Brett's consoles (the server keeps it, so Amber can read it): Settings → Plugins →
 * Follow Amber, the right-click menu on every target, the app menu, or the banner chip (shown while it's on).
 */
import { Component, useEffect, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Container, Icon, Note, flashWhenReady, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { followSse, sseJson } from '@console/axf/core/sse';
import { HUB_DEFAULT, normalizeHub } from '@console/axf/libs/hub/hub';
import { formatCountdown, vetoHost, VETO_WARNING_SECONDS } from '@console/axf/libs/hub/veto';
import { approvalsWatcher, countdownOf, type ApprovalItem } from '@console/axf/libs/approvals';
import { approvalsHost } from '@console/axf/libs/approvals/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { arrived, decide, drawable, highlightIsSelector, offers, parseFrame, pickNext, queueOf, routeOf, type DecideEnv, type FollowDecision } from './core';
import { appMenu } from './menu';
import './follow-amber.css';

const ID = 'ai.amberx.axf.console.follow-amber';
const FOLDER = 'follow-amber';
const DIALOG = 'follow-amber.approval';
const ASSET_ID = 'follow-amber';
const COUNTER = 'follow-amber.on';
const KEY = 'follow-amber.on';
const CHIP_KEY = 'follow-amber.chip';

/* ---------------- a tiny store: the switch, the hub, the approvals queue ---------------- */

interface State { on: boolean; by: string; at: string; known: boolean; hub: string; queue: ApprovalItem[]; current: string; error: string }
let st: State = { on: false, by: '', at: '', known: false, hub: HUB_DEFAULT, queue: [], current: '', error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useFollow = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
let runtime: AxfRuntime | null = null;
const seen = new Set<string>();
const decided = new Set<string>();

const post = (path: string, body: unknown) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function loadState(): Promise<void> {
  try {
    const r = await pluginFetch(FOLDER, 'state');
    if (!r.ok) throw new Error(r.status === 403 ? 'Follow Amber is for the owner only.' : `The console answered ${r.status}.`);
    const j = (await r.json()) as { on?: boolean; by?: string; at?: string };
    applyState(j.on === true, j.by ?? '', j.at ?? '');
  } catch (e) { set({ error: (e as Error).message }); }
}

function applyState(on: boolean, by: string, at: string) {
  set({ on, by, at, known: true, error: '' });
  if (runtime && runtime.settings.get(KEY) !== on) runtime.settings.set(KEY, on);
  if (runtime) paint(runtime);
}

/** Switch it for every console (the server keeps the one value; every follow stream hears it). */
export async function setFollow(on: boolean): Promise<void> {
  try {
    const r = await post('state', { on });
    if (!r.ok) throw new Error(`The console answered ${r.status}.`);
    const j = (await r.json()) as { on: boolean; by?: string; at?: string };
    applyState(j.on, j.by ?? '', j.at ?? '');
    runtime?.toast(j.on ? 'Follow Amber is on: what Amber talks about opens here, approvals pop up.' : 'Follow Amber is off.', 'info', 'Follow Amber');
  } catch (e) { runtime?.toast((e as Error).message, 'danger', 'Follow Amber'); }
}

/** The banner chip (a framework status widget) while it's on. */
function paint(rt: AxfRuntime) {
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Follow Amber', version: '0.1.0', author: 'Follow Amber plugin',
    description: 'Follow Amber is on: what Amber talks about opens here and approvals pop up. Tap to turn it off.', tags: ['amber', 'status'],
    data: { counter: COUNTER, onLabel: 'Following Amber', offLabel: 'Not following', onTone: 'accent', offTone: 'muted', dot: true, link: 'follow-amber.toggle' },
  }, 'app', ID);
  rt.setBadge(COUNTER, st.on ? 1 : 0);
  if (st.on && rt.settings.get(CHIP_KEY) !== false) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'left', order: 22, origin: ID, widget: { label: 'Following Amber', size: 'compact', priority: 4, aliases: ['follow amber', 'following'] } });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

/* ---------------- approvals: watch the feed while following, pop new ones up ---------------- */

async function hubUrl(): Promise<string> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    return normalizeHub(((await r.json()) as { hub?: string }).hub) ?? HUB_DEFAULT;
  } catch { return HUB_DEFAULT; }
}

function onFeed(items: ApprovalItem[], wanted = '') {
  const queue = queueOf(items, decided);
  const fresh = arrived(seen, queue);
  for (const i of queue) seen.add(i.id);
  set({ queue });
  if (!st.on || !runtime) return;
  const open = runtime.getState().dialog?.id;
  const want = wanted && queue.some((i) => i.id === wanted) ? wanted : fresh[0];
  // A new one (or the one Amber named) pops up; the approvals banner's own review / veto dialog gives way to it.
  if (want && (open !== DIALOG || !st.current)) { set({ current: want }); runtime.openDialog(DIALOG, { id: want }); }
  else if (want && open === DIALOG) runtime.toast(`${queue.length} approvals waiting`, 'info', 'Follow Amber');
  else if (queue.length && (open === 'approvals.review' || open === 'approvals.veto')) { const n = pickNext(queue); if (n) { set({ current: n.id }); runtime.openDialog(DIALOG, { id: n.id }); } }
}

/** While following, the approvals banner's own review / veto dialog gives way to the pop-up (same call, same session). */
let taking = false;
function takeOver(rt: AxfRuntime) {
  const d = rt.getState().dialog;
  if (taking || !st.on || !d || (d.id !== 'approvals.review' && d.id !== 'approvals.veto')) return;
  const id = typeof (d.props as { id?: unknown } | undefined)?.id === 'string' ? String((d.props as { id: string }).id) : '';
  const n = pickNext(st.queue, id);
  if (!n && !id) return;
  taking = true;
  set({ current: n?.id ?? id });
  queueMicrotask(() => { taking = false; rt.openDialog(DIALOG, { id: n?.id ?? id }); });
}

let stopFeed: (() => void) | null = null;
async function watchFeed(on: boolean) {
  stopFeed?.(); stopFeed = null;
  if (!on) return;
  const hub = await hubUrl();
  set({ hub });
  const w = approvalsWatcher(hub);
  const off = w.subscribe(() => { if (w.state.status === 'ok') onFeed(w.state.items); });
  w.start();
  stopFeed = () => { off(); };
  if (w.state.status === 'ok') onFeed(w.state.items);
}

async function checkFor(id = '') {
  const w = approvalsWatcher(st.hub);
  const s = await w.check();
  if (s.status === 'ok') onFeed(s.items, id);
}

/* ---------------- the client: follows the server's stream, draws nothing ---------------- */

function findText(text: string): Element | null {
  const want = text.trim().toLowerCase();
  const root = document.querySelector('.fx-dialog') ?? document.querySelector('.fx-main') ?? document.body;
  for (const el of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, button, a, label, [data-fx-row], li, td, th, span, strong, p')) {
    if ((el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase() === want) return el;
  }
  return null;
}

function highlight(h: string) {
  if (!h) return;
  flashWhenReady(() => {
    if (highlightIsSelector(h)) { try { return document.querySelector(h); } catch { return findText(h); } }
    return findText(h);
  }, 4000);
}

function clientId(): string {
  const k = 'axf.follow-amber.client';
  try {
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const n = `fa-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionStorage.setItem(k, n);
    return n;
  } catch { return `fa-${Math.random().toString(36).slice(2, 12)}`; }
}

function FollowClient() {
  const rt = useRuntime();
  const s = useFollow();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stop = followSse(
      (signal) => pluginFetch(FOLDER, `stream?client=${encodeURIComponent(clientId())}`, { signal }),
      (f) => {
        const m = parseFrame(sseJson(f));
        if (!m) return;
        if (m.type === 'state') { if (m.on !== st.on || !st.known) applyState(m.on, m.by ?? '', m.at ?? ''); return; }
        if (!st.on) return;
        if (m.type === 'show') {
          highlight(m.highlight ?? '');
          rt.toast(m.say ? `Amber: ${m.say}` : `Amber opened ${m.label || m.target}`, 'info', 'Follow Amber');
          return;
        }
        if (m.type === 'approval') { if (m.say) rt.toast(`Amber: ${m.say}`, 'info', 'Follow Amber'); void checkFor(m.id ?? ''); }
      },
    );
    return stop;
  }, [rt]);
  useEffect(() => { void watchFeed(s.on); return () => { stopFeed?.(); stopFeed = null; }; }, [s.on]);
  return null;
}

/* ---------------- the approval pop-up ---------------- */

/** Opens a hub page the app's way (its signed-in hub view), else a new tab. */
function openOnHub(url: string) {
  const h = vetoHost();
  if (h.open) h.open(url); else globalThis.open(url, '_blank', 'noopener,noreferrer');
}

/** Where a decision can go from this page (the hub frames its page only for the origins it lists: `frame`). */
const decideEnv = (hub: string): DecideEnv => ({ hub, origin: globalThis.location?.origin ?? '', vetoAct: vetoHost().act, approvalDecide: approvalsHost().decide, frame: approvalsHost().frame === true });

/**
 * One tap from either the pop-up or its fallback. The result shows here, always (Brett, Nov 6 2026): the console's relay
 * or the app's host decides; a page with neither says so, and "Open on axHub" stays a separate button. Nothing opens by
 * itself (pending approvals-no-window-spam s1).
 */
async function tapDecision(item: ApprovalItem, approve: boolean, hub: string): Promise<FollowDecision> {
  const r = await decide(item, approve, decideEnv(hub)).catch((e: unknown) => ({ ok: false, route: 'host', message: `Couldn't reach axHub (${(e as Error)?.message ?? e}). Nothing was decided.` }) as FollowDecision);
  if (r.ok) { decided.add(item.id); runtime?.toast(r.message, approve ? 'success' : 'info', 'Follow Amber'); set({ queue: queueOf(st.queue, decided) }); void checkFor(); }
  else if (r.open) runtime?.toast(r.message, 'info', 'Follow Amber');
  return r;
}

/** How long the hub's page gets to load in the frame before the pop-up offers Open on axHub instead. */
const FRAME_LOAD_MS = 8_000;

/** axHub's own page, framed, for the tap the console can't sign itself; the hub may refuse to be framed here. */
function HubFrame({ url }: { url: string }) {
  const [frame, setFrame] = useState<'loading' | 'loaded' | 'stuck'>('loading');
  useEffect(() => {
    setFrame('loading');
    const t = setTimeout(() => setFrame((f) => (f === 'loading' ? 'stuck' : f)), FRAME_LOAD_MS);
    return () => clearTimeout(t);
  }, [url]);
  if (frame === 'stuck') {
    return (
      <div className="fx-stack axp-follow-amber__done" role="status">
        <p className="fx-small fx-muted">axHub's page didn't open in here. Open it on the hub to approve or deny.</p>
        <Button tone="primary" icon="external" onClick={() => openOnHub(url)}>Open on axHub</Button>
      </div>
    );
  }
  return (
    <div className="fx-stack">
      <Note tone="info">The console can't sign this for you from here, so axHub's own page takes the tap: Approve or Deny below.</Note>
      <iframe className="axp-follow-amber__frame" title="Approval on axHub" src={url} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" onLoad={() => setFrame('loaded')} />
    </div>
  );
}

function ApprovalDialog({ id }: { id: string }) {
  const s = useFollow();
  const rt = useRuntime();
  const [, tick] = useState(0);
  const [busy, setBusy] = useState<'approve' | 'deny' | ''>('');
  const [result, setResult] = useState<FollowDecision | null>(null);
  const item = drawable(s.queue.find((i) => i.id === (s.current || id)) ?? pickNext(s.queue, s.current || id));
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1_000); return () => clearInterval(t); }, []);
  // Fast reads while it's open, so a decision on another screen (or the countdown running out) shows here.
  useEffect(() => { const t = setInterval(() => void checkFor(), 3_000); return () => clearInterval(t); }, []);
  useEffect(() => { setResult(null); }, [item?.id]);
  if (!item) {
    return (
      <div className="fx-stack axp-follow-amber__done" role="status">
        <Icon name="check" size={24} />
        <strong>Nothing waiting</strong>
        <p className="fx-small fx-muted">Every approval was decided, ran or expired.</p>
        <Button onClick={() => rt.closeDialog()}>Close</Button>
      </div>
    );
  }
  const route = routeOf(item, decideEnv(s.hub));
  const left = countdownOf(item);
  const urgent = left !== null && left <= VETO_WARNING_SECONDS;
  const pos = s.queue.findIndex((i) => i.id === item.id);
  const next = () => {
    const rest = queueOf(s.queue, decided).filter((i) => i.id !== item.id);
    if (rest.length) set({ current: rest[0]!.id }); else { set({ current: '' }); rt.closeDialog(); }
  };
  const tap = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'deny');
    const r = await tapDecision(item, approve, s.hub);
    setBusy('');
    setResult(r);
    if (r.ok) next();
  };
  return (
    <div className="fx-stack axp-follow-amber__ask">
      <div className="fx-row fx-row--wrap axp-follow-amber__top">
        {item.kind === 'held'
          ? left !== null && left > 0
            ? <span className={`axp-follow-amber__count${urgent ? ' is-urgent' : ''}`} role="timer" aria-live={urgent ? 'assertive' : 'off'}>{formatCountdown(left)}</span>
            : <Chip tone="accent">Running now</Chip>
          : <Chip tone="warning">Waiting for you</Chip>}
        <span className="fx-small fx-muted">{item.kind === 'held' ? (left !== null && left > 0 ? 'until axHub runs it by itself' : '') : 'axHub runs it only if you approve'}</span>
        {s.queue.length > 1 && <Chip>{pos + 1} of {s.queue.length}</Chip>}
      </div>
      <h3 className="axp-follow-amber__title">{item.title}</h3>
      {item.description && <p className="axp-follow-amber__desc">{item.description}</p>}
      <Container title="The exact call" icon="code" collapsible defaultOpen={false}>
        <code className="axp-follow-amber__call">{item.command ? `$ ${item.command}` : item.summary || item.tool}</code>
        <p className="fx-small fx-muted">{item.tool}{item.source ? ` · asked by ${item.source.who || item.source.label}` : ''}</p>
      </Container>
      {result?.frame ? <HubFrame url={item.url} /> : (
        <div className="fx-row axp-follow-amber__acts">
          <Button tone="danger" icon="x" busy={busy === 'deny'} disabled={busy !== '' || !offers(item, false)} aria-label={`Deny: ${item.title}`} onClick={() => void tap(false)} data-axf-one-tap="" data-axf-person-only="">Deny</Button>
          <Button tone="success" icon="check" busy={busy === 'approve'} disabled={busy !== '' || !offers(item, true)} aria-label={`Approve: ${item.title}`} onClick={() => void tap(true)} data-axf-one-tap="" data-axf-person-only="">Approve</Button>
        </div>
      )}
      {(route === 'frame' || route === 'open') && !result?.frame && <p className="fx-small fx-muted">This browser can't decide from here: its axHub session didn't reach the console. Use Open on axHub below.</p>}
      {result && !result.ok && !result.frame && <Note tone={result.open ? 'info' : 'danger'}>{result.message}</Note>}
      <div className="fx-row fx-row--wrap axp-follow-amber__foot">
        {s.queue.length > 1 && <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => { const n = s.queue[(pos + 1) % s.queue.length]; if (n) set({ current: n.id }); }}>Next</Button>}
        <Button size="sm" tone="ghost" icon="external" onClick={() => openOnHub(item.url)}>Open on axHub</Button>
        <Button size="sm" tone="ghost" onClick={() => rt.closeDialog()}>Later</Button>
      </div>
    </div>
  );
}

/**
 * The pop-up's last line (Brett, Nov 4 2026: "Why is the approval pop-up dialog just showing the sad face?"): if drawing
 * it still throws, this shows the raw call with Approve / Deny / Open in axHub instead of a broken dialog.
 */
function ApprovalFallback({ id, error }: { id: string; error: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const raw = st.queue.find((i) => i.id === (st.current || id)) ?? st.queue[0];
  const item = drawable(raw);
  const hubPage = item?.url || `${st.hub}/auth/admin/approvals`;
  const tap = async (approve: boolean) => {
    if (!item) return;
    setBusy(true);
    const r = await tapDecision(item, approve, st.hub);
    setBusy(false);
    setMsg(r.message);
    if (r.ok) runtime?.closeDialog();
  };
  let call = '';
  try { call = item ? (item.command ? `$ ${item.command}` : item.summary || item.tool) : JSON.stringify(raw ?? null); } catch { call = ''; }
  return (
    <div className="fx-stack axp-follow-amber__ask" role="alert">
      <Note tone="warning">Couldn't draw this approval{error ? ` (${error})` : ''}. Here is the raw call.</Note>
      {item && <strong>{item.title}</strong>}
      {call && <code className="axp-follow-amber__call">{call}</code>}
      <div className="fx-row axp-follow-amber__acts">
        <Button tone="danger" icon="x" busy={busy} disabled={busy || !item} onClick={() => void tap(false)} data-axf-one-tap="" data-axf-person-only="">Deny</Button>
        <Button tone="success" icon="check" busy={busy} disabled={busy || !item} onClick={() => void tap(true)} data-axf-one-tap="" data-axf-person-only="">Approve</Button>
      </div>
      {msg && <p className="fx-small fx-muted">{msg}</p>}
      <div className="fx-row fx-row--wrap axp-follow-amber__foot">
        <Button size="sm" tone="ghost" icon="external" onClick={() => openOnHub(hubPage)}>Open in axHub</Button>
        <Button size="sm" tone="ghost" onClick={() => runtime?.closeDialog()}>Later</Button>
      </div>
    </div>
  );
}

class ApprovalBoundary extends Component<{ id: string; children?: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e).slice(0, 200) || 'unknown error' }; }
  componentDidCatch(e: unknown, info: ErrorInfo) { console.error('[follow-amber] the approval pop-up failed to draw', e, info.componentStack); }
  render() { return this.state.error ? <ApprovalFallback id={this.props.id} error={this.state.error} /> : this.props.children; }
}

/* ---------------- settings ---------------- */

function FollowPanel() {
  const s = useFollow();
  useEffect(() => { void loadState(); }, []);
  return (
    <div className="fx-stack">
      {s.error && <Note tone="warning">{s.error}</Note>}
      <div className="fx-row fx-row--wrap">
        <Chip tone={s.on ? 'accent' : undefined}>{s.on ? 'Following Amber' : 'Not following'}</Chip>
        <Button tone={s.on ? 'neutral' : 'primary'} icon="eye" onClick={() => void setFollow(!s.on)}>{s.on ? 'Turn off' : 'Turn on'}</Button>
      </div>
      <p className="fx-small fx-muted">{s.known ? `${s.on ? 'On' : 'Off'}${s.by ? ` · switched by ${s.by}` : ''}${s.at ? ` · ${new Date(s.at).toLocaleString()}` : ''}` : 'Reading…'}</p>
      {s.on && s.queue.length > 0 && <Button icon="shield" onClick={() => { const n = pickNext(s.queue); if (n) { set({ current: n.id }); runtime?.openDialog(DIALOG, { id: n.id }); } }}>{s.queue.length} waiting: show them</Button>}
      <Note tone="info">
        Amber calls <code>console_show</code> (MCP, also through axHub) whenever she mentions something here; it only opens and highlights, so it never waits on a veto. REST: <code>POST /api/plugins/follow-amber/show</code> with <code>{'{"target": "plan studio", "say": "…"}'}</code>. CLI: <code>axf follow-amber show --target "plan studio"</code>.
      </Note>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Follow Amber',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  appMenu,
  register(rt) {
    runtime = rt;
    rt.actions.register('follow-amber.toggle', ([v]) => void setFollow(v === 'on' ? true : v === 'off' ? false : !st.on), { label: 'Follow Amber on / off', keywords: ['follow', 'amber', 'approvals', 'show'] } as never);
    rt.actions.register('follow-amber.approvals', () => { const n = pickNext(st.queue); if (n) { set({ current: n.id }); rt.openDialog(DIALOG, { id: n.id }); } else rt.toast('Nothing waiting for you on axHub.', 'info', 'Follow Amber'); }, { label: 'Show waiting approvals', keywords: ['approvals', 'veto', 'axhub'] } as never);
    // On every right-click menu in the console.
    rt.contextExtras.set('*:follow-amber', () => [{ id: 'follow-amber.toggle', label: st.on ? 'Follow Amber: on (turn off)' : 'Follow Amber: off (turn on)', icon: 'eye', action: 'follow-amber.toggle' }]);
    // While following, the pop-up is the one approval dialog: the approvals banner's own review / veto dialog gives way
    // to it the moment it opens (same call, same hub session; the banner itself is untouched).
    rt.subscribe(() => takeOver(rt));
    setInterval(() => takeOver(rt), 1_000);
    // The settings switch mirrors the server's value; flipping it there switches every console.
    rt.settings.subscribe(() => { const v = rt.settings.get(KEY); if (st.known && typeof v === 'boolean' && v !== st.on) void setFollow(v); });
    void loadState();
  },
  slots: { 'app.frame.cover': [{ id: 'follow-amber.client', order: 98, render: () => <FollowClient /> }] },
  dialogs: {
    [DIALOG]: { title: 'Approval waiting', icon: 'shield', render: (p) => { const id = typeof p?.id === 'string' ? p.id : ''; return <ApprovalBoundary id={id}><ApprovalDialog id={id} /></ApprovalBoundary>; } },
  },
  settingsTabs: [{ id: FOLDER, label: 'Follow Amber', icon: 'eye', order: 91, parent: 'plugins', description: 'The console opens what Amber talks about; approvals pop up here' }],
  settings: [{
    id: 'follow-amber.prefs', label: 'Follow Amber', icon: 'eye', tab: FOLDER, order: 10,
    description: 'One switch for all your consoles.',
    settings: [
      { key: KEY, label: 'Follow Amber', kind: 'toggle', default: false, scope: 'device', description: 'On: what Amber mentions opens here and approvals pop up. The same value for every console.' },
      { key: CHIP_KEY, label: 'Show the banner chip while following', kind: 'toggle', default: true, scope: 'device', description: 'A small "Following Amber" chip in the banner; tap it to turn Follow Amber off.' },
    ],
  }],
  settingsPanels: [
    { id: 'follow-amber.panel', tab: FOLDER, title: 'Follow Amber', icon: 'eye', order: 5, render: () => <FollowPanel /> },
    { id: 'follow-amber.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
