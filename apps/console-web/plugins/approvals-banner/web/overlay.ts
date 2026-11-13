/**
 * The AmberX overlay (one overlay since Nov 13 2026, replacing the separate float and pages builds). On the phone
 * (AmberX, Java `ApprovalOverlay`) an always-on toolbar floats over every app: it spawns the approval bar (what, why,
 * countdown, Approve / Deny / Shelve) when something waits, and expands into a full-screen browser with the toolbar
 * docked top-left, where Amber drives the console live while Brett watches. Because the toolbar window is always
 * visible, AmberX may open pages from the background, so every AI "open X" goes through it.
 *
 * Pure part: its settings, runtime settings `approvals-banner.overlay.*` (Settings → Plugins → Approvals banner, the
 * level toolbar, the console API / MCP / CLI like every setting), the one-time move off the retired settings, and the
 * verbs `overlay.expand`, `overlay.collapse`, `overlay.open {url}` (voice, console actions, MCP, the CLI). The phone gets
 * the settings through the veto host (`VetoHost.overlay`); its colours follow the active skin.
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
  idleOpacity: 'approvals-banner.overlay.idleOpacity',
  shrinkAfterSec: 'approvals-banner.overlay.shrinkAfterSec',
} as const;

/**
 * Settings the float and pages builds had, folded in by {@link migrateOverlay}: the toolbar now always shows (it is
 * what lets AmberX open pages from the background) and every open goes through the overlay.
 */
export const RETIRED_KEYS = {
  idleVisible: 'approvals-banner.overlay.idleVisible',
  pages: 'approvals-banner.overlay.pages',
} as const;

export type OverlayKey = keyof typeof OVERLAY_KEYS;

export interface OverlayConfig {
  /** the one on/off switch (the phone also needs "Display over other apps") */ on: boolean;
  /** which side of the screen the toolbar sits on; dragging it on the phone sets this */ edge: 'end' | 'start';
  /** distance from the top, percent of the screen height (0–90); dragging it on the phone sets this */ top: number;
  /** text and spacing scale */ size: 'small' | 'medium' | 'large';
  /** what opens the approval bar: every approval, only held calls (they run on their own), or never */ expand: 'every' | 'held' | 'never';
  /** what the toolbar says: the next held call's countdown, or how many wait */ show: 'next' | 'count';
  /** toolbar opacity while nothing waits, percent */ idleOpacity: number;
  /** after the last approval goes, fold the approval bar after this many seconds (0 = at once) */ shrinkAfterSec: number;
}

export const OVERLAY_DEFAULTS: OverlayConfig = {
  on: true, edge: 'end', top: 30, size: 'small', expand: 'every', show: 'next', idleOpacity: 85, shrinkAfterSec: 0,
};

export const IDLE_OPACITY_MIN = 40;

export const EDGES = [{ value: 'end', label: 'Right' }, { value: 'start', label: 'Left' }] as const;
export const SIZES = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] as const;
export const EXPANDS = [
  { value: 'every', label: 'Every approval' },
  { value: 'held', label: 'Only held commands (they run by themselves)' },
  { value: 'never', label: 'Never (tap ▸ on the toolbar to open it)' },
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
    idleOpacity: num(get(OVERLAY_KEYS.idleOpacity), IDLE_OPACITY_MIN, 100, d.idleOpacity),
    shrinkAfterSec: num(get(OVERLAY_KEYS.shrinkAfterSec), 0, 60, d.shrinkAfterSec),
  };
}

/**
 * The one-time move off the retired settings (the same rule as Java `ApprovalOverlayRules.migrate`): "hide the
 * toolbar when nothing waits" becomes the faintest idle toolbar, "pages in Chrome" is dropped (Chrome stays one tap
 * away on the docked toolbar). → the settings to write (retired keys set to null to clear them), or null when there is
 * nothing to move.
 */
export function migrateOverlay(get: (k: string) => unknown): Record<string, unknown> | null {
  const idle = get(RETIRED_KEYS.idleVisible), pages = get(RETIRED_KEYS.pages);
  const has = (v: unknown) => v !== undefined && v !== null; // the runtime answers null for a key nobody saved
  if (!has(idle) && !has(pages)) return null;
  const out: Record<string, unknown> = {};
  if (has(idle)) out[RETIRED_KEYS.idleVisible] = null;
  if (has(pages)) out[RETIRED_KEYS.pages] = null;
  if (idle === false) out[OVERLAY_KEYS.idleOpacity] = IDLE_OPACITY_MIN;
  return out;
}

/** Spoken / typed names for each setting (voice: "overlay size large", "overlay position left"). */
const ALIASES: Record<string, OverlayKey> = {
  on: 'on', enabled: 'on', edge: 'edge', side: 'edge', position: 'edge', top: 'top', height: 'top', y: 'top', size: 'size',
  expand: 'expand', opens: 'expand', opensfor: 'expand', show: 'show', shows: 'show', label: 'show',
  opacity: 'idleOpacity', idleopacity: 'idleOpacity', shrink: 'shrinkAfterSec', shrinkafter: 'shrinkAfterSec', shrinkaftersec: 'shrinkAfterSec',
};
const WORDS: Record<string, string> = { right: 'end', left: 'start', medium: 'medium', big: 'large', small: 'small', large: 'large', held: 'held', all: 'every', always: 'every' };

/**
 * One setting change by name (`approvals.overlay:<what>:<value>`): the key and parsed value, or an error to show.
 * `approvals.overlay:on|off` alone switches it.
 */
export function parseOverlayChange(what: string, value: string): { key: string; value: string | number | boolean } | { error: string } {
  const w = what.trim().toLowerCase().replace(/[\s_-]/g, '');
  if ((w === 'on' || w === 'off') && !value) return { key: OVERLAY_KEYS.on, value: w === 'on' };
  const name = ALIASES[w];
  if (!name) return { error: `unknown overlay setting "${what}" (on, edge, top, size, opens, show, opacity, shrink)` };
  const raw = value.trim().toLowerCase();
  const v = WORDS[raw] ?? raw;
  const yes = /^(on|true|yes|1)$/.test(v), no = /^(off|false|no|0)$/.test(v);
  const d = OVERLAY_DEFAULTS[name];
  if (typeof d === 'boolean') return yes || no ? { key: OVERLAY_KEYS[name], value: yes } : { error: `${name} takes on or off` };
  if (typeof d === 'number') {
    const n = Number(v.replace(/%|s$/g, ''));
    return Number.isFinite(n) ? { key: OVERLAY_KEYS[name], value: n } : { error: `${name} takes a number` };
  }
  const list = name === 'edge' ? EDGES : name === 'size' ? SIZES : name === 'expand' ? EXPANDS : SHOWS;
  return list.some((o) => o.value === v) ? { key: OVERLAY_KEYS[name], value: v } : { error: `${name} takes ${list.map((o) => o.value).join(', ')}` };
}

/* ---------------- the verbs: overlay.expand, overlay.collapse, overlay.open {url} ---------------- */

export type OverlayVerb = 'expand' | 'collapse' | 'open';
/** The approval bar on its own (it opens by itself when something waits). */
export type OverlayBarVerb = 'bar-open' | 'bar-close';

/** The pages the overlay's browser loads: https on Brett's own domain (the same rule as Java `OpenUrlRules`). */
export function overlayUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'amberxai.com' || u.hostname.endsWith('.amberxai.com')) && !u.username && !u.password;
  } catch { return false; }
}

/**
 * A spoken or typed overlay command → the verb (and URL for open), or null when it isn't one. Accepts the action
 * names (`expand`, `collapse`, `open <url>`) and the older `approvals.overlay` words (`page[:<url>]`, `close`,
 * `close-page`, `fullscreen`, `minimize`); `bar` / `bar:off` work the approval bar.
 */
export function parseOverlayVerb(what: string, value = ''): { verb: OverlayVerb; url?: string } | { verb: OverlayBarVerb } | { error: string } | null {
  const w = what.trim().toLowerCase().replace(/[\s_-]/g, '');
  const arg = value.trim();
  if (w === 'expand' || w === 'fullscreen' || w === 'maximize' || ((w === 'page' || w === 'go') && !arg)) return { verb: 'expand' };
  if (w === 'collapse' || w === 'close' || w === 'closepage' || w === 'minimize') return { verb: 'collapse' };
  if (w === 'open' || w === 'page' || w === 'openpage' || w === 'go') {
    if (!arg) return { verb: 'expand' };
    return overlayUrlAllowed(arg) ? { verb: 'open', url: arg } : { error: `overlay.open takes one of your own pages (https://…amberxai.com), not "${arg}"` };
  }
  if (w === 'bar' || w === 'approvals' || w === 'card') return { verb: /^(off|close|fold|no|false|0)$/i.test(arg) ? 'bar-close' : 'bar-open' };
  if (w === 'fold') return { verb: 'bar-close' };
  return null;
}

/**
 * The URL that carries a verb to the phone through axHub's `amberx.open_url` (AXPP `browser.open`, no new hub tool):
 * expand and collapse are the console URL with `axf-overlay=<verb>`; open is the page itself.
 */
export function overlayVerbUrl(verb: OverlayVerb, url = '', consoleUrl = 'https://console.amberxai.com'): string {
  if (verb === 'open') return url;
  return `${consoleUrl.replace(/\/$/, '')}/?axf-overlay=${verb}`;
}

/** What the overlay's browser exposes to the console running inside it (Java `ApprovalOverlay.Bridge`). */
export interface OverlayBridge {
  collapse(): void;
  open(url: string): void;
  state(): string;
}

/** The bridge when this console runs inside AmberX's overlay browser, else null. */
export function overlayBridge(scope: unknown = globalThis): OverlayBridge | null {
  const b = (scope as { AmberxOverlay?: Partial<OverlayBridge> } | null)?.AmberxOverlay;
  return b && typeof b.collapse === 'function' && typeof b.open === 'function' ? (b as OverlayBridge) : null;
}

/** The phone's settings payload (Java `WatchService.setApprovalOverlay`). */
export const nativeOverlayConfig = (c: OverlayConfig): Record<string, unknown> => ({ ...c });
