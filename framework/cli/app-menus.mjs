#!/usr/bin/env node
/**
 * app-menus — every app has its own locked default navigation menu and application menu (app-menus@1,
 * core/engines/app-menus-rules.mjs; build every-app-gets-own-locked-default, Nov 18 2026).
 *
 *   node framework/cli/app-menus.mjs list [--json]        each app's menus: default, choices, manifest defaults
 *   node framework/cli/app-menus.mjs backfill [--write]   write default-<app>-nav / default-<app>-appmenu (a copy of
 *                                                         the menu the app uses now), point the manifest at them,
 *                                                         and give every menu the app ships data.builtFor
 *   node framework/cli/app-menus.mjs check [--json]       CI: every app has both defaults, built for it, the manifest
 *                                                         names them, no app menu is built for another app or shared
 *
 * Apps are found by listing apps/ (an app with axf.manifest.json whose defaults name a nav-menu or app-menu), never by
 * name. Android (android-compose) apps are left out: their twin is deferred (framework/spec/PORTING.md). Baked copies (src/axf/assets) are left alone: those shared menus are never offered (app-menus@1).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_MENU_KINDS, APP_MENU_LABELS, auditAppMenus, menuBuiltForOf, menuChoices, menuDefaultId } from '../core/engines/app-menus-rules.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const TYPES = Object.values(APP_MENU_KINDS);

/** Apps on menus: folders of apps/ with an axf.manifest.json whose defaults name a menu. */
export function menuApps(root = ROOT) {
  const dir = join(root, 'apps');
  return readdirSync(dir).filter((n) => {
    const f = join(dir, n, 'axf.manifest.json');
    if (!existsSync(f)) return false;
    try {
      const m = readJson(f);
      if (m.framework?.template === 'android-compose') return false; // Android twin deferred (framework/spec/PORTING.md)
      const d = m.defaults ?? {};
      return TYPES.some((t) => typeof d[t] === 'string');
    } catch { return false; }
  }).sort();
}

/** The menu assets an app ships itself (src/assets/<type>/*.json): `[{ file, asset }]`. */
export function ownMenus(root, app) {
  const out = [];
  for (const t of TYPES) {
    const dir = join(root, 'apps', app, 'src/assets', t);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try { out.push({ file: join(dir, n), asset: readJson(join(dir, n)) }); } catch { /* not JSON: validate-assets reports it */ }
    }
  }
  return out;
}

function appName(root, app) {
  try { const m = readJson(join(root, 'apps', app, 'axf.manifest.json')); return m.app?.name || app; } catch { return app; }
}

/** `<type>/<id>` of every shared menu in framework/assets (never offered to an app). */
export function sharedMenuIds(root = ROOT) {
  return TYPES.flatMap((t) => { const d = join(root, 'framework/assets', t); return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.json')).map((n) => `${t}/${n.slice(0, -5)}`) : []; });
}

/** Find a menu by id: the app's own assets first, then the framework's shared set. */
function findMenu(root, app, type, id) {
  const own = ownMenus(root, app).find((m) => m.asset.type === type && m.asset.id === id);
  if (own) return own.asset;
  const f = join(root, 'framework/assets', type, `${id}.json`);
  return existsSync(f) ? readJson(f) : null;
}

/** The changes backfill makes for an app: `[{ file, value, why }]` (manifest last). */
export function backfillPlan(root, app) {
  const changes = [];
  const mf = join(root, 'apps', app, 'axf.manifest.json');
  const manifest = readJson(mf);
  const defaults = { ...(manifest.defaults ?? {}) };
  const label = appName(root, app);
  for (const [kind, type] of Object.entries(APP_MENU_KINDS)) {
    const id = menuDefaultId(app, kind);
    const file = join(root, 'apps', app, 'src/assets', type, `${id}.json`);
    if (!existsSync(file)) {
      const src = findMenu(root, app, type, defaults[type]) ?? findMenu(root, app, type, TYPES.includes(type) ? (type === 'nav-menu' ? 'sidebar-list' : 'standard-desktop') : '');
      if (!src) { changes.push({ error: `${app}: no ${type} to copy into ${id}` }); continue; }
      const asset = {
        $axf: 'asset@1', type, id,
        name: `${label} ${APP_MENU_LABELS[kind]} (default)`,
        version: '1.0.0',
        description: `${label}'s own default ${APP_MENU_LABELS[kind]}, locked until another one built for ${app} is picked (app-menus@1). Started from "${src.id}".`,
        author: src.author ?? 'AmberX AXF',
        tags: [...new Set(['default', 'app-menus@1', `app:${app}`, ...(Array.isArray(src.tags) ? src.tags : [])])],
        data: { ...src.data, builtFor: `app:${app}` },
      };
      changes.push({ file, value: asset, why: `new ${id} (copy of ${src.id})` });
    }
    if (defaults[type] !== id) { changes.push({ manifest: true, type, from: defaults[type], to: id }); defaults[type] = id; }
  }
  const shared = sharedMenuIds(root);
  for (const { file, asset } of ownMenus(root, app)) {
    if (menuBuiltForOf(asset) === null && !shared.includes(`${asset.type}/${asset.id}`)) changes.push({ file, value: { ...asset, data: { ...asset.data, builtFor: `app:${app}` } }, why: `builtFor app:${app} on ${asset.id}` });
  }
  if (changes.some((c) => c.manifest)) changes.push({ file: mf, value: { ...manifest, defaults }, why: 'manifest defaults → own menus' });
  return changes;
}

export function auditAll(root = ROOT) {
  const sharedIds = sharedMenuIds(root);
  return menuApps(root).map((app) => {
    const manifest = readJson(join(root, 'apps', app, 'axf.manifest.json'));
    return auditAppMenus(app, { defaults: manifest.defaults, ownAssets: ownMenus(root, app).map((m) => m.asset), sharedIds });
  });
}

function main(argv) {
  const [cmd = 'check', ...rest] = argv;
  const json = rest.includes('--json');
  if (cmd === 'list') {
    const rows = menuApps(ROOT).map((app) => {
      const assets = ownMenus(ROOT, app).map((m) => m.asset);
      const defaults = readJson(join(ROOT, 'apps', app, 'axf.manifest.json')).defaults ?? {};
      return { app, menus: Object.entries(APP_MENU_KINDS).map(([kind, type]) => ({ kind, type, default: menuDefaultId(app, kind), manifest: defaults[type] ?? null, choices: menuChoices(app, type, assets).map((c) => c.id) })) };
    });
    if (json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) for (const m of r.menus) console.log(`${r.app.padEnd(20)} ${m.kind.padEnd(8)} ${m.manifest === m.default ? 'locked on' : 'MANIFEST ' + m.manifest + ' ≠'} ${m.default}  (${m.choices.length} built for it)`);
    return 0;
  }
  if (cmd === 'backfill') {
    const write = rest.includes('--write');
    let n = 0; let bad = 0;
    for (const app of menuApps(ROOT)) {
      for (const c of backfillPlan(ROOT, app)) {
        if (c.error) { console.error(`✗ ${c.error}`); bad++; continue; }
        if (c.manifest) { console.log(`  ${app}: defaults["${c.type}"] ${c.from} → ${c.to}`); continue; }
        console.log(`${write ? '✓' : '·'} ${app}: ${c.why}`);
        if (write) writeJson(c.file, c.value);
        n++;
      }
    }
    console.log(`${n} change(s)${write ? ' written' : ' (dry run; --write to apply)'}`);
    return bad ? 1 : 0;
  }
  if (cmd === 'check') {
    const res = auditAll(ROOT);
    const errs = res.flatMap((r) => r.errors.map((e) => `${r.app}: ${e}`));
    if (json) console.log(JSON.stringify({ ok: !errs.length, apps: res }, null, 2));
    else {
      for (const e of errs) console.error(`✗ ${e}`);
      console.log(errs.length ? `app-menus: ${errs.length} problem(s) in ${res.length} apps (node framework/cli/app-menus.mjs backfill --write)` : `app-menus: ${res.length} apps, each on its own locked nav + app menu, none shared`);
    }
    return errs.length ? 1 : 0;
  }
  console.error('usage: app-menus.mjs list|backfill|check [--write] [--json]');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
