/**
 * Skin map (build flagship-professional-skin-covering-2, Nov 17 2026; Brett: "Show me where the data sets go, the
 * layouts, every single thing."): Settings → Appearance → Skin map lists every slot of skin-map@1 grouped by surface,
 * with what it controls, the tokens it writes, the components that read them, where its data and layout live, and what
 * the skin in force sets there. Tapping a row opens that asset.
 *
 * The document is the generated snapshot (framework/schemas/skin-map.json, baked into every app at src/axf/schemas),
 * loaded on demand so it never weighs on the first paint; the skin values come from rt.skinList() (each skin's
 * `extends` folded) through skinMapFor (core/engines/skin-map.mjs), so the view works the same in the console, axHub
 * web and AmberX with no server.
 *
 * API parity: deep link `settings.open:skin-map` (console-control `view:settings/tab:appearance/skin-map`), rows
 * `row:skin-map/<slot>`; actions `skin.map` (open) and `skin.map.slot:<slot>` (open on one row, say what the skin sets);
 * REST `GET /api/plugins/theme-manager/skin-map[/<slot>]?skin=` (MCP through plugin-commands); CLI
 * `node framework/cli/skins.mjs map [<skin>] [--slot <s>]`.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../core/runtime';
import { skinMapFor, skinMapRowValue } from '../../core/engines/skin-map.mjs';

/** The Appearance sub-tab id (settings.open:skin-map). */
export const SKIN_MAP_TAB = 'skin-map';
/** Console-control addresses (CONSOLE-CONTROL.md): the view and one row per slot. */
export const SKIN_MAP_TARGET = 'view:settings/tab:appearance/skin-map';
export const skinMapRowTarget = (slot: string) => `row:skin-map/${slot}`;
export const SKIN_MAP_ACTIONS = { open: 'skin.map', slot: 'skin.map.slot' } as const;

type MapDoc = { slots: MapRow[]; datasets: Record<string, unknown>[]; layouts: Record<string, unknown>[]; summary: Record<string, number> };
export type MapRow = {
  slot: string; kind: string; type?: string; label: string; via?: string; controls: string[]; tokens: string[]; settings: string[];
  components: string[]; attributes?: string[]; lives: Record<string, unknown> | null; value?: unknown; filled?: boolean;
};

/* ---------------- the document, loaded once on demand ---------------- */

let doc: MapDoc | null = null;
let loading: Promise<MapDoc> | null = null;
const docListeners = new Set<() => void>();
export function loadSkinMap(): Promise<MapDoc> {
  if (doc) return Promise.resolve(doc);
  loading ??= import('../../schemas/skin-map.json').then((m) => { doc = (m.default ?? m) as unknown as MapDoc; docListeners.forEach((l) => l()); return doc; });
  return loading;
}
export function useSkinMapDoc(): MapDoc | null {
  const d = useSyncExternalStore((l) => { docListeners.add(l); return () => { docListeners.delete(l); }; }, () => doc, () => doc);
  useEffect(() => { void loadSkinMap(); }, []);
  return d;
}

/* ---------------- the row the view opens on (skin.map.slot) ---------------- */

let focus = '';
const focusListeners = new Set<() => void>();
export function setSkinMapFocus(slot: string) { focus = slot; focusListeners.forEach((l) => l()); }
export function useSkinMapFocus(): string {
  return useSyncExternalStore((l) => { focusListeners.add(l); return () => { focusListeners.delete(l); }; }, () => focus, () => focus);
}

/** The skin in force here and its folded data (null = no skin). */
export function skinInForceData(rt: AxfRuntime): { id: string; data: unknown } | null {
  const id = rt.skinInForce().id;
  if (!id) return null;
  const e = rt.skinList().find((s) => s.id === id);
  return e ? { id, data: e.data } : null;
}

/** The map read through the skin in force (or `skinId`), one slot or all. */
export function useSkinMap(rt: AxfRuntime, skinId = '') {
  const d = useSkinMapDoc();
  const [, bump] = useState(0);
  useEffect(() => rt.settings.subscribe(() => bump((n) => n + 1)), [rt]);
  return useMemo(() => {
    if (!d) return null;
    const pick = skinId ? rt.skinList().find((s) => s.id === skinId) : null;
    const at = pick ? { id: pick.id, data: pick.data } : skinInForceData(rt);
    return skinMapFor(d, at?.id ?? '', at?.data ?? null) as unknown as MapDoc & { skin: { id: string; filled: number; rows: number } | null };
  }, [d, rt, skinId, rt.settings.getRevision()]);
}

/* ---------------- actions (voice, MCP console actions, Ctrl+K) ---------------- */

export function registerSkinMapActions(rt: AxfRuntime) {
  rt.actions.register(SKIN_MAP_ACTIONS.open, () => { setSkinMapFocus(''); rt.dispatch(`settings.open:${SKIN_MAP_TAB}`); }, { label: 'Open the skin map (Settings → Appearance → Skin map)' });
  rt.actions.register(SKIN_MAP_ACTIONS.slot, ([slot]) => {
    if (!slot) { rt.toast('skin.map.slot needs a slot (toolbar, parts.toolbar, motion, colorTheme…).', 'warning', 'Skin map'); return; }
    setSkinMapFocus(slot);
    rt.dispatch(`settings.open:${SKIN_MAP_TAB}`);
    void loadSkinMap().then((d) => {
      const row = d.slots.find((r) => r.slot === slot || r.type === slot || r.slot === `assets.${slot}`);
      if (!row) { rt.toast(`No slot "${slot}" in the skin map.`, 'warning', 'Skin map'); return; }
      const at = skinInForceData(rt);
      const v = at ? skinMapRowValue(row, at.data) : null;
      const shown = v === null ? 'not set by the skin' : typeof v === 'string' ? v : 'set';
      rt.toast(`${row.label}: ${shown}. Controls ${row.controls.join(', ') || 'nothing drawn'}; ${row.tokens.length} tokens, ${row.settings.length} settings.`, 'info', 'Skin map');
    });
  }, { label: 'Open the skin map on one slot and say what the skin sets there', params: true });
}
