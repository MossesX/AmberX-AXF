#!/usr/bin/env node
/**
 * settings-audit — the raw inventory of every settings store, key, writer and editing surface, per scope (build
 * one-true-source-for-every-setting, s4–s6). Static scan of the code plus the live documents when they are readable on
 * this machine; the collation into duplicates + owners is settings-sources.json (s7).
 *
 *   node framework/cli/settings-audit.mjs console    apps/console-web/server + every plugin           → audit-console.json
 *   node framework/cli/settings-audit.mjs builds     orchestrator, pipeline, accounts, slots, gate …  → audit-builds.json
 *   node framework/cli/settings-audit.mjs framework  SettingsRegistry keys, hub documents, skins …    → audit-framework.json
 *   --out <dir>   (default _claude/builds/reports/one-true-source-for-every-setting)   --json   print instead of writing
 *   AXF_AUDIT_LIVE_PLUGINS (default /opt/axf/.axf-console/plugins), AXF_AUDIT_LIVE_DATA (/opt/axf/.axf-console),
 *   AXHUB_PROJECTS_DIR (/projects): where the live documents are read from.
 *
 * Row (settings-audit-row@1): { key, store, file, kind, writer, writers[], routes[], editor, api, frame, source }.
 *   key      the setting as the store names it (top-level key of the document, a declared SettingsRegistry key, …)
 *   store    data-store@1 key of the document (plugins/<folder>/<file>, builds/pipeline/<file>, settings/<path>, browser:<storageKey>)
 *   source   live (read from the document on this machine) | declared (a settings group / DEFAULTS in code) | route (a REST route names it)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FRAME = 'settings-audit@1';
const LIVE_PLUGINS = process.env.AXF_AUDIT_LIVE_PLUGINS || '/opt/axf/.axf-console/plugins';
const LIVE_DATA = process.env.AXF_AUDIT_LIVE_DATA || '/opt/axf/.axf-console';
const PROJECTS = process.env.AXHUB_PROJECTS_DIR || '/projects';
const SETTINGS_LIKE = /settings|config|routing|workers|prefs|preferences|policy|options|defaults|accounts|retention|choices|profile|caps|limits|look|appearance|skin/i;
const SKIP_JSON = /^(plugin|help|notify|registry|package|package-lock|tsconfig|manifest|axf\.lock|seed|schema|fixture|catalog)\.json$|\.schema\.json$|^registry\./;
const WRITE_RE = /write|dump|replace\(|save|put|update|append|rename/i;

const walk = (dir, pred, out = []) => { if (!existsSync(dir)) return out; for (const n of readdirSync(dir)) { const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) { if (!/node_modules|\.git|dist|build|__pycache__|assets|\.venv/.test(n)) walk(p, pred, out); } else if (pred(p)) out.push(p); } return out; };
const rel = (p) => relative(REPO, p).split('\\').join('/');
const lines = (p) => readFileSync(p, 'utf8').split('\n');
const readLive = (p) => { try { const d = JSON.parse(readFileSync(p, 'utf8')); return d && typeof d === 'object' ? d : null; } catch { return null; } };
const topKeys = (d) => (d && !Array.isArray(d) ? Object.keys(d).filter((k) => k !== '$axf') : []);
const uniq = (a) => [...new Set(a)];

/** Scan code files for JSON store names, routes and web settings keys. */
export function scanCode(files) {
  const stores = new Map(); const routes = []; const webKeys = []; const regGets = []; const lsKeys = [];
  for (const f of files) {
    const isWeb = /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f);
    const src = lines(f);
    const consts = {}; for (const l of src) { const m = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/.exec(l); if (m) consts[m[1]] = m[2]; }
    const hasGroups = isWeb && /settings:\s*\[/.test(src.join('\n'));
    src.forEach((l, i) => {
      const at = `${rel(f)}:${i + 1}`;
      if (!isWeb) {
        for (const m of l.matchAll(/['"]([A-Za-z0-9][A-Za-z0-9._-]*\.json)['"]/g)) {
          const name = m[1]; if (SKIP_JSON.test(name) || /^\.\//.test(name)) continue;
          if (/HERE\s*\/|__dirname|import\.meta|readFileSync\(join\(HERE/.test(l) && !/data|DATA|dir/.test(l)) continue; // a schema beside the code, not a store
          const e = stores.get(name) || { name, mentions: [], writes: [] };
          e.mentions.push(at); if (WRITE_RE.test(l)) e.writes.push(at);
          stores.set(name, e);
        }
        const r = /@(?:router|r|app)\.(get|put|post|patch|delete)\(\s*["']([^"']+)["']/.exec(l) || /router\.(get|put|post|patch|delete)\(\s*["']([^"']+)["']/.exec(l);
        if (r && SETTINGS_LIKE.test(r[2])) routes.push({ verb: r[1].toUpperCase(), path: r[2], at });
      } else {
        if (hasGroups) for (const m of l.matchAll(/\bkey:\s*['"]([a-zA-Z][a-zA-Z0-9._-]*)['"]/g)) webKeys.push({ key: m[1], at, const: false });
        if (hasGroups) for (const m of l.matchAll(/\bkey:\s*([A-Z_][A-Z0-9_]*)\b/g)) if (consts[m[1]]) webKeys.push({ key: consts[m[1]], at, const: true });
        for (const m of l.matchAll(/settings\.(get|set|clear)\(\s*['"]([a-zA-Z][a-zA-Z0-9._-]*)['"]/g)) regGets.push({ key: m[2], op: m[1], at });
        for (const m of l.matchAll(/settings\.(get|set|clear)\(\s*([A-Z_][A-Z0-9_]*)\b/g)) if (consts[m[2]]) regGets.push({ key: consts[m[2]], op: m[1], at });
        for (const m of l.matchAll(/localStorage\.setItem\(\s*(?:['"]([^'"]+)['"]|([A-Za-z_][A-Za-z0-9_.]*))/g)) lsKeys.push({ key: m[1] || consts[m[2]] || `<${m[2]}>`, at });
      }
    });
  }
  return { stores: [...stores.values()], routes, webKeys, regGets, lsKeys };
}

const pluginDir = (p) => join(REPO, 'apps/console-web/plugins', p);
const codeFiles = (dir) => walk(dir, (p) => /\.(py|mjs|tsx?)$/.test(p) && !/\.test\.|test_|\/tests?\//.test(p) && !/\.d\.mts$/.test(p));

/** One plugin's inventory. */
export function auditPlugin(folder, { livePlugins = LIVE_PLUGINS, liveDirs = {} } = {}) {
  const dir = pluginDir(folder);
  const manifest = readLive(join(dir, 'plugin.json')) || {};
  const scan = scanCode(codeFiles(dir));
  const settingsTab = manifest.settingsTab ? `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=${folder}` : '';
  const editor = settingsTab || (scan.webKeys.length ? `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=${folder}` : `view:${folder}`);
  const rows = []; const stores = [];
  for (const s of scan.stores) {
    const like = SETTINGS_LIKE.test(s.name);
    const liveDir = liveDirs[folder] || join(livePlugins, folder);
    const liveFile = join(liveDir, s.name);
    const live = existsSync(liveFile) ? readLive(liveFile) : null;
    const storeKey = liveDirs[folder] ? `${liveDirs.__ns || 'console'}/${basename(liveDirs[folder])}/${s.name}` : `plugins/${folder}/${s.name}`;
    const store = { plugin: folder, name: s.name, store: storeKey, settingsLike: like, live: !!live, frame: live?.$axf || '', mentions: s.mentions.length, writes: s.writes, keys: live ? topKeys(live) : [] };
    stores.push(store);
    if (like) {
      const keys = store.keys.length ? store.keys : ['*'];
      for (const k of keys) rows.push({ key: k, store: storeKey, file: liveFile, kind: 'data-store', writer: s.writes[0] || s.mentions[0] || '', writers: s.writes, routes: scan.routes.map((r) => `${r.verb} /api/plugins/${folder}${r.path}`), editor, api: `/api/plugins/${folder}`, frame: store.frame, source: store.keys.length ? 'live' : 'declared' });
    }
  }
  for (const w of scan.webKeys) rows.push({ key: w.key, store: 'browser:axf.settings.console-web', file: w.at.split(':')[0], kind: 'browser', writer: w.at, writers: [w.at], routes: [], editor: `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=${folder}/setting:${w.key}`, api: 'console-control console_set', frame: 'SettingsRegistry', source: 'declared' });
  for (const g of scan.regGets) if (g.op !== 'get' && !scan.webKeys.some((w) => w.key === g.key)) rows.push({ key: g.key, store: 'browser:axf.settings.console-web', file: g.at.split(':')[0], kind: 'browser', writer: g.at, writers: [g.at], routes: [], editor: '', api: 'console-control console_set', frame: 'SettingsRegistry', source: 'declared' });
  for (const l of scan.lsKeys) rows.push({ key: l.key, store: `browser:${l.key}`, file: l.at.split(':')[0], kind: 'browser', writer: l.at, writers: [l.at], routes: [], editor: '', api: '', frame: 'localStorage', source: 'declared' });
  return { folder, settingsTab: !!manifest.settingsTab, uiEditor: manifest.uiEditor || '', stores, routes: scan.routes, rows };
}

/** The console server's own stores (apps/console-web/server). */
export function auditServer({ liveData = LIVE_DATA } = {}) {
  const scan = scanCode(codeFiles(join(REPO, 'apps/console-web/server')).filter((f) => !/\/tests?\//.test(f)));
  const rows = []; const stores = [];
  for (const s of scan.stores) {
    const like = SETTINGS_LIKE.test(s.name) || /^(state|alerts|nightly|host-check|project-wizard|update-status)\.json$/.test(s.name);
    const liveFile = join(liveData, s.name); const live = existsSync(liveFile) ? readLive(liveFile) : null;
    const storeKey = `console/${s.name}`;
    stores.push({ plugin: 'server', name: s.name, store: storeKey, settingsLike: like, live: !!live, frame: live?.$axf || '', mentions: s.mentions.length, writes: s.writes, keys: live ? topKeys(live) : [] });
    if (like) for (const k of (live ? topKeys(live) : ['*'])) rows.push({ key: k, store: storeKey, file: liveFile, kind: 'data-store', writer: s.writes[0] || s.mentions[0] || '', writers: s.writes, routes: scan.routes.map((r) => `${r.verb} /api${r.path}`), editor: 'view:settings', api: '/api', frame: live?.$axf || '', source: live ? 'live' : 'declared' });
  }
  return { folder: 'server', stores, routes: scan.routes, rows };
}

/** Hub settings documents under <projects>/_shared/_data (settings/**, claude/settings.json) and a project's _data folders. */
export function auditHubDocs(paths) {
  const rows = []; const docs = [];
  for (const { dir, ns, prefix = '', editor = '', owner = '', all = false } of paths) {
    for (const f of walk(dir, (p) => p.endsWith('.json') && !/\.tmp$|\/runs\/|\/history\//.test(p) && (all || SETTINGS_LIKE.test(basename(p)) || /^(workers|build-limit|store)\.json$/.test(basename(p))))) {
      const d = readLive(f); if (!d) continue;
      const r = relative(dir, f).split('\\').join('/');
      const storeKey = `${ns}/${prefix}${r}`;
      docs.push({ file: f, store: storeKey, frame: d.$axf || '', keys: topKeys(d), owner });
      for (const k of topKeys(d)) rows.push({ key: k, store: storeKey, file: f, kind: 'data-store', writer: owner, writers: owner ? [owner] : [], routes: [], editor, api: '', frame: d.$axf || '', source: 'live' });
    }
  }
  return { docs, rows };
}

/** SettingsRegistry keys declared or written anywhere in the framework's web code and the console app. */
export function auditRegistryKeys(dirs) {
  const files = dirs.flatMap((d) => walk(join(REPO, d), (p) => /\.(tsx?)$/.test(p) && !/\.test\.|\.d\.ts$/.test(p)));
  const scan = scanCode(files);
  const rows = [];
  for (const w of scan.webKeys) rows.push({ key: w.key, store: 'browser:axf.settings.<app>', file: w.at.split(':')[0], kind: 'browser', writer: w.at, writers: [w.at], routes: [], editor: `view:settings/setting:${w.key}`, api: 'console-control console_set / control@1 tokens', frame: 'SettingsRegistry', source: 'declared' });
  for (const g of scan.regGets) if (g.op !== 'get') rows.push({ key: g.key, store: 'browser:axf.settings.<app>', file: g.at.split(':')[0], kind: 'browser', writer: g.at, writers: [g.at], routes: [], editor: '', api: 'console-control console_set', frame: 'SettingsRegistry', source: 'declared' });
  for (const l of scan.lsKeys) rows.push({ key: l.key, store: `browser:${l.key}`, file: l.at.split(':')[0], kind: 'browser', writer: l.at, writers: [l.at], routes: [], editor: '', api: '', frame: 'localStorage', source: 'declared' });
  return { files: files.length, rows, reads: scan.regGets.filter((g) => g.op === 'get') };
}

const dedupe = (rows) => { const seen = new Map(); for (const r of rows) { const id = `${r.store}\u0000${r.key}`; const e = seen.get(id); if (!e) seen.set(id, { ...r, writers: uniq(r.writers) }); else { e.writers = uniq([...e.writers, ...r.writers]); e.routes = uniq([...e.routes, ...r.routes]); if (!e.editor) e.editor = r.editor; } } return [...seen.values()]; };

export function audit(scope) {
  const at = new Date().toISOString();
  if (scope === 'console') {
    const plugins = readdirSync(join(REPO, 'apps/console-web/plugins')).filter((p) => !p.startsWith('_') && existsSync(join(pluginDir(p), 'plugin.json')));
    const per = plugins.map((p) => auditPlugin(p));
    const server = auditServer();
    const rows = dedupe([...server.rows, ...per.flatMap((x) => x.rows)]);
    return { $axf: FRAME, scope, at, note: 'Audit pass 1: console server + plugins. Every JSON store a plugin or the server names in code, with the live document\'s top-level keys when it exists on this machine, every settings-like REST route, every SettingsRegistry key a plugin declares or writes, every localStorage key.', counts: { plugins: plugins.length, stores: per.reduce((n, x) => n + x.stores.length, 0) + server.stores.length, settingsStores: per.reduce((n, x) => n + x.stores.filter((s) => s.settingsLike).length, 0) + server.stores.filter((s) => s.settingsLike).length, rows: rows.length }, server: { stores: server.stores, routes: server.routes }, plugins: per.map(({ rows: _r, ...x }) => x), rows };
  }
  if (scope === 'builds') {
    const folders = ['build-orchestrator', 'claude-accounts', 'agent-slots', 'claude-settings', 'gate', 'push-banner', 'build-profiles', 'builds-page', 'agent-swarm', 'agent-manager'];
    const pipeline = join(PROJECTS, 'amberx-axf/_data/pipeline');
    const per = folders.map((p) => auditPlugin(p, { liveDirs: p === 'build-orchestrator' ? { 'build-orchestrator': pipeline, __ns: 'builds' } : {} }));
    // stores the orchestrator keeps outside its plugin folder
    const extra = auditHubDocs([
      { dir: pipeline, ns: 'builds', prefix: 'pipeline/', editor: 'view:builds/tab:pipeline', owner: 'apps/console-web/plugins/build-orchestrator/pipeline.mjs' },
      { dir: join(PROJECTS, 'amberx-axf/_data/auto-lander'), ns: 'console', prefix: 'auto-lander/', editor: 'view:builds/tab:gate', owner: 'framework/core/auto-lander.mjs', all: true },
      { dir: join(PROJECTS, 'amberx-axf/_data/agent-slots'), ns: 'console', prefix: 'agent-slots/', editor: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-slots', owner: 'framework/cli/agent-slots.mjs' },
      { dir: join(PROJECTS, 'amberx-axf/_data/build-rules'), ns: 'console', prefix: 'build-rules/', editor: 'view:builds/tab:rules', owner: 'framework/core/build-rules.mjs' },
      { dir: join(PROJECTS, '_shared/_data/claude'), ns: 'settings', prefix: 'claude/', editor: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=claude-settings', owner: 'apps/console-web/plugins/claude-settings/core.mjs' },
    ]);
    const slots = scanCode(codeFiles(join(REPO, 'framework/cli')).filter((f) => /agent-slots|auto-lander|build-rules|gate-rules|model-policy|build-defaults/.test(f)));
    const orch = readLive(join(REPO, '_claude/builds/orchestrator.json'));
    const orchRows = orch ? Object.keys(orch).filter((k) => !['builds', 'journal', 'rev', '$axf'].includes(k)).map((k) => ({ key: k, store: 'builds/orchestrator.json', file: '_claude/builds/orchestrator.json', kind: 'data-store', writer: 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs', writers: ['apps/console-web/plugins/build-orchestrator/orchestrator.mjs'], routes: ['/api/plugins/build-orchestrator'], editor: 'view:builds/tab:orchestrator', api: '/api/plugins/build-orchestrator', frame: orch.$axf || '', source: 'live' })) : [];
    const rows = dedupe([...per.flatMap((x) => x.rows), ...extra.rows, ...orchRows]);
    return { $axf: FRAME, scope, at, note: 'Audit pass 2: orchestrator + pipeline + agent stores (build-orchestrator pipeline settings/accounts, orchestrator.json settings blocks, claude-accounts workers.json, agent-slots, claude-settings, gate / auto-lander, push-banner), with the live documents on the hub volume.', counts: { plugins: folders.length, stores: per.reduce((n, x) => n + x.stores.length, 0), rows: rows.length, hubDocs: extra.docs.length }, plugins: per.map(({ rows: _r, ...x }) => x), hubDocs: extra.docs, frameworkCli: { stores: slots.stores, routes: slots.routes }, rows };
  }
  if (scope === 'framework') {
    const reg = auditRegistryKeys(['framework/react', 'framework/libs', 'framework/core', 'apps/console-web/src', 'apps/axhub-web/src', 'apps/demo/src']);
    const hub = auditHubDocs([{ dir: join(PROJECTS, '_shared/_data/settings'), ns: 'settings', editor: 'view:settings/tab:appearance', owner: 'framework/react/hubAppearance.ts + framework/cli/skins.mjs', all: true }]);
    const shared = walk(join(PROJECTS, '_shared/_data'), (p) => p.endsWith('.json') && !p.includes('/settings/') && !p.includes('app-catalog') && !p.includes('plugin-catalog')).map((f) => ({ file: f, frame: readLive(f)?.$axf || '', keys: topKeys(readLive(f)) }));
    const adapters = walk(join(REPO, 'apps/axhub-web'), (p) => /\.(tsx?|mjs|py)$/.test(p) && /setting|look|skin|appearance/i.test(basename(p)) && !/test/.test(p)).map(rel);
    const kotlin = walk(join(REPO, 'framework/android'), (p) => p.endsWith('.kt') && /Settings|Appearance|Hub/.test(basename(p))).map(rel);
    const rows = dedupe([...reg.rows, ...hub.rows]);
    return { $axf: FRAME, scope, at, note: 'Audit pass 3: framework + axHub side. SettingsRegistry keys declared or written in framework/react, framework/libs, framework/core and the web apps (browser stores), the hub settings documents under /projects/_shared/_data/settings (appearance@1, app-look@1, skins, apps), other shared documents, the axHub web app\'s settings code and the Kotlin twins (listed, not scanned).', counts: { webFiles: reg.files, rows: rows.length, hubDocs: hub.docs.length, sharedDocs: shared.length }, hubDocs: hub.docs, sharedDocs: shared, registryReads: uniq(reg.reads.map((r) => r.key)).sort(), axhubWebFiles: adapters, kotlinFiles: kotlin, rows };
  }
  throw new Error(`unknown scope ${scope} (console | builds | framework)`);
}

export function main(argv = process.argv.slice(2)) {
  const args = [...argv]; const json = args.includes('--json');
  const oi = args.indexOf('--out'); const outDir = oi >= 0 ? resolve(args[oi + 1]) : join(REPO, '_claude/builds/reports/one-true-source-for-every-setting');
  const scope = args.find((a) => !a.startsWith('--') && a !== (oi >= 0 ? args[oi + 1] : null));
  if (!scope) { console.log('usage: settings-audit.mjs console|builds|framework [--out dir] [--json]'); return 2; }
  const r = audit(scope);
  if (json) { console.log(JSON.stringify(r, null, 1)); return 0; }
  mkdirSync(outDir, { recursive: true });
  const f = join(outDir, `audit-${scope}.json`);
  writeFileSync(f, `${JSON.stringify(r, null, 1)}\n`);
  console.log(`${scope}: ${r.counts.rows} rows → ${rel(f)}`);
  const byStore = new Map(); for (const row of r.rows) byStore.set(row.store, (byStore.get(row.store) || 0) + 1);
  for (const [s, n] of [...byStore.entries()].sort()) console.log(`  ${s.padEnd(60)} ${n}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
