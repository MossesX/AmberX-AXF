#!/usr/bin/env node
// rebuild-shots — screenshots of the web Dev Console for rebuild logs (rebuild-log rule, Oct 20 2026).
//
//   node framework/cli/rebuild-shots.mjs --repo <checkout> --out <dir> --shots <shots.json> [--label before|after] [--web-port N] [--env K=V …]
//
// --web-port pins Vite's port (an app that must be on a known origin, e.g. allow-listed on a local axHub); --env adds
// variables for the API and Vite (AXF_APPEARANCE_HUB=http://127.0.0.1:18080 points the console at a local hub). A shot
// may carry "signIn": {"url", "username", "password"}: the browser posts that sign-in form first (a local hub's
// /auth/login) so the app has a hub session; "path" (the page to open, default "/") and "userAgent" (a suffix such as
// "AXF-Embed/patches") show the console the way a host app embeds it (embed@1).
//
// Starts the console API (uvicorn, scratch data dir, throwaway token) and Vite from <checkout>/apps/console-web,
// opens it in headless Chromium (Playwright), and for every shot runs its steps and saves
// <out>/<label>/<name>-<phone|desktop>.png. Shots file: [{ "name": "plugin-manager", "steps": [
//   {"search": "Plugin Manager"}            // Ctrl+K, type, Enter (the console's global search)
//   {"press": "Escape"} {"click": "text=Cards"} {"type": "abc"} {"wait": 800} {"eval": "js expression"}
// ], "viewports": ["phone","desktop"] }].
// --submit <kind> sends what was captured to UI Review for Brett's approval (the plugin providing ui-review@1, its
// review.mjs) as one ui-review-item@1: --name "…" (--title is the same) and --app are required, --group "<name>" (ask
// Brett; headless builds name it after the build), the screen is the shots' names (or --screen), --source / --by
// (else the Claude Code session running this), --build, --step, --branch, --pr, --notes; --console posts to the running
// console (AXF_CONSOLE_URL + AXF_TOKEN) instead of this checkout's data folder. Anything missing is refused, field named.
// Needs: Python with the console's requirements, npm deps in apps/console-web, Playwright + Chromium
// (PLAYWRIGHT_BROWSERS_PATH). Android screenshots come from CI (see _claude/rules/RULES.md, rebuild log).
import { spawn, execSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import net from 'node:net';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : a), []));
if (!args.repo || !args.out || !args.shots) { console.error('usage: rebuild-shots --repo <checkout> --out <dir> --shots <shots.json> [--label after]'); process.exit(2); }
const repo = resolve(args.repo), web = join(repo, 'apps/console-web'), label = args.label || 'after';
const shots = JSON.parse(readFileSync(args.shots, 'utf8'));
const VIEWPORTS = { phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 } };

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const waitFor = async (url, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`timeout waiting for ${url}`); };

let playwright;
const globalRoot = (() => { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return ''; } })();
for (const base of [web, repo, process.cwd(), globalRoot && join(globalRoot, '..')].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found: npm i -D playwright (browsers come from PLAYWRIGHT_BROWSERS_PATH)'); process.exit(2); } }

const token = 'shots-' + Math.random().toString(36).slice(2, 12);
const data = mkdtempSync(join(tmpdir(), 'axf-shots-'));
const apiPort = await freePort(), webPort = args['web-port'] ? Number(args['web-port']) : await freePort();
// every --env counts (args keeps only the last value of a repeated flag)
const envArgs = process.argv.slice(2).flatMap((v, i, all) => (v === '--env' && typeof all[i + 1] === 'string' && all[i + 1].includes('=') ? [all[i + 1]] : []));
const extraEnv = Object.fromEntries(envArgs.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
const env = { ...process.env, ...extraEnv, AXF_TOKEN: token, AXF_DATA_DIR: data, AXF_TOKEN_FILE: join(data, 'env'), AXF_STATE: join(data, 'state.json'), AXF_API: `http://127.0.0.1:${apiPort}` };
const procs = [];
const run = (cmd, argv, cwd) => { const p = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; }); p.log = () => log.slice(-4000); procs.push(p); return p; };
const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });

const api = run('python3', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(apiPort)], join(web, 'server'));
const vite = run('npx', ['vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], web);
try { await waitFor(`http://127.0.0.1:${apiPort}/api/health`); } catch (e) { console.error(api.log()); throw e; }
try { await waitFor(`http://127.0.0.1:${webPort}/`); } catch (e) { console.error(vite.log()); throw e; }

const browser = await playwright.chromium.launch();
const saved = [];
try {
  for (const shot of shots) {
    for (const vp of shot.viewports || ['phone', 'desktop']) {
      // "userAgent" (a host app's marker, e.g. "AXF-Embed/patches") and "path" (e.g. "/?axf-embed=patches") show the console as another app embeds it (embed@1).
      const ctx = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: shot.colorScheme || 'dark', ...(shot.userAgent ? { userAgent: `Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 ${shot.userAgent}` } : {}) });
      await ctx.addInitScript((t) => { try { localStorage.setItem('axf-console:token', t); } catch { /* blocked */ } }, token);
      const page = await ctx.newPage(); page.on('pageerror', (e) => console.error(`[page error] ${shot.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));
      // AXF_SHOTS_DEBUG=1: the page's console errors too (a React render crash shows only there)
      if (process.env.AXF_SHOTS_DEBUG) page.on('console', (m) => { if (m.type() === 'error') console.error(`[console] ${shot.name}/${vp}: ${m.text().slice(0, 600)}`); });
      if (shot.signIn) {
        // a hub session first (local axHub): post its sign-in form, keep the cookie in this context
        await page.goto(shot.signIn.url, { waitUntil: 'load' });
        await page.fill('input[name=username]', shot.signIn.username); await page.fill('input[name=password]', shot.signIn.password);
        await page.click('button[type=submit]'); await page.waitForTimeout(800);
      }
      // a cold Vite dev server on the VPS compiles the whole console on the first load: give it two minutes
      await page.goto(`http://127.0.0.1:${webPort}${shot.path || '/'}`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForTimeout(shot.settle ?? 3500);
      for (const s of shot.steps || []) {
        if (s.search) { await page.keyboard.press('Control+K'); await page.keyboard.type(s.search, { delay: 20 }); await page.waitForTimeout(500); await page.keyboard.press('Enter'); }
        else if (s.press) await page.keyboard.press(s.press);
        else if (s.click) await page.click(s.click, { timeout: 8000 });
        else if (s.type) await page.keyboard.type(s.type, { delay: 20 });
        else if (s.eval) await page.evaluate(s.eval);
        await page.waitForTimeout(s.wait ?? 700);
      }
      const dir = join(resolve(args.out), label); mkdirSync(dir, { recursive: true });
      const file = join(dir, `${shot.name}-${vp}.png`);
      await page.screenshot({ path: file, fullPage: !!shot.fullPage });
      saved.push(file); await ctx.close();
    }
  }
} finally { await browser.close(); stop(); }
console.log(saved.join('\n'));
// Keep the repo light: scale + palette-compress what was just captured (no-op without Pillow).
try { execSync(`python3 ${JSON.stringify(join(dirname(fileURLToPath(import.meta.url)), 'shrink-shots.py'))} ${JSON.stringify(join(resolve(args.out), label))}`, { stdio: 'inherit' }); } catch { /* shrinking is best effort */ }
if (!existsSync(join(resolve(args.out), label))) process.exit(1);
if (args.submit) submitForReview(join(resolve(args.out), label), saved);

/** The UI Review submitter, found by capability (ui-review@1), never by plugin folder name. */
function submitForReview(dir, files) {
  const plugins = join(dirname(fileURLToPath(import.meta.url)), '../../apps/console-web/plugins');
  const owner = existsSync(plugins) ? readdirSync(plugins).map((n) => join(plugins, n)).find((d) => { try { return JSON.parse(readFileSync(join(d, 'plugin.json'), 'utf8')).provides?.includes('service:ui-review@1') && existsSync(join(d, 'review.mjs')); } catch { return false; } }) : null;
  if (!owner) { console.error('--submit: no plugin provides ui-review@1 here; screenshots kept, nothing submitted'); process.exitCode = 1; return; }
  const kind = args.submit === true ? 'screen' : String(args.submit);
  const name = typeof args.name === 'string' ? args.name : typeof args.title === 'string' ? args.title : '';
  const screen = typeof args.screen === 'string' ? args.screen : [...new Set(shots.map((s) => s.name))].join(', ');
  const argv = [join(owner, 'review.mjs'), 'submit', '--kind', kind, '--name', name, '--screen', screen, '--shots', files.join(',')];
  for (const k of ['app', 'group', 'source', 'by', 'build', 'step', 'branch', 'pr', 'notes']) if (typeof args[k] === 'string') argv.push(`--${k}`, args[k]);
  if (args.console) argv.push('--console');
  const r = spawnSync(process.execPath, argv, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`--submit failed (exit ${r.status}); screenshots kept in ${dir}`); process.exitCode = 1; }
}
