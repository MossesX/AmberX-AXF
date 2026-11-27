/**
 * Screenshots of the ways into the app catalog (view axhub-apps) for UI Review, desktop and phone: the Apps menu with
 * "Android apps (downloads)" first, the screen it opens, and the side navigation's Apps section under Home. Runs
 * against `vite preview` of dist/ with the hub-pages relay answered from a fixed fake hub; nothing reaches a real hub.
 *
 *   node scripts/apps-nav-shots.mjs <out-dir>        (build first: npm run build)
 *   APPS_NAV_SHOTS_PORT=7461 · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/apps-nav-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.APPS_NAV_SHOTS_PORT) || 7461;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const HUB = 'https://axhub.amberxai.com';
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const BRETT = { id: 'brett', username: 'brett', role: 'admin', name: 'Brett', email: 'owner@example.test', disabled: false, permissions: [], createdAt: ago(60 * 24 * 30), passwordChangedAt: ago(60 * 24 * 9), weakPassword: false, mustChangePassword: false };
const SESSION = { signedIn: true, hub: HUB, loginUrl: `${HUB}/auth/login`, admin: true, user: BRETT, via: 'browser', can: { approvals: true, approvalLog: true, users: true, apps: true, handoff: true } };
const build = (file, b) => ({ version: '0.4.2', build: b, file: `${file}-0.4.2-b${b}.apk`, size: 18_400_000, sha256: 'a'.repeat(64), builtAt: ago(60 * b) });
const APPS = { updatedAt: ago(30), apps: [
  { project: 'console', name: 'AXF Console', platform: 'android', latest: build('console', 41), versions: [build('console', 41), build('console', 40)] },
  { project: 'phone-connect', name: 'Phone Connect', platform: 'android', latest: build('phone-connect', 17), versions: [build('phone-connect', 17)] },
  { project: 'voicevault', name: 'Voice Vault', platform: 'android', latest: build('voicevault', 12), versions: [build('voicevault', 12)] },
] };
const HUB_REPLIES = { 'auth/api/session': SESSION, 'apps.json': APPS };
const ME = { wall: true, hub: HUB, appearanceHub: 'off', user: { name: 'brett', role: 'admin' }, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false, exited = false;
  server.on('exit', () => { exited = true; });
  for (let i = 0; i < 120 && !up && !exited; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } }
  if (exited) throw new Error(`port ${PORT} is taken (set APPS_NAV_SHOTS_PORT)`);
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  const say = (m) => process.stderr.write(`${m}\n`);
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname.startsWith('/api/hub-pages/')) {
        const reply = HUB_REPLIES[u.pathname.slice('/api/hub-pages/'.length)];
        return reply ? json(reply) : json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
      }
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    const shoot = async (name) => { const file = join(OUT, `apps-nav-${name}-${device}.png`); await page.screenshot({ path: file }); shots.push(file); };
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    await sleep(10_000); // first visit: every plugin loads once before its menu entries and views are there
    const bar = page.locator('.fx-frame__menubar');
    // 1. the Apps menu: the catalog is its first entry
    await bar.getByText('Apps', { exact: true }).first().click();
    const entry = page.getByText('Android apps (downloads)', { exact: true }).first();
    await entry.waitFor({ timeout: 10_000 }).catch((e) => say(`${device}: ${e.message.split('\n')[0]}`));
    await sleep(400);
    await shoot('menu');
    // 2. the screen it opens
    await entry.click();
    await page.waitForSelector('.fx-main .fx-card', { timeout: 20_000 }).catch((e) => say(`${device}: ${e.message.split('\n')[0]}`));
    await sleep(1000);
    await shoot('screen');
    // 3. the side navigation (off by default: the View menu's own switch shows it): Apps sits right under Home
    const shown = await page.evaluate(() => window.axfConsoleControl({ verb: 'press', address: 'function:slot.hide', value: 'nav-menu:toggle' }).catch((e) => ({ ok: false, message: String(e) })));
    say(`${device}: side navigation → ${JSON.stringify(shown).slice(0, 140)}`);
    await page.waitForSelector('[data-axf-nav="app"]', { timeout: 10_000 }).catch((e) => say(`${device}: ${e.message.split('\n')[0]}`));
    await sleep(600);
    await shoot('sidenav');
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
