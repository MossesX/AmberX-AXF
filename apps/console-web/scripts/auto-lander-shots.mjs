/**
 * Screenshots of Gate → Auto-lander → Server (build server-auto-lander-fixes-lands) for UI Review: desktop and phone,
 * one pair per list layout (grid, cards, compact: the gate.view choice), against `vite preview` of dist/ with the
 * gate's auto-lander routes answered from a fixed fixture (no VPS, no GitHub). Each shot opens the tab through
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

const at = (min) => new Date(Date.parse('2026-11-17T09:00:00Z') - min * 60000).toISOString();
const att = (build, kind, n, result, min, log, extra = {}) => ({ build, kind, n, result, at: at(min), endedAt: result === 'started' ? '' : at(min - 3), account: kind === 'red-ci' ? 'hulu0241' : kind === 'land' ? 'merge-queue' : 'server', session: kind === 'red-ci' ? `axf-${build}--fix` : '', branch: `claude/${build}`, head: 'a1b2c3d4e5f6', pr: 0, log, ...extra });
const count = (list) => { const c = { total: list.length }; for (const k of ['clash', 'red-ci', 'land']) { const l = list.filter((a) => a.kind === k); c[k] = { attempts: l.length, ok: l.filter((a) => a.result === 'ok').length, failed: l.filter((a) => a.result === 'failed').length, timeout: 0, skipped: 0, started: l.filter((a) => a.result === 'started').length, failures: l.filter((a) => a.result === 'failed').length }; } return c; };
const row = (build, pr, state, reason, attempts, extra = {}) => ({ build, pr, branch: `claude/${build}`, head: 'a1b2c3d4e5f6', state, since: at(20), reason, escalation: null, last: { action: state === 'fixing' ? 'fix-session' : 'wait', waitReason: state === 'ci-running' ? 'ci-running' : '', notBefore: '', at: at(1) }, count: count(attempts), attempts, ...extra });
const stuck = [att('console-look-axhub-skin', 'red-ci', 1, 'failed', 140, 'the fix pushed 9f3e2a1 and CI is still red\nWeb Dev Console › Python route tests\n    apps/console-web/server/tests/test_look.py:41: AssertionError'), att('console-look-axhub-skin', 'red-ci', 2, 'failed', 90, 'the fix pushed 4c1d0b2 and CI is still red'), att('console-look-axhub-skin', 'red-ci', 3, 'failed', 30, 'the fix pushed 7e6a5f9 and CI is still red\nWeb Dev Console › theme-swap\n    a colour does not follow the theme in GateList')];
const STATUS = {
  ok: true, $axf: 'auto-lander-status@1', at: at(0),
  service: { up: true, lastTick: at(0.5), minutesSinceTick: 0.5, mode: 'tick', paused: false, pausedBy: '', pausedAt: '' },
  current: 'pending-tab-one-collapsed-row', queue: ['pending-tab-one-collapsed-row', 'phone-connect-small-android-companion', 'console-look-axhub-skin', 'shipped-features-open-button-views'],
  settings: { enabled: true, maxAttempts: 3, backoffBaseMin: 5, backoffFactor: 3, backoffMaxMin: 60, attemptTimeoutMin: 45, pushOnEscalation: true },
  builds: [
    row('console-look-axhub-skin', 731, 'escalated', 'CI is red (Web Dev Console); fixing red CI failed 3 times (the limit is 3). Needs a hand.', stuck, { escalation: { at: at(28), kind: 'red-ci', attempts: 3, why: 'CI is red; fixing red CI failed 3 times.' } }),
    row('pending-tab-one-collapsed-row', 729, 'fixing', 'CI is red: fix attempt 1 runs on hulu0241 (axf-pending-tab-one-collapsed-row--fix).', [att('pending-tab-one-collapsed-row', 'clash', 1, 'ok', 50, 'merged main in (regenerated: tracker, fixtures)'), att('pending-tab-one-collapsed-row', 'red-ci', 1, 'started', 8, '')]),
    row('phone-connect-small-android-companion', 712, 'ci-running', 'Merged main in (5be1c07d2); CI runs on the new head.', [att('phone-connect-small-android-companion', 'clash', 1, 'ok', 12, 'merged main into claude/phone-connect-small-android-companion and pushed 5be1c07d2')]),
    row('shipped-features-open-button-views', 735, 'landing', 'CI is green: PR #735 is in the merge queue.', [att('shipped-features-open-button-views', 'land', 1, 'started', 4, '')]),
    row('orchestrator-settings-collapsible-split', 720, 'landed', 'It has landed.', [att('orchestrator-settings-collapsible-split', 'red-ci', 1, 'ok', 200, 'fixed: CI is green on 1d2e3f4a5'), att('orchestrator-settings-collapsible-split', 'land', 1, 'ok', 160, 'PR #720 merged.')]),
  ],
  escalated: ['console-look-axhub-skin'],
  escalations: [{ build: 'console-look-axhub-skin', pr: 731, kind: 'red-ci', attempts: 3, why: 'CI is red; fixing red CI failed 3 times.', since: at(140), log: stuck[2].log }],
};
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
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
