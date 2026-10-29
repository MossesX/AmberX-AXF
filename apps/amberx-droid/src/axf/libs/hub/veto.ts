/**
 * lib-hub veto@1 (web) — held "veto" calls: a command the hub holds for a countdown and then runs itself, unless Brett
 * denies it first (Brett, Oct 28 2026: "instead of an Approve button I can Deny it and stop it from running before time
 * is up"). Additive to hub.ts: the approvals feed parser there is unchanged; this file reads the same reply again for
 * the held entries and splits them off, so an app shows held calls (countdown + Deny) apart from calls waiting for an
 * approval (Review).
 *
 * The contract (axHub, decision #101 + veto@1):
 *  - the feed (`GET /auth/api/approvals`, legacy `/auth/admin/approvals.json`) lists a held call in `pending` with
 *    `status: "held"`, `veto: { runsAt, secondsLeft, countdownSeconds }`, `jobId`, `denyUrl`, `streamUrl`; also in
 *    `held[]` with `heldCount`;
 *  - Deny is `POST /auth/api/approvals/<id>/deny` (admin session + the hub's own Origin + `X-AxHub-CSRF`), so only a
 *    page on the hub (or the phone's native session) can send it; other apps open the approval page instead;
 *  - the job stream `GET /auth/api/jobs/<jobId>/stream` (SSE): `countdown {secondsLeft}`, `state {state}`,
 *    `output {stream, text}`, `done {state, exitCode}`;
 *  - pushes `{ type: "veto", phase: "held"|"warning"|"running", id, jobId, title, command, runsAt, secondsLeft, … }`;
 *  - states: held → running → ran | failed, or denied, or expired.
 *
 * Every link an app uses is rebuilt here from the ids (a link from the hub is used only to check it points at the hub),
 * the same rule as the approvals feed. Countdowns run on the local clock from `secondsLeft` (read time kept), so a phone
 * whose clock is off still counts down right; `runsAt` is the fallback.
 *
 * Kotlin twin: deferred (all Android framework work is on hold); the AmberX shell's Java `VetoAlerts` reads the same
 * fields. Gap recorded in spec/PORTING.md.
 */
import { approvalUrl, approvalsUrl, feedUrl, HUB_DEFAULT, HUB_FEED_MAX_ITEMS, HUB_FIELD_CAPS, HUB_MESSAGES, interpretFeed, isApprovalId, isHub, normalizeHub, readCapped, unreachableFeed, type HubFeed, type HubFetch } from './hub';
import { readSse, type SseFrame } from '../../core/sse';

export const VETO_CONTRACT = 'veto@1';
/** "Time running out": the second notification fires this many seconds before the call runs. */
export const VETO_WARNING_SECONDS = 30;
/** The hub's default countdown (3 minutes). */
export const VETO_DEFAULT_COUNTDOWN = 180;
export const VETO_MAX_COUNTDOWN = 24 * 3600;
export const VETO_COMMAND_CAP = 2000;
export const VETO_OUTPUT_CAP = 4000;

export type VetoState = 'held' | 'running' | 'ran' | 'failed' | 'denied' | 'expired';
export const VETO_STATES: readonly VetoState[] = ['held', 'running', 'ran', 'failed', 'denied', 'expired'];
export const VETO_FINAL: readonly VetoState[] = ['ran', 'failed', 'denied', 'expired'];
export const isVetoFinal = (s: VetoState) => VETO_FINAL.includes(s);
/** Notification phases: held (timer started), warning (≤ 30 s left), running (time is up, the hub runs it). */
export type VetoPhase = 'held' | 'warning' | 'running';
export const VETO_PHASES: readonly VetoPhase[] = ['held', 'warning', 'running'];

const JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const isJobId = (id: unknown): id is string => typeof id === 'string' && JOB_ID.test(id);

/** One held call. `url` is its approval page on the hub; `denyUrl`/`streamUrl` are rebuilt from the ids. */
export interface VetoCall {
  id: string;
  jobId: string | null;
  tool: string;
  title: string;
  command: string;
  summary: string;
  runsAt: string;
  /** seconds left when it was read (`readAt`, local ms) */
  secondsLeft: number;
  countdownSeconds: number;
  readAt: number;
  url: string;
  denyUrl: string;
  streamUrl: string | null;
}

export const vetoDenyUrl = (base: string, id: unknown): string | null => (isApprovalId(id) ? `${base}/auth/api/approvals/${id}/deny` : null);
export const vetoStreamUrl = (base: string, jobId: unknown): string | null => (isJobId(jobId) ? `${base}/auth/api/jobs/${jobId}/stream` : null);

const o = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const s = (r: Record<string, unknown> | null, k: string): string | null => (r && typeof r[k] === 'string' ? (r[k] as string) : null);
const n = (r: Record<string, unknown> | null, k: string): number | null => (r && typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : null);
const clampSec = (v: number) => Math.max(0, Math.min(VETO_MAX_COUNTDOWN, Math.round(v)));

/** The command out of an entry: `command`, `args.command`, or the `"command":"…"` in the hub's summary. */
export function commandOf(p: Record<string, unknown>): string {
  const direct = s(p, 'command') ?? s(o(p.args), 'command') ?? s(o(p.arguments), 'command');
  if (direct) return direct.slice(0, VETO_COMMAND_CAP);
  const m = /"command":"((?:[^"\\]|\\.)*)"/.exec(s(p, 'summary') ?? '');
  return m ? m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\').slice(0, VETO_COMMAND_CAP) : '';
}

/**
 * A held call from a feed entry, a `held[]` entry, the explain layer or a push; null when it isn't one (no real approval
 * id, a link pointing somewhere other than the hub, no veto timing). `now` is the local clock (ms) it was read at.
 */
export function vetoOf(base: string, raw: unknown, now: number = Date.now()): VetoCall | null {
  const p = o(raw);
  if (!p) return null;
  const id = s(p, 'id');
  const url = approvalUrl(base, id);
  const denyUrl = vetoDenyUrl(base, id);
  if (!id || !url || !denyUrl) return null;
  for (const k of ['url', 'approvalUrl', 'denyUrl', 'streamUrl']) if (typeof p[k] === 'string' && !isHub(base, p[k])) return null;
  const v = o(p.veto) ?? p; // a push carries runsAt/secondsLeft at the top
  const runsAt = (s(v, 'runsAt') ?? '').slice(0, HUB_FIELD_CAPS.time);
  const left = n(v, 'secondsLeft');
  const at = runsAt ? Date.parse(runsAt) : NaN;
  if (left === null && !Number.isFinite(at)) return null;
  const secondsLeft = clampSec(left ?? (at - now) / 1000);
  const countdownSeconds = clampSec(n(v, 'countdownSeconds') ?? Math.max(VETO_DEFAULT_COUNTDOWN, secondsLeft));
  const jobId = isJobId(p.jobId) ? (p.jobId as string) : null;
  const tool = (s(p, 'tool') ?? 'vps.run').slice(0, HUB_FIELD_CAPS.tool);
  const reason = o(p.reason);
  const title = (s(p, 'title') ?? s(reason, 'title') ?? tool).slice(0, 200);
  return {
    id, jobId, tool, title, command: commandOf(p), summary: (s(p, 'summary') ?? '').slice(0, HUB_FIELD_CAPS.summary),
    runsAt, secondsLeft, countdownSeconds, readAt: now, url, denyUrl, streamUrl: vetoStreamUrl(base, jobId),
  };
}

/** Is a feed entry a held veto call (rather than a call waiting for an approval)? */
export const isHeldEntry = (raw: unknown): boolean => { const p = o(raw); return !!p && p.status === 'held' && !!o(p.veto); };

/** Every held call in a feed reply body (`pending` entries with `status: "held"` and `held[]`), deduped, capped. */
export function interpretVeto(base: string, body: string, now: number = Date.now()): VetoCall[] {
  let j: Record<string, unknown> | null;
  try { j = o(JSON.parse(body)); } catch { return []; }
  if (!j) return [];
  const out: VetoCall[] = [];
  const ids = new Set<string>();
  const add = (raw: unknown) => {
    if (out.length >= HUB_FEED_MAX_ITEMS) return;
    const c = vetoOf(base, raw, now);
    if (c && !ids.has(c.id)) { ids.add(c.id); out.push(c); }
  };
  for (const e of Array.isArray(j.pending) ? j.pending : []) if (isHeldEntry(e)) add(e);
  for (const e of Array.isArray(j.held) ? j.held : []) add(e);
  return out.sort((a, b) => a.secondsLeft - b.secondsLeft);
}

/** A feed split in two: calls waiting for an approval (`feed`, held ones taken out) and held veto calls. */
export interface VetoFeed { feed: HubFeed; held: VetoCall[] }

export function splitFeed(base: string, status: number, body: string, now: number = Date.now()): VetoFeed {
  const feed = interpretFeed(base, status, body);
  if (feed.status !== 'ok') return { feed, held: [] };
  const held = interpretVeto(base, body, now);
  if (!held.length) return { feed, held };
  const heldIds = new Set(held.map((c) => c.id));
  const pending = feed.pending.filter((p) => !heldIds.has(p.id));
  return { feed: { ...feed, pending, count: Math.max(pending.length, feed.count - (feed.pending.length - pending.length)) }, held };
}

/** Reads the approvals feed (same rules as `fetchHubFeed`: own session, redirects refused, capped) and splits it. */
export async function fetchVetoFeed(base: string, opts: { fetch?: HubFetch; now?: () => number; url?: string } = {}): Promise<VetoFeed> {
  const hub = normalizeHub(base);
  if (!hub) return { feed: unreachableFeed(HUB_DEFAULT), held: [] };
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  let r: Response;
  try {
    r = await f(opts.url ?? feedUrl(hub), { credentials: 'include', cache: 'no-store', redirect: 'error' });
  } catch (e) {
    return { feed: unreachableFeed(hub, ((e as Error)?.message || HUB_MESSAGES.unreachable).slice(0, 120)), held: [] };
  }
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return { feed: interpretFeed(hub, r.status || 302, ''), held: [] };
  if (r.status !== 200) return { feed: interpretFeed(hub, r.status, ''), held: [] };
  let body: string | null;
  try { body = await readCapped(r); } catch (e) { return { feed: unreachableFeed(hub, ((e as Error)?.message || HUB_MESSAGES.unreachable).slice(0, 120)), held: [] }; }
  if (body === null) return { feed: unreachableFeed(hub, HUB_MESSAGES.tooLarge), held: [] };
  return splitFeed(hub, 200, body, (opts.now ?? Date.now)());
}

/* ---------------------------------------------------------------- the countdown */

/** Seconds left now, on the local clock from when it was read. */
export const secondsLeftNow = (c: Pick<VetoCall, 'secondsLeft' | 'readAt'>, now: number = Date.now()): number =>
  Math.max(0, Math.ceil(c.secondsLeft - (now - c.readAt) / 1000));

export const vetoPhase = (secondsLeft: number): VetoPhase => (secondsLeft <= 0 ? 'running' : secondsLeft <= VETO_WARNING_SECONDS ? 'warning' : 'held');

/** 2:59, 0:05 */
export const formatCountdown = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Which notifications to send now: for each held call, every phase it has reached that wasn't sent yet (`sent` holds
 * `<id>:<phase>`). A call first seen already in its warning time gets one notification for that phase, not two. Returns the
 * notifications and the new sent list (ids no longer held drop out, except those that reached running).
 */
export function notifyPlan(sent: readonly string[], calls: readonly VetoCall[], now: number = Date.now()): { send: { call: VetoCall; phase: VetoPhase }[]; sent: string[] } {
  const was = new Set(sent);
  const next = new Set<string>();
  const send: { call: VetoCall; phase: VetoPhase }[] = [];
  for (const c of calls) {
    const phase = vetoPhase(secondsLeftNow(c, now));
    const reached = VETO_PHASES.slice(0, VETO_PHASES.indexOf(phase) + 1);
    const fresh = reached.filter((p) => !was.has(`${c.id}:${p}`));
    reached.forEach((p) => next.add(`${c.id}:${p}`));
    if (fresh.length) send.push({ call: c, phase: fresh[fresh.length - 1]! });
  }
  return { send, sent: [...next].slice(-600) };
}

/* ---------------------------------------------------------------- pushes */

export interface VetoPush { phase: VetoPhase; call: VetoCall }

/** A hub push `{type: "veto", phase, id, …}` → the call and its phase; null for anything else. */
export function vetoFromPush(base: string, raw: unknown, now: number = Date.now()): VetoPush | null {
  let p: unknown = raw;
  if (typeof raw === 'string') { try { p = JSON.parse(raw); } catch { return null; } }
  const j = o(p);
  if (!j || j.type !== 'veto' || !VETO_PHASES.includes(j.phase as VetoPhase)) return null;
  const call = vetoOf(base, j, now);
  return call ? { phase: j.phase as VetoPhase, call } : null;
}

/* ---------------------------------------------------------------- the job stream */

export type VetoEvent =
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'state'; state: VetoState }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; state: VetoState; exitCode: number | null };

/** One SSE frame from the job stream → a typed event; null for anything unknown or malformed. */
export function vetoEvent(f: Pick<SseFrame, 'event' | 'data'>): VetoEvent | null {
  let d: Record<string, unknown> | null;
  try { d = o(JSON.parse(f.data)); } catch { return null; }
  if (!d) return null;
  const state = VETO_STATES.includes(d.state as VetoState) ? (d.state as VetoState) : null;
  switch (f.event) {
    case 'countdown': { const v = n(d, 'secondsLeft'); return v === null ? null : { type: 'countdown', secondsLeft: clampSec(v) }; }
    case 'state': return state ? { type: 'state', state } : null;
    case 'output': return { type: 'output', stream: d.stream === 'stderr' ? 'stderr' : 'stdout', text: (s(d, 'text') ?? '').slice(0, VETO_OUTPUT_CAP) };
    case 'done': { const code = n(d, 'exitCode'); return { type: 'done', state: state && isVetoFinal(state) ? state : code === 0 ? 'ran' : 'failed', exitCode: code === null ? null : Math.round(code) }; }
    default: return null;
  }
}

/** Follows a held call's job stream to its end with the app's own hub session; resolves with how it ended (null = cut off). */
export async function followVeto(streamUrl: string, base: string, onEvent: (e: VetoEvent) => void, opts: { fetch?: HubFetch; signal?: AbortSignal } = {}): Promise<VetoState | null> {
  if (!isHub(base, streamUrl)) throw new Error('Not a hub stream.');
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const r = await f(streamUrl, { credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'text/event-stream' }, signal: opts.signal });
  if (r.status !== 200) throw new Error(HUB_MESSAGES.answered.replace('{status}', String(r.status)));
  let end: VetoState | null = null;
  await readSse(r, (fr) => { const e = vetoEvent(fr); if (!e) return; if (e.type === 'done') end = e.state; onEvent(e); }, opts.signal);
  return end;
}

/* ---------------------------------------------------------------- deny */

/**
 * Denies a held call from a page on the hub's own origin (the AXHub web app): the session's CSRF value from
 * `/auth/api/session`, then `POST <denyUrl>`. Other origins can't (the hub checks Origin): they open `call.url`.
 */
export async function denyVeto(base: string, id: string, opts: { fetch?: HubFetch; csrf?: string } = {}): Promise<{ ok: boolean; state?: VetoState; error?: string }> {
  const url = vetoDenyUrl(base, id);
  if (!url) return { ok: false, error: 'Not an approval id.' };
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  try {
    let csrf = opts.csrf;
    if (!csrf) {
      const sr = await f(`${base}/auth/api/session`, { credentials: 'include', cache: 'no-store', redirect: 'error' });
      csrf = s(o(await sr.json().catch(() => null)), 'csrf') ?? undefined;
      if (!csrf) return { ok: false, error: 'Sign in to axHub to deny it.' };
    }
    const r = await f(url, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-AxHub-CSRF': csrf }, body: '{}' });
    const j = o(await r.json().catch(() => null));
    const state = VETO_STATES.includes(j?.state as VetoState) ? (j!.state as VetoState) : undefined;
    if (r.status === 200) return { ok: true, state: state ?? 'denied' };
    return { ok: false, state, error: s(o(j?.error), 'message') ?? HUB_MESSAGES.answered.replace('{status}', String(r.status)) };
  } catch (e) {
    return { ok: false, error: ((e as Error)?.message || HUB_MESSAGES.unreachable).slice(0, 120) };
  }
}

/** The approvals page (for "open on the hub" links). */
export const vetoApprovalsUrl = approvalsUrl;
