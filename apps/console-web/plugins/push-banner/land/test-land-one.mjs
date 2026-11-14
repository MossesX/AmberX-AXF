#!/usr/bin/env node
// land-one.mjs: one serial landing attempt on a temp git repo (origin bare + a checkout), recorded as land-run@1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'land-one-'));
process.env.AXF_LAND_LOCK = join(root, 'lock.d');
process.env.AXF_CREW_SAY = 'off';
process.env.AXF_LAND_RESOLVER = '';
process.env.AXF_CONSOLE_UPDATE = ''; // never the real redeploy from a test
const { landOne, readRuns, checkAndLand, enqueue, runLine, readLine, afterBatch } = await import('./land-one.mjs');
const chrome = await import('./check-chrome-once.mjs');
const { makeGit, takeLandLock, dropLandLock } = await import('./land.mjs');
const lr = await import('../../../../../framework/core/land-run.mjs');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const origin = join(root, 'origin.git'); const repo = join(root, 'repo'); const data = join(root, 'data'); const work = join(root, 'work');
mkdirSync(data);
sh(['init', '-q', '--bare', '-b', 'main', origin], root);
sh(['clone', '-q', origin, work], root);
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) sh(['config', k, v], work);
const commit = (f, text, msg) => { writeFileSync(join(work, f), text); sh(['add', f], work); sh(['commit', '-qm', msg], work); };
commit('a.txt', 'one\n', 'a');
sh(['push', '-q', 'origin', 'HEAD:main'], work);
// a clean build: adds its own file; a clashing build: edits a.txt one way
sh(['checkout', '-qb', 'claude/clean'], work); commit('b.txt', 'b\n', 'b'); sh(['push', '-q', 'origin', 'claude/clean'], work);
sh(['checkout', '-q', 'main'], work); sh(['checkout', '-qb', 'claude/clash'], work); commit('a.txt', 'branch side\n', 'a branch'); sh(['push', '-q', 'origin', 'claude/clash'], work);
sh(['checkout', '-q', 'main'], work); sh(['checkout', '-qb', 'claude/clash2'], work); commit('a.txt', 'second branch side\n', 'a branch 2'); sh(['push', '-q', 'origin', 'claude/clash2'], work);
// main moves on: a new file and a.txt the other way
sh(['checkout', '-q', 'main'], work); commit('c.txt', 'c\n', 'c'); commit('a.txt', 'main side\n', 'a main'); sh(['push', '-q', 'origin', 'HEAD:main'], work);
sh(['clone', '-q', origin, repo], root);
for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) sh(['config', k, v], repo);
const s = { repo, slug: 'o/r', dataDir: data, remote: 'origin', base: 'main', archive: join(root, 'archive') };
const git = makeGit(repo, { retryWait: 10 });
const at = new Date('2026-11-14T23:00:00Z');
// the console and builds-live, faked: what the lander filed and recorded
const filed = []; const recorded = [];
const fakeApi = async (method, path, body) => { if (path.endsWith('/land/fix')) { filed.push(body); return { ok: true, id: `fix-${filed.length}`, status: 'queued' }; } return null; };
const base = { api: fakeApi, record: (_s, run) => { recorded.push([run.build, run.outcome]); return { ok: true }; }, said: 'We need to make sure things are landing as soon as they\'re built' };

await t('a clean build: main merged into its branch and pushed; the attempt is recorded as land-run@1, still going (CI next)', async () => {
  const r = await landOne({ s, git, ...base, ci: false, build: { id: 'clean', branch: 'claude/clean', pr: 12 }, now: () => at });
  assert.equal(r.ran, true);
  assert.equal(r.run.build, 'clean'); assert.equal(r.run.pr, 12);
  assert.equal(r.run.base, sh(['rev-parse', 'origin/main'], repo));
  assert.ok(r.run.merged, 'merged sha recorded'); assert.equal(r.run.outcome, '');
  sh(['fetch', '-q', 'origin'], repo);
  assert.equal(sh(['rev-parse', 'origin/claude/clean'], repo), r.run.merged, 'the merged head is on the branch');
  assert.equal(sh(['merge-base', '--is-ancestor', 'origin/main', 'origin/claude/clean'], repo), '', 'the branch now holds main');
  const runs = readRuns(s, 'clean');
  assert.equal(runs.length, 1); assert.equal(runs[0].id, lr.newLandRunId('clean', at.toISOString()));
});

await t('a code clash: nothing pushed, the attempt ends as clash with the file listed', async () => {
  const before = sh(['rev-parse', 'origin/claude/clash'], repo);
  const r = await landOne({ s, git, ...base, ci: false, build: { id: 'clash', branch: 'claude/clash' }, now: () => at });
  assert.equal(r.run.outcome, 'clash'); assert.deepEqual(r.run.unresolved, ['a.txt']);
  assert.ok(lr.validateLandRun(r.run).ok, 'a valid land-run@1');
  sh(['fetch', '-q', 'origin'], repo);
  assert.equal(sh(['rev-parse', 'origin/claude/clash'], repo), before, 'branch untouched');
});

await t('a missing branch is an error attempt, never a crash', async () => {
  const r = await landOne({ s, git, ...base, ci: false, build: { id: 'gone', branch: 'claude/gone' }, now: () => at });
  assert.equal(r.run.outcome, 'error'); assert.match(r.run.error, /not on origin/);
});

await t('the host resolver settles a clash the JS rules call code; the merge then lands on the branch', async () => {
  const fake = join(root, 'resolve.py');
  writeFileSync(fake, "import subprocess\nsubprocess.run(['git','checkout','--theirs','--','.'])\nsubprocess.run(['git','add','-A'])\n");
  process.env.AXF_LAND_RESOLVER = fake;
  try {
    const r = await landOne({ s, git, ...base, ci: false, build: { id: 'clash', branch: 'claude/clash' }, now: () => at });
    assert.equal(r.run.outcome, ''); assert.ok(r.run.merged);
    sh(['fetch', '-q', 'origin'], repo);
    assert.equal(sh(['show', 'origin/claude/clash:a.txt'], repo), 'main side', "main's side taken by the resolver");
  } finally { process.env.AXF_LAND_RESOLVER = ''; }
});

await t('a red check after regenerating: outcome red, the failing generator named', async () => {
  const merge = () => ({ merged: false, conflicts: [], regenerated: ['tracker'], checkError: 'tracker regenerated but its check failed (node x): boom' });
  const r = await landOne({ s, git, ...base, ci: false, build: { id: 'clean', branch: 'claude/clean' }, merge, now: () => at });
  assert.equal(r.run.outcome, 'red'); assert.equal(r.run.check.ok, false); assert.deepEqual(r.run.check.failed, ['tracker']);
  assert.deepEqual(r.run.regenerated, ['tracker']);
  assert.ok(lr.validateLandRun(r.run).ok, 'valid: the note says why no fix build yet');
});

// a fake GitHub: check runs per head from a script, records dispatches and merges
const fakeGh = (script) => {
  const calls = { dispatch: 0, merge: [], opened: 0 }; let i = 0;
  const gh = async (method, path, body) => {
    if (path.includes('/check-runs')) { const runs = script[Math.min(i, script.length - 1)]; i++; return { check_runs: runs }; }
    if (path.endsWith('/dispatches')) { calls.dispatch++; return null; }
    if (method === 'GET' && path.includes('/pulls?')) return [];
    if (method === 'POST' && path.endsWith('/pulls')) { calls.opened++; return { number: 99 }; }
    if (method === 'PUT' && path.endsWith('/merge')) { calls.merge.push({ path, body }); return { merged: true }; }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { gh, calls };
};
const run1 = (conclusion, status = 'completed') => [{ name: 'build', status, conclusion, app: { slug: 'github-actions' } }];
const fastCi = { sleep: async () => {}, pollMs: 0 };

await t('CI green on the merged head: the PR is merged at that head with the App token, the build marked merged', async () => {
  const { gh, calls } = fakeGh([run1('success')]); const marked = [];
  const r = await landOne({ s, git, ...base, gh, build: { id: 'clean', branch: 'claude/clean', pr: '#12' }, now: () => at, ciOpts: { ...fastCi, mark: (_s, b, o) => { marked.push([b.id, o.pr]); return { ok: true }; } } });
  assert.equal(r.run.outcome, 'landed'); assert.equal(r.run.ci.state, 'success');
  assert.equal(calls.merge.length, 1); assert.equal(calls.merge[0].body.sha, r.run.merged, 'merged at exactly the tested head');
  assert.match(calls.merge[0].path, /pulls\/12\/merge$/);
  assert.deepEqual(marked, [['clean', 12]]);
  assert.ok(lr.validateLandRun(r.run).ok);
});

await t('a cancelled run is started again, never a failure; green after it lands', async () => {
  const { gh, calls } = fakeGh([run1('cancelled'), run1(null, 'in_progress'), run1('success')]);
  const r = await landOne({ s, git, ...base, gh, build: { id: 'clean', branch: 'claude/clean', pr: 12 }, now: () => at, ciOpts: { ...fastCi, mark: () => ({ ok: true }) } });
  assert.equal(r.run.outcome, 'landed'); assert.equal(calls.dispatch, 1); assert.match(r.run.note, /1 cancelled run started again/);
});

await t('nothing ran on the head: CI is dispatched; red names the failing job and lands nothing', async () => {
  const { gh, calls } = fakeGh([[], run1(null, 'queued'), [{ name: 'Gradle', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } }]]);
  const r = await landOne({ s, git, ...base, gh, build: { id: 'clean', branch: 'claude/clean', pr: 12 }, now: () => at, ciOpts: fastCi });
  assert.equal(calls.dispatch, 1); assert.equal(calls.merge.length, 0);
  assert.equal(r.run.outcome, 'red'); assert.deepEqual(r.run.check.failed, ['Gradle']);
});

await t('still running when the wait ends: the attempt stays open (no outcome), nothing merged', async () => {
  const { gh, calls } = fakeGh([run1(null, 'in_progress')]); let tnow = 0;
  const r = await landOne({ s, git, ...base, gh, build: { id: 'clean', branch: 'claude/clean', pr: 12 }, now: () => at, ciOpts: { ...fastCi, waitMs: 100, clock: () => (tnow += 60) } });
  assert.equal(r.run.outcome, ''); assert.equal(calls.merge.length, 0); assert.match(r.run.note, /next attempt/);
});

await t('no PR yet: one is opened, then merged', async () => {
  const { gh, calls } = fakeGh([run1('success')]);
  const r = await landOne({ s, git, ...base, gh, build: { id: 'clean', branch: 'claude/clean' }, now: () => at, ciOpts: { ...fastCi, mark: () => ({ ok: true }) } });
  assert.equal(calls.opened, 1); assert.equal(r.run.pr, 99); assert.equal(r.run.outcome, 'landed');
});

await t('green but main moved in code since the merge: not landed, merged again next', async () => {
  const { gh, calls } = fakeGh([run1('success')]);
  const fakeGit = (a, o) => (a[0] === 'rev-parse' && a[1] === 'origin/main' ? { code: 0, out: 'f'.repeat(40) } : a[0] === 'diff' ? { code: 0, out: 'src/x.ts' } : { code: 0, out: '' });
  const run = { ...lr.emptyLandRun(), build: 'clean', base: 'a'.repeat(40), merged: 'b'.repeat(40) };
  await checkAndLand({ s, git: fakeGit, gh, b: { id: 'clean', branch: 'claude/clean', pr: 12 }, run, ...fastCi });
  assert.equal(calls.merge.length, 0); assert.match(run.note, /main moved/); assert.equal(lr.outcomeOf(run), '');
});

await t('red: a P0 fix build is filed with Brett\'s words first and the failing check; the attempt names it; the build goes red', async () => {
  filed.length = 0; recorded.length = 0;
  const { gh } = fakeGh([[{ name: 'Gradle', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } }]]);
  const r = await landOne({ s, git, ...base, gh, build: { id: 'clean-red', branch: 'claude/clean', pr: 12 }, now: () => at, ciOpts: fastCi });
  assert.equal(r.run.outcome, 'red'); assert.equal(r.run.fixBuild, 'fix-1');
  assert.equal(filed.length, 1); assert.equal(filed[0].priority, 'P0'); assert.equal(filed[0].build, 'clean-red'); assert.equal(filed[0].kind, 'ci');
  assert.ok(filed[0].said.startsWith("We need to make sure things are landing as soon as they're built"), 'his words come first');
  assert.match(filed[0].said, /Failing check after merging main into claude\/clean: Gradle/);
  assert.deepEqual(recorded, [['clean-red', 'red']], 'the land record goes red (the line moves on)');
  assert.ok(lr.validateLandRun(r.run).ok);
  const pipe = await import('../../../../../framework/core/build-pipeline.mjs');
  assert.equal(pipe.addLandAttempt(null, lr.attemptOf(r.run), at.toISOString()).landState, 'red', 'builds@1 state follows the outcome');
});

await t('landed and clash attempts go on the build too; a running one does not', async () => {
  recorded.length = 0;
  await landOne({ s, git, ...base, ci: false, build: { id: 'clash2', branch: 'claude/clash2' }, now: () => at });
  const { gh } = fakeGh([run1(null, 'in_progress')]); let tn = 0;
  await landOne({ s, git, ...base, gh, build: { id: 'clean', branch: 'claude/clean', pr: 12 }, now: () => at, ciOpts: { ...fastCi, waitMs: 10, clock: () => (tn += 20) } });
  assert.deepEqual(recorded, [['clash2', 'clash']]);
  assert.equal(filed.at(-1).kind, 'conflict'); assert.match(filed.at(-1).said, /clashes in code: a\.txt/);
  const again = filed.length;
  const r2 = await landOne({ s, git, ...base, ci: false, build: { id: 'clash2', branch: 'claude/clash2' }, now: () => at });
  assert.equal(filed.length, again, 'one fix build per head: the same clash is not filed twice'); assert.match(r2.run.note, /filed \(P0\) earlier/);
});

await t('the line: builds land one at a time in order; red files its fix and the line moves on; a lander error waits for the next run', async () => {
  const sL = { ...s, dataDir: join(root, 'line') };
  for (const id of ['one', 'two', 'three', 'four', 'five']) enqueue(sL, { id, branch: `claude/${id}` });
  enqueue(sL, { id: 'urgent', branch: 'claude/urgent' }, { front: true });
  const H = (c) => c.repeat(40);
  const outcome = {
    urgent: { merged: H('a'), ci: { status: 'completed', conclusion: 'success' }, outcome: 'landed' },
    one: { merged: H('b'), ci: { status: 'completed', conclusion: 'failure' }, outcome: 'red', fixBuild: 'fix-1' },
    two: { error: 'network down', outcome: 'error' },
    three: { unresolved: ['src/x.ts'], outcome: 'clash' },
    four: { merged: H('c'), ci: { status: 'in_progress', conclusion: '' }, outcome: '' },
    five: { check: { ok: false, failed: ['tracker'], note: 'tracker check failed' }, outcome: 'red' },
  };
  const order = []; let inside = 0; let overlap = false;
  const land = async ({ build }) => { inside++; if (inside > 1) overlap = true; order.push(build.id); await new Promise((r) => setTimeout(r, 5)); inside--; return { ran: true, run: { ...lr.emptyLandRun(), build: build.id, head: H('d'), check: { ok: null, failed: [], note: '' }, ...outcome[build.id], note: build.id } }; };
  // five: a red check right after the merge goes fix-filed (never paused as a lander error); four is in flight, so five waits for the next run
  const batches = [];
  const r = await runLine({ s: sL, land, batch: async (o) => { batches.push(o.ran.map((x) => x.build)); return {}; } });
  assert.deepEqual(batches, [['urgent', 'one', 'two', 'three']], 'one batch per run: the settled attempts (four is still checking)');
  assert.deepEqual(order, ['urgent', 'one', 'two', 'three', 'four'], 'front first, then in order, each once');
  assert.equal(overlap, false, 'never two at once');
  const l = readLine(sL); const st = Object.fromEntries(l.entries.map((e) => [e.build, e.state]));
  assert.deepEqual(st, { one: 'fix-filed', two: 'waiting', three: 'fix-filed', four: 'checking', five: 'waiting' });
  assert.equal(l.history.find((e) => e.build === 'urgent')?.state, 'landed');
  assert.equal(r.ran.length, 5);
  // next run: the one in flight is resumed first, nothing else starts while it is still checking
  const order2 = []; outcome.four = { merged: H('c'), ci: { status: 'completed', conclusion: 'success' }, outcome: 'landed' };
  await runLine({ s: sL, batch: null, land: async (o) => { order2.push(o.build.id); return land(o); } });
  assert.deepEqual(order2, ['four', 'two', 'five'], 'in-flight first, then the waiting ones');
  assert.equal(readLine(sL).entries.find((e) => e.build === 'five').state, 'fix-filed', 'a red check after the merge is fix-filed, not paused');
});

await t('batch boundary: one redeploy + one chrome check when something landed; none when nothing did; doubled = alert', async () => {
  const sB = { ...s, dataDir: join(root, 'batch') };
  let ups = 0; let checks = 0; const alerts = [];
  const api = async (m, p, body) => { alerts.push(body); return {}; };
  const redeploy = () => { ups++; return { ok: true, why: '' }; };
  const r1 = await afterBatch({ s: sB, ran: [{ build: 'a', outcome: 'landed' }, { build: 'b', outcome: 'landed' }, { build: 'c', outcome: 'red' }], api, redeploy, check: async () => { checks++; return { verdict: 'ok', why: 'one of each' }; } });
  assert.equal(ups, 1); assert.equal(checks, 1); assert.deepEqual(r1.landed, ['a', 'b']); assert.deepEqual(r1.red, ['c']);
  await afterBatch({ s: sB, ran: [{ build: 'd', outcome: 'red' }], api, redeploy, check: async () => { checks++; return {}; } });
  assert.equal(ups, 1, 'nothing landed: no redeploy'); assert.equal(checks, 1);
  await afterBatch({ s: sB, ran: [{ build: 'e', outcome: 'landed' }], api, redeploy, check: async () => ({ verdict: 'doubled', why: '2 banners' }) });
  const doubled = alerts.filter((x) => x.key === 'land:doubled-chrome');
  assert.equal(doubled.length, 1); assert.match(doubled[0].body, /2 banners/);
  const sums = alerts.filter((x) => String(x.key).startsWith('landsum:'));
  assert.equal(sums.length, 3, 'one summary per batch'); assert.match(sums[0].title, /2 landed, 0 archived, 0 flagged, 1 red/); assert.match(sums[0].body, /landed: a, b/);
  assert.equal(readFileSync(join(sB.dataDir, 'land-batches.jsonl'), 'utf8').trim().split('\n').length, 3);
});

await t('landing summary: one phone line per batch, nothing to say = no notification', async () => {
  const { summaryAlert } = await import('./land-one.mjs');
  assert.equal(summaryAlert({ at: 'x', landed: [], red: [], flagged: [], archived: [] }), null);
  const a = summaryAlert({ at: '2026-11-14T23:00:00Z', landed: ['a'], red: [], flagged: ['f'], archived: ['z1', 'z2'] });
  assert.equal(a.key, 'landsum:2026-11-14T23:00:00Z'); assert.match(a.title, /1 landed, 2 archived, 1 flagged, 0 red/); assert.match(a.body, /archived \(already on main\): z1, z2/);
});

await t('chrome verdicts: one of each ok, two banners or menu bars doubled, a sign-in wall unknown (never a pass)', async () => {
  assert.equal(chrome.verdict({ banners: 1, menubars: 1 }).verdict, 'ok');
  assert.equal(chrome.verdict({ banners: 2, menubars: 1 }).verdict, 'doubled');
  assert.equal(chrome.verdict({ banners: 1, menubars: 2 }).verdict, 'doubled');
  assert.equal(chrome.verdict({ blocked: 'the axHub sign-in wall' }).verdict, 'unknown');
  assert.equal(chrome.overall({ desktop: { banners: 1, menubars: 1 }, phone: { banners: 2, menubars: 1 } }).verdict, 'doubled');
});

await t('two at once: a second attempt is refused while the line is held, and runs once it is free', async () => {
  assert.equal(await takeLandLock({ who: 'other lander' }), true);
  const r = await landOne({ s, git, ...base, ci: false, build: { id: 'clean', branch: 'claude/clean' }, now: () => at });
  assert.equal(r.ran, false); assert.match(r.owner, /other lander/);
  dropLandLock();
  const r2 = await landOne({ s, git, ...base, ci: false, build: { id: 'clean', branch: 'claude/clean' }, now: () => at, dry: true });
  assert.equal(r2.ran, true);
});

await t('a lander only drops its own lock; a waiting lander keeps it fresh', async () => {
  const { lockDir, touchLandLock } = await import('./land.mjs');
  mkdirSync(lockDir(), { recursive: true }); writeFileSync(join(lockDir(), 'owner'), '999999 2026-11-14T00:00:00Z someone else\n');
  dropLandLock();
  assert.ok(existsSync(lockDir()), "another lander's lock stays");
  const { utimesSync, statSync } = await import('node:fs');
  utimesSync(lockDir(), new Date(0), new Date(0)); touchLandLock();
  assert.ok(Date.now() - statSync(lockDir()).mtimeMs < 5000, 'touched');
  dropLandLock({ force: true }); assert.ok(!existsSync(lockDir()));
});

await t('two land-one calls started together: exactly one runs', async () => {
  const slow = (o) => { spawnSync('sleep', ['0.3']); return { merged: true, sha: sh(['rev-parse', 'origin/claude/clean'], repo), conflicts: [] }; };
  const [a, b] = await Promise.all([
    landOne({ s, git, ...base, ci: false, build: { id: 'clean', branch: 'claude/clean' }, merge: slow, dry: true }),
    landOne({ s, git, ...base, ci: false, build: { id: 'clean', branch: 'claude/clean' }, merge: slow, dry: true }),
  ]);
  assert.equal([a, b].filter((x) => x.ran).length, 1);
});

rmSync(root, { recursive: true, force: true });
console.log(`land-one: ${n} checks passed`);
