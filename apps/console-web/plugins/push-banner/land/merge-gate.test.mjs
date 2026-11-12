// Merge gate self-test: the pure rules (merge-gate-core.mjs) and rounds of the runner against a real local git repo with
// a fake GitHub, a fake orchestrator and a fake console (no network, no model). Run:
//   node apps/console-web/plugins/push-banner/land/merge-gate.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as G from './merge-gate-core.mjs';
import { command, failuresOf, gateRound, readGateConfig, readLog } from './merge-gate.mjs';
import { makeGit } from './land.mjs';
process.env.AXF_CREW_SAY = 'off';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };
const AT = (m) => new Date(Date.parse('2026-11-12T10:00:00Z') + m * 60000);

// ------------------------------------------------------------------ pure rules

await t('a queue kick-out reads as a why in plain English', () => {
  const c = G.triggerFromKick({ why: '#7 conflicts with main in code (a.mjs, web/b.tsx). Merge main in and fix them.', head: 'h' });
  assert.equal(c.kind, 'conflict'); assert.deepEqual(c.files, ['a.mjs', 'web/b.tsx']);
  assert.equal(G.whyText(c), 'Conflicts with main in a.mjs, web/b.tsx.');
  const r = G.triggerFromKick({ why: '#7 broke CI when tested on top of main (failed: test, android). Run: https://github.com/o/r/actions/runs/5' });
  assert.equal(r.kind, 'ci'); assert.deepEqual(r.checks, ['test', 'android']); assert.match(r.runUrl, /runs\/5/);
  assert.match(G.whyText({ ...r, errors: ['test: step "Run tests" failed'] }), /Failed the test gate: test, android\. Errors: test: step "Run tests" failed/);
  assert.match(G.whyText({ kind: 'behind', behind: 400 }), /Too far behind main \(400 commits\)/);
});

await t('rules: fix first, rebuild after a failed fix or when too far behind, hold after the cap', () => {
  let e = G.newEntry({ build: 'feat', branch: 'claude/feat', pr: 7, at: 'x' });
  const conflict = { kind: 'conflict', files: ['a.mjs'] };
  assert.deepEqual(G.nextAttempt(e, conflict), { kind: 'fix', n: 1 });
  assert.deepEqual(G.nextAttempt(e, { kind: 'conflict', behind: 999 }), { kind: 'rebuild', n: 1 });
  e = G.startAttempt(e, 'fix', conflict, { at: '1' });
  assert.equal(e.state, 'fixing'); assert.equal(G.bannerView(e).tone, 'warning'); assert.equal(G.bannerView(e).label, 'Auto-fixing (attempt 1 of 3)');
  assert.match(G.bannerView(e).lines[0], /Why: Conflicts with main in a\.mjs/);
  e = G.endAttempt(e, 'failed', { at: '2', trigger: conflict });
  assert.deepEqual(G.nextAttempt(e, conflict), { kind: 'rebuild', n: 2 });
  e = G.startAttempt(e, 'rebuild', conflict, { at: '3', job: { build: 'feat-r2', branch: 'claude/feat-r2' } });
  assert.equal(e.state, 'rebuilding'); assert.equal(G.bannerView(e).tone, 'info'); assert.equal(e.branch, 'claude/feat-r2');
  e = G.endAttempt(e, 'failed', { at: '4', trigger: { kind: 'ci', checks: ['test'] } });
  assert.deepEqual(G.nextAttempt(e, { kind: 'ci' }), { kind: 'fix', n: 3 }, 'a new branch gets the cheap fix first');
  e = G.startAttempt(e, 'fix', { kind: 'ci', checks: ['test'] }, { at: '5' });
  e = G.endAttempt(e, 'failed', { at: '6', trigger: { kind: 'ci', checks: ['lint'] } });
  assert.deepEqual(G.nextAttempt(e, { kind: 'ci' }), { kind: 'hold', n: 3 });
  e = G.hold(e, { at: '7' });
  const v = G.bannerView(e);
  assert.equal(v.tone, 'danger'); assert.equal(v.label, 'Failed 3 times - needs you'); assert.equal(v.lines.length, 3, 'red says why for each attempt');
  assert.match(v.lines[1], /Rebuild: Failed the test gate: test/);
});

await t('rebuild ids: <name>-rN, one past the last, free', () => {
  assert.equal(G.rebuildId('feat'), 'feat-r2');
  assert.equal(G.rebuildId('feat-r6'), 'feat-r7');
  assert.equal(G.rebuildId('feat', new Set(['feat-r2'])), 'feat-r3');
});

await t('banner groups, clear keeps the log, restore and archive', () => {
  let log = { entries: [
    { ...G.newEntry({ build: 'a', at: '1' }), state: 'failed', attempts: [{ n: 1, kind: 'fix', why: 'x' }] },
    { ...G.newEntry({ build: 'b', at: '1' }), state: 'merged' },
    { ...G.newEntry({ build: 'c', at: '1' }), state: 'fixing', attempts: [{ n: 1, kind: 'fix', why: 'y', result: 'running' }] },
  ] };
  assert.deepEqual(G.bannerGroups(log).map((g) => [g.id, g.entries.length]), [['working', 1], ['failed', 1], ['merged', 1]]);
  log = G.applyFlag(log, { cmd: 'clear', group: 'failed' }, 'now');
  assert.deepEqual(G.bannerGroups(log).map((g) => g.id), ['working', 'merged'], 'Clear reds takes the red ones off the banner');
  assert.equal(log.entries.length, 3, 'still in the log');
  assert.equal(G.gridRows(log).find((r) => r.id === 'a').cleared, true);
  log = G.applyFlag(log, { cmd: 'restore', ids: ['a'] }, 'now');
  assert.ok(G.bannerGroups(log).some((g) => g.id === 'failed'));
  log = G.applyFlag(log, { cmd: 'archive', ids: ['b', 'c'] }, 'now');
  assert.deepEqual(G.gridRows(log).map((r) => r.id), ['a']); assert.equal(G.gridRows(log, { archived: true }).length, 3);
  const ctl = G.addCommand({}, { cmd: 'clear', ids: ['a'], seq: 1 });
  assert.equal(G.withPending(log, ctl).entries.find((e) => e.id === 'a').banner.cleared, true, 'a clear shows before the runner applies it');
  assert.throws(() => G.addCommand({}, { cmd: 'nuke', ids: ['a'] }), /unknown command/);
});

await t('every command is reachable by name (REST / CLI / MCP / voice share the ids)', () => {
  for (const c of ['retry', 'fix', 'rebuild', 'merge', 'skip', 'automerge', 'clear', 'restore', 'archive']) assert.ok(G.CMD_IDS.includes(c), c);
  assert.ok(G.GATE_COMMANDS.find((c) => c.cmd === 'retry').voice.includes('retry the failed merges'));
});

// ------------------------------------------------------------------ rounds: real git, fake GitHub / orchestrator / console

function sh(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); }
const root = mkdtempSync(join(tmpdir(), 'mg-test-'));
const origin = join(root, 'origin.git'); const repo = join(root, 'repo'); const data = join(root, 'data');
mkdirSync(data);
sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
sh(root, 'clone', '-q', origin, repo);
const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const commit = (file, text, msg) => { mkdirSync(join(repo, file, '..'), { recursive: true }); writeFileSync(join(repo, file), text); sh(repo, 'add', file); sh(repo, ...cfg, 'commit', '-q', '-m', msg); };
const store = (builds) => { sh(repo, 'checkout', '-q', '--detach', 'origin/main'); commit('_claude/builds/store.json', JSON.stringify({ builds }), 'store [skip ci]'); sh(repo, 'push', '-q', 'origin', 'HEAD:main'); sh(repo, 'fetch', '-q', 'origin'); };
commit('a.txt', 'base\n', 'base');
sh(repo, 'push', '-q', 'origin', 'HEAD:main');
sh(repo, 'checkout', '-q', '-b', 'claude/feat', 'origin/main'); commit('a.txt', 'feature\n', 'feat'); sh(repo, 'push', '-q', 'origin', 'HEAD:claude/feat');
const H = sh(repo, 'rev-parse', 'HEAD');
sh(repo, 'checkout', '-q', '--detach', 'origin/main'); commit('a.txt', 'main moved\n', 'main'); sh(repo, 'push', '-q', 'origin', 'HEAD:main');
sh(repo, 'fetch', '-q', 'origin');
store([{ id: 'feat', title: 'Feature', branch: 'claude/feat', status: 'built', detail: 'make the feature', origin: { said: 'build the feature' } }]);

const s = { repo, slug: 'o/r', dataDir: data, remote: 'origin', base: 'main', archive: join(root, 'archive') };
const base = makeGit(repo);
const pushes = [];
const git = (args, o) => { if (args[0] === 'push') pushes.push(args.join(' ')); return base(args, o); };
const calls = { requests: [], acts: [], alerts: [], resolved: [], said: [], gh: [], queue: [] };
const orch = { request: (x) => { calls.requests.push(x); return { id: x.id }; }, act: (c) => { calls.acts.push(c); return {}; } };
const api = async (method, path, body) => { if (path === '/api/alerts') calls.alerts.push(body); if (path === '/api/alerts/resolve') calls.resolved.push(...body.keys); return {}; };
const gh = async (method, path, body) => { calls.gh.push(`${method} ${path}`); if (path.includes('/actions/runs/')) return { jobs: [{ name: 'test', conclusion: 'failure', steps: [{ name: 'Run tests', conclusion: 'failure' }] }] }; return {}; };
const say = (ev, text, ref) => calls.said.push({ ev, text, ref });
const queueCtl = (c, pr, o) => calls.queue.push({ c, pr, o });
const kicked = (pr, branch, head, why) => ({ waiting: [{ pr, branch, head, build: '', state: 'kicked', why: `kicked out: ${why}` }], kicked: [{ pr, head, why }], items: [], merged: [] });
const round = (queue, m, extra = {}) => gateRound({ s, git, gh, api, orch, say, queueCtl, queue, land: {}, now: () => AT(m), ...extra });

await t('settings: on by default, cap 3', () => assert.deepEqual(readGateConfig(s), { on: true, cap: 3, behindLimit: 150 }));

await t('failures come from the queue (kicked, with the build found by branch) and auto-land', () => {
  const f = failuresOf({ queue: kicked(7, 'claude/feat', H, '#7 conflicts with main in code (a.txt). Merge main in and fix them.'), builds: [{ id: 'feat', branch: 'claude/feat' }] });
  assert.equal(f.length, 1); assert.equal(f[0].build, 'feat'); assert.equal(f[0].trigger.kind, 'conflict');
  const l = failuresOf({ land: { items: [{ id: 'x', branch: 'claude/x', state: 'blocked', reason: { kind: 'ci', checks: ['test'] } }] } });
  assert.equal(l[0].trigger.kind, 'ci');
});

const conflictQueue = kicked(7, 'claude/feat', H, '#7 conflicts with main in code (a.txt). Merge main in and fix them.');
await t('conflict: auto-fix (yellow) with the why; main pulled in, the code conflict goes to a fix session through the orchestrator', async () => {
  const doc = await round(conflictQueue, 0);
  const e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.state, 'fixing'); assert.equal(e.attempts.length, 1);
  assert.match(e.attempts[0].why, /Conflicts with main in a\.txt/);
  assert.equal(calls.requests[0].id, 'feat-fix1'); assert.match(calls.requests[0].detail, /Conflicting files: a\.txt/); assert.match(calls.requests[0].detail, /Never push to main/);
  assert.deepEqual(calls.acts[0], { action: 'update', id: 'feat-fix1', branch: 'claude/feat' }, 'the fix session works on the old branch');
  const al = calls.alerts.find((a) => a.key === 'gate:feat');
  assert.equal(al.severity, 'warning'); assert.match(al.title, /Auto-fixing \(attempt 1 of 3\)/); assert.match(al.body, /a\.txt/);
  assert.equal(calls.said[0].ev, 'start'); assert.match(calls.said[0].text, /Auto-fixing feat/);
  // a second round with nothing new launches nothing
  await round(conflictQueue, 3);
  assert.equal(calls.requests.length, 1, 'one session per attempt');
});

await t('the fix session ends and it still conflicts: full rebuild (blue) on fresh main, old build superseded, PR closed', async () => {
  store([{ id: 'feat', title: 'Feature', branch: 'claude/feat', status: 'built', detail: 'make the feature', origin: { said: 'build the feature' } }, { id: 'feat-fix1', branch: 'claude/feat', status: 'built' }]);
  const doc = await round(conflictQueue, 30);
  const e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.attempts[0].result, 'failed');
  assert.equal(e.state, 'rebuilding'); assert.equal(e.attempts[1].kind, 'rebuild'); assert.equal(e.branch, 'claude/feat-r2');
  const rq = calls.requests.at(-1);
  assert.equal(rq.id, 'feat-r2'); assert.equal(rq.said, 'build the feature');
  assert.match(rq.detail, /do NOT merge it/); assert.match(rq.detail, /claude\/feat/); assert.match(rq.detail, /make the feature/); assert.match(rq.detail, /Conflicts with main in a\.txt/);
  assert.ok(calls.acts.some((a) => a.action === 'archive' && a.id === 'feat'), 'old build superseded');
  assert.ok(calls.acts.some((a) => a.action === 'note' && a.id === 'feat' && /Superseded by feat-r2/.test(a.text)));
  assert.ok(calls.gh.includes('PATCH /repos/o/r/pulls/7'), 'old PR closed');
  assert.equal(e.links.chain[0].supersededBy, 'feat-r2');
  assert.equal(calls.alerts.filter((a) => a.key === 'gate:feat').at(-1).severity, 'warning');
  assert.match(calls.alerts.filter((a) => a.key === 'gate:feat').at(-1).title, /Full rebuild \(attempt 2 of 3\)/);
});

const afterRebuild = join(root, 'after-rebuild'); cpSync(data, afterRebuild, { recursive: true });

await t('the rebuild passes: green Passed, then Merged through the queue', async () => {
  let doc = await round({ items: [{ pr: 9, branch: 'claude/feat-r2', head: 'n1', state: 'testing', ci: 'running', prCi: 'success' }], waiting: [], kicked: [], merged: [] }, 60);
  let e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.state, 'passed'); assert.equal(e.pr, 9); assert.equal(G.bannerView(e).tone, 'success');
  doc = await round({ items: [], waiting: [], kicked: [], merged: [{ pr: 9, sha: 'abcdef123', at: AT(70).toISOString() }] }, 72);
  e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.state, 'merged'); assert.equal(G.bannerView(e).label, 'Merged');
  assert.ok(calls.resolved.includes('land:gate:feat'));
});

await t('three failures: red, held, why for each attempt, one merge.blocked push', async () => {
  cpSync(afterRebuild, data, { recursive: true, force: true });
  const before = calls.requests.length;
  // the rebuild's PR is kicked: attempt 2 failed, attempt 3 is a fix on the new branch
  let doc = await round(kicked(9, 'claude/feat-r2', 'n1', '#9 broke CI when tested on top of main (failed: test). Run: https://github.com/o/r/actions/runs/42'), 80);
  let e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.attempts[1].result, 'failed'); assert.match(e.attempts[1].failedWhy, /test/);
  assert.deepEqual(e.attempts[1].failedWith.errors, ['test: step "Run tests" failed'], 'the key error lines are kept');
  assert.equal(e.state, 'fixing'); assert.equal(e.attempts[2].kind, 'fix');
  assert.equal(calls.requests.length, before + 1);
  // the fix pushed a new head and that one is kicked too
  doc = await round(kicked(9, 'claude/feat-r2', 'n2', '#9 broke CI when tested on top of main (failed: lint).'), 120);
  e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.state, 'failed'); assert.equal(e.attempts.length, 3);
  const red = G.bannerView(e);
  assert.equal(red.tone, 'danger'); assert.equal(red.lines.length, 3);
  const blocked = calls.alerts.filter((a) => a.key === 'land:gate:feat');
  assert.equal(blocked.length, 1); assert.match(blocked[0].title, /^Landing blocked/); assert.equal(blocked[0].severity, 'error');
  assert.equal(calls.said.at(-1).ev, 'blocked');
  // held: no more attempts by itself
  const held = calls.requests.length;
  await round(kicked(9, 'claude/feat-r2', 'n2', '#9 broke CI (failed: lint).'), 130);
  assert.equal(calls.requests.length, held);
});

await t('clear keeps it in the log; row commands work (retry, skip, merge, automerge)', async () => {
  command(s, 'clear', { group: 'failed', by: 'brett' }); command(s, 'merge', { ids: ['9'] });
  let doc = await round({ items: [], waiting: [], kicked: [], merged: [] }, 140);
  assert.deepEqual(calls.queue.at(-1), { c: 'add', pr: 9, o: {} }, 'Merge sends it to the merge queue (by PR number too)');
  let e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.banner.cleared, true); assert.equal(G.bannerGroups(doc).length, 0); assert.equal(readLog(s).entries.length, 1);
  command(s, 'retry', { ids: ['feat'], by: 'brett' });
  const before = calls.requests.length;
  doc = await round(kicked(9, 'claude/feat-r2', 'n2', '#9 broke CI (failed: lint).'), 150);
  e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.attempts.length, 4, 'retry gives a red one another attempt'); assert.equal(e.banner.cleared, false, 'a new attempt is back on the banner');
  assert.equal(calls.requests.length, before + 1);
  assert.equal(calls.requests.at(-1).id, 'feat-r3', 'a second rebuild gets the next free -rN');
  command(s, 'automerge', { ids: ['feat'] }); command(s, 'skip', { ids: ['feat'] });
  doc = await round({ items: [], waiting: [], kicked: [], merged: [] }, 160);
  e = doc.entries.find((x) => x.build === 'feat');
  assert.equal(e.state, 'skipped'); assert.equal(e.autoMerge, false);
  await round(kicked(9, 'claude/feat-r2', 'n3', '#9 broke CI (failed: lint).'), 170);
  assert.equal(readLog(s).entries.find((x) => x.build === 'feat').state, 'skipped', 'skipped stays skipped');
});

await t('switched off: nothing new starts', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'mg-off-'));
  writeFileSync(join(d2, 'config.json'), JSON.stringify({ mergeGate: false }));
  const before = calls.requests.length;
  const doc = await gateRound({ s: { ...s, dataDir: d2 }, git, gh, api, orch, say, queue: conflictQueue, land: {}, now: () => AT(200) });
  assert.equal(doc.entries.length, 0); assert.equal(calls.requests.length, before);
});

await t('never pushes to main', () => {
  assert.ok(pushes.every((p) => !/(^|[\s:])(refs\/heads\/)?main$/.test(p)), pushes.join('\n'));
  assert.equal(sh(repo, 'rev-parse', 'origin/main'), sh(origin, 'rev-parse', 'main'));
});

console.log(`merge-gate: ${n} checks passed`);
