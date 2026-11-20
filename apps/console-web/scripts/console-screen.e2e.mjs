#!/usr/bin/env node
/**
 * console-screen@1 driver end to end (Playwright against `vite preview` of dist/): the commands the voice MCP tools
 * send (console_click, console_right_click, console_context_menu, console_menu, console_expand, console_type,
 * console_key, console_scroll) are run in the page through window.axfConsoleScreen (the same driver the relay calls)
 * on the Build orchestrator, and what each answer reports is checked against the page.
 *
 *   node scripts/console-screen.e2e.mjs          (build first: npm run build)
 *   CS_E2E_PORT=7391 · PW_CHROMIUM=<chromium path> · CS_E2E_DEBUG=1 (print each answer)
 *
 * The backend is mocked: /api/me as admin, the builds table of this checkout cut to a few builds, everything else
 * answers offline.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.CS_E2E_PORT) || 7391;
const DEBUG = !!process.env.CS_E2E_DEBUG;

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

let checks = 0;
let last;
const brief = (a) => JSON.stringify({ ...a, elements: a?.elements ? `[${a.elements.length}]` : undefined }).slice(0, 1500);
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}${last ? `\n  last answer: ${brief(last)}` : ''}`); checks++; };
let browser;
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
// the builds table of this checkout (the same JSON GET …/build-orchestrator/table serves), cut to a few builds with steps
let rows = [];
try {
  const all = JSON.parse(execFileSync('node', [join(APP, 'plugins/build-orchestrator/status-table.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').pop()); // axf-plugin:build-orchestrator
  rows = (all.rows ?? []).filter((r) => r.steps?.length && r.title).slice(0, 3);
} catch { /* the build orchestrator plugin is uninstalled: the fixture rows below */ }
if (rows.length < 2) {
  const at = new Date().toISOString();
  const step = (id, title) => ({ id, title, status: 'building', attempt: 0, model: 'Fable', account: '', slot: '', prNumber: 0, at, by: 'orchestrator' });
  rows = [['voice-console-control', 'Voice console control'], ['skin-gallery-fixes', 'Skin gallery fixes']].map(([id, title]) => ({ id, title, status: 'building', attempt: 0, steps: [step('s1', 'First step'), step('s2', 'Second step')], at, by: 'orchestrator' }));
}
const TABLE = { ok: true, rev: 1, updatedAt: new Date().toISOString(), profile: 'all', rows };
/** A few words of a build's title, as Brett would say them. */
const wordsOf = (title) => title.replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(' ').toLowerCase();

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
// --strictPort: a port someone else holds ends our server at once (never test another checkout's build by mistake)
let exited = false;
server.on('exit', () => { exited = true; });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { await sleep(500); } }
  ok(up, `vite preview on :${PORT} (is dist/ built?)`);
  ok(!exited, `port ${PORT} is free for this checkout's preview (set CS_E2E_PORT)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url());
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname === '/api/plugins/build-orchestrator/table') return json(u.searchParams.get('since') === String(TABLE.rev) ? { ok: true, unchanged: true, rev: TABLE.rev } : TABLE); // axf-plugin:build-orchestrator
    if (r.request().method() === 'GET' && (u.pathname === '/api/events' || u.pathname.endsWith('/stream'))) return r.abort();
    return json({ ok: false, error: 'offline (e2e)' }, 503);
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => typeof window.axfConsoleScreen === 'function' && typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
  const drive = async (cmd) => {
    last = await Promise.race([
      page.evaluate((c) => window.axfConsoleScreen(c), cmd),
      sleep(25_000).then(() => { throw new Error(`✗ ${cmd.action} ${cmd.target ?? cmd.path ?? ''} did not answer in 25 s`); }),
    ]);
    if (DEBUG) console.log(cmd, '→', brief(last));
    return last;
  };
  const control = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);

  // ---- the map of the Build orchestrator
  let c = await control({ verb: 'open', address: 'view:build-orchestrator' });
  ok(c.ok, `the Build orchestrator opens (${c.message ?? ''})`);
  await page.waitForSelector('[data-axf-row]', { timeout: 20_000 });
  let a = await drive({ action: 'map' });
  ok(a.ok && a.elements.length > 10, `the map lists the screen's interactive elements (${a.elements?.length})`);
  ok(a.elements.every((e, i) => e.n === i + 1 && e.label && e.kind && e.box), 'numbered from 1, each with words, a kind and a box');
  const seen = a.elements.filter((e) => e.visible);
  ok(seen.every((e) => e.box.x < 1400 * a.viewport.scale + 1 && e.box.y < 900 * a.viewport.scale + 1), 'visible boxes sit inside the screenshot');
  ok(seen.slice(1).every((e, i) => e.box.y + e.box.h / 2 >= seen[i].box.y - seen[i].box.h), 'visible elements read top to bottom');
  const mapRows = a.elements.filter((e) => e.kind === 'row');
  ok(mapRows.length >= 2 && mapRows.some((e) => e.label.includes(rows[0].title.slice(0, 20))), `grid rows are listed with their text (${mapRows.map((e) => e.label).join(' | ').slice(0, 200)})`);
  ok(mapRows.every((e) => e.state?.expanded === false), 'rows say they are collapsed');
  ok(a.elements.some((e) => e.kind === 'menu' && e.group === 'app menu') && a.elements.some((e) => e.kind === 'select') && a.elements.some((e) => (e.group ?? '').startsWith('toolbar')),
    'app-menu buttons, dropdowns and toolbar buttons are listed, each with where it sits');
  ok(a.elements.some((e) => e.kind === 'button' && e.state?.disabled), 'a disabled button says so');
  ok(a.elements.some((e) => e.address?.startsWith('view:build-orchestrator/') || e.address?.includes('grid:')), 'elements the control registry knows carry their console-control address');

  // ---- expand / collapse a row, by position and by words
  a = await drive({ action: 'expand', target: 'row 1' });
  ok(a.ok && /^expanded /.test(a.did), `expand row 1 (${a.message ?? a.did})`);
  ok(a.elements.find((e) => e.kind === 'row')?.state?.expanded === true, 'the new map says the row is expanded');
  ok(await page.locator('.axf-grid-detail').count() >= 1, 'the row\'s detail is on the page');
  a = await drive({ action: 'expand', target: 'row 1' });
  ok(a.ok && a.did.includes('already expanded'), 'expanding an expanded row changes nothing and says so');
  a = await drive({ action: 'collapse', target: wordsOf(rows[0].title) });
  ok(a.ok && /^collapsed /.test(a.did) && (await page.locator('.axf-grid-detail').count()) === 0, `collapse by the row's words (${a.message ?? a.did})`);
  const slip = wordsOf(rows[0].title).replace(/([a-z]{5,})/, (w) => w.slice(0, 2) + w.slice(3)); // one letter dropped from a long word
  a = await drive({ action: 'expand', target: slip });
  ok(a.ok && /^expanded /.test(a.did), `a transcription slip ("${slip}") still finds the row (${a.message ?? a.did})`);
  await drive({ action: 'collapse', target: 'row 1' });

  // ---- right-click a row: its context menu opens and its items come back numbered
  a = await drive({ action: 'right_click', target: 'row 2' });
  ok(a.ok && a.menu === true, `right-click row 2 opens its context menu (${a.message ?? a.did})`);
  let items = a.elements.filter((e) => e.kind === 'menuitem');
  ok(items.length >= 1, `the menu's items are in the map (${items.map((e) => e.label).join(', ')})`);
  ok(await page.locator('.fx-ctx').count() === 1, 'the context menu is on the page');
  a = await drive({ action: 'key', keys: 'Escape' });
  ok(a.ok && a.did === 'pressed Escape', 'Escape is pressed');
  // right-click anywhere by coordinates (the middle of the first row, in screenshot pixels)
  const r1 = mapRows[0].box;
  a = await drive({ action: 'right_click', target: `${Math.round(r1.x + r1.w / 3)},${Math.round(r1.y + r1.h / 2)}` });
  ok(a.ok && a.menu === true, `right-click by coordinates opens the menu of what is there (${a.message ?? a.did})`);
  await page.mouse.click(5, 5);

  // ---- right-click then pick an item in one call
  const pick = items.find((e) => !/delete|remove|stop|merge|kill|archive|cancel/i.test(e.label)) ?? items[0];
  a = await drive({ action: 'context_menu', target: 'row 2', item: pick.label });
  ok(a.ok && a.did.includes('and picked'), `context menu: right-click the row and pick "${pick.label}" (${a.message ?? a.did})`);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  a = await drive({ action: 'context_menu', target: 'row 1', item: 'no such item at all' });
  ok(!a.ok && a.code === 'not_found' && a.menu === true, 'an item the menu does not have: not_found, the menu stays open and is listed');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);

  // ---- several matches, destructive, deciding, coordinates: a probe panel with known buttons
  await page.evaluate(() => {
    const host = document.querySelector('.fx-shell') ?? document.body;
    const box = document.createElement('div');
    box.id = 'cs-probe';
    box.style.cssText = 'position:fixed;left:400px;top:300px;z-index:99999;display:flex;gap:8px;background:Canvas;padding:8px';
    window.csHits = [];
    for (const [id, label] of [['a', 'Zap it'], ['b', 'Zap it'], ['c', 'Delete everything'], ['d', 'Approve'], ['e', 'Plain']]) {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.id = id;
      b.addEventListener('click', () => window.csHits.push(id));
      b.addEventListener('dblclick', () => window.csHits.push(`${id}${id}`));
      box.appendChild(b);
    }
    const input = document.createElement('input');
    input.placeholder = 'Probe field';
    input.addEventListener('input', () => { window.csTyped = input.value; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.csEntered = true; });
    box.appendChild(input);
    host.appendChild(box);
  });
  const hits = () => page.evaluate(() => window.csHits);
  a = await drive({ action: 'click', target: 'zap it' });
  ok(!a.ok && a.code === 'ambiguous' && a.candidates.length === 2 && (await hits()).length === 0, 'two buttons with the same words: the numbered choices, nothing clicked');
  a = await drive({ action: 'click', target: String(a.candidates[1].n) });
  ok(a.ok && JSON.stringify(await hits()) === '["b"]', `a number from the map clicks exactly that one (${a.message ?? a.did})`);
  a = await drive({ action: 'click', target: 'the left zap it button' });
  ok(a.ok && (await hits()).join('') === 'ba', 'a position word breaks the tie');
  a = await drive({ action: 'click', target: 'delete everything' });
  ok(!a.ok && a.code === 'confirmation_required' && (await hits()).join('') === 'ba', 'a control that deletes is not pressed without confirm');
  a = await drive({ action: 'click', target: 'delete everything', confirm: true });
  ok(a.ok && (await hits()).join('') === 'bac', 'with confirm it is pressed');
  a = await drive({ action: 'click', target: 'approve', confirm: true });
  ok(!a.ok && a.code === 'denied' && a.personOnly === true && (await hits()).join('') === 'bac', 'approve is never pressed by a command, confirm or not');
  const plain = a.elements.find((e) => e.label === 'Plain');
  a = await drive({ action: 'click', target: `${Math.round(plain.box.x + plain.box.w / 2)},${Math.round(plain.box.y + plain.box.h / 2)}` });
  ok(a.ok && (await hits()).join('') === 'bace', `a click by x,y in screenshot pixels lands on what is there (${a.message ?? a.did})`);
  a = await drive({ action: 'double_click', target: 'plain' });
  ok(a.ok && (await hits()).slice(-3).join(',') === 'e,e,ee', 'a double-click is two clicks and a dblclick');
  a = await drive({ action: 'click', target: 'nothing called this anywhere' });
  ok(!a.ok && a.code === 'not_found', 'nothing by that name: not_found');

  // ---- type and keys
  a = await drive({ action: 'type', target: 'probe field', text: 'hello there', submit: true });
  ok(a.ok && (await page.evaluate(() => [window.csTyped, window.csEntered])).join('|') === 'hello there|true', `typing into a field by its placeholder, then Enter (${a.message ?? a.did})`);
  ok(a.elements.find((e) => e.label === 'Probe field')?.state?.value === 'hello there', 'the map shows the field\'s value');
  await page.evaluate(() => document.getElementById('cs-probe')?.remove());

  // ---- a tab by its words, the app menu by a path, then back by keys
  const tab = (await drive({ action: 'map' })).elements.find((e) => e.kind === 'tab' && !e.state?.selected && !e.state?.disabled && e.visible);
  if (tab) {
    a = await drive({ action: 'click', target: `${tab.label} tab` });
    ok(a.ok && a.elements.some((e) => e.kind === 'tab' && e.label === tab.label && e.state?.selected), `clicking the "${tab.label}" tab selects it (${a.message ?? a.did})`);
  }
  const menus = (await drive({ action: 'map' })).elements.filter((e) => e.kind === 'menu' && e.group === 'app menu');
  ok(menus.length >= 1, `the app menu's buttons are listed (${menus.map((m) => m.label).join(', ')})`);
  a = await drive({ action: 'click', target: menus[0].label });
  const first = a.elements.find((e) => e.kind === 'menuitem' && !e.state?.disabled && !/delete|remove|reset|clear|stop|sign out|log out/i.test(e.label));
  ok(a.ok && first, `opening the "${menus[0].label}" menu lists its items (${a.elements.filter((e) => e.kind === 'menuitem').map((e) => e.label).slice(0, 8).join(', ')})`);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  a = await drive({ action: 'menu', path: `${menus[0].label} > ${first.label}` });
  ok(a.ok && a.walked.length === 2, `walking "${menus[0].label} > ${first.label}" clicks each in turn (${a.message ?? a.did})`);
  await page.keyboard.press('Escape');
  a = await drive({ action: 'menu', path: 'Settings' });
  ok(a.ok, `"Settings" is found on the screen or inside an app menu (${a.message ?? a.did})`);
  await page.waitForTimeout(400);
  c = await control({ verb: 'state' });
  ok(String(c.state.dialog ?? '').startsWith('axf.settings') || c.state.screen === 'settings', `Settings is open (${c.state.dialog ?? c.state.screen})`);
  a = await drive({ action: 'menu', path: 'Plugins' });
  ok(a.ok, `then its Plugins tab (${a.message ?? a.did})`);
  await page.keyboard.press('Escape');
  a = await drive({ action: 'menu', path: 'No such menu at all > Nothing' });
  ok(!a.ok && a.code === 'not_found', 'a path whose first name is nowhere: not_found, menus closed again');
  ok(await page.locator('[role="menu"] [role^="menuitem"]:visible').count() === 0, 'no menu is left open');

  // ---- scroll
  await control({ verb: 'open', address: 'view:build-orchestrator' });
  a = await drive({ action: 'scroll', dir: 'bottom' });
  ok(a.ok && a.did === 'scrolled bottom', `scroll by direction (${a.message ?? a.did})`);
  a = await drive({ action: 'scroll', dir: 'top' });
  ok(a.ok, 'and back to the top');
  a = await drive({ action: 'fly' });
  ok(!a.ok && a.code === 'invalid', 'an unknown action is refused');

  ok(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  console.log(`✓ console-screen e2e — ${checks} checks (map, expand / collapse, right-click, context menu, numbers, coordinates, confirm, type, keys, tabs, menu path, scroll)`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  stop();
}
