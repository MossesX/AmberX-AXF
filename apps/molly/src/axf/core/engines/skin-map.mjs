/**
 * skin-map@1 (build flagship-professional-skin-covering-2, Fable, Nov 17 2026). Brett: "Show me where the data sets go,
 * the layouts, every single thing."
 *
 * A generated, read-only document that says, for every slot of skin@1, which asset / dataset / layout it controls,
 * which token(s) it writes, which settings keys it lands on, which components read them, and where every dataset and
 * layout lives (hub path, repo path, data-store namespace). Nothing in it is typed by hand: it is derived from
 *
 *   - the registry (schemas/asset-types.json): every slot a skin sets, how (skin-coverage@1), the skin's own fields
 *   - the style targets (schemas/customize.json): the elements `parts` reach and the selectors they draw
 *   - the token registry (schemas/token-registry.json): every --fx-* token with its element and its sources
 *   - the component token families (engines/component-tokens.mjs): the grid / tabs tokens
 *   - the five slots' rules (engines/skin-slots.mjs): the settings keys and tokens motion, behaviour, hooks, grid,
 *     dialog and settings chrome write
 *   - the data-store rules (schemas/data-store-paths.json): the namespace each hub file lands in
 *   - the stylesheets (framework/ui/axf.css + the libraries' css): which selectors read each token or attribute
 *   - the apps that ship the shared set (schemas/shared-assets.json) and the assets on disk (ids per type)
 *
 * `skinMap(inputs)` is pure: the CLI (cli/skins.mjs map), the schema writer (cli/build-engine.mjs → schemas/skin-map.json)
 * and the console route (/skins/map) call it with the files read; nothing here touches disk. The snapshot in
 * schemas/skin-map.json is checked current by spec/check-skin-map.mjs (CI). Kotlin twin deferred (spec/PORTING.md).
 */
import { CHROME_TYPES, CHROME_INSTANCE_KEY, CHROME_SETTINGS_PICK_KEY } from './chrome-settings-rules.mjs';
import { COVERAGE_KINDS, coverageTable } from './skin-coverage.mjs';
import { APP_LOOK_PROJECT, SKIN_NEVER, SKIN_SECTIONS, SKIN_SECTION_FIELDS, appLookPath } from './skin-rules.mjs';
import { BEHAVIOR_ARM_KEY, BEHAVIOR_OVERRIDES_KEY, BEHAVIOR_TAP_KINDS, CHROME_KIND_DEFAULTS_KEY, DIALOG_KEY, GRID_KEY, HOOKS_KEY, HOOK_KINDS, MOTION_EASING_ROLES, MOTION_KEY, MOTION_KINDS, MOTION_SPEEDS, NAV_COLLAPSED_SETTING, SETTINGS_PAGE_SLOT, SKIN_SLOT_KEYS, STYLE_TOKENS_KEY, behaviorTapKindKey, motionEaseVar, motionKindAttr, motionKindVar, motionSpeedVar } from './skin-slots.mjs';
import { SKIN_CONFIG_PROJECT, DEFAULT_SKIN_PROJECT, defaultSkinPath, skinConfigPath } from './skin-config-rules.mjs';

export const SKIN_MAP_CONTRACT = 'skin-map@1';
export const SKIN_MAP_FRAME = 'skin-map@1';
/** The hub paths of the shared documents (engines/appearance.ts; the hub project every app reads them from). */
export const APPEARANCE_PROJECT = 'shared';
export const APPEARANCE_PATH = 'settings/appearance.json';
/** Where the hub mounts a project's data (data-store-paths.json `projects` root): `/projects/<project>/_data/<path>`. */
export const HUB_MOUNT = '/projects';
/** Kinds of rows in `slots`, in the order the document lists them. */
export const SKIN_MAP_ROW_KINDS = ['section', 'slot', 'parts', 'reference', 'bundle', 'extras', 'chrome', ...SKIN_SLOT_KEYS];
/** What a row controls. */
export const SKIN_MAP_CONTROLS = ['asset', 'dataset', 'layout', 'tokens', 'settings'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort();
const str = (v) => (typeof v === 'string' ? v : '');

/* ---------------------------------------------------------------- data store: the namespace a hub file lands in */

/**
 * The data-store@1 key a file lands in: `root` = plugins | data | repo | projects, `rel` = the path under that root
 * (schemas/data-store-paths.json rules: the first rule whose regex matches wins; `to: null` = stays local). Null when no
 * rule maps it.
 */
export function dataStoreKey(paths, root, rel) {
  const rules = isObj(paths) && isObj(paths.rules) ? paths.rules[root] ?? [] : [];
  for (const rule of rules) {
    const m = new RegExp(rule.re).exec(rel);
    if (!m) continue;
    if (rule.to === null || rule.to === undefined) return null;
    return rule.to.replace(/\{(\d+)\}/g, (_, i) => m[Number(i)] ?? '');
  }
  return null;
}

/** Where a hub document lives: the axHub memory form (`project:path`), the mount path and the data-store namespace. */
export function hubPlace(paths, project, path) {
  const dir = project === 'shared' ? '_shared' : project;
  const rel = `${dir}/_data/${path}`;
  return { hub: `${project}:${path}`, mount: `${HUB_MOUNT}/${rel}`, dataStore: dataStoreKey(paths, 'projects', rel) };
}

/* ---------------------------------------------------------------- stylesheets: which selectors read a token or attribute */

/** The selectors of every rule in `css` whose body or selector matches `test` (a RegExp or a string). Minified-safe, comments stripped. */
export function cssReaders(css, test) {
  const re = typeof test === 'string' ? new RegExp(test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : test;
  const text = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  // one level deep is enough: @media / @supports bodies are scanned by the same regex on their inner rules
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@keyframes') || selector.startsWith('@')) continue;
    if (re.test(m[2]) || re.test(selector)) for (const s of selector.split(',')) out.add(s.trim());
  }
  return [...out].sort();
}

/** Readers of a token prefix across every stylesheet given (`{ path: text }`), as `{ selector, file }` rows. */
export function tokenReaders(sheets, prefix) {
  const out = [];
  for (const [file, css] of Object.entries(sheets ?? {})) for (const selector of cssReaders(css, `var(${prefix}`)) out.push({ selector, file });
  return out;
}

/* ---------------------------------------------------------------- the token registry */

/** The registry tokens whose sources match `test` (a string prefix or a RegExp over `source` / `sources`). */
export function tokensBySource(tokens, test) {
  const re = typeof test === 'string' ? new RegExp(`^${test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : test;
  return (Array.isArray(tokens) ? tokens : []).filter((t) => [t.source, ...(t.sources ?? [])].some((s) => typeof s === 'string' && re.test(s))).map((t) => t.id).sort();
}
/** The elements (the registry's component names) the given tokens belong to. */
export function tokenElements(tokens, ids) {
  const set = new Set(ids);
  return uniq((Array.isArray(tokens) ? tokens : []).filter((t) => set.has(t.id)).map((t) => t.element));
}

/** Which token sources each section / scale type writes (the engines that emit them, as the token registry names them). */
export const SECTION_TOKEN_SOURCES = {
  'color-theme': /^color-theme:/,
  'style-theme': /^engine:framework\/core\/engines\/theme\.ts$|^engine:framework\/core\/engines\/component-tokens\.mjs$/,
  layout: /^engine:layout@1$|^engine:framework\/core\/engines\/layout\.ts$/,
  'behavior-theme': /^engine:framework\/core\/engines\/behavior\.ts$|^engine:framework\/core\/engines\/animation-rules\.mjs$/,
  typography: /^engine:typography@1$/,
  density: /^engine:density@1$/,
  sizing: /^engine:sizing@1$/,
  'nav-style': /^engine:framework\/core\/engines\/navstyle\.ts$/,
  banner: /^engine:framework\/core\/engines\/banner\.ts$/,
  branding: /^engine:framework\/core\/engines\/brand\.ts$/,
};
/** Control and chrome types whose tokens come from engines/components.ts, by the registry's element name. */
export const COMPONENT_ELEMENTS = { button: 'button', slider: 'slider', container: 'container', dialog: 'dialog', popup: 'popup', 'context-menu': 'context-menu', toolbar: 'toolbar', 'nav-menu': 'nav-menu', 'app-menu': 'app-menu', gauge: 'gauge', meter: 'meter', 'tab-group': 'tab-group' };

/* ---------------------------------------------------------------- the document */

/**
 * Build the map. `inputs`:
 *   registry         schemas/asset-types.json (whole file)
 *   customize        schemas/customize.json (whole file; `targets` used)
 *   tokens           schemas/token-registry.json `tokens` (array)
 *   componentFamilies engines/component-tokens.mjs COMPONENT_TOKEN_FAMILIES
 *   dataStorePaths   schemas/data-store-paths.json
 *   apps             [{ id, dir }] — the apps that ship the shared set (schemas/shared-assets.json + their manifests)
 *   assets           { <type>: [asset ids on disk under framework/assets/<type>] }
 *   sheets           { <repo path>: css text } — framework/ui/axf.css and the libraries' stylesheets
 *   generatedAt?     ISO time (left out of the snapshot so it stays stable)
 */
export function skinMap(inputs) {
  const i = isObj(inputs) ? inputs : {};
  const types = isObj(i.registry) && isObj(i.registry.types) ? i.registry.types : {};
  const targets = isObj(i.customize) && isObj(i.customize.targets) ? i.customize.targets : {};
  const tokens = Array.isArray(i.tokens) ? i.tokens : [];
  const families = isObj(i.componentFamilies) ? i.componentFamilies : {};
  const paths = isObj(i.dataStorePaths) ? i.dataStorePaths : {};
  const apps = (Array.isArray(i.apps) ? i.apps : []).filter((a) => isObj(a) && str(a.id)).map((a) => ({ id: a.id, dir: str(a.dir) }));
  const assets = isObj(i.assets) ? i.assets : {};
  const sheets = isObj(i.sheets) ? i.sheets : {};
  const coverage = coverageTable(types, targets, SKIN_NEVER);
  const byType = Object.fromEntries(coverage.map((r) => [r.type, r]));
  const sectionOf = Object.fromEntries(Object.entries(SKIN_SECTIONS).map(([s, t]) => [t, s]));

  const readers = (prefix) => uniq(tokenReaders(sheets, prefix).map((r) => r.selector));
  const attrReaders = (attr) => uniq(Object.values(sheets).flatMap((css) => cssReaders(css, `[${attr}`)));
  const familyTokens = (family) => (families[family]?.tokens ?? []).map((t) => `${families[family].prefix}${t.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  const assetLives = (type) => ({
    repo: `framework/assets/${type}/<id>.json`,
    baked: apps.map((a) => `${a.dir}/src/axf/assets/${type}/<id>.json`),
    own: apps.map((a) => `${a.dir}/src/assets/${type}/<id>.json`),
    overrides: apps.map((a) => `${a.dir}/src/assets-overrides/${type}/<id>.json`),
    ids: Array.isArray(assets[type]) ? [...assets[type]].sort() : [],
    pick: { document: 'app-look@1', field: `slots.${type}`, hub: apps.map((a) => hubPlace(paths, APP_LOOK_PROJECT, appLookPath(a.id)).hub) },
  });

  const slots = [];
  // the four sections and every slot type, registry order
  for (const row of coverage) {
    const type = row.type;
    const t = types[type] ?? {};
    const section = sectionOf[type];
    const field = section ? SKIN_SECTION_FIELDS[section] : `assets.${type}`;
    const kind = section ? 'section' : row.by === 'slot' ? 'slot' : row.by;
    if (row.by === 'none') { slots.push({ slot: field, kind: 'bundle', type, label: str(t.label) || type, controls: [], why: row.why, tokens: [], settings: [], components: [], lives: null }); continue; }
    let ids = [];
    let components = [];
    if (SECTION_TOKEN_SOURCES[type]) ids = tokensBySource(tokens, SECTION_TOKEN_SOURCES[type]);
    else if (COMPONENT_ELEMENTS[type]) ids = tokens.filter((x) => x.element === COMPONENT_ELEMENTS[type]).map((x) => x.id).sort();
    if (type === 'style-theme') for (const f of Object.keys(families)) ids = uniq([...ids, ...familyTokens(f)]);
    components = uniq([...tokenElements(tokens, ids), ...(targets[type]?.root ? [targets[type].root] : []), ...(targets[type]?.item ? [targets[type].item] : [])]);
    const prefixes = uniq(ids.map((id) => id.match(/^(--fx-[a-z]+-)/)?.[1]).filter(Boolean));
    const selectors = uniq(prefixes.flatMap((p) => readers(p))).slice(0, 40);
    const controls = row.by === 'reference' ? ['asset'] : row.by === 'bundle' ? [] : ['asset', ...(ids.length ? ['tokens'] : [])];
    const entry = {
      slot: field, kind, type, label: str(t.label) || type, by: row.by, via: row.via || undefined, elements: row.elements,
      controls, tokens: ids, settings: [], components, selectors,
      lives: row.by === 'bundle' ? null : assetLives(type),
    };
    if (type === 'layout' || type === 'dock-layout' || type === 'xlayout') { entry.controls = ['layout', 'tokens']; entry.layout = true; }
    slots.push(entry);
    // parts on top of a slot (composite types) or as the only way (widgets)
    if (row.elements.length) {
      const target = targets[type] ?? {};
      slots.push({ slot: `parts.${type}`, kind: 'parts', type, label: `${str(t.label) || type} parts`, by: 'parts', elements: row.elements, controls: ['tokens'], tokens: uniq(Object.keys(isObj(target.tokens) ? target.tokens : {}).map((k) => `axf.custom.${type}.${k}`)), settings: [`axf.custom.${type}`], components: uniq([target.root, target.item]), selectors: uniq([target.root, target.item]), lives: { document: 'app-look@1', field: 'settings["axf.custom.<type>"]', sheet: 'the customize sheet (engines/customize.ts)' } });
    }
  }
  // the skin's own fields
  slots.push({ slot: 'iconPack', kind: 'reference', type: 'icon-pack', label: 'Icon pack', by: 'reference', controls: ['asset', 'settings'], tokens: [], settings: ['axf.icons.pack.<scope>'], components: ['Icon', 'brandGlyph', 'engines/iconmap-rules.mjs'], selectors: [], lives: assetLives('icon-pack') });
  slots.push({ slot: 'extras.spacing', kind: 'extras', label: 'Spacing', controls: ['settings', 'tokens'], tokens: ['--fx-space'], settings: ['axf.appearance.spacing'], components: ['engines/spacing.ts', 'styleThemeVars'], selectors: readers('--fx-space').slice(0, 40), lives: { document: 'app-look@1', field: 'spacing' } });
  slots.push({ slot: 'extras.hidden', kind: 'extras', label: 'Hidden chrome', controls: ['settings'], tokens: [], settings: ['axf.hide.<type>'], components: ['engines/hide.ts', 'AppShell'], selectors: [], lives: { document: 'app-look@1', field: 'hidden' } });
  slots.push({ slot: 'extras.settings', kind: 'extras', label: 'Look settings and token overrides', controls: ['settings', 'tokens'], tokens: [], settings: ['axf.tokens.theme', STYLE_TOKENS_KEY, 'axf.tokens.layout', 'axf.tokens.typography', 'axf.tokens.density', 'axf.tokens.sizing', 'axf.tokens.nav', 'axf.tokens.instances', 'axf.banners.*', 'axf.widgets.*'], components: ['engines/control-tokens.mjs', 'compileStyles'], selectors: [], lives: { document: 'app-look@1', field: 'settings' } });
  slots.push({ slot: 'chrome', kind: 'chrome', label: 'Chrome settings per kind', controls: ['settings', 'asset'], tokens: [], settings: [...CHROME_TYPES.map((k) => CHROME_SETTINGS_PICK_KEY(k)), ...CHROME_TYPES.map((k) => CHROME_INSTANCE_KEY(k, '<instance>'))], components: ['TabGroup', 'ChromeContext', 'rt.chromeData', 'engines/chrome-settings-rules.mjs'], selectors: [], lives: { document: 'app-look@1', field: 'settings["axf.chrome.*"]', interfaces: 'framework/assets/settings/chrome-<kind>.json (shared default), <app>/src/assets/settings/chrome-<kind>-<app>.json (custom copy)' } });
  // skin-slots@1
  const motionTokens = uniq([...MOTION_SPEEDS.map(motionSpeedVar), '--fx-motion', ...MOTION_EASING_ROLES.map(motionEaseVar), ...MOTION_KINDS.flatMap((k) => ['enter', 'exit', 'dur', 'stagger'].map((f) => motionKindVar(k, f)))]);
  slots.push({ slot: 'motion', kind: 'motion', label: 'Motion', controls: ['tokens', 'settings'], tokens: motionTokens, attributes: ['data-fx-motion-reduced', ...MOTION_KINDS.flatMap((k) => [motionKindAttr(k, 'enter'), motionKindAttr(k, 'exit')])], settings: [MOTION_KEY], components: ['compileStyles (skinMotionStyle)'], selectors: uniq([...readers('--fx-motion-'), ...attrReaders('data-fx-motion-')]).slice(0, 60), lives: { document: 'app-look@1', field: `settings["${MOTION_KEY}"]`, defaults: 'framework/ui/axf.css :root (--fx-motion-*)' } });
  slots.push({ slot: 'behavior', kind: 'behavior', label: 'Behaviour defaults', controls: ['settings'], tokens: [], settings: [BEHAVIOR_ARM_KEY, ...BEHAVIOR_TAP_KINDS.map(behaviorTapKindKey), BEHAVIOR_OVERRIDES_KEY, ...CHROME_TYPES.map((k) => CHROME_KIND_DEFAULTS_KEY(k)), NAV_COLLAPSED_SETTING], components: ['engines/tapconfirm.ts (tapConfigFor)', 'behaviorStyle (withBehaviorOverrides)', 'TabGroup', 'rt.chromeData', 'workspace look', 'NavTree (rt.navCollapsed)'], selectors: uniq([...attrReaders('data-fx-hover'), ...attrReaders('data-fx-press'), ...attrReaders('data-fx-focus')]).slice(0, 40), lives: { document: 'app-look@1', field: 'settings (the keys listed)' } });
  slots.push({ slot: 'hooks', kind: 'hooks', label: 'Hooks and drop zones', controls: ['settings'], tokens: [], settings: HOOK_KINDS.map((k) => HOOKS_KEY(k)), components: ['rt.skinHooks / rt.hookRegistry', 'ActionBus (registered actions)', 'lib-datagrid row hooks (grid-hook@1)', 'lib-dnd zones (data-axf-drop)'], selectors: [], lives: { document: 'app-look@1', field: 'settings["axf.hooks.<kind>"]', resolvedAgainst: 'hook@1 ids (when the contract lands), grid-hook@1 row hooks, lib-dnd zone names' } });
  slots.push({ slot: 'grid', kind: 'grid', label: 'Grid layout', controls: ['tokens', 'settings'], tokens: familyTokens('grid'), attributes: ['data-fx-grid-density', 'data-fx-grid-header', 'data-fx-grid-lines', 'data-fx-grid-rows'], settings: [STYLE_TOKENS_KEY, GRID_KEY], components: ['lib-datagrid DataGrid (.axf-grid)', 'framework table (.fx-table)', 'engines/component-tokens.mjs'], selectors: uniq([...readers('--fx-grid-'), ...attrReaders('data-fx-grid-')]).slice(0, 60), lives: { document: 'app-look@1', field: `settings["${STYLE_TOKENS_KEY}"]["*"]["grid.<token>"] and settings["${GRID_KEY}"]`, defaults: 'framework/ui/axf.css :root (--fx-grid-*, generated from component-tokens.mjs)' } });
  slots.push({ slot: 'dialog', kind: 'dialog', label: 'Dialog chrome', controls: ['settings', 'tokens'], tokens: ['--fx-dialog-w'], attributes: ['data-fx-dialog', 'data-fx-backdrop', 'data-fx-dialog-anim', 'data-fx-dialog-header'], settings: [DIALOG_KEY], components: ['dialogStyle (engines/components.ts)', 'Dialog host'], selectors: uniq([...readers('--fx-dialog-'), ...attrReaders('data-fx-dialog')]).slice(0, 40), lives: { document: 'app-look@1', field: `settings["${DIALOG_KEY}"]`, over: 'the active dialog asset (assets.dialog)' } });
  slots.push({ slot: 'settings', kind: 'settings', label: 'Settings chrome', controls: ['asset', 'settings'], tokens: [], settings: CHROME_TYPES.map((k) => CHROME_SETTINGS_PICK_KEY(k)), components: ['lib-settings (the settings page)', 'ChromeContext settings dialogs', 'engines/settingsui.ts'], selectors: [], lives: { document: 'app-look@1', field: `slots.${SETTINGS_PAGE_SLOT} and settings["axf.chrome.settings.<kind>"]`, assets: assetLives('settings') } });

  // datasets: every document a skin reads or writes, per app and shared
  const datasets = [];
  datasets.push({ id: 'appearance', contract: 'appearance@1', what: 'The shared document: the hub-wide skin (`skin`), the hub default skin (`defaultSkin`), the palette and the shared token overrides (axf.tokens.*).', ...hubPlace(paths, APPEARANCE_PROJECT, APPEARANCE_PATH), repo: 'framework/core/engines/appearance.ts', writtenBy: ['every app (pushAppearance)', 'axHub', 'skins.mjs global | default'], readBy: ['every app (applyAppearance)', 'axHub pages (palette)'] });
  for (const a of apps) {
    datasets.push({ id: `look:${a.id}`, app: a.id, contract: 'app-look@1', what: `${a.id}'s own look: the default snapshot, its own picks, Use skin, scopes, the colour theme inside the skin, undo and backups.`, ...hubPlace(paths, APP_LOOK_PROJECT, appLookPath(a.id)), repo: 'framework/core/engines/skin-rules.mjs', writtenBy: [a.id, 'skins.mjs', 'the theme-manager routes', 'control@1'], readBy: [a.id, 'skins.mjs apps | at'] });
    datasets.push({ id: `default-skin:${a.id}`, app: a.id, contract: 'skin@1', what: `${a.id}'s Default skin: its saved look as a protected skin asset (default-${a.id}).`, ...hubPlace(paths, DEFAULT_SKIN_PROJECT, defaultSkinPath(a.id)), repo: 'framework/core/engines/skin-config-rules.mjs', writtenBy: ['skins.mjs snapshot | migrate'], readBy: [a.id, 'Settings → Appearance'] });
    datasets.push({ id: `skin-config:${a.id}`, app: a.id, contract: 'skin-config@1', what: `What the AI may change when it makes a skin for ${a.id} (allow / lock / ask, limits).`, ...hubPlace(paths, SKIN_CONFIG_PROJECT, skinConfigPath(a.id)), repo: 'framework/core/engines/skin-config-rules.mjs', writtenBy: ['skins.mjs config', 'Settings → Appearance → Configure'], readBy: ['the skin maker'] });
  }
  datasets.push({ id: 'default-skin:global', contract: 'skin@1', what: 'The hub-wide look as a skin (default-global).', ...hubPlace(paths, DEFAULT_SKIN_PROJECT, defaultSkinPath('global')), repo: 'framework/core/engines/skin-config-rules.mjs', writtenBy: ['skins.mjs migrate global'], readBy: ['every app that follows the hub-wide skin'] });
  datasets.push({ id: 'skins:framework', contract: 'skin@1', what: 'The framework skins (repo files, baked into every app that ships the shared set).', hub: null, mount: null, dataStore: null, repo: 'framework/assets/skin/<id>.json', baked: apps.map((a) => `${a.dir}/src/axf/assets/skin/<id>.json`), ids: Array.isArray(assets.skin) ? [...assets.skin].sort() : [], writtenBy: ['builds (framework/assets)', 'the skin maker (Save as skin)'], readBy: ['every app (the Skin picker)', 'skins.mjs list | covers'] });
  datasets.push({ id: 'animation-prefs', contract: 'animation-prefs', what: "This app's own animation picks over the skin's (Settings → Appearance → Animations).", hub: 'app-look@1 settings["axf.appearance.animations"]', mount: null, dataStore: null, repo: 'framework/core/engines/animation-rules.mjs', writtenBy: ['Settings → Appearance', 'animations.mjs'], readBy: ['compileStyles'] });

  // layouts: every layout-bearing type with its assets and where the pick lives
  const layouts = [];
  for (const type of ['layout', 'dock-layout', 'xlayout']) {
    if (!types[type]) continue;
    const lives = assetLives(type);
    layouts.push({ type, label: str(types[type].label) || type, ids: lives.ids, tokens: type === 'layout' ? tokensBySource(tokens, SECTION_TOKEN_SOURCES.layout) : [], repo: lives.repo, baked: lives.baked, pick: lives.pick, overrides: type === 'layout' ? 'app-look@1 settings["axf.tokens.layout"] (control@1 tokens.layout)' : null, engine: type === 'layout' ? 'framework/core/engines/layout.ts (layoutVars)' : type === 'dock-layout' ? 'framework/core/engines/dock.ts' : 'framework/core/engines/xlayout.ts' });
  }

  const out = {
    $axf: SKIN_MAP_FRAME,
    generated: true,
    readOnly: true,
    note: 'Generated by framework/core/engines/skin-map.mjs from the registries, the token registry, the slot rules, the data-store rules and the stylesheets. Do not edit: node framework/cli/axf.mjs schemas rewrites it; node framework/cli/skins.mjs map prints it.',
    sources: { registry: 'framework/schemas/asset-types.json', customize: 'framework/schemas/customize.json', tokens: 'framework/schemas/token-registry.json', componentTokens: 'framework/core/engines/component-tokens.mjs', slots: 'framework/core/engines/skin-slots.mjs', dataStore: 'framework/schemas/data-store-paths.json', sheets: Object.keys(sheets).sort(), apps: apps.map((a) => a.id) },
    kinds: SKIN_MAP_ROW_KINDS,
    coverageKinds: COVERAGE_KINDS,
    summary: { slots: slots.length, datasets: datasets.length, layouts: layouts.length, tokens: uniq(slots.flatMap((s) => s.tokens)).length, settings: uniq(slots.flatMap((s) => s.settings)).length },
    slots,
    datasets,
    layouts,
  };
  if (str(i.generatedAt)) out.generatedAt = i.generatedAt;
  return out;
}

/**
 * The map read through one skin (build flagship-professional-skin-covering-2, s20): every row gains `value` (what that
 * skin sets there: an asset id, a part map, a slot block; null = left to the level below) and `filled`. `skin` is the
 * skin's data with its `extends` chain already folded (skin-rules.mjs foldSkinExtends). `slot` filters to the rows whose
 * slot, type or kind is that name (`toolbar`, `parts.toolbar`, `motion`). Pure; the document itself stays skin-free.
 */
export function skinMapRowValue(row, skin) {
  const d = isObj(skin) ? skin : {};
  const has = (v) => (typeof v === 'string' ? v !== '' : isObj(v) ? Object.keys(v).length > 0 : v !== undefined && v !== null);
  let v = null;
  if (!isObj(row)) return null;
  if (row.kind === 'section') v = d[row.slot];
  else if (row.kind === 'parts') v = d.parts?.[row.type];
  else if (row.slot === 'iconPack') v = d.iconPack;
  else if (row.kind === 'reference') v = row.via === 'iconPack' ? d.iconPack : d.assets?.[row.via];
  else if (row.kind === 'extras') v = d.extras?.[row.slot.slice('extras.'.length)];
  else if (row.kind === 'chrome') v = d.chrome;
  else if (SKIN_SLOT_KEYS.includes(row.kind)) v = d[row.kind];
  else if (typeof row.slot === 'string' && row.slot.startsWith('assets.')) v = d.assets?.[row.type];
  return has(v) ? v : null;
}
export function skinMapFor(map, id, skin, slot = '') {
  if (!isObj(map)) return null;
  const want = String(slot ?? '').trim();
  const rows = (map.slots ?? []).filter((r) => !want || r.slot === want || r.type === want || r.kind === want || r.slot === `assets.${want}`);
  const slots = rows.map((r) => { const value = skin ? skinMapRowValue(r, skin) : null; return { ...r, value, filled: value !== null }; });
  return { ...map, skin: id ? { id, filled: slots.filter((r) => r.filled).length, rows: slots.length } : null, slots };
}

/** The rows of the map that touch one settings key or token (the Where-everything-lives search). */
export function skinMapFind(map, needle) {
  const q = String(needle ?? '').toLowerCase();
  if (!q || !isObj(map)) return [];
  const hit = (s) => typeof s === 'string' && s.toLowerCase().includes(q);
  return (map.slots ?? []).filter((r) => hit(r.slot) || hit(r.label) || hit(r.type) || (r.tokens ?? []).some(hit) || (r.settings ?? []).some(hit) || (r.components ?? []).some(hit) || (r.attributes ?? []).some(hit) || (r.selectors ?? []).some(hit));
}

/** Validation messages for a map document (the console refuses anything else as the generated map). */
export function skinMapErrors(raw) {
  if (!isObj(raw)) return ['the skin map must be an object'];
  const out = [];
  if (raw.$axf !== SKIN_MAP_FRAME) out.push(`$axf must be ${SKIN_MAP_FRAME}`);
  if (raw.generated !== true || raw.readOnly !== true) out.push('a skin map is generated and read-only (generated: true, readOnly: true)');
  for (const k of ['slots', 'datasets', 'layouts']) if (!Array.isArray(raw[k])) out.push(`${k} must be an array`);
  for (const [n, r] of (Array.isArray(raw.slots) ? raw.slots : []).entries()) {
    if (!isObj(r) || !str(r.slot)) { out.push(`slots[${n}] needs a slot`); continue; }
    if (!SKIN_MAP_ROW_KINDS.includes(r.kind)) out.push(`slots[${n}] (${r.slot}): kind must be one of ${SKIN_MAP_ROW_KINDS.join(', ')}`);
    if (!Array.isArray(r.controls) || r.controls.some((c) => !SKIN_MAP_CONTROLS.includes(c))) out.push(`slots[${n}] (${r.slot}): controls must list ${SKIN_MAP_CONTROLS.join(', ')}`);
    for (const k of ['tokens', 'settings', 'components']) if (!Array.isArray(r[k])) out.push(`slots[${n}] (${r.slot}): ${k} must be an array`);
  }
  for (const [n, d] of (Array.isArray(raw.datasets) ? raw.datasets : []).entries()) {
    if (!isObj(d) || !str(d.id) || !str(d.contract)) out.push(`datasets[${n}] needs id and contract`);
    else if (!('hub' in d) || !('dataStore' in d) || !('repo' in d)) out.push(`datasets[${n}] (${d.id}) must say where it lives (hub, repo, dataStore; null when it has no such place)`);
  }
  for (const [n, l] of (Array.isArray(raw.layouts) ? raw.layouts : []).entries()) if (!isObj(l) || !str(l.type) || !Array.isArray(l.ids) || !str(l.repo)) out.push(`layouts[${n}] needs type, ids and repo`);
  return out;
}

/** The JSON Schema of skin-map@1 (schemas/json/skin-map.schema.json). */
export function skinMapJsonSchema() {
  const strArr = { type: 'array', items: { type: 'string' } };
  const row = { type: 'object', required: ['slot', 'kind', 'controls', 'tokens', 'settings', 'components'], properties: { slot: { type: 'string' }, kind: { enum: [...SKIN_MAP_ROW_KINDS] }, type: { type: 'string' }, label: { type: 'string' }, by: { enum: [...COVERAGE_KINDS, 'uncovered'] }, via: { type: 'string' }, elements: strArr, controls: { type: 'array', items: { enum: [...SKIN_MAP_CONTROLS] } }, tokens: strArr, attributes: strArr, settings: strArr, components: strArr, selectors: strArr, layout: { type: 'boolean' }, why: { type: 'string' }, lives: { type: ['object', 'null'] } } };
  const dataset = { type: 'object', required: ['id', 'contract', 'what', 'hub', 'repo', 'dataStore'], properties: { id: { type: 'string' }, app: { type: 'string' }, contract: { type: 'string' }, what: { type: 'string' }, hub: { type: ['string', 'null'] }, mount: { type: ['string', 'null'] }, dataStore: { type: ['string', 'null'] }, repo: { type: 'string' }, baked: strArr, ids: strArr, writtenBy: strArr, readBy: strArr } };
  const layout = { type: 'object', required: ['type', 'ids', 'repo'], properties: { type: { type: 'string' }, label: { type: 'string' }, ids: strArr, tokens: strArr, repo: { type: 'string' }, baked: strArr, pick: { type: 'object' }, overrides: { type: ['string', 'null'] }, engine: { type: 'string' } } };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'axf/skin-map.schema.json',
    title: 'AmberX AXF skin map (skin-map@1)',
    description: 'A generated, read-only document: which asset / dataset / layout each skin@1 slot controls, which tokens and settings keys it writes, which components and selectors read them, and where every dataset and layout lives (hub path, repo path, data-store namespace).',
    type: 'object',
    required: ['$axf', 'generated', 'readOnly', 'sources', 'summary', 'slots', 'datasets', 'layouts'],
    properties: {
      $axf: { const: SKIN_MAP_FRAME }, generated: { const: true }, readOnly: { const: true }, note: { type: 'string' }, generatedAt: { type: 'string' },
      sources: { type: 'object' }, kinds: strArr, coverageKinds: strArr,
      summary: { type: 'object', properties: { slots: { type: 'integer' }, datasets: { type: 'integer' }, layouts: { type: 'integer' }, tokens: { type: 'integer' }, settings: { type: 'integer' } } },
      slots: { type: 'array', items: row }, datasets: { type: 'array', items: dataset }, layouts: { type: 'array', items: layout },
    },
  };
}
