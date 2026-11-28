/**
 * Screenshots of the Build profiles manager (build profile-manager) for UI Review: desktop and phone, against
 * `vite preview` of dist/ with the profile routes answered from a fixed fixture (no VPS, no builds store):
 *   grid      the page: every profile in the grid, one row opened on its builds
 *   view      the profile view dialog
 *   edit      the Edit dialog (name, description, colour, icon)
 *   merge     the Merge dialog
 *   move      the Move builds dialog
 *   confirm   the confirm for taking a profile off the list
 *   cleanup   the cleanup helper with findings
 *   picker    the quick picker (the banner chip's dialog)
 *
 *   node apps/console-web/plugins/build-profiles/shots.mjs <out-dir>     (build the console first: npm run build)
 *   PM_SHOTS_ONLY=grid,view picks scenes · PM_SHOTS_PORT=<port> (default: a free one) · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node shots.mjs <out-dir>'); process.exit(2); }
// a free port of our own unless one is named: other checkouts leave `vite preview` servers on the usual ports
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const PORT = Number(process.env.PM_SHOTS_PORT) || await freePort();
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600000).toISOString();
const files = (id) => Object.fromEntries(['pending', 'plan', 'queue', 'status', 'orchestrator'].map((k) => [k, id === 'main' ? `_claude/builds/${k}.json` : `_claude/builds/profiles/${id}/${k}.json`]));
const profile = (id, name, description, stats, extra = {}) => ({
  id, name, description, catalog: true, createdAt: ago(24 * 30), updatedAt: ago(stats.hours ?? 2), files: files(id),
  counts: { pending: stats.pendingItems, plan: stats.plan ?? 40, queue: stats.queueSteps, orchestrator: stats.builds - stats.complete - stats.archived, tracked: stats.tracked ?? 120 },
  stats: {
    builds: stats.builds, byStatus: { running: stats.running, pending: stats.pending, complete: stats.complete, archived: stats.archived }, running: stats.running, pending: stats.pending,
    complete: stats.complete, archived: stats.archived, attention: stats.attention ?? 0, pendingItems: stats.pendingItems, queueSteps: stats.queueSteps,
    steps: { total: stats.steps, done: stats.done, left: stats.steps - stats.done },
    cost: { spentUsd: stats.spent, leftUsd: stats.left, basis: 'steps', perStepUsd: 1.4 }, lastActivity: ago(stats.hours ?? 2), firstCreated: ago(24 * 30),
  },
  ...extra,
});
const PROFILES = [
  profile('all', 'All builds', 'Every build in one place. The profile the console works on.', { builds: 439, running: 6, pending: 270, complete: 141, archived: 22, attention: 3, pendingItems: 270, queueSteps: 54, steps: 1764, done: 1263, spent: 1842.6, left: 701.4, hours: 0.2, plan: 520 }, { color: 'accent', icon: 'layers' }),
  profile('main', 'Main framework', 'The framework\'s own history: the original paths.', { builds: 96, running: 0, pending: 4, complete: 88, archived: 4, pendingItems: 4, queueSteps: 0, steps: 512, done: 498, spent: 655.2, left: 19.6, hours: 30 }, { base: true, icon: 'home' }),
  profile('skins', 'Skins', 'Skin gallery, skin editor and the colour themes.', { builds: 27, running: 2, pending: 9, complete: 15, archived: 1, attention: 1, pendingItems: 9, queueSteps: 12, steps: 143, done: 96, spent: 131.9, left: 65.8, hours: 3 }, { color: 'success', icon: 'sparkles', copiedFrom: 'all' }),
  profile('test-sandbox', 'Test Sandbox', 'Throwaway builds for trying the pipeline.', { builds: 5, running: 0, pending: 2, complete: 3, archived: 0, pendingItems: 2, queueSteps: 3, steps: 14, done: 9, spent: 11.2, left: 7, hours: 52 }, { color: 'warning', icon: 'zap' }),
  profile('refactor', 'Refactor', 'The refactor-all sweep. Finished; kept for the record.', { builds: 53, running: 0, pending: 0, complete: 50, archived: 3, pendingItems: 0, queueSteps: 0, steps: 310, done: 310, spent: 402.5, left: 0, hours: 24 * 21 }, { color: 'muted', icon: 'hammer', archived: true, archivedAt: ago(24 * 20) }),
];
const REMOVED = [
  profile('breakroom', 'Breakroom', 'Agent swarm builds.', { builds: 5, running: 0, pending: 0, complete: 5, archived: 0, pendingItems: 0, queueSteps: 0, steps: 31, done: 31, spent: 38.4, left: 0, hours: 24 * 22 }, { removedAt: ago(24 * 21), removedBy: 'Brett', mergedInto: 'all' }),
];
const STATE = { ok: true, active: 'all', effective: 'all', dataRoot: '/projects/amberx-axf/_data', profiles: PROFILES, removed: REMOVED };
const build = (id, title, status, steps, stepsDone, extra = {}) => ({ id, title, status, steps, stepsDone, pct: Math.round((stepsDone / steps) * 100), lastActivity: ago(extra.hours ?? 5), costUsd: stepsDone * 1.4, priority: 'Normal', ...extra });
// a PR as the builds store writes it
const prRef = (n) => `#${n}`;
const BUILDS = [
  build('skin-animations', 'Skin animations: swatches, switch ripple, picker fan', 'running', 5, 3, { pr: prRef(913), hours: 0.5 }),
  build('skin-config-panel', 'Skin configuration panel', 'running', 6, 2, { hours: 1, priority: 'Urgent' }),
  build('skin-gallery-phone', 'Skin gallery: phone previews', 'pending', 4, 0, { hours: 9 }),
  build('skin-light-dark', 'Light and dark for every skin', 'complete', 8, 8, { pr: 590, hours: 70 }),
  build('skins-plugin', 'Skins plugin: removable plugin and screen', 'landed', 7, 7, { pr: 647, hours: 120 }),
  build('skin-from-axhub', 'Skin from axHub: override switch', 'failed', 4, 3, { pr: 655, hours: 30 }),
  build('skin-old-picker', 'Old skin picker (replaced)', 'archived', 3, 3, { hours: 300 }),
];
const finding = (kind, id, title, status, to, extra = {}) => ({ kind, id, title, profiles: ['all'], status, fixable: true, to, why: '', evidence: '', ...extra });
const CLEANUP = {
  ok: true,
  findings: [
    finding('archived-complete', 'angel-ui-all-assets', 'Angel: every screen reads the scale tokens', 'archived', 'landed', { evidence: `PR ${prRef(402)} merged, 5 of 5 steps done` }),
    finding('archived-complete', 'big-dog-grid', 'Big Dog: grid rows collapse', 'archived', 'complete', { evidence: '4 of 4 steps done' }),
    finding('archived-complete', 'refactor-all-s35', 'Refactor all: enabled plugins 1/3', 'archived', 'landed', { evidence: `PR ${prRef(377)} merged, 3 of 3 steps done` }),
    finding('archived-complete', 'breakroom-desks', 'Breakroom desks', 'archived', '', { fixable: false, why: 'needs a look: 2 of 5 steps done', evidence: '2 of 5 steps done' }),
    finding('orphan-profile', 'urgent-veto-alarm', 'Veto notice alarm', 'complete', 'main', { profiles: ['urgent'], evidence: 'urgent' }),
  ],
  counts: { 'archived-complete': 4, 'orphan-profile': 1 }, fixable: 4, total: 5,
};
const PENDING = { items: [{ id: 'P-311', title: 'Skin gallery: search by colour', priority: 'P2', status: 'pending' }, { id: 'P-318', title: 'Skin editor: undo history', priority: 'P1', status: 'pending' }, { id: 'P-320', title: 'Colour theme export', priority: 'P3', status: 'pending' }] };
const QUEUE = { order: [{ id: 'skin-animations', title: 'Skin animations', status: 'running' }, { id: 'skin-config-panel', title: 'Skin configuration panel', status: 'running' }, { id: 'skin-gallery-phone', title: 'Skin gallery: phone previews', status: 'queued' }] };
const feature = (id, title, status) => ({ id, title, status });
const PLAN = { features: [feature('x.web.skins', 'Skins', 'built'), feature('x.web.skin-editor', 'Skin editor', 'partial'), feature('x.web.themes', 'Colour themes', 'built')] };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, owner: true, role: 'admin', themes: true, plugins: [] };

/** What each scene presses once the page is up: a row to open, then a button in it (by its name), or an item of
 * the Builds app menu. */
const SCENES = {
  grid: { row: 'Skins' },
  view: { row: 'Skins', button: 'View' },
  edit: { row: 'Skins', button: 'Edit' },
  merge: { row: 'Test Sandbox', button: 'Merge into…' },
  move: { row: 'Skins', button: /^Move/ },
  confirm: { row: 'Test Sandbox', button: 'Take off the list' },
  picker: { menu: 'Build profile…' },
  cleanup: { menu: 'Clean up builds…' },
};

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, detached: true, stdio: process.env.PM_SHOTS_DEBUG ? 'inherit' : 'ignore' });
// npx starts vite as a child: stop the whole group, or a preview server is left behind on every run
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
let exited = null;
server.on('exit', (code) => { exited = code ?? 'signal'; });
process.on('exit', stopServer);
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    if (exited !== null) throw new Error(`vite preview exited (${exited}): is port ${PORT} taken?`);
    try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ }
    if (!up) await sleep(500);
  }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  const say = (m) => process.stderr.write(`${m}\n`);
  for (const scene of (process.env.PM_SHOTS_ONLY || Object.keys(SCENES).join(',')).split(',')) {
    if (!(scene in SCENES)) { say(`unknown scene ${scene}`); continue; }
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      if (process.env.PM_SHOTS_DEBUG) page.on('framenavigated', (f) => say(`  nav: ${f.url()}`));
      if (process.env.PM_SHOTS_DEBUG) page.on('console', (m) => { if (m.type() === 'error') say(`  console: ${m.text().slice(0, 200)}`); });
      // the console's own views read the three lists too and want their full shape: they are answered only once the
      // manager page is up, for the row's Pending, Queue and Plan tabs
      let lists = false;
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const get = r.request().method() === 'GET';
        const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname === '/api/me') return json(ME);
        if (get && u.pathname === '/api/profiles') return json(STATE);
        if (get && u.pathname === '/api/plugins/build-profiles/list') return json(STATE);
        if (get && u.pathname === '/api/plugins/build-profiles/get') {
          const p = [...PROFILES, ...REMOVED].find((x) => x.id === u.searchParams.get('id'));
          return p ? json({ ok: true, profile: p, builds: BUILDS }) : json({ ok: false, error: 'no such profile' }, 404);
        }
        if (get && u.pathname === '/api/plugins/build-profiles/cleanup') return json(CLEANUP);
        if (lists && get && u.pathname === '/api/pending') return json(PENDING);
        if (lists && get && u.pathname === '/api/build-queue') return json(QUEUE);
        if (lists && get && u.pathname === '/api/plan') return json(PLAN);
        if (get && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 90_000 });
      const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
      // a fresh browser profile loads every plugin once to learn its shape: wait until this one is registered
      let known = false;
      for (let i = 0; i < 150 && !known; i++) { known = !!(await run({ verb: 'state', address: 'plugin:ai.amberx.axf.console.build-profiles' })).ok; if (!known) await sleep(1000); }
      if (!known) say(`${scene} ${device}: the plugin never registered`);
      let r;
      for (let i = 0; i < 20; i++) { r = await run({ verb: 'open', address: 'view:build-profiles' }); if (r.ok) break; await sleep(2000); }
      say(`${scene} ${device}: open → ${JSON.stringify(r).slice(0, process.env.PM_SHOTS_DEBUG ? 4000 : 140)}`);
      await page.waitForSelector('.axp-build-profiles__grid', { timeout: 60_000 }).catch((e) => say(`grid: ${e.message.split('\n')[0]}`));
      lists = true;
      const step = SCENES[scene];
      const miss = (what) => (e) => say(`${scene} ${device}: ${what}: ${e.message.split('\n')[0]}`);
      if (step.row) await page.locator('.axp-build-profiles__line', { hasText: step.row }).first().click({ timeout: 8000 }).catch(miss('row'));
      if (step.button) {
        await sleep(600);
        await page.locator('.axp-build-profiles__item', { hasText: step.row }).getByRole('button', { name: step.button }).first().click({ timeout: 8000 }).catch(miss('button'));
      }
      if (step.menu) {
        await page.getByText('Builds', { exact: true }).first().click({ timeout: 8000 }).catch(miss('menu'));
        await page.getByText(step.menu, { exact: true }).first().click({ timeout: 8000 }).catch(miss('menu item'));
      }
      const dialog = !!(step.button || step.menu);
      if (dialog) await page.waitForSelector('[role="dialog"]', { timeout: 20_000 }).catch(miss('dialog'));
      await sleep(1200);
      // the control API marks the screen it opened (a focus ring): not part of the page
      await page.addStyleTag({ content: '.fx-control-focus { animation: none !important; outline: none !important; background-color: transparent !important; }' });
      await sleep(300);
      const file = join(OUT, `profile-manager-${scene}-${device}.png`);
      await page.screenshot({ path: file, fullPage: !mobile && !dialog, timeout: 120_000 });
      shots.push(file);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  stopServer(); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close().catch(() => {}); stopServer(); process.exit(); }
