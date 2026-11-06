/**
 * ui-registry rules — ui-registry@1 (Brett, Nov 6 2026, build ui-registry-shortcuts: "All the UIs need to be in a
 * registry. Every single dialog, pop-up, settings interface, main plugin screen, every UI element has to be an asset …
 * from a button to a pop-up to a link to a menu to a menu entry … That needs to be visible to the API. Create a
 * registry so I can open them with my voice.").
 *
 * ONE registry of every piece of UI an app (and every plugin in it) has: screens, dialogs, pop-ups, settings interfaces
 * and single settings, menus and menu entries, navigation items, toolbars and their buttons, page buttons and links, tab
 * groups and tabs, banners, widgets, actions, windows, cards. Each item has a stable id (`<kind>:<key>`), a kind, the
 * app and owner (the app itself, a plugin, a library, the framework), a label, aliases (what a person may call it), and
 * exactly one way to open it (`open`). The registry is an asset in the asset@1 envelope, one per app
 * (`src/assets/ui-registry/<app>.json`), so it is visible to the API, the MCP server and the CLI like every other asset,
 * and a plugin declares its own items in `ui-registry.json` beside its plugin.json.
 *
 * Where items come from (all merged, `mergeUiItems`, first source wins a clash, aliases are unioned):
 *   declared  a plugin's ui-registry.json / an app's hand-written items (`source: declared`, kept across regeneration)
 *   authored  aliases and labels a person edited (kept across regeneration)
 *   scanned   framework/cli/ui-registry.mjs reads plugin manifests (`provides`), web/index.tsx, menus and toolbars
 *   live      what a running app reports (console-catalog@1 → `uiItemsFromConsoleCatalog`, a runtime's search index
 *             → `uiItemsFromSearchEntries`): the moment a plugin is installed its screens can be opened
 *
 * Opening (`uiOpenCommand`) never invents a transport: every item is a control@1 console command (console-commands.mjs):
 * a screen / dialog / settings tab opens through console.screens / console.dialogs / console.settings, an action runs
 * through console.actions, and anything that is an element on a page (a button, a link, a tab, a widget, a menu entry
 * without an action) runs the framework action `ui.open:<item id>` in the open app, which finds the element
 * (`data-axf-ui="<id>"`, else its help id), scrolls to it, flashes it and clicks it when the item says so.
 *
 * Reuses, never duplicates: console-command@1 for delivery, control@1 for the gate, help@1 ids for element targets,
 * voice-command@1 for the spoken form (`uiVoiceCommands` produces commands in that shape). Pure: no IO, no DOM, no
 * clock of its own. Unknown fields are dropped (open registry: later work adds kinds and open shapes here, never a new
 * type). Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { CONSOLE_KINDS, consoleActionEffect, foldWords } from './console-commands.mjs';

export const UI_REGISTRY_TYPE = 'ui-registry';
export const UI_REGISTRY_FRAME = 'ui-registry@1';
/** The attribute an element carries to name its registry item (`data-axf-ui="button:plan-studio/new-plan"`). */
export const UI_ATTR = 'data-axf-ui';
/** The framework action that opens an element item in the open app: `ui.open:<item id>` (navigate). */
export const UI_OPEN_ACTION = 'ui.open';
/** Kinds of UI (open list; the first word of every id). */
export const UI_KINDS = ['screen', 'dialog', 'popup', 'settings', 'settings-group', 'setting', 'menu', 'menu-item', 'nav-item', 'toolbar', 'button', 'link', 'tab-group', 'tab', 'banner', 'widget', 'action', 'window', 'card', 'control'];
export const UI_KIND_LABELS = {
  screen: 'Screen', dialog: 'Dialog', popup: 'Pop-up', settings: 'Settings', 'settings-group': 'Settings group', setting: 'Setting', menu: 'Menu', 'menu-item': 'Menu entry',
  'nav-item': 'Navigation item', toolbar: 'Toolbar', button: 'Button', link: 'Link', 'tab-group': 'Tab group', tab: 'Tab', banner: 'Banner', widget: 'Widget', action: 'Action',
  window: 'Window', card: 'Card', control: 'Control',
};
/** Words a person says after (or before) a name that pick the kind ("plan studio screen", "the builds menu"). */
export const UI_KIND_WORDS = {
  screen: 'screen', page: 'screen', view: 'screen', dialog: 'dialog', popup: 'popup', 'pop-up': 'popup', 'pop up': 'popup', settings: 'settings', tab: 'tab', setting: 'setting',
  menu: 'menu', entry: 'menu-item', item: 'menu-item', 'menu entry': 'menu-item', 'menu item': 'menu-item', nav: 'nav-item', navigation: 'nav-item', 'nav item': 'nav-item',
  toolbar: 'toolbar', button: 'button', link: 'link', 'tab group': 'tab-group', 'settings tab': 'settings', 'settings page': 'settings', banner: 'banner', widget: 'widget',
  action: 'action', command: 'action', window: 'window', card: 'card',
};
/** When several items share a name, the destination wins over an entry that points at it: screen before dialog before settings … before menu entries. */
export const UI_KIND_RANK = { screen: 0, dialog: 1, popup: 1, settings: 2, setting: 3, 'settings-group': 3, action: 4, window: 4, 'tab-group': 5, tab: 5, button: 6, link: 6, toolbar: 6, banner: 6, widget: 6, card: 6, menu: 7, 'menu-item': 8, 'nav-item': 8, control: 9 };
const rankOf = (item) => UI_KIND_RANK[item?.kind] ?? 9;
const byRank = (a, b) => rankOf(a) - rankOf(b);
/** How an item opens: exactly one of these shapes. */
export const UI_OPEN_VIAS = ['view', 'dialog', 'settings', 'action', 'url', 'element', 'menu'];
export const UI_SOURCES = ['declared', 'authored', 'scanned', 'live'];
/** = control@1 / plugin-commands@1 / voice-command@1 effects. */
export const UI_EFFECTS = ['navigate', 'read', 'write', 'destructive'];
export const UI_OWNERS = ['app', 'framework', 'plugin', 'library'];
export const UI_LIMITS = { items: 5000, aliases: 12, alias: 80, label: 160, id: 200, detail: 300, keywords: 12, shortcuts: 500, phrase: 120 };
/** Verbs a person puts before a name ("open the plan studio", "take me to builds"); dropped before matching. */
export const UI_OPEN_VERBS = ['open', 'show', 'show me', 'go to', 'goto', 'take me to', 'bring up', 'pull up', 'launch', 'start', 'switch to', 'jump to', 'load', 'display', 'run', 'press', 'click', 'tap', 'hit', 'toggle', 'navigate to', 'please'];
/** Spoken forms of the generic open command (voice-command@1 phrases; `{item}` is what to open). */
export const UI_VOICE_PHRASES = ['open {item}', 'show {item}', 'show me {item}', 'go to {item}', 'take me to {item}', 'bring up {item}', 'pull up {item}', 'shortcut {item}'];
export const UI_VOICE_COMMAND_ID = 'ui.open';
/** Words that name nothing on their own. */
const FILLER = new Set(['the', 'a', 'an', 'my', 'me', 'to', 'in', 'on', 'of', 'for', 'up', 'please', 'now', 'that', 'this', 'it', 'and', 'then', 'hey', 'uh', 'um']);

const ID = /^([a-z][a-z0-9-]*):([A-Za-z0-9_][A-Za-z0-9._/@:+-]{0,190})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const OWNER = /^(app|framework|plugin:[a-z0-9][a-z0-9._-]{0,62}|library:[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;
const BAD_URL = /^\s*(javascript|data|vbscript|file):/i;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const uniq = (a) => [...new Set(a)];
const strList = (v, max, each) => (Array.isArray(v) ? uniq(v.map((x) => str(x, each)).filter(Boolean)).slice(0, max) : []);

/* ================================================================== ids */

/** `<kind>:<key>` for an item (the key as given; the kind lower-case). */
export const uiId = (kind, key) => `${String(kind ?? '').toLowerCase()}:${String(key ?? '')}`;

/** { kind, key } of an id, or null when it is not one. */
export function parseUiId(id) {
  const m = ID.exec(str(id, UI_LIMITS.id + 1));
  return m ? { kind: m[1], key: m[2] } : null;
}

/** Element selector for an item: its `data-axf-ui`, then (an element item) its help id, then its `open.selector`. */
export function uiElementSelector(item) {
  const sel = [`[${UI_ATTR}="${item.id}"]`];
  if (item.help) sel.push(`[data-help="${item.help}"]`);
  if (item.open?.via === 'element' && item.open.selector) sel.push(item.open.selector);
  return sel.join(', ');
}

/* ================================================================== normalizing */

/** One `open` shape, cleaned, or null when it names nothing. Accepts the short forms ({ view }, { dialog }, { settings }, { action }, { url }, { element }, { menu }). */
export function normalizeUiOpen(raw) {
  if (!isObj(raw)) return null;
  const via = UI_OPEN_VIAS.includes(raw.via) ? raw.via : UI_OPEN_VIAS.find((k) => str(raw[k], 400) || (k === 'element' && str(raw.selector, 400)));
  if (!via) return null;
  const out = { via };
  if (via === 'view') { out.view = str(raw.view, 160); if (!out.view) return null; }
  else if (via === 'dialog') { out.dialog = str(raw.dialog, 160); if (!out.dialog) return null; const arg = str(raw.arg, 200); if (arg) out.arg = arg; }
  else if (via === 'settings') { out.tab = str(raw.settings ?? raw.tab, 160); if (!out.tab) return null; const anchor = str(raw.anchor, 200); if (anchor) out.anchor = anchor; }
  else if (via === 'action') { out.action = str(raw.action ?? raw.spec, 400); if (!out.action) return null; }
  else if (via === 'url') { out.url = str(raw.url, 2000); if (!out.url || BAD_URL.test(out.url)) return null; }
  else if (via === 'element') {
    out.selector = str(raw.selector ?? raw.element, 400); if (!out.selector) return null;
    if (raw.click === true) out.click = true;
    const view = str(raw.view, 160); if (view) out.view = view;
    const tab = str(raw.tab ?? raw.settings, 160); if (tab) out.tab = tab;
    const dialog = str(raw.dialog, 160); if (dialog) out.dialog = dialog;
  } else if (via === 'menu') { out.menu = str(raw.menu, 200); if (!out.menu) return null; }
  return out;
}

/** What running an item does: its own effect, else from its action (console-commands' policy), else navigate. */
export function uiEffect(item) {
  if (UI_EFFECTS.includes(item?.effect)) return item.effect;
  if (item?.open?.via === 'action') return consoleActionEffect({ id: String(item.open.action).split(':')[0] });
  return 'navigate';
}

/**
 * One item, cleaned (unknown fields dropped), or null when it has no id, no kind, no label or no way to open.
 * `defaults` fills app / owner / source when the item carries none. The kind in the id wins over `kind`.
 */
export function normalizeUiItem(raw, defaults = {}) {
  if (!isObj(raw)) return null;
  let id = str(raw.id, UI_LIMITS.id + 1);
  if (id && !id.includes(':') && UI_KINDS.includes(raw.kind)) id = uiId(raw.kind, id);
  const parsed = parseUiId(id);
  if (!parsed) return null;
  const kind = parsed.kind;
  const label = str(raw.label, UI_LIMITS.label) || str(raw.title, UI_LIMITS.label);
  if (!label) return null;
  // an `open` that is given must be usable (a bad URL or an unknown shape drops the item); none = the kind's default
  const open = raw.open !== undefined ? normalizeUiOpen(raw.open) : defaultOpen(kind, parsed.key, raw);
  if (!open) return null;
  const out = { id, kind, label, open };
  const app = str(raw.app ?? defaults.app, 63); if (SLUG.test(app)) out.app = app;
  const owner = str(raw.owner ?? defaults.owner, 140); if (OWNER.test(owner)) out.owner = owner;
  const parent = str(raw.parent, UI_LIMITS.id); if (parseUiId(parent)) out.parent = parent;
  const aliases = strList(raw.aliases, UI_LIMITS.aliases, UI_LIMITS.alias).filter((a) => foldWords(a) && foldWords(a) !== foldWords(label)); if (aliases.length) out.aliases = aliases;
  const keywords = strList(raw.keywords, UI_LIMITS.keywords, 80); if (keywords.length) out.keywords = keywords;
  for (const k of ['detail', 'icon', 'requires', 'help']) { const v = str(raw[k], k === 'detail' ? UI_LIMITS.detail : 160); if (v) out[k] = v; }
  if (UI_EFFECTS.includes(raw.effect)) out.effect = raw.effect;
  const source = UI_SOURCES.includes(raw.source) ? raw.source : UI_SOURCES.includes(defaults.source) ? defaults.source : '';
  if (source) out.source = source;
  if (raw.hidden === true) out.hidden = true;
  return out;
}

/** The open shape a kind implies when an item gives none: a screen opens its view, a dialog its dialog, a settings tab its tab, an action runs, an element item is found on the page. */
function defaultOpen(kind, key, raw) {
  if (kind === 'screen') return { via: 'view', view: key };
  if (kind === 'dialog' || kind === 'popup') return { via: 'dialog', dialog: key };
  if (kind === 'settings') return { via: 'settings', tab: key.replace(/^plugins\//, '') };
  if (kind === 'settings-group' || kind === 'setting') { const [tab, anchor] = key.split('/'); return tab ? { via: 'settings', tab, ...(anchor ? { anchor } : {}) } : null; }
  if (kind === 'action') return { via: 'action', action: key };
  if (kind === 'window') return { via: 'action', action: `windows.focus:${key}` };
  if (['button', 'link', 'tab', 'widget', 'menu-item', 'nav-item', 'toolbar', 'tab-group', 'banner', 'card', 'control', 'menu'].includes(kind)) {
    return { via: 'element', selector: `[${UI_ATTR}="${uiId(kind, key)}"]`, ...(raw?.click === true || kind === 'button' || kind === 'link' || kind === 'tab' || kind === 'menu-item' ? { click: true } : {}) };
  }
  return null;
}

/** A registry as an app ships it, cleaned and de-duplicated (first item with an id wins), capped. */
export function normalizeUiRegistry(raw) {
  const r = isObj(raw) ? raw : {};
  const app = str(r.app, 63);
  const defaults = { app: SLUG.test(app) ? app : '', owner: 'app', source: UI_SOURCES.includes(r.source) ? r.source : 'declared' };
  const seen = new Set();
  const items = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const n = normalizeUiItem(it, defaults);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    items.push(n);
    if (items.length >= UI_LIMITS.items) break;
  }
  const out = { $axf: UI_REGISTRY_FRAME, app: defaults.app, items };
  if (UI_SOURCES.includes(r.source) || r.source === 'mixed') out.source = r.source;
  const from = strList(r.generatedFrom, 12, 40); if (from.length) out.generatedFrom = from;
  const at = str(r.generatedAt, 40); if (at) out.generatedAt = at;
  return out;
}

/* ================================================================== validation (ONE validator: core/validate.ts + the build engine) */

export function uiRegistryErrors(type, raw) {
  if (type !== UI_REGISTRY_TYPE) return [];
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (!SLUG.test(raw.app ?? '')) e.push('data.app is the app (its project manifest name: lowercase letters, digits and dashes)');
  if (raw.source !== undefined && !UI_SOURCES.includes(raw.source) && raw.source !== 'mixed') e.push(`data.source must be one of ${UI_SOURCES.join(', ')}, mixed`);
  if (!Array.isArray(raw.items)) { e.push('data.items must be a list of UI items'); return e; }
  if (raw.items.length > UI_LIMITS.items) e.push(`data.items holds more than ${UI_LIMITS.items} items`);
  const ids = new Set();
  raw.items.forEach((it, i) => {
    const at = `data.items[${i}]`;
    if (!isObj(it)) { e.push(`${at} must be an object`); return; }
    const p = parseUiId(it.id);
    if (!p) e.push(`${at}.id must be <kind>:<key> (e.g. screen:plan-studio, button:plan-studio/new-plan)`);
    else {
      if (ids.has(it.id)) e.push(`${at}.id "${it.id}" is declared twice`);
      ids.add(it.id);
      if (!UI_KINDS.includes(p.kind)) e.push(`${at}.id kind "${p.kind}" is not a UI kind (${UI_KINDS.join(', ')})`);
      if (it.kind !== undefined && it.kind !== p.kind) e.push(`${at}.kind "${it.kind}" disagrees with the id's kind "${p.kind}"`);
    }
    if (!str(it.label, UI_LIMITS.label + 1) || it.label.length > UI_LIMITS.label) e.push(`${at}.label is what the item is called (up to ${UI_LIMITS.label} characters)`);
    if (it.open !== undefined && !normalizeUiOpen(it.open)) e.push(`${at}.open must be one of { view } | { dialog, arg? } | { settings, anchor? } | { action } | { url } | { element, click? } | { menu }`);
    else if (it.open === undefined && p && !defaultOpen(p.kind, p.key, it)) e.push(`${at}.open is needed: a ${p.kind} has no default way to open`);
    if (it.aliases !== undefined && (!Array.isArray(it.aliases) || it.aliases.length > UI_LIMITS.aliases || it.aliases.some((a) => !str(a, UI_LIMITS.alias)))) e.push(`${at}.aliases must list up to ${UI_LIMITS.aliases} short names`);
    if (it.owner !== undefined && !OWNER.test(String(it.owner))) e.push(`${at}.owner must be app, framework, plugin:<folder> or library:<id>`);
    if (it.effect !== undefined && !UI_EFFECTS.includes(it.effect)) e.push(`${at}.effect must be one of ${UI_EFFECTS.join(', ')}`);
    if (it.source !== undefined && !UI_SOURCES.includes(it.source)) e.push(`${at}.source must be one of ${UI_SOURCES.join(', ')}`);
    if (it.parent !== undefined && !parseUiId(it.parent)) e.push(`${at}.parent must be an item id`);
  });
  return e;
}

/** JSON Schema properties of the asset's `data` (the build engine's `axf schemas` writes schemas/json/ui-registry.schema.json). */
export function uiRegistrySchemaProperties() {
  const open = { type: 'object', description: 'exactly one way to open it', properties: { via: { enum: [...UI_OPEN_VIAS] }, view: { type: 'string' }, dialog: { type: 'string' }, arg: { type: 'string' }, settings: { type: 'string' }, tab: { type: 'string' }, anchor: { type: 'string' }, action: { type: 'string' }, spec: { type: 'string' }, url: { type: 'string' }, element: { type: 'string' }, selector: { type: 'string' }, click: { type: 'boolean' }, menu: { type: 'string' } } };
  return {
    app: { type: 'string', pattern: SLUG.source, description: 'the app (project manifest name)' },
    source: { enum: [...UI_SOURCES, 'mixed'] },
    generatedFrom: { type: 'array', items: { type: 'string' } },
    generatedAt: { type: 'string' },
    items: {
      type: 'array', maxItems: UI_LIMITS.items,
      items: {
        type: 'object', required: ['id', 'label'],
        properties: {
          id: { type: 'string', pattern: ID.source, maxLength: UI_LIMITS.id, description: '<kind>:<key>' },
          kind: { enum: [...UI_KINDS] }, label: { type: 'string', maxLength: UI_LIMITS.label }, open,
          app: { type: 'string' }, owner: { type: 'string', pattern: OWNER.source }, parent: { type: 'string' },
          aliases: { type: 'array', maxItems: UI_LIMITS.aliases, items: { type: 'string', maxLength: UI_LIMITS.alias } },
          keywords: { type: 'array', maxItems: UI_LIMITS.keywords, items: { type: 'string' } },
          detail: { type: 'string', maxLength: UI_LIMITS.detail }, icon: { type: 'string' }, requires: { type: 'string' }, help: { type: 'string' },
          effect: { enum: [...UI_EFFECTS] }, source: { enum: [...UI_SOURCES] }, hidden: { type: 'boolean' },
        },
      },
    },
  };
}

/* ================================================================== merging */

/**
 * Items from several sources as one list: the first list that has an id wins its fields; aliases and keywords are
 * unioned across all of them; a later source's `detail` / `icon` / `help` fill what the winner lacks. Order = precedence
 * (declared, authored, live, scanned).
 */
export function mergeUiItems(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const it = normalizeUiItem(raw);
      if (!it) continue;
      const have = byId.get(it.id);
      if (!have) { byId.set(it.id, { ...it }); continue; }
      const aliases = uniq([...(have.aliases ?? []), ...(it.aliases ?? [])]).filter((a) => foldWords(a) !== foldWords(have.label)).slice(0, UI_LIMITS.aliases);
      if (aliases.length) have.aliases = aliases;
      const keywords = uniq([...(have.keywords ?? []), ...(it.keywords ?? [])]).slice(0, UI_LIMITS.keywords);
      if (keywords.length) have.keywords = keywords;
      for (const k of ['detail', 'icon', 'help', 'requires', 'parent', 'owner', 'app']) if (!have[k] && it[k]) have[k] = it[k];
    }
  }
  return [...byId.values()];
}

/* ================================================================== items from what already exists */

/** Items from a console-catalog@1 (what an open console reports: screens, dialogs, settings tabs, actions). */
export function uiItemsFromConsoleCatalog(catalog, defaults = {}) {
  const c = isObj(catalog) ? catalog : {};
  const app = str(c.app, 63).replace(/^.*\//, '') || defaults.app || '';
  const out = [];
  for (const it of Array.isArray(c.items) ? c.items : []) {
    if (!isObj(it)) continue;
    const kind = Object.values(CONSOLE_KINDS).includes(it.kind) ? it.kind : null;
    if (!kind) continue;
    const key = kind === 'settings' && it.parent ? `${it.parent}/${it.id}` : it.id;
    const n = normalizeUiItem({
      id: uiId(kind, key), label: it.label, detail: it.detail, icon: it.icon, keywords: it.keywords, requires: it.requires, effect: it.effect,
      open: kind === 'screen' ? { view: it.id } : kind === 'dialog' ? { dialog: it.id } : kind === 'settings' ? { settings: it.id } : { action: it.id },
      owner: it.module ? ownerFromModule(it.module) : undefined, source: 'live',
    }, { app, owner: 'app', source: 'live' });
    if (n) out.push(n);
  }
  return out;
}

/** `axf.framework` → framework, a plugin / library id → library:<id>, else the app. */
export function ownerFromModule(module) {
  const m = str(module, 160);
  if (!m) return 'app';
  if (m === 'axf.framework' || m === 'axf') return 'framework';
  return `library:${m}`;
}

/**
 * Items from a runtime's search index entries (engines/search.ts shape: { kind, label, detail?, icon?, keywords?, requires?, focus })
 * and its action list ({ id, meta }). `ownerOf(kind, id)` may say who registered a view / dialog / settings tab.
 */
export function uiItemsFromSearchEntries(entries, actions = [], defaults = {}, ownerOf = () => undefined) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const f = isObj(e?.focus) ? e.focus : {};
    const base = { label: String(e.label ?? '').replace(/ settings$/, ''), detail: e.detail, icon: e.icon, keywords: e.keywords, requires: e.requires, source: 'live' };
    let raw = null;
    if (e.kind === 'view' && f.view) raw = { ...base, id: uiId('screen', f.view), open: { view: f.view }, owner: ownerOf('view', f.view) };
    else if (e.kind === 'settings-tab' && f.tab) raw = { ...base, id: uiId('settings', e.parent ? `${e.parent}/${f.tab}` : f.tab), open: { settings: f.tab }, owner: ownerOf('settings-tab', f.tab) };
    else if (e.kind === 'setting' && f.tab) raw = { ...base, id: uiId(f.anchor && /^group:/.test(f.anchor) ? 'settings-group' : 'setting', `${f.tab}/${f.anchor ?? f.key ?? e.id.replace(/^setting:/, '')}`), open: { settings: f.tab, anchor: f.anchor }, parent: uiId('settings', f.tab) };
    else if (e.kind === 'dialog' && f.id) raw = { ...base, id: uiId('dialog', f.id), open: { dialog: f.id }, owner: ownerOf('dialog', f.id) };
    else if (e.kind === 'menu' && f.spec) raw = { ...base, id: uiId('menu-item', `${String(e.id).replace(/^menu:/, '')}`), open: { action: f.spec } };
    else if (e.kind === 'window' && f.id) raw = { ...base, id: uiId('window', f.id), open: { action: `windows.focus:${f.id}` } };
    if (!raw) continue;
    const n = normalizeUiItem(raw, { app: defaults.app, owner: 'app', source: 'live' });
    if (n) out.push(n);
  }
  for (const a of Array.isArray(actions) ? actions : []) {
    const m = isObj(a?.meta) ? a.meta : {};
    if (!a?.id || m.stub || m.params === true) continue;
    const n = normalizeUiItem({ id: uiId('action', a.id), label: m.label || a.id, detail: a.id, requires: m.requires, effect: m.effect, open: { action: a.id }, owner: ownerFromModule(m.module), source: 'live' }, { app: defaults.app, owner: 'app', source: 'live' });
    if (n) out.push(n);
  }
  return out;
}

/**
 * Items from a menu or toolbar asset (asset@1 envelope): app-menu → menu:<menu id> + menu-item:<menu>/<item>; context-menu →
 * menu-item:<target>/<item>; nav-menu → nav-item:<id>; toolbar → toolbar:<asset id> + button:<asset id>/<item>. Entries with an
 * action open through it; entries with a view open the view; the rest are element items.
 */
export function uiItemsFromMenuAsset(asset, defaults = {}) {
  const a = isObj(asset) ? asset : {};
  const d = isObj(a.data) ? a.data : {};
  const type = str(a.type, 40); const assetId = str(a.id, 120);
  const def = { app: defaults.app, owner: defaults.owner ?? 'app', source: defaults.source ?? 'scanned' };
  const out = [];
  const push = (raw) => { const n = normalizeUiItem(raw, def); if (n) out.push(n); };
  const entryOpen = (it) => (str(it.action, 400) ? { action: it.action } : str(it.view, 160) ? { view: it.view } : str(it.href ?? it.url, 2000) ? { url: it.href ?? it.url } : null);
  const walk = (items, kind, prefix, parent, depth = 0) => {
    for (const it of Array.isArray(items) ? items : []) {
      if (!isObj(it) || it.type === 'separator' || it.separator === true || !str(it.label)) continue; // separators and label-less rows are not entries a person can name
      const key = `${prefix}/${str(it.id, 80) || slug(it.label)}`;
      const open = entryOpen(it);
      push({ id: uiId(kind, key), label: str(it.label, UI_LIMITS.label) || str(it.id, 80), icon: it.icon, requires: it.requires, parent, open: open ?? { element: `[${UI_ATTR}="${uiId(kind, key)}"]`, click: true } });
      if (Array.isArray(it.items) && depth < 4) walk(it.items, kind, key, uiId(kind, key), depth + 1);
    }
  };
  if (type === 'app-menu') for (const m of Array.isArray(d.menus) ? d.menus : []) { if (!isObj(m) || !str(m.id)) continue; const mid = uiId('menu', m.id); push({ id: mid, label: str(m.label, UI_LIMITS.label) || m.id, icon: m.icon, open: { element: `[${UI_ATTR}="${mid}"]`, click: true } }); walk(m.items, 'menu-item', m.id, mid); }
  else if (type === 'context-menu' && isObj(d.targets)) for (const [t, items] of Object.entries(d.targets)) walk(items, 'menu-item', t, undefined);
  else if (type === 'nav-menu') { const walkNav = (items, parent, depth = 0) => { for (const it of Array.isArray(items) ? items : []) { if (!isObj(it) || !str(it.id)) continue; const id = uiId('nav-item', it.id); push({ id, label: str(it.label, UI_LIMITS.label) || it.id, icon: it.icon, requires: it.requires, parent, open: entryOpen(it) ?? (str(it.view) ? { view: it.view } : { view: it.id }) }); if (Array.isArray(it.items) && depth < 4) walkNav(it.items, id, depth + 1); } }; for (const s of Array.isArray(d.sections) ? d.sections : []) walkNav(isObj(s) ? s.items : [], undefined); walkNav(d.items, undefined); }
  else if (type === 'toolbar' && assetId) { const tid = uiId('toolbar', assetId); push({ id: tid, label: str(a.name, UI_LIMITS.label) || assetId, open: { element: `[data-axf-toolbar="${assetId}"], [${UI_ATTR}="${tid}"]` } }); const groups = Array.isArray(d.groups) ? d.groups.flatMap((g) => (isObj(g) ? g.items ?? [] : [])) : []; for (const it of [...(Array.isArray(d.items) ? d.items : []), ...groups]) { if (!isObj(it) || !str(it.action) && !str(it.id)) continue; const key = `${assetId}/${str(it.id, 80) || slug(String(it.action).split(':')[0])}`; push({ id: uiId('button', key), label: str(it.label ?? it.tooltip ?? it.title, UI_LIMITS.label) || str(it.id, 80) || String(it.action), icon: it.icon, requires: it.requires, parent: tid, open: entryOpen(it) ?? { element: `[${UI_ATTR}="${uiId('button', key)}"]`, click: true } }); } }
  return out;
}

/**
 * Items a plugin@1 manifest promises (`provides`: view:<id>, dialog:<id>, settings-tab:<id>, action:<id>, banner:<id>);
 * `folder` is the plugin folder (its owner id). Labels come from the manifest name until a better source fills them.
 */
export function uiItemsFromPluginManifest(manifest, folder, defaults = {}) {
  const m = isObj(manifest) ? manifest : {};
  const name = str(m.name, UI_LIMITS.label) || folder;
  const owner = `plugin:${folder}`;
  const out = [];
  for (const p of Array.isArray(m.provides) ? m.provides : []) {
    const [k, ...rest] = String(p).split(':'); const key = rest.join(':');
    if (!key) continue;
    const label = (kindLabel) => (rest.length === 1 && key === folder ? name : `${name}: ${titleOf(key)}${kindLabel ? ` ${kindLabel}` : ''}`);
    let raw = null;
    if (k === 'view') raw = { id: uiId('screen', key), label: key === folder ? name : label(''), open: { view: key } };
    else if (k === 'dialog') raw = { id: uiId('dialog', key), label: label('dialog'), open: { dialog: key } };
    else if (k === 'settings-tab') raw = { id: uiId('settings', `plugins/${key}`), label: `${name} settings`, aliases: [`${name} plugin settings`], open: { settings: key } };
    else if (k === 'action') raw = { id: uiId('action', key), label: label(''), open: { action: key } };
    else if (k === 'banner') raw = { id: uiId('banner', key), label: `${name} banner`, open: { element: `[data-axf-banner="${key}"], [${UI_ATTR}="${uiId('banner', key)}"]` } };
    if (!raw) continue;
    const n = normalizeUiItem({ ...raw, owner, source: 'scanned' }, { app: defaults.app, source: 'scanned' });
    if (n) out.push(n);
  }
  return out;
}

const slug = (s) => foldWords(s).replace(/ /g, '-').slice(0, 80) || 'item';
const titleOf = (key) => String(key).split(/[/.]/).pop().replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ================================================================== search + resolve (aliases, fuzzy) */

/** Edit distance ≤ `max` between two short words (early exit), for spoken names ("orkestrator" → "orchestrator"). */
export function nearWord(a, b, max = 1) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i++) {
    let prev = dp[0]; dp[0] = i; let rowMin = dp[0];
    for (let j = 1; j <= a.length; j++) { const tmp = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[j - 1] === b[i - 1] ? 0 : 1)); prev = tmp; rowMin = Math.min(rowMin, dp[j]); }
    if (rowMin > max) return false;
  }
  return dp[a.length] <= max;
}
/** How close a spoken word may be to a real one: exact under 5 letters, one slip to 8, two beyond. */
const slack = (w) => (w.length < 5 ? 0 : w.length < 9 ? 1 : 2);

/** The words of what was said, with open verbs, kind words and fillers taken off; `kind` = the kind a word picked (if any). */
export function uiQueryWords(q) {
  const noFiller = (t) => t.split(' ').filter((w) => w && !FILLER.has(w)).join(' ');
  let s = ` ${noFiller(foldWords(q))} `;
  // the verbs without their own fillers ("take me to" → "take", "go to" → "go"), longest first, up to three in a row
  const verbs = uniq(UI_OPEN_VERBS.map(noFiller).filter(Boolean)).sort((a, b) => b.length - a.length);
  for (let pass = 0; pass < 3; pass++) for (const v of verbs) s = s.replace(new RegExp(`^ ${v} `), ' ');
  const words = s.trim().split(' ').filter(Boolean);
  let kind = '';
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const two = `${w} ${words[i + 1] ?? ''}`;
    if (UI_KIND_WORDS[two] && (i === 0 || i + 2 === words.length) && words.length > 2) { kind = UI_KIND_WORDS[two]; i++; continue; }
    if (UI_KIND_WORDS[w] && (i === 0 || i === words.length - 1) && words.length > 1) { kind = UI_KIND_WORDS[w]; continue; }
    kept.push(w);
  }
  return { words: kept, kind, phrase: kept.join(' '), whole: words.join(' ') };
}

/** Score one item for the words (0 = no match; every word must hit the label, an alias, the id or the keywords). */
export function scoreUiItem(item, words, phrase) {
  if (!words.length) return 1;
  const names = [item.label, ...(item.aliases ?? [])].map(foldWords);
  const idWords = foldWords(item.id.split(':').slice(1).join(' '));
  const extra = foldWords([item.detail, ...(item.keywords ?? []), UI_KIND_LABELS[item.kind] ?? item.kind].join(' '));
  let score = 0;
  if (names.includes(phrase)) score += 30;
  else if (names.some((n) => n.startsWith(`${phrase} `))) score += 8;
  else if (idWords === phrase.replace(/ /g, '-') || idWords === phrase) score += 15;
  for (const w of words) {
    let best = 0;
    for (const n of names) {
      const nw = n.split(' ');
      if (nw.includes(w)) best = Math.max(best, 4);
      else if (nw.some((x) => x.startsWith(w) && w.length >= 3)) best = Math.max(best, 3);
      else if (nw.some((x) => nearWord(w, x, slack(w)))) best = Math.max(best, 2.5);
      else if (n.includes(w)) best = Math.max(best, 2);
    }
    if (!best) { if (idWords.split(/[ /.-]/).includes(w)) best = 3; else if (idWords.includes(w)) best = 2; else if (extra.includes(w)) best = 1; }
    if (!best) return 0;
    score += best;
  }
  return score + (9 - rankOf(item)) * 0.01 - names[0].length / 1000;
}

/** Items matching what was said, best first. `kinds` / `app` / `owner` filter; a kind word in the query filters too. */
export function searchUiItems(items, q = '', opts = {}) {
  const { words, kind } = uiQueryWords(q);
  const kinds = opts.kinds?.length ? opts.kinds : opts.kind ? [opts.kind] : kind ? [kind] : null;
  const limit = Math.max(1, Math.min(Number(opts.limit) || 50, 500));
  const list = (Array.isArray(items) ? items : []).filter((i) => i && (!kinds || kinds.includes(i.kind)) && (!opts.app || i.app === opts.app) && (!opts.owner || i.owner === opts.owner) && (opts.hidden || !i.hidden));
  if (!words.length) return list.slice(0, limit).map((i) => ({ ...i, score: 1 }));
  const phrase = words.join(' ');
  return list.map((i) => ({ ...i, score: scoreUiItem(i, words, phrase) })).filter((i) => i.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The one item a query names: the exact id, an exact label or alias (case and punctuation folded), then the best search
 * hit when it clearly wins (a gap of one point) → { item, via } | { candidates, ambiguous: true } | { candidates: [] }.
 */
export function resolveUiItem(items, q, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const raw = str(q, 400);
  if (!raw) return { candidates: [] };
  const low = raw.toLowerCase();
  let hit = list.find((i) => i.id.toLowerCase() === low);
  if (hit) return { item: hit, via: 'id' };
  const { words, kind, phrase, whole } = uiQueryWords(raw);
  const scoped = list.filter((i) => (!opts.app || i.app === opts.app) && (!opts.kinds?.length || opts.kinds.includes(i.kind)));
  const pool = kind ? scoped.filter((i) => i.kind === kind) : scoped;
  // the name as said, with its kind word ("ui shortcuts settings"), then without it ("ui shortcuts" among the settings)
  const first = (list2, test) => list2.filter(test).sort(byRank)[0];
  hit = first(scoped, (i) => foldWords(i.label) === whole) ?? first(pool, (i) => foldWords(i.label) === phrase);
  if (hit) return { item: hit, via: 'label' };
  hit = first(scoped, (i) => (i.aliases ?? []).some((a) => foldWords(a) === whole)) ?? first(pool, (i) => (i.aliases ?? []).some((a) => foldWords(a) === phrase));
  if (hit) return { item: hit, via: 'alias' };
  if (!words.length) return { candidates: [] };
  let scored = searchUiItems(pool, phrase, { limit: 8, hidden: opts.hidden });
  if (!scored.length && kind) scored = searchUiItems(scoped, phrase, { limit: 8, hidden: opts.hidden }); // nothing of that kind: any kind with that name
  if (!scored.length) return { candidates: [] };
  // a clear winner, or rivals that are the same thing under another kind (the screen, its nav item, its menu entry, its
  // settings tab "<name> settings"): the best-ranked one
  const top = scored[0];
  const tl = foldWords(top.label);
  const family = (c) => { const cl = foldWords(c.label); return cl === tl || cl.startsWith(`${tl} `) || tl.startsWith(`${cl} `); };
  const rivals = scored.slice(1).filter((c) => top.score - c.score < 1 && !family(c));
  if (!rivals.length) return { item: top, via: 'fuzzy' };
  return { candidates: scored.slice(0, 6), ambiguous: true };
}

/* ================================================================== opening */

/**
 * The control@1 console command that opens an item (console-commands.mjs resolves and delivers it): a screen through
 * console.screens, a dialog through console.dialogs, a settings tab through console.settings, an action through
 * console.actions, anything else (an element on a page, a URL, a menu entry) through the framework action `ui.open:<id>`.
 * `to` = recent (default) | all | a client id. Pure: the caller adds `by` / `reason`.
 */
export function uiOpenCommand(item, opts = {}) {
  const o = item?.open ?? {};
  const input = {}; if (opts.to) input.to = opts.to;
  const base = (target, path, action, more = {}) => ({ $axf: 'control@1', op: 'act', target, path, action, ...(Object.keys({ ...input, ...more }).length ? { input: { ...input, ...more } } : {}) });
  if (o.via === 'view') return base('console.screens', o.view, 'open');
  if (o.via === 'dialog') return base('console.dialogs', o.dialog, 'open', o.arg || opts.arg ? { arg: opts.arg ?? o.arg } : {});
  if (o.via === 'settings') return base('console.settings', o.tab, 'open', o.anchor ? { anchor: o.anchor } : {});
  if (o.via === 'action') { const [id, ...args] = String(o.action).split(':'); return base('console.actions', id, 'run', args.length ? { args } : {}); }
  return base('console.actions', UI_OPEN_ACTION, 'run', { args: [item.id] });
}

/** What the `ui.open` action does for an item in the running app: where to go first, then what to find, flash and click. */
export function uiOpenPlan(item) {
  const o = item?.open ?? {};
  const plan = { via: o.via };
  if (o.via === 'url') return { ...plan, url: o.url };
  if (o.via === 'view') return { ...plan, view: o.view };
  if (o.via === 'dialog') return { ...plan, dialog: o.dialog, ...(o.arg ? { arg: o.arg } : {}) };
  if (o.via === 'settings') return { ...plan, tab: o.tab, ...(o.anchor ? { anchor: o.anchor } : {}) };
  if (o.via === 'action') return { ...plan, action: o.action };
  if (o.via === 'menu') { const [menu, ...rest] = String(o.menu).split('/'); return { ...plan, menu, item: rest.join('/'), selector: `[${UI_ATTR}="${item.id}"]` }; }
  return { ...plan, selector: uiElementSelector(item), click: !!o.click, ...(o.view ? { view: o.view } : {}), ...(o.tab ? { tab: o.tab } : {}), ...(o.dialog ? { dialog: o.dialog } : {}) };
}

/* ================================================================== user-defined shortcuts */

/** One shortcut: a phrase (and aliases) a person chose → an item id, with an optional spoken answer. */
export function normalizeUiShortcut(raw) {
  if (!isObj(raw)) return null;
  const phrase = str(raw.phrase, UI_LIMITS.phrase);
  const item = str(raw.item, UI_LIMITS.id);
  if (!foldWords(phrase) || !parseUiId(item)) return null;
  const out = { id: str(raw.id, 80) || `sc-${slug(phrase)}`, phrase, item };
  const aliases = strList(raw.aliases, UI_LIMITS.aliases, UI_LIMITS.phrase).filter((a) => foldWords(a) && foldWords(a) !== foldWords(phrase)); if (aliases.length) out.aliases = aliases;
  const say = str(raw.say, 200); if (say) out.say = say;
  const arg = str(raw.arg, 200); if (arg) out.arg = arg;
  if (raw.enabled === false) out.enabled = false;
  return out;
}

export function uiShortcutErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['a shortcut must be an object { phrase, item, aliases?, say? }'];
  if (!foldWords(str(raw.phrase, UI_LIMITS.phrase + 1)) || String(raw.phrase ?? '').length > UI_LIMITS.phrase) e.push(`phrase is what you say (up to ${UI_LIMITS.phrase} characters)`);
  if (!parseUiId(raw.item)) e.push('item must be a registry item id (<kind>:<key>)');
  if (raw.aliases !== undefined && (!Array.isArray(raw.aliases) || raw.aliases.length > UI_LIMITS.aliases)) e.push(`aliases must list up to ${UI_LIMITS.aliases} other phrases`);
  return e;
}

/** The shortcut whose phrase (or alias) is exactly what was said (open verbs and fillers dropped first), or null. */
export function matchUiShortcut(shortcuts, heard) {
  const { phrase, whole } = uiQueryWords(heard);
  const exact = foldWords(heard);
  if (!exact) return null;
  for (const s of Array.isArray(shortcuts) ? shortcuts : []) {
    if (!s || s.enabled === false) continue;
    const names = [s.phrase, ...(s.aliases ?? [])].map(foldWords);
    if (names.includes(exact) || names.includes(whole) || (phrase && names.includes(phrase))) return s;
  }
  return null;
}

/**
 * What to open for something said: a user shortcut first (its phrase, exactly), then the registry (id, label, alias,
 * fuzzy). → { item, via: 'shortcut'|'id'|'label'|'alias'|'fuzzy', shortcut?, say } | { ambiguous: true, candidates, say } | { candidates: [], say }.
 */
export function uiSay(items, shortcuts, heard, opts = {}) {
  const sc = matchUiShortcut(shortcuts, heard);
  if (sc) {
    const item = (Array.isArray(items) ? items : []).find((i) => i.id === sc.item);
    if (item) return { item, via: 'shortcut', shortcut: sc, say: sc.say || `Opening ${item.label}.` };
    return { candidates: [], shortcut: sc, say: `The shortcut "${sc.phrase}" points at ${sc.item}, which is not registered.` };
  }
  const r = resolveUiItem(items, heard, opts);
  if (r.item) return { ...r, say: `Opening ${r.item.label}.` };
  if (r.ambiguous) return { ...r, say: `Which one: ${r.candidates.slice(0, 4).map((c) => `${c.label} (${UI_KIND_LABELS[c.kind] ?? c.kind})`).join(', ')}?` };
  return { ...r, say: `I know nothing called "${str(heard, 80)}".` };
}

/* ================================================================== voice (voice-command@1 shape) */

/**
 * The spoken form of the registry as voice-command@1 commands: one generic `ui.open` ("open {item}" …, slot item = what
 * to open, navigate, never asks) and one command per user shortcut (its phrase as the only phrase). `run` names the
 * transports: the framework action in the open app, and the REST route / MCP tool the caller passes in.
 */
export function uiVoiceCommands(shortcuts = [], run = {}) {
  const base = { action: `${UI_OPEN_ACTION}:{item}`, ...(run.api ? { api: run.api } : {}), ...(run.mcp ? { mcp: run.mcp } : {}), ...(run.cli ? { cli: run.cli } : {}) };
  const out = [{ id: UI_VOICE_COMMAND_ID, title: 'Open any screen, dialog, setting, menu entry or button', effect: 'navigate', confirm: 'never', phrases: [...UI_VOICE_PHRASES], slots: { item: { type: 'text', required: true, say: 'What should I open?' } }, run: base, say: 'Opening {item}.', help: 'open <anything in the UI registry>: a screen, dialog, settings tab, menu entry, button, link… by name or alias', source: 'generated' }];
  for (const raw of Array.isArray(shortcuts) ? shortcuts : []) {
    const s = normalizeUiShortcut(raw);
    if (!s || s.enabled === false) continue;
    out.push({ id: `ui.shortcut.${s.id.replace(/[^a-z0-9_.-]+/g, '-').slice(0, 50)}`, title: `Shortcut: ${s.phrase}`, effect: 'navigate', confirm: 'never', phrases: uniq([s.phrase, ...(s.aliases ?? [])]).slice(0, 12), run: { action: `${UI_OPEN_ACTION}:${s.item}`, ...(run.api ? { api: run.api } : {}), ...(run.mcp ? { mcp: run.mcp } : {}) }, say: s.say || 'Opening it.', help: `${s.phrase} → ${s.item}`, source: 'authored' });
  }
  return out;
}

/* ================================================================== coverage */

/**
 * Is everything that was found registered? `registry` = the app's items, `found` = what a scan or a live app has.
 * → { total, byKind, bySource, missing: [ids found but not registered], unknown: [registered ids nothing found] }.
 */
export function uiRegistryCoverage(registry, found = []) {
  const items = Array.isArray(registry) ? registry : [];
  const have = new Set(items.map((i) => i.id));
  const seen = new Set((Array.isArray(found) ? found : []).map((i) => i?.id).filter(Boolean));
  const byKind = {}; const bySource = {};
  for (const i of items) { byKind[i.kind] = (byKind[i.kind] ?? 0) + 1; const s = i.source ?? 'declared'; bySource[s] = (bySource[s] ?? 0) + 1; }
  return { total: items.length, byKind, bySource, missing: [...seen].filter((id) => !have.has(id)).sort(), unknown: items.filter((i) => i.source === 'scanned' && !seen.has(i.id)).map((i) => i.id).sort() };
}
