#!/usr/bin/env node
/**
 * axf-hostd smoke test: a throwaway checkout with one demo service, the service daemon and the host API started on
 * sockets in a temp folder, systemctl / sudo replaced by stubs. Checks health, the loop and heartbeat, an action with
 * confirm, settings, the mode guard (container → skipped), mode changes, the loopback token and host_service_down.
 *   node deploy/host-services/test-hostd.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const T = mkdtempSync(join(tmpdir(), 'axf-hostd-'));
const root = join(T, 'root'); const data = join(T, 'data'); const run = join(T, 'run');
mkdirSync(join(root, 'deploy/host-services/services'), { recursive: true });
mkdirSync(join(root, 'deploy/host-services/workers'), { recursive: true });
mkdirSync(join(root, 'framework/core'), { recursive: true });
cpSync(join(REPO, 'framework/core/host-services.mjs'), join(root, 'framework/core/host-services.mjs'));
for (const f of ['framework/core/data-files.mjs', 'framework/core/data-store.mjs', 'framework/core/clip.mjs', 'framework/schemas/data-store-paths.json']) { mkdirSync(join(root, f, '..'), { recursive: true }); cpSync(join(REPO, f), join(root, f)); }
cpSync(join(REPO, 'deploy/host-services/axf-hostd.mjs'), join(root, 'deploy/host-services/axf-hostd.mjs'));
cpSync(join(REPO, 'deploy/host-services/services/host-api.json'), join(root, 'deploy/host-services/services/host-api.json'));
writeFileSync(join(root, 'deploy/host-services/services/demo.json'), JSON.stringify({
  $axf: 'host-service@1', id: 'demo', title: 'Demo', kind: 'daemon', unit: 'axf-demo.service', plugin: 'console', runner: 'deploy/host-services/workers/demo.mjs',
  health: { intervalSec: 5 }, sudo: [{ cmd: '/usr/bin/docker system df', why: 'measure' }],
  actions: [{ id: 'wipe', title: 'Wipe', confirm: true, args: { deep: { type: 'boolean' } } }, { id: 'echo', title: 'Echo' }, { id: 'forbidden', title: 'Forbidden' }],
  settings: { intervalSec: { type: 'integer', default: 5, min: 5, max: 600 } },
}));
const cronDir = join(root, 'cron.d'); mkdirSync(cronDir, { recursive: true });
const cronLog = join(root, 'axf-reaper.log');
writeFileSync(join(root, 'deploy/host-services/services/reaper.json'), JSON.stringify({
  $axf: 'host-service@1', id: 'reaper', title: 'Reaper', kind: 'tick', cron: 'axf-reaper', adopted: true, plugin: 'console', runner: 'framework/cli/reaper.mjs', health: { staleSec: 900 }, log: cronLog,
}));
writeFileSync(join(root, 'deploy/host-services/workers/demo.mjs'), `
let n = 0;
export const intervalSec = 5;
export async function tick(ctx) { n += 1; return { result: 'ok', message: 'pass ' + n + (ctx.dryRun ? ' (dry)' : ''), effects: ctx.dryRun ? ['would'] : ['did'] }; }
export const actions = {
  wipe: async (args, ctx) => ({ wiped: true, deep: !!args.deep, dryRun: ctx.dryRun }),
  echo: async () => ({ hi: true }),
  forbidden: async (args, ctx) => ctx.sudo(['/usr/bin/rm', '-rf', '/']),
};
`);
const bin = join(T, 'bin'); mkdirSync(bin);
writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\necho ActiveState=active\necho MainPID=42\necho NRestarts=0\necho UnitFileState=enabled\necho LoadState=loaded\n'); chmodSync(join(bin, 'systemctl'), 0o755);
writeFileSync(join(bin, 'journalctl'), '#!/bin/sh\necho "2026-11-17T12:00:00+0000 host demo[1]: tick"\n'); chmodSync(join(bin, 'journalctl'), 0o755);
writeFileSync(join(bin, 'sudo'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${join(T, 'sudo.log')}\n`); chmodSync(join(bin, 'sudo'), 0o755);
const env = { ...process.env, AXF_HOST_CRON_DIR: cronDir, AXF_HOST_ROOT: root, AXF_HOST_DATA: data, AXF_HOST_SOCKET_DIR: run, AXF_HOST_TOKEN: 'tok', AXF_HOST_PORT: String(17000 + Math.floor(Math.random() * 2000)), AXF_HOST_SYSTEMCTL: join(bin, 'systemctl'), AXF_HOST_JOURNALCTL: join(bin, 'journalctl'), AXF_HOST_SUDO: join(bin, 'sudo') };
const hostd = join(root, 'deploy/host-services/axf-hostd.mjs');
const kids = [];
const start = (id, extra = {}) => { const k = spawn(process.execPath, [hostd, id], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'inherit'] }); let out = ''; k.stdout.on('data', (c) => { out += c; }); k.log = () => out; kids.push(k); return k; };
const call = (socketPath, method, path, body, headers = {}) => new Promise((res, rej) => {
  const d = body ? JSON.stringify(body) : '';
  const r = request({ ...(socketPath.startsWith('http') ? { host: '127.0.0.1', port: Number(socketPath.split(':')[2]) } : { socketPath }), method, path, headers: { 'content-type': 'application/json', ...headers } }, (x) => { let s = ''; x.on('data', (c) => { s += c; }); x.on('end', () => res({ status: x.statusCode, body: JSON.parse(s) })); });
  r.on('error', rej); if (d) r.write(d); r.end();
});
const wait = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); } };
const API = join(run, 'api.sock'); const DEMO = join(run, 'demo.sock');
let n = 0; const ok = (name) => { n += 1; console.log(`  ✓ ${name}`); };
try {
  // container mode (no mode file): the loop runs but skips
  const demo = start('demo', { AXF_HOST_PORT: '' });
  await wait(() => existsSync(join(data, 'host-services/demo/state.json')));
  assert.equal(JSON.parse(readFileSync(join(data, 'host-services/demo/state.json'), 'utf8')).result, 'skipped'); ok('container mode: the host loop skips');
  assert.ok(existsSync(join(data, 'host-services/demo/heartbeat.json'))); ok('heartbeat written');
  assert.match(demo.log(), /^<6>\{"at":/m); ok('journald lines carry the syslog level');
  const h = await call(DEMO, 'GET', '/v1/health'); assert.equal(h.status, 200); assert.equal(h.body.service, 'demo'); ok('service socket answers /v1/health');
  const refused = await call(DEMO, 'POST', '/v1/actions/echo', { args: {} }); assert.equal(refused.body.code, 'mode_refused'); ok('actions refused in container mode');

  start('host-api');
  await wait(() => existsSync(API));
  const lb = `http://127.0.0.1:${env.AXF_HOST_PORT}`;
  const health = await call(lb, 'GET', '/v1/health'); assert.equal(health.body.ok, true); ok('loopback /v1/health is open');
  const noTok = await call(lb, 'GET', '/v1/services'); assert.equal(noTok.status, 401); assert.equal(noTok.body.code, 'unauthorized'); ok('loopback needs the token');
  const list = await call(lb, 'GET', '/v1/services', null, { authorization: 'Bearer tok' }); assert.equal(list.body.$axf, 'host-service-list@1');
  assert.deepEqual(list.body.services.map((s) => s.id).sort(), ['demo', 'host-api', 'reaper']); ok('host API lists every manifest');
  assert.equal(list.body.services.find((s) => s.id === 'demo').status, 'down'); ok('container mode is down by design');

  const sh = await call(API, 'PUT', '/v1/services/demo/mode', { to: 'shadow', by: 'test' }); assert.equal(sh.body.mode, 'shadow', JSON.stringify(sh.body)); ok('mode container → shadow');
  assert.match(readFileSync(join(T, 'sudo.log'), 'utf8'), /-n \/usr\/bin\/systemctl start axf-demo.service/); ok('mode change starts the unit through sudo -n');
  const bad = await call(API, 'PUT', '/v1/services/demo/mode', { to: 'host', by: 'test' }); assert.equal(bad.body.code, 'invalid_body'); ok('cut-over guarded (shadow too short)');
  await wait(async () => (await call(DEMO, 'GET', '/v1/health')).body.lastRun?.mode === 'shadow');
  assert.match(readFileSync(join(data, 'host-services/demo/shadow.jsonl'), 'utf8'), /"side":"host"/); ok('shadow: dry run logged');
  const conf = await call(API, 'POST', '/v1/services/demo/actions/wipe', { args: { deep: true } }); assert.equal(conf.body.code, 'confirm_required'); ok('confirm action needs confirm');
  const wiped = await call(API, 'POST', '/v1/services/demo/actions/wipe', { args: { deep: true }, confirm: true, by: 'test' }); assert.equal(wiped.body.result.wiped, true); assert.equal(wiped.body.dryRun, true); ok('action forwarded to the service socket');
  const forb = await call(API, 'POST', '/v1/services/demo/actions/forbidden', { by: 'test' }); assert.equal(forb.body.code, 'forbidden_command'); ok('commands outside the whitelist are forbidden');
  const set = await call(API, 'PUT', '/v1/services/demo/settings', { set: { intervalSec: 30 }, by: 'test' }); assert.equal(set.body.settings.intervalSec, 30); ok('settings merged');
  const badSet = await call(API, 'PUT', '/v1/services/demo/settings', { set: { nope: 1 } }); assert.equal(badSet.body.code, 'unknown_setting'); ok('unknown setting refused');
  const logs = await call(API, 'GET', '/v1/services/demo/logs?lines=5'); assert.equal(logs.body.lines.length, 1); ok('logs from journalctl');
  const rb = await call(API, 'POST', '/v1/services/demo/rollback', { by: 'test', why: 'drill' }); assert.equal(rb.body.to, 'container'); ok('rollback → container');
  const mode = await call(API, 'GET', '/v1/services/demo/mode'); assert.equal(mode.body.mode, 'container'); ok('mode file says container');
  const c0 = await call(API, 'GET', '/v1/services/reaper'); assert.equal(c0.body.status, 'down'); assert.equal(c0.body.mode, 'host'); assert.match(c0.body.reason, /axf-reaper is missing/); ok('an adopted cron schedule with no cron file is down');
  writeFileSync(join(cronDir, 'axf-reaper'), '*/2 * * * * root true\n'); writeFileSync(cronLog, 'reaped 0\nreaped 1\n');
  const c1 = await call(API, 'GET', '/v1/services/reaper'); assert.equal(c1.body.status, 'up'); assert.equal(c1.body.cron, 'axf-reaper'); ok('with its cron file and a fresh log it is up');
  const c2 = await call(API, 'POST', '/v1/services/reaper/unit/restart', { by: 'test', confirm: true }); assert.equal(c2.body.code, 'unknown_action'); ok('a cron schedule has no unit verbs');
  const c3 = await call(API, 'GET', '/v1/services/reaper/logs?lines=1'); assert.deepEqual(c3.body.lines.map((l) => l.line), ['reaped 1']); ok('its logs come from the log file');
  const c4 = await call(API, 'PUT', '/v1/services/reaper/mode', { to: 'shadow', by: 'test' }); assert.notEqual(c4.status, 200); ok('an adopted schedule has no mode to change');
  const c5 = await call(API, 'POST', '/v1/services/reaper/rollback', { by: 'test', confirm: true }); assert.equal(c5.body.code, 'unknown_action'); ok('and nothing to roll back to');
  const cli = (...a) => execFileSync(process.execPath, [join(REPO, 'framework/cli/host-services.mjs'), ...a], { env: { ...process.env, AXF_HOST_API: `unix:${API}`, AXF_HOST_API_FALLBACK: '', AXF_CONSOLE_URL: '', AXF_TOKEN: '' }, encoding: 'utf8' });
  assert.match(cli('list'), /^demo\s+down\s+container/m); ok('CLI list over the socket');
  assert.equal(JSON.parse(cli('status', 'demo', '--json')).id, 'demo'); ok('CLI status --json');
  assert.throws(() => cli('restart', 'demo'), (e) => e.status === 4); ok('CLI restart without --yes exits 4 (confirm)');

  demo.kill('SIGTERM'); await wait(() => !existsSync(DEMO));
  const down = await call(API, 'GET', '/v1/services/demo/health'); assert.equal(down.status, 503); assert.equal(down.body.code, 'host_service_down'); ok('a dead service is host_service_down');
  console.log(`✓ axf-hostd: ${n} checks`);
} finally {
  for (const k of kids) k.kill('SIGKILL');
  rmSync(T, { recursive: true, force: true });
}
