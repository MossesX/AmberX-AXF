#!/usr/bin/env node
/**
 * UI Directory collector (ui-directory@1, framework/core/ui-directory.mjs): the live data set of every UI surface in
 * every app, read from what the repo already registers. No hand-kept list, no model, no tokens.
 *
 * Sources (each one is a registry something else keeps current):
 *   - the console-control inventory   apps/console-web/src/control/inventory.json (views, tab rows, settings tabs, plugins)
 *   - console plugin manifests         apps/console-web/plugins/<folder>/plugin.json (provides view:/dialog:/settings-tab:/banner:)
 *   - console plugin web registrations plugins/<folder>/web/index.tsx (views, dialogs, settingsTabs, settingsPanels, banners)
 *   - app manifests                    apps/<app>/axf.manifest.json + project.manifest.json (one app row each)
 *   - other apps' views + plugins      apps/<app>/src/App.tsx `views`, apps/<app>/src/plugins/<folder>/plugin.json
 *   - UI registries                    apps/<app>/src/assets/ui-registry/*.json (ui-registry@1) when an app ships one
 *   - token families                   --fx-* tokens used by each plugin's / view's own code
 *
 *   node directory.mjs build [--reason r] [--build id]   write <dataDir>/directory.json (+ changes.json) when anything moved
 *   node directory.mjs --check                          CI: fresh scan; fails on an unregistered UI, a duplicate, a missing
 *                                                        plugin row or more unlinked rows than coverage.json allows
 *   node directory.mjs --update-ratchet                 lower coverage.json to today's numbers (never raises it)
 *   node directory.mjs stats | tree | search <q> | get <id> | reach <id> | gaps | changes | --json
 * The data set lives only in the plugin's data folder (lifecycle.dataDir; AXF_UI_DIRECTORY_DIR overrides it).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../../../../framework/core/ui-directory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FOLDER = 'ui-directory';
export const ROOT = resolve(process.env.AXF_REPO_ROOT || join(HERE, '../../../..'));
export const DATA_DIR = resolve(process.env.AXF_UI_DIRECTORY_DIR || join(ROOT, '.axf-console/plugins', FOLDER));
export const DIRECTORY_FILE = join(DATA_DIR, 'directory.json');
export const CHANGES_FILE = join(DATA_DIR, 'changes.json');
export const RATCHET_FILE = join(HERE, 'coverage.json');
const CONSOLE = 'console-web';
const CONSOLE_APP = join(ROOT, 'apps', CONSOLE);
const INVENTORY = join(CONSOLE_APP, 'src/control/inventory.json');
/** Where each app keeps its plugins (the same homes plugin-commands.mjs lists). */
const PLUGIN_HOMES = { 'console-web': 'plugins', 'amberx-droid': 'src/plugins', 'axhub-web': 'src/plugins', molly: 'plugins' };

const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const listDirs = (d) => (existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(d, n)).isDirectory()).sort() : []);
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const SETTINGS_SCREEN = D.rowId(CONSOLE, 'screen', 'settings');

function walk(dir, out = [], depth = 0) {
  if (!existsSync(dir) || depth > 6) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'vendor' || n.startsWith('.')) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out, depth + 1);
    else if (/\.(tsx?|mts|css)$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
  }
  return out;
}

/** Token families used by the files of a folder (or one file). */
function familiesIn(...paths) {
  let text = '';
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const files = statSync(p).isDirectory() ? walk(p) : [p];
    for (const f of files) text += read(f);
  }
  return D.familiesOf(text);
}

/* ------------------------------------------------------------------ apps */

export function apps() {
  const out = [];
  for (const app of listDirs(join(ROOT, 'apps'))) {
    const m = readJson(join(ROOT, 'apps', app, 'axf.manifest.json'));
    const p = readJson(join(ROOT, 'apps', app, 'project.manifest.json'));
    if (!m && !p) continue;
    out.push({ app, id: m?.app?.id ?? p?.name ?? app, name: m?.app?.name ?? p?.displayName ?? titleCase(app), startView: m?.startView ?? '', targets: m?.targets ?? p?.platforms ?? [], description: p?.description ?? '', file: rel(join(ROOT, 'apps', app, m ? 'axf.manifest.json' : 'project.manifest.json')) });
  }
  return out;
}

/* ------------------------------------------------------------------ plugins (every app that has a plugins folder) */

/** Views, dialogs, settings tabs, settings panels and banners a plugin's web code declares (literal ids). */
export function webRegistrations(dir) {
  const out = { views: [], dialogs: [], settingsTabs: [], settingsPanels: [], banners: [] };
  const index = join(dir, 'web/index.tsx');
  if (!existsSync(index)) return out;
  const src = read(index);
  const consts = new Map();
  for (const f of walk(join(dir, 'web'))) for (const m of read(f).matchAll(/(?:const|export const) (\w+) = '([\w.:-]+)'/g)) consts.set(m[1], m[2]);
  const key = (m) => (m[1] ? consts.get(m[1]) : m[2] ?? m[3]) ?? '';
  const block = (name) => {
    const i = src.search(new RegExp(`\\b${name}:\\s*\\{`));
    if (i < 0) return '';
    let depth = 0;
    for (let j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1); }
    return '';
  };
  const topKeys = (text) => {
    const ids = [];
    let depth = 0;
    const body = text.slice(text.indexOf('{') + 1);
    for (const line of body.split('\n')) {
      if (depth === 0) { const m = line.match(/^\s*(?:\[(\w+)\]|'([\w.:-]+)'|([\w]+)):\s*\{/); if (m) ids.push(key(m)); }
      for (const c of line) { if (c === '{') depth++; else if (c === '}') depth--; }
    }
    return ids.filter(Boolean);
  };
  for (const m of block('views').matchAll(/(?:\[(\w+)\]|'([\w.:-]+)'|\b([\w]+)): \{ title: '([^']+)'(?:, icon: '([^']+)')?/g)) { const id = key(m); if (id) out.views.push({ id, title: m[4], icon: m[5] ?? '' }); }
  for (const id of topKeys(block('views'))) if (!out.views.some((v) => v.id === id)) out.views.push({ id, title: titleCase(id), icon: '' });
  for (const id of topKeys(block('dialogs'))) out.dialogs.push({ id, title: (block('dialogs').match(new RegExp(`['"\\[]?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\\]]?:\\s*\\{[^}]*?title: '([^']+)'`))?.[1]) ?? titleCase(id.split('.').pop()) });
  const arr = (name) => { const m = src.match(new RegExp(`\\b${name}:\\s*\\[([\\s\\S]*?)\\n?\\s*\\],?\\n`)); return m ? m[1] : (src.match(new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? ''); };
  for (const m of arr('settingsTabs').matchAll(/\{\s*id: (?:'([\w.:-]+)'|(\w+)),\s*label: (?:'([^']+)'|"([^"]+)")(?:, icon: '([^']+)')?([^}]*)\}/g)) out.settingsTabs.push({ id: m[1] ?? consts.get(m[2]) ?? '', label: m[3] ?? m[4], icon: m[5] ?? '', parent: m[6].match(/parent: '([\w-]+)'/)?.[1] ?? '' });
  for (const m of arr('settingsPanels').matchAll(/\{\s*id: (?:'([\w.:-]+)'|(\w+)),\s*tab: (?:'([\w.:-]+)'|(\w+)),\s*title: '([^']+)'(?:, icon: '([^']+)')?/g)) out.settingsPanels.push({ id: m[1] ?? consts.get(m[2]) ?? '', tab: m[3] ?? consts.get(m[4]) ?? '', title: m[5], icon: m[6] ?? '' });
  for (const m of arr('banners').matchAll(/\{\s*id: (?:'([\w.:-]+)'|(\w+))/g)) out.banners.push({ id: m[1] ?? consts.get(m[2]) ?? '' });
  for (const k of Object.keys(out)) out[k] = out[k].filter((x) => x.id);
  return out;
}

export function plugins() {
  const out = [];
  for (const [app, home] of Object.entries(PLUGIN_HOMES)) {
    const dir = join(ROOT, 'apps', app, home);
    for (const folder of listDirs(dir)) {
      const m = readJson(join(dir, folder, 'plugin.json'));
      if (!m || m.$axf !== 'plugin@1') continue;
      const provides = (m.provides ?? []).map(String);
      out.push({ app, folder, dir: join(dir, folder), m, provides, web: webRegistrations(join(dir, folder)), tokens: familiesIn(join(dir, folder, 'web')), enabled: m.enabledByDefault !== false, file: rel(join(dir, folder, 'plugin.json')) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ rows */

function consoleRows(ps) {
  const inv = readJson(INVENTORY);
  const rows = [];
  if (!inv) return rows;
  const byPluginId = new Map(ps.filter((p) => p.app === CONSOLE).map((p) => [p.m.id, p]));
  const viewFile = (id) => { const f = join(CONSOLE_APP, 'src/views', `${titleCase(id).replace(/ /g, '')}.tsx`); return existsSync(f) ? f : ''; };
  const screenIds = new Map();
  for (const v of inv.views ?? []) {
    const p = v.plugin ? byPluginId.get(v.plugin) : null;
    const id = D.rowId(CONSOLE, 'screen', v.id);
    screenIds.set(v.id, id);
    const file = p ? rel(join(p.dir, 'web/index.tsx')) : viewFile(v.id) ? rel(viewFile(v.id)) : 'apps/console-web/src/App.tsx';
    rows.push({ id, name: v.label, kind: 'screen', app: CONSOLE, plugin: p?.folder ?? '', address: v.address, deepLink: v.address ? { tool: 'console_open', target: v.id } : null, tokens: p ? p.tokens : familiesIn(viewFile(v.id)), enabled: p ? p.enabled : true, source: p ? 'plugin' : v.source === 'framework' ? 'framework' : 'shell', file, icon: v.icon ?? '', detail: v.nav ? `${v.nav} › ${v.label}` : p ? `${p.m.name} page` : '', keywords: v.keywords ?? [] });
  }
  const tabIds = new Map();
  for (const g of inv.tabGroups ?? []) {
    const p = g.plugin ? byPluginId.get(g.plugin) : null;
    const parent = g.view ? screenIds.get(g.view) ?? '' : '';
    const gid = D.rowId(CONSOLE, 'tab', g.id || `${g.file}:${g.line}`);
    rows.push({ id: gid, name: g.id ? `${titleCase(g.id.split('.').pop().replace(/\*$/, ''))} tabs` : 'Tab row', kind: 'tab', app: CONSOLE, parent, plugin: p?.folder ?? '', address: g.address ?? '', deepLink: g.view && g.address ? { tool: 'console_open', target: g.view } : null, dynamic: !!g.dynamic, enabled: p ? p.enabled : true, source: p ? 'plugin' : 'inventory', file: `apps/console-web/${g.file}`, level: 0, detail: `${(g.tabs ?? []).length} tab(s)`, keywords: [g.id ?? ''] });
    for (const t of g.tabs ?? []) {
      const id = D.rowId(CONSOLE, 'tab', g.id || `${g.file}:${g.line}`, t.value);
      tabIds.set(`${g.id}=${t.value}`, id);
      rows.push({ id, name: t.label, kind: 'tab', app: CONSOLE, parent: gid, plugin: p?.folder ?? '', address: t.address ?? '', deepLink: g.view && t.address ? { tool: 'console_open', target: `${g.view} ${t.label}` } : null, enabled: p ? p.enabled : true, source: p ? 'plugin' : 'inventory', file: `apps/console-web/${g.file}`, level: 1, keywords: [t.value, t.label] });
    }
  }
  const settingsTabIds = new Map();
  for (const t of inv.settingsTabs ?? []) {
    const p = t.plugin ? byPluginId.get(t.plugin) : null;
    const id = D.rowId(CONSOLE, 'settings-tab', t.id);
    settingsTabIds.set(t.id, id);
    const parent = t.parent ? D.rowId(CONSOLE, 'settings-tab', t.parent) : SETTINGS_SCREEN;
    rows.push({ id, name: t.label, kind: 'settings-tab', app: CONSOLE, parent, plugin: p?.folder ?? '', address: t.address, deepLink: { tool: 'console_settings', target: t.id }, tokens: p ? p.tokens : [], enabled: p ? p.enabled : true, source: p ? 'plugin' : 'inventory', file: p ? rel(join(p.dir, 'web/index.tsx')) : 'apps/console-web/src/consoleSettings.tsx', level: t.parent ? 1 : 0, detail: t.parent ? `Settings › ${titleCase(t.parent)} › ${t.label}` : `Settings › ${t.label}`, keywords: [t.id, t.label, 'settings'] });
  }
  // the plugin's own settings tab is the settings interface of every row it owns
  const settingsOfPlugin = new Map();
  for (const t of inv.settingsTabs ?? []) if (t.plugin && byPluginId.has(t.plugin)) settingsOfPlugin.set(byPluginId.get(t.plugin).folder, settingsTabIds.get(t.id));
  for (const r of rows) if (r.plugin && !r.settings && r.kind !== 'settings-tab') r.settings = settingsOfPlugin.get(r.plugin) ?? '';
  // plugin rows + what the manifest and web code register beyond the inventory (dialogs, panels, banners, windows)
  for (const p of ps.filter((x) => x.app === CONSOLE)) {
    const ip = (inv.plugins ?? []).find((x) => x.folder === p.folder);
    const view = p.web.views[0]?.id ?? p.provides.find((x) => x.startsWith('view:'))?.slice(5) ?? '';
    const settings = settingsOfPlugin.get(p.folder) ?? '';
    const address = ip?.address ?? '';
    rows.push({ id: D.rowId(CONSOLE, 'plugin', p.folder), name: p.m.name, kind: 'plugin', app: CONSOLE, plugin: p.folder, address, deepLink: view ? { tool: 'console_open', target: view } : settings ? { tool: 'console_settings', target: p.folder } : address ? { tool: 'console_open', target: address } : null, settings, tokens: p.tokens, enabled: p.enabled, source: 'manifest', file: p.file, detail: `Plugin · ${p.m.kind ?? 'module'} · v${p.m.version ?? ''}`, keywords: [p.folder, p.m.name, ...(p.m.description ?? '').split(/\W+/).slice(0, 12)] });
    for (const d of p.web.dialogs) rows.push({ id: D.rowId(CONSOLE, 'dialog', d.id), name: d.title, kind: 'dialog', app: CONSOLE, parent: view ? screenIds.get(view) ?? '' : '', plugin: p.folder, deepLink: { tool: 'console_dialog', target: d.id }, settings, tokens: p.tokens, enabled: p.enabled, source: 'plugin', file: rel(join(p.dir, 'web/index.tsx')), detail: `${p.m.name} dialog`, keywords: [d.id, d.title, 'dialog'] });
    for (const x of p.provides.filter((s) => s.startsWith('dialog:'))) { const id = x.slice(7); if (!p.web.dialogs.some((d) => d.id === id)) rows.push({ id: D.rowId(CONSOLE, 'dialog', id), name: titleCase(id.split('.').pop()), kind: 'dialog', app: CONSOLE, plugin: p.folder, deepLink: { tool: 'console_dialog', target: id }, settings, tokens: p.tokens, enabled: p.enabled, source: 'manifest', file: p.file, detail: `${p.m.name} dialog`, keywords: [id, 'dialog'] }); }
    for (const sp of p.web.settingsPanels) rows.push({ id: D.rowId(CONSOLE, 'settings-panel', sp.id), name: sp.title, kind: 'settings-panel', app: CONSOLE, parent: settingsTabIds.get(sp.tab) ?? '', plugin: p.folder, address: (inv.settingsTabs ?? []).find((t) => t.id === sp.tab)?.address ?? '', deepLink: { tool: 'console_settings', target: sp.tab }, tokens: p.tokens, enabled: p.enabled, source: 'plugin', file: rel(join(p.dir, 'web/index.tsx')), icon: sp.icon, detail: `Settings › ${sp.tab} › ${sp.title}`, keywords: [sp.id, sp.title, 'settings'] });
    const bannerIds = Array.isArray(p.m.banner) ? p.m.banner : p.web.banners.map((b) => b.id);
    for (const b of bannerIds) rows.push({ id: D.rowId(CONSOLE, 'banner', b), name: `${p.m.name} banner`, kind: 'banner', app: CONSOLE, plugin: p.folder, address, deepLink: address ? { tool: 'console_open', target: 'home' } : null, settings, tokens: p.tokens, enabled: p.enabled, source: Array.isArray(p.m.banner) ? 'manifest' : 'plugin', file: p.file, detail: 'Banner above every page', keywords: [b, 'banner'] });
  }
  return rows;
}

/** Views and plugins of the other apps (their App.tsx `views` map and their own plugin folders). */
function otherAppRows(ps, appList) {
  const rows = [];
  for (const a of appList) {
    if (a.app === CONSOLE) continue;
    const appTsx = join(ROOT, 'apps', a.app, 'src/App.tsx');
    if (existsSync(appTsx)) {
      const src = read(appTsx);
      const start = src.indexOf('const views: ViewMap = {');
      const block = start >= 0 ? src.slice(start, src.indexOf('\n};', start)) : '';
      for (const m of block.matchAll(/^\s+'?([\w-]+)'?: \{ title: '([^']+)'(?:, icon: '([^']+)')?(?:, keywords: \[([^\]]*)\])?/gm)) {
        const file = join(ROOT, 'apps', a.app, 'src/views');
        rows.push({ id: D.rowId(a.app, 'screen', m[1]), name: m[2], kind: 'screen', app: a.app, address: `view:${m[1]}`, deepLink: { tool: 'console_open', target: m[1] }, tokens: familiesIn(file), source: 'shell', file: rel(appTsx), icon: m[3] ?? '', keywords: [m[1], m[2], ...((m[4] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [])] });
      }
    }
    for (const f of (existsSync(join(ROOT, 'apps', a.app, 'src/assets/ui-registry')) ? readdirSync(join(ROOT, 'apps', a.app, 'src/assets/ui-registry')) : []).filter((n) => n.endsWith('.json'))) {
      const reg = readJson(join(ROOT, 'apps', a.app, 'src/assets/ui-registry', f));
      for (const it of reg?.data?.items ?? reg?.data?.entries ?? []) if (it?.id) rows.push({ id: D.rowId(a.app, 'element', it.id), name: it.label || it.title || it.id, kind: 'element', app: a.app, address: it.address ?? '', deepLink: it.view ? { tool: 'console_open', target: it.view } : null, source: 'ui-registry', file: rel(join(ROOT, 'apps', a.app, 'src/assets/ui-registry', f)), detail: it.description ?? it.help ?? '', keywords: [it.kind ?? '', ...(it.voice ?? [])] });
    }
  }
  for (const p of ps.filter((x) => x.app !== CONSOLE)) {
    const view = p.web.views[0]?.id ?? p.provides.find((x) => x.startsWith('view:'))?.slice(5) ?? '';
    const pid = D.rowId(p.app, 'plugin', p.folder);
    rows.push({ id: pid, name: p.m.name, kind: 'plugin', app: p.app, plugin: p.folder, address: `plugin:${p.m.id}`, deepLink: view ? { tool: 'console_open', target: view } : null, tokens: p.tokens, enabled: p.enabled, source: 'manifest', file: p.file, detail: `Plugin · ${p.m.kind ?? 'module'} · v${p.m.version ?? ''}`, keywords: [p.folder, p.m.name] });
    for (const v of p.web.views) rows.push({ id: D.rowId(p.app, 'screen', v.id), name: v.title, kind: 'screen', app: p.app, plugin: p.folder, address: `view:${v.id}`, deepLink: { tool: 'console_open', target: v.id }, tokens: p.tokens, enabled: p.enabled, source: 'plugin', file: rel(join(p.dir, 'web/index.tsx')), icon: v.icon, keywords: [v.id, v.title] });
    for (const t of p.web.settingsTabs) rows.push({ id: D.rowId(p.app, 'settings-tab', t.id), name: t.label, kind: 'settings-tab', app: p.app, plugin: p.folder, address: `view:settings/tab:settings.tabs=${t.parent || t.id}${t.parent ? `/subtab:settings.subtabs=${t.id}` : ''}`, deepLink: { tool: 'console_settings', target: t.id }, tokens: p.tokens, enabled: p.enabled, source: 'plugin', file: rel(join(p.dir, 'web/index.tsx')), icon: t.icon, level: t.parent ? 1 : 0, keywords: [t.id, t.label, 'settings'] });
    for (const d of p.web.dialogs) rows.push({ id: D.rowId(p.app, 'dialog', d.id), name: d.title, kind: 'dialog', app: p.app, plugin: p.folder, deepLink: { tool: 'console_dialog', target: d.id }, tokens: p.tokens, enabled: p.enabled, source: 'plugin', file: rel(join(p.dir, 'web/index.tsx')), keywords: [d.id, d.title, 'dialog'] });
  }
  return rows;
}

/** Every row from every source, raw (buildDirectory normalises, validates and sorts). */
export function collect() {
  const ps = plugins();
  const appList = apps();
  const rows = appList.map((a) => ({ id: D.rowId(a.app, 'app', a.id), name: a.name, kind: 'app', app: a.app, source: 'manifest', file: a.file, detail: a.description, tokens: familiesIn(join(ROOT, 'apps', a.app, 'src/views'), join(ROOT, 'apps', a.app, 'src/App.tsx')), keywords: [a.app, a.id, ...a.targets] }));
  rows.push(...consoleRows(ps), ...otherAppRows(ps, appList));
  return { rows, plugins: ps, apps: appList };
}

/* ------------------------------------------------------------------ registration gaps (the CI check) */

/** Per plugin: UIs its web code declares that plugin.json `provides` does not list, and listed ones the code lacks. */
export function gaps(ps = plugins()) {
  const out = [];
  for (const p of ps) {
    const declared = [...p.web.views.map((v) => `view:${v.id}`), ...p.web.dialogs.map((d) => `dialog:${d.id}`), ...p.web.settingsTabs.map((t) => `settings-tab:${t.id}`)];
    const g = D.registrationGaps(declared, p.provides);
    if (g.unregistered.length || g.phantom.length) out.push({ app: p.app, folder: p.folder, file: p.file, ...g });
  }
  return out;
}

export function readRatchet() { return readJson(RATCHET_FILE) ?? { unlinked: Infinity, unregistered: Infinity, phantom: Infinity }; }

/**
 * Completeness (CI). Hard failures: a duplicate id, a plugin folder with no plugin row, an inventory view with no screen
 * row, a row the schema rejects. Ratcheted (coverage.json, only goes down): rows with no deep link (`unlinked`), UIs a
 * plugin's web code declares but its manifest does not register (`unregistered`), manifest entries no code backs (`phantom`).
 */
export function checkDirectory(fresh = buildFresh(), ratchet = readRatchet()) {
  const errors = [];
  const v = D.validateDirectory(fresh.directory);
  for (const e of v.errors.slice(0, 20)) errors.push(e.message);
  if (fresh.directory.dropped) errors.push(`${fresh.directory.dropped} row(s) were dropped by the schema: ${fresh.dropped.slice(0, 5).map((d) => `${d.id} (${D.rejection(d.errors)})`).join('; ')}`);
  const ids = new Set(fresh.directory.rows.map((r) => r.id));
  for (const p of fresh.plugins) if (!ids.has(D.rowId(p.app, 'plugin', p.folder))) errors.push(`plugin ${p.app}/${p.folder} has no row`);
  const inv = readJson(INVENTORY);
  for (const view of inv?.views ?? []) if (!ids.has(D.rowId(CONSOLE, 'screen', view.id))) errors.push(`console view ${view.id} has no screen row`);
  for (const t of inv?.settingsTabs ?? []) if (!ids.has(D.rowId(CONSOLE, 'settings-tab', t.id))) errors.push(`settings tab ${t.id} has no row`);
  const unlinked = fresh.directory.rows.filter((r) => r.status === 'unlinked');
  const g = gaps(fresh.plugins);
  const unregistered = g.flatMap((x) => x.unregistered.map((u) => `${x.app}/${x.folder}: ${u}`));
  const phantom = g.flatMap((x) => x.phantom.map((u) => `${x.app}/${x.folder}: ${u}`));
  const counts = { unlinked: unlinked.length, unregistered: unregistered.length, phantom: phantom.length };
  if (counts.unregistered > (ratchet.unregistered ?? Infinity)) errors.push(`${counts.unregistered} UI(s) a plugin's web code declares are not registered in its plugin.json "provides" (the ratchet allows ${ratchet.unregistered}): ${unregistered.slice(0, 8).join(', ')}`);
  if (counts.phantom > (ratchet.phantom ?? Infinity)) errors.push(`${counts.phantom} plugin.json "provides" entr(ies) have no UI behind them (the ratchet allows ${ratchet.phantom}): ${phantom.slice(0, 8).join(', ')}`);
  if (counts.unlinked > (ratchet.unlinked ?? Infinity)) errors.push(`${counts.unlinked} UI row(s) have no deep link (the ratchet allows ${ratchet.unlinked}): ${unlinked.slice(0, 8).map((r) => r.id).join(', ')}`);
  return { ok: !errors.length, errors, total: fresh.directory.total, counts, allowed: { unlinked: ratchet.unlinked, unregistered: ratchet.unregistered, phantom: ratchet.phantom }, where: { unlinked: unlinked.map((r) => r.id), unregistered, phantom } };
}

/* ------------------------------------------------------------------ store */

export function loadDirectory() { return existsSync(DIRECTORY_FILE) ? readJson(DIRECTORY_FILE) : null; }

export function buildFresh({ previous = loadDirectory(), now = new Date().toISOString() } = {}) {
  const c = collect();
  const { dropped } = D.normRows(c.rows, { now });
  const directory = D.buildDirectory(c.rows, { generatedAt: now, previous });
  return { directory, dropped, plugins: c.plugins, apps: c.apps };
}

/** Build and save when anything moved (auto add / remove); the change list says which build moved what. */
export function writeDirectory({ reason = 'manual', build = '' } = {}) {
  const prev = loadDirectory();
  const { directory } = buildFresh({ previous: prev });
  if (prev?.hash === directory.hash) return { wrote: false, directory: prev, diff: { added: [], removed: [], changed: [] } };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DIRECTORY_FILE, `${JSON.stringify(directory)}\n`);
  const diff = D.diffDirectories(prev, directory);
  let log = readJson(CHANGES_FILE);
  if (!Array.isArray(log)) log = [];
  log.unshift({ at: directory.generatedAt, reason, build, total: directory.total, added: diff.added.slice(0, 300), removed: diff.removed.slice(0, 300), changed: diff.changed.slice(0, 300), counts: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length } });
  writeFileSync(CHANGES_FILE, `${JSON.stringify(log.slice(0, 60), null, 1)}\n`);
  return { wrote: true, directory, diff };
}

/** The data set to read: the saved one, built first when it is missing. */
export function currentDirectory() { return loadDirectory() ?? writeDirectory({ reason: 'first read' }).directory; }

/* ------------------------------------------------------------------ CLI */

const printTree = (nodes, depth = 0, out = []) => { for (const n of nodes) { out.push(`${'  '.repeat(depth)}${n.name}  [${n.kind}]${n.row?.address ? `  ${n.row.address}` : ''}`); printTree(n.children, depth + 1, out); } return out; };

export async function main(argv) {
  const [cmd = 'stats', ...rest] = argv;
  const json = rest.includes('--json');
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? '' : ''; };
  if (cmd === 'build') {
    const r = writeDirectory({ reason: flag('--reason') || 'manual', build: flag('--build') });
    if (json) { process.stdout.write(`${JSON.stringify({ wrote: r.wrote, total: r.directory.total, counts: r.directory.counts, diff: { added: r.diff.added.length, removed: r.diff.removed.length, changed: r.diff.changed.length } })}\n`); return 0; }
    console.log(r.wrote ? `ui-directory: wrote ${rel(DIRECTORY_FILE)} — ${r.directory.total} rows (+${r.diff.added.length} new, ${r.diff.changed.length} changed, -${r.diff.removed.length} gone)` : `ui-directory: up to date (${r.directory.total} rows)`);
    return 0;
  }
  if (cmd === '--check' || cmd === 'check') {
    const r = checkDirectory();
    if (json) { process.stdout.write(`${JSON.stringify(r)}\n`); return r.ok ? 0 : 1; }
    if (r.ok) { console.log(`ui-directory: complete — ${r.total} rows; unlinked ${r.counts.unlinked} (≤ ${r.allowed.unlinked}), unregistered ${r.counts.unregistered} (≤ ${r.allowed.unregistered}), phantom ${r.counts.phantom} (≤ ${r.allowed.phantom})`); return 0; }
    for (const e of r.errors) console.error(`ui-directory: ${e}`);
    console.error('ui-directory: register the UI in its plugin.json "provides" (view:/dialog:/settings-tab:) and give it a console-control address; see apps/console-web/plugins/ui-directory/README.md');
    return 1;
  }
  if (cmd === '--update-ratchet') {
    const r = checkDirectory(buildFresh(), { unlinked: Infinity, unregistered: Infinity, phantom: Infinity });
    const old = readRatchet();
    const next = Object.fromEntries(['unlinked', 'unregistered', 'phantom'].map((k) => [k, Math.min(r.counts[k], Number.isFinite(old[k]) ? old[k] : r.counts[k])]));
    writeFileSync(RATCHET_FILE, `${JSON.stringify({ $axf: 'ui-directory-coverage@1', description: 'UI rows with no deep link, UIs a plugin declares in code but not in its plugin.json, and provides entries with no code behind them. Only goes down: node directory.mjs --update-ratchet.', ...next }, null, 2)}\n`);
    console.log(`ui-directory: ratchet ${JSON.stringify(next)}`);
    return 0;
  }
  if (cmd === 'gaps') { const g = gaps(); process.stdout.write(json ? `${JSON.stringify(g)}\n` : g.map((x) => `${x.app}/${x.folder}\n${x.unregistered.map((u) => `  unregistered ${u}`).join('\n')}${x.phantom.length ? `\n${x.phantom.map((u) => `  phantom      ${u}`).join('\n')}` : ''}`).join('\n') + '\n'); return 0; }
  if (cmd === '--json') { process.stdout.write(`${JSON.stringify(currentDirectory())}\n`); return 0; }
  const dir = currentDirectory();
  if (cmd === 'stats') {
    if (json) { process.stdout.write(`${JSON.stringify({ generatedAt: dir.generatedAt, hash: dir.hash, total: dir.total, counts: dir.counts })}\n`); return 0; }
    console.log(`${dir.total} UI rows, built ${dir.generatedAt}`);
    for (const [k, n] of Object.entries(dir.counts.kinds)) console.log(`  ${String(n).padStart(5)}  ${D.KIND_LABEL[k] ?? k}`);
    console.log(`  apps: ${Object.entries(dir.counts.apps).map(([a, n]) => `${a} ${n}`).join(', ')}`);
    console.log(`  status: ${Object.entries(dir.counts.statuses).map(([a, n]) => `${a} ${n}`).join(', ')}`);
    return 0;
  }
  if (cmd === 'tree') { const t = D.tree(dir.rows); process.stdout.write(json ? `${JSON.stringify(t)}\n` : `${printTree(t).join('\n')}\n`); return 0; }
  if (cmd === 'search') { const hits = D.search(dir.rows, rest.filter((x) => !x.startsWith('--')).join(' '), { limit: Number(flag('--limit')) || 30 }); process.stdout.write(json ? `${JSON.stringify(hits)}\n` : hits.map((h) => `${h.id.padEnd(60)} ${h.name}${h.address ? `  ${h.address}` : ''}`).join('\n') + '\n'); return 0; }
  if (cmd === 'get') { const r = dir.rows.find((x) => x.id === rest[0]); if (!r) { console.error(`ui-directory: no row ${rest[0]}`); return 2; } console.log(JSON.stringify({ ...r, reach: D.reachOf(r), settings: D.settingsOf(dir.rows, r.id)?.id ?? '' }, null, 2)); return 0; }
  if (cmd === 'reach') { const r = dir.rows.find((x) => x.id === rest[0]); if (!r) { console.error(`ui-directory: no row ${rest[0]}`); return 2; } console.log(JSON.stringify(D.reachOf(r), null, 2)); return 0; }
  if (cmd === 'changes') { console.log(existsSync(CHANGES_FILE) ? read(CHANGES_FILE) : '[]'); return 0; }
  console.error('usage: directory.mjs build [--reason r] [--build id] | --check | --update-ratchet | gaps | stats | tree | search <q> | get <id> | reach <id> | changes | --json');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));
