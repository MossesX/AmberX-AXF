#!/usr/bin/env node
/**
 * Chrome drawn once (build hotfix-desktop-console-draws-app-menu): Playwright against the console, desktop and phone.
 * The page must show exactly ONE application menu, ONE banner and ONE navigation menu, before and after the
 * per-instance chrome settings (chrome-settings@1: per-toolbar / per-instance settings interface, tap-to-confirm) are
 * used, standalone and embedded (embed@1). A second copy of any of them fails the run.
 *
 *   node scripts/chrome-once.e2e.mjs              (build first: npm run build; serves dist/ with vite preview)
 *   CHROME_E2E_URL=http://127.0.0.1:7461/         (test a running console instead, e.g. vite dev or the deployed one)
 *   CHROME_E2E_PORT=7097 · PW_CHROMIUM=<chromium path> · PLAYWRIGHT_DIR=<dir with node_modules/playwright>
 *   CHROME_E2E_SHOTS=<dir>                        (desktop + phone screenshots of each pass)
 *
 * The backend is mocked: /api/me as admin with no axHub (the look is local), everything else answers offline.
 * The nav menu is switched on through the same action REST / MCP / CLI / voice use (slot.hide:nav-menu:off).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.CHROME_E2E_PORT) || 7097;
const SHOTS = process.env.CHROME_E2E_SHOTS || '';

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw', '/tmp/axf-pw-overlay'].filter(Boolean)) { try { playwright = createRequire(join(base, 'node_modules', 'x.js'))('playwright'); break; } catch { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };

/** How many of each chrome element the page draws (visible or not: a hidden duplicate is still a duplicate). */
const count = (page) => page.evaluate(() => {
  const n = (s) => document.querySelectorAll(s).length;
  return {
    frames: n('.fx-frame'),
    shells: n('.fx-shell'),
    appMenus: n('[role="menubar"]'),
    appMenuRegions: n('.fx-frame__menubar'),
    banners: n('[role="banner"]'),
    navMenus: n('nav[data-axf-nav="app"]'),
    navRegions: n('.fx-region--nav'),
  };
});

let server = null;
const stop = () => { try { server?.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

let browser;
try {
  let base = process.env.CHROME_E2E_URL;
  if (!base) {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
    base = `http://127.0.0.1:${PORT}/`;
  }
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base)).ok; } catch { await sleep(500); } }
  ok(up, `console at ${base} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  for (const [form, opts] of Object.entries(VIEWPORTS)) {
    for (const embed of [false, true]) {
      const tag = `${form}${embed ? ' embedded' : ''}`;
      const page = await browser.newPage(opts);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname === '/api/me') return json(ME);
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return json({ ok: false, error: 'offline (e2e)' }, 503);
      });
      await page.goto(embed ? `${base}?axf-embed=axhub&axf-embed-hide=none` : base);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function' && document.querySelector('[role="menubar"]'), null, { timeout: 30_000 });
      const press = (id, value) => page.evaluate(([a, v]) => window.axfConsoleControl({ verb: 'press', address: `function:${a}`, value: v }), [id, value]);

      // the nav menu on, so all three are drawn
      await press('slot.hide', 'nav-menu:off');
      await page.waitForSelector('nav[data-axf-nav="app"]', { timeout: 10_000 });
      await sleep(400);
      let c = await count(page);
      ok(c.frames === 1 && c.shells === 1, `${tag}: one frame and one shell (${JSON.stringify(c)})`);
      ok(c.appMenus === 1 && c.appMenuRegions === 1, `${tag}: exactly one application menu (${JSON.stringify(c)})`);
      ok(c.banners === 1, `${tag}: exactly one banner (${JSON.stringify(c)})`);
      ok(c.navMenus === 1 && c.navRegions === 1, `${tag}: exactly one navigation menu (${JSON.stringify(c)})`);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `chrome-once-${form}${embed ? '-embedded' : ''}.png`) }); }

      // per-instance chrome settings (the per-toolbar feature): each instance picks its own settings interface and
      // its own tap-to-confirm; the page still draws one of each
      for (const type of ['app-menu', 'banner', 'nav-menu', 'toolbar']) await press('chrome.instance-interface', `${type}:app:default`);
      await press('chrome.set', 'app-menu:app:tapConfirm:on');
      await press('chrome.set', 'nav-menu:app:tapConfirm:on');
      await sleep(600);
      c = await count(page);
      ok(c.appMenus === 1 && c.banners === 1 && c.navMenus === 1 && c.shells === 1, `${tag}: one of each after per-instance settings (${JSON.stringify(c)})`);

      // a chrome settings dialog open (the per-instance picker inside it) draws no second chrome either
      await press('chrome.settings', 'app-menu:app');
      await page.waitForSelector('[data-axf-instance-interface]', { timeout: 10_000 });
      c = await count(page);
      ok(c.appMenus === 1 && c.banners === 1 && c.navMenus === 1 && c.shells === 1, `${tag}: one of each with the chrome settings dialog open (${JSON.stringify(c)})`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `chrome-once-${form}${embed ? '-embedded' : ''}-settings.png`) });

      ok(!errors.length, `${tag}: no page errors (${errors.slice(0, 3).join(' | ')})`);
      await page.close();
      console.log(`✓ ${tag}: one application menu, one banner, one navigation menu`);
    }
  }
  console.log(`chrome-once e2e: ${checks} checks passed`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
