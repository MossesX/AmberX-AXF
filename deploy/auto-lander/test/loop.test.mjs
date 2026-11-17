// node --test deploy/auto-lander/test/loop.test.mjs
// The whole loop, tick by tick, against a fake GitHub (fakes/github.mjs) and a fake claude-headless (fakes/claude-headless.sh):
//   1. a clash that resolves and lands       2. red CI fixed by a fix session and landed
//   3. three failed fixes escalate: a banner item (the systems-check verdict) and exactly one push; Fix starts over
//   4. a crash mid-attempt (stale lock, open attempt) that resumes cleanly
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'al-loop-'));
process.env.AXF_AUTO_LANDER_DIR = join(root, 'data');
process.env.FAKE_HEADLESS_LOG = join(root, 'headless.log');
process.env.AXF_CREW_SAY = 'off';
writeFileSync(process.env.FAKE_HEADLESS_LOG, '');

const L = await import('../auto-lander.mjs');
const A = await import('../attempts.mjs');
const esc = await import('../escalate.mjs');
const { ciStatus } = await import('../ci-status.mjs');
const { launchFix } = await import('../fix-session.mjs');
const { reconcile } = await import('../reconcile.mjs');
const { fakeGitHub } = await import('./fakes/github.mjs');

// ------------------------------------------------------------------ the fake world
const { gh, world } = fakeGitHub();
const S = { slug: 'o/r', base: 'main', workflow: 'android.yml' };
const store = [];
const alerts = []; const resolved = [];
esc.setConsole(async (method, path, body) => { if (path === '/api/alerts') alerts.push(body); if (path === '/api/alerts/resolve') resolved.push(...body.keys); return { ok: true }; });
const merges = []; const queue = [];
let clock = Date.parse('2026-11-17T08:00:00.000Z');
const now = () => new Date(clock).toISOString();
const later = (min) => { clock += min * 60000; };
const build = (id, pr, extra = {}) => { const b = { id, title: id, branch: `claude/${id}`, pr: `#${pr}`, status: 'built', builtAt: now(), steps: [{ id: 's1', done: true }], notes: [], origin: { said: `Build ${id}.` }, pipeline: {}, ...extra }; store.push(b); return b; };
const find = (id) => store.find((b) => b.id === id);
const launches = () => readFileSync(process.env.FAKE_HEADLESS_LOG, 'utf8').split('\n').filter(Boolean);

const fixDeps = {
  build: find, rules: () => ({}), worktree: () => '', branchWorktree: () => ({}), live: () => ({ live: false }), attempts: A, route: () => 'acct-a',
  act: (c) => { const b = find(c.id); if (c.action === 'add-step') b.steps.push({ id: `s${b.steps.length + 1}`, text: c.stepData.text, model: c.stepData.model }); if (c.action === 'note') b.notes.push(c.text); return { state: { builds: [b] } }; },
  setPipeline: (id, patch, o) => { const b = find(id); Object.assign(b.pipeline, patch); if (o.status) b.status = o.status; },
  launch: (b, l) => {
    const r = spawnSync('bash', [join(HERE, 'fakes/claude-headless.sh'), '--name', b.id, '--account', l.account, '--', '--model', l.model], { encoding: 'utf8', env: process.env });
    const session = /started (axf-\S+) in/.exec(r.stdout)?.[1]; if (r.status !== 0 || !session) throw new Error(`launcher exit ${r.status}: ${r.stderr}`);
    return { session, slot: '', dir: root };
  },
};
const deps = {
  s: S, gh,
  builds: () => store,
  ruleSet: () => null,
  landState: () => ({ land: { items: [] }, control: {} }),
  ciStatus: (o) => ciStatus({ ...o, gh, s: S }),
  mergeMain: async ({ build: id, pr }) => {
    const a = A.start(id, 'clash', { pr, at: now() });
    const p = world.prs[pr]; const fix = world.mergeFails?.[id];
    if (fix) { A.end(a, 'failed', { log: `hand-written files clash: ${fix}`, at: now() }); return { status: 'needs-fix', conflicts: [fix], ci: 'failure', failing: [`merge main: conflict in ${fix}`] }; }
    const sha = `${p.head.sha}-m`; world.push(pr, sha, 'running'); merges.push(id);
    A.end(a, 'ok', { log: 'merged main', at: now(), head: sha });
    return { status: 'merged', sha, conflicts: [] };
  },
  launchFix: (o) => launchFix({ ...o, deps: fixDeps }),
  queueAdd: async (n) => { queue.push(n); return { ok: true, out: `queued #${n}` }; },
  live: async () => ({ live: false }),
  startCi: async () => {},
  escalate: esc.escalate, resolveEscalation: esc.resolve, flushEscalations: esc.flush,
};
const tick = () => L.tick({ deps, now, reconcile });
const rec = async (id) => (await tick()).builds.find((b) => b.build === id);
const stateOf = (id) => L.readState().builds.find((b) => b.build === id);
/** The fix session ran: it pushed a new head and ended (the dispatcher's end puts the build back to built). */
const sessionPushes = (id, pr, head, ci) => { world.push(pr, head, ci); find(id).status = 'built'; delete find(id).pipeline.session; };

// ------------------------------------------------------------------ the cases

test('1. a clash: main is merged in, CI runs, the PR goes to the merge queue and lands', async () => {
  build('clash-b', 11); world.pr(11, 'claude/clash-b', 'c1', { mergeable: false, mergeable_state: 'dirty' }); world.ci.c1 = 'success';
  let r = await rec('clash-b');
  assert.equal(r.state, 'ci-running'); assert.deepEqual(merges, ['clash-b']);
  later(1); r = await rec('clash-b');
  assert.equal(r.state, 'ci-running'); assert.equal(r.last.waitReason, 'ci-running');
  world.ci['c1-m'] = 'success'; later(1); r = await rec('clash-b');
  assert.equal(r.state, 'landing'); assert.deepEqual(queue, [11], 'the merge queue is the only way in');
  world.merge(11, now()); later(1); r = await rec('clash-b');
  assert.equal(r.state, 'landed');
  assert.deepEqual(A.list('clash-b').map((a) => [a.kind, a.result]), [['clash', 'ok'], ['land', 'ok']]);
});

test('2. red CI: a fix session (fake claude-headless) pushes, the new head goes green, it lands', async () => {
  build('red-b', 12); world.pr(12, 'claude/red-b', 'r1'); world.ci.r1 = 'failure';
  let r = await rec('red-b');
  assert.equal(r.state, 'fixing');
  assert.deepEqual(launches(), ['red-b acct-a Opus']);
  const fixStep = find('red-b').steps.at(-1);
  assert.equal(fixStep.model, 'Opus'); assert.match(fixStep.text, /Web Dev Console › Python route tests/); assert.match(fixStep.text, /x\.py:3: AssertionError: boom/); assert.match(fixStep.text, /Brett said \(verbatim\): "Build red-b\."/);
  later(1); r = await rec('red-b');
  assert.equal(r.last.waitReason, 'in-flight', 'no second session while the first runs'); assert.equal(launches().length, 1);
  sessionPushes('red-b', 12, 'r2', 'running'); later(3); r = await rec('red-b');
  assert.equal(r.last.waitReason, 'in-flight', 'waits for the new head\'s CI'); assert.equal(A.list('red-b')[0].result, 'started');
  world.ci.r2 = 'success'; later(3); r = await rec('red-b');
  assert.equal(A.list('red-b', { kind: 'red-ci' })[0].result, 'ok');
  assert.equal(r.state, 'landing'); assert.ok(queue.includes(12));
  world.merge(12, now()); later(1); r = await rec('red-b');
  assert.equal(r.state, 'landed');
});

test('3. three failed fixes escalate: banner item, one push, Fix starts over', async () => {
  build('stuck-b', 13); world.pr(13, 'claude/stuck-b', 'e1'); world.ci.e1 = 'failure';
  const waits = [6, 16, 46];
  for (let n = 1; n <= 3; n += 1) {
    const r = await rec('stuck-b');
    assert.equal(r.state, 'fixing', `fix ${n} starts`);
    sessionPushes('stuck-b', 13, `e${n + 1}`, 'failure');
    later(1); await tick(); // reconcile: the new head is red again → failed
    assert.equal(A.count('stuck-b')['red-ci'].failures, n);
    if (n < 3) { assert.equal(stateOf('stuck-b').last.waitReason, 'backoff', `backoff after fix ${n}`); later(waits[n - 1]); }
  }
  let s = L.status({ at: now() });
  assert.equal(stateOf('stuck-b').state, 'escalated');
  assert.deepEqual(s.escalated, ['stuck-b']);
  assert.equal(s.escalations[0].kind, 'red-ci'); assert.equal(s.escalations[0].attempts, 3); assert.match(s.escalations[0].log, /still red/);
  assert.equal(alerts.length, 1, 'one push'); assert.equal(alerts[0].key, 'gate:auto-lander-escalated:stuck-b'); assert.equal(alerts[0].type, 'gate.auto-lander-escalated');
  assert.equal(launches().filter((l) => l.startsWith('stuck-b')).length, 3, 'nothing more starts once escalated');
  later(5); await tick(); later(5); await tick();
  assert.equal(alerts.length, 1, 'still one push');
  // the systems-check item (gate plugin, health@1) reads the same status
  const py = spawnSync('python3', ['-c', 'import sys,json; sys.path.insert(0, sys.argv[1]); import auto_lander_health as h; print(json.dumps(h.check(json.loads(sys.stdin.read()), float(sys.argv[2]))))', join(HERE, '../../../apps/console-web/plugins/gate/server'), String(clock)], { input: JSON.stringify(s), encoding: 'utf8' });  // axf-plugin:gate
  if (!py.error) { assert.equal(py.status, 0, py.stderr); const v = JSON.parse(py.stdout); assert.equal(v.status, 'error'); assert.match(v.summary, /gave up on stuck-b/); }
  // Fix: reset + a fix session now
  await L.retry('stuck-b', { by: 'brett', fix: true, at: now() });
  assert.deepEqual(resolved, ['gate:auto-lander-escalated:stuck-b']);
  later(1); const r = await rec('stuck-b');
  assert.equal(r.state, 'fixing'); assert.equal(launches().filter((l) => l.startsWith('stuck-b')).length, 4);
  s = L.status({ at: now() }); assert.deepEqual(s.escalated, []);
});

test('4. a crash mid-attempt: the stale lock is taken over and the open attempt is closed and retried', async () => {
  build('crash-b', 14); world.pr(14, 'claude/crash-b', 'k1', { mergeable: false, mergeable_state: 'dirty' }); world.ci.k1 = 'success';
  A.start('crash-b', 'clash', { pr: 14, at: now() });
  writeFileSync(L.files().lock, JSON.stringify({ pid: 2 ** 22 + 12345, at: now() }));
  later(1);
  const out = await tick();
  assert.ok(!out.skipped, 'a dead holder does not block the tick');
  const [first] = A.list('crash-b');
  assert.equal(first.result, 'failed'); assert.match(first.log, /crash/);
  assert.equal(stateOf('crash-b').last.waitReason, 'backoff', 'retry is scheduled, not lost');
  later(6); const r = await rec('crash-b');
  assert.equal(r.state, 'ci-running'); assert.deepEqual(A.list('crash-b').map((a) => a.result), ['failed', 'ok']);
  assert.ok(!existsSync(L.files().lock), 'the lock is released');
});

test('a live tick holds the one lock', async () => {
  writeFileSync(L.files().lock, JSON.stringify({ pid: process.pid, at: now() }));
  const out = await tick();
  assert.match(out.skipped, /another tick runs/);
});
