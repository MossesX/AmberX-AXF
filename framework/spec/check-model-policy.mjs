#!/usr/bin/env node
// model-policy@1 — Opus or Fable only, never Sonnet (Brett, Nov 1 2026); Fable for anything that might need it, Opus only for
// work that clearly doesn't, unsure = Fable, an unknown model is an error (Brett, Nov 21 2026). One registry, every reader.
//   node framework/spec/check-model-policy.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/model-policy.mjs';
import { JOB_DEFAULTS, JOB_ENUMS, jobTypeErrors, normalizeJobType } from '../core/engines/job-type-rules.mjs';
import { MODELS as STORE_MODELS } from '../plan/builds-store-core.mjs';
import { suggestModel } from '../cli/plan.mjs';
import * as SW from '../core/model-switch.mjs';
import { audit, findBuild, launchCheck, stepOf } from '../cli/model-gate.mjs';
import { readUpgradePolicy } from '../cli/upgrade-policy.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('the policy: Opus or Fable allowed, nothing else; default Opus, foundation Fable', () => {
  assert.deepEqual([...P.ALLOWED_MODELS], ['opus', 'fable']);
  assert.equal(P.DEFAULT_MODEL, 'opus'); assert.equal(P.FOUNDATION_MODEL, 'fable');
  assert.ok(P.ALLOWED_MODELS.every((m) => P.MODEL_TIERS.includes(m) && P.MODEL_IDS[m] && P.MODEL_LABELS[m]));
});
t('the snapshot Python readers use matches the registry (run axf schemas)', () => assert.deepEqual(read('framework/schemas/model-policy.json'), P.MODEL_POLICY));
t('modelKey reads every spelling', () => {
  assert.equal(P.modelKey('Opus'), 'opus'); assert.equal(P.modelKey('[Fable] do x'), 'fable'); assert.equal(P.modelKey('claude-sonnet-5-5'), 'sonnet'); assert.equal(P.modelKey('gpt'), '');
});
const FABLE_SPELLINGS = ['fable', 'Fable', 'FABLE', ' Fable ', '[Fable]', 'Fable 5.1', 'Fable 5.2', 'claude-fable-5-1', 'claude-fable-5-2', 'claude-fable-5-2[1m]', 'CLAUDE-FABLE-6-0', 'claude-fable-latest'];
const UNKNOWN_MODELS = ['gpt', 'gpt-5', 'nope', 'claude-3', 'auto', 'best', '<synthetic>', 'fabel', 'opsu'];
t('any spelling of Fable is Fable: key, step name, id, allowed, coerced', () => {
  for (const s of FABLE_SPELLINGS) {
    assert.equal(P.modelKey(s), 'fable', s); assert.equal(P.requireModel(s), 'fable', s); assert.equal(P.coerceModel(s), 'fable', s);
    assert.equal(P.stepModelName(s), 'Fable', s); assert.equal(P.modelId(s), 'claude-fable-5-2', s); assert.ok(P.modelAllowed(s), s); assert.equal(P.modelProblem(s), '', s);
  }
  for (const s of ['opus', 'Opus', 'OPUS', 'Opus 5.5', 'claude-opus-5-5', '[Opus]']) { assert.equal(P.requireModel(s), 'opus', s); assert.equal(P.stepModelName(s), 'Opus', s); assert.equal(P.modelId(s), 'claude-opus-5-5', s); }
  assert.deepEqual([...P.STEP_MODEL_NAMES], ['Opus', 'Fable']);
});
t('"Fable" resolves to the current Fable model, claude-fable-5-2 (not 5.1)', () => {
  assert.equal(P.MODEL_IDS.fable, 'claude-fable-5-2'); assert.equal(P.MODEL_LABELS.fable, 'Fable 5.2'); assert.equal(P.modelId('Fable'), 'claude-fable-5-2');
  assert.equal(P.modelId('claude-fable-5-1'), 'claude-fable-5-2', 'an old pinned id runs the current Fable');
  assert.ok(!JSON.stringify(P.MODEL_POLICY).includes('fable-5-1') && !JSON.stringify(P.MODEL_POLICY).includes('Fable 5.1'), 'no 5.1 left in the registry');
  assert.equal(read('framework/schemas/model-policy.json').ids.fable, 'claude-fable-5-2', 'the snapshot Python readers use');
});
t('an unknown model is an error, never a silent Opus', () => {
  for (const s of UNKNOWN_MODELS) {
    assert.equal(P.modelKey(s), '', s);
    for (const strict of [P.requireModel, P.modelId, P.stepModelName, (m) => P.requireModel('', { fallback: m }), (m) => P.stepModelName('', { fallback: m }), (m) => P.workModel('rename a file', { floor: m }), (m) => P.workModel('rename a file', { pin: m })]) {
      assert.throws(() => strict(s), (e) => e instanceof P.ModelError && e.code === 'model-unknown' && e.message.includes('not a Claude model'), s);
    }
    assert.notEqual(P.coerceModel(s), 'opus', `${s}: the tolerant reader never says Opus`); assert.equal(P.coerceModel(s), 'fable', s); assert.equal(P.coerceModel(s, 'opus'), 'fable', `${s}: a fallback is for a missing model only`);
    assert.ok(!P.modelAllowed(s), s); assert.match(P.modelProblem(s), /not a Claude model/, s);
    assert.equal(P.modelRank(s), -1); assert.equal(P.switchKind(s, 'Opus'), '');
  }
  for (const none of ['', '   ', null, undefined]) {
    assert.throws(() => P.requireModel(none), (e) => e instanceof P.ModelError && e.code === 'model-missing', 'no model is not Opus either');
    assert.throws(() => P.modelId(none), P.ModelError);
    assert.equal(P.requireModel(none, { fallback: 'Fable' }), 'fable'); assert.equal(P.coerceModel(none), 'opus', 'missing (not unknown) reads as the default'); assert.equal(P.coerceModel(none, 'fable'), 'fable');
    assert.equal(P.stepModelName(none), 'Fable', 'a step with no model and no words: unsure = Fable'); assert.equal(P.stepModelName(none, { text: 'rename the header' }), 'Opus'); assert.equal(P.stepModelName(none, { fallback: 'opus' }), 'Opus');
  }
});
t('blocked models are coerced UP to the cheapest allowed model, never down', () => {
  assert.equal(P.coerceModel('haiku'), 'opus'); assert.equal(P.coerceModel('sonnet'), 'opus'); assert.equal(P.coerceModel('opus'), 'opus'); assert.equal(P.coerceModel('fable'), 'fable');
  assert.equal(P.coerceModel(undefined, 'fable'), 'fable');
  assert.equal(P.modelId('Sonnet 5.5'), 'claude-opus-5-5'); assert.equal(P.requireModel('haiku'), 'opus'); assert.equal(P.stepModelName('Sonnet'), 'Opus');
});
t('modelProblem names the rule', () => {
  assert.equal(P.modelProblem('opus'), ''); assert.match(P.modelProblem('sonnet'), /never Sonnet 5\.5/); assert.match(P.modelProblem('gpt'), /not a Claude model/);
  assert.ok(!P.modelAllowed('haiku') && P.modelAllowed('Fable'));
});
t('foundation work goes to Fable', () => {
  assert.equal(P.modelForWork('new asset type + schema and migration'), 'fable'); assert.equal(P.modelForWork('kernel engine twin'), 'fable');
  assert.equal(P.modelForWork('tidy the settings page copy'), 'opus');
});
// Brett's model rule (Nov 21 2026): Fable for anything that might need it, Opus only when it clearly doesn't, unsure = Fable.
const FABLE_WORK = {
  audits: ['Audit the console plugins', 'Deep audit of the handoff path'],
  debugging: ['Debug the voice overlay', 'Fix the bug where the tab closes itself', 'The Send dialog crashes on empty plans', 'Find why step s3 is stuck', 'Failing test in check-card', 'Fix the regression in the nav'],
  'root-cause work': ['Root-cause the 502s on deploy', 'Find the root cause of the double commit', 'Investigate the slow first paint', 'Diagnose the heartbeat gap'],
  'pipeline / orchestrator / lander / builds-store code': ['Change the pipeline status rollup', 'Pipeline 2.0: retry ladder', 'Orchestrator brief gets the plan items', 'Dispatcher picks the account', 'Auto-lander re-checks main', 'Lander: hold on red', 'Builds store: status derivation', 'builds-store-core normStep', 'Watchdog requeue rule', 'Edit _claude/builds/store.json reader'],
  'merges and conflicts': ['Merge main into the branch', 'Resolve the merge conflict in ui.tsx', 'Fix conflicts after the rebase', 'Rebase onto main', 'Merge queue ordering'],
  'CI fixes': ['Fix CI', 'CI is red on main', 'ci: speed up the check job', 'Fix the GitHub Actions workflow', 'Add a workflow step for the spec checks'],
  security: ['Security review of the relay', 'Rotate the vault key', 'Auth for the phone pairing', 'Stop the API key leaking into logs', 'Secrets scan', 'Harden the access token check', 'Fix the permission check on approvals'],
  Android: ['Android: approvals screen', 'Kotlin twin of the validator', 'Fix the Gradle build', 'Sign the APK'],
  architecture: ['Architecture for live sync', 'Redesign the plugin loader', 'Refactor the session store', 'Rewrite the tab manager'],
  'judgment calls': ['Decide which store owns the status', 'Make the judgment call on retries', 'Weigh the trade-offs of polling', 'A decision on the cache key'],
  'foundation work': ['Write the JSON schema', 'New asset type', 'Data model for notes', 'Contract for the build hook', 'Kernel scheduler', 'Engine rules', 'Regenerate fixtures', 'Store migration', 'Cross-app protocol', 'The spec for plan-build'],
  'unsure (no word either way)': ['Add a button', 'Notes and tasks, round 2', 'Make the list faster', 'Phone connect tabs', 'Wire the Send dialog to the server', 'x', ''],
  'a Fable word next to an Opus word (might need it wins)': ['Rename the pipeline status field', 'Docs for the merge queue', 'Copy edit the security page', 'Move the files of the builds store', 'Simple styling fix that breaks on Android', 'Boilerplate for a new engine'],
};
const OPUS_WORK = {
  renames: ['Rename the Notes tab to Notebook', 'Renaming the helper to formatDate'],
  'copy edits': ['Copy edit the welcome page', 'Tidy the settings page copy', 'Fix the typo in the footer', 'Reword the empty state', 'Change the button label to Send'],
  'moving files': ['Move the files into src/lib', 'Move files to the shared folder', 'Moving the folder under web/'],
  'simple styling': ['Simple styling of the header', 'Fix the toolbar padding', 'Tweak the card margin and spacing', 'Change the badge colour', 'CSS for the chip row', 'Swap the icon'],
  docs: ['Update the README', 'Docs for the notes plugin', 'Write the documentation for skins', 'Add comments to the date helper', 'Changelog entry'],
  boilerplate: ['Boilerplate for the new plugin page', 'Scaffold the settings tab', 'Stub the empty page'],
};
t('Fable for anything that might need it; unsure = Fable', () => {
  for (const [kind, lines] of Object.entries(FABLE_WORK)) for (const text of lines) {
    const r = P.workModel(text); assert.equal(r.model, 'fable', `${kind}: "${text}" → ${r.model} (${r.why})`); assert.equal(P.modelForWork(text), 'fable'); assert.equal(P.stepModelName('', { text }), 'Fable');
  }
  assert.equal(P.MODEL_POLICY.work.unsure, 'fable'); assert.match(P.workModel('Add a button').why, /unsure/); assert.equal(P.workModel('Fix CI').word, 'ci');
});
t('Opus only for work that clearly does not need Fable', () => {
  for (const [kind, lines] of Object.entries(OPUS_WORK)) for (const text of lines) {
    const r = P.workModel(text); assert.equal(r.model, 'opus', `${kind}: "${text}" → ${r.model} (${r.why})`); assert.ok(r.word, 'names the word that decided'); assert.equal(P.stepModelName('', { text }), 'Opus');
  }
});
t('words match whole words only, in any case', () => {
  assert.equal(P.modelForWork('Change the special-case padding'), 'opus', '"spec" is not in "special"'); assert.equal(P.modelForWork('Rename the circle icon'), 'opus', '"ci" is not in "circle"');
  assert.equal(P.modelForWork('Reword the authors line'), 'opus', '"auth" is not in "authors"'); assert.equal(P.modelForWork('RENAME THE TAB'), 'opus'); assert.equal(P.modelForWork('FIX ci'), 'fable');
});
t('one word list: the registry holds it, the exports are built from it, and the snapshot carries it', () => {
  const w = P.MODEL_POLICY.work;
  assert.ok(Array.isArray(w.fable) && w.fable.length > 40 && Array.isArray(w.opus) && w.opus.length > 10);
  for (const frag of [...w.fable, ...w.opus]) assert.doesNotThrow(() => new RegExp(frag, 'i'), frag);
  assert.equal(new Set(w.fable).size, w.fable.length, 'no duplicate Fable words'); assert.equal(new Set(w.opus).size, w.opus.length, 'no duplicate Opus words');
  for (const frag of w.fable) assert.ok(P.FABLE_WORDS.source.includes(frag), frag);
  for (const frag of w.opus) assert.ok(P.OPUS_WORDS.source.includes(frag), frag);
  assert.equal(P.FOUNDATION_WORDS, P.FABLE_WORDS, 'the old name is the same list, not a second one');
  assert.deepEqual(read('framework/schemas/model-policy.json').work, w);
  for (const k of ['audits', 'debugging', 'root-cause', 'pipeline', 'orchestrator', 'lander', 'builds-store', 'merges', 'conflicts', 'CI', 'security', 'Android', 'architecture', 'judgment', 'renames', 'copy edits', 'moving files', 'styling', 'docs', 'boilerplate', 'Unsure = Fable', 'never a silent Opus']) assert.ok(P.MODEL_POLICY.rule.includes(k), `the rule names ${k}`);
});
t('a build-level model is a floor and a step pin is kept: words raise, nothing lowers', () => {
  assert.equal(P.modelForWork('Rename the tab', { floor: 'Fable' }), 'fable', '"all Fable" build'); assert.match(P.workModel('Rename the tab', { floor: 'FABLE' }).why, /build is set to Fable/);
  assert.equal(P.modelForWork('Rename the tab', { floor: 'opus' }), 'opus'); assert.equal(P.modelForWork('Fix CI', { floor: 'opus' }), 'fable', 'an Opus floor never lowers Fable work');
  assert.equal(P.modelForWork('Rename the tab', { floor: '' }), 'opus', 'no floor ("auto")'); assert.equal(P.modelForWork('Rename the tab', { pin: 'claude-fable-5-2' }), 'fable', 'a step pinned to Fable stays Fable');
  assert.equal(P.modelForWork('Fix CI', { pin: 'Opus' }), 'fable', 'an Opus pin on Fable work is raised');
  assert.equal(P.higherModel('Opus', 'fable'), 'fable'); assert.equal(P.higherModel('Fable', 'opus'), 'fable'); assert.equal(P.higherModel('', 'opus'), 'opus'); assert.equal(P.higherModel('gpt', ''), '');
});

// readers
t('job-type@1 takes its models from the policy', () => {
  assert.deepEqual([...JOB_ENUMS.model], [...P.ALLOWED_MODELS]); assert.equal(JOB_DEFAULTS.model, P.DEFAULT_MODEL);
  assert.equal(normalizeJobType({ model: 'sonnet' }).model, 'opus');
  assert.ok(jobTypeErrors('job-type', { specialty: 'x', model: 'haiku', budget: { tokens: 5000 }, trigger: { kind: 'on-demand' }, brief: 'b' }).some((e) => /never Haiku/.test(e)));
});
t('every shipped job type runs on an allowed model', () => {
  const dir = join(ROOT, 'framework/assets/job-type');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { const a = read(`framework/assets/job-type/${f}`); assert.ok(P.modelAllowed(a.data.model), `${f}: ${a.data.model}`); }
});
t('the asset-types registry enum for job-type is the allowed list', () => assert.deepEqual(read('framework/schemas/asset-types.json').types['job-type'].enums.model, [...P.ALLOWED_MODELS]));
t('the builds store knows only Fable and Opus steps', () => assert.deepEqual([...STORE_MODELS].sort(), ['Fable', 'Opus']));
t('the plan model picker never suggests Sonnet', () => {
  for (const f of [{ id: 'x.a', title: 'Icon pack', effort: 'S' }, { id: 'x.b', title: 'Kernel migration', area: 'Kernel' }, { id: 'x.c', title: 'Server auth' }, { id: 'x.d', title: 'Anything else' }]) {
    assert.ok(P.modelAllowed(suggestModel(f).model), `${f.title}: ${suggestModel(f).model}`);
  }
});
t('every agent roster runs only on allowed models', () => {
  // found, not named: a plugin is never referenced by folder outside itself (plugin-lifecycle@1); none installed = nothing to check
  const plugins = 'apps/console-web/plugins';
  const rosters = readdirSync(join(ROOT, plugins)).map((f) => `${plugins}/${f}/agents/roster.json`).filter((f) => existsSync(join(ROOT, f)));
  for (const f of rosters) for (const a of read(f).agents) for (const m of a.models) assert.ok(P.modelAllowed(m), `${f} ${a.id}: ${m}`);
});

// model switches (Brett, Nov 3 2026): "You can downgrade, but you can't upgrade."
t('one ordered ranking: Fable above Opus; upgrades need approval, downgrades are recorded', () => {
  assert.ok(P.modelRank('fable') > P.modelRank('opus')); assert.equal(P.modelRank('Opus 5.5'), P.MODEL_TIERS.indexOf('opus')); assert.equal(P.modelRank('gpt'), -1);
  assert.equal(P.switchKind('Opus', 'Fable'), 'upgrade'); assert.equal(P.switchKind('Fable', 'Opus'), 'downgrade'); assert.equal(P.switchKind('opus', 'Opus'), 'same'); assert.equal(P.switchKind('x', 'Opus'), '');
  assert.deepEqual([P.MODEL_POLICY.switches.upgrade, P.MODEL_POLICY.switches.downgrade], ['approval', 'record']);
});
t('who may approve: never a Claude session, headless build or agent; Brett via console or axHub', () => {
  assert.ok(SW.nonHumanSource({ CLAUDECODE: '1' })); assert.ok(SW.nonHumanSource({ AXF_SURFACE: 'headless' })); assert.ok(SW.nonHumanSource({ AXF_SESSION: 'build:x' }));
  assert.ok(SW.nonHumanSource({ AI_AGENT: 'claude-code' })); assert.ok(SW.nonHumanSource({}, { 'X-Axhub-Session': 'agent:Vinny' })); assert.equal(SW.nonHumanSource({}, { 'x-axhub-session': 'console' }), '');
  assert.equal(SW.approverFrom({ CLAUDECODE: '1', AXF_APPROVER: 'brett', AXF_APPROVER_VIA: 'console' }).ok, false, 'a session setting the approver itself is still refused');
  assert.equal(SW.approverFrom({ AXF_APPROVER: 'brett', AXF_APPROVER_VIA: 'self' }).ok, false);
  assert.deepEqual(SW.approverFrom({ AXF_APPROVER: 'brett', AXF_APPROVER_VIA: 'axhub' }), { ok: true, by: 'brett', via: 'axhub' });
});
const LB = (approvals = [], done = 1) => ({ id: 'lb', steps: [{ id: 's1', model: 'Opus', done: done >= 1 }, { id: 's2', model: 'Fable', done: false }, { id: 's3', model: 'Opus', done: false }], approvals });
t('launch gate: an unapproved upgrade phase or a model above the step is refused; downgrades and Brett-approved upgrades start', () => {
  assert.equal(launchCheck(LB(), 'fable').ok, false, 'phase 2 upgrades Opus → Fable, not approved');
  assert.match(launchCheck(LB(), 'fable').why, /request-upgrade lb 1/);
  assert.equal(launchCheck(LB([{ phase: 1, from: 'Opus', to: 'Fable', selfApproved: true }]), 'fable').ok, false, 'a self-approval does not count');
  assert.equal(launchCheck(LB([{ phase: 1, from: 'Opus', to: 'Fable', by: 'brett', via: 'console' }]), 'fable').ok, true);
  assert.equal(launchCheck(LB([{ phase: 1, from: 'Opus', to: 'Fable', by: 'brett', via: 'console' }]), 'opus').ok, true, 'running a Fable step on Opus is a downgrade');
  assert.equal(launchCheck(LB([], 0), 'fable').ok, false, 'phase 1 is pinned to Opus: launching on Fable is an upgrade');
  assert.equal(launchCheck(LB([], 0), 'opus').ok, true); assert.equal(launchCheck(null, 'fable').ok, true, 'not an orchestrator build');
  for (const s of ['FABLE', 'claude-fable-5-2', 'Fable 5.2']) assert.equal(launchCheck(LB([{ phase: 1, from: 'Opus', to: 'Fable', by: 'brett', via: 'console' }]), s).ok, true, `${s} is Fable`);
  const store = { builds: [LB()] };
  assert.equal(findBuild(store, { name: 'axf-lb' })?.id, 'lb'); assert.equal(findBuild(store, { brief: 'Continue build "L" (lb) — Phase 2' })?.id, 'lb'); assert.equal(findBuild(store, { name: 'other' }), null);
});
t('launch gate: an unknown model is refused for every launch, build or not; no model is nothing to compare', () => {
  for (const s of UNKNOWN_MODELS) for (const b of [null, LB([], 0)]) {
    const r = launchCheck(b, s); assert.equal(r.ok, false, `${s} ${b ? 'build' : 'no build'}`); assert.equal(r.unknown, true); assert.match(r.why, /not a Claude model.*never a silent Opus/);
  }
  assert.equal(launchCheck(null, '').ok, true); assert.equal(launchCheck(LB([], 0), '').ok, true); assert.equal(launchCheck(LB([], 0), undefined).ok, true);
});
t('model-gate CLI: resolve prints the current id for any spelling and fails on an unknown model; launch refuses it with exit 3', () => {
  const gate = (...a) => spawnSync(process.execPath, [join(ROOT, 'framework/cli/model-gate.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, AXF_MODEL: '', AXF_BUILD_ID: '', AXF_BUILD_STEP: '' } });
  for (const s of ['fable', 'Fable', 'FABLE', 'claude-fable-5-1', 'claude-fable-5-2']) { const r = gate('resolve', s); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'claude-fable-5-2', s); }
  assert.deepEqual(JSON.parse(gate('resolve', 'Opus', '--json').stdout), { ok: true, key: 'opus', label: 'Opus 5.5', id: 'claude-opus-5-5' });
  for (const s of ['gpt', '']) { const r = gate('resolve', s); assert.equal(r.status, 2, `${s}: ${r.stdout}`); assert.equal(r.stdout.trim(), '', 'no id printed'); assert.match(r.stderr, /model-gate: /); }
  const w = JSON.parse(gate('for-work', 'Fix', 'the', 'merge', 'conflict', '--json').stdout); assert.deepEqual([w.model, w.id, w.word], ['fable', 'claude-fable-5-2', 'merge']);
  assert.equal(JSON.parse(gate('for-work', 'Rename the tab', '--json').stdout).model, 'opus'); assert.equal(JSON.parse(gate('for-work', 'Rename the tab', '--floor', 'Fable', '--json').stdout).model, 'fable');
  const l = gate('launch', '--model', 'gpt-5', '--name', 'no-such-build-for-the-check'); assert.equal(l.status, 3, l.stdout + l.stderr); assert.match(l.stdout, /^refused: .*not a Claude model/);
});
t('audit lists upgrades with who approved them (Brett or not)', () => {
  const rows = audit({ builds: [LB([{ phase: 1, from: 'Opus', to: 'Fable', at: 'a' }]), { id: 'ok', steps: [{ id: 's1', model: 'Opus' }, { id: 's2', model: 'Fable' }], approvals: [{ phase: 1, from: 'Opus', to: 'Fable', at: 'b', by: 'brett', via: 'axhub' }] }] });
  assert.deepEqual(rows.map((r) => [r.build, r.kind, r.human]), [['lb', 'upgrade', false], ['ok', 'upgrade', true]]);
});

// Fable upgrades need my approval (owner-only Claude setting builds.fableUpgradeApproval, default off; Brett, Nov 4 2026)
t('upgrade policy: strict until set; off = upgrade phases clear, launch on the pinned model; the pin still holds', () => {
  assert.equal(SW.upgradePolicy().approvalRequired, true, 'the pure module is strict until an entry point reads the setting');
  SW.setUpgradePolicy({ approvalRequired: false, source: 'check' });
  try {
    assert.equal(SW.heldSteps(LB()).size, 0); assert.equal(launchCheck(LB(), 'fable').ok, true, 'phase 2 runs on Fable by itself');
    assert.match(launchCheck(LB(), 'fable').why, /no approval needed/);
    assert.equal(launchCheck(LB([], 0), 'fable').ok, false, 'an Opus step is still not launched on Fable: raise the step first');
    assert.match(launchCheck(LB([], 0), 'fable').why, /set its steps to Fable/); assert.match(SW.switchRule(), /need no approval/);
  } finally { SW.setUpgradePolicy({ approvalRequired: true, source: 'check' }); }
  assert.equal(SW.heldSteps(LB()).size, 1); assert.equal(SW.switchRule(), SW.SWITCH_RULE);
});
t('upgrade policy reader: setting value, default off, env can only make it stricter', () => {
  const d = mkdtempSync(join(tmpdir(), 'upol-')); const f = join(d, 'settings.json');
  assert.equal(readUpgradePolicy({ AXF_CLAUDE_SETTINGS_FILE: f }).approvalRequired, false, 'no document = default off');
  writeFileSync(f, JSON.stringify({ values: { [SW.UPGRADE_SETTING]: true } }));
  assert.equal(readUpgradePolicy({ AXF_CLAUDE_SETTINGS_FILE: f }).approvalRequired, true, 'Brett turned it on');
  assert.equal(readUpgradePolicy({ AXF_CLAUDE_SETTINGS_FILE: f, AXF_FABLE_UPGRADE_APPROVAL: '0' }).approvalRequired, true, 'the environment never turns it off');
  writeFileSync(f, JSON.stringify({ values: { [SW.UPGRADE_SETTING]: false } }));
  assert.equal(readUpgradePolicy({ AXF_CLAUDE_SETTINGS_FILE: f, AXF_FABLE_UPGRADE_APPROVAL: '1' }).approvalRequired, true, 'the environment may make it stricter');
});

t('pipeline-2 steps: a launch is judged by its own step (raised to Fable = Fable allowed), never by phase 1', () => {
  const b = { id: 'pb', flow: 'pipeline-2', approvals: [], steps: [{ id: 's1', model: 'Opus', text: 'a' }, { id: 's8', model: 'Fable', text: 'b' }] };
  assert.equal(stepOf(b, { name: 'pb--s8' })?.id, 's8', 'step from the <build>--<step> name');
  assert.equal(stepOf(b, { step: 's1', name: 'pb--s8' })?.id, 's1', 'AXF_BUILD_STEP wins');
  assert.equal(stepOf({ ...b, flow: '' }, { name: 'pb--s8' }), null, 'builds@1: no step pin');
  assert.equal(launchCheck(b, 'fable', { step: stepOf(b, { name: 'pb--s8' }) }).ok, true, 's8 was raised to Fable: Fable is its own model');
  assert.equal(launchCheck(b, 'fable', { step: stepOf(b, { name: 'pb--s1' }) }).ok, false, 's1 is Opus: Fable is an upgrade');
  assert.equal(launchCheck(b, 'opus', { step: stepOf(b, { name: 'pb--s8' }) }).ok, true, 'a downgrade is fine');
  assert.equal(findBuild({ builds: [b] }, { name: 'pb--s8' })?.id, 'pb', 'the build from the step name');
});

console.log(`model-policy: ${n} checks passed`);
