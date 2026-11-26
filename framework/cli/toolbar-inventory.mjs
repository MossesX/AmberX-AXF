#!/usr/bin/env node
/**
 * toolbar-inventory — every toolbar on the framework's apps, with what it holds today and what its page can really do
 * (build rebuild-every-toolbar-page-specific, Brett, Nov 17 2026: "Everywhere there's a toolbar, rebuild the asset for
 * that page/plugin with useful, integrated buttons made for it.").
 *
 * The scan is textual, the same tag walk as check-toolbars.mjs: every `role="toolbar"` element in the console, its
 * plugins, Molly, AmberX web, Expenses and the framework's React port and libraries. For each one:
 *   - its settings id (`data-axf-toolbar`, `data-axf-toolbar-asset`, else the slug of its aria-label: the id its
 *     tap-to-confirm override and its chrome settings live under; `framework/core/engines/tapconfirm.ts#toolbarIdOf`),
 *   - the app and the page or plugin it belongs to (the console-control view when known),
 *   - the buttons and controls drawn inside it now (framework Button / IconButton / raw <button>, with icon, label,
 *     title and the first line of the handler),
 *   - the page's real functions (once per page, in `pages[<page>]`): its plugin's commands (plugin-commands@1), the
 *     views and settings tab it provides, the console actions its code registers and its CLI.
 *
 *   node framework/cli/toolbar-inventory.mjs [--out <file>] [--json]
 *     default --out: _claude/builds/reports/rebuild-every-toolbar-page-specific/inventory.json
 *
 * The output is toolbar-inventory@1 (below). The toolbar contract (s2) and the page toolbar assets are designed from it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openingTags } from './check-toolbars.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const OUT = resolve(ROOT, flag('--out') ?? '_claude/builds/reports/rebuild-every-toolbar-page-specific/inventory.json');
const FRAME = 'toolbar-inventory@1';

/** Where toolbars live: app roots (src + plugins) and the framework's React port and libraries. */
const ROOTS = [
  { app: 'console-web', dir: 'apps/console-web/src' }, { app: 'console-web', dir: 'apps/console-web/plugins' },
  { app: 'molly', dir: 'apps/molly/src' }, { app: 'molly', dir: 'apps/molly/plugins' },
  { app: 'expenses', dir: 'apps/expenses/src' }, { app: 'expenses', dir: 'apps/expenses/plugins' },
  { app: 'framework', dir: 'framework/react' }, { app: 'framework', dir: 'framework/libs' },
];

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'vendor' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (/[\\/]src[\\/]axf$/.test(p)) continue; // baked framework copies are listed at their source
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Attribute value: the string literal, or the expression text (`{…}`), or null. */
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}=(?:"([^"]*)"|\\{)`).exec(tag);
  if (!m) return null;
  if (m[1] != null) return m[1];
  // an expression value: scan balanced braces, quote-aware
  let depth = 0; let quote = '';
  const start = m.index + m[0].length;
  for (let i = start - 1; i < tag.length; i++) {
    const c = tag[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return tag.slice(start, i);
  }
  return tag.slice(start);
};
/** A readable version of an attribute that may be an expression: template literal text with `${…}` → `…`. */
const readable = (v) => (v == null ? null : v.replace(/^`|`$/g, '').replace(/\$\{[^}]+\}/g, '…').replace(/^'|'$/g, '').trim());

/** The end index (exclusive) of the opening tag starting at `start`, brace- and quote-aware. */
function tagEnd(src, start) {
  let depth = 0; let quote = '';
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { if (depth || c !== '`') quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

/** The inner JSX of the element whose opening tag spans [start, end): up to its matching close tag. */
function innerOf(src, tag, start, end) {
  if (/\/>\s*$/.test(src.slice(start, end))) return '';
  const open = new RegExp(`<${tag}\\b`, 'g'); const close = `</${tag}>`;
  let depth = 1; let i = end;
  while (i < src.length && depth > 0) {
    open.lastIndex = i;
    const o = open.exec(src); const c = src.indexOf(close, i);
    if (c < 0) return src.slice(end);
    if (o && o.index < c) {
      const e = tagEnd(src, o.index);
      if (!/\/>\s*$/.test(src.slice(o.index, e))) depth++;
      i = e;
    } else { depth--; i = c + close.length; if (depth === 0) return src.slice(end, c); }
  }
  return src.slice(end);
}

const CONTROL_TAGS = new Set(['Button', 'IconButton', 'button', 'Select', 'Input', 'Toggle', 'Checkbox', 'SearchBox', 'Search', 'Switch', 'Segmented', 'TabGroup', 'Menu', 'Dropdown', 'a']);

/** Buttons and controls inside a toolbar's JSX: the framework controls and raw <button>s, in order. */
function controlsOf(inner) {
  const out = [];
  const re = /<([A-Za-z][A-Za-z0-9.]*)\b/g;
  let m;
  while ((m = re.exec(inner))) {
    const tag = m[1];
    if (!CONTROL_TAGS.has(tag)) continue;
    const end = tagEnd(inner, m.index);
    const text = inner.slice(m.index, end);
    const self = /\/>\s*$/.test(text);
    let label = readable(attr(text, 'label')) ?? readable(attr(text, 'aria-label'));
    if (!label && !self) {
      const body = innerOf(inner, tag, m.index, end);
      const t = body.replace(/<[^>]*>/g, ' ').replace(/\{[^{}]*\}/g, (x) => (/^\{'([^']*)'\}$/.test(x) ? x.slice(2, -2) : ' ')).replace(/\s+/g, ' ').trim();
      if (t) label = t.slice(0, 60);
    }
    const kind = tag === 'Button' || tag === 'IconButton' || tag === 'button' || tag === 'a' ? 'button' : tag.toLowerCase();
    const onClick = attr(text, 'onClick');
    const entry = { kind, tag, ...(attr(text, 'icon') != null ? { icon: readable(attr(text, 'icon')) } : {}), ...(label ? { label } : {}) };
    const title = readable(attr(text, 'title'));
    if (title && title !== label) entry.title = title.slice(0, 120);
    const target = attr(text, 'data-axf-target') ?? null;
    if (target) entry.target = readable(target);
    if (/\bdisabled=/.test(text)) entry.gated = readable(attr(text, 'disabled')).slice(0, 80);
    if (/\btone="danger"|tone=\{?'danger'/.test(text)) entry.destructive = true;
    if (onClick) entry.handler = onClick.replace(/\s+/g, ' ').trim().slice(0, 140);
    out.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------ owners: plugins, views, functions */

const PLUGIN_ROOTS = ['apps/console-web/plugins', 'apps/molly/plugins', 'apps/expenses/plugins'];

function pluginAt(file) {
  for (const root of PLUGIN_ROOTS) {
    const abs = join(ROOT, root) + '/';
    if (!file.startsWith(abs)) continue;
    const folder = file.slice(abs.length).split('/')[0];
    const dir = join(abs, folder);
    const m = json(join(dir, 'plugin.json'));
    if (m) return { folder, dir, m };
  }
  return null;
}

const CORE_VIEW = { Home: 'home', Tracker: 'tracker', Plan: 'plan', BuildManager: 'build', Pending: 'pending', Standards: 'standards-projects', Catalog: 'catalog', Libraries: 'libraries', DemosModules: 'demos', Boilerplates: 'boilerplates', Components: 'components', Explorer: 'explorer', Plugins: 'plugins', Wizards: 'wizards', LibraryTemplates: 'library-templates' };

/** Console actions a set of files registers (`actions.register('id', …, { label })`). */
function actionsIn(files) {
  const out = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/actions\.register\('([\w.:-]+)'/g)) {
      const win = src.slice(m.index, m.index + 2000);
      const label = win.match(/\{ label: (?:'((?:[^'\\]|\\.)+)'|`([^`]+)`)/);
      out.push({ id: m[1], ...(label ? { label: (label[1] ?? label[2]).replace(/\\'/g, "'") } : {}), file: rel(f) });
    }
  }
  return out;
}

const fnCache = new Map();
/** The real functions of a toolbar's owner: plugin commands, views, settings tab, CLI, registered console actions. */
function functionsOf(owner, file) {
  const key = owner.plugin ? `plugin:${owner.app}/${owner.plugin.folder}` : `${owner.app}:${owner.view ?? rel(dirname(file))}`;
  if (fnCache.has(key)) return fnCache.get(key);
  let fns;
  if (owner.plugin) {
    const m = owner.plugin.m;
    const cmds = (m.commands?.items ?? []).map((c) => ({ id: c.id, title: c.title, route: c.route, ...(c.readOnly ? { readOnly: true } : {}), ...(c.tool ? { tool: c.tool } : {}), ...(/confirm/i.test(c.title ?? '') ? { confirm: true } : {}) }));
    fns = {
      plugin: m.id, name: m.name,
      views: (m.provides ?? []).filter((x) => x.startsWith('view:')).map((x) => x.slice(5)),
      services: (m.provides ?? []).filter((x) => x.startsWith('service:')).map((x) => x.slice(8)),
      settingsTab: !!(m.settingsTab || (m.provides ?? []).some((x) => x.startsWith('settings-tab:'))),
      commands: cmds, cli: m.cli ?? null,
      actions: actionsIn(walk(join(owner.plugin.dir, 'web'))),
    };
  } else if (owner.app === 'console-web') {
    fns = { view: owner.view ?? null, actions: actionsIn([join(ROOT, 'apps/console-web/src/actions.ts'), file]) };
  } else if (owner.app === 'framework') {
    fns = { library: owner.library ?? null, actions: actionsIn([file]) };
  } else fns = { actions: actionsIn([file]) };
  fnCache.set(key, fns);
  return fns;
}

function ownerOf(app, file) {
  const plugin = pluginAt(file);
  if (plugin) return { app, plugin, page: `plugin:${plugin.m.id}`, view: plugin.m.tabable?.view ?? (plugin.m.provides ?? []).find((x) => x.startsWith('view:'))?.slice(5) ?? null };
  const r = rel(file);
  if (app === 'console-web') {
    const name = r.split('/').pop().replace(/\.tsx?$/, '');
    const view = r.includes('/src/views/') ? (CORE_VIEW[name] ?? slug(name)) : null;
    return { app, page: view ? `view:${view}` : `console:${name}`, view };
  }
  if (app === 'framework') {
    const lib = /framework\/libs\/([^/]+)\//.exec(r)?.[1];
    return { app, page: lib ? `library:${lib}` : `framework:${r.replace(/^framework\/react\//, '').replace(/\.tsx?$/, '')}`, library: lib ?? null, view: null };
  }
  return { app, page: `${app}:${r.split('/').pop().replace(/\.tsx?$/, '')}`, view: null };
}

/* ------------------------------------------------------------------ the scan */

export function buildToolbarInventory() {
  const toolbars = [];
  const pages = {};
  const files = new Set();
  for (const r of ROOTS) for (const f of walk(join(ROOT, r.dir))) {
    files.add(f);
    const src = read(f);
    const tags = openingTags(src);
    let cursor = 0;
    for (const t of tags) {
      const role = attr(t.text, 'role');
      if (role !== 'toolbar' && role !== "'toolbar'") continue;
      const start = src.indexOf(t.text, cursor); cursor = start + 1;
      const end = start + t.text.length;
      const inner = innerOf(src, t.tag, start, end);
      const explicit = attr(t.text, 'data-axf-toolbar');
      const asset = attr(t.text, 'data-axf-toolbar-asset');
      const label = readable(attr(t.text, 'aria-label')) ?? '';
      const dynamicId = /\$\{|…/.test(explicit ?? asset ?? label);
      const id = slug(readable(explicit)) || slug(readable(asset)) || slug(label) || 'toolbar';
      const owner = ownerOf(r.app, f);
      const ctx = attr(t.text, 'data-fx-ctx-target');
      const tap = attr(t.text, 'data-axf-tap-confirm');
      toolbars.push({
        id, label, ...(dynamicId ? { dynamicId: true } : {}),
        idSource: explicit != null ? 'data-axf-toolbar' : asset != null ? 'data-axf-toolbar-asset' : 'aria-label',
        app: owner.app, page: owner.page, ...(owner.view ? { view: owner.view } : {}), ...(owner.plugin ? { plugin: owner.plugin.m.id } : {}),
        file: rel(f), line: t.line,
        ...(ctx ? { contextTarget: readable(ctx) } : {}), ...(tap === 'off' ? { tapConfirm: 'off', tapConfirmReason: readable(attr(t.text, 'data-axf-tap-confirm-reason')) } : {}),
        assetDriven: asset != null || /data-axf-toolbar="app"/.test(t.text),
        buttons: controlsOf(inner),
      });
      if (!pages[owner.page]) pages[owner.page] = functionsOf(owner, f);
    }
  }
  const byApp = {}; const byKind = { assetDriven: 0, handwritten: 0, dynamicId: 0, noButtons: 0 };
  for (const t of toolbars) {
    byApp[t.app] = (byApp[t.app] ?? 0) + 1;
    if (t.assetDriven) byKind.assetDriven++; else byKind.handwritten++;
    if (t.dynamicId) byKind.dynamicId++;
    if (!t.buttons.length) byKind.noButtons++;
  }
  const ids = toolbars.map((t) => t.id);
  const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))].sort();
  return {
    $axf: FRAME,
    note: 'Generated by framework/cli/toolbar-inventory.mjs: every role="toolbar" with its settings id, page or plugin, current buttons and the page\'s real functions. Do not edit.',
    generatedAt: new Date().toISOString(),
    counts: { toolbars: toolbars.length, pages: Object.keys(pages).length, files: files.size, byApp, ...byKind, buttons: toolbars.reduce((n, t) => n + t.buttons.length, 0), duplicateIds: dupes.length },
    duplicateIds: dupes,
    toolbars,
    pages,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inv = buildToolbarInventory();
  if (args.includes('--json')) console.log(JSON.stringify(inv, null, 2));
  else {
    mkdirSync(dirname(OUT), { recursive: true });
    // axf-data: not data (build-time generator: writes a repo source file that is committed, not runtime data)
    writeFileSync(OUT, JSON.stringify(inv, null, 2) + '\n');
    const c = inv.counts;
    console.log(`✓ ${c.toolbars} toolbar(s) in ${c.files} file(s) → ${rel(OUT)}`);
    console.log(`  by app: ${Object.entries(c.byApp).map(([a, n]) => `${a} ${n}`).join(', ')}; asset-driven ${c.assetDriven}, handwritten ${c.handwritten}, dynamic ids ${c.dynamicId}, without buttons ${c.noButtons}, buttons ${c.buttons}`);
    if (inv.duplicateIds.length) console.log(`  settings ids used more than once: ${inv.duplicateIds.join(', ')}`);
  }
}
