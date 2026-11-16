#!/usr/bin/env node
/**
 * Plugin settings audit: for every console plugin, does it have a screen, a Settings → Plugins sub-tab,
 * and a gear (settings button) on its screen?
 *
 *   node framework/cli/plugin-settings-audit.mjs                 table on stdout
 *   node framework/cli/plugin-settings-audit.mjs --json          JSON on stdout
 *   node framework/cli/plugin-settings-audit.mjs --write [file]  write JSON (default
 *                                                                _claude/builds/reports/settings-interface-gear-every-plugin.audit.json)
 *   --root <dir>   plugins folder (default apps/console-web/plugins)
 *
 * Static read of each plugin folder (plugin.json + web/ sources); nothing is executed.
 *  - screen:      a `views: { … }` entry in its web library, or `view:<id>` in plugin.json `provides`.
 *                 Dialog-only plugins are recorded separately (`dialogs`), not as a screen.
 *  - settingsTab: a `settingsTabs: [...]` entry in its web library or `settings-tab:<id>` in `provides`
 *                 (the console re-parents every plugin tab under Settings → Plugins, App.tsx).
 *  - gear:        a control with the `settings` icon that opens a settings tab
 *                 (`settings.open:<tab>` / `openSettings(` / navigate to settings) in the plugin's web sources.
 *                 Only a rendered button (`kind: 'screen'`) aimed at the plugin's own tab counts; context/nav menu
 *                 entries are recorded as `settingsMenuItem`, links to other plugins' settings as evidence only.
 *                 Evidence is file:line; whether it sits in the screen's header is recorded as `gearInHeader`
 *                 when the same line is inside a header/toolbar element (heuristic, see `headerHint`).
 * Output is deterministic (sorted, no timestamps unless --stamp) so re-runs diff cleanly.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const ROOT = resolve(REPO, opt('--root', 'apps/console-web/plugins'));
const DEFAULT_OUT = '_claude/builds/reports/settings-interface-gear-every-plugin.audit.json';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** Keys of the object literal that follows `<key>: {` (top-level keys only). */
function objectKeys(src, key) {
  const keys = new Set();
  const re = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, start = i;
    while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
    const body = src.slice(start, i - 1);
    // walk the body at depth 0 and collect `'id':` / `id:` keys
    let d = 0, tok = '';
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (c === '{' || c === '[' || c === '(') d++;
      else if (c === '}' || c === ']' || c === ')') d--;
      if (d === 0) tok += c; else if (tok && !tok.endsWith('\u0000')) tok += '\u0000';
    }
    for (const k of tok.matchAll(/(?:^|[,\u0000\s])\s*['"]?([\w.-]+)['"]?\s*:/g)) keys.add(k[1]);
  }
  return [...keys];
}

/** Ids of `settingsTabs: [{ id: '…' … }]`. */
function settingsTabIds(src) {
  const ids = new Set();
  for (const m of src.matchAll(/settingsTabs\s*:\s*\[([\s\S]*?)\]/g)) for (const t of m[1].matchAll(/\bid\s*:\s*['"`]([^'"`]+)['"`]/g)) ids.add(t[1]);
  return [...ids];
}

const GEAR_ICON = /icon\s*[=:]\s*\{?\s*['"]settings['"]/;
const OPENS_SETTINGS = /settings\.open:|openSettings\(|navigate\(\s*['"`]settings|['"`]view:settings/;
const HEADER_HINT = /head|toolbar|actions|titlebar|Header|PageHead|\btrailing\b|\bextra\b/;
/** The shared gear (plugin-settings@1): <PluginSettingsGear tab=…/>, <PluginScreenHeader tab=…/> (gear unless gear={false}), a library's `gear: { tab }`. */
const SHARED_GEAR = /<\s*(PluginSettingsGear|PluginScreenHeader)\b[^>]*?\btab=\{?\s*(?:['"`]([\w.-]+)['"`]|(\w+))|\bgear:\s*\{\s*tab:\s*(?:['"`]([\w.-]+)['"`]|(\w+))/;

function auditPlugin(folder) {
  const dir = join(ROOT, folder);
  const manifestPath = join(dir, 'plugin.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const provides = Array.isArray(manifest?.provides) ? manifest.provides : [];
  const files = walk(join(dir, 'web'));
  const views = new Set(provides.filter((p) => p.startsWith('view:')).map((p) => p.slice(5)));
  const dialogs = new Set(provides.filter((p) => p.startsWith('dialog:')).map((p) => p.slice(7)));
  const tabs = new Set(provides.filter((p) => p.startsWith('settings-tab:')).map((p) => p.slice(13)));
  const sections = new Set();
  const gears = [];
  // string constants of the plugin's web files (`const FOLDER = 'x'`), so tab={FOLDER} resolves
  const consts = new Map();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/(?:export )?const (\w+) = ['"]([\w.-]+)['"]/g)) if (!consts.has(m[1])) consts.set(m[1], m[2]);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const k of objectKeys(src, 'views')) if (!['title', 'icon', 'render', 'keywords'].includes(k)) views.add(k);
    for (const k of objectKeys(src, 'dialogs')) if (!['title', 'icon', 'render', 'keywords', 'size', 'width'].includes(k)) dialogs.add(k);
    for (const id of settingsTabIds(src)) tabs.add(id);
    for (const m of src.matchAll(/\btab\s*:\s*['"]([\w.-]+)['"]/g)) sections.add(m[1]);
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const shared = line.match(SHARED_GEAR);
      if (shared && !/gear=\{false\}/.test(line)) {
        const target = shared[2] ?? consts.get(shared[3]) ?? shared[4] ?? consts.get(shared[5]) ?? null;
        gears.push({ at: `${relative(REPO, f)}:${i + 1}`, kind: 'screen', target, own: target !== null && tabs.has(target), headerHint: true, shared: true });
        return;
      }
      if (!GEAR_ICON.test(line) || !OPENS_SETTINGS.test(line)) return;
      const ctx = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
      const target = (line.match(/settings\.open:([\w.-]+)/) || [])[1] ?? null;
      const kind = /<\s*(Icon)?Button\b|<\s*button\b/.test(ctx.split('\n').slice(-3).join('\n')) ? 'screen' : 'menu';
      gears.push({ at: `${relative(REPO, f)}:${i + 1}`, kind, target, own: target !== null && tabs.has(target), headerHint: kind === 'screen' && HEADER_HINT.test(ctx) });
    });
  }
  // settings tabs may be declared after the gear's file was read: settle `own` once every file is in
  for (const g of gears) g.own = g.target !== null && tabs.has(g.target);
  const ownGears = gears.filter((g) => g.kind === 'screen' && g.own);
  const hasScreen = views.size > 0;
  const hasTab = tabs.size > 0;
  const hasGear = ownGears.length > 0;
  const missing = [];
  if (!hasTab) missing.push('settings-tab');
  if (hasScreen && !hasGear) missing.push('gear');
  return {
    folder,
    id: manifest?.id ?? null,
    name: manifest?.name ?? folder,
    template: folder.startsWith('_'),
    manifest: !!manifest,
    screen: hasScreen,
    views: [...views].sort(),
    dialogs: [...dialogs].sort(),
    settingsTab: hasTab,
    settingsTabs: [...tabs].sort(),
    settingsSections: [...sections].sort(),
    gear: hasGear,
    gearInHeader: ownGears.some((g) => g.headerHint),
    settingsMenuItem: gears.some((g) => g.kind === 'menu' && g.own),
    gears: gears.sort((a, b) => a.at.localeCompare(b.at)),
    missing,
  };
}

// a folder without plugin.json is not a plugin (notes-tasks holds a design and a schema): nothing to audit
const folders = readdirSync(ROOT).filter((n) => statSync(join(ROOT, n)).isDirectory() && existsSync(join(ROOT, n, 'plugin.json'))).sort();
const plugins = folders.map(auditPlugin);
const real = plugins.filter((p) => !p.template);
const summary = {
  plugins: real.length,
  withScreen: real.filter((p) => p.screen).length,
  withoutScreen: real.filter((p) => !p.screen).length,
  withSettingsTab: real.filter((p) => p.settingsTab).length,
  missingSettingsTab: real.filter((p) => !p.settingsTab).map((p) => p.folder),
  screensWithGear: real.filter((p) => p.screen && p.gear).length,
  screensMissingGear: real.filter((p) => p.screen && !p.gear).map((p) => p.folder),
  noScreen: real.filter((p) => !p.screen).map((p) => p.folder),
  complete: real.filter((p) => p.missing.length === 0).length,
};
const report = {
  $axf: 'plugin-settings-audit@1',
  build: 'settings-interface-gear-every-plugin',
  root: relative(REPO, ROOT),
  script: 'framework/cli/plugin-settings-audit.mjs',
  ...(flag('--stamp') ? { generatedAt: new Date().toISOString() } : {}),
  summary,
  plugins,
};

if (flag('--write')) {
  const out = resolve(REPO, opt('--write', DEFAULT_OUT));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${relative(REPO, out)}: ${summary.plugins} plugins, ${summary.withScreen} with a screen, ${summary.withSettingsTab} with a settings tab, ${summary.screensWithGear} screens with a gear`);
} else if (flag('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  const yn = (b) => (b ? 'yes' : '—');
  const rows = plugins.map((p) => [p.folder + (p.template ? ' (template)' : ''), yn(p.screen), yn(p.settingsTab), p.screen ? (p.gear ? (p.gearInHeader ? 'header' : 'yes') : 'MISSING') : 'n/a', p.missing.join(', ')]);
  const head = ['plugin', 'screen', 'settings tab', 'gear', 'missing'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => c.padEnd(w[i])).join('  ');
  console.log(fmt(head)); console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const r of rows) console.log(fmt(r));
  console.log(`\n${summary.plugins} plugins · ${summary.withScreen} with a screen · ${summary.withoutScreen} without · ${summary.withSettingsTab} with a Settings → Plugins tab · ${summary.screensWithGear}/${summary.withScreen} screens with a gear · ${summary.complete} complete`);
}
