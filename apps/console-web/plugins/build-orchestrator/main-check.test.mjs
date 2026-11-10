// Self-test: node apps/console-web/plugins/build-orchestrator/main-check.test.mjs
// The one-build check against main: the verdicts (pure), then queue / main-check end to end on a scratch store and a
// scratch git repo standing in for main.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MC from './main-check-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const created = '2026-11-10T10:00:00.000Z';
const st = (id, text, done = false) => ({ id, text, done, skip: false, model: 'Opus' });
const WRAP = (id) => `Tests green, report _claude/builds/reports/${id}.md, THREADS row, commit, push, PR`;
const ev0 = { main: 'abc', mainRef: 'main', manifest: null, mergedPr: null, landed: null, paths: {}, ledger: [] };

// ---------------- pure
t('pathsOf: repo paths a step names, no placeholders, no trailing punctuation', () => {
  assert.deepEqual(MC.pathsOf('Add framework/cli/foo.mjs and `apps/x/y.tsx`, then docs/a.md.'), ['framework/cli/foo.mjs', 'apps/x/y.tsx', 'docs/a.md']);
  assert.deepEqual(MC.pathsOf('report _claude/builds/reports/<id>.md'), []);
  assert.deepEqual(MC.pathsOf('no paths here'), []);
});
t('similarity: same words high, different low; short titles never supersede', () => {
  assert.ok(MC.similarity('Orchestrator retries failed launches on another account', 'Orchestrator retries failed launches on another account') === 1);
  assert.ok(MC.similarity('Orchestrator retries failed launches', 'Voice notes on the phone') < 0.2);
  assert.equal(MC.supersededBy({ id: 'a', title: 'Fix icons', createdAt: created }, [{ build: 'b', title: 'Fix icons', landedAt: '2026-11-11T00:00:00Z' }]), null);
});
t('decide: main unreadable → unknown (queue anyway)', () => {
  const r = MC.decide({ id: 'a', steps: [st('s1', 'x')] }, { unavailable: true, error: 'no git' });
  assert.equal(r.verdict, 'unknown');
});
t('decide: nothing on main → open', () => {
  assert.equal(MC.decide({ id: 'a', createdAt: created, steps: [st('s1', 'Add apps/x/a.mjs')] }, ev0).verdict, 'open');
});
t('decide: some step paths added on main after the build was filed → partial, only those ticked', () => {
  const b = { id: 'a', createdAt: created, steps: [st('s1', 'Add apps/x/a.mjs'), st('s2', 'Add apps/x/b.mjs'), st('s3', WRAP('a'))] };
  const r = MC.decide(b, { ...ev0, paths: { 'apps/x/a.mjs': { onMain: true, addedAt: '2026-11-10T11:00:00+00:00' }, 'apps/x/b.mjs': { onMain: false, addedAt: '' } } });
  assert.equal(r.verdict, 'partial'); assert.deepEqual(r.ticks.map((x) => x.id), ['s1']);
});
t('createdPathsOf: only paths the step says it creates; reused / read / changed ones are no evidence', () => {
  assert.deepEqual(MC.createdPathsOf('Add `apps/x/a.mjs` and write docs/b.md'), ['apps/x/a.mjs', 'docs/b.md']);
  assert.deepEqual(MC.createdPathsOf('Homes + kit: reuse `apps/x/wizard.mjs` (run, kit)'), []);
  assert.deepEqual(MC.createdPathsOf('Add a route in apps/x/server.py'), []);
  assert.deepEqual(MC.createdPathsOf('BRETT: review; decisions go to _claude/memory/decisions.md'), []);
});
t('decide: a step that only reuses a file added later, or a BRETT step, is never ticked', () => {
  const ev = { ...ev0, paths: { 'apps/x/w.mjs': { onMain: true, addedAt: '2026-11-10T11:00:00Z' } } };
  assert.equal(MC.decide({ id: 'a', createdAt: created, steps: [st('s1', 'Reuse apps/x/w.mjs for homes')] }, ev).verdict, 'open');
  assert.equal(MC.decide({ id: 'a', createdAt: created, steps: [st('s1', 'BRETT: decide, then add apps/x/w.mjs')] }, ev).verdict, 'open');
});
t('decide: a path that existed before the build was filed is no evidence', () => {
  const b = { id: 'a', createdAt: created, steps: [st('s1', 'Change apps/x/a.mjs')] };
  assert.equal(MC.decide(b, { ...ev0, paths: { 'apps/x/a.mjs': { onMain: true, addedAt: '2026-11-01T00:00:00Z' } } }).verdict, 'open');
});
t('decide: a merged PR alone never closes a build with open steps (phase 1 landed, phase 2 left)', () => {
  const b = { id: 'a', createdAt: created, pr: '12', steps: [st('s1', 'done', true), st('s2', 'Design the phase two contract')] };
  const r = MC.decide(b, { ...ev0, mergedPr: { number: 12, commit: 'f00' } });
  assert.equal(r.verdict, 'open'); assert.match(r.why, /PR #12 merged/);
});
t('decide: landed with every step ticked → done, PR and commit linked', () => {
  const r = MC.decide({ id: 'a', steps: [st('s1', 'x', true)] }, { ...ev0, mergedPr: { number: 12, commit: 'f00ba4' } });
  assert.equal(r.verdict, 'done'); assert.equal(r.pr, 12); assert.equal(r.commit, 'f00ba4');
});
t('decide: landed branch changed every step path and the report is on main → done (wrap-up ticked too)', () => {
  const b = { id: 'a', createdAt: created, steps: [st('s1', 'Add apps/x/a.mjs'), st('s2', WRAP('a'))] };
  const ev = { ...ev0, landed: { commit: 'beef', files: ['apps/x/a.mjs', '_claude/builds/reports/a.md'] }, paths: { 'apps/x/a.mjs': { onMain: true }, '_claude/builds/reports/a.md': { onMain: true } } };
  const r = MC.decide(b, ev); assert.equal(r.verdict, 'done'); assert.deepEqual(r.ticks.map((x) => x.id), ['s1', 's2']); assert.equal(r.commit, 'beef');
});
t('decide: landed (PR merged) with only the wrap-up step left → done; the report is not required', () => {
  const b = { id: 'a', createdAt: created, pr: '352', steps: [st('s1', 'x', true), st('s2', 'Shots, UI Review, report, PR, merge queue front, deploy')] };
  const r = MC.decide(b, { ...ev0, mergedPr: { number: 352, commit: 'f00' } });
  assert.equal(r.verdict, 'done'); assert.deepEqual(r.ticks.map((x) => x.id), ['s2']); assert.equal(r.pr, 352);
  assert.equal(MC.decide(b, ev0).verdict, 'open', 'not landed: the wrap-up is still to do');
});
t('decide: the wrap-up step alone is never ticked while other steps are open', () => {
  const b = { id: 'a', createdAt: created, steps: [st('s1', 'Design it'), st('s2', WRAP('a'))] };
  const r = MC.decide(b, { ...ev0, landed: { commit: 'beef', files: [] }, paths: { '_claude/builds/reports/a.md': { onMain: true } } });
  assert.equal(r.verdict, 'open');
});
t('decide: its own shipped manifest ticks the steps it lists as done', () => {
  const b = { id: 'a', createdAt: created, steps: [st('s1', 'Build the thing'), st('s2', 'Then more')] };
  const r = MC.decide(b, { ...ev0, manifest: { id: 'sm-a', pr: 5, landedCommit: 'c0ffee', doneSteps: ['Build the thing'] } });
  assert.equal(r.verdict, 'partial'); assert.deepEqual(r.ticks.map((x) => x.id), ['s1']); assert.equal(r.pr, 5);
});
t('decide: a landed build with the same title, landed after this one was filed → superseded', () => {
  const b = { id: 'dup', title: 'Orchestrator retries failed launches on another account', createdAt: created, steps: [st('s1', 'x')] };
  const ledger = [{ build: 'orig', title: 'Orchestrator retries failed launches on another account', landedAt: '2026-11-10T12:00:00Z', landedCommit: 'abc123', pr: 9 }];
  const r = MC.decide(b, { ...ev0, ledger }); assert.equal(r.verdict, 'superseded'); assert.equal(r.by, 'orig'); assert.equal(r.pr, 9);
  assert.equal(MC.decide({ ...b, createdAt: '2026-11-11T00:00:00Z' }, { ...ev0, ledger }).verdict, 'open', 'filed after the other landed: Brett asked again on purpose');
});
t('decide: the AI pass counts only with a commit on main, and only when code found nothing', () => {
  const b = { id: 'a', createdAt: created, steps: [st('s1', 'Do x'), st('s2', 'Do y')] };
  const ai = { verdict: 'partial', steps: ['s1', 'nope'], commit: 'abcdef1', why: 'x landed' };
  assert.equal(MC.decide(b, { ...ev0, aiCommitOnMain: false }, { ai }).verdict, 'open');
  const r = MC.decide(b, { ...ev0, aiCommitOnMain: true }, { ai }); assert.equal(r.verdict, 'partial'); assert.deepEqual(r.ticks.map((x) => x.id), ['s1']); assert.ok(r.ai);
  assert.deepEqual(MC.parseAi('sure: {"verdict":"done","steps":[],"commit":"abc1234","why":"w"}'), { verdict: 'done', steps: [], commit: 'abc1234', why: 'w' });
  assert.equal(MC.parseAi('no json'), null);
});
t('closedAlert: names the verdict, the evidence and the link', () => {
  const a = MC.closedAlert({ id: 'a', title: 'Alpha' }, { verdict: 'done', why: 'every open step is on main', pr: 7, commit: 'abcdef123456' });
  assert.match(a.title, /Already on main: Alpha/); assert.match(a.body, /PR #7 · abcdef123/); assert.match(a.body, /not queued/);
});

// ---------------- end to end: scratch store + scratch git repo as main
{
  const tmp = mkdtempSync(join(tmpdir(), 'axf-maincheck-'));
  const repo = join(tmp, 'repo'); mkdirSync(repo);
  const later = '2030-01-01T00:00:00+00:00';
  const g = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_COMMITTER_DATE: later, GIT_AUTHOR_DATE: later } }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  const put = (p, s = 'x') => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  g('init', '-q', '-b', 'main'); put('README.md'); g('add', '.'); g('commit', '-qm', 'base');
  const storeFile = join(tmp, 'store.json');
  const env = { ...process.env, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_PIPELINE_CONSOLE: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_MAIN_CHECK_GIT_DIR: repo, AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off' };
  const run = (file, ...args) => { const r = spawnSync(process.execPath, [join(HERE, file), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) throw new Error(`${file} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`); return r; };
  const json = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
  const find = (id) => JSON.parse(readFileSync(storeFile, 'utf8')).builds.find((b) => b.id === id);
  const add = (o) => run('orchestrator.mjs', 'act', JSON.stringify({ action: 'add', ...o }));

  add({ id: 'gamma', title: 'Gamma', steps: [{ text: 'Add apps/x/gamma-a.mjs', model: 'Opus', estimate: '20 min' }, { text: 'Add apps/x/gamma-b.mjs', model: 'Opus', estimate: '20 min' }, { text: WRAP('gamma'), model: 'Opus', estimate: '20 min' }] });
  add({ id: 'delta', title: 'Delta', steps: [{ text: 'Create apps/x/delta.mjs', model: 'Opus', estimate: '20 min' }] });
  add({ id: 'eta', title: 'Eta', steps: [{ text: 'Add apps/x/eta.mjs', model: 'Opus', estimate: '20 min' }, { text: WRAP('eta'), model: 'Opus', estimate: '20 min' }] });
  add({ id: 'theta', title: 'Theta', steps: [{ text: 'Add apps/x/theta.mjs', model: 'Opus', estimate: '20 min' }] });
  add({ id: 'orig', title: 'Orchestrator retries failed launches on another account', steps: [{ text: 'x', model: 'Opus', estimate: '20 min' }] });
  add({ id: 'dup', title: 'Orchestrator retries failed launches on another account', steps: [{ text: 'y', model: 'Opus', estimate: '20 min' }] });
  run('orchestrator.mjs', 'act', 'step', 'orig', 's1', 'done');
  // main moves on: gamma's first file, delta's file; eta's branch lands with its report
  put('apps/x/gamma-a.mjs'); put('apps/x/delta.mjs'); g('add', '.'); g('commit', '-qm', 'gamma a, delta');
  g('checkout', '-qb', 'claude/eta'); put('apps/x/eta.mjs'); put('_claude/builds/reports/eta.md', '# Eta'); g('add', '.'); g('commit', '-qm', 'eta'); g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', '-m', 'Merge pull request #77 from x/claude/eta', 'claude/eta');

  t('e2e main-check (dry): says what it would do, writes nothing', () => {
    const r = json(run('pipeline.mjs', 'main-check', 'gamma', '--json'));
    assert.equal(r.verdict, 'partial'); assert.deepEqual(r.ticks.map((x) => x.id), ['s1']); assert.equal(r.applied, false);
    assert.equal(find('gamma').steps[0].done, false);
  });
  t('e2e queue: partly done → the step on main is ticked, only what is left is queued', () => {
    const r = json(run('pipeline.mjs', 'queue', 'gamma', '--by', 'brett', '--json'));
    assert.equal(r.status, 'queued'); assert.equal(r.mainCheck.verdict, 'partial');
    const b = find('gamma'); assert.equal(b.steps[0].done, true); assert.match(b.steps[0].note, /apps\/x\/gamma-a\.mjs/); assert.equal(b.steps[1].done, false);
    assert.ok(b.notes.some((x) => /Only what is left is queued/.test(x.text)));
  });
  t('e2e queue: already done → closed and archived, not queued', () => {
    const r = json(run('pipeline.mjs', 'queue', 'delta', '--json'));
    assert.equal(r.status, 'archived'); assert.equal(r.mainCheck.verdict, 'done');
    const b = find('delta'); assert.equal(b.steps[0].done, true); assert.ok(b.notes.some((x) => /already done on main/.test(x.text)));
  });
  t('e2e queue: its branch landed (PR #77) with every step on main → done, PR linked', () => {
    const r = json(run('pipeline.mjs', 'queue', 'eta', '--json'));
    assert.equal(r.status, 'archived'); assert.equal(r.mainCheck.verdict, 'done');
    assert.ok(find('eta').steps.every((s) => s.done)); assert.match(find('eta').notes.at(-1).text, /commit [0-9a-f]{12}/);
  });
  t('e2e queue: superseded by a landed build with the same title → archived with the reason', () => {
    const r = json(run('pipeline.mjs', 'queue', 'dup', '--json'));
    assert.equal(r.status, 'archived'); assert.equal(r.mainCheck.verdict, 'superseded'); assert.equal(r.mainCheck.by, 'orig');
    assert.match(find('dup').notes.at(-1).text, /superseded: same work as orig/);
  });
  t('e2e queue: nothing on main → queued as is; --no-main-check skips the check', () => {
    assert.equal(json(run('pipeline.mjs', 'queue', 'theta', '--json')).mainCheck.verdict, 'open');
    assert.equal(find('theta').status, 'queued');
  });
  t('e2e the checks are readable without the UI (main-check with no id, status.state.mainChecks)', () => {
    const all = json(run('pipeline.mjs', 'main-check', '--json')).checks;
    assert.deepEqual(Object.keys(all).sort(), ['delta', 'dup', 'eta', 'gamma', 'theta']);
    assert.equal(all.gamma.stage, 'queue'); assert.equal(all.gamma.open, 's2,s3');
  });
  t('e2e setting: mainCheck=off queues without looking', () => {
    add({ id: 'iota', title: 'Iota', steps: [{ text: 'Create apps/x/delta.mjs', model: 'Opus', estimate: '20 min' }] });
    run('pipeline.mjs', 'set', 'mainCheck=off');
    const r = json(run('pipeline.mjs', 'queue', 'iota', '--json')); assert.equal(r.status, 'queued'); assert.equal(r.mainCheck.mode, 'off');
    run('pipeline.mjs', 'set', 'mainCheck=code');
  });
}

console.log(`main-check: ${n} checks passed`);
