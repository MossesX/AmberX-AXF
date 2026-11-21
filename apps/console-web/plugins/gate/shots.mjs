#!/usr/bin/env node
/**
 * Screenshots of Builds → Gate & rules for UI Review: every tab, desktop and phone, against `vite preview` of the
 * console's dist/. The gate routes are answered by the plugin's own ops (gate.mjs) over a temp data folder seeded with a
 * small merge line, so the screens show real answers; the VPS lander's routes (auto-lander…) come from a fixed fixture.
 * No VPS, no GitHub, nothing outside the temp folder is written.
 *
 *   node apps/console-web/plugins/gate/shots.mjs <out-dir>      (build the console first: npm run build)
 *   GATE_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path> · PLAYWRIGHT_DIR=<folder with node_modules/playwright>
 *   GATE_SHOTS_SKIN=<skin id> · GATE_SHOTS_MODE=light|dark     one more look of the same tabs
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');
const ROOT = resolve(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node apps/console-web/plugins/gate/shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.GATE_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found (set PLAYWRIGHT_DIR)'); process.exit(2); }

// ------------------------------------------------------------------ a temp gate: data folder, merge line, build rules

const TMP = mkdtempSync(join(tmpdir(), 'axf-gate-shots-'));
const LAND = join(TMP, 'lander');
mkdirSync(LAND, { recursive: true });
const NOW = new Date().toISOString();
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const json = (f, v) => writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`); // axf-data: not data (a temp fixture for the screenshots)
json(join(LAND, 'config.json'), { $axf: 'push-banner-config@1', repos: ['o/r'], autoLand: true, autoMerge: false, landWaitUi: true, mergeQueue: true, queueMode: 'stack' });
json(join(LAND, 'merge-queue.json'), {
  $axf: 'merge-queue@1', at: NOW,
  items: [
    { pr: 871, title: 'Model picker: keep the last choice', build: 'model-picker-memory', branch: 'claude/model-picker-memory', head: 'a1', state: 'testing', ci: 'running', startedAt: ago(8) },
    { pr: 872, title: 'Help for the gate screen', build: 'help-gate', branch: 'claude/help-gate', head: 'b2', state: 'waiting', why: 'its screenshots are waiting in UI Review.' },
  ],
  waiting: [{ pr: 874, title: 'Dock sizes', build: 'dock-sizes', branch: 'claude/dock-sizes', head: 'd4', state: 'kicked', why: 'PR 874 conflicts with main in code (framework/ui/axf.css). Merge main in and fix them.' }],
  merged: [{ pr: 868, title: 'Emergency slots', at: ago(55) }],
});
json(join(LAND, 'land.json'), { $axf: 'land@1', items: [] });
Object.assign(process.env, { AXF_GATE_DIR: join(TMP, 'gate'), AXF_GATE_LANDER_DIR: LAND, AXF_GATE_LANDER_CLI: '', AXF_BUILD_RULES_DIR: join(TMP, 'build-rules') });
const { createGate } = await import('./gate.mjs');
const gate = createGate();
gate.run('lander_mode', { mergeQueue: true, by: 'Brett', reason: 'Stack the ready PRs' });
// a little history, so the audit lists have rows
gate.run('rules_set', { id: 'ui-review', severity: 'warn', by: 'Brett', reason: 'Let small UI fixes land while their shots wait' });
gate.run('rules_toggle', { id: 'toolbars', enabled: false, by: 'Brett', reason: 'Toolbar check is being rebuilt' });
gate.run('build_rules_toggle', { id: gate.run('build_rules_list').rules[0]?.id, by: 'Brett', reason: 'Trying the build without it' });

const step = (id, status, prNumber, model = 'Opus', slot = null) => ({ id, status, prNumber, model, slot });
const failed = { kind: 'ci-red', status: 'running-ci', why: 'CI is red on 7e6a5f9 (Web Dev Console › theme-swap)', head: '7e6a5f9a1b2c', pr: 733, at: ago(12), retry: 'fix', notBefore: ago(-4), failing: ['Web Dev Console › theme-swap'] };
const BUILDS = [
  { build: 'console-look-axhub-skin', title: 'Console look: axHub skin', status: 'failed', attempt: 4, statusAt: ago(12), waiting: [], failure: failed, can: { retry: true, fix: true },
    prs: [{ pr: 732, steps: ['s1'], state: 'merged' }, { pr: 733, steps: ['s2'], state: 'open' }], steps: [step('s1', 'in-pr', 732, 'Opus', 1), step('s2', 'in-pr', 733, 'Fable', 2), step('s3', 'completed', null, 'Opus', 3)] },
  { build: 'p2-status-core', title: 'Pipeline 2.0, part 1: status core', status: 'running-ci', attempt: 0, statusAt: ago(6), waiting: [], failure: null, can: { retry: false, fix: false },
    prs: [{ pr: 741, steps: ['s1', 's2'], state: 'open' }], steps: [step('s1', 'in-pr', 741, 'Fable', 1), step('s2', 'in-pr', 741, 'Opus', 2)] },
  { build: 'phone-connect-small-android-companion', title: 'Phone Connect: small Android companion', status: 'building', attempt: 0, statusAt: ago(25), waiting: ['s1', 's2'], failure: null, can: { retry: false, fix: false },
    prs: [], steps: [step('s1', 'building', null, 'Opus', 5), step('s2', 'building', null, 'Opus', 6)] },
];
const AL_SETTINGS = { enabled: true, sizeCapLines: 4000, flakyReruns: 1, backoffBaseMin: 2, backoffFactor: 2, backoffMaxMin: 30, ciNoneKickMin: 10, ciTimeoutMin: 120, fixTimeoutMin: 60, notifyAfterAttempts: 3, workflow: 'android.yml', mergeMethod: 'merge' };
const AL_STATUS = {
  ok: true, $axf: 'lander-status@1', at: NOW,
  service: { lastTick: ago(0.5), result: 'worked', build: 'p2-status-core', error: '', paused: false, pausedBy: '', pausedAt: '', up: true, state: 'up' },
  can: { run: true, pause: true, resume: false },
  current: 'p2-status-core', queue: BUILDS.map((b) => b.build), builds: BUILDS,
  failing: [{ build: 'console-look-axhub-skin', attempt: 4, kind: 'ci-red', why: failed.why, since: ago(12), pr: 733 }], escalations: [], settings: AL_SETTINGS,
};
const AL_LOG = [['build-complete', 90, 'pipeline'], ['merging-pr', 80, 'lander'], ['running-ci', 70, 'lander'], ['failed', 40, 'lander', 3], ['running-ci', 30, 'lander'], ['failed', 12, 'lander', 4]]
  .map(([status, min, by, attempt]) => ({ status, at: ago(min), by, ...(attempt ? { attempt, note: failed.why } : {}) }));

/** One GET under /api/plugins/gate/, answered the way server/routes.py does. */
async function answer(path, q) {
  const one = (re) => { const m = path.match(re); return m ? decodeURIComponent(m[1]) : ''; };
  if (path === 'auto-lander') return AL_STATUS;
  if (path === 'auto-lander/settings') return { ok: true, settings: AL_SETTINGS };
  if (one(/^auto-lander\/builds\/(.+)$/)) { const b = BUILDS.find((x) => x.build === one(/^auto-lander\/builds\/(.+)$/)); return b ? { ok: true, build: b.build, status: b.status, attempt: b.attempt, failure: b.failure, statusLog: b.failure ? AL_LOG : AL_LOG.slice(0, 3) } : { ok: false, message: 'no build' }; }
  const table = { rules: 'rules_list', check: 'check_pr', history: 'history', lander: 'lander_status', 'lander/waiting': 'lander_waiting', 'lander/runs': 'lander_runs', 'lander/mode': 'lander_mode', settings: 'settings_get',
    'build-rules': 'build_rules_list', 'build-rules/history': 'build_rules_history', 'build-rules/runs': 'build_rules_runs', 'build-rules/brief': 'build_rules_brief' };
  if (table[path]) return gate.run(table[path], q);
  if (one(/^rules\/([^/]+)$/)) return gate.run('rules_get', { id: one(/^rules\/([^/]+)$/) });
  if (one(/^build-rules\/([^/]+)$/)) return gate.run('build_rules_get', { id: one(/^build-rules\/([^/]+)$/) });
  return { ok: false, code: 'not_found', message: `no route ${path}` };
}

// ------------------------------------------------------------------ the shots

/** Each tab, and the row or fold opened before its shot (what a person would tap first). */
const TABS = [
  ['overview', null], ['rules', '[data-axf-target="row:merge-queue-only"] [data-fx-row]'], ['build-rules', '.axp-gate__row [data-fx-row]'],
  ['line', '[data-axf-target="row:872"] [data-fx-row]'], ['auto-lander', '[data-axf-target="row:console-look-axhub-skin"] [data-fx-row]'],
  ['limits', null], ['triage', null], ['history', '.axp-gate__row [data-fx-row]'],
];
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const only = (process.env.GATE_SHOTS_ONLY || '').split(',').filter(Boolean);
const look = [process.env.GATE_SHOTS_SKIN, process.env.GATE_SHOTS_MODE].filter(Boolean).join('-');

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.GATE_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: process.env.GATE_SHOTS_MODE === 'light' ? 'light' : 'dark' });
    const page = await ctx.newPage();
    await page.route('**/api/**', async (r) => {
      const u = new URL(r.request().url());
      const send = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return send(ME);
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      const m = u.pathname.match(/^\/api\/plugins\/gate\/(.+)$/); // axf-plugin:gate
      if (m && r.request().method() === 'GET') return send(await answer(m[1].replace(/\/$/, ''), Object.fromEntries(u.searchParams)));
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd).catch((e) => ({ ok: false, error: String(e) }));
    if (process.env.GATE_SHOTS_SKIN) say(`skin: ${JSON.stringify(await run({ verb: 'run', address: `action:skin.use:${process.env.GATE_SHOTS_SKIN}` })).slice(0, 160)}`);
    if (process.env.GATE_SHOTS_MODE) say(`mode: ${JSON.stringify(await run({ verb: 'run', address: `action:skin.mode:${process.env.GATE_SHOTS_MODE}` })).slice(0, 160)}`);
    for (const [tab, tap] of TABS) {
      if (only.length && !only.includes(tab)) continue;
      await run({ verb: 'open', address: `view:gate/tab:gate.tabs=${tab}` });
      await page.waitForSelector('.axp-gate__panel', { timeout: 15_000 });
      await sleep(900);
      if (tap) await page.locator(tap).first().click({ timeout: 5000 }).catch((e) => say(`${tab} ${device}: ${e.message.split('\n')[0]}`));
      await sleep(900);
      const file = join(OUT, `gate-${tab}${look ? `-${look}` : ''}-${device}.png`);
      await page.screenshot({ path: file, fullPage: true });
      shots.push(file);
      say(`${tab} ${device}`);
    }
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
