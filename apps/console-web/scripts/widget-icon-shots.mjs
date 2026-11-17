/**
 * Widget icons screenshots (build icon-picker-every-banner-settings-widget): the banner and Settings before (every
 * widget drawn as text, how text-only widgets drew before the build) and after (the icon rule), and the icon picker in
 * its three layouts (grid, list, compact), on desktop and phone. Runs against `vite preview` of dist/ with every API
 * answered offline; drives the console through window.axfConsoleControl (the console actions widget.mode,
 * widget.icons, widget.icons.layout).
 *
 *   node scripts/widget-icon-shots.mjs <out-dir>     (build first: npm run build)
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
if (!OUT) { console.error('usage: node scripts/widget-icon-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.CI_SHOTS_PORT) || 7099;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((x) => window.axfConsoleControl(x), cmd);
    // function targets follow the action bus on a 4 s sync
    await page.waitForFunction(async () => (await window.axfConsoleControl({ verb: 'search', query: { q: 'widget icons', limit: 5 } })).hits?.some((h) => h.address === 'function:widget.icons'), null, { timeout: 20_000, polling: 1000 });
    const act = (action, value) => run({ verb: 'press', address: `function:${action}`, ...(value ? { value } : {}) });
    const shot = async (name) => { await sleep(1200); process.stderr.write(`shot ${name} ${device}\n`); const f = join(OUT, `${name}-${device}.png`); await page.screenshot({ path: f }); shots.push(f); };
    await run({ verb: 'open', address: 'view:settings' });
    // every widget the console resolved, drawn as text = before
    const ids = await page.evaluate(() => [...document.querySelectorAll('[data-axf-widget-icon-id]')].map((e) => e.getAttribute('data-axf-widget-icon-id')));
    const banner = await page.evaluate(() => [...document.querySelectorAll('[data-axf-banner-item]')].map((e) => `banner:${e.getAttribute('data-axf-banner-item')}`));
    const all = [...new Set([...banner, ...ids.filter((i) => i.startsWith('settings:tab:'))])].filter(Boolean).slice(0, 24);
    process.stderr.write(`${device}: ${all.length} widgets\n`);
    // straight through the action bus (one command each would highlight every target)
    const modes = (mode) => page.evaluate(({ list, m }) => { for (const id of list) window.axfConsoleControl({ verb: 'press', address: 'function:widget.mode', value: `${id}:${m}`, options: { highlight: false } }); }, { list: all, m: mode });
    await modes('text');
    await shot('settings-before');
    await modes('auto');
    await shot('settings-after');
    for (const layout of ['grid', 'list', 'compact']) {
      await act('widget.icons.layout', layout);
      const opened = await act('widget.icons', 'settings:tab:appearance');
      if (process.env.CI_SHOTS_DEBUG) console.error(JSON.stringify(opened).slice(0, 400));
      await page.locator('[data-axf-icon-picker]').first().waitFor({ timeout: 10_000 });
      await shot(`picker-${layout}`);
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    await act('widget.icons.layout', 'grid');
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
