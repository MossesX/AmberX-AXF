#!/usr/bin/env node
// Every framework plugin and whether it is built or planned (plugin-index@1).
//   node framework/cli/plugins.mjs            list
//   node framework/cli/plugins.mjs --json     the same as JSON
//   node framework/cli/plugins.mjs --check    validate framework/catalog/plugins.json and every plugin's `tabable` (exit 1 on problems)
// Built = a plugin@1 manifest exists (apps/*/plugins/<folder>/plugin.json, "_" folders are templates).
// Planned = listed in framework/catalog/plugins.json with no built plugin of the same id.
// Installed is per app (built + enabled there), so the console works it out itself.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './persist.mjs';
import { applyDefaults } from './build-defaults.mjs';
import { instanceClashes } from './plugin-instances.mjs';
import { validateAsset } from './build-engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = 'framework/catalog/plugins.json';
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/**
 * toolbar-binding@1 (Brett, Oct 27 2026): every toolbar asset file a plugin ships (any *.json under its folder with
 * "type": "toolbar") must be a plugin toolbar of that plugin (owner.kind "plugin", owner.plugin = its id) and name the
 * element it controls (attach), or the plugin doesn't validate. Toolbars registered from code are checked at runtime
 * (AssetRegistry.registerPluginAsset).
 */
export function pluginToolbarProblems(p, root = ROOT) {
  const out = [];
  const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) return [];
    const f = join(d, e.name);
    return e.isDirectory() ? walk(f) : e.name.endsWith('.json') && e.name !== 'plugin.json' ? [f] : [];
  }) : []);
  for (const f of walk(join(root, p.folder))) {
    let raw;
    try { raw = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (raw?.$axf !== 'asset@1' || raw.type !== 'toolbar') continue;
    const r = validateAsset(raw, { plugin: p.id });
    for (const e of r.errors) out.push(`${f.slice(root.length + 1)}: ${e}`);
  }
  return out;
}

export function builtPlugins(root = ROOT) {
  const out = [];
  const apps = join(root, 'apps');
  for (const app of existsSync(apps) ? readdirSync(apps) : []) {
    const dir = join(apps, app, 'plugins');
    if (!existsSync(dir)) continue;
    for (const folder of readdirSync(dir)) {
      const f = join(dir, folder, 'plugin.json');
      if (folder.startsWith('_') || !existsSync(f)) continue;
      try {
        const m = readJson(f);
        if (m.$axf !== 'plugin@1') continue;
        out.push({ id: m.id, name: m.name, version: m.version, target: (m.targets ?? [])[0] ?? '', description: m.description ?? '', folder: `apps/${app}/plugins/${folder}`, status: 'built', tabable: pluginTab(m), banner: pluginBanners(m), builtWith: m.builtWith?.model ? { model: m.builtWith.model, builtAt: m.builtWith.builtAt ?? '' } : null, opens: m.opens ?? false, manifest: m });
      } catch { /* a broken manifest is the plugin's own problem; the console reports it */ }
    }
  }
  return out;
}

/**
 * `tabable` (plugin@1, Oct 22 2026): can a host app (Patches) add this plugin to its tab group? Every plugin declares it
 * (false by default); `true` = its first page (`view:<id>` in provides), `{view, label?, icon?}` = that page, which it
 * must provide. A plugin without a page (settings only) can't be tabable.
 */
const VIEW_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const views = (m) => (Array.isArray(m?.provides) ? m.provides : []).filter((p) => typeof p === 'string' && p.startsWith('view:')).map((p) => p.slice(5));

export function checkTabable(m) {
  const problems = [];
  const t = m?.tabable;
  if (t === undefined) return ['"tabable" is missing (false unless a host may show its page as a tab)'];
  if (t === false) return problems;
  if (t === true) { if (!views(m).length) problems.push('"tabable": true needs a page (a "view:<id>" in provides)'); return problems; }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['"tabable" is false, true or {view, label?, icon?}'];
  for (const k of Object.keys(t)) if (!['view', 'label', 'icon'].includes(k)) problems.push(`"tabable" has an unknown key "${k}"`);
  if (typeof t.view !== 'string' || !VIEW_ID.test(t.view)) problems.push('"tabable".view is a view id');
  else if (!views(m).includes(t.view)) problems.push(`"tabable".view "${t.view}" isn't a page it provides ("view:${t.view}")`);
  if (t.label !== undefined && (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 80)) problems.push('"tabable".label is short text');
  if (t.icon !== undefined && (typeof t.icon !== 'string' || !ICON_ID.test(t.icon))) problems.push('"tabable".icon is an icon name');
  return problems;
}

/**
 * `banner` (plugin@1, Oct 23 2026): does this plugin include a banner (`AxfWebLibrary.banners`, the live banners above
 * every page)? Every plugin declares it: `false`, or the ids of the banners it contributes. Every banner a plugin
 * declares gets the shared banner settings (Hide, Hide all banners, the hide timer; react/components/BannerSettings.tsx).
 * Checked against the plugin's web code: the ids it declares are exactly the ids in its `banners: [...]`.
 */
const BANNER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The banner ids a plugin's web code contributes (`banners: [{ id: '…', … }]`), read from the source text. */
export function bannerIdsInSource(text) {
  const out = [];
  const re = /\bbanners\s*:\s*\[/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex, objDepth = 0;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === '{') { objDepth++; if (objDepth === 1) { const id = /^\{\s*id\s*:\s*['"]([^'"]+)['"]/.exec(text.slice(i)); if (id) out.push(id[1]); } }
      else if (c === '}') objDepth--;
    }
  }
  return [...new Set(out)];
}

export function checkBanner(m, sourceIds = null) {
  const b = m?.banner;
  if (b === undefined) return ['"banner" is missing (false, or the ids of the banners it includes)'];
  if (b !== false && !(Array.isArray(b) && b.length && b.every((x) => typeof x === 'string' && BANNER_ID.test(x)) && new Set(b).size === b.length)) return ['"banner" is false or a list of banner ids'];
  if (sourceIds) {
    const declared = b === false ? [] : b;
    const missing = sourceIds.filter((id) => !declared.includes(id));
    const extra = declared.filter((id) => !sourceIds.includes(id));
    const out = [];
    if (missing.length) out.push(`"banner" doesn't list ${missing.map((x) => `"${x}"`).join(', ')}, which its web code contributes`);
    if (extra.length) out.push(`"banner" lists ${extra.map((x) => `"${x}"`).join(', ')}, which its web code doesn't contribute`);
    return out;
  }
  return [];
}

/** The banner ids every .ts/.tsx file under a plugin's web/ folder contributes (vendor/ skipped). */
export function webBannerIds(folder) {
  const out = new Set();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) { if (f.name !== 'vendor' && f.name !== 'node_modules') walk(join(d, f.name)); }
      else if (/\.(tsx?|mjs)$/.test(f.name)) for (const id of bannerIdsInSource(readFileSync(join(d, f.name), 'utf8'))) out.add(id);
    }
  };
  walk(join(folder, 'web'));
  return [...out];
}

/** The banner ids a plugin declares ([] = none). */
export function pluginBanners(m) { return Array.isArray(m?.banner) && !checkBanner(m).length ? [...m.banner] : []; }

/** The tab a plugin offers ({view, label, icon}) or null when it isn't tabable (or its declaration is wrong). */
export function pluginTab(m) {
  if (checkTabable(m).length || !m.tabable) return null;
  const t = m.tabable === true ? { view: views(m)[0] } : m.tabable;
  return { view: t.view, label: t.label ?? m.name, ...(t.icon ? { icon: t.icon } : {}) };
}

export function checkIndex(index, { pending = [], plan = [] } = {}) {
  const problems = [];
  if (index?.$axf !== 'plugin-index@1') problems.push('$axf must be "plugin-index@1"');
  const items = Array.isArray(index?.items) ? index.items : (problems.push('items must be a list'), []);
  const seen = new Set();
  for (const [i, it] of items.entries()) {
    const at = `items[${i}]${it?.id ? ` (${it.id})` : ''}`;
    for (const k of ['id', 'name', 'target']) if (typeof it?.[k] !== 'string' || !it[k].trim()) problems.push(`${at}: ${k} is required`);
    if (it?.id && seen.has(it.id)) problems.push(`${at}: id listed twice`);
    seen.add(it?.id);
    if (it?.pending && !pending.some((p) => p.id === it.pending)) problems.push(`${at}: pending item "${it.pending}" not on the pending list`);
    if (it?.plan && !plan.some((p) => p.id === it.plan)) problems.push(`${at}: plan item "${it.plan}" not in the plan`);
    if (it?.model && !['fable', 'opus', 'sonnet'].includes(it.model)) problems.push(`${at}: model must be fable, opus or sonnet`);
  }
  return problems;
}

/** Built plugins plus planned ones not built yet, sorted by name. */
export function allPlugins(root = ROOT) {
  const built = builtPlugins(root);
  const index = readJson(join(root, INDEX));
  const planned = (index.items ?? []).filter((p) => !built.some((b) => b.id === p.id)).map((p) => ({ ...p, status: 'planned' }));
  return [...built, ...planned].sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const load = (rel, key) => { try { const j = readJson(dataPath(rel)); return Array.isArray(j) ? j : j[key] ?? j.items ?? []; } catch { return []; } };
    const problems = checkIndex(readJson(join(ROOT, INDEX)), { pending: load('framework/plan/pending.json', 'items'), plan: load('framework/plan/plan.json', 'features') });
    const done = allPlugins().filter((p) => p.status === 'built').map((p) => p.id);
    for (const it of readJson(join(ROOT, INDEX)).items ?? []) if (done.includes(it.id)) console.log(`note: ${it.id} is built now; its planned entry can go`);
    for (const p of builtPlugins()) for (const x of checkTabable(p.manifest)) problems.push(`${p.folder}/plugin.json: ${x}`);
    for (const p of builtPlugins()) for (const x of checkBanner(p.manifest, webBannerIds(join(ROOT, p.folder)))) problems.push(`${p.folder}/plugin.json: ${x}`);
    // build-defaults@1 (Oct 23 2026): every rule for plugins holds (a missing default = run build-defaults.mjs apply --write)
    for (const p of builtPlugins()) {
      const r = applyDefaults('plugin', p.manifest);
      for (const x of r.problems) problems.push(`${p.folder}/plugin.json: ${x.message} (${x.rule})`);
      for (const f of r.filled) problems.push(`${p.folder}/plugin.json: "${f.field}" is missing; the build engine's default is ${JSON.stringify(f.value)} (${f.rule}; node framework/cli/build-defaults.mjs apply --write)`);
    }
    // toolbar-binding@1 (Brett, Oct 27 2026): a toolbar asset a plugin ships must be a plugin toolbar of that plugin
    for (const p of builtPlugins()) for (const x of pluginToolbarProblems(p)) problems.push(x);
    // one instance per plugin (Brett, Oct 23 2026): never two folders with one plugin, whatever model built them
    for (const c of instanceClashes(builtPlugins().map((p) => ({ folder: p.folder, manifest: p.manifest })))) problems.push(c.message);
    if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
    const tabs = builtPlugins().filter((p) => p.tabable);
    const withBanner = builtPlugins().filter((p) => p.banner.length);
    const byModel = {};
    for (const p of builtPlugins()) byModel[p.builtWith?.model ?? '?'] = (byModel[p.builtWith?.model ?? '?'] ?? 0) + 1;
    console.log(`✓ built with: ${Object.entries(byModel).map(([k, n]) => `${k} ${n}`).join(', ')}; one instance of every plugin`);
    console.log(`✓ ${INDEX} ok; every plugin declares tabable (${tabs.length} tabable: ${tabs.map((p) => p.name).join(', ') || 'none'}) and banner (${withBanner.length} with banners: ${withBanner.map((p) => p.name).join(', ') || 'none'})`);
  } else if (args.includes('--json')) {
    console.log(JSON.stringify({ items: allPlugins().map(({ manifest, ...p }) => p) }, null, 2));
  } else {
    for (const p of allPlugins()) console.log(`${p.status.padEnd(8)} ${p.name}  (${p.id})${p.folder ? `  ${p.folder}` : ''}`);
  }
}
