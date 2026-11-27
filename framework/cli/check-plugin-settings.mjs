#!/usr/bin/env node
/**
 * Plugin settings check (build every-plugin-screen-gets-a-settings-gear): every console plugin that draws a screen
 * (a view in its web library) has its own sub-tab under Settings → Plugins and a gear on that screen that opens it.
 *
 *   node framework/cli/check-plugin-settings.mjs [--json] [--report] [plugin dirs…]   (default: apps/console-web/plugins/*)
 *
 * Reads each plugin's plugin.json and its web entry (web/index.tsx, plus the files it spreads in):
 *  - view:        the web library adds `views: { … }` with at least one entry
 *  - settingsTab: the library declares `settingsTabs: [{ id, … }]`, or plugin.json `settingsTab: { default: true }`
 *                 (the console's PluginDefaultSettingsTab), or plugin.json `provides` a `settings-tab:<id>`
 *  - gear:        the console host header draws it (src/PluginSettingsGear.tsx mounted by src/pluginLoader.tsx) unless
 *                 plugin.json says `settingsGear: false` with a `settingsGearReason`; a hand-made gear is any on-screen
 *                 Button / IconButton with icon "settings" that dispatches `settings.open:<its tab>`
 *
 * --report prints the table (and the problems as notes) and exits 0. Without it (CI: .github/workflows/android.yml) a
 * plugin with a view and no settings sub-tab, a view with no gear (the host gear not mounted, no hand-made one), a
 * hand-made gear next to the host's, or `settingsGear: false` without a reason fails with file:line.
 * --root=<dir> checks another tree (the unit test's fixtures: framework/spec/check-plugin-settings.test.mjs).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const reportOnly = args.includes('--report');
const rootArg = args.find((a) => a.startsWith('--root='))?.slice(7);
const base = rootArg ? resolve(rootArg) : ROOT;
const dirs = args.filter((a) => !a.startsWith('--'));
const PLUGINS = join(base, 'apps/console-web/plugins');
const HOST_GEAR = join(base, 'apps/console-web/src/PluginSettingsGear.tsx');
const HOST_MOUNT = join(base, 'apps/console-web/src/pluginLoader.tsx');

const list = dirs.length ? dirs.map((d) => resolve(base, d)) : (existsSync(PLUGINS) ? readdirSync(PLUGINS).filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(PLUGINS, n)).isDirectory()).map((n) => join(PLUGINS, n)) : []);
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'vendor' || n === 'test' ? [] : walk(p)) : [p]; }) : []);
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** The host gear is live once the component exists and the loader mounts it on every plugin view. */
export function hostGearMounted(root = base) {
  const g = join(root, 'apps/console-web/src/PluginSettingsGear.tsx');
  const m = join(root, 'apps/console-web/src/pluginLoader.tsx');
  return existsSync(g) && existsSync(m) && /PluginViewHost/.test(readFileSync(m, 'utf8'));
}

/** Static read of one plugin folder. */
export function auditPlugin(dir) {
  const rel = relative(base, dir);
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const own = walk(join(dir, 'web')).filter((f) => /\.(tsx?|mjs)$/.test(f));
  // a framework library spread into the plugin (`...hubSyncLibrary`, `...lib` from createMcpLibrary) brings its views and tabs
  const libs = new Set();
  for (const f of own) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@console\/axf\/libs\/([\w-]+)['"]/g)) {
      const names = m[1].split(',').map((n) => n.trim()).filter((n) => /Library$/.test(n));
      if (names.some((n) => new RegExp(`\\.\\.\\.${n}\\b|=\\s*${n}\\(`).test(src)) && /\.\.\.\w+/.test(src)) libs.add(m[2]);
    }
  }
  const files = [...own, ...[...libs].flatMap((l) => walk(join(base, 'framework/libs', l)).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)))];
  const views = [];
  const tabs = [];
  const gears = [];
  let viewAt = null;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const fr = relative(base, f);
    // views: { id: { … }, 'id-2': { … } }  (only the keys at the first level)
    for (const m of src.matchAll(/\bviews:\s*\{/g)) {
      let depth = 1; let i = m.index + m[0].length; let key = ''; let type = false;
      const keys = [];
      for (; i < src.length && depth > 0; i++) {
        const c = src[i];
        if (depth === 1 && c === '[' && !key.trim()) { const end = src.indexOf(']', i); key = src.slice(i + 1, end); i = end; continue; }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth--;
        if (depth === 1 && c === ';') type = true; // a type literal, not the library's views
        if (depth === 1 && c === ':' && key.trim()) { keys.push(key.trim().replace(/^['"]|['"]$/g, '')); key = '__value__'; continue; }
        if (depth === 1 && c === ',') { key = ''; continue; }
        if (depth === 1 && key !== '__value__') key += c;
      }
      if (type || !keys.length) continue;
      views.push(...keys);
      if (!viewAt) viewAt = `${fr}:${lineOf(src, m.index)}`;
    }
    for (const m of src.matchAll(/\bsettingsTabs:\s*\[\s*\{\s*id:\s*([^,}]+)/g)) tabs.push({ id: m[1].trim().replace(/^['"`]|['"`]$/g, ''), at: `${fr}:${lineOf(src, m.index)}` });
    if (!f.endsWith('.tsx')) continue;
    // a hand-made gear: a settings-icon button on a screen that opens the plugin's settings tab
    for (const m of src.matchAll(/<(?:Icon)?Button\b/g)) {
      const tag = src.slice(m.index, m.index + 400).split(/\/>|<\/(?:Icon)?Button>/)[0];
      if (/icon=["']settings["']/.test(tag) && /settings\.open:/.test(tag)) gears.push(`${fr}:${lineOf(src, m.index)}`);
    }
  }
  const manifestTab = manifest.settingsTab && typeof manifest.settingsTab === 'object' && manifest.settingsTab.default === true;
  const provided = (manifest.provides ?? []).filter((p) => typeof p === 'string' && p.startsWith('settings-tab:')).map((p) => p.slice(13));
  const hasView = views.length > 0;
  const optOut = manifest.settingsGear === false;
  return {
    folder: rel.split('/').pop(),
    rel,
    views,
    viewAt,
    settingsTab: tabs.length > 0 || manifestTab || provided.length > 0,
    tabIds: [...tabs.map((t) => t.id), ...(manifestTab ? ['(default)'] : []), ...provided.map((p) => `provides:${p}`)],
    handGears: gears,
    optOut,
    optOutReason: optOut ? String(manifest.settingsGearReason ?? '') : '',
    hasView,
  };
}

export function audit(paths = list, root = base) {
  const host = hostGearMounted(root);
  const rows = paths.map(auditPlugin).filter(Boolean);
  const withView = rows.filter((r) => r.hasView);
  const problems = [];
  for (const r of withView) {
    const at = r.viewAt ?? `${r.rel}/plugin.json:1`;
    if (!r.settingsTab) problems.push(`${at}: ${r.folder} has a screen but no settings sub-tab (add settingsTabs with parent 'plugins', or plugin.json "settingsTab": { "default": true })`);
    if (r.optOut && !r.optOutReason.trim()) problems.push(`${r.rel}/plugin.json:1: ${r.folder} sets "settingsGear": false without a "settingsGearReason"`);
    if (!host && !r.optOut && !r.handGears.length) problems.push(`${at}: ${r.folder} has a screen with no settings gear`);
    if (host && r.handGears.length && !r.optOut) for (const g of r.handGears) problems.push(`${g}: ${r.folder} draws its own settings gear; the host header already has one (remove it)`);
  }
  return {
    host,
    plugins: rows.length,
    withView: withView.length,
    withTab: withView.filter((r) => r.settingsTab).length,
    withoutTab: withView.filter((r) => !r.settingsTab).map((r) => r.folder),
    withHandGear: withView.filter((r) => r.handGears.length).map((r) => r.folder),
    gearCovered: withView.filter((r) => r.optOut || host || r.handGears.length).length,
    optedOut: withView.filter((r) => r.optOut).map((r) => `${r.folder}: ${r.optOutReason}`),
    rows,
    problems,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = audit();
  if (json) {
    console.log(JSON.stringify(a, null, 2));
  } else {
    console.log(`plugin settings: ${a.plugins} plugins, ${a.withView} with a screen, ${a.withTab} of them with a settings sub-tab, ${a.gearCovered} with a gear (host gear ${a.host ? 'mounted' : 'not mounted'})`);
    if (a.withoutTab.length) console.log(`  no settings sub-tab (${a.withoutTab.length}): ${a.withoutTab.join(', ')}`);
    if (a.withHandGear.length) console.log(`  hand-made gear (${a.withHandGear.length}): ${a.withHandGear.join(', ')}`);
    if (a.optedOut.length) console.log(`  opted out: ${a.optedOut.join('; ')}`);
    const noGear = a.rows.filter((r) => r.hasView && !r.optOut && !a.host && !r.handGears.length).map((r) => r.folder);
    if (noGear.length) console.log(`  no gear (${noGear.length}): ${noGear.join(', ')}`);
    const viewless = a.rows.filter((r) => !r.hasView && r.settingsTab).map((r) => r.folder);
    if (viewless.length) console.log(`  settings only, no screen (${viewless.length}): ${viewless.join(', ')}`);
    for (const p of a.problems) (reportOnly ? console.log : console.error)(`${reportOnly ? '!' : '✗'} ${p}`);
    if (!reportOnly) console.log(a.problems.length ? `✗ ${a.problems.length} problem(s)` : '✓ every plugin screen has a settings sub-tab and one settings gear');
  }
  process.exit(!reportOnly && a.problems.length ? 1 : 0);
}
