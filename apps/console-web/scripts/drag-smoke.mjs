#!/usr/bin/env node
/**
 * drag-move@1 smoke on the built console (Playwright against `vite preview` of dist/): the requests REST /api/drag/*,
 * the console_drag_* MCP tools, `axf drag` and voice relay to the page are run there through window.axfDrag (the same
 * executor the console-commands relay calls; the REST → relay leg is covered by server/tests/test_drag.py). Each move
 * is checked in the host's order, then again after a reload.
 *
 *   node ../../framework/cli/agent-slots.mjs heavy -- node scripts/drag-smoke.mjs     (build first: npm run build)
 *   DRAG_SMOKE_PORT=7098 · PW_CHROMIUM=<chromium path> · PLAYWRIGHT_DIR=<dir with playwright>
 *
 * Covers: a banner widget moved to another side (order changed, kept after reload), a Builds grid column moved first
 * (kept after reload), a tab moved in a tab host when the screen has one (window tab stacks are per session, so that one
 * is checked without a reload), drag.zones and drag.preview drawing the drop-zone overlay. The backend is mocked: /api/me
 * as admin, this checkout's orchestrator state for one build (the Builds grid), everything else offline.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.DRAG_SMOKE_PORT) || 7098;

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

let checks = 0;
let last;
const notes = [];
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}${last ? `\n  last answer: ${JSON.stringify(last).slice(0, 1200)}` : ''}`); checks++; };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
// the orchestrator state of this checkout, cut to one build (as console-control.e2e.mjs does), so the Builds grid draws
const BUILD = 'drag-anything-by-api-and-voice-follow-up-to-full';
const full = JSON.parse(execFileSync('node', [join(APP, 'plugins/build-orchestrator/orchestrator.mjs'), 'state', '--json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim().split('\n').pop());
const build = full.state.builds.find((b) => b.id === BUILD) ?? full.state.builds.find((b) => b.steps?.length);
const state = { ...full, state: { ...full.state, builds: [{ ...build, hidden: false, status: 'running' }] } };
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
  tabs: { pending: [], queue: [{ ...row, tab: 'queue' }], active: [row], incomplete: [], complete: [], errors: [], archive: [], deleted: [] },
  accounts: [], slots: { used: 1, cap: 4, free: 3, queued: 0, unavailable: false }, plan: { launches: [], waits: [], queue: [], idle: null },
  settings: { parallelPerAccount: 1, autoQueue: false, splitProvider: '', idleAfterMin: 30, maxRuns: 4 }, state: { at: now, idle: null, alerts: [], recent: [] },
};

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
let browser;

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
  const boot = async (path = '/') => {
    await page.goto(`http://127.0.0.1:${PORT}${path}`);
    await page.waitForFunction(() => typeof window.axfDrag === 'function', null, { timeout: 30_000 });
  };
  const run = async (req) => {
    last = await Promise.race([page.evaluate((q) => window.axfDrag(q), req), sleep(20_000).then(() => { throw new Error(`✗ ${req.verb} did not answer in 20 s`); })]);
    return last;
  };
  const host = async (kind, container) => (await run({ verb: 'drag.list', kind, ...(container ? { container } : {}) })).hosts.find((h) => !container || h.container === container) ?? null;
  const waitHost = async (kind, container, ms = 40_000) => { const t = Date.now(); let h = null; while (!(h = await host(kind, container)) && Date.now() - t < ms) await sleep(300); return h; };

  /** The Builds screen (its plugin loads lazily: open until the screen is there), then the build's row. */
  const openBuilds = async () => {
    const t = Date.now();
    let a = null;
    while (Date.now() - t < 30_000) {
      a = await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:build-orchestrator' }));
      if (a?.ok && a.state?.screen === 'build-orchestrator') break;
      await sleep(500);
    }
    ok(a?.state?.screen === 'build-orchestrator', `the Builds screen opens (${a?.message ?? a?.state?.screen})`);
    await page.evaluate((id) => window.axfConsoleControl({ verb: 'focus', address: `row:${id}` }), build.id);
  };

  await boot();
  const list = await run({ verb: 'drag.list' });
  ok(list.ok && list.$axf === 'drag-list@1' && list.kinds.length >= 8, 'drag.list answers the kinds and the hosts');

  // ---- banner widget: to the other end of the banner, kept after a reload
  const banner = await waitHost('banner-widget', 'banner');
  ok(banner && banner.items.length > 0, `the banner is a drag host with widgets (${banner?.items.length ?? 0})`);
  const w = banner.items[0];
  const side = banner.sides[banner.sides.length - 1] === w.side ? banner.sides[0] : banner.sides[banner.sides.length - 1];
  const zones = await run({ verb: 'drag.zones', kind: 'banner-widget', container: 'banner', id: w.id });
  ok(zones.ok && zones.targets.some((t) => t.zone === 'side' && t.side === side), `drag.zones offers the ${side} side for ${w.id}`);
  const pv = await run({ verb: 'drag.preview', command: { kind: 'banner-widget', source: { container: 'banner', id: w.id }, target: { container: 'banner', zone: 'side', side, index: 0 } } });
  ok(pv.ok, 'drag.preview plans the move');
  ok(await page.locator('[data-axf-drag-preview]').count() === 1, 'the preview draws the drop-zone overlay');
  const mv = await run({ verb: 'drag.move', command: { kind: 'banner-widget', source: { container: 'banner', id: w.id }, target: { container: 'banner', zone: 'side', side, index: 0 }, reason: 'smoke' } });
  ok(mv.ok && mv.to.side === side && mv.to.index === 0, `drag.move put ${w.id} first on the ${side}`);
  const after = await host('banner-widget', 'banner');
  ok(after.order[side][0] === w.id, 'the banner order changed');
  await boot();
  const reloaded = await waitHost('banner-widget', 'banner');
  ok(reloaded.order[side]?.[0] === w.id, `the banner order survives a reload (${JSON.stringify(reloaded.order)})`);

  // ---- grid column: first column of a Builds grid moved after the second, kept after a reload
  await openBuilds();
  const findGrid = async () => { const t = Date.now(); while (Date.now() - t < 40_000) { const l = await run({ verb: 'drag.list', kind: 'grid-column' }); const g = l.hosts.find((h) => h.items.filter((i) => !i.locked).length >= 2); if (g) return g; await sleep(300); } return null; };
  const grid = await findGrid();
  if (!grid) last = { hosts: (await run({ verb: 'drag.list' })).hosts.map((h) => `${h.kind}:${h.container}:${h.items.length}:${h.items.filter((i) => i.locked).length}`), errors: errors.slice(0, 5) };
  ok(grid, `a Builds grid is a grid-column host (grids drawn: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-axf-grid]')].map((g) => g.getAttribute('data-axf-grid'))))}, view ${await page.evaluate(() => window.axfConsoleControlState?.().screen)})`);
  const movable = grid.items.filter((i) => !i.locked);
  const [c0, c1] = movable;
  const gm = await run({ verb: 'drag.move', command: { kind: 'grid-column', source: { container: grid.container, id: c0.id }, target: { container: grid.container, zone: 'after', ref: c1.id }, reason: 'smoke' } });
  ok(gm.ok, `drag.move moved column ${c0.id} after ${c1.id}`);
  const gOrder = (await host('grid-column', grid.container)).order;
  ok(gOrder.indexOf(c0.id) === gOrder.indexOf(c1.id) + 1, `the grid's column order changed (${gOrder.join(', ')})`);
  ok(await page.locator(`[data-axf-grid="${grid.container}"] [data-axf-col="${c0.id}"]`).count() === 1, 'the moved column header is drawn');
  await boot();
  await openBuilds();
  const g2 = await waitHost('grid-column', grid.container);
  ok(g2 && g2.order.indexOf(c0.id) === g2.order.indexOf(c1.id) + 1, `the column order survives a reload (${g2?.order.join(', ')})`);

  // ---- a tab: the first tab host on the screen with two tabs or more (no reload: window tab stacks are per session)
  const tabs = (await run({ verb: 'drag.list', kind: 'tab' })).hosts.find((h) => h.items.filter((i) => !i.locked).length >= 2);
  if (tabs) {
    const [t0] = tabs.items;
    const tm = await run({ verb: 'drag.move', command: { kind: 'tab', source: { container: tabs.container, id: t0.id }, target: { container: tabs.container, zone: 'into' }, reason: 'smoke' } });
    ok(tm.ok, `drag.move moved tab ${t0.id} last in ${tabs.container}`);
    const tOrder = (await host('tab', tabs.container)).order;
    ok(tOrder[tOrder.length - 1] === t0.id, 'the tab order changed');
  } else notes.push('no tab host with two tabs on the built console screens (no TabGroup row in the console takes onReorder; window tab stacks open on demand): tab leg skipped, covered by check-drag-hosts.mts');

  // ---- the deep link highlights the item
  const sh = await run({ verb: 'drag.show', kind: 'banner-widget', container: 'banner', id: w.id });
  ok(sh.ok && sh.highlighted && sh.zones > 0, 'drag.show highlights the widget and its drop zones');

  ok(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  console.log(`✓ drag smoke — ${checks} checks (banner widget, grid column${tabs ? ', tab' : ''}; reload)`);
  for (const n of notes) console.log(`  note: ${n}`);
} catch (e) {
  console.error(String(e?.message ?? e));
  if (process.env.DRAG_SMOKE_SHOT) await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: process.env.DRAG_SMOKE_SHOT }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  stop();
}
