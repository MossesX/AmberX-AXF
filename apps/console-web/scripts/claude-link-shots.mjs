/**
 * Screenshots of the Terminal's Claude link tab (build terminal-main-tab-streaming-console-s) for UI Review: desktop and
 * phone, one pair per layout (dense, cards, split: the claudeLinkLayout choice) live, plus dense paused, filtered and
 * empty, against `vite preview` of dist/ with the Claude link stream answered from a fixed SSE fixture (no VPS, no
 * axHub). Each shot opens the tab through console-control (`view:terminal/tab:claude-link`), like the deep link does.
 *
 *   node scripts/claude-link-shots.mjs <out-dir>        (build first: npm run build)
 *   CL_SHOTS_PORT=7098 · CL_SHOTS_ONLY=dense-live,cards-live,… · PW_CHROMIUM=<chromium path>
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
if (!OUT) { console.error('usage: node scripts/claude-link-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.CL_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const T0 = Date.parse('2026-11-17T19:40:00Z');
let n = 0;
const ev = (sec, kind, source, summary, extra = {}) => ({ id: ++n, ts: T0 + sec * 1000, kind, source, session: '', account: '', model: '', summary, detail: {}, level: kind === 'error' ? 'error' : kind === 'disconnect' ? 'warn' : 'info', ...extra });
const EVENTS = [
  ev(0, 'connect', 'axhub-client', 'axhub.amberxai.com answered', { detail: { host: 'axhub.amberxai.com', ms: 182 } }),
  ev(4, 'launch', 'headless', 'Started Ivy (terminal-main-tab-streaming-console-s) on claude-opus-5-5', { session: 'axf-terminal-main-tab', model: 'claude-opus-5-5', detail: { surface: 'pipeline', phase: '1' } }),
  ev(5, 'account', 'workers', '→ hulu0241 (subscription): least busy worker, 1/3 running', { session: 'axf-terminal-main-tab', account: 'hulu0241', detail: { state: 'run', accountKind: 'subscription' } }),
  ev(6, 'launch', 'agent-slots', 'slot taken: terminal-main-tab-streaming-console-s', { detail: { slot: 'take', priority: 'normal' } }),
  ev(18, 'mcp', 'mcp-server', 'axf-terminal-main-tab: builds_get ok (41 ms)', { session: 'axf-terminal-main-tab', detail: { tool: 'builds_get', ok: true, ms: 41, args: ['id'] } }),
  ev(31, 'axhub', 'axhub-client', 'call vps.run → veto (240 ms)', { level: 'warn', detail: { host: 'axhub.amberxai.com', tool: 'call vps.run', state: 'veto', status: 200, ms: 240, service: 'vps', action: 'run', reason: 'Restart the console container' } }),
  ev(44, 'mcp', 'mcp-server', 'chat:7f3a: console_show ok (12 ms)', { session: 'chat:7f3a', detail: { tool: 'console_show', ok: true, ms: 12, args: ['target'] } }),
  ev(58, 'axhub', 'axhub-client', 'list_services → ok (96 ms)', { detail: { host: 'axhub.amberxai.com', tool: 'list_services', state: 'ok', status: 200, ms: 96 } }),
  ev(73, 'launch', 'headless', 'Started Brook (skins-possible-fable-review) on claude-fable-5-2', { session: 'axf-skins-review', model: 'claude-fable-5-2' }),
  ev(74, 'account', 'workers', '→ waits for zed (position 2)', { session: 'axf-skins-review', account: 'zed', level: 'warn', detail: { state: 'queue', position: 2 } }),
  ev(92, 'account', 'headless', 'Ivy (terminal-main-tab) hit the limit on hulu0241: handing off to the next worker', { session: 'axf-terminal-main-tab', account: 'hulu0241', level: 'warn', detail: { costUsd: 4.12 } }),
  ev(101, 'disconnect', 'axhub-client', 'axhub.amberxai.com unreachable: HttpError: timed out', { detail: { host: 'axhub.amberxai.com', why: 'timed out', ms: 30000 } }),
  ev(116, 'connect', 'axhub-client', 'axhub.amberxai.com answered again', { detail: { host: 'axhub.amberxai.com', ms: 211 } }),
  ev(130, 'error', 'mcp-server', '/mcp refused a call: wrong bearer token', { detail: { userAgent: 'python-httpx/0.27', path: '/mcp' } }),
  ev(142, 'exit', 'headless', 'Brook (skins-possible-fable-review) ended: exit 1 (crash) · $0.84', { session: 'axf-skins-review', model: 'claude-fable-5-2', account: 'zed', level: 'error', detail: { exit: 1, exitKind: 'crash', costUsd: 0.84 } }),
  ev(142, 'error', 'headless', 'Brook (skins-possible-fable-review): Error: connect ECONNREFUSED 10.0.1.4:443', { session: 'axf-skins-review', detail: { lines: ['Error: connect ECONNREFUSED 10.0.1.4:443'] } }),
];
const counts = (list) => Object.fromEntries(['launch', 'exit', 'account', 'mcp', 'axhub', 'connect', 'disconnect', 'error'].map((k) => [k, list.filter((e) => e.kind === k).length]));
const STATE = (list) => ({ $axf: 'claude-link-state@1', connected: true, since: T0, why: 'axhub.amberxai.com answered again', last: list[list.length - 1] ?? null, counts: counts(list), seq: list.length, clearedAt: 0, size: 2000, held: list.length, subscribers: 1, view: { paused: false, kinds: [], q: '', rev: 0 } });
const SETTINGS = (layout) => ({ $axf: 'terminal-settings@1', idleMinutes: 60, moshKeepMinutes: 30, fontSize: 14, fontSizePhone: 0, chainTextSize: 100, copyOnSelect: false, pasteWarn: true, mouseDefault: false, moshDefault: false, user: '', showHubRuns: false, showHeadless: false,
  vps: { host: '', port: 22, user: 'root' }, windowsLook: true, mica: true, toolbar: true, scheme: 'app', fontFamily: '', lineHeight: 1.15, cursorStyle: 'bar', cursorBlink: true, scrollback: 10000, padding: 1, bell: 'visual', closeConfirm: true,
  startup: 'none', newTab: 'picker', tabWidth: 'equal', claudeProfiles: [{ id: 'default', name: 'Default', model: '', permissionMode: 'default', flags: [], cwd: '', prompt: '', icon: 'sparkles', color: '', connection: 'console' }], defaultClaudeProfile: 'default',
  persistTabs: true, splitDefault: 'side', chainSpeed: 'normal', showChain: true, sessionsNav: false, newSession: 'quiet', sshKey: false, claudeToken: false, publicKey: '',
  claudeLinkBuffer: 2000, claudeLinkKinds: [], claudeLinkAutoScroll: true, claudeLinkDetail: false, claudeLinkLayout: layout });
const sse = (list) => `retry: 3000\nevent: hello\ndata: ${JSON.stringify(STATE(list))}\n\n${list.map((e) => `id: ${e.id}\nevent: link\ndata: ${JSON.stringify(e)}\n\n`).join('')}`;
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

// shot = layout-state
const ALL = ['dense-live', 'cards-live', 'split-live', 'dense-paused', 'dense-filtered', 'dense-empty'];
const ONLY = (process.env.CL_SHOTS_ONLY || ALL.join(',')).split(',');

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.CL_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const shot of ONLY) {
    const [layout, state] = shot.split('-');
    const list = state === 'empty' ? [] : EVENTS;
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        const P = '/api/plugins/console-terminal';
        if (u.pathname === '/api/me') return json(ME);
        if (u.pathname === `${P}/settings`) return json(SETTINGS(layout));
        if (u.pathname === `${P}/claude-link/stream`) return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }, body: Number(u.searchParams.get('since') || 0) ? '' : sse(list) });
        if (u.pathname === `${P}/claude-link/state`) return json(STATE(list));
        if (u.pathname === `${P}/claude-link/view`) return json({ paused: state === 'paused', kinds: [], q: '', rev: 1 });
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      await page.goto(`http://127.0.0.1:${PORT}/?view=terminal&tab=claude-link`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:terminal/tab:claude-link' })).catch((e) => say(`open: ${e}`));
      await page.waitForSelector('[data-axf-toolbar="terminal.claude-link"]', { timeout: 15_000 });
      await sleep(700);
      if (state === 'paused') await page.locator('[data-axf-toolbar="terminal.claude-link"] button', { hasText: /^Pause$/ }).first().click().catch((e) => say(`pause: ${e.message.split('\n')[0]}`));
      if (state === 'filtered') {
        for (const k of ['Error', 'axHub']) await page.locator('[data-axf-toolbar="terminal.claude-link"] .fx-chip', { hasText: new RegExp(`^${k}`) }).first().click().catch((e) => say(`filter: ${e.message.split('\n')[0]}`));
      }
      if (layout === 'dense' && state === 'live') await page.locator('.axp-cl__line', { hasText: 'vps.run' }).first().click().catch(() => undefined); // one row open
      if (layout === 'split') await page.locator('.axp-cl__line', { hasText: 'vps.run' }).first().click().catch(() => undefined);
      // the window fills the screen so the tab reads at full size
      await page.locator('.axp-wt__cap[aria-label="Maximize"]').first().click().catch(() => undefined);
      await sleep(600);
      const file = join(OUT, `claude-link-${layout}-${state}-${device}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      say(`${shot} ${device}: ${file}`);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
