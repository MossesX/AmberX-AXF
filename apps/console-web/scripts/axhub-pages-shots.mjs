/**
 * Screenshots of the axHub module's pages in the console (hub-pages@1: Approvals with a held call, Passes, Users, Apps,
 * axHub) for UI Review, desktop and phone, against `vite preview` of dist/ with the console's hub-pages relay
 * (`/api/hub-pages/*`) answered from a fixed fake hub. Nothing reaches a real hub.
 *
 *   node scripts/axhub-pages-shots.mjs <out-dir>        (build first: npm run build)
 *   AXHUB_SHOTS_PORT=7099 · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/axhub-pages-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.AXHUB_SHOTS_PORT) || 7099;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const HUB = 'https://axhub.amberxai.com';
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const later = (min) => new Date(Date.now() + min * 60_000).toISOString();
const user = (o) => ({ id: o.username, role: 'user', disabled: false, createdAt: ago(60 * 24 * 30), passwordChangedAt: ago(60 * 24 * 9), weakPassword: false, permissions: [], name: '', email: '', mustChangePassword: false, ...o });
const BRETT = user({ username: 'brett', role: 'admin', name: 'Brett', email: 'owner@example.test' });
const SESSION = { signedIn: true, hub: HUB, loginUrl: `${HUB}/auth/login`, admin: true, user: BRETT, via: 'browser', can: { approvals: true, approvalLog: true, users: true, apps: true, handoff: true } };
const item = (id, o) => ({
  id, tool: 'vps.run', summary: 'docker system prune -f', args: '{}', whole: true, title: 'Free disk space on the VPS', reasonGiven: true, effect: 'changes',
  description: 'Disk is at 86%. Prune stopped containers and dangling images.', code: { service: 'vps', tool: 'run', qualified: 'vps.run', arguments: '{\n  "command": "docker system prune -f"\n}', command: 'docker system prune -f' },
  status: 'pending', statusLabel: 'Waiting', reviewRequired: false, actions: ['approve', 'decline', 'postpone', 'ignore'], revision: 1, callerId: 'claude',
  createdAt: ago(3), expiresAt: later(57), showExpires: true, history: [], source: { kind: 'headless', label: 'Headless', who: 'fable-full-audit s16' }, ...o,
});
const GRID = {
  filters: [{ id: 'all', label: 'All' }, { id: 'pending', label: 'Waiting' }, { id: 'approved', label: 'Approved' }, { id: 'declined', label: 'Declined' }],
  filter: 'all', page: 1, pages: 1, total: 4, waiting: 1, heldCount: 1, postponed: 0, log: true, auto: { available: true, minutes: [5, 10, 30] },
  items: [
    item('11111111-1111-4111-8111-111111111111', { tool: 'github.pulls/merge', title: 'Merge PR #912 into main', summary: 'merge #912', status: 'held', statusLabel: 'Held', actions: [], source: { kind: 'claude_code', label: 'Claude Code', who: 'merge-queue' }, veto: { runsAt: later(1), secondsLeft: 64, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'] } }),
    item('22222222-2222-4222-8222-222222222222', {}),
    item('33333333-3333-4333-8333-333333333333', { tool: 'axhub.memory_write', title: 'Save the plan tree', status: 'approved', statusLabel: 'Approved', actions: ['revoke'], showExpires: false, createdAt: ago(42), source: { kind: 'console', label: 'Console', who: '' } }),
    item('44444444-4444-4444-8444-444444444444', { tool: 'coolify.deploy', title: 'Redeploy axHub', status: 'declined', statusLabel: 'Declined', actions: ['reopen'], showExpires: false, createdAt: ago(130), source: { kind: 'claude_ai', label: 'Claude.ai', who: 'chat' } }),
  ],
};
const pass = (o) => ({ id: 'p1', service: 'github', tools: ['pulls/create', 'pulls/merge'], title: 'Land the audit build', description: 'Merge queue for the console audit.', createdAt: ago(20), expiresAt: later(40), active: true, secondsLeft: 2400, grantedBy: 'brett', grantedVia: 'web', uses: 7, lastUsedAt: ago(2), canExtend: true, canRevoke: true, ...o });
const PASSES = { active: [pass({})], recent: [pass({ id: 'p0', title: 'Theme pass', service: 'console', tools: ['token.set'], active: false, secondsLeft: 0, expiresAt: ago(90), createdAt: ago(150), uses: 3, canExtend: false, canRevoke: false })], minutes: { min: 5, max: 240, presets: [15, 30, 60, 120] }, now: ago(0) };
const USERS = { you: 'brett', roles: ['admin', 'user'], passwordMin: 12, tempPasswordMin: 12, hints: [{ id: 'apps.download', label: 'Download apps' }, { id: 'console.themes', label: 'Console themes' }],
  users: [BRETT, user({ username: 'mosses', name: 'Mosses', permissions: ['apps.download'] }), user({ username: 'vinny', name: 'Vinny', disabled: true })] };
const build = (b) => ({ version: '0.4.2', build: b, file: `console-0.4.2-b${b}.apk`, size: 18_400_000, sha256: 'a'.repeat(64), builtAt: ago(60 * b) });
const APPS = { updatedAt: ago(30), apps: [
  { project: 'console', name: 'Dev Console', platform: 'android', latest: build(41), versions: [build(41), build(40), build(39)] },
  { project: 'voicevault', name: 'Voice Vault', platform: 'android', latest: { ...build(12), file: 'voicevault-0.4.2-b12.apk' }, versions: [{ ...build(12), file: 'voicevault-0.4.2-b12.apk' }] },
] };
const ACCOUNT = { user: BRETT, passwordMin: 12, browsers: [{ id: 'b1', label: 'Chrome on Android', lastSeenAt: ago(0), current: true }, { id: 'b2', label: 'Firefox on Linux', lastSeenAt: ago(60 * 26), current: false }] };
const HUB_REPLIES = { 'auth/api/session': SESSION, 'auth/api/approvals': GRID, 'auth/api/passes': PASSES, 'auth/api/users': USERS, 'apps.json': APPS, 'auth/api/account': ACCOUNT };
const ME = { wall: true, hub: HUB, appearanceHub: 'off', user: { name: 'brett', role: 'admin' }, admin: true, role: 'admin', themes: true, plugins: [] };

const SCREENS = [['approvals', 'view:axhub-approvals', '.axf-grid-row'], ['passes', 'view:axhub-passes', '.fx-card'], ['users', 'view:axhub-users', '.fx-card'], ['apps', 'view:axhub-apps', '.fx-card'], ['hub', 'view:axhub-hub', '.fx-table']];

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.AXHUB_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const [name, address, ready] of SCREENS) {
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
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
      await sleep(10_000); // first visit: every plugin loads once to learn its shape before its views can be opened
      // New plugins load once at startup to learn their shape: retry the open until the view is there.
      let opened = null;
      for (let i = 0; i < 40; i++) { opened = await run({ verb: 'open', address }).catch((e) => ({ ok: false, message: String(e) })); if (opened?.ok) break; await sleep(500); }
      say(`${name} ${device}: open → ${JSON.stringify(opened).slice(0, 160)}`);
      await page.waitForSelector(`.fx-main ${ready}`, { timeout: 20_000 }).catch((e) => say(`${name} ${device}: ${e.message.split('\n')[0]}`));
      await sleep(1200);
      const file = join(OUT, `axhub-${name}-${device}.png`);
      await page.screenshot({ path: file, fullPage: !mobile });
      shots.push(file);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
