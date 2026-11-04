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

/**
 * How a decision can reach axHub from here, best first. `frame` only when the hub lets this origin frame its approval
 * page (its CSP `frame-ancestors`, AXHUB_APPROVALS_FRAME_ANCESTORS); otherwise the browser refuses the frame and draws
 * its own error face in the pop-up (Nov 4 2026), so the page opens on axHub instead (`open`).
 */
export type DecideRoute = 'host' | 'hub' | 'frame' | 'open';

export interface DecideEnv {
  hub: string;
  /** This page's origin (decisions go directly only from the hub's own origin). */
  origin: string;
  /** The app's native side can act on held calls with its own hub session (AmberX's phone shell). */
  vetoAct?: (id: string, action: 'deny' | 'approve-now') => Promise<VetoActionResult>;
  /** The app's own approvals path (AmberX's hub web view). */
  approvalDecide?: (item: ApprovalItem, d: ApprovalDecision) => Promise<DecideResult>;
  /** The hub frames its approval page for this origin (lib-approvals host `frame`); off by default. */
  frame?: boolean;
  fetch?: HubFetch;
}

/**
 * Which route a decision takes: the app's host, else directly on the hub's origin, else the hub's page (framed when the
 * hub allows this origin to frame it, else opened on axHub).
 */
export function routeOf(item: Pick<ApprovalItem, 'kind'>, env: Pick<DecideEnv, 'hub' | 'origin' | 'vetoAct' | 'approvalDecide' | 'frame'>): DecideRoute {
  if (item.kind === 'held' ? env.vetoAct : env.approvalDecide) return 'host';
  if (canDecideHere(env.hub, env.origin)) return 'hub';
  return env.frame === true ? 'frame' : 'open';
}

export interface FollowDecision {
  ok: boolean; message: string; route: DecideRoute;
  /** the hub's own page must take this tap, shown framed (only where the hub allows the frame) */ frame?: boolean;
  /** the hub's own page must take this tap, opened on axHub */ open?: boolean;
}

const OPEN_MESSAGE = 'Opened on axHub: approve or deny it there.';

/**
 * One tap on Approve or Deny. Held calls: Approve runs it now, Deny stops it (veto@1); approvals: approve / decline.
 * Signed as Brett: the host's hub session or the hub's own session cookie with its CSRF value. Never from a token, and
 * nothing here runs without a tap.
 */
export async function decide(item: ApprovalItem, approve: boolean, env: DecideEnv): Promise<FollowDecision> {
  const route = routeOf(item, env);
  if (route === 'frame') return { ok: false, route, frame: true, message: 'Confirm it on axHub\'s own page below.' };
  if (route === 'open') return { ok: false, route, open: true, message: OPEN_MESSAGE };
  if (item.kind === 'held') {
    const action = approve ? 'approve-now' : 'deny';
    const r = route === 'host' && env.vetoAct ? await env.vetoAct(item.id, action).catch((e) => ({ ok: false, error: String((e as Error)?.message ?? e) }) as VetoActionResult)
      : await vetoAction(env.hub, item.id, action, { fetch: env.fetch });
    return r.ok ? { ok: true, route, message: `${approve ? 'Approved, running now' : 'Denied'}: ${item.title}` } : { ok: false, route, message: r.error ?? 'axHub refused.' };
  }
  const d: ApprovalDecision = approve ? 'approve' : 'decline';
  const r = route === 'host' && env.approvalDecide ? await env.approvalDecide(item, d) : await decideOnHub(env.hub, item, d, { fetch: env.fetch, origin: env.origin });
  if (r.opened) return env.frame === true ? { ok: false, route: 'frame', frame: true, message: r.message || 'Confirm it on axHub\'s own page below.' } : { ok: false, route: 'open', open: true, message: r.message || OPEN_MESSAGE };
  return { ok: r.ok, route, message: r.message };
}

/** May this button act at all (the hub lists what each item offers; a held call's Approve = run it now)? */
export const offers = (item: Pick<ApprovalItem, 'decisions'>, approve: boolean): boolean =>
  approve ? item.decisions.includes('approve') : item.decisions.includes('deny') || item.decisions.includes('decline');

/* ---------------------------------------------------------------- drawing safely */

const text = (v: unknown, cap = 600): string => {
  if (typeof v === 'string') return v.slice(0, cap);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object') { const t = (v as { title?: unknown }).title; if (typeof t === 'string') return t.slice(0, cap); try { return JSON.stringify(v).slice(0, cap); } catch { return ''; } }
  return '';
};

/**
 * The item with every field the pop-up draws forced into shape (strings, a decisions list), so one bad field from the hub
 * (a reason object where a title string belongs, a missing list) can never crash the pop-up: it shows the raw call.
 */
export function drawable(raw: unknown): ApprovalItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as Record<string, unknown>;
  const id = text(i.id, 80);
  if (!id) return null;
  const tool = text(i.tool, 120) || 'call';
  const decisions = Array.isArray(i.decisions) ? (i.decisions.filter((d) => d === 'approve' || d === 'deny' || d === 'decline') as ApprovalDecision[]) : [];
  const source = i.source && typeof i.source === 'object' ? i.source as ApprovalItem['source'] : null;
  return {
    ...(i as unknown as ApprovalItem),
    kind: i.kind === 'held' ? 'held' : 'approval', id, tool,
    title: text(i.title, 200) || `Run ${tool}`, description: text(i.description), summary: text(i.summary, 2000), command: text(i.command, 2000),
    createdAt: text(i.createdAt, 40), url: text(i.url, 400), decisions: decisions.length ? decisions : i.kind === 'held' ? ['deny'] : ['approve', 'decline'],
    source: source && typeof source.label === 'string' ? source : null,
    veto: i.veto && typeof i.veto === 'object' ? (i.veto as ApprovalItem['veto']) : null,
  };
}

