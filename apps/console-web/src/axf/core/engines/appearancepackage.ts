/**
 * appearance-package@1: every appearance setting of an app saved as one asset (type `appearance-package`), so a whole
 * look can be picked, shared and restored in one go. Pure: the runtime captures and applies (runtime.ts →
 * `captureAppearancePackage`, `applyAppearancePackage`, `restoreDefaultAppearance`).
 *
 * What a package holds:
 *  - `slots`    the active asset of every appearance slot (themes, layout, chrome, controls, widgets); never the access
 *               policy and never another package
 *  - `spacing`  the Spacing choice
 *  - `hidden`   chrome shown / hidden overrides
 *  - `settings` every other appearance setting, by key: the keys starting with one of APPEARANCE_SETTING_PREFIXES
 *               (customize tokens, roll switches, banner looks and hides, toolbar fold, placement picks …)
 * The prefix list is an open registry (`registerAppearanceSettingPrefix`), so a library adds its own look settings.
 */
import type { AppearancePackageData } from '../types';
import { spacingOf } from './spacing';

export const APPEARANCE_PACKAGE_TYPE = 'appearance-package';

/** The package last applied (setting; cleared by Restore default appearance). */
export const PACKAGE_APPLIED_KEY = 'axf.appearance.package';

/** Slot types a package never sets. */
export const PACKAGE_NEVER: readonly string[] = ['uac-policy', APPEARANCE_PACKAGE_TYPE];

/** Settings keys (by prefix) that count as appearance. Spacing and hidden have their own fields. */
const PREFIXES: string[] = [
  'axf.custom.',          // per-asset tokens (engines/customize.ts)
  'axf.roll.',            // Randomize / Assets in rolls switches
  'axf.banners.',         // banner looks, behaviour and hides (BannerSettings, engines/bannerhide.ts)
  'axf.toolbar.collapsed',
  'axf.placement.',       // where each plugin's UI opens
  'axf.appearance.',      // the Appearance tab's own settings (spacing is written to its field too)
];
export const APPEARANCE_SETTING_PREFIXES: readonly string[] = PREFIXES;

/** Add a prefix of settings keys that are part of an app's look (a library's own appearance settings). */
export function registerAppearanceSettingPrefix(prefix: string): void {
  if (/^[a-z0-9][a-z0-9._-]{1,80}$/.test(prefix) && !PREFIXES.includes(prefix)) PREFIXES.push(prefix);
}

/** Is this settings key part of an app's look? (`axf.hide.*` and spacing are captured in their own fields.) */
export function isAppearanceSetting(key: string): boolean {
  return key !== 'axf.appearance.spacing' && key !== PACKAGE_APPLIED_KEY && PREFIXES.some((p) => key.startsWith(p));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Keep only fields a package may hold; anything malformed is dropped (never a crash). */
export function normalizePackage(raw: unknown): AppearancePackageData {
  const d = isObj(raw) ? raw : {};
  const slots: Record<string, string> = {};
  if (isObj(d.slots)) for (const [t, id] of Object.entries(d.slots)) if (!PACKAGE_NEVER.includes(t) && typeof id === 'string' && ID.test(id)) slots[t] = id;
  const out: AppearancePackageData = { slots };
  if (typeof d.spacing === 'string' && spacingOf(d.spacing) === d.spacing) out.spacing = d.spacing;
  if (isObj(d.hidden)) {
    const hidden: Record<string, boolean> = {};
    for (const [t, v] of Object.entries(d.hidden)) if (typeof v === 'boolean') hidden[t] = v;
    out.hidden = hidden;
  }
  if (isObj(d.settings)) {
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.settings)) if (isAppearanceSetting(k) && v !== undefined) settings[k] = v;
    out.settings = settings;
  }
  return out;
}

/** Validation messages for a package's data (validators call it for type `appearance-package`). */
export function packageErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const errors: string[] = [];
  if (!isObj(raw.slots)) errors.push('data.slots must be an object (asset type → asset id)');
  else for (const [t, id] of Object.entries(raw.slots)) {
    if (PACKAGE_NEVER.includes(t)) errors.push(`data.slots.${t}: a package never sets ${t}`);
    else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.slots.${t} must be an asset id`);
  }
  if ('spacing' in raw && (typeof raw.spacing !== 'string' || spacingOf(raw.spacing) !== raw.spacing)) errors.push('data.spacing must be tight, compact or regular');
  if ('hidden' in raw && (!isObj(raw.hidden) || Object.values(raw.hidden).some((v) => typeof v !== 'boolean'))) errors.push('data.hidden must map asset types to true / false');
  if ('settings' in raw) {
    if (!isObj(raw.settings)) errors.push('data.settings must be an object');
    else for (const k of Object.keys(raw.settings)) if (!isAppearanceSetting(k)) errors.push(`data.settings.${k} is not an appearance setting`);
  }
  return errors;
}

/** What capturing needs from the runtime. */
export interface PackageCaptureEnv {
  active: Record<string, string>;
  types: readonly string[];
  spacing: string;
  /** hidden overrides the user saved (type → bool) */
  hidden: Record<string, boolean>;
  /** every saved settings key → value */
  values: Record<string, unknown>;
}

/** The current look as package data. */
export function capturePackage(env: PackageCaptureEnv): AppearancePackageData {
  const slots: Record<string, string> = {};
  for (const t of env.types) if (!PACKAGE_NEVER.includes(t) && env.active[t]) slots[t] = env.active[t]!;
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env.values).sort(([a], [b]) => a.localeCompare(b))) if (isAppearanceSetting(k) && v !== undefined && v !== null) settings[k] = v;
  return { slots, spacing: env.spacing, hidden: { ...env.hidden }, settings };
}

/** The settings keys applying `pkg` changes: its own keys are set, every other appearance key saved now is cleared. */
export function packageSettingsPlan(pkg: AppearancePackageData, saved: readonly string[]): { set: Record<string, unknown>; clear: string[] } {
  const set = { ...(pkg.settings ?? {}) };
  const clear = saved.filter((k) => isAppearanceSetting(k) && !(k in set));
  return { set, clear };
}
