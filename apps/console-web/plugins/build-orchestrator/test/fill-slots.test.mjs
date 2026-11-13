#!/usr/bin/env node
// Fill every slot (build-pipeline@1, BUILD-PARALLEL §4): parallel step worktrees, the merge back and its conflict path,
// on a scratch git repo with a bare origin and a scratch builds store.
//   node apps/console-web/plugins/build-orchestrator/test/fill-slots.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const tmp = mkdtempSync(join(tmpdir(), 'axf-fill-'));
const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

// a bare origin, a main clone (the "repo root") and the build branch with its own worktree
const origin = join(tmp, 'origin.git'); const repo = join(tmp, 'repo'); const wtRoot = join(tmp, 'worktrees');
sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
sh(tmp, 'clone', '-q', origin, repo);
for (const [k, v] of [['user.name', 'test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) sh(repo, 'config', k, v);
writeFileSync(join(repo, 'a.txt'), 'a\n'); writeFileSync(join(repo, 'shared.txt'), 'base\n');
sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'base'); sh(repo, 'push', '-q', 'origin', 'main');
mkdirSync(wtRoot, { recursive: true });
sh(repo, 'worktree', 'add', '-q', '-b', 'claude/dag', join(wtRoot, 'dag'), 'main');
sh(join(wtRoot, 'dag'), 'push', '-q', 'origin', 'claude/dag');

Object.assign(process.env, { AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all',
  AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_PIPELINE_REPO: repo, AXF_PIPELINE_WORKTREES: wtRoot, AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off' });
const store = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const pipe = await import('../pipeline.mjs');
const P = await import('../pipeline-core.mjs');

const step = (id, extra = {}) => ({ id, text: `step ${id}`, model: 'Opus', estimate: '5 min', ...extra });
store.withStore((s) => { s.builds.push(core.normBuild({ id: 'dag', title: 'DAG', profiles: ['all'], status: 'running', branch: 'claude/dag', steps: [
  step('s1', { done: true, doneAt: '2026-11-13T10:00:00.000Z' }), step('s2', { after: ['s1'], files: ['b.txt'] }), step('s3', { after: ['s1'], files: ['shared.txt'] }), step('s4', { after: ['s1'], files: ['shared.txt'] }),
] })); return s; }, { by: 'test', action: 'seed' });
const find = () => store.loadStore().builds.find((b) => b.id === 'dag');
const work = (dir, file, text, msg) => { writeFileSync(join(dir, file), text); sh(dir, 'add', file); sh(dir, 'commit', '-q', '-m', msg); sh(dir, 'push', '-q', 'origin', 'HEAD'); };

await t('ensureStepWorktree: branch <build-branch>--s2 off the build branch, in <root>/dag--s2; a second call keeps it', () => {
  const w = pipe.ensureStepWorktree(find(), 's2');
  assert.equal(w.branch, 'claude/dag--s2'); assert.equal(w.dir, join(wtRoot, 'dag--s2')); assert.equal(w.made, true); assert.equal(w.base, 'origin/claude/dag');
  assert.equal(sh(w.dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'claude/dag--s2');
  assert.equal(pipe.ensureStepWorktree(find(), 's2').made, false);
});
await t('mergeStepBack: a clean step branch merges --no-ff into the build branch, is pushed, then the step branch and worktree go', () => {
  work(join(wtRoot, 'dag--s2'), 'b.txt', 'b\n', 's2 work');
  const r = pipe.mergeStepBack('dag', 's2');
  assert.equal(r.merged, true, JSON.stringify(r));
  assert.equal(sh(join(wtRoot, 'dag'), 'show', 'HEAD:b.txt'), 'b');
  assert.match(sh(join(wtRoot, 'dag'), 'log', '-1', '--format=%s'), /Merge claude\/dag--s2/);
  assert.equal(sh(repo, 'ls-remote', 'origin', 'claude/dag').split('\t')[0], sh(join(wtRoot, 'dag'), 'rev-parse', 'HEAD'), 'pushed');
  assert.equal(existsSync(join(wtRoot, 'dag--s2')), false); assert.equal(sh(repo, 'ls-remote', 'origin', 'claude/dag--s2'), '');
  assert.match(find().notes.at(-1).text, /s2: claude\/dag--s2 merged into claude\/dag/);
});
await t('mergeStepBack: a conflict aborts the merge; the step goes back blocked, re-runs after the step it clashed with; the branch is kept', () => {
  const w3 = pipe.ensureStepWorktree(find(), 's3'); const w4 = pipe.ensureStepWorktree(find(), 's4');
  work(w3.dir, 'shared.txt', 'from s3\n', 's3 work'); work(w4.dir, 'shared.txt', 'from s4\n', 's4 work');
  assert.equal(pipe.mergeStepBack('dag', 's3').merged, true);
  store.withStore((s) => { const b = core.findBuild(s, 'dag'); b.steps[2].done = true; b.steps[2].doneAt = '2026-11-13T11:00:00.000Z'; return s; }, { by: 'test', action: 'tick' });
  const r = pipe.mergeStepBack('dag', 's4');
  assert.equal(r.conflict, true); assert.deepEqual(r.files, ['shared.txt']);
  const s4 = find().steps[3];
  assert.equal(s4.done, false); assert.deepEqual(s4.after, ['s3']); assert.equal(s4.parallel, 'never'); assert.equal(P.isConflictBlocked(s4), true);
  assert.match(s4.note, /^blocked: merge conflict on claude\/dag--s4 \(shared\.txt\): re-runs after s3/);
  assert.equal(sh(join(wtRoot, 'dag'), 'status', '--porcelain', '-uno'), '', 'the build worktree is clean after the abort');
  assert.equal(readFileSync(join(wtRoot, 'dag', 'shared.txt'), 'utf8'), 'from s3\n');
  assert.ok(existsSync(w4.dir)); assert.notEqual(sh(repo, 'ls-remote', 'origin', 'claude/dag--s4'), '', 'the conflicting branch is kept');
});
await t('mergeStepBack defers while the build worktree has uncommitted changes', () => {
  pipe.ensureStepWorktree(find(), 's2');
  writeFileSync(join(wtRoot, 'dag', 'a.txt'), 'dirty\n');
  const r = pipe.mergeStepBack('dag', 's2'); assert.equal(r.deferred, true); assert.equal(r.merged, false);
  sh(join(wtRoot, 'dag'), 'checkout', '--', 'a.txt');
});
await t('conflictBack (pure): with no file match it falls back to the previous step; a missing step is refused', () => {
  const b = { id: 'x', steps: [step('s1', { done: true }), step('s2', { after: [], claim: { runId: 'r' } })] };
  const c = P.conflictBack(b, 's2', { files: ['other.txt'], branch: 'claude/x--s2', now: Date.parse('2026-11-13T12:00:00Z') });
  assert.deepEqual(c.after, ['s1']); assert.equal('claim' in c.build.steps[1], false);
  assert.equal(P.conflictBack(b, 's9').ok, false);
});

// ---------------- the reconciler (builds-reconcile.mjs): dead step sessions, step branches
const R = await import('../../../../../framework/cli/builds-reconcile.mjs');
await t('reconciler: a step session that is not alive is reset to ready (worktree kept); a live one and the build session are left alone', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const claim = (runId, at) => ({ runId, slot: '', account: 'w', branch: 'claude/dag--s2', at, model: 'Opus', expiresAt: new Date(Date.parse(at) + 45 * 60e3).toISOString() });
  const b = { id: 'dag', steps: [step('s1', { done: true }), step('s2', { after: ['s1'], claim: claim('step-a', '2026-11-13T11:00:00Z') }), step('s3', { after: ['s1'], claim: claim('step-b', '2026-11-13T11:00:00Z') }), step('s4', { after: ['s1'], claim: claim('step-c', '2026-11-13T11:58:00Z') })] };
  const alive = R.stepAlive(['axf-dag--s3--joey'], []);
  const resets = R.stepResetPlan([b], alive, { now });
  assert.deepEqual(resets.map((r) => r.step), ['s2'], 's3 is alive in tmux; s4 is inside the grace period');
  assert.match(resets[0].why, /not alive: back to ready \(worktree and branch kept\)/);
  assert.deepEqual(R.stepResetPlan([b], R.stepAlive(null, []), { now }), [], 'no tmux to ask: nothing reset');
  assert.equal(R.stepAlive([], [{ build: 'dag', step: 's2', state: 'running' }])(b, b.steps[1]), true, 'an agent slot holding the step counts as alive');
});
await t('reconciler: step branches stay out of build matching; built only when every done parallel step branch merged back', () => {
  const b = { id: 'dag', branch: 'claude/dag', steps: [step('s1', { done: true }), step('s2', { after: ['s1'], done: true }), step('s3', { after: ['s1'], done: true, parallel: 'never' })] };
  assert.equal(R.isStepBranch([b], 'claude/dag--s2'), true); assert.equal(R.isStepBranch([b], 'claude/dag-other'), false);
  const open = R.stepBranchesOf([b], [{ name: 'claude/dag--s2' }, { name: 'claude/dag--s3' }, { name: 'claude/dag' }]);
  assert.deepEqual(open.get('dag'), [{ step: 's2', branch: 'claude/dag--s2' }], 'the kept branch of a conflict re-run does not hold the build');
  assert.equal(R.stepBranchesOf([b], [{ name: 'claude/dag' }]).size, 0);
});

console.log(`fill-slots: ${n} checks passed`);
