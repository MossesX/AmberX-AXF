/**
 * design-package@1: an AmberX Design Package (type `design-package`) wraps the four themes that make an app's whole
 * look and feel: a style theme, a colour theme, a layout and a behaviour theme. Picking one in Settings → Appearance
 * swaps all four at once. It replaced appearance-package@1 (Oct 27 2026, Brett: "replace it"); everything that type
 * held lives on as the optional `extras`, so nothing a saved look carried is lost:
 *
 *  - `extras.slots`    the active asset of every other appearance slot (chrome, controls, widgets); never the access
 *                      policy, never a package, never one of the four themes (those are the package's own fields)
 *  - `extras.spacing`  the Spacing choice
 *  - `extras.hidden`   chrome shown / hidden overrides
 *  - `extras.settings` every other appearance setting, by key: keys starting with one of APPEARANCE_SETTING_PREFIXES
 *                      (customize tokens, roll switches, banner looks and hides, toolbar fold, placement picks …)
 *
 * Applying a package with no `extras` changes only the four themes; with `extras` it is the whole look, as before.
 * The prefix list is an open registry (`registerAppearanceSettingPrefix`), so a library adds its own look settings.
 * Pure: the runtime captures and applies (runtime.ts → `captureDesignPackage`, `applyDesignPackage`,
 * `restoreDefaultAppearance`). `fromAppearancePackage` turns an old appearance-package's data into a design package.
 */
import type { AppearancePackageData, DesignPackageData, DesignPackageExtras } from '../types';
import { spacingOf } from './spacing';

export const DESIGN_PACKAGE_TYPE = 'design-package';
/** @deprecated the retired type's name; `fromAppearancePackage` converts its data. */
export const APPEARANCE_PACKAGE_TYPE = 'appearance-package';

/** The four themes a design package wraps, in the order they are shown. */
export const DESIGN_THEMES = ['style-theme', 'color-theme', 'layout', 'behavior-theme'] as const;
export type DesignTheme = (typeof DESIGN_THEMES)[number];

/** The package last applied (setting; cleared by Restore default appearance). */
export const DESIGN_APPLIED_KEY = 'axf.appearance.design';
/** The retired appearance package's setting; read once and moved to DESIGN_APPLIED_KEY. */
export const PACKAGE_APPLIED_KEY = 'axf.appearance.package';

/** Slot types a package never sets in its extras. */
export const PACKAGE_NEVER: readonly string[] = ['uac-policy', DESIGN_PACKAGE_TYPE, APPEARANCE_PACKAGE_TYPE, ...DESIGN_THEMES];

/** Settings keys (by prefix) that count as appearance. Spacing and hidden have their own fields. */
const PREFIXES: string[] = [
  'axf.custom.',          // per-asset tokens (engines/customize.ts)
  'axf.roll.',            // Randomize / Assets in rolls switches
  'axf.banners.',         // banner looks, behaviour and hides (BannerSettings, engines/bannerhide.ts)
  'axf.toolbar.collapsed',
  'axf.placement.',       // where each plugin's UI opens
  'axf.appearance.',      // the Appearance tab's own settings (spacing is written to its field too)
  'axf.widgets.',         // where widgets sit on banners and toolbars (rt.moveHostItem, arrange mode)
  'axf.look',             // Settings → Appearance → Sliders (one key, `axf.look`; Restore used to leave it behind)
];
export const APPEARANCE_SETTING_PREFIXES: readonly string[] = PREFIXES;

/** Add a prefix of settings keys that are part of an app's look (a library's own appearance settings). */
export function registerAppearanceSettingPrefix(prefix: string): void {
  if (/^[a-z0-9][a-z0-9._-]{1,80}$/.test(prefix) && !PREFIXES.includes(prefix)) PREFIXES.push(prefix);
}

/** Is this settings key part of an app's look? (`axf.hide.*`, spacing and the applied-package keys have their own place.) */
export function isAppearanceSetting(key: string): boolean {
  return key !== 'axf.appearance.spacing' && key !== PACKAGE_APPLIED_KEY && key !== DESIGN_APPLIED_KEY && PREFIXES.some((p) => key.startsWith(p));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;

function normalizeExtras(d: Record<string, unknown>): DesignPackageExtras {
  const out: DesignPackageExtras = {};
  if (isObj(d.slots)) {
    const slots: Record<string, string> = {};
    for (const [t, id] of Object.entries(d.slots)) if (!PACKAGE_NEVER.includes(t) && typeof id === 'string' && ID.test(id)) slots[t] = id;
    out.slots = slots;
  }
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

/** Keep only fields a package may hold; anything malformed is dropped (never a crash). Missing themes stay ''. */
export function normalizeDesignPackage(raw: unknown): DesignPackageData {
  const d = isObj(raw) ? raw : {};
  const pick = (t: DesignTheme) => (typeof d[t] === 'string' && ID.test(d[t] as string) ? (d[t] as string) : '');
  const out: DesignPackageData = { 'style-theme': pick('style-theme'), 'color-theme': pick('color-theme'), layout: pick('layout'), 'behavior-theme': pick('behavior-theme') };
  if (isObj(d.extras)) out.extras = normalizeExtras(d.extras);
  return out;
}

/** Validation messages for a package's data (validators call it for type `design-package`). */
export function designPackageErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const errors: string[] = [];
  for (const t of DESIGN_THEMES) if (typeof raw[t] !== 'string' || !ID.test(raw[t] as string)) errors.push(`data.${t} must be a ${t} asset id`);
  if (!('extras' in raw)) return errors;
  const x = raw.extras;
  if (!isObj(x)) return [...errors, 'data.extras must be an object'];
  if ('slots' in x) {
    if (!isObj(x.slots)) errors.push('data.extras.slots must be an object (asset type → asset id)');
    else for (const [t, id] of Object.entries(x.slots)) {
      if (PACKAGE_NEVER.includes(t)) errors.push(`data.extras.slots.${t}: ${(DESIGN_THEMES as readonly string[]).includes(t) ? `${t} is one of the package's own themes` : `a package never sets ${t}`}`);
      else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.extras.slots.${t} must be an asset id`);
    }
  }
  if ('spacing' in x && (typeof x.spacing !== 'string' || spacingOf(x.spacing) !== x.spacing)) errors.push('data.extras.spacing must be tight, compact or regular');
  if ('hidden' in x && (!isObj(x.hidden) || Object.values(x.hidden).some((v) => typeof v !== 'boolean'))) errors.push('data.extras.hidden must map asset types to true / false');
  if ('settings' in x) {
    if (!isObj(x.settings)) errors.push('data.extras.settings must be an object');
    else for (const k of Object.keys(x.settings)) if (!isAppearanceSetting(k)) errors.push(`data.extras.settings.${k} is not an appearance setting`);
  }
  return errors;
}

/** Every slot applying the package swaps: its four themes plus its extra slots (themes win). Empty ids are skipped. */
export function designPackageSlots(pkg: DesignPackageData): Record<string, string> {
  const slots: Record<string, string> = { ...(pkg.extras?.slots ?? {}) };
  for (const t of DESIGN_THEMES) if (pkg[t]) slots[t] = pkg[t];
  return slots;
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

/** The current look as a design package. `withExtras: false` = only the four themes. */
export function captureDesignPackage(env: PackageCaptureEnv, withExtras = true): DesignPackageData {
  const out: DesignPackageData = {
    'style-theme': env.active['style-theme'] ?? '',
    'color-theme': env.active['color-theme'] ?? '',
    layout: env.active.layout ?? '',
    'behavior-theme': env.active['behavior-theme'] ?? '',
  };
  if (!withExtras) return out;
  const slots: Record<string, string> = {};
  for (const t of env.types) if (!PACKAGE_NEVER.includes(t) && env.active[t]) slots[t] = env.active[t]!;
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env.values).sort(([a], [b]) => a.localeCompare(b))) if (isAppearanceSetting(k) && v !== undefined && v !== null) settings[k] = v;
  out.extras = { slots, spacing: env.spacing, hidden: { ...env.hidden }, settings };
  return out;
}

/**
 * The settings keys applying `pkg` changes. A package with extras is the whole look: its own keys are set and every
 * other appearance key saved now is cleared. A package without extras leaves the other settings alone.
 */
export function packageSettingsPlan(pkg: DesignPackageData, saved: readonly string[]): { set: Record<string, unknown>; clear: string[] } {
  if (!pkg.extras) return { set: {}, clear: [] };
  const set = { ...(pkg.extras.settings ?? {}) };
  const clear = saved.filter((k) => isAppearanceSetting(k) && !(k in set));
  return { set, clear };
}

/** An old appearance-package's data as a design package (the four themes lifted out of its slots). */
export function fromAppearancePackage(raw: unknown, fallbackBehavior = 'standard'): DesignPackageData {
  const d = isObj(raw) ? raw : {};
  const slots = isObj(d.slots) ? (d.slots as Record<string, unknown>) : {};
  const take = (t: string, fb = '') => (typeof slots[t] === 'string' && ID.test(slots[t] as string) ? (slots[t] as string) : fb);
  const extras = normalizeExtras(d);
  return {
    'style-theme': take('style-theme'),
    'color-theme': take('color-theme'),
    layout: take('layout'),
    'behavior-theme': take('behavior-theme', fallbackBehavior),
    extras,
  };
}

/* ---- deprecated names (appearance-package@1 callers); they act on design packages now ---- */

/** @deprecated use normalizeDesignPackage */
export const normalizePackage = (raw: unknown): AppearancePackageData => {
  const p = normalizeDesignPackage(raw);
  return { ...(p.extras ?? {}), slots: designPackageSlots(p) };
};
/** @deprecated use designPackageErrors */
export const packageErrors = designPackageErrors;
/** @deprecated use captureDesignPackage */
export const capturePackage = (env: PackageCaptureEnv): DesignPackageData => captureDesignPackage(env);
