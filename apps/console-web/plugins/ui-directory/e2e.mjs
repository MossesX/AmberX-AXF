#!/usr/bin/env node
/**
 * UI Directory page end to end (Playwright against `vite preview` of apps/console-web/dist), desktop and phone.
 *
 *   node apps/console-web/plugins/ui-directory/e2e.mjs        (build first: npm run build in apps/console-web)
 *   UIDIR_E2E_PORT=7098 · PW_CHROMIUM=<chromium path> · UIDIR_E2E_SHOTS=<dir> (desktop + phone screenshots)
 *
 * The backend is mocked: /api/me as admin, the directory from this checkout's data folder (built when missing), the
 * page-state report recorded. Covers: the deep link opens the page (console-control open view:ui-directory), the tree
 * draws grouped by app, search filters it and opens the groups, the page reports its state (what GET page answers),
 * the ui-directory.show action sets the filters without the UI, a row's open button opens its UI (a settings tab), and
 * the phone layout has no sideways scroll.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.UIDIR_E2E_PORT) || 7098;
const SHOTS = process.env.UIDIR_E2E_SHOTS || '';

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };

const dataDir = process.env.AXF_UI_DIRECTORY_DIR || join(ROOT, '.axf-console/plugins/ui-directory');
if (!existsSync(join(dataDir, 'directory.json'))) execFileSync('node', [join(HERE, 'directory.mjs'), 'build', '--reason', 'e2e'], { stdio: 'ignore' });
const directory = readFileSync(join(dataDir, 'directory.json'), 'utf8');
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const reports = [];

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
let browser;

async function openPage(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url());
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname === '/api/plugins/ui-directory/directory') return json(directory);
    if (u.pathname === '/api/plugins/ui-directory/page' && r.request().method() === 'POST') { reports.push(JSON.parse(r.request().postData() || '{}')); return json({ ok: true }); }
    if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
    return json({ ok: false, error: 'offline (e2e)' }, 503);
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
  return { page, errors };
}

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { await sleep(500); } }
  ok(up, `vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  // ---- desktop
  const { page, errors } = await openPage({ width: 1400, height: 900 });
  const a = await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:ui-directory' }));
  ok(a.ok && a.state.screen === 'ui-directory', `the deep link opens the page (${a.message ?? a.state?.screen})`);
  await page.waitForSelector('.axp-uidir__tree', { timeout: 15_000 });
  const apps = await page.locator('.axp-uidir__tree > .axp-uidir__node').count();
  ok(apps >= 5, `the tree is grouped by app (${apps} apps)`);
  ok(await page.locator('[role="toolbar"][aria-label="Search and filter the UI directory"]').count() === 1, 'the filter toolbar is a labelled toolbar');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'ui-directory-desktop.png') });

  await page.getByRole('searchbox', { name: 'Search' }).fill('ui directory');
  await page.waitForFunction(() => document.querySelectorAll('.axp-uidir__node.is-settings-panel').length >= 2, null, { timeout: 10_000 });
  ok(await page.locator('.axp-uidir__name', { hasText: 'Install & uninstall' }).count() >= 1, 'search opens the groups down to the matching panels');
  await sleep(900);
  const last = reports.at(-1);
  ok(last && last.q === 'ui directory' && last.shown > 0 && last.total > 300, `the page reports its state (${JSON.stringify(last)})`);

  // a row's info shows the four doors; its open button opens the UI
  const tabRow = page.locator('.axp-uidir__node.is-settings-tab').filter({ hasText: 'UI Directory' }).first();
  await tabRow.getByRole('button', { name: 'How to reach UI Directory' }).first().click();
  ok(await page.locator('.axp-uidir__reach dt', { hasText: 'CLI' }).count() >= 1, 'a row shows how it is reached (MCP, REST, CLI, voice)');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'ui-directory-desktop-search.png') });
  await tabRow.getByRole('button', { name: 'Open UI Directory' }).first().click();
  await page.waitForFunction(() => window.axfConsoleControlState().screen === 'settings', null, { timeout: 10_000 });
  ok(true, 'a row opens its UI (Settings → Plugins → UI Directory)');

  // the show action sets the filters without the UI (what POST show / MCP / CLI / voice send)
  const pressed = await page.evaluate(() => window.axfConsoleControl({ verb: 'press', address: 'function:ui-directory.show', value: 'kind=dialog' }));
  ok(pressed.ok, `the show action runs without the UI (${pressed.message ?? ''})`);
  await page.waitForFunction(() => window.axfConsoleControlState().screen === 'ui-directory', null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll('.axp-uidir__node.is-dialog').length > 0 && !document.querySelector('.axp-uidir__node.is-settings-panel'), null, { timeout: 10_000 });
  ok(true, 'show kind=dialog filters the tree to dialogs');
  await sleep(900);
  ok(reports.at(-1)?.kind === 'dialog' && reports.at(-1)?.q === '', 'the reported state follows the action');
  ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await page.close();

  // ---- phone
  const phone = await openPage({ width: 390, height: 844 });
  await phone.page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:ui-directory' }));
  await phone.page.waitForSelector('.axp-uidir__tree', { timeout: 15_000 });
  await phone.page.getByRole('button', { name: 'Expand all' }).click();
  const overflow = await phone.page.evaluate(() => { const el = document.querySelector('.axp-uidir'); return el ? el.scrollWidth - el.clientWidth : 99; });
  ok(overflow <= 1, `no sideways scroll on a phone (${overflow}px)`);
  if (SHOTS) await phone.page.screenshot({ path: join(SHOTS, 'ui-directory-phone.png') });
  ok(phone.errors.length === 0, `no page errors on the phone (${phone.errors.join(' | ')})`);
  console.log(`ui-directory e2e: ${checks} checks passed${SHOTS ? ` · shots in ${SHOTS}` : ''}`);
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
