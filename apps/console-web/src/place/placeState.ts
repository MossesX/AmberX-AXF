/**
 * The console's place store: where the person is (view, active tab of every tab row, selection, scroll offsets of the
 * main scroller and named panes), kept in sessionStorage so a reload, a pull-down refresh or a server-pushed console
 * refresh can put them back exactly there. sessionStorage on purpose: the place belongs to this browser tab and ends
 * with it; a second console tab keeps its own.
 *
 * Everything is keyed by console-control@1 addresses (framework/spec/CONSOLE-CONTROL.md):
 *   view       `view:builds`
 *   tabs       `view:builds/tab:builds.tabs` → the active tab value (`tabAddress` gives `…/tab:builds.tabs=queue`)
 *   selection  `view:builds/grid:queue` → [`row:<id>`, …]
 *   scroll     `view:builds/scroll:main`, `view:builds/scroll:<pane id>` → { top, left }
 * An address without a leading `view:` is filed under the current view, so a pane only has to know its own name.
 *
 * Writes are debounced; `install()` also flushes on pagehide and when the page is hidden (the only moments a phone
 * reliably gives before a reload) and records scroll offsets as the person scrolls. This module only saves and answers;
 * putting the place back is the caller's job (`suspend()` keeps the resets of a remount from overwriting what was saved).
 */
import { formatAddress, parseAddress } from '../axf/core/engines/console-control';
import { SCROLL_CONTAINER_ATTR, mainScrollElement, scrollAddressOf } from '../axf/react/scrollControl';

export const PLACE_KEY = 'axf:console:place@1';
/** How long a change waits before it is written (ms). */
export const PLACE_SAVE_DELAY = 200;
/** Most entries kept per map (tabs, selection, scroll); the least recently changed go first. */
export const PLACE_MAX_ENTRIES = 200;
/** Most selected items kept per selection. */
export const PLACE_MAX_SELECTION = 500;

export interface PlaceScroll { top: number; left: number }
export interface PlaceState {
  v: 1;
  /** When it was last changed (ms since epoch). */
  at: number;
  /** The current view's address (`view:<id>`), else null. */
  view: string | null;
  /** Tab row address → active tab value. */
  tabs: Record<string, string>;
  /** Grid / list / view address → selected item addresses (`row:<id>`). */
  selection: Record<string, string[]>;
  /** Scroll container address → offsets. Only containers that are scrolled away from the start are listed. */
  scroll: Record<string, PlaceScroll>;
}

export interface PlaceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface PlaceStoreOptions {
  /** Where it is kept; default the browser's sessionStorage (none: the place lives for this page only). */
  storage?: PlaceStorage | null;
  key?: string;
  delay?: number;
  now?: () => number;
}

const emptyPlace = (): PlaceState => ({ v: 1, at: 0, view: null, tabs: {}, selection: {}, scroll: {} });

function browserStorage(): PlaceStorage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/** `builds` or `view:builds` as a view address; null for nothing. */
export function viewAddress(view: string | null | undefined): string | null {
  if (!view) return null;
  return view.startsWith('view:') ? view : formatAddress([{ kind: 'view', id: view }]);
}

/** The view id of a view address (`view:builds/tab:x` → `builds`), else null. */
export function viewIdOf(address: string | null | undefined): string | null {
  if (!address) return null;
  try { const first = parseAddress(address)[0]; return first?.kind === 'view' ? first.id : null; } catch { return null; }
}

/** A selected item as an address: an address stays as it is, a bare id becomes `row:<id>`. */
export function rowAddress(item: string): string {
  try { parseAddress(item); return item; } catch { return formatAddress([{ kind: 'row', id: item }]); }
}

/** The address of one tab of a row: `view:builds/tab:builds.tabs` + `queue` → `view:builds/tab:builds.tabs=queue`. */
export const tabAddress = (row: string, value: string): string => `${row}=${value.replace(/%/g, '%25').replace(/\//g, '%2F')}`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const offset = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** A stored value as a place: anything malformed is dropped, never thrown. */
export function readPlace(raw: unknown): PlaceState {
  const out = emptyPlace();
  let data: unknown = raw;
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch { return out; } }
  if (!isRecord(data) || data.v !== 1) return out;
  if (typeof data.at === 'number' && Number.isFinite(data.at)) out.at = data.at;
  if (typeof data.view === 'string' && data.view.startsWith('view:')) out.view = data.view;
  if (isRecord(data.tabs)) for (const [k, v] of Object.entries(data.tabs)) if (typeof v === 'string') out.tabs[k] = v;
  if (isRecord(data.selection)) {
    for (const [k, v] of Object.entries(data.selection)) {
      if (Array.isArray(v)) { const items = v.filter((x): x is string => typeof x === 'string' && x !== ''); if (items.length) out.selection[k] = items.slice(0, PLACE_MAX_SELECTION); }
    }
  }
  if (isRecord(data.scroll)) {
    for (const [k, v] of Object.entries(data.scroll)) {
      if (!isRecord(v)) continue;
      const top = offset(v.top), left = offset(v.left);
      if (top || left) out.scroll[k] = { top, left };
    }
  }
  return out;
}

/** Set (or with `undefined` remove) one entry, moving it to the end so the cap drops the least recently changed. */
function put<T>(map: Record<string, T>, key: string, value: T | undefined): void {
  delete map[key];
  if (value === undefined) return;
  map[key] = value;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - PLACE_MAX_ENTRIES; i++) delete map[keys[i]!];
}

const sameItems = (a: readonly string[] | undefined, b: readonly string[]): boolean => (a ?? []).length === b.length && b.every((x, i) => a![i] === x);

export interface PlaceStore {
  /** The whole place (a copy). */
  get(): PlaceState;
  /** The current view's address, else null. */
  view(): string | null;
  /** Set the current view (`builds` or `view:builds`). */
  setView(view: string | null): void;
  /** The active tab value saved for a tab row, else null. */
  tab(row: string): string | null;
  /** Save the active tab of a tab row (null forgets it). */
  setTab(row: string, value: string | null): void;
  /** The selected item addresses saved under a grid / list / view, else []. */
  selection(scope: string): string[];
  /** Save the selection under a grid / list / view: item addresses or bare row ids (null or [] forgets it). */
  setSelection(scope: string, items: string | readonly string[] | null): void;
  /** The offsets saved for a scroll container (`scroll:main`, `scroll:<pane>`), else null (it was at the start). */
  scroll(container?: string): PlaceScroll | null;
  /** Save the offsets of a scroll container. */
  setScroll(container: string, top: number, left?: number): void;
  /** Read the offsets of the main scroller and every named pane on the page into the store. */
  captureScroll(): void;
  /** Write now (no debounce). */
  flush(): void;
  /** Forget everything, here and in storage. */
  clear(): void;
  /** Stop recording scroll from the page until the returned function is called (a restore is putting the place back). */
  suspend(): () => void;
  /** Called after every change. */
  subscribe(fn: (place: PlaceState) => void): () => void;
  /** Record scrolling and flush on pagehide / hidden. Returns the uninstall. */
  install(): () => void;
}

export function createPlaceStore(options: PlaceStoreOptions = {}): PlaceStore {
  const key = options.key ?? PLACE_KEY;
  const delay = options.delay ?? PLACE_SAVE_DELAY;
  const now = options.now ?? Date.now;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const listeners = new Set<(place: PlaceState) => void>();
  let state: PlaceState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let suspended = 0;

  const load = (): PlaceState => {
    if (state) return state;
    let raw: string | null = null;
    try { raw = storage?.getItem(key) ?? null; } catch { /* storage blocked: start empty */ }
    state = readPlace(raw);
    return state;
  };

  const flush = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!dirty || !state) return;
    dirty = false;
    try { storage?.setItem(key, JSON.stringify(state)); } catch { /* full or blocked: the place lasts for this page only */ }
  };

  const changed = (): void => {
    const s = load();
    s.at = now();
    dirty = true;
    if (timer === null) timer = setTimeout(() => { timer = null; flush(); }, delay);
    for (const fn of [...listeners]) fn(s);
  };

  /** A relative address filed under the current view. */
  const under = (address: string): string => {
    const view = load().view;
    return address.startsWith('view:') || !view ? address : `${view}/${address}`;
  };

  const setScroll = (container: string, top: number, left = 0): void => {
    const s = load(), k = under(container);
    const next = { top: offset(top), left: offset(left) };
    const had = s.scroll[k];
    if ((had?.top ?? 0) === next.top && (had?.left ?? 0) === next.left) return;
    put(s.scroll, k, next.top || next.left ? next : undefined);
    changed();
  };

  const record = (el: Element | null): void => {
    if (!(el instanceof HTMLElement)) return;
    // Only the main scroller and panes that carry a name: an unnamed inner scroller has no address of its own.
    const named = el.hasAttribute(SCROLL_CONTAINER_ATTR);
    if (!named && el !== mainScrollElement() && el !== document.scrollingElement) return;
    setScroll(named ? scrollAddressOf(el) : 'scroll:main', el.scrollTop, el.scrollLeft);
  };

  const captureScroll = (): void => {
    if (typeof document === 'undefined' || suspended) return;
    record(mainScrollElement());
    // A pane that is not laid out (a kept, hidden view) reads 0: its saved offsets stay.
    document.querySelectorAll<HTMLElement>(`[${SCROLL_CONTAINER_ATTR}]`).forEach((el) => { if (el.getClientRects().length) record(el); });
  };

  const store: PlaceStore = {
    get: () => JSON.parse(JSON.stringify(load())) as PlaceState,
    view: () => load().view,
    setView(view) {
      const s = load(), next = viewAddress(view);
      if (s.view === next) return;
      s.view = next;
      changed();
    },
    tab: (row) => load().tabs[under(row)] ?? null,
    setTab(row, value) {
      const s = load(), k = under(row);
      if ((s.tabs[k] ?? null) === (value || null)) return;
      put(s.tabs, k, value || undefined);
      changed();
    },
    selection: (scope) => [...(load().selection[under(scope)] ?? [])],
    setSelection(scope, items) {
      const s = load(), k = under(scope);
      const next = (items === null ? [] : typeof items === 'string' ? [items] : [...items]).filter(Boolean).slice(0, PLACE_MAX_SELECTION).map(rowAddress);
      if (sameItems(s.selection[k], next)) return;
      put(s.selection, k, next.length ? next : undefined);
      changed();
    },
    scroll(container = 'scroll:main') { const v = load().scroll[under(container)]; return v ? { ...v } : null; },
    setScroll,
    captureScroll,
    flush,
    clear() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      dirty = false;
      state = emptyPlace();
      try { storage?.removeItem(key); } catch { /* blocked: nothing was kept */ }
      for (const fn of [...listeners]) fn(state);
    },
    suspend() {
      suspended++;
      let released = false;
      return () => { if (!released) { released = true; suspended--; } };
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    install() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
      const onScroll = (e: Event) => {
        if (suspended) return;
        const t = e.target;
        record(t === document || t === window ? (document.scrollingElement as HTMLElement | null) : (t as Element | null));
      };
      const save = () => { captureScroll(); flush(); };
      const onVisibility = () => { if (document.visibilityState === 'hidden') save(); };
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
      window.addEventListener('pagehide', save);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        document.removeEventListener('scroll', onScroll, { capture: true });
        window.removeEventListener('pagehide', save);
        document.removeEventListener('visibilitychange', onVisibility);
        flush();
      };
    },
  };
  return store;
}

/** The console's place (this browser tab). */
export const placeStore = createPlaceStore();
