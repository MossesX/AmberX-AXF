/**
 * Pure rules for the hub's own pages in this app (decision #96 on axHub: the hub's HTML pages moved here).
 *
 * Routes: the hub redirects every old page to `https://<hub>/#/<route>` (`/auth/admin/approvals/<id>` →
 * `#/approvals/<id>`, `/auth/account` → `#/account`, `/handoff/<id>` → `#/handoff/<id>` …), so the hash is the page.
 * Plus the handoff page's session picker and gauges (ported from the hub's old `handoff.js`). No DOM, no network:
 * `test.mjs` checks every rule here.
 */

/** A request id the hub hands out (UUID), checked before it goes into a route or a URL. */
export const APPROVAL_ID_RE = /^[0-9a-f-]{36}$/;
/** A handoff run id (`20261022-143005-ab12`). */
export const RUN_ID_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;
/** A view name the shell knows, for routes that aren't one of the hub's own. */
const VIEW_RE = /^[a-z][a-z0-9-]{0,40}$/;
/** Grid filters the hub knows (`APPROVAL_FILTERS` there). */
export const APPROVAL_FILTERS = ['all', 'pending', 'postponed', 'approved', 'declined', 'ignored', 'revoked', 'used', 'expired'] as const;

export interface Route {
  /** The shell view: home (approvals), approval, approvals-log, users, account, apps, hub, handoff, handoff-run, … */
  view: string;
  params: Record<string, string>;
}

const clean = (hash: string) => hash.replace(/^#/, '').replace(/^\/+/, '');

/** `#/approvals/<id>` → `{view: 'approval', params: {id}}`. Anything it can't read is the home page. */
export function parseRoute(hash: string): Route {
  const raw = clean(hash ?? '');
  const q = raw.indexOf('?');
  const path = (q >= 0 ? raw.slice(0, q) : raw).replace(/\/+$/, '');
  const query = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  const [a, b] = parts;
  if (!a || a === 'approvals' && !b) {
    const status = query.get('status') ?? '';
    return { view: 'home', params: (APPROVAL_FILTERS as readonly string[]).includes(status) && status !== 'all' ? { status } : {} };
  }
  if (a === 'approvals' && b === 'log' && parts.length === 2) return { view: 'approvals-log', params: {} };
  if (a === 'approvals' && b && APPROVAL_ID_RE.test(b) && parts.length === 2) {
    const pick = pickOf(query.get('do'));
    return { view: 'approval', params: pick ? { id: b, do: pick } : { id: b } };
  }
  if (a === 'handoff' && !b) return { view: 'handoff', params: {} };
  if (a === 'handoff' && b && RUN_ID_RE.test(b) && parts.length === 2) {
    const file = query.get('file') ?? '';
    return { view: 'handoff-run', params: file && safeFilePath(file) ? { id: b, file } : { id: b } };
  }
  if (parts.length === 1 && VIEW_RE.test(a)) return { view: a, params: {} };
  return { view: 'home', params: {} };
}

/** The other way: what goes after `#`. Views without a route of their own get `#/<view>`. */
export function routeHash(view: string, params: Record<string, string> = {}): string {
  switch (view) {
    case 'home':
      return params.status && params.status !== 'all' && (APPROVAL_FILTERS as readonly string[]).includes(params.status) ? `#/approvals?status=${params.status}` : '#/approvals';
    case 'approvals-log':
      return '#/approvals/log';
    case 'approval':
      if (!APPROVAL_ID_RE.test(params.id ?? '')) return '#/approvals';
      return pickOf(params.do) ? `#/approvals/${params.id}?do=${params.do}` : `#/approvals/${params.id}`;
    case 'handoff-run':
      if (!RUN_ID_RE.test(params.id ?? '')) return '#/handoff';
      return params.file && safeFilePath(params.file) ? `#/handoff/${params.id}?file=${encodeURIComponent(params.file)}` : `#/handoff/${params.id}`;
    default:
      return VIEW_RE.test(view) ? `#/${view}` : '#/approvals';
  }
}

/** A kit file path from a route: plain relative path, no traversal (the hub checks again; this only keeps routes tidy). */
export function safeFilePath(p: string): boolean {
  return p.length > 0 && p.length <= 300 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '' || s === '.' || s === '..');
}

/* ─────────────────────────────────────────────────────────── waiting rows */

/** A button a notice can pick (`?do=` on the request's address, axHub decision 105): the page opens with it picked. */
export const PICKS = ['deny', 'approve-now', 'shelve', 'approve'] as const;
export type NoticePick = (typeof PICKS)[number];
/** `?do=` → the picked button, or "" (anything else is ignored). `approve` is the same as `approve-now` on a held call. */
export const pickOf = (raw: string | null | undefined): NoticePick | '' => ((PICKS as readonly string[]).includes(raw ?? '') ? (raw as NoticePick) : '');

type HeldView = { status: string; veto?: { state?: string; approvedNow?: boolean; actions?: string[] } };
type HeldAction = 'deny' | 'approve-now' | 'shelve';

/**
 * What a held (veto) call offers now, in the order shown: Deny, Approve now, Shelve. The hub's `veto.actions` when it
 * sends them (decision 104); a hub from before 104 sends none, and gets Deny + Approve now (the app tries
 * `/approve-now`, then `/approve`, decision 105) — Approve now is never left off a call still counting down.
 */
export function heldActions(item: HeldView): HeldAction[] {
  if (item.status !== 'held' || !item.veto) return [];
  const order: HeldAction[] = ['deny', 'approve-now', 'shelve'];
  const raw = item.veto.actions;
  if (Array.isArray(raw)) return order.filter((a) => raw.includes(a));
  return item.veto.approvedNow ? ['deny'] : ['deny', 'approve-now'];
}

/** The routes Approve now tries on a held call, in order: decision 104's own, then 105's plain `/approve`. */
export const approveNowPaths = (id: string): string[] => (APPROVAL_ID_RE.test(id) ? [`/auth/api/approvals/${id}/approve-now`, `/auth/api/approvals/${id}/approve`] : []);

/**
 * How many requests wait on the owner: the hub's `waiting` counts pending requests only, so the held calls counting
 * down (`heldCount`, or the held rows on the page from a hub that doesn't send it) are added (decision 102: both wait).
 */
export function waitingCount(grid: { waiting?: number; heldCount?: number; items?: HeldView[] } | null | undefined): number {
  if (!grid) return 0;
  const pending = Number.isFinite(grid.waiting) ? Math.max(0, grid.waiting!) : 0;
  const held = Number.isFinite(grid.heldCount) ? Math.max(0, grid.heldCount!) : (grid.items ?? []).filter((i) => i.status === 'held' && !!i.veto).length;
  return pending + held;
}

/** The page title for that count. */
export const waitingTitle = (n: number): string => (n <= 0 ? 'Nothing waiting' : `${n} waiting`);

/** The hub's sign-in page, coming back to this exact page (the hub only returns to its own host). */
export function signInUrl(hub: string, here: string): string {
  let back = `${hub}/`;
  try {
    const u = new URL(here);
    if (u.origin === hub) back = u.toString();
  } catch { /* the hub's front page then */ }
  return `${hub}/auth/login?rd=${encodeURIComponent(back)}`;
}

/** What the hub's JSON error means, in words for the page. */
export function errorText(status: number, body: unknown): string {
  const msg = body && typeof body === 'object' && (body as { error?: { message?: unknown } }).error?.message;
  if (typeof msg === 'string' && msg) return msg.slice(0, 300);
  if (status === 0) return "Can't reach the hub.";
  if (status === 401) return 'Sign in on the hub.';
  if (status === 403) return 'Not allowed.';
  if (status === 404) return 'Not found.';
  return `The hub answered ${status}.`;
}

/* ─────────────────────────────────────────────────────────── times */

/** "in 12 min", "3 h ago", "just now". */
export function relTime(iso: string | number | undefined, now: number = Date.now()): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso ?? '');
  if (!Number.isFinite(t) || t <= 0) return '—';
  const d = t - now;
  const a = Math.abs(d);
  if (a < 45_000) return 'just now';
  const m = Math.round(a / 60_000);
  const text = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  return d > 0 ? `in ${text}` : `${text} ago`;
}

/** Local `YYYY-MM-DDTHH:MM` (a datetime-local field) → the UTC `YYYY-MM-DDTHH:MM` the hub's Postpone takes, or "". */
export function localToUtcMinute(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return '';
  const t = new Date(local).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16) : '';
}

/** Elapsed time as m:ss or h:mm:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
}

/* ─────────────────────────────────────────────────────────── handoff */

export type SessionKind = 'open' | 'cmd' | 'ps' | 'copy';
export interface SessionType { id: string; label: string; hint: string; kind: SessionKind; os: string; url?: (prompt: string) => string }

export const chatUrl = (p: string) => `https://claude.ai/new?q=${encodeURIComponent(p)}`;
/** A ready Claude Code command with the prompt in a quoted here-doc (nothing in it is expanded). */
export const bashCommand = (p: string) => `claude "$(cat <<'AXF_HANDOFF_EOF'\n${p}\nAXF_HANDOFF_EOF\n)"`;

/** Where the new account's session may run. The likely ones (this device's platform) come first. */
export const SESSIONS: SessionType[] = [
  { id: 'claude-code-web', label: 'Claude Code on the web (claude.ai/code)', hint: 'best: it works in the repo', kind: 'open', url: () => 'https://claude.ai/code', os: '' },
  { id: 'android-app', label: 'Android · Claude app', hint: 'opens the app with the prompt filled in', kind: 'open', url: chatUrl, os: 'android' },
  { id: 'android-moshi', label: 'Android · Moshi (mosh / SSH to the VPS)', hint: 'copies a ready claude command', kind: 'cmd', os: 'android' },
  { id: 'android-terminal', label: 'Android · terminal (Termux)', hint: 'copies a ready claude command', kind: 'cmd', os: 'android' },
  { id: 'android-browser', label: 'Android · browser (claude.ai)', hint: 'opens claude.ai with the prompt filled in', kind: 'open', url: chatUrl, os: 'android' },
  { id: 'windows-desktop', label: 'Windows · Claude desktop app', hint: 'opens Claude with the prompt filled in', kind: 'open', url: chatUrl, os: 'windows' },
  { id: 'windows-browser', label: 'Windows · browser (claude.ai)', hint: 'opens claude.ai with the prompt filled in', kind: 'open', url: chatUrl, os: 'windows' },
  { id: 'windows-terminal', label: 'Windows · Terminal / PowerShell (Claude Code)', hint: 'copies the prompt; run claude (Get-Clipboard -Raw)', kind: 'ps', os: 'windows' },
  { id: 'mac-desktop', label: 'Mac · Claude desktop app', hint: 'opens Claude with the prompt filled in', kind: 'open', url: chatUrl, os: 'mac' },
  { id: 'mac-terminal', label: 'Mac · Terminal (Claude Code)', hint: 'copies a ready claude command', kind: 'cmd', os: 'mac' },
  { id: 'linux-terminal', label: 'Linux · terminal (Claude Code)', hint: 'copies a ready claude command', kind: 'cmd', os: 'linux' },
  { id: 'ios-app', label: 'iPhone / iPad · Claude app', hint: 'opens Claude with the prompt filled in', kind: 'open', url: chatUrl, os: 'ios' },
  { id: 'vscode', label: 'VS Code · Claude Code extension', hint: 'opens VS Code with the prompt', kind: 'open', url: (p) => `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(p)}`, os: '' },
  { id: 'jetbrains', label: 'JetBrains IDE · Claude Code', hint: 'copies the prompt to paste', kind: 'copy', os: '' },
  { id: 'other', label: 'Something else', hint: 'copies the prompt to paste', kind: 'copy', os: '' },
];

/** The browser's platform from its user agent (a web page can't see the device's apps). */
export function platformOf(ua: string): string {
  return /Android/.test(ua) ? 'android' : /iPhone|iPad/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Mac OS/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : '';
}

/** The session list for this device: its platform first, otherwise in the listed order; filtered by a search. */
export function sessionsFor(platform: string, q = ''): SessionType[] {
  const s = q.trim().toLowerCase();
  return SESSIONS
    .map((x, i) => ({ x, i }))
    .sort((a, b) => Number(b.x.os === platform && !!platform) - Number(a.x.os === platform && !!platform) || a.i - b.i)
    .map(({ x }) => x)
    .filter((x) => !s || `${x.label} ${x.hint}`.toLowerCase().includes(s));
}

/** What goes on the clipboard for a session type. */
export const clipboardFor = (s: SessionType, prompt: string) => (s.kind === 'cmd' ? bashCommand(prompt) : prompt);

/** What the page says after a pick. */
export function afterPick(s: SessionType, copied: boolean, opened: boolean): string {
  const lines = [copied ? (s.kind === 'cmd' ? 'A ready claude command is on your clipboard.' : 'The prompt is on your clipboard.') : "Couldn't reach the clipboard: select the prompt below and copy it."];
  if (s.kind === 'open') lines.push(opened ? "It opened in a new tab or app. If the prompt isn't there already, paste it and send it." : 'Your browser blocked the new window: open the session yourself, paste and send.');
  if (s.kind === 'cmd') lines.push('Paste it into the terminal and press Enter.');
  if (s.kind === 'ps') lines.push('In PowerShell run:  claude (Get-Clipboard -Raw)');
  if (s.kind === 'copy') lines.push('Paste it into the session and send it.');
  return lines.join(' ');
}

export interface HandoffStepView { id: string; group: string; label: string; remaining: boolean; done: boolean; state: string; note: string; at: number }

/** The gauges and bars of a run: steps done, handoff steps done, pace (steps a minute) and the time left at that pace. */
export function handoffGauges(steps: HandoffStepView[], sentAt: number, now: number) {
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  const rem = steps.filter((s) => s.remaining);
  const remDone = rem.filter((s) => s.done).length;
  const elapsed = sentAt ? Math.max(0, now - sentAt) : 0;
  const pace = elapsed > 30_000 ? remDone / (elapsed / 60_000) : 0;
  const left = pace > 0 ? ((rem.length - remDone) / pace) * 60_000 : 0;
  const status = !sentAt ? 'Waiting for the prompt to be sent to the new account.' : remDone >= rem.length ? 'Handoff complete.' : "Live: the new account's Claude is working through the steps.";
  return { total, done, remaining: rem.length, remDone, elapsed, pace, left, live: !!sentAt && remDone < rem.length, status };
}

/** Steps grouped in their order, with how many of each group are done. */
export function stepGroups(steps: HandoffStepView[]): { name: string; steps: HandoffStepView[]; done: number }[] {
  const groups = new Map<string, HandoffStepView[]>();
  for (const s of steps) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return [...groups].map(([name, list]) => ({ name, steps: list, done: list.filter((s) => s.done).length }));
}

/* ─────────────────────────────────────────────────────────── who asked (axHub decision 109) */

/** The badge order for the source filter and the sort: people first, then unattended, then the hub. */
export const SOURCE_ORDER = ['claude_ai', 'claude_code', 'headless', 'console', 'agent', 'system', 'unknown'] as const;
export const SOURCE_LABEL: Record<string, string> = {
  claude_ai: 'Claude.ai', claude_code: 'Claude Code', headless: 'Headless', console: 'Console', agent: 'Agent', system: 'System', unknown: 'Unknown',
};

interface SourceRow { source?: { kind: string; label: string; who: string } }

/** A row's source kind ('unknown' when the hub sent none or a kind this page doesn't know). */
export const sourceKind = (r: SourceRow): string => (r.source && Object.hasOwn(SOURCE_LABEL, r.source.kind) ? r.source.kind : 'unknown');
/** A row's who: the session, build or agent name ('' when it adds nothing beyond the badge). */
export const sourceWho = (r: SourceRow): string => (r.source && r.source.who && r.source.who !== r.source.label ? r.source.who : '');

/** The source filter chips: every kind on the page, in badge order, with its count. */
export function sourceChips(rows: readonly SourceRow[]): { kind: string; label: string; count: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(sourceKind(r), (n.get(sourceKind(r)) ?? 0) + 1);
  return SOURCE_ORDER.filter((k) => n.has(k)).map((k) => ({ kind: k, label: SOURCE_LABEL[k]!, count: n.get(k)! }));
}

interface TimedRow { status: string; createdAt: string; expiresAt: string; showExpires?: boolean; veto?: { secondsLeft: number; state?: string } }

/**
 * Sort key of the countdown column: seconds until it runs (held) or expires (waiting); shelved after those; decided
 * requests last (Infinity).
 */
export function countdownKey(r: TimedRow, now: number = Date.now()): number {
  if (r.status === 'held' && r.veto) return r.veto.state === 'shelved' ? 1e9 + r.veto.secondsLeft : r.veto.secondsLeft;
  if (r.showExpires) { const t = Date.parse(r.expiresAt); return Number.isFinite(t) ? Math.max(0, (t - now) / 1000) : 1e10; }
  return Number.POSITIVE_INFINITY;
}

/** Sort key of the Requested column: when it was asked (ms; unknown = 0). */
export const requestedKey = (r: Pick<TimedRow, 'createdAt'>): number => { const t = Date.parse(r.createdAt); return Number.isFinite(t) ? t : 0; };

/** Next column sort after a header tap: same column flips, a new one starts ascending, `null` = the hub's order. */
export function nextSort(cur: { col: string; dir: 1 | -1 } | null, col: string | null): { col: string; dir: 1 | -1 } | null {
  if (col === null) return null;
  return cur && cur.col === col ? { col, dir: cur.dir === 1 ? -1 : 1 } : { col, dir: 1 };
}

/**
 * The hub's reply to a tap shows at once (Running, Denied, Approved …) until the grid's next read changes that row; a
 * reply is kept with the revision + status of the row it answered.
 */
export interface KeptReply<T> { base: string; item: T }
export const replyBase = (r: { revision: number; status: string }): string => `${r.revision}:${r.status}`;
export function shownRow<T extends { id: string; revision: number; status: string }>(fromGrid: T, kept: KeptReply<T> | undefined): T {
  return kept && kept.base === replyBase(fromGrid) && (kept.item as { id: string }).id === fromGrid.id ? kept.item : fromGrid;
}
