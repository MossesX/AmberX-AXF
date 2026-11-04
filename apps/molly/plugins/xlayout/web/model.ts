/**
 * xLayout's model (pure, no React): the xlayout@1 asset in force with the user's saved choices on top. The asset says
 * what Molly does by default; Settings → Plugins → xLayout and the Toolbar designer save per key (last save wins), and
 * a key nobody saved falls back to the asset. Everything is checked again by the engine (`normalizeXLayout`).
 */
import type { AxfRuntime } from '../../../src/axf/core';
import { normalizeXLayout, TOOLBAR_LOCATIONS, TOOLBAR_SLOT_COUNT, type XLayoutData, type XToolbarItem } from '../../../src/axf/core/engines/xlayout';

export const PLUGIN_ID = 'ai.amberx.axf.molly.xlayout';
export const FOLDER = 'xlayout';

/** Settings keys (one value each, so two editors saving different keys never undo each other). */
export const K = {
  ideOn: 'xlayout.ide.on',
  preset: 'xlayout.ide.preset',
  paneLimit: 'xlayout.ide.paneLimit',
  /** how many copies of one app may be open as tabs at once (molly-multi-instance-tabs) */
  maxInstances: 'xlayout.ide.maxInstances',
  /** the IDE dock as last arranged (dock@1 snapshot), restored when IDE mode comes back */
  dock: 'xlayout.ide.dock',
  visible: (slot: number) => `xlayout.toolbar.${slot}.visible`,
  location: (slot: number) => `xlayout.toolbar.${slot}.location`,
  /** a slot's items as the Toolbar designer saved them (JSON list of xlayout toolbar items) */
  items: (slot: number) => `xlayout.toolbar.${slot}.items`,
  /** Molly's own plugins' toolbars: `<plugin>.<screen>` → up to three slots (JSON), see toolbars.ts */
  pluginBars: 'xlayout.pluginToolbars',
} as const;

export const SLOTS = Array.from({ length: TOOLBAR_SLOT_COUNT }, (_, i) => i + 1);

const parseJson = (v: unknown): unknown => { if (typeof v !== 'string' || !v) return undefined; try { return JSON.parse(v); } catch { return undefined; } };

/** The asset's raw data (no xlayout asset = an empty one: no apps, defaults everywhere). */
function assetData(rt: AxfRuntime): Record<string, unknown> {
  const a = rt.assetOrNull('xlayout' as never) as { data?: unknown } | null;
  return a?.data && typeof a.data === 'object' ? (a.data as Record<string, unknown>) : {};
}

/** The xlayout in force: the asset with every saved choice laid over it, normalized. */
export function effectiveXLayout(rt: AxfRuntime): XLayoutData {
  const raw = assetData(rt);
  const saved = rt.settings.savedValues();
  const has = (k: string) => Object.hasOwn(saved, k) && saved[k] !== null;
  const ide = { ...((raw.ide as Record<string, unknown>) ?? {}) };
  if (has(K.ideOn)) ide.on = saved[K.ideOn] === true;
  if (has(K.preset)) ide.preset = saved[K.preset];
  if (has(K.paneLimit)) ide.paneLimit = Number(saved[K.paneLimit]);
  if (has(K.maxInstances)) ide.maxInstances = Number(saved[K.maxInstances]);
  const bars = Array.isArray(raw.toolbars) ? (raw.toolbars as Record<string, unknown>[]).map((t) => ({ ...t })) : [];
  for (const slot of SLOTS) {
    let t = bars.find((b) => b.slot === slot);
    if (!t) { t = { slot }; bars.push(t); }
    if (has(K.visible(slot))) t.visible = saved[K.visible(slot)] === true;
    if (has(K.location(slot)) && (TOOLBAR_LOCATIONS as readonly unknown[]).includes(saved[K.location(slot)])) t.location = saved[K.location(slot)];
    const items = parseJson(saved[K.items(slot)]); if (Array.isArray(items)) t.items = items;
  }
  return normalizeXLayout({ ...raw, ide, toolbars: bars });
}

/** Save one slot's items (the Toolbar designer). */
export function saveSlotItems(rt: AxfRuntime, slot: number, items: readonly XToolbarItem[]): void {
  rt.settings.set(K.items(slot), JSON.stringify(items));
}
