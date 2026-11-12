/**
 * axf dev — live-reload server for assets (the Android/web equivalent of HMR for everything that is an asset).
 *
 *   node framework/cli/axf.mjs dev [appDir] [--port 7070] [--framework]
 *
 * Watches the app's assets folder (or framework/assets with --framework) and serves:
 *   GET /                 → { app, rev, assets: <count>, files: [...] }
 *   GET /assets.json      → every asset as one JSON array (what the app loads on connect)
 *   GET /assets/<type>/<id>.json
 *   GET /manifest.json    → axf.manifest.json
 *   GET /events?since=<rev> → long-poll: resolves with { rev, changed: [{type,id,action}] } when a file changes
 *
 * On the device the axf-assets remote source (flag axf.hotReload, setting axf.devServer=http://<pc-ip>:7070)
 * loads /assets.json once, then long-polls /events and re-registers only the changed assets; the runtime
 * recompiles, so a theme edit on the PC lands on the phone in under a second without a rebuild. Code
 * changes still go through Android Studio's Live Edit / Apply Changes — this covers everything in JSON.
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { appTemplate, FRAMEWORK_DIR, loadAssets, validateAsset } from './build-engine.mjs';
import { requireProject } from './project.mjs';

/**
 * Editor and tool scratch files that must never be announced: vim swap/backup (`.x.json.swp`, `x.json~`, `4913`),
 * emacs locks/autosaves (`.#x.json`, `#x.json#`), JetBrains safe-write (`x.json___jb_tmp___`), atomic-write temps
 * (`x.json.tmp`, `x.json.1234.tmp`, `.x.json.crswap`) and any hidden file. Only `<name>.json` passes.
 */
export function isTempFile(name) {
  const base = basename(String(name));
  if (!base.endsWith('.json')) return true;
  if (base.startsWith('.') || base.startsWith('#') || base.startsWith('~')) return true;
  return /___jb_(tmp|old)___|\.(tmp|swp|swo|bak|orig)\.json$/i.test(base);
}

/**
 * One changed asset file → the change record /events serves ({type, id, action, ok}, `error` when it is invalid, plus
 * the parsed asset as `raw` when it is valid). Invalid files are announced with `ok: false` and never served as the
 * new version. Shared with the Watch live preview's Vite plugin (framework/cli/watch-live-vite.mjs).
 */
export function assetChange(file, action) {
  const type = basename(dirname(file));
  const id = basename(file, '.json');
  if (action === 'removed') return { type, id, action, ok: true };
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { type, id, action, ok: false, error: `not valid JSON: ${e.message}` }; }
  const v = validateAsset(raw);
  if (!v.ok) return { type, id, action, ok: false, error: (v.errors ?? []).slice(0, 3).join('; ') || 'invalid asset' };
  if (raw.type !== type) return { type, id, action, ok: false, error: `type "${raw.type}" is in the ${type}/ folder` };
  return { type, id: raw.id ?? id, action, ok: true, raw };
}

/** The URLs this server answers on: every IPv4 address when bound to all interfaces, else the bound host. */
export function devServerUrls(host, port) {
  if (host !== '0.0.0.0' && host !== '::') return [`http://${host}:${port}`];
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  return [`http://localhost:${port}`, ...ips.map((ip) => `http://${ip}:${port}`)];
}

export function startDevServer({ dir = '.', port = 7070, host = '0.0.0.0', framework = false, log = console.log } = {}) {
  const root = resolve(dir);
  // The build rule: no project is loaded without a validated manifest (the framework's own is the repo root).
  requireProject(framework ? join(FRAMEWORK_DIR, '..') : root, 'loaded');
  const assetsDir = framework ? join(FRAMEWORK_DIR, 'assets') : join(root, appTemplate(root).assetsDir);
  const manifestPath = join(root, 'axf.manifest.json');
  if (!existsSync(assetsDir)) throw new Error(`No assets folder at ${assetsDir}`);

  let rev = 1;
  let waiters = [];
  let changes = [];
  const snapshot = () => loadAssets(assetsDir).filter((a) => a.result.ok).map((a) => a.raw);

  // Last good asset per file, so a delete or rename reports the asset id (which may differ from the file name).
  const known = new Map(loadAssets(assetsDir).filter((x) => x.result.ok).map((x) => [x.file, { type: x.raw.type, id: x.raw.id }]));

  const announce = (batch) => {
    if (!batch.length) return;
    for (const c of batch) {
      rev++;
      const { raw: _raw, ...rec } = c;
      changes.push({ rev, ...rec, at: Date.now() });
      log(`  ${c.action.padEnd(8)} ${c.type}/${c.id}.json${c.from ? ` (was ${c.from.type}/${c.from.id})` : ''}${c.ok ? '' : `  invalid, not sent: ${c.error}`}  rev ${rev}`);
    }
    changes = changes.slice(-200);
    const w = waiters; waiters = [];
    for (const res of w) respond(res, eventsSince(res.since));
  };

  const eventsSince = (since) => {
    const changed = changes.filter((c) => c.rev > since);
    const bad = changed.filter((c) => !c.ok);
    return { rev, changed, ...(bad.length ? { error: bad.map((c) => `${c.type}/${c.id}: ${c.error}`).join('\n') } : {}) };
  };

  // Changes are collected for 80 ms and announced together, so an editor's write-temp-then-rename settles into one
  // record and a rename (old name gone + new name present in the same batch) is one `renamed` record.
  let pending = new Set();
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    const files = [...pending]; pending = new Set();
    const removed = []; const present = [];
    for (const file of files) {
      if (existsSync(file)) present.push(file);
      else if (known.has(file)) removed.push(file);
    }
    const batch = [];
    for (const file of present) {
      const c = assetChange(file, known.has(file) ? 'changed' : 'added');
      if (c.ok && c.action === 'added') {
        // A file that vanished in this batch with the same type (or the same asset id) is this one, renamed.
        const i = removed.findIndex((r) => known.get(r).id === c.id || dirname(r) === dirname(file));
        if (i >= 0) { const [old] = removed.splice(i, 1); c.action = 'renamed'; c.from = known.get(old); known.delete(old); }
      }
      if (c.ok) known.set(file, { type: c.type, id: c.id });
      batch.push(c);
    }
    for (const file of removed) { const k = known.get(file); known.delete(file); batch.push({ ...k, action: 'removed', ok: true }); }
    announce(batch);
  };
  const onChange = (dirPath) => (_evt, name) => {
    if (!name || isTempFile(name)) return;
    const file = join(dirPath, String(name));
    if (relative(assetsDir, file).split(/[\\/]/).length !== 2) return; // only <type>/<id>.json
    pending.add(file);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 80);
  };
  // fs.watch is recursive on Linux ≥ 20 / macOS / Windows; fall back to per-type dirs otherwise.
  const watchers = [];
  try { watchers.push(watch(assetsDir, { recursive: true }, onChange(assetsDir))); } catch {
    for (const d of new Set(loadAssets(assetsDir).map((x) => dirname(x.file)))) watchers.push(watch(d, onChange(d)));
  }

  const respond = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') return respond(res, { axf: 'dev-server@1', app: existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).app : null, rev, assets: snapshot().length, dir: relative(process.cwd(), assetsDir) });
    if (url.pathname === '/assets.json') return respond(res, { rev, assets: snapshot() });
    if (url.pathname === '/manifest.json') {
      if (existsSync(manifestPath)) return respond(res, JSON.parse(readFileSync(manifestPath, 'utf8')));
      // --framework: the framework's own starter defaults stand in for an app manifest (Watch live shows them)
      const fwDefaults = join(FRAMEWORK_DIR, 'defaults.json');
      if (framework && existsSync(fwDefaults)) return respond(res, { app: { id: 'framework', name: 'AmberX AXF framework' }, defaults: JSON.parse(readFileSync(fwDefaults, 'utf8')) });
      return respond(res, { error: 'no manifest' }, 404);
    }
    if (url.pathname.startsWith('/assets/')) {
      let file = join(assetsDir, decodeURIComponent(url.pathname.slice('/assets/'.length)));
      if (!file.startsWith(assetsDir + sep)) return respond(res, { error: 'not found' }, 404);
      if (!existsSync(file)) {
        // The asset id may differ from its file name: look it up among the last good versions.
        const [type, idJson = ''] = relative(assetsDir, file).split(/[\\/]/);
        file = [...known].find(([, k]) => k.type === type && `${k.id}.json` === idJson)?.[0];
        if (!file || !existsSync(file)) return respond(res, { error: 'not found' }, 404);
      }
      const c = assetChange(file, 'changed');
      return c.ok ? respond(res, c.raw) : respond(res, { error: c.error }, 422);
    }
    if (url.pathname === '/events') {
      const since = Number(url.searchParams.get('since') ?? 0);
      if (rev > since) return respond(res, eventsSince(since));
      res.since = since;
      waiters.push(res);
      const t = setTimeout(() => { waiters = waiters.filter((w) => w !== res); respond(res, { rev, changed: [] }); }, 25_000);
      req.on('close', () => { clearTimeout(t); waiters = waiters.filter((w) => w !== res); });
      return;
    }
    respond(res, { error: 'not found' }, 404);
  });
  server.listen(port, host, () => {
    const urls = devServerUrls(host, server.address()?.port ?? port);
    log(`AXF dev server watching ${relative(process.cwd(), assetsDir) || '.'} (${snapshot().length} assets)`);
    for (const u of urls) log(`  ${u}`);
    const lan = urls.find((u) => !/localhost|127\.0\.0\.1/.test(u)) ?? urls[0];
    log(`  web app:  open it with ?axfDev=${lan}`);
    log(`  phone:    Settings → Developer → Dev server URL = ${lan} (same Wi-Fi; emulator: http://10.0.2.2:${port})`);
  });
  server.on('close', () => { for (const w of watchers) w.close(); clearTimeout(flushTimer); });
  return server;
}
