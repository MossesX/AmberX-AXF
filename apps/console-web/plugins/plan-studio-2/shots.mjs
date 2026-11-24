#!/usr/bin/env node
/**
 * Screenshots of sent plans in Plan Studio 2.0 for UI Review, desktop and phone, against `vite preview` of dist/ with
 * the plugin's state answered from a fixture made by the real core (web/live-core.mjs liveView over a tree and a list of
 * builds): a plan being built (the orchestrator's steps in every state, marked From orchestrator, the lock), one in CI,
 * one landed, one sent and not split yet, and an unsent plan beside them; the read-only editor of a sent step; the
 * settings panel for how each state looks. Under every sent plan: its build panel (the build number, the state badge
 * and status line, the waiting reason, the split mark, the merge line, a rejected build's clash options, and the steps
 * table), answered per plan from the same fixture (live-core.mjs buildDetail), as GET plans/<planId>/build does.
 *
 *   node apps/console-web/plugins/plan-studio-2/shots.mjs <out-dir>     (build first: npm run build in apps/console-web)
 *   PS2_SHOTS_PORT=7093 · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import * as tc from './web/tree-core.mjs';
import * as live from './web/live-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../..');
const ROOT = join(APP, '../..');
const TAB = 'plan-studio-2';
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.PS2_SHOTS_PORT) || 7093;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

/* ---- the fixture: a tree, and the builds its plans were sent as */
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
let state = tc.emptyState();
const add = (o) => { const r = tc.add(state, o); state = r.state; return r.item.id; };
const plan = (title, body = '') => add({ kind: 'plan', title, body });
const step = (parent, title, o = {}) => add({ kind: 'step', parent, title, ...o });
let uidN = 0;
const bStep = (id, text, status, model, o = {}) => ({ id, uid: `st-mwtx${(uidN++).toString(36)}h8mf${id}`, splitBy: 'vps-fable', ...(model ? { modelBy: 'triage' } : {}), text, status, model, estimate: '10 min', done: ['completed', 'in-pr'].includes(status), statusAt: ago(5), attempt: status === 'failed' ? 2 : 1, ...o });
const SPLIT = { by: 'vps', model: 'claude-fable-5-2', at: ago(80) };
const pv = (state, label, tone, icon, line, o = {}) => ({ state, label, tone, icon, line, attempt: 1, waitingOn: null, ...o });
const build = (id, planRef, status, steps, o = {}) => ({ id, title: id, planRef, flow: live.FLOW, status, steps, ...(steps.length ? { split: { ...SPLIT, stepCount: steps.length } } : {}), profiles: ['all'], createdAt: ago(90), statusAt: ago(4), attempt: 1, ...o });

const building = plan('Plan Studio live progress', 'One store: steps check off in place.');
add({ kind: 'note', parent: building, title: 'Why', body: 'Plan Studio and the orchestrator read the same store.' });
const ci = plan('Console tabs: plugins open in tabs');
const landed = plan('Voice notes: retry a failed upload');
const waiting = plan('Group chat audio');
step(waiting, 'Hear agents talk while typing'); step(waiting, 'Mute per agent', { model: 'Opus', minutes: 20 });
const queued = plan('Phone connect popups');
const rejected = plan('Orchestrator badges for every state');
const mine = plan('Ideas for December');
step(mine, 'Sketch the dashboard', { minutes: 30 }); step(mine, 'Ask Brett about colours'); step(mine, 'Write it up', { done: true });
const builds = [
  build('plan-studio-live-progress', building, 'building', [
    bStep('s1', 'Read sent steps from the builds store', 'completed', 'Fable'), bStep('s2', 'Replace planning steps on split', 'completed', 'Fable'),
    bStep('s3', 'State badges and the lock on sent rows', 'building', 'Opus'), bStep('s4', 'Settings for how each state looks', 'sending', 'Opus'),
    bStep('s5', 'Orchestrator actions on the context menu', 'failed', 'Opus', { failedFrom: 'building' }), bStep('s6', 'Tests for replace on split and live check-off', 'ready', 'Opus'),
  ], { number: 41, pr: 924, pipelineView: pv('building', 'Building', 'accent', 'hammer', 'The VPS is building: 2 of 6 steps are done, 2 are in their slots.') }),
  build('console-tabs-plugins-open-in-tabs', ci, 'build-complete', [bStep('s1', 'Tab strip for plugin views', 'in-pr', 'Opus', { prNumber: 921 }), bStep('s2', 'Remember open tabs per device', 'in-pr', 'Opus', { prNumber: 921 })],
    { number: 39, pr: 921, pipelineView: pv('waiting-to-merge', 'Waiting to merge', 'warning', 'clock', 'Built and green. It merges when its turn comes.', { mergeLine: { position: 2, waitingFor: { number: 38, buildId: 'console-idle-load-fix', title: 'Console idle load fix' } } }) }),
  build('voice-notes-retry', landed, 'landed', [bStep('s1', 'Retry queue', 'in-pr', 'Opus', { prNumber: 915 }), bStep('s2', 'Toast on retry', 'in-pr', 'Opus', { prNumber: 915 })],
    { number: 36, pr: 915, pipelineView: pv('landed', 'Landed', 'success', 'check', 'Merged into main with CI green.') }),
  build('group-chat-audio', waiting, 'pending', [], { number: 44, pipelineView: pv('pending', 'Pending', '', 'clock', 'Sent. Waiting for the VPS to split it into steps.') }),
  build('phone-connect-popups', queued, 'split', [bStep('s1', 'Popup when a phone connects', 'pending', ''), bStep('s2', 'Remember dismissed popups', 'pending', '')],
    { number: 42, pipelineView: pv('split', 'Split', '', 'layers', 'Split into 2 steps that never touch the same files. Waiting for its turn to build.', { waitingOn: { buildId: 'plan-studio-live-progress', number: 41, title: 'Plan Studio live progress', reason: 'Waiting: Plan Studio live progress holds the active place' } }) }),
  build('orchestrator-badges', rejected, 'split', [bStep('s1', 'A badge per pipeline state', 'pending', ''), bStep('s2', 'Live refresh on the builds event', 'pending', '', { waitsFor: { number: 41, buildId: 'plan-studio-live-progress' } })],
    { number: 43, pipelineView: pv('rejected', 'Rejected', 'danger', 'alert', 'Not started: it would clash with work that is not on main yet.'),
      clash: { rejected: true, reason: 'Step s2 touches files that build #41 has not merged yet', with: [{ number: 41, buildId: 'plan-studio-live-progress', title: 'Plan Studio live progress' }],
        options: [{ id: 'defer', label: 'Run 1 step now, defer 1 step', steps: [{ step: 's2', uid: '', title: 'Live refresh on the builds event', waitsFor: { number: 41 } }] }, { id: 'run-all', label: 'Wait and run all after build #41 lands' }] } }),
];
const view = live.liveView(state, builds);
/** GET plans/<planId>/build, from the same builds (what the server's plan-build op answers). */
const planBuild = (planId) => { const sent = live.sentBuilds(builds, planId); return sent.length ? { ok: true, plan: { id: planId }, ...live.buildDetail(sent[sent.length - 1]) } : { ok: true, plan: { id: planId }, build: null, steps: [] }; };
const STATE = { ok: true, $axf: tc.SCHEMA, rev: view.rev, items: view.items, trash: [], store: '/projects/amberx-axf/_data/plan-studio-2', onHub: true, watch: true, sent: 6 };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.PS2_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname === `/api/plugins/${TAB}/state`) return json(STATE);
      const pb = new RegExp(`^/api/plugins/${TAB}/plans/([^/]+)/build$`).exec(u.pathname);
      if (pb) return json(planBuild(decodeURIComponent(pb[1])));
      if (u.pathname === '/api/builds/events') return r.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((x) => window.axfConsoleControl(x), cmd);
    const shot = async (name, opts = {}) => { const p = join(OUT, `plan-studio-2-${name}-${device}.png`); await page.screenshot({ path: p, ...opts }); shots.push(p); say(`${name} ${device}`); };

    // 1. the tree: sent plans with the orchestrator's steps, an unsent plan beside them
    // plugins register a moment after the console is up: ask until the view is there
    let opened = null;
    for (let i = 0; i < 40 && !opened?.ok; i++) { opened = await run({ verb: 'open', address: `view:${TAB}` }).catch((e) => ({ ok: false, message: String(e) })); if (!opened?.ok) await sleep(500); }
    say(`open → ${JSON.stringify(opened).slice(0, 300)}`);
    await page.waitForSelector('.axp-plan-studio-2__stepstable [data-ps2-col="uid"]', { timeout: 20_000 });
    await sleep(800);
    await shot('sent-tree', { fullPage: !mobile });
    // 1b. a build waiting for the active place, and a rejected build with its options
    await page.locator('[data-ps2-clash]').first().scrollIntoViewIfNeeded();
    await sleep(500);
    await shot('build-waiting-rejected');
    await page.locator('.axp-plan-studio-2__tree').first().scrollIntoViewIfNeeded();

    // 2. a step the orchestrator filed, selected: the read-only editor with the orchestrator's actions
    // a DOM click: the row moves while it is Building (status styles), which a pointer click waits out
    await page.evaluate(() => { [...document.querySelectorAll('.axp-plan-studio-2__steplink')].find((b) => b.textContent.includes('State badges and the lock'))?.click(); });
    await page.locator('.axp-plan-studio-2__senttitle').first().waitFor({ timeout: 10_000 });
    await page.locator('.axp-plan-studio-2__senttitle').first().scrollIntoViewIfNeeded();
    await sleep(600);
    await shot('sent-step', { fullPage: !mobile });

    // 3. the row menu: the orchestrator's actions
    await page.locator('.axp-plan-studio-2__row.is-locked', { hasText: 'Plan Studio live progress' }).first().scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'More for Plan Studio live progress' }).first().click({ timeout: 5000 }).catch((e) => say(`menu: ${e.message.split('\n')[0]}`));
    await sleep(500);
    // the submenu opens on hover (a pointer) or on a tap (touch)
    const sub = page.locator('[data-axf-item="plan-studio-2.orch"] > .fx-menu__item').first();
    await (mobile ? sub.click({ timeout: 3000 }) : sub.hover({ timeout: 3000 })).catch((e) => say(`submenu: ${e.message.split('\n')[0]}`));
    await sleep(700);
    await shot('orchestrator-menu');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // 4. settings: how each state looks
    for (let i = 0; i < 20 && !(await page.locator('.axp-plan-studio-2__looks').count()); i++) {
      await page.keyboard.press('Escape');
      await run({ verb: 'press', address: 'function:settings.open', value: TAB });
      await sleep(1500);
    }
    const looks = page.locator('.axp-plan-studio-2__looks');
    await looks.first().waitFor({ timeout: 20_000 });
    await looks.first().scrollIntoViewIfNeeded();
    for (const name of ['Building', 'Landed']) await looks.locator('.fx-card', { has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) }).locator('.fx-card__toggle').first().click({ timeout: 3000 }).catch((e) => say(`open ${name}: ${e.message.split('\n')[0]}`));
    await looks.locator('.fx-card', { has: page.locator('h3', { hasText: /^Building$/ }) }).first().scrollIntoViewIfNeeded();
    await sleep(900);
    await shot('state-looks');
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); await browser?.close(); server.kill('SIGTERM'); process.exit(1); }
