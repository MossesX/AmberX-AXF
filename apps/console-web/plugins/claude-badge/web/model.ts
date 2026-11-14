/**
 * Badges: what each of the eight banner badges is, and what its settings mean. Pure (no React, no runtime), so test.mts
 * runs it directly. The keys keep their old names where a setting already existed, so nobody's choices are lost.
 */
export type BadgeKind = 'console' | 'vps' | 'axhub' | 'amberx' | 'usage' | 'disk' | 'cpu' | 'memory';
/** The server health widgets: one metric each, coloured by the thresholds set on the server health page. */
export type HealthKind = 'disk' | 'cpu' | 'memory';
export type BadgeState = 'ok' | 'warn' | 'error' | 'off';
export type TapKind = 'dropdown' | 'screen' | 'command' | 'toggle' | 'none';
export type BadgeTone = 'success' | 'warning' | 'danger' | 'muted';

export const STATE_IDS: BadgeState[] = ['ok', 'warn', 'error', 'off'];
export const STATE_NAMES: Record<BadgeState, string> = { ok: 'OK', warn: 'Warning', error: 'Error', off: 'Off' };
export const TONES: Record<BadgeState, BadgeTone> = { ok: 'success', warn: 'warning', error: 'danger', off: 'muted' };
export const CHIPS: Record<BadgeState, 'success' | 'warning' | 'danger' | 'accent'> = { ok: 'success', warn: 'warning', error: 'danger', off: 'accent' };
export const ICONS = ['sparkles', 'zap', 'check', 'star', 'cloud', 'key', 'lock', 'shield', 'alert', 'info', 'x', 'minus', 'clock', 'eye', 'bell', 'rocket', 'terminal', 'user', 'smartphone', 'box', 'chart', 'layers', 'monitor'];
export const TAPS: { value: TapKind; label: string }[] = [
  { value: 'dropdown', label: 'Drop-down' }, { value: 'screen', label: 'Open a screen' }, { value: 'command', label: 'Run a command' },
  { value: 'toggle', label: 'Toggle a setting' }, { value: 'none', label: 'Nothing' },
];

interface StateDef { label: string; icon: string; setting: string }
export interface BadgeDef {
  /** the badge asset's id */ id: string;
  label: string; title: string; icon: string; order: number; side: 'left' | 'right'; aliases: string[];
  tap: TapKind; target: string; about: string;
  states: Record<BadgeState, StateDef>;
}

export const BADGES: Record<BadgeKind, BadgeDef> = {
  console: {
    id: 'claude', label: 'Claude', title: 'Claude (console AI)', icon: 'sparkles', order: 5, side: 'left', aliases: ['claude', 'console connection'],
    tap: 'screen', target: 'settings.open:claude-badge', about: 'The AI connection, tested when the console loads.',
    states: {
      ok: { label: 'connected', icon: 'sparkles', setting: 'Connected (has credits)' },
      warn: { label: 'out of credits', icon: 'zap', setting: 'Account works, out of credits' },
      error: { label: 'unavailable', icon: 'sparkles', setting: "Can't connect (bad token or account)" },
      off: { label: 'not tested', icon: 'minus', setting: 'Not tested yet' },
    },
  },
  vps: {
    id: 'claude-vps', label: 'VPS', title: 'VPS (ping)', icon: 'cloud', order: 6, side: 'left', aliases: ['vps', 'vps connection', 'server'],
    tap: 'screen', target: 'nav:server-health', about: 'Green while the VPS answers a ping, red when it does not. Nothing else.',
    states: {
      ok: { label: 'pingable', icon: 'cloud', setting: 'Answers a ping' },
      warn: { label: 'checking', icon: 'clock', setting: 'Checking' },
      error: { label: 'not answering', icon: 'alert', setting: "Doesn't answer a ping" },
      off: { label: 'no host', icon: 'minus', setting: 'No VPS host known' },
    },
  },
  axhub: {
    id: 'axhub', label: 'axHub', title: 'axHub (connection)', icon: 'shield', order: 24, side: 'right', aliases: ['axhub', 'hub'],
    tap: 'screen', target: 'hubstatus.open', about: 'Green only while settings come live from axHub right now.',
    states: {
      ok: { label: 'live', icon: 'shield', setting: 'Settings live from axHub' },
      warn: { label: 'checking', icon: 'clock', setting: 'Checking' },
      error: { label: 'not live', icon: 'alert', setting: 'Not live' },
      off: { label: 'no reading', icon: 'minus', setting: 'No reading yet' },
    },
  },
  amberx: {
    id: 'amberx-phone', label: 'AmberX', title: 'AmberX (phone app)', icon: 'smartphone', order: 7, side: 'left', aliases: ['amberx', 'phone'],
    tap: 'dropdown', target: '', about: 'Whether the AmberX app on the phone is connected to axHub, and when it was last seen.',
    states: {
      ok: { label: 'connected', icon: 'smartphone', setting: 'Phone connected' },
      warn: { label: 'seen lately', icon: 'clock', setting: 'Offline, seen in the last hour' },
      error: { label: 'offline', icon: 'alert', setting: 'Offline for over an hour' },
      off: { label: 'not paired', icon: 'minus', setting: 'Not paired or no reading' },
    },
  },
  usage: {
    id: 'claude-usage', label: 'Usage', title: 'Usage meter', icon: 'clock', order: 8, side: 'left', aliases: ['usage', 'usage meter', 'credits'],
    tap: 'dropdown', target: '', about: 'How much of its 5-hour and weekly limits the active Claude account has used.',
    states: {
      ok: { label: 'plenty left', icon: 'clock', setting: 'Under 80% used' },
      warn: { label: 'running low', icon: 'alert', setting: '80% used or more' },
      error: { label: 'limit hit', icon: 'zap', setting: 'A limit is full' },
      off: { label: 'no reading', icon: 'minus', setting: 'Nothing to read' },
    },
  },
  disk: {
    id: 'vps-disk', label: 'Disk', title: 'VPS disk', icon: 'box', order: 9, side: 'left', aliases: ['disk', 'disk space', 'storage'],
    tap: 'screen', target: 'nav:server-health', about: 'How full the VPS disk is. Past the red line the console raises an alert.',
    states: {
      ok: { label: 'ok', icon: 'box', setting: 'Under the warn line' },
      warn: { label: 'filling up', icon: 'alert', setting: 'Past the warn line' },
      error: { label: 'nearly full', icon: 'alert', setting: 'Past the red line' },
      off: { label: 'no reading', icon: 'minus', setting: 'Nothing to read' },
    },
  },
  cpu: {
    id: 'vps-cpu', label: 'CPU', title: 'VPS CPU load', icon: 'chart', order: 10, side: 'left', aliases: ['cpu', 'cpu load', 'load'],
    tap: 'screen', target: 'nav:server-health', about: 'The VPS load over the last minute, as a share of its cores.',
    states: {
      ok: { label: 'ok', icon: 'chart', setting: 'Under the warn line' },
      warn: { label: 'busy', icon: 'alert', setting: 'Past the warn line' },
      error: { label: 'overloaded', icon: 'alert', setting: 'Past the red line' },
      off: { label: 'no reading', icon: 'minus', setting: 'Nothing to read' },
    },
  },
  memory: {
    id: 'vps-memory', label: 'Mem', title: 'VPS memory and swap', icon: 'layers', order: 11, side: 'left', aliases: ['memory', 'ram', 'swap'],
    tap: 'screen', target: 'nav:server-health', about: 'VPS memory in use and swap in use; the worse of the two sets the colour.',
    states: {
      ok: { label: 'ok', icon: 'layers', setting: 'Under the warn line' },
      warn: { label: 'tight', icon: 'alert', setting: 'Past the warn line' },
      error: { label: 'nearly out', icon: 'alert', setting: 'Past the red line' },
      off: { label: 'no reading', icon: 'minus', setting: 'Nothing to read' },
    },
  },
};
export const KINDS = Object.keys(BADGES) as BadgeKind[];
export const HEALTH_KINDS: HealthKind[] = ['disk', 'cpu', 'memory'];

export type BadgeField = 'show' | 'icon-only' | 'label' | 'order' | 'side' | 'tap' | 'tap-target';
export const keyOf = (kind: BadgeKind, field: BadgeField) => `claude-badge.${kind}.${field}`;
/** The icon setting. The first two badges keep the keys they have had since before `warn` and `off` existed. */
export function iconKey(kind: BadgeKind, st: BadgeState): string {
  const old = st === 'warn' ? 'no-credit' : st;
  if (kind === 'console') return `claude-badge.icon.${old}`;
  if (kind === 'vps') return `claude-badge.vps.icon.${old}`;
  return `claude-badge.${kind}.icon.${st}`;
}

export type Read = (key: string) => unknown;
export const iconOf = (read: Read, kind: BadgeKind, st: BadgeState) => { const v = read(iconKey(kind, st)); return typeof v === 'string' && ICONS.includes(v) ? v : BADGES[kind].states[st].icon; };
export const shownOf = (read: Read, kind: BadgeKind) => read(keyOf(kind, 'show')) !== false;
export const shapeOf = (read: Read, kind: BadgeKind): 'pill' | 'icon' => (read(keyOf(kind, 'icon-only')) === true ? 'icon' : 'pill');
export const labelOf = (read: Read, kind: BadgeKind) => { const v = read(keyOf(kind, 'label')); return typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : ''; };
export const orderOf = (read: Read, kind: BadgeKind) => { const v = Number(read(keyOf(kind, 'order'))); return Number.isFinite(v) && read(keyOf(kind, 'order')) !== undefined ? v : BADGES[kind].order; };
export const sideOf = (read: Read, kind: BadgeKind) => { const v = read(keyOf(kind, 'side')); return v === 'left' || v === 'right' ? v : BADGES[kind].side; };

/** The connection badges (everything but the usage meter). The banner guard test requires them on the bar by default. */
export const CONNECTION_KINDS: BadgeKind[] = ['console', 'vps', 'axhub', 'amberx'];

/** What one badge attaches to the banner (rt.attachToBanner), from its settings. One source for the plugin and its tests. */
export function badgeAttachment(read: Read, kind: BadgeKind, origin: string) {
  const d = BADGES[kind];
  return {
    type: 'badge' as const, id: d.id, at: sideOf(read, kind), order: orderOf(read, kind), origin,
    widget: { label: d.title, priority: 8, aliases: d.aliases, ...(kind === 'usage' || kind === 'memory' ? { size: 'wide' as const } : {}) },
  };
}

export interface TapPlan { do: 'drop' | 'dispatch' | 'toggle' | 'none'; spec?: string; key?: string }
/** What a tap does right now. A screen is an action (`x.open`, `settings.open:x`) or a view id; a bad setting does nothing. */
export function tapPlan(read: Read, kind: BadgeKind): TapPlan {
  const v = read(keyOf(kind, 'tap'));
  const tap = TAPS.some((t) => t.value === v) ? (v as TapKind) : BADGES[kind].tap;
  const raw = read(keyOf(kind, 'tap-target'));
  const target = typeof raw === 'string' ? raw.trim() : '';
  if (tap === 'dropdown') return { do: 'drop' };
  if (tap === 'screen') {
    const to = target || (BADGES[kind].tap === 'screen' ? BADGES[kind].target : `settings.open:claude-badge`);
    return { do: 'dispatch', spec: /[.:]/.test(to) ? to : `nav:${to}` };
  }
  if (tap === 'command') return target ? { do: 'dispatch', spec: target } : { do: 'none' };
  if (tap === 'toggle') return { do: 'toggle', key: target || keyOf(kind, 'icon-only') };
  return { do: 'none' };
}

export interface UsageWindow { used: number; resetsAt: string; locked: boolean }
export interface UsageAccount { name: string; type: string; active: boolean; plan: string; fresh: boolean; asOf: number; status: string; why: string; fiveHour: UsageWindow | null; weekly: UsageWindow | null }
export interface UsageResult { at: number; ready: boolean; why: string; active: string; state: BadgeState; cached?: boolean; age?: number; accounts: UsageAccount[] }

const pct = (w: UsageWindow | null) => (w ? `${Math.round(w.used)}%` : '–');
/** The banner words: `5h 12% · wk 13%`, with the label in front when one is set. */
export function meterText(r: UsageResult | null, label = ''): string {
  const a = r?.accounts.find((x) => x.active);
  const body = !a || a.status === 'no-meter' ? BADGES.usage.states.off.label : `5h ${pct(a.fiveHour)} · wk ${pct(a.weekly)}`;
  return label ? `${label} ${body}` : body;
}
const STATUS_WORDS: Record<string, string> = { ok: 'Up to date', limit: 'Limit hit', old: 'Last known', 'no-meter': 'No meter' };
export const statusWord = (s: string) => STATUS_WORDS[s] ?? s;
const TYPE_WORDS: Record<string, string> = { login: 'Login', token: 'Token', 'api-key': 'API key' };
export const typeWord = (t: string) => TYPE_WORDS[t] ?? t;

/* ---------------- server health ---------------- */

export type Metric = 'disk' | 'cpu' | 'memory' | 'swap';
export const METRICS: Metric[] = ['disk', 'cpu', 'memory', 'swap'];
export const METRIC_NAMES: Record<Metric, string> = { disk: 'Disk', cpu: 'CPU load', memory: 'Memory', swap: 'Swap' };
export interface Threshold { warn: number; red: number }
export interface HealthResult {
  at: number; ready: boolean; why: string; cached?: boolean; alert?: string;
  thresholds: Record<Metric, Threshold>;
  states: Record<Metric, BadgeState>;
  disk: { total: number; used: number; free: number; pct: number; path: string } | null;
  cpu: { load1: number; load5: number; load15: number; cores: number; pct: number } | null;
  memory: { total: number; used: number; pct: number } | null;
  swap: { total: number; used: number; pct: number; none: boolean } | null;
}
/** One read of GET /vps: is the host pingable. */
export interface PingResult { at: number; ok: boolean; state: BadgeState; reachable: boolean; host: string; source: string; method: string; ms: number; error: string }

const RANK: Record<BadgeState, number> = { off: 0, ok: 1, warn: 2, error: 3 };
/** The worse of two states (off only when both are off). */
export const worst = (a: BadgeState, b: BadgeState): BadgeState => (RANK[a] >= RANK[b] ? a : b);
/** One widget's state: the memory widget is the worse of memory and swap. */
export function healthState(h: HealthResult | null, kind: HealthKind): BadgeState {
  if (!h) return 'off';
  return kind === 'memory' ? worst(h.states.memory, h.states.swap) : h.states[kind];
}
const pc = (n: number | undefined) => (n === undefined ? '–' : `${Math.round(n)}%`);
/** The banner words: `Disk 63%`, `CPU 0.42`, `Mem 41% · swap 2%`. The label replaces the leading word when set. */
export function healthText(h: HealthResult | null, kind: HealthKind, label = ''): string {
  const word = label || BADGES[kind].label;
  if (!h || !h.ready) return `${word} –`;
  if (kind === 'disk') return `${word} ${pc(h.disk?.pct)}`;
  if (kind === 'cpu') return `${word} ${h.cpu ? h.cpu.load1.toFixed(2) : '–'}`;
  const swap = h.swap && !h.swap.none ? ` · swap ${pc(h.swap.pct)}` : '';
  return `${word} ${pc(h.memory?.pct)}${swap}`;
}
export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
/** The tooltip: the numbers behind the words. */
export function healthTip(h: HealthResult | null, kind: HealthKind): string {
  if (!h) return 'Reading the server…';
  if (!h.ready) return h.why || "Can't read this server's numbers";
  const t = h.thresholds;
  if (kind === 'disk') return h.disk ? `Disk ${pc(h.disk.pct)} full: ${gb(h.disk.free)} free of ${gb(h.disk.total)} · warn ${t.disk.warn}%, red ${t.disk.red}%` : 'No disk reading';
  if (kind === 'cpu') return h.cpu ? `Load ${h.cpu.load1.toFixed(2)} / ${h.cpu.load5.toFixed(2)} / ${h.cpu.load15.toFixed(2)} on ${h.cpu.cores} cores (${pc(h.cpu.pct)}) · warn ${t.cpu.warn}%, red ${t.cpu.red}%` : 'No CPU reading';
  const mem = h.memory ? `Memory ${pc(h.memory.pct)} (${gb(h.memory.used)} of ${gb(h.memory.total)})` : 'No memory reading';
  const swap = !h.swap ? '' : h.swap.none ? ' · no swap' : ` · swap ${pc(h.swap.pct)} (${gb(h.swap.used)} of ${gb(h.swap.total)})`;
  return mem + swap;
}
/** What the VPS badge says in one line. */
export function pingText(r: PingResult | null): string {
  if (!r) return 'Pinging the VPS…';
  if (r.state === 'ok') return `VPS answers a ping${r.ms ? ` in ${Math.round(r.ms)} ms` : ''}${r.host ? ` · ${r.host}` : ''}`;
  if (r.state === 'off') return r.error || 'No VPS host known';
  return r.error || `VPS ${r.host} doesn't answer a ping`;
}
