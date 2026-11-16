/**
 * plugin-settings@1 — the `settings` block of a plugin@1 manifest (pure, IO-free).
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface."
 * Every plugin's settings live in one place, a sub-tab of Settings → Plugins (never a top-level tab, never a screen of
 * its own), and every plugin with a screen carries one gear that opens that sub-tab. This block is how a plugin says
 * so in plugin.json, and how the console, the Plugin Manager, the API and the checks read it without running the plugin:
 *
 *   "settings": {
 *     "$axf":     "plugin-settings@1",
 *     "tab":      "<id>",               its sub-tab: the `settings-tab:<id>` it provides (AxfWebLibrary.settingsTabs[].id)
 *     "parent":   "plugins",            always; the console re-parents every plugin tab here (App.tsx underPlugins)
 *     "sections": ["enable", "info", "logs", …],   what the tab shows, in order. The three defaults are on every plugin:
 *                 enable = enable / disable, info = name · version · built-with · description · dependencies,
 *                 logs = its log lines. Built-in extras: options (its own keys below), appearance (plugin theme
 *                 override, libs/plugintheme), placement (Opens in, axf.placement.<id>), commands (plugin-commands@1).
 *                 A plugin's own panels are sections too: "<plugin>.<section>" ids (open registry).
 *     "options":  ["<setting key>", …], the real option keys it registers under its tab (SettingSpec.key); [] = none
 *     "gear":     true | false          a gear on its screen header opens the tab (react/components/PluginSettingsGear).
 *                 true whenever it has a screen (a `view:<id>` in provides); false only when it has none.
 *   }
 *
 * A manifest without the block gets `defaultSettings`: the first `settings-tab:` it provides (else its folder name),
 * the three default sections, no options, and a gear exactly when it has a screen. `normalizeSettings` fills the same
 * defaults into a partial declaration. `checkSettings` lists what is wrong in plain words (plugins.mjs --check).
 * The sub-tab's console-control address (CONSOLE-CONTROL.md): `settingsAddress(tab)`.
 */

export const SCHEMA = 'plugin-settings@1';
export const VERSION = 1;
export const PARENT = 'plugins';
/** The sections every plugin's settings tab shows, in this order (Plugin Manager entry: enable/disable, info, logs). */
export const DEFAULT_SECTIONS = Object.freeze(['enable', 'info', 'logs']);
/** Sections the console draws itself; anything else is the plugin's own panel ("<plugin>.<section>"). */
export const BUILTIN_SECTIONS = Object.freeze(['enable', 'info', 'logs', 'options', 'appearance', 'placement', 'commands']);
export const KEYS = Object.freeze(['$axf', 'tab', 'parent', 'sections', 'options', 'gear']);

/** console-control@1 pieces, the same as react/controlTargets.ts (SETTINGS_VIEW_ADDRESS, SETTINGS_TAB_ROW, SETTINGS_SUBTAB_ROW). */
export const SETTINGS_VIEW = 'view:settings';
export const SETTINGS_TAB_ROW = 'settings.tabs';
export const SETTINGS_SUBTAB_ROW = 'settings.subtabs';

export const TAB_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SECTION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const OPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const provides = (m) => list(m?.provides).filter((p) => typeof p === 'string');

/** The screens a manifest provides (`view:<id>`). */
export function pluginViews(m) { return provides(m).filter((p) => p.startsWith('view:')).map((p) => p.slice(5)); }
/** The settings tabs a manifest provides (`settings-tab:<id>`). */
export function pluginSettingsTabs(m) { return provides(m).filter((p) => p.startsWith('settings-tab:')).map((p) => p.slice(13)); }
/** Does the plugin have a screen a gear can sit on? */
export function hasScreen(m) { return pluginViews(m).length > 0; }

/** The folder's short name ('apps/console-web/plugins/my-plugin' → 'my-plugin'). */
const shortFolder = (folder) => String(folder ?? '').split('/').filter(Boolean).pop() ?? '';

/**
 * The block a plugin gets when it declares none: derived from what it provides. Every field is filled, so readers
 * never branch on a missing one.
 */
export function defaultSettings(m, { folder = '' } = {}) {
  const tab = pluginSettingsTabs(m)[0] ?? shortFolder(folder) ?? '';
  return { $axf: SCHEMA, tab, parent: PARENT, sections: [...DEFAULT_SECTIONS], options: [], gear: hasScreen(m) };
}

/** A declaration (full or partial) with every default filled; junk values are kept so `checkSettings` can name them. */
export function normalizeSettings(m, { folder = '' } = {}) {
  const d = defaultSettings(m, { folder });
  const s = isObj(m?.settings) ? m.settings : {};
  const sections = Array.isArray(s.sections) ? s.sections : d.sections;
  return {
    $axf: SCHEMA,
    tab: typeof s.tab === 'string' && s.tab ? s.tab : d.tab,
    parent: s.parent === undefined ? PARENT : s.parent,
    // the three defaults are on every plugin, in front, in their order; a declaration may add, never drop them
    sections: [...DEFAULT_SECTIONS, ...sections.filter((x) => !DEFAULT_SECTIONS.includes(x))],
    options: Array.isArray(s.options) ? [...s.options] : d.options,
    gear: typeof s.gear === 'boolean' ? s.gear : d.gear,
  };
}

/**
 * What is wrong with a manifest's `settings` block, in plain words ([] = fine). A missing block is reported too
 * (`required`, default true); plugins.mjs --check passes `required: false` until every console plugin carries one.
 */
export function checkSettings(m, { folder = '', required = true } = {}) {
  const s = m?.settings;
  const problems = [];
  if (s === undefined) return required ? [`"settings" is missing (plugin-settings@1: its Settings → Plugins sub-tab, sections, option keys and gear; default ${JSON.stringify(defaultSettings(m, { folder }))})`] : [];
  if (!isObj(s)) return ['"settings" is a plugin-settings@1 block {tab, parent, sections, options, gear}'];
  for (const k of Object.keys(s)) if (!KEYS.includes(k)) problems.push(`"settings" has an unknown key "${k}"`);
  if (s.$axf !== undefined && s.$axf !== SCHEMA) problems.push(`"settings".$axf is "${SCHEMA}"`);
  const tabs = pluginSettingsTabs(m);
  if (typeof s.tab !== 'string' || !TAB_ID.test(s.tab)) problems.push('"settings".tab is its settings tab id (lowercase, digits, . _ -)');
  else if (!tabs.includes(s.tab)) problems.push(tabs.length ? `"settings".tab "${s.tab}" isn't a tab it provides (${tabs.map((t) => `"settings-tab:${t}"`).join(', ')})` : `"settings".tab "${s.tab}": the plugin provides no "settings-tab:${s.tab}"; every plugin has a Settings → Plugins sub-tab`);
  if (s.parent !== undefined && s.parent !== PARENT) problems.push(`"settings".parent is "${PARENT}": plugin settings are a sub-tab of Settings → Plugins, never a top-level tab`);
  if (s.sections !== undefined) {
    if (!Array.isArray(s.sections) || !s.sections.every((x) => typeof x === 'string' && SECTION_ID.test(x))) problems.push('"settings".sections is a list of section ids');
    else {
      if (new Set(s.sections).size !== s.sections.length) problems.push('"settings".sections repeats a section');
      const dropped = DEFAULT_SECTIONS.filter((x) => !s.sections.includes(x));
      if (dropped.length) problems.push(`"settings".sections drops ${dropped.map((x) => `"${x}"`).join(', ')}: enable, info and logs are on every plugin`);
    }
  }
  if (s.options !== undefined && (!Array.isArray(s.options) || !s.options.every((x) => typeof x === 'string' && OPTION_KEY.test(x)))) problems.push('"settings".options is a list of setting keys');
  else if (Array.isArray(s.options) && new Set(s.options).size !== s.options.length) problems.push('"settings".options repeats a key');
  if (s.gear !== undefined && typeof s.gear !== 'boolean') problems.push('"settings".gear is true or false');
  else {
    const screen = hasScreen(m);
    if (s.gear === false && screen) problems.push(`"settings".gear is false but the plugin has a screen (view:${pluginViews(m)[0]}): every screen carries the gear that opens its settings`);
    if (s.gear === true && !screen) problems.push('"settings".gear is true but the plugin has no screen to carry it (no "view:<id>" in provides)');
  }
  return problems;
}

/** The sub-tab's console-control@1 address: view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=<tab>. */
export function settingsAddress(tab) {
  if (typeof tab !== 'string' || !TAB_ID.test(tab)) throw new Error(`bad settings tab id ${JSON.stringify(tab)}`);
  return `${SETTINGS_VIEW}/tab:${SETTINGS_TAB_ROW}=${PARENT}/subtab:${SETTINGS_SUBTAB_ROW}=${tab}`;
}
/** The runtime action that opens the sub-tab (rt.dispatch). */
export function settingsOpenAction(tab) {
  if (typeof tab !== 'string' || !TAB_ID.test(tab)) throw new Error(`bad settings tab id ${JSON.stringify(tab)}`);
  return `settings.open:${tab}`;
}
/** Every way the sub-tab is reached, for the gear, the API and the PR text: the address (REST / MCP / CLI / voice open it), the action, the aria label. */
export function settingsTarget(m, { folder = '' } = {}) {
  const s = normalizeSettings(m, { folder });
  // a declared tab that is no id falls back to the derived one; a plugin with neither has no address yet ('')
  const tab = TAB_ID.test(s.tab) ? s.tab : defaultSettings(m, { folder }).tab;
  const ok = TAB_ID.test(tab);
  const name = typeof m?.name === 'string' && m.name ? m.name : tab;
  return { tab, address: ok ? settingsAddress(tab) : '', action: ok ? settingsOpenAction(tab) : '', label: `${name} settings`, gear: s.gear };
}

export const REGISTRY = Object.freeze({ schema: SCHEMA, version: VERSION, parent: PARENT, keys: KEYS, defaultSections: DEFAULT_SECTIONS, builtinSections: BUILTIN_SECTIONS });
