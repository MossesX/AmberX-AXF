/**
 * Session sync web core: the client store (link state, snapshot, channel), the API, live push (SSE with resume) and
 * what the plugin paints on the runtime (assignment directory for helper badges, counters, the Sessions chip, one
 * helper-status widget per helper, "Managed by orchestrator" on a helper's console, saved widget placements).
 * No React here; ui.tsx and index.tsx draw it. Zero tokens.
 */
import type { AxfRuntime } from '@console/axf/core';
import { followSse, sseJson } from '@console/axf/core/sse';
import { setAssignments, type AssignmentBadge } from '@console/axf/core/assignments';
import { ensureWindowHost, windowHost, WIDGET_TYPES } from '@console/axf/core/engines/widgets';
import { pluginFetch } from '@console/plugins';

export const ID = 'ai.amberx.axf.console.session-sync';
export const FOLDER = 'session-sync';
export const VIEW = 'session-sync';
export const DIALOG_JOIN = 'session-sync.join';
export const DIALOG_SEND = 'session-sync.send';
export const DIALOG_WIDGETS = 'session-sync.widgets';
export const CHIP_ASSET = 'session-sync';
export const MANAGED_ASSET = 'session-sync-managed';
export const COUNTERS = { chip: 'sessions.on', helpers: 'sessions.helpers', working: 'sessions.working', lunch: 'sessions.lunch', offers: 'sessions.offers', managed: 'sessions.managed' } as const;
export const KEYS = { chip: 'session-sync.chip', widgets: 'session-sync.widgets', widgetHost: 'session-sync.widget-host', hideDisconnected: 'session-sync.hide-disconnected', sendDefault: 'session-sync.send-default', askOnSend: 'session-sync.ask-on-send', joinSeen: 'session-sync.join-seen', role: 'axf.session.role', managedBy: 'axf.session.managedBy' } as const;
const PROFILE_CHIP_KEY = 'status:build-profile'; // the build-profile chip's attachment key (an asset id, not a plugin)

export interface SessionV { id: string; account: string; agent: string; client: string; role: string; approved?: boolean; status: string; helper: { state: string; tooltip: string }; doing: { build: string; step: string; note: string }; startedAt: string; lastSeenAt: string; endedAt: string; branch: string; pause: { reason: string; until: string } | null; summary?: string }
export interface ClaimV { id: string; session: string; kind: string; area: string; paths: string[]; reason: string; build: string; step: string; since: string; expiresAt: string }
export interface OfferV { id: string; build: string; steps: string[] | null; mode: string; childBuild: string; to: string; from: string; reason: string; at: string; expiresAt: string; status: string }
export interface AssignmentV { id: string; build: string; steps: string[] | null; session: string; account: string; agent: string; offer: string; status: string; order: number; since: string; updatedAt: string; backAt: string; reason: string; stepStates: Record<string, { state: string; at: string; reason: string }>; parent: string }
export interface ScopedBuild { id: string; title: string; steps: { id: string; text?: string; done?: boolean; model?: string }[]; assignedTo: { assignment: string; session: string; agent: string; status: string } | null; offer: { id: string; mode: string; status: string } | null; managedBy: string; pending?: boolean }
export interface StateV {
  ok: boolean; project: string; rev: number; seq: number; updatedAt: string; primary: { session: string; account: string; agent: string; since: string } | null;
  me: { session: string; account: string; agent: string; role: string }; sessions: SessionV[]; claims: ClaimV[]; settings: Record<string, unknown>; caps: Record<string, number>; stats: Record<string, { offers: number; accepts: number; rejects: number; holds: number; released: number; stepsDone: number; msPerStep: number[] }>;
  scoped: boolean; managedBy?: string; offers: OfferV[]; assignments: AssignmentV[]; builds?: ScopedBuild[]; helpers?: SessionV[];
}
export interface SnapshotV {
  ok: boolean; at: string; me: StateV['me']; primary: StateV['primary'];
  working: { session: string; agent: string; account: string; role: string; status: string; build: string; step: string; note: string; model: string; progress: { done: number; total: number; next: string } | null; since: string; lastSeenAt: string; branch: string }[];
  running: { id: string; title: string; branch: string; pr: string; progress: { done: number; total: number; next: string }; assignedTo: AssignmentBadge | null; steps: { id: string; text: string; model: string; done: boolean; estimate: string; assignedTo: unknown; withHelper: string }[] }[];
  done: { id: string; title: string; status: string; pr: string; mergedAt: string; report: string }[];
  attention: { kind: string; ref: string; text: string }[];
  queued: { id: string; title: string; estimate: string; touches: string[]; steps: number; createdAt: string }[];
  offers: OfferV[]; assignments: AssignmentV[]; caps: Record<string, number>; decisions: { at: string; text: string }[];
}
export interface MessageV { id: string; at: string; from: string; kind: string; text: string; jobId: string; channel?: string }
export type Live = 'off' | 'live' | 'reconnecting' | 'polling';

interface Store { state: StateV | null; snapshot: SnapshotV | null; messages: MessageV[]; filter: string; live: Live; seq: number; error: string; loading: boolean; wall: boolean | null; user: string }
let st: Store = { state: null, snapshot: null, messages: [], filter: 'all', live: 'off', seq: 0, error: '', loading: false, wall: null, user: '' };
const subs = new Set<() => void>();
export const set = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getStore = () => st;
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let runtime: AxfRuntime | null = null;
export const rtNow = () => runtime;

/* ---------------- the API (identity comes from the signed-in console; an open dev console says who it is) ---------------- */

async function identity(): Promise<Record<string, string>> {
  if (st.wall === null) {
    try { const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' }); const j = (await r.json()) as { wall?: boolean; user?: { name?: string } | null }; set({ wall: j.wall === true, user: j.user?.name ?? '' }); }
    catch { set({ wall: false }); }
  }
  return st.wall ? {} : { 'x-axf-session': 'console-local', 'x-axf-account': 'console', 'x-axf-client': 'console' };
}
export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await pluginFetch(FOLDER, path, { ...init, headers: { 'content-type': 'application/json', ...(await identity()), ...(init.headers as Record<string, string> | undefined) } });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string };
  if (!r.ok) throw new Error(j.detail ?? (r.status === 404 ? 'Session sync is disabled or its server part is not running.' : `The console answered ${r.status}.`));
  return j;
}
export const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export async function loadState(): Promise<StateV | null> {
  set({ loading: true });
  try { const s = await call<StateV>('state'); set({ state: s, seq: Math.max(st.seq, s.seq ?? 0), error: '', loading: false }); if (runtime) paint(runtime); return s; }
  catch (e) { set({ error: (e as Error).message, loading: false }); return null; }
}
export async function loadSnapshot(): Promise<SnapshotV | null> {
  try { const s = await call<SnapshotV>('snapshot'); set({ snapshot: s }); return s; } catch (e) { set({ error: (e as Error).message }); return null; }
}
export async function loadMessages(filter = st.filter): Promise<void> {
  try { const r = await call<{ messages: MessageV[] }>(`messages?filter=${encodeURIComponent(filter)}&limit=300`); set({ messages: r.messages, filter }); } catch { /* the Breakroom may be off */ }
}
const toast = (text: string, kind: 'info' | 'success' | 'danger' | 'warning' = 'info') => runtime?.toast(text, kind, 'Session sync');
const act = async <T>(path: string, body: unknown, okText?: string | ((r: T) => string)): Promise<T | null> => {
  try { const r = await post<T>(path, body); if (okText) toast(typeof okText === 'function' ? okText(r) : okText, 'success'); await loadState(); return r; }
  catch (e) { toast((e as Error).message, 'danger'); return null; }
};
export const actions = {
  sync: () => act<{ path: string; md: string; published: { ok: boolean; sha?: string; error?: string } | null; connected: SessionV[] }>('sync', {}, (r) => `Sync file written: ${r.md}${r.published ? r.published.ok ? ` · on main` : ` · not on main: ${r.published.error}` : ''}`),
  join: () => act<{ role: string; becamePrimary: boolean; needsApproval: boolean }>('join', {}, (r) => `Joined as ${r.role}${r.needsApproval ? ' (waiting for approval)' : ''}`),
  end: (summary: string) => act('end', { summary }, 'Pairing ended: claims released, work given back'),
  claim: (kind: 'area' | 'path', what: string, reason: string, build = '') => act('claim', { kind, ...(kind === 'area' ? { area: what } : { paths: what.split(',').map((x) => x.trim()).filter(Boolean) }), reason, build }, 'Claimed'),
  release: (claim = '') => act('release', { claim }, 'Released'),
  send: (text: string, kind = 'session', build = '', step = '') => act('send', { text, kind, build, step }).then((r) => { void loadMessages(); return r; }),
  requestWork: (minutes: number, areas: string[], model: string) => act<{ offers: OfferV[] }>('request-work', { minutes, areas, model }, (r) => (r.offers.length ? `${r.offers.length} offer(s) from the orchestrator` : 'Nothing fits right now; the orchestrator will offer when it does')),
  respond: (id: string, response: string, reason = '', backAt = '') => act<{ reaction: { decision: string; why: string } }>('respond', { id, response, reason, backAt }, (r) => r.reaction?.why || response),
  step: (assignment: string, step: string, state: string, reason = '') => act('step', { assignment, step, state, reason }),
  offer: (build: string, steps: string[] | null, to: string, reason: string) => act<{ offer: OfferV; duplicate: boolean }>('offer', { build, steps: steps ?? [], to, reason }, (r) => (r.duplicate ? 'Already offered' : `Offered ${r.offer.build} to ${r.offer.to || 'any helper'}`)),
  takeBack: (assignment: string, steps: string[] | null, confirm: boolean, reason: string) => act<{ ok: boolean }>('take-back', { assignment, steps: steps ?? [], confirm, reason }, 'Taken back'),
  undo: (seq: number) => act('undo', { seq }, 'Undone'),
  replan: (dryRun: boolean) => act<{ moves: { id: string; from: number; to: number; why: string }[]; summary: string[]; order: string[]; dryRun: boolean }>('replan', { dryRun }),
  approveAccount: (account: string) => act('approve-account', { account }, `Account ${account} approved`),
  makePrimary: (session: string) => act('make-primary', { session }, 'Primary changed'),
  settings: async (patch: Record<string, unknown>) => { try { const r = await put<{ settings: Record<string, unknown> }>('settings', patch); await loadState(); return r.settings; } catch (e) { toast((e as Error).message, 'danger'); return null; } },
  consistency: () => act<{ drift: number; fixed: { changed: string[] } | null }>('consistency', {}, (r) => (r.drift ? `Fixed ${r.fixed?.changed.length ?? 0} place(s)` : 'Every store agrees with the link')),
};

/* ---------------- live push: one SSE stream, resume from the last seq, slow poll when down ---------------- */

let stopLive: (() => void) | null = null;
let refresh: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
const schedule = (what: 'state' | 'snapshot' | 'messages') => { if (refresh) return; refresh = setTimeout(() => { refresh = null; void loadState(); if (what !== 'state' || st.snapshot) void loadSnapshot(); void loadMessages(); }, 150); };
export function startLive(rt: AxfRuntime): () => void {
  runtime = rt;
  if (stopLive) return stopLive;
  void loadState();
  const stop = followSse(async (signal) => pluginFetch(FOLDER, `events?after=${st.seq}`, { signal, headers: await identity() }), (f) => {
    if (f.event === 'gap') { set({ seq: 0 }); schedule('state'); return; }
    const ev = sseJson<{ seq: number; type: string; data: Record<string, unknown> }>(f);
    if (!ev) return;
    if (ev.seq > st.seq) set({ seq: ev.seq });
    if (ev.type === 'message') { void loadMessages(); return; }
    schedule(ev.type === 'handover' || ev.type === 'assignment' || ev.type === 'offer' || ev.type === 'replan' ? 'snapshot' : 'state');
  }, { onOpen: () => { set({ live: 'live' }); if (poll) { clearInterval(poll); poll = null; } }, onDrop: () => { set({ live: 'reconnecting' }); if (!poll) poll = setInterval(() => { set({ live: 'polling' }); void loadState(); }, 30000); } });
  stopLive = () => { stop(); stopLive = null; if (poll) { clearInterval(poll); poll = null; } set({ live: 'off' }); };
  return stopLive;
}

/* ---------------- what the plugin paints on the runtime ---------------- */

const HELPER_ICON: Record<string, string> = { none: 'user-x', idle: 'user', working: 'activity', lunch: 'coffee' };
const HELPER_TONE: Record<string, 'muted' | 'neutral' | 'accent' | 'warning' | 'success'> = { none: 'muted', idle: 'neutral', working: 'accent', lunch: 'warning' };
const helperAssetId = (session: string) => `helper-${session.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
export const isSecondary = () => st.state?.me.role === 'secondary';

/** Badges, counters, the chip, one widget per helper, the managed chip. Called on every state load. */
export function paint(rt: AxfRuntime) {
  const s = st.state; if (!s) return;
  const names = new Map(s.sessions.map((x) => [x.id, x.agent || x.id]));
  // helper badges everywhere: the assignment directory
  const badges: AssignmentBadge[] = s.assignments.filter((a) => ['queued', 'working', 'held', 'blocked', 'rejected'].includes(a.status)).map((a) => {
    const sess = s.sessions.find((x) => x.id === a.session);
    const name = `${a.agent || names.get(a.session) || a.session} (helper)`;
    const total = a.steps?.length ?? 0; const done = a.steps ? a.steps.filter((x) => a.stepStates[x]?.state === 'done').length : 0;
    const idx = s.assignments.filter((x) => x.session === a.session && ['queued', 'working'].includes(x.status)).sort((x, y) => x.order - y.order).findIndex((x) => x.id === a.id) + 1;
    const text = a.status === 'working' ? `${name}${total ? ` · step ${Math.min(done + 1, total)}/${total}` : ''}` : a.status === 'queued' ? `In ${a.agent || a.session}'s queue (#${idx})` : `${a.status === 'held' ? 'On hold at' : a.status === 'blocked' ? 'Blocked at' : 'Rejected by'} ${a.agent || a.session}${a.reason ? `: ${a.reason}` : ''}`;
    return { build: a.build, steps: a.steps, status: a.status, kind: a.status, animated: a.status === 'working' && sess?.status === 'working', agent: a.agent, session: a.session, account: a.account, text, since: a.since, updatedAt: a.updatedAt, assignment: a.id, withHelper: a.parent };
  });
  setAssignments(ID, badges);
  // counters + the chip
  const helpers = s.sessions.filter((x) => x.role === 'secondary' && !x.endedAt && (x.status !== 'offline' || !rt.settings.get(KEYS.hideDisconnected)));
  rt.setBadge(COUNTERS.helpers, helpers.filter((x) => x.status !== 'offline').length);
  rt.setBadge(COUNTERS.working, helpers.filter((x) => x.helper.state === 'working').length);
  rt.setBadge(COUNTERS.lunch, helpers.filter((x) => x.helper.state === 'lunch').length);
  rt.setBadge(COUNTERS.offers, s.offers.length);
  rt.setBadge(COUNTERS.chip, s.sessions.filter((x) => !x.endedAt).length);
  rt.registry.register({ $axf: 'asset@1', type: 'status', id: CHIP_ASSET, name: 'Sessions', version: '0.1.0', author: 'Session sync plugin', description: 'How many Claude sessions are on this project. Tap to open the Sessions panel.', tags: ['sessions', 'status'],
    data: { counter: COUNTERS.chip, onLabel: s.sessions.filter((x) => !x.endedAt).length > 1 ? `${s.sessions.filter((x) => !x.endedAt).length} sessions` : 'Sessions', offLabel: 'No sessions', onTone: s.settings.enforce === false ? 'warning' : 'accent', offTone: 'muted', dot: true, link: 'session-sync.open' } }, 'app', ID);
  if (rt.settings.get(KEYS.chip) !== false) rt.attachToBanner({ type: 'status', id: CHIP_ASSET, at: 'left', order: 21, origin: ID }); else rt.detachFromBanner(`status:${CHIP_ASSET}`);
  // one helper-status widget per helper (a counter widget: icon + label + tone), on the banner / toolbar / windows the user picked
  const host = String(rt.settings.get(KEYS.widgetHost) ?? 'banner');
  const seen = new Set<string>();
  for (const h of helpers) {
    const id = helperAssetId(h.id); seen.add(id);
    const state = h.helper.state === 'none' && rt.settings.get(KEYS.hideDisconnected) ? '' : h.helper.state;
    if (!state) { rt.detachFromHost('banner', `counter:${id}`); rt.detachFromHost('toolbar', `counter:${id}`); continue; }
    rt.setBadge(`sessions.helper.${h.id}`, 1);
    rt.registry.register({ $axf: 'asset@1', type: 'counter', id, name: `Helper: ${h.agent || h.id}`, version: '0.1.0', author: 'Session sync plugin', description: `Helper session ${h.agent || h.id} (${h.account}): ${h.helper.tooltip}`, tags: ['sessions', 'helper', state],
      data: { counter: `sessions.helper.${h.id}`, tone: HELPER_TONE[state] ?? 'neutral', hideAtZero: false, icon: HELPER_ICON[state] ?? 'user', label: h.agent || h.id, link: 'session-sync.open' } }, 'app', ID);
    if (host === 'banner' || host === 'both') rt.attachToBanner({ type: 'counter', id, at: 'right', order: 30, origin: ID }); else rt.detachFromHost('banner', `counter:${id}`);
    if (host === 'toolbar' || host === 'both') rt.attachToToolbar({ type: 'counter', id, at: 'end', order: 30, origin: ID }); else rt.detachFromHost('toolbar', `counter:${id}`);
  }
  for (const a of rt.hostAttachments('banner')) if (a.origin === ID && a.type === 'counter' && !seen.has(a.id)) rt.detachFromHost('banner', `counter:${a.id}`);
  for (const a of rt.hostAttachments('toolbar')) if (a.origin === ID && a.type === 'counter' && !seen.has(a.id)) rt.detachFromHost('toolbar', `counter:${a.id}`);
  // a helper's console: Managed by orchestrator instead of the build profile
  const secondary = s.me.role === 'secondary';
  rt.setBadge(COUNTERS.managed, secondary ? 1 : 0);
  if (rt.settings.get(KEYS.role) !== s.me.role) rt.settings.set(KEYS.role, s.me.role);
  const by = secondary ? `${s.primary?.agent || s.primary?.session || 'the primary session'} (${s.primary?.account || 'primary account'})` : '';
  if (rt.settings.get(KEYS.managedBy) !== by) rt.settings.set(KEYS.managedBy, by);
  if (secondary) {
    rt.registry.register({ $axf: 'asset@1', type: 'status', id: MANAGED_ASSET, name: 'Managed by orchestrator', version: '0.1.0', author: 'Session sync plugin', description: `This console is a helper session: its builds come from ${by}. No build profile to switch.`, tags: ['sessions', 'status'],
      data: { counter: COUNTERS.managed, onLabel: 'Managed by orchestrator', offLabel: '', onTone: 'accent', offTone: 'muted', dot: false, link: 'session-sync.open' } }, 'app', ID);
    rt.attachToBanner({ type: 'status', id: MANAGED_ASSET, at: 'left', order: 20, origin: ID });
    rt.detachFromBanner(PROFILE_CHIP_KEY);
  } else rt.detachFromBanner(`status:${MANAGED_ASSET}`);
  attachSaved(rt);
}

/* ---------------- Add widgets…: any attachable widget on any host (banner, toolbar, a window's title bar) ---------------- */

export interface SavedWidget { host: string; type: string; id: string; at: string; order?: number }
export const savedWidgets = (rt: AxfRuntime): SavedWidget[] => { const v = rt.settings.get(KEYS.widgets); try { const list = typeof v === 'string' ? (JSON.parse(v) as unknown) : []; return Array.isArray(list) ? (list as SavedWidget[]).filter((w) => w && w.host && w.type && w.id) : []; } catch { return []; } };
const saveWidgets = (rt: AxfRuntime, list: SavedWidget[]) => rt.settings.set(KEYS.widgets, JSON.stringify(list));
export function attachSaved(rt: AxfRuntime) {
  for (const w of savedWidgets(rt)) {
    if (w.host.startsWith('window:')) ensureWindowHost(w.host.slice(7));
    if (!rt.registry.has(w.type as never, w.id)) continue;
    rt.attachToHost(w.host, { type: w.type, id: w.id, at: w.at as never, order: w.order ?? 50, origin: ID });
  }
}
export function addWidget(rt: AxfRuntime, host: string, type: string, id: string, at = host === 'toolbar' ? 'end' : host.startsWith('window:') ? 'end' : 'right') {
  const list = savedWidgets(rt).filter((w) => !(w.host === host && w.type === type && w.id === id));
  list.push({ host, type, id, at, order: 50 });
  saveWidgets(rt, list);
  if (host.startsWith('window:')) ensureWindowHost(host.slice(7));
  rt.attachToHost(host, { type, id, at: at as never, order: 50, origin: ID });
}
export function removeWidget(rt: AxfRuntime, host: string, type: string, id: string) {
  saveWidgets(rt, savedWidgets(rt).filter((w) => !(w.host === host && w.type === type && w.id === id)));
  rt.detachFromHost(host, `${type}:${id}`);
}
/** Every widget asset the app knows, for the picker: type, id, name, where it already sits. */
export function attachableWidgets(rt: AxfRuntime): { type: string; id: string; name: string; description: string; mine: boolean }[] {
  const out: { type: string; id: string; name: string; description: string; mine: boolean }[] = [];
  for (const type of WIDGET_TYPES) for (const a of rt.registry.list(type as never) as { id: string; name?: string; description?: string; origin?: string }[]) out.push({ type, id: a.id, name: a.name ?? a.id, description: a.description ?? '', mine: type === 'counter' && a.id.startsWith('helper-') });
  return out.sort((a, b) => Number(b.mine) - Number(a.mine) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}
export const openWindows = (rt: AxfRuntime): { id: string; title: string }[] => rt.windows.state.windows.map((w) => ({ id: w.id, title: w.title }));
export const hostLabel = (host: string, rt: AxfRuntime) => host === 'banner' ? 'Banner' : host === 'toolbar' ? 'Toolbar' : host.startsWith('window:') ? `Window: ${openWindows(rt).find((w) => w.id === host.slice(7))?.title ?? host.slice(7)}` : host;
export { windowHost };
