#!/usr/bin/env node
// Every framework plugin and whether it is built or planned (plugin-index@1).
//   node framework/cli/plugins.mjs            list
//   node framework/cli/plugins.mjs --json     the same as JSON
//   node framework/cli/plugins.mjs --check    validate framework/catalog/plugins.json (exit 1 on problems)
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
        out.push({ id: m.id, name: m.name, version: m.version, target: (m.targets ?? [])[0] ?? '', description: m.description ?? '', folder: `apps/${app}/plugins/${folder}`, status: 'built' });
      } catch { /* a broken manifest is the plugin's own problem; the console reports it */ }
    }
  }
  return out;
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
    if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
    console.log(`✓ ${INDEX} ok`);
  } else if (args.includes('--json')) {
    console.log(JSON.stringify({ items: allPlugins() }, null, 2));
  } else {
    for (const p of allPlugins()) console.log(`${p.status.padEnd(8)} ${p.name}  (${p.id})${p.folder ? `  ${p.folder}` : ''}`);
  }
}
