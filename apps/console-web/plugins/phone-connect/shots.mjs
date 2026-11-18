/**
 * Screenshots of Settings → Plugins → Phone Connect (build rebuild-fresh-main-phone-connect-small) for UI Review:
 * desktop and phone, one pair per layout option (tabs, stacked, split: the phone-connect layout choice), against
 * `vite preview` of dist/ with the plugin's routes answered from a fixed fixture (no VPS, no phone). Each shot opens
 * the sub-tab through console-control, like the deep link does.
 *
 *   node apps/console-web/plugins/phone-connect/shots.mjs <out-dir>   (build the console first: npm run build)
 *   PC_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path> · PC_SHOTS_ONLY=tabs,stacked,split
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..'); // apps/console-web
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node apps/console-web/plugins/phone-connect/shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.PC_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const at = (min) => new Date(Date.parse('2026-11-17T21:00:00Z') - min * 60000).toISOString();
const DEVICE = {
  $axf: 'phone-device@1', deviceId: 'phone-3fa9c2e17b0d4a55', name: 'samsung SM-S948U', app: 'phone-connect-droid', appVersion: '0.1.0', platform: 'android',
  capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1', 'voice@1'], state: 'paired', owner: { kind: 'person', who: 'brett' },
  token: { prefix: 'tok_Q7xk', issuedAt: at(90), rotatedAt: '' }, watch: { on: true, ring: true }, urlPolicy: { mode: 'allowlist', allowlist: ['github.com'] },
  pairedAt: at(90), lastSeenAt: at(0.2), revokedAt: '', updatedAt: at(0.2), capabilityState: { 'recorder@1': { running: true, since: at(25), session: 'Build review', parts: 1, queue: 0, mic: false } },
  online: true, presence: 'online',
};
const OLD = { ...DEVICE, deviceId: 'amberx-0123456789abcdef', name: 'samsung SM-S938B (AmberX)', state: 'revoked', token: null, revokedAt: at(60), lastSeenAt: at(200), online: false, presence: 'revoked', capabilityState: {} };
const CATALOG = {
  open_url: { label: 'Open pages', description: 'The console and agents may open a page on the phone (inside its url policy).' },
  notify: { label: 'Notifications', description: 'FYIs, fix updates and alerts that pass the Notifications panel reach the phone.' },
  approval: { label: 'Approval prompts', description: 'Approvals and veto countdowns show on the phone; only your tap there decides.' },
  recorder: { label: 'Audio recorder', description: 'Start, stop and read the phone\'s audio-output recorder (a start always asks you first).' },
  voice: { label: 'Voice line', description: 'The console assistant may say a line or listen once through the phone.' },
};
const FEATURES = { open_url: true, notify: true, approval: true, recorder: true, voice: false };
const cmd = (id, command, status, min, from, error) => ({ id, command, status, at: at(min), from, result: status === 'done' ? { ok: true } : status === 'failed' ? { ok: false, error } : null });
const COMMANDS = [
  cmd('c1', 'notify', 'done', 2, { kind: 'service', who: 'alerts', via: 'console' }),
  cmd('c2', 'open_url', 'done', 9, { kind: 'session', who: 'axf-build-gate', via: 'mcp' }),
  cmd('c3', 'recorder.start', 'done', 25, { kind: 'session', who: 'claude-session', via: 'hub' }),  // axf-not-plugin:claude-session: a sample caller
  cmd('c4', 'voice', 'failed', 40, { kind: 'session', who: 'ai-assistant', via: 'console' }, { code: 'denied', message: 'Voice line is switched off in Settings → Plugins → Phone Connect' }),  // axf-not-plugin:ai-assistant: a sample caller
];
const STATUS = { ok: true, $axf: 'phone-connect-status@1', at: at(0), paired: true, device: DEVICE, presence: 'online', online: true, devices: 2,
  pairing: { code: 'R6HUG9C9', expiresAt: at(-8), secondsLeft: 480, state: 'pending', claimUrl: '', pairPage: '' }, features: FEATURES, recorder: DEVICE.capabilityState['recorder@1'], origin: 'https://console.amberxai.com' };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.PC_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const layout of (process.env.PC_SHOTS_ONLY || 'tabs,stacked,split').split(',')) {
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        const P = '/api/plugins/phone-connect/';
        if (u.pathname === '/api/me') return json(ME);
        if (u.pathname === `${P}status`) return json(STATUS);
        if (u.pathname === `${P}devices`) return json({ ok: true, devices: [DEVICE, OLD] });
        if (u.pathname === `${P}settings`) return json({ ok: true, features: FEATURES, layout, catalog: CATALOG });
        if (u.pathname === `${P}commands`) return json({ ok: true, commands: COMMANDS });
        if (u.pathname === `${P}pair`) return json({ ok: true, pairing: STATUS.pairing });
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      const run = (c) => Promise.race([page.evaluate((x) => window.axfConsoleControl(x), c), sleep(6000).then(() => ({ ok: false, error: 'timeout' }))]);
      // the plugin sub-tabs show at Administrator; open Settings → Plugins → Phone Connect like a tap does
      await run({ verb: 'open', address: 'view:settings' }).catch(() => undefined);
      await page.locator('select[aria-label="Settings level"]').first().selectOption('administrator', { timeout: 5000 }).catch((e) => say(`level: ${e.message.split('\n')[0]}`));
      await sleep(300);
      const opened = await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect' }).catch((e) => ({ ok: false, error: String(e) }));
      say(`${layout} ${device}: open → ${JSON.stringify(opened).slice(0, 120)}`);
      if (!(await page.locator('.axp-phone').count())) {
        await page.getByText('Plugins', { exact: true }).last().click({ timeout: 5000 }).catch((e) => say(`plugins: ${e.message.split('\n')[0]}`));
        await sleep(400);
        await page.getByText('Phone Connect', { exact: true }).first().click({ timeout: 5000 }).catch((e) => say(`sub-tab: ${e.message.split('\n')[0]}`));
      }
      await page.waitForSelector('.axp-phone', { timeout: 15_000 }).catch(async (e) => { await page.screenshot({ path: join(OUT, `debug-${layout}-${device}.png`) }); say(await page.evaluate(() => document.querySelector('main, #root')?.innerText?.slice(0, 600) ?? '')); throw e; });
      await page.locator('.axp-phone [role="tab"]', { hasText: /^Phones/ }).first().click({ timeout: 3000 }).catch(() => undefined);
      await sleep(900);
      const file = join(OUT, `opt-${layout}--phone-connect-settings-${device}.png`);
      await page.locator('.axp-phone').first().scrollIntoViewIfNeeded().catch(() => undefined);
      await page.screenshot({ path: file, fullPage: !mobile });
      shots.push(file);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); server.kill('SIGTERM'); }
