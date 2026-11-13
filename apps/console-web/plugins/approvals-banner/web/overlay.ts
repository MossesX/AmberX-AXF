/**
 * The approval overlay (Brett, Nov 13 2026: "Build me a overlay that expands with the approval every time one's sent.
 * A little overlay, like a little toolbar, but it expands when I need an approval."). On the phone (AmberX, Java
 * `ApprovalOverlay`) a small toolbar floats over every app and opens into the full card (what, why, countdown,
 * Approve / Deny / Shelve) the moment an approval or held command arrives, then shrinks back.
 *
 * Pure part: its settings, runtime settings `approvals-banner.overlay.*`, so they show in Settings → Plugins →
 * Approvals banner, follow the level toolbar, and are set from the console API / MCP / CLI like every setting; the
 * `approvals.overlay:<what>:<value>` action (voice, console actions) changes them by name. The phone gets them through
 * the veto host (`VetoHost.overlay`); its colours follow the active skin (the theme tokens AmberX sends natively).
 */

/** Settings → Plugins → Overlay: the overlay's preview and settings. */
export const OVERLAY_TAB = 'approvals-overlay';

export const OVERLAY_KEYS = {
  on: 'approvals-banner.overlay.on',
  edge: 'approvals-banner.overlay.edge',
  top: 'approvals-banner.overlay.top',
  size: 'approvals-banner.overlay.size',
  expand: 'approvals-banner.overlay.expand',
  show: 'approvals-banner.overlay.show',
  idleVisible: 'approvals-banner.overlay.idleVisible',
  idleOpacity: 'approvals-banner.overlay.idleOpacity',
  shrinkAfterSec: 'approvals-banner.overlay.shrinkAfterSec',
  pages: 'approvals-banner.overlay.pages',
} as const;

export type OverlayKey = keyof typeof OVERLAY_KEYS;

export interface OverlayConfig {
  /** the toolbar is on (the phone also needs "Display over other apps") */ on: boolean;
  /** which side of the screen it sits on */ edge: 'end' | 'start';
  /** distance from the top, percent of the screen height (0–90); dragging it on the phone sets this */ top: number;
  /** text and spacing scale */ size: 'small' | 'medium' | 'large';
  /** what opens the card: every approval, only held calls (they run on their own), or never */ expand: 'every' | 'held' | 'never';
  /** what the toolbar says: the next held call's countdown, or how many wait */ show: 'next' | 'count';
  /** keep the toolbar on screen when nothing waits (off: it appears only with an approval) */ idleVisible: boolean;
  /** toolbar opacity while nothing waits, percent */ idleOpacity: number;
  /** after the last approval goes, shrink back after this many seconds (0 = at once) */ shrinkAfterSec: number;
  /**
   * where pages Amber opens go (open_url, console_show; Brett, Nov 13 2026: "I want it to pop up a full browser window
   * if I want to, if I go to a page. But I want it to be just a floating toolbar unless you call it to open something."):
   * the toolbar's own full-screen browser window, closed back to the toolbar; or Chrome
   */ pages: 'overlay' | 'browser';
}

export const OVERLAY_DEFAULTS: OverlayConfig = {
  on: true, edge: 'end', top: 30, size: 'small', expand: 'every', show: 'next', idleVisible: true, idleOpacity: 85, shrinkAfterSec: 0, pages: 'overlay',
};

export const EDGES = [{ value: 'end', label: 'Right' }, { value: 'start', label: 'Left' }] as const;
export const SIZES = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] as const;
export const EXPANDS = [
  { value: 'every', label: 'Every approval' },
  { value: 'held', label: 'Only held commands (they run by themselves)' },
  { value: 'never', label: 'Never (tap the toolbar to open it)' },
] as const;
export const PAGES = [
  { value: 'overlay', label: 'The toolbar opens into a full browser window' },
  { value: 'browser', label: 'Chrome' },
] as const;
export const SHOWS = [{ value: 'next', label: 'Next countdown' }, { value: 'count', label: 'How many wait' }] as const;

const pick = <T extends string>(v: unknown, list: readonly { value: T }[], d: T): T => (list.some((o) => o.value === v) ? (v as T) : d);
const num = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/** The settings as the phone uses them (the same clamps as Java `ApprovalOverlayRules.settings`). */
export function overlayConfig(get: (k: string) => unknown): OverlayConfig {
  const d = OVERLAY_DEFAULTS;
  return {
    on: bool(get(OVERLAY_KEYS.on), d.on),
    edge: pick(get(OVERLAY_KEYS.edge), EDGES, d.edge),
    top: num(get(OVERLAY_KEYS.top), 0, 90, d.top),
    size: pick(get(OVERLAY_KEYS.size), SIZES, d.size),
    expand: pick(get(OVERLAY_KEYS.expand), EXPANDS, d.expand),
    show: pick(get(OVERLAY_KEYS.show), SHOWS, d.show),
    idleVisible: bool(get(OVERLAY_KEYS.idleVisible), d.idleVisible),
    idleOpacity: num(get(OVERLAY_KEYS.idleOpacity), 40, 100, d.idleOpacity),
    shrinkAfterSec: num(get(OVERLAY_KEYS.shrinkAfterSec), 0, 60, d.shrinkAfterSec),
    pages: pick(get(OVERLAY_KEYS.pages), PAGES, d.pages),
  };
}

/** Spoken / typed names for each setting (voice: "overlay size large", "overlay position left"). */
const ALIASES: Record<string, OverlayKey> = {
  on: 'on', enabled: 'on', edge: 'edge', side: 'edge', position: 'edge', top: 'top', height: 'top', y: 'top', size: 'size',
  expand: 'expand', opens: 'expand', show: 'show', shows: 'show', label: 'show', idle: 'idleVisible', idlevisible: 'idleVisible',
  opacity: 'idleOpacity', idleopacity: 'idleOpacity', shrink: 'shrinkAfterSec', shrinkafter: 'shrinkAfterSec', shrinkaftersec: 'shrinkAfterSec',
  pages: 'pages', links: 'pages', browser: 'pages',
};
const WORDS: Record<string, string> = { right: 'end', left: 'start', medium: 'medium', big: 'large', small: 'small', large: 'large', held: 'held', all: 'every', always: 'every', chrome: 'browser', window: 'overlay', toolbar: 'overlay', inside: 'overlay' };

/**
 * One setting change by name (`approvals.overlay:<what>:<value>`): the key and parsed value, or an error to show.
 * `approvals.overlay:on|off` alone switches it.
 */
export function parseOverlayChange(what: string, value: string): { key: string; value: string | number | boolean } | { error: string } {
  const w = what.trim().toLowerCase().replace(/[\s_-]/g, '');
  if ((w === 'on' || w === 'off') && !value) return { key: OVERLAY_KEYS.on, value: w === 'on' };
  const name = ALIASES[w];
  if (!name) return { error: `unknown overlay setting "${what}" (on, edge, top, size, expand, show, idle, opacity, shrink, pages)` };
  const raw = value.trim().toLowerCase();
  const v = WORDS[raw] ?? raw;
  const yes = /^(on|true|yes|1)$/.test(v), no = /^(off|false|no|0)$/.test(v);
  const d = OVERLAY_DEFAULTS[name];
  if (typeof d === 'boolean') return yes || no ? { key: OVERLAY_KEYS[name], value: yes } : { error: `${name} takes on or off` };
  if (typeof d === 'number') {
    const n = Number(v.replace(/%|s$/g, ''));
    return Number.isFinite(n) ? { key: OVERLAY_KEYS[name], value: n } : { error: `${name} takes a number` };
  }
  const list = name === 'edge' ? EDGES : name === 'size' ? SIZES : name === 'expand' ? EXPANDS : name === 'pages' ? PAGES : SHOWS;
  return list.some((o) => o.value === v) ? { key: OVERLAY_KEYS[name], value: v } : { error: `${name} takes ${list.map((o) => o.value).join(', ')}` };
}

/**
 * The page window by name: `approvals.overlay:page[:<url>]` opens one of Brett's pages in the toolbar's full browser
 * window (no URL: the last page or the console); `approvals.overlay:close` closes it, just the toolbar again. Null when
 * [what] isn't one of these.
 */
export function parsePageCommand(what: string, value: string): { command: 'page' | 'close-page'; url?: string } | null {
  const w = what.trim().toLowerCase().replace(/[\s_-]/g, '');
  const url = value.trim();
  if (w === 'page' || w === 'openpage' || w === 'go') return url ? { command: 'page', url } : { command: 'page' };
  if (w === 'close' || w === 'closepage') return { command: 'close-page' };
  return null;
}

/** The phone's settings payload (Java `WatchService.setApprovalOverlay`). */
export const nativeOverlayConfig = (c: OverlayConfig): Record<string, unknown> => ({ ...c });
