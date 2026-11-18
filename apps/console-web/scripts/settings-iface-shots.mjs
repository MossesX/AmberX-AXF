/**
 * Screenshots of the settings interface row (settings-iface@1; build settings-iface-default-all): desktop and phone.
 *   1. a plugin's settings tab with its interface locked on default-<name> (greyed, unticked)
 *   2. the picker dialog after ticking "Use another settings interface" (only interfaces built for that plugin)
 *   3. Settings → Appearance → Asset types with one asset type's card open (locked row)
 * Runs against `vite preview` of dist/ with every API answered offline.
 *
 *   node scripts/settings-iface-shots.mjs <out-dir> [plugin tab id]     (build first: npx vite build)
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
const TAB = process.argv[3] || 'gate';
if (!OUT) { console.error('usage: node scripts/settings-iface-shots.mjs <out-dir> [plugin tab id]'); process.exit(2); }
const PORT = Number(process.env.CI_SHOTS_PORT) || 7300 + Math.floor(Math.random() * 600);
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const say = (m) => process.stderr.write(`${m}\n`);
// its own process group, so stopping it also stops the vite child npx starts
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, detached: true, stdio: process.env.CI_SHOTS_DEBUG ? 'inherit' : 'ignore' });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopServer);
let serverExited = false;
server.on('exit', () => { serverExited = true; });
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up || serverExited) throw new Error(`vite preview on :${PORT} did not start (port taken, or dist/ not built)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    // nothing leaves the machine: an external font that never loads would hold every screenshot
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((x) => window.axfConsoleControl(x), cmd);
    const shot = async (name) => { const p = join(OUT, `${name}-${device}.png`); await page.screenshot({ path: p }); shots.push(p); say(`${name} ${device}`); };
    await sleep(4000);
    // 1. a plugin's settings tab: locked on its default
    // plugins install after the console loads: open the tab until it is there
    const row = page.locator('[data-axf-settings-iface^="plugin:"]').first();
    for (let i = 0; i < 20 && !(await page.locator(`[data-axf-settings-tab="${TAB}"]`).count()); i++) {
      await page.keyboard.press('Escape');
      await run({ verb: 'press', address: 'function:settings.open', value: TAB });
      await sleep(1500);
    }
    await row.waitFor({ timeout: 20_000 }).catch(async (e) => { say((await page.evaluate(() => document.querySelector('[data-axf-settings-tab]')?.outerHTML ?? 'none')).slice(0, 3000)); throw e; });
    await row.scrollIntoViewIfNeeded();
    await sleep(400);
    await shot('plugin-locked');
    // 2. tick → the dialog lists only interfaces built for this plugin
    await row.getByRole('checkbox', { name: 'Use another settings interface' }).click();
    await page.locator('[data-axf-settings-iface-dialog]').waitFor({ timeout: 10_000 });
    await sleep(400);
    await shot('plugin-dialog');
    await page.keyboard.press('Escape');
    await sleep(300);
    // 3. Settings → Appearance → Asset types, the toolbar card open
    await run({ verb: 'press', address: 'function:settings.open', value: 'asset-types' });
    const card = page.locator('[data-axf-anchor="settings-asset-type:toolbar"]');
    await card.waitFor({ timeout: 15_000 });
    await card.getByRole('button').first().click().catch((e) => say(`open card: ${e.message.split('\n')[0]}`));
    await page.locator('[data-axf-settings-iface="asset:toolbar"]').waitFor({ timeout: 10_000 }).catch(() => {});
    await card.scrollIntoViewIfNeeded();
    await sleep(400);
    await shot('asset-type-locked');
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  stopServer(); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
