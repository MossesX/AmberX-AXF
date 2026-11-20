#!/usr/bin/env node
/**
 * Pipeline 2.0 parallel steps, final give-ups and `act step` (Nov 20 2026), on a scratch store with a fake launcher:
 *   - up to stepsInParallel (default 4) steps of the active build run at once, never above the free slots
 *   - a step that used up its attempts (the watchdog's maxAttempts) is never relaunched by the orchestrator
 *   - `orchestrator.mjs act step` on a Pipeline 2.0 build ticks the step and leaves the flow's status alone
 *   node apps/console-web/plugins/build-orchestrator/test/p2-parallel.test.mjs
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2par-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/bin/bash
name=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "$name $AXF_BUILD_STEP \${HOME:-nohome}" >> "${tmp}/launches"
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off', AXF_BUILD_LOCK_PIDS: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_WATCHDOG2_DIR: join(tmp, 'wd2'),
  // every fake session stays alive: a step ends only by its explicit stepExit (the sweep never sees it gone)
  AXF_P2_SLOTS: '8', AXF_P2_ALIVE: Array.from({ length: 6 }, (_, i) => `axf-par--s${i + 1}`).join(','),
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 8, running: 0, usageLeft: 1 }, { name: 'b', usable: true, free: 8, running: 0, usageLeft: 0.8 }]),
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');
const O = await import('../orchestrator.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const running = (id) => get(id).steps.filter((s) => ['sending', 'building'].includes(s.status)).map((s) => s.id);
const send = (id, k) => BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id, title: id, flow: P2.FLOW, steps: Array.from({ length: k }, (_, i) => P2.transition({ id: `s${i + 1}`, text: `Part ${i + 1}`, model: 'Opus', estimate: '20 min', files: [`apps/p${i + 1}`] }, 'pending', { kind: 'step', by: 'test' }).rec) }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' });

console.log('parallel steps: up to stepsInParallel (default 4) at once, each in its own worktree');
eq(F.parallelCap(), 4, 'the default is 4 steps at once');
send('par', 6);
let r = F.advance();
eq(get('par').steps.length, 6, 'six steps (none share files)');
eq(running('par'), ['s1', 's2', 's3', 's4'], 'one pass sends four steps, not one');
ok(r.waits.some((w) => w.id === 'par' && /4 of 4 steps already running/.test(w.why)) || r.launched.length === 4, 'the rest wait for a running step to end');
const launches = () => readFileSync(join(tmp, 'launches'), 'utf8').trim().split('\n');
eq(launches().map((l) => l.split(' ')[1]), ['s1', 's2', 's3', 's4'], 'each launch carries its own AXF_BUILD_STEP (the launcher locks per step)');
ok(launches().every((l) => !/nohome$/.test(l)), 'the launcher always gets HOME');
F.stepExit('par', 's2', { exit: 0 });
F.advance();
eq(running('par'), ['s1', 's3', 's4', 's5'], 'a finished step frees its place: the next step goes out');
{ const prev = process.env.AXF_P2_SLOTS; process.env.AXF_P2_SLOTS = '4'; // four slots, four running: none free
  F.stepExit('par', 's1', { exit: 0 }); r = F.advance(); process.env.AXF_P2_SLOTS = prev;
  eq(running('par'), ['s3', 's4', 's5', 's6'], 'under the VPS slot cap: s6 takes the freed place'); }
{ process.env.AXF_P2_PARALLEL = '2'; F.stepExit('par', 's3', { exit: 0 }); F.advance(); delete process.env.AXF_P2_PARALLEL;
  eq(running('par'), ['s4', 's5', 's6'], 'a lower stepsInParallel never sends more (3 already run, cap 2: nothing new)'); }

console.log('give-up is final: a step at maxAttempts is never relaunched by the orchestrator');
eq(F.attemptCap(), P2.MAX_ATTEMPTS, `the cap is the watchdog's maxAttempts (default ${P2.MAX_ATTEMPTS})`);
mkdirSync(join(tmp, 'wd2'), { recursive: true }); writeFileSync(join(tmp, 'wd2', 'settings.json'), JSON.stringify({ maxAttempts: 3 }));
eq(F.attemptCap(), 3, 'read from the watchdog settings file');
writeFileSync(join(tmp, 'wd2', 'settings.json'), '{}');
const failAt = (sid, attempt) => BS.withStore((x) => { const st = x.builds.find((b) => b.id === 'par').steps.find((s) => s.id === sid); Object.assign(st, { attempt }); return x; }, { by: 'test' });
failAt('s4', 4); F.stepExit('par', 's4', { exit: 1 });
failAt('s5', 5); F.stepExit('par', 's5', { exit: 1 });
eq([get('par').steps[3].status, get('par').steps[4].status], ['failed', 'failed'], 's4 (attempt 4) and s5 (attempt 5) failed');
const before = launches().length;
r = F.advance();
const sent = launches().slice(before).map((l) => l.split(' ')[1]);
eq(sent, ['s4'], 's4 has an attempt left and is relaunched; s5 is not');
eq([get('par').steps[3].status, get('par').steps[3].attempt], ['building', 5], 's4 is building as attempt 5');
eq([get('par').steps[4].status, get('par').steps[4].attempt], ['failed', 5], 's5 stays failed at attempt 5');
ok(r.waits.some((w) => w.step === 's5' && /gave up after attempt 5 of 5/.test(w.why)), 'and the pass says why');
for (let i = 0; i < 3; i++) F.advance();
eq(get('par').steps[4].attempt, 5, 'no pass ever relaunches it (no "attempt 21 of 5")');
BS.withStore((x) => { const st = x.builds.find((b) => b.id === 'par').steps[4]; Object.assign(st, { status: 'ready', statusAt: new Date().toISOString(), statusBy: 'watchdog', attempt: 6, model: 'Fable', account: 'b', tmux: '', slot: '' }); return x; }, { by: 'watchdog' });
F.advance();
eq([get('par').steps[4].status, get('par').steps[4].model, get('par').steps[4].attempt], ['building', 'Fable', 6], "the watchdog's Fable escalation (ready, attempt 6) is sent");

console.log('act step on a Pipeline 2.0 build');
let err = ''; try { O.act({ action: 'step', id: 'par', step: 's6', done: true }); } catch (e) { err = e.message; }
const b = get('par');
eq([err, b.status, b.flow], ['', 'building', P2.FLOW], 'the step is ticked; the build stays building (never running)');
eq([b.steps[5].done, b.steps[5].status], [true, 'building'], 'the tick sets done; the step\'s flow status is the session\'s');
ok(!(b.statusLog ?? []).some((l) => l.status === 'running'), 'no builds@1 status in its log');
F.stepExit('par', 's6', { exit: 0 });
eq(get('par').steps[5].status, 'completed', 'its clean exit still completes it');

console.log(`${failed ? 'FAIL' : 'ok'} p2-parallel: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
