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
  | { $axf: typeof FOLLOW_FRAME; type: 'show'; id?: string; kind: string; target: string; label?: string; highlight?: string; say?: string; by?: string }
  | { $axf: typeof FOLLOW_FRAME; type: 'approval'; id?: string; say?: string; by?: string };

const str = (v: unknown, cap = 300) => (typeof v === 'string' ? v.slice(0, cap) : '');

/** A frame from the stream, or null when it isn't one this client runs. */
export function parseFrame(raw: unknown): FollowFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (f.$axf !== FOLLOW_FRAME) return null;
  if (f.type === 'state' && typeof f.on === 'boolean') return { $axf: FOLLOW_FRAME, type: 'state', on: f.on, by: str(f.by, 80), at: str(f.at, 40) };
  if (f.type === 'show' && typeof f.target === 'string' && f.target) {
    return { $axf: FOLLOW_FRAME, type: 'show', id: str(f.id, 40), kind: str(f.kind, 20), target: str(f.target, 200), label: str(f.label, 200), highlight: str(f.highlight, 200), say: str(f.say), by: str(f.by, 80) };
  }
  if (f.type === 'approval') return { $axf: FOLLOW_FRAME, type: 'approval', id: str(f.id, 80), say: str(f.say), by: str(f.by, 80) };
  return null;
}

/** A highlight is a CSS selector when it looks like one (#id, .class, [attr], tag.class), else exact visible text. */
export const highlightIsSelector = (h: string): boolean => /^[#.[]/.test(h.trim()) || /^[a-z][a-z0-9-]*[#.[:]/i.test(h.trim());

/* ---------------------------------------------------------------- the flash (Brett, Nov 4 2026) */

/** How the referenced item flashes: on/off, the two colours ('' = the colour theme's flash-a / flash-b), count, speed. */
export interface FlashPrefs { on: boolean; colorA: string; colorB: string; count: number; speed: FlashSpeed }
export type FlashSpeed = 'slow' | 'normal' | 'fast';
/** One flash every N ms; 5 flashes at normal = 2.5 s. */
export const FLASH_PERIOD_MS: Record<FlashSpeed, number> = { slow: 750, normal: 500, fast: 300 };
export const FLASH_COUNT = { min: 1, max: 10, default: 5 } as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Settings values → prefs (anything missing or odd falls back to the default). A colour left at its default (`defA` /
 *  `defB`, the engine's FLASH_DEFAULTS) means "follow the colour theme", so a theme swap still recolours the flash. */
export function flashPrefs(get: (k: string) => unknown, defA = '', defB = ''): FlashPrefs {
  const n = Number(get('follow-amber.flash.count'));
  const sp = get('follow-amber.flash.speed');
  const col = (v: unknown, def: string) => (typeof v === 'string' && HEX.test(v) && v.toLowerCase() !== def.toLowerCase() ? v : '');
  return {
    on: get('follow-amber.flash') !== false,
    colorA: col(get('follow-amber.flash.colorA'), defA),
    colorB: col(get('follow-amber.flash.colorB'), defB),
    count: Number.isFinite(n) && n >= FLASH_COUNT.min ? Math.min(FLASH_COUNT.max, Math.round(n)) : FLASH_COUNT.default,
    speed: sp === 'slow' || sp === 'fast' ? sp : 'normal',
  };
}

/** The inline custom properties the `fx-attn-flash` class reads (framework/ui/axf.css). */
export function flashStyle(p: FlashPrefs): Record<string, string> {
  return {
    '--axf-attn-count': String(p.count),
    '--axf-attn-period': `${FLASH_PERIOD_MS[p.speed]}ms`,
    ...(p.colorA ? { '--axf-attn-a': p.colorA } : {}),
    ...(p.colorB ? { '--axf-attn-b': p.colorB } : {}),
  };
}

/** How long the whole flash runs (the class comes off after it). */
export const flashMs = (p: Pick<FlashPrefs, 'count' | 'speed'>): number => p.count * FLASH_PERIOD_MS[p.speed];

/** A place on the page the highlight text could mean. */
export interface FlashCandidate { text: string; /** inside the dialog / window on top */ onTop: boolean; /** on screen now */ visible: boolean; /** document order */ order: number }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** How well a candidate's text matches: 3 exact, 2 starts with, 1 contains, 0 not at all. */
export function matchScore(text: string, want: string): number {
  const t = norm(text), w = norm(want);
  if (!w || !t) return 0;
  if (t === w) return 3;
  if (t.length <= w.length * 4 + 40) { if (t.startsWith(w)) return 2; if (t.includes(w)) return 1; }
  return 0;
}

/**
 * The best match when several items carry the highlight text: exact text first, then the one in the dialog / window on
 * top, then the visible one, then the shortest text (the row itself, not its whole list), then document order.
 * → its index in `cands`, or -1 when nothing matches.
 */
export function pickBest(cands: readonly FlashCandidate[], want: string): number {
  let best = -1, key: number[] = [];
  cands.forEach((c, i) => {
    const s = matchScore(c.text, want);
    if (!s) return;
    const k = [s, c.onTop ? 1 : 0, c.visible ? 1 : 0, -c.text.length, -c.order];
    const j = k.findIndex((v, x) => v !== key[x]);
    if (best < 0 || (j >= 0 && k[j]! > key[j]!)) { best = i; key = k; }
  });
  return best;
}

/** A short label for what flashed (sent back so Amber knows it landed). */
export const flashLabel = (text: string, fallback: string): string => { const t = text.replace(/\s+/g, ' ').trim(); return (t || fallback).slice(0, 80); };

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
