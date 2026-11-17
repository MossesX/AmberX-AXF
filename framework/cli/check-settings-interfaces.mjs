#!/usr/bin/env node
/**
 * check-settings-interfaces — every page has its correct default settings interface (plugin-settings@1,
 * framework/spec/PLUGIN-SETTINGS.md; Brett, Nov 17 2026: "Each plugin needs its own settings interface, not the
 * console's. … Make sure every page has the correct default settings interface.").
 *
 * Lists every console plugin (apps/console-web/plugins/<folder>/plugin.json), every console page (the control
 * inventory's views) and every app in framework/schemas/shared-assets.json, and flags:
 *
 *   no-interface      a plugin with settings and no own interface: plugin.json `settingsInterface` must name
 *                     `settings/plugin-<slug>` and that asset must exist in the plugin's assets/settings/ with
 *                     scope plugin and owner = the plugin id
 *   wrong-interface   the named asset exists but is not the plugin's (scope, owner or id off)
 *   opens-console     a plugin's web code opens the console's Settings (`settings.open:plugins`, `app.settings`,
 *                     a navigation to the Settings view) instead of its own window; a line that means the console's own Settings
 *                     on purpose (e.g. its plugin list) carries a `settings-interfaces: console` comment
 *   page-interface    a console page that belongs to a plugin opens another owner's settings, or an app page that
 *                     names a plugin interface as its own (the page's plugin, otherwise the app's)
 *   app-interface     an app in shared-assets.json whose settings pick is not an app interface (scope app)
 *
 *   node framework/cli/check-settings-interfaces.mjs                 the findings, one line each (exit 1 over the baseline)
 *   node framework/cli/check-settings-interfaces.mjs --list          every plugin and page with its interface, then the findings
 *   node framework/cli/check-settings-interfaces.mjs --json          the same as JSON
 *   node framework/cli/check-settings-interfaces.mjs --write-baseline   record the current count (it only comes down)
 *   node framework/cli/check-settings-interfaces.mjs --fix [--range a-m]  write each missing settings/plugin-<slug> default
 *                     (the engine's generatedPluginSettings: the plugin's registered tabs and keys at Basic, level toolbar
 *                     on) and point plugin.json settingsInterface at it; --range limits it to folders starting a…m
 *
 * Ratchet: framework/spec/settings-interfaces-baseline.json (`max` findings; 0 once the sweep is done).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGINS = join(ROOT, 'apps/console-web/plugins');
const INVENTORY = join(ROOT, 'apps/console-web/src/control/inventory.json');
const SHARED = join(ROOT, 'framework/schemas/shared-assets.json');
const BASELINE = join(ROOT, 'framework/spec/settings-interfaces-baseline.json');
const args = new Set(process.argv.slice(2));

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
/** Same slug as core/engines/plugin-settings.ts pluginSlug. */
export const pluginSlug = (id) => (String(id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plugin');
export const pluginSettingsId = (id) => `plugin-${pluginSlug(id)}`;

function inventory() {
  if (!existsSync(INVENTORY)) {
    try { execFileSync(process.execPath, ['scripts/control-inventory.mjs'], { cwd: join(ROOT, 'apps/console-web'), stdio: 'ignore' }); } catch { /* read below */ }
  }
  return readJson(INVENTORY) ?? { plugins: [], views: [], settings: [], settingsTabs: [] };
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.|\.e2e\./.test(e.name)) out.push(p);
  }
  return out;
}

/** Calls in a plugin's web code that open the console's Settings rather than the plugin's own window. */
const OPENS_CONSOLE = [/['"`]settings\.open:plugins['"`]/, /dispatch\(\s*['"`]app\.settings['"`]/, /navigate\(\s*['"`]settings['"`]\s*\)/];

/** Every plugin: its interface and whether it has settings at all. */
export function pluginRows(inv = inventory()) {
  const byFolder = new Map((inv.plugins ?? []).map((p) => [p.folder, p]));
  const rows = [];
  for (const folder of readdirSync(PLUGINS).sort()) {
    const pj = join(PLUGINS, folder, 'plugin.json');
    if (folder.startsWith('_') || !existsSync(pj)) continue;
    const m = readJson(pj) ?? {};
    const id = String(m.id ?? '');
    const ip = byFolder.get(folder) ?? {};
    const keys = (inv.settings ?? []).filter((s) => s.plugin === id).map((s) => s.key).filter(Boolean);
    const hasSettings = !!ip.settingsTabId || keys.length > 0 || m.settingsTab?.default === true;
    const want = pluginSettingsId(id);
    const named = typeof m.settingsInterface === 'string' ? m.settingsInterface.replace(/^settings\//, '') : null;
    const file = join(PLUGINS, folder, 'assets', 'settings', `${want}.json`);
    const asset = existsSync(file) ? readJson(file) : null;
    const web = walk(join(PLUGINS, folder, 'web'));
    // a line that opens the console's own Settings on purpose (its plugin list, not this plugin's settings) says so with
    // a `settings-interfaces: console` comment; anything else is a finding
    const opens = web.flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (/settings-interfaces: console/.test(line) ? [] : OPENS_CONSOLE.filter((re) => re.test(line)).map((re) => `${relative(ROOT, f)}:${i + 1} (${re.source.replace(/\\/g, '')})`))));
    rows.push({ folder, id, name: m.name ?? folder, hasSettings, tab: ip.settingsTabId ?? null, keys, want, named, asset: asset ? { id: asset.id, scope: asset.data?.scope ?? null, owner: asset.data?.owner ?? null } : null, opens, view: (inv.views ?? []).filter((v) => v.plugin === id).map((v) => v.id) });
  }
  return rows;
}

/** Every console page and the interface it opens: its plugin's, otherwise the console's. */
export function pageRows(inv = inventory(), plugins = pluginRows(inv)) {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  return (inv.views ?? []).map((v) => {
    const p = v.plugin ? byId.get(v.plugin) : null;
    return { view: v.id, label: v.label, source: v.source, owner: p ? `plugin:${p.id}` : 'console', interface: p ? `settings/${p.want}` : 'settings/console', has: p ? !!p.asset && p.asset.owner === p.id : true, ...(v.plugin && !p ? { orphan: v.plugin } : {}) };
  });
}

/** Apps in shared-assets.json: their settings pick must be an app interface. */
export function appRows() {
  const shared = readJson(SHARED) ?? {};
  const apps = (Array.isArray(shared.apps) ? shared.apps : []).map((a) => (typeof a === 'string' ? { id: a.split('/').pop(), dir: a } : a));
  return apps.map((a) => {
    const dir = join(ROOT, a.dir ?? a.path ?? `apps/${a.id}`);
    const manifest = readJson(join(dir, 'axf.manifest.json')) ?? readJson(join(dir, 'src', 'axf.manifest.json')) ?? {};
    const pick = manifest.defaults?.settings ?? null;
    let scope = null;
    for (const base of ['src/assets/settings', 'src/axf/assets/settings', 'src/assets-overrides/settings']) {
      const f = join(dir, base, `${pick}.json`);
      if (pick && existsSync(f)) { const d = readJson(f)?.data ?? {}; scope = d.scope ?? (d.for ? 'chrome' : 'app'); break; }
    }
    return { app: a.id ?? a.name, dir: relative(ROOT, dir), pick, scope };
  });
}

export function findings({ plugins, pages, apps }) {
  const out = [];
  for (const p of plugins) {
    if (p.hasSettings && (!p.named || !p.asset)) out.push({ kind: 'no-interface', what: `plugin ${p.folder}`, why: `no own settings interface: plugin.json settingsInterface = settings/${p.want} and plugins/${p.folder}/assets/settings/${p.want}.json (scope plugin, owner ${p.id})` });
    else if (p.hasSettings && (p.named !== p.want || p.asset.id !== p.want || p.asset.scope !== 'plugin' || p.asset.owner !== p.id)) out.push({ kind: 'wrong-interface', what: `plugin ${p.folder}`, why: `settings/${p.named} is not its own (want ${p.want}, scope plugin, owner ${p.id}; has id ${p.asset?.id}, scope ${p.asset?.scope}, owner ${p.asset?.owner})` });
    for (const o of p.opens) out.push({ kind: 'opens-console', what: `plugin ${p.folder}`, why: `opens the console's Settings: ${o}` });
  }
  for (const g of pages) {
    if (g.orphan) out.push({ kind: 'page-interface', what: `page ${g.view}`, why: `belongs to ${g.orphan}, which is not a console plugin here` });
    else if (!g.has) out.push({ kind: 'page-interface', what: `page ${g.view}`, why: `its plugin has no own interface to open (${g.interface}); it would fall back to a generated one` });
  }
  for (const a of apps) if (a.pick && a.scope && a.scope !== 'app') out.push({ kind: 'app-interface', what: `app ${a.app}`, why: `its settings pick settings/${a.pick} is scope ${a.scope}, not an app interface` });
  return out;
}

/** The default interface a plugin gets (core/engines/plugin-settings.ts generatedPluginSettings, from the inventory). */
export function generatedData(p, inv) {
  const own = (inv.settingsTabs ?? []).filter((t) => t.plugin === p.id || (p.tab && t.id === p.tab));
  const ids = new Set(own.map((t) => t.id));
  const tabs = [...own, ...(inv.settingsTabs ?? []).filter((t) => !ids.has(t.id) && t.parent && ids.has(t.parent))];
  if (!tabs.length && p.tab) tabs.push({ id: p.tab });
  const levelOf = {};
  for (const t of tabs) levelOf[t.id] = 'basic';
  for (const k of p.keys) levelOf[k] = 'basic';
  return {
    scope: 'plugin', owner: p.id, layout: 'list', header: 'compact', search: false, descriptions: true,
    tabs: tabs.slice(0, 24).map((t) => ({ id: t.id, ...(t.parent && t.parent !== 'plugins' ? { parent: t.parent } : {}) })),
    hide: [], groups: [], levels: true, defaultLevel: 'basic', levelOf: Object.fromEntries(Object.entries(levelOf).slice(0, 200)), visible: {},
  };
}

/** Write the missing interface of one plugin and name it in its plugin.json. → what it wrote. */
export function fixPlugin(p, inv) {
  const wrote = [];
  const dir = join(PLUGINS, p.folder, 'assets', 'settings');
  const file = join(dir, `${p.want}.json`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const asset = {
      $axf: 'asset@1', type: 'settings', version: '1.0.0', author: 'check-settings-interfaces (plugin-settings@1)', id: p.want,
      name: `${p.name}: its own settings`,
      description: `${p.name}'s own settings interface (plugin-settings@1): only its tabs and keys, the level toolbar on, opened in its own window, never the console's Settings. Generated from its registered settings; edit it like any settings asset.`,
      tags: ['plugin-settings', p.folder], data: generatedData(p, inv),
    };
    writeFileSync(file, JSON.stringify(asset, null, 2) + '\n');
    wrote.push(relative(ROOT, file));
  }
  const pj = join(PLUGINS, p.folder, 'plugin.json');
  const text = readFileSync(pj, 'utf8');
  const want = `settings/${p.want}`;
  if (!text.includes(`"settingsInterface"`)) {
    // insert after the "name" line, keeping the file's own formatting
    const next = text.replace(/^(\s*)("name"\s*:\s*"(?:[^"\\]|\\.)*",?)\s*$/m, (_m, ind, line) => `${ind}${line.endsWith(',') ? line : `${line},`}\n${ind}"settingsInterface": "${want}",`);
    if (next !== text) { writeFileSync(pj, next); wrote.push(relative(ROOT, pj)); }
  } else if (!text.includes(`"settingsInterface": "${want}"`)) {
    writeFileSync(pj, text.replace(/"settingsInterface"\s*:\s*"[^"]*"/, `"settingsInterface": "${want}"`));
    wrote.push(relative(ROOT, pj));
  }
  return wrote;
}

export function run() {
  const inv = inventory();
  const plugins = pluginRows(inv);
  const pages = pageRows(inv, plugins);
  const apps = appRows();
  return { plugins, pages, apps, findings: findings({ plugins, pages, apps }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.has('--fix')) {
    const argv = process.argv.slice(2);
    const range = argv.includes('--range') ? argv[argv.indexOf('--range') + 1] ?? 'a-z' : 'a-z';
    const [lo, hi] = range.toLowerCase().split('-');
    const inv = inventory();
    let n = 0;
    for (const p of pluginRows(inv)) {
      const c = p.folder[0].toLowerCase();
      if (!p.hasSettings || c < lo || c > (hi ?? lo)) continue;
      for (const f of fixPlugin(p, inv)) { console.log(`wrote ${f}`); n++; }
    }
    console.log(`${n} file(s) written (${range})`);
  }
  const r = run();
  if (args.has('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  if (args.has('--list')) {
    console.log('Plugins:');
    for (const p of r.plugins) console.log(`  ${p.folder.padEnd(24)} ${p.hasSettings ? (p.named ? `settings/${p.named}` : '(none)') : '(no settings)'}${p.view.length ? `  pages: ${p.view.join(', ')}` : ''}`);
    console.log('Pages:');
    for (const g of r.pages) console.log(`  ${g.view.padEnd(24)} ${g.owner.padEnd(44)} ${g.interface}`);
    console.log('Apps:');
    for (const a of r.apps) console.log(`  ${String(a.app).padEnd(24)} settings/${a.pick ?? '(none)'} (${a.scope ?? 'not found'})`);
    console.log('');
  }
  for (const f of r.findings) console.log(`- [${f.kind}] ${f.what}: ${f.why}`);
  const base = readJson(BASELINE)?.max ?? null;
  if (args.has('--write-baseline')) {
    if (base !== null && r.findings.length > base) { console.error(`✗ ${r.findings.length} findings is over the baseline ${base}; the baseline only comes down`); process.exit(1); }
    writeFileSync(BASELINE, JSON.stringify({ $axf: 'settings-interfaces-baseline@1', max: r.findings.length, note: 'check-settings-interfaces.mjs ratchet: only comes down' }, null, 2) + '\n');
    console.log(`baseline written: ${r.findings.length}`);
    process.exit(0);
  }
  const summary = `${r.plugins.length} plugins (${r.plugins.filter((p) => p.hasSettings).length} with settings), ${r.pages.length} pages, ${r.apps.length} apps: ${r.findings.length} finding(s)`;
  if (base !== null && r.findings.length > base) { console.error(`✗ settings interfaces — ${summary}, over the baseline ${base}`); process.exit(1); }
  console.log(`${r.findings.length ? '•' : '✓'} settings interfaces — ${summary}${base !== null ? ` (baseline ${base})` : ''}`);
}
