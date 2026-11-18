/**
 * Banner widgets: the widgets other plugins supply data for (registry.ts SUPPLIED). This plugin registers each asset, puts
 * it on the banner or takes it off, and repaints the moment its data or one of its settings changes. Positions, sizes and
 * hides the person picked stay in the framework's widget prefs (keyed `type:id`, unchanged by the move).
 */
import type { AxfRuntime } from '@console/axf/core';
import { bannerData, onBannerData } from '@console/bannerData';
import { ICONS } from './model';
import { SUPPLIED, iconChoice, iconKeyOf, sideOf, suppliedAsset, wanted, widgetKey, type WidgetDef } from './registry';

const placed = new Map<string, string>();
let unsubscribe: (() => void) | null = null;
const counters = new Map<string, number>();

const read = (rt: AxfRuntime) => (k: string) => rt.settings.get(k);

/** Put one supplied widget on the banner as its data and settings say, or take it off. */
export function paintSupplied(rt: AxfRuntime, w: WidgetDef, origin: string): void {
  const key = widgetKey(w);
  const s = bannerData(w.id);
  const r = read(rt);
  if (s && s.type === w.type) rt.registry.register(suppliedAsset(w, s, iconChoice(r, w, ICONS)) as never, 'app', origin);
  const data = s && s.type === w.type ? s.data : null;
  if (!wanted(r, w, data, (c) => rt.badge(c))) {
    if (placed.has(w.id)) { rt.detachFromBanner(key); placed.delete(w.id); }
    return;
  }
  const at = sideOf(r, w);
  const place = `${at}:${w.order}`;
  if (placed.get(w.id) === place) return;
  if (placed.has(w.id)) rt.detachFromBanner(key);
  placed.set(w.id, place);
  rt.attachToBanner({ type: w.type, id: w.asset, at, order: w.order, origin, widget: { ...w.hint } });
}

/** Watch the banner data, the settings and the counters `when` depends on; paint every supplied widget once now. */
export function startSupplied(rt: AxfRuntime, origin: string): void {
  if (!unsubscribe) {
    unsubscribe = onBannerData((id) => { const w = SUPPLIED.find((x) => x.id === id); if (w) paintSupplied(rt, w, origin); });
    const keys = new Set<string>();
    for (const w of SUPPLIED) for (const k of [w.showKey, w.when?.key, w.sideKey, iconKeyOf(w)]) if (k) keys.add(k);
    for (const k of keys) rt.settings.onChange(k, () => { for (const w of SUPPLIED) paintSupplied(rt, w, origin); });
    // `when: lit` follows the supplier's counter: repaint only the ones whose counter moved
    rt.subscribe(() => {
      for (const w of SUPPLIED) {
        if (!w.when) continue;
        const c = bannerData(w.id)?.data.counter;
        if (typeof c !== 'string') continue;
        const n = rt.badge(c);
        if (counters.get(w.id) === n) continue;
        counters.set(w.id, n);
        paintSupplied(rt, w, origin);
      }
    });
  }
  placed.clear(); // a fresh register (hot reload, switched back on) attaches everything again
  for (const w of SUPPLIED) paintSupplied(rt, w, origin);
}
