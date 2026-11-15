#!/usr/bin/env node
// model-policy@1 — Opus or Fable only, never Sonnet; Fable for foundation work (Brett, Nov 1 2026). One registry, every reader.
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
import { audit, findBuild, launchCheck } from '../cli/model-gate.mjs';
import { readUpgradePolicy } from '../cli/upgrade-policy.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
t('blocked models are coerced UP to the cheapest allowed model, never down', () => {
  assert.equal(P.coerceModel('haiku'), 'opus'); assert.equal(P.coerceModel('sonnet'), 'opus'); assert.equal(P.coerceModel('opus'), 'opus'); assert.equal(P.coerceModel('fable'), 'fable');
  assert.equal(P.coerceModel('nope'), 'opus'); assert.equal(P.coerceModel(undefined, 'fable'), 'fable');
  assert.equal(P.modelId('Sonnet 5.5'), 'claude-opus-5-5');
});
t('modelProblem names the rule', () => {
  assert.equal(P.modelProblem('opus'), ''); assert.match(P.modelProblem('sonnet'), /never Sonnet 5\.5/); assert.match(P.modelProblem('gpt'), /not a Claude model/);
  assert.ok(!P.modelAllowed('haiku') && P.modelAllowed('Fable'));
});
t('foundation work goes to Fable', () => {
  assert.equal(P.modelForWork('new asset type + schema and migration'), 'fable'); assert.equal(P.modelForWork('kernel engine twin'), 'fable');
  assert.equal(P.modelForWork('tidy the settings page copy'), 'opus');
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
  const store = { builds: [LB()] };
  assert.equal(findBuild(store, { name: 'axf-lb' })?.id, 'lb'); assert.equal(findBuild(store, { brief: 'Continue build "L" (lb) — Phase 2' })?.id, 'lb'); assert.equal(findBuild(store, { name: 'other' }), null);
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

console.log(`model-policy: ${n} checks passed`);
