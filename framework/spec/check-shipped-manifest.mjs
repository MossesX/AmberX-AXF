#!/usr/bin/env node
/**
 * shipped-manifest@1 conformance: the manifest the orchestrator sends Shipped features when a build lands.
 *   node framework/spec/check-shipped-manifest.mjs           check
 *   node framework/spec/check-shipped-manifest.mjs --write   regenerate fixtures/shipped-manifest.json's expected outputs
 *
 * 1. pure: normalising, validation (field-named), estimates, areas, manifestFromBuild, toLedger, summaries (fixture)
 * 2. IO (framework/cli/shipped.mjs): landing detection in a scratch git repo (fast-forward land, PR merge, main merged
 *    into the branch first), report parsing, ship → sidecar + store ref + build-hook@1 `shipped` event, a build the
 *    store never had created from its manifest, backfill finding landed builds with no manifest, adoptStore firing hooks
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as SM from '../core/shipped-manifest.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/shipped-manifest.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ta = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = '2026-11-09T01:00:00Z';

const build = {
  id: 'urgent-amberx-veto', title: 'URGENT: AmberX veto notice alarm too loud', profiles: ['all'], status: 'complete', pr: '#397', branch: 'claude/urgent-amberx-veto', mergedAt: '2026-11-09T00:06:38Z',
  origin: { said: 'The approve and deny dialogue is still saying open, and I received the alarm.', verbatim: true, at: '2026-11-08T22:20:00Z', source: 'voice', addenda: [{ said: 'And no repeat at 30 seconds.', at: '2026-11-08T22:25:00Z' }] },
  pipeline: { launchedAt: '2026-11-08T22:27:50Z', account: 'account-3' },
  steps: [
    { id: 's1', text: 'One normal notice per hold', model: 'Opus', estimate: '30 min', done: true, doneAt: '2026-11-08T22:40:10Z' },
    { id: 's2', text: 'Approve / Deny act directly', model: 'fable', estimate: '1.5 h', done: true, doneAt: '2026-11-08T23:10:10Z' },
    { id: 's3', text: 'Android channel for the APK', model: 'Opus', estimate: '20m', done: false },
    { id: 's4', text: 'skipped', skip: true },
  ],
};
const found = {
  landedCommit: '661901740ba21f9767d70f7cf3c101c2e2c35a27', landedAt: '2026-11-09T00:06:35Z', commits: ['864ab0549c64cf17f6a64d6d757b4885b5262909', '44862718a364abc2a8b0e43cf83464c4f517de10'],
  files: ['apps/console-web/plugins/approvals-banner/web/index.tsx', 'apps/console-web/plugins/approvals-banner/test.mts', 'apps/amberx-droid/android/app/src/main/java/ai/amberx/droid/VetoAlarm.java', 'framework/python/axf_server/relay.py', '_claude/builds/reports/urgent-amberx-veto.md'],
  runs: [{ session: 'axf-urgent-amberx-veto--lenny', account: 'account-3', model: 'opus', startedAt: '2026-11-08T22:27:50Z', endedAt: '2026-11-08T23:12:00Z', exit: 0, costUsd: 5.0549 }],
  tests: [{ name: 'approvals-banner/test.mts: 18 checks', result: 'pass' }, { name: 'amberx-droid test.mjs', command: 'node apps/amberx-droid/test.mjs', result: 'fail', detail: '1 failing' }],
  uiReview: [{ id: 'r-1', name: 'Veto notice settings', status: 'waiting', group: 'urgent-amberx-veto - Nov 8 10:41 PM' }],
  cost: { usd: 5.0549, tokens: { input: 176, output: 1202, cacheRead: 12464140, cacheWrite: 195524 } }, report: '_claude/builds/reports/urgent-amberx-veto.md', brief: '# Build: urgent-amberx-veto\n…', open: ['The Android channel change needs a new APK'],
};
const IN = {
  estimates: ['30 min', '~20m', '1.5 h', '2h', '1 h 30 min', 45, '', 'soon', '10'],
  areas: ['apps/console-web/plugins/example-grid/web/ui.tsx', 'apps/console-web/src/App.tsx', 'apps/axhub-web/src/plugins/approvals/x.ts', 'framework/core/shipped-manifest.mjs', 'deploy/claude-headless.sh', '_claude/builds/store.json', 'docs/x.md', 'README.md', 'package.json'],
  build, found,
  noOrigin: { id: 'direct-launch', title: 'Direct launch', detail: 'Make the thing work.', status: 'complete', mergedAt: '2026-11-08T12:00:00Z', steps: [] },
  bad: [{}, { build: { id: 'x' } }, { build: { id: 'x' }, said: 'words' }, { $axf: 'nope', build: { id: 'x' }, said: { text: 'w', verbatim: 'yes' }, landedCommit: 'zz', models: ['Sonnet'], tests: [{ result: 'great' }], shippedAt: 'yesterday' }],
};
const run = () => {
  const m = SM.manifestFromBuild(IN.build, IN.found, { now: NOW, source: 'orchestrator', by: 'orchestrator' });
  const again = SM.manifestFromBuild(IN.build, IN.found, { now: NOW, source: 'orchestrator', prev: m });
  const direct = SM.manifestFromBuild(IN.noOrigin, { landedCommit: 'abcdef1234' }, { now: NOW, source: 'backfill' });
  return {
    estimates: IN.estimates.map(SM.estimateMinutes), areas: SM.areasOf(IN.areas).map((a) => `${a.kind}:${a.id}:${a.files.length}`),
    manifest: m, rev2: { id: again.id, rev: again.rev }, direct: { said: direct.said, open: direct.open, valid: SM.validateManifest(direct).ok },
    valid: SM.validateManifest(m), bad: IN.bad.map((b) => SM.validateManifest(b).errors.map((e) => e.field)),
    ledger: (({ manifest, ...rest }) => rest)(SM.toLedger(m)), summary: SM.summaryOf(m), ref: SM.refOf(m), normIdempotent: same(SM.normManifest(m), m),
  };
};
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: SM.SCHEMA, note: 'Generated by framework/spec/check-shipped-manifest.mjs --write; every port replays `in` and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ 1. the contract
const m = actual.manifest;
t('his words come first and stay verbatim; addenda follow in order', () => { assert.equal(m.said.text, build.origin.said); assert.equal(m.said.verbatim, true); assert.deepEqual(m.said.addenda.map((a) => a.text), ['And no repeat at 30 seconds.']); });
t('no prompt on the build: the detail stands in, marked not verbatim', () => { assert.equal(actual.direct.said.text, 'Make the thing work.'); assert.equal(actual.direct.said.verbatim, false); assert.equal(actual.direct.valid, true); });
t('steps: estimates in minutes, actual time from the previous done step (the first from the launch), skipped steps out, undone ones open', () => {
  assert.deepEqual(m.steps.map((s) => [s.id, s.estimateMin, s.actualMin, s.done]), [['s1', 30, 12, true], ['s2', 90, 30, true], ['s3', 20, 0, false]]);
  assert.equal(m.steps[1].model, 'Fable'); assert.ok(m.open[0].startsWith('s3: '));
  assert.deepEqual(actual.estimates, [30, 20, 90, 120, 90, 45, 0, 0, 10]);
});
t('models from the steps that ran and the sessions; accounts from the runs', () => { assert.deepEqual(m.models, ['Opus', 'Fable']); assert.deepEqual(m.accounts, ['account-3']); });
t('areas group files by plugin (console and axHub homes) / app / framework / deploy / builds / docs, biggest first', () => assert.deepEqual(actual.areas, ['docs:docs:2', 'plugin:approvals:1', 'plugin:example-grid:1', 'app:console-web:1', 'framework:core:1', 'deploy:deploy:1', 'builds:builds:1', 'other:package.json:1']));
t('a valid manifest validates; a bad one names each field', () => {
  assert.ok(actual.valid.ok, SM.rejection(actual.valid.errors));
  assert.deepEqual(actual.bad[0], ['build.id', 'said.text', 'landedCommit']); assert.deepEqual(actual.bad[1], ['said.text', 'landedCommit']); assert.deepEqual(actual.bad[2], ['landedCommit']);
  for (const f of ['$axf', 'said.verbatim', 'landedCommit', 'shippedAt', 'models', 'tests']) assert.ok(actual.bad[3].includes(f), f);
});
t('a second manifest of the same build keeps the id and bumps the rev', () => assert.deepEqual(actual.rev2, { id: 'sm-urgent-amberx-veto', rev: 2 }));
t('normalising is idempotent; the store ref is small', () => { assert.ok(actual.normIdempotent); assert.deepEqual(actual.ref, { id: 'sm-urgent-amberx-veto', rev: 1, at: NOW, landedCommit: found.landedCommit }); });
t('to the ledger: build, PR, prompts (origin + addenda), merged fields, an edit and a fallback feature', () => {
  const l = actual.ledger;
  assert.equal(l.build.mergedAt, build.mergedAt); assert.equal(l.build.pr, 397); assert.equal(l.build.model, 'Fable'); assert.equal(l.pr.mergeCommit, found.landedCommit);
  assert.deepEqual(l.prompts.map((p) => [p.index, p.kind, p.verbatim]), [[0, 'origin', true], [1, 'addendum', true]]);
  assert.equal(l.featureFields.mergeCommit, found.landedCommit); assert.equal(l.feature.status, 'merged'); assert.equal(l.feature.type, 'fix'); assert.equal(l.edit.status, 'merged');
  assert.deepEqual(l.feature.builds, [{ id: 'urgent-amberx-veto', profile: 'all', role: 'added' }]);
});
t('the summary counts what a list or voice answer needs', () => { const s = actual.summary; assert.deepEqual(s.steps, { done: 2, total: 3, estimateMin: 140, actualMin: 42 }); assert.deepEqual(s.tests, { pass: 1, fail: 1, total: 2 }); assert.equal(s.open, 2); });
t('search text holds the prompt, PR, commit and files', () => { const q = SM.searchText(m); for (const x of ['still saying open', '#397', '661901740', 'vetoalarm.java']) assert.ok(q.includes(x), x); });
t('schemas/shipped-manifest.json + schemas/json/shipped-manifest.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/shipped-manifest.json')), SM.REGISTRY)); for (const [name, s] of Object.entries(SM.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });
t('PORTING.md lists the contract', () => assert.match(rd('framework/spec/PORTING.md'), /shipped-manifest@1/));

// ------------------------------------------------------------------ 2. the IO side
const tmp = mkdtempSync(join(tmpdir(), 'axf-shipped-'));
const repo = join(tmp, 'repo'); mkdirSync(repo);
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
const commit = (file, msg) => { writeFileSync(join(repo, file), `${msg}\n`); g('add', file); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
g('init', '-q', '-b', 'main'); commit('base.txt', 'base');
// A: a PR merge (merge commit with the branch head as its second parent)
g('checkout', '-q', '-b', 'claude/a'); const a1 = commit('a1.txt', 'a1'); const a2 = commit('a2.txt', 'a2');
g('checkout', '-q', 'main'); commit('m1.txt', 'm1'); g('merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from claude/a', 'claude/a'); const landA = g('rev-parse', 'HEAD');
// B: main merged into the branch first, then main fast-forwarded to it (build_land)
g('checkout', '-q', '-b', 'claude/b'); const b1 = commit('b1.txt', 'b1');
g('checkout', '-q', 'main'); commit('m2.txt', 'm2');
g('checkout', '-q', 'claude/b'); g('merge', '-q', '--no-ff', '-m', 'Merge origin/main into claude/b (build_land)', 'main'); const headB = g('rev-parse', 'HEAD');
g('checkout', '-q', 'main'); g('merge', '-q', '--ff-only', 'claude/b');
// C: a branch never landed
g('checkout', '-q', '-b', 'claude/c', 'main~1'); commit('c1.txt', 'c1'); g('checkout', '-q', 'main');
// D: main merged into the branch, and the branch merged into main by a merge whose FIRST parent is the branch head
g('checkout', '-q', '-b', 'claude/d'); const d1 = commit('d1.txt', 'd1'); g('checkout', '-q', 'main'); commit('m3.txt', 'm3');
g('checkout', '-q', 'claude/d'); g('merge', '-q', '--no-ff', '-m', 'Merge main into claude/d (build_land)', 'main'); const landD = g('rev-parse', 'HEAD'); g('checkout', '-q', 'main'); g('merge', '-q', '--ff-only', 'claude/d');
commit('after.txt', 'Builds live: status [skip ci]');

const store = join(tmp, 'store.json');
Object.assign(process.env, { AXF_SHIPPED_GIT_DIR: repo, AXF_BUILDS_STORE: store, AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'on', AXF_BUILD_HOOKS_DIR: join(tmp, 'hooks'), AXF_HEADLESS_DIR: join(tmp, 'headless'), AXF_SHIPPED_UI_REVIEW: 'off', AXF_PIPELINE_WORKTREES: join(tmp, 'wt'), AXF_BUILD_HOOKS_SYNC: '' });
mkdirSync(join(tmp, 'headless'));
writeFileSync(join(tmp, 'headless', 'events.jsonl'), [
  { event: 'session-start', session: 'axf-a--x', name: 'a', model: 'claude-opus-5-5', at: '2026-11-09T00:00:00Z' }, { event: 'session-login', session: 'axf-a--x', name: 'a', account: 'account-3', at: '2026-11-09T00:00:01Z' },
  { event: 'session-end', session: 'axf-a--x', name: 'a', exit: 0, account: 'account-3', costUsd: 2.5, at: '2026-11-09T00:20:00Z' }, { event: 'session-start', session: 'axf-other', name: 'other', at: '2026-11-09T00:00:00Z' },
].map((e) => JSON.stringify(e)).join('\n'));
writeFileSync(join(tmp, 'headless', 'axf-a--x.meter.json'), JSON.stringify({ tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, costUsd: 2.5 }));
const S = await import('../cli/shipped.mjs');
const BS = await import('../cli/builds-store.mjs');
const H = await import('../cli/build-hooks.mjs');

t('landing: a PR merge, a fast-forward after main was merged in, a first-parent merge, and a branch that never landed', () => {
  assert.equal(S.landedCommitOf(a2), landA); assert.equal(S.landedCommitOf(headB), headB); assert.equal(S.landedCommitOf(landD), landD);
  assert.equal(S.landedCommitOf(S.branchHead('claude/c')), ''); assert.equal(S.branchHead('claude/nope'), '');
});
t("the branch's own commits and files, never main's", () => {
  assert.deepEqual(S.branchWork(a2, landA), { commits: [a2, a1], files: ['a1.txt', 'a2.txt'] });
  assert.deepEqual(S.branchWork(headB, headB), { commits: [b1], files: ['b1.txt'] });
  assert.deepEqual(S.branchWork(landD, landD), { commits: [d1], files: ['d1.txt'] });
});
t('runs: account, model, times and cost from session events; tokens from the meter', () => {
  const r = S.runsOf(['a']); assert.equal(r.runs.length, 1); assert.equal(r.runs[0].account, 'account-3'); assert.equal(r.runs[0].endedAt, '2026-11-09T00:20:00Z');
  assert.deepEqual(r.cost, { usd: 2.5, estimated: false, tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 } });
});
t('report: tests (results read from the wording) and open items, wrapped bullets joined', () => {
  const r = S.parseReport('# Report\n\n## Tests\n- `node a/test.mjs`: 27 → 35\n- check-theme fails on main\n  (unrelated)\n- e2e not run\n\n## Still open\n- The APK needs\n  a rebuild.\n- Kotlin twin deferred\n\n## Other\n- not open\n');
  assert.deepEqual(r.tests.map((x) => [x.result, x.command]), [['pass', 'node a/test.mjs'], ['fail', ''], ['skip', '']]);
  assert.deepEqual(r.open, ['The APK needs a rebuild.', 'Kotlin twin deferred']);
});
await ta('ship: sidecar written, ref on the build, build-hook@1 fires `shipped`; a second ship is rev 2', async () => {
  BS.withStore((s) => { s.builds.push({ id: 'a', title: 'Build A', status: 'complete', branch: 'claude/a', pr: '#1', mergedAt: '2026-11-09T00:30:00Z', origin: { said: 'Make A.', verbatim: true }, steps: [{ id: 's1', text: 'A', model: 'Opus', estimate: '30 min', done: true, doneAt: '2026-11-09T00:15:00Z' }], profiles: ['all'] }); return s; }, { by: 'test' });
  const r = S.ship('a', { now: NOW });
  assert.equal(r.manifest.landedCommit, landA); assert.deepEqual(r.manifest.files, ['a1.txt', 'a2.txt']); assert.equal(r.manifest.cost.usd, 2.5); assert.equal(r.manifest.steps[0].actualMin, 15);
  const f = await import('../cli/shipped-files.mjs'); assert.equal(f.readManifest('a').id, 'sm-a'); assert.ok(existsSync(f.manifestFile('a')));
  const b = BS.loadStore().builds.find((x) => x.id === 'a'); assert.deepEqual(b.shipped, { id: 'sm-a', rev: 1, at: NOW, landedCommit: landA });
  const ev = H.readOutbox().filter((e) => e.event === 'shipped'); assert.equal(ev.length, 1); assert.deepEqual(ev[0].shipped, b.shipped);
  assert.equal(S.ship('a', { now: '2026-11-09T02:00:00Z' }).manifest.rev, 2); assert.equal(H.readOutbox().filter((e) => e.event === 'shipped').length, 2);
});
t('ship: fields given by the API win; a bad manifest is refused with the field', () => {
  const r = S.ship('a', { manifest: { said: { text: 'Make A, exactly.', verbatim: true }, tests: [{ name: 'x', result: 'pass' }] }, source: 'api', now: NOW });
  assert.equal(r.manifest.said.text, 'Make A, exactly.'); assert.equal(r.manifest.tests.length, 1); assert.equal(r.manifest.source, 'api'); assert.equal(r.manifest.landedCommit, landA, 'gathered fields stay');
  assert.throws(() => S.ship('a', { manifest: { landedCommit: 'not-a-sha!', said: { text: 'x', verbatim: 'yes' } } }), /said\.verbatim/);
});
t('backfill: finds landed builds with no manifest (store, an unfinished build whose branch is on main, a build_land merge the store never had); dry writes nothing', () => {
  BS.withStore((s) => { s.builds.push({ id: 'b', title: 'Build B', status: 'running', branch: 'claude/b', origin: { said: 'Make B.', verbatim: true }, steps: [{ id: 's1', text: 'B', done: true, doneAt: '2026-11-09T00:10:00Z' }, { id: 's2', text: 'report', done: false }], profiles: ['all'] }); s.builds.push({ id: 'c', title: 'Build C', status: 'running', branch: 'claude/c', profiles: ['all'] }); return s; }, { by: 'test' });
  const dry = S.backfill({ from: '2000-01-01', dry: true });
  const ids = dry.shipped.map((x) => x.id).sort(); assert.deepEqual(ids, ['b', 'd'], JSON.stringify(dry.shipped)); assert.ok(dry.shipped.every((x) => x.ok));
  const f = S.findUnshipped({ from: '2000-01-01' }); assert.ok(f.find((x) => x.id === 'd').fromGit);
  const r = S.backfill({ from: '2000-01-01' });
  assert.ok(r.shipped.every((x) => x.ok), JSON.stringify(r.shipped));
  const st = BS.loadStore(); const b = st.builds.find((x) => x.id === 'b'); const d = st.builds.find((x) => x.id === 'd');
  assert.equal(b.status, 'running', 'a build with open steps keeps its status'); assert.equal(b.mergedAt, undefined); assert.equal(b.shipped.id, 'sm-b');
  const fb = r.shipped.find((x) => x.id === 'b'); assert.equal(fb.manifest.open, 1, 'the open step is in the manifest'); assert.equal(fb.manifest.landedCommit, headB);
  assert.ok(d, 'a build the store never had is created from its manifest'); assert.equal(d.source, 'shipped'); assert.equal(d.shipped.landedCommit, landD);
  assert.equal(S.backfill({ from: '2000-01-01' }).found, 0, 'nothing left');
  assert.throws(() => S.findUnshipped({ from: 'soon' }), /--since/);
});
t('a build with every step done that landed with no merge time (build_land fast-forward) gets it and is complete', () => {
  BS.withStore((s) => { s.builds.push({ id: 'g', title: 'Build G', status: 'pending', branch: 'claude/b', origin: { said: 'Make G.', verbatim: true }, steps: [{ id: 's1', text: 'G', done: true, doneAt: '2026-11-09T00:10:00Z' }], profiles: ['all'] }); return s; }, { by: 'test' });
  const r = S.ship('g', { now: NOW }); const g = BS.loadStore().builds.find((x) => x.id === 'g');
  assert.equal(g.status, 'complete'); assert.equal(g.mergedAt, r.manifest.landedAt); assert.ok(g.mergedAt);
});
t('the tick ships newly landed builds a few at a time, and none when AXF_SHIPPED=off', () => {
  BS.withStore((s) => { s.builds.push({ id: 'e', title: 'Build E', status: 'complete', branch: 'claude/a', mergedAt: new Date().toISOString(), origin: { said: 'Make E.', verbatim: true }, profiles: ['all'] }); return s; }, { by: 'test' });
  assert.deepEqual(S.shipLanded({ env: { ...process.env, AXF_SHIPPED: 'off' } }), { off: true, shipped: [] });
  assert.deepEqual(S.shipLanded().shipped.map((x) => x.id), ['e']); assert.deepEqual(S.shipLanded().shipped, []);
});
t('adoptStore: builds changed in another checkout fire their events here', () => {
  const before = H.readOutbox().length;
  const now = BS.readStoreNow(); const next = JSON.parse(JSON.stringify(now));
  const c = next.builds.find((x) => x.id === 'c'); c.rev += 1; c.pr = '#9';
  assert.equal(BS.adoptedChanges(now, next).length, 1);
  BS.adoptStore(next);
  const added = H.readOutbox().slice(before); assert.deepEqual(added.map((e) => e.event), ['pr-opened']); assert.equal(added[0].by, 'builds-live');
});
console.log(`check-shipped-manifest: ${n} checks passed`);
