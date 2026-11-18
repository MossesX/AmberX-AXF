/**
 * Banner data (capability service `axf.banner-data@1`): how a plugin hands what one of its banner widgets shows to whichever
 * plugin draws the banner widgets, without either naming the other.
 *
 * A data plugin calls `supplyBannerData(widget, supply, origin)` whenever its numbers change: `widget` is the widget's
 * stable id (it is also the id of the asset drawn, so saved positions and sizes keep working), `supply` is the asset's
 * type and data (or null: nothing to show right now). Counters stay where they always were (rt.setBadge).
 * The widgets plugin reads `bannerData()` / `onBannerData()` and owns everything else: the asset, whether it is on the
 * banner, its side, order, size, shape and icon. With no widgets plugin installed the data simply goes unused.
 *
 * Pure module state, no runtime and no React, so AmberX bundles the same file (apps/amberx-droid/vite.config.ts).
 */

export type BannerDataType = 'status' | 'counter' | 'badge' | 'action-button';

export interface BannerDataSupply {
  type: BannerDataType;
  /** the asset's `data` (status: counter, onLabel…; counter: counter, tone…; badge: icon, label…; action-button: action…) */
  data: Record<string, unknown>;
  /** the asset's name and description (default: the widget's own) */
  name?: string;
  description?: string;
  tags?: string[];
}

export interface BannerDataEntry extends BannerDataSupply {
  widget: string;
  /** the plugin id that supplied it (dropped when that plugin is switched off) */
  origin: string;
  /** bumps on every supply, so a reader can tell a change from a repeat */
  rev: number;
}

const WIDGET_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const TYPES: readonly BannerDataType[] = ['status', 'counter', 'badge', 'action-button'];
const entries = new Map<string, BannerDataEntry>();
const listeners = new Set<(widget: string) => void>();
let rev = 0;

const tell = (widget: string) => { for (const f of [...listeners]) { try { f(widget); } catch { /* a bad reader can't stop the others */ } } };

/** Hand over (or with null, take back) what a banner widget shows. Bad input is ignored. */
export function supplyBannerData(widget: string, supply: BannerDataSupply | null, origin: string): void {
  if (!WIDGET_ID.test(widget)) return;
  if (!supply) { if (entries.delete(widget)) tell(widget); return; }
  if (!TYPES.includes(supply.type) || !supply.data || typeof supply.data !== 'object') return;
  entries.set(widget, { ...supply, data: { ...supply.data }, widget, origin, rev: ++rev });
  tell(widget);
}

/** What one widget has to show now, or null. */
export function bannerData(widget: string): BannerDataEntry | null { return entries.get(widget) ?? null; }

/** Every widget with something to show now. */
export function allBannerData(): BannerDataEntry[] { return [...entries.values()]; }

/** Called with the widget id whenever its data changes or goes. Returns the unsubscribe. */
export function onBannerData(fn: (widget: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Drop everything one plugin supplied (the console calls it when that plugin is switched off). */
export function dropBannerData(origin: string): void {
  for (const [w, e] of [...entries]) if (e.origin === origin) { entries.delete(w); tell(w); }
}
