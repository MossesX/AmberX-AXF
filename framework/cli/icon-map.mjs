#!/usr/bin/env node
/**
 * icon-map — the icon spot inventory (icon-map@1, framework/spec/ICON-MAP.md).
 *
 * A *spot* is one place in a UI that draws an icon, a badge or an app icon. Its id is `<app>:<area>/<slot>`:
 *   app   framework | console-web | amberx-droid | axhub-web | molly | expenses | walkthrough-studio | …
 *   area  the component, view, plugin or library the spot sits in (kebab-case, from the file path)
 *   slot  the icon's role: the glyph name a literal `<Icon name="…">` asks for, the prop or expression a dynamic one
 *         reads (`name={icon}` → `icon`), `badge` for a badge, `launcher` / `favicon` for app icons
 *
 *   node framework/cli/icon-map.mjs scan [--json] [--write <file>]   scan every app for spots (source only, baked copies skipped)
 *   node framework/cli/icon-map.mjs list [--app <id>] [--kind <k>]    print the spots of the last written inventory
 *
 * Source scanning never replaces registration at run time (rt.registerIconSpot, engines/icon-map.ts): it is how the
 * starter icon-map asset (framework/assets/icon-map/default.json) and the inventory doc are kept honest.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const INVENTORY_FILE = 'framework/spec/icon-inventory.json';
export const SPOT_KINDS = ['icon', 'badge', 'app-icon'];
export const SPOT_ID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/;

/** Where source lives per app; `src/axf` (baked framework copies), dist and node_modules are never scanned. */
export const SCAN_ROOTS = {
  framework: ['framework/react', 'framework/libs'],
  'console-web': ['apps/console-web/src', 'apps/console-web/plugins'],
  'amberx-droid': ['apps/amberx-droid/src'],
  'axhub-web': ['apps/axhub-web/src'],
  molly: ['apps/molly/src', 'apps/molly/plugins'],
  expenses: ['apps/expenses/src'],
  'walkthrough-studio': ['apps/walkthrough-studio/src'],
  voicevault: ['apps/voicevault/src'],
};

/** App icons that are files, not components: one spot each (kind app-icon). */
export const APP_ICON_SPOTS = [
  { id: 'console-web:app/favicon', app: 'console-web', area: 'app', slot: 'favicon', kind: 'app-icon', glyph: 'sparkles', source: 'brand place favicon (branding@1 decorations.favicon)' },
  { id: 'axhub-web:app/favicon', app: 'axhub-web', area: 'app', slot: 'favicon', kind: 'app-icon', glyph: 'cloud', source: 'brand place favicon' },
  { id: 'molly:app/favicon', app: 'molly', area: 'app', slot: 'favicon', kind: 'app-icon', glyph: 'sparkles', source: 'brand place favicon' },
  { id: 'amberx-droid:app/favicon', app: 'amberx-droid', area: 'app', slot: 'favicon', kind: 'app-icon', glyph: 'zap', source: 'brand place favicon' },
  { id: 'amberx-droid:app/launcher', app: 'amberx-droid', area: 'app', slot: 'launcher', kind: 'app-icon', glyph: 'zap', source: 'apps/amberx-droid/android/app/src/main/res/mipmap-*/ic_launcher*.png (adaptive icon)' },
];

const posix = (p) => p.split(sep).join('/');
const kebab = (s) => s.replace(/\.(tsx?|m?jsx?)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const SKIP = /\/(node_modules|dist|__pycache__|\.git)\/|\/src\/axf\//;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (SKIP.test(posix(p) + '/')) continue;
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts|jsx|js|mjs)$/.test(n) && !/\.d\.m?ts$/.test(n)) acc.push(p);
  }
  return acc;
}

/** The area a source file belongs to: plugin id, view, component or library name. */
export function areaOf(rel) {
  const parts = rel.split('/');
  const i = parts.indexOf('plugins');
  if (i >= 0 && parts[i + 1]) return `plugin-${kebab(parts[i + 1])}`;
  if (rel.startsWith('framework/libs/')) return `lib-${kebab(parts[2])}`;
  if (rel.startsWith('framework/react/')) return parts[2] === 'components' ? kebab(parts[parts.length - 1]) : `${kebab(parts[2])}-${kebab(parts[parts.length - 1])}`;
  const v = parts.indexOf('views');
  if (v >= 0 && parts[v + 1]) return `view-${kebab(parts[v + 1])}`;
  const m = parts.indexOf('modules');
  if (m >= 0 && parts[m + 1]) return `module-${kebab(parts[m + 1])}`;
  const pa = parts.indexOf('panes');
  if (pa >= 0 && parts[pa + 1]) return `pane-${kebab(parts[pa + 1])}`;
  return kebab(parts[parts.length - 1]);
}

const slotOfExpr = (expr) => {
  const names = [...expr.matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)].map((m) => m[1]);
  if (names.length) return names;
  const id = expr.match(/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*/)?.[0] ?? 'icon';
  return [kebab(id.split(/\??\./).pop() || 'icon')];
};

/** Scan one file: `{ literal: Set, dynamic: Set, badges: number }`. */
export function scanSource(src) {
  const literal = new Set([...src.matchAll(/<Icon\b[^>]*?\bname=["']([a-z][a-z0-9-]*)["']/g)].map((m) => m[1]));
  const dynamic = new Set();
  for (const m of src.matchAll(/<Icon\b[^>]*?\bname=\{([^}]+)\}/g)) for (const s of slotOfExpr(m[1].trim())) if (!literal.has(s)) dynamic.add(s);
  const badges = (src.match(/<Badge\b/g) ?? []).length + (src.match(/<BadgeFor\b/g) ?? []).length;
  return { literal, dynamic, badges };
}

/** Every spot in every app: `{ generatedAt?, spots: Spot[], assets: { icons, files }, apps }`. */
export function scanSpots(root = ROOT) {
  const spots = new Map();
  const add = (s) => { if (!spots.has(s.id)) spots.set(s.id, s); else spots.get(s.id).files = [...new Set([...spots.get(s.id).files, ...s.files])]; };
  for (const [app, dirs] of Object.entries(SCAN_ROOTS)) {
    for (const d of dirs) for (const f of walk(join(root, d))) {
      const rel = posix(relative(root, f));
      const { literal, dynamic, badges } = scanSource(readFileSync(f, 'utf8'));
      const area = areaOf(rel);
      for (const n of literal) add({ id: `${app}:${area}/${n}`, app, area, slot: n, kind: 'icon', glyph: n, files: [rel] });
      for (const n of dynamic) add({ id: `${app}:${area}/${n}`, app, area, slot: n, kind: 'icon', glyph: '', dynamic: true, files: [rel] });
      if (badges) add({ id: `${app}:${area}/badge`, app, area, slot: 'badge', kind: 'badge', glyph: '', dynamic: true, files: [rel] });
    }
  }
  // plugin icons: the glyph a plugin shows in menus and the plugin manager (plugin.json icon)
  for (const [app, dirs] of Object.entries(SCAN_ROOTS)) for (const d of dirs) {
    const pd = join(root, d.endsWith('/plugins') ? d : join(d, 'plugins'));
    if (!existsSync(pd)) continue;
    for (const p of readdirSync(pd)) {
      const pj = join(pd, p, 'plugin.json');
      if (!existsSync(pj)) continue;
      try { const icon = JSON.parse(readFileSync(pj, 'utf8')).icon; if (typeof icon === 'string' && /^[a-z][a-z0-9-]*$/.test(icon)) add({ id: `${app}:plugin-${kebab(p)}/plugin-icon`, app, area: `plugin-${kebab(p)}`, slot: 'plugin-icon', kind: 'icon', glyph: icon, files: [posix(relative(root, pj))] }); } catch { /* not a plugin */ }
    }
  }
  // badge assets (badge@1, attachable: banners draw them): one badge spot per asset, the asset's icon is the default glyph
  for (const [app, dirs] of Object.entries({ framework: ['framework/assets'], ...Object.fromEntries(Object.entries(SCAN_ROOTS).filter(([a]) => a !== 'framework').map(([a, ds]) => [a, ds.map((d) => join(d, 'assets'))])) })) {
    for (const d of dirs) {
      const bd = join(root, d, 'badge');
      if (!existsSync(bd)) continue;
      for (const f of readdirSync(bd).filter((n) => n.endsWith('.json'))) {
        try { const a = JSON.parse(readFileSync(join(bd, f), 'utf8')); if (a.type === 'badge' && typeof a.id === 'string') add({ id: `${app}:badge/${a.id}`, app, area: 'badge', slot: a.id, kind: 'badge', glyph: typeof a.data?.icon === 'string' ? a.data.icon : '', files: [posix(relative(root, join(bd, f)))] }); } catch { /* not an asset */ }
      }
    }
  }
  for (const s of APP_ICON_SPOTS) add({ ...s, files: [] });
  // asset-driven icons (menus, toolbars, nav items, badges, widgets): counted, registered at run time by their loaders
  let icons = 0, files = 0;
  const assetDirs = ['framework/assets', ...Object.values(SCAN_ROOTS).flat().map((d) => join(d, 'assets'))];
  for (const d of assetDirs) for (const f of walkJson(join(root, d))) { const n = (readFileSync(f, 'utf8').match(/"icon":\s*"[a-z][a-z0-9-]*"/g) ?? []).length; if (n) { icons += n; files++; } }
  const all = [...spots.values()].sort((a, b) => a.id.localeCompare(b.id));
  const apps = {};
  for (const s of all) { const a = (apps[s.app] ??= { spots: 0, icon: 0, badge: 0, 'app-icon': 0, dynamic: 0, areas: new Set() }); a.spots++; a[s.kind]++; if (s.dynamic) a.dynamic++; a.areas.add(s.area); }
  for (const a of Object.values(apps)) a.areas = a.areas.size;
  return { $axf: 'icon-inventory@1', spots: all, assets: { icons, files }, apps };
}

function walkJson(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (SKIP.test(posix(p) + '/')) continue; if (statSync(p).isDirectory()) walkJson(p, acc); else if (n.endsWith('.json')) acc.push(p); }
  return acc;
}

function main(argv) {
  const [cmd = 'scan', ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'scan') {
    const inv = scanSpots();
    const file = flag('--write');
    if (file) writeFileSync(resolve(ROOT, file), JSON.stringify(inv, null, 2) + '\n');
    if (rest.includes('--json')) { console.log(JSON.stringify(inv, null, 2)); return; }
    console.log(`${inv.spots.length} spots · ${Object.keys(inv.apps).length} apps · ${inv.assets.icons} asset icon fields in ${inv.assets.files} files${file ? ` → ${file}` : ''}`);
    for (const [app, a] of Object.entries(inv.apps)) console.log(`  ${app.padEnd(20)} ${String(a.spots).padStart(4)} spots  ${String(a.areas).padStart(3)} areas  icon ${a.icon} · badge ${a.badge} · app-icon ${a['app-icon']} · dynamic ${a.dynamic}`);
    return;
  }
  if (cmd === 'list') {
    const inv = JSON.parse(readFileSync(join(ROOT, INVENTORY_FILE), 'utf8'));
    const app = flag('--app'), kind = flag('--kind');
    for (const s of inv.spots) if ((!app || s.app === app) && (!kind || s.kind === kind)) console.log(`${s.id.padEnd(64)} ${s.kind.padEnd(8)} ${s.dynamic ? '(dynamic)' : s.glyph}`);
    return;
  }
  throw new Error('Usage: icon-map.mjs scan [--json] [--write <file>] | list [--app <id>] [--kind icon|badge|app-icon]');
}

if (process.argv[1] && posix(process.argv[1]).endsWith('/cli/icon-map.mjs')) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}
