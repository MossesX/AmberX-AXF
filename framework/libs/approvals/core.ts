/**
 * lib-approvals (web) — the pure part: one list of everything axHub is waiting on, for any AXF app's title bar badge
 * (Brett, Oct 28 2026: "Make approvals pop up in the assistant's title bar, click to approve").
 *
 * Built over what already exists, no new contract (the Fable contract step approval-badge@1 was skipped):
 *  - lib-hub's approvals feed (`hub.ts`: `interpretFeed`, decision #85) and veto@1 (`veto.ts`: `splitFeed`, held calls);
 *  - the extra fields the hub's feed entries carry (axHub decision #99): `title` / `reason.title`, `description` /
 *    `reason.description`, `actions`, `revision`, read again from the same reply body (hub.ts stays unchanged);
 *  - the hub's decide route `POST /auth/api/approvals/<id>` `{action, rev}` (the AXHub web app's `act`) and veto@1's Deny.
 *    Both need the hub's own Origin + `X-AxHub-CSRF`, so only a page on the hub can send them; every other app opens
 *    the approval page (in a frame where the hub allows it, `AXHUB_APPROVALS_FRAME_ANCESTORS`) or hands the decision to
 *    its own deciding path (the AmberX phone: the signed-in hub web view, native Deny).
 *
 * Held (veto) calls offer Deny, and Approve (run it now, veto@1 `approve-now`, decision 104) when the hub lists it.
 *
 * Every link is rebuilt from the ids (lib-hub rule); nothing here holds a token. Node tests import this file directly
 * (`framework/spec/check-approvals.mts`). Kotlin twin: none (Android framework work is on hold; recorded in PORTING.md).
 */
import { HUB_FIELD_CAPS, HUB_MESSAGES, approvalsUrl, hubOrigin, isApprovalId, type HubFeedStatus, type HubFetch } from '../hub/hub';
import { formatCountdown, secondsLeftNow, splitFeed, vetoAction, type VetoCall } from '../hub/veto';

export const APPROVALS_LIBRARY_ID = 'ai.amberx.axf.approvals';
/** Default poll period while the page is visible (the console banner and AmberX read the feed every 5 s too). */
export const APPROVALS_POLL_MS = 5_000;
export const APPROVALS_POLL_MIN_MS = 2_000;
export const APPROVALS_POLL_MAX_MS = 300_000;
export const APPROVALS_TITLE_CAP = 200;
export const APPROVALS_DESCRIPTION_CAP = 600;
/** Window event every watcher answers with a check now (same name lib-hub's react part uses). */
export const APPROVALS_CHECK_EVENT = 'axf:hub-check';
/** Window event asking a mounted badge to open its popover (`detail.id` optional: that item first). */
export const APPROVALS_OPEN_EVENT = 'axf:approvals-open';

export type ApprovalKind = 'approval' | 'held';
export type ApprovalDecision = 'approve' | 'decline' | 'deny';
/** Approve / Deny on every row (Brett, Oct 30 2026): a decline reads Deny too. */
export const DECISION_LABELS: Record<ApprovalDecision, string> = { approve: 'Approve', decline: 'Deny', deny: 'Deny' };

/** One thing the hub is waiting on: a call waiting for an approval, or a held (veto) call counting down. */
export interface ApprovalItem {
  kind: ApprovalKind;
  id: string;
  tool: string;
  /** What is being approved, one line (the caller's reason title, else "Run <tool>"). */
  title: string;
  /** What it does and why ('' when the caller gave none). */
  description: string;
  summary: string;
  command: string;
  createdAt: string;
  expiresAt: string;
  /** The approval page on the hub (rebuilt from the id). */
  url: string;
  /** What can be decided: approvals approve/decline (as the hub lists them), held calls deny (+ approve = run it now). */
  decisions: ApprovalDecision[];
  /** The hub's revision for the decide route (null when the feed didn't send one). */
  revision: number | null;
  /** Held calls: the countdown (seconds left at `readAt`, local clock). */
  veto: VetoCall | null;
}

export type ApprovalsStatus = 'idle' | HubFeedStatus;

export interface ApprovalsState {
  status: ApprovalsStatus;
  hub: string;
  /** Everything waiting: held calls + approvals (the hub's count, never less than the items kept). */
  count: number;
  /** Held calls first (soonest to run), then approvals in the hub's order. */
  items: ApprovalItem[];
  approvalsUrl: string;
  error: string;
  /** Local clock (ms) of the last answer, null before the first. */
  checkedAt: number | null;
}

export const emptyApprovals = (hub: string, status: ApprovalsStatus = 'idle', error = ''): ApprovalsState =>
  ({ status, hub, count: 0, items: [], approvalsUrl: approvalsUrl(hub), error, checkedAt: null });

const o = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const s = (r: Record<string, unknown> | null, k: string): string | null => (r && typeof r[k] === 'string' ? (r[k] as string) : null);
const oneLine = (t: string, cap: number) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);

interface Extra { title: string; description: string; actions: string[] | null; revision: number | null }

/** The decision fields of each feed entry, by id (the hub's `title`/`reason`, `actions`, `revision`). */
function extras(body: string): Map<string, Extra> {
  const out = new Map<string, Extra>();
  let j: Record<string, unknown> | null = null;
  try { j = o(JSON.parse(body)); } catch { return out; }
  for (const e of Array.isArray(j?.pending) ? (j!.pending as unknown[]) : []) {
    const p = o(e);
    const id = s(p, 'id');
    if (!p || !id || out.has(id)) continue;
    const reason = o(p.reason);
    const rev = typeof p.revision === 'number' && Number.isFinite(p.revision) ? Math.floor(p.revision) : null;
    out.set(id, {
      title: oneLine(s(p, 'title') ?? s(reason, 'title') ?? '', APPROVALS_TITLE_CAP),
      description: (s(p, 'description') ?? s(reason, 'description') ?? '').trim().slice(0, APPROVALS_DESCRIPTION_CAP),
      actions: Array.isArray(p.actions) ? p.actions.filter((a): a is string => typeof a === 'string') : null,
      revision: rev,
    });
  }
  return out;
}

/** The command out of a hub summary (`… "command":"…"`), for one short line. */
export function commandOfSummary(summary: string): string {
  const m = /"command":"((?:[^"\\]|\\.)*)"/.exec(summary);
  return m ? m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
}

/** A held call's decisions from its veto actions: Deny, and Approve when the hub offers `approve-now` (deny first). */
export const heldDecisions = (c: Pick<VetoCall, 'actions'>): ApprovalDecision[] =>
  [...(c.actions.includes('deny') ? ['deny' as const] : []), ...(c.actions.includes('approve-now') ? ['approve' as const] : [])];

/** Row order (Brett, Oct 30 2026: Approve / Deny on every row): the safe one first, so Deny / Decline sit left of Approve. */
export const rowOrder = (ds: readonly ApprovalDecision[]): ApprovalDecision[] => [...ds.filter((d) => d !== 'approve'), ...ds.filter((d) => d === 'approve')];

/** Approve/decline as the hub lists them for this entry (both when it sent no list), approve first. */
export function decisionsOf(actions: readonly string[] | null): ApprovalDecision[] {
  if (!actions) return ['approve', 'decline'];
  const out: ApprovalDecision[] = [];
  if (actions.includes('approve')) out.push('approve');
  if (actions.includes('decline')) out.push('decline');
  return out;
}

/**
 * What a reply from the approvals feed means, as one list: held calls (countdown + Deny) and calls waiting for an
 * approval (Approve / Decline), with titles and descriptions. Status mapping, link checks and caps are lib-hub's.
 */
export function interpretApprovals(base: string, status: number, body: string, now: number = Date.now()): ApprovalsState {
  const { feed, held } = splitFeed(base, status, body, now);
  if (feed.status !== 'ok') return { ...emptyApprovals(base, feed.status, feed.error), checkedAt: now };
  const ex = extras(body);
  const items: ApprovalItem[] = [];
  for (const c of held) {
    const e = ex.get(c.id);
    items.push({
      kind: 'held', id: c.id, tool: c.tool, title: e?.title || c.title || `Run ${c.tool}`, description: e?.description ?? '',
      summary: c.summary, command: c.command, createdAt: '', expiresAt: c.runsAt, url: c.url, decisions: heldDecisions(c), revision: e?.revision ?? null, veto: c,
    });
  }
  for (const p of feed.pending) {
    const e = ex.get(p.id);
    items.push({
      kind: 'approval', id: p.id, tool: p.tool, title: e?.title || `Run ${p.tool}`.slice(0, APPROVALS_TITLE_CAP), description: e?.description ?? '',
      summary: p.summary, command: commandOfSummary(p.summary).slice(0, HUB_FIELD_CAPS.summary), createdAt: p.createdAt, expiresAt: p.expiresAt,
      url: p.url, decisions: decisionsOf(e?.actions ?? null), revision: e?.revision ?? null, veto: null,
    });
  }
  return { status: 'ok', hub: base, count: Math.max(feed.count + held.length, items.length), items, approvalsUrl: feed.approvalsUrl, error: '', checkedAt: now };
}

/* ---------------------------------------------------------------- words and times */

/** Seconds since the call was made (0 when the time is missing or in the future). */
export function ageSeconds(createdAt: string, now: number = Date.now()): number {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
}

/** 12 s, 3 min, 2 h, 4 d */
export function formatAge(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return t < 60 ? `${t} s` : t < 3600 ? `${Math.floor(t / 60)} min` : t < 86_400 ? `${Math.floor(t / 3600)} h` : `${Math.floor(t / 86_400)} d`;
}

/** Seconds a held call has left now (null for an approval). */
export const countdownOf = (item: ApprovalItem, now: number = Date.now()): number | null => (item.veto ? secondsLeftNow(item.veto, now) : null);

/** The line under an item's title: "Runs in 2:40" for a held call, "vps.run · 3 min ago" for an approval. */
export function itemLine(item: ApprovalItem, now: number = Date.now()): string {
  const left = countdownOf(item, now);
  if (left !== null) return left > 0 ? `Runs in ${formatCountdown(left)}` : 'Running';
  return `${item.tool}${item.createdAt ? ` · ${formatAge(ageSeconds(item.createdAt, now))} ago` : ''}`;
}

/** The badge's words: "3 waiting", "1 held · 2:40". Empty when nothing is waiting (nothing is drawn then). */
export function badgeText(st: ApprovalsState, now: number = Date.now()): string {
  if (st.status !== 'ok' || st.count === 0) return '';
  const held = st.items.filter((i) => i.kind === 'held');
  const soonest = held.length ? Math.min(...held.map((h) => countdownOf(h, now) ?? 0)) : null;
  return soonest !== null && held.length === st.count ? `${st.count} held · ${formatCountdown(soonest)}` : `${st.count} waiting`;
}

/** The badge's accessible name. */
export function badgeLabel(st: ApprovalsState): string {
  const held = st.items.filter((i) => i.kind === 'held').length;
  const waiting = Math.max(0, st.count - held);
  const parts = [waiting ? `${waiting} approval${waiting === 1 ? '' : 's'} waiting` : '', held ? `${held} held command${held === 1 ? '' : 's'} counting down` : ''].filter(Boolean);
  return parts.length ? `${parts.join(', ')} on axHub` : 'Nothing waiting on axHub';
}

/** Is any held call 30 s or less from running (the badge turns urgent)? */
export const isUrgent = (st: ApprovalsState, now: number = Date.now()): boolean =>
  st.items.some((i) => { const l = countdownOf(i, now); return l !== null && l <= 30; });

/** Ids in `next` that weren't in `prev` (each new item pops up once). */
export const freshIds = (prev: readonly string[], next: readonly ApprovalItem[]): string[] => next.map((i) => i.id).filter((id) => !prev.includes(id));
/** Ids in `prev` gone from `next` (decided or expired: their result toast). */
export const goneIds = (prev: readonly string[], next: readonly ApprovalItem[]): string[] => { const ids = new Set(next.map((i) => i.id)); return prev.filter((id) => !ids.has(id)); };

/* ---------------------------------------------------------------- deciding */

/** The decide route for one approval, null for a bad id. */
export const decisionUrl = (base: string, id: unknown): string | null => (isApprovalId(id) ? `${base}/auth/api/approvals/${id}` : null);

/** Can a page at `origin` send decisions itself? Only a page on the hub's own origin (the hub checks Origin + CSRF). */
export const canDecideHere = (base: string, origin: unknown): boolean => { const a = hubOrigin(base); return !!a && a === hubOrigin(origin); };

export interface DecideResult {
  ok: boolean;
  /** The hub's words or ours, for the result toast. */
  message: string;
  /** Opened the approval page instead (in a frame or a hub view): the result comes when it leaves the feed. */
  opened?: boolean;
}

/** May this decision be made on this item at all (held calls: deny / approve-now as the hub lists; approvals: likewise)? */
export const allowed = (item: ApprovalItem, d: ApprovalDecision): boolean => item.decisions.includes(d);

/**
 * Sends a decision from a page on the hub's own origin: Deny through veto@1, Approve / Decline through the hub's decide
 * route with the session's CSRF value. Other origins get `ok: false` (they open the page instead).
 */
export async function decideOnHub(base: string, item: ApprovalItem, d: ApprovalDecision, opts: { fetch?: HubFetch; csrf?: string; origin?: string } = {}): Promise<DecideResult> {
  if (!allowed(item, d)) return { ok: false, message: item.kind === 'held' ? `The hub doesn't offer ${DECISION_LABELS[d]} for this held command now.` : `The hub doesn't offer ${DECISION_LABELS[d]} for this one.` };
  const origin = opts.origin ?? (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!canDecideHere(base, origin)) return { ok: false, message: 'Only a page on axHub can decide; open it there.' };
  if (item.kind === 'held') {
    // veto@1: Deny stops it, Approve runs it now (decision 104); both on the hub's own routes.
    const r = await vetoAction(base, item.id, d === 'approve' ? 'approve-now' : 'deny', { fetch: opts.fetch, csrf: opts.csrf });
    return r.ok ? { ok: true, message: `${d === 'approve' ? 'Approved, running now' : 'Denied'}: ${item.title}` } : { ok: false, message: r.error ?? 'The hub refused.' };
  }
  const url = decisionUrl(base, item.id);
  if (!url) return { ok: false, message: 'Not an approval id.' };
  const f: HubFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  try {
    let csrf = opts.csrf;
    if (!csrf) {
      const sr = await f(`${base}/auth/api/session`, { credentials: 'include', cache: 'no-store', redirect: 'error' });
      csrf = s(o(await sr.json().catch(() => null)), 'csrf') ?? undefined;
      if (!csrf) return { ok: false, message: 'Sign in to axHub to decide.' };
    }
    const r = await f(url, {
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-AxHub-CSRF': csrf },
      body: JSON.stringify({ action: d, ...(item.revision !== null ? { rev: item.revision } : {}) }),
    });
    const j = o(await r.json().catch(() => null));
    if (r.status === 200) return { ok: true, message: s(j, 'message') ?? `${d === 'approve' ? 'Approved' : 'Declined'}: ${item.title}` };
    return { ok: false, message: s(o(j?.error), 'message') ?? s(j, 'message') ?? HUB_MESSAGES.answered.replace('{status}', String(r.status)) };
  } catch (e) {
    return { ok: false, message: ((e as Error)?.message || HUB_MESSAGES.unreachable).slice(0, 120) };
  }
}

/** The toast after an item the user acted on left the feed. */
export const goneMessage = (item: Pick<ApprovalItem, 'kind' | 'title'>): string =>
  item.kind === 'held' ? `${item.title}: no longer held (denied, run or expired).` : `${item.title}: decided on axHub.`;
