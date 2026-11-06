#!/usr/bin/env node
/**
 * ui-registry — the UI registry of every app (ui-registry@1, core/engines/ui-registry-rules.mjs), filled by a scanner so
 * nothing has to be written twice (Brett, Nov 6 2026, build ui-registry-shortcuts: "All the UIs need to be in a registry …
 * from a button to a pop-up to a link to a menu to a menu entry … visible to the API").
 *
 * What the scanner reads for an app (apps/<folder>):
 *   - plugin manifests (plugins/<f>/plugin.json or src/plugins/<f>/plugin.json) → `provides` (view:, dialog:, settings-tab:, action:, banner:)
 *   - web code (src/**, plugins/<f>/web/**; never src/axf): `views: { id: { title, icon, keywords } }`, `dialogs: { … }`,
 *     `settingsTabs: [{ id, label, parent }]`, `nav: { items: [{ id, label, view }] }`, `rt.actions.register('id', …, { label })`,
 *     `openDialog('id')`, and every <Button> / <button> / <a> / <Link> that carries data-axf-ui="<id>" or data-help="<help id>"
 *   - menu contributions (web/menu.ts `appMenu`): menu-item:<menu>/<item>
 *   - the app's active app-menu, context-menu, nav-menu and toolbar assets (axf.manifest.json defaults)
 *   - declared items: plugins/<f>/ui-registry.json and src/ui-registry.json (an asset envelope or { items }), kept as written
 *   - the registry asset already on disk: its `declared` / `authored` items (aliases a person added) survive regeneration
 *
 *   node framework/cli/ui-registry.mjs scan <app> [--json]
 *   node framework/cli/ui-registry.mjs generate [app…]          writes apps/<folder>/src/assets/ui-registry/<app>.json
 *   node framework/cli/ui-registry.mjs check [app…]             CI: every app's registry exists, validates and holds everything the scan finds
 *   node framework/cli/ui-registry.mjs registry [--json]        every app's items (what the UI shortcuts plugin's server reads)
 *   node framework/cli/ui-registry.mjs list [app] [--kind k] [--owner o] [--json]
 *   node framework/cli/ui-registry.mjs search <words…> [--app a] [--kind k] [--limit n] [--json]
 *   node framework/cli/ui-registry.mjs get <id> [--json]
 *   node framework/cli/ui-registry.mjs say <words…> [--app a] [--to t] [--json]   what would open (AXF_UI_SHORTCUTS_FILE = the user's shortcuts, AXF_UI_LIVE_FILE = items running apps reported; the UI shortcuts server sets both)
 *   node framework/cli/ui-registry.mjs open <id|words…> [--to recent|all|<client>] [--app a]   opens it in Brett's open console (AXF_CONSOLE_URL + AXF_TOKEN)
 *   node framework/cli/ui-registry.mjs coverage [app] [--json]
 *   node framework/cli/ui-registry.mjs voice [--json]           the voice-command@1 commands (generic open + shortcuts)
 *
 * Apps: a folder under apps/ or its project manifest name (console-web = axf-console-web). Default set: every app whose
 * project manifest names an AXF app manifest (`framework.appManifest`) and that has src/assets (the demo and Walkthrough
 * Studio are left out, like shared assets). AXF_ROOT = another checkout to scan.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWebActions } from '../core/engines/plugin-commands.mjs';
import {
  UI_ATTR, UI_KIND_LABELS, UI_OPEN_ACTION, UI_REGISTRY_TYPE, mergeUiItems, normalizeUiItem, normalizeUiRegistry, normalizeUiShortcut, resolveUiItem, searchUiItems, uiEffect, uiId,
  uiItemsFromMenuAsset, uiItemsFromPluginManifest, uiOpenCommand, uiRegistryCoverage, uiRegistryErrors, uiSay, uiVoiceCommands,
} from '../core/engines/ui-registry-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.AXF_ROOT ? resolve(process.env.AXF_ROOT) : resolve(HERE, '../..');
const SKIP_APPS = new Set(['demo', 'walkthrough-studio']);
const MENU_TYPES = ['app-menu', 'context-menu', 'nav-menu', 'toolbar'];
const CODE_LIMIT = 2_000_000;

const read = (f) => readFileSync(f, 'utf8');
const readJson = (f) => { try { return JSON.parse(read(f)); } catch { return null; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const titleOf = (key) => String(key).split(/[/.:]/).pop().replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* ================================================================== apps */

/** Every app folder with a project manifest: { folder, dir, name, displayName, appManifest, plugins: [dirs] }. */
export function listApps() {
  const out = [];
  for (const folder of readdirSync(join(ROOT, 'apps')).sort()) {
    const dir = join(ROOT, 'apps', folder);
    const pm = readJson(join(dir, 'project.manifest.json'));
    if (!pm || !isDir(join(dir, 'src'))) continue;
    const appManifest = pm.framework?.appManifest ? readJson(join(dir, pm.framework.appManifest)) : null;
    const pluginRoots = [join(dir, 'plugins'), join(dir, 'src', 'plugins')].filter(isDir);
    const plugins = pluginRoots.flatMap((r) => readdirSync(r).filter((n) => !n.startsWith('_') && !n.startsWith('.') && isDir(join(r, n)) && existsSync(join(r, n, 'plugin.json'))).map((n) => join(r, n)));
    out.push({ folder, dir, name: pm.name, displayName: pm.displayName || pm.name, appManifest, plugins, defaultSet: !SKIP_APPS.has(folder) && !!appManifest && isDir(join(dir, 'src', 'assets')) });
  }
  return out;
}

export function findApp(nameOrFolder) {
  const apps = listApps();
  const a = apps.find((x) => x.folder === nameOrFolder || x.name === nameOrFolder || `apps/${x.folder}` === nameOrFolder || x.dir === resolve(nameOrFolder));
  if (!a) throw new Error(`no app "${nameOrFolder}" (one of ${apps.map((x) => x.folder).join(', ')})`);
  return a;
}

const registryFile = (app) => join(app.dir, 'src', 'assets', 'ui-registry', `${app.name}.json`);

/* ================================================================== reading code */

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'vendor' || n === 'dist' || n.startsWith('.') || n.startsWith('_')) continue; // _template and friends are not UI
    const p = join(dir, n);
    if (/[\\/]src[\\/]axf$/.test(p)) continue;
    if (isDir(p)) walk(p, out);
    else if (/\.(tsx|ts)$/.test(n) && !/\.(test|spec|d)\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

/** The text between the brace at `open` and its match (strings and template literals skipped). */
function balanced(src, open, pair = '{}') {
  let depth = 0; let q = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; if (i < 1) break; continue; }
    if (ch === pair[0]) depth++;
    else if (ch === pair[1]) { depth--; if (depth === 0) return { text: src.slice(open + 1, i), end: i }; }
  }
  return null;
}

/** `const NAME = 'value'` in a file, so `[NAME]: { … }` keys and `openDialog(NAME)` resolve. */
function constants(src) {
  const out = new Map();
  for (const m of src.matchAll(/\b(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*(['"`])([^'"`\n]{1,160})\2/g)) out.set(m[1], m[3]);
  return out;
}

/** Depth-1 `key: value` entries of an object body: [{ key, body }] (key = identifier, 'quoted' or [CONST] resolved). */
function objectEntries(body, consts) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i);
    const m = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:(['"`])([^'"`]+)\1|\[([A-Za-z_$][\w$]*)\]|([A-Za-z_$][\w$-]*))\s*:/.exec(rest);
    if (!m) break;
    const key = m[2] ?? (m[3] ? consts.get(m[3]) : m[4]);
    const valueAt = i + m[0].length;
    // the value: an object, else up to the next top-level comma
    const ws = /^\s*/.exec(body.slice(valueAt))[0].length;
    let end;
    let value;
    if (body[valueAt + ws] === '{') { const b = balanced(body, valueAt + ws); if (!b) break; value = b.text; end = b.end + 1; }
    else {
      let depth = 0; let q = null; let j = valueAt;
      for (; j < body.length; j++) { const ch = body[j]; if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; } if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; } if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; else if (ch === ',' && depth === 0) break; }
      value = body.slice(valueAt, j); end = j;
    }
    if (key) out.push({ key, body: value });
    const comma = body.indexOf(',', end);
    i = comma < 0 ? body.length : comma + 1;
  }
  return out;
}

const field = (body, name) => { const m = new RegExp(`\\b${name}:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\\\n]){0,200})\\1`).exec(body); return m ? m[2].replace(/\\(.)/g, '$1') : ''; };
const listField = (body, name) => { const m = new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`).exec(body); return m ? [...m[1].matchAll(/(['"`])([^'"`]+)\1/g)].map((x) => x[2]) : []; };
/** The plain text of a JSX element's children (expressions dropped), or ''. */
const childText = (src, closeOfOpenTag, tag) => { const close = src.indexOf(`</${tag}>`, closeOfOpenTag); if (close < 0 || close - closeOfOpenTag > 400) return ''; return src.slice(closeOfOpenTag + 1, close).replace(/\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); };
/** Where a JSX opening tag ends: the `>` outside every {…} attribute and quote (so `onClick={() => x}` doesn't end it), or -1. */
function tagEnd(src, from) {
  let depth = 0; let q = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || (c === '`' && depth)) { q = c; continue; }
    if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) return i;
  }
  return -1;
}
const attr = (tag, name) => { const m = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*(['"\`])([^'"\`]*)\\3\\s*\\})`).exec(tag); return m ? (m[1] ?? m[2] ?? m[4] ?? '') : ''; };

/** Every item one source file declares. `owner` = app | plugin:<folder>; `ownerKey` prefixes element ids. */
export function scanSource(src, { owner = 'app', ownerKey = 'app', file = '' } = {}) {
  const text = String(src ?? '').slice(0, CODE_LIMIT);
  const consts = constants(text);
  const items = [];
  const push = (raw) => { const n = normalizeUiItem({ ...raw, owner, source: 'scanned' }); if (n) items.push(n); };
  const inPlugins = owner.startsWith('plugin:');
  // views / dialogs maps (an app's `const views: ViewMap = {` and a library's `views: {`)
  for (const m of text.matchAll(/\b(views|dialogs)\s*(?::\s*[A-Za-z<>\[\]|, ]+)?\s*[:=]\s*\{/g)) {
    const b = balanced(text, m.index + m[0].length - 1);
    if (!b) continue;
    for (const e of objectEntries(b.text, consts)) {
      const title = field(e.body, 'title') || field(e.body, 'label');
      if (!title && !/\brender\b/.test(e.body)) continue; // a lookup table that happens to be called views
      const kind = m[1] === 'views' ? 'screen' : 'dialog';
      push({ id: uiId(kind, e.key), label: title || titleOf(e.key), icon: field(e.body, 'icon'), keywords: listField(e.body, 'keywords'), requires: field(e.body, 'requires'), open: kind === 'screen' ? { view: e.key } : { dialog: e.key } });
    }
  }
  // settings tabs
  for (const m of text.matchAll(/\bsettingsTabs\s*:\s*\[/g)) {
    const b = balanced(text, m.index + m[0].length - 1, '[]');
    if (!b) continue;
    for (const t of b.text.matchAll(/\{[^{}]*\}/g)) {
      const id = field(t[0], 'id') || (consts.get((/\bid:\s*([A-Z][A-Z0-9_]*)/.exec(t[0]) ?? [])[1]) ?? '');
      const label = field(t[0], 'label');
      if (!id) continue;
      const sub = inPlugins || field(t[0], 'parent') === 'plugins';
      push({ id: uiId('settings', sub ? `plugins/${id}` : id), label: label ? (/settings$/i.test(label) ? label : `${label} settings`) : `${titleOf(id)} settings`, icon: field(t[0], 'icon'), detail: field(t[0], 'description'), open: { settings: id } });
    }
  }
  // nav items
  for (const m of text.matchAll(/\bnav\s*:\s*\{/g)) {
    const b = balanced(text, m.index + m[0].length - 1);
    if (!b) continue;
    for (const t of b.text.matchAll(/\{[^{}]*\bview:\s*(['"`])([^'"`]+)\1[^{}]*\}/g)) {
      const id = field(t[0], 'id') || t[2];
      push({ id: uiId('nav-item', id), label: field(t[0], 'label') || titleOf(id), icon: field(t[0], 'icon'), requires: field(t[0], 'requires'), open: { view: t[2] } });
    }
  }
  // actions (the same scanner plugin-commands uses), minus ones that take arguments
  for (const a of scanWebActions(text, file)) {
    if (a.context) continue;
    push({ id: uiId('action', a.id), label: a.label || titleOf(a.id), detail: a.id, open: { action: a.id }, ...(a.searchable ? {} : { hidden: true }) });
  }
  // dialogs opened by id somewhere (a dialog the file renders itself is already above; this catches the rest)
  for (const m of text.matchAll(/\bopenDialog\(\s*(?:(['"`])([A-Za-z0-9_.:/-]+)\1|([A-Z][A-Z0-9_]*))/g)) {
    const id = m[2] ?? consts.get(m[3]);
    if (!id || items.some((i) => i.id === uiId('dialog', id))) continue;
    push({ id: uiId('dialog', id), label: `${titleOf(id)} dialog`, open: { dialog: id } });
  }
  // buttons and links that name themselves (data-axf-ui) or carry a help id
  for (const m of text.matchAll(/<(Button|button|a|Link|IconButton)\b/g)) {
    const end = tagEnd(text, m.index + m[0].length);
    if (end < 0) continue;
    const tag = text.slice(m.index, end + 1);
    const named = attr(tag, UI_ATTR);
    const help = attr(tag, 'data-help');
    if (!named && !help) continue;
    const isLink = m[1] === 'a' || m[1] === 'Link';
    const label = childText(text, end, m[1]) || attr(tag, 'aria-label') || attr(tag, 'title') || attr(tag, 'label') || titleOf(help || named);
    const id = named || uiId(isLink ? 'link' : 'button', `${ownerKey}/${help}`);
    push({ id, label, help: help || undefined, open: { element: `[${UI_ATTR}="${id}"]${help ? `, [data-help="${help}"]` : ''}`, click: true } });
  }
  return items;
}

/** Items from a plugin's web/menu.ts (`appMenu` contributions): menu-item:<menu>/<item>, nested one level. */
export function scanMenuContributions(src, { owner = 'app' } = {}) {
  const text = String(src ?? '');
  const items = [];
  const push = (raw) => { const n = normalizeUiItem({ ...raw, owner, source: 'scanned' }); if (n) items.push(n); };
  const walkItems = (body, menu, parent, depth = 0) => {
    for (const t of body.matchAll(/\{\s*id:\s*(['"`])([^'"`]+)\1[^{}]*?\}/g)) {
      const id = t[2]; const label = field(t[0], 'label'); const action = field(t[0], 'action'); const href = field(t[0], 'href') || field(t[0], 'url');
      if (!label || /\btype:\s*(['"`])separator\1/.test(t[0])) continue; // separators and label-less rows are not entries a person can name
      const key = `${menu}/${id}`;
      push({ id: uiId('menu-item', key), label: label || titleOf(id), icon: field(t[0], 'icon'), requires: field(t[0], 'requires'), parent, open: action ? { action } : href ? { url: href } : { element: `[${UI_ATTR}="${uiId('menu-item', key)}"]`, click: true } });
    }
    // nested: { id, label, items: [ … ] }
    for (const n of body.matchAll(/\{\s*id:\s*(['"`])([^'"`]+)\1[^{}]*?\bitems:\s*\[/g)) {
      const b = balanced(body, n.index + n[0].length - 1, '[]');
      if (b && depth < 2) walkItems(b.text, `${menu}/${n[2]}`, uiId('menu-item', `${menu}/${n[2]}`), depth + 1);
    }
  };
  for (const g of text.matchAll(/\bmenu:\s*(['"`])([^'"`]+)\1/g)) {
    const after = text.indexOf('items:', g.index);
    if (after < 0) continue;
    const open = text.indexOf('[', after);
    const b = balanced(text, open, '[]');
    if (b) walkItems(b.text, g[2], uiId('menu', g[2]));
  }
  return items;
}

/** A declared registry file: an asset@1 envelope or a bare { items }; items get the owner when they name none. */
function declaredItems(file, owner) {
  const j = readJson(file);
  if (!j) return [];
  const data = j.data ?? j;
  return (Array.isArray(data.items) ? data.items : []).map((it) => normalizeUiItem({ ...it, owner: it.owner ?? owner, source: it.source === 'authored' ? 'authored' : 'declared' })).filter(Boolean);
}

/** The app's active asset of a type, from its own assets, overrides, the baked framework copy or the framework. */
function activeAsset(app, type) {
  const id = app.appManifest?.defaults?.[type];
  if (!id) return null;
  for (const dir of [join(app.dir, 'src/assets-overrides', type), join(app.dir, 'src/assets', type), join(app.dir, 'src/axf/assets', type), join(ROOT, 'framework/assets', type)]) {
    const f = join(dir, `${id}.json`);
    if (existsSync(f)) return readJson(f);
  }
  return null;
}

/* ================================================================== the scan */

/** Everything the scanner finds for an app: { items, from, files, plugins }. */
export function scanApp(app) {
  const from = new Set();
  const declared = []; const code = []; const manifests = []; const menus = [];
  // declared: the app's own file + each plugin's
  const own = join(app.dir, 'src', 'ui-registry.json');
  if (existsSync(own)) { declared.push(...declaredItems(own, 'app')); from.add('declared'); }
  for (const p of app.plugins) {
    const folder = basename(p);
    const f = join(p, 'ui-registry.json');
    if (existsSync(f)) { declared.push(...declaredItems(f, `plugin:${folder}`)); from.add('declared'); }
    const pj = readJson(join(p, 'plugin.json'));
    if (pj) { manifests.push(...uiItemsFromPluginManifest(pj, folder, { app: app.name })); from.add('manifests'); }
    const menu = join(p, 'web', 'menu.ts');
    if (existsSync(menu)) { code.push(...scanMenuContributions(read(menu), { owner: `plugin:${folder}` })); from.add('menus'); }
  }
  // the registry on disk: items a person declared or edited there survive
  const onDisk = existsSync(registryFile(app)) ? readJson(registryFile(app)) : null;
  for (const it of onDisk?.data?.items ?? []) if (it.source === 'declared' || it.source === 'authored') { const n = normalizeUiItem(it); if (n) declared.push(n); }
  // code
  const files = walk(join(app.dir, 'src')).concat(app.plugins.flatMap((p) => (p.startsWith(join(app.dir, 'src')) ? [] : walk(join(p, 'web')))));
  for (const f of files) {
    const rel = relative(app.dir, f);
    const pm = /(?:^|[\\/])plugins[\\/]([^\\/]+)[\\/]/.exec(rel);
    const owner = pm ? `plugin:${pm[1]}` : 'app';
    const found = scanSource(read(f), { owner, ownerKey: pm ? pm[1] : 'app', file: rel });
    if (found.length) { code.push(...found); from.add('web'); }
  }
  // the active menu and toolbar assets
  for (const type of MENU_TYPES) { const asset = activeAsset(app, type); if (asset) { menus.push(...uiItemsFromMenuAsset(asset, { app: app.name, owner: 'app', source: 'scanned' })); from.add(type === 'toolbar' ? 'toolbars' : 'menus'); } }
  const items = mergeUiItems(declared, code, manifests, menus).map((i) => normalizeUiItem({ ...i, app: app.name }, { owner: 'app' })).filter(Boolean);
  return { items: items.sort((a, b) => a.id.localeCompare(b.id)), from: [...from].sort(), files: files.length, plugins: app.plugins.length };
}

/** The asset envelope for an app's registry. */
export function registryAsset(app, scan) {
  return {
    $axf: 'asset@1', type: UI_REGISTRY_TYPE, id: app.name, name: `${app.displayName} UI registry`, version: '0.1.0',
    description: `Every screen, dialog, settings interface, menu entry, button and link of ${app.displayName} and its plugins (ui-registry@1). Generated by framework/cli/ui-registry.mjs; items with source declared or authored are kept as written, so add aliases there or in a plugin's ui-registry.json.`,
    author: 'AmberX AXF', tags: ['ui-registry', 'generated'],
    data: { app: app.name, source: 'mixed', generatedFrom: scan.from, items: scan.items },
  };
}

/** Write (or refresh) an app's registry asset. */
export function generate(app) {
  const scan = scanApp(app);
  const file = registryFile(app);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(registryAsset(app, scan), null, 2)}\n`);
  return { file: relative(ROOT, file), items: scan.items.length, from: scan.from };
}

/** CI: the registry on disk exists, validates and holds everything the scan finds (and nothing scanned that vanished). */
export function checkApp(app) {
  const problems = [];
  const file = registryFile(app);
  const fix = `node framework/cli/ui-registry.mjs generate ${app.folder}`;
  if (!existsSync(file)) return { app: app.folder, problems: [`no UI registry at ${relative(ROOT, file)}: ${fix}`] };
  const asset = readJson(file);
  if (!asset) return { app: app.folder, problems: [`${relative(ROOT, file)} is not JSON`] };
  const errs = uiRegistryErrors(asset.type, asset.data);
  if (asset.type !== UI_REGISTRY_TYPE) problems.push(`${relative(ROOT, file)}: type must be ${UI_REGISTRY_TYPE}`);
  problems.push(...errs.map((e) => `${relative(ROOT, file)}: ${e}`));
  if (asset.data?.app !== app.name) problems.push(`${relative(ROOT, file)}: data.app must be ${app.name}`);
  const scan = scanApp(app);
  const cov = uiRegistryCoverage(normalizeUiRegistry(asset.data).items, scan.items);
  if (cov.missing.length) problems.push(`${app.folder}: ${cov.missing.length} UI item(s) not registered (${cov.missing.slice(0, 6).join(', ')}${cov.missing.length > 6 ? ', …' : ''}): ${fix}`);
  if (cov.unknown.length) problems.push(`${app.folder}: ${cov.unknown.length} registered item(s) the scan no longer finds (${cov.unknown.slice(0, 6).join(', ')}${cov.unknown.length > 6 ? ', …' : ''}): ${fix}`);
  return { app: app.folder, problems, items: cov.total, byKind: cov.byKind };
}

/**
 * Every app's registry as the plugin server reads it: items with their app, plus per-app facts. AXF_UI_LIVE_FILE names a
 * JSON file of items running apps reported (the UI shortcuts server keeps it): they fill in and win over the disk copy.
 */
export function fullRegistry() {
  const apps = [];
  const items = [];
  for (const app of listApps()) {
    const file = registryFile(app);
    if (!existsSync(file)) continue;
    const asset = readJson(file);
    if (!asset || asset.type !== UI_REGISTRY_TYPE) continue;
    const reg = normalizeUiRegistry(asset.data);
    const list = reg.items.map((i) => ({ ...i, app: app.name }));
    apps.push({ app: app.name, folder: app.folder, displayName: app.displayName, file: relative(ROOT, file), items: list.length, generatedFrom: reg.generatedFrom ?? [] });
    items.push(...list);
  }
  const liveFile = process.env.AXF_UI_LIVE_FILE;
  let live = [];
  if (liveFile && existsSync(liveFile)) { const j = readJson(liveFile); live = (Array.isArray(j) ? j : j?.items ?? []).map((i) => normalizeUiItem(i, { source: 'live' })).filter(Boolean); }
  return { $axf: 'ui-registry@1', apps, items: live.length ? mergeUiItems(live, items) : items, live: live.length };
}

/* ================================================================== CLI */

const flag = (args, name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const words = (args) => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--json', '--check'].includes(args[i - 1])));
const out = (json, data, text) => { if (json) console.log(JSON.stringify(data, null, 2)); else console.log(text); };
const line = (i) => `${i.id.padEnd(48)} ${(UI_KIND_LABELS[i.kind] ?? i.kind).padEnd(14)} ${i.label}${i.aliases?.length ? `  (${i.aliases.join(', ')})` : ''}${i.owner && i.owner !== 'app' ? `  ← ${i.owner}` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const [cmd = 'help', ...rest] = argv;
  const json = argv.includes('--json');
  const appsArg = words(rest).filter((w) => w !== cmd);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(read(fileURLToPath(import.meta.url)).split('\n').slice(1, 30).map((l) => l.replace(/^ \*\s?/, '')).join('\n')); return; }
  if (cmd === 'apps') { const apps = listApps(); return out(json, apps.map(({ folder, name, displayName, defaultSet, plugins }) => ({ folder, name, displayName, defaultSet, plugins: plugins.length })), apps.map((a) => `${a.folder.padEnd(20)} ${a.name.padEnd(20)} ${a.plugins.length} plugin(s)${a.defaultSet ? '' : '  (not in the default set)'}`).join('\n')); }
  if (cmd === 'scan') { const app = findApp(appsArg[0] ?? 'console-web'); const s = scanApp(app); return out(json, s, `${app.folder}: ${s.items.length} items from ${s.from.join(', ')} (${s.files} files, ${s.plugins} plugins)\n${s.items.map(line).join('\n')}`); }
  if (cmd === 'generate') {
    const apps = appsArg.length ? appsArg.map(findApp) : listApps().filter((a) => a.defaultSet);
    const results = apps.map(generate);
    return out(json, results, results.map((r) => `✓ ${r.file}: ${r.items} items (${r.from.join(', ')})`).join('\n'));
  }
  if (cmd === 'check') {
    const apps = appsArg.length ? appsArg.map(findApp) : listApps().filter((a) => a.defaultSet);
    const results = apps.map(checkApp);
    const problems = results.flatMap((r) => r.problems);
    out(json, { ok: !problems.length, results }, problems.length ? problems.map((p) => `✗ ${p}`).join('\n') : `✓ ui-registry: ${results.map((r) => `${r.app} ${r.items}`).join(', ')} items registered`);
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (cmd === 'registry') { const r = fullRegistry(); return out(json, r, `${r.items.length} items in ${r.apps.length} app(s)\n${r.apps.map((a) => `  ${a.folder.padEnd(20)} ${a.items} items  ${a.file}`).join('\n')}`); }
  if (cmd === 'list') {
    const r = fullRegistry();
    const app = appsArg[0] ? findApp(appsArg[0]).name : undefined;
    const kind = flag(rest, 'kind'); const owner = flag(rest, 'owner');
    const list = r.items.filter((i) => (!app || i.app === app) && (!kind || i.kind === kind) && (!owner || i.owner === owner));
    return out(json, list, list.map(line).join('\n') || 'nothing registered (run generate)');
  }
  if (cmd === 'search') {
    const r = fullRegistry();
    const app = flag(rest, 'app') ? findApp(flag(rest, 'app')).name : undefined;
    const hits = searchUiItems(r.items, words(rest).join(' '), { app, kind: flag(rest, 'kind'), limit: Number(flag(rest, 'limit')) || 20 });
    return out(json, hits, hits.map((h) => `${h.score.toFixed(1).padStart(5)}  ${line(h)}`).join('\n') || 'no match');
  }
  if (cmd === 'get') {
    const r = fullRegistry();
    const res = resolveUiItem(r.items, words(rest).join(' '));
    if (!res.item) { out(json, res, res.ambiguous ? `ambiguous: ${res.candidates.map((c) => c.id).join(', ')}` : 'not found'); process.exitCode = 1; return; }
    return out(json, { item: res.item, via: res.via, effect: uiEffect(res.item), command: uiOpenCommand(res.item) }, `${line(res.item)}\n  open: ${JSON.stringify(res.item.open)}\n  command: ${JSON.stringify(uiOpenCommand(res.item))}`);
  }
  if (cmd === 'say') {
    const r = fullRegistry();
    const shortcuts = loadShortcuts();
    const app = flag(rest, 'app') ? findApp(flag(rest, 'app')).name : undefined;
    const to = flag(rest, 'to');
    const res = uiSay(r.items, shortcuts, words(rest).join(' '), { app });
    return out(json, { ...res, ...(res.item ? { effect: uiEffect(res.item), command: uiOpenCommand(res.item, { to, arg: res.shortcut?.arg }) } : {}) }, `${res.say}${res.item ? `\n  ${line(res.item)} (via ${res.via})` : ''}`);
  }
  if (cmd === 'open') {
    const r = fullRegistry();
    const shortcuts = loadShortcuts();
    const app = flag(rest, 'app') ? findApp(flag(rest, 'app')).name : undefined;
    const res = uiSay(r.items, shortcuts, words(rest).join(' '), { app });
    if (!res.item) { out(json, res, res.say); process.exitCode = 1; return; }
    const url = process.env.AXF_CONSOLE_URL; const tok = process.env.AXF_TOKEN;
    if (!url || !tok) { out(json, { ...res, command: uiOpenCommand(res.item), sent: false }, `${res.say}\n  would send ${JSON.stringify(uiOpenCommand(res.item, { to: flag(rest, 'to') }))}\n  set AXF_CONSOLE_URL + AXF_TOKEN to open it in the console`); return; }
    const owner = registryOwner();
    if (!owner) { out(json, { ...res, sent: false }, `${res.say}\n  no console plugin provides ui-registry@1 here; nothing sent`); process.exitCode = 1; return; }
    const resp = await fetch(`${url.replace(/\/$/, '')}/api/plugins/${owner}/open`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ id: res.item.id, to: flag(rest, 'to') || 'recent', by: 'cli' }) });
    const body = await resp.json().catch(() => ({}));
    out(json, { ...res, sent: resp.ok, response: body }, resp.ok ? `${res.say} (${body.message ?? 'sent'})` : `could not open: ${body.message ?? resp.status}`);
    if (!resp.ok) process.exitCode = 1;
    return;
  }
  if (cmd === 'coverage') {
    const apps = appsArg.length ? appsArg.map(findApp) : listApps().filter((a) => a.defaultSet);
    const results = apps.map((app) => { const asset = existsSync(registryFile(app)) ? readJson(registryFile(app)) : null; const cov = uiRegistryCoverage(asset ? normalizeUiRegistry(asset.data).items : [], scanApp(app).items); return { app: app.folder, ...cov }; });
    return out(json, results, results.map((r) => `${r.app}: ${r.total} items (${Object.entries(r.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}); ${r.missing.length} missing, ${r.unknown.length} stale`).join('\n'));
  }
  if (cmd === 'voice') {
    const owner = registryOwner();
    const v = uiVoiceCommands(loadShortcuts(), { cli: 'axf ui open <words>', ...(owner ? { api: `POST /api/plugins/${owner}/say`, mcp: `${owner}_say` } : {}) });
    return out(json, v, v.map((c) => `${c.id}: ${c.phrases.join(' | ')}`).join('\n'));
  }
  throw new Error(`unknown command ${cmd} (scan | generate | check | registry | list | search | get | say | open | coverage | voice | apps)`);
}

/** The console plugin that serves the registry (provides `service:ui-registry@1`), found by capability, never by name; '' when none. */
export function registryOwner() {
  const dir = join(ROOT, 'apps/console-web/plugins');
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('_') || f.startsWith('.')) continue;
      const pj = readJson(join(dir, f, 'plugin.json'));
      if (Array.isArray(pj?.provides) && pj.provides.includes('service:ui-registry@1')) return f;
    }
  } catch { /* no console here */ }
  return '';
}

/** User shortcuts for the CLI: the file AXF_UI_SHORTCUTS_FILE names (the console plugin's data folder), else none. */
function loadShortcuts() {
  const f = process.env.AXF_UI_SHORTCUTS_FILE;
  if (!f || !existsSync(f)) return [];
  const j = readJson(f);
  return (Array.isArray(j) ? j : j?.shortcuts ?? []).map(normalizeUiShortcut).filter(Boolean);
}

export { UI_OPEN_ACTION };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`ui-registry: ${e.message}`); process.exit(2); });
}
