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

console.log(`model-policy: ${n} checks passed`);
