#!/usr/bin/env node
/**
 * toolbar-owner — every plugin has its own default toolbar, every toolbar is generic or built for one screen
 * (toolbar-owner@1, core/engines/toolbar-owner-rules.mjs; build every-plugin-gets-own-default-toolbar, Nov 18 2026).
 *
 *   node framework/cli/toolbar-owner.mjs defaults [--write]   default-<plugin>-toolbar of every console plugin
 *                                                             (apps/console-web/plugins/<folder>/assets/toolbar)
 *   node framework/cli/toolbar-owner.mjs backfill [--write]   data.builtFor on every toolbar asset that lacks it
 *   node framework/cli/toolbar-owner.mjs list [--json]        every toolbar with who it is built for
 *   node framework/cli/toolbar-owner.mjs choices <view> [<plugin>] [--json]   what a screen's picker offers
 *   node framework/cli/toolbar-owner.mjs check [--json]       CI: every plugin default present and right, every
 *                                                             toolbar has a valid builtFor, plugin toolbars are
 *                                                             built for their own plugin's screens
 *
 * Plugin folders are found by listing the plugins directory, never by name. Baked copies (src/axf/assets) are left
 * to shared-assets bake.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOOLBAR_GENERIC, parseToolbarBuiltFor, pluginToolbarDefaultAsset, pluginToolbarDefaultId, toolbarBuiltForErrors, toolbarBuiltForOf, toolbarChoices,
} from '../core/engines/toolbar-owner-rules.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const posix = (p) => p.split(sep).join('/');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-single', '.git', 'sessions', 'changes', '_claude']);

/** Console plugin folders (a folder with plugin.json; `_` folders are templates). */
export function pluginFolders(root = ROOT) {
  const dir = join(root, 'apps/console-web/plugins');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith('_') && !n.startsWith('.') && existsSync(join(dir, n, 'plugin.json'))).sort();
}

function pluginLabel(root, folder) {
  try { const j = readJson(join(root, 'apps/console-web/plugins', folder, 'plugin.json')); return typeof j.name === 'string' && j.name ? j.name : folder; } catch { return folder; }
}

/** Every plugin default this repo ships: `[{ plugin, file, asset }]`. */
export function plannedDefaults(root = ROOT) {
  return pluginFolders(root).map((f) => {
    const asset = pluginToolbarDefaultAsset(f, { label: pluginLabel(root, f) });
    return asset ? { plugin: f, file: join(root, 'apps/console-web/plugins', f, 'assets/toolbar', `${asset.id}.json`), asset } : null;
  }).filter(Boolean);
}

/** Every source toolbar asset file (baked copies left out). */
export function toolbarFiles(root = ROOT) {
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
      } else if (n.endsWith('.json') && posix(relative(root, d)).split('/').pop() === 'toolbar') {
        try { const j = readJson(p); if (j && j.$axf === 'asset@1' && j.type === 'toolbar') out.push(p); } catch { /* not json */ }
      }
    }
  };
  for (const top of ['framework/assets', 'apps']) if (existsSync(join(root, top))) walk(join(root, top));
  return out.sort();
}

/** The plugin folder a file sits in, or ''. */
export function folderOf(root, file) {
  const rel = posix(relative(join(root, 'apps/console-web/plugins'), file));
  return rel.startsWith('..') ? '' : rel.split('/')[0];
}

/** What builtFor a toolbar file gets when it has none: read from its scope, its id, else generic. */
export function backfillValue(root, file, asset) {
  return toolbarBuiltForOf(asset);
}

export function backfill(root = ROOT, write = false) {
  const changed = [];
  for (const f of toolbarFiles(root)) {
    const a = readJson(f);
    if (a.data && parseToolbarBuiltFor(a.data.builtFor)) continue;
    const v = backfillValue(root, f, a);
    changed.push({ file: posix(relative(root, f)), builtFor: v });
    if (write) { a.data = { ...(a.data ?? {}), builtFor: v }; writeJson(f, a); }
  }
  return changed;
}

export function writeDefaults(root = ROOT, write = false) {
  const changed = [];
  for (const { file, asset } of plannedDefaults(root)) {
    if (existsSync(file)) { try { const cur = readJson(file); if (cur.id === asset.id && cur.data?.builtFor === asset.data.builtFor) continue; } catch { /* rewrite */ } }
    changed.push(posix(relative(root, file)));
    if (write) writeJson(file, asset);
  }
  return changed;
}

export function list(root = ROOT) {
  return toolbarFiles(root).map((f) => { const a = readJson(f); return { id: a.id, file: posix(relative(root, f)), builtFor: toolbarBuiltForOf(a), scope: a.data?.scope ?? 'app', tags: a.tags ?? [] }; });
}

export function check(root = ROOT) {
  const problems = [];
  for (const { plugin, file, asset } of plannedDefaults(root)) {
    const rel = posix(relative(root, file));
    if (!existsSync(file)) { problems.push(`plugin:${plugin}: missing ${rel} (node framework/cli/toolbar-owner.mjs defaults --write)`); continue; }
    const a = readJson(file);
    if (a.id !== asset.id) problems.push(`${rel}: id must be ${asset.id}`);
    if (a.data?.builtFor !== `plugin:${plugin}`) problems.push(`${rel}: data.builtFor must be plugin:${plugin}`);
  }
  for (const f of toolbarFiles(root)) {
    const rel = posix(relative(root, f));
    const a = readJson(f);
    if (a.data?.builtFor === undefined) { problems.push(`${rel}: data.builtFor is missing (generic | view:<id> | plugin:<name>; node framework/cli/toolbar-owner.mjs backfill --write)`); continue; }
    const errs = toolbarBuiltForErrors(a.data.builtFor);
    if (errs.length) { problems.push(`${rel}: ${errs.join('; ')}`); continue; }
    const folder = folderOf(root, f);
    const b = parseToolbarBuiltFor(a.data.builtFor);
    if (folder && b.kind === 'plugin' && b.id !== folder) problems.push(`${rel}: a toolbar in plugins/${folder} is built for plugin:${b.id}; it must be generic, a view, or plugin:${folder}`);
    if (!folder && b.kind !== 'generic' && posix(rel).startsWith('framework/assets/')) problems.push(`${rel}: a shared framework toolbar must be generic (it is offered on every screen)`);
    const did = pluginToolbarDefaultId(folder);
    if (folder && a.id.startsWith('default-') && a.id.endsWith('-toolbar') && a.id !== did) problems.push(`${rel}: default toolbar id must be ${did}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ CLI */

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'check', ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  const json = flags.has('--json');
  const write = flags.has('--write');
  const print = (v, text) => console.log(json ? JSON.stringify(v, null, 2) : text);
  if (cmd === 'defaults') { const c = writeDefaults(ROOT, write); print(c, c.length ? `${write ? 'wrote' : 'would write'} ${c.length}:\n${c.join('\n')}` : 'every plugin default toolbar is in place'); }
  else if (cmd === 'backfill') { const c = backfill(ROOT, write); print(c, c.length ? `${write ? 'set' : 'would set'} builtFor on ${c.length}:\n${c.map((x) => `${x.file} → ${x.builtFor}`).join('\n')}` : 'every toolbar has a builtFor'); }
  else if (cmd === 'list') { const l = list(ROOT); print(l, l.map((x) => `${x.builtFor === TOOLBAR_GENERIC ? 'generic ' : 'screen  '} ${x.id.padEnd(44)} ${x.builtFor}`).join('\n')); }
  else if (cmd === 'choices') {
    const [view = '', plugin = ''] = args;
    const assets = toolbarFiles(ROOT).map(readJson).filter((a) => !(a.tags ?? []).includes('ui-choice'));
    const c = toolbarChoices({ view: view || null, plugin: plugin || null }, assets);
    print(c, c.map((x) => `${x.isDefault ? '* ' : '  '}${x.generic ? 'generic' : 'screen '} ${x.id}`).join('\n') || 'nothing to offer');
  } else if (cmd === 'check') {
    const p = check(ROOT);
    if (json) console.log(JSON.stringify({ ok: !p.length, problems: p }, null, 2));
    else console.log(p.length ? `toolbar-owner@1: ${p.length} problem(s)\n${p.join('\n')}` : `toolbar-owner@1: ok (${plannedDefaults(ROOT).length} plugin defaults, ${toolbarFiles(ROOT).length} toolbars)`);
    process.exit(p.length ? 1 : 0);
  } else { console.error('usage: toolbar-owner.mjs defaults|backfill|list|choices|check [--write] [--json]'); process.exit(2); }
}
