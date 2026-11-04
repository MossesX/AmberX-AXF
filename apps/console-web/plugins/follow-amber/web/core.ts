/**
 * Follow Amber (web) — the pure part, no React: the follow-amber@1 frames the server sends, the approvals queue the
 * pop-up shows, and how one decision reaches axHub. The plugin's index.tsx draws it; test.mts drives it with a fake hub.
 */
import { decideOnHub, canDecideHere, type ApprovalDecision, type ApprovalItem, type DecideResult } from '@console/axf/libs/approvals/core';
import { vetoAction, type VetoActionResult } from '@console/axf/libs/hub/veto';
import type { HubFetch } from '@console/axf/libs/hub/hub';

export const FOLLOW_FRAME = 'follow-amber@1';

/** What the server sends down a follow stream. */
export type FollowFrame =
  | { $axf: typeof FOLLOW_FRAME; type: 'state'; on: boolean; by?: string; at?: string }
  | { $axf: typeof FOLLOW_FRAME; type: 'show'; kind: string; target: string; label?: string; highlight?: string; say?: string; by?: string }
  | { $axf: typeof FOLLOW_FRAME; type: 'approval'; id?: string; say?: string; by?: string };

const str = (v: unknown, cap = 300) => (typeof v === 'string' ? v.slice(0, cap) : '');

/** A frame from the stream, or null when it isn't one this client runs. */
export function parseFrame(raw: unknown): FollowFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (f.$axf !== FOLLOW_FRAME) return null;
  if (f.type === 'state' && typeof f.on === 'boolean') return { $axf: FOLLOW_FRAME, type: 'state', on: f.on, by: str(f.by, 80), at: str(f.at, 40) };
  if (f.type === 'show' && typeof f.target === 'string' && f.target) {
    return { $axf: FOLLOW_FRAME, type: 'show', kind: str(f.kind, 20), target: str(f.target, 200), label: str(f.label, 200), highlight: str(f.highlight, 200), say: str(f.say), by: str(f.by, 80) };
  }
  if (f.type === 'approval') return { $axf: FOLLOW_FRAME, type: 'approval', id: str(f.id, 80), say: str(f.say), by: str(f.by, 80) };
  return null;
}

/** A highlight is a CSS selector when it looks like one (#id, .class, [attr], tag.class), else exact visible text. */
export const highlightIsSelector = (h: string): boolean => /^[#.[]/.test(h.trim()) || /^[a-z][a-z0-9-]*[#.[:]/i.test(h.trim());

/* ---------------------------------------------------------------- the approvals queue */

/**
 * What waits for Brett, in the order the pop-up shows it: held calls first (soonest to run first), then approvals
 * (oldest first). Shelved and approved-now held calls wait quietly and are left out; so is anything already decided here.
 */
export function queueOf(items: readonly ApprovalItem[], decided: ReadonlySet<string> = new Set()): ApprovalItem[] {
  const live = items.filter((i) => !decided.has(i.id) && !(i.kind === 'held' && (i.veto?.shelved || i.veto?.approvedNow)));
  const held = live.filter((i) => i.kind === 'held').sort((a, b) => (a.veto?.secondsLeft ?? 0) - (b.veto?.secondsLeft ?? 0));
  const asks = live.filter((i) => i.kind !== 'held').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...held, ...asks];
}

/** The queue's next item: the one Amber named (when it is waiting), else the first. */
export const pickNext = (queue: readonly ApprovalItem[], wanted = ''): ApprovalItem | null => queue.find((i) => i.id === wanted) ?? queue[0] ?? null;

/** Ids that just arrived (not seen before): these pop up. */
export const arrived = (seen: ReadonlySet<string>, queue: readonly ApprovalItem[]): string[] => queue.map((i) => i.id).filter((id) => !seen.has(id));

/* ---------------------------------------------------------------- deciding */

/** How a decision can reach axHub from here, best first. */
export type DecideRoute = 'host' | 'hub' | 'frame';

export interface DecideEnv {
  hub: string;
  /** This page's origin (decisions go directly only from the hub's own origin). */
  origin: string;
  /** The app's native side can act on held calls with its own hub session (AmberX's phone shell). */
  vetoAct?: (id: string, action: 'deny' | 'approve-now') => Promise<VetoActionResult>;
  /** The app's own approvals path (AmberX's hub web view). */
  approvalDecide?: (item: ApprovalItem, d: ApprovalDecision) => Promise<DecideResult>;
  fetch?: HubFetch;
}

/** Which route a decision takes: the app's host, else directly on the hub's origin, else the hub's page in a frame. */
export function routeOf(item: Pick<ApprovalItem, 'kind'>, env: Pick<DecideEnv, 'hub' | 'origin' | 'vetoAct' | 'approvalDecide'>): DecideRoute {
  if (item.kind === 'held' ? env.vetoAct : env.approvalDecide) return 'host';
  if (canDecideHere(env.hub, env.origin)) return 'hub';
  return 'frame';
}

export interface FollowDecision { ok: boolean; message: string; route: DecideRoute; /** the hub's own page must take this tap (shown framed) */ frame?: boolean }

/**
 * One tap on Approve or Deny. Held calls: Approve runs it now, Deny stops it (veto@1); approvals: approve / decline.
 * Signed as Brett: the host's hub session or the hub's own session cookie with its CSRF value. Never from a token, and
 * nothing here runs without a tap.
 */
export async function decide(item: ApprovalItem, approve: boolean, env: DecideEnv): Promise<FollowDecision> {
  const route = routeOf(item, env);
  if (route === 'frame') return { ok: false, route, frame: true, message: 'Confirm it on axHub\'s own page below.' };
  if (item.kind === 'held') {
    const action = approve ? 'approve-now' : 'deny';
    const r = route === 'host' && env.vetoAct ? await env.vetoAct(item.id, action).catch((e) => ({ ok: false, error: String((e as Error)?.message ?? e) }) as VetoActionResult)
      : await vetoAction(env.hub, item.id, action, { fetch: env.fetch });
    return r.ok ? { ok: true, route, message: `${approve ? 'Approved, running now' : 'Denied'}: ${item.title}` } : { ok: false, route, message: r.error ?? 'axHub refused.' };
  }
  const d: ApprovalDecision = approve ? 'approve' : 'decline';
  const r = route === 'host' && env.approvalDecide ? await env.approvalDecide(item, d) : await decideOnHub(env.hub, item, d, { fetch: env.fetch, origin: env.origin });
  if (r.opened) return { ok: false, route: 'frame', frame: true, message: r.message || 'Confirm it on axHub\'s own page below.' };
  return { ok: r.ok, route, message: r.message };
}

/** May this button act at all (the hub lists what each item offers; a held call's Approve = run it now)? */
export const offers = (item: Pick<ApprovalItem, 'decisions'>, approve: boolean): boolean =>
  approve ? item.decisions.includes('approve') : item.decisions.includes('deny') || item.decisions.includes('decline');
