#!/usr/bin/env node
/**
 * prompt-engine@1 conformance (framework/core/engines/prompt-engine.mjs): the registry from manifests, context-aware
 * builder options, rule / macro / pipeline / manifest validation with the field named, templates and paths, every
 * condition operator and AND / OR / NOT groups, trigger filters, cooldown / dedupe / rate limits, prompt instances,
 * answers (approve, deny, pick by id / number / label, text, later, veto timeout, pick default), planning (macro
 * expansion with params, cycles, depth, pipelines with gates and resume, missing connectors = keys needed), audit
 * lines, the templates, the registry snapshot and the JSON Schemas (`axf schemas`).
 *
 *   node framework/spec/check-prompt-engine.mjs           check against fixtures/prompt-engine.json
 *   node framework/spec/check-prompt-engine.mjs --write   regenerate the fixture's expected outputs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../core/engines/prompt-engine.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/prompt-engine.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-13T18:00:00.000Z';
const later = (sec) => new Date(Date.parse(AT) + sec * 1000).toISOString();

/* ---- inputs */
const manifest = { $axf: 'prompt-manifest@1', source: 'deploy', title: 'Deploys', kind: 'service', group: 'Systems', events: [{ id: 'deploy.done', title: 'Deploy finished', fields: [{ name: 'target', type: 'enum', enum: ['console', 'hub'] }, { name: 'ok', type: 'boolean' }, { name: 'durationSec', type: 'number' }] }], actions: [{ id: 'deploy.rollback', title: 'Roll back', effect: 'destructive', input: [{ name: 'target', type: 'enum', required: true, enum: ['console', 'hub'] }], needs: ['connector:ssh'] }], connectors: [{ id: 'email', available: true }] };
const reg = E.buildRegistry([manifest]);
const failedRule = E.fromTemplate('build-failed-retry', {}, { now: AT });
const vetoRule = E.fromTemplate('approval-veto', {}, { now: AT });
const popupRule = E.fromTemplate('ui-review-popup', {}, { now: AT });
const condRule = E.normRule({ id: 'slow-deploy', title: 'Slow deploy', trigger: { event: 'deploy.done' }, when: { all: [{ field: 'ok', op: 'truthy' }, { any: [{ field: 'durationSec', op: 'gt', value: 300 }, { field: 'target', op: 'eq', value: 'hub' }] }, { not: { field: 'target', op: 'eq', value: 'skip' } }] }, limits: { cooldownSec: 600, maxPerHour: 2 }, ask: { kind: 'none' }, on: { fire: [{ action: 'notify.email', input: { subject: 'Slow deploy to {{target}}', text: '{{durationSec}}s' } }, { action: 'deploy.rollback', input: { target: '{{target}}' } }] } }, { now: AT });
const textRule = E.normRule({ id: 'name-it', title: 'Name it', trigger: { event: 'custom.event' }, ask: { kind: 'text', title: 'Name for {{name}}?' }, on: { text: [{ action: 'log.note', input: { text: 'Named {{answer.text}}' } }] } }, { now: AT });
const macro = { id: 'cleanup', title: 'Cleanup', params: [{ name: 'build', required: true }, { name: 'note', default: 'done' }], steps: [{ action: 'build.note', input: { build: '{{params.build}}', note: '{{params.note}}', text: '{{params.note}} for {{params.build}}' } }, { action: 'log.note', input: { text: 'cleaned {{params.build}}' } }] };
const loopA = { id: 'loop-a', steps: [{ action: 'macro.run', input: { macro: 'loop-b' } }] };
const loopB = { id: 'loop-b', steps: [{ action: 'macro.run', input: { macro: 'loop-a' } }] };
const pipeline = { id: 'ship', title: 'Ship it', params: [{ name: 'build', required: true }], stages: [{ id: 'prep', title: 'Prepare', actions: [{ action: 'log.note', input: { text: 'prep {{params.build}}' } }] }, { id: 'go', title: 'Go live', gate: { kind: 'approve', title: 'Go live with {{params.build}}?' }, actions: [{ action: 'notify.push', input: { title: 'Live: {{params.build}}' } }] }, { id: 'after', title: 'After', actions: [{ action: 'macro.run', input: { macro: 'cleanup', params: { build: '{{params.build}}' } } }] }] };
const failedEvent = { source: 'builds', event: 'build.status', at: AT, payload: { build: { id: 'b1', title: 'Grid', status: 'failed', branch: 'claude/grid' }, from: 'running' } };
const okEvent = { source: 'builds', event: 'build.status', at: AT, payload: { build: { id: 'b2', title: 'Grid', status: 'built' } } };
const deployEvent = (payload) => ({ source: 'deploy', event: 'deploy.done', at: AT, payload });
const heldEvent = { source: 'approvals', event: 'approval.held', at: AT, payload: { approval: { id: 'a1', tool: 'vps.build_start', summary: 'Start the build', secondsLeft: 90 } } };
const ctx = E.eventContext(failedEvent, failedRule);

/* ---- the run */
function run() {
  const out = {};
  out.registry = { sources: reg.sources.map((s) => s.source), events: Object.keys(reg.events).length, actions: Object.keys(reg.actions).length, connectors: reg.connectors, deployFields: reg.events['deploy.done'].fields.map((f) => f.name), missing: E.missingConnectors(reg, 'deploy.rollback'), emailOk: E.missingConnectors(reg, 'notify.email'), smsMissing: E.missingConnectors(reg, 'notify.sms') };
  out.options = {
    none: (() => { const o = E.optionsFor(reg, {}); return { sources: o.sources.length, events: o.events.length, fields: o.fields.length, actions: o.actions.length }; })(),
    source: (() => { const o = E.optionsFor(reg, { source: 'deploy' }); return { events: o.events.map((e) => e.id) }; })(),
    field: (() => { const o = E.optionsFor(reg, { source: 'builds', event: 'build.status', field: 'build.status' }); return { ops: o.ops, values: o.values }; })(),
    number: E.optionsFor(reg, { event: 'deploy.done', field: 'durationSec' }).ops,
    bool: E.optionsFor(reg, { event: 'deploy.done', field: 'ok' }).ops,
    ask: { approve: E.optionsFor(reg, { ask: 'approve' }).answers, veto: E.optionsFor(reg, { ask: 'veto' }).answers, pick: E.optionsFor(reg, { ask: 'pick' }).answers, none: E.optionsFor(reg, { ask: 'none' }).answers },
    outputs: E.optionsFor(reg, {}).outputs,
    action: E.optionsFor(reg, { action: 'tool.run', input: { plugin: 'ui-review' } }, { plugins: [{ id: 'ui-review', title: 'UI Review', commands: [{ id: 'list' }, { id: 'decide' }] }, { id: 'other', commands: [{ id: 'x' }] }] }).inputs.map((i) => ({ name: i.name, choices: i.choices })),
    build: E.optionsFor(reg, { action: 'build.archive' }, { builds: [{ id: 'b1', title: 'Grid' }] }).inputs.map((i) => ({ name: i.name, choices: i.choices })),
  };
  out.validate = {
    templates: Object.fromEntries(E.TEMPLATES.map((x) => [x.id, E.validateRule(E.fromTemplate(x.id), reg).ok])),
    noEvent: E.validateRule({ title: 'x' }, reg).errors.map((e) => e.field),
    unknownEvent: E.validateRule({ title: 'x', trigger: { event: 'nope.x' }, ask: { kind: 'approve', title: 't' } }, reg).errors.map((e) => e.field),
    wrongSource: E.validateRule({ title: 'x', trigger: { source: 'deploy', event: 'build.status' }, ask: { kind: 'approve', title: 't' } }, reg).errors.map((e) => e.field),
    badCond: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, when: { all: [{ field: '', op: 'zz' }, { field: 'a', op: 'gt', value: 'notanumber' }, { field: 'a', op: 'matches', value: '(' }] }, ask: { kind: 'approve', title: 't' } }, reg).errors.map((e) => `${e.field}`),
    pickNeedsTwo: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'pick', title: 't', options: ['a'] } }, reg).errors.map((e) => e.field),
    wrongBranch: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'approve', title: 't' }, on: { pick: { a: [] }, timeout: [] } }, reg).errors.map((e) => e.field),
    unknownOption: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'pick', title: 't', options: ['a', 'b'] }, on: { pick: { c: [{ action: 'log.note', input: { text: 'x' } }] } } }, reg).errors.map((e) => e.field),
    unknownAction: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'approve', title: 't' }, on: { approve: [{ action: 'nope' }, { action: 'build.note', input: {} }, { action: 'build.status', input: { build: 'b', status: 'zzz' } }] } }, reg).errors.map((e) => e.field),
    noneNeedsFire: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'none' } }, reg).errors.map((e) => e.field),
    vetoMin: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'veto', title: 't', countdownSec: 2 } }, reg).errors.map((e) => e.field),
    limits: E.validateRule({ title: 'x', trigger: { event: 'build.status' }, ask: { kind: 'approve', title: 't' }, limits: { cooldownSec: -1, maxPerHour: 'x' } }, reg).errors.map((e) => e.field),
    macroOk: E.validateMacro(macro, reg), macroBad: E.validateMacro({ steps: [] }, reg).errors.map((e) => e.field), macroUnknownAction: E.validateMacro({ id: 'm', steps: ['nope'] }, reg).errors.map((e) => e.field),
    pipelineOk: E.validatePipeline(pipeline, reg).ok, pipelineBad: E.validatePipeline({ id: 'p', stages: [{}, { gate: { kind: 'pick', options: [] } }] }, reg).errors.map((e) => e.field),
    manifestOk: E.validateManifest(manifest).ok, manifestBad: E.validateManifest({ events: [{ id: 'a' }, { id: 'a' }, {}], actions: [{ id: 'x', effect: 'zap', input: [{}] }] }).errors.map((e) => e.field),
    rejection: E.rejectionText(E.validateRule({ title: 'x' }, reg).errors),
  };
  out.norm = { failed: failedRule, cond: condRule, slug: ['Build Failed: Retry!', '  ', 'a.b-c_d', 'X'.repeat(100)].map(E.slug), summary: { failed: E.summarize(failedRule, reg), cond: E.summarize(condRule, reg), veto: E.summarize(vetoRule, reg) } };
  out.paths = { get: [E.getPath(ctx, 'build.id'), E.getPath(ctx, 'build.steps.total'), E.getPath(ctx, 'nope.x'), E.getPath({ a: [{ b: 1 }] }, 'a.0.b')], render: [E.render('{{build.id}} on {{build.branch|or:no branch}} {{build.status|upper}} {{missing|or:none}} {{build|json}}', ctx), E.render('plain', ctx)], deep: E.renderDeep({ a: '{{build.id}}', b: ['{{build.steps}}', 'x {{build.status}}'], c: { d: '{{nope}}' } }, ctx) };
  const cases = [
    ['eq', 'build.status', 'failed'], ['eq', 'build.status', 'built'], ['ne', 'build.status', 'built'], ['in', 'build.status', ['failed', 'blocked']], ['nin', 'build.status', ['failed']], ['contains', 'build.title', 'gri'], ['startsWith', 'build.branch', 'claude/'], ['endsWith', 'build.branch', 'grid'], ['matches', 'build.branch', '^claude/.*d$'], ['matches', 'build.branch', '('],
    ['gt', 'build.steps.total', 0], ['gte', 'build.steps.total', 0], ['lt', 'build.steps.total', 1], ['lte', 'build.steps.total', 0], ['gt', 'build.title', 1], ['exists', 'build.pr'], ['missing', 'build.pr'], ['exists', 'build.id'], ['truthy', 'build.id'], ['falsy', 'build.pr'], ['zz', 'build.id', 1],
  ];
  out.conditions = { leaves: cases.map(([op, field, value]) => [`${op} ${field}`, E.testCondition({ field, op, value }, E.eventContext({ ...failedEvent, payload: { ...failedEvent.payload, build: { ...failedEvent.payload.build, steps: { total: 0 } } } }))]),
    groups: [E.evalGroup(condRule.when, { ok: true, durationSec: 400, target: 'console' }), E.evalGroup(condRule.when, { ok: true, durationSec: 10, target: 'hub' }), E.evalGroup(condRule.when, { ok: true, durationSec: 10, target: 'console' }), E.evalGroup(condRule.when, { ok: false, durationSec: 400, target: 'hub' }), E.evalGroup(null, {}), E.evalGroup({ any: [] }, {}), E.evalGroup({ not: { all: [] } }, {}), E.evalGroup({ all: [{ field: 'a', op: 'eq', value: 1 }, { any: [{ field: 'b', op: 'eq', value: 2 }, { field: 'b', op: 'eq', value: 3 }] }] }, { a: 1, b: 3 })] };
  out.trigger = { match: E.matchTrigger(failedRule, failedEvent), filterMiss: E.matchTrigger(failedRule, okEvent), otherEvent: E.matchTrigger(failedRule, heldEvent), noSource: E.matchTrigger(failedRule, { event: 'build.status', payload: failedEvent.payload }), wildcard: E.matchTrigger({ id: 'w', trigger: { event: 'build.*' } }, okEvent), listFilter: E.matchTrigger({ id: 'l', trigger: { event: 'build.status', filter: { 'build.status': ['failed', 'blocked'] } } }, failedEvent) };
  // limits: dedupe (same build twice), cooldown, rate
  const e1 = E.evaluate(failedRule, failedEvent, {}, AT, { registry: reg });
  const e2 = E.evaluate(failedRule, { ...failedEvent, at: later(5) }, e1.state, later(5));
  const e3 = E.evaluate(failedRule, { ...failedEvent, at: later(5), payload: { build: { id: 'b9', title: 'Other', status: 'failed' } } }, e2.state, later(5));
  const e4 = E.evaluate(failedRule, { ...failedEvent, at: later(90000) }, e3.state, later(90000));
  const c1 = E.evaluate(condRule, deployEvent({ ok: true, durationSec: 400, target: 'console' }), {}, AT);
  const c2 = E.evaluate(condRule, deployEvent({ ok: true, durationSec: 400, target: 'console' }), c1.state, later(60));
  const c3 = E.evaluate(condRule, deployEvent({ ok: true, durationSec: 400, target: 'console' }), c2.state, later(700));
  const c4 = E.evaluate(condRule, deployEvent({ ok: true, durationSec: 400, target: 'console' }), c3.state, later(1400));
  const c5 = E.evaluate(condRule, deployEvent({ ok: true, durationSec: 10, target: 'console' }), c4.state, later(2100));
  const off = E.evaluate({ ...failedRule, enabled: false }, failedEvent, {}, AT);
  const forced = E.evaluate({ ...failedRule, enabled: false }, failedEvent, {}, AT, { force: true });
  out.evaluate = { first: { fire: e1.fire, kind: e1.instance.kind, title: e1.instance.title, text: e1.instance.text, options: e1.instance.options, id: e1.instance.id, answers: e1.instance.answers }, dedupe: e2.reason, otherBuild: e3.fire, nextDay: e4.fire, cond: [c1.fire, c2.reason, c3.fire, c4.reason, c5.reason], off: off.reason, forced: forced.fire, stateKeys: Object.keys(e4.state), pruned: E.pruneState(e4.state, later(90000 + 86400 * 2)), all: E.evaluateAll([failedRule, condRule, popupRule], failedEvent, {}, AT).results.map((r) => [r.rule, r.fire, r.reason]) };
  // instances + answers
  const inst = e1.instance;
  const a = (ans, rule = failedRule, i = inst) => { const r = E.answerInstance(i, rule, ans, later(30)); return r.ok ? { ok: true, status: r.instance.status, branch: r.branch, option: r.option?.id ?? null, actions: r.actions.map((x) => x.action), answer: r.instance.answer } : { ok: false, code: r.code, error: r.error }; };
  const veto = E.evaluate(vetoRule, heldEvent, {}, AT).instance;
  const txt = E.evaluate(textRule, { source: 'custom', event: 'custom.event', at: AT, payload: { name: 'thing' } }, {}, AT).instance;
  out.answers = { pickId: a({ kind: 'pick', option: 'archive' }), pickNumber: a('pick 1'), pickLabel: a({ kind: 'pick', option: 'leave it' }), pickBad: a({ kind: 'pick', option: 'nope' }), approveOnPick: a('approve'), deny: a('deny'), later: a('later'), timeoutNoDefault: a({ kind: 'timeout' }), text: a('some words', textRule, txt),
    veto: { fields: { kind: veto.kind, countdownSec: veto.countdownSec, expiresAt: veto.expiresAt, title: veto.title, answers: veto.answers }, timeout: a({ kind: 'timeout' }, vetoRule, veto), deny: a('no', vetoRule, veto), approve: a('yes', vetoRule, veto) },
    withDefault: a({ kind: 'timeout' }, { ...failedRule, ask: { ...failedRule.ask, defaultOption: 'retry' } }, E.instanceFor({ ...failedRule, ask: { ...failedRule.ask, defaultOption: 'retry' } }, failedEvent, AT)),
    alreadyAnswered: (() => { const r = E.answerInstance(inst, failedRule, 'deny', later(1)); return a('approve', failedRule, r.instance); })(),
    normAnswer: ['yes', 'Reject', 'pick option 2', 'wait', 'Call it Bob', { option: 'a' }, { text: 'x' }, { kind: 'zz' }, 5].map(E.normAnswer),
    expire: E.expireInstances([veto, inst, { ...veto, id: 'v2', status: 'answered' }], { [vetoRule.id]: vetoRule, [failedRule.id]: failedRule }, later(100)).map((r) => [r.instance.id, r.branch, r.actions.length]),
    notYet: E.expireInstances([veto], { [vetoRule.id]: vetoRule }, later(10)).length };
  // planning
  const plan = (actions, extra = {}) => { const p = E.plan(actions, { registry: reg, macros: [macro, loopA, loopB], pipelines: [pipeline], ctx: { params: {}, build: { id: 'b1' } }, ...extra }); return { steps: p.steps.map((s) => ({ action: s.action, input: s.input, ...(s.marker ? { marker: s.marker } : {}), ...(s.blocked ? { blocked: s.blocked } : {}), ...(s.confirm ? { confirm: true } : {}), ...(s.brettOnly ? { brettOnly: true } : {}) })), errors: p.errors, keysNeeded: p.keysNeeded, gate: p.gate ? { pipeline: p.gate.pipeline, stage: p.gate.stage } : null, runnable: p.runnable, ok: p.ok }; };
  out.plan = {
    direct: plan([{ action: 'build.archive', input: { build: '{{build.id}}' } }, { action: 'build.delete', input: { build: 'x' } }, { action: 'build.approve-upgrade', input: { build: 'x', phase: 1 } }]),
    macro: plan([{ action: 'macro.run', input: { macro: 'cleanup', params: { build: 'b7' } } }]),
    macroMissingParam: plan([{ action: 'macro.run', input: { macro: 'cleanup' } }]),
    macroUnknown: plan([{ action: 'macro.run', input: { macro: 'nope' } }]),
    cycle: plan([{ action: 'macro.run', input: { macro: 'loop-a' } }]),
    pipelineGate: plan([{ action: 'pipeline.run', input: { pipeline: 'ship', params: { build: 'b7' } } }]),
    pipelineResume: plan([{ action: 'pipeline.run', input: { pipeline: 'ship', stage: 1, gatePassed: true, params: { build: 'b7' } } }]),
    keysNeeded: plan(condRule.on.fire, { ctx: { target: 'hub', durationSec: 400 } }),
    smsBlocked: plan([{ action: 'notify.sms', input: { text: 'hi' } }, { action: 'notify.email', input: { subject: 's' } }]),
    missingInput: plan([{ action: 'build.note', input: { build: 'b' } }, 'nope', 5]),
    ask: plan([{ action: 'prompt.ask', input: { kind: 'approve', title: 'Sure?' } }, { action: 'log.note', input: { text: 'after' } }]),
  };
  const instF = E.instanceFor(E.fromTemplate('service-down-call'), { source: 'watchdog', event: 'health.down', at: AT, payload: { service: 'hub' } }, AT, { registry: reg });
  out.instanceKeys = { keysNeeded: E.instanceFor({ ...popupRule, ask: { ...popupRule.ask, outputs: ['dialog', 'sms', 'email'] } }, { source: 'ui-review', event: 'ui-review.submitted', at: AT, payload: { item: { id: 'i', name: 'n' } } }, AT, { registry: reg }).keysNeeded, noneKind: instF, resume: E.instanceFor(failedRule, failedEvent, AT, { resume: { pipeline: 'ship', stage: 1 } }).resume };
  out.audit = { entry: E.auditEntry('answered', { rule: 'r', instance: 'i', event: 'e', reason: 'why', extra: 1 }, AT, 'brett'), unknownKind: E.auditEntry('zz', 'text', AT).kind, history: E.historyOf([{ kind: 'fired', rule: 'a', at: '1' }, { kind: 'ran', rule: 'b', at: '2' }, { kind: 'fired', rule: 'a', at: '3' }], { rule: 'a' }, 5), limited: E.historyOf([{ kind: 'x' }, { kind: 'y' }, { kind: 'z' }], {}, 2) };
  out.templates = E.TEMPLATES.map((x) => ({ id: x.id, group: x.group, event: E.fromTemplate(x.id).trigger.event, ask: E.fromTemplate(x.id).ask.kind }));
  out.fromTemplate = { override: (() => { const r = E.fromTemplate('watchdog-danger', { id: 'my-watch', title: 'Mine', enabled: false }, { now: AT }); return { id: r.id, title: r.title, enabled: r.enabled, template: r.template, createdAt: r.createdAt }; })(), unknown: E.fromTemplate('nope') };
  out.registrySnapshot = E.REGISTRY;
  out.schemas = Object.keys(E.jsonSchemas());
  return out;
}

const got = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'prompt-engine@1', note: 'Expected outputs of framework/spec/check-prompt-engine.mjs; regenerate with --write after a deliberate engine change.', expected: got }, null, 2)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8')).expected;
for (const k of Object.keys(got)) t(`fixture: ${k}`, () => assert.ok(same(got[k], fx[k]), `${k}: ${JSON.stringify(got[k]).slice(0, 600)}\n expected ${JSON.stringify(fx[k]).slice(0, 600)}`));

/* ---- behaviour the fixture states in words (so a wrong regeneration is still caught) */
t('every template validates against the built-in registry', () => { for (const x of E.TEMPLATES) assert.ok(E.validateRule(E.fromTemplate(x.id), E.buildRegistry()).ok, x.id); });
t('a failed build asks once per build per day (dedupe), another build asks', () => { assert.equal(got.evaluate.first.fire, true); assert.equal(got.evaluate.dedupe, 'dedupe'); assert.equal(got.evaluate.otherBuild, true); assert.equal(got.evaluate.nextDay, true); });
t('cooldown, then the per-hour cap, conditions checked first', () => assert.deepEqual(got.evaluate.cond, [true, 'cooldown', true, 'rate', 'conditions']));
t('a disabled rule never fires unless forced (test-fire)', () => { assert.equal(got.evaluate.off, 'disabled'); assert.equal(got.evaluate.forced, true); });
t('pick by id, number and label; a wrong option names the options', () => { assert.equal(got.answers.pickId.option, 'archive'); assert.equal(got.answers.pickNumber.option, 'retry'); assert.equal(got.answers.pickLabel.option, 'leave'); assert.equal(got.answers.pickBad.code, 'validation'); assert.match(got.answers.pickBad.error, /1 Queue it again/); });
t('a pick prompt is not answered with approve', () => assert.equal(got.answers.approveOnPick.ok, false));
t('a veto timeout approves (the call runs); deny stops it', () => { assert.equal(got.answers.veto.timeout.branch, 'approve'); assert.equal(got.answers.veto.timeout.status, 'expired'); assert.equal(got.answers.veto.deny.branch, 'deny'); assert.equal(got.answers.veto.deny.actions[0], 'log.note'); });
t('a pick with a default option takes it on timeout', () => assert.equal(got.answers.withDefault.option, 'retry'));
t('an answered prompt is not answered twice', () => assert.equal(got.answers.alreadyAnswered.ok, false));
t('expiry: only waiting prompts past their deadline', () => { assert.deepEqual(got.answers.expire.map((x) => x[0]), [got.answers.veto.fields && E.evaluate(vetoRule, heldEvent, {}, AT).instance.id]); assert.equal(got.answers.notYet, 0); });
t('macro expands with params and defaults', () => { assert.deepEqual(got.plan.macro.steps.map((s) => s.action), ['macro.run', 'build.note', 'log.note']); assert.equal(got.plan.macro.steps[1].input.text, 'done for b7'); assert.equal(got.plan.macroMissingParam.errors.length, 1); assert.equal(got.plan.cycle.ok, false); });
t('a pipeline stops at its gate and resumes after it', () => { assert.deepEqual(got.plan.pipelineGate.gate, { pipeline: 'ship', stage: 1 }); assert.equal(got.plan.pipelineGate.steps.at(-1).marker, 'gate'); assert.deepEqual(got.plan.pipelineGate.steps.at(-1).input.resume, { pipeline: 'ship', stage: 1, params: { build: 'b7' } }); assert.equal(got.plan.pipelineResume.gate, null); assert.ok(got.plan.pipelineResume.steps.some((s) => s.action === 'notify.push' && s.input.title === 'Live: b7')); assert.ok(got.plan.pipelineResume.steps.some((s) => s.action === 'log.note' && s.input.text === 'cleaned b7')); });
t('missing connectors are keys needed, never silent; an available one passes', () => { assert.deepEqual(got.plan.keysNeeded.keysNeeded, ['ssh']); assert.deepEqual(got.plan.smsBlocked.keysNeeded, ['sms']); assert.equal(got.plan.smsBlocked.steps[1].blocked, undefined); assert.equal(got.plan.smsBlocked.runnable, 1); });
t('destructive and Brett-only steps are marked', () => { assert.equal(got.plan.direct.steps[1].confirm, true); assert.equal(got.plan.direct.steps[2].brettOnly, true); assert.equal(got.plan.direct.steps[0].input.build, 'b1'); });
t('a nested ask is a gate: nothing after it is planned', () => { assert.equal(got.plan.ask.steps.length, 1); assert.equal(got.plan.ask.steps[0].marker, 'gate'); });
t('the builder only offers what fits: deploy events for the deploy source, number ops for a number, commands of the picked plugin', () => { assert.deepEqual(got.options.source.events, ['deploy.done']); assert.ok(!got.options.number.includes('contains')); assert.deepEqual(got.options.bool, ['truthy', 'falsy']); assert.deepEqual(got.options.action[1].choices.map((c) => c.id), ['list', 'decide']); assert.equal(got.options.outputs.find((o) => o.id === 'email').available, true); assert.equal(got.options.outputs.find((o) => o.id === 'sms').available, false); });
t('validation names the field', () => { assert.deepEqual(got.validate.noEvent, ['trigger.event', 'on.fire']); assert.deepEqual(got.validate.wrongSource, ['trigger.source']); assert.ok(got.validate.badCond.includes('when.all.0.field')); assert.ok(got.validate.badCond.includes('when.all.2.value')); assert.deepEqual(got.validate.pickNeedsTwo, ['ask.options']); assert.deepEqual(got.validate.unknownOption, ['on.pick.c']); assert.ok(got.validate.unknownAction.includes('on.approve.2.input.status')); assert.deepEqual(got.validate.noneNeedsFire, ['on.fire']); });
t('the registry snapshot (schemas/prompt-engine.json) is current (run axf schemas)', () => assert.ok(same(JSON.parse(rd('framework/schemas/prompt-engine.json')), E.REGISTRY)));
for (const [name, schema] of Object.entries(E.jsonSchemas())) t(`schemas/json/${name} is current (run axf schemas)`, () => assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), schema)));
t('every plugin.json promptManifest in the repo validates', () => {
  const dir = join(ROOT, 'apps/console-web/plugins');
  for (const f of readdirSync(dir)) {
    const pj = join(dir, f, 'plugin.json');
    if (f.startsWith('_') || !existsSync(pj)) continue;
    const j = JSON.parse(readFileSync(pj, 'utf8'));
    if (j.promptManifest && typeof j.promptManifest === 'object') assert.ok(E.validateManifest({ ...j.promptManifest, source: j.promptManifest.source || f }).ok, `${f}: ${E.rejectionText(E.validateManifest(j.promptManifest).errors)}`);
  }
});
console.log(`check-prompt-engine: ${n} checks passed`);
