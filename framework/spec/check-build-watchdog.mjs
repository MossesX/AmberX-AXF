#!/usr/bin/env node
/**
 * build-watchdog@1 checks: the stuck-build decision table. A build marked Building with no live session (killed 143,
 * OOM 137, failed 1, tmux or pid gone, heartbeat older than staleMin) is reset and requeued (retry) until maxRetries,
 * then goes back to Pending with a banner (give-up); a usage limit or dead login moves it to another account without
 * counting a retry; a live session, a build still starting, or an unprobed build is left alone. Golden cases live in
 * fixtures/build-watchdog.json: `decisions` replays the pure decide() on build records + probes; `records` replays
 * recoveryRecord() / normRecovery(); `settings` replays normSettings().
 *   node framework/spec/check-build-watchdog.mjs            compare the engine with the fixture
 *   node framework/spec/check-build-watchdog.mjs --write    regenerate the fixture's `out` blocks from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const FIXTURE = join(HERE, 'fixtures/build-watchdog.json');
const WRITE = process.argv.includes('--write');

const W = await import('../core/build-watchdog.mjs');
const C = await import('../plan/builds-store-core.mjs');

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
eq(fixture.$axf, 'build-watchdog-cases@1', 'fixture schema');
const NOW = fixture.now;
const settings = W.normSettings(fixture.settings);
eq(settings, W.DEFAULTS, 'the fixture runs on the default settings');

// ---------------- the registry and the schema file are current (run axf schemas)
const schemaFile = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/build-watchdog.json'), 'utf8'));
ok(same(schemaFile, W.jsonSchema()), 'framework/schemas/build-watchdog.json is current (node framework/cli/axf.mjs schemas)');
eq(schemaFile.$defs.recovery.properties.cause.enum, W.STUCK_CAUSES, 'a recovery record names a stuck cause');
eq(schemaFile.$defs.recovery.properties.action.enum, W.ACTIONS.filter((a) => a !== 'none'), 'a recovery record never carries "none"');
eq(schemaFile.$defs.decision.properties.cause.enum, W.CAUSES, 'a decision may name every cause');
eq(schemaFile.$defs.recovery.required, ['at', 'buildId', 'cause', 'action', 'attempt'], 'the record shape Brett asked for is required');
for (const k of ['at', 'buildId', 'phase', 'step', 'cause', 'exit', 'action', 'attempt', 'account', 'notified']) ok(k in schemaFile.$defs.recovery.properties, `recovery record has ${k}`);
ok(W.STUCK_CAUSES.every((c) => W.CAUSES.includes(c)), 'every stuck cause is a cause');
ok(W.RETRY_ACTIONS.every((a) => W.ACTIONS.includes(a)), 'every retry action is an action');
eq(W.REGISTRY.journalAction, 'watchdog-recover', 'the journal action');
eq([W.EXIT_CODES[143], W.EXIT_CODES[137], W.EXIT_CODES[0], W.exitCause(1), W.exitCause(2)], ['exit-killed', 'exit-oom', 'exit-clean', 'exit-failed', 'exit-failed'], 'exit codes by name');

// ---------------- the decision table
// records as the store holds them: every build goes through normBuild, so the table sees what the executor will see
const fullBuild = (b) => C.normBuild({ title: b.id, createdAt: NOW, updatedAt: NOW, ...b }, { now: NOW });
const pick = (d) => ({ stuck: d.stuck, cause: d.cause, exit: d.exit, action: d.action, attempt: d.attempt, account: d.account, excludeAccounts: d.excludeAccounts, resetStep: d.resetStep, releaseSlot: d.releaseSlot, requeue: d.requeue, status: d.status, step: d.step, phase: d.phase, banner: d.banner, notify: d.notify, note: d.note });
for (const c of fixture.decisions) {
  const b = fullBuild(c.build);
  const d = W.decide(b, c.probe, c.settings ?? settings, { now: NOW, ...(c.accounts ? { accounts: c.accounts } : {}) });
  const got = pick(d);
  if (WRITE) c.out = got; else eq(got, c.out, `decision: ${c.name}`);
  // invariants every case keeps
  ok(W.CAUSES.includes(got.cause) && W.ACTIONS.includes(got.action), `${c.name}: cause and action are registered`);
  eq(got.stuck, W.STUCK_CAUSES.includes(got.cause) && W.isMarkedRunning(b), `${c.name}: stuck = marked Building with a stuck cause`);
  eq(got.action !== 'none', got.stuck && W.normSettings(c.settings ?? settings).enabled, `${c.name}: an action exactly when stuck and the watchdog is on`);
  eq(got.action === 'none', got.status === '' && !got.releaseSlot && !got.requeue && !got.resetStep && !got.banner && !got.notify, `${c.name}: none does nothing`);
  if (got.action !== 'none') { eq(got.releaseSlot, true, `${c.name}: every fix releases the slot`); eq(!!got.notify, true, `${c.name}: every fix tells the phone`); }
  eq(got.action === 'give-up', got.status === 'pending', `${c.name}: give-up alone goes to Pending`);
  eq(got.action === 'give-up', got.banner, `${c.name}: give-up alone raises a banner item`);
  eq(got.action === 'give-up', got.notify === W.NOTIFY.gaveUp, `${c.name}: give-up alone is the alert, the rest FYIs`);
  eq(got.requeue, got.status === 'queued', `${c.name}: requeue = back to the Queue`);
  eq(W.RETRY_ACTIONS.includes(got.action) || got.action === 'retry-other-account', got.resetStep, `${c.name}: a relaunch resets the step`);
  if (got.action !== 'none') ok(got.attempt <= (c.settings ? W.normSettings(c.settings) : settings).maxRetries || got.action === 'give-up', `${c.name}: never a retry past maxRetries`);
  // a live session is never touched, whatever the exit history says
  if (c.probe.pid === true || c.probe.tmux === true) ok(got.cause === 'live' || got.cause === 'stale-heartbeat' || got.exit != null || c.probe.limit, `${c.name}: an alive process is left alone unless hung, ended or limited`);
}

// retries count only since the last progress, and stop at maxRetries whatever the cause
const base = fixture.decisions.find((c) => c.name.startsWith('killed 143')).build;
const recs = (k, at = '2026-11-16T11:50:00.000Z') => Array.from({ length: k }, (_, i) => ({ at: at.replace('50', String(50 + i)), buildId: base.id, cause: 'exit-killed', action: 'retry', attempt: i + 1 }));
eq([0, 1, 2, 3].map((k) => W.decide(fullBuild({ ...base, recoveries: recs(k) }), { exit: 143, at: NOW }, settings).action), ['retry', 'retry', 'retry', 'give-up'], 'retry, retry, retry, give up (maxRetries 3)');
eq([0, 1, 2, 3].map((k) => W.decide(fullBuild({ ...base, recoveries: recs(k) }), { exit: 143, at: NOW }, settings).attempt), [1, 2, 3, 4], 'the attempt counts the retries before it');
eq(W.decide(fullBuild({ ...base, recoveries: recs(3, '2026-11-16T09:50:00.000Z'), steps: base.steps.map((s) => ({ ...s, done: s.id === 's1', doneAt: s.id === 's1' ? '2026-11-16T10:30:00.000Z' : '' })) }), { exit: 143, at: NOW }, settings).attempt, 1, 'a step ticked since the last retry resets the count');
eq(W.decide(fullBuild({ ...base, recoveries: recs(3) }), { exit: 1, limit: 'usage', at: NOW }, settings).action, 'retry-other-account', 'a usage limit never counts a retry');
eq(W.decide(fullBuild({ ...base, recoveries: recs(3) }), { exit: 0, at: NOW }, settings).action, 'requeue', 'a missed clean end never counts a retry');
eq(W.decide(fullBuild(base), { exit: 143, at: NOW }, { maxRetries: 0 }).action, 'give-up', 'maxRetries 0: never retried');
eq(W.decide(fullBuild(base), { exit: 143, at: NOW }, { enabled: false }).action, 'none', 'watchdog off: nothing');
// the stale limit is the setting, not a constant
eq(W.decide(fullBuild(base), { pid: null, tmux: null, lastSeenAt: '2026-11-16T11:45:00.000Z', at: NOW }, { staleMin: 10 }).cause, 'stale-heartbeat', 'staleMin 10: a 15 min heartbeat is stale');
eq(W.decide(fullBuild(base), { pid: null, tmux: null, lastSeenAt: '2026-11-16T11:45:00.000Z', at: NOW }, { staleMin: 20 }).cause, 'live', 'staleMin 20: a 15 min heartbeat is fresh');
// marked running
eq(['running', 'waiting'].map((s) => W.isMarkedRunning(fullBuild({ ...base, status: s }))), [true, true], 'running and waiting are Building');
eq(['pending', 'built', 'complete', 'failed', 'blocked', 'archived'].map((s) => W.isMarkedRunning(fullBuild({ ...base, status: s }))), [false, false, false, false, false, false], 'the rest are not');
eq(W.isMarkedRunning(fullBuild({ ...base, status: 'queued' })), true, 'queued with a launch newer than its last run end: queued-running');
eq(W.isMarkedRunning(fullBuild({ ...base, status: 'queued', pipeline: { ...base.pipeline, session: '' } })), false, 'queued without a session: waiting for its turn');
eq(W.isMarkedRunning(fullBuild({ ...base, status: 'queued', pipeline: { ...base.pipeline, lastRun: { at: '2026-11-16T11:59:00.000Z', exit: 0, outcome: 'requeued', reason: 'phase-done' } } })), false, 'queued after its run ended: not running');
eq(W.isMarkedRunning(fullBuild({ ...base, deleted: true, deletedAt: NOW })), false, 'a deleted build is never touched');

// ---------------- the records
for (const c of fixture.records) {
  const b = fullBuild(c.build);
  const d = W.decide(b, c.probe, settings, { now: NOW });
  const r = W.recoveryRecord(b, d, { now: NOW, notified: c.notified ?? '' });
  const got = { record: r, line: W.recoveryLine(r, b), normAgain: W.normRecovery(r) };
  if (WRITE) c.out = got; else eq(got, c.out, `record: ${c.name}`);
  if (r) {
    eq(Object.keys(r), ['at', 'buildId', 'phase', 'step', 'cause', 'exit', 'action', 'attempt', 'account', 'notified', 'session', 'note'], `${c.name}: the record shape`);
    eq(W.normRecovery(r), r, `${c.name}: normRecovery is a fixed point`);
    ok(W.STUCK_CAUSES.includes(r.cause) && r.action !== 'none', `${c.name}: a record is a fix`);
    // on the build, through the store's normBuild: kept, in shape, journal-ready
    const kept = C.normBuild({ ...b, recoveries: [...(b.recoveries ?? []), r] }, { now: NOW });
    eq(kept.recoveries.at(-1), r, `${c.name}: the store keeps the record`);
    eq(C.validateStore({ ...C.emptyStore(NOW), builds: [kept] }).errors, [], `${c.name}: the store validates it`);
  } else eq(d.action, 'none', `${c.name}: no record when nothing was done`);
}
eq(W.normRecovery({ action: 'none', at: NOW }), null, 'none is no record');
eq(W.normRecovery({ action: 'retry' }), null, 'a record without a time is no record');
eq(W.normRecovery({ action: 'retry', at: NOW, cause: 'gremlins', attempt: -3, account: 'Bad Name', notified: 'yes' }).cause, 'unknown', 'an unknown cause reads as unknown (validateStore refuses it)');
eq(W.normRecovery({ action: 'retry', at: NOW, cause: 'exit-killed', attempt: -3, account: 'Bad Name', notified: 'yes' }), { at: NOW, buildId: '', phase: '', step: '', cause: 'exit-killed', exit: null, action: 'retry', attempt: 0, account: '', notified: '', session: '', note: '' }, 'bad fields read as empty, never invented');
eq(W.normRecoveries([{ action: 'retry', at: '2026-11-16T12:00:00.000Z', cause: 'exit-killed' }, { action: 'retry', at: '2026-11-16T11:00:00.000Z', cause: 'pid-gone' }, null, { action: 'none', at: NOW }]).map((r) => r.cause), ['pid-gone', 'exit-killed'], 'recoveries sort oldest first and drop non-records');
eq(W.normRecoveries(Array.from({ length: 70 }, (_, i) => ({ action: 'retry', at: `2026-11-16T${String(i).padStart(2, '0')}:00:00.000Z`.replace(/T(\d\d)/, (m, h) => `T${String(Math.min(23, Number(h))).padStart(2, '0')}`), cause: 'exit-killed', attempt: i }))).length, W.MAX_RECOVERIES, 'capped at MAX_RECOVERIES');

// ---------------- the settings
for (const c of fixture.settings) {
  const got = W.normSettings(c.in);
  if (WRITE) c.out = got; else eq(got, c.out, `settings: ${c.name}`);
  eq(Object.keys(got), ['enabled', 'staleMin', 'graceMin', 'maxRetries'], `${c.name}: every setting present`);
}
eq(W.normSettings(), W.DEFAULTS, 'no settings = the defaults');
eq(W.DEFAULTS.staleMin, 20, 'the default stale limit matches the build lock (LOCK_STALE_MS, 20 min)');

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`build-watchdog: fixture written (${fixture.decisions.length} decision + ${fixture.records.length} record + ${fixture.settings.length} settings cases)`); }
if (failed) { console.error(`build-watchdog: ${failed}/${n} checks failed`); process.exit(1); }
console.log(`build-watchdog: ${n}/${n} checks passed`);
