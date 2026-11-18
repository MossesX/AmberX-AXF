#!/usr/bin/env node
/**
 * settings-iface — every asset type and every plugin has its own settings interface (settings-iface@1,
 * core/engines/settings-iface-rules.mjs; build settings-iface-default-all, Nov 18 2026).
 *
 *   node framework/cli/settings-iface.mjs defaults [--write]   the default-<name> asset of every asset type
 *                                                              (framework/assets/settings) and every console plugin
 *                                                              (apps/console-web/plugins/<folder>/assets/settings)
 *   node framework/cli/settings-iface.mjs backfill [--write]   data.builtFor on every settings asset that lacks it
 *   node framework/cli/settings-iface.mjs check [--json]       CI: every default present and right, every settings
 *                                                              asset has a valid builtFor, plugin files are built
 *                                                              for their own plugin (or a chrome kind), no sharing
 *
 * Plugin folders are found by listing the plugins directory, never by name. Baked copies (src/axf/assets) are left
 * to shared-assets bake.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtForErrors, builtForOf, ifaceDefaultAsset, ifaceDefaultId, parseBuiltFor } from '../core/engines/settings-iface-rules.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PLUGINS = join(ROOT, 'apps/console-web/plugins');
const posix = (p) => p.split(sep).join('/');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-single', '.git', 'sessions', 'changes', '_claude']);

export function assetTypes(root = ROOT) {
  return Object.keys(readJson(join(root, 'framework/schemas/asset-types.json')).types);
}

/** Console plugin folders (a folder with plugin.json; `_` folders are templates). */
export function pluginFolders(root = ROOT) {
  const dir = join(root, 'apps/console-web/plugins');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith('_') && !n.startsWith('.') && existsSync(join(dir, n, 'plugin.json'))).sort();
}

function pluginLabel(root, folder) {
  try { const j = readJson(join(root, 'apps/console-web/plugins', folder, 'plugin.json')); return typeof j.name === 'string' && j.name ? j.name : folder; } catch { return folder; }
}

/** Every default this repo ships: `[{ owner, file, asset }]`. */
export function plannedDefaults(root = ROOT) {
  const types = assetTypes(root);
  const spec = readJson(join(root, 'framework/schemas/asset-types.json')).types;
  const out = [];
  for (const t of types) {
    const owner = `asset:${t}`;
    const asset = ifaceDefaultAsset(owner, { label: spec[t]?.label ?? t, assetTypes: types });
    out.push({ owner, file: join(root, 'framework/assets/settings', `${asset.id}.json`), asset });
  }
  for (const f of pluginFolders(root)) {
    const owner = `plugin:${f}`;
    if (!parseBuiltFor(owner)) continue;
    const asset = ifaceDefaultAsset(owner, { label: pluginLabel(root, f), assetTypes: types });
    out.push({ owner, file: join(root, 'apps/console-web/plugins', f, 'assets/settings', `${asset.id}.json`), asset });
  }
  return out;
}

/** Every source settings asset file (baked copies left out). */
export function settingsFiles(root = ROOT) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (SKIP_DIRS.has(n)) continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) {
        const rel = posix(relative(root, p));
        if (/\/src\/axf$/.test(rel) || /\/assets\/axf$/.test(rel) || rel.endsWith('/build') || rel.startsWith('framework/spec')) continue;
        walk(p);
      } else if (n.endsWith('.json') && posix(relative(root, d)).split('/').pop() === 'settings') {
        try { const j = readJson(p); if (j && j.$axf === 'asset@1' && j.type === 'settings') out.push(p); } catch { /* not json */ }
      }
    }
  };
  for (const top of ['framework/assets', 'apps']) if (existsSync(join(root, top))) walk(join(root, top));
  return out.sort();
}

/** The plugin folder a file sits in, or ''. */
function folderOf(root, file) {
  const rel = posix(relative(join(root, 'apps/console-web/plugins'), file));
  return rel.startsWith('..') ? '' : rel.split('/')[0];
}

/** What builtFor a file without one gets: the chrome kind it names, its plugin, its default id, else the Settings page. */
export function backfillValue(root, file, asset, types = assetTypes(root)) {
  const d = asset.data ?? {};
  if (typeof d.for === 'string' && parseBuiltFor(`chrome:${d.for}`)) return `chrome:${d.for}`;
  const folder = folderOf(root, file);
  if (folder && parseBuiltFor(`plugin:${folder}`)) return `plugin:${folder}`;
  return builtForOf(asset, types);
}

export function backfill(root = ROOT, write = false) {
  const types = assetTypes(root);
  const changed = [];
  for (const f of settingsFiles(root)) {
    const a = readJson(f);
    if (a.data && parseBuiltFor(a.data.builtFor)) continue;
    const v = backfillValue(root, f, a, types);
    changed.push({ file: posix(relative(root, f)), builtFor: v });
    if (write) { a.data = { ...(a.data ?? {}), builtFor: v }; writeJson(f, a); }
  }
  return changed;
}

export function writeDefaults(root = ROOT, write = false) {
  const changed = [];
  for (const { file, asset } of plannedDefaults(root)) {
    const now = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const next = `${JSON.stringify(asset, null, 2)}\n`;
    if (now) { try { const cur = readJson(file); if (cur.data?.builtFor === asset.data.builtFor) continue; } catch { /* rewrite */ } }
    changed.push(posix(relative(root, file)));
    if (write) writeJson(file, JSON.parse(next));
  }
  return changed;
}

export function check(root = ROOT) {
  const problems = [];
  const types = assetTypes(root);
  for (const { owner, file, asset } of plannedDefaults(root)) {
    const rel = posix(relative(root, file));
    if (!existsSync(file)) { problems.push(`${owner}: missing ${rel} (node framework/cli/settings-iface.mjs defaults --write)`); continue; }
    const a = readJson(file);
    if (a.id !== asset.id) problems.push(`${rel}: id must be ${asset.id}`);
    if (a.data?.builtFor !== owner) problems.push(`${rel}: data.builtFor must be ${owner}`);
  }
  const ids = new Map();
  for (const f of settingsFiles(root)) {
    const rel = posix(relative(root, f));
    const a = readJson(f);
    const errs = builtForErrors(a.data?.builtFor);
    if (errs.length) { problems.push(`${rel}: ${errs.join('; ')} (node framework/cli/settings-iface.mjs backfill --write)`); continue; }
    const o = parseBuiltFor(a.data.builtFor);
    const folder = folderOf(root, f);
    if (folder && !(o.kind === 'chrome' || a.data.builtFor === `plugin:${folder}`)) problems.push(`${rel}: a plugin's settings interface is built for that plugin (plugin:${folder}) or a chrome kind, not ${a.data.builtFor}`);
    if (o.kind === 'asset' && !types.includes(o.name)) problems.push(`${rel}: builtFor ${a.data.builtFor} names no asset type`);
    if (a.id.startsWith('default-') && ifaceDefaultId(a.data.builtFor, types) !== a.id) problems.push(`${rel}: default-* ids are reserved for the default of their owner (${a.data.builtFor} → ${ifaceDefaultId(a.data.builtFor, types)})`);
    const app = rel.startsWith('apps/') ? rel.split('/')[1] : '*';
    const key = `${app}:${a.id}`;
    if (ids.has(key) && app !== '*') problems.push(`${rel}: id ${a.id} also in ${ids.get(key)}`);
    ids.set(key, rel);
  }
  return problems;
}

async function main(argv) {
  const [cmd = 'check', ...rest] = argv;
  const write = rest.includes('--write');
  const json = rest.includes('--json');
  if (cmd === 'defaults') { const c = writeDefaults(ROOT, write); console.log(json ? JSON.stringify({ ok: true, changed: c }) : `${write ? 'wrote' : 'would write'} ${c.length} default(s)${c.length ? `\n  ${c.join('\n  ')}` : ''}`); return 0; }
  if (cmd === 'backfill') { const c = backfill(ROOT, write); console.log(json ? JSON.stringify({ ok: true, changed: c }) : `${write ? 'backfilled' : 'would backfill'} ${c.length} file(s)${c.length ? `\n  ${c.map((x) => `${x.file} → ${x.builtFor}`).join('\n  ')}` : ''}`); return 0; }
  if (cmd === 'check') {
    const p = check(ROOT);
    if (json) console.log(JSON.stringify({ ok: !p.length, problems: p }));
    else console.log(p.length ? `settings-iface: ${p.length} problem(s)\n  ${p.join('\n  ')}` : `settings-iface: ok (${plannedDefaults(ROOT).length} defaults, ${settingsFiles(ROOT).length} settings assets)`);
    return p.length ? 1 : 0;
  }
  console.error('usage: settings-iface.mjs defaults|backfill [--write] | check [--json]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
