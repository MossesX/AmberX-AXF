#!/usr/bin/env node
/**
 * Orchestrator demo — the runner (driver) of a demo-run@1 (framework/spec/LIVE-DEMO.md).
 *
 * Every decision about what happens next comes from the reference core (framework/core/live-demo.mjs): the runner only
 * fires the events the core allows, at the times it allows them. Per act it:
 *   1. focuses the console on the act's target (watch-live follow + console-control focus with highlight) → `focused`
 *   2. holds the caption on screen for CAPTION_MS → `start`
 *   3. runs the act's action, watches for its expectation, records the result with its evidence → `finish`
 *   4. waits: with pause between steps on, for Next (`waiting-next`), then the gap (`cooldown`, ≥ 30 s, the core never
 *      shortens it) → `tick` → the next act's focus.
 * Brett's events (continue, toggle-pause, next, skip, stop) and the runner-level hold (pause / resume: nothing moves
 * until resume) come in through `event` (REST, MCP, CLI and voice all call it), under the same lock as the driver.
 *
 * The record is persisted after every event in the plugin data folder (data-store@1): runs/<id>.json = { run, driver }
 * and current.json = { id }. A console restart calls `ensure`, which starts a driver again for a run that isn't over;
 * an act cut off in `running` is judged by its expectation alone (pass if it holds, else fail "interrupted").
 *
 *   node runner.mjs new [--pause|--no-pause]          a new run in the overlay (fixture ids picked, nothing created yet)
 *   node runner.mjs event <type> [--pause true|false] [--why "…"] [--id <run>]    continue | toggle-pause | next | skip | stop | hold | resume
 *   node runner.mjs drive [--id <run>]                 the driver loop (spawned detached by `ensure`)
 *   node runner.mjs ensure                             start a driver for the current run when none is alive
 *   node runner.mjs state [--id <run>] | summary [--id <run>]
 * Every command prints one JSON line.
 *
 * Test only: AXF_DEMO_GAP_MS_TEST=<ms> runs the driver on a scaled clock (30 000 virtual ms pass in <ms> real ms) so a
 * dry run takes minutes, not half an hour; the record says `testClock` and the core's 30 s rule still holds on the
 * record's own times.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../../../framework/core/live-demo.mjs';
import * as P1 from './acts/queue-launch-steps.mjs';
import * as P2 from './acts/crash-watchdog-retry.mjs';
import * as P3 from './acts/ci-fix-land.mjs';
import * as P4 from './acts/die-cleanup-notify.mjs';
import { FOLDER, demoBuildId, findBuild } from './sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
export const PARTS = [P1, P2, P3, P4];
export const CAPTION_MS = 5000;
export const POLL_MS = 1000;
export const TITLE = 'Orchestrator demo: everything the Build orchestrator can do';
export const BRETT_EVENTS = ['continue', 'toggle-pause', 'next', 'skip', 'stop', 'hold', 'resume'];

// ── catalog ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The fixture ids of a run (suffix = the run's short tag). */
export const idsFor = (suffix) => ({ grid: demoBuildId('grid', suffix), crash: demoBuildId('crash', suffix), ci: demoBuildId('ci', suffix), die: demoBuildId('die', suffix) });

/** Every act, in tour order, for these ids. */
export const catalog = (ids) => PARTS.flatMap((p) => p.acts(ids));
export const handlers = Object.assign({}, ...PARTS.map((p) => p.handlers));
export const customExpects = Object.assign({}, ...PARTS.map((p) => p.expects ?? {}));
/** What the overlay lists: one line per part, then every act. */
export const outline = (ids) => PARTS.map((p) => ({ part: p.PART, title: p.TITLE, acts: p.acts(ids).map((a) => ({ id: a.id, title: a.title })) }));

// ── clock ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Real clock, or the test-only scaled clock (AXF_DEMO_GAP_MS_TEST). */
export function makeClock(env = process.env, real = () => Date.now()) {
  const test = Number(env.AXF_DEMO_GAP_MS_TEST) || 0;
  const factor = test > 0 ? core.MIN_GAP_MS / Math.max(50, test) : 1;
  const t0 = real();
  const nowMs = () => (factor === 1 ? real() : t0 + (real() - t0) * factor);
  return { factor, test: factor !== 1, nowMs, now: () => new Date(nowMs()).toISOString(), realMs: (virtualMs) => Math.max(1, Math.round(virtualMs / factor)) };
}

// ── persistence (data-store@1, the plugin data folder) ──────────────────────────────────────────────────────────────

export async function realFiles() {
  const { pluginData } = await import('../../../../framework/core/data-files.mjs');
  const d = pluginData(FOLDER);
  return { dir: d.dir, read: (rel, fb) => d.readJsonSync(rel, fb), write: (rel, doc) => d.writeJsonSync(rel, doc) };
}

export function memoryFiles() {
  const m = new Map();
  return { dir: '', read: (rel, fb) => (m.has(rel) ? JSON.parse(m.get(rel)) : structuredClone(fb)), write: (rel, doc) => m.set(rel, JSON.stringify(doc)), map: m };
}

const runFile = (id) => `runs/${id}.json`;
export const currentId = (files) => files.read('current.json', {})?.id ?? '';
export function loadRun(files, id = currentId(files)) {
  if (!id) return null;
  const doc = files.read(runFile(id), null);
  if (!doc?.run) return null;
  return { run: core.normRun(doc.run), driver: { ...defaultDriver(), ...(doc.driver ?? {}) } };
}
export function saveRun(files, rec) {
  files.write(runFile(rec.run.id), { $axf: 'orchestrator-demo-run@1', run: rec.run, driver: rec.driver });
  files.write('current.json', { id: rec.run.id });
  return rec;
}
const defaultDriver = () => ({ held: false, heldAt: '', suffix: '', ids: {}, log: [], pid: 0, beatAt: '', testClock: false, cleaned: false, cleanup: null, summary: null });

/** A cross-process lock on the run (the driver and every event take it). Stale after 30 s. */
export function withLock(files, id, fn) {
  if (!files.dir) return fn();
  const f = join(files.dir, 'runs', `${id}.lock`);
  mkdirSync(dirname(f), { recursive: true });
  for (let i = 0; ; i += 1) {
    try { closeSync(openSync(f, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(f).mtimeMs > 30000) { rmSync(f, { force: true }); continue; } } catch { continue; }
      if (i > 400) throw new Error(`demo run ${id} is locked`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { rmSync(f, { force: true }); }
}

// ── runs and events ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A new run: in the overlay, fixture ids chosen, nothing created yet. */
export function newDemoRun({ pause = true, now = new Date().toISOString(), suffix = Math.random().toString(36).slice(2, 8), testClock = false } = {}) {
  const ids = idsFor(suffix);
  const id = `demo-run-${now.slice(0, 10).replace(/-/g, '')}-${suffix}`;
  let run = core.newRun({ id, title: TITLE, acts: catalog(ids), pause, now });
  const bad = core.validateRun(run);
  if (bad.length) throw new Error(`demo run invalid: ${bad.map((b) => b.message).join('; ')}`);
  run = core.step(run, { type: 'begin', at: now });
  return { run, driver: { ...defaultDriver(), suffix, ids, testClock } };
}

/** Apply one of Brett's events (or the driver's) to the stored run. Returns the new record. */
export function applyEvent(rec, type, { at, pause, why = '', by = 'brett' } = {}) {
  const r = { run: rec.run, driver: { ...rec.driver } };
  if (type === 'hold') { if (core.TERMINAL_STATES.includes(r.run.state)) throw new core.DemoTransitionError('invalid-transition', `the run is ${r.run.state}`, { state: r.run.state, event: type }); r.driver.held = true; r.driver.heldAt = at; return r; }
  if (type === 'resume') { r.driver.held = false; r.driver.heldAt = ''; return r; }
  if (type === 'set-pause') { if (core.TERMINAL_STATES.includes(r.run.state)) return r; r.run = { ...r.run, pause: !!pause, updatedAt: at }; return r; }
  if (type === 'next' && r.run.state === 'cooldown') return r; // already counting down: Next twice is harmless
  const ev = { type, at, ...(typeof pause === 'boolean' ? { pause } : {}), ...(why ? { why } : {}), ...(type === 'stop' ? { by } : {}) };
  r.run = core.step(r.run, ev);
  if (type === 'stop' || type === 'continue') r.driver.held = false;
  return r;
}

/** State for every surface: the record, the summary, the check-list, what the caption bar shows. */
export function view(rec, nowMs = Date.now()) {
  if (!rec) return { $axf: 'orchestrator-demo-state@1', run: null, summary: null, checklist: [], caption: null, held: false, outline: [] };
  const { run, driver } = rec;
  const act = core.currentAct(run);
  const idx = run.cursor;
  const countdownMs = run.state === 'cooldown' ? Math.max(0, Date.parse(run.nextAt) - nowMs) : 0;
  return {
    $axf: 'orchestrator-demo-state@1',
    run, summary: core.summarize(run), checklist: core.checklist(run),
    caption: act && !core.TERMINAL_STATES.includes(run.state) ? { n: idx + 1, of: run.acts.length, actId: act.id, title: act.title, text: act.caption, focus: act.focus, state: run.state, nextAt: run.nextAt, countdownMs } : null,
    held: driver.held, testClock: driver.testClock, ids: driver.ids, log: driver.log.slice(-50), allowed: core.allowedEvents(run), driverAlive: pidAlive(driver.pid),
    cleanup: driver.cleanup, outline: outline(driver.ids),
  };
}

/** The summary written into the run record when it ends: the core's fold plus passed / failed / skipped per act. */
export function summaryRecord(run) {
  const results = new Map(run.results.map((r) => [r.actId, r]));
  return {
    ...core.summarize(run),
    acts: run.acts.map((a) => { const r = results.get(a.id); return { actId: a.id, title: a.title, result: r?.result ?? 'not-run', observed: r?.observed ?? '', error: r?.error ?? '', evidence: (r?.evidence ?? []).map((e) => ({ kind: e.kind, text: e.text, ref: e.ref })), focus: a.focus.address }; }),
  };
}

const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

// ── expectations ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Does the act's expectation hold now? (`fails` acts expect the failure: seeing it is the pass.) */
export async function expectationHolds(ctx, act) {
  const e = act.expect;
  const b = e.build ? findBuild(ctx.store, e.build) : null;
  switch (e.kind) {
    case 'none': return true;
    case 'status': return !!b && b.status === e.status;
    case 'step-done': return !!b?.steps?.find((s) => s.id === e.step)?.done;
    case 'step-skipped': return !!b?.steps?.find((s) => s.id === e.step)?.skip;
    case 'row': return !!b;
    case 'row-gone': return !b;
    case 'note': return !!b && (b.notes ?? []).some((n) => n.text.includes(e.text));
    case 'alert': case 'banner': return (await ctx.alerts.list()).some((a) => `${a.title ?? ''} ${a.body ?? ''}`.includes(e.text) && (!e.build || !a.meta?.build || a.meta.build === e.build));
    case 'log': return ctx.logLines().some((l) => l.includes(e.text));
    case 'custom': { const f = customExpects[e.text]; return f ? !!(await f(ctx, act)) : false; }
    default: return false;
  }
}

/** Run one act: its action, then watch for the expectation. Returns an act-result@1 (without times). */
export async function runAct(ctx, act) {
  const ev = [];
  let observed = ''; let error = '';
  try {
    const h = act.run.kind === 'custom' ? handlers[act.run.cmd] : null;
    if (act.run.kind === 'custom' && !h) throw new Error(`no handler for ${act.run.cmd}`);
    if (h) { const r = await h(ctx, act); observed = r?.observed ?? ''; ev.push(...(r?.evidence ?? [])); error = r?.error ?? ''; }
    else if (act.run.kind !== 'noop') { const r = await ctx.action(act.run); observed = r?.observed ?? `${act.run.kind} ${act.run.cmd || act.run.path} done`; }
  } catch (e) { error = e?.message || String(e); }
  if (error) return { result: 'fail', observed: observed || error, evidence: [...ev, { kind: 'error', text: error, ref: '', at: ctx.now() }], error };
  const within = act.expect.within || act.run.timeoutMs;
  const until = ctx.clock.nowMs() + within;
  let held = await expectationHolds(ctx, act);
  while (!held && ctx.clock.nowMs() < until) {
    if (ctx.isStopped?.()) return { result: 'skipped', observed: 'stopped', evidence: ev, error: '' };
    await ctx.sleep(ctx.clock.realMs(500)); held = await expectationHolds(ctx, act);
  }
  const what = `${act.expect.kind}${act.expect.build ? ` ${act.expect.build}` : ''}${act.expect.step ? ` ${act.expect.step}` : ''}${act.expect.status ? ` = ${act.expect.status}` : ''}${act.expect.text ? ` "${act.expect.text}"` : ''}`;
  if (held) return { result: 'pass', observed: act.expect.fails ? `failed as meant: ${observed}` : observed, evidence: ev, error: '' };
  const why = `expected ${what} within ${Math.round(within / 1000)} s; not seen`;
  return { result: 'fail', observed: observed || why, evidence: [...ev, { kind: 'error', text: why, ref: '', at: ctx.now() }], error: why };
}

// ── the driver ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One step of the driver: looks at the stored run and fires the next driver event when it is due. Returns
 * { rec, did, wait } (`wait` = virtual ms until it is worth looking again). Brett's events never come from here.
 */
export async function driveOnce(ctx, files, id) {
  const peek = loadRun(files, id);
  if (!peek) return { rec: null, did: 'gone', wait: 0 };
  const { run, driver } = peek;
  const at = ctx.now();
  const fire = (type, extra = {}) => withLock(files, id, () => { const cur = loadRun(files, id); if (cur.run.state !== run.state || cur.run.cursor !== run.cursor) return cur; const n = { run: core.step(cur.run, { type, at: ctx.now(), ...extra }), driver: { ...cur.driver, beatAt: ctx.now() } }; return saveRun(files, n); });
  const log = (text) => withLock(files, id, () => { const cur = loadRun(files, id); cur.driver.log = [...cur.driver.log, `${ctx.now()} ${text}`].slice(-400); saveRun(files, cur); });
  if (core.TERMINAL_STATES.includes(run.state)) {
    if (!driver.cleaned) {
      const c = ctx.cleanup ? await ctx.cleanup({ ...ctx, log: (t) => ctx.logBuffer.push(t) }, peek) : null;
      for (const t of ctx.logBuffer.splice(0)) await log(t);
      withLock(files, id, () => { const cur = loadRun(files, id); cur.driver.cleaned = true; cur.driver.cleanup = c; cur.driver.summary = summaryRecord(cur.run); saveRun(files, cur); });
    }
    return { rec: loadRun(files, id), did: 'over', wait: 0 };
  }
  if (driver.held) return { rec: peek, did: 'held', wait: POLL_MS };
  const act = core.currentAct(run);
  switch (run.state) {
    case 'idle': case 'overlay': case 'waiting-next': return { rec: peek, did: 'waiting-for-brett', wait: POLL_MS };
    case 'focusing': {
      await ctx.focus(act.focus, act);
      await log(`focus ${act.id}: ${act.focus.address || act.focus.route}`);
      return { rec: fire('focused'), did: 'focused', wait: 0 };
    }
    case 'captioned': {
      const left = Date.parse(run.enteredAt) + CAPTION_MS - ctx.clock.nowMs();
      if (left > 0) return { rec: peek, did: 'caption', wait: Math.min(left, POLL_MS) };
      return { rec: fire('start'), did: 'started', wait: 0 };
    }
    case 'running': {
      const live = { ...ctx, log: (t) => { ctx.logBuffer.push(t); }, logLines: () => [...loadRun(files, id).driver.log, ...ctx.logBuffer], isStopped: () => loadRun(files, id)?.run.state !== 'running' };
      let res;
      if (ctx.resumed) {
        // the act was cut off by a restart: judge it by its expectation alone, never run its action twice
        const held = await expectationHolds(live, act);
        res = held ? { result: 'pass', observed: 'checked after a restart: the expected state is there', evidence: [], error: '' } : { result: 'fail', observed: 'interrupted by a console restart', evidence: [], error: 'interrupted by a console restart before the act finished' };
        ctx.resumed = false;
      } else res = await runAct(live, act);
      for (const t of ctx.logBuffer.splice(0)) await log(t);
      const stillRunning = loadRun(files, id);
      if (stillRunning.run.state !== 'running' || stillRunning.run.cursor !== run.cursor) return { rec: stillRunning, did: 'superseded', wait: 0 }; // stopped while it ran
      const rec = fire('finish', { result: { ...res, startedAt: run.enteredAt, endedAt: ctx.now() } });
      await log(`${res.result} ${act.id}: ${res.observed}`);
      return { rec, did: `finished:${res.result}`, wait: 0 };
    }
    case 'cooldown': {
      const left = Date.parse(run.nextAt) - ctx.clock.nowMs();
      if (left > 0) return { rec: peek, did: 'cooldown', wait: Math.min(left, POLL_MS) };
      return { rec: fire('tick'), did: 'ticked', wait: 0 };
    }
    default: return { rec: peek, did: 'unknown-state', wait: POLL_MS };
  }
}

/** The driver loop: until the run is over (and cleaned up). */
export async function drive(ctx, files, id, { maxLoops = Infinity } = {}) {
  withLock(files, id, () => { const cur = loadRun(files, id); cur.driver.pid = process.pid; cur.driver.beatAt = ctx.now(); saveRun(files, cur); });
  const first = loadRun(files, id);
  ctx.resumed = first?.run.state === 'running';
  for (let i = 0; i < maxLoops; i += 1) {
    const r = await driveOnce(ctx, files, id);
    if (r.did === 'over' || r.did === 'gone') return r.rec;
    if (r.wait > 0) await ctx.sleep(ctx.clock.realMs(r.wait));
  }
  return loadRun(files, id);
}

// ── real context ────────────────────────────────────────────────────────────────────────────────────────────────────

const consoleUrl = (env = process.env) => `http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}`;
async function consoleCall(method, path, body, env = process.env) {
  if (env.AXF_DEMO_CONSOLE === 'off') return null;
  try {
    const r = await fetch(`${consoleUrl(env)}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(env.AXF_TOKEN ? { Authorization: `Bearer ${env.AXF_TOKEN}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json().catch(() => ({})) : null;
  } catch { return null; }
}

/** The context the real driver runs with: the builds store, data folder, fake runner, dry-run lander, alert hub, focus. */
export async function realContext({ files, rec, env = process.env } = {}) {
  const sandbox = await import('./sandbox.mjs');
  const { fakeSessions } = await import('./fake-session.mjs');
  const { dryLander } = await import('./dry-lander.mjs');
  const clock = makeClock(env);
  const data = await sandbox.realData();
  const raised = [];
  const ctx = {
    clock, now: clock.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    store: await sandbox.realStore(), data, ids: rec.driver.ids, suffix: rec.driver.suffix, runId: rec.run.id,
    sessions: fakeSessions({ dir: join(files.dir, 'sessions') }), lander: dryLander({ data }), logBuffer: [],
    alerts: {
      raise: async (a) => { raised.push(a); await consoleCall('POST', '/api/alerts', a, env); },
      resolve: async (keys) => { await consoleCall('POST', '/api/alerts/resolve', { keys }, env); },
      list: async () => { const r = await consoleCall('GET', '/api/alerts', null, env); const server = Array.isArray(r) ? r : Array.isArray(r?.alerts) ? r.alerts : []; return [...server, ...raised]; },
      raised: () => raised,
    },
    // the alert hub asks axf.notify@1 before it delivers; the hub's answer says whether it went out
    notify: async (a) => { raised.push(a); const r = await consoleCall('POST', '/api/alerts', a, env); return r ? { sent: true, alert: r } : { sent: false, why: 'the console did not answer (the notice is recorded in the run only)' }; },
    focus: async (f) => {
      // watch-live follow, then the console's own focus with highlight
      spawn(process.execPath, [join(REPO, 'framework/cli/axf.mjs'), 'focus', f.app, f.route || '', f.selector || '', '--note', f.note || 'orchestrator demo'], { stdio: 'ignore', detached: true }).unref();
      if (f.address) await consoleCall('POST', '/api/console-control/focus', { address: f.address, options: { highlightMs: 4000, expand: true }, by: 'orchestrator-demo', reason: f.note }, env);
    },
    action: async (a) => {
      if (a.kind === 'rest') return { observed: JSON.stringify(await consoleCall(a.method || 'GET', a.path, a.body, env)).slice(0, 300) };
      if (a.kind === 'console') return { observed: JSON.stringify(await consoleCall('POST', '/api/console-control/do', { verb: a.cmd, address: a.path, value: a.body, by: 'orchestrator-demo' }, env)).slice(0, 300) };
      throw new Error(`action kind ${a.kind} is not used by the orchestrator demo`);
    },
  };
  return ctx;
}

// ── settings (the plugin's own, data folder settings.json) ──────────────────────────────────────────────────────────

/** Plugin settings: the default for Pause between steps. The gap is never a setting below the core's 30 s floor. */
export function readSettings(files) {
  const s = files.read('settings.json', {}) ?? {};
  return { $axf: 'orchestrator-demo-settings@1', pauseBetweenSteps: s.pauseBetweenSteps !== false, minGapMs: core.MIN_GAP_MS };
}
export function writeSettings(files, patch) {
  const next = { ...readSettings(files), ...(typeof patch?.pauseBetweenSteps === 'boolean' ? { pauseBetweenSteps: patch.pauseBetweenSteps } : {}) };
  files.write('settings.json', { pauseBetweenSteps: next.pauseBetweenSteps });
  return readSettings(files);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

/** Start a detached driver for the current run when it isn't over and no driver is alive. */
export function ensureDriver(files, id = currentId(files)) {
  const rec = loadRun(files, id);
  if (!rec || core.TERMINAL_STATES.includes(rec.run.state) && rec.driver.cleaned) return { started: false, why: rec ? 'the run is over' : 'no run' };
  if (pidAlive(rec.driver.pid)) return { started: false, why: `driver ${rec.driver.pid} is alive` };
  const child = spawn(process.execPath, [join(HERE, 'runner.mjs'), 'drive', '--id', id], { stdio: 'ignore', detached: true, env: process.env });
  child.unref();
  return { started: true, pid: child.pid };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const cmd = argv[0] || 'state';
  const files = await realFiles();
  const id = arg(argv, '--id') || currentId(files);
  const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); return o; };
  const clock = makeClock(env);
  try {
    if (cmd === 'new') {
      const old = loadRun(files, id);
      if (old && !core.TERMINAL_STATES.includes(old.run.state)) return out({ ok: false, code: 'busy', error: `run ${old.run.id} is still ${old.run.state}: stop it first`, state: view(old) });
      const pause = argv.includes('--pause') ? true : argv.includes('--no-pause') ? false : readSettings(files).pauseBetweenSteps;
      const rec = newDemoRun({ pause, now: clock.now(), testClock: clock.test });
      saveRun(files, rec);
      return out({ ok: true, state: view(rec) });
    }
    if (cmd === 'start') {
      // Open a run and play it at once (the overlay's Continue): reuses a run still in its overlay, refuses a playing one.
      const p = argv.includes('--pause') ? true : argv.includes('--no-pause') ? false : readSettings(files).pauseBetweenSteps;
      const old = loadRun(files, id);
      if (old && !core.TERMINAL_STATES.includes(old.run.state) && old.run.state !== 'overlay') return out({ ok: false, code: 'busy', error: `run ${old.run.id} is already ${old.run.state}: stop it first`, state: view(old) });
      let rec = old && old.run.state === 'overlay' ? old : saveRun(files, newDemoRun({ pause: p, now: clock.now(), testClock: clock.test }));
      rec = withLock(files, rec.run.id, () => saveRun(files, applyEvent(loadRun(files, rec.run.id), 'continue', { at: clock.now(), pause: p })));
      return out({ ok: true, state: view(rec), driver: ensureDriver(files, rec.run.id) });
    }
    if (cmd === 'settings') {
      const p = arg(argv, '--pause');
      const s = p === undefined ? readSettings(files) : writeSettings(files, { pauseBetweenSteps: p === 'true' });
      return out({ ok: true, settings: s });
    }
    if (cmd === 'event') {
      const type = argv[1];
      if (![...BRETT_EVENTS, 'set-pause'].includes(type)) return out({ ok: false, code: 'invalid-transition', error: `unknown event ${type} (${[...BRETT_EVENTS, 'set-pause'].join(', ')})` });
      if (!id) return out({ ok: false, code: 'no-run', error: 'no demo run: start one first' });
      const p = arg(argv, '--pause');
      const rec = withLock(files, id, () => saveRun(files, applyEvent(loadRun(files, id), type, { at: clock.now(), pause: p === undefined ? undefined : p === 'true', why: arg(argv, '--why') || '', by: arg(argv, '--by') || 'brett' })));
      const d = type === 'continue' || type === 'resume' || type === 'stop' ? ensureDriver(files, id) : null;
      return out({ ok: true, state: view(rec), driver: d });
    }
    if (cmd === 'drive') {
      const rec = loadRun(files, id);
      if (!rec) return out({ ok: false, code: 'no-run', error: 'no demo run' });
      const ctx = await realContext({ files, rec, env });
      ctx.cleanup = (await import('./cleanup.mjs')).cleanupRun;
      const end = await drive(ctx, files, id);
      return out({ ok: true, state: view(end) });
    }
    if (cmd === 'ensure') return out({ ok: true, ...ensureDriver(files, id) });
    if (cmd === 'state') return out({ ok: true, state: view(loadRun(files, id)) });
    if (cmd === 'summary') { const rec = loadRun(files, id); return out({ ok: !!rec, summary: rec ? (rec.driver.summary ?? summaryRecord(rec.run)) : null, checklist: rec ? core.checklist(rec.run) : [], cleanup: rec?.driver.cleanup ?? null, ...(rec ? {} : { code: 'no-run', error: 'no demo run' }) }); }
    return out({ ok: false, code: 'usage', error: 'usage: runner.mjs new|start [--pause|--no-pause] | event <type> | drive | ensure | state | summary | settings [--pause true|false] [--id <run>]' });
  } catch (e) {
    process.exitCode = 1;
    return out({ ok: false, code: e?.code || 'error', error: e?.message || String(e) });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
