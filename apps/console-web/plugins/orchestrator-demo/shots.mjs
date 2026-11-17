/**
 * Screenshots of the Orchestrator demo (build guided-live-demo-test-watch-orchestrator) for UI Review: the start
 * overlay, the live caption bar over the crossed-off check-list, and the summary, desktop and phone, against
 * `vite preview` of dist/. The plugin's routes are answered from states the real runner makes (runner.mjs newDemoRun /
 * view over the core), so the pictures show real act titles, captions and counts; nothing touches a console or a build.
 * The start overlay is also taken once per dialog option (ui-choices@1: opt-<id>--…), each drawn with that option's
 * dialog asset data applied the way the dialog engine applies it (root data-fx-dialog* attributes, --fx-dialog-w).
 *
 *   node apps/console-web/plugins/orchestrator-demo/shots.mjs <out-dir>   (build first: npm run build in apps/console-web)
 *   OD_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import * as core from '../../../../framework/core/live-demo.mjs';
import * as R from './runner.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node apps/console-web/plugins/orchestrator-demo/shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.OD_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

// ── states from the real runner ──────────────────────────────────────────────────────────────────────────────────
const T0 = Date.now() - 12 * 60000;
const at = (s) => new Date(T0 + s * 1000).toISOString();
const base = R.newDemoRun({ pause: true, now: at(0), suffix: 'k4d2x9' });
const overlay = base;
let run = core.step(base.run, { type: 'continue', at: at(5), pause: false });
let t = 5;
const play = (n, results = {}) => {
  for (let i = 0; i < n; i += 1) {
    const act = core.currentAct(run);
    run = core.step(run, { type: 'focused', at: at(t += 2) });
    run = core.step(run, { type: 'start', at: at(t += 5) });
    const b = act.builds[0] ?? '';
    const r = results[act.id] ?? { result: 'pass', observed: `${act.title}: seen`, evidence: b ? [{ kind: 'status', text: b, ref: `row:${b}`, at: at(t) }] : [] };
    run = core.step(run, { type: 'finish', at: at(t += 8), result: r });
    if (i < n - 1 || run.state !== 'cooldown') run = core.step(run, { type: 'tick', at: at(t += 31) });
  }
};
play(7);
const live = { run, driver: { ...base.driver, held: false } };
const nowLive = Date.parse(run.enteredAt) + 12000; // 18 s left of the 30 s gap
const liveView = R.view(live, nowLive);
run = core.step(run, { type: 'tick', at: at(t += 31) });
play(run.acts.length - 7, { 'stale-row-cleanup': { result: 'fail', observed: 'the row was still there after 15 s', error: 'expected row-gone demo-grid-k4d2x9 within 15 s; not seen', evidence: [{ kind: 'error', text: 'demo-grid-k4d2x9 still in the grid', ref: 'row:demo-grid-k4d2x9', at: at(t) }] } });
while (!core.TERMINAL_STATES.includes(run.state)) run = core.step(run, { type: 'tick', at: at(t += 31) });
const done = { run, driver: { ...base.driver, cleaned: true } };
const summary = { ...R.summaryRecord(run) };
const doneView = R.view(done);
const SETTINGS = { $axf: 'orchestrator-demo-settings@1', pauseBetweenSteps: true, minGapMs: 30000 };
const DEPS = { ok: true, missing: [], reason: '', skipped: '', source: 'live-build-status-real-time-grids-15' };
const STATES = { overlay: R.view(overlay), live: liveView, done: doneView };

// ── the overlay's dialog options (ui-choices@1) ──────────────────────────────────────────────────────────────────
export const OPTIONS = [
  { id: 'spotlight', label: 'Spotlight modal', data: { variant: 'modal', width: 560, backdrop: 'blur', animation: 'scale', header: 'accent-bar', closeOnBackdrop: false } },
  { id: 'sheet', label: 'Bottom sheet', data: { variant: 'sheet', width: 680, backdrop: 'dim', animation: 'slide', header: 'filled', closeOnBackdrop: false } },
  { id: 'compact', label: 'Compact card', data: { variant: 'modal', width: 440, backdrop: 'dim', animation: 'fade', header: 'plain', closeOnBackdrop: false } },
];
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.OD_SHOTS_DEBUG ? 'inherit' : 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  const say = (m) => process.stderr.write(`${m}\n`);
  const take = async ({ name, state, open, device, option = null, wait = '' }) => {
    const mobile = device === 'phone';
    const ctx = await browser.newContext({ viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      const p = u.pathname.replace('/api/plugins/orchestrator-demo', '');
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname.startsWith('/api/plugins/orchestrator-demo')) {
        if (p === '/state') return json({ ok: true, state: STATES[state], settings: SETTINGS, deps: DEPS });
        if (p === '/summary') return json({ ok: true, summary, checklist: STATES.done.checklist, cleanup: { removed: Object.values(base.driver.ids), errors: [] } });
        if (p === '/settings') return json({ ok: true, settings: SETTINGS });
        if (p === '/deps') return json({ ok: true, deps: DEPS });
      }
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    // deterministic: open the page through console-control (that loads the plugin), then press the real button
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    await sleep(8000); // the shell restores its last page while plugins load
    for (let i = 0; i < 10; i += 1) {
      await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:orchestrator-demo' }));
      await sleep(1500);
      if (await page.locator('.axp-orchestrator-demo__page').count()) break;
    }
    if (open === 'start') await page.getByRole('button', { name: 'Start the demo' }).click({ timeout: 15_000 }).catch((e) => say(`${name}: ${e.message.split('\n')[0]}`));
    if (open === 'summary') await page.getByRole('button', { name: 'Summary' }).click({ timeout: 15_000 }).catch((e) => say(`${name}: ${e.message.split('\n')[0]}`));
    if (option) {
      await page.evaluate((d) => {
        const el = document.documentElement;
        el.dataset.fxDialog = d.variant; el.dataset.fxDialogHeader = d.header; el.dataset.fxDialogAnim = 'none';
        el.style.setProperty('--fx-dialog-w', `${d.width}px`);
      }, option.data);
    }
    await page.waitForSelector(wait, { timeout: 30_000 }).catch((e) => say(`${name}: ${e.message.split('\n')[0]}`));
    await sleep(1500);
    const file = join(OUT, `${option ? `opt-${option.id}--` : ''}${name}-${device}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    await ctx.close();
  };
  for (const device of (process.env.OD_SHOTS_DEVICES || 'desktop,phone').split(',')) {
    await take({ name: 'start-overlay', state: 'overlay', open: 'start', device, wait: '[data-axf-target="dialog:orchestrator-demo.start"]' });
    for (const option of OPTIONS) await take({ name: 'start-overlay', state: 'overlay', open: 'start', device, option, wait: '[data-axf-target="dialog:orchestrator-demo.start"]' });
    await take({ name: 'caption-bar', state: 'live', open: 'page', device, wait: '[data-axf-target="view:orchestrator-demo/caption"]' });
    await take({ name: 'summary', state: 'done', open: 'summary', device, wait: '[data-axf-target="dialog:orchestrator-demo.summary"]' });
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
