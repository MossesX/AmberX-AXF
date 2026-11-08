#!/usr/bin/env node
/**
 * build-hook@1 conformance: one builds store change → the events every listener gets.
 *   node framework/spec/check-build-hook.mjs           check
 *   node framework/spec/check-build-hook.mjs --write   regenerate fixtures/build-hook.json's expected outputs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../core/build-hook.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/build-hook.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ta = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-04T22:00:00Z';

const s1 = { id: 's1', uid: 'u1', title: 'Grid', text: 'Three-level grid', files: ['apps/console-web/plugins/example-grid/web/index.tsx'], model: 'Opus' };
const s2 = { id: 's2', uid: 'u2', title: 'Edits', text: 'Edits table', model: 'Fable' };
const origin = { said: 'Where is the list of features?', at: '2026-11-04T12:00:00Z', source: 'voice', verbatim: true };
const base = { id: 'shipped', title: 'Shipped features', profiles: ['angel'], status: 'pending', createdAt: '2026-11-04T12:00:00Z', rev: 1, steps: [s1], origin };
const IN = {
  created: { op: 'add', before: null, after: base },
  createdWithPr: { op: 'add', before: null, after: { ...base, id: 'old', pr: 'https://github.com/MossesX/axHub/pull/44', mergedAt: '2026-10-30T14:00:00Z', status: 'complete' } },
  createdCancelled: { op: 'add', before: null, after: { ...base, id: 'gone', deleted: true } },
  stepsAdded: { op: 'change', before: base, after: { ...base, rev: 2, steps: [s1, s2] } },
  stepDone: { op: 'change', before: { ...base, steps: [s1, s2] }, after: { ...base, rev: 3, status: 'running', steps: [{ ...s1, done: true, doneAt: AT }, s2] } },
  addendum: { op: 'change', before: base, after: { ...base, rev: 4, origin: { ...origin, addenda: [{ said: 'Show edits too.', at: '2026-11-04T21:34:07Z', source: 'chat' }] } } },
  prOpened: { op: 'change', before: { ...base, status: 'running' }, after: { ...base, rev: 5, status: 'built', pr: '350', branch: 'claude/shipped-features-r2' } },
  merged: { op: 'change', before: { ...base, status: 'built', pr: '350' }, after: { ...base, rev: 6, status: 'complete', pr: '350', mergedAt: '2026-11-05T00:00:00Z' } },
  archived: { op: 'change', before: base, after: { ...base, rev: 7, status: 'archived' } },
  deleted: { op: 'delete', before: base, after: { ...base, rev: 8, deleted: true } },
  restored: { op: 'restore', before: { ...base, deleted: true }, after: { ...base, rev: 9 } },
  nothing: { op: 'change', before: base, after: { ...base, rev: 10, title: 'Renamed' } },
  junk: { op: 'add' },
  // Fable review (Nov 6 2026): the cases the first cut got wrong or never covered
  branchNamedAxhub: { op: 'add', before: null, after: { ...base, id: 'adapter', branch: 'claude/axhub-adapter-fix', pr: '#12' } },
  repoField: { op: 'add', before: null, after: { ...base, id: 'hub-thing', repo: 'axhub', branch: 'claude/axf-look' } },
  twoTicks: { op: 'change', before: { ...base, steps: [s1, s2] }, after: { ...base, rev: 11, steps: [{ ...s1, done: true, doneAt: AT }, { ...s2, done: true, doneAt: AT }] } },
  lateOrigin: { op: 'change', before: { ...base, origin: undefined }, after: { ...base, rev: 12, origin } },
  deleteNoAfter: { op: 'delete', before: base, after: null },
  archivedAfterMerge: { op: 'change', before: { ...base, status: 'complete', pr: '350', mergedAt: '2026-11-05T00:00:00Z' }, after: { ...base, rev: 13, status: 'archived', pr: '350', mergedAt: '2026-11-05T00:00:00Z' } },
  modelSpellings: { op: 'add', before: null, after: { ...base, id: 'models', steps: [{ ...s1, model: 'fable' }, { ...s2, model: 'claude-opus-5-5' }, { id: 's3', uid: 'u3', title: 'No model' }, { id: 's4', uid: 'u4', title: 'Blocked model', model: 'Sonnet 5.5' }] } },
};
const run = () => ({
  events: Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, H.eventsFromChange(c, { at: AT, by: 'test' })])),
  journal: H.eventsFromJournal([{ rev: 1, at: AT, by: 'cli', builds: [IN.created] }, { rev: 1, at: AT, by: 'cli', builds: [IN.created] }, { rev: 2, at: AT, by: 'cli', builds: [IN.stepsAdded] }]).map((e) => e.id),
  validate: { ok: H.validateEvent({ event: 'created', build: { id: 'x' }, at: AT }).errors.map((e) => e.field), bad: H.validateEvent({ event: 'nope' }).errors.map((e) => e.field) },
  prNumber: ['330', '#331', 'https://github.com/MossesX/AmberX-AXF/pull/332', '', 'none', 333, { number: 334 }, { url: 'https://github.com/MossesX/axHub/pull/45' }, 'PR #336 (draft)'].map(H.prNumber),
  buildRepo: [{ pr: 'https://github.com/MossesX/axHub/pull/44' }, { pr: 'https://github.com/MossesX/AmberX-AXF/pull/44', branch: 'axhub-x' }, { repo: 'MossesX/axHub' }, { branch: 'claude/axhub-adapter-fix' }, { repo: 'nope', branch: 'axhub' }, {}].map(H.buildRepo),
  stepModel: ['Fable', 'fable', '[Fable]', 'Fable 5.1', 'claude-fable-5-1', 'Opus', 'opus', 'Sonnet', 'haiku', '', undefined].map(H.stepModel),
});
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'build-hook@1', note: 'Generated by framework/spec/check-build-hook.mjs --write; every port replays `in` and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

const kinds = (k) => actual.events[k].map((e) => e.event);
t('created carries every planned step and his verbatim words', () => { const [e] = actual.events.created; assert.equal(e.event, 'created'); assert.equal(e.steps.length, 1); assert.equal(e.prompt.said, origin.said); assert.equal(e.prompt.verbatim, true); assert.equal(e.build.profile, 'angel'); });
t('a build that arrives already merged or cancelled says so', () => { assert.deepEqual(kinds('createdWithPr'), ['created', 'pr-merged']); assert.equal(actual.events.createdWithPr[0].build.repo, 'axhub'); assert.deepEqual(kinds('createdCancelled'), ['created', 'cancelled']); });
t('later changes: new steps, ticks, addenda, status, PR, merge', () => {
  assert.deepEqual(kinds('stepsAdded'), ['steps-added']); assert.equal(actual.events.stepsAdded[0].steps[0].uid, 'u2');
  assert.deepEqual(kinds('stepDone'), ['step-done', 'status']); assert.equal(actual.events.stepDone[0].id, 'shipped:3:step-done:u1');
  assert.deepEqual(kinds('addendum'), ['addendum']); assert.equal(actual.events.addendum[0].prompt.said, 'Show edits too.');
  assert.deepEqual(kinds('prOpened'), ['status', 'pr-opened']); assert.equal(actual.events.prOpened[1].build.pr, 350);
  assert.deepEqual(kinds('merged'), ['status', 'pr-merged']);
});
t('archived without a merge and deleted are cancelled; restore comes back', () => { assert.deepEqual(kinds('archived'), ['cancelled']); assert.deepEqual(kinds('deleted'), ['cancelled']); assert.deepEqual(kinds('restored'), ['restored']); });
t('a rename alone fires nothing; junk fires nothing', () => { assert.deepEqual(kinds('nothing'), []); assert.deepEqual(kinds('junk'), []); });
t('ids are stable, so a replayed journal gives each event once', () => { assert.deepEqual(actual.journal, ['shipped:1:created', 'shipped:2:steps-added']); });
t('every event validates and normalises to itself', () => { for (const evs of Object.values(actual.events)) for (const e of evs) { assert.ok(H.validateEvent(e).ok, e.id); assert.deepEqual(H.normEvent(e), e); } });
t('the repo comes from the PR URL or the repo field, never the branch name', () => {
  assert.equal(actual.events.branchNamedAxhub[0].build.repo, 'amberx-axf'); assert.equal(actual.events.repoField[0].build.repo, 'axhub');
  assert.deepEqual(actual.buildRepo, ['axhub', 'amberx-axf', 'axhub', 'amberx-axf', 'amberx-axf', 'amberx-axf']);
});
t('two steps ticked in one write are two events with their own ids', () => { assert.deepEqual(actual.events.twoTicks.map((e) => e.id), ['shipped:11:step-done:u1', 'shipped:11:step-done:u2']); });
t('his words arriving after the build was created come as an addendum with index 0', () => { const [e] = actual.events.lateOrigin; assert.equal(e.event, 'addendum'); assert.equal(e.prompt.index, 0); assert.equal(e.prompt.said, origin.said); assert.equal(e.id, 'shipped:12:addendum:0'); });
t('a delete with no after still cancels; archiving a merged build is a status change, not a cancel', () => {
  assert.deepEqual(kinds('deleteNoAfter'), ['cancelled']); assert.equal(actual.events.deleteNoAfter[0].to, 'deleted');
  assert.deepEqual(kinds('archivedAfterMerge'), ['status']);
});
t('step models follow model-policy@1: any spelling of Fable / Opus, a blocked or missing model runs as the default', () => {
  assert.deepEqual(actual.events.modelSpellings[0].steps.map((s) => s.model), ['Fable', 'Opus', 'Opus', 'Opus']);
  assert.deepEqual(actual.stepModel, ['Fable', 'Fable', 'Fable', 'Fable', 'Fable', 'Opus', 'Opus', 'Opus', 'Opus', 'Opus', 'Opus']);
  assert.deepEqual(H.STEP_MODELS, ['Opus', 'Fable']);
});
t('PR numbers from every shape the store has carried', () => assert.deepEqual(actual.prNumber, [330, 331, 332, 0, 0, 333, 334, 45, 336]));
await ta('outbox round-trip (IO side)', async () => {
  process.env.AXF_BUILD_HOOKS_DIR = mkdtempSync(join(tmpdir(), 'axf-hooks-')); process.env.AXF_BUILD_HOOKS = 'on';
  const io = await import('../cli/build-hooks.mjs');
  io.appendEvents(actual.events.created); assert.equal(io.readOutbox().length, 1); assert.equal(io.readOutbox()[0].id, 'shipped:1:created');
});
await ta('delivery: cursors per listener, a throwing listener keeps its cursor, new lines are taken in the same delivery, one delivery at a time', async () => {
  const io = await import('../cli/build-hooks.mjs');
  const dir = process.env.AXF_BUILD_HOOKS_DIR; const log = join(dir, 'seen.json'); writeFileSync(log, '[]');
  const okMod = join(dir, 'ok.mjs'); writeFileSync(okMod, `import { readFileSync, writeFileSync } from 'node:fs'; export default (evs) => { const f = ${JSON.stringify(log)}; const s = JSON.parse(readFileSync(f, 'utf8')); writeFileSync(f, JSON.stringify([...s, ...evs.map((e) => e.id)])); };`);
  const badMod = join(dir, 'bad.mjs'); writeFileSync(badMod, `let n = 0; export const onBuildEvents = () => { n += 1; if (n === 1) throw new Error('down'); };`);
  const to = [{ name: 'ok', module: okMod }, { name: 'bad', module: badMod }];
  io.appendEvents(actual.events.stepsAdded);
  let r = await io.deliver({ to }); assert.equal(r.ok, 2); assert.match(String(r.bad), /^error: down/);
  assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), ['shipped:1:created', 'shipped:2:steps-added']);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cursors.json'), 'utf8')), { ok: 2 }, 'the failed listener has no cursor yet');
  r = await io.deliver({ to }); assert.equal(r.ok, 0); assert.equal(r.bad, 2, 'the listener that was down gets everything it missed');
  // a lock held by a live delivery turns the next one away; a stale one is taken over
  assert.equal(io.takeLock(), true); r = await io.deliver({ to }); assert.deepEqual(r, { locked: true }); io.dropLock();
  assert.equal(io.takeLock(), true); assert.equal(io.takeLock(0), true, 'a stale lock (older than the limit) is taken over'); io.dropLock();
  // events appended during a round are taken before the delivery ends
  const growMod = join(dir, 'grow.mjs'); writeFileSync(growMod, `import { appendFileSync } from 'node:fs'; let n = 0; export default (evs) => { n += 1; if (n === 1) appendFileSync(${JSON.stringify(join(dir, 'events.jsonl'))}, JSON.stringify(${JSON.stringify(actual.events.stepDone[0])}) + '\\n'); globalThis.__growSeen = (globalThis.__growSeen || []).concat(evs.map((e) => e.id)); };`);
  r = await io.deliver({ to: [{ name: 'grow', module: growMod }] }); assert.equal(r.grow, 3);
  assert.deepEqual(globalThis.__growSeen, ['shipped:1:created', 'shipped:2:steps-added', 'shipped:3:step-done:u1']);
  // replay delivers the given events and leaves cursors alone
  r = await io.deliver({ to, events: actual.events.created }); assert.equal(r.ok, 1); assert.deepEqual(JSON.parse(readFileSync(join(dir, 'cursors.json'), 'utf8')), { ok: 2, bad: 2, grow: 3 });
});
await ta('real builds journal replays without throwing', async () => { const io = await import('../cli/build-hooks.mjs'); const ev = io.journalEvents(); assert.ok(Array.isArray(ev)); });
t('schemas/build-hook.json + schemas/json/build-event.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/build-hook.json')), H.REGISTRY)); for (const [name, s] of Object.entries(H.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });
t('PORTING.md lists the contract', () => assert.match(rd('framework/spec/PORTING.md'), /build-hook@1/));
console.log(`check-build-hook: ${n} checks passed`);
