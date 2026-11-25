/*
 * Claude link — the pure part: the event shape (claude-link-event@1, docs/claude-link.md), the kinds, and the settings
 * the Claude link tab reads (Settings → Plugins → Terminal → Claude link). No React, no runtime: the check
 * (claude-link.test.mts) imports this file as it is.
 */

export const KINDS = ['launch', 'exit', 'account', 'mcp', 'axhub', 'connect', 'disconnect', 'error'] as const;
export type ClaudeLinkKind = (typeof KINDS)[number];
export type ClaudeLinkLevel = 'info' | 'warn' | 'error';

/** One line of the stream (claude-link-event@1). */
export interface ClaudeLinkEvent {
  /** when it happened, epoch ms */
  ts: number;
  kind: ClaudeLinkKind;
  /** which event source said it (docs/claude-link.md lists them) */
  source: string;
  /** the session it belongs to: a tmux name (axf-…, axt-…), a chat's session name, or '' */
  session: string;
  /** the saved Claude account's name, or '' (never an email, token or key) */
  account: string;
  model: string;
  /** one short line, secret-free */
  summary: string;
  /** more, shown when detail is on: secret-free too */
  detail: string;
  level: ClaudeLinkLevel;
}

export const KIND_LABELS: Record<ClaudeLinkKind, string> = {
  launch: 'Launches', exit: 'Exits', account: 'Accounts', mcp: 'MCP calls', axhub: 'axHub calls', connect: 'Connects', disconnect: 'Disconnects', error: 'Errors',
};

/** The settings registry keys (values persist through rt.settings). */
export const KEYS = {
  buffer: 'terminal.claudeLink.buffer',
  kinds: 'terminal.claudeLink.kinds',
  autoScroll: 'terminal.claudeLink.autoScroll',
  showDetail: 'terminal.claudeLink.showDetail',
} as const;

export const BUFFER = { min: 100, max: 10000, step: 100, default: 1000 } as const;

export interface ClaudeLinkPrefs {
  /** how many lines the tab keeps before the oldest drop off */
  buffer: number;
  /** the kinds the filter starts on (all of them = no filter) */
  kinds: ClaudeLinkKind[];
  autoScroll: boolean;
  showDetail: boolean;
}

export const DEFAULTS: ClaudeLinkPrefs = { buffer: BUFFER.default, kinds: [...KINDS], autoScroll: true, showDetail: false };

/** Each setting's level for the settings level toolbar (the settings asset's levelOf carries the same map). */
export const LEVELS: Record<string, 'simple' | 'basic' | 'developer' | 'administrator'> = {
  [KEYS.autoScroll]: 'simple', [KEYS.kinds]: 'basic', [KEYS.showDetail]: 'basic', [KEYS.buffer]: 'developer',
};

export const isKind = (v: unknown): v is ClaudeLinkKind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);

/** A saved buffer size made safe: a whole number inside the allowed range, else the default. */
export function cleanBuffer(v: unknown): number {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return BUFFER.default;
  return Math.max(BUFFER.min, Math.min(Math.round(n), BUFFER.max));
}

/** A saved kind filter made safe: known kinds in the canonical order, no repeats. Nothing valid picked = every kind. */
export function cleanKinds(v: unknown): ClaudeLinkKind[] {
  const picked = new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(isKind));
  return picked.size ? KINDS.filter((k) => picked.has(k)) : [...KINDS];
}

/** The four settings from whatever the registry holds (`get` = rt.settings.get). Unset or broken values fall back to the defaults. */
export function readPrefs(get: (key: string) => unknown): ClaudeLinkPrefs {
  const flag = (key: string, d: boolean) => { const v = get(key); return typeof v === 'boolean' ? v : d; };
  return { buffer: cleanBuffer(get(KEYS.buffer)), kinds: cleanKinds(get(KEYS.kinds)), autoScroll: flag(KEYS.autoScroll, DEFAULTS.autoScroll), showDetail: flag(KEYS.showDetail, DEFAULTS.showDetail) };
}

/** Does the filter let this kind through? */
export const kindShown = (prefs: Pick<ClaudeLinkPrefs, 'kinds'>, kind: string): boolean => prefs.kinds.includes(kind as ClaudeLinkKind);

/** Keep the newest `buffer` lines. */
export function trimTo<T>(lines: readonly T[], buffer: number): T[] {
  const n = cleanBuffer(buffer);
  return lines.length > n ? lines.slice(lines.length - n) : [...lines];
}
