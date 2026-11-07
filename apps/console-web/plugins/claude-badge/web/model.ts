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
    id: 'claude-vps', label: 'VPS', title: 'VPS (Claude login)', icon: 'cloud', order: 6, side: 'left', aliases: ['vps', 'vps connection'],
    tap: 'screen', target: 'settings.open:claude-badge', about: 'The Claude Code login on the VPS.',
    states: {
      ok: { label: 'logged in', icon: 'cloud', setting: 'Logged in and working' },
      warn: { label: 'limit hit', icon: 'zap', setting: 'Limit hit or out of credits' },
      error: { label: 'not logged in', icon: 'alert', setting: 'Not logged in or expired' },
      off: { label: "can't read", icon: 'minus', setting: "Can't read the VPS" },
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
