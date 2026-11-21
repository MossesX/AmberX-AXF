#!/usr/bin/env node
/**
 * host-services@1 conformance: the registry snapshot and JSON Schemas are current, every deploy/<service>/host-service.json
 * in the repo validates, and the engine's answers (manifest defaults and errors, sudoers lines, console-control targets,
 * endpoints from env, up / degraded / down / unknown with `since`, call results → host_service_down, action call
 * checks) match the fixture every port replays.
 *   node framework/spec/check-host-services.mjs           check
 *   node framework/spec/check-host-services.mjs --write   regenerate fixtures/host-services.json
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../core/host-services.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/host-services.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (v) => JSON.parse(JSON.stringify(v));
const attempt = (fn) => { try { return fn(); } catch (e) { if (!(e instanceof H.HostServiceError)) throw e; return { error: e.code, status: e.status, message: e.message, service: e.service }; } };
const errs = (list) => list.map((e) => ({ error: e.code, status: e.status, message: e.message }));
let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const T0 = '2026-11-17T12:00:00.000Z';
const plus = (sec) => new Date(Date.parse(T0) + sec * 1000).toISOString();

// ── 1. registry + schemas ────────────────────────────────────────────────────────────────────────────────────────────
await t('schemas/host-service.json + schemas/json/host-*.schema.json are current (run axf schemas)', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/host-service.json')), H.REGISTRY), 'framework/schemas/host-service.json drifted');
  for (const [name, s] of Object.entries(H.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name);
  const err = H.jsonSchemas()['host-error.schema.json'];
  assert.deepEqual(err.properties.code.enum, Object.keys(H.ERRORS));
  assert.ok(Object.keys(H.ERRORS).includes('host_service_down'));
  for (const e of Object.values(H.ERRORS)) assert.ok(['down', 'retry', 'caller', 'confirm'].includes(e.console));
  for (const r of H.ROUTES) assert.ok(['GET', 'POST', 'PUT'].includes(r.method) && r.path.startsWith('/'));
});

// ── 2. every manifest in the repo ────────────────────────────────────────────────────────────────────────────────────
const repoManifests = [];
await t('every deploy/host-services/services/*.json (and deploy/*/host-service.json) validates and the set has no duplicate id / unit / socket', () => {
  const sdir = join(ROOT, 'deploy/host-services/services');
  if (existsSync(sdir)) for (const name of readdirSync(sdir).filter((x) => x.endsWith('.json')).sort()) {
    const m = JSON.parse(readFileSync(join(sdir, name), 'utf8'));
    const e = H.manifestErrors(m, `deploy/host-services/services/${name}`);
    assert.deepEqual(e, [], e.join('\n'));
    assert.equal(`${m.id}.json`, name, `${name}: the file is named after its id`);
    assert.ok(m.kind === 'tick' || m.runner.startsWith('deploy/host-services/'), `${name}: a daemon runs from deploy/host-services (workers/ or axf-hostd.mjs); a tick may adopt an existing runner`);
    if (m.kind === 'tick') assert.equal(m.adopted, true, `${name}: every tick here is an adopted schedule (adopted: true): its own installer owns the unit or cron file`);
    if (m.runner !== undefined) assert.ok(existsSync(join(ROOT, m.runner)), `${name}: runner ${m.runner} exists`);
    repoManifests.push(m);
  }
  const dir = join(ROOT, 'deploy');
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = join(dir, d.name, 'host-service.json');
    if (!existsSync(f)) continue;
    const m = JSON.parse(readFileSync(f, 'utf8'));
    const e = H.manifestErrors(m, `deploy/${d.name}/host-service.json`);
    assert.deepEqual(e, [], e.join('\n'));
    assert.ok(m.runner.startsWith(`deploy/${d.name}/`), `${f}: runner lives beside its manifest`);
    repoManifests.push(m);
  }
  const set = H.normManifests(repoManifests);
  assert.deepEqual(set.errors, []);
  assert.ok(set.manifests.some((m) => m.id === H.DEFAULTS.hostApiId), 'host-api is in the set');
});

// ── 3. the engine, replayed into the fixture ─────────────────────────────────────────────────────────────────────────
const maintenance = {
  $axf: 'host-service@1', id: 'maintenance', title: 'Maintenance monitor', kind: 'daemon', unit: 'axf-maintenance.service', plugin: 'maintenance', runner: 'deploy/maintenance/host.mjs',
  sudo: [{ cmd: '/usr/bin/docker builder prune -af', why: 'Clear Docker cache' }, { cmd: '/usr/bin/systemctl restart docker', why: 'Clear Docker cache when the cache shows as in use' }],
  health: { intervalSec: 30, timeoutMs: 5000 },
  actions: [{ id: 'clear-docker-cache', title: 'Clear Docker cache', confirm: true, timeoutMs: 600000, args: { restartDocker: { type: 'boolean' } } }, { id: 'measure', title: 'Measure disk now', modes: ['shadow', 'host'] }],
  settings: { diskAlertPct: { type: 'integer', default: 85, min: 50, max: 99, title: 'Disk alert at %' }, nightlyAt: { type: 'string', default: '03:30' } },
  replaces: [{ kind: 'thread', name: '_loop', where: 'the maintenance plugin: server/__init__.py' }],
};
const lander = { $axf: 'host-service@1', id: 'auto-lander', title: 'Auto-lander', kind: 'tick', unit: 'axf-auto-lander.service', plugin: 'gate', runner: 'deploy/auto-lander/auto-lander.mjs', health: { staleSec: 180 }, replaces: [{ kind: 'cron', name: 'axf-auto-land' }, { kind: 'cron', name: 'axf-pipeline' }] };
const out = {};

await t('manifests: defaults filled, errors named, duplicates refused, sudoers lines, control targets', () => {
  out.manifests = { hostApi: H.normManifest(H.HOST_API_MANIFEST), maintenance: H.normManifest(maintenance), lander: H.normManifest(lander) };
  assert.equal(out.manifests.maintenance.socket, '/run/axf-host/maintenance.sock');
  assert.equal(out.manifests.maintenance.health.path, '/health');
  assert.equal(out.manifests.lander.timer, 'axf-auto-lander.timer');
  assert.equal(out.manifests.lander.socket, undefined);
  assert.deepEqual(out.manifests.maintenance.actions[0].modes, ['shadow', 'host']);
  assert.equal(out.manifests.maintenance.user, 'axf-host');
  out.manifestErrors = {
    notObject: H.manifestErrors(null),
    empty: H.manifestErrors({}),
    tickWithSocket: H.manifestErrors({ ...lander, socket: '/run/axf-host/x.sock', health: { path: '/health' } }),
    daemonWithTimer: H.manifestErrors({ ...maintenance, timer: 'axf-maintenance.timer' }),
    root: H.manifestErrors({ ...maintenance, user: 'root' }),
    badUnit: H.manifestErrors({ ...maintenance, unit: 'maintenance.service', socket: '/tmp/m.sock' }),
    badSudo: H.manifestErrors({ ...maintenance, sudo: [{ cmd: 'docker ps; rm -rf /', why: '' }] }),
    badActions: H.manifestErrors({ ...maintenance, actions: [{ id: 'restart', title: 'x' }, { id: 'a', title: 'A' }, { id: 'a', title: 'B', modes: ['sideways'], args: { n: { type: 'enum' } } }] }),
    badSettings: H.manifestErrors({ ...maintenance, settings: { pct: { type: 'integer', default: 120, max: 99 }, mode: { type: 'enum', default: 'x', values: ['a'] }, flag: { type: 'boolean' } } }),
    badPaths: H.manifestErrors({ ...maintenance, runner: '/opt/axf/x.mjs', dataDir: '../x', log: 'relative.log' }),
  };
  for (const [k, v] of Object.entries(out.manifestErrors)) assert.ok(v.length, `${k} should fail`);
  out.normThrows = attempt(() => H.normManifest({ ...maintenance, kind: 'cron' }));
  assert.equal(out.normThrows.error, 'invalid_manifest');
  out.set = H.normManifests([maintenance, lander]).manifests.map((m) => m.id);
  assert.deepEqual(out.set, ['host-api', 'maintenance', 'auto-lander']);
  out.setErrors = H.normManifests([maintenance, { ...lander, id: 'maintenance' }, { ...lander, unit: 'axf-maintenance.service' }, { ...maintenance, id: 'other' }]).errors;
  assert.equal(out.setErrors.length, 3);
  out.sudoers = { hostApi: H.sudoersLines(H.HOST_API_MANIFEST), maintenance: H.sudoersLines(maintenance), lander: H.sudoersLines(lander) };
  assert.equal(out.sudoers.maintenance[0], 'axf-host ALL=(root) NOPASSWD: /usr/bin/docker builder prune -af');
  assert.deepEqual(out.sudoers.lander, []);
  out.controlTargets = { maintenance: H.controlTargets(maintenance), lander: H.controlTargets(lander) };
  assert.ok(out.controlTargets.maintenance.some((x) => x.address === 'host:maintenance/action:clear-docker-cache' && x.confirm));
  assert.ok(out.controlTargets.lander.some((x) => x.address === 'host:auto-lander/unit:run'));
  assert.ok(!out.controlTargets.maintenance.some((x) => x.address === 'host:maintenance/unit:run'));
  out.derived = H.derived('maintenance');
});

await t('endpoints from env: socket first, loopback fallback with the token, blanks remove, junk is noted', () => {
  out.endpoints = {
    defaults: H.resolveEndpoints({}),
    withToken: H.resolveEndpoints({ AXF_HOST_TOKEN: 'secret-not-in-fixture' }),
    custom: H.resolveEndpoints({ AXF_HOST_API: 'unix:///run/axf-host/other.sock', AXF_HOST_API_FALLBACK: 'http://127.0.0.1:7788/', AXF_HOST_TOKEN: 't' }),
    socketOnly: H.resolveEndpoints({ AXF_HOST_API_FALLBACK: '' }),
    httpOnly: H.resolveEndpoints({ AXF_HOST_API: 'http://host.docker.internal:7788', AXF_HOST_TOKEN: 't' }),
    junk: H.resolveEndpoints({ AXF_HOST_API: 'ftp://nope', AXF_HOST_API_FALLBACK: 'http://host:7788/v1/services' }),
    barePath: H.resolveEndpoints({ AXF_HOST_API: '/run/axf-host/api.sock' }),
  };
  assert.equal(out.endpoints.defaults.endpoints[0].kind, 'socket');
  assert.equal(out.endpoints.defaults.endpoints[1].auth, 'missing-token');
  assert.equal(out.endpoints.defaults.notes.length, 1);
  assert.equal(out.endpoints.withToken.token, 'set');
  assert.ok(!JSON.stringify(out.endpoints.withToken).includes('secret'));
  assert.equal(out.endpoints.custom.endpoints[1].url, 'http://127.0.0.1:7788');
  assert.equal(out.endpoints.socketOnly.endpoints.length, 1);
  assert.equal(out.endpoints.httpOnly.endpoints.length, 1);
  assert.equal(out.endpoints.junk.endpoints.length, 0);
  assert.equal(out.endpoints.junk.notes.length, 2);
  out.requests = { socket: H.requestFor(out.endpoints.defaults.endpoints[0], 'services/maintenance/health'), http: H.requestFor(out.endpoints.custom.endpoints[1], '/services', { token: 'TOKEN' }) };
  assert.equal(out.requests.socket.path, '/v1/services/maintenance/health');
  assert.equal(out.requests.http.headers.authorization, 'Bearer TOKEN');
});

await t('state: up / degraded / down / unknown with since carried forward', () => {
  const states = [];
  const step = (name, manifest, facts, previous, now) => { const s = H.serviceState(manifest, facts, previous, now); states.push({ name, state: s }); return s; };
  const healthOk = (at) => ({ ok: true, at, latencyMs: 4 });
  // daemon
  let s = step('daemonUp', maintenance, { unitState: 'active', enabled: true, pid: 4321, restarts: 0, activeSince: T0, health: healthOk(plus(5)), mode: 'host' }, null, plus(10));
  assert.equal(s.status, 'up'); assert.equal(s.since, plus(10));
  s = step('daemonStillUp', maintenance, { unitState: 'active', enabled: true, pid: 4321, restarts: 0, health: healthOk(plus(35)), mode: 'host' }, s, plus(40));
  assert.equal(s.since, plus(10), 'since carried forward while the status holds');
  s = step('daemonStaleHealth', maintenance, { unitState: 'active', enabled: true, pid: 4321, restarts: 0, health: healthOk(plus(35)), mode: 'host' }, s, plus(120));
  assert.equal(s.status, 'degraded'); assert.equal(s.since, plus(120));
  step('daemonHealthFailed', maintenance, { unitState: 'active', health: { ok: false, at: plus(120), message: 'disk probe failed' }, mode: 'host' }, s, plus(125)).status;
  step('daemonHealthRefused', maintenance, { unitState: 'active', health: { ok: false, at: plus(120), message: 'socket refused', code: 'host_service_down' }, mode: 'host' }, s, plus(125));
  step('daemonNoProbeYet', maintenance, { unitState: 'active', mode: 'host' }, null, plus(125));
  step('daemonRestarted', maintenance, { unitState: 'active', restarts: 3, health: healthOk(plus(130)), mode: 'host' }, { ...s, restarts: 1 }, plus(131));
  step('daemonActivating', maintenance, { unitState: 'activating', mode: 'host' }, s, plus(140));
  const down = step('daemonFailed', maintenance, { unitState: 'failed', enabled: true, mode: 'host' }, s, plus(150));
  assert.equal(down.status, 'down'); assert.equal(down.code, 'host_service_down');
  step('daemonInactive', maintenance, { unitState: 'inactive', mode: 'host' }, down, plus(160));
  step('daemonContainerMode', maintenance, { unitState: 'inactive', mode: 'container' }, null, plus(160));
  step('daemonShadowUp', maintenance, { unitState: 'active', health: healthOk(plus(160)), mode: 'shadow' }, null, plus(161));
  step('badManifestOnDisk', maintenance, { manifestError: 'manifest.sudo[0].cmd: an absolute program with fixed arguments, no shell syntax', mode: 'host' }, null, plus(161));
  step('unreachable', maintenance, { reachable: false, mode: 'host' }, down, plus(170));
  // tick
  let k = step('tickUp', lander, { unitState: 'inactive', timerState: 'active', enabled: true, lastRun: { at: plus(100), result: 'ok', durationMs: 1200 }, mode: 'host' }, null, plus(160));
  assert.equal(k.status, 'up'); assert.equal(k.timerState, 'active');
  k = step('tickStale', lander, { unitState: 'inactive', timerState: 'active', enabled: true, lastRun: { at: plus(100), result: 'ok', durationMs: 1200 }, mode: 'host' }, k, plus(100 + 181));
  assert.equal(k.status, 'degraded');
  step('tickErrored', lander, { unitState: 'inactive', timerState: 'active', lastRun: { at: plus(290), result: 'error', message: 'git fetch failed' }, mode: 'host' }, k, plus(300));
  step('tickNoRunYet', lander, { unitState: 'inactive', timerState: 'active', mode: 'host' }, null, plus(300));
  step('tickRunning', lander, { unitState: 'activating', timerState: 'active', lastRun: { at: plus(100), result: 'ok' }, mode: 'host' }, null, plus(110));
  step('tickUnitFailed', lander, { unitState: 'failed', timerState: 'active', lastRun: { at: plus(100), result: 'ok' }, mode: 'host' }, k, plus(300));
  step('tickTimerOff', lander, { unitState: 'inactive', timerState: 'inactive', lastRun: { at: plus(100), result: 'ok' }, mode: 'host' }, k, plus(300));
  step('tickContainerMode', lander, { unitState: 'inactive', timerState: 'inactive', mode: 'container' }, null, plus(300));
  out.states = states;
  out.badClock = attempt(() => H.serviceState(maintenance, {}, null, 'yesterday'));
  assert.equal(out.badClock.error, 'invalid_body');
  out.unreachable = H.unreachableStates([maintenance, lander], [{ ...down, mode: 'host' }], plus(200));
  assert.deepEqual(out.unreachable.map((x) => x.status), ['unknown', 'unknown', 'unknown']);
  assert.equal(out.unreachable[1].mode, 'host');
  out.healthItems = Object.fromEntries(states.map(({ name, state }) => [name, H.healthItem(state)]));
  assert.equal(out.healthItems.daemonUp, null);
  assert.equal(out.healthItems.daemonFailed.fix.verb, 'restart');
  assert.equal(out.healthItems.tickTimerOff.fix.verb, 'start');
  assert.equal(out.healthItems.unreachable.fix.service, 'host-api');
  assert.equal(out.healthItems.daemonContainerMode.fix, null);
  assert.equal(out.healthItems.daemonStaleHealth.push, false);
  out.summary = H.summary([states[0].state, down, k, out.unreachable[0]]);
});

await t('call results → host_service_down and the other codes, the same on REST / MCP / CLI / voice', () => {
  const cases = {
    ok: { status: 200, body: { ok: true } },
    created: { status: 201, body: {} },
    socketMissing: { error: { code: 'ENOENT', message: 'connect ENOENT /run/axf-host/api.sock' } },
    refused: { error: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:7788' } },
    fetchCause: { error: { name: 'TypeError', message: 'fetch failed', cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } } },
    aborted: { error: { name: 'AbortError', message: 'This operation was aborted' } },
    stringErr: { error: 'ETIMEDOUT' },
    oddErr: { error: { name: 'SyntaxError', message: 'Unexpected token < in JSON' } },
    serviceDown: { status: 503, body: { $axf: 'host-error@1', code: 'host_service_down', message: 'axf-maintenance.service is inactive', service: 'maintenance', unit: 'axf-maintenance.service' } },
    busy: { status: 409, body: { $axf: 'host-error@1', code: 'busy', message: 'a tick holds the lock', service: 'auto-lander', retryAfterMs: 15000 } },
    confirm: { status: 428, body: { $axf: 'host-error@1', code: 'confirm_required', message: 'Clear Docker cache needs a confirm token', service: 'maintenance', action: 'clear-docker-cache' } },
    unknownCode: { status: 418, body: { $axf: 'host-error@1', code: 'teapot', message: 'x' } },
    proxy502: { status: 502, body: '<html>bad gateway</html>' },
    badToken: { status: 401, body: 'Unauthorized' },
    plain500: { status: 500, body: 'boom' },
    nothing: null,
  };
  out.calls = Object.fromEntries(Object.entries(cases).map(([k, r]) => { const e = H.toHostError(r, { service: 'maintenance', action: k === 'confirm' ? 'clear-docker-cache' : '', endpoint: k === 'refused' ? 'http://127.0.0.1:7788' : '' }); return [k, e ? { ...e.frame(), console: e.console, answer: H.consoleAnswer(e) } : null]; }));
  assert.equal(out.calls.ok, null); assert.equal(out.calls.created, null);
  for (const k of ['socketMissing', 'refused', 'fetchCause', 'aborted', 'stringErr', 'proxy502']) { assert.equal(out.calls[k].code, 'host_service_down', k); assert.equal(out.calls[k].service, 'host-api', k); assert.equal(out.calls[k].answer.state, 'down'); assert.equal(out.calls[k].answer.cli.exit, 3); }
  assert.equal(out.calls.oddErr.code, 'internal');
  assert.equal(out.calls.serviceDown.service, 'maintenance'); assert.equal(out.calls.serviceDown.answer.rest.status, 503);
  assert.equal(out.calls.busy.retryAfterMs, 15000); assert.equal(out.calls.busy.answer.cli.exit, 5);
  assert.equal(out.calls.confirm.answer.cli.exit, 4);
  assert.equal(out.calls.unknownCode.code, 'internal');
  assert.equal(out.calls.badToken.code, 'unauthorized');
  assert.equal(out.calls.plain500.code, 'internal');
  assert.equal(out.calls.nothing.code, 'internal');
  out.errorFrame = H.errorFrame('host_service_down', 'x', { service: 'maintenance', unit: 'axf-maintenance.service', requestId: 'r1', extra: 'dropped' });
  assert.equal(out.errorFrame.extra, undefined);
  out.actionCalls = {
    ok: errs(H.actionCallErrors(maintenance, 'clear-docker-cache', { args: { restartDocker: true }, confirm: 'tok', mode: 'host' })),
    noConfirm: errs(H.actionCallErrors(maintenance, 'clear-docker-cache', { args: {}, mode: 'host' })),
    badArg: errs(H.actionCallErrors(maintenance, 'clear-docker-cache', { args: { restartDocker: 'yes', extra: 1 }, confirm: 'tok', mode: 'host' })),
    containerMode: errs(H.actionCallErrors(maintenance, 'measure', { mode: 'container' })),
    unknown: errs(H.actionCallErrors(maintenance, 'nope', {})),
    unitRestart: errs(H.actionCallErrors(maintenance, 'restart', {})),
    runOnDaemon: errs(H.actionCallErrors(maintenance, 'run', {})),
    runOnTick: errs(H.actionCallErrors(lander, 'run', {})),
  };
  assert.deepEqual(out.actionCalls.ok, []); assert.deepEqual(out.actionCalls.unitRestart, []); assert.deepEqual(out.actionCalls.runOnTick, []);
  assert.equal(out.actionCalls.noConfirm[0].error, 'confirm_required');
  assert.equal(out.actionCalls.badArg.length, 2);
  assert.equal(out.actionCalls.containerMode[0].error, 'mode_refused');
  assert.equal(out.actionCalls.unknown[0].error, 'unknown_action');
  assert.equal(out.actionCalls.runOnDaemon[0].error, 'unknown_action');
  out.valueErrors = { int: H.valueError({ type: 'integer', min: 1, max: 5 }, 7), ok: H.valueError({ type: 'integer', min: 1, max: 5 }, 3), enumBad: H.valueError({ type: 'enum', values: ['a'] }, 'b'), str: H.valueError({ type: 'string' }, 4), num: H.valueError({ type: 'number' }, NaN), unknown: H.valueError({ type: 'blob' }, 1) };
});

await t('migration: modes, guards, shadow runs and drift, cut-over order, rollback steps, mode schema', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/host-service-mode.json')), H.modeJsonSchema()), 'framework/schemas/host-service-mode.json drifted (run axf schemas)');
  assert.deepEqual(Object.keys(H.MODE_TRANSITIONS), H.MODE_EVENTS);
  for (const [from, to] of Object.values(H.MODE_TRANSITIONS)) assert.ok(H.MODES.includes(from) && H.MODES.includes(to));
  const alerts = { $axf: 'host-service@1', id: 'alerts', title: 'Alert delivery', kind: 'daemon', unit: 'axf-alerts.service', plugin: 'console', runner: 'deploy/alerts/host.mjs', replaces: [{ kind: 'thread', name: 'alerts', where: 'apps/console-web/server/alerts.py' }] };
  const terminal = { $axf: 'host-service@1', id: 'console-terminal', title: 'Terminal sessions', kind: 'daemon', unit: 'axf-console-terminal.service', plugin: 'console-terminal', runner: 'deploy/console-terminal/host.mjs', after: ['alerts'] };
  const later = { $axf: 'host-service@1', id: 'zz-later', title: 'Something a later build adds', kind: 'tick', unit: 'axf-zz-later.service', plugin: 'later', runner: 'deploy/zz-later/tick.mjs', after: ['maintenance'] };
  const mcache = { ...maintenance, actions: [{ ...maintenance.actions[0], modes: ['host'] }, maintenance.actions[1]] };
  const all = [mcache, lander, alerts, terminal, later];
  const mo = {};
  mo.plans = Object.fromEntries(H.MODES.map((mode) => [mode, { maintenance: H.modePlan(maintenance, mode), lander: H.modePlan(lander, mode) }]));
  assert.deepEqual(mo.plans.host.lander.cronFiles, ['/etc/cron.d/axf-auto-land', '/etc/cron.d/axf-pipeline']);
  assert.equal(mo.plans.host.lander.cronPresent, false); assert.equal(mo.plans.shadow.lander.cronPresent, true);
  assert.deepEqual(mo.plans.container.lander.units, []); assert.deepEqual(mo.plans.host.lander.units, ['axf-auto-lander.timer']);
  assert.equal(mo.plans.shadow.maintenance.env.AXF_HOST_MODE, 'shadow'); assert.equal(mo.plans.container.maintenance.env.AXF_HOST_MODE, 'off');
  mo.order = H.cutoverOrder(all);
  assert.deepEqual(mo.order.map((x) => x.id), ['host-api', 'maintenance', 'alerts', 'auto-lander', 'console-terminal', 'zz-later']);
  mo.cycle = attempt(() => H.cutoverOrder([{ ...alerts, after: ['console-terminal'] }, terminal]));
  assert.equal(mo.cycle.error, 'invalid_manifest');
  mo.unknownAfter = H.normManifests([{ ...terminal, after: ['nope'] }]).errors;
  assert.equal(mo.unknownAfter.length, 1);
  // the document
  const s0 = H.initialModeState(T0);
  mo.initial = s0;
  mo.norm = { junk: attempt(() => H.normModeState({ $axf: 'other@1' }, T0)), loose: H.normModeState({ rev: -1, default: 'host', services: { maintenance: { mode: 'weird', runs: -2 }, 'Bad Id': { mode: 'host' }, alerts: { mode: 'host', since: T0, rollbackOf: { from: 'shadow', at: T0, why: 'x' } } } }, T0) };
  assert.equal(mo.norm.junk.error, 'invalid_body'); assert.equal(mo.norm.loose.default, 'container'); assert.equal(mo.norm.loose.services.maintenance.mode, 'container'); assert.equal(mo.norm.loose.services['Bad Id'], undefined);
  mo.modeOf = { hostApi: H.modeOf(s0, 'host-api'), unknown: H.modeOf(s0, 'maintenance'), alerts: H.modeOf(mo.norm.loose, 'alerts') };
  // guards, step by step on maintenance
  const steps = [];
  const step = (name, fn) => { const v = attempt(fn); steps.push({ name, v }); return v; };
  const up = (at) => H.serviceState(maintenance, { unitState: 'active', health: { ok: true, at }, mode: 'shadow' }, null, at);
  let st = s0;
  step('hostApiNoMode', () => H.canChangeMode(st, H.HOST_API_MANIFEST, 'shadow'));
  step('hostFromContainer', () => H.canChangeMode(st, maintenance, 'host', {}));
  step('unknownMode', () => H.canChangeMode(st, maintenance, 'sideways', {}));
  step('shadowNoUnit', () => H.canChangeMode(st, maintenance, 'shadow', { unitInstalled: false }));
  step('shadowApiDown', () => H.canChangeMode(st, maintenance, 'shadow', { hostApiUp: false }));
  step('shadowRefusedThrows', () => H.changeMode(st, all, { id: 'maintenance', to: 'shadow', at: T0, ctx: { unitInstalled: false } }));
  step('unknownService', () => H.changeMode(st, all, { id: 'nope', to: 'shadow', at: T0 }));
  step('noClock', () => H.changeMode(st, all, { id: 'maintenance', to: 'shadow' }));
  st = step('startShadow', () => H.changeMode(st, all, { id: 'maintenance', to: 'shadow', at: T0, by: 'svc:console/brett', ctx: { unitInstalled: true, hostApiUp: true } })).state;
  assert.equal(st.rev, 1);
  step('shadowAgain', () => H.canChangeMode(st, maintenance, 'shadow', {}));
  step('cutoverTooSoon', () => H.canChangeMode(st, maintenance, 'host', { now: plus(600), state: up(plus(600)) }));
  step('cutoverNoClock', () => H.canChangeMode(st, maintenance, 'host', { state: up(plus(600)) }));
  // shadow runs and drift
  const d1 = step('driftEffects', () => H.shadowDrift('maintenance', { result: 'ok', effects: ['prune'] }, { result: 'ok', effects: [] }, plus(300)));
  step('driftNone', () => H.shadowDrift('maintenance', { result: 'ok', effects: ['measure'] }, { result: 'ok', effects: ['measure'] }, plus(300)));
  step('driftResult', () => H.shadowDrift('maintenance', { result: 'ok' }, { result: 'skipped' }, plus(300)));
  step('driftHostError', () => H.shadowDrift('maintenance', { error: 'EACCES /var/lib/docker' }, { result: 'ok' }, plus(300)));
  step('driftContainerError', () => H.shadowDrift('maintenance', { result: 'ok' }, { error: 'timeout' }, plus(300)));
  step('driftHostMissing', () => H.shadowDrift('maintenance', null, { result: 'ok' }, plus(300)));
  step('driftContainerMissing', () => H.shadowDrift('maintenance', { result: 'ok' }, null, plus(300)));
  step('driftBothMissing', () => H.shadowDrift('maintenance', null, null, plus(300)));
  step('driftNoAt', () => H.shadowDrift('maintenance', { result: 'ok' }, { result: 'ok' }));
  st = H.recordShadowRun(st, 'maintenance', { at: plus(300), drift: d1 });
  for (const k of [1, 2, 3]) st = H.recordShadowRun(st, 'maintenance', { at: plus(300 + k * 60) });
  step('afterRuns', () => st.services.maintenance);
  step('cutoverWithDrift', () => H.canChangeMode(st, maintenance, 'host', { now: plus(3000), state: up(plus(3000)) }));
  step('cutoverDriftAcceptedTooSoon', () => H.canChangeMode(st, maintenance, 'host', { now: plus(1200), state: up(plus(1200)), acceptDrift: ['d1'] }));
  step('cutoverDriftAcceptedShortWindow', () => H.canChangeMode(st, maintenance, 'host', { now: plus(1200), state: up(plus(1200)), acceptDrift: ['d1'], minShadowMs: 60000 }));
  step('cutoverFewRuns', () => H.canChangeMode(st, maintenance, 'host', { now: plus(3000), state: up(plus(3000)), acceptDrift: ['d1'], minRuns: 5 }));
  step('cutoverHostDegraded', () => H.canChangeMode(st, maintenance, 'host', { now: plus(3000), state: { status: 'degraded', reason: 'no health probe yet' }, acceptDrift: ['d1'] }));
  step('cutoverNoState', () => H.canChangeMode(st, maintenance, 'host', { now: plus(3000), acceptDrift: ['d1'] }));
  step('nextWait', () => H.migrationNext(st, all, { maintenance: { now: plus(1200), state: up(plus(1200)) } }).find((x) => x.id === 'maintenance'));
  step('backToContainer', () => H.changeMode(st, all, { id: 'maintenance', to: 'container', at: plus(1300), why: 'not yet' }).state.services.maintenance);
  st = step('cutOver', () => H.changeMode(st, all, { id: 'maintenance', to: 'host', at: plus(3000), by: 'svc:console/brett', ctx: { now: plus(3000), state: up(plus(3000)), acceptDrift: ['d1'] } })).state;
  assert.equal(st.services.maintenance.mode, 'host'); assert.equal(st.services.maintenance.rollbackOf, null);
  step('afterNeedsHost', () => H.canChangeMode(H.changeMode(st, all, { id: 'zz-later', to: 'shadow', at: plus(3001) }).state, later, 'host', { now: plus(9000), state: { status: 'up' }, minRuns: 0, modes: { maintenance: 'shadow' } }));
  step('afterSatisfied', () => H.canChangeMode(H.changeMode(st, all, { id: 'zz-later', to: 'shadow', at: plus(3001) }).state, later, 'host', { now: plus(9000), state: { status: 'up' }, minRuns: 0, modes: { maintenance: 'host' } }));
  step('afterChangeModeReadsDoc', () => H.changeMode(H.changeMode(st, all, { id: 'zz-later', to: 'shadow', at: plus(3001) }).state, all, { id: 'zz-later', to: 'host', at: plus(9000), ctx: { state: { status: 'up' }, minRuns: 0 } }).changes);
  step('actionInHostOnly', () => errs(H.actionCallErrors(mcache, 'clear-docker-cache', { confirm: 't', mode: 'shadow' })));
  step('nextDone', () => H.migrationNext(st, all).find((x) => x.id === 'maintenance').next);
  step('stepBack', () => H.changeMode(st, all, { id: 'maintenance', to: 'shadow', at: plus(4000), by: 'svc:cli', why: 'watch it again' }).state.services.maintenance);
  st = step('rollBack', () => H.changeMode(st, all, { id: 'maintenance', to: 'container', at: plus(5000), by: 'svc:console/brett', why: 'docker restart looped' })).state;
  assert.equal(st.services.maintenance.rollbackOf.from, 'host'); assert.equal(st.rev, 3);
  step('rollbackSteps', () => H.rollbackSteps(maintenance, { by: 'svc:console/brett', why: 'docker restart looped' }));
  step('rollbackStepsTick', () => H.rollbackSteps(lander, { by: 'svc:cli' }));
  step('stepBackSteps', () => H.rollbackSteps(lander, { to: 'shadow' }));
  step('tierRollback', () => H.changeMode(H.changeMode(s0, all, { ids: ['alerts', 'auto-lander'], to: 'shadow', at: T0 }).state, all, { ids: ['alerts', 'auto-lander'], to: 'container', at: plus(10), why: 'tier back' }).changes);
  step('summary', () => H.modeSummary(st, all));
  mo.steps = steps;
  assert.equal(steps.find((s) => s.name === 'hostFromContainer').v.ok, false);
  assert.equal(steps.find((s) => s.name === 'shadowRefusedThrows').v.error, 'invalid_body');
  assert.equal(steps.find((s) => s.name === 'unknownService').v.error, 'unknown_service');
  assert.equal(steps.find((s) => s.name === 'cutoverWithDrift').v.ok, false);
  assert.equal(steps.find((s) => s.name === 'cutoverDriftAcceptedShortWindow').v.ok, true);
  assert.equal(steps.find((s) => s.name === 'cutoverHostDegraded').v.ok, false);
  assert.equal(steps.find((s) => s.name === 'afterNeedsHost').v.ok, false);
  assert.equal(steps.find((s) => s.name === 'afterSatisfied').v.ok, true);
  assert.equal(steps.find((s) => s.name === 'afterChangeModeReadsDoc').v[0].to, 'host');
  assert.equal(steps.find((s) => s.name === 'actionInHostOnly').v[0].error, 'mode_refused');
  assert.equal(steps.find((s) => s.name === 'nextDone').v, 'done');
  assert.equal(steps.find((s) => s.name === 'rollbackSteps').v.steps[0].do, 'mode');
  assert.equal(steps.find((s) => s.name === 'rollbackStepsTick').v.steps.find((x) => x.do === 'cron').verify, '2 cron file(s) present');
  assert.equal(steps.find((s) => s.name === 'tierRollback').v.length, 2);
  out.migration = mo;
});

// ── 4. fixture ───────────────────────────────────────────────────────────────────────────────────────────────────────
await t('adopted schedules: a cron tick, an adopted unit, freshness off, no mode, no stop', () => {
  const reaper = { $axf: 'host-service@1', id: 'reaper', title: 'Reaper', kind: 'tick', cron: 'axf-reaper', adopted: true, plugin: 'console', runner: 'framework/cli/reaper.mjs', health: { staleSec: 900 }, log: '/var/log/axf-reaper.log' };
  const quiet = { ...reaper, id: 'token-save', cron: 'axf-claude-token-save', health: { freshness: false } };
  const landerNow = { $axf: 'host-service@1', id: 'lander', title: 'Lander', kind: 'tick', unit: 'axf-lander.service', timer: 'axf-lander.timer', adopted: true, plugin: 'gate', runner: 'deploy/lander/run.mjs' };
  const ad = {};
  ad.manifests = { reaper: H.normManifest(reaper), lander: H.normManifest(landerNow) };
  // every filled-in manifest is itself a valid manifest (the host API and the console normalise what they are handed)
  const noRunner = { ...reaper, id: 'orchestrator-tick', cron: 'axf-orchestrator-tick', runner: undefined };
  ad.manifests.noRunner = H.normManifest(noRunner);
  for (const m of [reaper, quiet, landerNow, noRunner, maintenance, lander]) assert.deepEqual(H.normManifest(H.normManifest(m)), H.normManifest(m), `${m.id}: normalising twice changes nothing`);
  for (const m of repoManifests) assert.deepEqual(H.normManifest(H.normManifest(m)), H.normManifest(m), `${m.id}: normalising twice changes nothing`);
  assert.equal(ad.manifests.reaper.unit, 'cron:axf-reaper'); assert.equal(ad.manifests.reaper.timer, undefined); assert.equal(ad.manifests.reaper.adopted, true);
  ad.errors = {
    cronWithUnit: H.manifestErrors({ ...reaper, unit: 'axf-reaper.service' }),
    cronNotAdopted: H.manifestErrors({ ...reaper, adopted: false }),
    cronDaemon: H.manifestErrors({ ...reaper, kind: 'daemon' }),
    adoptedWithSudo: H.manifestErrors({ ...landerNow, sudo: [{ cmd: '/usr/bin/docker ps', why: 'x' }] }),
    freshnessOnDaemon: H.manifestErrors({ ...maintenance, health: { freshness: false } }),
    neither: H.manifestErrors({ ...reaper, cron: undefined }),
  };
  for (const [k, v] of Object.entries(ad.errors)) assert.ok(v.length >= 1, `${k} is refused`);
  const st = (m, f, at) => H.serviceState(m, f, null, at);
  ad.states = {
    cronUp: st(reaper, { unitState: 'inactive', timerState: 'active', enabled: true, lastRun: { at: plus(100), result: 'ok' }, mode: 'container' }, plus(160)),
    cronMissing: st(reaper, { unitState: 'inactive', timerState: 'inactive', lastRun: { at: plus(100), result: 'ok' } }, plus(160)),
    cronStale: st(reaper, { unitState: 'inactive', timerState: 'active', lastRun: { at: plus(100), result: 'ok' } }, plus(100 + 901)),
    quietUp: st(quiet, { unitState: 'inactive', timerState: 'active' }, plus(160)),
    landerUp: st(landerNow, { unitState: 'inactive', timerState: 'active', enabled: true, lastRun: { at: plus(100), result: 'ok' } }, plus(160)),
  };
  assert.equal(ad.states.cronUp.status, 'up'); assert.equal(ad.states.cronUp.mode, 'host'); assert.equal(ad.states.cronUp.cron, 'axf-reaper');
  assert.equal(ad.states.cronMissing.status, 'down'); assert.equal(ad.states.cronMissing.reason, '/etc/cron.d/axf-reaper is missing');
  assert.equal(ad.states.cronStale.status, 'degraded'); assert.equal(ad.states.quietUp.status, 'up'); assert.equal(ad.states.landerUp.adopted, true);
  ad.healthItems = { cronMissing: H.healthItem(ad.states.cronMissing), cronUp: H.healthItem(ad.states.cronUp) };
  assert.equal(ad.healthItems.cronMissing.fix.kind, 'action'); assert.equal(ad.healthItems.cronUp, null);
  const errs = (list) => list.map((e) => e.code);
  ad.calls = { restartCron: errs(H.actionCallErrors(reaper, 'restart', {})), runCron: errs(H.actionCallErrors(reaper, 'run', {})), stopAdopted: errs(H.actionCallErrors(landerNow, 'stop', {})), runAdopted: errs(H.actionCallErrors(landerNow, 'run', {})) };
  assert.deepEqual(ad.calls, { restartCron: ['unknown_action'], runCron: ['unknown_action'], stopAdopted: ['unknown_action'], runAdopted: [] });
  ad.controlTargets = { reaper: H.controlTargets(reaper).map((x) => x.address), lander: H.controlTargets(landerNow).map((x) => x.address) };
  assert.deepEqual(ad.controlTargets.reaper, ['host:reaper']); assert.ok(!ad.controlTargets.lander.includes('host:lander/unit:stop'));
  ad.mode = H.canChangeMode(H.initialModeState(T0), landerNow, 'shadow', { now: T0 });
  assert.equal(ad.mode.ok, false);
  out.adopted = plain(ad);
});

await t('fixtures/host-services.json is current (run --write)', () => {
  const fixture = plain({ $axf: H.SCHEMA, note: 'Generated by framework/spec/check-host-services.mjs --write; every port answers the same manifest defaults and errors, sudoers lines, control targets, endpoints, states (with since) and call → error mappings.', in: { maintenance, lander, T0 }, out });
  if (WRITE) { writeFileSync(FIX, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`wrote ${FIX}`); return; }
  assert.ok(existsSync(FIX), 'fixtures/host-services.json missing (run --write)');
  assert.deepEqual(JSON.parse(readFileSync(FIX, 'utf8')), fixture, 'fixtures/host-services.json drifted (run --write)');
});

console.log(`✓ host-services@1: ${n} checks${repoManifests.length ? `, ${repoManifests.length} repo manifest(s)` : ''}`);
