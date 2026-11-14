/**
 * Picker swap settings (picker@1, spec/PICKER.md § 2): whether drop-downs open the themed picker, and how. One small
 * store the swap layer, SelectField, PickerDialog and the picker-dialog plugin all read; the plugin writes it from its
 * settings (Settings → Plugins → Picker dialog, control@1 `axf.picker.*`). Off by default: with no plugin installed,
 * every drop-down is the original control.
 */
import { useSyncExternalStore } from 'react';

export interface PickerSwapConfig {
  /** Master switch (the plugin turns it on; uninstalled = off). */
  enabled: boolean;
  /** Framework SelectFields render a PickerField. */
  swapSelectFields: boolean;
  /** Remaining native <select> elements get a picker trigger (the select stays as the source of truth). */
  swapSelects: boolean;
  /** Options at which the search field shows; null = the picker asset's choice. */
  searchThreshold: number | null;
  /** Phones get the bottom sheet (off = the dialog everywhere). */
  sheetOnPhone: boolean;
  /** App ids that keep their original drop-downs. */
  excludeApps: string[];
  /** This app's id (the plugin library passes it). */
  app: string;
}

export const PICKER_SWAP_DEFAULT: PickerSwapConfig = { enabled: false, swapSelectFields: true, swapSelects: true, searchThreshold: null, sheetOnPhone: true, excludeApps: [], app: '' };

let cfg: PickerSwapConfig = { ...PICKER_SWAP_DEFAULT };
const subs = new Set<() => void>();

export const getPickerSwap = (): PickerSwapConfig => cfg;
export function setPickerSwap(patch: Partial<PickerSwapConfig>): PickerSwapConfig {
  const next = { ...cfg, ...patch };
  if (JSON.stringify(next) === JSON.stringify(cfg)) return cfg;
  cfg = next;
  for (const s of subs) s();
  return cfg;
}
export function subscribePickerSwap(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }

/** Is the swap on for this app right now? */
export const swapActive = (c: PickerSwapConfig = cfg): boolean => c.enabled && !(c.app && c.excludeApps.includes(c.app));

export function usePickerSwap(): PickerSwapConfig {
  return useSyncExternalStore(subscribePickerSwap, getPickerSwap, getPickerSwap);
}
