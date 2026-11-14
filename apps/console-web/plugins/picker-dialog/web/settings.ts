/**
 * The picker-dialog plugin's settings keys and their swap config (pure data: the server, the CLI and the web library
 * agree on these names; spec/PICKER.md § 2 "API").
 */
import type { PickerSwapConfig } from '@console/axf/react/pickerConfig';

export const FOLDER = 'picker-dialog';
export const PLUGIN_ID = 'ai.amberx.axf.console.picker-dialog';
export const TAB = 'picker-dialog';

export const K = {
  enabled: 'axf.picker.enabled',
  swapSelectFields: 'axf.picker.swapSelectFields',
  swapSelects: 'axf.picker.swapSelects',
  searchThreshold: 'axf.picker.searchThreshold',
  sheetOnPhone: 'axf.picker.sheetOnPhone',
  excludeApps: 'axf.picker.excludeApps',
} as const;

export const DEFAULTS = { enabled: true, swapSelectFields: true, swapSelects: true, searchThreshold: 8, sheetOnPhone: true, excludeApps: '' };

type Get = (key: string) => unknown;

/** Settings values → the swap config the framework reads. */
export function configFrom(get: Get, app: string): Partial<PickerSwapConfig> {
  const b = (k: string, d: boolean) => { const v = get(k); return typeof v === 'boolean' ? v : d; };
  const n = Number(get(K.searchThreshold));
  const ex = get(K.excludeApps);
  const list = Array.isArray(ex) ? ex.map(String) : String(ex ?? '').split(/[\s,]+/);
  return {
    enabled: b(K.enabled, DEFAULTS.enabled),
    swapSelectFields: b(K.swapSelectFields, DEFAULTS.swapSelectFields),
    swapSelects: b(K.swapSelects, DEFAULTS.swapSelects),
    searchThreshold: Number.isFinite(n) && get(K.searchThreshold) !== null && get(K.searchThreshold) !== undefined ? Math.max(0, Math.min(200, Math.round(n))) : DEFAULTS.searchThreshold,
    sheetOnPhone: b(K.sheetOnPhone, DEFAULTS.sheetOnPhone),
    excludeApps: list.map((s) => s.trim()).filter(Boolean),
    app,
  };
}
