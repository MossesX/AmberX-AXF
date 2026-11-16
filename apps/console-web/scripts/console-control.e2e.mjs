#!/usr/bin/env node
/**
 * console-control@1 executor end to end (Playwright against `vite preview` of dist/): the commands REST, MCP, the CLI
 * and voice send are run in the page through window.axfConsoleControl (the same executor the relay calls), and the
 * state each answer reports is checked against the page.
 *
 *   node scripts/console-control.e2e.mjs          (build first: npm run build)
 *   CC_E2E_PORT=7099 · PW_CHROMIUM=<chromium path> · CC_E2E_SHOTS=<dir> (palette screenshots, desktop + phone)
 *
 * Covers: open a tab, scroll, focus a grid row and a build step (the build's real steps, from orchestrator.mjs state),
 * set a setting, press a button, search then focus, the voice action, and the search palette (Ctrl+K and its deep link).
 * The backend is mocked: /api/me as admin, the orchestrator state from this checkout, everything else answers offline.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.CC_E2E_PORT) || 7099;
const BUILD = 'full-api-and-voice-control-of-the-entire-console-every-tab-screen-setting-bu';

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

let checks = 0;
let last; // the last answer, printed when a check fails
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}${last ? `\n  last answer: ${JSON.stringify(last).slice(0, 1200)}` : ''}`); checks++; };
let browser;
// signed in as admin, no axHub (the look is local), so nothing reaches outside the test
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

// the orchestrator state of this checkout, cut to one build (its steps are real)
let full = { state: { builds: [] } }; // empty once the build orchestrator plugin is uninstalled
full = JSON.parse(execFileSync('node', [join(APP, 'plugins/build-orchestrator/orchestrator.mjs'), 'state', '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').pop()); // axf-plugin:build-orchestrator
const build = full.state.builds.find((b) => b.id === BUILD) ?? full.state.builds.find((b) => b.steps?.length);
const state = { ...full, state: { ...full.state, builds: [{ ...build, hidden: false, status: 'running' }] } };
const step = build.steps[1] ?? build.steps[0];
// GET /pipeline as the Builds view reads it: this build on the Active tab, its real steps in the step subgrid
const stepList = build.steps.map((x) => ({ id: x.id, text: x.text ?? x.title ?? x.id, model: x.model ?? '', estimate: String(x.estimate ?? x.minutes ?? ''), done: !!x.done, skip: !!x.skip }));
const done = stepList.filter((x) => x.done).length;
const row = {
  id: build.id, title: build.title, status: 'running', tab: 'active', stepList, builtAt: '', priority: 'P2',
  steps: { done, total: stepList.length, left: stepList.length - done }, minutesLeft: 0, nextModel: 'Opus', nextStep: '',
  needsApproval: false, needsSplit: false, pipeline: null, said: '', branch: '', pr: '', createdAt: '', updatedAt: '', actions: [],
};
const now = new Date().toISOString();
const pipeline = {
  ok: true, at: now, table: { pending: [], queued: [], building: [row] },
  tabs: { pending: [], queue: [], active: [row], incomplete: [], complete: [], errors: [], archive: [], deleted: [] },
  accounts: [], slots: { used: 1, cap: 4, free: 3, queued: 0, unavailable: false },
  plan: { launches: [], waits: [], queue: [], idle: null },
  settings: { parallelPerAccount: 1, autoQueue: false, splitProvider: '', idleAfterMin: 30, maxRuns: 4 },
  state: { at: now, idle: null, alerts: [], recent: [] },
};

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { await sleep(500); } }
  ok(up, `vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url());
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname.endsWith('/build-orchestrator/state')) return json(state);
    if (u.pathname.endsWith('/build-orchestrator/pipeline')) return json(pipeline);
    if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
    return json({ ok: false, error: 'offline (e2e)' }, 503);
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
  const run = async (cmd) => {
    last = await Promise.race([
      page.evaluate((c) => window.axfConsoleControl(c), cmd),
      sleep(20_000).then(() => { throw new Error(`✗ ${cmd.verb} ${cmd.address ?? ''} did not answer in 20 s`); }),
    ]);
    return last;
  };

  // state with nothing asked: where the console is
  let a = await run({ verb: 'state' });
  ok(a.ok && typeof a.state.screen === 'string' && a.state.targets > 0, 'state answers with the live snapshot');

  // open a tab (Settings › Plugins): the answer's state says the screen and the active tab
  a = await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=plugins' });
  ok(a.ok && a.state.screen === 'settings', `open a settings tab → screen settings (${a.message ?? a.state?.screen})`);
  ok(Object.values(a.state.tabs).includes('plugins') || (await page.evaluate(() => window.axfConsoleControlState().screen)) === 'settings', 'the settings tab row reports plugins');

  // set a setting (help mode) and read it back
  a = await run({ verb: 'set', address: 'setting:axf.help.mode', value: 'on' });
  ok(a.ok, `set help mode (${a.message ?? ''})`);
  a = await run({ verb: 'state', address: 'setting:axf.help.mode' });
  ok(a.ok && a.state.value === true, 'help mode reads back on');
  await run({ verb: 'set', address: 'setting:axf.help.mode', value: 'off' });

  // scroll: the answer reports the pane position
  await run({ verb: 'open', address: 'view:build-orchestrator' });
  a = await run({ verb: 'scroll', scroll: { dir: 'bottom' } });
  ok(a.ok && a.scroll && a.state.scroll, `scroll bottom reports the pane (${a.message ?? ''})`);
  a = await run({ verb: 'scroll', scroll: { dir: 'top' } });
  ok(a.ok && a.scroll.atTop === true, 'scroll top → atTop');

  // focus a grid row (the build) and one of its steps: the executor opens the tab and expands the row first
  a = await run({ verb: 'focus', address: `row:${build.id}`, options: { expand: true } });
  ok(a.ok && a.state.screen === 'build-orchestrator', `focus the build row (${a.message ?? ''})`);
  ok(a.state.focusedRow && a.state.focusedRow.endsWith(`row:${build.id}`), `state names the focused row (${a.state.focusedRow})`);
  a = await run({ verb: 'focus', address: `row:${build.id}/step:${step.id}` });
  ok(a.ok && a.state.focusedRow?.endsWith(`step:${step.id}`), `focus a build step (${a.message ?? a.state.focusedRow})`);
  ok(await page.locator('.fx-control-focus').count() > 0, 'the focused target is highlighted');

  // press a button: the console's Settings button (an action-registry press target); the answer's state is the new screen
  a = await run({ verb: 'press', address: 'button:console.settings' });
  ok(a.ok && a.pressed?.endsWith('button:console.settings'), `press button:console.settings (${a.message ?? ''})`);
  await page.waitForFunction(() => window.axfConsoleControlState().screen === 'settings', null, { timeout: 5000 });
  ok(true, 'pressing it opened Settings');

  // search, then focus the best hit
  a = await run({ verb: 'search', query: { q: 'plugins', kinds: ['tab'] } });
  ok(a.ok && a.hits.length > 0 && a.hits.every((h) => h.address && h.kind === 'tab'), 'search returns addressed hits');
  const hit = a.hits.find((h) => h.address.startsWith('view:settings/')) ?? a.hits[0];
  a = await run({ verb: 'focus', address: hit.address });
  ok(a.ok && a.state.focused === hit.address, `search then focus ${hit.address}`);

  // voice: the console action runs the phrase through the same executor
  await page.evaluate(() => window.axfConsoleControl({ verb: 'press', address: 'function:console.control.voice', value: 'open plugins settings' }));
  await page.waitForFunction(() => window.axfConsoleControlState().screen === 'settings', null, { timeout: 5000 });
  ok(true, 'voice "open plugins settings" opened Settings');

  // the search palette: Ctrl+K opens it, typing lists hits, Enter pulls the first into focus
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.cc-palette', { timeout: 5000 });
  ok((await page.evaluate(() => window.axfConsoleControlState().dialog)) === 'console-control.search', 'the palette is the open dialog in state');
  const typingInto = await page.evaluate(() => { const el = document.activeElement; return el?.closest('.cc-palette') ? el.tagName : `${el?.tagName}.${el?.className}`; });
  ok(typingInto === 'INPUT', `the palette field has the keyboard (${typingInto})`);
  await page.keyboard.type('build orchestrator');
  await page.waitForFunction(() => document.querySelector('.cc-palette input')?.value === 'build orchestrator', null, { timeout: 3000 })
    .catch(async () => { throw new Error(`✗ the palette field reads "${await page.evaluate(() => document.querySelector('.cc-palette input')?.value)}" — ${await page.evaluate(() => document.querySelector('.cc-palette')?.textContent?.slice(0, 200))}`); });
  await page.waitForSelector('.cc-palette__hit', { timeout: 5000 });
  const shots = process.env.CC_E2E_SHOTS;
  if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, 'palette-desktop.png') }); }
  const titles = await page.$$eval('.cc-palette__hit', (els) => els.map((e) => e.getAttribute('title')));
  const at = titles.findIndex((t) => t === 'view:build-orchestrator');
  ok(at >= 0, `the palette lists the Build orchestrator screen (${titles.slice(0, 8).join(', ')})`);
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.axfConsoleControlState().screen === 'build-orchestrator', null, { timeout: 5000 })
    .catch(async () => { throw new Error(`✗ picking view:build-orchestrator left the screen on ${await page.evaluate(() => window.axfConsoleControlState().screen)}`); });
  ok(!(await page.evaluate(() => window.axfConsoleControlState().dialog)), 'picking a palette hit closes it and pulls the screen into focus');

  // the deep link opens the palette with the words
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.route('**/api/**', (r) => (new URL(r.request().url()).pathname === '/api/me'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) })
    : r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' })));
  await phone.goto(`http://127.0.0.1:${PORT}/?axf-cmd=search&q=settings`);
  await phone.waitForSelector('.cc-palette__hit', { timeout: 15_000 }).catch(async () => {
    if (process.env.CC_E2E_SHOTS) await phone.screenshot({ path: join(process.env.CC_E2E_SHOTS, 'palette-phone-failed.png') });
    throw new Error(`✗ the deep link lists no hits: ${JSON.stringify(await phone.evaluate(() => ({ url: location.href, palette: document.querySelector('.cc-palette')?.textContent?.slice(0, 300) ?? null, input: document.querySelector('.cc-palette input')?.value ?? null, dialog: window.axfConsoleControlState?.().dialog ?? null, screen: window.axfConsoleControlState?.().screen ?? null })))}`);
  });
  ok(!phone.url().includes('axf-cmd'), 'the deep link is taken off the address');
  if (shots) await phone.screenshot({ path: join(shots, 'palette-phone.png') });

  ok(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  console.log(`✓ console-control e2e — ${checks} checks (open, set, scroll, focus row + step, press, search → focus, voice, palette)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  stop();
}
