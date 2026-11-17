#!/usr/bin/env node
/**
 * Settings open in a floating dialog by default (build all-settings-interfaces-open-floating, Nov 13 2026), end to end
 * against `vite preview` of dist/: app.settings and settings.open:<tab> open a glass dialog over the screen you are on,
 * There is no page option (Brett, Nov 16 2026): no Open as page, no `axf.settings.opensAs`.
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
    ok(!(await page.$('[data-axf-settings-popout]')), `${name}: no Open as page (always a popup)`);
    await sleep(400);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `settings-dialog-${name}.png`) });

    // one tab: settings.open:appearance → the tab dialog
    await page.keyboard.press('Escape');
    await sleep(200);
    await run({ verb: 'press', address: 'function:settings.open', value: 'appearance' });
    await page.waitForSelector('[data-axf-settings-tab="appearance"]', { timeout: 10_000 });
    s = await st();
    ok(s.dialog === 'axf.settings.tab', `${name}: a tab opens in the tab dialog (${s.dialog})`);
    // the console-control chain (view:settings, then its tab) opens the whole interface and switches to that tab inside
    // it, never a second window (settings-opened-banners-nav-menu)
    await page.keyboard.press('Escape');
    await sleep(200);
    await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=appearance' });
    await page.waitForSelector('[data-axf-settings-all] [data-axf-scope="tab:settings.tabs=appearance"]', { timeout: 10_000 });
    s = await st();
    ok(s.dialog === 'axf.settings.all' && (await page.$$('.fx-dialog')).length === 1, `${name}: view:settings/tab:… opens the whole interface on that tab, one window (${s.dialog})`);
    await sleep(400);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `settings-tab-dialog-${name}.png`) });

    // the retired option does nothing: a saved "page" value is not a setting any more, Settings still pops up
    await page.keyboard.press('Escape');
    const gone = await run({ verb: 'get', address: 'setting:axf.settings.opensAs' }).then((r) => r, (e) => ({ ok: false, error: String(e) }));
    ok(!gone || gone.ok === false, `${name}: setting:axf.settings.opensAs is gone`);
    await run({ verb: 'open', address: 'view:settings' });
    s = await st();
    ok(s.dialog === 'axf.settings.all', `${name}: Settings still opens as a popup`);

    // settings-opened-banners-nav-menu (Brett, Nov 17 2026: "it doesn't open in the floating window. It opens in the
    // main area."): the nav menu's Settings item is the floating window too, never the Settings page
    await page.keyboard.press('Escape');
    await sleep(200);
    const navItem = await page.$('[data-axf-view-link="settings"]');
    if (navItem && await navItem.isVisible()) {
      await navItem.click();
      await page.waitForSelector('[data-axf-settings-all]', { timeout: 10_000 });
      s = await st();
      ok(s.dialog === 'axf.settings.all' && s.screen === screen0, `${name}: the nav menu's Settings item opens the floating window over ${screen0} (${s.dialog} on ${s.screen})`);
      // a second press keeps the one window (focused, not opened twice)
      await navItem.click();
      await sleep(200);
      ok((await page.$$('.fx-dialog')).length === 1 && (await st()).dialog === 'axf.settings.all', `${name}: pressing it again keeps one window`);
    } else {
      await run({ verb: 'press', address: 'function:nav', value: 'settings' });
      await page.waitForSelector('[data-axf-settings-all]', { timeout: 10_000 });
      s = await st();
      ok(s.dialog === 'axf.settings.all' && s.screen === screen0, `${name}: nav:settings opens the floating window over ${screen0} (${s.dialog} on ${s.screen})`);
    }
    // a banner gear / toolbar item (settings.open:<tab>) while the window is up switches the tab inside it: still floating
    await run({ verb: 'press', address: 'function:settings.open', value: 'about' });
    await sleep(300);
    s = await st();
    ok(s.dialog === 'axf.settings.all' && s.screen === screen0, `${name}: a settings tab asked while the window is up stays in the floating window (${s.dialog} on ${s.screen})`);
    ok(!!(await page.$('[data-axf-settings-all] [data-axf-scope="tab:settings.tabs=about"]')), `${name}: the window switched to that tab`);

    // right-click Settings… on a toolbar / banner / nav / tab group / menu bar: chrome.settings → the chrome settings dialog, once
    await page.keyboard.press('Escape');
    await sleep(200);
    await run({ verb: 'press', address: 'function:chrome.settings', value: 'toolbar:app' });
    await page.waitForSelector('.fx-dialog[aria-label="Chrome settings"]', { timeout: 10_000 });
    s = await st();
    ok(s.dialog === 'axf.chrome.settings' && s.screen === screen0, `${name}: Toolbar settings… opens the floating chrome settings dialog (${s.dialog} on ${s.screen})`);
    await run({ verb: 'press', address: 'function:chrome.settings', value: 'toolbar:app' });
    await sleep(200);
    ok((await page.$$('.fx-dialog')).length === 1 && (await st()).dialog === 'axf.chrome.settings', `${name}: Settings… again keeps the one dialog`);
    await sleep(400);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `chrome-settings-dialog-${name}.png`) });

    // Banner settings: the floating banner settings dialog
    await page.keyboard.press('Escape');
    await sleep(200);
    await run({ verb: 'press', address: 'function:banners.settings' });
    await page.waitForSelector('.fx-dialog[aria-label="Banner settings"]', { timeout: 10_000 });
    s = await st();
    ok(s.dialog === 'axf.banners.settings' && s.screen === screen0, `${name}: Banner settings opens floating (${s.dialog} on ${s.screen})`);

    // the one door by API: settings.floating:<target>
    await page.keyboard.press('Escape');
    await sleep(200);
    await run({ verb: 'press', address: 'function:settings.floating', value: 'chrome:nav-menu:app' });
    await page.waitForSelector('.fx-dialog[aria-label="Chrome settings"]', { timeout: 10_000 });
    ok((await st()).dialog === 'axf.chrome.settings', `${name}: settings.floating:chrome:nav-menu:app opens the nav menu's settings floating`);
    await page.keyboard.press('Escape');
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
