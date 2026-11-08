#!/usr/bin/env node
/**
 * menu-gen — generate an app's nested menus (nested-menu@1, core/engines/menugen.mjs) from its files: the shared
 * app-menu and nav-menu assets its manifest names, and every plugin's declared UI (plugin.json `provides`:
 * view:/dialog:/settings-tab:, plus an optional `menu: { category, subcategory, keywords }`). The running app does the
 * same from its live registry (framework/react/generatedMenus.tsx); this is the offline twin for reports, UI Review
 * options and tests, so the three apps' menus are generated the same exact way.
 *
 *   node framework/cli/menu-gen.mjs <appDir> [--max 12] [--style list|rail|pills] [--depth 3]
 *        [--out <dir>]        write <dir>/app-menu/<app>-generated.json and <dir>/nav-menu/<app>-generated.json
 *        [--id <asset id>]    another asset id for the written files (UI Review options)
 *        [--name "…"]         another asset name
 *        [--outline] [--nav]  print the tree (the navigation's page tree with --nav)
 *        [--json]             one JSON result: stats, notes, index, assets
 *   node framework/cli/menu-gen.mjs sources <appDir> [--json]     the registry entries found, one per line
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMenuAssets, treeOutline } from '../core/engines/menugen.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

function findAsset(appDir, type, id) {
  const places = [join(appDir, 'src/assets', type, `${id}.json`), join(appDir, 'src/assets-overrides', type, `${id}.json`), join(appDir, 'src/axf/assets', type, `${id}.json`), join(ROOT, 'framework/assets', type, `${id}.json`)];
  const f = places.find((p) => existsSync(p));
  return f ? readJson(f) : null;
}

function pluginDirs(appDir) {
  const out = [];
  for (const rel of ['plugins', 'src/plugins']) {
    const d = join(appDir, rel);
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d).sort()) if (!n.startsWith('_') && !n.startsWith('.') && existsSync(join(d, n, 'plugin.json'))) out.push(join(d, n));
  }
  return out;
}

/** Console plugins that also run inside this app (plugin.json `targets`). */
function consolePluginsFor(appId) {
  const d = join(ROOT, 'apps/console-web/plugins');
  if (!existsSync(d)) return [];
  return readdirSync(d).sort().filter((n) => !n.startsWith('_') && existsSync(join(d, n, 'plugin.json'))).map((n) => join(d, n)).filter((p) => { try { return (readJson(join(p, 'plugin.json')).targets ?? []).includes(appId); } catch { return false; } });
}

/** The registry entries an app's files declare. */
export function staticSources(appDir) {
  const manifest = readJson(join(appDir, 'axf.manifest.json'));
  const appId = manifest.app.id;
  const out = [];
  const nav = findAsset(appDir, 'nav-menu', manifest.defaults['nav-menu']);
  const walkNav = (items, hint) => { for (const it of items ?? []) { if (it.view) out.push({ kind: /^apps$/i.test(hint ?? '') ? 'app' : 'page', view: it.view, action: `nav:${it.view}`, label: it.label, icon: it.icon, requires: it.requires, badge: it.badge, hint, module: 'app' }); walkNav(it.items, hint ?? it.label); } };
  for (const s of nav?.data?.sections ?? []) walkNav(s.items, s.label ?? undefined);
  const menu = findAsset(appDir, 'app-menu', manifest.defaults['app-menu']);
  const walkMenu = (items, hint, hintId, trail) => {
    for (const it of items ?? []) {
      if (it.separator) continue;
      if (it.provider) out.push({ kind: 'list', provider: it.provider, label: it.label, icon: it.icon, requires: it.requires, hint, hintId, keywords: trail, module: 'app' });
      else if (it.action) out.push({ action: it.action, label: it.label, icon: it.icon, requires: it.requires, badge: it.badge, shortcut: it.shortcut, hint, hintId, keywords: trail, module: 'app' });
      if (it.items) walkMenu(it.items, hint, hintId, [...trail, it.label].filter(Boolean));
    }
  };
  for (const m of menu?.data?.menus ?? []) walkMenu(m.items, m.label, m.id, []);
  const seenPlugins = new Set();
  for (const dir of [...pluginDirs(appDir), ...(appId === 'axf-console' ? [] : consolePluginsFor(appId))]) {
    let p;
    try { p = readJson(join(dir, 'plugin.json')); } catch { continue; }
    if (!p?.id || seenPlugins.has(p.id)) continue;
    seenPlugins.add(p.id);
    const ui = (p.provides ?? []).filter((x) => /^(view|dialog|settings-tab):/.test(x));
    const declared = typeof p.menu === 'object' && p.menu ? p.menu : {};
    const base = { module: p.id, moduleLabel: p.name ?? p.id, category: declared.category, subcategory: declared.subcategory, keywords: [...(declared.keywords ?? []), ...(p.name ? [p.name] : [])] };
    const views = ui.filter((x) => x.startsWith('view:'));
    for (const x of ui) {
      const [kind, id] = [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)];
      if (kind === 'view') out.push({ ...base, kind: 'page', view: id, action: `nav:${id}`, label: views.length === 1 ? p.name : undefined, icon: 'layout' });
      else if (kind === 'dialog') out.push({ ...base, kind: 'dialog', action: `dialog:${id}`, label: ui.length === 1 ? p.name : undefined, icon: 'box' });
      else out.push({ ...base, kind: 'settings', action: `settings.open:${id}`, label: `${p.name} settings`, icon: 'settings' });
    }
  }
  return { appId, appLabel: manifest.app.name, sources: out };
}

export function generateFor(appDir, opts = {}) {
  const { appId, appLabel, sources } = staticSources(appDir);
  const gen = generateMenuAssets(sources, { app: appId, appLabel, maxPerLevel: opts.max, style: opts.style, maxDepth: opts.depth, favorites: opts.favorites, recents: opts.recents });
  if (opts.id) { gen.appMenu.id = opts.id; gen.navMenu.id = opts.id; }
  if (opts.name) { gen.appMenu.name = opts.name; gen.navMenu.name = `${opts.name} navigation`; }
  return { appId, appLabel, sources, ...gen };
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) o[k] = true; else { o[k] = next; i++; }
  }
  return o;
}

export function main(argv = process.argv.slice(2)) {
  const a = args(argv);
  const cmd = a._[0] === 'sources' ? 'sources' : 'generate';
  const appDir = resolve(a._[cmd === 'sources' ? 1 : 0] ?? '.');
  if (!existsSync(join(appDir, 'axf.manifest.json'))) { console.error(`menu-gen: ${appDir} has no axf.manifest.json`); process.exitCode = 2; return; }
  if (cmd === 'sources') {
    const { sources } = staticSources(appDir);
    if (a.json) console.log(JSON.stringify(sources));
    else for (const s of sources) console.log(`${(s.kind ?? 'action').padEnd(8)} ${(s.label ?? '').padEnd(32)} ${s.action ?? `list:${s.provider}`}  [${s.moduleLabel ?? s.module}]`);
    return;
  }
  const r = generateFor(appDir, { max: a.max ? Number(a.max) : undefined, style: a.style, depth: a.depth ? Number(a.depth) : undefined, id: a.id, name: a.name, favorites: a.favorites?.split(','), recents: a.recents?.split(',') });
  if (a.out) {
    for (const asset of [r.appMenu, r.navMenu]) {
      const f = join(resolve(a.out), asset.type, `${asset.id}.json`);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, `${JSON.stringify(asset, null, 2)}\n`);
      if (!a.json) console.log(`wrote ${f}`);
    }
  }
  if (a.json) { console.log(JSON.stringify({ app: r.appId, stats: r.stats, notes: r.notes, index: r.index, appMenu: r.appMenu, navMenu: r.navMenu })); return; }
  const s = r.stats;
  console.log(`${r.appLabel} (${r.appId}): ${s.sources} entries → ${s.categories} categories, ${s.groups} sub menus, widest level ${s.widest} (cap ${s.maxPerLevel}), deepest ${s.deepest}${s.unplaced ? `, ${s.unplaced} only in search` : ''}`);
  for (const n of r.notes) console.log(`note: ${n}`);
  if (a.outline || a.nav) console.log(treeOutline(r.tree, { nav: !!a.nav }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
