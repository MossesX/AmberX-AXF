#!/usr/bin/env node
/**
 * model-triage@1 in the dispatcher, end to end on a scratch store (no git, no tmux, a fake launcher): every lane gets
 * its model from the VPS triage gate, an explicit override wins, and every decision is kept on the step and in the
 * gate's log.
 *   - the orchestrator lane: steps assigned at the split and again at assigning-models, launched on that model
 *   - overrides: a pin on the step, a step that names its model, Brett's build-wide model
 *   - the emergency lane: the same gate, logged as its own lane
 *   - a step whose session failed asks the gate again (second try) and is relaunched on Fable
 *   - "Fable upgrades need my approval" on: the raise is held, the decision says what the gate wanted
 *   - the rules are data: an edit changes the next decision
 *   - the hand lane (what deploy/claude-headless.sh asks): the brief's own model wins, the launch's model is a floor
 *   node apps/console-web/plugins/build-orchestrator/test/p2-triage.test.mjs
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2triage-'));
const wt = join(tmp, 'wt'); mkdirSync(wt);
const triageDir = join(tmp, 'triage');
const settingsFile = join(tmp, 'claude-settings.json');
const launcher = join(tmp, 'launcher.sh');
// the fake launcher records the session and the model it was started on
writeFileSync(launcher, `#!/bin/bash
name="" model=""
while [ $# -gt 0 ]; do case "$1" in --name) name="$2"; shift 2;; --model) model="$2"; shift 2;; *) shift;; esac; done
echo "$name $model" >> "${tmp}/launches"
echo "started axf-$name in $PWD"
`);
chmodSync(launcher, 0o755);
for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'AXF_BUILD_ID', 'AXF_FABLE_UPGRADE_APPROVAL']) delete process.env[k];
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off',
  AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_DISPATCH_DIR: join(tmp, 'pipe'), AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_SLOTS_TMUX: 'off', AXF_BUILD_LOCK_TMUX: 'off',
  AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_CREW_SAY: 'off', AXF_BUILD_LIMIT: 'off',
  AXF_P2_SLOTS: '6', AXF_P2_PARALLEL: '6', AXF_P2_EMERGENCY_SLOTS: '2', AXF_P2_ALIVE: '',
  AXF_P2_ACCOUNTS: JSON.stringify([{ name: 'a', usable: true, free: 9, running: 0, usageLeft: 0.9 }, { name: 'b', usable: true, free: 9, running: 0, usageLeft: 0.8 }]),
  AXF_MODEL_TRIAGE_DIR: triageDir, AXF_CLAUDE_SETTINGS_FILE: settingsFile,
});
const BS = await import('../../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const E = await import('../../../../../framework/cli/emergency-builds.mjs');
const MT = await import('../../../../../framework/cli/model-triage.mjs');
await import('../pipeline.mjs'); // binds pipeline2.mjs
const F = await import('../pipeline2.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const send = (id, steps) => BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id, title: id, flow: P2.FLOW, steps: steps.map((x, i) => P2.transition({ id: `s${i + 1}`, model: 'Opus', estimate: '5 min', ...x }, 'pending', { kind: 'step', by: 'test' }).rec) }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' });
const advance = () => { process.env.AXF_P2_ALIVE = BS.loadStore().builds.flatMap((b) => b.steps).filter((x) => x.status === 'building' && x.tmux).map((x) => x.tmux).join(','); return F.advance(); };
const launches = () => (existsSync(join(tmp, 'launches')) ? readFileSync(join(tmp, 'launches'), 'utf8').trim().split('\n').map((l) => l.split(' ')) : []);
const launchedOn = (name) => launches().filter((l) => l[0] === name).map((l) => l[1]);
const logged = (q = {}) => MT.decisions({ dir: triageDir, limit: 500, ...q });
const land = (id, pr) => { const at = new Date().toISOString(); for (const s of get(id).steps) if (s.status === 'building') F.stepExit(id, s.id, { exit: 0 }); BS.setFlowStatus(id, 'merging-pr', { by: 'test' }); BS.setFlowStatus(id, 'landed', { by: 'test', extra: { pr: String(pr), mergedAt: at, landed: { pr, sha: 'a'.repeat(40), mergedAt: at, ci: 'success', ciAt: at } } }); };
const models = (id) => get(id).steps.map((s) => [s.model, s.triage?.rule]);

console.log('the orchestrator lane: the gate assigns every step; the orchestrator picks nothing');
send('alpha', [
  { text: 'Change how the gate rule set is stored', files: ['framework/spec/GATE.md'] },
  { text: 'Rename the tab label', files: ['apps/ui/a.tsx'] },
  { text: 'Add a button to the page', files: ['apps/other/b.tsx'] },
  { text: 'Rename the labels everywhere', files: ['p1/a', 'p2/a', 'p3/a', 'p4/a', 'p5/a', 'p6/a', 'p7/a', 'p8/a'] },
  { text: 'CI is red on main: find the cause', files: ['apps/ci/x'] },
]);
advance();
eq(models('alpha'), [['Fable', 'contracts'], ['Opus', 'simple-work'], ['Fable', 'default'], ['Fable', 'size'], ['Fable', 'ci-fix']], 'each step has the gate\'s model and the rule that fired: a contract path, clearly simple work, the default, the size limit, a CI fix');
const A = get('alpha');
ok(A.steps.every((s) => s.triage && s.triage.why && s.triage.lane === 'orchestrator' && s.triage.at), 'every decision is kept on its step (model, rule, why, lane, when)');
eq(A.steps[3].triage.facts.files, 8, 'the measure the rule read is on the decision (8 files against a limit of 8)');
ok(A.notes.some((x) => /Models assigned by the triage gate: s1 Fable \(Contracts: it touches framework\/spec\/GATE\.md\)/.test(x.text)), 'the build\'s note lists the decisions (visible wherever the build is)');
eq(A.steps.map((s) => launchedOn(`alpha--${s.id}`).at(-1)), ['claude-fable-5-2', 'claude-opus-5-5', 'claude-fable-5-2', 'claude-fable-5-2', 'claude-fable-5-2'], 'each step was launched on the model the gate gave it');
const la = logged({ build: 'alpha' });
eq([...new Set(la.map((d) => d.step))].sort(), ['s1', 's2', 's3', 's4', 's5'], 'every step\'s decision is in the gate\'s log');
ok(la.every((d) => d.lane === 'orchestrator' && d.rule && d.model && d.build === 'alpha'), 'each log line names the build, the step, the lane, the model and the rule');
eq(F.statusView().builds.find((b) => b.id === 'alpha').steps.map((s) => s.triage?.rule), ['contracts', 'simple-work', 'default', 'size', 'ci-fix'], 'the status view (the console\'s read) carries the decision');
land('alpha', 1);

console.log('explicit overrides win over every rule');
send('pins', [
  { text: 'Rewrite the store schema', files: ['framework/spec/BUILDS.md'], pin: 'Opus', pinBy: 'Brett' },
  { text: '[Fable] Rename the tab label', files: ['apps/ui/a.tsx'] },
  { text: 'Tidy the docs.\nModel: Fable', files: ['docs/a.md'] },
  { text: 'Rename a label', files: ['apps/ui/c.tsx'], model: 'Fable' },
]);
advance();
eq(models('pins'), [['Opus', 'override'], ['Fable', 'override'], ['Fable', 'override'], ['Fable', 'designer']], 'a pin keeps Opus on contract work; a step that names its model gets it; a Fable the step came with is a suggestion that raises');
ok(/pinned to Opus by Brett/.test(get('pins').steps[0].triage.why), 'the decision says whose pin it was');
eq(launchedOn('pins--s1').at(-1), 'claude-opus-5-5', 'the pinned step really ran on Opus');
land('pins', 2);
// Brett's build-wide model (Claude settings → Builds → Default model): every step, whatever the rules say
writeFileSync(settingsFile, JSON.stringify({ values: { 'builds.defaultModel': 'opus' } }));
send('allopus', [{ text: 'Change the store schema', files: ['framework/spec/BUILDS.md'] }, { text: 'Fix CI', files: ['x'], pin: 'Fable' }]);
advance();
eq(models('allopus'), [['Opus', 'override'], ['Fable', 'override']], 'Brett\'s build-wide model is an override too, and a pin on one step still beats it');
ok(/every build runs on Opus/.test(get('allopus').steps[0].triage.why), 'the decision names the setting');
writeFileSync(settingsFile, JSON.stringify({ values: { 'builds.defaultModel': 'split' } }));
land('allopus', 3);
// the CLI's pin: an override put on a build that is already split
send('latepin', [{ text: 'Rename the tab label', files: ['apps/ui/a.tsx'] }]);
send('holder', [{ text: 'Rename a thing', files: ['h'] }]);
F.advance({ build: 'latepin' });
eq([get('latepin').steps[0].status, get('latepin').steps[0].model], ['building', 'Opus'], 'latepin is out on Opus');
land('latepin', 4);

console.log('a failed session asks the gate again: the second try goes up');
advance();
eq([get('holder').steps[0].model, get('holder').steps[0].triage.rule], ['Opus', 'simple-work'], 'first try: clearly simple work, Opus');
F.stepExit('holder', 's1', { exit: 1 });
advance();
const H = get('holder').steps[0];
eq([H.model, H.triage.rule, H.triage.from, H.status], ['Fable', 'second-try', 'Opus', 'building'], 'the session failed on Opus: the gate\'s second-try rule raised it and it is building again');
eq(launchedOn('holder--s1'), ['claude-opus-5-5', 'claude-fable-5-2'], 'launched on Opus, then on Fable');
ok(logged({ build: 'holder' }).some((d) => d.rule === 'second-try' && d.model === 'Fable'), 'the retry\'s decision is logged');
// a launch that never started is not a failed try of the model
eq(MT.sessionFailures({ statusLog: [{ status: 'failed', why: 'launch on a: boom' }, { status: 'failed', why: 'a hit its usage limit' }, { status: 'failed', why: 'session exit 1' }] }), 1, 'only a session that ran and ended in an error counts as a failed try');
land('holder', 5);

console.log('the emergency lane goes through the same gate');
send('busy', [{ text: 'Rename one', files: ['a'] }]);
send('rush', [{ text: 'Change the builds store schema', files: ['framework/plan/x.mjs'] }, { text: 'Rename the banner label', files: ['apps/ui/z.tsx'] }]);
advance();
E.sendToEmergency('rush', { env: { AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'console' } });
const r = advance();
eq([r.active, r.emergency], ['busy', ['rush']], 'busy is the active build, rush runs beside it in the emergency lane');
eq(models('rush'), [['Fable', 'contracts'], ['Opus', 'simple-work']], 'its steps got their models from the gate');
eq(get('rush').steps.map((s) => s.triage.lane), ['emergency', 'emergency'], 'decided as the emergency lane');
ok(logged({ lane: 'emergency' }).filter((d) => d.build === 'rush').length >= 2, 'and logged as the emergency lane');
eq(get('rush').steps.map((s) => launchedOn(`rush--${s.id}`).at(-1)), ['claude-fable-5-2', 'claude-opus-5-5'], 'launched in the emergency slots on those models');
land('rush', 6); land('busy', 7);

console.log('"Fable upgrades need my approval" on: the raise waits for Brett');
process.env.AXF_FABLE_UPGRADE_APPROVAL = '1';
send('held', [{ text: 'Change the store schema', files: ['framework/spec/BUILDS.md'] }, { text: 'Fix it', files: ['z'], pin: 'Fable' }]);
advance();
const HD = get('held').steps;
eq([HD[0].model, HD[0].triage.rule, HD[0].triage.held, HD[0].triage.wanted], ['Opus', 'contracts', true, 'Fable'], 'the gate wanted Fable (contracts) but the step stays on Opus: held for Brett, and the decision says so');
eq([HD[1].model, HD[1].triage.rule], ['Fable', 'override'], 'a pin is Brett\'s own word: it is not held');
delete process.env.AXF_FABLE_UPGRADE_APPROVAL;
land('held', 8);

console.log('the rules are data: an edit changes the next decision');
MT.commitEdit({ op: 'rule', id: 'simple-work', enabled: false, reason: { title: 'test', description: '' } }, { dir: triageDir, by: 'test' });
MT.commitEdit({ op: 'defaults', model: 'opus' }, { dir: triageDir, by: 'test' });
MT.commitEdit({ op: 'rule', id: 'size', settings: { files: 2 } }, { dir: triageDir, by: 'test' });
send('edited', [{ text: 'Add a button to the page', files: ['apps/other/b.tsx'] }, { text: 'Add two buttons', files: ['m/a', 'm/b'] }]);
advance();
eq(models('edited'), [['Opus', 'default'], ['Fable', 'size']], 'the default is Opus now and the size limit is 2 files');
eq(MT.history({ dir: triageDir }).map((h) => [h.rev, h.what, h.by]), [[3, 'rule size', 'test'], [2, 'defaults', 'test'], [1, 'rule simple-work', 'test']], 'every rule change is in the history (who, what, the revision)');
let bad = ''; try { MT.commitEdit({ op: 'rule', id: 'size', settings: { files: 'many' } }, { dir: triageDir, by: 'test' }); } catch (e) { bad = `${e.code}:${e.message}`; }
ok(/^invalid:size\.files: a whole number/.test(bad) && MT.loadConfig({ dir: triageDir }).rev === 3, 'a bad value is refused and nothing changes');
MT.commitEdit({ op: 'reset' }, { dir: triageDir, by: 'test' });
eq([MT.loadConfig({ dir: triageDir }).defaults.model, MT.loadConfig({ dir: triageDir }).rules.find((x) => x.id === 'size').settings.files], ['fable', 8], 'reset puts the starting rules back');
land('edited', 9);

console.log('the hand lane (what deploy/claude-headless.sh asks before it starts a session)');
const hand = (o) => MT.triageLaunch({ lane: 'hand', ...o });
let h = hand({ name: 'hand-a', text: '# Tidy the docs\n\nRename two labels.', requested: 'claude-opus-5-5' });
eq([h.key, h.id, h.decision.rule], ['opus', 'claude-opus-5-5', 'simple-work'], 'clearly simple work asked for on Opus stays on Opus');
h = hand({ name: 'hand-b', text: '# Tidy the docs\n\nRename two labels.', requested: 'claude-fable-5-2' });
eq([h.key, h.decision.rule], ['fable', 'requested'], 'the model the launch named is a floor: the gate never lowers it');
h = hand({ name: 'hand-c', text: '# Move the builds store to a new schema\n\nDo it.', requested: 'opus' });
eq([h.key, h.decision.rule], ['fable', 'contracts'], 'the gate raises a launch that asked for less than the work needs');
h = hand({ name: 'hand-d', text: '# Move the builds store to a new schema\n\nModel: Opus\n\nDo it.', requested: 'fable' });
eq([h.key, h.decision.rule], ['opus', 'override'], 'a brief that names its model wins over the rules and the request');
h = hand({ name: 'hand-e', text: '# Hand build: Gates UI rebuild (Earl, Fable)\n\nRename the labels.', requested: 'opus' });
eq([h.key, h.decision.rule], ['fable', 'override'], 'a title that ends with the model is the brief saying so');
h = hand({ name: 'hand-f', text: '# Model triage\n\nThe gate picks which model each step runs on (Opus, Fable, ...), a brief that says Fable wins.\nRename labels.', requested: 'opus' });
eq([h.key, h.decision.rule], ['opus', 'simple-work'], 'talking about the models is not naming one');
eq(logged({ lane: 'hand' }).map((d) => d.name).sort(), ['hand-a', 'hand-b', 'hand-c', 'hand-d', 'hand-e', 'hand-f'], 'every hand launch is in the log under its session name');
MT.commitEdit({ op: 'defaults', handRequest: 'pin' }, { dir: triageDir, by: 'test' });
eq(hand({ name: 'hand-g', text: '# Move the builds store to a new schema', requested: 'opus' }).decision.rule, 'override', 'handRequest = pin: the launch\'s own model is an override');
MT.commitEdit({ op: 'reset' }, { dir: triageDir, by: 'test' });

console.log(failed ? `\n${failed} of ${n} failed` : `\nok p2-triage: ${n}/${n}`);
process.exit(failed ? 1 : 0);
