#!/usr/bin/env node
// Screenshots of axHub web and AmberX (built dist, `vite preview`) with the hub's appearance document mocked in the
// browser (Playwright routes), so the apps come up on the one shared look without a hub session.
//   node _claude/builds/reports/one-look-default/shots/apps-shots.mjs --repo <checkout> --out <dir> --label after [--doc <appearance.json>]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : a), []));
if (!args.repo || !args.out) { console.error('usage: apps-shots --repo <checkout> --out <dir> [--label after] [--doc <appearance.json>]'); process.exit(2); }
const repo = resolve(args.repo);
const label = args.label || 'after';
const playwright = createRequire(join(repo, 'apps', 'console-web', 'x.js'))('playwright');
const VIEWPORTS = { phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 } };
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const waitFor = async (url, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error(`timeout waiting for ${url}`); };

// the shared look as the hub holds it right now (ids only), or the file given
const doc = readFileSync(args.doc || '/projects/_shared/_data/settings/appearance.json', 'utf8');
const APPS = [
  { app: 'axhub-web', shots: [{ name: 'home' }, { name: 'appearance', steps: ["AXF.dispatch('settings.open:appearance')"] }] },
  { app: 'amberx-droid', shots: [{ name: 'home' }, { name: 'appearance', steps: ["AXF.dispatch('settings.open:appearance')"] }] },
];
const procs = [];
const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } } };
process.on('exit', stop);

const browser = await playwright.chromium.launch();
const saved = [];
try {
  for (const { app, shots } of APPS) {
    const port = await freePort();
    const p = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: join(repo, 'apps', app), detached: true, stdio: 'ignore' });
    procs.push(p);
    await waitFor(`http://127.0.0.1:${port}/`);
    for (const shot of shots) for (const vp of ['phone', 'desktop']) {
      const ctx = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: 'dark' });
      const origin = `http://127.0.0.1:${port}`;
      const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,if-match,if-none-match,accept', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS', 'Access-Control-Expose-Headers': 'etag' };
      // the hub, mocked: the appearance document (read + a write that is accepted), a live stream that just ends, everything else 401
      await ctx.route('https://axhub.amberxai.com/**', (route) => {
        const url = route.request().url(); const method = route.request().method();
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (url.includes('/data/shared/settings/appearance.json')) return route.fulfill({ status: method === 'PUT' ? 200 : 200, headers: { ...cors, 'Content-Type': 'application/json', ETag: '"shot-1"' }, body: method === 'PUT' ? route.request().postData() ?? doc : doc });
        if (url.includes('/data-events')) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: ': ok\n\n' });
        return route.fulfill({ status: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: '{"error":"shot: no hub session"}' });
      });
      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(120000);
      page.on('pageerror', (e) => console.error(`[page error] ${app}/${shot.name}: ${e.message}`));
      await page.goto(`${origin}/`, { waitUntil: 'load' });
      await page.waitForTimeout(4000);
      for (const s of shot.steps || []) { await page.evaluate(s); await page.waitForTimeout(1500); }
      const dir = join(resolve(args.out), label, app); mkdirSync(dir, { recursive: true });
      const file = join(dir, `${shot.name}-${vp}.png`);
      await page.screenshot({ path: file });
      saved.push(file); await ctx.close();
    }
  }
} finally { await browser.close(); stop(); }
console.log(saved.join('\n'));
