/**
 * The pure half of the console's place (no DOM, no React): the frame, parsing, deep-link precedence, merging and the
 * sessionStorage read / write. Unit tested by scripts/place-state-check.mts; placeState.ts adds the DOM half.
 */
/* ================================================================== the place (pure) */

export const PLACE_FRAME = 'console-place@1';
export const PLACE_STORAGE_KEY = 'axf:console-place@1';
/** A saved place older than this is ignored (a tab left for days opens fresh). */
export const PLACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Query parameters that are deep links: any of them on load wins over the saved place. */
export const DEEP_LINK_PARAMS = ['axf-open', 'axf-cmd', 'axf-ref'] as const;
/** Saving waits this long after the last change. */
export const PLACE_SAVE_DEBOUNCE_MS = 250;

export interface ConsolePlace {
  $axf: typeof PLACE_FRAME;
  /** ISO time of the save */
  at: string;
  /** what saved it last: change, pagehide, hidden, unload, refresh, pull-refresh, api */
  by: string;
  /** the open view's address, `view:<id>` */
  view: string;
  /** tab row address → active tab value */
  tabs: Record<string, string>;
  /** grid address → selected row id */
  selection: Record<string, string>;
  /** scroll address → offset from the top in px */
  scroll: Record<string, number>;
}

export const viewAddress = (id: string): string => `view:${id}`;
export const viewIdOf = (address: string): string | null => (/^view:([^/]+)$/.test(address) ? address.slice(5) : null);

export function emptyPlace(view = 'home', by = 'change', at = new Date()): ConsolePlace {
  return { $axf: PLACE_FRAME, at: at.toISOString(), by, view: viewAddress(view), tabs: {}, selection: {}, scroll: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function pick<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(v)) return out;
  for (const [k, x] of Object.entries(v)) if (k && ok(x)) out[k] = x;
  return out;
}
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 400;
const isOffset = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Reads a stored place; null when missing, malformed, from another frame or older than `maxAgeMs`. */
export function parsePlace(raw: string | null | undefined, now = Date.now(), maxAgeMs = PLACE_MAX_AGE_MS): ConsolePlace | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isRecord(v) || v.$axf !== PLACE_FRAME || typeof v.view !== 'string' || !viewIdOf(v.view)) return null;
  const at = Date.parse(String(v.at ?? ''));
  if (!Number.isFinite(at) || now - at > maxAgeMs || at - now > 60_000) return null;
  return {
    $axf: PLACE_FRAME, at: new Date(at).toISOString(), by: typeof v.by === 'string' ? v.by : 'change', view: v.view,
    tabs: pick(v.tabs, isStr), selection: pick(v.selection, isStr), scroll: pick(v.scroll, isOffset),
  };
}

/** True when the URL carries a deep link that must win over the saved place. */
export function hasDeepLink(href: string): boolean {
  try { const u = new URL(href); return DEEP_LINK_PARAMS.some((p) => u.searchParams.has(p)); } catch { return false; }
}

/**
 * What a load should restore: the saved place, unless a deep link is in the URL (the link wins: null) or the place is
 * unusable. `views` (when given) drops a saved view this console doesn't have; plugin views that load later are kept
 * when `views` is omitted.
 */
export function placeToRestore(saved: ConsolePlace | null, href: string, views?: readonly string[]): ConsolePlace | null {
  if (!saved || hasDeepLink(href)) return null;
  const id = viewIdOf(saved.view);
  if (!id || (views && !views.includes(id))) return null;
  return saved;
}

/** Only the parts of `place` that sit under `view` (or are global, like `scroll:main`) are reapplied on that view. */
export function belongsToView(address: string, view: string): boolean {
  if (address.startsWith('scroll:')) return true;
  if (address.startsWith('view:')) return address === view || address.startsWith(`${view}/`);
  return true;
}

/** A new place from the current one plus what is on screen now (rows not on screen keep their last value). */
export function mergePlace(prev: ConsolePlace | null, now: Omit<ConsolePlace, '$axf'>): ConsolePlace {
  const sameView = prev?.view === now.view;
  return {
    $axf: PLACE_FRAME, at: now.at, by: now.by, view: now.view,
    tabs: { ...(prev?.tabs ?? {}), ...now.tabs },
    selection: { ...(sameView ? prev?.selection : {}), ...now.selection },
    // scroll belongs to the view on screen: a new view starts from what it reports
    scroll: { ...(sameView ? prev?.scroll : {}), ...now.scroll },
  };
}

/* ================================================================== storage */

function storage(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

export function readPlace(now = Date.now()): ConsolePlace | null {
  try { return parsePlace(storage()?.getItem(PLACE_STORAGE_KEY), now); } catch { return null; }
}

export function writePlace(place: ConsolePlace): void {
  try { storage()?.setItem(PLACE_STORAGE_KEY, JSON.stringify(place)); } catch { /* storage full or off: this page only */ }
}

export function clearPlace(): void {
  try { storage()?.removeItem(PLACE_STORAGE_KEY); } catch { /* storage off */ }
}

