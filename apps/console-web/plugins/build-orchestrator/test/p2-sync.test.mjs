#!/usr/bin/env node
/**
 * pipeline-status@1 in the Pipeline 2.0 flow, on a scratch store (no git, no tmux, a fake launcher, a fake Fable):
 * the split's provenance (`split`, `splitBy`, `modelBy`), build numbers and step uids in the read, `pipelineView` on
 * every read and never stored, one update command per store change, one splitter per build (no refused write after a
 * split), steps that never share files, the clash rejection with its two answers and deferred steps, and the draft PR
 * a build gets the moment it starts.
 *   node apps/console-web/plugins/build-orchestrator/test/p2-sync.test.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2sync-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/bin/bash
name=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
// the fake Fable: four steps, two of them tied by a shared folder through a third
const design = join(tmp, 'design.json');
writeFileSync(design, JSON.stringify({ steps: [
  { text: 'Contract module', model: 'Fable', minutes: 10, files: ['framework/core/thing.mjs'] },
  { text: 'Docs page', model: 'Opus', minutes: 5, files: ['docs/thing.md'] },
  { text: 'Contract tests', model: 'Opus', minutes: 10, files: ['framework/core/thing.test.mjs', 'framework/spec/thing/'] },
  { text: 'Spec fixture', model: 'Opus', minutes: 10, files: ['framework/spec/thing/fixture.json', 'framework/core/thing.mjs'] },
] }));
const fable = `cat >/dev/null; cat ${design}`;
const updates = join(tmp, 'updates.jsonl');
const prCmd = `if [ "$AXF_PR_ACTION" = ready ]; then echo "ready $AXF_PR_NUMBER" >> ${join(tmp, 'pr-calls')}; exit 0; fi; echo "$AXF_BUILD_ID $AXF_BUILD_BRANCH" >> ${join(tmp, 'pr-calls')}; echo '{"number": 4242, "url": "https://github.example/pull/4242"}'`;
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_SPLITTER: fable, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_P2_SLOTS: '4', AXF_P2_ALIVE: '', AXF_P2_UPDATES: updates, AXF_P2_DRAFT_PR_CMD: prCmd, AXF_P2_LANDER: 'off',
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 6, running: 0, usageLeft: 0.9 }, { name: 'b', usable: true, free: 6, running: 0, usageLeft: 0.8 }]),
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const BC = await import('../../../../../framework/core/build-clash.mjs');
await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const stored = (id) => JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')).builds.find((b) => b.id === id);
const sent = () => (existsSync(updates) ? readFileSync(updates, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sendPlan = (id, planning, extra = {}) => BS.withStore((s) => { s.builds.push(core.normBuild({ ...P2.transition({ id, title: `Plan ${id}`, source: 'plan-studio-2', planRef: `${id}-item`, flow: P2.FLOW, planning: planning.map((text) => ({ text })), steps: [], ...extra }, 'pending', { by: 'planner' }).rec })); return s; }, { by: 'planner' });
const sendSteps = (id, steps, extra = {}) => BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id, title: `Build ${id}`, flow: P2.FLOW, steps: steps.map((x, i) => P2.transition({ id: `s${i + 1}`, model: 'Opus', estimate: '5 min', ...x }, 'pending', { kind: 'step', by: 't' }).rec), ...extra }, 'pending', { by: 't' }).rec)); return s; }, { by: 't' });
/** One pass with every session that is out still alive (a pass ends the sessions it cannot find). */
const adv = (opts = {}) => { process.env.AXF_P2_ALIVE = BS.loadStore().builds.flatMap((b) => b.steps).filter((s) => s.status === 'building' && s.tmux).map((s) => s.tmux).join(','); return F.advance(opts); };
const land = (id, pr) => { const at = new Date().toISOString(); if (get(id).status !== 'merging-pr') BS.setFlowStatus(id, 'merging-pr', { by: 'lander' }); BS.setFlowStatus(id, 'landed', { by: 'lander', extra: { pr: String(pr), mergedAt: at, landed: { pr, sha: 'a'.repeat(40), mergedAt: at, ci: 'success', ciAt: at } } }); };
const noRefusal = (id) => !get(id).notes.some((x) => /refused a write/.test(x.text));

console.log('a plan is split by Fable on the VPS: provenance, numbers, uids, the view');
sendPlan('alpha', ['Build the thing']);
eq(get('alpha').number, 'B-0001', 'the store gave the build its number when it was added');
eq(get('alpha').pipelineView.state, 'pending', 'a read carries the view before the split');
let r = adv();
let A = get('alpha');
eq(A.split, { by: 'vps', model: A.split.model, at: A.split.at, stepCount: 2, host: hostname() }, 'split: by the VPS, when, how many steps');
ok(/fable/i.test(A.split.model), `split.model is the model that really ran (${A.split.model})`);
eq(A.steps.map((s) => s.splitBy), ['vps-fable', 'vps-fable'], 'every step says who split it');
eq(BC.stepOverlaps(A.steps), [], 'no two steps share a file: each merges cleanly alone');
ok(/Contract module/.test(A.steps[0].text) && /Contract tests/.test(A.steps[0].text) && /Spec fixture/.test(A.steps[0].text) && A.steps[1].text === 'Docs page', 'the three steps tied by shared files are one session; the docs step is its own');
ok(A.steps.every((s) => /^st-/.test(s.uid)) && new Set(A.steps.map((s) => s.uid)).size === 2, 'each step keeps a unique uid');
eq(A.steps.map((s) => s.modelBy), ['triage', 'triage'], 'modelBy: triage once the models are assigned');
eq(A.status, 'building', 'the build went on through the flow in the same pass');
ok(noRefusal('alpha'), 'no refused write after the split');
eq(A.splitClaim, null, 'the split claim is cleared with the split');
eq([A.pipelineView.state, A.pipelineView.label, A.pipelineView.split.by], ['building', 'Building', 'vps'], 'the read carries pipelineView with the split');
ok(/Building: 0 of 2 steps built/.test(A.pipelineView.line), `the line says what it is doing (${A.pipelineView.line})`);
ok(!('pipelineView' in stored('alpha')), 'pipelineView is worked out on read, never stored');
eq(stored('alpha').number, 'B-0001', 'the number is stored, once');
const sv = F.statusView().builds.find((b) => b.id === 'alpha');
eq([sv.number, sv.split.by, sv.pipelineView.state, sv.steps[0].uid === A.steps[0].uid, sv.steps[0].splitBy, sv.steps[0].modelBy], ['B-0001', 'vps', 'building', true, 'vps-fable', 'triage'], 'the status view exposes number, split, pipelineView and each step uid / splitBy / modelBy');

console.log('one update command per store change');
{ const u = sent().filter((x) => x.build === 'alpha');
  ok(u.length > 0 && u.every((x) => x.build && x.state && Number.isInteger(x.rev) && x.at), 'each command is { build, state, rev, at }');
  eq(new Set(u.map((x) => x.rev)).size, u.length, 'one command per change (no store revision is announced twice)');
  const states = [...new Set(u.filter((x) => !x.step).map((x) => x.state))];
  eq(states, ['splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building'], 'every build state the pass made was announced, in order');
  ok(u.some((x) => x.step === 's1'), 'step changes are announced too (the screens re-read the store)');
  const before = sent().length; adv(); eq(sent().length, before, 'a pass that changes nothing sends nothing'); }
eq(F.notifyUpdated({ id: 'alpha', status: 'building' }, 1, { env: { AXF_PIPELINE_CONSOLE: 'off' } }), null, 'with the console off no command is sent, and nothing fails');
ok(F.notifyUpdated({ id: 'zz', status: 'split' }, 7, { env: { AXF_PIPELINE_CONSOLE: 'no-such-container', PATH: '/nonexistent' } }) !== undefined, 'a console that is down never fails the pipeline');

console.log('the draft PR opens the moment the build starts');
eq([A.pr, A.prUrl, A.prDraft, A.branch], ['4242', 'https://github.example/pull/4242', true, 'lander/alpha'], 'pr number and link are on the build as soon as it started');
eq(readFileSync(join(tmp, 'pr-calls'), 'utf8').trim().split('\n'), ['alpha lander/alpha'], 'asked once, for the branch the lander lands it from');
ok(r.prs.some((x) => x.id === 'alpha' && x.pr === 4242), 'the pass reports it');
ok(A.notes.some((x) => /Draft PR #4242/.test(x.text)), 'a note says so'); // theme-ok: a PR number, not a colour

console.log('one splitter per build: a second pass never writes over the first');
// beta's plan touches other files than alpha (which is still building)
const design2 = join(tmp, 'design2.json');
writeFileSync(design2, JSON.stringify({ steps: [{ text: 'Other module', model: 'Opus', minutes: 10, files: ['framework/other/a.mjs'] }, { text: 'Other docs', model: 'Opus', minutes: 5, files: ['docs/other.md'] }] }));
process.env.AXF_PIPELINE_SPLITTER = `cat >/dev/null; cat ${design2}`;
sendPlan('beta', ['Another plan']);
// another pass (another process) took it a moment ago
BS.setFlowStatus('beta', 'splitting', { by: 'orchestrator', mutate: (rec) => { rec.splitClaim = { by: 'other-host:999', at: new Date().toISOString() }; } });
r = adv({ build: 'beta' });
eq([get('beta').status, get('beta').steps.length], ['splitting', 0], 'a build another pass is splitting is left alone');
ok(r.waits.some((w) => w.id === 'beta' && /another pass is splitting/.test(w.why)), 'and the pass says why');
// that pass died: its claim lapses and the next pass splits
BS.setFlowStatus('beta', 'splitting', { by: 'orchestrator', mutate: (rec) => { rec.splitClaim = { by: 'other-host:999', at: new Date(Date.now() - F.SPLIT_CLAIM_MS - 1000).toISOString() }; } });
adv({ build: 'beta' });
eq([get('beta').status, get('beta').steps.length, get('beta').number], ['split', 2, 'B-0002'], 'a lapsed claim is taken over and the build is split');
const uids = get('beta').steps.map((s) => s.uid);
// the late answer of the other pass: what used to be written over the steps and refused
let late = null; try { BS.setFlowStatus('beta', 'split', { by: 'orchestrator', mutate: (rec) => { rec.steps = rec.steps.map((s, i) => core.normStep({ ...s, uid: '' }, i)); } }); } catch (e) { late = e; }
ok(late && get('beta').notes.some((x) => /refused a write/.test(x.text)), 'the store still refuses a blind second split (the guard is unchanged)');
BS.withStore((s) => { const b = s.builds.find((x) => x.id === 'beta'); b.notes = b.notes.filter((x) => !/refused a write/.test(x.text)); return s; }, { by: 't' });
adv();
eq(get('beta').steps.map((s) => s.uid), uids, 'later passes leave the split as it is');
ok(noRefusal('beta'), 'and the pipeline itself never triggers that refusal again');
eq(get('beta').pipelineView.waitingOn?.buildId, 'alpha', 'beta waits at split: the view names the build that holds the active place');
ok(/Waiting: Plan alpha holds the active place/.test(get('beta').pipelineView.line), 'in plain words');

console.log('two passes at the same moment (two processes, a slow Fable): one splits, the other stands back');
{ sendPlan('race', ['A third plan']);
  const design3 = join(tmp, 'design3.json');
  writeFileSync(design3, JSON.stringify({ steps: [{ text: 'Race a', model: 'Opus', minutes: 5, files: ['race/a'] }, { text: 'Race b', model: 'Opus', minutes: 5, files: ['race/b'] }] }));
  const env = { ...process.env, AXF_PIPELINE_LOCKED: '1', AXF_PIPELINE_SPLITTER: `cat >/dev/null; sleep 2; cat ${design3}` };
  const run = () => new Promise((done) => { const c = spawn(process.execPath, [join(HERE, '..', 'pipeline2.mjs'), 'advance', '--build', 'race', '--json'], { env, stdio: 'ignore' }); c.on('exit', done); });
  await Promise.all([run(), run()]);
  const R = get('race');
  eq([R.status, R.steps.length, R.split?.stepCount], ['split', 2, 2], 'the build is split once');
  ok(noRefusal('race'), 'nothing was refused: no "step was replaced by another" note');
  const log = readFileSync(join(tmp, 'pipe', 'log.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"build":"race"')).map((l) => JSON.parse(l));
  eq([log.filter((l) => l.event === 'design').length, log.filter((l) => l.event === 'refused').length], [1, 0], 'Fable was asked once and the store refused nothing');
  BS.setFlowStatus('race', 'archived', { by: 't' }); }

console.log('intake: a build that clashes with one not on main yet is rejected, with answers');
// finish alpha and take it out of the line, then a hand build that is still building
for (const s of get('alpha').steps) F.stepExit('alpha', s.id, { exit: 0 });
eq(get('alpha').status, 'build-complete', 'alpha is built');
adv();
eq([get('alpha').prDraft, get('alpha').pr], [false, '4242'], 'built: its PR is taken out of draft so the lander can merge it');
ok(readFileSync(join(tmp, 'pr-calls'), 'utf8').includes('ready 4242'), 'the PR was marked ready once the build was built');
land('alpha', 4242);
BS.setFlowStatus('beta', 'archived', { by: 't' });
sendSteps('hand-x', [{ text: 'By hand', files: ['apps/ui/web/'] }], { hand: { at: new Date().toISOString(), by: 'brett' } });
BS.setFlowStatus('hand-x', 'building', { by: 'hand' });
sendSteps('gamma', [{ text: 'UI change', files: ['apps/ui/web/page.tsx'] }, { text: 'Server change', files: ['apps/server/x.py'] }]);
r = adv();
let G = get('gamma');
eq([G.status, G.clash?.rejected, G.steps.length], ['split', true, 2], 'the whole build is rejected: split, not started');
ok(/^Rejected: 1 step of 2 touches files that B-\d{4} \(Build hand-x\) has not landed yet \(apps\/ui\/web\/page\.tsx\)/.test(G.clash.reason), `with a plain reason (${G.clash.reason})`);
eq(G.clash.options.map((o) => o.id), ['run-all', 'defer'], 'and two answers');
eq(G.clash.options[1].steps.map((d) => [d.step, d.waitsFor.buildId]), [['s1', 'hand-x']], 'the defer answer names the step and the build it waits for');
ok(r.rejected.some((x) => x.id === 'gamma') && r.waits.some((w) => w.id === 'gamma' && /rejected for a clash/.test(w.why)), 'the pass reports the rejection');
eq([G.pipelineView.label, G.pipelineView.tone, G.pipelineView.clash.rejected], ['Rejected (clash)', 'danger', true], 'the view shows it as rejected');
ok(G.notes.some((x) => /Rejected: 1 step of 2/.test(x.text) && /run-all/.test(x.text)), 'a note carries the reason and the answers');
// a clean build behind it is not held up
sendSteps('delta', [{ text: 'Docs only', files: ['docs/d.md'] }]);
r = adv();
eq([get('delta').status, r.active], ['building', 'delta'], 'a clean build behind the rejected one starts');
let refused = null; try { F.actBuild('gamma', 'queue', { pass: () => ({}) }); } catch (e) { refused = e; }
ok(refused?.code === 2 && /answer it first/.test(refused.message), 'Queue on a rejected build says to answer the clash first');
refused = null; try { F.actBuild('delta', 'defer', { pass: () => ({}) }); } catch (e) { refused = e; }
ok(refused?.code === 2, 'an answer on a build with no clash is refused');
F.stepExit('delta', 's1', { exit: 0 }); land('delta', 11);

console.log('defer: the clean steps run now, the clashing step starts by itself when that build lands');
const ans = F.actBuild('gamma', 'defer', { by: 'brett', pass: (id) => adv({ build: id }) });
G = get('gamma');
eq([G.clash.rejected, G.clash.answer, G.clash.answeredBy], [false, 'defer', 'brett'], 'the answer is on the record');
eq(G.steps.map((s) => s.waitsFor?.buildId ?? ''), ['hand-x', ''], 'the clashing step carries the build it waits for');
ok(/1 step deferred/.test(ans.say), `the tap answers in words (${ans.say})`);
eq([G.status, G.steps.map((s) => s.status)], ['building', ['pending', 'building']], 'the clean step is building; the deferred one has not started');
ok(/1 step deferred, waiting for B-\d{4} to land/.test(G.pipelineView.line), `the view says what it waits for (${G.pipelineView.line})`);
F.stepExit('gamma', 's2', { exit: 0 });
r = adv();
eq([get('gamma').status, get('gamma').steps[0].status], ['building', 'pending'], 'with its clean step built the build still waits for the deferred one');
ok(r.waits.some((w) => w.id === 'gamma' && w.step === 's1' && /deferred: it starts by itself when/.test(w.why)), 'and says so');
// the hand build lands
BS.setFlowStatus('hand-x', 'build-complete', { by: 'hand' });
land('hand-x', 12);
r = adv();
G = get('gamma');
eq(G.steps[0].status, 'building', 'the deferred step started by itself once that build landed');
ok(existsSync(G.steps[0].worktree), 'in a worktree cut after the landing (main has that build)');
F.stepExit('gamma', 's1', { exit: 0 });
eq(get('gamma').status, 'build-complete', 'and the build completes');
land('gamma', 13);

console.log('run-all: every step runs now; a build whose every step is deferred waits without holding the place');
sendSteps('hand-y', [{ text: 'By hand', files: ['framework/z/'] }], { hand: { at: new Date().toISOString(), by: 'brett' } });
BS.setFlowStatus('hand-y', 'building', { by: 'hand' });
sendSteps('eps', [{ text: 'Touches z', files: ['framework/z/a.mjs'] }]);
sendSteps('zeta', [{ text: 'Touches z too', files: ['framework/z/b.mjs'] }]);
adv();
eq([get('eps').clash?.rejected, get('zeta').clash?.rejected], [true, true], 'both are rejected');
F.actBuild('zeta', 'defer', { by: 'brett', pass: (id) => adv({ build: id }) });
eq(get('zeta').status, 'split', 'every step deferred: the build waits at split, it does not take the active place');
F.actBuild('eps', 'run-all', { by: 'brett', pass: (id) => adv({ build: id }) });
eq([get('eps').clash.answer, get('eps').status, get('eps').steps[0].waitsFor ?? null], ['run-all', 'building', null], 'run-all: it starts with every step');
F.stepExit('eps', 's1', { exit: 0 }); land('eps', 14);
r = adv();
ok(get('zeta').status === 'split' && r.waits.some((w) => w.id === 'zeta' && /every step is deferred/.test(w.why)), 'the deferred build still waits, and says for what');
BS.setFlowStatus('hand-y', 'build-complete', { by: 'hand' }); land('hand-y', 15);
adv();
eq(get('zeta').status, 'building', 'it starts by itself when that build lands');

console.log('the merge line, read from the one store');
sendSteps('m1', [{ text: 'a', files: ['m/1'] }], { hand: { at: '2026-11-24T00:00:00.000Z', by: 'brett' } });
sendSteps('m2', [{ text: 'b', files: ['m/2'] }], { hand: { at: '2026-11-24T00:00:01.000Z', by: 'brett' } });
for (const id of ['m1', 'm2']) { BS.setFlowStatus(id, 'building', { by: 'hand' }); BS.setFlowStatus(id, 'build-complete', { by: 'hand' }); }
eq([get('m1').pipelineView.state, get('m1').pipelineView.mergeLine.position], ['build-complete', 1], 'first in the line: the lander takes it next');
const M2 = get('m2').pipelineView;
eq([M2.state, M2.mergeLine.position, M2.mergeLine.waitingFor.buildId, M2.mergeLine.waitingFor.number], ['waiting-to-merge', 2, 'm1', get('m1').number], 'second: waiting to merge, with its place and the build it waits for');
ok(new Set(BS.loadStore().builds.map((b) => b.number)).size === BS.loadStore().builds.length, 'every build has its own number');
ok(BS.loadStore().builds.every((b) => !('pipelineView' in (stored(b.id) ?? {}))), 'no view was ever stored');

console.log(failed ? `p2-sync: ${failed} of ${n} FAILED` : `ok p2-sync: ${n}/${n}`);
process.exit(failed ? 1 : 0);
