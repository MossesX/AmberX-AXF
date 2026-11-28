#!/usr/bin/env node
/**
 * Checks for builds-live (store writes go live to main), the newer-wins merge and the reconciler (orch-live-sync).
 * Runs against throwaway git repos in a temp folder (a bare "origin" and clones), never the real remote.
 *
 *   node framework/spec/check-builds-live.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import * as merge from '../plan/builds-merge-core.mjs';
import * as rc from '../plan/builds-reconcile-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = join(ROOT, 'framework/cli/builds-live.mjs');
const ORCH = join(ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs');  // axf-plugin:build-orchestrator
const STORE_REL = '_claude/builds/store.json';
let pass = 0; let fail = 0;
const check = (ok, what) => { if (ok) pass += 1; else { fail += 1; console.log(`✗ ${what}`); } };

const T = mkdtempSync(join(tmpdir(), 'axf-live-check-'));
const WHO = { GIT_AUTHOR_NAME: 'check', GIT_AUTHOR_EMAIL: 'check@example.com', GIT_COMMITTER_NAME: 'check', GIT_COMMITTER_EMAIL: 'check@example.com' };
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...WHO } }); if (r.status !== 0 && !args.includes('--no-fail')) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const gitTry = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...WHO } });
const envFor = (clone, extra = {}) => ({
  ...process.env, ...WHO,
  AXF_BUILDS_STORE: join(clone, STORE_REL), AXF_BUILDS_LIVE: '1', AXF_BUILDS_LIVE_GIT: clone, AXF_BUILDS_LIVE_SYNC: '1', AXF_BUILDS_LIVE_PUSH: 'every',
  AXF_CONSOLE_ROOT: 'off', AXF_BUILD_PROFILE: 'all', AXF_BUILDS_EXPORT: '0', AXF_ACTOR: `check-${clone.slice(-1)}`, ...extra,
});
const run = (clone, script, args, extra) => spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: envFor(clone, extra) });
const runAsync = (clone, script, args) => new Promise((ok) => { const c = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: envFor(clone) }); let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', (code) => ok({ code, out })); });
const mainStore = () => JSON.parse(git(join(T, 'a'), 'show', 'origin/main:' + STORE_REL));
const fetchA = () => git(join(T, 'a'), 'fetch', '-q', 'origin');
const stepsDone = (s, id) => s.builds.find((b) => b.id === id).steps.filter((x) => x.done).map((x) => x.id).join(',');

function seed() {
  git(T, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  const s = join(T, 'seed'); git(T, 'clone', '-q', join(T, 'remote.git'), 'seed');
  const now = '2026-11-03T10:00:00.000Z';
  const store = core.emptyStore(now);
  store.migratedAt = now;
  for (const id of ['x', 'y']) store.builds.push(core.normBuild({ id, title: `Build ${id}`, profiles: ['all'], steps: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, text: `step ${n} of ${id}`, model: 'Opus' })) }, { now, seed: id }));
  mkdirSync(join(s, '_claude/builds/journal'), { recursive: true });
  writeFileSync(join(s, STORE_REL), `${JSON.stringify(core.compactStore(store), null, 1)}\n`);
  writeFileSync(join(s, '_claude/THREADS.md'), '# Threads\n\n## Active\n\n| Thread | State |\n|---|---|\n| a | working |\n');
  // a retired profile's export an older checkout left on main (one profile since Nov 7 2026): the next publish takes it off
  mkdirSync(join(s, '_claude/builds/profiles/current'), { recursive: true });
  writeFileSync(join(s, '_claude/builds/profiles/current/orchestrator.json'), '{"$axf":"orchestrator@1","builds":[]}\n');
  // and the old status file itself (retired Nov 28 2026: status lives in the store only)
  writeFileSync(join(s, '_claude/builds/orchestrator.json'), '{"$axf":"orchestrator@1","builds":[{"id":"x","status":"queued"}]}\n');
  writeFileSync(join(s, '.gitattributes'), '_claude/builds/store.json merge=axf-builds\n_claude/builds/journal/*.jsonl merge=axf-builds\n');
  git(s, 'add', '-A'); git(s, 'commit', '-q', '-m', 'seed'); git(s, 'push', '-q', 'origin', 'main');
  for (const c of ['a', 'b', 'c']) git(T, 'clone', '-q', join(T, 'remote.git'), c);
}

async function main() {
  seed();
  const A = join(T, 'a'); const B = join(T, 'b'); const C = join(T, 'c');
  const seedSha = git(A, 'rev-parse', 'HEAD');

  // 1. one step reaches main at once; the clone's branch and HEAD are untouched
  let r = run(A, ORCH, ['act', 'step', 'x', 's1', 'done']);
  check(r.status === 0, `tick s1 on A: ${r.stderr}`);
  fetchA();
  let m = mainStore();
  check(stepsDone(m, 'x') === 's1', `main has x s1 done (has ${stepsDone(m, 'x')})`);
  check(git(A, 'rev-parse', 'HEAD') === seedSha, 'A\'s own branch got no commit');
  const msg = git(A, 'log', '-1', '--format=%B', 'origin/main');
  check(/\[skip ci\]/.test(msg) && /Builds live: .*x.* s1 done/.test(msg), `status commit says what changed and skips CI: ${msg.split('\n')[0]}`);
  const threads = git(A, 'show', 'origin/main:_claude/THREADS.md');
  check(threads.includes(merge.LIVE_HEAD ?? '## Live build log') && /`x` s1 done/.test(threads), 'THREADS.md on main got a live log line');
  check(threads.indexOf('| a | working |') < threads.indexOf('## Live build log'), 'the live log sits after the thread rows');
  const files = git(A, 'show', '--name-only', '--format=', 'origin/main').split('\n');
  check(files.every((f) => f.startsWith('_claude/')), `status commit touches only _claude/ (${files.join(' ')})`);
  check(files.some((f) => f.startsWith('_claude/builds/journal/')), 'status commit carries the journal line');
  check(gitTry(A, 'cat-file', '-e', 'origin/main:_claude/builds/profiles/current/orchestrator.json').status !== 0, 'a retired profile\'s export is taken off main by the next publish');
  check(gitTry(A, 'cat-file', '-e', 'origin/main:_claude/builds/orchestrator.json').status !== 0, 'the old status file is taken off main by the next publish and never written again');
  check(!existsSync(join(A, '_claude/builds/orchestrator.json')) || !readFileSync(join(A, '_claude/builds/orchestrator.json'), 'utf8').includes('s1'), 'no status file is written into the checkout either');
  const live = JSON.parse(run(A, LIVE, ['status', '--json']).stdout);
  check(live.queued === 0 && live.lastOk && !live.stuck, 'outbox empty, last publish recorded');

  // 2. parallel writers on two clones, B's copy stale: both steps land, nothing regresses, history stays linear
  const [ra, rb] = await Promise.all([runAsync(A, ORCH, ['act', 'step', 'x', 's3', 'done']), runAsync(B, ORCH, ['act', 'step', 'x', 's2', 'done'])]);
  check(ra.code === 0 && rb.code === 0, `parallel ticks ran (${ra.out} ${rb.out})`);
  fetchA(); m = mainStore();
  check(stepsDone(m, 'x') === 's1,s2,s3', `main has s1, s2, s3 (has ${stepsDone(m, 'x')})`);
  check(git(A, 'rev-list', '--merges', '--count', 'origin/main') === '0', 'no merge commits on main (rebase-retry, never forced)');
  check(git(A, 'rev-list', '--count', 'origin/main') === '4', `seed + 3 status commits (${git(A, 'rev-list', '--count', 'origin/main')})`);
  const bLocal = JSON.parse(readFileSync(join(B, STORE_REL), 'utf8'));
  check(stepsDone(bLocal, 'x').includes('s1'), 'B pulled main back: its stale copy now has s1');

  // a lost race quotes commit ids: an id with 403 in it is still "main moved" (retried), a real refusal is not
  const live0 = await import('../cli/builds-live.mjs');
  const raced = "remote: error: cannot lock ref 'refs/heads/main': is at d71df58c7622532269e85806133e46908337c5fe but expected b9beaba02f48a3993a9132397e3286f7a0625536\n ! [remote rejected] 4dc9e1f8f88403802d918e54d7574c572235e763 -> main (failed to update ref)";
  check(live0.pushRetryable(raced), 'a lost push race is retried even when a commit id in the message holds 403');
  check(live0.pushRetryable(' ! [rejected] abc -> main (fetch first)'), 'main moved (fetch first) is retried');
  check(!live0.pushRetryable('remote: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] abc -> main (protected branch hook declined)'), 'a protected branch is not retried');
  check(!live0.pushRetryable('fatal: unable to access: The requested URL returned error: 403\n ! [rejected]'), 'an HTTP 403 is not retried');
  check(!live0.pushRetryable('fatal: repository not found'), 'an unrelated failure is not retried');

  // 3. retry: the remote rejects the first push (main moved), the second goes through
  const hook = join(T, 'remote.git', 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\nif [ ! -f "${T}/rejected-once" ]; then touch "${T}/rejected-once"; echo "rejected: fetch first" >&2; exit 1; fi\nexit 0\n`); chmodSync(hook, 0o755);
  r = run(A, ORCH, ['act', 'step', 'y', 's1', 'done']);
  fetchA(); m = mainStore();
  check(existsSync(join(T, 'rejected-once')) && stepsDone(m, 'y') === 's1', 'a rejected push is retried and lands');

  // 4. a refusal that isn't "main moved" (protection) is not retried: the change stays queued and status says why
  writeFileSync(hook, '#!/bin/sh\necho "GH006: Protected branch update failed for refs/heads/main." >&2\nexit 1\n'); chmodSync(hook, 0o755);
  r = run(A, ORCH, ['act', 'step', 'y', 's2', 'done']);
  let st = JSON.parse(run(A, LIVE, ['status', '--json']).stdout);
  check(st.queued === 1 && st.stuck && /refused/.test(st.error), `protected main: queued + stuck (${JSON.stringify(st).slice(0, 160)})`);
  rmSync(hook);
  r = run(A, LIVE, ['flush']);
  st = JSON.parse(run(A, LIVE, ['status', '--json']).stdout);
  fetchA(); m = mainStore();
  check(r.status === 0 && st.queued === 0 && !st.stuck && stepsDone(m, 'y') === 's1,s2', 'flush publishes the queued change once main takes pushes again');

  // 5. link: all steps done + an open PR = built; merged = complete
  for (const s of ['s3', 's4']) run(A, ORCH, ['act', 'step', 'y', s, 'done']);
  r = run(A, LIVE, ['link', 'y', '--branch', 'claude/y', '--pr', 'https://github.com/o/r/pull/12']);
  fetchA(); m = mainStore();
  let y = m.builds.find((b) => b.id === 'y');
  // done-means-merged@1: every step done + an open PR = landing (the lander's); merged = landed (complete only once verified)
  check(y.status === 'landing' && y.pr === '#12' && y.branch === 'claude/y', `link: landing, awaiting merge (${y.status} ${y.pr} ${y.branch})`);
  r = run(A, LIVE, ['link', 'y', '--merged']);
  fetchA(); m = mainStore(); y = m.builds.find((b) => b.id === 'y');
  // the store guard: merged without CI on the merge commit is not landed; the refusal is a note
  check(y.status === 'landing' && !!y.mergedAt && y.notes.some((n) => /^Refused landing → landed/.test(n.text)), `merged, no CI evidence: refused, stays landing with a note (${y.status})`);
  r = run(A, LIVE, ['link', 'y', '--sha', 'abc1234', '--ci', 'success']);
  fetchA(); m = mainStore(); y = m.builds.find((b) => b.id === 'y');
  check(y.status === 'landed' && y.landed?.sha === 'abc1234' && y.landed?.ci === 'success', `merged + CI green on the merge commit: landed (${y.status})`);
  check(core.validateStore(m).ok, 'main\'s store is valid builds@1 after every live write');

  // 6. a feature branch with its own (older) copy merges main with the driver: clean, newer wins, nothing regresses
  run(C, ORCH, ['act', 'step', 'x', 's4', 'done'], { AXF_BUILDS_LIVE: '0' }); // offline write on C's branch
  git(C, 'checkout', '-q', '-b', 'feat'); git(C, 'add', '-A'); git(C, 'commit', '-q', '-m', 'feature work + its store copy');
  git(C, 'config', 'merge.axf-builds.driver', `node "${LIVE}" merge-driver %O %A %B %P`);
  git(C, 'fetch', '-q', 'origin');
  const mg = gitTry(C, 'merge', '--no-edit', 'origin/main');
  const cs = JSON.parse(readFileSync(join(C, STORE_REL), 'utf8'));
  check(mg.status === 0, `merge with the driver is clean (${mg.stdout}${mg.stderr})`);
  check(stepsDone(cs, 'x') === 's1,s2,s3,s4' && cs.builds.find((b) => b.id === 'y').status === 'landed', `merged store: x ${stepsDone(cs, 'x')}, y ${cs.builds.find((b) => b.id === 'y').status}`);

  // 7. heal: a pushed branch whose builds files conflict with main gets main merged in (driver), pushed, not forced
  const D = join(T, 'd'); git(T, 'clone', '-q', join(T, 'remote.git'), 'd');
  git(D, 'checkout', '-q', '-b', 'claude/heal-me', seedSha);
  run(D, ORCH, ['act', 'step', 'x', 's4', 'done'], { AXF_BUILDS_LIVE: '0' });
  git(D, 'add', '-A'); git(D, 'commit', '-q', '-m', 'branch copy of the store'); git(D, 'push', '-q', 'origin', 'claude/heal-me');
  const plain = gitTry(D, 'merge', '--no-edit', '--no-commit', 'origin/main'); gitTry(D, 'merge', '--abort');
  r = run(A, LIVE, ['heal', 'claude/heal-me']);
  check(r.status === 0, `heal: ${r.stdout}${r.stderr}`);
  const healed = JSON.parse(git(A, 'show', `${git(A, 'ls-remote', 'origin', 'refs/heads/claude/heal-me').split('\t')[0]}:${STORE_REL}`) || '{}');
  check(healed.builds && stepsDone(healed, 'x') === 's1,s2,s3,s4', `healed branch has every step (${healed.builds ? stepsDone(healed, 'x') : 'none'}; plain merge exit ${plain.status})`);

  // 8. pure: a stale copy never undoes a newer tick; notes and links are never blanked
  const base = mainStore().builds.find((b) => b.id === 'x');
  const stale = JSON.parse(JSON.stringify(base)); stale.updatedAt = '2026-11-03T09:00:00.000Z'; stale.steps.forEach((s) => { s.done = false; s.doneAt = ''; s.updatedAt = '2026-11-03T09:00:00.000Z'; }); stale.status = 'pending';
  const mb = merge.mergeBuild(stale, base);
  check(mb.steps.map((s) => s.done).join() === base.steps.map((s) => s.done).join() && mb.status === base.status, 'stale copy loses to the newer one');
  const newerUndo = JSON.parse(JSON.stringify(base)); newerUndo.updatedAt = '2026-12-01T00:00:00.000Z'; newerUndo.steps[3] = { ...newerUndo.steps[3], done: false, doneAt: '', updatedAt: '2026-12-01T00:00:00.000Z' }; newerUndo.branch = '';
  const mu = merge.mergeBuild(base, newerUndo);
  check(!mu.steps[3].done && mu.steps[0].done, 'a newer undo wins for that step only');
  check(mu.branch === base.branch, 'a blank branch never wipes a set one');
  { // pipeline-2@1: a stale copy that ticked a step (newer rev, no runtime fields) never strips the step's status contract
    const st = (o) => ({ uid: 'u1', id: 's1', text: 'Part 1', model: 'Opus', estimate: '10 min', ...o });
    const live = { id: 'p', title: 'p', flow: 'pipeline-2', status: 'building', statusAt: '2026-11-20T06:57:04.000Z', statusLog: [{ status: 'ready', at: '2026-11-20T06:50:00.000Z', by: 'o', attempt: 1 }, { status: 'building', at: '2026-11-20T06:57:04.000Z', by: 'o', attempt: 1 }], attempt: 1, updatedAt: '2026-11-20T06:57:04.000Z', rev: 5, notes: [],
      steps: [st({ status: 'building', statusAt: '2026-11-20T06:57:04.000Z', attempt: 3, tmux: 'axf-p--s1--earl', worktree: '/w/p--s1', branch: 'claude/p--s1', account: 'a', updatedAt: '2026-11-20T06:57:04.000Z', rev: 4 })] };
    const ticked = { ...JSON.parse(JSON.stringify(live)), status: 'running', statusLog: live.statusLog.slice(0, 1), updatedAt: '2026-11-20T07:08:34.000Z', rev: 6,
      steps: [st({ status: 'ready', statusAt: '2026-11-20T04:54:19.000Z', attempt: 1, done: true, doneAt: '2026-11-20T07:08:34.000Z', updatedAt: '2026-11-20T07:08:34.000Z', rev: 5 })] };
    for (const [m, how] of [[merge.mergeBuild(live, ticked), 'stale copy newer'], [merge.mergeBuild(ticked, live), 'other order']]) {
      const s1 = m.steps[0];
      check(s1.done === true && s1.status === 'building' && s1.tmux === 'axf-p--s1--earl' && s1.worktree === '/w/p--s1' && s1.account === 'a' && s1.attempt === 3, `pipeline-2 merge (${how}): the tick survives, status / tmux / worktree / account / attempt kept (${JSON.stringify({ d: s1.done, st: s1.status, t: s1.tmux, a: s1.attempt })})`);
      check(m.status === 'building', `pipeline-2 merge (${how}): the build keeps its flow status (${m.status})`);
    }
    check(merge.liveStatus({ flow: 'pipeline-2', status: 'building', steps: [{ done: true }] }) === 'building', 'liveStatus never derives a builds@1 status for a pipeline-2 build');
  }
  check(merge.mergeJournalText('{"at":"2"}\n{"at":"1"}\n', '{"at":"1"}\n{"at":"3"}\n') === '{"at":"2"}\n{"at":"1"}\n{"at":"3"}\n', 'journal union: the first file as it is, then each new line once');
  // done-means-merged@1: all done = landing until merged, landed once merged (with or without a PR: never complete without the verify)
  check(merge.liveStatus({ status: 'running', pr: '#5', steps: [{ done: true }] }) === 'landing' && merge.liveStatus({ status: 'running', pr: '#5', mergedAt: 'x', steps: [{ done: true }] }) === 'landed' && merge.liveStatus({ status: 'running', steps: [{ done: true }] }) === 'landing', 'liveStatus: landing until merged, landed once merged, never built or complete');
  check(merge.liveStatus({ status: 'archived', pr: '#5', steps: [{ done: true }] }) === 'archived' && merge.liveStatus({ status: 'complete', mergedAt: 'x', steps: [{ done: false }] }) === 'complete' && merge.liveStatus({ status: 'complete', pr: '#5', steps: [{ done: false }] }) === 'landing' && merge.liveStatus({ status: 'complete', steps: [{ done: false }] }) === 'complete' && merge.liveStatus({ status: 'fixing', steps: [{ done: true }] }) === 'fixing' && merge.liveStatus({ status: 'escalated', steps: [{ done: true }] }) === 'escalated', 'liveStatus keeps archived, merged complete, fixing and escalated; an unmerged complete without ticks is landing');
  check(merge.liveStatus({ status: 'pending', steps: [{ done: true }, { done: false }] }) === 'pending' && merge.liveStatus({ status: 'running', steps: [{ done: true }, { done: false }] }) === 'running', 'liveStatus: a paused (pending) build with ticks stays pending');
  check(merge.liveStatus({ status: 'complete', pr: '#5', mergedAt: 'x', steps: [{ done: true }, { done: false }] }) === 'complete', 'liveStatus: merged = complete even with steps unticked');

  // 8b. running = a live process runs it (hotfix-build-manager, Nov 4 2026)
  {
    const now = '2026-11-04T12:00:00.000Z'; const old = '2026-11-04T10:00:00.000Z';
    const b = (id, extra = {}) => ({ id, status: 'running', updatedAt: old, pr: '', steps: [{ id: 's1', done: true }, { id: 's2', done: false }], ...extra });
    const alive = rc.aliveIds({ sessions: ['axf-live-one--earl'], slots: [{ name: 'slot-one' }], now,
      changes: [{ state: 'running', lastSeenAt: '2026-11-04T11:55:00.000Z', buildRef: { kind: 'queue', id: 'hb-one' } }, { state: 'running', lastSeenAt: old, buildRef: { id: 'quiet-one' } }, { state: 'running', lastSeenAt: '2026-11-04T11:58:00.000Z', branch: 'claude/branch-one' }] });
    check(['live-one', 'slot-one', 'hb-one', 'branch-one'].every((x) => alive.has(x)) && !alive.has('quiet-one'), 'aliveIds: tmux sessions, agent slots, fresh build-log heartbeats (a quiet one is not alive)');
    const builds = [b('live-one'), b('slot-one'), b('stale'), b('fresh', { updatedAt: '2026-11-04T11:50:00.000Z' }), b('merged', { pr: '#9', mergedAt: old }),
      b('all-done', { pr: '#7', steps: [{ id: 's1', done: true }] }), b('epic', { kind: 'epic', planRef: 'x.epic' }), b('ticked'), { ...b('waits'), status: 'pending' }];
    const plan = rc.idlePlan(builds, alive, { now, skip: ['ticked'] });
    const to = Object.fromEntries(plan.map((c) => [c.id, c.set.status]));
    check(JSON.stringify(to) === JSON.stringify({ stale: 'pending', merged: 'landed', 'all-done': 'landing' }), `idlePlan: stale → pending (paused), merged → landed, all done → landing; live, fresh, epics, ticked and pending untouched (${JSON.stringify(to)})`);
    check(rc.idlePlan(builds, null, { now }).length === 0, 'idlePlan: processes unseen (no tmux) = nothing touched');
  }

  // 9. reconciler matching
  const B1 = { id: 'theme-editor', branch: '', pr: '', status: 'pending', steps: [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, done: false })) };
  const B2 = { id: 'token-control', branch: '', pr: '', status: 'pending', steps: Array.from({ length: 14 }, (_, i) => ({ id: `s${i + 1}`, done: false })) };
  const B3 = { id: 'dock-engine', branch: '', pr: '', status: 'pending', steps: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, done: false })) };
  const B4 = { id: 'md-studio', branch: '', pr: '', status: 'pending', steps: [1, 2, 3].map((n) => ({ id: `s${n}`, done: false })) };
  const prs = [
    { number: 243, branch: 'claude/theme-editor', title: 'Theme editor plugin', body: '', state: 'open', updatedAt: '5', commits: ['theme-editor s1: sections', 's2 views'] },
    { number: 250, branch: 'claude/token-control-opus', title: 'Token control (token-control s4-s14)', body: '', state: 'open', updatedAt: '4', commits: [] },
    { number: 246, branch: 'claude/token-control', title: 'Token control, Fable phase', body: 'token-control s1–s3 done on Fable', state: 'open', updatedAt: '3', commits: [] },
    { number: 245, branch: 'claude/molly-fable', title: 'Fable foundation', body: 'Builds dock-engine s1-s4 (all done).', state: 'open', updatedAt: '2', commits: [] },
    { number: 242, branch: 'claude/md-studio-plan', title: 'MD Studio plan', body: '- md-studio s1 layout\n- md-studio s2 browser', state: 'merged', mergedAt: '2026-11-02T00:00:00Z', updatedAt: '1', commits: [] },
    { number: 99, branch: 'claude/random', title: 'Something else', body: '', state: 'open', updatedAt: '0', commits: [] },
    { number: 98, branch: 'claude/old', title: 'theme-editor s5 done', body: '', state: 'closed', updatedAt: '0', commits: [] },
  ];
  const branches = [{ name: 'claude/theme-editor', ahead: 3, updatedAt: '2026-11-03T00:00:00Z', pr: 243 }, { name: 'claude/stray', ahead: 2, updatedAt: '2026-11-02T00:00:00Z', pr: 0 }, { name: 'claude/merged-away', ahead: 0, updatedAt: '2026-11-02T00:00:00Z', pr: 0 }];
  const p = rc.plan([B1, B2, B3, B4], prs, branches, { now: '2026-11-03T12:00:00Z' });
  const ch = (id) => p.changes.find((c) => c.id === id) ?? { set: {}, steps: [] };
  check(ch('theme-editor').set.branch === 'claude/theme-editor' && ch('theme-editor').set.pr === '#243' && ch('theme-editor').steps.join() === 's1,s2', `branch name = build id: linked, commit steps ticked (${JSON.stringify(ch('theme-editor'))})`);
  check(ch('token-control').set.pr === '#250' && ch('token-control').set.branch === 'claude/token-control-opus', 'two PRs: the newest one is linked');
  check(ch('token-control').steps.length === 14 && ch('token-control').stepNotes.s2 === 'PR #246 (claude/token-control)' && ch('token-control').stepNotes.s9 === 'PR #250 (claude/token-control-opus)', 'steps from both PRs, each noting its PR');
  check(ch('dock-engine').set.pr === '#245' && ch('dock-engine').steps.join() === 's1,s2,s3,s4', 'PR naming a build\'s steps as done links it');
  check(ch('md-studio').steps.length === 0, 'a plan PR listing steps without "done" ticks nothing');
  check(!p.changes.some((c) => c.why.some((w) => w.includes('#98'))), 'closed, unmerged PRs are ignored');
  check(p.orphans.prs.map((x) => x.number).join() === '99', `orphan PRs: ${p.orphans.prs.map((x) => x.number)}`);
  check(p.orphans.branches.map((x) => x.branch).join() === 'claude/stray', `orphan branches: ${p.orphans.branches.map((x) => x.branch)}`);
  check(rc.stepRefs(B2, ['token-control s4 next, s5 left']).length === 0, 'lines about work still to do tick nothing');
  check(rc.score({ id: 'x', branch: '', pr: '' }, { branch: 'claude/x', title: '' }) === 90 && rc.score({ id: 'abc', branch: '', pr: '' }, { title: 'abc' }) === 0, 'short ids only match by branch, never by a word in a title');
  const merged = rc.plan([{ ...B1, branch: 'claude/theme-editor', pr: '#243', steps: B1.steps.map((s) => ({ ...s, done: true })) }], [{ ...prs[0], state: 'merged', mergedAt: '2026-11-03T11:00:00Z' }], [], {});
  check(merged.changes[0]?.set.mergedAt === '2026-11-03T11:00:00Z', 'the build\'s own PR merged: mergedAt recorded');

  // 9b. the reconciler's one write: Brett's stops stick, a status read before the build moved is not written, a
  // deleted build is left alone; ticks and PR fields still come in
  {
    const dir = mkdtempSync(join(tmpdir(), 'axf-reconcile-check-'));
    const keep = { ...process.env };
    Object.assign(process.env, { AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0', AXF_BUILD_PROFILE: 'all' });
    delete process.env.AXF_DATA_DIR;
    try {
      const now = '2026-11-28T10:00:00.000Z';
      const st = core.emptyStore(now); st.migratedAt = now;
      const mk = (id, status, extra = {}) => core.normBuild({ id, title: id, profiles: ['all'], status, steps: [1, 2, 3].map((n) => ({ id: `s${n}`, text: `step ${n}`, model: 'Opus' })), ...extra }, { now, seed: id });
      const stop = (kind, from) => ({ stop: { kind, at: now, by: 'brett', why: 'not now', from } });
      st.builds.push(mk('held', 'pending', { pipeline: { ...stop('hold', 'queued'), heldAt: now, heldBy: 'brett' } }), mk('cancelled', 'pending', { pipeline: stop('cancel', 'running') }), mk('unqueued', 'pending', { pipeline: stop('unqueue', 'queued') }),
        mk('moved', 'queued'), mk('gone', 'running', { deleted: true, deletedAt: now }), mk('plain', 'running'));
      writeFileSync(join(dir, 'store.json'), `${JSON.stringify(core.compactStore(st), null, 1)}\n`);
      const R = await import('../cli/builds-reconcile.mjs');
      const S = await import('../cli/builds-store.mjs');
      const BP = await import('../core/build-pipeline.mjs');
      check(['held', 'cancelled', 'unqueued'].every((id) => BP.stopOf(S.loadStore().builds.find((b) => b.id === id))), 'the stops are in the store as the contract reads them');
      const chg = (id, set, steps = []) => ({ id, set, steps, stepNotes: Object.fromEntries(steps.map((x) => [x, 'PR #7'])), why: [`test ${id}`] });
      const plan = {
        changes: [chg('held', { status: 'running', pr: '#7', branch: 'claude/held' }, ['s1']), chg('cancelled', { status: 'landing' }), chg('unqueued', {}, ['s1', 's2', 's3']), chg('moved', { status: 'pending' }), chg('gone', { status: 'pending' }), chg('plain', { status: 'pending' })],
        stepResets: [], seen: new Map([['held', 'pending'], ['cancelled', 'pending'], ['unqueued', 'pending'], ['moved', 'running'], ['gone', 'running'], ['plain', 'running']]),
      };
      const out = R.applyPlan(plan);
      const after = Object.fromEntries(S.loadStore().builds.map((b) => [b.id, b]));
      check(after.held.status === 'pending' && BP.stopOf(after.held)?.kind === 'hold' && after.held.pipeline.heldAt === now, `a held build stays held, whatever the pass worked out (${after.held.status})`);
      check(after.held.steps[0].done && after.held.pr === '#7' && after.held.branch === 'claude/held', 'its ticked step and PR fields still come in');
      check(after.cancelled.status === 'pending' && BP.stopOf(after.cancelled)?.kind === 'cancel', `a cancelled build is not set landing (${after.cancelled.status})`);
      check(after.unqueued.status === 'pending' && BP.stopOf(after.unqueued)?.kind === 'unqueue' && after.unqueued.steps.every((x) => x.done) && !after.unqueued.builtAt, `an unqueued build with every step ticked stays in Pending (${after.unqueued.status})`);
      check(out.kept.map((x) => x.id).sort().join() === 'cancelled,held,unqueued', `the stops that stood are reported (${out.kept.map((x) => x.id).join()})`);
      check(after.held.notes.at(-1).text.includes('only Brett lifts that'), 'the build carries a note saying why it was left');
      check(after.moved.status === 'queued' && out.stale.length === 1 && out.stale[0].id === 'moved' && out.stale[0].not === 'pending', `a build that moved during the pass keeps its new status (${after.moved.status})`);
      check(after.gone.status === 'running' && after.gone.deleted === true && after.gone.notes.length === 0, 'a deleted build is left alone');
      check(after.plain.status === 'pending', `an ordinary build still takes the pass's answer (${after.plain.status})`);
      const again = R.applyPlan(plan);
      check(S.loadStore().builds.find((b) => b.id === 'held').notes.length === after.held.notes.length && again.kept.length === 3, 'a second pass keeps the stops and adds no second note');
      check(R.keepStopOn(after.plain, { ...after.plain, status: 'running' }) === '' && R.keepStopOn(after.held, JSON.parse(JSON.stringify(after.held))) === '', 'keepStopOn: nothing to say for a build that is not stopped or was not moved');
      const lifted = JSON.parse(JSON.stringify(after.cancelled)); delete lifted.pipeline.stop; lifted.pipeline.queuedAt = now; lifted.status = 'queued';
      check(R.keepStopOn(after.cancelled, lifted) !== '' && lifted.status === 'pending' && BP.stopOf(lifted)?.kind === 'cancel' && !lifted.pipeline.queuedAt, 'keepStopOn: a cleared stop and a queue stamp are put back');
      check(R.stoppedAmong([{ id: 'held' }, { id: 'plain' }, { id: 'nope' }], Object.values(after)).join() === 'held', 'stoppedAmong: the requeue pass sees which of its builds are stopped');
      check(live0.unknownBuilds({ builds: [{ id: 'a', deleted: true }, { id: 'b' }] }, { builds: [{ id: 'a', status: 'queued' }, { id: 'b', status: 'running' }, { id: 'c' }] }).map((b) => b.id).join() === 'c', 'unknownBuilds: main\'s copy only brings builds the database has no record of (a deleted one is a record)');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 10. threads log: appended in its section, capped, before a later heading
  let t = 'x\n## Active\nrow\n';
  t = merge.LIVE_HEAD ? t : t;
  const { appendThreads } = await import('../cli/builds-live.mjs');
  t = appendThreads(t, ['- one']); t = appendThreads(`${t}\n## After\nkeep\n`, ['- two', '- one']);
  check(/## Live build log[\s\S]*- one\n- two\n\n## After\nkeep/.test(t) && t.indexOf('row') < t.indexOf('## Live build log'), `threads section: ${JSON.stringify(t.slice(-80))}`);

  // 11. a month rolls into a new part before GitHub's file limit; a full part is never rewritten
  check(merge.journalPart('2026-11', {}, 10, 100) === '2026-11', 'first journal file of a month');
  check(merge.journalPart('2026-11', { '2026-11': 95 }, 10, 100) === '2026-11-p2', 'over the cap: next part');
  check(merge.journalPart('2026-11', { '2026-11': 95, '2026-11-p2': 5 }, 10, 100) === '2026-11-p2', 'the last part keeps filling');
  check(merge.journalPart('2026-11', { '2026-11': 95, '2026-11-p2': 95, '2026-10': 500 }, 10, 100) === '2026-11-p3', 'parts count up, other months ignored');
  fetchA();
  const J = '_claude/builds/journal';
  const fullBefore = git(A, 'ls-tree', '-r', '--name-only', 'origin/main', J).split('\n').filter(Boolean);
  const small = { AXF_BUILDS_JOURNAL_BYTES: '1' };
  r = run(A, ORCH, ['act', 'step', 'y', 's4', 'done'], small); check(r.status === 0, `tick with a tiny cap: ${r.stderr}`);
  fetchA();
  const after = git(A, 'ls-tree', '-r', '--name-only', 'origin/main', J).split('\n').filter(Boolean);
  const part = after.find((f) => !fullBefore.includes(f));
  check(!!part && /-p\d+\.jsonl$/.test(part), `the new line went to a new part (${part})`);
  check(git(A, 'show', '--name-only', '--format=', 'origin/main').split('\n').filter((f) => f.startsWith(J)).length === 1, 'the commit touches only that part, full parts stay as they are');
  const hist = JSON.parse(run(A, join(ROOT, 'framework/cli/builds-store.mjs'), ['history', 'y', '--json']).stdout || '{}').history ?? [];
  check(hist.filter((h) => h.action === 'orchestrator:step').length >= 1, 'history still reads every part');

  // 12. one bad record stays out; the rest of the batch still reaches main
  const outbox = join(A, `${STORE_REL}.live-outbox.jsonl`);
  const cur = mainStore().builds.find((b) => b.id === 'x');
  const stamp = new Date(Date.now() + 60000).toISOString();
  const poisoned = { ...cur, updatedAt: stamp, steps: [{ ...cur.steps[0], text: 'a second step under the same uid' }, ...cur.steps] };
  writeFileSync(outbox, `${JSON.stringify({ rev: 900, at: stamp, by: 'check', action: 'poison', note: '', builds: [{ id: 'x', op: 'change', rev: 99, before: null, after: poisoned }] })}\n`);
  r = run(A, ORCH, ['act', 'step', 'y', 's3', 'done']); check(r.status === 0, `tick next to a poisoned line: ${r.stderr}`);
  r = run(A, LIVE, ['flush']); check(r.status === 0, `flush with a bad record: ${r.stdout}${r.stderr}`);
  fetchA();
  check(stepsDone(mainStore(), 'y').includes('s3'), 'the good build reached main');
  check(mainStore().builds.find((b) => b.id === 'x').steps.length === cur.steps.length, 'the bad record did not');
  check(JSON.parse(run(A, LIVE, ['status', '--json']).stdout).skipped?.join() === 'x', 'status names what was left out');

  // 13. a profile registered only on the hub (a project's, e.g. test-sandbox from project-seed) never gets a repo export:
  // its build reaches main in the store, its orchestrator.json stays in its shared-data folder, and the repo export an
  // older version wrote is swept (Nov 13 2026, main-ci-red-test-sandbox-profile-export: check-profiles.mjs failed on main)
  const hub = join(T, 'hub'); mkdirSync(join(hub, 'framework/plan'), { recursive: true });
  writeFileSync(join(hub, 'framework/plan/profiles.json'), JSON.stringify({ $axf: 'build-profiles@1', active: 'all', profiles: [{ id: 'all', name: 'All builds' }, { id: 'hub-only', name: 'Hub only' }] }));
  const leaked = join(hub, '_claude/builds/profiles/hub-only/orchestrator.json');
  mkdirSync(dirname(leaked), { recursive: true }); writeFileSync(leaked, '{"$export":"old","$axf":"orchestrator@1","builds":[]}\n');
  const hubEnv = { AXF_DATA_DIR: hub, AXF_BUILD_PROFILE: 'hub-only', AXF_BUILDS_EXPORT: '1' };
  r = run(A, ORCH, ['act', JSON.stringify({ action: 'add', id: 'z', title: 'Build z', steps: [{ id: 's1', text: 'one', model: 'Opus' }] })], hubEnv);
  check(r.status === 0, `add z in the hub-only profile: ${r.stderr}`);
  fetchA();
  check(mainStore().builds.find((b) => b.id === 'z')?.profiles.includes('hub-only'), 'the hub-only build itself reached main in the store');
  check(gitTry(A, 'cat-file', '-e', 'origin/main:_claude/builds/profiles/hub-only/orchestrator.json').status !== 0, 'no repo export on main for a profile the repo registry does not list');
  check(!existsSync(join(hub, 'framework/plan/profiles/hub-only/_claude/builds/orchestrator.json')), 'no status file in the profile\'s shared-data folder either: status lives in the store only (Nov 25 2026)');
  check(!existsSync(leaked), 'a repo export of a hub-only profile from an older version is swept');
  check(!existsSync(join(ROOT, '_claude/builds/profiles/hub-only')), 'nothing was written into the real repo');

  // 14. push mode landed (the default since Nov 21 2026, audit B4-06): ticks, notes and links wait in the outbox, the
  // console's checkout takes them at once (file copy), and the landing publishes everything queued as ONE commit
  git(T, 'clone', '-q', join(T, 'remote.git'), 'e'); git(T, 'clone', '-q', join(T, 'remote.git'), 'f');
  const E = join(T, 'e'); const F = join(T, 'f');
  const landEnv = { AXF_BUILDS_LIVE_PUSH: '', AXF_CONSOLE_ROOT: F };
  const mainCount = () => { fetchA(); return Number(git(A, 'rev-list', '--count', 'origin/main')); };
  const liveSt = (extra = {}) => JSON.parse(run(E, LIVE, ['status', '--json'], { ...landEnv, ...extra }).stdout);
  const fStore = () => JSON.parse(readFileSync(join(F, STORE_REL), 'utf8'));
  const before14 = mainCount();
  r = run(E, LIVE, ['pull'], landEnv); check(r.status === 0, `pull into e: ${r.stdout}${r.stderr}`);
  r = run(E, ORCH, ['act', JSON.stringify({ action: 'add', id: 'w', title: 'Build w', steps: [{ id: 's1', text: 'one', model: 'Opus' }, { id: 's2', text: 'two', model: 'Opus' }] })], landEnv);
  check(r.status === 0, `add w (landed mode): ${r.stderr}`);
  r = run(E, ORCH, ['act', 'step', 'w', 's1', 'done'], landEnv); check(r.status === 0, `tick w s1 (landed mode): ${r.stderr}`);
  r = run(E, ORCH, ['act', 'note', 'w', 'a note while it runs'], landEnv); check(r.status === 0, `note w (landed mode): ${r.stderr}`);
  check(mainCount() === before14, 'landed mode: an add, a tick and a note make no commit on main');
  st = liveSt();
  check(st.push === 'landed' && st.queued === 3 && st.due === '' && !st.stuck, `landed mode: the changes are queued, not due, not stuck (${JSON.stringify(st).slice(0, 200)})`);
  check(fStore().builds.some((b) => b.id === 'w') && stepsDone(fStore(), 'w') === 's1', 'landed mode: the console checkout has the tick at once (live status without a push)');
  r = run(E, LIVE, ['sync'], landEnv);
  check(r.status === 0 && mainCount() === before14 && /held/.test(r.stdout), `landed mode: sync (session start, reconciler) pulls only and holds the queue (${r.stdout.trim()})`);
  r = run(E, ORCH, ['act', 'step', 'w', 's2', 'done'], landEnv); check(r.status === 0, `tick w s2 (landed mode): ${r.stderr}`);
  r = run(E, LIVE, ['link', 'w', '--branch', 'claude/w', '--pr', '77'], landEnv); check(r.status === 0, `link w (landed mode): ${r.stderr}`);
  r = run(E, LIVE, ['link', 'w', '--merged'], landEnv); check(r.status === 0, `merged w, no CI yet (landed mode): ${r.stderr}`);
  check(mainCount() === before14 && liveSt().due === '', 'landed mode: every step done, a PR and a merge without CI evidence (landing) still make no commit');
  r = run(E, LIVE, ['link', 'w', '--sha', 'abc1234', '--ci', 'success'], landEnv); check(r.status === 0, `land w (landed mode): ${r.stderr}`);
  check(mainCount() === before14 + 1, `landed mode: the landing makes exactly one commit (${mainCount() - before14})`);
  const w = mainStore().builds.find((b) => b.id === 'w');
  check(w?.status === 'landed' && stepsDone(mainStore(), 'w') === 's1,s2' && w.pr === '#77' && w.notes.some((n) => n.text === 'a note while it runs'), `landed mode: main has w landed with everything that was queued (${w?.status})`);
  check(/Builds live: .*\[skip ci\]/.test(git(A, 'log', '-1', '--format=%s', 'origin/main')), 'landed mode: the snapshot is still a status-only [skip ci] commit');
  st = liveSt();
  check(st.queued === 0 && st.due === '' && !existsSync(join(E, `${STORE_REL}.live-outbox.jsonl.due`)), 'landed mode: outbox empty and no longer due after the landing');
  r = run(E, ORCH, ['act', 'note', 'w', 'a note after the landing'], landEnv);
  check(mainCount() === before14 + 1 && liveSt().queued === 1, 'landed mode: a note after the landing waits again');
  // the daily snapshot: changes held for the snapshot period go out with the next write or sync
  check(liveSt({ AXF_BUILDS_LIVE_SNAPSHOT_HOURS: '0.0000001' }).due === 'snapshot' && liveSt({ AXF_BUILDS_LIVE_SNAPSHOT_HOURS: '0' }).due === '', 'landed mode: a held outbox is due as a snapshot after the period (0 = never)');
  check(liveSt({ AXF_BUILDS_LIVE_OUTBOX_MAX_MB: '0.00001' }).due === 'full', 'landed mode: an outbox past the size cap is due');
  r = run(E, LIVE, ['sync'], { ...landEnv, AXF_BUILDS_LIVE_SNAPSHOT_HOURS: '0.0000001' });
  check(r.status === 0 && mainCount() === before14 + 2 && liveSt().queued === 0, `landed mode: the snapshot publishes the held changes as one commit (${r.stdout.trim()})`);
  r = run(E, ORCH, ['act', 'note', 'w', 'one more'], landEnv);
  r = run(E, LIVE, ['flush'], landEnv);
  check(r.status === 0 && mainCount() === before14 + 3, 'landed mode: flush publishes on demand');
  r = run(E, ORCH, ['act', 'note', 'w', 'and another'], landEnv);
  r = run(E, LIVE, ['sync', '--now'], landEnv);
  check(r.status === 0 && mainCount() === before14 + 4 && liveSt().queued === 0, `landed mode: sync --now publishes on demand (${r.stdout.trim()})`);
  // a protected main: the snapshot goes to the configured push target (the deploy key's URL), not to the fetch remote
  git(E, 'remote', 'set-url', '--push', 'origin', join(T, 'no-such-remote.git'));
  r = run(E, ORCH, ['act', 'note', 'w', 'through the push target'], landEnv);
  r = run(E, LIVE, ['flush'], landEnv);
  check(r.status !== 0 && mainCount() === before14 + 4 && liveSt().queued === 1 && liveSt().stuck, `a push that cannot reach main keeps the outbox and says so (${r.stdout.trim().slice(0, 80)})`);
  const pushCfg = join(T, 'builds-live-push.json'); writeFileSync(pushCfg, JSON.stringify({ url: join(T, 'remote.git') }));
  check(liveSt({ AXF_BUILDS_LIVE_PUSH_CONFIG: pushCfg }).pushVia === 'deploy-key' && liveSt().pushVia === 'remote', 'status says which way the snapshot is pushed');
  r = run(E, LIVE, ['flush'], { ...landEnv, AXF_BUILDS_LIVE_PUSH_CONFIG: pushCfg });
  check(r.status === 0 && mainCount() === before14 + 5 && liveSt().queued === 0 && !liveSt().stuck, `the push target takes the snapshot when the remote refuses it (${r.stdout.trim().slice(0, 80)}${r.stderr.trim().slice(0, 80)})`);
  // the pure rule: which journal entries land a build
  const liveMod = await import('../cli/builds-live.mjs');
  const ent = (before, after) => ({ builds: [{ id: 'q', op: 'change', before: before && { status: before }, after: after && { status: after } }] });
  check(liveMod.landsBuild(ent('landing', 'landed')) && liveMod.landsBuild(ent('running', 'complete')) && liveMod.landsBuild(ent(null, 'landed')), 'landsBuild: a status that moves to landed (or straight to complete) lands the build');
  check(!liveMod.landsBuild(ent('landed', 'complete')) && !liveMod.landsBuild(ent('landed', 'landed')) && !liveMod.landsBuild(ent('running', 'landing')) && !liveMod.landsBuild(ent('running', 'failed')) && !liveMod.landsBuild(ent('running', 'archived')) && !liveMod.landsBuild(ent('running', null)) && !liveMod.landsBuild({}), 'landsBuild: landed → complete, landing, failed, archived and a delete are not landings');

  // 15. only a real change is a commit (stop-ghost-builds-live-commits, Nov 23 2026): a shipped build and a no-op tick
  // (stamps, run bookkeeping, a repeated note) queue nothing and publish nothing; a subject never ends in an empty list
  {
    const at = (n) => `2026-11-23T10:${String(n).padStart(2, '0')}:00.000Z`;
    const rec = (o = {}) => ({ id: 'g', status: 'running', updatedAt: at(0), rev: 3, branch: 'claude/g', pr: '#9', notes: [{ text: 'Launch failed on a: exit 127', at: at(0) }],
      pipeline: { account: 'a', session: 'axf-g', runs: 1, note: '', heldAt: '' }, steps: [{ uid: 'u1', id: 's1', text: 'one', done: false, updatedAt: at(0), rev: 1 }], ...o });
    const base15 = rec();
    const rc15 = (o) => merge.realChanges(base15, rec(o));
    check(rc15({ updatedAt: at(5), rev: 9 }).length === 0, 'realChanges: a newer stamp and revision are not a change');
    check(rc15({ updatedAt: at(5), pipeline: { ...base15.pipeline, session: 'axf-g--2', runs: 2, note: 'launch failed: exit 127', lastSeenAt: at(5) } }).length === 0, 'realChanges: the dispatcher\'s run bookkeeping (session, runs, heartbeat) is not a change');
    check(rc15({ updatedAt: at(5), notes: [...base15.notes, { text: 'Launch failed on a: exit 127', at: at(5) }] }).length === 0, 'realChanges: a note the build already holds, written again, is not a change');
    check(rc15({ steps: [{ ...base15.steps[0], updatedAt: at(5), rev: 2 }] }).length === 0, 'realChanges: a step whose stamp alone moved is not a change');
    check(rc15({ notes: [...base15.notes, { text: 'a new finding', at: at(5) }] }).join() === 'note', 'realChanges: a new note is a change');
    check(rc15({ status: 'queued' }).join() === 'status' && rc15({ steps: [{ ...base15.steps[0], done: true }] }).join() === 'steps' && rc15({ pipeline: { ...base15.pipeline, heldAt: at(5) } }).join() === 'pipeline', 'realChanges: a status move, a ticked step and a hold are changes');
    check(merge.realChanges(null, base15).join() === 'added' && merge.realChanges(base15, null).join() === 'removed', 'realChanges: a new build and a removed one are changes');
    const shipped = rec({ status: 'queued', shipped: { id: 'sm-g', rev: 1, at: at(1), landedCommit: 'abc' }, mergedAt: at(1) });
    const sh = (o) => merge.realChanges(shipped, { ...shipped, ...o });
    check(merge.isSettled(shipped) && merge.isSettled({ status: 'complete' }) && merge.isSettled({ status: 'archived' }) && !merge.isSettled(base15), 'isSettled: a shipped manifest, complete or archived');
    check(sh({ status: 'running', updatedAt: at(6), notes: [...shipped.notes, { text: 'Started run 2', at: at(6) }] }).length === 0 && sh({ status: 'fixing' }).length === 0, 'realChanges: a shipped build flapping between queued, running and fixing, with new notes, is not a change');
    check(sh({ status: 'landed' }).join() === 'status' && sh({ status: 'complete' }).join() === 'status' && sh({ deleted: true }).join() === 'deleted', 'realChanges: a shipped build moving to landed / complete, or removed, is a change');
    const done = rec({ status: 'complete', mergedAt: at(1) });
    check(merge.realChanges(done, { ...done, updatedAt: at(7), notes: [...done.notes, { text: 'Watchdog looked again', at: at(7) }] }).length === 0 && merge.realChanges(done, { ...done, status: 'archived' }).join() === 'status', 'realChanges: a complete build takes no notes as changes, only a status move');
    const ent15 = (before, after) => ({ at: at(8), by: 'pipeline', builds: [{ id: 'g', op: 'change', before, after }] });
    check(merge.realEntry(ent15(base15, rec({ updatedAt: at(8) }))) === null && merge.realEntry(ent15(base15, rec({ status: 'queued' })))?.builds.length === 1, 'realEntry: an entry with no real change is dropped, one with a change is kept');
    const liveMod15 = await import('../cli/builds-live.mjs');
    check(/^Builds live: 2 build change\(s\): g, h \[skip ci\]/.test(liveMod15.message([], ['g', 'h'], [])) && /^Builds live: 1 status file\(s\): shipped\/g\.json \[skip ci\]/.test(liveMod15.message([], [], ['_claude/builds/shipped/g.json'])), 'message: the subject names the builds, or the files when no build changed');
    check(!/change\(s\):\s+\[skip ci\]/.test(liveMod15.message([ent15(base15, rec({ updatedAt: at(8) }))], [], [])), 'message: a subject never ends in an empty list');

    // end to end on the throwaway remote, a push per write (the mode that used to commit every tick)
    const G = join(T, 'g'); git(T, 'clone', '-q', join(T, 'remote.git'), 'g');
    const STORE_MOD = join(ROOT, 'framework/cli/builds-store.mjs');
    const write = (body, extra) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { withStore } from ${JSON.stringify(STORE_MOD)}; withStore((s) => { const find = (id) => s.builds.find((b) => b.id === id); const now = new Date().toISOString(); ${body}; return s; }, { by: 'pipeline', action: 'pipeline:tick', note: 'check' });`], { cwd: ROOT, encoding: 'utf8', env: envFor(G, extra) });
    const head = () => { fetchA(); return git(A, 'rev-parse', 'origin/main'); };
    const queued = () => JSON.parse(run(G, LIVE, ['status', '--json']).stdout).queued;
    r = run(G, LIVE, ['pull']); check(r.status === 0, `pull into g: ${r.stdout}${r.stderr}`);
    r = run(G, ORCH, ['act', 'note', 'x', 'Launch failed on a: launcher exit 127']); check(r.status === 0, `first note on x: ${r.stderr}`);
    const h0 = head();
    check(mainStore().builds.find((b) => b.id === 'x').notes.some((n) => /exit 127/.test(n.text)), 'a first note is a real change and reaches main');
    // a no-op tick: the dispatcher rewrites its bookkeeping and the same note, the build does not move
    r = write(`const b = find('x'); b.pipeline = { ...(b.pipeline ?? {}), note: 'launch failed: exit 127', tried: ['a'] }; b.notes.push({ text: 'Launch failed on a: launcher exit 127', at: now }); b.updatedAt = now;`);
    check(r.status === 0, `no-op tick wrote the store: ${r.stderr}`);
    check(JSON.parse(readFileSync(join(G, STORE_REL), 'utf8')).builds.find((b) => b.id === 'x').notes.filter((n) => /exit 127/.test(n.text)).length === 2, 'the no-op tick is in the local store');
    check(head() === h0 && queued() === 0, 'a no-op tick (stamp, run bookkeeping, a repeated note) makes no commit and queues nothing');
    r = run(G, LIVE, ['flush']); check(r.status === 0 && head() === h0, `flush after a no-op tick publishes nothing (${r.stdout.trim()})`);
    r = run(G, LIVE, ['sync', '--now']); check(r.status === 0 && head() === h0, `sync --now with only stamps newer here publishes nothing (${r.stdout.trim()})`);
    // a shipped build: its manifest is on the record, its status was left at queued, a stale dispatcher keeps touching it
    r = write(`const b = find('x'); b.status = 'queued'; b.shipped = { id: 'sm-x', rev: 1, at: now, landedCommit: 'abc1234' }; b.updatedAt = now;`);
    check(r.status === 0, `ship x: ${r.stderr}`);
    const h1 = head();
    check(h1 !== h0 && mainStore().builds.find((b) => b.id === 'x').shipped?.id === 'sm-x', 'the shipped manifest reaching the record is a real change (one commit)');
    for (const [st, note] of [['running', 'Started run 2 on a'], ['queued', 'Reconciler: no live session or process runs it'], ['running', 'Started run 3 on a']]) {
      r = write(`const b = find('x'); b.status = ${JSON.stringify(st)}; b.notes.push({ text: ${JSON.stringify(note)}, at: now }); b.updatedAt = now;`);
      check(r.status === 0, `touch shipped x (${st}): ${r.stderr}`);
    }
    check(head() === h1 && queued() === 0, 'a shipped build touched again (status flaps, new notes) makes no commit and queues nothing');
    r = run(G, LIVE, ['sync', '--now']); check(r.status === 0 && head() === h1, `sync --now never republishes a shipped build (${r.stdout.trim()})`);
    // lines an older version queued (every write, whole records) are dropped at publish, not committed
    const stale = JSON.parse(readFileSync(join(G, STORE_REL), 'utf8')).builds.find((b) => b.id === 'x');
    const later = new Date(Date.now() + 60000).toISOString();
    writeFileSync(join(G, `${STORE_REL}.live-outbox.jsonl`), `${JSON.stringify({ rev: 901, at: later, by: 'pipeline', action: 'pipeline:launch-failed', note: 'x', builds: [{ id: 'x', op: 'change', rev: 99, before: stale, after: { ...stale, updatedAt: later, notes: [...stale.notes, { text: 'Started run 3 on a', at: later }] } }] })}\n`);
    r = run(G, LIVE, ['flush']);
    check(r.status === 0 && head() === h1 && queued() === 0, `an outbox line with no real change is dropped without a commit (${r.stdout.trim()})`);
    // and a real change still goes out, with a subject that names it
    r = run(G, ORCH, ['act', 'note', 'y', 'a real note after the ghosts']); check(r.status === 0, `real note on y: ${r.stderr}`);
    const subj = (() => { fetchA(); return git(A, 'log', '-1', '--format=%s', 'origin/main'); })();
    check(head() !== h1 && /Builds live: .*y.* note.*\[skip ci\]/.test(subj), `a real change still publishes, named in the subject (${subj})`);
    fetchA();
    const subjects = git(A, 'log', '--format=%s', 'origin/main').split('\n').filter((l) => l.startsWith('Builds live:'));
    check(subjects.length > 0 && subjects.every((l) => !/change\(s\):\s*\[skip ci\]/.test(l)), 'no status commit on main has an empty change list');
  }

  // the status file and main's own code: while main's builds-live is from before the retirement the file is left as it
  // is (that code still reads it) and never rewritten; once main carries the retirement it is taken off
  {
    const s = join(T, 'seed');
    const old = '{"$axf":"orchestrator@1","builds":[{"id":"x","status":"queued"}]}\n';
    const put = (code) => {
      git(s, 'pull', '-q', 'origin', 'main');
      mkdirSync(join(s, 'framework/cli'), { recursive: true }); writeFileSync(join(s, 'framework/cli/builds-live.mjs'), code);
      writeFileSync(join(s, '_claude/builds/orchestrator.json'), old);
      git(s, 'add', '-A'); git(s, 'commit', '-q', '-m', 'code on main'); git(s, 'push', '-q', 'origin', 'main');
    };
    put('// builds-live from before the status file was retired\n');
    let q = run(A, ORCH, ['act', 'note', 'y', 'a note while main still reads the status file']); check(q.status === 0, `note on y (old main): ${q.stderr}`);
    fetchA();
    check(mainStore().builds.find((b) => b.id === 'y').notes.some((n) => n.text.includes('still reads the status file')), 'the publish reached main');
    check(gitTry(A, 'show', 'origin/main:_claude/builds/orchestrator.json').stdout === old, 'main\'s code is older: its status file is neither rewritten nor removed');
    put('// export const STATUS_FILE_RETIRED\n');
    q = run(A, ORCH, ['act', 'note', 'y', 'a note once main retired the status file']); check(q.status === 0, `note on y (new main): ${q.stderr}`);
    fetchA();
    check(gitTry(A, 'cat-file', '-e', 'origin/main:_claude/builds/orchestrator.json').status !== 0, 'main carries the retirement: a status file brought back is taken off by the next publish');
  }

  console.log(`${fail ? '✗' : '✓'} builds-live: ${pass} passed, ${fail} failed`);
  rmSync(T, { recursive: true, force: true });
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); rmSync(T, { recursive: true, force: true }); process.exitCode = 1; });
