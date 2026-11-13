/**
 * designer@1 — the UI asset designer: a host plugin and its designer add-ons (Brett, Nov 7 2026, build
 * ui-asset-designer: "We're gonna build a UI asset designer, which will create assets with their manifest and their
 * identifier. It's going to create separate plugins for the app menu designer, the nav menu designer, the toolbar
 * designer, the banner designer, the embedded widget designer, the widget designer. These are not dependent on the
 * designer, but the designer interface will inherit those other designers. The UI designer plugin will have add-ons,
 * each with their own settings interface and the designer's interface." … "Make it super powerful: full-blown context
 * menu, drag and drop, map-based. Every UI asset will also have a context menu section which gives you a preview of
 * the UI, and informs you in multiple ways (tooltips etc)."). Every designer is built from scratch; older designer
 * code is reference only.
 *
 * ONE rules file, plain JS, read by the TS engines, the build engine (axf init / validate), the console server, the
 * CLI, the React layer and every add-on plugin:
 *
 *   designer-addon@1   what a designer add-on declares (plugin.json `designer` block, or `designer.json` beside it):
 *                      id, label, the asset types it designs, its plugin, its standalone view, its settings interface
 *                      (a `settings` asset, settings-ui@1: `settings/designer-<addon>`), its designer interface (a
 *                      `designer` asset: `designer/<addon>`), the extra manifest fields it writes, capabilities, what
 *                      may be dropped on its canvas, the node kinds of its document, voice phrases. The six Brett named
 *                      ship in DESIGNER_ADDONS; the registry is open (`addonsFromPluginManifest` finds more).
 *   designer (type)    the designer's interface as an asset (like `settings` is the settings interface as an asset):
 *                      canvas (grid, snap, zoom, rulers, guides, free / flow / both map), panels (library, layers,
 *                      inspector, preview, help, history: where each sits), preview (inline / floating / docked,
 *                      desktop / phone / both, live / on save), info (tooltip, hover card, side panel, help text, say),
 *                      context-menu sections, history (limit, coalescing), output (where designed assets go, id
 *                      prefix, register, version bump), voice, autosave. `designer/default` is the shared interface;
 *                      every add-on has its own copy `designer/<addon>` that `extends` it (inherit@1, the same folding
 *                      as chrome-settings@1) until edited.
 *   designed@1         the manifest every designed asset carries (envelope field `designed`): a uid that never changes
 *                      (the identifier, survives renames), the ref `<type>/<id>`, which add-on made it, app, author,
 *                      created / updated, revision, origin (what Brett said), the UI registry item it registers as,
 *                      where it lives in the library, the add-on's extra fields and a content hash. `makeDesigned`,
 *                      `withDesigned`, `designedOf`, `designedErrors`.
 *   registration       `designedRegistryItem` = the ui-registry@1 item (build ui-registry-shortcuts) a designed asset
 *                      registers as (`<kind>:<type>/<id>`, opens in its designer), `designedLibraryEntry` = its row in
 *                      the designer library index (designer-library@1), `designedLibraryPath` = the file it is saved to.
 *   embed (type)       embed-asset@1: an asset that shows another registered UI, a plugin view, a command or a URL
 *                      inside a host (a toolbar, a tab group, a grid row, a banner, any region): target, a link to a
 *                      JSON manifest with the configuration, size, hosts, load, sandbox, expand. (Not embed@1, which is
 *                      the host marker for an app running inside another app: core/engines/embed.ts.)
 *   asset-context@1    the context-menu section every UI asset gets (`assetContextSection`): its identity with a
 *                      tooltip, a live Preview entry, About (hover card / side panel), Help (help@1), Edit in its
 *                      designer, Copy id, Where it is used; `assetInfo` writes the same facts in every mode.
 *
 * Pure: no IO, no DOM, no clock of its own (`now` is passed in). Unknown fields are dropped (open registry).
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); fixture spec/fixtures/designer.json
 * (spec/check-designer.mjs). The document model, history, selection, canvas, drag-and-drop and the designer's own
 * context menu are in designer-doc.mjs.
 */
import { CHROME_TYPES, resolveSettingsChain } from './chrome-settings-rules.mjs';

/** asset@1 envelope id pattern (asset-types.json → envelope.idPattern; spec/check-designer.mjs keeps them equal). */
export const ASSET_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,47}$';

export const DESIGNER_CONTRACT = 'designer@1';
export const DESIGNER_ADDON_FRAME = 'designer-addon@1';
export const DESIGNED_FRAME = 'designed@1';
export const DESIGNER_LIBRARY_FRAME = 'designer-library@1';
export const EMBED_ASSET_CONTRACT = 'embed-asset@1';
export const ASSET_CONTEXT_CONTRACT = 'asset-context@1';

/** The two asset types this contract adds. */
export const DESIGNER_TYPE = 'designer';
export const EMBED_TYPE = 'embed';
/** The host plugin (console) and the capability names. An add-on provides `service:axf.designer-addon@1` + `designer:<addon id>`. */
export const DESIGNER_HOST_PLUGIN = 'ai.amberx.axf.console.ui-asset-designer';
export const DESIGNER_HOST_FOLDER = 'ui-asset-designer';
export const DESIGNER_SERVICE = 'axf.designer@1';
export const DESIGNER_ADDON_SERVICE = 'axf.designer-addon@1';
export const DESIGNER_PLUGIN_PREFIX = 'ai.amberx.axf.console.';
/** The shared designer interface every add-on copy extends. */
export const DESIGNER_DEFAULT_ID = 'default';
/** The settings interface ids: `designer` for the host, `designer-<addon>` per add-on (all extend `designer`). */
export const DESIGNER_SETTINGS_ID = 'designer';
export const designerSettingsId = (addon) => (addon && addon !== 'host' ? `${DESIGNER_SETTINGS_ID}-${addon}` : DESIGNER_SETTINGS_ID);
/** A settings asset's `for` when it is a designer's: `designer` (the host) or `designer:<addon>`. */
export const designerSettingsFor = (addon) => (addon && addon !== 'host' ? `designer:${addon}` : 'designer');
export const DESIGNER_SETTINGS_FOR = /^designer(:[a-z0-9][a-z0-9-]{0,39})?$/;
/** The element attribute that names the asset an element draws (`<type>/<id>`); the asset context section reads it. */
export const ASSET_ATTR = 'data-axf-asset';
/** The drag payload MIME type every designer and palette uses (designer-doc.mjs reads it). */
export const DESIGNER_DROP_MIME = 'application/x-axf-designer';

export const DESIGNER_LIMITS = { id: 40, label: 80, types: 24, phrases: 24, phrase: 120, aliases: 12, alias: 80, manifestFields: 40, revision: 1_000_000, extras: 60 };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, maxN, maxLen) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxN) : []);
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ASSET_ID = new RegExp(ASSET_ID_PATTERN);
const PLUGIN_ID = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;
const TYPE_SLUG = /^[a-z][a-z0-9-]{0,39}$/;
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/* ================================================================== asset types the designers cover (asset-types.json; spec/check-designer.mjs keeps these lists equal to the spec) */

/** Widget types (asset-types.json `widget: true`), in spec order: what the Widget designer designs. */
export const DESIGNER_WIDGET_TYPES = ['clock', 'search-bar', 'action-button', 'logo', 'label', 'status', 'counter', 'progress', 'avatar', 'link', 'theme-switch', 'spacer', 'divider'];
/** Every UI asset type: one that is drawn on screen (navigation chrome, overlays, controls, the banner and badges, widgets, the embed). Themes, packs, system and brand types are not UI assets. */
export const UI_ASSET_TYPES = ['app-menu', 'toolbar', 'nav-menu', 'context-menu', 'tab-group', 'dialog', 'popup', 'button', 'slider', 'container', 'gauge', 'meter', 'banner', 'badge', ...DESIGNER_WIDGET_TYPES, EMBED_TYPE];
export const isUiAssetType = (t) => UI_ASSET_TYPES.includes(t);
/** Labels and icons of the UI asset types (asset-types.json `label` / `icon`) plus the two types this contract adds. */
export const UI_ASSET_LABELS = Object.freeze({
  'app-menu': 'Application menu', toolbar: 'Toolbar', 'nav-menu': 'Navigation menu', 'context-menu': 'Context menu', 'tab-group': 'Tab group', dialog: 'Dialog', popup: 'Popup / toast', button: 'Button', slider: 'Slider', container: 'Container', gauge: 'Gauge', meter: 'Progress meter', banner: 'Banner', badge: 'Badge',
  clock: 'Clock', 'search-bar': 'Search bar', 'action-button': 'Action button', logo: 'Logo', label: 'Label', status: 'Status', counter: 'Counter', progress: 'Progress', avatar: 'Avatar', link: 'Link', 'theme-switch': 'Theme switch', spacer: 'Spacer', divider: 'Divider',
  [EMBED_TYPE]: 'Embed', [DESIGNER_TYPE]: 'Designer interface',
});
export const UI_ASSET_ICONS = Object.freeze({
  'app-menu': 'menu', toolbar: 'sliders', 'nav-menu': 'grid', 'context-menu': 'chevron-right', 'tab-group': 'layers', dialog: 'box', popup: 'bell', button: 'zap', slider: 'sliders', container: 'box', gauge: 'chart', meter: 'chart', banner: 'menu', badge: 'star',
  clock: 'clock', 'search-bar': 'search', 'action-button': 'zap', logo: 'star', label: 'type', status: 'eye', counter: 'bell', progress: 'chart', avatar: 'user', link: 'external', 'theme-switch': 'sun', spacer: 'minus', divider: 'layout',
  [EMBED_TYPE]: 'box', [DESIGNER_TYPE]: 'edit',
});
export const assetTypeLabel = (t) => UI_ASSET_LABELS[t] ?? String(t ?? '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const assetTypeIcon = (t) => UI_ASSET_ICONS[t] ?? 'layers';
/** The ui-registry@1 kind a designed asset of a type registers as. */
export const DESIGNED_UI_KIND = Object.freeze({
  toolbar: 'toolbar', banner: 'banner', 'nav-menu': 'menu', 'app-menu': 'menu', 'context-menu': 'menu', 'tab-group': 'tab-group', dialog: 'dialog', popup: 'popup',
  button: 'control', slider: 'control', container: 'control', gauge: 'control', meter: 'control', badge: 'widget', [EMBED_TYPE]: 'widget',
  ...Object.fromEntries(DESIGNER_WIDGET_TYPES.map((t) => [t, 'widget'])),
});
export const designedUiKind = (type) => DESIGNED_UI_KIND[type] ?? 'control';

/* ================================================================== designer-addon@1 */

/** What a designer can do. An add-on lists the ones it supports; the host greys out the rest. */
export const DESIGNER_CAPABILITIES = ['canvas', 'tree', 'preview', 'context-menu', 'drag-drop', 'multi-select', 'undo', 'map', 'voice', 'api', 'standalone', 'embedded'];
/** What may be dropped on a designer canvas (designer-doc.mjs `parseDrop` / `applyDrop`). */
export const DESIGNER_DROP_KINDS = ['node', 'palette', 'asset', 'action', 'hook', 'embed', 'text', 'file'];
/** The field kinds an add-on's extra manifest fields take (the host's manifest form draws them). */
export const MANIFEST_FIELD_KINDS = ['text', 'number', 'toggle', 'choice', 'asset', 'action', 'list'];

const ADDON_BASE = { $axf: DESIGNER_ADDON_FRAME, version: '1.0.0', standalone: true, capabilities: [...DESIGNER_CAPABILITIES] };
const addon = (id, label, icon, types, extra = {}) => ({
  ...ADDON_BASE, id, label, icon, types, plugin: `${DESIGNER_PLUGIN_PREFIX}${id}-designer`, folder: `${id}-designer`, view: `${id}-designer`,
  settings: designerSettingsId(id), interface: id, drops: ['node', 'palette', 'action', 'hook', 'text'], manifest: { fields: [] }, voice: [`make a ${label.replace(/ designer$/, '').toLowerCase()} called {name}`, `open the ${label.toLowerCase()}`, `edit {asset} in the ${label.toLowerCase()}`], ...extra,
});
/** The six add-ons Brett named (Nov 7 2026), each a standalone plugin that also plugs into the host. Open list: more come from plugin manifests. */
export const DESIGNER_ADDONS = Object.freeze([
  addon('app-menu', 'App menu designer', 'menu', ['app-menu'], { drops: ['node', 'palette', 'action', 'hook', 'text', 'embed'], manifest: { fields: [{ key: 'window', label: 'Window', kind: 'text' }] } }),
  addon('nav-menu', 'Nav menu designer', 'list', ['nav-menu'], { drops: ['node', 'palette', 'action', 'hook', 'text'], manifest: { fields: [{ key: 'navStyle', label: 'Sub-menu style asset', kind: 'asset', options: ['nav-style'] }] } }),
  addon('toolbar', 'Toolbar designer', 'sliders', ['toolbar'], { drops: ['node', 'palette', 'asset', 'action', 'hook', 'embed', 'text'], manifest: { fields: [{ key: 'placement', label: 'Placement', kind: 'choice', options: ['top', 'bottom', 'left', 'right', 'floating'] }, { key: 'window', label: 'Window', kind: 'text' }] } }),
  addon('banner', 'Banner designer', 'menu', ['banner'], { drops: ['node', 'palette', 'asset', 'embed'], manifest: { fields: [{ key: 'formFactor', label: 'Form factor', kind: 'choice', options: ['desktop', 'phone', 'both'] }] } }),
  addon('embed', 'Embed designer', 'box', [EMBED_TYPE], { capabilities: DESIGNER_CAPABILITIES.filter((c) => !['map', 'multi-select'].includes(c)), drops: ['asset', 'action', 'text', 'file'], manifest: { fields: [{ key: 'hosts', label: 'Hosts', kind: 'list' }, { key: 'sandbox', label: 'Sandboxed', kind: 'toggle' }] }, voice: ['make an embed of {ui}', 'put {ui} in the {host}', 'open the embed designer'] }),
  addon('widget', 'Widget designer', 'layers', DESIGNER_WIDGET_TYPES, { capabilities: DESIGNER_CAPABILITIES.filter((c) => !['map', 'multi-select'].includes(c)), drops: ['asset', 'action', 'text'], manifest: { fields: [{ key: 'tone', label: 'Tone', kind: 'choice', options: ['neutral', 'accent', 'success', 'warning', 'danger'] }] }, voice: ['make a {type} widget called {name}', 'open the widget designer'] }),
]);
export const DESIGNER_ADDON_IDS = DESIGNER_ADDONS.map((a) => a.id);

/** One extra manifest field an add-on writes into `designed.extras`. */
export function normalizeManifestField(raw) {
  if (!isObj(raw)) return null;
  const key = str(raw.key, 40); if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key)) return null;
  const kind = MANIFEST_FIELD_KINDS.includes(raw.kind) ? raw.kind : 'text';
  const out = { key, label: str(raw.label, 80) || key, kind };
  const options = strList(raw.options, 24, 40); if (options.length) out.options = options;
  if (raw.required === true) out.required = true;
  if (raw.default !== undefined && ['string', 'number', 'boolean'].includes(typeof raw.default)) out.default = raw.default;
  return out;
}

/** An add-on declaration, cleaned: unknown fields dropped, defaults from its id. Null when it has no usable id, label or types. */
export function normalizeDesignerAddon(raw, defaults = {}) {
  if (!isObj(raw)) return null;
  const id = slug(raw.id); if (!SLUG.test(id)) return null;
  const types = strList(raw.types ?? (raw.type ? [raw.type] : []), DESIGNER_LIMITS.types, 40).filter((t) => TYPE_SLUG.test(t));
  const label = str(raw.label, DESIGNER_LIMITS.label) || `${assetTypeLabel(types[0] ?? id)} designer`;
  if (!types.length) return null;
  const plugin = str(raw.plugin ?? defaults.plugin, 120);
  const folder = str(raw.folder ?? defaults.folder, 60);
  const caps = strList(raw.capabilities, 24, 20).filter((c) => DESIGNER_CAPABILITIES.includes(c));
  const drops = strList(raw.drops, 12, 20).filter((d) => DESIGNER_DROP_KINDS.includes(d));
  const fields = (Array.isArray(raw.manifest?.fields) ? raw.manifest.fields : []).map(normalizeManifestField).filter(Boolean).slice(0, DESIGNER_LIMITS.manifestFields);
  const out = {
    $axf: DESIGNER_ADDON_FRAME, id, label, icon: str(raw.icon, 40) || assetTypeIcon(types[0]), types,
    plugin: PLUGIN_ID.test(plugin) ? plugin : `${DESIGNER_PLUGIN_PREFIX}${id}-designer`,
    folder: /^[a-z0-9][a-z0-9-]{0,59}$/.test(folder) ? folder : `${id}-designer`,
    view: /^[a-z0-9][a-z0-9-]{0,59}$/.test(str(raw.view, 60)) ? str(raw.view, 60) : `${id}-designer`,
    settings: ASSET_ID.test(str(raw.settings, 48)) ? str(raw.settings, 48) : designerSettingsId(id),
    interface: ASSET_ID.test(str(raw.interface, 48)) ? str(raw.interface, 48) : id,
    capabilities: caps.length ? caps : [...DESIGNER_CAPABILITIES],
    drops: drops.length ? drops : ['node', 'palette', 'action', 'text'],
    manifest: { fields },
    voice: strList(raw.voice, DESIGNER_LIMITS.phrases, DESIGNER_LIMITS.phrase),
    standalone: raw.standalone !== false,
    version: /^\d+\.\d+\.\d+$/.test(str(raw.version, 20)) ? str(raw.version, 20) : '1.0.0',
  };
  const nodes = strList(raw.nodes, 24, 40); if (nodes.length) out.nodes = nodes;
  const detail = str(raw.detail ?? raw.description, 300); if (detail) out.detail = detail;
  return out;
}

/** What is wrong with an add-on declaration; [] when nothing. */
export function designerAddonErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['not an object'];
  if (raw.$axf !== undefined && raw.$axf !== DESIGNER_ADDON_FRAME) e.push(`$axf must be ${DESIGNER_ADDON_FRAME}`);
  if (!SLUG.test(slug(raw.id))) e.push('id: a slug (a-z, 0-9, -) is needed');
  const types = Array.isArray(raw.types) ? raw.types : raw.type ? [raw.type] : [];
  if (!types.length) e.push('types: at least one asset type');
  for (const t of types) if (!TYPE_SLUG.test(String(t))) e.push(`types: not an asset type name "${t}"`);
  if (raw.plugin !== undefined && !PLUGIN_ID.test(String(raw.plugin))) e.push('plugin: a plugin id like ai.amberx.axf.console.toolbar-designer');
  for (const c of Array.isArray(raw.capabilities) ? raw.capabilities : []) if (!DESIGNER_CAPABILITIES.includes(c)) e.push(`capabilities: unknown "${c}" (${DESIGNER_CAPABILITIES.join(', ')})`);
  for (const d of Array.isArray(raw.drops) ? raw.drops : []) if (!DESIGNER_DROP_KINDS.includes(d)) e.push(`drops: unknown "${d}" (${DESIGNER_DROP_KINDS.join(', ')})`);
  if (raw.manifest !== undefined && (!isObj(raw.manifest) || (raw.manifest.fields !== undefined && !Array.isArray(raw.manifest.fields)))) e.push('manifest: { fields: [{ key, label, kind, options?, required?, default? }] }');
  for (const f of Array.isArray(raw.manifest?.fields) ? raw.manifest.fields : []) if (!normalizeManifestField(f)) e.push(`manifest.fields: bad field ${JSON.stringify(f).slice(0, 80)}`);
  if (raw.settings !== undefined && !ASSET_ID.test(String(raw.settings))) e.push('settings: a settings asset id');
  if (raw.interface !== undefined && !ASSET_ID.test(String(raw.interface))) e.push('interface: a designer asset id');
  return e;
}

/**
 * The add-ons a plugin manifest declares: its `designer` block (one add-on or a list) and every `designer:<id>` in
 * `provides` (an add-on with no block gets the defaults of its id). The plugin's id and folder fill in the blanks.
 */
export function addonsFromPluginManifest(manifest, folder = '') {
  if (!isObj(manifest)) return [];
  const defaults = { plugin: str(manifest.id, 120), folder: str(folder, 60) };
  const out = new Map();
  const blocks = Array.isArray(manifest.designer) ? manifest.designer : isObj(manifest.designer) ? [manifest.designer] : [];
  for (const b of blocks) { const a = normalizeDesignerAddon(b, defaults); if (a) out.set(a.id, a); }
  for (const p of Array.isArray(manifest.provides) ? manifest.provides : []) {
    const m = /^designer:([a-z0-9][a-z0-9-]{0,39})$/.exec(String(p)); if (!m || out.has(m[1])) continue;
    const known = DESIGNER_ADDONS.find((a) => a.id === m[1]);
    const a = normalizeDesignerAddon(known ? { ...known, ...defaults } : { id: m[1], types: TYPE_SLUG.test(m[1]) ? [m[1]] : [], ...defaults }, defaults);
    if (a) out.set(a.id, a);
  }
  return [...out.values()];
}

/** Every add-on the host knows: the built-in six, then declared ones (a declared add-on with a built-in id replaces it). */
export function mergeAddons(...lists) {
  const out = new Map(DESIGNER_ADDONS.map((a) => [a.id, a]));
  for (const l of lists) for (const a of Array.isArray(l) ? l : []) { const n = normalizeDesignerAddon(a); if (n) out.set(n.id, n); }
  return [...out.values()];
}
/** The add-on that designs an asset type (the first one listing it), or null. */
export const addonForType = (addons, type) => (Array.isArray(addons) ? addons : []).find((a) => a.types.includes(type)) ?? null;
/** The picker rows of the host: label, icon, the types, whether the plugin is installed (`installed` = the plugin ids present). */
export function designerAddonChoices(addons, installed = []) {
  const have = new Set(Array.isArray(installed) ? installed : []);
  return (Array.isArray(addons) ? addons : []).map((a) => ({ id: a.id, label: a.label, icon: a.icon, types: [...a.types], plugin: a.plugin, installed: have.has(a.plugin), view: a.view, settings: a.settings, interface: a.interface }));
}
/** The `provides` entries an add-on plugin declares so the host and the plugin inventory see it. */
export const addonProvides = (a) => [`service:${DESIGNER_ADDON_SERVICE}`, `designer:${a.id}`, `view:${a.view}`, `settings-tab:${a.folder}`];

/* ================================================================== the designer asset type: the designer's interface */

const field = (key, label, kind, extra) => ({ key, label, kind, group: key.split('.')[0], level: 'basic', ...extra });
/** Every field of a designer asset (dotted paths into `data`): kind, options / range, default, group and level. The settings dialog, the validator and the JSON Schema all read this one list. */
export const DESIGNER_FIELDS = Object.freeze([
  field('canvas.mode', 'Canvas', 'choice', { options: ['free', 'flow', 'both'], labels: { free: 'Free map', flow: 'Flow', both: 'Both' }, default: 'both', level: 'simple' }),
  field('canvas.grid', 'Grid step', 'number', { min: 2, max: 64, default: 8 }),
  field('canvas.snap', 'Snap to grid', 'toggle', { default: true, level: 'simple' }),
  field('canvas.zoomMin', 'Smallest zoom (%)', 'number', { min: 10, max: 100, default: 25, level: 'developer' }),
  field('canvas.zoomMax', 'Largest zoom (%)', 'number', { min: 100, max: 800, default: 400, level: 'developer' }),
  field('canvas.rulers', 'Rulers', 'toggle', { default: false }),
  field('canvas.guides', 'Alignment guides', 'toggle', { default: true }),
  field('panels.library', 'Asset library panel', 'choice', { options: ['left', 'right', 'bottom', 'float', 'hidden'], default: 'left', level: 'simple' }),
  field('panels.layers', 'Layers / tree panel', 'choice', { options: ['left', 'right', 'bottom', 'float', 'hidden'], default: 'left', level: 'simple' }),
  field('panels.inspector', 'Inspector panel', 'choice', { options: ['left', 'right', 'bottom', 'float', 'hidden'], default: 'right', level: 'simple' }),
  field('panels.preview', 'Preview panel', 'choice', { options: ['left', 'right', 'bottom', 'float', 'hidden'], default: 'bottom', level: 'simple' }),
  field('panels.help', 'Help panel', 'choice', { options: ['left', 'right', 'bottom', 'float', 'hidden'], default: 'right' }),
  field('panels.history', 'History panel', 'choice', { options: ['left', 'right', 'bottom', 'float', 'hidden'], default: 'hidden' }),
  field('preview.mode', 'Preview', 'choice', { options: ['inline', 'floating', 'docked'], default: 'docked', level: 'simple' }),
  field('preview.device', 'Preview device', 'choice', { options: ['desktop', 'phone', 'both'], default: 'both', level: 'simple' }),
  field('preview.refresh', 'Preview refresh', 'choice', { options: ['live', 'on-save'], labels: { live: 'Live', 'on-save': 'On save' }, default: 'live' }),
  field('info.tooltip', 'Tooltips', 'toggle', { default: true, level: 'simple' }),
  field('info.hoverCard', 'Hover cards', 'toggle', { default: true, level: 'simple' }),
  field('info.sidePanel', 'Side panel details', 'toggle', { default: true }),
  field('info.helpText', 'Help text', 'toggle', { default: true }),
  field('info.say', 'Spoken descriptions', 'toggle', { default: false }),
  field('context.preview', 'Preview in the context menu', 'toggle', { default: true, level: 'simple' }),
  field('context.insert', 'Insert menu', 'toggle', { default: true }),
  field('context.arrange', 'Arrange menu', 'toggle', { default: true }),
  field('context.clipboard', 'Cut / copy / paste', 'toggle', { default: true }),
  field('context.help', 'Help entry', 'toggle', { default: true }),
  field('history.limit', 'Undo steps', 'number', { min: 10, max: 500, default: 100 }),
  field('history.coalesceMs', 'Merge quick edits (ms)', 'number', { min: 0, max: 2000, default: 400, level: 'developer' }),
  field('output.to', 'Save designed assets to', 'choice', { options: ['app', 'framework', 'hub'], labels: { app: "The app's assets", framework: 'Framework assets', hub: 'axHub shared data' }, default: 'app', level: 'developer' }),
  field('output.idPrefix', 'Id prefix', 'text', { default: '', level: 'developer' }),
  field('output.register', 'Register in the UI registry', 'toggle', { default: true, level: 'developer' }),
  field('output.version', 'Version on save', 'choice', { options: ['patch', 'minor', 'keep'], default: 'patch', level: 'developer' }),
  field('voice', 'Voice control', 'toggle', { default: true, level: 'simple' }),
  field('autosave', 'Autosave', 'toggle', { default: true, level: 'simple' }),
]);
export const DESIGNER_FIELD_GROUPS = ['canvas', 'panels', 'preview', 'info', 'context', 'history', 'output', 'voice', 'autosave'];
export const DESIGNER_PANELS = ['library', 'layers', 'inspector', 'preview', 'help', 'history'];
export const DESIGNER_PANEL_SIDES = ['left', 'right', 'bottom', 'float', 'hidden'];

const getPath = (o, path) => path.split('.').reduce((v, k) => (isObj(v) ? v[k] : undefined), o);
const setPath = (o, path, v) => { const ks = path.split('.'); let cur = o; for (const k of ks.slice(0, -1)) { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k]; } cur[ks.at(-1)] = v; };
const fieldOk = (f, v) => (f.kind === 'toggle' ? typeof v === 'boolean' : f.kind === 'number' ? typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max : f.kind === 'choice' ? f.options.includes(v) : typeof v === 'string' && v.length <= 80);

/** The designer interface with every field filled (defaults for what the asset leaves out; bad values fall back). `for` and `extends` pass through. */
export function normalizeDesigner(raw) {
  const d = isObj(raw) ? raw : {};
  const out = {};
  for (const f of DESIGNER_FIELDS) { const v = getPath(d, f.key); setPath(out, f.key, fieldOk(f, v) ? v : f.default); }
  const forV = str(d.for, 48); if (forV) out.for = forV;
  const ext = str(d.extends, 48); if (ext) out.extends = ext;
  return out;
}
/** The default designer interface (what `designer/default` carries). */
export const DESIGNER_DEFAULT = Object.freeze(normalizeDesigner({}));

/** What is wrong with a designer asset's data; [] when nothing. Only fields the asset sets are judged. */
export function designerInterfaceErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  for (const f of DESIGNER_FIELDS) {
    const v = getPath(raw, f.key);
    if (v === undefined) continue;
    if (!fieldOk(f, v)) e.push(`data.${f.key}: ${f.kind === 'choice' ? `one of ${f.options.join(', ')}` : f.kind === 'number' ? `a number ${f.min}–${f.max}` : f.kind === 'toggle' ? 'true or false' : 'text up to 80 characters'}`);
  }
  for (const g of DESIGNER_FIELD_GROUPS) if (raw[g] !== undefined && typeof DESIGNER_FIELDS.find((f) => f.key === g) === 'undefined' && !isObj(raw[g])) e.push(`data.${g}: must be an object`);
  if (raw.for !== undefined && !(raw.for === 'host' || SLUG.test(String(raw.for)))) e.push('data.for: the add-on id this interface is for, or host');
  if (raw.extends !== undefined && (typeof raw.extends !== 'string' || !ASSET_ID.test(raw.extends))) e.push('data.extends: a designer asset id');
  return e;
}
/** inherit@1 folding for designer assets (the same rules as chrome settings: child fields win, objects merge key by key, depth ≤ 4). */
export const resolveDesignerChain = (get, id) => { const d = resolveSettingsChain(get, id); return d ? normalizeDesigner(d) : null; };
/** The designer interface in force for an add-on: its own copy when the library has it, else the shared default. */
export function designerInterfacePick(addonId, ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (addonId && list.includes(addonId)) return addonId;
  return list.includes(DESIGNER_DEFAULT_ID) ? DESIGNER_DEFAULT_ID : null;
}
/** An add-on's copy of the shared designer interface: the same data plus `for` and `extends`, so it follows the default until edited. */
export function designerCopy(defaultAsset, a) {
  if (!isObj(defaultAsset) || !isObj(defaultAsset.data)) throw new Error('designerCopy: the shared designer interface asset is needed');
  return {
    $axf: 'asset@1', type: DESIGNER_TYPE, id: a.interface ?? a.id, name: `${a.label} interface`, version: '1.0.0',
    description: `The ${a.label.toLowerCase()}'s own copy of the shared designer interface (${defaultAsset.id}): canvas, panels, preview, info, context menu, history, output and voice. It follows the default until edited (designer@1).`,
    author: 'AmberX AXF', tags: ['designer', a.id],
    data: { ...structuredClone(defaultAsset.data), for: a.id, extends: defaultAsset.id },
  };
}
/** The settings interface an add-on (or the host) renders its Settings through: a `settings` asset with `for` = designer:<addon>, extending the host's. */
export function designerSettingsCopy(hostSettings, a) {
  if (!isObj(hostSettings) || !isObj(hostSettings.data)) throw new Error('designerSettingsCopy: the host settings interface asset is needed');
  return {
    $axf: 'asset@1', type: 'settings', id: a.settings ?? designerSettingsId(a.id), name: `${a.label} settings`, version: '1.0.0',
    description: `The ${a.label.toLowerCase()}'s settings interface (designer@1): its own copy of the UI asset designer's settings interface (${hostSettings.id}), following it until edited. Reached from the add-on's Settings → Plugins tab, the host's add-on list and the right-click menu of its designer.`,
    author: 'AmberX AXF', tags: ['designer', 'settings-interface', a.id],
    data: { ...structuredClone(hostSettings.data), for: designerSettingsFor(a.id), extends: hostSettings.id },
  };
}
/** What is wrong with a settings asset that is a designer's settings interface (`for` designer / designer:<addon>); [] when nothing or not one. */
export function designerSettingsErrors(asset) {
  const d = isObj(asset) && isObj(asset.data) ? asset.data : null;
  if (!d || typeof d.for !== 'string' || !d.for.startsWith('designer')) return [];
  const e = [];
  if (!DESIGNER_SETTINGS_FOR.test(d.for)) e.push('data.for: designer or designer:<addon id>');
  const want = designerSettingsId(d.for.split(':')[1] ?? 'host');
  if (asset.id !== want) e.push(`id: a settings interface for ${d.for} is named ${want}`);
  if (d.for !== 'designer' && d.extends !== DESIGNER_SETTINGS_ID) e.push(`data.extends: an add-on's settings interface extends ${DESIGNER_SETTINGS_ID}`);
  if (d.for === 'designer' && d.extends !== undefined) e.push('data.extends: the host settings interface extends nothing');
  return e;
}
/** Every (add-on, designer copy id, settings copy id) the framework must ship. */
export const designerPlan = (addons = DESIGNER_ADDONS) => addons.map((a) => ({ addon: a.id, interfaceId: a.interface, settingsId: a.settings }));
/** What is missing from a library of ids: the shared default, the host settings interface, every add-on's two copies. */
export function designerMissing(designerIds, settingsIds, addons = DESIGNER_ADDONS) {
  const d = new Set(Array.isArray(designerIds) ? designerIds : []), s = new Set(Array.isArray(settingsIds) ? settingsIds : []);
  const missing = [];
  if (!d.has(DESIGNER_DEFAULT_ID)) missing.push(`designer/${DESIGNER_DEFAULT_ID}`);
  if (!s.has(DESIGNER_SETTINGS_ID)) missing.push(`settings/${DESIGNER_SETTINGS_ID}`);
  for (const a of addons) { if (!d.has(a.interface)) missing.push(`designer/${a.interface}`); if (!s.has(a.settings)) missing.push(`settings/${a.settings}`); }
  return missing;
}

/* ================================================================== the embed asset type (embed-asset@1) */

export const EMBED_TARGET_KINDS = ['ui', 'plugin', 'command', 'url', 'asset'];
export const EMBED_HOSTS = ['toolbar', 'tab-group', 'grid-row', 'banner', 'region', 'dialog'];
export const EMBED_LOADS = ['live', 'lazy', 'snapshot'];
export const EMBED_EXPANDS = ['inline', 'side', 'popout'];
export const EMBED_SIZE_MAX = 4096;
const HTTPS = /^https:\/\/[^\s"'<>]+$/i;
const REL_JSON = /^(\.{0,2}\/|\/)?[A-Za-z0-9._/-]+\.json$/;
const UI_ID = /^[a-z][a-z-]*:[^\s"'<>]{1,200}$/;
const PLUGIN_VIEW = /^[a-z0-9][a-z0-9-]{0,59}(\/[a-z0-9][a-z0-9._-]{0,79})?$/;
const COMMAND = /^[a-z][a-z0-9._-]*(:[^\s<>"'`]{0,160})?$/;
const ASSET_REF = /^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]{1,47}$/;
const sizeOk = (v) => v === 'auto' || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= EMBED_SIZE_MAX);

/** An embed asset's data, cleaned and filled: bad fields fall back, unknown ones are dropped. Null when it has no usable target. */
export function normalizeEmbed(raw) {
  const d = isObj(raw) ? raw : {};
  const t = isObj(d.target) ? d.target : {};
  const kind = EMBED_TARGET_KINDS.includes(t.kind) ? t.kind : t.url ? 'url' : t.id ? 'ui' : '';
  if (!kind) return null;
  const target = { kind };
  if (kind === 'url') { if (!HTTPS.test(str(t.url, 2000))) return null; target.url = str(t.url, 2000); }
  else { const id = str(t.id, 240); if (!id) return null; target.id = id; }
  if (isObj(t.params)) target.params = structuredClone(t.params);
  const out = { target, label: str(d.label, 80) || target.id || target.url, icon: str(d.icon, 40) || 'box' };
  const manifest = str(d.manifest, 2000); if (manifest && (HTTPS.test(manifest) || REL_JSON.test(manifest))) out.manifest = manifest;
  const s = isObj(d.size) ? d.size : {};
  out.size = { width: sizeOk(s.width) ? s.width : 'auto', height: sizeOk(s.height) ? s.height : 'auto' };
  if (sizeOk(s.minHeight) && s.minHeight !== 'auto') out.size.minHeight = s.minHeight;
  if (sizeOk(s.maxHeight) && s.maxHeight !== 'auto') out.size.maxHeight = s.maxHeight;
  const hosts = strList(d.hosts, 12, 20).filter((h) => EMBED_HOSTS.includes(h)); out.hosts = hosts.length ? hosts : [...EMBED_HOSTS];
  out.load = EMBED_LOADS.includes(d.load) ? d.load : 'live';
  out.sandbox = typeof d.sandbox === 'boolean' ? d.sandbox : kind === 'url';
  out.expand = EMBED_EXPANDS.includes(d.expand) ? d.expand : 'inline';
  out.passData = d.passData === true;
  out.remember = d.remember !== false;
  if (kind === 'url') out.sandbox = true; // a web page never gets the console token or the host's storage
  return out;
}
/** What is wrong with an embed asset's data; [] when nothing. */
export function embedAssetErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  const t = raw.target;
  if (!isObj(t)) e.push('data.target: { kind: ui | plugin | command | url | asset, id? | url?, params? }');
  else {
    if (!EMBED_TARGET_KINDS.includes(t.kind)) e.push(`data.target.kind: one of ${EMBED_TARGET_KINDS.join(', ')}`);
    if (t.kind === 'url') { if (typeof t.url !== 'string' || !HTTPS.test(t.url)) e.push('data.target.url: an https:// address (no other scheme)'); }
    else if (typeof t.id !== 'string' || !t.id.trim()) e.push('data.target.id: the registered UI id (<kind>:<key>), plugin view, command or asset ref');
    else if (t.kind === 'ui' && !UI_ID.test(t.id)) e.push('data.target.id: a ui-registry@1 id like screen:plan-studio');
    else if (t.kind === 'plugin' && !PLUGIN_VIEW.test(t.id)) e.push('data.target.id: <plugin folder>[/<view>]');
    else if (t.kind === 'command' && !COMMAND.test(t.id)) e.push('data.target.id: an action spec like plan.new or console.open:builds');
    else if (t.kind === 'asset' && !ASSET_REF.test(t.id)) e.push('data.target.id: an asset ref <type>/<id>');
    if (t.params !== undefined && !isObj(t.params)) e.push('data.target.params: an object');
  }
  if (raw.manifest !== undefined && (typeof raw.manifest !== 'string' || !(HTTPS.test(raw.manifest) || REL_JSON.test(raw.manifest)))) e.push('data.manifest: an https:// address or a .json path');
  if (raw.size !== undefined) { if (!isObj(raw.size)) e.push('data.size: { width, height }'); else for (const k of ['width', 'height', 'minHeight', 'maxHeight']) if (raw.size[k] !== undefined && !sizeOk(raw.size[k])) e.push(`data.size.${k}: auto or a number 0–${EMBED_SIZE_MAX}`); }
  if (raw.hosts !== undefined) { if (!Array.isArray(raw.hosts)) e.push('data.hosts: a list'); else for (const h of raw.hosts) if (!EMBED_HOSTS.includes(h)) e.push(`data.hosts: unknown host "${h}" (${EMBED_HOSTS.join(', ')})`); }
  if (raw.load !== undefined && !EMBED_LOADS.includes(raw.load)) e.push(`data.load: ${EMBED_LOADS.join(' | ')}`);
  if (raw.expand !== undefined && !EMBED_EXPANDS.includes(raw.expand)) e.push(`data.expand: ${EMBED_EXPANDS.join(' | ')}`);
  for (const k of ['sandbox', 'passData', 'remember']) if (raw[k] !== undefined && typeof raw[k] !== 'boolean') e.push(`data.${k}: true or false`);
  if (isObj(t) && t.kind === 'url' && raw.sandbox === false) e.push('data.sandbox: a web page is always sandboxed');
  return e;
}

/** ONE validator for the two types, shared by core/validate.ts and the build engine; other types get []. */
export function designerErrors(type, data) {
  if (type === DESIGNER_TYPE) return designerInterfaceErrors(data);
  if (type === EMBED_TYPE) return embedAssetErrors(data);
  return [];
}
/** JSON Schema `properties` for the two types (the build engine's writeSchemas). */
export function designerSchemaProperties(type) {
  if (type === DESIGNER_TYPE) {
    const props = { for: { type: 'string' }, extends: { type: 'string', pattern: ASSET_ID_PATTERN } };
    for (const f of DESIGNER_FIELDS) {
      const [g, k] = f.key.split('.');
      const s = f.kind === 'toggle' ? { type: 'boolean', default: f.default } : f.kind === 'number' ? { type: 'number', minimum: f.min, maximum: f.max, default: f.default } : f.kind === 'choice' ? { enum: f.options, default: f.default } : { type: 'string', maxLength: 80, default: f.default };
      if (!k) { props[g] = { ...s, description: f.label }; continue; }
      props[g] ??= { type: 'object', properties: {} };
      props[g].properties[k] = { ...s, description: f.label };
    }
    return props;
  }
  if (type === EMBED_TYPE) return {
    target: { type: 'object', required: ['kind'], properties: { kind: { enum: EMBED_TARGET_KINDS }, id: { type: 'string' }, url: { type: 'string', pattern: '^https://' }, params: { type: 'object' } } },
    manifest: { type: 'string', description: 'a link to a JSON manifest with the configuration (https:// or a .json path)' },
    label: { type: 'string', maxLength: 80 }, icon: { type: 'string' },
    size: { type: 'object', properties: Object.fromEntries(['width', 'height', 'minHeight', 'maxHeight'].map((k) => [k, { oneOf: [{ const: 'auto' }, { type: 'number', minimum: 0, maximum: EMBED_SIZE_MAX }] }])) },
    hosts: { type: 'array', items: { enum: EMBED_HOSTS } }, load: { enum: EMBED_LOADS }, expand: { enum: EMBED_EXPANDS },
    sandbox: { type: 'boolean' }, passData: { type: 'boolean' }, remember: { type: 'boolean' },
  };
  return {};
}

/* ================================================================== designed@1: the manifest + identifier of a designed asset */

export const assetRef = (type, id) => `${type}/${id}`;
/** `<type>/<id>` → { type, id }, or null. */
export function parseAssetRef(ref) {
  const m = /^([a-z][a-z0-9-]*)\/([a-z0-9][a-z0-9-]{1,47})$/.exec(String(ref ?? ''));
  return m ? { type: m[1], id: m[2] } : null;
}
/** FNV-1a (32-bit) of the canonical JSON of a value: stable across runs and ports, no crypto. */
export function designedHash(value) {
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
  let h = 0x811c9dc5;
  for (const ch of canon(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** A uid for a designed asset: `dz-` + time (base 36) + 6 random base-36 digits; pass `rand` (0..1) for a fixed one. */
export function designedUid(now, rand = Math.random()) {
  const t = Number.isFinite(now) ? now : Date.now();
  const r = Math.floor(Math.max(0, Math.min(0.999999, rand)) * 36 ** 6).toString(36).padStart(6, '0');
  return `dz-${t.toString(36)}${r}`;
}
export const DESIGNED_UID = /^dz-[0-9a-z]{6,20}$/;
const bump = (v, how) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '')); if (!m) return '1.0.0'; if (how === 'keep') return m[0]; return how === 'minor' ? `${m[1]}.${+m[2] + 1}.0` : `${m[1]}.${m[2]}.${+m[3] + 1}`; };

/**
 * The manifest of a designed asset. `previous` (its last manifest) keeps uid, createdAt and origin and bumps the
 * revision; without it this is the first revision. `now` is an ISO time; `app` the app it is saved into; `output`
 * the designer interface's output block (version bump, register).
 */
export function makeDesigned({ asset, addon, app = '', by = '', now, uid, previous = null, origin = null, aliases = [], extras = {}, output = DESIGNER_DEFAULT.output } = {}) {
  if (!isObj(asset) || typeof asset.type !== 'string' || typeof asset.id !== 'string') throw new Error('makeDesigned: an asset with type and id is needed');
  const at = str(now, 40) || new Date(0).toISOString();
  const prev = isObj(previous) && previous.$axf === DESIGNED_FRAME ? previous : null;
  const a = isObj(addon) ? addon : { id: str(addon, 40) || 'host' };
  const kind = designedUiKind(asset.type);
  const ref = assetRef(asset.type, asset.id);
  const name = str(asset.name, 120) || asset.id;
  const m = {
    $axf: DESIGNED_FRAME,
    uid: prev?.uid && DESIGNED_UID.test(prev.uid) ? prev.uid : DESIGNED_UID.test(str(uid, 30)) ? str(uid, 30) : designedUid(Date.parse(at) || 0, 0),
    ref, type: asset.type, id: asset.id, name,
    version: prev ? bump(asset.version ?? prev.version, output?.version ?? 'patch') : (/^\d+\.\d+\.\d+$/.test(str(asset.version, 20)) ? asset.version : '1.0.0'),
    addon: a.id, designer: DESIGNER_CONTRACT,
    createdAt: prev?.createdAt || at, updatedAt: at, revision: Math.min(DESIGNER_LIMITS.revision, (Number.isInteger(prev?.revision) ? prev.revision : 0) + 1),
    registry: { kind, id: `${kind}:${ref}`, aliases: strList([asset.id, ...(Array.isArray(aliases) ? aliases : []), ...(prev?.registry?.aliases ?? [])], DESIGNER_LIMITS.aliases, DESIGNER_LIMITS.alias) },
    hash: designedHash(asset.data ?? {}),
  };
  const appId = str(app ?? prev?.app, 63); if (appId) m.app = appId;
  const who = str(by ?? prev?.by, 80); if (who) m.by = who;
  const o = isObj(origin) ? origin : prev?.origin; if (isObj(o) && (o.said || o.source)) m.origin = { ...(str(o.said, 2000) ? { said: str(o.said, 2000) } : {}), ...(str(o.source, 20) ? { source: str(o.source, 20) } : {}), ...(str(o.at, 40) ? { at: str(o.at, 40) } : {}) };
  const ex = isObj(extras) ? Object.fromEntries(Object.entries(extras).filter(([k, v]) => /^[a-z][a-zA-Z0-9]{0,39}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v) || Array.isArray(v)).slice(0, DESIGNER_LIMITS.extras)) : {};
  if (Object.keys(ex).length) m.extras = ex;
  return m;
}
/** The asset with its manifest in the envelope (`designed`), name and version taken from the manifest. */
export const withDesigned = (asset, manifest) => ({ ...asset, version: manifest.version, designed: manifest });
/** The manifest an asset carries, or null (a hand-written asset has none). */
export const designedOf = (asset) => (isObj(asset) && isObj(asset.designed) && asset.designed.$axf === DESIGNED_FRAME ? asset.designed : null);
/** What is wrong with a designed@1 block (the envelope's `designed`), checked against its asset when one is given; [] when nothing. */
export function designedErrors(raw, asset = null) {
  const e = [];
  if (!isObj(raw)) return ['designed: must be an object'];
  if (raw.$axf !== DESIGNED_FRAME) e.push(`designed.$axf must be ${DESIGNED_FRAME}`);
  if (!DESIGNED_UID.test(String(raw.uid))) e.push('designed.uid: dz-<base36> (the identifier never changes)');
  const ref = parseAssetRef(raw.ref);
  if (!ref) e.push('designed.ref: <type>/<id>');
  else if (isObj(asset) && (asset.type !== ref.type || asset.id !== ref.id)) e.push(`designed.ref: ${raw.ref} is not this asset (${asset.type}/${asset.id})`);
  if (raw.type !== undefined && ref && raw.type !== ref.type) e.push('designed.type: must match ref');
  if (raw.id !== undefined && ref && raw.id !== ref.id) e.push('designed.id: must match ref');
  if (!SLUG.test(String(raw.addon))) e.push('designed.addon: the add-on id (a slug)');
  if (raw.designer !== DESIGNER_CONTRACT) e.push(`designed.designer must be ${DESIGNER_CONTRACT}`);
  for (const k of ['createdAt', 'updatedAt']) if (typeof raw[k] !== 'string' || Number.isNaN(Date.parse(raw[k]))) e.push(`designed.${k}: an ISO time`);
  if (!Number.isInteger(raw.revision) || raw.revision < 1) e.push('designed.revision: an integer from 1');
  if (!isObj(raw.registry) || typeof raw.registry.id !== 'string' || !/^[a-z-]+:[a-z][a-z0-9-]*\/[a-z0-9-]+$/.test(raw.registry.id)) e.push('designed.registry: { kind, id: <kind>:<type>/<id>, aliases }');
  else if (ref && raw.registry.id !== `${raw.registry.kind}:${ref.type}/${ref.id}`) e.push('designed.registry.id: <kind>:<ref>');
  if (typeof raw.hash !== 'string' || !/^[0-9a-f]{8}$/.test(raw.hash)) e.push('designed.hash: 8 hex digits');
  else if (isObj(asset) && isObj(asset.data) && designedHash(asset.data) !== raw.hash) e.push('designed.hash: the asset data changed since it was designed (save it through its designer)');
  if (raw.extras !== undefined && !isObj(raw.extras)) e.push('designed.extras: an object');
  if (raw.origin !== undefined && !isObj(raw.origin)) e.push('designed.origin: { said?, source?, at? }');
  return e;
}

/** The ui-registry@1 item a designed asset registers as: opens in its designer (`designer.open:<ref>`), owned by the host plugin, declared so it survives regeneration. */
export function designedRegistryItem(manifest, opts = {}) {
  if (!isObj(manifest) || !parseAssetRef(manifest.ref)) return null;
  const typeLabel = assetTypeLabel(manifest.type);
  const item = {
    id: manifest.registry?.id ?? `${designedUiKind(manifest.type)}:${manifest.ref}`, kind: manifest.registry?.kind ?? designedUiKind(manifest.type),
    label: manifest.name, aliases: strList([manifest.id, `${manifest.name} ${typeLabel.toLowerCase()}`, ...(manifest.registry?.aliases ?? [])].filter((a) => a !== manifest.name), DESIGNER_LIMITS.aliases, DESIGNER_LIMITS.alias),
    owner: `plugin:${opts.ownerFolder ?? DESIGNER_HOST_FOLDER}`, source: 'declared',
    open: { via: 'action', action: `designer.open:${manifest.ref}` },
    detail: `${typeLabel} designed with the ${manifest.addon} designer (revision ${manifest.revision})`, icon: assetTypeIcon(manifest.type),
    keywords: [manifest.type, 'designed', manifest.addon], effect: 'navigate',
  };
  if (manifest.app) item.app = manifest.app;
  return item;
}
/** Its row in the designer library index (designer-library@1). */
export const designedLibraryEntry = (manifest, path = '') => ({ uid: manifest.uid, ref: manifest.ref, type: manifest.type, id: manifest.id, name: manifest.name, addon: manifest.addon, revision: manifest.revision, updatedAt: manifest.updatedAt, ...(manifest.app ? { app: manifest.app } : {}), path: path || designedLibraryPath(manifest) });
/** Where a designed asset is saved: the app's assets, the framework's starters, or the hub's shared data. */
export function designedLibraryPath(manifest, to = 'app', app = '') {
  const file = `${manifest.type}/${manifest.id}.json`;
  if (to === 'framework') return `framework/assets/${file}`;
  if (to === 'hub') return `_data/assets/${file}`;
  return `${app ? `apps/${app}/` : ''}src/assets/${file}`;
}
/** A library index, cleaned (one row per uid, newest update wins). */
export function normalizeDesignerLibrary(raw) {
  const rows = new Map();
  for (const r of Array.isArray(raw?.items) ? raw.items : []) {
    if (!isObj(r) || !DESIGNED_UID.test(String(r.uid)) || !parseAssetRef(r.ref)) continue;
    const prev = rows.get(r.uid);
    if (!prev || String(r.updatedAt) > String(prev.updatedAt)) rows.set(r.uid, { uid: r.uid, ref: r.ref, type: str(r.type, 40) || r.ref.split('/')[0], id: str(r.id, 48) || r.ref.split('/')[1], name: str(r.name, 120) || r.id, addon: slug(r.addon) || 'host', revision: Number.isInteger(r.revision) ? r.revision : 1, updatedAt: str(r.updatedAt, 40), ...(str(r.app, 63) ? { app: str(r.app, 63) } : {}), path: str(r.path, 300) });
  }
  return { $axf: DESIGNER_LIBRARY_FRAME, items: [...rows.values()].sort((a, b) => a.ref.localeCompare(b.ref)) };
}
/** The library with one entry added or replaced (by uid; a rename keeps the row and changes its ref). */
export function upsertDesignerLibrary(lib, entry) {
  const l = normalizeDesignerLibrary(lib);
  return normalizeDesignerLibrary({ items: [...l.items.filter((r) => r.uid !== entry.uid), entry] });
}
/** What is wrong with the id a person picked for a new designed asset: pattern, prefix rule, clashes with built-ins or existing ids. */
export function designedIdErrors(id, { existing = [], builtin = [], prefix = '' } = {}) {
  const e = [];
  if (!ASSET_ID.test(String(id))) e.push(`id must match ${ASSET_ID_PATTERN}`);
  if (prefix && !String(id).startsWith(prefix)) e.push(`id must start with ${prefix}`);
  if (builtin.includes(id)) e.push(`${id} is a built-in asset: pick another id (built-ins are never overwritten)`);
  else if (existing.includes(id)) e.push(`${id} exists already: pick another id or open that one`);
  return e;
}
/** An id for a new asset from its name: slug + prefix, de-duplicated against `existing` (-2, -3, …). */
export function suggestAssetId(name, { existing = [], prefix = '' } = {}) {
  const base = `${prefix}${slug(name) || 'asset'}`.slice(0, 44).replace(/-+$/, '') || 'asset';
  let id = base.length < 2 ? `${base}-1` : base; let n = 2;
  while (existing.includes(id)) id = `${base}-${n++}`;
  return id;
}

/* ================================================================== asset-context@1: the context-menu section every UI asset gets */

export const ASSET_INFO_MODES = ['tooltip', 'hover-card', 'side-panel', 'help-text', 'say'];
/** Settings keys: the section on / off per device, and the info modes in force. */
export const ASSET_CONTEXT_KEYS = Object.freeze({ on: 'axf.asset-context.on', preview: 'axf.asset-context.preview', info: 'axf.asset-context.info', perType: (t) => `axf.asset-context.${t}` });
/** The actions the section dispatches (console-visible, so Amber drives them by voice). */
export const ASSET_CONTEXT_ACTIONS = Object.freeze({ preview: 'asset.preview', about: 'asset.about', copyId: 'asset.copyId', usage: 'asset.usage', help: 'help.explain', edit: 'designer.open', change: 'chrome.pick' });
export const DESIGNER_ACTIONS = Object.freeze({ open: 'designer.open', new: 'designer.new', preview: 'designer.preview', save: 'designer.save', publish: 'designer.publish' });
/** The help@1 id of an asset's help entry. */
export const assetHelpId = (ref) => `asset:${ref}`;

const count = (v) => (Array.isArray(v) ? v.length : 0);
const deepItems = (items) => (Array.isArray(items) ? items.reduce((n, it) => n + (it?.separator ? 0 : 1) + deepItems(it?.items), 0) : 0);
/** One line about what an asset holds, per type. */
export function assetSummary(asset) {
  if (!isObj(asset) || !isObj(asset.data)) return '';
  const d = asset.data;
  switch (asset.type) {
    case 'toolbar': { const items = (d.groups ?? []).reduce((n, g) => n + count(g?.items), 0); return `${items} button${items === 1 ? '' : 's'} in ${count(d.groups)} group${count(d.groups) === 1 ? '' : 's'}${count(d.widgets) ? `, ${count(d.widgets)} widget${count(d.widgets) === 1 ? '' : 's'}` : ''}${d.showSearch ? ', search' : ''}`; }
    case 'banner': return `${count(d.attach)} attached, ${d.height ?? ''}px ${d.surface ?? ''}`.trim();
    case 'nav-menu': { const items = (d.sections ?? []).reduce((n, s) => n + deepItems(s?.items), 0); return `${items} item${items === 1 ? '' : 's'} in ${count(d.sections)} section${count(d.sections) === 1 ? '' : 's'}, ${d.style ?? ''}`.trim(); }
    case 'app-menu': { const items = (d.menus ?? []).reduce((n, m) => n + deepItems(m?.items), 0); return `${count(d.menus)} menu${count(d.menus) === 1 ? '' : 's'}, ${items} item${items === 1 ? '' : 's'}`; }
    case 'context-menu': { const targets = isObj(d.targets) ? Object.keys(d.targets) : []; const items = targets.reduce((n, t) => n + deepItems(d.targets[t]), 0); return `${targets.length} target${targets.length === 1 ? '' : 's'}, ${items} item${items === 1 ? '' : 's'}, ${d.variant ?? ''}`.trim(); }
    case 'tab-group': return `${d.style ?? ''} tabs, ${d.position ?? 'top'}`.trim();
    case EMBED_TYPE: return d.target ? `${d.target.kind}: ${d.target.id ?? d.target.url ?? ''}` : '';
    case 'dialog': return `${d.variant ?? ''} dialog`.trim();
    case 'popup': return `${d.variant ?? ''} pop-up at ${d.position ?? ''}`.trim();
    default: return `${assetTypeLabel(asset.type).toLowerCase()}`;
  }
}

/**
 * The same facts in every mode: tooltip (one line), hover-card (title, subtitle, lines, preview ref), side-panel
 * (sections of rows), help-text (a help@1 entry), say (a spoken sentence).
 */
export function assetInfo(asset, mode, ctx = {}) {
  if (!isObj(asset)) return null;
  const ref = assetRef(asset.type, asset.id);
  const typeLabel = assetTypeLabel(asset.type);
  const m = designedOf(asset) ?? ctx.manifest ?? null;
  const summary = assetSummary(asset);
  const usedIn = strList(ctx.usedIn, 24, 120);
  const tooltip = `${typeLabel} · ${asset.name}${summary ? ` · ${summary}` : ''}`;
  switch (mode) {
    case 'tooltip': return tooltip;
    case 'hover-card': return { title: asset.name, subtitle: `${typeLabel} · ${ref}`, lines: [summary, m ? `Designed with the ${m.addon} designer · revision ${m.revision}` : 'Built in', asset.description ? str(asset.description, 160) : ''].filter(Boolean), preview: ref };
    case 'side-panel': return {
      title: asset.name, sections: [
        { label: 'Identity', rows: [['Type', typeLabel], ['Id', asset.id], ['Ref', ref], ['Version', asset.version ?? ''], ...(m ? [['Identifier', m.uid]] : [])] },
        { label: 'Contents', rows: [['Summary', summary], ...(asset.description ? [['Description', asset.description]] : []), ...(Array.isArray(asset.tags) && asset.tags.length ? [['Tags', asset.tags.join(', ')]] : [])] },
        ...(m ? [{ label: 'Designed', rows: [['Designer', `${m.addon} designer`], ['Revision', String(m.revision)], ['Created', m.createdAt], ['Updated', m.updatedAt], ...(m.by ? [['By', m.by]] : []), ...(m.origin?.said ? [['Brett said', m.origin.said]] : []), ['Registered as', m.registry.id]] }] : []),
        { label: 'Where it is used', rows: usedIn.length ? usedIn.map((u, i) => [String(i + 1), u]) : [['—', 'Not placed anywhere yet']] },
      ],
    };
    case 'help-text': return { id: assetHelpId(ref), kind: HELP_KIND_OF[asset.type] ?? 'control', title: asset.name, text: `${typeLabel}: ${summary || asset.name}. Right-click it for a preview, its settings and its designer.`, more: [asset.description, m ? `Designed with the ${m.addon} designer, revision ${m.revision}.` : '', usedIn.length ? `Used in: ${usedIn.join(', ')}.` : ''].filter(Boolean).join(' ') };
    case 'say': return `${asset.name} is a ${typeLabel.toLowerCase()}${summary ? ` with ${summary}` : ''}${m ? `, designed with the ${m.addon} designer` : ''}.`;
    default: return null;
  }
}
const HELP_KIND_OF = { toolbar: 'control', banner: 'banner', 'nav-menu': 'nav', 'app-menu': 'menu', 'context-menu': 'menu', 'tab-group': 'tab', dialog: 'control', popup: 'control', button: 'button', slider: 'slider', link: 'link' };

/**
 * The context-menu section of a UI asset (asset-context@1). `opts`: `addon` (the add-on that designs the type, so
 * Edit shows), `interface` (the designer interface in force: which entries are on), `isChrome` (a chrome kind: the
 * shared chrome block already has Settings / Change / Move, so Change is left out here), `usedIn`, `manifest`.
 * Entries carry `tip` (the tooltip) and the Preview entry `preview` = the asset ref (the menu shows a live miniature
 * on hover); every action is an id Amber can run by voice.
 */
export function assetContextSection(asset, opts = {}) {
  if (!isObj(asset) || !isUiAssetType(asset.type)) return [];
  const ref = assetRef(asset.type, asset.id);
  const ui = normalizeDesigner(opts.interface ?? {});
  const typeLabel = assetTypeLabel(asset.type);
  const tip = ui.info.tooltip ? assetInfo(asset, 'tooltip', opts) : undefined;
  const items = [{ id: 'asset-head', label: `${typeLabel}: ${asset.name}`, icon: assetTypeIcon(asset.type), action: `${ASSET_CONTEXT_ACTIONS.about}:${ref}`, ...(tip ? { tip } : {}) }];
  if (ui.context.preview) items.push({ id: 'asset-preview', label: 'Preview', icon: 'eye', action: `${ASSET_CONTEXT_ACTIONS.preview}:${ref}`, preview: ref, tip: 'Hover for a live miniature; tap to open it in a floating preview' });
  if (ui.info.hoverCard || ui.info.sidePanel) items.push({ id: 'asset-about', label: 'About…', icon: 'info', action: `${ASSET_CONTEXT_ACTIONS.about}:${ref}`, tip: 'Identity, contents, who designed it and where it is used' });
  if (ui.context.help && ui.info.helpText) items.push({ id: 'asset-help', label: 'Help', icon: 'help', action: `${ASSET_CONTEXT_ACTIONS.help}:${assetHelpId(ref)}` });
  const a = opts.addon ?? null;
  if (a) items.push({ id: 'asset-edit', label: `Edit in ${a.label}…`, icon: 'edit', action: `${ASSET_CONTEXT_ACTIONS.edit}:${ref}`, tip: `Open ${asset.name} in the ${a.label.toLowerCase()}` });
  if (!opts.isChrome && CHROME_TYPES.includes(asset.type)) items.push({ id: 'asset-change', label: `Change ${typeLabel.toLowerCase()}…`, icon: 'layers', action: `${ASSET_CONTEXT_ACTIONS.change}:${asset.type}` });
  items.push({ id: 'asset-copy-id', label: 'Copy id', icon: 'copy', action: `${ASSET_CONTEXT_ACTIONS.copyId}:${ref}`, tip: ref });
  items.push({ id: 'asset-usage', label: 'Where it is used', icon: 'search', action: `${ASSET_CONTEXT_ACTIONS.usage}:${ref}`, tip: strList(opts.usedIn, 24, 120).join(', ') || 'Not placed anywhere yet' });
  items.push({ id: 'asset-sep', separator: true });
  return items;
}
/** The asset an element stands for: its `data-axf-asset` attribute (`<type>/<id>`), parsed. Pure: pass the attribute value. */
export const assetRefFromAttr = (value) => parseAssetRef(value);
