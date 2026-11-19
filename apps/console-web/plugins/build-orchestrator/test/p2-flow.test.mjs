#!/usr/bin/env node
/**
 * pipeline-2@1 orchestrator flow, end to end on a scratch store (no git, no tmux, a fake launcher):
 * pending → splitting → split → pulling-main (one step at a time, worktrees cut before launch) → assigning-models →
 * ready → sending → building → build-complete; one active build at a time; accounts by usage left, spread evenly,
 * never one marked out; a launch failure and a usage-limit exit retry forward on another account as attempt N + 1.
 *   node apps/console-web/plugins/build-orchestrator/test/p2-flow.test.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'axf-p2flow-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const launcher = join(tmp, 'launcher.sh');
// the fake launcher: account "bad" refuses; anything else "starts" axf-<name>
writeFileSync(launcher, `#!/bin/bash
name="" account=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --account) account="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "$name $account $AXF_BUILD_STEP $AXF_ACCOUNT_SWITCHES" >> "${tmp}/launches"
[ "$account" = bad ] && { echo "boom: login refused"; exit 1; }
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
const future = new Date(Date.now() + 2 * 86400e3).toISOString();
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_P2_SLOTS: '2', AXF_P2_ALIVE: '',
  AXF_P2_ACCOUNTS: JSON.stringify([
    { name: 'bad', usable: true, free: 3, running: 0, usageLeft: 1 },
    { name: 'a', usable: true, free: 3, running: 0, usageLeft: 0.9 },
    { name: 'b', usable: true, free: 3, running: 0, usageLeft: 0.6 },
    { name: 'out', usable: true, free: 3, running: 0, usageLeft: 1, limited: { until: future, reason: 'hit its weekly limit' } },
    { name: 'empty', usable: true, free: 3, running: 0, usageLeft: 0 },
  ]),
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const send = (id, steps) => BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id, title: id, flow: P2.FLOW, steps: steps.map((x, i) => P2.transition({ id: `s${i + 1}`, model: 'Opus', estimate: '20 min', ...x }, 'pending', { kind: 'step', by: 'test' }).rec) }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' });

console.log('one pass: split, one active, main into each step, models, steps out to free slots');
send('alpha', [{ text: 'Write the store schema', files: ['framework/x'] }, { text: 'UI tweak', files: ['apps/ui'] }, { text: 'Fix the store helper', files: ['framework/x/y.mjs'] }]);
send('beta', [{ text: 'Another build', files: ['b'] }]);
let r = F.advance();
let A = get('alpha');
eq(A.steps.length, 2, 'split into 2 steps for 2 slots, the two store steps together (same files)');
eq(A.statusLog.map((l) => l.status), ['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building'], 'build walks the flow forward, every change logged');
ok(A.statusLog.every((l) => l.at && l.by), 'every change has at and by');
eq(A.steps.map((s) => s.statusLog.map((l) => l.status).join('>')), ['pending>pulling-main>ready>sending>failed>sending>building', 'pending>pulling-main>ready>sending>building'], 'each step: main pulled, then sent and building (s1 retried forward after a refused launch)');
ok(A.steps.every((s) => existsSync(s.worktree) && s.branch === `claude/alpha--${s.id}`), 'worktrees cut before launch at <build>--<step>');
eq(A.steps.map((s) => s.model), ['Fable', 'Opus'], 'models: Fable for the schema step, Opus otherwise');
eq(r.active, 'alpha', 'alpha is the one active build');
eq(get('beta').status, 'split', 'beta is split and waits (shown Pending)');
ok(r.waits.some((w) => w.id === 'beta' && /one active build/.test(w.why)), 'beta says what it waits for');
const launches = readFileSync(join(tmp, 'launches'), 'utf8').trim().split('\n');
ok(launches.some((l) => l.startsWith('alpha--s1 bad')) && !launches.some((l) => l.startsWith('alpha--s2 bad')), 'a launch failure on one account … (no other step tries it in the same pass)');
eq(A.steps.map((s) => s.account).sort(), ['a', 'b'], '… retried at once on others; steps spread across accounts with usage left');
ok(!launches.some((l) => / (out|empty) /.test(l)), 'never an account marked out or with no usage left');
ok(launches.every((l) => / 0$/.test(l)), 'the launcher never switches accounts itself (the dispatcher retries as attempt N + 1)');
const s1 = A.steps.find((s) => s.statusLog.some((l) => l.status === 'failed'));
ok(s1 && s1.attempt === 2, `the failed launch is attempt 1, its retry attempt 2 (${s1?.attempt})`);

console.log('step exits: completed, a usage limit retried forward on another account');
F.stepExit('alpha', 's2', { exit: 0, account: get('alpha').steps[1].account });
eq(get('alpha').steps[1].status, 'completed', 'a clean exit = completed (done)');
const was = get('alpha').steps[0].account;
F.stepExit('alpha', 's1', { exit: 1, hit: 'usage', account: was });
eq([get('alpha').steps[0].status, get('alpha').steps[0].failedFrom], ['failed', 'building'], 'a usage-limit exit = failed at building');
r = F.advance();
A = get('alpha');
eq([A.steps[0].status, A.steps[0].attempt], ['building', 3], 'relaunched forward (never back to ready), attempt 3');
ok(A.steps[0].account !== was && A.steps[0].account !== 'bad', `on another account (${was} → ${A.steps[0].account})`);
F.stepExit('alpha', 's1', { exit: 0 });
eq(get('alpha').status, 'build-complete', 'every step completed = build complete (the lander takes it)');
F.advance();
eq(get('beta').status, 'split', 'beta still waits: alpha is active until it lands');

console.log('forward-only through the store, whoever writes');
let threw = null; try { BS.setFlowStatus('alpha', 'building', { by: 'test' }); } catch (e) { threw = e.code; }
eq([threw, get('alpha').status], ['backward', 'build-complete'], 'build-complete → building refused');
const w = BS.withStore((s) => { s.builds.find((b) => b.id === 'alpha').steps[0].status = 'ready'; return s; }, { by: 'raw' });
eq([w.refused.length, get('alpha').steps[0].status], [1, 'completed'], 'a raw backward step write is refused');

console.log('the store change event: a second trigger');
{ const H = await import('../pipeline2-hook.mjs'); let ran = [];
  const env = { ...process.env, AXF_CLAUDE_ACCOUNTS: tmp };
  ok(H.onBuildEvents([{ event: 'status', to: 'ready' }], { env, run: (a) => ran.push(a) }).woke && ran[0].includes('advance'), 'ready wakes a pass at once');
  ok(H.onBuildEvents([{ event: 'status', to: 'landed' }], { env, run: (a) => ran.push(a) }).woke, 'landed wakes a pass (the next build may become active)');
  ok(!H.onBuildEvents([{ event: 'status', to: 'queued' }], { env, run: (a) => ran.push(a) }).woke, 'a builds@1 status does not');
  ok(!H.onBuildEvents([{ event: 'status', to: 'ready' }], { env: { ...env, AXF_P2_HOOK: 'off' }, run: (a) => ran.push(a) }).woke, 'AXF_P2_HOOK=off'); }

console.log(`${failed ? 'FAIL' : 'ok'} p2-flow: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
