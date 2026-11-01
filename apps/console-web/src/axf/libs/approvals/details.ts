/**
 * lib-approvals (web) — the details of one approval row, for the expandable rows every app shows (Brett, Nov 1 2026:
 * "make every approval row expandable": caret on the far right, tap the row or the caret, it drops open in place with
 * the real details). Pure: no React, no network; Node tests import it (`framework/spec/check-approvals.mts`).
 *
 * One model ({@link ApprovalDetails}) for every surface, built from whatever that surface reads:
 *  - {@link detailsOfItem}: a lib-approvals feed item (the title bar popover, the console banner, AmberX);
 *  - {@link detailsOfHubEntry}: one hub entry as the hub's approvals API shapes it (`approvalView`: the AXHub web app's
 *    grid, the approval page; also a raw feed entry), so the axHub list and the dropdown share the rows.
 *
 * Who asked (axHub decision 108, approval-source): `source { kind, session?, client?, clientVersion?, oauthClient? }`,
 * read tolerantly (absent on an older hub: the row says "Not recorded"). Secrets are already hidden by the hub
 * (connector redaction); nothing here un-hides or adds anything. Every link is rebuilt from the id (lib-hub rule).
 *
 * Expanded state lives in {@link approvalsOpenStore}, keyed by surface + id, outside React: a live refresh (a new feed
 * read, a re-render, even a remount of the list) never folds a row the user opened.
 */
import { approvalUrl } from '../hub/hub';
import { formatCountdown, secondsLeftNow, vetoStreamUrl, type VetoCall } from '../hub/veto';
import type { ApprovalDecision, ApprovalItem } from './core';

/* ---------------------------------------------------------------- who asked */

export type SourceKind = 'claude_ai' | 'claude_code' | 'headless' | 'console' | 'agent' | 'system' | 'unknown';
export const SOURCE_KINDS: readonly SourceKind[] = ['claude_ai', 'claude_code', 'headless', 'console', 'agent', 'system', 'unknown'];
export const SOURCE_LABELS: Record<SourceKind, string> = {
  claude_ai: 'Claude.ai', claude_code: 'Claude Code', headless: 'Headless', console: 'Console', agent: 'Agent', system: 'System', unknown: 'Unknown',
};
/** Icon per source (framework icon names). */
export const SOURCE_ICONS: Record<SourceKind, string> = {
  claude_ai: 'sparkles', claude_code: 'terminal', headless: 'rocket', console: 'monitor', agent: 'user', system: 'shield', unknown: 'info',
};
/** The `X-Axhub-Session` pattern (decision 108). */
export const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/;

export interface ApprovalSource { kind: SourceKind; session?: string; client?: string; clientVersion?: string; oauthClient?: string }

const o = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (r: Record<string, unknown> | null, k: string): string | null => (r && typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string) : null);
const num = (r: Record<string, unknown> | null, k: string): number | null => (r && typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : null);
const clean = (t: string, cap: number) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);
const iso = (v: string | null): string => (v && Number.isFinite(Date.parse(v)) ? v : '');

/** The source an entry carries (`source`, or the older `caller.source`); null when the hub recorded none. */
export function sourceOf(raw: unknown): ApprovalSource | null {
  const p = o(raw);
  const s = o(p?.source) ?? o(o(p?.caller)?.source);
  if (!s) return null;
  const kind = SOURCE_KINDS.includes(s.kind as SourceKind) ? (s.kind as SourceKind) : 'unknown';
  const session = str(s, 'session');
  const out: ApprovalSource = { kind };
  if (session && SESSION_NAME.test(session)) out.session = session;
  for (const [k, cap] of [['client', 80], ['clientVersion', 40], ['oauthClient', 80]] as const) { const v = str(s, k); if (v) out[k] = clean(v, cap); }
  return out;
}

/** "Claude Code 2.1.4" / "claude.ai" — the client line (empty when the hub recorded none). */
export const clientLine = (s: ApprovalSource | null): string =>
  s ? [s.client ? `${s.client}${s.clientVersion ? ` ${s.clientVersion}` : ''}` : '', s.oauthClient && s.oauthClient !== s.client ? `OAuth: ${s.oauthClient}` : ''].filter(Boolean).join(' · ') : '';

/* ---------------------------------------------------------------- the model */

export type ApprovalPolicy = 'veto' | 'confirm';
export const POLICY_LABELS: Record<ApprovalPolicy, string> = { veto: 'Veto (runs unless denied)', confirm: 'Confirm (waits for approval)' };

/** Where it is now (the hub's status, or the veto state for a held call). */
export type ApprovalPhase = 'pending' | 'postponed' | 'held' | 'shelved' | 'running' | 'ran' | 'failed' | 'approved' | 'used' | 'denied' | 'declined' | 'expired' | 'revoked' | 'ignored' | 'unknown';
const PHASES: readonly ApprovalPhase[] = ['pending', 'postponed', 'held', 'shelved', 'running', 'ran', 'failed', 'approved', 'used', 'denied', 'declined', 'expired', 'revoked', 'ignored'];
export const PHASE_LABELS: Record<ApprovalPhase, string> = {
  pending: 'Waiting', postponed: 'Postponed', held: 'Counting down', shelved: 'Shelved', running: 'Running', ran: 'Ran', failed: 'Failed',
  approved: 'Approved', used: 'Used', denied: 'Denied', declined: 'Declined', expired: 'Expired', revoked: 'Revoked', ignored: 'Ignored', unknown: 'Unknown',
};
/** Still waiting on a person: Approve / Deny show inside the row. */
export const isWaitingPhase = (p: ApprovalPhase): boolean => p === 'pending' || p === 'postponed' || p === 'held' || p === 'shelved';
const phaseOf = (v: unknown): ApprovalPhase => {
  const t = typeof v === 'string' ? v.toLowerCase() : '';
  if (t === 'rejected') return 'declined';
  return PHASES.includes(t as ApprovalPhase) ? (t as ApprovalPhase) : 'unknown';
};

/** Everything the expanded row shows. Strings are as the hub sent them (already display-safe and redacted). */
export interface ApprovalDetails {
  id: string;
  kind: 'approval' | 'held';
  phase: ApprovalPhase;
  /** What is being approved, the caller's one line (or "Run <tool>"). */
  title: string;
  /** What it does and why, in the caller's words ('' when none). */
  description: string;
  /** True / false when the hub says whether the title + description are the caller's words; null when unknown. */
  reasonGiven: boolean | null;
  tool: string;
  toolDescription: string;
  policy: ApprovalPolicy;
  /** Short risk words: the hub's effect, then what the command touches. */
  risk: string[];
  /** The shell command when there is one ('' otherwise). */
  command: string;
  /** The arguments, pretty-printed when they are JSON (the whole summary when not). */
  arguments: string;
  source: ApprovalSource | null;
  /** The caller id the hub keeps (a token or client name; '' when not sent). */
  callerId: string;
  requestedAt: string;
  expiresAt: string;
  /** Held calls: when it runs (ISO) and the countdown at read time (for the live tick). */
  runsAt: string;
  veto: Pick<VetoCall, 'secondsLeft' | 'readAt' | 'shelved'> | null;
  decidedAt: string;
  decidedBy: string;
  ranAt: string;
  finishedAt: string;
  /** undefined: not run (or not known); null: ran without an exit code. */
  exitCode: number | null | undefined;
  /** The hub's approval page (rebuilt from the id). */
  url: string;
  /** The held call's job stream (output), rebuilt from the job id; null when none. */
  streamUrl: string | null;
  /** What the person can decide here now. */
  decisions: ApprovalDecision[];
}

/* ---------------------------------------------------------------- risk words */

const RISKS: [RegExp, string][] = [
  [/\brm\s+-[a-z]*[rf]|\bdrop\s+(table|database)\b|\btruncate\b|\bdelete\b/i, 'deletes'],
  [/\bsudo\b|\bchmod\b|\bchown\b/, 'root / permissions'],
  [/\bdocker\b|\bpodman\b|\bkubectl\b/, 'containers'],
  [/\bsystemctl\b|\breboot\b|\bshutdown\b|\bkill(all)?\b/, 'services'],
  [/\bgit\s+(push|reset|rebase|merge)\b/, 'git history'],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, 'runs downloaded code'],
  [/\.env\b|secret|token|password|credential/i, 'secrets'],
  [/>\s*\/|\btee\b|\bsed\s+-i\b|\bmv\b|\bcp\b/, 'writes files'],
];
const EFFECT_RISK: Record<string, string> = { destructive: 'destructive', changes: 'changes things', 'read-only': 'read-only' };

/** The risk words for a call: the hub's `risk`/`riskTags` list, its effect, then what the command touches. Max 6. */
export function riskTags(effect: unknown, command: string, extra: unknown = null): string[] {
  const out: string[] = [];
  const add = (t: string) => { const v = clean(t, 30).toLowerCase(); if (v && !out.includes(v)) out.push(v); };
  if (Array.isArray(extra)) for (const t of extra) if (typeof t === 'string') add(t);
  if (typeof effect === 'string' && EFFECT_RISK[effect]) add(EFFECT_RISK[effect]!);
  for (const [re, t] of RISKS) if (re.test(command)) add(t);
  return out.slice(0, 6);
}

/** The arguments part of a hub summary (`<tool> with arguments <json>`), pretty-printed when it is JSON. */
export function argumentsOf(summary: string): string {
  const marker = ' with arguments ';
  const i = summary.indexOf(marker);
  const raw = i >= 0 ? summary.slice(i + marker.length) : summary;
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

/* ---------------------------------------------------------------- builders */

/** From a lib-approvals feed item (+ its raw feed entry, when the surface kept it, for the extra fields). */
export function detailsOfItem(item: ApprovalItem, raw: unknown = item.entry ?? null): ApprovalDetails {
  const r = o(raw);
  const v = o(r?.veto);
  const phase = item.kind === 'held' ? (item.veto?.shelved ? 'shelved' : 'held') : phaseOf(str(r, 'status') ?? 'pending');
  const command = item.command || str(o(o(r?.code)), 'command') || '';
  return {
    id: item.id, kind: item.kind, phase: phase === 'unknown' ? 'pending' : phase, title: item.title, description: item.description,
    reasonGiven: r && typeof r.reasonGiven === 'boolean' ? r.reasonGiven : item.description ? true : null,
    tool: item.tool, toolDescription: str(r, 'toolDescription') ?? '', policy: item.kind === 'held' ? 'veto' : 'confirm',
    risk: riskTags(str(r, 'effect'), command, r?.risk ?? r?.riskTags),
    command, arguments: str(o(r?.code), 'arguments') ?? argumentsOf(item.summary), source: sourceOf(r),
    callerId: str(r, 'callerId') ?? '', requestedAt: iso(item.createdAt || str(r, 'createdAt')), expiresAt: item.kind === 'held' ? '' : iso(item.expiresAt),
    runsAt: item.veto?.runsAt ?? '', veto: item.veto ? { secondsLeft: item.veto.secondsLeft, readAt: item.veto.readAt, shelved: item.veto.shelved } : null,
    decidedAt: iso(str(r, 'decidedAt')), decidedBy: str(r, 'decidedBy') ?? '', ranAt: iso(str(v, 'startedAt')), finishedAt: iso(str(v, 'finishedAt')),
    exitCode: v && 'exitCode' in v ? num(v, 'exitCode') : undefined, url: item.url, streamUrl: item.veto?.streamUrl ?? null, decisions: item.decisions,
  };
}

/** The decisions an entry offers here: approve / decline (as the hub lists them) or, held, deny + approve (run now). */
function decisionsOfEntry(r: Record<string, unknown>, held: boolean): ApprovalDecision[] {
  const v = o(r.veto);
  const list = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : null);
  if (held) {
    const acts = list(v?.actions) ?? ['deny'];
    return [...(acts.includes('deny') ? ['deny' as const] : []), ...(acts.includes('approve-now') ? ['approve' as const] : [])];
  }
  const acts = list(r.actions) ?? ['approve', 'decline'];
  return [...(acts.includes('approve') ? ['approve' as const] : []), ...(acts.includes('decline') ? ['decline' as const] : [])];
}

/**
 * From one hub entry as the hub's approvals API shapes it (`approvalView`: id, tool, title, description, effect, code,
 * status, actions, veto, history, decidedBy, source …). `base` is the hub (links are rebuilt from the ids); `now` the
 * local clock the entry was read at (held countdowns tick from it). Null for an entry without a real approval id.
 */
export function detailsOfHubEntry(base: string, raw: unknown, now: number = Date.now()): ApprovalDetails | null {
  const r = o(raw);
  const id = str(r, 'id');
  const url = approvalUrl(base, id);
  if (!r || !id || !url) return null;
  const v = o(r.veto);
  const code = o(r.code);
  const st = phaseOf(r.status);
  const vs = phaseOf(v?.state);
  const held = !!v && (st === 'held' || vs === 'held' || vs === 'shelved');
  const phase: ApprovalPhase = v && st !== 'pending' && st !== 'postponed' ? (vs !== 'unknown' ? vs : st) : st === 'unknown' ? 'pending' : st;
  const summary = str(r, 'summary') ?? '';
  const command = str(code, 'command') ?? str(r, 'command') ?? str(o(r.args), 'command') ?? (/"command":"((?:[^"\\]|\\.)*)"/.exec(summary)?.[1]?.replace(/\\"/g, '"').replace(/\\\\/g, '\\') ?? '');
  const tool = str(code, 'qualified') ?? str(r, 'tool') ?? '';
  const reason = o(r.reason);
  const history = Array.isArray(r.history) ? r.history.map(o).filter((h): h is Record<string, unknown> => !!h) : [];
  // The decision: the newest history step out of pending/held (the hub lists history newest first).
  const decided = history.find((h) => ['approved', 'rejected', 'declined', 'denied', 'revoked', 'ignored', 'expired'].includes(String(h.to)));
  const left = num(v, 'secondsLeft');
  return {
    id, kind: held ? 'held' : 'approval', phase: held && phase !== 'shelved' ? 'held' : phase,
    title: clean(str(r, 'title') ?? str(reason, 'title') ?? `Run ${tool}`, 200),
    description: (str(r, 'description') ?? str(reason, 'description') ?? '').trim().slice(0, 4000),
    reasonGiven: typeof r.reasonGiven === 'boolean' ? r.reasonGiven : reason ? true : null,
    tool, toolDescription: str(r, 'toolDescription') ?? '', policy: v ? 'veto' : 'confirm',
    risk: riskTags(str(r, 'effect'), command, r.risk ?? r.riskTags),
    command, arguments: str(code, 'arguments') ?? argumentsOf(str(r, 'args') ? `x with arguments ${str(r, 'args')}` : summary),
    source: sourceOf(r), callerId: str(r, 'callerId') ?? '',
    requestedAt: iso(str(r, 'createdAt')), expiresAt: v ? '' : iso(str(r, 'expiresAt')),
    runsAt: iso(str(v, 'runsAt')), veto: held && left !== null ? { secondsLeft: Math.max(0, Math.round(left)), readAt: now, shelved: vs === 'shelved' } : null,
    decidedAt: iso(str(r, 'decidedAt') ?? str(v, 'approvedNowAt') ?? (decided ? str(decided, 'at') : null)),
    decidedBy: str(r, 'decidedBy') ?? (decided ? str(decided, 'by') ?? '' : ''),
    ranAt: iso(str(v, 'startedAt')), finishedAt: iso(str(v, 'finishedAt')),
    exitCode: v && 'exitCode' in v ? num(v, 'exitCode') : undefined,
    url, streamUrl: vetoStreamUrl(base, r.jobId), decisions: decisionsOfEntry(r, held),
  };
}

/* ---------------------------------------------------------------- words and times */

/** Seconds a held call has left now (null when it isn't counting down). */
export const detailsCountdown = (d: Pick<ApprovalDetails, 'veto'>, now: number = Date.now()): number | null => (d.veto ? secondsLeftNow(d.veto, now) : null);

/** 4 s, 2 min 5 s, 1 h 3 min */
export function formatDuration(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  if (t < 60) return `${t} s`;
  if (t < 3600) return `${Math.floor(t / 60)} min${t % 60 ? ` ${t % 60} s` : ''}`;
  return `${Math.floor(t / 3600)} h${Math.floor((t % 3600) / 60) ? ` ${Math.floor((t % 3600) / 60)} min` : ''}`;
}

/** Local time with the date when it isn't today: "14:02:11", "Oct 31 14:02". */
export function formatWhenAt(at: string, now: number = Date.now()): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const today = new Date(now).toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface TimelineStep { id: 'requested' | 'countdown' | 'expires' | 'decided' | 'ran' | 'finished' | 'duration'; label: string; text: string; live?: boolean }

/** The timeline rows: requested, countdown (live) or expiry, decided (by whom), ran at, finished, duration. */
export function timelineOf(d: ApprovalDetails, now: number = Date.now()): TimelineStep[] {
  const out: TimelineStep[] = [];
  if (d.requestedAt) out.push({ id: 'requested', label: 'Requested', text: formatWhenAt(d.requestedAt, now) });
  const left = detailsCountdown(d, now);
  if (left !== null) out.push({ id: 'countdown', label: d.veto?.shelved ? 'Countdown' : 'Runs in', text: d.veto?.shelved ? `Shelved at ${formatCountdown(left)}` : left > 0 ? formatCountdown(left) : 'now', live: !d.veto?.shelved });
  else if (d.runsAt && !d.ranAt && isWaitingPhase(d.phase)) out.push({ id: 'countdown', label: 'Runs at', text: formatWhenAt(d.runsAt, now) });
  if (d.expiresAt && isWaitingPhase(d.phase)) out.push({ id: 'expires', label: 'Expires', text: formatWhenAt(d.expiresAt, now) });
  if (d.decidedAt || d.decidedBy) out.push({ id: 'decided', label: PHASE_LABELS[d.phase] && !isWaitingPhase(d.phase) ? `${PHASE_LABELS[d.phase]}` : 'Decided', text: [d.decidedAt ? formatWhenAt(d.decidedAt, now) : '', d.decidedBy ? `by ${d.decidedBy}` : ''].filter(Boolean).join(' ') });
  if (d.ranAt) out.push({ id: 'ran', label: 'Ran at', text: formatWhenAt(d.ranAt, now) });
  if (d.finishedAt) out.push({ id: 'finished', label: 'Finished', text: formatWhenAt(d.finishedAt, now) });
  if (d.ranAt && (d.finishedAt || d.phase === 'running')) {
    const ms = Date.parse(d.finishedAt || new Date(now).toISOString()) - Date.parse(d.ranAt);
    if (Number.isFinite(ms)) out.push({ id: 'duration', label: 'Duration', text: formatDuration(ms), live: !d.finishedAt });
  }
  return out;
}

/** Has it run (or is it running), so a result section belongs in the row? */
export const hasResult = (d: Pick<ApprovalDetails, 'phase' | 'ranAt' | 'exitCode'>): boolean =>
  d.phase === 'running' || d.phase === 'ran' || d.phase === 'failed' || !!d.ranAt || d.exitCode !== undefined;

/** "Exit 0", "Exit 2 (failed)", "Running…", "No exit code". */
export function exitLine(d: Pick<ApprovalDetails, 'phase' | 'exitCode'>): string {
  if (d.phase === 'running' && d.exitCode === undefined) return 'Running…';
  if (d.exitCode === undefined || d.exitCode === null) return d.phase === 'failed' ? 'Failed (no exit code)' : 'No exit code';
  return d.exitCode === 0 ? 'Exit 0' : `Exit ${d.exitCode} (failed)`;
}

/** The last `n` lines of some output (trailing blank lines dropped). */
export function tailLines(text: string, n = 12): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.slice(-Math.max(1, n));
}

/** The collapsed row's second line: source · who · tool · requested / countdown. */
export function collapsedLine(d: ApprovalDetails, now: number = Date.now()): string {
  const left = detailsCountdown(d, now);
  const when = left !== null ? (d.veto?.shelved ? 'shelved' : left > 0 ? `runs in ${formatCountdown(left)}` : 'running') : d.requestedAt ? formatWhenAt(d.requestedAt, now) : '';
  return [d.source?.session ?? '', d.tool, isWaitingPhase(d.phase) ? when : PHASE_LABELS[d.phase]].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- expanded rows */

/**
 * Which rows are open, per surface (`scope`: 'popover', 'banner', 'axhub', 'amberx' …), kept outside React so a live
 * refresh never folds an open row; mirrored in sessionStorage so a reload of the same tab keeps them open too.
 */
export class ApprovalsOpenStore {
  private open: Set<string>;
  private subs = new Set<() => void>();
  private version = 0;
  constructor(private storageKey: string | null = 'axf.approvals.open') {
    let saved: string[] = [];
    try { saved = storageKey ? JSON.parse(globalThis.sessionStorage?.getItem(storageKey) ?? '[]') : []; } catch { saved = []; }
    this.open = new Set(Array.isArray(saved) ? saved.filter((x) => typeof x === 'string').slice(-200) : []);
  }
  private key = (scope: string, id: string) => `${scope}:${id}`;
  isOpen = (scope: string, id: string): boolean => this.open.has(this.key(scope, id));
  set(scope: string, id: string, on: boolean): void {
    const k = this.key(scope, id);
    if (on === this.open.has(k)) return;
    if (on) this.open.add(k); else this.open.delete(k);
    this.version++;
    try { if (this.storageKey) globalThis.sessionStorage?.setItem(this.storageKey, JSON.stringify([...this.open].slice(-200))); } catch { /* fine */ }
    this.subs.forEach((f) => f());
  }
  toggle = (scope: string, id: string): boolean => { const on = !this.isOpen(scope, id); this.set(scope, id, on); return on; };
  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  snapshot = (): number => this.version;
}

export const approvalsOpenStore = new ApprovalsOpenStore();

/* ---------------------------------------------------------------- where a row's item lives */

/**
 * Something that holds approval items a surface shows elsewhere (the application menu's rows only carry
 * `expand: "approval:<id>"`): lib-approvals' own menu list and the console banner register one, and the menu's details
 * renderer finds the item (and how to decide it) through {@link lookupApproval}.
 */
export interface ApprovalsLookup {
  hub: () => string;
  find: (id: string) => ApprovalItem | undefined;
  /** This surface's deciding path (default: lib-approvals `decideApproval`). */
  decide?: (item: ApprovalItem, d: ApprovalDecision) => Promise<{ ok: boolean; message: string; opened?: boolean }>;
}
const lookups = new Set<ApprovalsLookup>();
/** Registers a lookup; returns its remover. */
export function registerApprovalsLookup(l: ApprovalsLookup): () => void { lookups.add(l); return () => { lookups.delete(l); }; }
/** The newest-registered lookup that knows this id, with its item. */
export function lookupApproval(id: string): { item: ApprovalItem; lookup: ApprovalsLookup } | null {
  for (const l of [...lookups].reverse()) { const item = l.find(id); if (item) return { item, lookup: l }; }
  return null;
}
/** The `expand` key of an approval's menu row. */
export const approvalExpandKey = (id: string): string => `approval:${id}`;
