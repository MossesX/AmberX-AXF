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
const ORCH = join(ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs');
const STORE_REL = '_claude/builds/store.json';
let pass = 0; let fail = 0;
const check = (ok, what) => { if (ok) pass += 1; else { fail += 1; console.log(`✗ ${what}`); } };

const T = mkdtempSync(join(tmpdir(), 'axf-live-check-'));
const WHO = { GIT_AUTHOR_NAME: 'check', GIT_AUTHOR_EMAIL: 'check@example.com', GIT_COMMITTER_NAME: 'check', GIT_COMMITTER_EMAIL: 'check@example.com' };
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...WHO } }); if (r.status !== 0 && !args.includes('--no-fail')) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const gitTry = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...WHO } });
const envFor = (clone, extra = {}) => ({
  ...process.env, ...WHO,
  AXF_BUILDS_STORE: join(clone, STORE_REL), AXF_BUILDS_LIVE: '1', AXF_BUILDS_LIVE_GIT: clone, AXF_BUILDS_LIVE_SYNC: '1',
  AXF_CONSOLE_ROOT: 'off', AXF_BUILD_PROFILE: 'main-framework', AXF_BUILDS_EXPORT: '0', AXF_ACTOR: `check-${clone.slice(-1)}`, ...extra,
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
  for (const id of ['x', 'y']) store.builds.push(core.normBuild({ id, title: `Build ${id}`, profiles: ['main-framework'], steps: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, text: `step ${n} of ${id}`, model: 'Opus' })) }, { now, seed: id }));
  mkdirSync(join(s, '_claude/builds/journal'), { recursive: true });
  writeFileSync(join(s, STORE_REL), `${JSON.stringify(core.compactStore(store), null, 1)}\n`);
  writeFileSync(join(s, '_claude/THREADS.md'), '# Threads\n\n## Active\n\n| Thread | State |\n|---|---|\n| a | working |\n');
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
  check(y.status === 'built' && y.pr === '#12' && y.branch === 'claude/y', `link: built, awaiting merge (${y.status} ${y.pr} ${y.branch})`);
  r = run(A, LIVE, ['link', 'y', '--merged']);
  fetchA(); m = mainStore(); y = m.builds.find((b) => b.id === 'y');
  check(y.status === 'complete' && !!y.mergedAt, `merged: complete (${y.status})`);
  check(core.validateStore(m).ok, 'main\'s store is valid builds@1 after every live write');

  // 6. a feature branch with its own (older) copy merges main with the driver: clean, newer wins, nothing regresses
  run(C, ORCH, ['act', 'step', 'x', 's4', 'done'], { AXF_BUILDS_LIVE: '0' }); // offline write on C's branch
  git(C, 'checkout', '-q', '-b', 'feat'); git(C, 'add', '-A'); git(C, 'commit', '-q', '-m', 'feature work + its store copy');
  git(C, 'config', 'merge.axf-builds.driver', `node "${LIVE}" merge-driver %O %A %B %P`);
  git(C, 'fetch', '-q', 'origin');
  const mg = gitTry(C, 'merge', '--no-edit', 'origin/main');
  const cs = JSON.parse(readFileSync(join(C, STORE_REL), 'utf8'));
  check(mg.status === 0, `merge with the driver is clean (${mg.stdout}${mg.stderr})`);
  check(stepsDone(cs, 'x') === 's1,s2,s3,s4' && cs.builds.find((b) => b.id === 'y').status === 'complete', `merged store: x ${stepsDone(cs, 'x')}, y ${cs.builds.find((b) => b.id === 'y').status}`);

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
  check(merge.mergeJournalText('{"at":"2"}\n{"at":"1"}\n', '{"at":"1"}\n{"at":"3"}\n') === '{"at":"2"}\n{"at":"1"}\n{"at":"3"}\n', 'journal union: the first file as it is, then each new line once');
  check(merge.liveStatus({ status: 'running', pr: '#5', steps: [{ done: true }] }) === 'built' && merge.liveStatus({ status: 'running', pr: '#5', mergedAt: 'x', steps: [{ done: true }] }) === 'complete' && merge.liveStatus({ status: 'running', steps: [{ done: true }] }) === 'complete', 'liveStatus: built until merged, complete without a PR');
  check(merge.liveStatus({ status: 'archived', pr: '#5', steps: [{ done: true }] }) === 'archived' && merge.liveStatus({ status: 'complete', steps: [{ done: false }] }) === 'complete', 'liveStatus keeps archived and built-without-ticks');

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

  // 10. threads log: appended in its section, capped, before a later heading
  let t = 'x\n## Active\nrow\n';
  t = merge.LIVE_HEAD ? t : t;
  const { appendThreads } = await import('../cli/builds-live.mjs');
  t = appendThreads(t, ['- one']); t = appendThreads(`${t}\n## After\nkeep\n`, ['- two', '- one']);
  check(/## Live build log[\s\S]*- one\n- two\n\n## After\nkeep/.test(t) && t.indexOf('row') < t.indexOf('## Live build log'), `threads section: ${JSON.stringify(t.slice(-80))}`);

  console.log(`${fail ? '✗' : '✓'} builds-live: ${pass} passed, ${fail} failed`);
  rmSync(T, { recursive: true, force: true });
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); rmSync(T, { recursive: true, force: true }); process.exitCode = 1; });
