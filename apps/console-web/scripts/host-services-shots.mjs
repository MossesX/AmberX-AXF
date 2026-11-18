/**
 * Screenshots of Settings → Plugins → Host services (build move-server-side-console-parts-onto-vps) for UI Review:
 * desktop and phone, for each page-toolbar option (HS_SHOTS_ONLY=list,down,gate picks scenes), against
 * `vite preview` of dist/ with /api/host-services answered from a fixed fixture (no VPS):
 *   list   the view with every kind of row (up, degraded, down, in console, a tick) and one row opened
 *   down   the host API unreachable: the "Host service down" note and every row unknown
 *   gate   the Breakroom with agent-swarm down on the host: the shared HostServiceGate note above the page
 *
 *   node scripts/host-services-shots.mjs <out-dir>        (build first: npm run build)
 *   HS_SHOTS_PORT=<port> (default: a free one) · PW_CHROMIUM=<chromium path> · HS_TOOLBAR=<toolbar asset id> (the option being shown)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/host-services-shots.mjs <out-dir>'); process.exit(2); }
// a free port of our own unless one is named: other checkouts leave `vite preview` servers on the usual ports, and
// shooting one of them would picture another branch's console
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const PORT = Number(process.env.HS_SHOTS_PORT) || await freePort();
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const NOW = Date.parse('2026-11-18T09:00:00Z');
const at = (min) => new Date(NOW - min * 60000).toISOString();
const man = (id, title, description, actions = []) => ({ title, description, actions });
const svc = (id, status, mode, extra = {}) => ({ $axf: 'host-service-state@1', id, unit: `axf-${id}.service`, kind: 'daemon', plugin: id, status, since: at(extra.sinceMin ?? 90), at: at(0), reason: '', code: '', unitState: status === 'down' ? 'failed' : 'active', enabled: true, pid: 4242, restarts: 0, health: { ok: status === 'up', at: at(0.3), message: '', latencyMs: 4 }, lastRun: { at: at(1), result: status === 'degraded' ? 'error' : 'ok', durationMs: 820, message: '' }, heartbeat: { at: at(0.4), mode }, mode, reachable: true, ...extra });
const SERVICES = [
  svc('host-api', 'up', 'host', { plugin: 'console', manifest: man('host-api', 'Host API', 'Serves /run/axf-host/api.sock and 127.0.0.1:7788.') }),
  svc('builds-live', 'up', 'host', { plugin: 'build-orchestrator', manifest: man('builds-live', 'Builds live publisher', 'Publishes the builds store outbox to main and pulls main back, even while the console is down.', [{ id: 'flush', title: 'Publish now' }, { id: 'pull', title: 'Pull main' }, { id: 'sync', title: 'Sync' }, { id: 'status', title: 'Status', modes: ['container', 'shadow', 'host'] }]) }),
  svc('shipped-features', 'degraded', 'shadow', { reason: 'last run error: ledger sync: GitHub rate limit', manifest: man('shipped-features', 'Shipped features watcher', 'Keeps the feature ledger current from new builds, PRs and the deploy log.', [{ id: 'sync', title: 'Sync now' }, { id: 'ship-landed', title: 'Ship landed builds' }]) }),
  svc('hub-sync', 'up', 'shadow', { manifest: man('hub-sync', 'axHub sync', 'claude-sync and the persist push, on a timer.') }),
  svc('agent-swarm', 'down', 'host', { sinceMin: 14, reason: 'unit failed', code: 'host_service_down', health: null, manifest: man('agent-swarm', 'Agent job runner', 'Launches agent jobs and sweeps finished runs onto their agents.', [{ id: 'run-job', title: 'Run a job' }, { id: 'sweep', title: 'Sweep finished runs' }]) }),
  svc('systems-check', 'down', 'container', { reason: 'mode container: the host copy is off, the console still runs this part', manifest: man('systems-check', 'Systems check runner', 'Host checks that touch Docker, disk or git, and their Auto fixes.', [{ id: 'run-checks', title: 'Run host checks now' }, { id: 'fix', title: 'Auto fix', confirm: true }]) }),
  svc('maintenance', 'up', 'host', { unit: 'axf-maintenance-actions.service', manifest: man('maintenance', 'Maintenance actions', 'Clear Docker cache, Restart Docker and Measure now, on the host.', [{ id: 'clear-docker-cache', title: 'Clear Docker cache', confirm: true, modes: ['host'] }, { id: 'snapshot', title: 'Measure now' }]) }),
  svc('auto-lander', 'up', 'host', { kind: 'tick', plugin: 'gate', timerState: 'active', heartbeat: null, manifest: man('auto-lander', 'Auto-lander', 'Merges main into clashing builds, fixes red CI, lands green PRs.') }),
  svc('pipeline', 'up', 'host', { kind: 'tick', plugin: 'build-orchestrator', timerState: 'active', heartbeat: null, manifest: man('pipeline', 'Build pipeline tick', 'The orchestrator\'s dispatcher, every minute.') }),
];
const LIST = { $axf: 'host-service-list@1', at: at(0), services: SERVICES, hostApi: { up: true, endpoint: 'unix:/run/axf-host/api.sock' }, counts: { up: 6, degraded: 1, down: 2 } };
const DOWN = { $axf: 'host-service-list@1', at: at(23), downSince: at(23), down: { $axf: 'host-error@1', code: 'host_service_down', message: 'the host API cannot be reached (unix:/run/axf-host/api.sock: ConnectionRefusedError)', service: 'host-api' }, hostApi: { up: false }, counts: { unknown: SERVICES.length },
  services: SERVICES.map((s) => ({ ...s, status: 'unknown', since: at(23), reason: 'the host API cannot be reached', code: 'host_service_down', reachable: false, health: null, heartbeat: null, lastRun: null })) };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, detached: true, stdio: process.env.HS_SHOTS_DEBUG ? 'inherit' : 'ignore' });
// npx starts vite as a child: stop the whole group, or a preview server is left behind on every run
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
let exited = null;
server.on('exit', (code) => { exited = code ?? 'signal'; });
process.on('exit', stopServer);
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    if (exited !== null) throw new Error(`vite preview exited (${exited}): is port ${PORT} taken?`); try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  const say = (m) => process.stderr.write(`${m}\n`);
  const tag = process.env.HS_TOOLBAR || 'host-services';
  for (const scene of (process.env.HS_SHOTS_ONLY || 'list,down,gate').split(',')) {
    for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      await page.route('**/api/**', (r) => {
        const u = new URL(r.request().url());
        const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.pathname === '/api/me') return json(ME);
        if (u.pathname === '/api/host-services') return json(scene === 'down' ? DOWN : LIST);
        if (u.pathname.startsWith('/api/host-services/')) return scene === 'down' ? json(DOWN.down, 503) : json({ lines: [{ at: at(1), line: 'tick ok' }] });
        if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
      });
      // the option being shown: the page toolbar's per-instance asset pick (axf.chrome.toolbar.<id>.asset), seeded in the
      // console's saved settings before it starts (the pick is no console-control setting, so `set` cannot reach it)
      if (tag !== 'host-services') await page.addInitScript((pick) => { const k = 'axf:axf-console:settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v['axf.chrome.toolbar.host-services.asset'] = pick; localStorage.setItem(k, JSON.stringify(v)); }, tag);
      await page.goto(`http://127.0.0.1:${PORT}/`);
      await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 90_000 });
      const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
      // a fresh profile loads every plugin once to learn its shape: wait until this one is registered
      let known = false;
      for (let i = 0; i < 150 && !known; i++) { known = !!(await run({ verb: 'state', address: 'plugin:ai.amberx.axf.console.host-services' })).ok; if (!known) await sleep(1000); }
      if (!known) say(`${scene} ${device}: the host-services plugin never registered`);
      if (scene === 'gate') {
        await run({ verb: 'open', address: 'view:agent-swarm' });
        await page.waitForSelector('[data-host-service-down="agent-swarm"]', { timeout: 60_000 }).catch((e) => say(`gate: ${e.message.split('\n')[0]}`));
      } else {
        // the deep link first; when the settings page (list layout) does not follow it, press the same rows a user
        // would: Plugins, then Host services. On a busy host the sub-tab can take a while to be listed.
        let r;
        for (let i = 0; i < 20; i++) { r = await run({ verb: 'open', address: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=host-services' }); if (r.ok) break; await sleep(3000); }
        const onView = () => page.locator('[data-axf-target="view:host-services"]').count();
        await sleep(1500);
        if (!(await onView())) {
          await page.locator('.axf-settings__navlist button', { hasText: /^Plugins/ }).first().click({ timeout: 30_000 }).catch((e) => say(`plugins row: ${e.message.split('\n')[0]}`));
          await page.locator('.axf-settings__navlist--subs button', { hasText: /^Host services/ }).first().click({ timeout: 30_000 }).catch((e) => say(`host-services row: ${e.message.split('\n')[0]}`));
        }
        say(`${scene} ${device}: open → ${JSON.stringify(r).slice(0, process.env.HS_SHOTS_DEBUG ? 4000 : 160)}`);
        await page.waitForSelector('[data-axf-target="view:host-services"]', { timeout: 60_000 }).catch((e) => say(`view: ${e.message.split('\n')[0]}`));
        if (scene === 'list') await page.locator('[data-axf-target="view:host-services"] [aria-expanded="false"]').nth(4).click({ timeout: 4000 }).catch((e) => say(`expand: ${e.message.split('\n')[0]}`));
      }
      await sleep(900);
      const file = join(OUT, `host-services-${scene}${tag === 'host-services' ? '' : `-${tag}`}-${device}.png`);
      await page.screenshot({ path: file, fullPage: !mobile, timeout: 120_000 });
      shots.push(file);
      await ctx.close();
    }
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  stopServer(); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
