// Self-test: node apps/console-web/plugins/build-orchestrator/auto-merge.test.mjs
// Auto-merge switch + merge banner groups (auto-merge-core.mjs), the merge queue's gate (push-banner merge-queue-core.mjs)
// and the pipeline CLI end to end on a scratch store (auto-merge, merge-banner, merge-decide, merge-dismiss).
process.env.AXF_BUILD_LIMIT ??= 'off';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AM from './auto-merge-core.mjs';
import * as Q from '../push-banner/land/merge-queue-core.mjs';
import { isCandidate } from '../push-banner/land/land-core.mjs';
import { normBuild } from '../../../../framework/plan/builds-store-core.mjs';
import { apply as orchApply } from './web/orchestrator-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const now = Date.parse('2026-11-11T12:00:00Z');
const step = (id, done) => ({ id, text: `${id} work`, model: 'Opus', done, doneAt: done ? '2026-11-11T10:00:00Z' : '' });
const b = (id, status, extra = {}) => ({ id, title: id, status, branch: `claude/${id}`, pr: '', createdAt: '2026-11-11T09:00:00Z', updatedAt: '2026-11-11T11:00:00Z', builtAt: ['built', 'complete'].includes(status) ? '2026-11-11T11:00:00Z' : '', steps: [step('s1', ['built', 'complete'].includes(status))], notes: [], ...extra });

// ---------------- the record
t('builds@1: autoMerge defaults to false for every build, existing ones included', () => {
  const r = normBuild({ id: 'old', title: 'Old build' });
  assert.equal(r.autoMerge, false); assert.equal(r.autoMergeAt, undefined); assert.equal(r.mergeApproval, undefined);
  const on = normBuild({ id: 'x', autoMerge: true, autoMergeAt: '2026-11-11T00:00:00Z', autoMergeBy: 'Brett', mergeApproval: { by: 'Brett', at: '2026-11-11T01:00:00Z' } });
  assert.equal(on.autoMerge, true); assert.equal(on.autoMergeBy, 'Brett'); assert.equal(on.mergeApproval.by, 'Brett');
  assert.equal(normBuild({ id: 'y', autoMerge: 'yes' }).autoMerge, false, 'only true is on');
});
t('orchestrator act auto-merge: off by anyone, on only with Brett as approver (voice / control_act planner.builds)', () => {
  const state = { builds: [b('a', 'pending')] };
  assert.equal(orchApply(state, { action: 'auto-merge', id: 'a', on: false }).state.builds[0].autoMerge, false);
  assert.throws(() => orchApply(state, { action: 'auto-merge', id: 'a', on: true }), /Brett's yes/);
  const r = orchApply(state, { action: 'auto-merge', id: 'a', on: true, approver: { by: 'Brett', via: 'axhub' } });
  assert.equal(r.state.builds[0].autoMerge, true); assert.ok(r.state.builds[0].autoMergeAt); assert.equal(r.state.builds[0].autoMergeBy, 'Brett');
});

// ---------------- the gate: off never lands, on lands only on green
t('gate: off waits for Brett, on or approved may join; the queue holds the same rule', () => {
  for (const [rec, waits] of [[b('a', 'built'), true], [b('a', 'built', { autoMerge: true }), false], [b('a', 'built', { mergeApproval: { by: 'Brett', at: '2026-11-11T11:30:00Z' } }), false]]) {
    assert.equal(!!AM.gate(rec), waits); assert.equal(Q.awaitsBrett(rec), waits, 'merge-queue-core awaitsBrett = auto-merge-core gate');
  }
});
t('merge queue: an off build is not ready (green or not) until Brett says Merge or adds it by hand', () => {
  const pr = { number: 7, head: 'abc', ci: 'success', awaitsBrett: Q.awaitsBrett(b('a', 'built')) };
  assert.equal(Q.notReady(pr, {}), Q.AWAITS_BRETT, 'off never lands, even on green');
  assert.equal(Q.notReady(pr, { added: [7] }), '', "his Add back / Merge on the PR is his yes");
  assert.equal(Q.notReady({ ...pr, awaitsBrett: Q.awaitsBrett(b('a', 'built', { autoMerge: true })) }, {}), '', 'on: joins by itself');
  assert.equal(Q.notReady({ ...pr, ci: 'failure', awaitsBrett: false }, {}), 'its PR checks are red', 'on lands only on green');
  assert.equal(Q.notReady({ number: 9, head: 'x', ci: 'success' }, {}), '', 'a PR with no build is not touched by the switch');
});
t('red or clash on an auto-merge build: the merge.blocked push (land:<build>, high priority) names the build and what failed', () => {
  const a = Q.autoMergeBlocked({ build: 'skins', number: 42, autoMerge: true }, 'CI failed: lint.');
  assert.equal(a.source, 'push-banner'); assert.equal(a.key, 'land:skins'); assert.equal(a.severity, 'error');
  assert.match(a.title, /Landing blocked: skins/); assert.match(a.body, /CI failed: lint\./); assert.match(a.body, /#42/);
  const types = JSON.parse(readFileSync(join(HERE, '../push-banner/notify.json'), 'utf8')).types;
  const blocked = types.find((x) => x.id === 'merge.blocked');
  assert.equal(blocked.priority, 'high'); assert.ok(a.key.startsWith(blocked.match.keyPrefix) && a.source === blocked.match.source, 'matches the merge.blocked notify type');
});
t('finished = the push banner land-core candidate rule', () => {
  for (const rec of [b('a', 'built'), b('a', 'complete'), b('a', 'archived'), b('a', 'running'), b('a', 'built', { mergedAt: '2026-11-11T00:00:00Z' }), b('a', 'built', { branch: '' })]) assert.equal(AM.finished(rec), isCandidate(rec), `${rec.status} ${rec.branch}`);
});

// ---------------- the banner groups
const store = { builds: [
  b('new-one', 'pending'), b('queued-one', 'queued', { autoMergeAt: '2026-11-11T10:00:00Z' }), b('running-one', 'running'),
  b('ready-one', 'built', { pr: '#11' }), b('auto-one', 'built', { pr: '#12', autoMerge: true, autoMergeAt: '2026-11-11T10:00:00Z' }),
  b('red-one', 'built', { pr: '#13' }), b('clash-one', 'built', { pr: '#14' }),
  b('landed', 'complete', { mergedAt: '2026-11-11T11:30:00Z', shipped: { id: 'landed', landedCommit: 'abcdef1234567' } }), b('old-landed', 'complete', { mergedAt: '2026-10-01T00:00:00Z' }),
  b('gone', 'pending', { deleted: true }),
] };
const queue = { items: [{ pr: 12, build: 'auto-one', state: 'testing', prCi: 'success' }], waiting: [{ pr: 11, build: 'ready-one', state: 'held', prCi: 'success', why: Q.AWAITS_BRETT }, { pr: 14, build: 'clash-one', state: 'held', prCi: 'none', why: 'it conflicts with main in code (a.mjs)' }], kicked: [{ pr: 13, why: 'CI failed: unit tests.', at: '2026-11-11T11:40:00Z', runUrl: 'https://example.invalid/run' }] };
t('groups: one Auto-merge? entry per build on its way, unanswered only; answered ones leave the group', () => {
  const g = AM.groups(store, { queue, now }).groups;
  assert.deepEqual(g.ask.map((e) => e.id).sort(), ['new-one', 'running-one']);
  assert.ok(g.ask.every((e) => e.autoMerge === false), 'unanswered = off');
});
t('groups: Ready shows tests and clash; on builds show as landing; red and clash go to Blocked; Merged recent with commit', () => {
  const r = AM.groups(store, { queue, now });
  const g = r.groups;
  assert.deepEqual(g.ready.map((e) => e.id).sort(), ['auto-one', 'ready-one']);
  const ready = g.ready.find((e) => e.id === 'ready-one'); assert.equal(ready.tests, 'green'); assert.equal(ready.clash, 'merges cleanly'); assert.equal(ready.landing, false);
  assert.equal(g.ready.find((e) => e.id === 'auto-one').landing, true);
  assert.deepEqual(g.blocked.map((e) => e.id).sort(), ['clash-one', 'red-one']);
  assert.match(g.blocked.find((e) => e.id === 'red-one').why, /unit tests/); assert.match(g.blocked.find((e) => e.id === 'clash-one').why, /Clashes with main/);
  assert.deepEqual(g.merged.map((e) => e.id), ['landed']); assert.equal(g.merged[0].commit, 'abcdef1234567');
  assert.deepEqual(r.counts, { ask: 2, ready: 2, blocked: 2, merged: 1 }); assert.equal(r.total, 7);
  assert.equal(AM.groups(store, { queue, now, dismissed: ['landed'] }).counts.merged, 0, 'dismissed leaves Merged');
});
t('grouping moves entries: answering takes a build out of Auto-merge?, finishing moves it to Ready, landing to Merged', () => {
  const s = structuredClone(store);
  const nb = s.builds.find((x) => x.id === 'new-one');
  AM.setAutoMerge(nb, true, { by: 'Brett', at: '2026-11-11T11:50:00Z' });
  assert.ok(!AM.groups(s, { queue, now }).groups.ask.some((e) => e.id === 'new-one'));
  nb.status = 'built'; nb.builtAt = '2026-11-11T11:55:00Z'; nb.steps[0].done = true;
  assert.equal(AM.groups(s, { queue, now }).groups.ready.find((e) => e.id === 'new-one')?.landing, true);
  nb.status = 'complete'; nb.mergedAt = '2026-11-11T11:58:00Z';
  assert.equal(AM.groups(s, { queue, now }).groups.merged[0].id, 'new-one');
  assert.equal(AM.groups({ builds: [] }).total, 0, 'empty: the banner hides');
});
t('decisions: merge = his yes, skip = archive, rebuild = queue again; only finished builds', () => {
  assert.ok(AM.decision(b('a', 'built'), 'merge', { by: 'Brett' }).mergeApproval.at);
  assert.equal(AM.decision(b('a', 'built'), 'skip', { by: 'Brett' }).status, 'archived');
  assert.equal(AM.decision(b('a', 'built'), 'rebuild', { by: 'Brett' }).status, 'queued');
  assert.throws(() => AM.decision(b('a', 'pending'), 'merge'), /not a finished build/);
  assert.throws(() => AM.decision(b('a', 'built'), 'land'), /merge, skip, rebuild/);
  assert.match(AM.chatLine({ id: 'x', title: 'X', commit: 'abcdef123' }, 'merged'), /Landed on main: X \(abcdef12\)/);
});

// ---------------- the CLI end to end (scratch store)
const tmp = mkdtempSync(join(tmpdir(), 'auto-merge-'));
const storeFile = join(tmp, 'store.json');
writeFileSync(storeFile, JSON.stringify({ $axf: 'builds@1', rev: 1, builds: store.builds.map((x) => ({ ...x, profiles: ['all'] })) }));
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'AXF_APPROVER', 'AXF_APPROVER_VIA'].includes(k)));
const env = { ...base, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_PIPELINE_CONSOLE: 'off' };
const brett = { ...env, AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'console' };
const pipe = (e, ...a) => spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), ...a, '--json'], { cwd: ROOT, env: e, encoding: 'utf8', timeout: 120000, input: a.includes('--queue-stdin') ? JSON.stringify(queue) : undefined });
const json = (r) => JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
const rec = (id) => JSON.parse(readFileSync(storeFile, 'utf8')).builds.find((x) => x.id === id);
t('CLI auto-merge: off by anyone; on refused without Brett; multi-select on with Brett', () => {
  let r = pipe(env, 'auto-merge', 'new-one', 'off'); assert.equal(r.status, 0, r.stderr); assert.equal(rec('new-one').autoMerge, false); assert.ok(rec('new-one').autoMergeAt);
  r = pipe(env, 'auto-merge', 'running-one', 'on'); assert.notEqual(r.status, 0); assert.match(json(r).error, /Brett's yes/); assert.equal(rec('running-one').autoMerge, false);
  r = pipe(brett, 'auto-merge', 'new-one', 'running-one', 'on'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(json(r).done.map((d) => d.id), ['new-one', 'running-one']); assert.ok(rec('new-one').autoMerge && rec('running-one').autoMerge);
  assert.match(rec('running-one').autoMergeBy, /Brett/);
  r = pipe(brett, 'auto-merge', 'landed', 'nope', 'on'); assert.notEqual(r.status, 0, 'a landed build and an unknown one are refused');
});
t('CLI merge-banner: groups with the queue facts; the answered builds left Auto-merge?', () => {
  const r = json(pipe(env, 'merge-banner', '--queue-stdin'));
  assert.equal(r.ok, true); assert.equal(r.counts.ask, 0); assert.equal(r.counts.blocked, 2); assert.equal(r.groups.ready.find((e) => e.id === 'ready-one').tests, 'green');
  assert.ok(r.unposted.some((u) => u.kind === 'merged' && u.build === 'landed'), 'merge results to post in the Breakroom');
});
t('CLI merge-decide: merge needs Brett; skip archives; rebuild queues a new step; dismiss clears Merged; posted once', () => {
  let r = pipe(env, 'merge-decide', 'ready-one', 'merge'); assert.notEqual(r.status, 0); assert.equal(rec('ready-one').mergeApproval, undefined, 'off never lands without his yes');
  r = pipe(brett, 'merge-decide', 'ready-one', 'merge'); assert.equal(r.status, 0, r.stdout); assert.ok(rec('ready-one').mergeApproval.at); assert.equal(Q.awaitsBrett(rec('ready-one')), false);
  r = pipe(env, 'merge-decide', 'clash-one', 'skip'); assert.equal(r.status, 0, r.stdout); assert.equal(rec('clash-one').status, 'archived');
  r = pipe(env, 'merge-decide', 'red-one', 'rebuild'); assert.equal(r.status, 0, r.stdout); assert.equal(rec('red-one').status, 'queued'); assert.ok(rec('red-one').steps.some((s) => s.id === 'rebuild-1' && !s.done));
  r = pipe(env, 'merge-dismiss', 'landed'); assert.equal(r.status, 0); assert.equal(json(pipe(env, 'merge-banner', '--queue-stdin')).counts.merged, 0);
  const before = json(pipe(env, 'merge-banner', '--queue-stdin')).unposted.length;
  pipe(env, 'merge-posted', ...json(pipe(env, 'merge-banner', '--queue-stdin')).unposted.map((u) => u.key));
  assert.equal(json(pipe(env, 'merge-banner', '--queue-stdin')).unposted.length, 0, `posted once (${before} before)`);
});
t('status rows carry the switch for the orchestrator tables', () => {
  const s = json(pipe(env, 'status'));
  const all = Object.values(s.tabs).flat();
  assert.equal(all.find((r) => r.id === 'new-one').autoMerge, true); assert.equal(all.find((r) => r.id === 'queued-one').autoMerge, false);
});

console.log(`auto-merge: ${n} checks passed`);
