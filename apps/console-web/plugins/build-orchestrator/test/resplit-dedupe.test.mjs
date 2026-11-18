// Step-dedupe tests: node apps/console-web/plugins/build-orchestrator/test/resplit-dedupe.test.mjs
// A re-split never grows a build, two copies of the store that gave one step different uids merge into one step, the
// save guard collapses repeats from any writer, a done copy wins, and distinct steps with similar text are kept.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-dedupe-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_PIPELINE_CONSOLE: 'off', AXF_BUILD_PROFILE: 'all', AXF_PIPELINE_SPLITTER: '/bin/false',
});
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const merge = await import('../../../../../framework/plan/builds-merge-core.mjs');
const S = await import('../../../../../framework/cli/builds-store.mjs');
const P = await import('../pipeline.mjs');

let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const texts = (b) => b.steps.map((s) => s.text);
const find = (id) => core.findBuild(S.loadStore(), id);
const seed = (builds) => writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(core.normalizeStore({ ...core.emptyStore(), builds })));

const DETAIL = 'Read the splitter\nFix the splitter\nAdd the guard\nWrite the tests';

await t('re-split twice keeps the step count', () => {
  seed([{ id: 'resplit', title: 'Resplit', detail: DETAIL, status: 'pending', steps: [] }]);
  P.splitBuild('resplit', { provider: 'rules' });
  const once = find('resplit').steps.length;
  assert.ok(once > 0);
  P.splitBuild('resplit', { provider: 'rules' });
  P.splitBuild('resplit', { provider: 'rules' });
  assert.equal(find('resplit').steps.length, once);
});

await t('a re-split keeps a done step with its done flag and uid', () => {
  const b = find('resplit'); const first = b.steps[0];
  S.withStore((s) => { const r = core.findBuild(s, 'resplit'); r.steps[0].done = true; r.steps[0].doneAt = '2026-11-17T00:00:00Z'; return s; }, { by: 'test' });
  P.splitBuild('resplit', { provider: 'rules' });
  const after = find('resplit');
  const kept = after.steps.filter((s) => s.text === first.text);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].done, true);
  assert.equal(kept[0].uid, first.uid);
  assert.equal(after.steps.length, b.steps.length);
});

await t('merging two copies with re-uided steps does not double', () => {
  const mk = (pfx, at, doneIdx = -1) => core.normBuild({ id: 'm', title: 'm', status: 'queued', updatedAt: at,
    steps: ['A', 'B', 'C'].map((x, i) => ({ id: `s${i + 1}`, uid: `${pfx}-${i}`, text: `Step ${x}`, createdAt: '2026-11-17T23:25:00Z', done: i === doneIdx, doneAt: i === doneIdx ? at : '' })) });
  const a = mk('a', '2026-11-17T23:21:00Z', 1); const b = mk('b', '2026-11-17T23:22:00Z');
  let m = merge.mergeBuild(a, b);
  for (let i = 0; i < 5; i += 1) m = merge.mergeBuild(m, mk(`x${i}`, '2026-11-17T23:20:00Z'));
  assert.deepEqual(texts(m), ['Step A', 'Step B', 'Step C']);
  assert.equal(m.steps[1].done, true, 'the tick on the older copy survives');
});

await t('the save guard collapses repeats any writer appends', () => {
  S.withStore((s) => { const r = core.findBuild(s, 'resplit'); r.steps = [...r.steps, ...r.steps.map((x) => ({ ...x, uid: `${x.uid}-dup`, id: `${x.id}-9`, done: false }))]; return s; }, { by: 'test' });
  const b = find('resplit');
  assert.equal(new Set(texts(b)).size, b.steps.length);
  assert.equal(b.steps[0].done, true);
});

await t('a done copy wins over a pending one, order of first appearance', () => {
  const d = core.dedupeSteps([{ id: 's1', text: 'One' }, { id: 's2', text: 'Two' }, { id: 's3', text: '  one ', done: true, uid: 'u3' }, { id: 's4', text: '[Opus] Two' }]);
  assert.equal(d.dropped, 2);
  assert.deepEqual(d.steps.map((s) => s.id), ['s3', 's2']);
  assert.equal(d.steps[0].done, true);
});

await t('distinct steps with similar text are kept', () => {
  const d = core.dedupeSteps([{ text: 'Run checks' }, { text: 'Run checks again' }, { text: 'Run check' }, { text: '' }, { text: '' }]);
  assert.equal(d.steps.length, 5);
});

await t('tidyStepIds renames collision ids only where free', () => {
  const b = { steps: [{ id: 's1' }, { id: 's65-64' }, { id: 's3-2' }, { id: 's2' }] };
  assert.equal(core.tidyStepIds(b), 1);
  assert.deepEqual(b.steps.map((s) => s.id), ['s1', 's65-64', 's3', 's2']);
});

await t('dedupe-steps: dry run writes nothing, apply collapses with one revision per build', () => {
  const rep = (id, k) => ({ id, title: id, status: 'queued', steps: Array.from({ length: 3 * k }, (_, i) => ({ id: i < 3 ? `s${i + 1}` : `s${i + 1}-${i}`, uid: `${id}-${i}`, text: `Step ${i % 3}`, done: i === 4, doneAt: i === 4 ? '2026-11-17T00:00:00Z' : '' })) });
  // written raw (normalizeStore would already collapse them)
  writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify({ ...core.emptyStore(), builds: [core.normBuild({ id: 'clean', steps: [{ text: 'only' }] }), { ...core.normBuild({ id: 'r1' }), ...rep('r1', 4) }, { ...core.normBuild({ id: 'r2' }), ...rep('r2', 2) }] }));
  const dry = S.dedupeStepsNow();
  assert.deepEqual(dry.builds.map((b) => [b.id, b.before, b.after]), [['r1', 12, 3], ['r2', 6, 3]]);
  const revBefore = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')).rev ?? 0;
  const done = S.dedupeStepsNow({ apply: true });
  assert.deepEqual(done.total, { before: 18, after: 6 });
  const r1 = find('r1');
  assert.deepEqual(r1.steps.map((s) => [s.id, s.done]), [['s1', false], ['s2', true], ['s3', false]]);
  assert.equal(S.loadStore().rev - revBefore, 2, 'one revision per build');
  assert.equal(S.dedupeStepsNow().builds.length, 0, 'a second run finds nothing');
});

console.log(`resplit-dedupe: ${n} passed`);
