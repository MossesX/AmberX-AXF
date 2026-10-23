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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = 'framework/catalog/plugins.json';
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

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
        out.push({ id: m.id, name: m.name, version: m.version, target: (m.targets ?? [])[0] ?? '', description: m.description ?? '', folder: `apps/${app}/plugins/${folder}`, status: 'built', tabable: pluginTab(m), manifest: m });
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
    if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
    const tabs = builtPlugins().filter((p) => p.tabable);
    console.log(`✓ ${INDEX} ok; every plugin declares tabable (${tabs.length} tabable: ${tabs.map((p) => p.name).join(', ') || 'none'})`);
  } else if (args.includes('--json')) {
    console.log(JSON.stringify({ items: allPlugins().map(({ manifest, ...p }) => p) }, null, 2));
  } else {
    for (const p of allPlugins()) console.log(`${p.status.padEnd(8)} ${p.name}  (${p.id})${p.folder ? `  ${p.folder}` : ''}`);
  }
}
