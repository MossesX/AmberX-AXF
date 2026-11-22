/**
 * Before / after screenshots of a chrome Settings… Interface tab (build fix-banner-settings-interface-tab): desktop and
 * phone, for the banner, the app toolbar and one tab group. Each pair opens the instance's Settings → Interface tab
 * through console-control (`function:chrome.settings` = the deep link), shoots it, presses one control on the tab and
 * shoots again: the chrome restyles, the settings window stays the same. Runs against `vite preview` of dist/ with every
 * API answered offline.
 *
 *   node scripts/chrome-interface-shots.mjs <out-dir>     (build first: npm run build)
 *   CI_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/chrome-interface-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.CI_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
/** Each case: the instance, the control pressed on its Interface tab (a radio by its label inside a group), and what to frame. */
const CASES = [
  { name: 'banner', type: 'banner', id: 'app', group: 'Surface', option: 'Accent', field: 'surface' },
  { name: 'toolbar', type: 'toolbar', id: 'app', group: 'Buttons', option: 'Icons + labels', field: 'variant' },
  { name: 'tab-group', type: 'tab-group', id: 'settings.tabs', group: 'Show', option: 'Icons', field: 'display', view: 'view:settings' },
];

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.CI_SHOTS_DEBUG ? 'inherit' : 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  const say = (m) => process.stderr.write(`${m}\n`);
  for (const c of CASES.filter((x) => !process.env.CI_SHOTS_ONLY || process.env.CI_SHOTS_ONLY.split(',').includes(x.name))) {
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
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
      if (c.view) await run({ verb: 'open', address: c.view });
      await sleep(600);
      const open = await run({ verb: 'press', address: 'function:chrome.settings', value: `${c.type}:${c.id}:interface` });
      say(`${c.name} ${device}: open → ${JSON.stringify(open).slice(0, 160)}`);
      const panel = page.locator(`[data-axf-interface-for="${c.type}:${c.id}"]`);
      await sleep(500);
      if (!(await panel.count())) await page.locator('[role="tab"]', { hasText: 'Interface' }).last().click({ timeout: 5000 }).catch((e) => say(`tab click: ${e.message.split('\n')[0]}`));
      await panel.waitFor({ timeout: 15_000 }).catch(async (e) => { await page.screenshot({ path: join(OUT, `debug-${c.name}-${device}.png`) }); say(await page.evaluate(() => [...document.querySelectorAll("[role=dialog] [role=tab]")].map((t) => `${t.textContent}:${t.getAttribute("aria-selected")}`).join(" | "))); throw e; });
      await sleep(400);
      const before = join(OUT, `${c.name}-interface-before-${device}.png`);
      await page.screenshot({ path: before });
      await panel.locator(`[role="radiogroup"][aria-label="${c.group}"]`).first().getByRole('radio', { name: c.option, exact: true }).click({ timeout: 5000 });
      await sleep(700);
      const after = join(OUT, `${c.name}-interface-after-${device}.png`);
      await page.screenshot({ path: after });
      const state = await run({ verb: 'state', address: `setting:chrome.${c.type}.${c.id}.${c.field}` });
      say(`${c.name} ${device}: after → ${JSON.stringify(state?.state?.value ?? state?.state?.target?.value ?? state).slice(0, 120)}`);
      shots.push(before, after);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
