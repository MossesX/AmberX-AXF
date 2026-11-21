/**
 * Screenshots of Builds → VPS Configuration (the gate plugin): the Build cap tab and the Passes tab (veto passes),
 * desktop and phone, against `vite preview` of dist/ with the routes answered from a fixed fixture (no VPS, no hub).
 * Each shot opens its tab through console-control (`view:vps-configuration`, then `view:gate/tab:gate.tabs=<tab>`),
 * so it also proves the screen's new address and the tab addresses resolve.
 *
 *   node scripts/vps-config-shots.mjs <out-dir>        (build first: npm run build)
 *   VPS_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/vps-config-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.VPS_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const inMin = (min) => new Date(Date.now() + min * 60000).toISOString();
const CAP = {
  ok: true, $axf: 'build-cap@1', at: inMin(0), hardCap: 4, live: 2, free: 2, emergencySlots: 2, emergencyLive: 0, stepsInParallel: 6, effective: 4,
  note: 'Steps in parallel is 6 but the hard cap is 4: only 4 run at once.', setBy: 'brett', setAt: '2026-11-18T08:31:18.835Z',
  ranges: { maxBuilds: [1, 64], emergencySlots: [0, 8], stepsInParallel: [1, 12] }, ownerOnly: ['maxBuilds', 'emergencySlots'], canEdit: false,
};
const pass = (id, scope, label, state, extra = {}) => ({ id, scope, label, state, minutes: 30, reason: 'theme pass for the skin build', requestedBy: 'claude', requestedAt: inMin(-3), changes: 3, text: `${label}: on for 30 minutes.`, ...extra });
const PASSES = {
  ok: true, maxMinutes: 120,
  items: [
    { id: 'all', label: 'Everything', targets: ['*'], active: pass('p-101', 'all', 'Everything', 'active', { expiresAt: inMin(24), approvedBy: 'brett' }), pending: null, text: 'Everything runs without the veto until the pass ends.' },
    { id: 'tokens.theme', label: 'Theme', targets: ['tokens.theme'], active: null, pending: pass('p-102', 'tokens.theme', 'Theme', 'pending', { minutes: 45 }), text: 'A request is waiting for approval.' },
    { id: 'tokens.style', label: 'Style', targets: ['tokens.style'], active: null, pending: null, text: 'No pass: changes wait for the veto countdown.' },
    { id: 'tokens.layout', label: 'Layout', targets: ['tokens.layout'], active: null, pending: null, text: 'No pass: changes wait for the veto countdown.' },
  ],
  recent: [pass('p-099', 'tokens.theme', 'Theme', 'expired', { text: 'Ended after 30 minutes; 5 changes.' }), pass('p-098', 'all', 'Everything', 'revoked', { text: 'Revoked by brett after 4 minutes; 1 change.' })],
};
const GATE_SETTINGS = { ok: true, settings: { refreshSec: 600, historySize: 2000, defaultTab: 'rules' } };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const TABS = [['build-cap', '[data-axf-toolbar="gate.build-cap"]'], ['passes', '#vps-pass-start, [id$="vps-pass-start"]']];

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.VPS_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const [tab, ready] of TABS) {
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => say(`${tab} ${device}: page error: ${e.message.split('\n')[0]}`));
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname === '/api/me') return json(ME);
        if (u.pathname === '/api/plugins/gate/build-cap') return json(CAP); // axf-plugin:gate
        if (u.pathname === '/api/plugins/gate/settings') return json(GATE_SETTINGS); // axf-plugin:gate
        if (u.pathname === '/api/plugins/token-control/pass/status') return json(PASSES); // axf-plugin:token-control
        if (u.pathname === '/api/plugins/token-control/pass/settings') return json({ ok: true, maxMinutes: 120, timeZone: 'America/New_York' }); // axf-plugin:token-control
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd).catch((e) => ({ ok: false, error: String(e) }));
      await sleep(10_000); // first visit: every plugin loads once to learn its shape before its views can be opened
      const open = async (address) => {
        let r = null;
        for (let i = 0; i < 40; i++) { r = await run({ verb: 'open', address }); if (r?.ok) break; await sleep(500); }
        say(`${tab} ${device}: open ${address} → ${JSON.stringify(r).slice(0, 160)}`);
      };
      await open('view:vps-configuration'); // the screen's address under its new name
      await sleep(600);
      await open(`view:gate/tab:gate.tabs=${tab}`);
      await page.waitForSelector(ready, { timeout: 15_000 }).catch((e) => say(`${tab} ${device}: ${e.message.split('\n')[0]}`));
      await sleep(900);
      const state = await run({ verb: 'state', address: tab === 'build-cap' ? 'setting:vps.buildCap.stepsInParallel' : 'setting:vps.passes.maxMinutes' });
      say(`${tab} ${device}: its setting target → ${JSON.stringify(state).slice(0, 220)}`);
      const file = join(OUT, `vps-configuration-${tab}-${device}.png`);
      await page.screenshot({ path: file, fullPage: !mobile });
      shots.push(file);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
