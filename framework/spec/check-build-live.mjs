#!/usr/bin/env node
/**
 * build-live@1 checks: build changes and liveness on the console live channel (framework/core/engines/build-live.mjs,
 * spec/BUILD-LIVE.md). Golden cases live in fixtures/build-live.json: `events` replays normEvent() on raw frames,
 * `invalid` replays validateEvent(), `alive` replays aliveOf(), `fold` replays fold() over a sequence of frames for one
 * build (the state after the last frame, the changed flag and the dropped reason per frame). Also: the schema file is
 * the engine's jsonSchema(), every cause / action / reason named is one the two watchdogs know (liveness adds no check
 * of its own), every normalised event validates, every folded state fits build-live-state@1, and the producers
 * (livenessEvent, changeEvent, watchdogEvent, snapshotEvent) make valid frames from the watchdog's own outputs.
 *   node framework/spec/check-build-live.mjs            compare the engine with the fixture
 *   node framework/spec/check-build-live.mjs --write    regenerate the fixture's `out` blocks from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const FIXTURE = join(HERE, 'fixtures/build-live.json');
const SCHEMA_FILE = join(ROOT, 'framework/schemas/build-live.json');
const WRITE = process.argv.includes('--write');

const L = await import('../core/engines/build-live.mjs');
const W = await import('../core/build-watchdog.mjs');
const S = await import('../core/stale-rows.mjs');
const H = await import('../core/build-hook.mjs');
const C = await import('../plan/builds-store-core.mjs');

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (a, b, what) => ok(same(a, b), `${what}:\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
eq(fixture.$axf, 'build-live-cases@1', 'fixture schema');
eq(fixture.everySec, L.DEFAULT_EVERY_SEC, 'the fixture runs on the default pass interval');
const schema = L.jsonSchema();
const stateKeys = Object.keys(schema.$defs.state.properties);
const eventKeys = Object.keys(schema.$defs.event.properties);

// ---- events: normEvent
for (const c of fixture.events) {
  const got = L.normEvent(c.in);
  if (WRITE) c.out = got;
  else eq(got, c.out, `events: ${c.name}`);
  if (got) {
    eq(L.validateEvent(got), [], `events: ${c.name}: a normalised event validates`);
    ok(Object.keys(got).every((k) => eventKeys.includes(k)) && eventKeys.every((k) => k in got), `events: ${c.name}: every schema field present, nothing else`);
    eq(L.normEvent(got), got, `events: ${c.name}: normEvent is idempotent`);
  }
}
// ---- invalid: validateEvent
for (const c of fixture.invalid) eq(L.validateEvent(c.in), c.errors, `invalid: ${c.name}`);
// ---- alive: aliveOf
for (const c of fixture.alive) {
  const got = L.aliveOf(c.in.cause, c.in.processAlive, c.in.markedRunning);
  if (WRITE) c.out = got; else eq(got, c.out, `alive: ${c.name}`);
}
// ---- fold
for (const c of fixture.fold) {
  const first = L.normEvent(c.in[0]);
  let state = L.emptyState(first?.build ?? '');
  const changed = []; const dropped = []; const states = [];
  for (const raw of c.in) {
    const r = L.fold(state, raw);
    state = r.state; changed.push(r.changed); dropped.push(r.dropped); states.push(r.state.state);
  }
  const got = { state, changed, dropped, states };
  if (WRITE) c.out = got; else eq(got, c.out, `fold: ${c.name}`);
  ok(Object.keys(state).every((k) => stateKeys.includes(k)) && stateKeys.every((k) => k in state), `fold: ${c.name}: the state has every build-live-state@1 field and nothing else`);
  ok(L.STATES.includes(state.state), `fold: ${c.name}: state is one of ${L.STATES.join(', ')}`);
  ok(state.line.length > 0 && state.line.length <= 300, `fold: ${c.name}: a line`);
  // foldAll gives the same answer as folding by hand
  const all = L.foldAll(c.in);
  eq(all.get(first.build), state, `fold: ${c.name}: foldAll agrees`);
}

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`wrote ${FIXTURE}`); }

// ---- the rule, spelled out on the fixture's scenarios
const F = Object.fromEntries(fixture.fold.map((c) => [c.name, c.out]));
const by = (needle) => Object.entries(F).find(([k]) => k.includes(needle))?.[1];
const noop = by('changes nothing');
ok(noop && same(noop.changed, [true, true, false, false]) && same(noop.dropped, ['', '', '', 'replay']), 'a repeated liveness pass changes nothing; the replayed frame is dropped');
ok(noop && noop.state.checkedAt === '2026-11-17T19:58:30.000Z' && noop.state.events === 3, 'checkedAt moves on every pass folded');
const killed = by('killed 143');
ok(killed && same(killed.states, ['running', 'broke', 'broke', 'broke', 'idle']), `killed: running → broke → … → idle (got ${killed?.states})`);
ok(killed && killed.changed[2] === false, 'a second dead pass with the same cause does not re-render');
ok(killed && killed.state.broke === null && killed.state.lastBroke?.cause === 'exit-killed' && killed.state.lastBroke.signal === 'TERM', 'back in the Queue: broke cleared, lastBroke kept with the signal');
ok(killed && killed.state.watchdog.action === '' && killed.state.recovering === false, 'once the store moved the build on, the watchdog\'s part is over');
const clean = by('clean exit');
ok(clean && same(clean.states, ['running', 'running', 'done']), `a clean exit is not broke (got ${clean?.states})`);
const hung = by('hung');
ok(hung && same(hung.states, ['stale', 'stale']) && hung.state.recovering === true, 'stale heartbeat with a process alive = stale, recovering on kill-retry');
const limit = by('usage limit');
ok(limit && same(limit.states, ['broke', 'broke']) && limit.state.recovering === true && limit.state.broke.what === 'its account hit the usage limit', 'an account stop is broke and recovering');
const gave = by('gives up');
ok(gave && gave.state.state === 'broke' && gave.state.recovering === false && gave.state.broke.what.startsWith('the watchdog gave up after 3 retries'), 'give-up is broke, not recovering');
const red = by('status failed');
ok(red && same(red.states, ['running', 'broke']) && red.state.broke.what === 'the build failed: crash-limit: 3 crashes on s3', 'status failed is broke with the store\'s note');
const done = by('done');
ok(done && same(done.states, ['done', 'done']) && done.state.alive === 'none', 'built / complete are done');
const replay = by('replay');
ok(replay && same(replay.dropped, ['', 'replay', 'replay', '']) && replay.state.alive === 'alive', 'the same id and an older seq are dropped; the snapshot folds');
const other = by('another build');
ok(other && same(other.dropped, ['', 'other-build']), 'a frame for another build is refused');
// an older frame of the same kind (by time) is dropped even with a higher seq
{
  let s = L.emptyState('late');
  s = L.fold(s, { kind: 'liveness', seq: 5, build: 'late', at: '2026-11-17T20:00:30Z', status: 'running', alive: 'alive', cause: 'live' }).state;
  const r = L.fold(s, { kind: 'liveness', seq: 6, build: 'late', at: '2026-11-17T20:00:15Z', status: 'running', alive: 'dead', cause: 'pid-gone' });
  eq(r.dropped, 'older', 'an older frame of the same kind is dropped');
  const r2 = L.fold(s, { kind: 'change', seq: 6, build: 'late', at: '2026-11-17T20:00:15Z', status: 'running', change: 'step-done', step: { id: 's2' } });
  ok(!r2.dropped && r2.state.step?.id === 's2', 'a change written before a later liveness pass still folds (per-kind time rule)');
}

// ---- stateOf table
eq(L.stateOf({ status: 'running', alive: 'alive' }), 'running', 'stateOf running');
eq(L.stateOf({ status: 'running', alive: 'unknown' }), 'running', 'stateOf running, not probed yet');
eq(L.stateOf({ status: 'queued', alive: 'alive' }), 'running', 'queued-running (dispatched, store not moved) is running');
eq(L.stateOf({ status: 'running', alive: 'stale' }), 'stale', 'stateOf stale');
eq(L.stateOf({ status: 'running', alive: 'dead', cause: 'exit-killed' }), 'broke', 'stateOf broke');
eq(L.stateOf({ status: 'running', alive: 'dead', cause: 'exit-clean' }), 'running', 'stateOf clean exit stays running');
eq(L.stateOf({ status: 'queued', alive: 'none', watchdog: { action: 'give-up' } }), 'broke', 'stateOf give-up');
eq(L.stateOf({ status: 'landed', alive: 'none' }), 'done', 'stateOf done');
eq(L.stateOf({ status: 'pending', alive: 'none' }), 'idle', 'stateOf idle');
eq(L.stateOf({ status: 'blocked', alive: 'alive' }), 'broke', 'blocked is broke even with a live session');
for (const st of C.STATUSES) ok(L.STATES.includes(L.stateOf({ status: st, alive: 'none' })), `every builds@1 status has a live state (${st})`);

// ---- liveness adds no check of its own: every word is one the watchdogs know
ok(same(schema.$defs.cause.enum, ['', ...W.CAUSES]), 'causes are build-watchdog@1\'s');
ok(same(schema.$defs.watchdogAction.enum, ['', ...W.ACTIONS]), 'watchdog actions are build-watchdog@1\'s');
ok(same(schema.$defs.stale.properties.action.enum, [...S.ACTIONS]) && same(schema.$defs.stale.properties.reason.enum, [...S.REASON_CODES]), 'stale verdicts are stale-row@1\'s');
ok(same(schema.$defs.change.enum, ['', ...H.EVENTS]), 'change events are build-hook@1\'s');
ok(same(schema.$defs.status.enum, [...C.STATUSES]), 'statuses are builds@1\'s');
for (const c of W.CAUSES) ok(L.ALIVE.includes(L.aliveOf(c, true, true)) && L.ALIVE.includes(L.aliveOf(c, false, true)), `aliveOf answers for ${c}`);
for (const c of W.STUCK_CAUSES) ok(c === 'stale-heartbeat' ? L.aliveOf(c, true, true) === 'stale' : L.aliveOf(c, true, true) === 'dead', `${c} is dead (or stale when hung)`);
ok(L.RECOVERING_ACTIONS.every((a) => W.ACTIONS.includes(a)) && !L.RECOVERING_ACTIONS.includes('give-up') && !L.RECOVERING_ACTIONS.includes('none'), 'recovering actions are the watchdog\'s relaunching ones');
ok(L.LIVE_STATUSES.every((s) => C.STATUSES.includes(s)) && W.RUNNING_STATUSES.every((s) => L.LIVE_STATUSES.includes(s)), 'live statuses cover the watchdog\'s running statuses');

// ---- producers: from the watchdog's own outputs to valid frames
{
  const now = fixture.now;
  const b = C.normBuild({ id: 'prod', title: 'Producers', status: 'running', steps: [{ id: 's1', text: 'one', model: 'Opus', done: true, doneAt: '2026-11-17T19:00:00Z' }, { id: 's2', text: 'two', model: 'Opus' }, { id: 's3', text: 'three', model: 'Opus' }], pipeline: { launchedAt: '2026-11-17T19:30:00Z', account: 'hulu0241' } }, { now, seed: 'prod' });
  const live = W.causeOf(b, { pid: true, tmux: true, lastSeenAt: '2026-11-17T19:59:30Z', at: now }, W.DEFAULTS, now);
  const e1 = L.livenessEvent(b, live, { seq: 1, at: now, decision: W.decide(b, { pid: true, tmux: true, lastSeenAt: '2026-11-17T19:59:30Z', at: now }, W.DEFAULTS, { now }), stale: S.classify({ kind: 'building', id: 'prod' }, { session: { alive: true } }) });
  ok(e1 && L.validateEvent(e1).length === 0 && e1.alive === 'alive' && e1.cause === 'live' && e1.step?.id === 's2' && e1.step.index === 2 && e1.step.total === 3 && e1.lastStep?.id === 's1' && e1.stale?.reason === 'live' && e1.watchdog.action === 'none', `livenessEvent from causeOf (${JSON.stringify(e1)})`);
  const killedProbe = { pid: false, tmux: false, exit: 143, exitKind: 'crash', at: now };
  const dead = W.causeOf(b, killedProbe, W.DEFAULTS, now);
  const e2 = L.livenessEvent(b, dead, { seq: 2, at: now });
  ok(e2 && e2.alive === 'dead' && e2.cause === 'exit-killed' && e2.exit === 143 && e2.signal === 'TERM', 'livenessEvent from a killed probe');
  const d = W.decide(b, killedProbe, W.DEFAULTS, { now });
  const rec = W.recoveryRecord(b, d, { now });
  const e3 = L.watchdogEvent({ ...b, status: 'queued' }, rec, { seq: 3 });
  ok(e3 && L.validateEvent(e3).length === 0 && e3.watchdog.action === 'retry' && e3.watchdog.attempt === 1 && e3.cause === 'exit-killed' && e3.status === 'queued', `watchdogEvent from recoveryRecord (${JSON.stringify(e3?.watchdog)})`);
  const after = { ...b, status: 'queued' };
  const ev = H.eventsFromChange ? H.eventsFromChange(b, after, { at: now, by: 'watchdog' }) : [];
  const change = ev.find((x) => x.event === 'status') ?? { event: 'status', at: now, by: 'watchdog', build: { id: 'prod', status: 'queued' } };
  const e4 = L.changeEvent(after, change, { seq: 4 });
  ok(e4 && L.validateEvent(e4).length === 0 && e4.change === 'status' && e4.by === 'store:watchdog' && e4.alive === 'none', `changeEvent from a build-event@1 (${JSON.stringify(e4)})`);
  const states = L.foldAll([e1, e2, e3, e4]);
  const st = states.get('prod');
  ok(st && st.state === 'idle' && st.lastBroke?.cause === 'exit-killed' && st.events === 4, `the four producers fold (${st?.state}, ${st?.lastBroke?.cause}, ${st?.events})`);
  const e5 = L.snapshotEvent(st, { seq: 5, at: now });
  ok(e5 && L.validateEvent(e5).length === 0 && e5.kind === 'snapshot' && e5.status === 'queued', 'snapshotEvent from a state');
  const snap = L.snapshot(states, { at: now });
  ok(snap.$axf === L.SNAPSHOT && snap.seq === 4 && snap.everySec === 15 && snap.builds.length === 1 && Object.keys(snap).every((k) => k in schema.$defs.snapshot.properties), 'snapshot wraps the states');
  const e6 = L.fold(st, e5);
  ok(e6.changed === false && !e6.dropped, 'a snapshot equal to the state folds without a change');
}
// ---- channel staleness
ok(L.channelStale('', fixture.now) && L.channelStale('2026-11-17T19:59:00Z', fixture.now) && !L.channelStale('2026-11-17T19:59:40Z', fixture.now), 'the channel is stale after three silent passes');

// ---- the schema file is current
const onDisk = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'));
ok(same(onDisk, schema), 'framework/schemas/build-live.json equals jsonSchema() (run: node framework/cli/axf.mjs schemas)');
ok(same(L.REGISTRY.kinds, L.KINDS) && L.REGISTRY.sseEvent === 'build-live' && L.REGISTRY.everySec === 15, 'registry snapshot');

console.log(`check-build-live: ${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
