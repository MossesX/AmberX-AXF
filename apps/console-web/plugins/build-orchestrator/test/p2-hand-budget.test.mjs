#!/usr/bin/env node
/**
 * Hand builds and build budgets in the dispatcher, end to end on a scratch store (no git, no tmux, a fake launcher,
 * meters written by hand):
 *   hand builds (hand-build@1)   a hand launch gets a record at `building`; it never takes, waits for, or breaches the
 *                                one active place; the dispatcher never launches it; a clean exit hands it to the
 *                                lander (build-complete), a stop archives it, a crash fails it and nothing relaunches
 *                                it; started again by hand it carries on; a pass notices a session that vanished; the
 *                                dispatch gate and the model gate let a hand launch through with its record on file
 *   budgets (build-budget@1)     no cap until a number is saved; a build that reaches the per-build cap is stopped
 *                                (sessions failed, `budgetStop`, one alert) and is not launched again until the cap
 *                                allows it; at the daily cap every running build stops and no build takes the active
 *                                place; a raised cap releases the stop and the build goes on by itself
 *   node apps/console-web/plugins/build-orchestrator/test/p2-hand-budget.test.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2hand-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const hdir = join(tmp, 'headless'); mkdirSync(hdir);
const settingsFile = join(tmp, 'claude-settings.json');
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/bin/bash
name=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; *) shift;; esac; done
echo "$name" >> "${tmp}/launches"
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'AXF_BUILD_ID', 'AXF_BUILD_STEP', 'AXF_DISPATCH_TOKEN', 'AXF_FABLE_UPGRADE_APPROVAL', 'AXF_BUDGET', 'AXF_HAND_BUILDS']) delete process.env[k];
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_P2_SLOTS: '6', AXF_P2_PARALLEL: '6', AXF_P2_EMERGENCY_SLOTS: '2', AXF_P2_ALIVE: '',
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 9, running: 0, usageLeft: 0.9 }]),
  AXF_MODEL_TRIAGE_DIR: join(tmp, 'triage'), AXF_CLAUDE_SETTINGS_FILE: settingsFile,
  AXF_HEADLESS_DIR: hdir, AXF_HAND_GIT: 'off', AXF_HAND_AHEAD: '2', AXF_BUDGET_KILL: 'off',
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const H = await import('../../../../../framework/cli/hand-build.mjs');
const BB = await import('../../../../../framework/cli/build-budget.mjs');
const B = await import('../../../../../framework/core/build-budget.mjs');
const DG = await import('../../../../../framework/cli/dispatch-gate.mjs');
const MG = await import('../../../../../framework/cli/model-gate.mjs');
const WC = await import('../../../../../deploy/watchdog/core.mjs');
const LC = await import('../../../../../deploy/lander/lander-core.mjs');
await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const send = (id, steps) => BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id, title: id, flow: P2.FLOW, steps: steps.map((x, i) => P2.transition({ id: `s${i + 1}`, model: 'Opus', estimate: '5 min', ...x }, 'pending', { kind: 'step', by: 'test' }).rec) }, 'split', { by: 'test' }).rec)); return s; }, { by: 'test' });
const alive = () => BS.loadStore().builds.flatMap((b) => b.steps).filter((x) => x.status === 'building' && x.tmux).map((x) => x.tmux);
const advance = (gone = []) => { process.env.AXF_P2_ALIVE = alive().filter((x) => !gone.includes(x)).join(','); return F.advance(); };
const launches = () => (existsSync(join(tmp, 'launches')) ? readFileSync(join(tmp, 'launches'), 'utf8').trim().split('\n') : []);
const meter = (session, name, costUsd, startedAt = new Date().toISOString()) => writeFileSync(join(hdir, `${session}.meter.json`), JSON.stringify({ $axf: 'headless-meter@1', session, name, costUsd, startedAt }));
const caps = (values) => writeFileSync(settingsFile, JSON.stringify({ values }));
const handStart = (name, more = {}) => { const dir = join(wt, name); mkdirSync(dir, { recursive: true }); process.env.AXF_HAND_BRANCH = `claude/${name}`; return H.start({ name, session: `axf-${name}--earl`, dir, model: 'claude-fable-5-2', brief: `# Build: ${name}\n\nDo the thing.`, by: 'Earl the Ear', ...more }); };

// ---------------------------------------------------------------- hand builds
console.log('hand builds');
{
  send('plan-a', [{ text: 'a' }]);
  let r = advance();
  eq(r.active, 'plan-a', 'a sent build takes the active place');
  const s = handStart('hand-one');
  ok(s.ok && s.created, 'a hand launch files its record');
  const b = get('hand-one');
  eq([b.status, b.flow, b.source, b.branch, P2.isHand(b)], ['building', 'pipeline-2', 'hand', 'claude/hand-one', true], 'the record: a Pipeline 2.0 build, building, tagged hand, on its branch');
  eq([b.steps.length, b.steps[0].id, b.steps[0].status, b.steps[0].model, b.steps[0].tmux, b.steps[0].worktree], [1, 's1', 'building', 'Fable', 'axf-hand-one--earl', join(wt, 'hand-one')], 'one step, already building in the session and its worktree');
  eq(b.title, 'hand-one', 'the title comes from the brief');
  ok(!handStart('hand-one').created && get('hand-one').steps.length === 1, 'a second start files nothing twice');
  process.env.AXF_HAND_BRANCH = 'main';
  ok(H.start({ name: 'chat-1', session: 'axf-chat-1', dir: wt }).skipped, 'a session that is not on its own claude/<name> branch is not a hand build');
  process.env.AXF_HAND_BRANCH = 'claude/other';
  ok(H.start({ name: 'hand-x', session: 'axf-hand-x', dir: wt }).skipped, 'nor one on another build\'s branch');

  const act = P2.activeBuild(BS.loadStore().builds.filter((x) => x.flow === P2.FLOW));
  eq([act.active?.id, act.others.length], ['plan-a', 0], 'the hand build is beside the line: not the active build, not a breach');
  const before = launches().length;
  r = advance();
  eq([r.active, launches().length, get('hand-one').status], ['plan-a', before, 'building'], 'a pass never launches a hand build and leaves it building');
  send('plan-b', [{ text: 'b' }]);
  r = advance();
  ok(r.waits.some((w) => w.id === 'plan-b' && /plan-a/.test(w.why)) && !r.waits.some((w) => /hand-one/.test(w.why)), 'a waiting build waits for the active build, never for the hand build');
  eq(WC.findIssues(BS.loadStore(), { probes: { 'hand-one/s1': { tmux: false } }, now: Date.now() + 3600e3 }).filter((i) => i.build === 'hand-one'), [], 'the watchdog leaves a hand build that is being built alone');
  ok(DG.check({ name: 'hand-one', brief: '' }).ok && DG.still({ name: 'hand-one' }).ok, 'the dispatch gate passes a hand launch whose record is on file');
  ok(MG.launchCheck(get('hand-one'), 'claude-fable-5-2').ok && MG.launchCheck({ ...get('hand-one'), steps: [{ ...get('hand-one').steps[0], model: 'Opus' }] }, 'fable').ok, 'the model gate does not pin a hand build to its last launch model');
  ok(!DG.check({ name: 'plan-b', brief: '' }).ok, 'an orchestrator build still needs the dispatcher\'s token');

  // a clean exit with commits: over to the lander
  const e = H.exit({ name: 'hand-one', session: 'axf-hand-one--earl', exit: 0, kind: 'phase-done' });
  eq([e.status, get('hand-one').status, get('hand-one').steps[0].status], ['build-complete', 'build-complete', 'completed'], 'a clean exit: step completed, build-complete');
  eq(LC.pickBuild(BS.loadStore().builds).build?.id, 'hand-one', 'the lander picks it like any other build');
  eq(P2.activeBuild(BS.loadStore().builds.filter((x) => x.flow === P2.FLOW)).active?.id, 'plan-a', 'landing beside the line: plan-a stays the active build');
  ok(H.exit({ name: 'hand-one', exit: 1 }).status === 'build-complete', 'a late exit call changes nothing');
  ok(handStart('hand-one').skipped && get('hand-one').status === 'build-complete', 'a launch under the name of a build that is landing leaves its record alone');

  // a clean exit with nothing on the branch: archived
  handStart('hand-empty'); process.env.AXF_HAND_AHEAD = '0';
  eq([H.exit({ name: 'hand-empty', exit: 0 }).status, get('hand-empty').status], ['archived', 'archived'], 'a clean exit with no commit: archived, nothing to land');
  process.env.AXF_HAND_AHEAD = '2';

  // stopped by hand: archived; started again: the same record carries on
  handStart('hand-stop');
  eq(H.exit({ name: 'hand-stop', session: 'axf-hand-stop--earl', exit: 143 }).status, 'archived', 'stopped by hand (SIGTERM): archived');
  ok(!P2.handBuilds(BS.loadStore().builds).some((x) => x.id === 'hand-stop'), 'and no longer watched');
  const again = handStart('hand-stop', { session: 'axf-hand-stop--gina' });
  eq([again.resumed, get('hand-stop').status, get('hand-stop').steps[0].tmux], [true, 'building', 'axf-hand-stop--gina'], 'started again by hand: back at building in the new session');
  ok(H.exit({ name: 'hand-stop', session: 'axf-hand-stop--earl', exit: 0 }).status === 'building', 'the old session\'s exit does not end the new one');

  // a crash: failed, never relaunched; started again by hand it carries on
  eq(H.exit({ name: 'hand-stop', session: 'axf-hand-stop--gina', exit: 1, kind: 'crash' }).status, 'failed', 'a crash: failed');
  eq([get('hand-stop').status, get('hand-stop').failedFrom, get('hand-stop').steps[0].status], ['failed', 'building', 'failed'], 'failed at building, its step too');
  const l0 = launches().length; advance(); advance();
  eq([launches().length, get('hand-stop').status], [l0, 'failed'], 'no pass relaunches a failed hand build');
  eq(WC.findIssues(BS.loadStore(), { now: Date.now() + 3600e3 }).filter((i) => i.build === 'hand-stop'), [], 'and the watchdog does not retry it');
  handStart('hand-stop', { session: 'axf-hand-stop--joey' });
  eq([get('hand-stop').status, get('hand-stop').attempt, get('hand-stop').steps[0].status], ['building', 1, 'building'], 'started again after a crash: building, a fresh attempt count');

  // the session vanished without an exit call: the pass ends it from the session-end event
  writeFileSync(join(hdir, 'events.jsonl'), `${JSON.stringify({ event: 'session-end', session: 'axf-hand-stop--joey', exit: 0, kind: 'phase-done' })}\n`);
  r = advance(['axf-hand-stop--joey']);
  eq([r.hand.length, get('hand-stop').status], [0, 'building'], 'a session that only just started is given time');
  const late = H.sweep({ env: { ...process.env, AXF_P2_ALIVE: '' }, now: Date.now() + H.SWEEP_GRACE_MS + 1000 });
  eq([late.map((x) => x.id), get('hand-stop').status], [['hand-stop'], 'build-complete'], 'a vanished session is ended from its session-end event (exit 0: over to the lander)');
  handStart('hand-gone');
  H.sweep({ env: { ...process.env, AXF_P2_ALIVE: '' }, now: Date.now() + H.SWEEP_GRACE_MS + 1000 });
  eq(get('hand-gone').status, 'failed', 'one with no session-end event at all is a crash');
  ok(!F.actBuild || (() => { try { F.actBuild('hand-gone', 'hold', { by: 'test' }); return false; } catch (err) { return /hand build/.test(err.message); } })(), 'a hand build is never put on hold');
}

// ---------------------------------------------------------------- budgets
console.log('budgets');
{
  eq([BB.readCaps().perBuildUsd, BB.readCaps().dailyUsd], [0, 0], 'no cap until a number is saved');
  meter('axf-plan-a--s1--earl', 'plan-a--s1', 40);
  let r = advance();
  ok(r.budget && !r.budget.stopped.length && !r.budget.daily.reached && !get('plan-a').budgetStop, 'with no cap nothing is stopped, whatever was spent');
  eq(get('plan-a').steps[0].status, 'building', 'plan-a is building');

  caps({ 'builds.budgetPerBuildUsd': 50 });
  r = advance();
  ok(!r.budget.stopped.length, 'under the cap: nothing stops');
  meter('axf-plan-a--s1--gina', 'plan-a--s1', 15); // a second session of the same step: the build's spend is the sum
  eq(BB.look().spend.byBuild['plan-a'], 55, 'a build\'s spend is every session of it');
  r = advance();
  eq(r.budget.stopped.map((x) => [x.id, x.kind, x.spentUsd, x.capUsd]), [['plan-a', 'build', 55, 50]], 'at the per-build cap the build is stopped');
  let b = get('plan-a');
  eq([b.budgetStop?.kind, b.steps[0].status, b.steps[0].failedFrom], ['build', 'failed', 'building'], 'its record says so and its running step is failed (the session is stopped)');
  ok(/reached its budget: \$55\.00 of \$50\.00 per build/.test(b.notes.at(-1)?.text ?? '') || b.notes.some((x) => /reached its budget: \$55\.00 of \$50\.00 per build/.test(x.text)), 'a note with the numbers and the one switch');
  ok(r.budget.alert && /plan-a/.test(r.budget.alert.title) && /Budget per build \(USD\)/.test(r.budget.alert.body), 'one alert for Brett naming the setting');
  const l0 = launches().length;
  r = advance(); r = advance();
  eq([launches().length, r.budget.stopped.length, !!r.budget.alert], [l0, 0, false], 'a stopped build is not relaunched, and Brett is told once');
  ok(r.waits.some((w) => w.id === 'plan-a' && /stopped at its budget/.test(w.why)), 'the pass says why it waits');
  eq(WC.findIssues(BS.loadStore(), { now: Date.now() + 3600e3 }).filter((i) => i.build === 'plan-a'), [], 'the watchdog leaves a budget stop alone');
  eq(P2.activeBuild(BS.loadStore().builds.filter((x) => x.flow === P2.FLOW)).active?.id, 'plan-a', 'it keeps the active place: plan-b still waits its turn');

  caps({ 'builds.budgetPerBuildUsd': 100 }); // Brett raises the cap
  r = advance();
  eq([r.budget.cleared.map((x) => x.id), !!get('plan-a').budgetStop], [['plan-a'], false], 'a raised cap releases the stop');
  r = advance();
  eq([get('plan-a').steps[0].status, launches().length], ['building', l0 + 1], 'and the build goes on by itself: its step is sent out again');

  // the daily cap: every running build stops, nothing new takes the active place
  handStart('hand-two');
  caps({ 'builds.budgetPerBuildUsd': 100, 'builds.budgetDailyUsd': 60 });
  meter('axf-chat--paulie', 'chat', 10); // today: 40 + 15 + 10 = 65, builds and everything else
  eq(BB.dailyReached().reached, true, 'the day\'s spend is every metered session started today');
  r = advance();
  eq(r.budget.stopped.map((x) => [x.id, x.kind]).sort(), [['hand-two', 'daily'], ['plan-a', 'daily']], 'at the daily cap every build with a session out stops, hand builds too');
  eq([get('hand-two').status, get('hand-two').budgetStop?.kind, get('plan-a').steps[0].status], ['failed', 'daily', 'failed'], 'the hand build is failed, the pipeline build\'s step too');
  ok(/Daily build budget reached: \$65\.00 of \$60\.00/.test(r.budget.alert?.title ?? ''), 'one alert for the day');
  BS.setFlowStatus('plan-a', 'archived', { by: 'test', why: 'out of the way' });
  r = advance();
  ok(!r.active && r.waits.some((w) => /daily budget is reached/.test(w.why)) && get('plan-b').status === 'split', 'while the daily cap is reached no build takes the active place');
  meter('axf-old--earl', 'old', 500, '2026-01-01T00:00:00.000Z');
  eq(BB.look().daily.spentUsd, 65, 'yesterday\'s sessions do not count towards today');
  caps({ 'builds.budgetPerBuildUsd': 100, 'builds.budgetDailyUsd': 0 }); // Brett removes the daily cap
  r = advance();
  ok(r.budget.cleared.some((x) => x.id === 'hand-two') && !get('hand-two').budgetStop, 'the daily stop is released once the cap allows it');
  eq([r.active, get('hand-two').status], ['plan-b', 'failed'], 'the line moves again; a hand build stays failed until it is started by hand');

  // the engine's own rules
  eq(B.buildOfSession('axf-plan-a--s1--earl', ['plan-a']), 'plan-a', 'a step session belongs to its build');
  eq(B.buildOfSession('lander-fix-plan-a', ['plan-a']), 'plan-a', 'a fix worktree too');
  eq(B.buildOfSession('axf-plan-ab--earl', ['plan-a']), '', 'never by a loose prefix');
  eq(B.capsOf({ 'builds.budgetPerBuildUsd': -3, 'builds.budgetDailyUsd': 'x' }), { perBuildUsd: 0, dailyUsd: 0, stored: { perBuild: false, daily: false } }, 'a bad stored value is no cap, never a made-up one');
}

console.log(failed ? `\n${failed} of ${n} failed` : `\n✓ hand builds and budgets — ${n} checks`);
process.exit(failed ? 1 : 0);
