/**
 * Screenshots of Gate → Auto-lander → Server (the lander, lander@1, Pipeline 2.0) and of the read-only Merge queue view
 * for UI Review: desktop and phone, one pair per list layout (grid, cards, compact: the gate.view choice) plus one pair of
 * the merge queue, against `vite preview` of dist/ with the routes answered from a fixed fixture (no VPS, no GitHub). Each shot opens the tab through
 * console-control (`view:gate/tab:gate.tabs=auto-lander`) and selects a build row, like the deep link does.
 *
 *   node scripts/auto-lander-shots.mjs <out-dir>        (build first: npm run build)
 *   AL_SHOTS_PORT=7097 · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/auto-lander-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.AL_SHOTS_PORT) || 7097;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const at = (min) => new Date(Date.parse('2026-11-19T13:00:00Z') - min * 60000).toISOString();
const step = (id, status, prNumber, model = 'Opus', slot = null) => ({ id, status, prNumber, model, slot });
const ROWS = [
  { build: 'console-look-axhub-skin', title: 'Console look: axHub skin', status: 'failed', attempt: 4, statusAt: at(12), waiting: [],
    failure: { kind: 'ci-red', status: 'running-ci', why: 'CI is red on 7e6a5f9 (Web Dev Console › theme-swap)', head: '7e6a5f9a1b2c', pr: 733, at: at(12), retry: 'fix', notBefore: at(-4) },
    prs: [{ pr: 731, steps: ['s1', 's2', 's3'], state: 'closed' }, { pr: 732, steps: ['s1'], state: 'merged' }, { pr: 733, steps: ['s2'], state: 'open' }],
    steps: [step('s1', 'in-pr', 732, 'Opus', 1), step('s2', 'in-pr', 733, 'Fable', 2), step('s3', 'completed', null, 'Opus', 3)] },
  { build: 'p2-status-core', title: 'Pipeline 2.0, part 1: status core', status: 'running-ci', attempt: 0, statusAt: at(6), waiting: [], failure: null,
    prs: [{ pr: 741, steps: ['s1', 's2', 's3', 's4'], state: 'open' }],
    steps: [step('s1', 'in-pr', 741, 'Fable', 1), step('s2', 'in-pr', 741, 'Opus', 2), step('s3', 'in-pr', 741, 'Opus', 3), step('s4', 'in-pr', 741, 'Opus', 4)] },
  { build: 'phone-connect-small-android-companion', title: 'Phone Connect: small Android companion', status: 'building', attempt: 0, statusAt: at(25), waiting: ['s1', 's2'], failure: null, prs: [],
    steps: [step('s1', 'building', null, 'Opus', 5), step('s2', 'building', null, 'Opus', 6)] },
];
const STATUS = {
  ok: true, $axf: 'lander-status@1',
  service: { lastTick: new Date(Date.now() - 30000).toISOString(), result: 'worked', build: 'p2-status-core', error: '', paused: false, pausedBy: '', pausedAt: '' },
  current: 'p2-status-core', queue: ROWS.map((r) => r.build), builds: ROWS,
  failing: [{ build: 'console-look-axhub-skin', attempt: 4, kind: 'ci-red', why: ROWS[0].failure.why, since: at(12), pr: 733 }],
  escalations: [],
  settings: { enabled: true, sizeCapLines: 4000, flakyReruns: 1, backoffBaseMin: 2, backoffFactor: 2, backoffMaxMin: 30, ciNoneKickMin: 10, ciTimeoutMin: 120, fixTimeoutMin: 60, notifyAfterAttempts: 3, workflow: 'android.yml', mergeMethod: 'merge' },
};
const QUEUE = { ok: true, $axf: 'merge-queue@2', at: at(0), landing: 'p2-status-core', rows: ROWS };
const GATE_SETTINGS = { ok: true, settings: { refreshSec: 600, historySize: 2000, defaultTab: 'auto-lander' } };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.AL_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const view of (process.env.AL_SHOTS_ONLY || 'grid,cards,compact').split(',')) {
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname === '/api/me') return json(ME);
        if (u.pathname === '/api/plugins/gate/auto-lander') return json(STATUS); // axf-plugin:gate
        if (u.pathname === '/api/plugins/gate/settings') return json(GATE_SETTINGS); // axf-plugin:gate
        if (u.pathname === '/api/plugins/merge-queue-view/queue') return json(QUEUE); // axf-plugin:merge-queue-view
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
      const set = await run({ verb: 'set', address: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=gate/setting:gate.view', value: view }).catch((e) => ({ ok: false, error: String(e) }));
      say(`${view} ${device}: set gate.view → ${JSON.stringify(set).slice(0, 200)}`);
      await run({ verb: 'open', address: 'view:gate/tab:gate.tabs=auto-lander' });
      await page.waitForSelector('[data-axf-toolbar="gate.auto-lander"]', { timeout: 15_000 });
      // select + open the escalated build's row (its attempt log), as the escalation banner's deep link does
      await page.locator('[data-axf-toolbar="gate.auto-lander"] ~ * strong', { hasText: /^console-look-axhub-skin$/ }).first().click({ timeout: 5000 }).catch((e) => say(`row click: ${e.message.split('\n')[0]}`));
      await sleep(900);
      const file = join(OUT, `auto-lander-${view}-${device}.png`);
      await page.screenshot({ path: file, fullPage: !mobile });
      shots.push(file);
      await ctx.close();
    }
  }
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname === '/api/plugins/merge-queue-view/queue') return json(QUEUE); // axf-plugin:merge-queue-view
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    await page.evaluate((c) => window.axfConsoleControl(c), { verb: 'open', address: 'view:merge-queue' });
    await page.waitForSelector('text=Waiting to land', { timeout: 15_000 }).catch((e) => say(`merge queue: ${e.message.split('\n')[0]}`));
    await page.locator('strong', { hasText: /^console-look-axhub-skin$/ }).first().click({ timeout: 5000 }).catch((e) => say(`row click: ${e.message.split('\n')[0]}`));
    await sleep(900);
    const file = join(OUT, `merge-queue-${device}.png`);
    await page.screenshot({ path: file, fullPage: !mobile });
    shots.push(file);
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
