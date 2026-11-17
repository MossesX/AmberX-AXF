#!/usr/bin/env node
/**
 * Refreshing the console stays put (build fix-refreshing-console-jumps-back), end to end against `vite preview` of dist/:
 * open a view with a tab row, switch to a later tab, scroll the main pane, then
 *   1. reload                    → same view, same tab, same scroll, and the pane still scrolls
 *   2. server-pushed refresh     → what console-commands' reloadPage does: save the place, then reload
 *   3. pull-down refresh         → a touch pull at the top saves the place (`by: pull-refresh`), then the reload
 *   4. a deep link wins          → `?axf-open=view:home` opens Home, not the saved place
 *
 *   node scripts/place-refresh.e2e.mjs            (build first: npm run build)
 *   PR_E2E_PORT=7099 · PW_CHROMIUM=<chromium path> · PR_E2E_VIEW=assets
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.PR_E2E_PORT) || 7099;
const VIEW = process.env.PR_E2E_VIEW || 'assets';
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }
let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; console.log(`ok  ${what}`); };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not up yet */ } if (!up) await sleep(500); }
  ok(up, `vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 640 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
    if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
    return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (e2e)' }) });
  });
  const ready = async () => {
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function' && !!window.axfConsolePlace, null, { timeout: 30_000 });
  };
  const where = () => page.evaluate(() => {
    const main = Array.from(document.querySelectorAll('.fx-main')).filter((m) => m.offsetParent !== null).pop();
    const row = document.querySelector('.fx-main [data-axf-tab][aria-selected="true"]');
    return { view: window.axfConsoleControlState().screen, tab: row?.getAttribute('data-axf-tab') ?? null, top: Math.round(main?.scrollTop ?? -1), room: main ? main.scrollHeight - main.clientHeight : 0 };
  });
  const settle = () => page.waitForFunction(() => !window.axfConsolePlace.state().restoring, null, { timeout: 15_000 });

  await page.goto(`http://127.0.0.1:${PORT}/`);
  await ready();
  await page.evaluate((v) => window.axfConsoleControl({ verb: 'open', address: `view:${v}` }), VIEW);
  await page.waitForSelector(`[data-axf-view="${VIEW}"] [data-axf-tab]`, { timeout: 15_000 });
  // a later tab of the first tab row in the view
  const tabs = await page.$$eval(`[data-axf-view="${VIEW}"] [data-axf-tab]`, (els) => els.map((e) => e.getAttribute('data-axf-tab')));
  const want = tabs[Math.min(2, tabs.length - 1)];
  await page.click(`[data-axf-view="${VIEW}"] [data-axf-tab="${want}"]`);
  await sleep(500);
  let w = await where();
  ok(w.view === VIEW && w.tab === want, `on ${VIEW}, tab ${want} (${w.view}, ${w.tab})`);
  ok(w.room > 200, `the main pane has room to scroll (${w.room}px)`);
  const target = Math.min(600, Math.floor(w.room / 2));
  await page.evaluate((t) => { const m = Array.from(document.querySelectorAll('.fx-main')).filter((x) => x.offsetParent !== null).pop(); m.scrollTop = t; }, target);
  await sleep(600); // past the save debounce

  const expectPlace = async (label) => {
    await ready();
    await settle();
    const now = await where();
    ok(now.view === VIEW, `${label}: back on ${VIEW} (${now.view})`);
    ok(now.tab === want, `${label}: tab ${want} again (${now.tab})`);
    ok(Math.abs(now.top - target) <= 2, `${label}: scroll ${target} again (${now.top})`);
    // the page still scrolls: no inline lock on the root, and a wheel moves the pane
    const locks = await page.evaluate(() => ['html', 'body', '#root', '.fx-main'].flatMap((s) => Array.from(document.querySelectorAll(s))).filter((el) => /hidden|none/.test(el.style.overflow + el.style.pointerEvents) || el.hasAttribute('inert')).length);
    ok(locks === 0, `${label}: nothing locks the page`);
    await page.mouse.move(550, 400);
    await page.mouse.wheel(0, 120);
    await sleep(300);
    const after = await where();
    ok(after.top !== now.top, `${label}: the pane still scrolls (${now.top} → ${after.top})`);
    // put it back for the next round (the wheel ended the restore and saved the new offset)
    await page.evaluate((t) => { const m = Array.from(document.querySelectorAll('.fx-main')).filter((x) => x.offsetParent !== null).pop(); m.scrollTop = t; }, target);
    await sleep(600);
  };

  // 1. reload
  await page.reload();
  await expectPlace('reload');

  // 2. server-pushed console.refresh: console-commands saves the place, then reloads
  await page.evaluate(() => { window.axfConsolePlace.save('refresh'); location.reload(); });
  await page.waitForLoadState('load');
  await expectPlace('server refresh');

  // 3. pull-down refresh: a touch pull from the top of the pane saves the place before the browser reloads.
  // The pane has to be at the top for the browser to pull, so the place restored is the top of the same tab.
  await page.evaluate(() => { const m = Array.from(document.querySelectorAll('.fx-main')).filter((x) => x.offsetParent !== null).pop(); m.scrollTop = 0; });
  await sleep(600);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 550, y: 250 }] });
  for (let y = 270; y <= 420; y += 30) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 550, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const by = await page.evaluate(() => window.axfConsolePlace.state().saved?.by);
  ok(by === 'pull-refresh', `pull refresh saved the place (${by})`);
  await page.reload();
  await ready();
  await settle();
  w = await where();
  ok(w.view === VIEW && w.tab === want && w.top <= 2, `pull refresh: back on ${VIEW}, tab ${want}, at the top (${w.view}, ${w.tab}, ${w.top})`);

  // 4. a deep link wins over the saved place
  await page.goto(`http://127.0.0.1:${PORT}/?axf-open=${encodeURIComponent('view:home')}`);
  await ready();
  await page.waitForFunction(() => window.axfConsoleControlState().screen === 'home', null, { timeout: 10_000 }).catch(() => null);
  w = await where();
  ok(w.view === 'home', `deep link: ?axf-open=view:home opens Home (${w.view})`);

  console.log(`\n${checks} place-refresh checks passed`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
