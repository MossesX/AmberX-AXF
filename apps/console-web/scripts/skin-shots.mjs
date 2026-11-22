/**
 * Skin pass screenshots (build fable-full-audit-ui-overhaul-conso s12): the console's AmberX skin by day and by night,
 * desktop and phone. Applies the AmberX Signature Day package, shoots Home and Settings, then presses the banner's
 * theme switch (it must land on the package's own night theme, Carbon Amber, not an unrelated theme) and shoots again.
 * Runs against `vite preview` of dist/ with every API answered offline.
 *
 *   node scripts/skin-shots.mjs <out-dir>          (build first: npm run build)
 *   CI_SHOTS_PORT=<port, default random 7300-7899> · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/skin-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.CI_SHOTS_PORT) || 7300 + Math.floor(Math.random() * 600);
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const say = (m) => process.stderr.write(`${m}\n`);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, detached: true, stdio: process.env.CI_SHOTS_DEBUG ? 'inherit' : 'ignore' });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopServer);
let browser;
let failed = false;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} did not start (port taken, or dist/ not built)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((x) => window.axfConsoleControl(x), cmd);
    const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fx-bg').trim());
    const shot = async (name) => { await sleep(600); await page.screenshot({ path: join(OUT, `${name}-${device}.png`) }); say(`${name}-${device} (bg ${await bg()})`); };
    await sleep(3000);
    const r = await run({ verb: 'press', address: 'function:design.package', value: 'amberx-signature-day' });
    if (!r?.ok) say(`design package: ${JSON.stringify(r).slice(0, 300)}`);
    await sleep(1200);
    await run({ verb: 'open', address: 'screen:home' });
    await shot('day-home');
    const sw = page.locator('.fx-widget-theme:visible').first();
    if (!(await sw.count())) {
      // the phone banner folds its widgets away: show the night package directly
      say(`no visible theme switch on ${device}: applying the night package`);
      await run({ verb: 'press', address: 'function:design.package', value: 'amberx-signature-night' });
      await shot('night-home');
      await run({ verb: 'press', address: 'function:settings.open', value: 'appearance' });
      await shot('night-settings');
      await page.keyboard.press('Escape');
      await run({ verb: 'press', address: 'function:design.package', value: 'amberx-signature-day' });
      await run({ verb: 'press', address: 'function:settings.open', value: 'appearance' });
      await shot('day-settings');
    } else {
      await sw.click();
      await sleep(800);
      const night = await bg();
      if (night.toLowerCase() !== '#121110') { say(`theme switch landed on bg ${night}, want Carbon Amber #121110`); failed = true; }
      await shot('night-home');
      await run({ verb: 'press', address: 'function:settings.open', value: 'appearance' });
      await shot('night-settings');
      await page.keyboard.press('Escape');
      await sw.click();
      await sleep(800);
      const day = await bg();
      if (day.toLowerCase() !== '#f9f7f3') { say(`theme switch back landed on bg ${day}, want Saffron Day #f9f7f3`); failed = true; }
      await run({ verb: 'press', address: 'function:settings.open', value: 'appearance' });
      await shot('day-settings');
    }
    await ctx.close();
  }
} catch (e) {
  say(String(e?.stack ?? e));
  failed = true;
} finally {
  await browser?.close();
  stopServer();
}
process.exit(failed ? 1 : 0);
