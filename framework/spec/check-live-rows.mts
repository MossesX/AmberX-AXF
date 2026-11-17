/**
 * Self-test for live rows (live-change@1 + optimistic@1) on the web port (CI: npx -y tsx framework/spec/check-live-rows.mts).
 *  1. replays spec/fixtures/live-rows.json against core/engines/live-rows.ts (the Kotlin twin, when Android resumes,
 *     replays the same file): registry, store log + since, apply batches, view diff, optimistic scenarios, validators,
 *     data-change@1 mapping;
 *  2. checks the registry snapshot and the JSON Schemas under framework/schemas are what the engine generates;
 *  3. checks the spec doc names every op, resync reason, rollback reason and kept viewer state;
 *  4. the contract's own invariants: a batch with a gap never half-applies, an optimistic confirm never re-renders what
 *     was already shown, every rollback names a reason from the registry.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEEP_ON_CHANGE, LIVE_CHANGE_OPS, LIVE_CHANGE_REGISTRY, LiveChangeLog, RESYNC_REASONS, ROLLBACK_REASONS, applyLiveChanges, diffRowSets, expirePending, fromDataChange, isOwnChange, liveBatchErrors, liveChangeErrors, liveChangeJsonSchemas, liveRowsFrom, optimisticApply, pendingKeys,
  reconcileLiveChanges, rejectPending, resumeQuery, resyncLiveRows, rowSetFrom, rowSetFromResync, type LiveChange, type LiveRowsResult, type LiveRowsState,
} from '../core/engines/live-rows';

const root = new URL('..', import.meta.url).pathname;
const rd = (p: string) => readFileSync(root + p, 'utf8');
const f = JSON.parse(rd('spec/fixtures/live-rows.json'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(LIVE_CHANGE_REGISTRY, f.registry, 'registry');
eq(liveChangeJsonSchemas(), f.jsonSchemas, 'json schemas');
{
  const L = f.log;
  const log = new LiveChangeLog(L.ns, { limit: L.limit, epoch: L.epoch });
  const events = L.appends.map((a: never) => log.append(a));
  eq(events, L.events, 'log events');
  eq([log.rev, log.firstRev], [L.rev, L.firstRev], 'log rev / firstRev');
  eq(log.rows(), L.rows, 'log rows');
  eq(log.snapshot('history'), L.snapshot, 'log snapshot');
  for (const q of L.since) eq(log.since(q.rev, q), q.result, `since ${JSON.stringify({ rev: q.rev, max: q.max, epoch: q.epoch })}`);
}
for (const c of f.apply) {
  const r = applyLiveChanges(c.set, c.events);
  eq(r, c.result, `apply ${c.name}`);
  eq(resumeQuery(r.set), c.resume, `resume ${c.name}`);
}
for (const c of f.diff) eq(diffRowSets(c.before, c.after), c.result, `diff ${c.name}`);
eq(rowSetFrom('planner', [{ id: 'p1' }, { key: 'p2' }, { id: 'p1', dup: true }, { noKey: true }], 7), f.rowSets['from-rows-default-key'], 'rowSetFrom default key');
eq(rowSetFrom('planner', [{ slug: 'x' }, { slug: 'y' }], 2, (r) => String(r.slug)), f.rowSets['from-rows-key-of'], 'rowSetFrom keyOf');
eq(rowSetFromResync({ $axf: 'live-change-resync@1', ns: 'planner', reason: 'history', rev: 9, epoch: 'e3', rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], order: ['p3', 'p1', 'ghost'] }), f.rowSets['from-resync-order-wins'], 'rowSetFromResync');
eq({ mine: isOwnChange(f.log.events[0], 'c-tab1'), theirs: isOwnChange(f.log.events[1], 'c-tab1'), noClient: isOwnChange(f.log.events[0], undefined) }, f.own, 'own echo');
for (const [name, sc] of Object.entries(f.optimistic) as [string, { start: LiveRowsState; steps: { do: string; result: LiveRowsResult; pendingKeys: string[]; [k: string]: unknown }[] }][]) {
  let state: LiveRowsState = liveRowsFrom(sc.start.base, sc.start.pending);
  eq(state, sc.start, `optimistic ${name} start`);
  for (const [i, s] of sc.steps.entries()) {
    let r: LiveRowsResult;
    if (s.do === 'optimistic') r = optimisticApply(state, s.op as never);
    else if (s.do === 'reconcile') r = reconcileLiveChanges(state, s.events as LiveChange[]);
    else if (s.do === 'reject') r = rejectPending(state, s.opId as string, (s.reason as never) ?? 'rejected', s.detail as string | undefined);
    else if (s.do === 'expire') r = expirePending(state, s.now as number, s.timeoutMs as number | undefined);
    else if (s.do === 'resync') r = resyncLiveRows(state, s.frame as never);
    else throw new Error(`unknown step ${s.do}`);
    eq(r, s.result, `optimistic ${name} step ${i} (${s.do})`);
    eq(pendingKeys(r.state), s.pendingKeys, `optimistic ${name} step ${i} pending keys`);
    state = r.state;
  }
}
for (const [name, c] of Object.entries(f.errors.events) as [string, { input: unknown; errors: string[] }][]) eq(liveChangeErrors(c.input), c.errors, `event errors ${name}`);
for (const c of f.dataChange) eq(fromDataChange(c.change, c.row), c.event, `data-change ${c.change.cursor}`);

/* ---------- 2. snapshots current ---------- */
eq(JSON.parse(rd('schemas/live-change.json')), LIVE_CHANGE_REGISTRY, 'schemas/live-change.json is current');
for (const [name, s] of Object.entries(liveChangeJsonSchemas())) eq(JSON.parse(rd(`schemas/json/${name}`)), s, `schemas/json/${name} is current`);

/* ---------- 3. the spec names everything ---------- */
const spec = rd('spec/LIVE-CHANGES.md');
for (const word of [...LIVE_CHANGE_OPS, ...RESYNC_REASONS, ...ROLLBACK_REASONS.filter((r) => r !== 'rejected'), ...KEEP_ON_CHANGE]) { assert.ok(spec.includes(`\`${word}\``), `LIVE-CHANGES.md names ${word}`); checks++; }
assert.ok(spec.includes('Reject'), 'LIVE-CHANGES.md describes reject'); checks++;

/* ---------- 4. invariants ---------- */
{
  const set = rowSetFrom('builds', [{ id: 'a' }, { id: 'b' }], 5);
  const ok: LiveChange = { ns: 'builds', key: 'a', op: 'delete', rev: 6, origin: { session: 's', surface: 'cli' }, ts: 1 };
  const gap = applyLiveChanges(set, [ok, { ...ok, key: 'b', rev: 8 }]);
  eq([gap.set, gap.applied, gap.resync?.reason], [set, 0, 'gap'], 'a gap never half-applies');
  const st = liveRowsFrom(set);
  const shown = optimisticApply(st, { opId: 'o', key: 'b', op: 'reorder', before: 'a', at: 0 });
  const echoed = reconcileLiveChanges(shown.state, [{ ...ok, key: 'b', op: 'reorder', before: 'a', origin: { session: 's', surface: 'console', opId: 'o' } }]);
  eq([echoed.changed, echoed.moved, echoed.confirmed, echoed.state.pending], [[], [], ['o'], []], 'a confirm re-renders nothing already shown');
  for (const sc of Object.values(f.optimistic) as { steps: { result: LiveRowsResult }[] }[]) for (const s of sc.steps) for (const rb of s.result.rolledBack) { assert.ok((ROLLBACK_REASONS as readonly string[]).includes(rb.reason), `rollback reason ${rb.reason}`); checks++; }
  assert.ok(liveBatchErrors({ $axf: 'live-change-batch@1', ns: 'builds', events: [ok], rev: 6 }).length === 0, 'a good batch validates'); checks++;
  assert.ok(liveBatchErrors({ $axf: 'live-change-batch@1', ns: 'builds', events: [ok, { ...ok, rev: 9 }], rev: 9 }).some((e) => e.includes('does not follow')), 'a batch with a gap is invalid'); checks++;
}

console.log(`✓ live-rows: ${checks} checks`);
