#!/usr/bin/env node
/**
 * done-means-merged@1 checks (framework/spec/DONE-MEANS-MERGED.md): the records on builds@1 (attempt@1, failure, landed,
 * escalation), the status guard (landed / built / complete are refused without a merged PR, CI green on the merge commit
 * and the verify), the one-off migration (built / complete that cannot prove a merge → landing / fixing, nothing lost)
 * and the retry ladder (retry-ladder.mjs). Golden cases live in fixtures/done-means-merged.json.
 *   node framework/spec/check-done-means-merged.mjs            compare the engines with the fixture
 *   node framework/spec/check-done-means-merged.mjs --write    regenerate the fixture's `out` blocks from the engines
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures/done-means-merged.json');
const WRITE = process.argv.includes('--write');

const BP = await import('../core/build-pipeline.mjs');
const core = await import('../plan/builds-store-core.mjs');
const merge = await import('../plan/builds-merge-core.mjs');
const RL = existsSync(join(HERE, '../core/retry-ladder.mjs')) ? await import('../core/retry-ladder.mjs') : null;

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
eq(fixture.$axf, 'done-means-merged@1', 'fixture schema');
const AT = fixture.at;

// ---------------- the vocabulary
eq(BP.FAILURE_KINDS, ['crash', 'ci-red', 'clash', 'push-fail', 'stalled', 'fell-to-pending'], 'failure kinds');
eq(BP.DONE_STATUSES, ['fixing', 'landing', 'landed', 'escalated'], 'the statuses this contract adds');
for (const s of BP.DONE_STATUSES) ok(core.STATUSES.includes(s), `builds@1 STATUSES carries ${s}`);
ok(core.FINISHED.includes('landing') && core.FINISHED.includes('landed'), 'landing and landed count as finished work');

// ---------------- records: normalised and kept by normBuild
for (const c of fixture.records) {
  const got = { attempts: BP.normAttempts(c.in.attempts), failure: BP.normFailure(c.in.failure), landed: BP.normLanded(c.in.landed), escalation: BP.normEscalation(c.in.escalation) };
  if (WRITE) c.out = got; else eq(got, c.out, `record: ${c.name}`);
  const b = core.normBuild({ id: 'x', title: 'x', status: 'fixing', steps: [], ...c.in });
  eq({ attempts: b.attempts ?? [], failure: b.failure ?? null, landed: b.landed ?? null, escalation: b.escalation ?? null }, got, `normBuild keeps the records: ${c.name}`);
  const again = core.normBuild(b);
  eq({ attempts: again.attempts ?? [], failure: again.failure ?? null, landed: again.landed ?? null, escalation: again.escalation ?? null }, got, `normBuild is idempotent on them: ${c.name}`);
  ok(got.attempts.every((a, i) => a.n === i + 1), `attempt numbers are dense: ${c.name}`);
}
eq(BP.fromAutoLanderAttempt({ build: 'b', kind: 'red-ci', n: 2, account: 'w-max', session: 's', head: 'h', pr: 710, result: 'failed', log: 'android / check-theme', at: AT, endedAt: AT }), { n: 2, kind: 'ci-red', strategy: 'fix', fixStrategy: 'targeted', model: '', account: 'w-max', session: 's', step: '', head: 'h', pr: 710, startedAt: AT, endedAt: AT, result: 'failed', log: '', note: 'android / check-theme', source: 'auto-lander' }, 'an auto-lander red-ci attempt folds in as ci-red / fix');
eq(BP.fromAutoLanderAttempt({ kind: 'clash', n: 1, result: 'ok', at: AT }).strategy, 'merge-main', 'an auto-lander clash attempt is merge-main');
eq(BP.normAttempt({ kind: 'nope', result: 'nope', strategy: 'nope' }), BP.normAttempt({ kind: 'crash', result: 'failed', strategy: 'retry' }), 'bad enums fall to the safe side');
eq(BP.normAttempts(Array.from({ length: 70 }, (_, i) => ({ kind: 'crash', n: i + 1, result: 'failed' }))).length, BP.ATTEMPTS_MAX, 'at most 60 attempts kept');

// ---------------- the guard
for (const c of fixture.guard) {
  const got = BP.guardStatus(c.in.build, c.in.to);
  if (WRITE) c.out = got; else eq(got, c.out, `guard: ${c.name}`);
  ok(got.ok || got.why.length > 10, `guard: ${c.name}: a refusal says why`);
}
ok(['landed', 'built', 'complete'].every((to) => !BP.guardStatus({ status: 'landing', pr: '#1', steps: [] }, to).ok), 'no proof: none of landed / built / complete is allowed');
ok(['pending', 'queued', 'running', 'fixing', 'escalated', 'archived'].every((to) => BP.guardStatus({ status: 'landing' }, to).ok), 'the other statuses need no proof');

// ---------------- the migration
for (const c of fixture.migrate) {
  const r = BP.migrateDone(c.in, { at: AT });
  const got = { status: r.build.status, failure: r.build.failure ?? null, landed: r.build.landed ?? null, change: r.change, noted: r.build.notes?.length !== (c.in.notes?.length ?? 0) };
  if (WRITE) c.out = got; else eq(got, c.out, `migrate: ${c.name}`);
  eq(r.build.id, c.in.id, `migrate keeps the id: ${c.name}`);
  eq((r.build.steps ?? []).length, (c.in.steps ?? []).length, `migrate keeps the steps: ${c.name}`);
  if (r.change && r.change.from !== r.change.to) ok(got.noted, `migrate: ${c.name}: a moved record says why in a note`);
  // the live merge never undoes the migration (a deleted record is never shown, so its status is not settled)
  if (!r.build.deleted) { const settled = core.normBuild(r.build); merge.settleStatus(settled, AT); eq(settled.status, r.build.status, `liveStatus keeps the migrated status: ${c.name}`); }
}
{
  const store = core.normalizeStore({ $axf: 'builds@1', rev: 3, builds: fixture.migrate.map((c) => ({ ...c.in, profiles: ['all'], order: { all: 0 } })) });
  const r = BP.migrateDoneStore(store, { at: AT });
  const got = { moved: r.report.moved.map((m) => `${m.id}:${m.from}>${m.to}`), unprovable: r.report.unprovable, meta: r.store.meta.doneMeansMerged };
  if (WRITE) fixture.store = got; else eq(got, fixture.store, 'migrateDoneStore report');
  eq(r.store.builds.length, store.builds.length, 'the migration drops no record');
  eq(core.validateStore(core.normalizeStore(r.store)).errors, [], 'the migrated store is a valid builds@1');
  eq(core.normalizeStore(r.store).meta.doneMeansMerged, r.store.meta.doneMeansMerged, 'normalizeStore keeps the migration record');
  const twice = BP.migrateDoneStore(core.normalizeStore(r.store), { at: AT });
  eq(twice.report.moved, [], 'running the migration twice moves nothing more');
}

// ---------------- exit transition and tabs under the contract
eq(BP.nextStatusOnExit({ exit: 0, stepsLeft: 0 }).status, 'landing', 'every step done ends in landing, never built');
eq(BP.STATUS_AFTER.finished, 'landing', 'STATUS_AFTER.finished is landing');
eq(['fixing', 'landing', 'landed', 'escalated', 'built'].map((s) => BP.tabOf({ status: s, steps: [] })), ['active', 'complete', 'archive', 'errors', 'complete'], 'tabs: fixing active, landing with built, landed archived, escalated errors');
ok(BP.isLive({ status: 'fixing' }) && !BP.canArchive({ status: 'fixing' }) && !BP.canDelete({ status: 'fixing' }), 'a fixing build is live: never archived or deleted underneath');
eq(merge.liveStatus({ status: 'running', pr: '#5', steps: [{ done: true }] }), 'landing', 'liveStatus: all done + PR = landing');
eq(merge.liveStatus({ status: 'landing', pr: '#5', mergedAt: AT, steps: [{ done: true }] }), 'landed', 'liveStatus: merged = landed');
eq(merge.liveStatus({ status: 'landed', pr: '#5', mergedAt: AT, steps: [{ done: true }] }), 'landed', 'liveStatus: landed stays landed (complete only through the verify)');

// ---------------- the retry ladder (s3)
if (RL && fixture.ladder) {
  for (const c of fixture.ladder) {
    const got = RL.nextStrategy(c.in.attempts, c.in.failure, c.in.policy, { at: c.in.at ?? AT, ...(c.in.ctx ?? {}) });
    if (WRITE) c.out = got; else eq(got, c.out, `ladder: ${c.name}`);
    ok(BP.STRATEGIES.includes(got.strategy), `ladder: ${c.name}: strategy is a rung`);
    ok(got.escalate === (got.strategy === 'escalate'), `ladder: ${c.name}: escalate flag follows the strategy`);
    ok(got.reason.length > 10, `ladder: ${c.name}: says why`);
    const again = RL.nextStrategy(c.in.attempts, c.in.failure, c.in.policy, { at: c.in.at ?? AT, ...(c.in.ctx ?? {}) });
    eq(again, got, `ladder: ${c.name}: deterministic`);
    // a rung that failed is never used again for the same kind
    const used = (c.in.attempts ?? []).filter((a) => a.kind === (c.in.failure?.kind ?? '') && ['failed', 'timeout'].includes(a.result)).map((a) => RL.rungOf(a));
    if (!got.escalate && got.strategy !== 'retry') ok(!used.includes(RL.rungOf(got)), `ladder: ${c.name}: never repeats a failed rung (${RL.rungOf(got)})`);
  }
  for (const c of fixture.escalations ?? []) {
    const got = RL.escalationOf(c.in.attempts, c.in.failure, { at: AT, head: c.in.head ?? '' });
    if (WRITE) c.out = got; else eq(got, c.out, `escalation: ${c.name}`);
    eq(BP.normEscalation(got), got, `escalation: ${c.name}: is a normalised escalation record`);
  }
  // walk every kind from nothing to escalate: finite, every rung different, escalate last
  for (const kind of BP.FAILURE_KINDS) {
    const walk = RL.walk(kind, {}, { at: AT, pinnedModel: 'Fable', model: 'Fable', account: 'a1', accounts: ['a1', 'a2'] });
    const rungs = walk.map((d) => RL.rungOf(d));
    ok(walk.length <= RL.DEFAULTS.maxAttempts + 1 && walk[walk.length - 1].strategy === 'escalate', `walk ${kind}: ends in escalate within maxAttempts (${rungs.join(' → ')})`);
    ok(new Set(rungs.slice(0, -1)).size === rungs.length - 1, `walk ${kind}: every rung different (${rungs.join(' → ')})`);
    ok(walk.length >= 3, `walk ${kind}: at least two different tries before escalating`);
    if (WRITE) { fixture.walks = fixture.walks ?? {}; fixture.walks[kind] = rungs; } else eq(rungs, fixture.walks?.[kind], `walk ${kind} matches the fixture`);
  }
  eq(RL.walk('crash', { maxAttempts: 2 }, { at: AT }).length, 3, 'a configurable max: two tries then escalate');

  // escalation only comes after N different attempts: for every kind and every maxAttempts N, a walk with rungs to
  // spare escalates exactly after min(N, rungs available) failures, each on a different rung, and never earlier
  const roomy = { at: AT, pinnedModel: 'Fable', model: 'Fable', account: 'a1', accounts: ['a1', 'a2', 'a3'] };
  for (const kind of BP.FAILURE_KINDS) {
    const full = RL.walk(kind, { maxAttempts: 10, maxTotal: 30 }, roomy).length - 1;
    for (let N = 1; N <= 6; N++) {
      const w = RL.walk(kind, { maxAttempts: N, maxTotal: 30 }, roomy);
      const tries = w.slice(0, -1);
      eq(tries.length, Math.min(N, full), `escalate ${kind} at maxAttempts ${N}: after ${Math.min(N, full)} different attempts`);
      ok(tries.every((d) => !d.escalate) && w[w.length - 1].escalate, `escalate ${kind} at maxAttempts ${N}: escalate only last`);
      ok(new Set(tries.map((d) => RL.rungOf(d))).size === tries.length, `escalate ${kind} at maxAttempts ${N}: each attempt a different strategy`);
      const esc = RL.escalationOf(tries.map((d) => ({ kind, strategy: d.strategy, fixStrategy: d.fixStrategy, model: d.model, account: d.account, startedAt: AT, endedAt: AT, result: 'failed' })), { kind }, { at: AT, policy: { maxAttempts: N, maxTotal: 30 } });
      eq(esc.attempts, tries.length, `escalation record of ${kind} at maxAttempts ${N} counts every attempt`);
    }
  }
  // maxTotal across kinds: a different kind each time still escalates once the total is reached
  {
    const mixed = BP.FAILURE_KINDS.slice(0, 3).map((kind) => ({ kind, strategy: 'retry', startedAt: AT, endedAt: AT, result: 'failed' }));
    ok(RL.nextStrategy(mixed, { kind: 'stalled' }, { maxTotal: 3 }, { at: AT }).escalate, 'maxTotal: three failures of three kinds escalate at maxTotal 3');
    ok(!RL.nextStrategy(mixed, { kind: 'stalled' }, { maxTotal: 4 }, { at: AT }).escalate, 'maxTotal: three failures do not escalate at maxTotal 4');
  }
  // a skipped attempt (a hand's reset) never counts: the ladder starts over
  {
    const reset = RL.walk('crash', {}, roomy).slice(0, -1).map((d) => ({ kind: 'crash', strategy: d.strategy, model: d.model, account: d.account, startedAt: AT, endedAt: AT, result: 'skipped' }));
    eq(RL.nextStrategy(reset, { kind: 'crash' }, {}, roomy).strategy, 'retry', 'after a reset (all skipped) the ladder starts over at its first rung');
  }
}

// ---------------- the store write path refuses what the guard refuses (builds-store-core setStatus, when present)
if (typeof core.guardedStatus === 'function') {
  const r = core.guardedStatus({ id: 'g', status: 'landing', pr: '#1', steps: [{ done: true }] }, 'complete', { at: AT, by: 'check' });
  ok(!r.ok && r.build.status === 'landing', 'store: complete without proof is refused, the status stays');
  ok((r.build.notes ?? []).some((x) => /refused/i.test(x.text ?? '')), 'store: the refusal is recorded as a note');
  const okr = core.guardedStatus({ id: 'g', status: 'landing', pr: '#1', steps: [] }, 'fixing', { at: AT, by: 'check' });
  ok(okr.ok && okr.build.status === 'fixing', 'store: fixing needs no proof');
}

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`done-means-merged: fixture written (${fixture.records.length} records, ${fixture.guard.length} guard, ${fixture.migrate.length} migrate${fixture.ladder ? `, ${fixture.ladder.length} ladder` : ''} cases)`); }
if (failed) { console.error(`done-means-merged: ${failed}/${n} checks failed`); process.exit(1); }
console.log(`done-means-merged: ${n}/${n} checks passed`);
