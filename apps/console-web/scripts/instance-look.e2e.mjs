#!/usr/bin/env node
/**
 * Own look per grid and tab group (instance-look@1): Playwright against the built console, desktop and phone.
 * The Glossary screen has a framework DataGrid (glossary.grid) and a TabGroup (glossary.views). The run drives
 * everything through the same actions REST / MCP / CLI / voice use (window.axfConsoleControl):
 *   1. both follow the skin: no data-fx-inst on either root
 *   2. chrome.look.set gives each its own look: data-fx-inst lists the keys, the computed row / tab colours change,
 *      the grid's column template is unchanged (fixed cell widths)
 *   3. chrome.look.open opens Settings on the Look tab (the deep link)
 *   4. chrome.look.reset puts both back on the skin: the computed colours equal step 1 again; chrome.look.undo restores
 *   5. each option look (theme-manager/assets/instance-look/*) applied to the grid, one shot each (UI Review choices)
 *
 *   node scripts/instance-look.e2e.mjs                  (build first: npm run build; serves dist/ with vite preview)
 *   LOOK_E2E_URL=http://127.0.0.1:7461/ · LOOK_E2E_PORT=7098 · PW_CHROMIUM=<path> · PLAYWRIGHT_DIR=<dir>
 *   LOOK_E2E_SHOTS=<dir>                                (desktop + phone screenshots of each step)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.LOOK_E2E_PORT) || 7098;
const SHOTS = process.env.LOOK_E2E_SHOTS || '';
const OPTIONS_DIR = join(APP, 'plugins/theme-manager/assets/instance-look');

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw', '/tmp/axf-pw-overlay'].filter(Boolean)) { try { playwright = createRequire(join(base, 'node_modules', 'x.js'))('playwright'); break; } catch { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const KINDS = ['term', 'action', 'plugin', 'setting'];
const CATALOG = {
  $axf: 'glossary-catalog@1', generatedAt: '2026-11-17T00:00:00.000Z', hash: 'e2e', kinds: Object.fromEntries(KINDS.map((k) => [k, k[0].toUpperCase() + k.slice(1)])),
  counts: {}, total: 12, generic: 0,
  entries: ['Skin', 'Instance look', 'Tab group', 'Data grid', 'Token', 'Reset to skin', 'Theme manager', 'Console control', 'Deep link', 'Look section', 'Colour theme', 'Style theme']
    .map((term, i) => ({ id: `e2e-${i}`, term, kind: KINDS[i % KINDS.length], category: i % 2 ? 'Look' : 'Framework', summary: `${term}: an entry the own-look run draws in the grid.` })),
};
const GRID = '[data-axf-grid="glossary.grid"]';
const TABS = '[data-axf-tab-group="glossary.views"]';

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };
const options = readdirSync(OPTIONS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(OPTIONS_DIR, f), 'utf8')));

let server = null;
const stop = () => { try { server?.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

let browser;
try {
  let base = process.env.LOOK_E2E_URL;
  if (!base) {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
    base = `http://127.0.0.1:${PORT}/`;
  }
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base)).ok; } catch { await sleep(500); } }
  ok(up, `console at ${base} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const [form, opts] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage(opts);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname.startsWith('/api/plugins/glossary-index/catalog')) return json(CATALOG);
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return json({ ok: false, error: 'offline (e2e)' }, 503);
    });
    await page.goto(base);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function' && document.querySelector('[role="menubar"]'), null, { timeout: 30_000 });
    const control = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
    // a reset deletes the instance's record, so console-control asks for confirm (the same as REST / MCP / voice)
    const press = (id, value) => control({ verb: 'press', address: `function:${id}`, value, ...(/reset/.test(id) ? { confirm: 'yes' } : {}) });
    const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${form}-${name}.png`) }); };
    const look = () => page.evaluate(([g, t]) => {
      const grid = document.querySelector(g), tabs = document.querySelector(t);
      const row = grid?.querySelector('.axf-grid-row'), tab = tabs?.querySelector('.fx-tab.is-active, .fx-tab[aria-selected="true"]');
      return {
        gridInst: grid?.getAttribute('data-fx-inst') ?? null, tabsInst: tabs?.getAttribute('data-fx-inst') ?? null,
        rowBg: row ? getComputedStyle(row).backgroundColor : '', rowFont: row ? getComputedStyle(row).fontSize : '',
        cols: grid ? getComputedStyle(grid).getPropertyValue('--axf-grid-cols') : '', tabBg: tab ? getComputedStyle(tab).backgroundColor : '',
      };
    }, [GRID, TABS]);

    await control({ verb: 'open', address: 'view:glossary-index' });
    await page.waitForSelector(TABS, { timeout: 15_000 });
    await control({ verb: 'set', address: 'tab:glossary.views', value: 'grid' });
    await page.waitForSelector(`${GRID} .axf-grid-row`, { timeout: 15_000 });
    await sleep(400);

    // 1. both follow the skin
    const skin = await look();
    ok(skin.gridInst === null && skin.tabsInst === null, `${form}: grid and tab row follow the skin at first (${JSON.stringify(skin)})`);
    await shot('1-skin');

    // 2. an own look on each
    await press('chrome.look.set', 'grid:glossary.grid:rowBg:surface2');
    await press('chrome.look.set', 'grid:glossary.grid:rowAltBg:surface3');
    await press('chrome.look.set', 'grid:glossary.grid:textSize:sm');
    await press('chrome.look.set', 'grid:glossary.grid:radius:md');
    await press('chrome.look.set', 'tab-group:glossary.views:selectedBg:accentSoft');
    await press('chrome.look.set', 'tab-group:glossary.views:radius:pill');
    await sleep(400);
    const own = await look();
    ok(own.gridInst?.split(' ').sort().join(' ') === 'radius rowAltBg rowBg textSize', `${form}: the grid root lists its own keys (${own.gridInst})`);
    ok(own.tabsInst?.split(' ').sort().join(' ') === 'radius selectedBg', `${form}: the tab row lists its own keys (${own.tabsInst})`);
    ok(own.rowBg !== skin.rowBg, `${form}: the grid's rows restyle (${skin.rowBg} → ${own.rowBg})`);
    ok(own.tabBg !== skin.tabBg, `${form}: the active tab restyles (${skin.tabBg} → ${own.tabBg})`);
    ok(own.cols === skin.cols, `${form}: the column template is unchanged (fixed cell widths)`);
    await shot('2-own-look');
    const refused = await press('chrome.look.set', 'grid:glossary.grid:radius:4px');
    await sleep(200);
    ok((await look()).gridInst === own.gridInst, `${form}: a raw px is refused and changes nothing (${JSON.stringify(refused)})`);

    // 3. the deep link opens Settings on the Look tab
    await press('chrome.look.open', 'grid:glossary.grid');
    await page.waitForSelector('[data-axf-instance-look="grid:glossary.grid"]', { timeout: 10_000 });
    await sleep(300);
    await shot('3-settings-look');
    await page.keyboard.press('Escape');
    await sleep(300);

    // 4. reset to skin, then one undo
    const r1 = await press('chrome.look.reset', 'grid:glossary.grid');
    const r2 = await press('chrome.look.reset', 'tab-group:glossary.views');
    await sleep(400);
    const back = await look();
    ok(back.gridInst === null && back.tabsInst === null && back.rowBg === skin.rowBg && back.tabBg === skin.tabBg, `${form}: Reset to skin returns both to the skin (${JSON.stringify(back)} · ${JSON.stringify(r1)} · ${JSON.stringify(r2)})`);
    await shot('4-reset-to-skin');
    await press('chrome.look.undo', 'grid:glossary.grid');
    await sleep(300);
    ok((await look()).rowBg === own.rowBg, `${form}: one undo brings the grid's look back`);
    await press('chrome.look.reset', 'grid:glossary.grid');

    // 5. the option looks (UI Review choices), applied through Change grid look… (chrome.swap = the picker's move)
    for (const o of options) {
      await press('chrome.swap', `grid:glossary.grid:${o.id}`);
      await sleep(300);
      const l = await look();
      ok(l.gridInst !== null, `${form}: option ${o.id} applies (${l.gridInst})`);
      await shot(`5-option-${o.id}`);
      await press('chrome.look.reset', 'grid:glossary.grid');
    }

    ok(!errors.length, `${form}: no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
    console.log(`✓ ${form}: own look on, deep link, reset to skin, undo, ${options.length} option looks`);
  }
  console.log(`instance-look e2e: ${checks} checks passed`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
