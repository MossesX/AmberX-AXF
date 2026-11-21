#!/usr/bin/env node
/**
 * Pipeline 2.0 status contract end to end (the deep audit's part A), on a scratch store with a fake launcher:
 *   P1-02  a build that failed while it waited its turn starts again like any waiting build; one that used up its
 *          attempts stays put until Brett's retry (`orchestrator.mjs retry`), which resets the attempt counts
 *   P1-05  a step with no status never blocks a build (it gets pending, main, a slot); skipped steps never block it;
 *          steps are not added to, or removed from, a build that is being built
 *   P1-09  no store op derives a builds@1 status on a Pipeline 2.0 build: zero refusals
 *   B4-04  a refused write keeps nothing for that build, and the caller is told
 *   P1-14  one dispatcher and one watchdog for Pipeline 2.0: the builds@1 planner and watchdogs leave its builds alone
 *   node apps/console-web/plugins/build-orchestrator/test/p2-status-contract.test.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2contract-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/bin/bash
name=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "$name" >> "${tmp}/launches"
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
const IDS = ['holder', 'dead', 'gone', 'fresh', 'bare', 'ops', 'wait'];
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off', AXF_BUILD_LOCK_PIDS: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_WATCHDOG2_DIR: join(tmp, 'wd2'), AXF_BUILD_PROFILE: 'all',
  // every fake session stays alive: a step ends only by its explicit stepExit
  AXF_P2_SLOTS: '8', AXF_P2_ALIVE: IDS.flatMap((id) => [1, 2, 3, 4].map((i) => `axf-${id}--s${i}`)).join(','),
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 8, running: 0, usageLeft: 1 }, { name: 'b', usable: true, free: 8, running: 0, usageLeft: 0.8 }]),
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const PL = await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');
const O = await import('../orchestrator.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const T = (h) => `2026-11-20T${String(h).padStart(2, '0')}:00:00.000Z`;
const step = (i, status, extra = {}) => ({ id: `s${i}`, text: `Part ${i}`, model: 'Opus', estimate: '5 min', files: [`apps/p${i}`], status, statusAt: T(1), ...extra });
/** A build as the store would hold it at this point of its life (a new record: nothing to compare it with). */
const put = (id, fields, steps) => BS.withStore((s) => { s.builds.push(core.normBuild({ id, title: id, flow: P2.FLOW, statusAt: T(1), statusLog: [{ status: fields.status, at: T(1), by: 'test' }], ...fields, steps })); return s; }, { by: 'test' });
const archive = (id) => BS.setFlowStatus(id, 'archived', { by: 'test' });
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

console.log('P1-02: a build that failed while it waited starts again; a given-up one waits for Brett\'s retry');
put('holder', { status: 'failed', failedFrom: 'running-ci', attempt: 3, createdAt: T(0) }, [step(1, 'completed')]);
put('gone', { status: 'failed', failedFrom: 'split', attempt: 5, createdAt: T(1) }, [step(1, 'pending')]);
put('dead', { status: 'failed', failedFrom: 'split', attempt: 2, createdAt: T(2) }, [step(1, 'pending'), step(2, 'pending')]);
put('fresh', { status: 'split', attempt: 1, createdAt: T(3) }, [step(1, 'pending')]);
let r = F.advance();
eq([r.active, get('dead').status, get('gone').status, get('fresh').status], ['holder', 'failed', 'failed', 'split'], 'while a failed build holds the active place nobody else starts');
eq(r.waits.filter((w) => /waiting for holder to land/.test(w.why)).map((w) => w.id).sort(), ['dead', 'fresh'], 'the build that failed while waiting is in the line again, next to the one still at split');
ok(F.waitsTurn(get('dead')) && !F.waitsTurn(get('gone')), 'attempts left = it waits its turn; attempts used up = it does not');
archive('holder');
r = F.advance();
eq([r.active, get('dead').status, get('dead').attempt, get('dead').failedFrom], ['dead', 'building', 3, undefined], 'the place is free: the build that failed at split is activated (the oldest with attempts left) and builds, as attempt 3');
ok(get('dead').statusLog.some((l) => l.status === 'pulling-main' && /failed while it waited/.test(l.why ?? '')), 'its log says it failed while it waited and is starting now');
eq(get('dead').steps.map((s) => s.status), ['building', 'building'], 'its steps got main and went out');
eq([get('gone').status, get('gone').attempt], ['failed', 5], 'the one at attempt 5 of 5 is never started by a pass');
ok(throws(() => BS.setFlowStatus('gone', 'pulling-main', { by: 'orchestrator' }))?.code === 'backward', 'the contract itself refuses to move it (B4-05)');
const retried = PL.retryBuild('gone', { by: 'Brett', why: 'back in the line' });
eq([retried.status, get('gone').status, get('gone').attempt, get('gone').failedFrom], ['split', 'split', 1, undefined], 'orchestrator.mjs retry on a Pipeline 2.0 build: back to split, attempt 1');
eq([get('gone').statusLog.at(-1).reset, get('gone').statusLog.at(-1).why, /Retry by Brett: back in the line\. The attempt counts start again/.test(get('gone').notes.at(-1).text)], [true, 'Retry by Brett: back in the line', true], 'the reset, who and why are in the log and the notes');
ok(/nothing to retry/.test(throws(() => F.retryBuild('fresh'))?.message ?? ''), 'a retry of a build that has not failed is an error, not a silent reset');
F.stepExit('dead', 's1', { exit: 0 }); F.stepExit('dead', 's2', { exit: 0 });
eq(get('dead').status, 'build-complete', 'every step completed = build complete');
archive('dead');
r = F.advance();
eq([r.active, get('gone').status, get('fresh').status], ['gone', 'building', 'split'], 'after the retry it takes its turn (it is the oldest), ahead of the newer build');
// a step that gave up inside the build: the retry resets it and it goes out again
F.stepExit('gone', 's1', { exit: 1 });
BS.withStore((s) => { const b = s.builds.find((x) => x.id === 'gone'); Object.assign(b.steps[0], { attempt: 5, tried: ['a', 'b'] }); return s; }, { by: 'test' });
r = F.advance();
ok(get('gone').steps[0].status === 'failed' && r.waits.some((w) => w.id === 'gone' && w.step === 's1' && /gave up after attempt 5 of 5/.test(w.why)), 'a step at attempt 5 of 5 is left failed');
const rs = F.retryBuild('gone', { by: 'Brett' });
eq([rs.steps, get('gone').steps[0].status, get('gone').steps[0].attempt, get('gone').steps[0].tried], [[{ id: 's1', status: 'ready' }], 'ready', 1, undefined], 'the retry puts the step back at ready, attempt 1, every account open again');
F.advance();
eq(get('gone').steps[0].status, 'building', 'and the next pass sends it');
F.stepExit('gone', 's1', { exit: 0 }); archive('gone'); archive('fresh');

console.log('P1-05: steps with no status, skipped steps, step edits past the split');
put('bare', { status: 'building', attempt: 1, createdAt: T(4) }, [step(1, 'completed', { done: true }), step(2, 'ready'), step(3, 'pending', { skip: true })]);
{ // an older writer left s2 without a status: written straight into the file, as the store held such builds
  const f = process.env.AXF_BUILDS_STORE; const j = JSON.parse(readFileSync(f, 'utf8'));
  const s2 = j.builds.find((b) => b.id === 'bare').steps[1]; for (const k of ['status', 'statusAt', 'statusBy', 'statusLog', 'attempt']) delete s2[k];
  writeFileSync(f, JSON.stringify(j));
  eq(get('bare').steps[1].status, undefined, 'the store holds a step with no status');
}
r = F.advance();
eq([r.active, get('bare').steps[1].status, r.pulled.some((p) => p.id === 'bare' && p.step === 's2')], ['bare', 'building', true], 'the step with no status counts as pending: it gets main and goes out, instead of blocking the build');
eq(get('bare').steps[1].statusLog.map((l) => l.status), ['pulling-main', 'ready', 'sending', 'building'], 'through the flow, step by step');
ok(existsSync(join(wt, 'bare--s2')) && !existsSync(join(wt, 'bare--s3')), 'its worktree was cut; the skipped step got none');
F.stepExit('bare', 's2', { exit: 0 });
eq([get('bare').status, get('bare').steps[2].status], ['build-complete', 'pending'], 'every step completed = build complete: the skipped step (still pending) does not block it');
archive('bare');

put('ops', { status: 'building', attempt: 1, createdAt: T(5) }, [step(1, 'completed', { done: true }), step(2, 'building'), step(3, 'ready')]);
put('wait', { status: 'split', attempt: 1, createdAt: T(6) }, [step(1, 'pending')]);
const before = JSON.stringify(get('ops').steps.map((s) => [s.uid, s.status]));
const addErr = throws(() => O.act({ action: 'add-step', id: 'ops', stepData: { text: 'One more thing', model: 'Opus', estimate: '5 min' } }));
ok(addErr?.code === 'refused' && /no step is added to a build that is being built/.test(addErr.message), 'add step on a build that is being built: refused with a clear message');
const rmErr = throws(() => O.act({ action: 'remove-step', id: 'ops', step: 's3' }));
ok(rmErr?.code === 'refused' && /its steps are fixed/.test(rmErr.message), 'remove step: refused with a clear message');
eq(JSON.stringify(get('ops').steps.map((s) => [s.uid, s.status])), before, 'the build\'s steps and their statuses are untouched');
ok(/Store: refused a write by/.test(get('ops').notes.at(-1)?.text ?? ''), 'the refused write shows in the build\'s notes (B4-04)');
O.act({ action: 'add-step', id: 'wait', stepData: { text: 'A late addition', model: 'Opus', estimate: '5 min' } });
eq(get('wait').steps.map((s) => s.status), ['pending', 'pending'], 'a build still waiting at split takes a new step, and it enters at pending (never blank)');

console.log('P1-09: store ops on a building Pipeline 2.0 build derive no builds@1 status (zero refusals)');
{
  const uids = () => get('ops').steps.map((s) => s.uid);
  const run = (name, fn) => {
    const lines = []; const write = process.stderr.write; process.stderr.write = (t) => { lines.push(String(t)); return true; };
    let w; try { w = BS.withStore(fn, { by: 'console', action: name }); } finally { process.stderr.write = write; }
    eq([w.refused.length, lines.filter((l) => /refused/.test(l)).length, get('ops').status], [0, 0, 'building'], `${name}: no refusal, nothing on stderr, still building`);
  };
  run('step-done', (s) => core.applyNow(s, 'all', [{ op: 'step-done', build: 'ops', uid: uids()[1], done: true }]).store);
  eq([get('ops').steps[1].done, get('ops').steps[1].status], [true, 'building'], 'the tick is kept; the step\'s flow status is the session\'s');
  run('step-done on another step', (s) => core.applyNow(s, 'all', [{ op: 'step-done', build: 'ops', uid: uids()[2], done: true }]).store);
  run('draft: reorder + rename', (s) => { const d = core.addDraftOp(core.addDraftOp(s, 'all', { op: 'reorder-steps', build: 'ops', uids: [...uids()].reverse() }), 'all', { op: 'rename-build', id: 'ops', title: 'Ops, renamed' }); return core.applyDraft(d, 'all').store; });
  eq([get('ops').title, get('ops').steps.map((s) => s.id)], ['Ops, renamed', ['s3', 's2', 's1']], 'reorder and rename land');
  run('every step ticked', (s) => core.applyNow(s, 'all', get('ops').steps.filter((x) => !x.done).map((x) => ({ op: 'step-done', build: 'ops', uid: x.uid, done: true }))).store);
  ok(get('ops').steps.every((x) => x.done), 'all steps ticked: the build is still building (never "landing")');
  run('a Pending-list edit', (s) => { const it = core.itemOfBuild(s.builds.find((b) => b.id === 'ops')); return core.absorbPending(s, 'all', { items: [...core.projectPending(s, 'all').items.filter((x) => x.id !== 'ops'), { ...it, title: 'Ops, from Pending', status: 'complete', updatedAt: new Date().toISOString() }] }); });
  eq([get('ops').title, get('ops').status], ['Ops, from Pending', 'building'], 'the Pending edit lands, its status does not move the build');
  for (const [name, op] of [['divide-step', { op: 'divide-step', build: 'ops', uid: uids()[0], parts: [{ text: 'a', estimate: '5 min' }, { text: 'b', estimate: '5 min' }] }], ['harvest', { op: 'harvest', from: [{ build: 'ops', uid: uids()[0] }], into: [{ title: 'Harvested', uids: [uids()[0]] }] }], ['restore-default', { op: 'restore-default', id: 'ops' }]]) {
    const e = throws(() => core.applyDraft(core.addDraftOp(BS.loadStore(), 'all', op), 'all'));
    ok(e?.code === 'steps-locked' || /no default breakdown/.test(e?.message ?? ''), `${name} on a build that is being built: refused up front with the reason (${(e?.message ?? 'no error').slice(0, 60)})`);
  }
  ok(core.ownsStatus({ status: 'running' }) && !core.ownsStatus({ flow: 'pipeline-2', status: 'building' }) && !core.ownsStatus({ status: 'build-complete' }), 'ownsStatus: builds@1 derivation never owns a Pipeline 2.0 build');
}

console.log('B4-04: a refused status takes the rest of its write with it, and the caller is told');
{
  const w = BS.withStore((s) => { const b = s.builds.find((x) => x.id === 'ops'); b.status = 'ready'; b.title = 'A stale copy'; b.pr = '#1'; b.notes.push({ text: 'from a stale writer', at: T(9) }); return s; }, { by: 'stale-writer' });
  eq([w.flowRefused.length, get('ops').title, get('ops').pr || '', get('ops').notes.some((x) => x.text === 'from a stale writer')], [1, 'Ops, from Pending', '', false], 'nothing of the write was kept for that build');
  ok(/refused a write by stale-writer, nothing of it was kept: forward-only: building → ready goes back/.test(get('ops').notes.at(-1).text), 'one note on the build says what was refused');
  const e = throws(() => BS.setFlowStatus('ops', 'build-complete', { by: 'x', mutate: (b) => { b.steps.pop(); } }));
  eq([e?.code, get('ops').status, get('ops').steps.length], ['backward', 'building', 3], 'setFlowStatus throws when the guard refuses the rest of its write, and nothing is kept');
  const loose = BS.withStore((s) => { const b = s.builds.find((x) => x.id === 'ops'); b.status = 'ready'; b.title = 'Kept on request'; return s; }, { by: 'x', strict: false });
  eq([loose.flowRefused.length, get('ops').title, get('ops').status], [1, 'Kept on request', 'building'], 'strict: false (asked for) keeps the content and drops only the status');
}

console.log('B4-03: archive, then un-archive, through the store');
{
  eq([get('holder').status, get('holder').archivedFrom, get('holder').failedFrom], ['archived', 'failed', 'running-ci'], 'an archived build keeps where it was');
  ok(throws(() => BS.setFlowStatus('holder', 'pending', { by: 'x' }))?.code === 'backward', 'archived → pending is refused');
  const e = throws(() => BS.setFlowStatus('holder', 'failed', { by: 'Brett' }));
  ok(e?.code === 'backward' && /ops holds the active place/.test(e.message), 'it does not come back into the active place while another build holds it');
  archive('ops');
  BS.setFlowStatus('holder', 'failed', { by: 'Brett' });
  eq([get('holder').status, get('holder').failedFrom, get('holder').attempt, P2.holdsActive(get('holder'))], ['failed', 'running-ci', 3, true], 'with the place free it returns exactly as it left');
  archive('holder');
}

console.log('P1-14: one dispatcher, one watchdog');
{
  const W = await import('../../../../../framework/core/build-watchdog.mjs');
  const RW = await import('../recovery-watchdog.mjs');
  const staleBuilds = await import('../watchdog/tables/builds.mjs');
  BS.withStore((s) => { s.builds.push(core.normBuild({ id: 'legacy-pending', title: 'An old pending build', status: 'pending', profiles: ['all'], steps: [{ id: 's1', text: 'x', model: 'Opus', estimate: '5 min' }] })); return s; }, { by: 'test' });
  eq([PL.legacyActive(BS.loadStore()), PL.legacyActive({ builds: [{ id: 'q', status: 'queued' }] }), PL.legacyActive({ builds: [{ id: 'p', flow: 'pipeline-2', status: 'building' }] })], [false, true, false], 'the builds@1 dispatcher is at work only while a builds@1 build is queued or building');
  PL.tick();
  const log = existsSync(join(tmp, 'pipe', 'log.jsonl')) ? readFileSync(join(tmp, 'pipe', 'log.jsonl'), 'utf8') : '';
  ok(!/"event":"planned"/.test(log) && !get('legacy-pending').pipeline?.planned, 'with no builds@1 build in the Queue the old planner plans nothing and logs no "planned" line');
  ok(!W.isMarkedRunning({ id: 'x', flow: 'pipeline-2', status: 'running' }) && W.isMarkedRunning({ id: 'y', status: 'running' }), 'the builds@1 recovery watchdog never takes a Pipeline 2.0 build');
  eq(RW.queueWork({ builds: [{ id: 'x', flow: 'pipeline-2', status: 'queued', steps: [{ id: 's1', text: 'x' }] }] }).length, 0, 'nor counts one as Queue work to fill slots for');
  eq(RW.scan({ store: BS.loadStore(), settings: RW.loadSettings(), accounts: [] }).builds.length, 0, 'its scan finds nothing to watch among Pipeline 2.0 builds');
  eq([staleBuilds.rowOf({ id: 'x', flow: 'pipeline-2', status: 'pending' }), staleBuilds.rowOf({ id: 'y', status: 'pending' })?.kind], [null, 'pending'], 'the stale-row watchdog has no row for a Pipeline 2.0 build (its status is the flow\'s)');
}

console.log(`${failed ? 'FAIL' : 'ok'} p2-status-contract: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
