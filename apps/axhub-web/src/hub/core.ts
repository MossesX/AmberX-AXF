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
/** Plugin kinds and folders as the plugin catalog writes them (axHub decision 101). */
export const PLUGIN_KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const PLUGIN_FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
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
  if (a === 'approvals' && b && APPROVAL_ID_RE.test(b) && parts.length === 2) return { view: 'approval', params: { id: b } };
  if (a === 'plugins' && !b) {
    const kind = query.get('kind') ?? '';
    return { view: 'plugins', params: PLUGIN_KIND_RE.test(kind) ? { kind } : {} };
  }
  if (a === 'plugins' && b === 'install' && parts.length === 4 && PLUGIN_KIND_RE.test(parts[2] ?? '') && PLUGIN_FOLDER_RE.test(parts[3] ?? '')) {
    const version = query.get('version') ?? '';
    return { view: 'plugin-install', params: { kind: parts[2]!, folder: parts[3]!, ...(/^\d{1,6}\.\d{1,6}\.\d{1,6}([-+][0-9A-Za-z.-]{1,40})?$/.test(version) ? { version } : {}) } };
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
      return APPROVAL_ID_RE.test(params.id ?? '') ? `#/approvals/${params.id}` : '#/approvals';
    case 'plugins':
      return PLUGIN_KIND_RE.test(params.kind ?? '') ? `#/plugins?kind=${params.kind}` : '#/plugins';
    case 'plugin-install':
      if (!PLUGIN_KIND_RE.test(params.kind ?? '') || !PLUGIN_FOLDER_RE.test(params.folder ?? '')) return '#/plugins';
      return `#/plugins/install/${params.kind}/${params.folder}${params.version ? `?version=${encodeURIComponent(params.version)}` : ''}`;
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
