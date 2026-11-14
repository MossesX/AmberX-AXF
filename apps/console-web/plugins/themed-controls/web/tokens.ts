/**
 * Tooltip and scrollbar settings (s24) are tokens of the themed-controls asset: the tooltip delay, hide delay and
 * long-press time, and the scrollbar width. Changing one writes the control@1 override (`axf.tokens.controls`, the
 * same store `axf token controls set tooltip.delayMs 300` and REST / MCP control_set write), so a theme swap, a skin and
 * every API see one value. Reads come from the asset in force with the overrides written in.
 */
import type { AxfRuntime } from '@console/axf/core';
import { THEMED_CONTROL_FIELDS, tcFieldErrors } from '@console/axf/core/engines/themed-controls';
import { withTokenOverride, withoutTokenOverride } from '@console/axf/core/engines/control-tokens.mjs';

export const TOKENS_KEY = 'axf.tokens.controls';

export interface TokenSetting { path: string; label: string; unit: string; min: number; max: number; step: number }
const field = (path: string) => THEMED_CONTROL_FIELDS[path] as { min: number; max: number; default: number };
export const TOKEN_SETTINGS: TokenSetting[] = [
  { path: 'tooltip.delayMs', label: 'Tooltip delay', unit: 'ms', step: 50 },
  { path: 'tooltip.hideMs', label: 'Tooltip hide delay', unit: 'ms', step: 50 },
  { path: 'tooltip.longPressMs', label: 'Long press for a tooltip', unit: 'ms', step: 50 },
  { path: 'scrollbar.width', label: 'Scrollbar width', unit: 'px', step: 1 },
].map((s) => ({ ...s, min: field(s.path).min, max: field(s.path).max }));

export function tokenSetting(words: string): TokenSetting | null {
  const w = words.trim().toLowerCase();
  return TOKEN_SETTINGS.find((s) => s.path.toLowerCase() === w || s.label.toLowerCase() === w || s.path.replace('.', '-').toLowerCase() === w || s.label.toLowerCase().includes(w)) ?? null;
}

/** The value in force (asset + overrides), else the registry default. */
export function tokenValue(rt: AxfRuntime, path: string): number {
  const data = (rt as unknown as { themedControlsData?: () => Record<string, Record<string, unknown>> | null }).themedControlsData?.();
  const [g, k] = path.split('.') as [string, string];
  const v = Number(data?.[g]?.[k]);
  return Number.isFinite(v) ? v : field(path).default;
}

/** Write one token (clamped to its range); `null` = back to the asset's value. Returns the value now in force. */
export function setToken(rt: AxfRuntime, path: string, value: number | null): number {
  const raw = rt.settings.get(TOKENS_KEY);
  if (value === null) { rt.settings.set(TOKENS_KEY, withoutTokenOverride(raw, path) as never); return tokenValue(rt, path); }
  const f = field(path);
  const v = Math.round(Math.min(f.max, Math.max(f.min, value)));
  const errs = tcFieldErrors(path, v);
  if (errs.length) throw new Error(errs.join('; '));
  rt.settings.set(TOKENS_KEY, withTokenOverride(raw, path, v) as never);
  return v;
}
