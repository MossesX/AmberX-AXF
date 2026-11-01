#!/usr/bin/env node
/**
 * Watch live (watch-live@1) — hot-rendered previews of what a headless Claude session is changing.
 *
 *   node framework/cli/watch-live.mjs watch --session <name> [--worktree .] [--change <id>] [--parent <pid>] [--every 10]
 *        started by deploy/claude-headless.sh next to every session: finds the apps the session touches (git), starts
 *        a live preview for each (Vite dev server with HMR, plus `axf dev` for asset-only projects) on free local
 *        ports, registers them, keeps the focus file current, and stops everything when the session (or --parent) ends
 *   node framework/cli/watch-live.mjs focus <app> [route] [selector] [--note "…"]   (also `axf focus …`)
 *        the session says which screen and element it is working on: writes .axf-focus.json in the checkout
 *   node framework/cli/watch-live.mjs list | targets [--worktree .] | stop --session <name>
 *
 * Registry: one JSON file per session in AXF_PREVIEW_REGISTRY (default /opt/axf/.axf-console/previews on the VPS,
 * which the console container sees as $AXF_ROOT/.axf-console/previews; else <repo>/.axf-console/previews). The
 * console server (apps/console-web/server/previews.py) reads it and proxies each preview at
 * /preview/<session>/<app>/ behind its own auth, so previews never get a public port: they listen on
 * AXF_PREVIEW_HOST (default: the Docker network gateway the console reaches the host on, else 127.0.0.1).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const CONTRACT = 'watch-live@1';
export const FOCUS_FILE = '.axf-focus.json';
/** A registry file not refreshed for this long is treated as gone (the watcher heartbeats every --every seconds). */
export const STALE_MS = 120_000;
export const SESSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * What can be hot-rendered, and how. `vite` = the app's own dev server; `shell` = the demo app rendering another
 * project's assets through the web port (asset-only projects, Android/Compose screens, the framework's assets,
 * templates and boilerplates). Open list: add a row for a new app.
 */
export const TARGETS = [
  { app: 'console-web', label: 'Dev Console', match: /^apps\/console-web\//, kind: 'vite', dir: 'apps/console-web', liveFramework: true },
  { app: 'axhub-web', label: 'axHub web', match: /^apps\/axhub-web\//, kind: 'vite', dir: 'apps/axhub-web' },
  { app: 'amberx-droid', label: 'AmberX (web layer)', match: /^apps\/amberx-droid\/(?!android\/)/, kind: 'vite', dir: 'apps/amberx-droid', note: 'Native (Capacitor) code shows in the next APK.' },
  { app: 'patches-web', label: 'Patches web', match: /^apps\/patches-web\//, kind: 'vite', dir: 'apps/patches-web' },
  { app: 'walkthrough-studio', label: 'Walkthrough Studio', match: /^apps\/walkthrough-studio\//, kind: 'vite', dir: 'apps/walkthrough-studio' },
  { app: 'demo', label: 'Demo', match: /^apps\/demo\//, kind: 'vite', dir: 'apps/demo', liveFramework: true },
  { app: 'framework', label: 'Framework (assets, engines, controls, templates)', match: /^framework\/(assets|core|react|ui|schemas|templates|boilerplates)\//, kind: 'shell', dir: 'apps/demo', assets: { framework: true }, liveFramework: true },
  { app: 'console', label: 'Dev Console (Android)', match: /^apps\/console\//, kind: 'shell', dir: 'apps/demo', assets: { dir: 'apps/console' }, android: true },
  { app: 'axhub-android', label: 'axHub (Android)', match: /^apps\/axhub-android\//, kind: 'shell', dir: 'apps/demo', assets: { dir: 'apps/axhub-android' }, android: true },
  { app: 'voicevault', label: 'Voice Vault (Android)', match: /^apps\/voicevault\//, kind: 'shell', dir: 'apps/demo', assets: { dir: 'apps/voicevault' }, android: true },
  { app: 'patches', label: 'Patches (Android)', match: /^apps\/patches\//, kind: 'shell', dir: 'apps/demo', assets: { dir: 'apps/patches' }, android: true },
];
export const ANDROID_NOTE = 'Android/Compose screen shown through the web port: asset and layout changes render live here; Kotlin/Compose code changes only show in the next APK.';

export function targetFor(file) {
  return TARGETS.find((t) => t.match.test(file)) ?? null;
}

/** Changed files → the apps they touch (in TARGETS order). */
export function touchedApps(files) {
  const apps = new Set();
  for (const f of files) { const t = targetFor(f); if (t) apps.add(t.app); }
  return TARGETS.filter((t) => apps.has(t.app)).map((t) => t.app);
}

/** Where the registry lives (see the header). */
export function registryDir(env = process.env) {
  if (env.AXF_PREVIEW_REGISTRY) return resolve(env.AXF_PREVIEW_REGISTRY);
  if (existsSync('/opt/axf/.axf-console')) return '/opt/axf/.axf-console/previews';
  return join(REPO, '.axf-console', 'previews');
}

const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
};

export function writeEntry(dir, entry) {
  if (!SESSION_RE.test(entry.session)) throw new Error(`session name: ${entry.session}`);
  writeJson(join(dir, `${entry.session}.json`), { contract: CONTRACT, ...entry, updatedAt: Date.now() });
}

export function removeEntry(dir, session) {
  rmSync(join(dir, `${session}.json`), { force: true });
}

/** Every live session entry (stale or broken files are skipped). */
export function listEntries(dir, now = Date.now()) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const e = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (e?.contract === CONTRACT && now - Number(e.updatedAt ?? 0) < STALE_MS) out.push(e);
    } catch { /* half-written: next read */ }
  }
  return out;
}

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

/** Files this checkout changes compared with where it branched from main (committed, staged, unstaged, new). */
export function changedFiles(worktree) {
  const base = git(worktree, ['merge-base', 'HEAD', 'origin/main']) || git(worktree, ['rev-parse', 'HEAD']);
  const files = new Set();
  for (const out of [git(worktree, ['diff', '--name-only', base]), git(worktree, ['ls-files', '--others', '--exclude-standard'])]) {
    for (const f of out.split('\n')) if (f.trim()) files.add(f.trim());
  }
  return [...files];
}

/** A selector guess for a file being edited (asset type → its control; plugin → its `axp-`/folder classes). */
export function guessSelector(file) {
  const asset = file.match(/\/assets\/(?:axf\/assets\/)?([a-z-]+)\/[^/]+\.json$/);
  const BY_TYPE = {
    toolbar: '[class*="fx-toolbar"]', 'nav-menu': '[class*="fx-nav"]', 'app-menu': '[class*="fx-appmenu"]', menubar: '[class*="fx-menubar"]',
    banner: '[class*="fx-banner"]', dialog: '[role="dialog"]', popup: '[class*="fx-popup"]', 'context-menu': '[class*="fx-ctx"]',
    button: '.fx-btn', slider: '[class*="fx-slider"]', container: '[class*="fx-container"]', layout: 'main', 'tab-group': '[class*="fx-tabs"]',
  };
  if (asset) return BY_TYPE[asset[1]] ?? '';
  const plugin = file.match(/^apps\/console-web\/plugins\/([^/]+)\//);
  if (plugin) return `[class*="axp-${plugin[1]}"], [class*="${plugin[1]}"]`;
  return '';
}

/** The focus file the session wrote, or an automatic one from the most recently edited file. */
/** Files that never draw anything (server code, tests, docs, scripts): not worth focusing on. */
export const NOT_UI = /(^|\/)(server|scripts|test|tests|__tests__)\/|\.(py|md|sh|txt|lock)$|(^|\/)test\.[a-z]+$|\.test\.[a-z]+$|\.d\.m?ts$/;

export function autoFocus(worktree, files, now = Date.now()) {
  let best = null;
  for (const f of files) {
    const t = targetFor(f);
    if (!t || NOT_UI.test(f)) continue;
    let mtime = 0;
    try { mtime = statSync(join(worktree, f)).mtimeMs; } catch { continue; }
    if (!best || mtime > best.mtime) best = { f, t, mtime };
  }
  if (!best) return null;
  return { app: best.t.app, route: '', selector: guessSelector(best.f), note: `editing ${best.f}`, auto: true, at: Math.round(best.mtime) || now };
}

export function readFocusFile(worktree) {
  try { return JSON.parse(readFileSync(join(worktree, FOCUS_FILE), 'utf8')); } catch { return null; }
}

/** `axf focus <app> [route] [selector] [--note]`: the session's own focus (wins over the automatic one). */
export function writeFocus(worktree, { app, route = '', selector = '', note = '' }) {
  if (!app) throw new Error('Usage: axf focus <app> [route] [selector] [--note "…"]');
  const known = TARGETS.some((t) => t.app === app);
  const focus = { app, route, selector, ...(note ? { note } : {}), at: Date.now() };
  writeJson(join(worktree, FOCUS_FILE), focus);
  return { focus, known };
}

/** A free TCP port on host. */
export function freePort(host = '127.0.0.1') {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, host, () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

/** The address previews listen on: reachable by the console container, never public. */
export function previewHost(env = process.env) {
  if (env.AXF_PREVIEW_HOST) return env.AXF_PREVIEW_HOST;
  const net = env.AXF_PREVIEW_NETWORK || 'coolify';
  const r = spawnSync('docker', ['network', 'inspect', net, '-f', '{{(index .IPAM.Config 0).Gateway}}'], { encoding: 'utf8' });
  const ip = r.status === 0 ? r.stdout.trim() : '';
  return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : '127.0.0.1';
}

/** The generated Vite config that wraps the app's own and adds the Watch live plugin (not committed). */
export function wrapperConfig(opts) {
  return `// Generated by framework/cli/watch-live.mjs for a Watch live preview. Not committed (.gitignore: .axf-preview*).
import { loadConfigFromFile, mergeConfig } from 'vite';
const OPTS = ${JSON.stringify(opts, null, 2)};
export default async (env) => {
  const loaded = await loadConfigFromFile(env, undefined, OPTS.appDir);
  const { axfWatchLive, liveFramework } = await import(OPTS.plugin);
  return mergeConfig(loaded?.config ?? {}, {
    base: OPTS.base,
    cacheDir: OPTS.cacheDir,
    clearScreen: false,
    plugins: [axfWatchLive(OPTS), ...(OPTS.liveFramework ? [liveFramework(OPTS)] : [])],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { host: OPTS.host, port: OPTS.port, strictPort: true, open: false, allowedHosts: true, fs: { allow: [OPTS.worktree] } },
  });
};
`;
}

/** node_modules for an app: already there, borrowed from the console checkout, or installed (slow, once). */
function ensureDeps(appDir, rel, log) {
  if (existsSync(join(appDir, 'node_modules', 'vite'))) return Promise.resolve(true);
  const borrowed = join(process.env.AXF_PREVIEW_DEPS_ROOT || '/opt/axf', rel, 'node_modules');
  if (existsSync(join(borrowed, 'vite')) && !existsSync(join(appDir, 'node_modules'))) {
    try { symlinkSync(borrowed, join(appDir, 'node_modules'), 'dir'); return Promise.resolve(true); } catch { /* fall through */ }
  }
  log(`installing ${rel} dependencies for its preview (once)…`);
  const args = existsSync(join(appDir, 'package-lock.json')) ? ['ci', '--no-audit', '--no-fund', '--loglevel=error'] : ['install', '--no-audit', '--no-fund', '--loglevel=error'];
  return new Promise((ok) => {
    const p = spawn('npm', args, { cwd: appDir, stdio: 'ignore' });
    p.on('exit', (code) => ok(code === 0 && existsSync(join(appDir, 'node_modules', 'vite'))));
    p.on('error', () => ok(false));
  });
}

class Watcher {
  constructor({ session, worktree, change = '', parent = 0, every = 10, log = console.log, dir = registryDir(), host = previewHost(), spawnFn = spawn }) {
    if (!SESSION_RE.test(session)) throw new Error('--session is a tmux-style name (letters, digits, . _ -)');
    Object.assign(this, { session, worktree: resolve(worktree), change, parent: Number(parent) || 0, every, log, dir, host, spawnFn });
    this.apps = {};
    this.children = [];
    this.branch = git(this.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  save() {
    writeEntry(this.dir, { session: this.session, worktree: this.worktree, branch: this.branch, change: this.change, host: this.host, pid: process.pid, focus: readFocusFile(this.worktree), apps: this.apps });
  }

  async start(app) {
    const t = TARGETS.find((x) => x.app === app);
    if (!t || this.apps[app]) return;
    const appDir = join(this.worktree, t.dir);
    const entry = { app, label: t.label, kind: t.kind, status: 'starting', startedAt: Date.now(), android: !!t.android, note: t.android ? ANDROID_NOTE : (t.note ?? ''), route: '' };
    this.apps[app] = entry;
    this.save();
    if (!existsSync(join(appDir, 'package.json'))) { Object.assign(entry, { status: 'failed', why: `${t.dir} is not in this checkout` }); return this.save(); }
    if (!(await ensureDeps(appDir, t.dir, this.log))) { Object.assign(entry, { status: 'failed', why: `npm install failed in ${t.dir}` }); return this.save(); }
    const base = `/preview/${this.session}/${app}/`;
    try {
      if (t.assets) {
        entry.assetsPort = await freePort(this.host);
        const devArgs = [join(REPO, 'framework', 'cli', 'axf.mjs'), 'dev', ...(t.assets.framework ? ['--framework'] : [join(this.worktree, t.assets.dir)]), '--port', String(entry.assetsPort), '--host', this.host];
        this.track(this.spawnFn(process.execPath, devArgs, { cwd: this.worktree, stdio: 'ignore' }), app);
      }
      entry.port = await freePort(this.host);
      const assetsDirs = [join(appDir, 'src', 'assets')];
      const cfg = join(appDir, `.axf-preview.${app}.vite.config.mjs`);
      writeFileSync(cfg, wrapperConfig({
        app, appDir, worktree: this.worktree, base, host: this.host, port: entry.port, cacheDir: join(appDir, `.axf-preview-cache-${app}`),
        plugin: pathToFileURL(join(REPO, 'framework', 'cli', 'watch-live-vite.mjs')).href, assetsDirs, assetsServer: !!t.assets,
        liveFramework: !!t.liveFramework, frameworkDir: join(this.worktree, 'framework'),
      }));
      const vite = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
      this.track(this.spawnFn(process.execPath, [vite, '--config', cfg], { cwd: appDir, stdio: 'ignore' }), app);
      Object.assign(entry, { status: 'ready', readyAt: Date.now() });
      this.log(`preview ${app} → ${base} (port ${entry.port}${entry.assetsPort ? `, assets ${entry.assetsPort}` : ''})`);
    } catch (e) {
      Object.assign(entry, { status: 'failed', why: String(e?.message ?? e).slice(0, 200) });
    }
    this.save();
  }

  track(child, app) {
    this.children.push(child);
    child.on?.('exit', (code) => {
      const e = this.apps[app];
      if (!this.stopping && e && e.status !== 'failed') { Object.assign(e, { status: 'failed', why: `preview server exited (${code})` }); this.save(); }
    });
  }

  tick() {
    if (this.parent) { try { process.kill(this.parent, 0); } catch { return this.stop(); } }
    const files = changedFiles(this.worktree);
    for (const app of touchedApps(files)) if (!this.apps[app]) void this.start(app);
    const own = readFocusFile(this.worktree);
    if (!own || own.auto) {
      const auto = autoFocus(this.worktree, files);
      if (auto && (!own || own.at !== auto.at || own.app !== auto.app)) writeJson(join(this.worktree, FOCUS_FILE), auto);
    }
    this.save();
  }

  run() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.every * 1000);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => this.stop());
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.timer);
    for (const c of this.children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
    removeEntry(this.dir, this.session);
    for (const t of TARGETS) {
      const appDir = join(this.worktree, t.dir);
      rmSync(join(appDir, `.axf-preview.${t.app}.vite.config.mjs`), { force: true });
    }
    this.log(`previews for ${this.session} stopped`);
    setTimeout(() => process.exit(0), 200);
  }
}

export { Watcher };

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = {};
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
    else args.push(rest[i]);
  }
  const worktree = resolve(flags.worktree ?? (git(process.cwd(), ['rev-parse', '--show-toplevel']) || '.'));
  switch (cmd) {
    case 'watch': {
      new Watcher({ session: String(flags.session ?? ''), worktree, change: flags.change ?? process.env.AXF_ADOPT_CHANGE ?? '', parent: flags.parent, every: Number(flags.every ?? 10) }).run();
      break;
    }
    case 'focus': {
      const [app, route = '', selector = ''] = args;
      const { focus, known } = writeFocus(worktree, { app, route, selector, note: flags.note === true ? '' : flags.note ?? '' });
      console.log(`focus → ${focus.app}${focus.route ? ` ${focus.route}` : ''}${focus.selector ? ` ${focus.selector}` : ''}${known ? '' : `  (note: "${app}" is not a preview target: ${TARGETS.map((t) => t.app).join(', ')})`}`);
      break;
    }
    case 'targets': {
      const files = changedFiles(worktree);
      console.log(JSON.stringify({ apps: touchedApps(files), focus: readFocusFile(worktree) ?? autoFocus(worktree, files) }, null, 2));
      break;
    }
    case 'list': {
      console.log(JSON.stringify(listEntries(registryDir()), null, 2));
      break;
    }
    case 'stop': {
      const dir = registryDir();
      const e = listEntries(dir).find((x) => x.session === flags.session);
      if (e?.pid) { try { process.kill(e.pid, 'SIGTERM'); } catch { /* gone */ } }
      removeEntry(dir, String(flags.session ?? ''));
      console.log(`stopped ${flags.session}`);
      break;
    }
    default:
      console.log('Usage: watch-live.mjs watch --session <name> | focus <app> [route] [selector] [--note …] | targets | list | stop --session <name>');
      process.exitCode = cmd ? 2 : 0;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
