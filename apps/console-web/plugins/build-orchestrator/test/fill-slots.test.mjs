#!/usr/bin/env node
// Fill every slot (build-pipeline@1, BUILD-PARALLEL §4): parallel step worktrees, the merge back and its conflict path,
// on a scratch git repo with a bare origin and a scratch builds store.
//   node apps/console-web/plugins/build-orchestrator/test/fill-slots.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ---------------- the dispatcher end to end: 4 slots, two running builds (one a DAG), a fake claude in HOME/.local/bin
{
  const HERE = dirname(fileURLToPath(import.meta.url)); const PLUGIN = resolve(HERE, '..'); const ROOT = resolve(PLUGIN, '../../../..');
  const t2 = mkdtempSync(join(tmpdir(), 'axf-fill-e2e-'));
  const o2 = join(t2, 'origin.git'); const r2 = join(t2, 'repo'); const wt2 = join(t2, 'worktrees'); const home = join(t2, 'home'); const hdir = join(t2, 'headless');
  for (const d of [wt2, join(home, '.local', 'bin'), hdir, join(t2, 'slots'), join(t2, 'pipeline')]) mkdirSync(d, { recursive: true });
  sh(t2, 'init', '-q', '--bare', '-b', 'main', o2); sh(t2, 'clone', '-q', o2, r2);
  for (const [k, v] of [['user.name', 'test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) sh(r2, 'config', k, v);
  writeFileSync(join(r2, 'base.txt'), 'base\n'); sh(r2, 'add', '.'); sh(r2, 'commit', '-q', '-m', 'base'); sh(r2, 'push', '-q', 'origin', 'main');
  for (const id of ['dag', 'lin']) { sh(r2, 'worktree', 'add', '-q', '-b', `claude/${id}`, join(wt2, id), 'main'); sh(join(wt2, id), 'push', '-q', 'origin', `claude/${id}`); }
  // fake Claude logins: two worker accounts (Max with Fable, Pro without), three sessions each
  const acc = join(t2, 'accounts'); const workers = join(t2, 'workers');
  for (const a of ['console', 'w-max', 'w-pro']) { mkdirSync(join(acc, a), { recursive: true }); writeFileSync(join(acc, a, '.credentials.json'), '{}'); }
  writeFileSync(join(acc, '.active'), 'console\n'); mkdirSync(workers, { recursive: true });
  writeFileSync(join(workers, 'seen.json'), JSON.stringify({ console: { email: 'c@x', plan: 'max' }, 'w-max': { email: 'max@x', plan: 'max' }, 'w-pro': { email: 'pro@x', plan: 'pro' } }));
  writeFileSync(join(workers, 'workers.json'), JSON.stringify({ workers: ['w-max', 'w-pro'] }));
  const settingsFile = join(t2, 'claude-settings.json');
  // the fake claude: does the step (one file), commits and pushes the step branch, ticks the step
  writeFileSync(join(home, '.local', 'bin', 'claude'), `#!/usr/bin/env bash
set -e
f="$AXF_STEP_ID.txt"; echo "work of $AXF_STEP_ID" > "$f"; git add "$f"; git -c user.name=t -c user.email=t@example.invalid commit -q -m "$AXF_BUILD_ID $AXF_STEP_ID"; git push -q origin HEAD
node "${PLUGIN}/orchestrator.mjs" act step "$AXF_BUILD_ID" "$AXF_STEP_ID" done >/dev/null
`); chmodSync(join(home, '.local', 'bin', 'claude'), 0o755);
  // the fake launcher: what claude-headless.sh does that matters here (claude from HOME/.local/bin, start / end events)
  const launcher = join(t2, 'launcher.sh');
  writeFileSync(launcher, `#!/usr/bin/env bash
set -e
export PATH="$HOME/.local/bin:$PATH"
printf '%s\\n' "$*" >> "${t2}/launches.log"
name=""; step=""; account=""
while [[ $# -gt 0 ]]; do case "$1" in --name) name="$2"; shift 2;; --step) step="$2"; shift 2;; --account) account="$2"; shift 2;; --) shift; break;; *) shift;; esac; done
ses="axf-$name\${step:+--$step}--fake"
echo "{\\"event\\":\\"session-start\\",\\"session\\":\\"$ses\\",\\"name\\":\\"$name\\",\\"step\\":\\"$step\\",\\"at\\":\\"$(date -u +%FT%TZ)\\"}" >> "${hdir}/events.jsonl"
if [[ -n "$step" ]]; then
  grep -q "one step only: $step" .axf-brief.md || { echo "brief is not step-scoped" >&2; exit 9; }
  AXF_STEP_ID="$step" AXF_BUILD_ID="$name" claude
  echo "{\\"event\\":\\"session-end\\",\\"session\\":\\"$ses\\",\\"name\\":\\"$name\\",\\"step\\":\\"$step\\",\\"exit\\":0,\\"at\\":\\"$(date -u +%FT%TZ)\\"}" >> "${hdir}/events.jsonl"
fi
echo "started $ses in $(pwd)"
`); chmodSync(launcher, 0o755);
  const env = { ...process.env, HOME: home, AXF_BUILDS_STORE: join(t2, 'store.json'), AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_CREW_SAY: 'off',
    AXF_PIPELINE_DIR: join(t2, 'pipeline'), AXF_SLOTS_DIR: join(t2, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8', AXF_HEADLESS_DIR: hdir,
    AXF_CLAUDE_ACCOUNTS: acc, AXF_CLAUDE_SEEN: join(workers, 'seen.json'), AXF_CLAUDE_WORKERS: workers, AXF_CLAUDE_HOME: join(t2, 'claude-home'), AXF_CLAUDE_GLOBAL: join(t2, 'claude.json'),
    AXF_CLAUDE_SETTINGS_FILE: settingsFile, AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_SPLITTER: 'false', AXF_PIPELINE_WORKTREES: wt2, AXF_PIPELINE_REPO: r2, AXF_PIPELINE_CONSOLE: 'off',
    AXF_PIPELINE_SETTINGS: JSON.stringify({ parallelPerAccount: 3, idleAfterMin: 0, splitProvider: 'off' }) };
  for (const k of ['AXF_BUILD_ID', 'AXF_STEP_ID', 'AXF_DISPATCH_TOKEN', 'AXF_SESSION', 'AXF_SURFACE']) delete env[k];
  mkdirSync(join(t2, 'claude-home'), { recursive: true }); writeFileSync(join(t2, 'claude.json'), '{}');
  const S = (m) => spawnSync(process.execPath, [join(ROOT, 'framework/cli/agent-slots.mjs'), 'set', `maxAgents=${m}`], { env, encoding: 'utf8' });
  S(4);
  const node = (file, ...a) => { const r = spawnSync(process.execPath, [file, ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 }); if (r.status !== 0) throw new Error(`${file} ${a.join(' ')}: ${r.stdout}\n${r.stderr}`); return r; };
  const orch = (...a) => node(join(PLUGIN, 'orchestrator.mjs'), ...a);
  const tick = () => JSON.parse(node(join(PLUGIN, 'pipeline.mjs'), 'tick', '--json').stdout.trim().split('\n').pop());
  const st = (o) => ({ model: 'Opus', estimate: '5 min', ...o });
  orch('act', JSON.stringify({ action: 'add', id: 'dag', title: 'DAG build', steps: [st({ text: 'contract first' }), st({ text: 'wire part a', after: ['s1'], files: ['a.txt'] }), st({ text: 'wire part b', after: ['s1'], files: ['b.txt'] }),
    st({ text: 'touch part a again', after: ['s1'], files: ['a.txt'] }), st({ text: 'docs for it', after: ['s1'], files: ['docs.md'] }), st({ text: 'tests and PR', after: ['s2', 's3', 's4', 's5'] })] }));
  orch('act', JSON.stringify({ action: 'add', id: 'lin', title: 'Linear build', steps: [st({ text: 'one' }), st({ text: 'two', files: ['x.txt'] }), st({ text: 'three' })] }));
  orch('act', JSON.stringify({ action: 'add', id: 'pend', title: 'Pending clean', steps: [st({ text: 'a pending step', files: ['p.txt'] })] }));
  orch('act', JSON.stringify({ action: 'add', id: 'pend-clash', title: 'Pending clash', steps: [st({ text: 'touches a.txt', files: ['a.txt'] })] }));
  orch('act', 'step', 'dag', 's1', 'done');
  // both builds already run in their own sessions (the dispatcher started them earlier)
  const storeIo = (fn) => { const p = join(t2, 'store.json'); const j = JSON.parse(readFileSync(p, 'utf8')); fn(j); writeFileSync(p, JSON.stringify(j)); };
  storeIo((j) => { for (const b of j.builds) if (b.id === 'dag' || b.id === 'lin') { b.status = 'running'; b.branch = `claude/${b.id}`; b.pipeline = { ...(b.pipeline ?? {}), session: `axf-${b.id}`, account: b.id === 'dag' ? 'w-max' : 'w-pro', model: 'Opus', launchedAt: new Date().toISOString(), runs: 1 }; } });
  const find = (id) => JSON.parse(readFileSync(join(t2, 'store.json'), 'utf8')).builds.find((b) => b.id === id);

  let r1;
  await t('e2e fill: free slots take the DAG\'s ready steps (s3, s5); s4 is held back by its file clash with s2; the linear build gets none', () => {
    r1 = tick();
    const launched = r1.fill.launched.map((l) => `${l.id}/${l.step}`).sort();
    assert.deepEqual(launched, ['dag/s3', 'dag/s5'], JSON.stringify(r1.fill.plan));
    assert.ok(r1.fill.plan.waits.some((w) => w.id === 'dag' && w.step === 's4' && /files clash with s2 \(a\.txt\)/.test(w.why)), JSON.stringify(r1.fill.plan.waits));
    assert.ok(!r1.fill.plan.launches.some((l) => l.id === 'lin'), 'steps without a list stay in the build\'s own session');
    const log = readFileSync(join(t2, 'launches.log'), 'utf8');
    assert.match(log, /--name dag --step s3 --account w-/); assert.match(log, /--name dag --step s5 --account w-/);
    assert.ok(existsSync(join(wt2, 'dag--s3')) && existsSync(join(wt2, 'dag--s5')), 'one worktree per step');
    assert.equal(find('dag').steps[2].done, true, 'the fake claude ticked s3');
    assert.match(find('dag').notes.map((x) => x.text).join('\n'), /s3: started in parallel on w-/);
  });
  await t('e2e merge back: the next tick merges both step branches into claude/dag and deletes them', () => {
    const r = tick();
    assert.deepEqual(r.fill.ended.map((e) => `${e.step}:${e.outcome}`).sort(), ['s3:merged', 's5:merged'], JSON.stringify(r.fill.ended));
    assert.equal(sh(join(wt2, 'dag'), 'show', 'HEAD:s3.txt'), 'work of s3'); assert.equal(sh(join(wt2, 'dag'), 'show', 'HEAD:s5.txt'), 'work of s5');
    assert.equal(sh(r2, 'ls-remote', 'origin', 'claude/dag--s3'), ''); assert.equal(existsSync(join(wt2, 'dag--s3')), false);
    assert.deepEqual(r.fill.autoQueued, [], 'auto-queue is off: nothing moved');
    assert.equal(find('pend').status, 'pending');
  });
  await t('e2e auto-queue: only with builds.autoQueuePending on; the clean Pending build moves with its note, the clashing one waits', () => {
    writeFileSync(settingsFile, JSON.stringify({ values: { 'builds.autoQueuePending': true } }));
    const r = tick();
    assert.deepEqual(r.fill.autoQueued, ['pend']);
    assert.equal(find('pend').status, 'queued'); assert.ok(find('pend').notes.some((x) => x.text === 'auto-queued: slots free'));
    assert.equal(find('pend-clash').status, 'pending', 'a.txt is open in the running DAG build');
  });
  await t('e2e fill off: no step launches, even with ready steps and free slots', () => {
    writeFileSync(settingsFile, JSON.stringify({ values: { 'builds.fillSlots': false } }));
    storeIo((j) => { const b = j.builds.find((x) => x.id === 'dag'); b.steps[1].done = true; b.steps[1].doneAt = new Date().toISOString(); });
    const r = tick();
    assert.equal(r.fill.launched.length, 0); assert.equal(r.fill.plan, null);
  });
}

console.log(`fill-slots: ${n} checks passed`);
