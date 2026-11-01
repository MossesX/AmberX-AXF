/**
 * job-type@1 (core/engines/job-type-rules.mjs): the type is registered (types, optional, late-optional, asset-types
 * order, never rolled), the fixture replays (normalize, errors, brief rendering, schedules), both validators give the
 * same messages, every starter validates, its brief only uses declared placeholders and its UI Review group carries a
 * timestamp, and the schema carries every field. Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-job-type.mts            (--write regenerates spec/fixtures/job-type.json)
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { JOB_ENUMS, jobInputs, jobTypeErrors, nextRun, normalizeJobType, placeholders, renderJobBrief, timeWords } from '../core/engines/job-type-rules.mjs';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- registered everywhere ---- */
ok(ASSET_TYPES.includes('job-type'), 'job-type is an asset type');
ok(OPTIONAL_TYPES.includes('job-type'), 'job-type is optional (older apps still validate)');
const spec = read('framework/schemas/asset-types.json');
eq(Object.keys(spec.types), [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
eq(Object.keys(spec.types).at(-1), 'uac-policy', 'uac-policy stays last');
eq(spec.types['job-type'].enums.model, [...JOB_ENUMS.model], 'registry model enum = the rules file');
eq(spec.types['job-type'].roll, { slot: false, asset: false }, 'never rolled');

/* ---- the contract: computed here, replayed from the fixture ---- */
const AT = '2026-11-01T07:05:00.000Z';
const good = { specialty: 'site-checks', model: 'sonnet', budget: { tokens: 100000, maxTurns: 10 }, trigger: { kind: 'schedule', every: '6h' }, inputs: [{ id: 'sites', label: 'Sites', default: 'a.example b.example' }, { id: 'who', label: 'Who', required: true }], brief: 'Check {{sites}} for {{who}} on {{date}}.', outputs: { report: 'r/{{jobType}}/{{stamp}}.md', uiReviewGroup: 'Checks - {{when}}' } };
const cases: Record<string, [string, unknown]> = {
  ok: ['job-type', good],
  'not-an-object': ['job-type', 'nope'],
  'bad-core': ['job-type', { specialty: 'Site Checks', model: 'gpt', budget: { tokens: 5 }, trigger: { kind: 'cron' }, brief: '' }],
  'schedule-without-time': ['job-type', { ...good, trigger: { kind: 'schedule' } }],
  'event-without-name': ['job-type', { ...good, trigger: { kind: 'event' } }],
  'undeclared-placeholder': ['job-type', { ...good, brief: 'Do {{thing}} at {{when}}' }],
  'bad-outputs': ['job-type', { ...good, outputs: { report: '../../etc/passwd', uiReviewGroup: 'Shots' } }],
  'shadowed-input': ['job-type', { ...good, inputs: [{ id: 'date' }, { id: 'x' }, { id: 'x' }] }],
  'other-type': ['button', { specialty: 'Nope' }],
};
const computed = {
  defaults: normalizeJobType(null),
  normalized: { good: normalizeJobType(good), junk: normalizeJobType({ specialty: 'X', model: 'gpt', budget: { tokens: 1.5 }, trigger: { kind: 'schedule', every: 'often' }, extra: true }) },
  errors: Object.fromEntries(Object.entries(cases).map(([k, [t, d]]) => [k, jobTypeErrors(t, d)])),
  inputs: { filled: jobInputs(normalizeJobType(good), { who: 'Brett', bogus: 'x' }), missing: jobInputs(normalizeJobType(good), {}) },
  time: timeWords(AT),
  brief: renderJobBrief(normalizeJobType({ ...good, readOnly: true, command: 'run {{sites}}' }), { sites: 'a.example', who: 'Brett' }, { at: AT, agent: 'paulie', agentName: 'Ping Paulie', jobType: 'site-check', jobName: 'Site health check', runId: 'job-1' }),
  next: {
    onDemand: nextRun({ kind: 'on-demand', every: '', at: '', event: '' }, '', AT),
    everyNever: nextRun({ kind: 'schedule', every: '6h', at: '', event: '' }, '', AT),
    everyAfter: nextRun({ kind: 'schedule', every: '6h', at: '', event: '' }, '2026-11-01T03:00:00.000Z', AT),
    dailyBefore: nextRun({ kind: 'schedule', every: '', at: '09:00', event: '' }, '2026-10-31T09:00:00.000Z', AT),
    dailyNever: nextRun({ kind: 'schedule', every: '', at: '06:00', event: '' }, '', AT),
  },
};
const FX = 'framework/spec/fixtures/job-type.json';
if (process.argv.includes('--write')) writeFileSync(new URL(FX, root), `${JSON.stringify({ $axf: 'fixture@1', about: 'job-type@1 rules (core/engines/job-type-rules.mjs); regenerate: npx -y tsx framework/spec/check-job-type.mts --write', at: AT, cases, ...computed }, null, 1)}\n`);
const fx = read(FX);
for (const k of Object.keys(computed) as (keyof typeof computed)[]) eq(computed[k], fx[k], `fixture: ${k}`);
eq(fx.errors.ok, [], 'a good job type has no errors');
ok(fx.errors['bad-core'].length >= 4, 'bad specialty, budget, trigger and brief are all named (the model enum is the registry\'s)');
ok(fx.errors['undeclared-placeholder'].some((e: string) => e.includes('{{thing}}')), 'undeclared placeholder named');
ok(fx.errors['bad-outputs'].length === 2, 'path escape + group without a timestamp');
eq(fx.errors['other-type'], [], 'other types are not checked');
eq(fx.inputs.missing.missing, ['who'], 'required input reported');
ok(fx.brief.text.includes('Read-only job') && fx.brief.report === 'r/site-check/2026-11-01-0705.md', 'brief: outputs and read-only line');
eq(fx.time.when, 'Nov 1 2:05 AM', 'Brett\'s clock (Rhode Island, EST after the DST change)');
eq(fx.next.everyNever, AT, 'a schedule that never ran is due now');
eq(fx.next.dailyBefore, '2026-11-01T09:00:00.000Z', 'daily: the next 09:00 after the last run');

/* ---- both validators agree ---- */
for (const [k, [t, d]] of Object.entries(cases)) {
  if (t !== 'job-type' || k === 'not-an-object') continue; // junk data: each validator words it its own way
  const env = { $axf: 'asset@1', type: 'job-type', id: 'case-x', name: 'Case', version: '1.0.0', data: d };
  const core = validateAsset(env).errors;
  const be = engine.validateAsset(env).errors;
  for (const m of fx.errors[k]) { ok(core.some((e: string) => e.includes(m)), `core validator names "${m}" (${k})`); ok(be.some((e: string) => e.includes(m)), `build engine names "${m}" (${k})`); }
}

/* ---- starters ---- */
const dir = 'framework/assets/job-type/';
const starters = readdirSync(new URL(dir, root)).filter((f) => f.endsWith('.json')).map((f) => read(`${dir}${f}`));
ok(starters.length >= 6, 'six starter job types (the first crew)');
for (const a of starters) {
  eq(validateAsset(a).errors, [], `${a.id}: core validator`);
  eq(engine.validateAsset(a).errors, [], `${a.id}: build engine`);
  const d = normalizeJobType(a.data);
  const declared = new Set(d.inputs.map((i) => i.id));
  for (const p of placeholders(d.brief)) ok(declared.has(p) || ['date', 'when', 'stamp', 'agent', 'agentName', 'jobType', 'jobName', 'runId', 'report', 'group'].includes(p), `${a.id}: {{${p}}} declared`);
  if (d.readOnly) ok(!d.tools.some((t) => /^(Edit|Write)$/.test(t)), `${a.id}: read-only job gets no edit tools`);
}
eq(new Set(starters.map((a) => a.data.specialty)).size, starters.length, 'one specialty per starter');

/* ---- schema ---- */
const schema = read('framework/schemas/json/job-type.schema.json');
for (const k of ['specialty', 'model', 'budget', 'trigger', 'brief', 'inputs', 'outputs']) ok(schema.properties.data.properties[k], `schema has ${k}`);

console.log(`job-type: ${n} checks passed`);
