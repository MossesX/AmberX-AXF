#!/usr/bin/env node
/**
 * demo-run@1 checks: the guided live demo's state machine (framework/core/live-demo.mjs). Golden transitions live in
 * fixtures/live-demo.json: `runs` replays event lists on a seed run and records every state, cursor and nextAt;
 * `errors` replays sequences that must be refused and records the error code; `norm` replays normRun on raw records.
 *   node framework/spec/check-live-demo.mjs            compare the engine with the fixture
 *   node framework/spec/check-live-demo.mjs --write    regenerate the fixture's `out` blocks from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const FIXTURE = join(HERE, 'fixtures/live-demo.json');
const WRITE = process.argv.includes('--write');

const D = await import('../core/live-demo.mjs');

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throwsCode = (fn, code, what) => { try { fn(); ok(false, `${what}: expected ${code}, nothing thrown`); return null; } catch (e) { ok(e instanceof D.DemoTransitionError && e.code === code, `${what}: expected ${code}, got ${e.code ?? e.message}`); return e; } };

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
eq(fixture.$axf, 'live-demo-cases@1', 'fixture schema');
const NOW = fixture.now;
const T = (s) => new Date(Date.parse(NOW) + Number(s) * 1000).toISOString(); // seconds after NOW

// ---------------- the schema file is current (axf schemas)
const schemaFile = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/live-demo.json'), 'utf8'));
ok(same(schemaFile, D.jsonSchema()), 'framework/schemas/live-demo.json is current (node framework/cli/axf.mjs schemas)');
eq(schemaFile.$defs.run.properties.state.enum, D.STATES, 'the schema names every state');
eq(schemaFile.$defs.event.properties.type.enum, D.EVENTS, 'the schema names every event');
eq(schemaFile.$defs.result.properties.result.enum, D.RESULTS, 'pass / fail / skipped');
eq(schemaFile.$defs.run.properties.minGapMs.minimum, 30000, 'the schema holds the 30 s floor');
eq(D.MIN_GAP_MS, 30000, 'MIN_GAP_MS is 30 s');
eq(schemaFile.$defs.act.required, ['id', 'title', 'caption', 'focus', 'run', 'expect'], 'the act shape Brett asked for');
ok(D.STATES.every((s) => Array.isArray(D.ALLOWED[s])), 'every state has an allowed list');
ok(Object.values(D.ALLOWED).flat().every((e) => D.EVENTS.includes(e)), 'every allowed event is an event');
eq(D.TERMINAL_STATES.map((s) => D.ALLOWED[s]), [['tick'], ['tick']], 'terminal states accept nothing but tick');
eq(D.REGISTRY.states, D.STATES, 'the registry snapshot carries the states');

// ---------------- the seed run
const seed = D.normRun(fixture.seed, { now: NOW });
eq(D.validateRun(seed), [], 'the seed run is valid');
eq(seed.state, 'idle', 'a new run is idle');
eq(seed.cursor, -1, 'cursor −1 before the first act');
eq(seed.minGapMs, 30000, 'the seed runs on the 30 s gap');
eq(D.normRun(seed, { now: NOW }), seed, 'normRun is a fixed point');
eq(D.newRun({ id: seed.id, title: seed.title, acts: fixture.seed.acts, now: NOW }), seed, 'newRun = normRun of an idle record');

// the gap never goes lower
eq([0, 1, 29999, '5000', null, undefined, -1, 'soon'].map((v) => D.normGap(v)), [30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000], 'anything below 30 s reads as 30 s');
eq([30000, 45000, '60000'].map((v) => D.normGap(v)), [30000, 45000, 60000], 'bigger gaps stay');
eq(D.normRun({ ...fixture.seed, minGapMs: 1000 }, { now: NOW }).minGapMs, 30000, 'a run asking for 1 s gets 30 s');

// ---------------- golden transitions
const evs = (list) => list.map((e) => ({ ...e, at: typeof e.at === 'number' ? T(e.at) : e.at }));
for (const c of fixture.runs) {
  const start = D.normRun({ ...fixture.seed, ...(c.seed ?? {}) }, { now: NOW });
  const r = D.replay(start, evs(c.events));
  const got = { trace: r.trace, error: r.error, final: { state: r.run.state, cursor: r.run.cursor, pause: r.run.pause, nextAt: r.run.nextAt, startedAt: r.run.startedAt, endedAt: r.run.endedAt, stopped: r.run.stopped, results: r.run.results.map((x) => ({ actId: x.actId, result: x.result, observed: x.observed, durationMs: x.durationMs })) }, summary: D.summarize(r.run), checklist: D.checklist(r.run).map((l) => `${l.mark} ${l.title}`) };
  if (WRITE) c.out = got; else eq(got, c.out, `run: ${c.name}`);
  // invariants every replay keeps
  eq(D.validateRun(r.run), [], `${c.name}: the run stays valid`);
  eq(D.normRun(r.run, { now: NOW }), r.run, `${c.name}: the run stays normalized`);
  for (const t of r.trace) ok(D.STATES.includes(t.state), `${c.name}: ${t.state} is a state`);
  for (let i = 1; i < r.trace.length; i++) ok(Date.parse(r.trace[i].at) >= Date.parse(r.trace[i - 1].at), `${c.name}: events are in time order`);
  // every cooldown entry sets nextAt exactly one gap later and nothing leaves it earlier
  for (let i = 0; i < r.trace.length; i++) {
    const t = r.trace[i];
    if (t.state === 'cooldown' && (i === 0 || r.trace[i - 1].state !== 'cooldown')) {
      eq(t.nextAt, new Date(Date.parse(t.at) + start.minGapMs).toISOString(), `${c.name}: nextAt = entry + minGapMs`);
      const leave = r.trace.slice(i + 1).find((x) => x.state !== 'cooldown');
      if (leave && leave.state !== 'stopped') ok(Date.parse(leave.at) >= Date.parse(t.nextAt), `${c.name}: nothing leaves the cooldown before nextAt (left at ${leave.at}, gap ends ${t.nextAt})`);
    }
  }
  // pause on: every finish lands in waiting-next; pause off: in cooldown
  for (let i = 0; i < r.trace.length; i++) if (r.trace[i].event === 'finish') { const before = i ? r.trace[i - 1] : null; void before; ok(['waiting-next', 'cooldown'].includes(r.trace[i].state), `${c.name}: finish goes to waiting-next or cooldown`); }
  // results cover exactly the acts up to the cursor when done
  if (r.run.state === 'done') { eq(r.run.results.length, r.run.acts.length, `${c.name}: done = every act has a result`); eq(got.summary.remaining, 0, `${c.name}: nothing remains when done`); }
  eq(got.summary.done, got.summary.pass + got.summary.fail + got.summary.skipped, `${c.name}: done = pass + fail + skipped`);
  eq(got.summary.total, r.run.acts.length, `${c.name}: total = acts`);
  eq(got.summary.failed.length, got.summary.fail, `${c.name}: the failed list names every failure`);
  if (r.run.state === 'stopped') { ok(!!r.run.stopped && r.run.endedAt === r.run.stopped.at, `${c.name}: a stopped run says who and when`); }
}

// ---------------- refused transitions
for (const c of fixture.errors) {
  const start = D.normRun({ ...fixture.seed, ...(c.seed ?? {}) }, { now: NOW });
  const r = D.replay(start, evs(c.events));
  const got = { reached: r.run.state, error: r.error };
  if (WRITE) c.out = got; else eq(got, c.out, `error: ${c.name}`);
  ok(r.error && D.ERROR_CODES.includes(r.error.code), `${c.name}: refused with a known code`);
}
// a direct look at each code
const idle = seed;
throwsCode(() => D.step(idle, { type: 'next', at: NOW }), 'invalid-transition', 'next in idle');
throwsCode(() => D.step(idle, { type: 'begin' }), 'bad-time', 'an event without a time');
throwsCode(() => D.step(idle, { type: 'dance', at: NOW }), 'invalid-transition', 'an unknown event');
throwsCode(() => D.step({ ...idle, state: 'limbo' }, { type: 'begin', at: NOW }), 'invalid-transition', 'an unknown state');
throwsCode(() => D.step(D.step(idle, { type: 'begin', at: T(1) }), { type: 'continue', at: NOW }), 'bad-time', 'an event earlier than the state entry');
const overlay = D.step(idle, { type: 'begin', at: NOW });
const focusing = D.step(overlay, { type: 'continue', at: T(1) });
const captioned = D.step(focusing, { type: 'focused', at: T(2) });
const running = D.step(captioned, { type: 'start', at: T(3) });
throwsCode(() => D.step(running, { type: 'finish', at: T(4), result: { result: 'maybe' } }), 'bad-result', 'finish with an unknown result');
throwsCode(() => D.step(running, { type: 'finish', at: T(4) }), 'bad-result', 'finish without a result');
const noActs = D.step(D.normRun({ ...fixture.seed, acts: [] }, { now: NOW }), { type: 'begin', at: NOW });
throwsCode(() => D.step(noActs, { type: 'continue', at: T(1) }), 'no-act', 'continue with no acts');
const waiting = D.step(running, { type: 'finish', at: T(5), result: { result: 'pass', observed: 'row appeared' } });
eq(waiting.state, 'waiting-next', 'pause on: finish waits for Next');
const cooldown = D.step(waiting, { type: 'next', at: T(6) });
eq(cooldown.state, 'cooldown', 'Next starts the gap');
eq(cooldown.nextAt, T(36), 'the gap ends 30 s after Next');
throwsCode(() => D.advance(cooldown, T(20)), 'too-early', 'advance 16 s early');
throwsCode(() => D.advance(cooldown, T(35.999)), 'too-early', 'advance 1 ms early');
eq(D.step(cooldown, { type: 'tick', at: T(20) }), cooldown, 'a tick before nextAt changes nothing');
eq(D.step(cooldown, { type: 'tick', at: T(36) }).state, 'focusing', 'a tick at nextAt moves to the next act');
eq(D.advance(cooldown, T(36)).state, 'focusing', 'advance at nextAt = the tick');
eq(D.step(cooldown, { type: 'tick', at: T(36) }).cursor, 1, 'the next act is current');
throwsCode(() => D.advance(waiting, T(36)), 'invalid-transition', 'advance outside cooldown');
// pause off: finish goes straight to the gap
throwsCode(() => D.step(running, { type: 'toggle-pause', at: T(3) }), 'invalid-transition', 'toggle-pause while running');
const runningOff = D.step(D.step(D.step(D.step(idle, { type: 'begin', at: NOW }), { type: 'continue', at: T(1), pause: false }), { type: 'focused', at: T(2) }), { type: 'start', at: T(3) });
eq(runningOff.pause, false, 'Continue with pause off records it');
eq(D.step(runningOff, { type: 'finish', at: T(5), result: { result: 'fail', observed: 'exit 143', error: 'killed' } }).state, 'cooldown', 'pause off: finish goes straight to cooldown');
eq(D.step(runningOff, { type: 'finish', at: T(5), result: { result: 'fail' } }).nextAt, T(35), 'pause off: the gap still holds 30 s');
// toggle while waiting / in the gap applies from the next finish
eq(D.step(waiting, { type: 'toggle-pause', at: T(5) }).pause, false, 'toggle in waiting-next');
eq(D.step(waiting, { type: 'toggle-pause', at: T(5) }).state, 'waiting-next', 'toggle never moves the state');
eq(D.step(cooldown, { type: 'toggle-pause', at: T(7), pause: true }).pause, true, 'toggle may set the flag outright');
// stop while running records the act as skipped with why
const stoppedMid = D.step(running, { type: 'stop', at: T(4), by: 'brett', why: 'seen enough' });
eq([stoppedMid.state, stoppedMid.stopped, stoppedMid.results.map((r) => [r.result, r.observed])], ['stopped', { at: T(4), by: 'brett', why: 'seen enough' }, [['skipped', 'stopped: seen enough']]], 'stop mid-act');
eq(D.summarize(stoppedMid).remaining, seed.acts.length - 1, 'a stopped run counts what remains');
throwsCode(() => D.step(stoppedMid, { type: 'begin', at: T(5) }), 'invalid-transition', 'nothing restarts a stopped run');
eq(D.step(stoppedMid, { type: 'tick', at: T(99) }), stoppedMid, 'a tick on a terminal run is a no-op');
// skip records a skipped result and starts the gap
const skippedRun = D.step(focusing, { type: 'skip', at: T(2) });
eq([skippedRun.state, skippedRun.results[0].result, skippedRun.results[0].observed, skippedRun.nextAt], ['cooldown', 'skipped', 'skipped by brett', T(32)], 'skip → skipped + gap');
// the result records evidence and the failure text; durations come from the times
const failed1 = D.step(running, { type: 'finish', at: T(9), result: { result: 'fail', observed: 'exit 1 after 6 s', error: 'claude failed', evidence: [{ kind: 'log', text: 'exit 1', ref: 'logs/demo-crash.log' }, { kind: 'banner', text: 'Build demo-crash crashed' }, { text: '' }] } });
eq(failed1.results[0], { actId: seed.acts[0].id, result: 'fail', startedAt: T(3), endedAt: T(9), durationMs: 6000, observed: 'exit 1 after 6 s', evidence: [{ kind: 'log', text: 'exit 1', ref: 'logs/demo-crash.log', at: '' }, { kind: 'banner', text: 'Build demo-crash crashed', ref: '', at: '' }], error: 'claude failed' }, 'a fail result with its evidence');
eq(D.summarize(failed1).failed, [{ actId: seed.acts[0].id, title: seed.acts[0].title, observed: 'exit 1 after 6 s', error: 'claude failed' }], 'the summary says what failed');
eq(D.checklist(failed1)[0].mark, '✗', 'a failed act is marked ✗');
eq(D.checklist(waiting)[0].mark, '✓', 'a passed act is crossed off');
eq(D.checklist(focusing)[0].mark, '▶', 'the current act is marked');
eq(D.checklist(focusing)[1].mark, '·', 'an act to come is a dot');
// allowedEvents for the overlay's buttons
eq(D.allowedEvents(overlay), ['continue', 'toggle-pause', 'stop'], 'overlay: Continue, Pause, Stop');
eq(D.allowedEvents(waiting), ['next', 'toggle-pause', 'stop'], 'waiting-next: Next, Pause, Stop');
eq(D.allowedEvents(cooldown), ['toggle-pause', 'stop'], 'cooldown: Pause, Stop (the gap cannot be cut short)');
eq(D.allowedEvents(stoppedMid), [], 'stopped: nothing');

// ---------------- the sandbox: every act touches demo- builds only
eq(['demo-crash', 'demo-a1', 'demo-'.padEnd(80, 'x'), 'demo-'.padEnd(81, 'x')].map(D.isDemoBuildId), [true, true, true, false], 'demo build ids: up to 80 characters');
eq(['crash', 'demo', 'Demo-crash', 'guided-live-demo-test-watch-orchestrator', ''].map(D.isDemoBuildId), [false, false, false, false, false], 'anything else is not');
const real = D.normRun({ ...fixture.seed, acts: [{ ...fixture.seed.acts[0], builds: ['guided-live-demo-test-watch-orchestrator'] }] }, { now: NOW });
eq(D.validateRun(real).map((e) => e.code), ['not-demo-build'], 'an act on a real build is refused');
const realExpect = D.normRun({ ...fixture.seed, acts: [{ ...fixture.seed.acts[0], expect: { kind: 'status', build: 'skins', status: 'queued' } }] }, { now: NOW });
eq(D.validateRun(realExpect).map((e) => e.code), ['not-demo-build'], 'an expectation on a real build is refused too');
eq(D.normAct(fixture.seed.acts[0]).builds.every(D.isDemoBuildId), true, 'the seed acts name demo builds');

// ---------------- normalization cases
for (const c of fixture.norm) {
  const got = { run: D.normRun(c.in, { now: NOW }), errors: D.validateRun(D.normRun(c.in, { now: NOW })) };
  if (WRITE) c.out = got; else eq(got, c.out, `norm: ${c.name}`);
  eq(D.normRun(got.run, { now: NOW }), got.run, `${c.name}: fixed point`);
}
eq(D.normAction({ kind: 'teleport', cmd: 'x' }).kind, 'custom', 'an unknown action kind reads as custom');
eq(D.normAction(null), { kind: 'noop', cmd: '', args: [], method: '', path: '', body: null, timeoutMs: 60000 }, 'junk reads as noop');
eq(D.normAction({ kind: 'cli', timeoutMs: 10 }).timeoutMs, 60000, 'a timeout under 1 s reads as the default');
eq(D.normExpect({ kind: 'status', build: 'demo-x', status: 'queued', fails: 'yes' }), { kind: 'status', build: 'demo-x', step: '', status: 'queued', text: '', within: 0, fails: false }, 'an expectation in shape');
eq(D.normResult({ actId: 'a', result: 'pass', startedAt: NOW, endedAt: T(4) }).durationMs, 4000, 'duration from the times');
eq(D.normResult({ actId: 'a', result: 'nope' }), null, 'an unknown result is no result');
eq(D.normResult({ result: 'pass' }), null, 'a result without an act is no result');

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`wrote ${FIXTURE}`); }
console.log(`${failed ? 'FAIL' : 'ok'} live-demo: ${n - failed}/${n} checks`);
process.exit(failed ? 1 : 0);
