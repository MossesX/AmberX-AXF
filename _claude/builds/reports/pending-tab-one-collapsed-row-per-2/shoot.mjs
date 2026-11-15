// Shots of the Pending tab (build pending-tab-one-collapsed-row-per-2): vite preview of the worktree, mocked backend.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const [APP, OUT, PR_MJS] = process.argv.slice(2);
const playwright = createRequire('/tmp/axf-pw-overlay/node_modules/x.js')('playwright');
const PR = await import(PR_MJS);
const PORT = 7193;
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const now = Date.now(); const ago = (h) => new Date(now - h * 3600e3).toISOString();
const steps = (n, done, fable = 1) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, text: ['Read the current tab and map its data', 'Add the pure helper with unit tests', 'Server routes for the expanded state', 'Build the row component on framework controls', 'Wire the tab and remove the old list', 'Phone layout and look checks'][i % 6], model: i < fable ? 'Fable' : 'Opus', estimate: `${8 + (i % 3)} min`, done: i < done, skip: false }));
const mk = (id, title, h, n, done, extra = {}) => ({ row: { id, title, status: 'pending', priority: extra.priority ?? 'Normal', steps: { done, total: n, left: n - done }, needsApproval: !!extra.approval, needsSplit: n === 0, pipeline: extra.pipeline ?? null, said: extra.said ?? '', createdAt: ago(h), updatedAt: ago(h / 2), stepList: steps(n, done), actions: ['archive', 'delete'], nextModel: 'Opus' }, notes: extra.notes ?? [], said: extra.said ?? '' });
const SRC = [
  mk('pending-tab-one-collapsed-row-per-2', 'Pending tab: one collapsed row per build (rebuild)', 0.5, 6, 2, { priority: 'High', said: 'Why are pending builds not 1 expandable row. Wanna just rebuild it', notes: [{ text: 'Phase 1 on Opus: rows, routes, API parity.', at: ago(0.3) }] }),
  mk('grid-token-set-colours-hover-selected', 'Grid token set: colours, hover, selected, lines', 40, 3, 0, { priority: 'High', said: 'Every grid gets its own token set' }),
  mk('orchestrator-stale-row-watchdog-vps', 'Watchdog + watch-rule system (orchestrator, Plan Studio, everything)', 18, 24, 0, { pipeline: { splitRequested: 'x' } }),
  mk('landing-auto-resolves-generated-files-no', 'Landing auto-resolves generated files (no more clashes)', 39, 0, 0),
  mk('amberx-walkthrough-2-hour-indexed', 'AmberX Walkthrough: 2-hour indexed, themeable video tour', 34, 27, 0, { approval: true, priority: 'Low' }),
];
let view = PR.emptyView();
const answer = () => PR.answer(SRC.map((x) => x.row), view, 'brett', { notes: Object.fromEntries(SRC.map((x) => [x.row.id, x.notes])), said: Object.fromEntries(SRC.map((x) => [x.row.id, x.said])) });
const status = () => ({ ok: true, at: new Date().toISOString(), table: { pending: SRC.map((x) => x.row), queued: [], building: [] }, tabs: { pending: SRC.map((x) => x.row), queue: [], active: [], incomplete: [], complete: [], errors: [], archive: [], deleted: [] }, accounts: [], slots: { used: 1, cap: 4, free: 3, queued: 0, unavailable: false }, plan: { launches: [], waits: [], queue: [], idle: null }, settings: { parallelPerAccount: 2, autoQueue: false, splitProvider: 'claude', idleAfterMin: 30, maxRuns: 3, apiOverflow: false }, state: { at: new Date().toISOString(), idle: null, alerts: [], recent: [] } });
const server = spawn('node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch { await sleep(500); } }
const browser = await playwright.chromium.launch();
mkdirSync(OUT, { recursive: true });
const VP = { desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
async function open(form) {
  const page = await browser.newPage(VP[form]);
  page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 200)));
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace('/api/plugins/build-orchestrator/', '');
    const json = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname === '/api/events') return r.abort();
    if (p === 'state') return json({ ok: true, state: { updatedAt: new Date().toISOString(), rules: { sameSession: true, subAgents: false, approveModelSwitch: true, maxStepMinutes: 10 }, builds: [] } });
    if (p === 'pipeline') return json(status());
    if (p === 'groups/tabs') return json({ ok: true, tabs: [] });
    if (p === 'priority') return json({ map: Object.fromEntries(SRC.map((x) => [x.row.id, { priority: x.row.priority === 'High' ? 'P1' : x.row.priority === 'Low' ? 'P3' : 'P2', set: true, waiting: 0 }])) });
    if (p === 'pending/rows') return json(answer());
    let m = /^pending\/rows\/([^/]+)\/(expand|collapse|toggle)$/.exec(p);
    if (m) { view = PR[m[2]](view, 'brett', decodeURIComponent(m[1])); return json(answer()); }
    if (p === 'pending/rows/collapse-all') { view = PR.collapseAll(view, 'brett'); return json(answer()); }
    if (p.startsWith('pipeline/')) return json({ ok: true });
    return json({ ok: false, error: 'offline (shots)' }, 503);
  });
  await page.addInitScript(() => { try { localStorage.setItem('axf.console.orch-tab', JSON.stringify('pending')); } catch {} });
  await page.goto(`${base}#/build-orchestrator`);
  await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30000 });
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate(() => window.axfConsoleControl({ verb: 'press', address: 'function:build-orchestrator.open', value: 'pending' }));
    if (i === 0 || i === 19) console.log('press', JSON.stringify(r).slice(0, 300));
    if (await page.$('.oc-prow')) break;
    await sleep(1000);
  }
  try { await page.waitForSelector('.oc-prow', { timeout: 20000 }); }
  catch (e) { await page.screenshot({ path: join(OUT, `debug-${form}.png`) }); console.log(await page.evaluate(() => [location.href, document.body.innerText.slice(0, 600)].join('\n'))); throw e; }
  await sleep(800);
  return page;
}
const shot = async (page, name, full = false) => { await sleep(500); await page.screenshot({ path: join(OUT, name), fullPage: full }); console.log('shot', name); };
const layout = (page, l) => page.evaluate((v) => document.querySelector('.oc-prows[role="list"]')?.setAttribute('data-layout', v), l);
const scrollTo = (page) => page.evaluate(() => document.querySelector('.oc-prows')?.closest('section')?.scrollIntoView({ block: 'start' }));
for (const form of ['desktop', 'phone']) {
  view = PR.emptyView();
  const page = await open(form);
  await scrollTo(page);
  for (const l of ['one-line', 'compact', 'stacked']) { await layout(page, l); await shot(page, `opt-${l}--collapsed-${form}.png`); }
  await layout(page, 'one-line');
  await page.click('.oc-prow__head >> nth=0');
  await page.waitForSelector('.oc-prow__body');
  await scrollTo(page);
  for (const l of ['one-line', 'compact', 'stacked']) { await layout(page, l); await shot(page, `opt-${l}--expanded-${form}.png`); }
  await page.close();
}
await browser.close();
server.kill('SIGTERM');
process.exit(0);
