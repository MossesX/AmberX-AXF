/**
 * Screenshots for build plan-studio-2-open-button-working-deep, desktop and phone, against `vite preview` of dist/ with
 * every API answered offline (Plan Studio 2.0 gets a small sample tree):
 *   1. plan-open       Plan Studio 2.0 with one plan opened on its own, reached by the deep link
 *                      ?axf-target=view:plan-studio-2/plan:<id>
 *   2. deep-link       Settings → Plugins → Plan Studio 2.0 reached by #/settings/plugins/plan-studio-2 (its Open panel)
 *   3. palette-<look>  the Ctrl+K command palette with "plan" typed, once per look (centred, bottom sheet, side drawer)
 *
 *   node scripts/plan-studio-2-shots.mjs <out-dir>        (build first: npx vite build)
 *   CI_SHOTS_PORT=<port> · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/plan-studio-2-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.CI_SHOTS_PORT) || 7300 + Math.floor(Math.random() * 600);
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const at = '2026-11-18T12:00:00.000Z';
const item = (id, parent, order, kind, title, more = {}) => ({ id, parent, order, kind, title, body: '', status: 'draft', done: false, priority: '', tags: [], model: '', minutes: 0, links: [], collapsed: false, createdAt: at, updatedAt: at, by: 'shots', ...more });
const ITEMS = [
  item('launch-day', null, 0, 'plan', 'Launch day', { status: 'active', priority: 'P1' }),
  item('launch-prep', 'launch-day', 0, 'section', 'Preparation'),
  item('launch-dns', 'launch-prep', 0, 'step', 'Point the DNS at the new host', { done: true, model: 'Opus', minutes: 10 }),
  item('launch-deploy', 'launch-prep', 1, 'step', 'Deploy the console', { model: 'Opus', minutes: 20 }),
  item('launch-notes', 'launch-day', 1, 'note', 'Rollback: keep the old container for a day'),
  item('voice-plan', null, 1, 'plan', 'Voice commands everywhere'),
  item('voice-step', 'voice-plan', 0, 'step', 'Say "open launch day"', { minutes: 15 }),
];
const STATE = { ok: true, rev: 3, items: ITEMS, trash: [], store: '/projects/amberx-axf/_data/plan-studio-2', onHub: true };
const say = (m) => process.stderr.write(`${m}\n`);

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
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname === '/api/plugins/plan-studio-2/state' || u.pathname === '/api/control/plan-studio-2/state') return json(STATE);
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return json({ ok: false, error: 'offline (shots)' }, 503);
    });
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    const shot = async (name) => { const p = join(OUT, `${name}-${device}.png`); await page.screenshot({ path: p }); shots.push(p); say(`${name} ${device}`); };
    const ready = () => page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });

    // 1. a deep link straight into one plan of Plan Studio 2.0
    await page.goto(`http://127.0.0.1:${PORT}/?axf-target=view:plan-studio-2/plan:launch-day`);
    await ready();
    await page.locator('.axp-plan-studio-2__opened').waitFor({ timeout: 30_000 }).catch((e) => say(`plan-open: ${e.message.split('\n')[0]}`));
    await sleep(800);
    await shot('plan-open');

    // 2. a deep link into a settings sub-tab, followed while the console is open (hashchange)
    await page.evaluate(() => { window.location.hash = '#/settings/plugins/plan-studio-2'; });
    await page.locator('[data-axf-target="button:plan-studio-2.open-page"]').waitFor({ timeout: 20_000 }).catch((e) => say(`deep-link: ${e.message.split('\n')[0]}`));
    await sleep(800);
    await shot('deep-link');

    // 3. the palette, once per look
    for (const look of ['command-palette', 'command-palette-sheet', 'command-palette-drawer']) {
      await page.keyboard.press('Escape');
      await page.evaluate((v) => window.axfConsoleControl({ verb: 'set', address: 'setting:console.palette.look', value: v }), look);
      await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:plan-studio-2' }));
      await sleep(500);
      await page.keyboard.press('Control+k');
      const field = page.locator('.cc-palette input').first();
      await field.waitFor({ timeout: 10_000 }).catch((e) => say(`palette: ${e.message.split('\n')[0]}`));
      await field.fill('plan');
      await sleep(700);
      await shot(`palette-${look}`);
    }
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  stopServer(); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
