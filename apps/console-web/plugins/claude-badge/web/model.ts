/**
 * Badges: what each of the five banner badges is, and what its settings mean. Pure (no React, no runtime), so test.mts
 * runs it directly. The keys keep their old names where a setting already existed, so nobody's choices are lost.
 */
export type BadgeKind = 'console' | 'vps' | 'axhub' | 'amberx' | 'usage';
export type BadgeState = 'ok' | 'warn' | 'error' | 'off';
export type TapKind = 'dropdown' | 'screen' | 'command' | 'toggle' | 'none';
export type BadgeTone = 'success' | 'warning' | 'danger' | 'muted';

export const STATE_IDS: BadgeState[] = ['ok', 'warn', 'error', 'off'];
export const STATE_NAMES: Record<BadgeState, string> = { ok: 'OK', warn: 'Warning', error: 'Error', off: 'Off' };
export const TONES: Record<BadgeState, BadgeTone> = { ok: 'success', warn: 'warning', error: 'danger', off: 'muted' };
export const CHIPS: Record<BadgeState, 'success' | 'warning' | 'danger' | 'accent'> = { ok: 'success', warn: 'warning', error: 'danger', off: 'accent' };
export const ICONS = ['sparkles', 'zap', 'check', 'star', 'cloud', 'key', 'lock', 'shield', 'alert', 'info', 'x', 'minus', 'clock', 'eye', 'bell', 'rocket', 'terminal', 'user', 'smartphone'];
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
    id: 'claude', label: 'Claude', title: 'Claude (can build)', icon: 'sparkles', order: 5, side: 'left', aliases: ['claude', 'can claude build', 'build accounts'],
    tap: 'dropdown', target: '', about: 'Can Claude build: green when one build account or more can sign in and has credits (the dispatcher\'s own check), red when none can.',
    states: {
      ok: { label: 'can build', icon: 'sparkles', setting: 'A build account is ready' },
      warn: { label: 'checking', icon: 'clock', setting: 'Checking' },
      error: { label: "can't build", icon: 'alert', setting: 'No build account can sign in with credits' },
      off: { label: "can't tell", icon: 'minus', setting: "Can't read the orchestrator" },
    },
  },
  vps: {
    id: 'claude-vps', label: 'VPS', title: 'VPS (build accounts)', icon: 'cloud', order: 6, side: 'left', aliases: ['vps', 'vps connection'],
    tap: 'screen', target: 'settings.open:claude-badge', about: 'Whether the console can see the build accounts on the VPS.',
    states: {
      ok: { label: 'connected', icon: 'cloud', setting: 'Build accounts read from the VPS' },
      warn: { label: 'out of date', icon: 'clock', setting: 'The VPS account snapshot is old' },
      error: { label: "can't see", icon: 'alert', setting: "Can't see the build accounts" },
      off: { label: "can't tell", icon: 'minus', setting: "Can't read the orchestrator" },
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
};
export const KINDS = Object.keys(BADGES) as BadgeKind[];

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
    widget: { label: d.title, priority: 8, aliases: d.aliases, ...(kind === 'usage' ? { size: 'wide' as const } : {}) },
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

/** One build account in the Claude badge's read (GET /build): the dispatcher's check over the latest health sweep. */
export interface ReadyAccount { name: string; label: string; kind: 'subscription' | 'api'; ready: boolean; signedIn: boolean | null; credits: boolean | null; fable: boolean | null; healthAt: string; why: string }
export interface BuildResult { at: number; ok: boolean; state: BadgeState; ready: number; total: number; accounts: ReadyAccount[]; source: string; from: string; healthAt: string; text: string; error: string; cached?: boolean; vps?: { state: BadgeState; reachable: boolean; text: string } }
const SERVER_STATES: Record<string, BadgeState> = { ok: 'ok', warn: 'warn', error: 'error', off: 'off' };
/** The server's state as one of the four; anything unknown is `off`, never green. */
export const buildState = (r: BuildResult | null): BadgeState => (r ? SERVER_STATES[r.state] ?? 'off' : 'off');
/** The badge words: `Claude 1/4` (ready of all), or just the label when nothing was read. */
export function buildText(r: BuildResult | null, label = BADGES.console.label): string {
  return r && r.state !== 'off' && r.total ? `${label} ${r.ready}/${r.total}` : label;
}
/** One account's line in the drop-down. */
export function readyLine(a: ReadyAccount): string {
  if (a.ready) return `Ready${a.fable === true ? ' · takes Fable' : a.fable === false ? ' · Opus only' : ''}`;
  return a.why ? a.why.charAt(0).toUpperCase() + a.why.slice(1) : 'Not ready';
}
