// Land-clash bounce tests: node apps/console-web/plugins/build-orchestrator/test/land-clash.test.mjs
// A build with every step done whose branch clashes with main gets one merge-main step and goes back to the Queue; a
// second report on the same head adds nothing and does not turn it into fixing; a clash on a new head after the step
// is done bounces again; a live lander fix agent on that head is waited for; a build with steps open is never bounced.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-land-clash-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_CREW_SAY: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_PIPELINE_CONSOLE: 'off', AXF_BUILD_PROFILE: 'all', AXF_PIPELINE_WORKTREES: join(tmp, 'wt'),
});
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const S = await import('../../../../../framework/cli/builds-store.mjs');
const PC = await import('../pipeline-core.mjs');
const PL = await import('../pipeline.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const find = (id) => core.findBuild(S.loadStore(), id);
const done = (k) => Array.from({ length: k }, (_, i) => ({ id: `s${i + 1}`, text: `step ${i + 1}`, model: 'Opus', estimate: '10 min', done: true, doneAt: '2026-11-17T00:00:00Z' }));
const build = (id, steps, extra = {}) => ({ id, title: id, status: 'landing', branch: `claude/${id}`, pr: 787, steps, builtAt: '2026-11-17T01:00:00Z', ...extra });
writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(core.normalizeStore({ ...core.emptyStore(), builds: [
  build('phone', done(27)),
  build('agent', done(3)),
  build('open', [...done(2), { id: 's3', text: 'step 3', model: 'Opus', estimate: '10 min' }], { status: 'running' }),
] })));
const conflict = (id, head, files, extra = {}) => [id, { id, pr: 787, head, state: 'blocked', reason: { kind: 'conflict', text: `${id}: merging main into it conflicts in code (${files.join(', ')}). Needs a code fix.`, files }, ...extra }];
const tick = (entries) => PL.detectFailures({ land: new Map(entries), policy: { stalledAfterMin: 20, attemptTimeoutMin: 45 } });

await t('27/27 done + clash → one merge-main step added, status queued', () => {
  const found = tick([conflict('phone', 'abc1234def', ['framework/spec/check-ci-scope.mjs'])]);
  assert.deepEqual(found.map((x) => x.id), [], 'a bounce is not a failure');
  const b = find('phone');
  assert.equal(b.status, 'queued'); assert.equal(b.steps.length, 28);
  const st = b.steps.at(-1);
  assert.equal(st.id, 's28'); assert.equal(st.model, 'Opus'); assert.equal(st.done, false);
  assert.match(st.text, /^Merge main into claude\/phone and resolve conflicts in framework\/spec\/check-ci-scope\.mjs \(clash at abc1234\)/);
  assert.equal(b.pipeline.bounce.step, 's28'); assert.equal(b.pipeline.bounce.count, 1); assert.deepEqual(b.pipeline.bounce.files, ['framework/spec/check-ci-scope.mjs']);
  assert.equal(b.pipeline.runs, 0); assert.equal(b.failure, undefined);
  assert.match(b.notes.at(-1).text, /Clashes with main in framework\/spec\/check-ci-scope\.mjs: added s28/);
});

await t('a second clash report on the same head adds no second step and never turns it into fixing', () => {
  tick([conflict('phone', 'abc1234def', ['framework/spec/check-ci-scope.mjs'])]);
  tick([conflict('phone', 'abc1234def', ['framework/spec/check-ci-scope.mjs'])]);
  const b = find('phone');
  assert.equal(b.steps.length, 28); assert.equal(b.status, 'queued'); assert.equal(b.pipeline.bounce.count, 1);
});

await t('the merge-main step done, a clash on a new head bounces once more', () => {
  S.withStore((s) => { const r = core.findBuild(s, 'phone'); r.steps.at(-1).done = true; r.steps.at(-1).doneAt = new Date().toISOString(); r.status = 'landing'; return s; }, { by: 'test' });
  tick([conflict('phone', 'fff0000aaa', ['framework/spec/check-ci-scope.mjs'])]);
  const b = find('phone');
  assert.equal(b.steps.length, 29); assert.match(b.steps.at(-1).text, /clash at fff0000/); assert.equal(b.pipeline.bounce.count, 2); assert.equal(b.status, 'queued');
});

await t('a live lander fix agent on that head is waited for; a stale one is not', () => {
  const agent = (at) => ({ agent: { kind: 'conflict', head: 'aaa1111bbb', at, exit: 0, session: 'fix' } });
  tick([conflict('agent', 'aaa1111bbb', ['a.mjs'], agent(new Date().toISOString()))]);
  assert.equal(find('agent').steps.length, 3, 'the lander is on it');
  tick([conflict('agent', 'aaa1111bbb', ['a.mjs'], agent(new Date(Date.now() - 90 * 60e3).toISOString()))]);
  assert.equal(find('agent').steps.length, 4, 'its agent ran past the attempt timeout: bounced');
});

await t('a build with steps still open is never bounced', () => {
  assert.equal(PC.clashBounceStep(find('open'), { files: ['x'], head: 'h' }), null);
  tick([conflict('open', 'ccc2222ddd', ['x.mjs'])]);
  assert.equal(find('open').steps.length, 3);
});

await t('pure: the step text carries every file (up to 8) and a missing head', () => {
  const b = core.normBuild(build('p', done(1)));
  assert.match(PC.clashBounceStep(b, { files: ['a', 'b'] }).text, /conflicts in a, b; keep both sides' intent/);
  assert.match(PC.clashBounceStep(b, {}).text, /the conflicting files/);
});

console.log(`land-clash: ${n} passed`);
