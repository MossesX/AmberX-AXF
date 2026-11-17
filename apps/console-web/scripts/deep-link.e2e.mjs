#!/usr/bin/env node
/**
 * Console deep links on load (src/control/deepLink.ts), end to end (Playwright against `vite preview` of dist/):
 * every page is loaded fresh with `?axf-target=<address>` and must land on that screen (and tab), not the home screen.
 *
 *   node scripts/deep-link.e2e.mjs          (build first: npm run build)
 *   DL_E2E_PORT=7098 · PW_CHROMIUM=<chromium path> · DL_E2E_SHOTS=<dir> (one screenshot per address)
 *
 * Covers: plugin screens (build orchestrator, gate), a tab of a plugin screen (gate › auto-lander), a tab of a built-in
 * screen (settings › plugins), the link in the hash, a slow backend (the plugin list answers late), the link surviving a
 * reload before it landed (sessionStorage, the sign-in round trip), a remote open and console_refresh on an open console
 * (straight to the screen, back on it after the reload), the address bar following the console and a browser refresh
 * landing where it was, and an
 * unknown screen answering with a warning instead of hanging.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.DL_E2E_PORT) || 7098;
const SHOTS = process.env.DL_E2E_SHOTS;

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

// a server already on the port (another run's leftover) would serve a stale dist/: refuse it
try { await fetch(`http://127.0.0.1:${PORT}/`); console.error(`port ${PORT} is already in use (DL_E2E_PORT=<free port>)`); process.exit(2); } catch { /* free */ }
// its own process group, so stopping it also stops the vite child npx starts (it would outlive the run otherwise)
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('exit', stop);

let browser;
/** A fresh tab with the backend mocked offline (admin); `slowMs` holds every API answer back that long. */
async function freshPage(ctx, slowMs = 0) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url());
    if (slowMs) await sleep(slowMs);
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    if (u.pathname === '/api/me') return json(ME);
    if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort().catch(() => {});
    return json({ ok: false, error: 'offline (e2e)' }, 503);
  });
  return { page, errors };
}

/** Wait for the deep link to finish and return where the console is. */
async function landed(page, address) {
  await page.waitForFunction(() => window.axfDeepLink?.done === true, null, { timeout: 45_000 }).catch(async () => {
    throw new Error(`✗ ${address}: the deep link never finished (${JSON.stringify(await page.evaluate(() => ({ link: window.axfDeepLink ?? null, screen: window.axfConsoleControlState?.().screen ?? null })))})`);
  });
  return page.evaluate(() => ({ link: window.axfDeepLink, state: window.axfConsoleControlState(), url: location.href }));
}

const CASES = [
  { address: 'view:build-orchestrator', screen: 'build-orchestrator' },
  { address: 'view:gate', screen: 'gate' },
  { address: 'view:gate/tab:gate.tabs=auto-lander', screen: 'gate', tab: ['view:gate/tab:gate.tabs', 'auto-lander'] },
  // Settings opens as a floating popup over the current screen (Nov 2026): the dialog is up, on the plugins tab
  { address: 'view:settings/tab:settings.tabs=plugins', dialog: 'axf.settings.tab' },
];

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { await sleep(500); } }
  ok(up, `vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  // each address, loaded fresh in its own tab: the focused screen (and tab) is the one asked for
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page, errors } = await freshPage(ctx);
    await page.goto(`http://127.0.0.1:${PORT}/?axf-target=${encodeURIComponent(c.address)}`);
    const r = await landed(page, c.address);
    ok(r.link.answer?.ok, `${c.address}: the link opened (${r.link.answer?.message ?? ''})`);
    if (c.screen) ok(r.state.screen === c.screen, `${c.address}: lands on ${c.screen}, not ${r.state.screen}`);
    if (c.dialog) ok(r.state.dialog === c.dialog, `${c.address}: opens the ${c.dialog} popup (${r.state.screen} ${r.state.dialog ?? 'no dialog'})`);
    if (c.tab) ok(r.state.tabs?.[c.tab[0]] === c.tab[1], `${c.address}: tab ${c.tab[0]} is ${c.tab[1]} (${JSON.stringify(r.state.tabs)})`);
    const here = await page.evaluate(() => window.axfConsoleHere());
    ok(here.startsWith(c.address), `${c.address}: the console is at ${here}`);
    await sleep(600);
    const bar = new URL(await page.evaluate(() => location.href)).searchParams.get('axf-target') ?? '';
    ok(bar.startsWith(c.address), `${c.address}: the address bar keeps where the console is (${bar})`);
    // still there a moment later (no late boot step moved it back home)
    await sleep(1500);
    const later = await page.evaluate(() => window.axfConsoleHere());
    ok(later.startsWith(c.address), `${c.address}: still at ${c.address} after boot settled (${later})`);
    ok(!errors.length, `${c.address}: no page errors (${errors.slice(0, 3).join(' | ')})`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `deep-link-${c.address.replace(/[^a-z0-9]+/gi, '-')}.png`) });
    await ctx.close();
  }

  // the link in the hash query
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const { page } = await freshPage(ctx);
    await page.goto(`http://127.0.0.1:${PORT}/#/?axf-target=${encodeURIComponent('view:build-orchestrator')}`);
    const r = await landed(page, 'hash');
    ok(r.state.screen === 'build-orchestrator', `hash link (phone) lands on build-orchestrator, not ${r.state.screen}`);
    await ctx.close();
  }

  // a slow backend: the plugin list answers 2.5 s late, so the screen registers late
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await freshPage(ctx, 2500);
    await page.goto(`http://127.0.0.1:${PORT}/?axf-target=${encodeURIComponent('view:gate/tab:gate.tabs=auto-lander')}`);
    const r = await landed(page, 'slow');
    ok(r.state.screen === 'gate' && r.state.tabs?.['view:gate/tab:gate.tabs'] === 'auto-lander', `slow backend still lands on gate › auto-lander (${r.state.screen} ${JSON.stringify(r.state.tabs)})`);
    await ctx.close();
  }

  // a reload before it landed (a sign-in round trip in the same tab): the tab's saved copy still lands it
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await freshPage(ctx);
    // the tab's saved copy from a load that never landed (the page went to sign-in first), and a bare URL coming back
    await page.addInitScript(() => { if (!sessionStorage.getItem('e2e.seeded')) { sessionStorage.setItem('e2e.seeded', '1'); sessionStorage.setItem('axf.console.deep-link', 'view:build-orchestrator'); } });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    const r = await landed(page, 'saved');
    ok(r.state.screen === 'build-orchestrator', `the saved link lands after a reload (${r.state.screen})`);
    await sleep(600);
    ok(String(await page.evaluate(() => sessionStorage.getItem('axf.console.deep-link'))).startsWith('view:build-orchestrator'), 'the saved copy follows the screen once it landed');
    await ctx.close();
  }

  // Brett's case (Nov 16 2026): a session opened the orchestrator with no console open, AmberX woke one with
  // ?axf-cmd=<id>, and the queued command reached a cold page before the orchestrator screen had registered. Both
  // shapes a session sends: console_show / console_open with an address (op control) and console_open by name (op open).
  const WAKES = [
    { name: 'console_show view:build-orchestrator', msg: { op: 'control', command: { verb: 'focus', address: 'view:build-orchestrator', by: 'mcp' } }, screen: 'build-orchestrator' },
    { name: 'console_open orchestrator', msg: { op: 'open', kind: 'screen', target: 'build-orchestrator', label: 'Build orchestrator' }, screen: 'build-orchestrator' },
    { name: 'console_show gate › auto-lander', msg: { op: 'control', command: { verb: 'open', address: 'view:gate/tab:gate.tabs=auto-lander', by: 'mcp' } }, screen: 'gate', tab: ['view:gate/tab:gate.tabs', 'auto-lander'] },
  ];
  for (const w of WAKES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const id = `e2e${Math.random().toString(36).slice(2, 8)}`;
    const acks = [];
    let sent = false;
    await page.route('**/api/**', async (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname.includes('/console-commands/stream')) {
        if (sent) return r.abort().catch(() => {});
        sent = true;
        const m = { $axf: 'console-command@1', id, at: new Date().toISOString(), delivery: { how: 'woke' }, by: 'e2e', ...w.msg };
        return r.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(m)}\n\n` }).catch(() => {});
      }
      if (u.pathname.includes('/console-commands/ack')) { try { acks.push(JSON.parse(r.request().postData() ?? '{}')); } catch { /* skip */ } return json({ ok: true }); }
      if (u.pathname.includes('/console-commands/')) return json({ ok: true });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort().catch(() => {});
      return json({ ok: false, error: 'offline (e2e)' }, 503);
    });
    await page.goto(`http://127.0.0.1:${PORT}/?axf-cmd=${id}`);
    const until = Date.now() + 30_000;
    while (Date.now() < until && !acks.some((a) => a.id === id)) await sleep(200);
    const ack = acks.find((a) => a.id === id);
    ok(sent, `${w.name}: the console asked for its queued command`);
    ok(ack, `${w.name}: the console acked the queued command`);
    await sleep(1500);
    const st = await page.evaluate(() => window.axfConsoleControlState());
    ok(ack.ok && st.screen === w.screen, `${w.name}: the woken console shows ${w.screen}, not ${st.screen} (ack: ${ack.ok} ${ack.message})`);
    if (w.tab) ok(st.tabs?.[w.tab[0]] === w.tab[1], `${w.name}: tab is ${w.tab[1]} (${JSON.stringify(st.tabs)})`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `wake-${w.name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
    await ctx.close();
  }

  // Remote open never lands on home (s5): an open console on the orchestrator is sent Gate › Auto-lander and goes
  // straight there (no home screen in between); a remote console_refresh then reloads onto that same screen and tab.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const queue = [];
    const acks = [];
    await page.route('**/api/**', async (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname.includes('/console-commands/stream')) {
        // hold the stream open until a command is queued, then send it (the client reconnects for the next one)
        const until = Date.now() + 20_000;
        while (!queue.length && Date.now() < until) await sleep(100);
        if (!queue.length) return r.abort().catch(() => {});
        const m = { $axf: 'console-command@1', at: new Date().toISOString(), by: 'e2e', ...queue.shift() };
        return r.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(m)}\n\n` }).catch(() => {});
      }
      if (u.pathname.includes('/console-commands/ack')) { try { acks.push(JSON.parse(r.request().postData() ?? '{}')); } catch { /* skip */ } return json({ ok: true }); }
      if (u.pathname.includes('/console-commands/')) return json({ ok: true });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort().catch(() => {});
      return json({ ok: false, error: 'offline (e2e)' }, 503);
    });
    const acked = async (id) => { const until = Date.now() + 30_000; while (Date.now() < until && !acks.some((a) => a.id === id)) await sleep(100); return acks.find((a) => a.id === id); };
    await page.goto(`http://127.0.0.1:${PORT}/?axf-target=${encodeURIComponent('view:build-orchestrator')}`);
    await landed(page, 'warm');
    await page.evaluate(() => {
      window.__seen = [window.axfConsoleControlState().screen];
      setInterval(() => { const s = window.axfConsoleControlState().screen; if (window.__seen[window.__seen.length - 1] !== s) window.__seen.push(s); }, 5);
    });
    queue.push({ id: 'e2e-open-gate', op: 'control', command: { verb: 'open', address: 'view:gate/tab:gate.tabs=auto-lander', by: 'mcp' } });
    const a1 = await acked('e2e-open-gate');
    ok(a1?.ok, `remote open gate › auto-lander acked ok (${a1?.message})`);
    const s1 = await page.evaluate(() => ({ st: window.axfConsoleControlState(), seen: window.__seen }));
    ok(s1.st.screen === 'gate' && s1.st.tabs?.['view:gate/tab:gate.tabs'] === 'auto-lander', `remote open lands on gate › auto-lander (${s1.st.screen} ${JSON.stringify(s1.st.tabs)})`);
    ok(!s1.seen.includes('home'), `remote open goes straight there, never home (${s1.seen.join(' → ')})`);
    queue.push({ id: 'e2e-refresh', op: 'refresh' });
    const nav = page.waitForEvent('framenavigated', { timeout: 30_000 });
    const a2 = await acked('e2e-refresh');
    ok(a2?.ok, `remote refresh acked ok (${a2?.message})`);
    await nav;
    const r = await landed(page, 'refresh');
    ok(r.state.screen === 'gate' && r.state.tabs?.['view:gate/tab:gate.tabs'] === 'auto-lander', `remote refresh reloads onto gate › auto-lander, not home (${r.state.screen} ${JSON.stringify(r.state.tabs)})`);
    await ctx.close();
  }

  // A browser refresh reloads exactly where Brett is (s4, Nov 16 2026): he opens Gate, taps the Auto-lander tab, and
  // the address bar follows; a reload (and a fresh tab on that URL, as after the sign-in round trip) lands back there.
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page, errors } = await freshPage(ctx);
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 45_000 });
    await sleep(800);
    ok(!(await page.evaluate(() => location.search.includes('axf-target'))), `the home screen keeps the bare URL (${await page.evaluate(() => location.href)})`);
    const opened = await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:gate', by: 'e2e' }));
    ok(opened.ok, `opened gate (${opened.message ?? ''})`);
    const tab = page.getByRole('tab', { name: /auto-lander/i }).first();
    await tab.waitFor({ timeout: 30_000 });
    await tab.click();
    await sleep(800);
    const url = await page.evaluate(() => location.href);
    ok(new URL(url).searchParams.get('axf-target') === 'view:gate/tab:gate.tabs=auto-lander', `the address bar follows to gate › auto-lander (${url})`);
    await page.reload();
    const r = await landed(page, 'browser refresh');
    ok(r.state.screen === 'gate' && r.state.tabs?.['view:gate/tab:gate.tabs'] === 'auto-lander', `a browser refresh comes back to gate › auto-lander (${r.state.screen} ${JSON.stringify(r.state.tabs)})`);
    const fresh = await ctx.newPage();
    await fresh.route('**/api/**', (rr) => { const u = new URL(rr.request().url()); if (u.pathname === '/api/me') return rr.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) }); if (u.pathname === '/api/events') return rr.abort().catch(() => {}); return rr.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }); });
    await fresh.goto(url);
    const f = await landed(fresh, 'copied URL');
    ok(f.state.screen === 'gate' && f.state.tabs?.['view:gate/tab:gate.tabs'] === 'auto-lander', `the URL alone (a new tab, the sign-in return) opens gate › auto-lander (${f.state.screen} ${JSON.stringify(f.state.tabs)})`);
    ok(!errors.length, `browser refresh: no page errors (${errors.slice(0, 3).join(' | ')})`);
    await ctx.close();
  }

  // an unknown screen answers (not ok) instead of hanging, and leaves the console usable
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await freshPage(ctx);
    await page.goto(`http://127.0.0.1:${PORT}/?axf-target=${encodeURIComponent('view:no-such-screen-e2e')}`);
    await page.waitForFunction(() => window.axfDeepLink?.done === true, null, { timeout: 60_000 });
    const r = await page.evaluate(() => window.axfDeepLink);
    ok(r.answer && !r.answer.ok, `an unknown screen ends not ok (${JSON.stringify(r.answer)?.slice(0, 200)})`);
    await ctx.close();
  }

  console.log(`✓ deep-link e2e — ${checks} checks (${CASES.map((c) => c.address).join(', ')}, hash, slow backend, reload, wake, remote open + refresh, browser refresh, unknown)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  stop();
}
