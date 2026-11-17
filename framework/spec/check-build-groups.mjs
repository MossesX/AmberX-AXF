#!/usr/bin/env node
/**
 * step-groups@1 checks: the grouping engine (framework/core/build-groups.mjs, planGroups) against the golden cases in
 * fixtures/build-groups.json, plus the invariants every plan must hold: each open step in exactly one group, a group
 * merges after every group it waits for, ids follow the merge order, a refused plan writes no groups, and a plan
 * written on a build is a valid builds@1 record that reads back the same.
 *   node framework/spec/check-build-groups.mjs            compare the engine with the fixture
 *   node framework/spec/check-build-groups.mjs --write    regenerate the fixture's `out` blocks from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures/build-groups.json');
const WRITE = process.argv.includes('--write');

const G = await import('../core/build-groups.mjs');
const BP = await import('../core/build-pipeline.mjs');
const C = await import('../plan/builds-store-core.mjs');

let n = 0; let failed = 0;
const ok = (cond, what) => { n++; if (!cond) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
eq(fixture.$axf, 'step-groups-cases@1', 'fixture schema');
const step = (s, i) => ({ id: s.id ?? `s${i + 1}`, text: s.text ?? `${s.id ?? `s${i + 1}`} work`, model: s.model ?? 'Opus', estimate: s.estimate === undefined ? '10 min' : s.estimate, files: s.files ?? [], dependsOn: s.dependsOn ?? [], done: s.done === true, skip: s.skip === true });
const pick = (p) => ({ split: p.split, minutes: p.minutes, groups: p.groups.map((g) => ({ id: g.id, steps: g.steps, dependsOn: g.dependsOn })), mergeOrder: p.mergeOrder, error: p.error });

for (const c of fixture.cases) {
  const build = { id: c.id ?? 'b', title: c.name, steps: c.steps.map(step) };
  const plan = G.planGroups(build, c.options ?? {});
  const got = pick(plan);
  if (WRITE) c.out = got; else eq(got, c.out, `case: ${c.name}`);
  ok(plan.$axf === G.SCHEMA, `case: ${c.name}: plan carries the schema`);
  ok(plan.reason.length > 0, `case: ${c.name}: a reason is always given`);
  const open = build.steps.filter((s) => !s.done && !s.skip).map((s) => s.id);
  if (plan.error) {
    eq(plan.groups, [], `case: ${c.name}: a refused plan writes no groups`);
    eq(plan.split, false, `case: ${c.name}: a refused plan is not split`);
    ok(plan.reason.startsWith('refused: '), `case: ${c.name}: the reason says refused`);
  } else {
    const placed = plan.groups.flatMap((g) => g.steps);
    eq([...placed].sort(), [...open].sort(), `case: ${c.name}: every open step in exactly one group, nothing else`);
    eq(plan.split, plan.groups.length > 1, `case: ${c.name}: split = more than one group`);
    eq(plan.mergeOrder, plan.groups.map((g) => g.id), `case: ${c.name}: mergeOrder lists the groups in order`);
    eq(plan.groups.map((g) => g.mergeOrder), plan.groups.map((_, i) => i), `case: ${c.name}: mergeOrder fields count up from 0`);
    eq(plan.groups.map((g) => g.id), plan.groups.map((_, i) => `g${i + 1}`), `case: ${c.name}: ids follow the merge order`);
    for (const g of plan.groups) for (const d of g.dependsOn) ok(plan.mergeOrder.indexOf(d) < plan.mergeOrder.indexOf(g.id), `case: ${c.name}: ${g.id} merges after ${d}`);
    ok(plan.groups.every((g) => g.state === 'planned' && !g.slot && !g.account && !g.branch), `case: ${c.name}: fresh groups are planned, no run record`);
    // dependsOn honoured: inside a group the dependency comes first; across groups the group waits
    for (const s of build.steps.filter((s) => open.includes(s.id))) for (const d of s.dependsOn) {
      if (!open.includes(d)) continue;
      const gs = plan.groups.find((g) => g.steps.includes(s.id)); const gd = plan.groups.find((g) => g.steps.includes(d));
      ok(gs === gd ? gs.steps.indexOf(d) < gs.steps.indexOf(s.id) : gs.dependsOn.includes(gd.id), `case: ${c.name}: ${s.id} after ${d} (same group: ordered; other group: waits)`);
    }
    // shared files never split across groups
    for (let i = 0; i < build.steps.length; i++) for (let j = i + 1; j < build.steps.length; j++) {
      const a = build.steps[i]; const b = build.steps[j];
      if (!open.includes(a.id) || !open.includes(b.id) || !a.files.some((f) => b.files.includes(f))) continue;
      ok(plan.groups.find((g) => g.steps.includes(a.id)) === plan.groups.find((g) => g.steps.includes(b.id)), `case: ${c.name}: ${a.id} and ${b.id} share a file and sit in one group`);
    }
    // the plan on a build: a valid builds@1 record that reads back unchanged, each planned step naming its group
    const written = G.withGroups(build, plan);
    const rec = C.normBuild(written);
    const store = C.normalizeStore({ ...C.emptyStore('2026-11-16T23:25:33.721Z'), builds: [rec] });
    eq(C.validateStore(store).errors, [], `case: ${c.name}: the written plan is a valid builds@1 record`);
    if (plan.split) {
      eq(rec.groups.map((g) => ({ id: g.id, steps: g.steps, dependsOn: g.dependsOn })), got.groups, `case: ${c.name}: normBuild keeps the plan as planned`);
      eq(rec.steps.filter((s) => open.includes(s.id)).map((s) => s.group), open.map((id) => plan.groups.find((g) => g.steps.includes(id)).id), `case: ${c.name}: every open step names its group`);
      ok(BP.isSplit(rec) && BP.groupsOf(rec).length === plan.groups.length, `case: ${c.name}: groupsOf reads the plan`);
      eq(BP.readyGroups(rec).map((g) => g.id), plan.groups.filter((g) => !g.dependsOn.length).map((g) => g.id), `case: ${c.name}: readyGroups = the groups that wait for nothing`);
    } else {
      ok(!('groups' in rec), `case: ${c.name}: an unsplit build carries no groups`);
      eq(BP.groupsOf(rec).length, 1, `case: ${c.name}: an unsplit build reads as one implicit group`);
    }
  }
}

// ---------------- the pieces on their own
eq([G.estimateMinutes('10 min'), G.estimateMinutes('~1.5 h'), G.estimateMinutes('2 d'), G.estimateMinutes(12), G.estimateMinutes('soon'), G.estimateMinutes('')], [10, 90, 960, 12, null, null], 'estimateMinutes readings');
eq(G.buildMinutes({ steps: [{ id: 'a', estimate: '5 min' }, { id: 'b' }, { id: 'c', estimate: '8 min', done: true }, { id: 'd', estimate: '7 min', skip: true }] }), 15, 'buildMinutes: open steps, a missing estimate counts as the step cap');
eq(G.buildMinutes({ steps: [{ id: 'a' }, { id: 'b' }] }, 4), 8, 'buildMinutes honours stepMinutes');
eq(G.DEFAULT_SPLIT_MINUTES, 30, 'the default threshold is 30 minutes');
eq(G.SPLIT_SETTING, 'splitOverMin', 'the setting key is fixed');
eq(G.planGroups(null).reason, 'nothing open to plan', 'no build: nothing to plan, no error');
eq(G.planGroups({ steps: [{ id: 's1', estimate: '40 min', files: ['a'] }] }).groups.length, 1, 'one long step: one group');
const four = { steps: ['a', 'b', 'c', 'd'].map((f, i) => ({ id: `s${i + 1}`, estimate: '10 min', files: [f] })) };
eq(G.planGroups(four, { splitOverMin: 'nope' }).threshold, 30, 'a bad threshold falls back to 30');
eq(G.planGroups(four, { splitOverMin: 39 }).split, true, 'threshold just under the minutes: split');
eq(G.planGroups(four, { splitOverMin: 40 }).split, false, 'minutes equal to the threshold: not over, one group');
eq(G.planGroups(four, { stepMinutes: 5, splitOverMin: 30 }).minutes, 40, 'stepMinutes only fills missing estimates');
eq(G.planGroups({ steps: four.steps.map((s) => ({ ...s, estimate: '' })) }, { stepMinutes: 5 }).minutes, 20, 'missing estimates count as stepMinutes');
eq(G.planGroups({ steps: four.steps.map((s) => ({ ...s, files: ['./x.mjs', 'x.mjs'] })) }).groups.length, 1, 'file paths are compared normalised (./x.mjs = x.mjs)');
const w = G.withGroups(four, G.planGroups(four));
ok(w.groups.length === 4 && w.steps.every((s, i) => s.group === `g${i + 1}`) && !('groups' in four), 'withGroups writes the plan, leaves the input alone');
const back = G.withGroups({ ...w, steps: w.steps }, G.planGroups(four, { splitOverMin: 0 }));
ok(!('groups' in back) && back.steps.every((s) => s.group === ''), 'withGroups with an unsplit plan clears groups and the steps\' group fields');
ok(!('groups' in G.withGroups(four, G.planGroups({ steps: [{ id: 's1', dependsOn: ['s1'] }, { id: 's2' }] }))), 'a refused plan writes no groups');

if (WRITE) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`build-groups: fixture written (${fixture.cases.length} cases)`); }
if (failed) { console.error(`build-groups: ${failed}/${n} checks failed`); process.exit(1); }
console.log(`build-groups: ${n}/${n} checks passed`);
