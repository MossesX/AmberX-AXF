#!/usr/bin/env node
/**
 * Emergency builds, end to end on a scratch store (no git, no tmux, a fake launcher):
 *   - starting one: Brett's signed-in console only (AXF_APPROVER + AXF_APPROVER_VIA=console); a session, a headless
 *     build, an agent, an axHub approval and a bare call are refused and nothing is tagged or granted;
 *   - the emergency lane: an emergency build skips the one-active-build line and builds beside the active build, its
 *     steps in the emergency slot pool (2 places) while the orchestrator's slots are busy; the orchestrator never puts
 *     an ordinary step in an emergency slot; an emergency build is never the active build and never a breach;
 *   - the grant is taken back once the build is no longer a live emergency build.
 *   node apps/console-web/plugins/build-orchestrator/test/emergency.test.mjs
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2emergency-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const launcher = join(tmp, 'launcher.sh');
writeFileSync(launcher, `#!/bin/bash
name=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "$name" >> "${tmp}/launches"
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
// nothing here may look like Brett or like a session: each case passes its own environment
for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'AXF_BUILD_ID']) delete process.env[k];
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_P2_SLOTS: '2', AXF_P2_EMERGENCY_SLOTS: '2', AXF_P2_ALIVE: '',
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 9, running: 0, usageLeft: 0.9 }, { name: 'b', usable: true, free: 9, running: 0, usageLeft: 0.8 }]),
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const E = await import('../../../../../framework/cli/emergency-builds.mjs');
const L = await import('../../../../../framework/cli/build-limit.mjs');
await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');
const T = await import('../web/status-table-core.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const send = (id, steps, more = {}) => BS.withStore((s) => { s.builds.push(core.normBuild({ ...P2.transition({ id, title: id, flow: P2.FLOW, steps: steps.map((x, i) => P2.transition({ id: `s${i + 1}`, model: 'Opus', estimate: '20 min', ...x }, 'pending', { kind: 'step', by: 'test' }).rec) }, 'pending', { by: 'test' }).rec, ...more })); return s; }, { by: 'test' });
const refused = (env, id = 'rush') => { try { E.sendToEmergency(id, { env }); return ''; } catch (e) { return `${e.code}:${e.message}`; } };
const BRETT = { AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'console' };
// a pass with every session that is building still alive (a session the dispatcher can't see is swept as ended)
const advance = () => { process.env.AXF_P2_ALIVE = BS.loadStore().builds.flatMap((b) => b.steps).filter((x) => x.status === 'building' && x.tmux).map((x) => x.tmux).join(','); return F.advance(); };
// the lander's part, done by hand: the merge evidence `landed` asks for (done-means-merged@1)
const land = (id, pr) => { const at = new Date().toISOString(); BS.setFlowStatus(id, 'merging-pr', { by: 'test' }); BS.setFlowStatus(id, 'landed', { by: 'test', extra: { pr: String(pr), mergedAt: at, landed: { pr, sha: 'a'.repeat(40), mergedAt: at, ci: 'success', ciAt: at } } }); };
const inSlot = (id) => get(id).steps.filter((s) => ['sending', 'building'].includes(s.status)).length;

console.log('the orchestrator is busy: one active build fills its 2 slots, the next build waits its turn');
send('alpha', [{ text: 'One', files: ['a'] }, { text: 'Two', files: ['b'] }]);
send('beta', [{ text: 'Waits', files: ['c'] }]);
send('rush', [{ text: 'Hot fix part one', files: ['r1'] }, { text: 'Hot fix part two', files: ['r2'] }]);
send('rush2', [{ text: 'A second emergency', files: ['q'] }]);
let r = advance();
eq([r.active, inSlot('alpha'), get('beta').status, get('rush').status, get('rush2').status], ['alpha', 2, 'split', 'split', 'split'], 'alpha is active in both orchestrator slots; beta, rush and rush2 are split and wait');
eq(r.emergency, [], 'no emergency build yet');

console.log('starting an emergency build: Brett\'s signed-in console only');
ok(/^3:only Brett/.test(refused({})), 'a bare call (no approver) is refused');
ok(/^3:only Brett/.test(refused({ ...BRETT, CLAUDECODE: '1' })), 'a Claude session is refused even with the approver variables set');
ok(/^3:only Brett/.test(refused({ ...BRETT, AXF_SURFACE: 'headless' })), 'a headless build is refused');
ok(/^3:only Brett/.test(refused({ ...BRETT, AXF_SESSION: 'some-build' })), 'a build session is refused');
ok(/^3:only Brett/.test(refused({ ...BRETT, AI_AGENT: 'worker' })), 'an agent is refused');
ok(/^3:only Brett/.test(refused({ AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'axhub' })), 'an axHub approval is not his console: refused');
ok(/^3:only Brett/.test(refused({ AXF_APPROVER: '', AXF_APPROVER_VIA: 'console' })), 'the console token (no signed-in name) is refused');
eq([P2.isEmergency(get('rush')), L.loadEmergency()], [false, []], 'after every refusal: no tag on the build, no grant on the slots');
ok(/^2:no build/.test(refused(BRETT, 'nope')), 'Brett, but no such build');
send('old-style', [], { flow: undefined });
BS.withStore((s) => { const b = s.builds.find((x) => x.id === 'old-style'); delete b.flow; b.status = 'queued'; return s; }, { by: 'test' });
ok(/^2:.*not a Pipeline 2\.0 build/.test(refused(BRETT, 'old-style')), 'Brett, but not a Pipeline 2.0 build');
eq(L.loadEmergency(), [], 'a build that cannot go leaves no grant behind');
const sent = E.sendToEmergency('rush', { env: BRETT });
eq([sent.ok, sent.already, sent.emergency.by, !!sent.emergency.at], [true, false, 'Brett', true], 'Brett\'s console click sends it');
eq([P2.isEmergency(get('rush')), get('rush').emergency.by, L.emergencyIds()], [true, 'Brett', ['rush']], 'the build is tagged emergency and holds the slot grant (every gate reads one of the two)');
ok(get('rush').notes.some((x) => /Sent to emergency by Brett/.test(x.text)), 'the build says who sent it');
eq(E.sendToEmergency('rush', { env: BRETT }).already, true, 'sending it twice changes nothing');
eq(T.tableRows(BS.loadStore()).map((x) => [x.id, x.emergency]).slice(0, 1), [['rush', true]], 'the builds table: the Emergency badge, the emergency build first');
E.sendToEmergency('rush2', { env: BRETT });
eq([T.canSendEmergency(T.buildRow(get('rush'))), T.canSendEmergency(T.buildRow(get('beta'))), T.canSendEmergency(T.buildRow(get('old-style')))], [false, true, false], 'the table offers Send to emergency on a Pipeline 2.0 build that is not one yet');

console.log('the emergency lane: past the line, in the emergency slots, beside the active build');
r = advance();
const R = get('rush');
eq([r.active, r.emergency], ['alpha', ['rush', 'rush2']], 'alpha stays the one active build; both emergency builds run in the emergency lane, oldest first');
ok(R.statusLog.some((l) => l.status === 'pulling-main' && /emergency/.test(l.why || '')), 'rush went to pulling-main although alpha is active (it skipped the line)');
eq([inSlot('rush'), R.steps.map((s) => s.status)], [2, ['building', 'building']], 'its two steps are out at once: the 2 emergency slots');
eq([get('rush2').status, inSlot('rush2'), get('rush2').steps[0].status], ['ready', 0, 'ready'], 'the second emergency build is past the line too, but both emergency slots are taken: its step waits');
ok(r.waits.some((w) => w.id === 'rush2' && /no free emergency slot/.test(w.why)), '… and says it waits for an emergency slot');
eq(inSlot('alpha'), 2, 'the orchestrator\'s own 2 slots still hold alpha\'s steps (4 orchestrator + 2 emergency are counted apart)');
eq(get('beta').status, 'split', 'beta (ordinary) still waits for the active place: an emergency build does not open it');
ok(!r.waits.some((w) => /breach/.test(w.why)), 'an emergency build beside the active one is not a breach');
eq(P2.activeBuild(BS.loadStore().builds).others, [], '… for the contract either');
const launches = () => readFileSync(join(tmp, 'launches'), 'utf8').trim().split('\n');
eq(launches().filter((l) => l.startsWith('rush--')).length, 2, 'two emergency launches, no more');

console.log('the pools never lend');
F.stepExit('alpha', 's1', { exit: 0 });
r = advance();
eq([inSlot('rush2'), get('rush2').steps[0].status], [0, 'ready'], 'a freed orchestrator slot is not given to an emergency build');
F.stepExit('rush', 's1', { exit: 0 });
r = advance();
eq([inSlot('rush') + inSlot('rush2'), get('rush2').steps[0].status], [2, 'building'], 'a freed emergency slot starts the waiting emergency step');
eq(launches().filter((l) => l.startsWith('rush')).length, 3, 'three emergency launches in all, never more than 2 at once');
F.stepExit('alpha', 's2', { exit: 0 });
eq(get('alpha').status, 'build-complete', 'alpha completes and goes to the lander');
r = advance();
eq([r.active, get('beta').status, inSlot('beta')], ['alpha', 'split', 0], 'beta still waits for alpha to land; it never borrows a free emergency slot');
land('alpha', 11);
r = advance();
eq([r.active, inSlot('beta')], ['beta', 1], 'once alpha landed, beta becomes the active build in the orchestrator\'s slots');

console.log('an emergency build finishes and hands over to the lander; its grant is taken back when it is done');
F.stepExit('rush', 's2', { exit: 0 }); F.stepExit('rush2', 's1', { exit: 0 });
eq(get('rush').status, 'build-complete', 'every step completed: build-complete (the lander has it, front of its line)');
advance();
eq(L.emergencyIds(), ['rush', 'rush2'], 'the grants stay while they land');
land('rush', 12); land('rush2', 13);
advance();
eq(L.emergencyIds(), [], 'landed: the grants are taken back');

console.log('back to an ordinary build');
send('second', [{ text: 'x', files: ['s'] }]);
advance();
E.sendToEmergency('second', { env: BRETT });
eq(E.list().map((x) => [x.id, x.granted]), [['rush', false], ['rush2', false], ['second', true]], 'list: every emergency build with its grant');
eq(E.clearEmergency('second', { by: 'test' }).cleared, true, 'clear: the tag and the grant go');
eq([P2.isEmergency(get('second')), L.emergencyIds()], [false, []], 'it is an ordinary build again');
r = advance();
eq([r.emergency, get('second').status], [[], 'split'], 'and waits its turn like one');

console.log(`${failed ? 'FAIL' : 'ok'} emergency: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
