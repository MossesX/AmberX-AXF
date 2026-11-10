/**
 * A real console for the UI checks (test-ui.mjs, coverage.mjs): the console API (uvicorn) and Vite on free ports, a
 * temporary data folder, look document and inline-edit data, no axHub (AXF_APPEARANCE_HUB=off), and Playwright found
 * wherever it is installed. `startConsole()` → { web, api, token, rest(method, path, body), browser, stop() } or null
 * when Playwright isn't installed (the caller skips).
 */
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB = resolve(HERE, '../..');
export const REPO = resolve(WEB, '../..');

export function findPlaywright() {
  const globalRoot = (() => { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return ''; } })();
  for (const base of [WEB, REPO, process.cwd(), process.env.PLAYWRIGHT_DIR, globalRoot && join(globalRoot, '..'), '/tmp/sc-pw'].filter(Boolean)) {
    try { return createRequire(join(base, 'x.js'))('playwright'); } catch { /* next */ }
  }
  return null;
}

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const waitFor = async (url, ms = 120_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`timeout waiting for ${url}`); };

/** Poll until `fn` is truthy (the console server runs a Node process per call; a busy VPS can take seconds). */
export const until = async (fn, ms = 15_000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* again */ } await new Promise((r) => setTimeout(r, 300)); } return v; };

export async function startConsole() {
  const playwright = findPlaywright();
  if (!playwright) return null;
  const token = `ie-${Math.random().toString(36).slice(2, 12)}`;
  const data = mkdtempSync(join(tmpdir(), 'inline-edit-ui-data-'));
  const apiPort = await freePort();
  const webPort = await freePort();
  const env = {
    ...process.env, AXF_TOKEN: token, AXF_DATA_DIR: data, AXF_TOKEN_FILE: join(data, 'env'), AXF_STATE: join(data, 'state.json'), AXF_API: `http://127.0.0.1:${apiPort}`,
    AXF_APPEARANCE_HUB: 'off', AXF_APPEARANCE_FILE: join(data, 'appearance.json'), AXF_INLINE_EDIT_DATA_DIR: join(data, 'inline-edit'),
  };
  const procs = [];
  const run = (cmd, argv, cwd) => { const p = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; }); p.log = () => log.slice(-3000); procs.push(p); return p; };
  const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } } };
  process.on('exit', stop);
  const api = run('python3', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(apiPort)], join(WEB, 'server'));
  const vite = run('npx', ['vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], WEB);
  try { await waitFor(`http://127.0.0.1:${apiPort}/api/health`); } catch (e) { console.error(api.log()); stop(); throw e; }
  try { await waitFor(`http://127.0.0.1:${webPort}/`); } catch (e) { console.error(vite.log()); stop(); throw e; }
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const rest = async (method, path, body) => { const r = await fetch(`http://127.0.0.1:${apiPort}/api/plugins/inline-edit/${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) }); return r.json(); };
  const browser = await playwright.chromium.launch();
  return {
    web: `http://127.0.0.1:${webPort}`, api: `http://127.0.0.1:${apiPort}`, token, rest, browser,
    async page(vp = 'desktop') {
      const ctx = await browser.newContext(vp === 'phone' ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' } : { viewport: { width: 1366, height: 860 }, colorScheme: 'dark' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('axf-console:token', t); } catch { /* blocked */ } }, token);
      const page = await ctx.newPage();
      page.setDefaultTimeout(30_000);
      page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
      return { ctx, page };
    },
    async stop() { await browser.close().catch(() => undefined); stop(); },
  };
}
