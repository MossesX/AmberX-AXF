// node --test deploy/lander/test/family.test.mjs
// Parallel split families at the lander (orchestrator-settings-collapsible-split): parts land together with their
// parent, or in order part by part with the parent last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../lander-core.mjs';
import { memoryStore } from '../store.mjs';

const at = '2026-11-22T12:00:00.000Z';
const step = (id, status = 'completed') => ({ id, status, branch: `claude/x-${id}` });
const lead = (landing, status = 'build-complete', extra = {}) => ({ id: 'app', status, completedAt: '2026-11-22T09:00:00Z', steps: [step('s1'), step('s2')], pipeline: { parallel: { role: 'lead', parts: ['app-p1', 'app-p2'], contractStep: 's1', integrationStep: 's2', landing } }, ...extra });
const part = (n, status = 'build-complete', extra = {}) => ({ id: `app-p${n}`, status, completedAt: `2026-11-22T0${n}:00:00Z`, steps: [step('s1')], pipeline: { parallel: { role: 'part', lead: 'app', part: n, of: 2 } }, ...extra });

test('lands together: parts never land on their own; the parent waits until every part is built', () => {
  const builds = [lead('together'), part(1), part(2, 'building')];
  assert.equal(L.familyLanding(builds[1], builds), 'together');
  assert.match(L.familyHold(builds[1], builds), /lands together with its parent app/);
  assert.match(L.familyHold(builds[0], builds), /waits for app-p2 to finish building/);
  assert.equal(L.pickBuild(builds).build, null, 'nothing may land yet');
  const ready = [lead('together'), part(1), part(2)];
  assert.equal(L.familyHold(ready[0], ready), '');
  const p = L.pickBuild(ready);
  assert.equal(p.build.id, 'app', 'the parent lands, even though its parts finished earlier');
  assert.deepEqual(p.others, ['app-p1', 'app-p2'], 'the parts wait at the back');
});

test('lands in order: part 1, then part 2, then the parent', () => {
  let builds = [lead('own'), part(1), part(2)];
  assert.equal(L.familyHold(builds[1], builds), '');
  assert.match(L.familyHold(builds[2], builds), /lands in order: app-p1 first/);
  assert.match(L.familyHold(builds[0], builds), /lands after its parts: app-p1, app-p2/);
  assert.equal(L.pickBuild(builds).build.id, 'app-p1');
  builds = [lead('own'), part(1, 'landed'), part(2)];
  assert.equal(L.pickBuild(builds).build.id, 'app-p2');
  builds = [lead('own'), part(1, 'landed'), part(2, 'landed')];
  assert.equal(L.pickBuild(builds).build.id, 'app');
});

test('pickBuild reads the family from the whole store when it works on one build', () => {
  const builds = [lead('own'), part(1), part(2)];
  assert.equal(L.pickBuild([builds[2]], builds).build, null, 'part 2 alone still waits for part 1');
  assert.equal(L.pickBuild([builds[2]]).build, null, 'without its parent a part falls back to lands together: it never lands alone by mistake');
});

test('familyFollow: a parent landed together carries its built parts to main with its own merge', () => {
  const landed = { pr: 812, sha: 'abc123', mergedAt: at, ci: 'success', ciAt: at };
  const builds = [lead('together', 'landed', { pr: '#812', mergedAt: at, landed }), part(1), part(2, 'building')];
  const f = L.familyFollow(builds, at);
  assert.deepEqual(f.map((x) => x.id), ['app-p1'], 'a part still building is left alone');
  assert.equal(f[0].change.status, 'landed');
  assert.equal(f[0].change.landed.pr, 812);
  assert.deepEqual(f[0].change.steps, [{ id: 's1', status: 'in-pr', prNumber: 812 }]);
  const store = memoryStore(builds, { now: () => at });
  const r = store.write(f[0].id, f[0].change);
  assert.ok(r.ok, r.why);
  assert.equal(r.build.status, 'landed');
  assert.equal(r.build.steps[0].status, 'in-pr');
  assert.deepEqual(L.familyFollow(store.read(), at), [], 'once landed it is not written again');
  assert.deepEqual(L.familyFollow([lead('own', 'landed', { landed }), part(1)], at), [], 'lands in order: each part lands itself');
  assert.deepEqual(L.familyFollow([lead('together', 'landed'), part(1)], at), [], 'no merge evidence on the parent: nothing is claimed');
});

test('queueRows says why a family member waits', () => {
  const builds = [lead('together'), part(1)];
  const rows = L.queueRows(builds);
  assert.match(rows.find((r) => r.build === 'app-p1').familyWait, /lands together/);
  assert.equal(rows.find((r) => r.build === 'app').familyWait, undefined);
});

test('a build outside any family is untouched', () => {
  const b = { id: 'solo', status: 'build-complete' };
  assert.equal(L.familyHold(b, [b]), '');
  assert.equal(L.familyLanding(b, [b]), '');
  assert.equal(L.pickBuild([b]).build.id, 'solo');
});
