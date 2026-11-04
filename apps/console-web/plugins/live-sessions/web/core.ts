/*
 * Live sessions: the pure part (no React, no console imports), shared by the views and core-check.mts.
 * Rows come from the server (claude-live-session@1); this file only filters, formats and does the player's clock math.
 */

export const ID = 'ai.amberx.axf.console.live-sessions';
export const FOLDER = 'live-sessions';
export const VIEW = 'live-sessions';
export const RECORDINGS_VIEW = 'session-recordings';
export const WIDGET_ID = 'live-sessions';
export const COUNTERS = { human: 'live.sessions.human', headless: 'live.sessions.headless', watched: 'live.sessions.watched' } as const;

export type Kind = 'human' | 'headless';
export type Status = 'live' | 'idle' | 'ended';
export interface Agent { id: string; name: string; title: string; avatar: unknown; known: boolean }
export interface Watcher { by: string; voice: boolean; since: number }
export interface Notice { watched: boolean; recording: boolean; text: string; by: string[] }
export interface Row {
  id: string; kind: Kind; client: string; mode: 'voice' | 'text'; account: string; primary: boolean; device: string; app: string;
  title: string; doing: string; build: string; step: string; progress: number | null; model: string; thinking: string; agent: Agent;
  startedAt: number; lastAt: number; costUsd: number | null; status: Status; voice: { ok: boolean; why: string }; recording: boolean;
  watchers: Watcher[]; notice: Notice; source: string; url: string;
}
export interface Counts { human: number; headless: number; total: number; label: string; watched: number }
export interface Snapshot { rows: Row[]; counts: Counts; at: number }
export interface Event { seq: number; t: number; atMs: number; kind: string; role?: string; text?: string; tool?: string; args?: unknown; result?: string; error?: boolean; contextTokens?: number; tokens?: number }
export interface Marker { t: number; kind: string; label: string }
export interface Span { track: string; from: number; to: number }
export interface Timeline { durationMs: number; markers: Marker[]; context: { t: number; seq: number; tokens: number }[]; speech: Span[]; silenceMs: number }
export interface AudioPart { track: 'mic' | 'tts'; startMs: number; endMs: number | null; file: string; bytes: number }
export interface Recording {
  id: string; agent: Partial<Agent>; account: string; device: string; app: string; client: string; mode: string; title: string; startMs: number; endMs: number;
  lengthMs: number; events: number; bytes: number; topics: string[]; costUsd: number | null; pinned: boolean; favourite: boolean; audio: boolean;
  savedBytes: number | null; compacted: boolean; verified: boolean | null;
}

export const isSnapshot = (j: unknown): j is Snapshot => !!j && Array.isArray((j as Snapshot).rows) && !!(j as Snapshot).counts;

export type KindFilter = 'all' | Kind;
export interface Filters { kind: KindFilter; account: string; agent: string; q: string; ended: boolean }
export const NO_FILTERS: Filters = { kind: 'all', account: '', agent: '', q: '', ended: false };

export function filterRows(rows: Row[], f: Filters): Row[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (f.kind === 'all' || r.kind === f.kind) && (!f.account || r.account === f.account)
    && (!f.agent || r.agent.name === f.agent || r.agent.id === f.agent) && (f.ended || r.status !== 'ended')
    && (!q || [r.title, r.doing, r.build, r.device, r.app, r.account, r.model, r.agent.name].join(' ').toLowerCase().includes(q)));
}

export function countLabel(c: Counts | null): string {
  if (!c) return 'Sessions …';
  return c.label;
}

export const CLIENT_LABEL: Record<string, string> = { code: 'Claude Code', chat: 'claude.ai chat', voice: 'Voice call', companion: 'AmberX', headless: 'Headless build', swarm: 'Agent swarm job' };
export const KIND_ICON: Record<Kind, string> = { human: 'user', headless: 'terminal' };
export const KIND_LABEL: Record<Kind, string> = { human: 'Human', headless: 'Headless' };

/** "4s", "12m", "3h 05m", "2d" from ms. */
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86_400)}d`;
}

/** Player clock: "1:02:03" / "4:05". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`);
export function bytes(n: number | null | undefined): string {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** The banner widget: a framework `status` asset (no new asset type), label = the counts, tap opens the list. */
export function widgetAsset(c: Counts | null) {
  const text = countLabel(c);
  return {
    $axf: 'asset@1', type: 'status', id: WIDGET_ID, name: 'Live sessions', version: '0.1.0', author: 'Live sessions plugin',
    description: 'How many Claude sessions are going on, human and headless; tap for the grid.', tags: ['sessions', 'claude', 'live'],
    data: { counter: COUNTERS.human, onLabel: text, offLabel: text, onTone: c?.watched ? 'warning' : 'accent', offTone: 'muted', dot: true, link: 'live-sessions.open' },
  };
}

/** What the runtime needs for the widget (structural, so this file imports nothing). */
export interface WidgetHost {
  registry: { register(raw: unknown, source: 'app', origin: string): unknown };
  setBadge(name: string, n: number): void;
  attachToBanner(a: { type: string; id: string; at: 'left' | 'center' | 'right'; order?: number; origin: string }): unknown;
  detachFromBanner(keyOrOrigin: string): void;
}

export function paintWidget(rt: WidgetHost, c: Counts | null, show: boolean): void {
  rt.registry.register(widgetAsset(c), 'app', ID);
  rt.setBadge(COUNTERS.human, c?.human ?? 0);
  rt.setBadge(COUNTERS.headless, c?.headless ?? 0);
  rt.setBadge(COUNTERS.watched, c?.watched ?? 0);
  if (show) rt.attachToBanner({ type: 'status', id: WIDGET_ID, at: 'right', order: 24, origin: ID });
  else rt.detachFromBanner(`status:${WIDGET_ID}`);
}

// ---------------------------------------------------------------- player

/** Events visible at session time t (the context window filling in as it did). */
export function upTo(events: Event[], t: number): Event[] {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid]!.t <= t) lo = mid + 1; else hi = mid; }
  return events.slice(0, lo);
}

/** Context tokens at t (the running count the server worked out). */
export function tokensAt(tl: Timeline, t: number): number {
  let n = 0;
  for (const c of tl.context) { if (c.t <= t) n = c.tokens; else break; }
  return n;
}

/** Skip silence: inside speech stay, else jump to the next speech start (or stay when there is none). */
export function nextSpeech(speech: Span[], t: number): number {
  for (const s of [...speech].sort((a, b) => a.from - b.from)) {
    if (s.from <= t && t < s.to) return t;
    if (s.from > t) return s.from;
  }
  return t;
}

/** The audio part playing at session time t on a track, with the offset into it (silence = none: the gap is timeline). */
export function partAt(parts: AudioPart[], track: 'mic' | 'tts', t: number, lenOf: (p: AudioPart) => number): { part: AudioPart; offsetMs: number } | null {
  for (const p of parts) {
    if (p.track !== track) continue;
    const end = p.endMs ?? p.startMs + lenOf(p);
    if (p.startMs <= t && t < end) return { part: p, offsetMs: t - p.startMs };
  }
  return null;
}

export const SPEEDS = [0.5, 1, 1.5, 2, 3, 4] as const;

export function eventLine(e: Event): string {
  if (e.kind === 'tool') return `${e.tool ?? 'tool'} ${typeof e.args === 'object' ? JSON.stringify(e.args).slice(0, 160) : ''}`;
  if (e.kind === 'result') return (e.result ?? '').slice(0, 400);
  return (e.text ?? '').slice(0, 4000);
}

export const EVENT_LABEL: Record<string, string> = {
  context: 'Context', user: 'Human', assistant: 'Claude', tool: 'Tool call', result: 'Result', compact: 'Compacted', memory: 'Memory', approval: 'Approval',
  error: 'Error', build: 'Build', note: 'Note', voice: 'Voice',
};
