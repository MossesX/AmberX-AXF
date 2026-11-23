#!/usr/bin/env node
/**
 * pipeline-2@1 taps (pipeline2.mjs actBuild: the orchestrator's menu, the planner's, REST, MCP) on a scratch store
 * (no git, no tmux, a fake launcher), and the split that moves a sent plan on by itself:
 *   - a plan sent from the planner (planning steps, no build steps) goes pending → split → active in one pass; a second
 *     one waits at split (shown Pending) and takes the active place by itself when the first is out of the way;
 *   - Queue never refuses a waiting Pipeline 2.0 build ("only a Pending build can be queued"): it moves it on and says
 *     where it stands;
 *   - hold / release, retry, rebuild (a step, a build that failed while landing), run-ci, land, cancel: each done on the
 *     VPS, each refused with a reason when it does not fit where the build is.
 *   node apps/console-web/plugins/build-orchestrator/test/p2-actions.test.mjs
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2act-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/bin/bash
name=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
const noFable = join(tmp, 'no-fable.sh'); // the splitter cannot answer: one build step per planning step
writeFileSync(noFable, '#!/bin/bash\necho "out of credits" >&2\nexit 1\n'); chmodSync(noFable, 0o755);
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_SPLITTER: noFable, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_P2_SLOTS: '4', AXF_P2_ALIVE: '', AXF_P2_LANDER: 'off', AXF_PIPELINE_LOCKED: '1',
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 8, running: 0, usageLeft: 0.9 }]),
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const PL = await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const refused = (fn) => { try { fn(); return ''; } catch (e) { return e.code === 2 || e instanceof BS.FlowRefused ? e.message : `threw: ${e.message}`; } };
let ticks = 0;
const opts = { by: 'Brett', landerTick: () => { ticks += 1; return true; } };
const act = (id, action, o = {}) => F.actBuild(id, action, { ...opts, ...o });
/** A plan as the planner sends it: one pending build, its steps as planning only. */
const sendPlan = (id, planning, createdAt) => BS.withStore((s) => { s.builds.push(core.normBuild({ ...P2.transition({ id, title: `Plan ${id}`, source: 'planner', planRef: `${id}-item`, flow: P2.FLOW, planning: planning.map((text) => ({ text })), steps: [] }, 'pending', { by: 'planner' }).rec, createdAt })); return s; }, { by: 'test' });
const walk = (id, ...tos) => { for (const to of tos) BS.setFlowStatus(id, to, { by: 'test' }); };

console.log('the split moves a sent plan on by itself');
sendPlan('first', ['Write the page', 'Write the tests'], '2026-11-20T10:00:00.000Z');
sendPlan('second', ['Another thing'], '2026-11-20T11:00:00.000Z');
F.advance();
eq(get('first').statusLog.map((l) => l.status).slice(0, 4), ['pending', 'splitting', 'split', 'pulling-main'], 'one pass: pending → splitting → split → active, nothing else needed');
eq([get('first').steps.length, get('first').steps.every((s) => s.status === 'building')], [2, true], 'its steps were filed by the orchestrator and went out');
eq([get('second').status, get('second').steps.length], ['split', 1], 'the next plan is split too and waits its turn (shown Pending)');

console.log('Queue on a waiting build: never "only a Pending build can be queued"');
let r = act('second', 'queue');
ok(r.status === 'split' && /is in line \(Pending\): waiting for first to land/.test(r.say), `queue says where it stands: ${r.say}`);
eq(refused(() => PL.queue('second', { by: 'Brett' })), '', 'pipeline.mjs queue (the console\'s Queue, axf.build-dispatch@1) moves a Pipeline 2.0 build on instead of refusing it');
ok(/in line/.test(PL.queue('second', { by: 'Brett' }).say), 'and answers with its place');
ok(/already past the line: Building/.test(act('first', 'queue').say), 'queue on the active build changes nothing');
ok(/only a Pending build can be queued/.test(refused(() => { BS.withStore((s) => { s.builds.push(core.normBuild({ id: 'old-style', title: 'builds@1', status: 'built', steps: [] })); return s; }, { by: 'test' }); PL.queue('old-style'); })), 'a builds@1 build keeps its own Queue rule');

console.log('hold / release');
ok(/only a build still waiting its turn/.test(refused(() => act('first', 'hold'))), 'the active build is not put on hold');
r = act('second', 'hold', { why: 'not yet' });
ok(r.held && F.isHeld(get('second')) && get('second').pipeline.heldBy === 'Brett' && get('second').pipeline.heldWhy === 'not yet', 'a waiting build goes on hold');
ok(/on hold already/.test(refused(() => act('second', 'hold'))) && /release it first/.test(refused(() => act('second', 'queue'))), 'held: no second hold, no queue');
eq(F.nextToActivate(F.p2Builds(BS.loadStore()).filter((b) => b.id === 'second')), null, 'the line skips a held build');

console.log('retry and rebuild');
ok(/nothing to retry/.test(refused(() => act('first', 'retry'))), 'retry needs something failed');
BS.setFlowStatus('first', 'failed', { step: 's1', by: 'test', why: 'session exit 1' });
ok(/only a failed step is built again/.test(refused(() => act('first', 'rebuild', { step: 's2' }))), 'a step that has not failed is not rebuilt');
ok(/no step s9/.test(refused(() => act('first', 'rebuild', { step: 's9' }))), 'an unknown step is refused');
r = act('first', 'rebuild', { step: 's1' });
eq([get('first').steps[0].status, get('first').steps[0].attempt, r.step], ['ready', 1, 's1'], 'rebuild of a failed step: back through ready, the attempt count starts again');
BS.setFlowStatus('first', 'sending', { step: 's1', by: 'test' }); BS.setFlowStatus('first', 'failed', { step: 's1', by: 'test', why: 'again' });
r = act('first', 'retry');
ok(get('first').steps[0].status === 'ready' && /retrying/.test(r.say), 'retry: the failed step leaves failed forward');

console.log('run CI and land fit only where the build is');
ok(/CI runs once its steps are merged into one PR/.test(refused(() => act('first', 'run-ci'))), 'no CI on a build that is still building');
ok(/lands once every step is built/.test(refused(() => act('first', 'land'))), 'no landing before every step is built');
ok(/only a failed build is rebuilt/.test(refused(() => act('first', 'rebuild'))), 'a build that has not failed is not rebuilt');
for (const to of ['sending', 'building', 'completed']) BS.setFlowStatus('first', to, { step: 's1', by: 'test' });
BS.setFlowStatus('first', 'completed', { step: 's2', by: 'test' });
walk('first', 'build-complete');
ticks = 0;
ok(/the lander takes it on its next pass/.test(act('first', 'land').say) && ticks === 1, 'land on a built build: the lander is asked for a pass now');
walk('first', 'merging-pr', 'pr-pulling-main', 'running-ci');
ok(/Running CI/.test(act('first', 'run-ci').say) && ticks === 2, 'run-ci at Running CI: checked now');
BS.setFlowStatus('first', 'failed', { by: 'lander', why: 'CI red', mutate: (rec) => { rec.failure = { kind: 'ci', status: 'running-ci', why: 'CI red', retry: 'hold' }; } });
r = act('first', 'run-ci');
eq([r.status, get('first').attempt, !!get('first').failure], ['running-ci', 1, false], 'run-ci on a build that failed at CI: back at Running CI, the failure cleared, attempts reset');
BS.setFlowStatus('first', 'failed', { by: 'lander', why: 'CI red again' });
r = act('first', 'rebuild');
ok(r.status === 'pr-pulling-main' && /recompiled/.test(r.say), 'rebuild on a build that failed while landing: main is pulled into its PR again (recompile)');
BS.setFlowStatus('first', 'failed', { by: 'lander', why: 'merge refused' });
r = act('first', 'land');
ok(r.status === 'pr-pulling-main' && /landing again/.test(r.say), 'land on a build that failed while landing: retried where it failed');
walk('first', 'running-ci', 'merging-main');
ok(/is past CI/.test(refused(() => act('first', 'run-ci'))), 'no CI re-run once it is merging into main');

console.log('cancel, and the next build takes its turn by itself');
r = act('first', 'cancel', { why: 'changed my mind' });
eq([r.status, get('first').archivedFrom], ['archived', 'merging-main'], 'cancel: archived from where it was');
ok(/archived: nothing to queue/.test(refused(() => act('first', 'queue'))), 'a cancelled build takes no more taps');
F.advance();
eq(get('second').status, 'split', 'the held build stays where it is even with the place free');
r = act('second', 'release', { pass: (id) => F.advance({ build: id }) });
ok(!r.held && P2.holdsActive(get('second')) && /has the active place/.test(r.say), `release: it takes the active place at once: ${r.say}`);
ok(/not on hold/.test(refused(() => act('second', 'release'))), 'release needs a hold');
ok(/action is one of/.test(refused(() => act('second', 'explode'))) && /no build/.test(refused(() => act('nope', 'queue'))) && /not a Pipeline 2.0 build/.test(refused(() => act('old-style', 'queue'))), 'unknown actions and builds are refused');
ok(get('second').notes.some((x) => /On hold \(Brett\): not yet/.test(x.text)) && get('first').notes.some((x) => /Cancelled from Merging into main \(Brett\): changed my mind/.test(x.text)), 'every tap leaves a note on the build with who and why');

console.log(failed ? `\n${failed} of ${n} checks FAILED` : `\np2-actions: ${n} checks passed`);
process.exit(failed ? 1 : 0);
