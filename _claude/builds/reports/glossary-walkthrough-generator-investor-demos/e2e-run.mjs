import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire('/root/axf-builds/style-override-rule/apps/console-web/package.json');
const { chromium } = require('playwright');
const PORT = 7481, OUT = '/tmp/wt-e2e/shots';
mkdirSync(OUT, { recursive: true });
const app = '/root/axf-builds/glossary-walkthrough-generator/apps/console-web';
const srv = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60 && !log.includes(String(PORT)); i++) await sleep(250);
if (/already in use/.test(log)) { console.log('PORT BUSY'); srv.kill(); process.exit(1); }
const catalog = readFileSync('/tmp/wt-sample/catalog.json');
const exp = JSON.parse(readFileSync('/tmp/wt-e2e/investor-tour.walkthrough.json', 'utf8'));
const w = exp.walkthrough;
const summary = { id: 'investor-tour', name: w.name, version: w.version, updatedAt: w.updatedAt, createdAt: w.createdAt, mode: 'claude', model: 'claude-opus-5-5', features: 5, steps: 22, claude: 5, terms: w.features.map((f) => f.term), prompt: w.request.prompt, audience: 'investors', versions: 1, book: 'investor-tour' };
const results = [];
const check = (c, m) => { results.push(`${c ? 'PASS' : 'FAIL'} ${m}`); };
const browser = await chromium.launch();
const json = (body) => (r) => r.fulfill({ status: 200, contentType: 'application/json', body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
async function ctx(viewport, mobile) {
  const c = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await c.newPage();
  page.on('pageerror', (e) => results.push(`PAGEERROR ${(e.stack || e.message).slice(0, 700)}`));
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, body: '{"detail":"mock"}', contentType: 'application/json' }));
  await page.route('**/api/me', json({ appearanceHub: 'off', admin: true, user: 'brett' }));
  await page.route('**/api/plugins/glossary-index/catalog', json(catalog));
  await page.route('**/api/plugins/glossary-index/walkthroughs', json({ items: [summary], ai: true }));
  await page.route('**/api/plugins/glossary-index/demos*', json({ items: [] }));
  await page.route('**/api/plugins/glossary-index/walkthrough/plan', json({ id: 'investor-tour', title: w.name, brief: w.brief, request: w.request, missing: [], features: [] }));
  return { c, page };
}
const base = `http://127.0.0.1:${PORT}/`;
const P = '.axp-glossary-index__wt-player';
const next = async (page) => { await page.click(`${P} button:has-text("Next")`); await sleep(600); };
try {
  // 1. the sandbox way: play the exported file with no API (desktop)
  const { c, page } = await ctx({ width: 1440, height: 900 }, false);
  await page.goto(`${base}?axf-walkthrough-src=/samples/investor-tour.walkthrough.json`);
  await page.waitForSelector(P, { timeout: 20000 });
  const eyebrow = await page.textContent(`${P} .fx-eyebrow`);
  check(/AmberX AXF investor tour · v1\.0\.0 · Step 1 of 22/.test(eyebrow), `player opens from the file: ${eyebrow}`);
  await page.screenshot({ path: `${OUT}/desktop-1-intro.png` });
  await next(page);
  check(/Everything is an asset/.test(await page.textContent(P)), 'Next moves to part 1');
  check(await page.isVisible('.axp-glossary-index__wt-docs'), 'docs card shows');
  await page.screenshot({ path: `${OUT}/desktop-2-part1-docs.png` });
  await page.selectOption(`${P} select`, '1');
  await sleep(1500);
  check(/The Theme manager/.test(await page.textContent(P)), 'Part picker jumps to part 2');
  await page.screenshot({ path: `${OUT}/desktop-3-theme-manager.png` });
  await page.selectOption(`${P} select`, '2');
  await sleep(1200);
  for (let i = 0; i < 3; i++) await next(page);
  check(/Your turn: tap Only undescribed/.test(await page.textContent(P)), 'try-it step waits for the viewer');
  await sleep(800);
  const hl = await page.$('.axp-glossary-index-target');
  check(!!hl, `try-it target highlighted: ${hl ? await hl.evaluate((e) => e.outerHTML.slice(0, 140)) : 'none'}`);
  await page.screenshot({ path: `${OUT}/desktop-4-try-it.png` });
  if (hl) {
    await hl.click({ force: true }); await sleep(500);
    const after = await page.textContent(P); check(/You did it/.test(after), `tapping the highlighted control completes the try-it step: ${after.slice(0, 400)}`);
    await page.screenshot({ path: `${OUT}/desktop-5-try-done.png` });
  }
  await page.click(`${P} button:has-text("Stop")`);
  // the generator page
  await page.goto(`${base}?axf-view=walkthrough-generator`);
  await page.waitForSelector('.axp-glossary-index__wt-list', { timeout: 20000 });
  await page.fill('.axp-glossary-index__wt-picker input', 'merge queue');
  await sleep(500);
  const boxes = await page.$$('.axp-glossary-index__wt-list input[type=checkbox]');
  check(boxes.length > 0, `search lists entries (${boxes.length})`);
  for (const b of boxes.slice(0, 3)) await b.check();
  check((await page.$$('.axp-glossary-index__wt-order li')).length === Math.min(3, boxes.length), 'picked entries show in order');
  await page.click('button:has-text("Show brief")');
  await page.waitForSelector('.axp-glossary-index__wt-brief', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/desktop-6-generator.png` });
  await page.screenshot({ path: `${OUT}/desktop-7-generator-full.png`, fullPage: true });
  await c.close();
  // 2. phone
  const p2 = await ctx({ width: 412, height: 915 }, true);
  await p2.page.goto(`${base}?axf-walkthrough-src=/samples/investor-tour.walkthrough.json&axf-walkthrough-step=2`);
  await p2.page.waitForSelector(P, { timeout: 20000 });
  await sleep(900);
  await p2.page.screenshot({ path: `${OUT}/phone-1-player.png` });
  await p2.page.goto(`${base}?axf-view=walkthrough-generator`);
  await p2.page.waitForSelector('.axp-glossary-index__wt-list', { timeout: 20000 });
  await p2.page.fill('.axp-glossary-index__wt-picker input', 'theme');
  await sleep(500);
  for (const b of (await p2.page.$$('.axp-glossary-index__wt-list input[type=checkbox]')).slice(0, 2)) await b.check();
  await p2.page.screenshot({ path: `${OUT}/phone-2-generator.png` });
  await p2.c.close();
} catch (e) { results.push(`FAIL error ${e.message.split('\n')[0]}`); try { for (const pg of browser.contexts().flatMap((c) => c.pages())) await pg.screenshot({ path: `${OUT}/fail.png` }); } catch {} }
await browser.close();
srv.kill();
console.log(results.join('\n'));
process.exit(0);
