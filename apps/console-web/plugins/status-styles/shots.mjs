/**
 * Screenshots of Status styles for UI Review, desktop and phone, against `vite preview` of dist/ with the API
 * answered from fixtures: the settings tab (a style per status, the preset library, the preset maker) and the builds
 * table with every row and step styled by its status.
 *
 *   node apps/console-web/plugins/status-styles/shots.mjs <out-dir>        (build first: npm run build)
 *   SS_SHOTS_PORT=7096 · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.SS_SHOTS_PORT) || 7096;
const TAB = 'status-styles';
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const step = (id, title, status, min) => ({ id, title, status, attempt: status === 'failed' ? 2 : 0, model: 'Opus', account: 'worker-1', slot: '1', prNumber: status === 'in-pr' ? 902 : 0, at: ago(min), by: 'pipeline' });
const row = (id, title, status, steps, min) => ({
  id, title, status, attempt: status === 'failed' ? 2 : 0, steps, done: steps.filter((s) => s.status === 'completed' || s.status === 'in-pr').length, total: steps.length,
  model: 'Opus', account: 'worker-1', slot: '1', prNumber: 0, pr: '', branch: `claude/${id}`, at: ago(min), by: 'pipeline', createdAt: ago(min + 90), updatedAt: ago(min), flow: 'pipeline-2',
});
const ROWS = [
  row('status-styles-plugin', 'Status styles plugin', 'building', [step('s1', 'Style engine', 'completed', 30), step('s2', 'Settings tab', 'building', 9), step('s3', 'Preset library', 'sending', 2), step('s4', 'Help text', 'ready', 1)], 12),
  row('safe-mode-button', 'Server safe mode: one emergency button', 'running-ci', [step('s1', 'Switch', 'in-pr', 60)], 6),
  row('console-state-tables', 'Console state and settings to tables', 'merging-pr', [step('s1', 'Rows', 'in-pr', 30)], 3),
  row('worktrees-before-launch', 'Worktrees cut before launch', 'assigning-models', [step('s1', 'Cut', 'ready', 2)], 1),
  row('one-pr-size-cap', 'One-PR size cap', 'pulling-main', [step('s1', 'Threshold', 'pulling-main', 1)], 0.5),
  row('voice-notes-retry', 'Voice notes: retry a failed upload', 'failed', [step('s1', 'Retry queue', 'failed', 25)], 25),
  row('merge-queue-read-only', 'Merge queue: read-only view', 'merging-main', [step('s1', 'View', 'in-pr', 15)], 1.5),
  row('send-validates-schema', 'Send to orchestrator validates the schema', 'ready', [step('s1', 'Validate', 'pending', 9)], 9),
  row('glossary-search', 'Glossary index: search by alias', 'pending', [], 44),
];
const TABLE = { ok: true, rev: 9350, updatedAt: ago(0), profile: 'all', rows: ROWS };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const OWN = [{ id: 'my-calm-green-sweep', name: 'Calm green sweep', target: 'row', effect: 'sweep', tone: 'success', speed: 60, strength: 50, direction: 'alternate', tint: 4, edge: true, bold: false, italic: false, dim: 0 }];

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, detached: true, stdio: process.env.SS_SHOTS_DEBUG ? 'inherit' : 'ignore' });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopServer);
const say = (m) => process.stderr.write(`${m}\n`);
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} did not start (port taken, or dist/ not built)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname === `/api/plugins/${TAB}/config`) return json({ config: { $axf: 'status-styles@1' }, presets: OWN });
      if (u.pathname.endsWith('/table')) return json(u.searchParams.get('since') === String(TABLE.rev) ? { ok: true, unchanged: true, rev: TABLE.rev } : TABLE);
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((x) => window.axfConsoleControl(x), cmd);
    const shot = async (name, opts = {}) => { const p = join(OUT, `status-styles-${name}-${device}.png`); await page.screenshot({ path: p, ...opts }); shots.push(p); say(`${name} ${device}`); };
    await page.waitForSelector(`style[data-axf-plugin-style="${TAB}"]`, { state: 'attached', timeout: 30_000 });

    // 1. the builds table: every row and step drawn by its status
    say(`open builds → ${JSON.stringify(await run({ verb: 'open', address: 'view:build-orchestrator' }).catch((e) => String(e))).slice(0, 120)}`);
    await page.waitForSelector('.axf-grid-row [data-status]', { timeout: 20_000 });
    await page.locator('.axf-grid-row', { hasText: 'Status styles plugin' }).first().click({ timeout: 5000 }).catch((e) => say(`row click: ${e.message.split('\n')[0]}`));
    await sleep(2600); // mid-sweep
    await shot('builds');

    // 2. the settings tab
    for (let i = 0; i < 20 && !(await page.locator('.axp-status-styles__status').count()); i++) {
      await page.keyboard.press('Escape');
      await run({ verb: 'press', address: 'function:settings.open', value: TAB });
      await sleep(1500);
    }
    await page.locator('.axp-status-styles__status').first().waitFor({ timeout: 20_000 });
    await sleep(1200);
    await shot('settings');
    await page.locator('.axp-status-styles__library').scrollIntoViewIfNeeded();
    await sleep(1500);
    await shot('library');
    await page.getByRole('button', { name: 'Edit a copy' }).nth(22).click();
    await page.getByRole('button', { name: 'Save preset' }).scrollIntoViewIfNeeded();
    await sleep(1500);
    await shot('maker');
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  stopServer(); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
