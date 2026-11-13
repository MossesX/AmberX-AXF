#!/usr/bin/env node
/**
 * control-inventory — the console's static console-control@1 index (framework/spec/CONSOLE-CONTROL.md).
 *
 * Everything the console can show, known without a browser: every view (the shell's own and every plugin's), every
 * nav entry, every tab row and the tabs it declares literally, every settings tab and sub-tab, every setting declared
 * in code or in a settings asset, every registered action and every plugin. Each entry carries its console-control
 * address, a label and keywords, so the server can list, search and validate addresses while no console is open, and
 * the console can search screens that are not rendered yet.
 *
 *   node apps/console-web/scripts/control-inventory.mjs            write src/control/inventory.json
 *   node apps/console-web/scripts/control-inventory.mjs --check    exit 1 when the committed file is stale (CI)
 *   node apps/console-web/scripts/control-inventory.mjs --json     print it
 *
 * The file is generated: never edit it by hand. The scan is textual (literal ids only); a tab row whose id is built at
 * run time is listed with `dynamic: true` and is still addressable once rendered (the registry knows it then).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const OUT = join(APP, 'src/control/inventory.json');
const FRAME = 'console-control-inventory@1';

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const rel = (p) => relative(APP, p).split('\\').join('/');
const enc = (id) => String(id).replace(/%/g, '%25').replace(/\//g, '%2F');
const words = (...xs) => [...new Set(xs.flat().filter(Boolean).map((x) => String(x).trim()).filter(Boolean))].slice(0, 24);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(n) && !/\.(test|spec|d)\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ plugins */

function plugins() {
  const dir = join(APP, 'plugins');
  return readdirSync(dir).filter((d) => !d.startsWith('_') && existsSync(join(dir, d, 'plugin.json'))).sort().map((folder) => {
    const m = json(join(dir, folder, 'plugin.json'));
    return { folder, m, dir: join(dir, folder) };
  });
}

/** The plugin a source file belongs to (null for the console's own code). */
const ownerOf = (file, ps) => ps.find((p) => file.startsWith(p.dir + '/')) ?? null;

/* ------------------------------------------------------------------ views */

function shellViews() {
  const src = read(join(APP, 'src/App.tsx'));
  const block = src.slice(src.indexOf('const views: ViewMap = {'), src.indexOf('};', src.indexOf('const views: ViewMap = {')));
  const out = [];
  for (const m of block.matchAll(/^\s+'?([\w-]+)'?: \{ title: '([^']+)', icon: '([^']+)'/gm)) out.push({ id: m[1], title: m[2], icon: m[3] });
  return out;
}

/** Views a plugin's web code declares in `views: { … }` (literal titles; constant ids resolved inside the file). */
function pluginViewTitles(p) {
  const out = new Map();
  for (const f of walk(join(p.dir, 'web'))) {
    const src = read(f);
    const consts = new Map([...src.matchAll(/(?:const|export const) (\w+) = '([\w.-]+)'/g)].map((m) => [m[1], m[2]]));
    for (const m of src.matchAll(/(?:\[(\w+)\]|'([\w.-]+)'|\b([\w]+)): \{ title: '([^']+)'(?:, icon: '([^']+)')?(?:, keywords: \[([^\]]*)\])?/g)) {
      const id = m[1] ? consts.get(m[1]) : m[2] ?? m[3];
      if (!id) continue;
      out.set(id, { title: m[4], icon: m[5], keywords: (m[6] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [] });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ tab rows */

const SKIP_ATTR = /\bdata-axf-no-control\b/;

/** `<TabGroup id="x" … tabs={[{ value: 'a', label: 'A' }, …]}>`: literal ids and tabs. */
function tabRows(files, ps, viewOfPlugin) {
  const out = [];
  for (const f of files) {
    const src = read(f);
    let i = 0;
    while ((i = src.indexOf('<TabGroup', i)) >= 0) {
      const end = findTagEnd(src, i);
      const tag = src.slice(i, end);
      i = end;
      if (SKIP_ATTR.test(tag)) continue;
      const line = src.slice(0, src.indexOf(tag)).split('\n').length;
      const lit = tag.match(/\bid=(?:"([^"]+)"|\{'([^']+)'\}|\{"([^"]+)"\})/);
      const dyn = !lit && /\bid=\{/.test(tag);
      const id = lit ? (lit[1] ?? lit[2] ?? lit[3]) : dyn ? (tag.match(/\bid=\{`([^`$]*)/)?.[1] ?? '') + '*' : null;
      // tabs declared inline, or in a const array the tag names (tabs={TABS})
      let tabsSrc = tag;
      const named = tag.match(/\btabs=\{\(?(\w+)[\s)]*(?:\.(?:map|filter)\b|\})/);
      if (named) { const d = src.match(new RegExp(`const ${named[1]}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\n?\\]( as const)?;`)); if (d) tabsSrc = d[1]; }
      const tabs = [];
      const add = (value, label) => { if (!tabs.some((t) => t.value === value)) tabs.push({ value, label }); };
      for (const t of tabsSrc.matchAll(/\{\s*(?:value|id): '([^']+)',\s*label: '([^']+)'/g)) add(t[1], t[2]);
      for (const t of tabsSrc.matchAll(/\[\s*'([\w.-]+)',\s*'([^']+)'/g)) add(t[1], t[2]);
      const owner = ownerOf(f, ps);
      out.push({ id, dynamic: !!dyn || !id, file: rel(f), line, plugin: owner?.m.id ?? null, view: owner ? viewOfPlugin.get(owner.folder) ?? null : viewOfCoreFile(f), tabs });
    }
  }
  return out;
}

function findTagEnd(src, start) {
  let depth = 0;
  let j0 = start + '<TabGroup'.length;
  if (src[j0] === '<') j0 = src.indexOf('>', j0) + 1; // a type argument: <TabGroup<View> …>
  for (let j = j0; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && src[j - 1] !== '=') return j + 1;
  }
  return src.length;
}

/** The view a core source file renders in (by its name), else null (shared chrome: banner, dialogs). */
function viewOfCoreFile(f) {
  const name = f.split('/').pop().replace(/\.tsx?$/, '');
  const map = { Home: 'home', Tracker: 'tracker', Plan: 'plan', BuildManager: 'build', Pending: 'pending', Standards: 'standards-projects', Catalog: 'catalog', Libraries: 'libraries', DemosModules: 'demos', Boilerplates: 'boilerplates', Components: 'components', AssetStudio: 'assets', Account: 'account' };
  return map[name] ?? null;
}

/* ------------------------------------------------------------------ build */

export function buildInventory() {
  const ps = plugins();
  const views = [];
  const seen = new Set();
  const nav = json(join(APP, 'src/assets/nav-menu/console-nav.json')).data.sections ?? [];
  const navOf = new Map();
  for (const s of nav) for (const it of s.items ?? []) if (it.view) navOf.set(it.view, { section: s.label, label: it.label, id: it.id });

  for (const v of shellViews()) {
    seen.add(v.id);
    const n = navOf.get(v.id);
    views.push({ address: `view:${enc(v.id)}`, id: v.id, label: v.title, icon: v.icon, keywords: words(v.id, n?.label, n?.section), source: 'shell', ...(n ? { nav: n.section } : {}) });
  }
  if (!seen.has('settings')) { seen.add('settings'); views.push({ address: 'view:settings', id: 'settings', label: 'Settings', icon: 'settings', keywords: ['settings', 'preferences', 'options', 'Account'], source: 'framework', nav: 'Account' }); }

  const viewOfPlugin = new Map();
  for (const p of ps) {
    const titles = pluginViewTitles(p);
    const ids = (p.m.provides ?? []).filter((x) => x.startsWith('view:')).map((x) => x.slice(5));
    if (ids[0]) viewOfPlugin.set(p.folder, p.m.tabable?.view ?? ids[0]);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const t = titles.get(id);
      const label = t?.title ?? (p.m.tabable?.view === id ? p.m.tabable.label : null) ?? p.m.name;
      views.push({ address: `view:${enc(id)}`, id, label, icon: t?.icon ?? p.m.tabable?.icon ?? 'box', keywords: words(id, p.m.name, t?.keywords ?? []), source: 'plugin', plugin: p.m.id });
    }
  }

  const files = [...walk(join(APP, 'src')).filter((f) => !f.includes('/src/axf/')), ...ps.flatMap((p) => walk(join(p.dir, 'web')))];
  const rows = tabRows(files, ps, viewOfPlugin);
  // framework tab rows the console renders (settings), with their addresses from the settings library
  const tabGroups = rows.map((r) => {
    const base = r.view ? `view:${enc(r.view)}/` : '';
    const address = r.dynamic ? null : `${base}tab:${enc(r.id)}`;
    return { ...(address ? { address } : {}), id: r.id, dynamic: r.dynamic, view: r.view, plugin: r.plugin, file: r.file, line: r.line,
      tabs: r.tabs.map((t) => ({ ...(address ? { address: `${address}=${enc(t.value)}` } : {}), value: t.value, label: t.label })) };
  });

  const navItems = nav.flatMap((s) => (s.items ?? []).map((it) => ({ address: it.view ? `view:${enc(it.view)}` : null, id: it.id, label: it.label, section: s.label, icon: it.icon })));

  return {
    $axf: FRAME,
    note: 'Generated by apps/console-web/scripts/control-inventory.mjs: do not edit.',
    counts: { views: views.length, nav: navItems.length, tabGroups: tabGroups.length, tabs: tabGroups.reduce((n, g) => n + g.tabs.length, 0) },
    views, nav: navItems, tabGroups,
  };
}

/* ------------------------------------------------------------------ cli */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inv = buildInventory();
  const text = JSON.stringify(inv, null, 2) + '\n';
  if (process.argv.includes('--json')) process.stdout.write(text);
  else if (process.argv.includes('--check')) {
    const now = existsSync(OUT) ? read(OUT) : '';
    if (now !== text) { console.error(`${rel(OUT)} is stale: run node apps/console-web/scripts/control-inventory.mjs`); process.exit(1); }
    console.log(`${rel(OUT)} current (${Object.entries(inv.counts).map(([k, v]) => `${v} ${k}`).join(', ')})`);
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${rel(OUT)} (${Object.entries(inv.counts).map(([k, v]) => `${v} ${k}`).join(', ')})`);
  }
}
