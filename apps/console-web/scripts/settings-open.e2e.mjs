#!/usr/bin/env node
/**
 * Settings open in a floating dialog by default (build all-settings-interfaces-open-floating, Nov 13 2026), end to end
 * against `vite preview` of dist/: app.settings and settings.open:<tab> open a glass dialog over the screen you are on,
 * Open as page moves it to the Settings page, `axf.settings.opensAs` = page keeps the page.
 *
 *   node scripts/settings-open.e2e.mjs            (build first: npm run build)
 *   SO_E2E_PORT=7098 · PW_CHROMIUM=<chromium path> · SO_E2E_SHOTS=<dir> (desktop + phone shots of the dialog)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.SO_E2E_PORT) || 7098;
const SHOTS = process.env.SO_E2E_SHOTS;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }
let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };
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
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const [name, viewport, mobile] of [['desktop', { width: 1400, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (e2e)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
    const st = () => page.evaluate(() => window.axfConsoleControlState());
    const screen0 = (await st()).screen;

    // the whole interface: app.settings → the glass dialog over the screen we were on
    await run({ verb: 'open', address: 'view:settings' });
    await page.waitForSelector('[data-axf-settings-all]', { timeout: 10_000 });
    let s = await st();
    ok(s.dialog === 'axf.settings.all' && s.screen === screen0, `${name}: Settings opens in a dialog over ${screen0} (${s.dialog} on ${s.screen})`);
    ok(await page.$eval('.fx-dialog', (el) => el.getAttribute('data-fx-dialog-surface') === 'glass' && /blur/.test(getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter || '')), `${name}: the dialog is glass`);
    ok(await page.$('[data-axf-settings-popout]'), `${name}: Open as page is there`);
    await sleep(400);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `settings-dialog-${name}.png`) });

    // one tab: settings.open:appearance → the tab dialog
    await page.keyboard.press('Escape');
    await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=appearance' });
    await page.waitForSelector('[data-axf-settings-tab="appearance"]', { timeout: 10_000 });
    s = await st();
    ok(s.dialog === 'axf.settings.tab', `${name}: a tab opens in the tab dialog (${s.dialog})`);
    await sleep(400);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `settings-tab-dialog-${name}.png`) });

    // Open as page → the Settings page on the same tab, dialog gone
    await page.click('[data-axf-settings-popout]');
    await page.waitForFunction(() => window.axfConsoleControlState().screen === 'settings', null, { timeout: 10_000 });
    s = await st();
    ok(s.screen === 'settings' && !s.dialog, `${name}: Open as page shows the Settings page`);

    // the per-user option: page keeps the page
    await run({ verb: 'set', address: 'setting:axf.settings.opensAs', value: 'page' });
    await run({ verb: 'open', address: 'view:home' }).catch(() => {});
    await run({ verb: 'open', address: 'view:settings' });
    s = await st();
    ok(s.screen === 'settings' && !s.dialog, `${name}: Settings open in = page opens the page`);
    await run({ verb: 'set', address: 'setting:axf.settings.opensAs', value: 'dialog' });
    await ctx.close();
  }
  console.log(`settings-open e2e: ${checks} checks passed${SHOTS ? ` (shots in ${SHOTS})` : ''}`);
} catch (e) {
  console.error(String(e?.stack ?? e).split("\n").slice(0, 8).join("\n"));
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
