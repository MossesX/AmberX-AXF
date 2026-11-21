/**
 * Screenshots of the one status-driven builds table (Pipeline 2.0, status-table@1) for UI Review: the Build
 * orchestrator page (a building row expanded to its steps) and the read-only Merge queue view, desktop and phone,
 * against `vite preview` of dist/ with GET /api/plugins/build-orchestrator/table answered from a fixed fixture. axf-plugin:build-orchestrator
 *
 *   node scripts/status-table-shots.mjs <out-dir>        (build first: npm run build)
 *   ST_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/status-table-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.ST_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const step = (id, title, status, model, account, slot, min, extra = {}) => ({ id, title, status, attempt: status === 'failed' ? 2 : 0, model, account, slot, prNumber: status === 'in-pr' ? 902 : 0, at: ago(min), by: 'pipeline', ...extra });
const row = (id, title, status, steps, min, extra = {}) => {
  const done = steps.filter((s) => s.status === 'completed' || s.status === 'in-pr').length;
  const one = (k) => { const v = [...new Set(steps.map((s) => s[k]).filter(Boolean))]; return v.length === 1 ? v[0] : v.length ? 'mixed' : ''; };
  return { id, title, status, attempt: 0, steps, done, total: steps.length, model: one('model'), account: one('account'), slot: one('slot'), prNumber: 0, pr: '', branch: `claude/${id}`, at: ago(min), by: 'pipeline', createdAt: ago(min + 95), updatedAt: ago(min), ...extra };
};
const ROWS = [
  row('pipeline-2-0-status-table', 'Pipeline 2.0: one status-driven builds table', 'building', [
    step('s1', 'Status-table core: contract statuses, filters, timers', 'completed', 'Opus', 'hulu0241', '1', 41),
    step('s2', 'GET /table: compact rows from the builds store', 'completed', 'Opus', 'hulu0241', '2', 29),
    step('s3', 'The one table: rows, steps, badges, live timers', 'building', 'Opus', 'hulu0241', '3', 12),
    step('s4', 'Contract review of the status mapping', 'building', 'Fable', 'amberx-2', '4', 7),
  ], 12),
  row('server-safe-mode-one-emergency-button', 'Server safe mode: one emergency button', 'running-ci', [
    step('s1', 'Safe mode switch', 'in-pr', 'Opus', 'amberx-2', '1', 60), step('s2', 'Banner button', 'in-pr', 'Opus', 'amberx-2', '2', 55),
  ], 6, { prNumber: 902, pr: 'https://github.com/MossesX/AmberX-AXF/pull/902' }),
  row('postgres-part-c-console-state-settings', 'Postgres part C: console state and settings', 'merging-pr', [
    step('s1', 'Settings rows', 'in-pr', 'Opus', 'hulu0241', '1', 30), step('s2', 'Console state rows', 'completed', 'Opus', 'hulu0241', '2', 20),
  ], 3, { prNumber: 899, pr: 'https://github.com/MossesX/AmberX-AXF/pull/899' }),
  row('worktrees-cut-before-launch', 'Worktrees cut before launch', 'assigning-models', [
    step('s1', 'Cut the worktree in pulling-main', 'ready', 'Fable', '', '', 2), step('s2', 'Launch only starts the session', 'ready', 'Opus', '', '', 1),
  ], 1),
  row('one-pr-size-cap', 'One-PR size cap', 'pulling-main', [step('s1', 'Size threshold', 'pulling-main', '', '', '', 0.5), step('s2', 'Split into N PRs', 'pending', '', '', '', 3)], 0.5),
  row('voice-notes-retry', 'Voice notes: retry a failed upload', 'failed', [step('s1', 'Retry queue', 'failed', 'Opus', 'amberx-2', '2', 25), step('s2', 'Toast on retry', 'completed', 'Opus', 'amberx-2', '1', 40)], 25, { attempt: 2 }),
  row('plan-studio-send-to-orchestrator', 'Plan Studio: send to orchestrator validates the schema', 'split', [step('s1', 'Validate', 'pending', '', '', '', 9), step('s2', 'Send', 'pending', '', '', '', 9)], 9),
  row('glossary-index-search', 'Glossary index: search by alias', 'pending', [], 44),
  row('merge-queue-read-only', 'Merge queue: read-only view', 'merging-main', [step('s1', 'View', 'in-pr', 'Opus', 'hulu0241', '1', 15)], 1.5, { prNumber: 897, pr: 'https://github.com/MossesX/AmberX-AXF/pull/897' }),
];
const TABLE = { ok: true, rev: 9350, updatedAt: ago(0), profile: 'all', rows: ROWS };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.ST_SHOTS_DEBUG ? 'inherit' : 'ignore' });
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
  for (const [view, address] of [['builds', 'view:build-orchestrator'], ['merge-queue', 'view:merge-queue']]) {
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname === '/api/me') return json(ME);
        if (u.pathname === '/api/plugins/build-orchestrator/table') return json(u.searchParams.get('since') === String(TABLE.rev) ? { ok: true, unchanged: true, rev: TABLE.rev } : TABLE); // axf-plugin:build-orchestrator
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
      const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
      say(`${view} ${device}: open → ${JSON.stringify(await run({ verb: 'open', address }).catch((e) => String(e))).slice(0, 160)}`);
      await page.waitForSelector('.st-page .axf-grid-row', { timeout: 20_000 });
      // expand the active build to its steps (the queue: the PR under CI)
      const target = view === 'builds' ? 'Pipeline 2.0: one status-driven builds table' : 'Server safe mode: one emergency button';
      await page.locator('.st-page .axf-grid-row', { hasText: target }).first().click({ timeout: 5000 }).catch((e) => say(`row click: ${e.message.split('\n')[0]}`));
      await sleep(1500); // the timers tick
      const file = join(OUT, `status-table-${view}-${device}.png`);
      await page.screenshot({ path: file, fullPage: !mobile });
      shots.push(file);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
