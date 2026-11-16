#!/usr/bin/env node
/**
 * Grid column alignment check (Playwright against `vite preview` of dist/): every DataGrid's header cells and the
 * matching cell in every row must share their left and right edges (within 1px), in 1-row and 2-row mode, under the
 * default look and every framework skin, on desktop and phone.
 *
 *   node scripts/grid-align.mjs                 (build first: npm run build)
 *   GRID_ALIGN_PORT=7097 · PW_CHROMIUM=<chromium path> · PLAYWRIGHT_DIR=<dir with playwright>
 *   GRID_ALIGN_SHOTS=<dir>      also save a screenshot of every case (<skin>-<rows>row-<viewport>-<tab>.png)
 *   GRID_ALIGN_SKINS=a,b        only these skins ('default' = no skin); default: default + every framework/assets/skin
 *   GRID_ALIGN_TABS=pending,…   only these orchestrator tabs; default: every build tab plus All builds
 *   GRID_ALIGN_ROWS=1,2         row modes; default both
 *   GRID_ALIGN_VIEWPORTS=desktop,phone
 *   GRID_ALIGN_VIEWS=a,b        other console views with a DataGrid (measured with whatever data they show offline)
 *
 * The backend is mocked: /api/me as admin, axHub's data server on the same origin (the shared appearance document
 * answers 404 = defaults; this app's app-look@1 document has Use skin on with the skin under test, which is how a skin
 * reaches the console), the orchestrator state and GET /pipeline built from this checkout's builds (long and short
 * titles in every tab), everything else offline. Row mode is switched the way REST / MCP / CLI / voice switch it:
 * window.axfConsoleControl `set setting:axf.grid.rowLines`. Exit 1 when any edge is off by more than 1px.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.GRID_ALIGN_PORT) || 7097;
const SHOTS = process.env.GRID_ALIGN_SHOTS || '';
const TOLERANCE = 1;
const list = (v, dflt) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : dflt);

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

const SKINS = list(process.env.GRID_ALIGN_SKINS, ['default', ...readdirSync(join(ROOT, 'framework/assets/skin')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()]);
const PIPELINE_TABS = ['pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted'];
const TABS = list(process.env.GRID_ALIGN_TABS, [...PIPELINE_TABS, 'builds']);
const ROWS = list(process.env.GRID_ALIGN_ROWS, ['1', '2']).map(Number);
const VIEWPORTS = { desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const VIEWS = list(process.env.GRID_ALIGN_VIEWS, ['builds', 'feature-matrix', 'shipped-features', 'ui-review', 'chat-viewer', 'agent-swarm']);
const VPS = list(process.env.GRID_ALIGN_VIEWPORTS, Object.keys(VIEWPORTS));

// ---- mocked backend: this checkout's builds, spread over every tab (titles long and short, real steps) ----
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ME = { wall: false, hub: ORIGIN, appearanceHub: ORIGIN, user: null, admin: true, role: 'admin', themes: true, plugins: [] };
let skinUnderTest = 'default';
const appLook = () => ({ $axf: 'app-look@1', app: 'axf-console', default: {}, own: {}, skin: { use: skinUnderTest !== 'default', inherit: false, id: skinUnderTest === 'default' ? '' : skinUnderTest, overrides: {} }, scopes: {}, undo: null });
// the orchestrator's state as the console reads it; a checkout without it (CI) reads the synced store snapshot
let full;
try { full = JSON.parse(execFileSync('node', [join(APP, 'plugins/build-orchestrator/orchestrator.mjs'), 'state', '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop()); } catch { full = null; }
if (!full?.state?.builds?.length) {
  const store = JSON.parse(readFileSync(join(ROOT, '_claude/builds/store.json'), 'utf8'));
  const builds = Array.isArray(store.builds) ? store.builds : Object.values(store.builds ?? {});
  full = { ok: true, state: { $axf: 'orchestrator@1', updatedAt: new Date().toISOString(), rules: {}, builds } };
}
const withSteps = full.state.builds.filter((b) => b.steps?.length && !b.deleted);
const byLen = [...withSteps].sort((a, b) => b.title.length - a.title.length);
// per tab: the two longest titles, two short ones and a few in between, so rows with very different content sit together
const pickFor = (i) => [byLen[i * 2], byLen[i * 2 + 1], byLen[byLen.length - 1 - i * 2], byLen[byLen.length - 2 - i * 2], ...withSteps.slice(i * 5, i * 5 + 5)].filter(Boolean);
const stateBuilds = full.state.builds.slice(0, 120).map((b) => ({ ...b, hidden: false }));
const state = { ...full, state: { ...full.state, builds: stateBuilds } };
const now = new Date().toISOString();
const STATUS = { pending: 'pending', queue: 'queued', active: 'running', incomplete: 'waiting', complete: 'built', errors: 'failed', archive: 'archived', deleted: 'pending' };
const rowOf = (b, tab, n) => {
  const stepList = b.steps.map((x) => ({ id: x.id, text: x.text ?? x.title ?? x.id, model: x.model ?? 'Opus', estimate: String(x.estimate ?? ''), done: !!x.done, skip: !!x.skip }));
  const done = stepList.filter((x) => x.done).length;
  return {
    id: b.id, title: b.title, status: STATUS[tab], tab, stepList, builtAt: tab === 'complete' ? now : '', priority: 'P2', said: '',
    steps: { done, total: stepList.length, left: stepList.length - done }, minutesLeft: 0, nextModel: n % 3 ? 'Opus' : 'Fable', nextStep: stepList.find((x) => !x.done)?.id ?? '',
    needsApproval: false, needsSplit: false, branch: '', pr: tab === 'complete' || tab === 'archive' ? String(700 + n) : '', createdAt: now, updatedAt: now,
    pipeline: n % 2 ? { account: 'mossesx-max-', model: n % 3 ? 'Opus' : 'Fable', queuedAt: now } : null,
    actions: tab === 'pending' || tab === 'queue' ? ['hold', 'archive'] : [], held: tab === 'pending' && n === 3, deleted: tab === 'deleted',
  };
};
const tabs = Object.fromEntries(PIPELINE_TABS.map((t, i) => [t, pickFor(i).map((b, n) => rowOf(b, t, n))]));
const pipeline = {
  ok: true, at: now, table: { pending: tabs.pending, queued: tabs.queue, building: tabs.active }, tabs,
  accounts: [], slots: { used: 1, cap: 4, free: 3, queued: 0, unavailable: false },
  plan: { launches: [], waits: [], queue: [], idle: null },
  settings: { parallelPerAccount: 1, autoQueue: false, splitProvider: '', idleAfterMin: 30, maxRuns: 4 },
  state: { at: now, idle: null, alerts: [], recent: [] },
};

// ---- measuring: one grid at a time, its own header against its own rows (nested grids are measured as grids too) ----
function measure() {
  const out = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (const grid of document.querySelectorAll('.axf-grid')) {
    if (!visible(grid)) continue;
    const id = grid.getAttribute('data-axf-grid') ?? '?';
    const own = (sel) => [...grid.querySelectorAll(sel)].filter((el) => el.closest('.axf-grid') === grid);
    const head = own('.axf-grid-head')[0];
    if (!head) continue;
    const hcells = own('.axf-grid-head [role=columnheader]');
    const rows = own('.axf-grid-row');
    const bad = [];
    let pairs = 0;
    // every header cell sits inside the header and none overlaps another on the same line (a cell auto-placed into the
    // wrong track moves the header and the rows together, so the pairs alone would not see it)
    const hb = head.getBoundingClientRect();
    const hr = hcells.map((c) => c.getBoundingClientRect());
    hr.forEach((r, i) => {
      if (r.left < hb.left - 1 || r.right > hb.right + 1) bad.push({ header: hcells[i].textContent?.trim() || `#${i}`, what: 'outside the header' });
      hr.forEach((o, j) => { if (j > i && Math.abs(o.top - r.top) < 2 && o.left < r.right - 1 && r.left < o.right - 1) bad.push({ header: hcells[i].textContent?.trim() || `#${i}`, what: `overlaps ${hcells[j].textContent?.trim() || `#${j}`}` }); });
    });
    for (const row of rows) {
      const cells = [...row.querySelectorAll('[role=gridcell]')].filter((el) => el.closest('.axf-grid-row') === row);
      if (cells.length !== hcells.length) { bad.push({ row: row.getAttribute('data-axf-row'), what: `${cells.length} cells under ${hcells.length} headers` }); continue; }
      cells.forEach((c, i) => {
        const h = hcells[i].getBoundingClientRect(), r = c.getBoundingClientRect();
        pairs++;
        const dl = Math.abs(h.left - r.left), dr = Math.abs(h.right - r.right);
        if (dl > 1 || dr > 1) bad.push({ row: row.getAttribute('data-axf-row'), col: hcells[i].textContent?.trim() || `#${i}`, left: +(r.left - h.left).toFixed(1), right: +(r.right - h.right).toFixed(1) });
      });
    }
    out.push({ id, rows: rows.length, pairs, mode: grid.getAttribute('data-axf-row-lines') ?? '1', template: getComputedStyle(grid).gridTemplateColumns, bad });
  }
  return out;
}

// its own process group, so stopping it stops vite too (killing npx alone leaves vite holding the port)
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch { /* gone */ } } };
process.on('exit', stop);

const failures = [];
const notes = [];
let cases = 0, pairsTotal = 0;
const prints = new Map();
let browser;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { await sleep(500); } }
  if (!up) throw new Error(`vite preview on :${PORT} did not start (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const vp of VPS) {
    const ctx = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(/\/data-events/, (r) => r.abort());
    await page.route(/\/(api|data)\//, (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname === '/data/shared/settings/appearance.json') return json({ error: 'not found' }, 404);
      if (u.pathname === '/data/shared/settings/looks/axf-console.json') return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Data-Version': `v-${skinUnderTest}` }, body: JSON.stringify(appLook()) });
      if (u.pathname.endsWith('/build-orchestrator/state')) return json(state);
      if (u.pathname.endsWith('/build-orchestrator/pipeline')) return json(pipeline);
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return json({ ok: false, error: 'offline (grid-align)' }, 503);
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => Promise.race([page.evaluate((c) => window.axfConsoleControl(c), cmd), sleep(20_000).then(() => ({ ok: false, message: 'no answer in 20 s' }))]);
    for (const skin of SKINS) {
      skinUnderTest = skin;
      await page.reload();
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      await page.waitForTimeout(800);
      // proof the skin is drawn: its tokens differ from the default look's
      const fingerprint = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return ['--fx-bg', '--fx-surface', '--fx-accent', '--fx-font-size', '--fx-space', '--fx-radius-md', '--fx-font'].map((k) => cs.getPropertyValue(k).trim()).join('|'); });
      let print = await fingerprint();
      for (let i = 0; i < 24 && skin !== 'default' && print === prints.get(vp); i++) { await page.waitForTimeout(250); print = await fingerprint(); }
      if (skin === 'default') prints.set(vp, print);
      else if (print === prints.get(vp)) failures.push(`${vp} · skin ${skin}: not applied (the tokens equal the default look's)`);
      for (const rows of ROWS) {
        const m = await run({ verb: 'set', address: 'setting:axf.grid.rowLines', value: rows });
        if (!m.ok) {
          const what = `${vp} · ${skin} · ${rows}-row: row mode can't be set (${m.code ?? ''} ${m.message ?? ''})`.trim();
          if (rows !== 1) { failures.push(what); continue; }
          notes.push(`${what}; measuring the default (1 row)`);
        }
        for (const tab of TABS) {
          await run({ verb: 'open', address: 'view:build-orchestrator' });
          let o = { ok: false };
          for (let i = 0; i < 20 && !o.ok; i++) { o = await run({ verb: 'open', address: `view:build-orchestrator/tab:build-orchestrator.tabs=${tab}` }); if (!o.ok) await page.waitForTimeout(250); }
          if (!o.ok) { failures.push(`${vp} · ${tab}: can't open (${o.message ?? o.code})`); continue; }
          await page.waitForTimeout(500);
          // open the first row so its steps sub-grid is measured too
          const first = page.locator('.axf-grid-row').first();
          if (await first.count()) { await first.click({ position: { x: 4, y: 4 } }).catch(() => {}); await page.waitForTimeout(300); }
          const grids = await page.evaluate(measure);
          cases++;
          const label = `${vp} · ${skin} · ${rows}-row · ${tab}`;
          // the API reads back what the screen draws: the grid's state has the row mode and the resolved column template
          if (PIPELINE_TABS.includes(tab) && grids.some((g) => g.id === `build-orchestrator.${tab}`)) {
            const st = await run({ verb: 'state', address: `grid:build-orchestrator.${tab}` });
            const got = st.state ?? st.target?.state ?? st;
            if (!st.ok || got.rowLines !== rows || typeof got.template !== 'string') failures.push(`${label}: state grid:build-orchestrator.${tab} answered ${JSON.stringify(st).slice(0, 300)}`);
          }
          if (!grids.length) notes.push(`${label}: no grid on screen`);
          for (const g of grids) {
            pairsTotal += g.pairs;
            if (g.rows && String(rows) !== g.mode) failures.push(`${label} · grid ${g.id}: asked for ${rows} line(s) per row, drew ${g.mode}`);
            if (g.bad.length) failures.push(`${label} · grid ${g.id}: ${g.bad.length} misaligned cell(s) of ${g.pairs}, e.g. ${g.bad.slice(0, 3).map((b) => JSON.stringify(b)).join(' ')}`);
          }
          if (SHOTS) await page.screenshot({ path: join(SHOTS, `${skin}-${rows}row-${vp}-${tab}.png`), fullPage: false });
        }
        // every other console view that draws a DataGrid (offline data: whatever rows it has are measured)
        for (const view of VIEWS) {
          const o = await run({ verb: 'open', address: `view:${view}` });
          if (!o.ok) { notes.push(`${vp} · view ${view}: not installed here (${o.code ?? o.message})`); continue; }
          await page.waitForTimeout(600);
          const grids = await page.evaluate(measure);
          cases++;
          const label = `${vp} · ${skin} · ${rows}-row · view ${view}`;
          for (const g of grids) {
            pairsTotal += g.pairs;
            if (g.rows && String(rows) !== g.mode) failures.push(`${label} · grid ${g.id}: asked for ${rows} line(s) per row, drew ${g.mode}`);
            if (g.bad.length) failures.push(`${label} · grid ${g.id}: ${g.bad.length} misaligned cell(s) of ${g.pairs}, e.g. ${g.bad.slice(0, 3).map((b) => JSON.stringify(b)).join(' ')}`);
          }
          if (SHOTS && grids.length) await page.screenshot({ path: join(SHOTS, `${skin}-${rows}row-${vp}-view-${view}.png`), fullPage: false });
        }
      }
    }
    if (errors.length) failures.push(`${vp}: page errors: ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
} catch (e) {
  failures.push(`harness: ${e.message}`);
} finally {
  await browser?.close();
  stop();
}
for (const n of notes) console.log(`· ${n}`);
console.log(`grid-align: ${cases} case(s), ${pairsTotal} header/cell pairs measured, ${failures.length} failure(s)`);
for (const f of failures) { console.log(`✗ ${f}`); if (process.env.GITHUB_ACTIONS) console.log(`::error title=Grid alignment::${f}`); }
process.exit(failures.length ? 1 : 0);
