// Shots of the Shipped features table (build shipped-features-organized-sortable): vite preview of the worktree's build,
// the plugin's /ledger answered from a ledger JSON (ledger.mjs export json), everything else offline.
//   node shoot.mjs <apps/console-web> <out dir> <ledger.json> <playwright base dir>
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const [APP, OUT, LEDGER, PW] = process.argv.slice(2);
const playwright = createRequire(join(PW, 'x.js'))('playwright');
const ledger = { ...JSON.parse(readFileSync(LEDGER, 'utf8')), manifests: [{ build: 'shipped-features-organized-sortable', tests: { pass: 45, total: 45 } }, { build: 'veto', tests: { pass: 17, total: 18 } }], meta: { syncing: false, importing: false, error: '' } };
const PORT = 7194;
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const server = spawn('node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch { await sleep(500); } }
const browser = await playwright.chromium.launch();
mkdirSync(OUT, { recursive: true });
const VP = { desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
async function open(form, view) {
  const page = await browser.newPage(VP[form]);
  page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 200)));
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace('/api/plugins/shipped-features/', '');
    const json = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname === '/api/events') return r.abort();
    if (p === 'ledger') return json(ledger);
    const fm = /^feature\/(.+)$/.exec(p);
    if (fm) { const f = ledger.features.find((x) => x.id === decodeURIComponent(fm[1])); return json({ feature: f, edits: [], prompts: ledger.prompts.filter((q) => f?.prompts.some((r) => r.id === q.id)), history: [] }); }
    if (p === 'summary') return json({ ready: true, statuses: {}, active: 0 });
    return json({ ok: false, error: 'offline (shots)' }, 503);
  });
  await page.addInitScript((v) => { try { if (v) localStorage.setItem('axp-shipped-features.table', JSON.stringify(v)); } catch {} }, view);
  await page.goto(`${base}#/shipped-features`);
  await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30000 });
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.axfConsoleControl({ verb: 'press', address: 'function:shipped-features.open' }));
    if (await page.$('.axp-shipped .axf-grid')) break;
    await sleep(1000);
  }
  try { await page.waitForSelector('.axp-shipped .axf-grid', { timeout: 20000 }); }
  catch (e) { await page.screenshot({ path: join(OUT, `debug-${form}.png`) }); console.log(await page.evaluate(() => document.body.innerText.slice(0, 600))); throw e; }
  await sleep(1000);
  return page;
}
const shot = async (page, name) => { await sleep(400); await page.screenshot({ path: join(OUT, name) }); console.log('shot', name); };
const top = (page) => page.evaluate(() => document.querySelector('.axp-shipped')?.scrollIntoView({ block: 'start' }));
for (const form of ['desktop', 'phone']) {
  let page = await open(form, null);
  await top(page); await shot(page, `default-by-area-${form}.png`);
  await page.close();
  page = await open(form, { by: 'status', sorts: [{ col: 'status', dir: 'asc' }, { col: 'shipped', dir: 'desc' }], hidden: ['description', 'commit', 'settings', 'help'], statuses: [], plugins: [] });
  await top(page); await shot(page, `by-status-multisort-${form}.png`);
  await page.click('.axp-shipped__actions button:has-text("Columns")');
  await page.waitForSelector('.axp-shipped__picker');
  await page.evaluate(() => document.querySelector('.axp-shipped__picker')?.scrollIntoView({ block: 'start' }));
  await shot(page, `column-picker-${form}.png`);
  await page.close();
  page = await open(form, { by: 'area', expanded: [] });
  await page.click('.axp-shipped .axf-grid-row button[aria-label="Expand row"] >> nth=0');
  await page.waitForSelector('.axf-grid-detail');
  await page.evaluate(() => document.querySelector('.axf-grid-detail')?.previousElementSibling?.scrollIntoView({ block: 'start' }));
  await shot(page, `row-expanded-${form}.png`);
  await page.close();
}
await browser.close();
server.kill('SIGTERM');
process.exit(0);
