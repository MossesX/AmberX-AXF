/**
 * Look settings: which settings keys are part of an app's look (they ride the shared appearance document and a skin's
 * `extras.settings`), and which retired ones are never applied again. Lived in design-package@1's engine until design
 * packages folded into skins (build appearance-skins-colour-themes-only, Fable, Nov 10 2026); the rules are unchanged.
 * Pure.
 */

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
  'axf.tokens.',          // control@1 token overrides (engines/control-tokens.mjs; the Token control plugin's API, MCP and CLI)
  'axf.icons.',           // icon packs per scope (engines/skin.ts SKIN_ICON_PACK_KEY; the icon-map engine reads the same keys)
];
export const APPEARANCE_SETTING_PREFIXES: readonly string[] = PREFIXES;

/**
 * Look settings retired on Nov 1 2026 (Brett: "Remove all appearance and theme editing abilities from the settings
 * interface … only allow selecting design, style, and color themes"; then: "I only wanted it removed from settings
 * for the apps not plugins"): the app-wide Sliders, per-asset tokens and rolls. Nov 10 2026 added the design package's
 * own keys (`axf.appearance.design`, `axf.appearance.overrides`): a skin pick lives on the app-look document. None is
 * applied; a shared document that still carries one is cleaned once. Plugin settings (Banner settings and its Apply to
 * all) stay.
 */
export const RETIRED_LOOK_SETTINGS: readonly string[] = ['axf.look', 'axf.custom.', 'axf.roll.', 'axf.appearance.design', 'axf.appearance.package', 'axf.appearance.overrides'];

/** Is this a retired look setting (never applied, cleared where found)? */
export function isRetiredLookSetting(key: string): boolean {
  return RETIRED_LOOK_SETTINGS.some((p) => (p.endsWith('.') ? key.startsWith(p) : key === p || key.startsWith(`${p}.`)));
}

/** Add a prefix of settings keys that are part of an app's look (a library's own appearance settings). */
export function registerAppearanceSettingPrefix(prefix: string): void {
  if (/^[a-z0-9][a-z0-9._-]{1,80}$/.test(prefix) && !PREFIXES.includes(prefix)) PREFIXES.push(prefix);
}

/** The retired "package applied" notes: never a look setting (a skin pick lives on the app-look document). */
const PACKAGE_NOTES = ['axf.appearance.design', 'axf.appearance.package'];

/**
 * Is this settings key part of an app's look? (`axf.hide.*`, spacing and the retired package notes have their own place.)
 * A retired look setting still counts (so a document that carries one is cleaned, not kept); `isRetiredLookSetting`
 * says whether it is applied.
 */
export function isAppearanceSetting(key: string): boolean {
  return key !== 'axf.appearance.spacing' && !PACKAGE_NOTES.includes(key) && PREFIXES.some((p) => key.startsWith(p));
}
