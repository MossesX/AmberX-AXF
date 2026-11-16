#!/usr/bin/env node
/**
 * Hide any asset (page-assets@1; build assets-menu-hide-any-asset-hidden-list, Nov 16 2026), end to end against
 * `vite preview` of dist/: Settings → Appearance lists the visible assets; Hide moves one to Hidden and takes it off
 * the page; the hidden list is an appearance setting (saved in the app's look on axHub) and survives a reload; Show
 * brings it back; the menu bar's View menu has Assets…; a chrome settings dialog has Hide.
 *
 *   node scripts/page-assets.e2e.mjs            (build first: npm run build)
 *   PA_E2E_PORT=7099 · PW_CHROMIUM=<chromium path> · PA_E2E_SHOTS=<dir>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.PA_E2E_PORT) || 7099;
const SHOTS = process.env.PA_E2E_SHOTS;
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
    if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
    return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (e2e)' }) });
  });
  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
  };
  await boot();
  const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);

  // Settings → Appearance: the Assets list (Visible / Hidden)
  await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=appearance' }).catch(() => run({ verb: 'open', address: 'view:settings' }));
  await page.waitForSelector('[data-axf-assets-list]', { timeout: 15_000 });
  await page.waitForSelector('[data-axf-assets-list] [aria-label="Visible assets"] [data-axf-asset-row]', { timeout: 10_000 });
  const rows = await page.$$eval('[data-axf-assets-list] [aria-label="Visible assets"] [data-axf-asset-row]', (els) => els.map((e) => e.getAttribute('data-axf-asset-row')));
  ok(rows.length > 0, `Settings → Appearance lists the visible assets (${rows.length})`);
  // hide something outside the settings dialog: the first nav or toolbar on the page under it
  const target = ['nav-menu', 'toolbar', 'tab-group', 'app-menu'].map((t) => rows.find((id) => id.startsWith(`${t}:`))).find(Boolean) ?? rows[0];
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'assets-list-before.png') });
  await page.click(`[data-axf-assets-list] [aria-label="Visible assets"] [data-axf-asset-row="${target}"] button`);
  await page.waitForSelector(`[data-axf-assets-list] [aria-label="Hidden assets"] [data-axf-asset-row="${target}"]`, { timeout: 5_000 });
  ok(true, `${target}: Hide moves it to Hidden`);
  const saved = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([, v]) => v.includes('axf.assets.hidden'))));
  ok(saved.includes(target), `${target}: the hidden list is saved (survives a reload)`);
  await sleep(300);
  ok(await page.$$eval('[data-axf-asset-hidden]', (els) => els.length > 0), `${target}: the asset is off the page`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'assets-list-hidden.png') });

  // reload: still hidden
  await boot();
  await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=appearance' }).catch(() => run({ verb: 'open', address: 'view:settings' }));
  await page.waitForSelector(`[data-axf-assets-list] [aria-label="Hidden assets"] [data-axf-asset-row="${target}"]`, { timeout: 15_000, state: 'attached' });
  ok(true, `${target}: still hidden after a reload`);

  // Show brings it back
  await page.click(`[data-axf-assets-list] [aria-label="Hidden assets"] [data-axf-asset-row="${target}"] button`);
  await page.waitForFunction((id) => !document.querySelector(`[data-axf-assets-list] [aria-label="Hidden assets"] [data-axf-asset-row="${id}"]`), target, { timeout: 5_000 });
  await sleep(300);
  ok(await page.$$eval('[data-axf-asset-hidden]', (els) => els.length === 0), `${target}: Show puts it back on the page`);

  console.log(`✓ page assets e2e — ${checks} checks`);
} catch (e) {
  console.error(e?.message ?? e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
