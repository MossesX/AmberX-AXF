#!/usr/bin/env node
/**
 * Hidden assets (hidden-assets@1, build rebuild-fresh-main-hide-any-asset): Playwright against the built console, desktop
 * and phone. Right-click a toolbar → Hide toolbar → it is gone and the toast offers Undo; the Assets menu shows Hidden
 * items… with the count; the Hidden list (dialog axf.hidden-assets) lists it by kind; Unhide brings it back; a tab group
 * hidden through the console action goes and comes back; Unhide all empties the list.
 *
 *   node scripts/hidden-assets.e2e.mjs            (build first: npm run build; serves dist/ with vite preview)
 *   HIDDEN_E2E_URL=http://127.0.0.1:7461/          (test a running console instead)
 *   HIDDEN_E2E_PORT=7187 · PW_CHROMIUM=<chromium path> · PLAYWRIGHT_DIR=<dir with node_modules/playwright>
 *   HIDDEN_E2E_SHOTS=<dir>                        (desktop + phone screenshots: right-click Hide, Assets menu, Hidden list)
 *
 * The backend is mocked like chrome-once.e2e.mjs: /api/me as admin with no axHub (the look document is local).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.HIDDEN_E2E_PORT) || 7187;
const SHOTS = process.env.HIDDEN_E2E_SHOTS || '';

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw', '/tmp/axf-pw-overlay'].filter(Boolean)) { try { playwright = createRequire(join(base, 'node_modules', 'x.js'))('playwright'); break; } catch { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

const ME = { wall: false, hub: 'https://axhub.amberxai.com', appearanceHub: 'https://axhub.amberxai.com', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };

let server = null;
const stop = () => { try { server?.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

let browser;
let lastPage = null;
try {
  let base = process.env.HIDDEN_E2E_URL;
  if (!base) {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
    base = `http://127.0.0.1:${PORT}/`;
  }
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base)).ok; } catch { await sleep(500); } }
  ok(up, `console at ${base} (is dist/ built?)`);
  // the port may belong to another checkout's preview server: make sure it serves this dist/
  if (server) ok((await (await fetch(base)).text()) === readFileSync(join(APP, 'dist/index.html'), 'utf8'), `${base} serves this checkout's dist/ (port ${PORT} taken? set HIDDEN_E2E_PORT)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const [form, opts] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage(opts);
    lastPage = page;
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return json({ ok: false, error: 'offline (e2e)' }, 503);
    });
    // an in-memory axHub for this app's look document (the hidden list lives there; the look comes from axHub only)
    const looks = new Map();
    let ver = 0;
    await page.route(/^https:\/\/axhub\.amberxai\.com\//, async (r) => {
      const req = r.request();
      const u = new URL(req.url());
      const origin = req.headers().origin || new URL(base).origin;
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type, if-match, accept', 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-expose-headers': 'etag' };
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      const m = /^\/data\/(shared\/settings\/looks\/[a-z0-9-]+\.json)$/.exec(u.pathname);
      // the shared appearance document: nothing saved yet (the app starts from its defaults, then reads its own look)
      if (/^\/data\/shared\/settings\/(appearance|apps\/[a-z0-9-]+)\.json$/.test(u.pathname) && req.method() === 'GET') return r.fulfill({ status: 404, headers: cors, body: '' });
      if (!m) return r.abort();
      if (req.method() === 'PUT') { looks.set(m[1], req.postData() ?? ''); ver++; return r.fulfill({ status: 200, headers: { ...cors, etag: `"v${ver}"`, 'content-type': 'application/json' }, body: '{"ok":true}' }); }
      const doc = looks.get(m[1]);
      return doc ? r.fulfill({ status: 200, headers: { ...cors, etag: `"v${ver}"`, 'content-type': 'application/json' }, body: doc }) : r.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(base);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function' && document.querySelector('[role="menubar"]'), null, { timeout: 30_000 });
    const press = (id, value) => page.evaluate(([a, v]) => window.axfConsoleControl({ verb: 'press', address: `function:${a}`, value: v }), [id, value]);
    const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `hidden-${name}-${form}.png`) }); };
    // the home screen's own toolbar (hand-drawn role="toolbar": the DOM pass hides it); its piece id is its label's slug
    const TB = '[role="toolbar"][aria-label="Home cards"]';
    const count = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).length, TB);

    // start clean
    await press('chrome.unhideAll');
    await page.waitForSelector(TB, { timeout: 15_000 });

    // 1. right-click the toolbar: the shared chrome block has Hide toolbar
    const tb = await page.$(TB);
    const box = await tb.boundingBox();
    await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2, { button: 'right' });
    const hideItem = page.locator('.fx-ctx >> text=Hide toolbar').first();
    await hideItem.waitFor({ timeout: 10_000 });
    ok(await hideItem.isVisible(), `${form}: right-click a toolbar → Hide toolbar`);
    await shot('right-click');
    await hideItem.click();
    await page.waitForFunction((sel) => ![...document.querySelectorAll(sel)].some((e) => e.getClientRects().length), TB, { timeout: 10_000 });
    ok((await count()) === 0, `${form}: the toolbar is gone`);
    ok(await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('data-axf-hidden-piece') === 'toolbar:home-cards', TB), `${form}: stamped as the piece toolbar:home-cards`);
    ok(await page.locator('.fx-toast >> text=Undo').first().isVisible(), `${form}: the toast offers Undo`);

    // 2. Undo brings it back; hide it again plus a tab group through the console action
    await page.locator('.fx-toast >> text=Undo').first().click();
    await page.waitForSelector(TB, { timeout: 10_000 });
    ok((await count()) === 1, `${form}: Undo brings it back`);
    await press('chrome.hide', 'toolbar:home-cards');
    await press('chrome.hide', 'tab-group:settings.tabs');
    await press('chrome.hide', 'banner:app');
    const n = await page.evaluate(() => window.axfConsoleControl({ verb: 'state' }).then(() => document.querySelectorAll('[data-axf-hidden-entry]').length));
    ok(n === 0, `${form}: the list isn't open yet`);

    // 3. the Assets menu: Hidden items… with the count, Unhide all, Hide ▸
    const assets = page.locator('[role="menubar"] >> text=Assets').first();
    if (await assets.isVisible()) {
      await assets.click();
      await page.locator('text=Hidden items…').first().waitFor({ timeout: 10_000 });
      ok(await page.locator('text=Unhide all').first().isVisible(), `${form}: Assets menu has Unhide all`);
      await shot('assets-menu');
      await page.keyboard.press('Escape');
    } else {
      // a phone folds the menu bar into its ☰ sheet: open it there
      await page.locator('[role="menubar"] button').first().click();
      await sleep(400);
      await shot('assets-menu');
      await page.keyboard.press('Escape');
    }

    // 4. the Hidden list (dialog axf.hidden-assets): grouped by kind, Unhide per row
    await press('chrome.hidden');
    await page.waitForSelector('[data-axf-target="panel:hidden-assets"]', { timeout: 10_000 });
    const rows = await page.$$eval('[data-axf-hidden-entry]', (els) => els.map((e) => e.getAttribute('data-axf-hidden-entry')));
    ok(rows.includes('toolbar:home-cards') && rows.includes('tab-group:settings.tabs') && rows.includes('banner:app'), `${form}: the Hidden list lists all three (${rows.join(', ')})`);
    await page.evaluate(() => document.querySelectorAll('.fx-toast button[aria-label="Dismiss"]').forEach((b) => b.click()));
    await sleep(900); // the dialog's open animation
    await shot('hidden-list');
    // the three options for UI Review (ui-choices@1): the same list under each dialog asset
    if (SHOTS) {
      for (const d of ['side-drawer', 'centered-modal', 'bottom-sheet']) {
        await press('swap', `dialog:${d}`);
        await page.waitForSelector('[data-axf-target="panel:hidden-assets"]', { timeout: 10_000 });
        await sleep(1000);
        await shot(`option-${d}`);
      }
    }
    await page.locator('[data-axf-hidden-entry="toolbar:home-cards"] button').first().click();
    await page.waitForSelector(TB, { timeout: 10_000 });
    ok((await count()) === 1, `${form}: Unhide on the row brings the toolbar back`);

    // 5. Unhide all (tap twice) empties the list
    const all = page.locator('#hidden\\.unhide-all');
    await all.click();
    await all.click();
    await page.waitForSelector('[data-axf-hidden-count="0"]', { timeout: 10_000 });
    ok(await page.locator('text=Nothing is hidden in this app').first().isVisible(), `${form}: empty state after Unhide all`);
    await sleep(600);
    await shot('hidden-empty');

    ok(!errors.length, `${form}: no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
    console.log(`✓ ${form}: right-click Hide, Undo, Assets menu, Hidden list, Unhide, Unhide all`);
  }
  console.log(`hidden-assets e2e: ${checks} checks passed`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  try { console.error('toasts:', await lastPage?.evaluate(() => [...document.querySelectorAll('.fx-toast')].map((t) => t.textContent.trim()).join(' || ')), '· hidden pieces:', await lastPage?.evaluate(() => [...document.querySelectorAll('[data-axf-hidden-piece]')].map((x) => x.getAttribute('data-axf-hidden-piece')).join(', '))); } catch { /* page gone */ }
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
