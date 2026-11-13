#!/usr/bin/env node
/**
 * Prompt engine plugin tests (node apps/console-web/plugins/prompt-engine/test.mjs): the runner over a temp data folder
 * (rules / macros / pipelines CRUD with validation, templates, fire → ask → answer → run with fake executors, dedupe
 * across calls, dry test-fire, gates that resume a pipeline, expiry on tick, schedules, chained events with a depth
 * cap, keys-needed dispatch, audit lines, the CLI's exit codes) and the build-hook listener's event mapping.
 * The engine's own decisions are covered by framework/spec/check-prompt-engine.mjs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = mkdtempSync(join(tmpdir(), 'axf-pe-'));
process.env.AXF_PROMPT_ENGINE_DIR = T;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const R = await import('./engine.mjs');
const H = await import('./build-hooks.mjs');
const E = await import('../../../../framework/core/engines/prompt-engine.mjs');

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const calls = [];
const fakeExec = {
  'tool.run': (step) => { calls.push(['tool', step.input]); return { ok: true, result: { ran: step.input.command } }; },
  'build.note': (step) => { calls.push(['note', step.input]); return { ok: true }; },
  'build.status': (step) => { calls.push(['status', step.input]); return step.input.build === 'bad' ? { ok: false, error: 'no such build' } : { ok: true }; },
  'build.archive': (step) => { calls.push(['archive', step.input]); return { ok: true }; },
  'console.command': (step) => { calls.push(['console', step.input]); return { ok: true }; },
};
const audits = () => R.readAudit().map((l) => l.kind);

await test('rules: templates add, duplicates refused, validation names the field, update / enable / remove with confirm', async () => {
  const a = R.useTemplate('build-failed-retry');
  assert.equal(a.ok, true); assert.equal(a.rule.id, 'build-failed-retry'); assert.match(a.summary, /Build status changed/);
  assert.equal(R.useTemplate('build-failed-retry').ok, false, 'the same id twice is refused');
  assert.equal(R.useTemplate('nope').code, 'not_found');
  const bad = R.rules.add({ title: 'x', trigger: { event: 'nope.x' } });
  assert.equal(bad.ok, false); assert.equal(bad.errors[0].field, 'trigger.event');
  const u = R.rules.update('build-failed-retry', { title: 'Failed builds', limits: { dedupeKey: '{{build.id}}', dedupeSec: 60 } });
  assert.equal(u.ok, true); assert.equal(u.rule.title, 'Failed builds'); assert.equal(u.rule.limits.dedupeSec, 60); assert.equal(u.rule.ask.kind, 'pick', 'the rest is kept');
  assert.equal(R.rules.update('nope', {}).code, 'not_found');
  assert.equal(R.setEnabled('build-failed-retry', false).rule.enabled, false);
  assert.equal(R.setEnabled('build-failed-retry', true).rule.enabled, true);
  const rm = R.rules.remove('build-failed-retry', 'wrong');
  assert.equal(rm.code, 'confirmation_required'); assert.equal(rm.confirm, 'build-failed-retry');
  assert.equal(R.rules.list().length, 1);
});

await test('macros and pipelines: CRUD with the registry checking every step', async () => {
  const m = R.macros.add({ id: 'cleanup', title: 'Cleanup', params: ['build'], steps: [{ action: 'build.note', input: { build: '{{params.build}}', text: 'cleaned' } }, { action: 'tool.run', input: { plugin: 'ui-review', command: 'list' } }] });
  assert.equal(m.ok, true); assert.equal(m.macro.params[0].name, 'build');
  assert.equal(R.macros.add({ id: 'bad', steps: [{ action: 'nope' }] }).ok, false);
  const p = R.pipelines.add({ id: 'ship', title: 'Ship', params: [{ name: 'build', required: true }], stages: [{ title: 'Prep', actions: [{ action: 'build.note', input: { build: '{{params.build}}', text: 'prep' } }] }, { title: 'Go', gate: { kind: 'approve', title: 'Go live with {{params.build}}?' }, actions: [{ action: 'macro.run', input: { macro: 'cleanup', params: { build: '{{params.build}}' } } }] }] });
  assert.equal(p.ok, true); assert.equal(p.pipeline.stages[1].gate.kind, 'approve');
  assert.equal(R.pipelines.update('ship', { title: 'Ship it' }).pipeline.title, 'Ship it');
  assert.equal(R.macros.remove('cleanup', 'nope').code, 'confirmation_required');
});

await test('fire: a failed build asks; the same build again is deduped across calls; answering runs the branch', async () => {
  calls.length = 0;
  const ev = { source: 'builds', event: 'build.status', payload: { build: { id: 'b1', title: 'Grid', status: 'failed' } } };
  const r1 = R.fire(ev, { by: 'test', exec: fakeExec });
  assert.equal(r1.ok, true); assert.deepEqual(r1.fired, [{ rule: 'build-failed-retry', asks: true }]); assert.equal(r1.instances.length, 1); assert.equal(r1.dispatch[0].kind, 'ask');
  assert.equal(r1.instances[0].title, 'Build failed: Grid');
  const r2 = R.fire(ev, { by: 'test', exec: fakeExec });
  assert.equal(r2.fired.length, 0); assert.deepEqual(r2.skipped.find((s) => s.rule === 'build-failed-retry').reason, 'dedupe');
  const w = R.waiting();
  assert.equal(w.count, 1); assert.equal(w.items[0].n, 1);
  const bad = R.answer('1', 'approve');
  assert.equal(bad.ok, false, 'a pick is not approved');
  const ans = R.answer('1', { kind: 'pick', option: 'archive' }, { by: 'brett', exec: fakeExec });
  assert.equal(ans.ok, true); assert.equal(ans.branch, 'pick'); assert.equal(ans.option.id, 'archive');
  assert.equal(ans.run.ok, true); assert.deepEqual(calls, [['archive', { build: 'b1' }]]);
  assert.equal(R.waiting().count, 0);
  assert.equal(R.loadInstances()[0].status, 'ran');
  assert.equal(R.answer('nope', 'approve').code, 'not_found');
  assert.equal(R.answer(ans.instance.id, 'deny').ok, false, 'already answered');
  for (const k of ['fired', 'asked', 'skipped', 'answered', 'planned', 'ran']) assert.ok(audits().includes(k), k);
});

await test('fire: a run-now rule plans macros, a failed step stops the rest, continueOnError goes on', async () => {
  calls.length = 0;
  R.rules.add({ id: 'shipped', title: 'Shipped', trigger: { event: 'build.shipped' }, ask: { kind: 'none' }, on: { fire: [{ action: 'build.status', input: { build: 'bad', status: 'queued' } }, { action: 'macro.run', input: { macro: 'cleanup', params: { build: '{{build.id}}' } } }] } });
  const r = R.fire({ event: 'build.shipped', payload: { build: { id: 'b2' } } }, { exec: fakeExec });
  assert.equal(r.fired.length, 1); assert.equal(r.runs[0].failed.length, 1); assert.equal(r.runs[0].ran.length, 0, 'stopped at the failure');
  R.rules.update('shipped', { on: { fire: [{ action: 'build.status', input: { build: 'bad', status: 'queued' }, continueOnError: true }, { action: 'macro.run', input: { macro: 'cleanup', params: { build: '{{build.id}}' } } }] } });
  calls.length = 0;
  const r2 = R.fire({ event: 'build.shipped', payload: { build: { id: 'b3' } } }, { exec: fakeExec });
  assert.equal(r2.runs[0].failed.length, 1); assert.deepEqual(r2.runs[0].ran.map((x) => x.action), ['build.note', 'tool.run']);
  assert.deepEqual(calls.map((c) => c[0]), ['status', 'note', 'tool']); assert.equal(calls[1][1].build, 'b3');
});

await test('test-fire is dry: shows the prompt and the plans, writes nothing but a dry-run line', async () => {
  const before = R.loadInstances().length;
  const t = R.testRule('build-failed-retry');
  assert.equal(t.fire, true); assert.equal(t.dry, true); assert.equal(t.instance.kind, 'pick'); assert.ok(t.plans['pick:archive'].steps[0].action === 'build.archive');
  assert.equal(R.loadInstances().length, before);
  const t2 = R.testRule('build-failed-retry', { event: { event: 'build.status', payload: { build: { id: 'x', status: 'built' } } } });
  assert.equal(t2.fire, false); assert.equal(t2.reason, 'filter');
  assert.equal(R.testRule('nope').code, 'not_found');
  const t3 = R.testRule('shipped', { exec: fakeExec });
  assert.equal(t3.run.dry, true); assert.equal(t3.run.steps.length, 4);
  assert.equal(audits()[0] === 'dry-run' || audits().includes('dry-run'), true);
});

await test('pipelines: a gate asks, the answer resumes the next stage, params carried', async () => {
  calls.length = 0;
  R.rules.add({ id: 'ship-it', title: 'Ship it', trigger: { event: 'custom.event', filter: { name: 'ship' } }, ask: { kind: 'none' }, on: { fire: [{ action: 'pipeline.run', input: { pipeline: 'ship', params: { build: '{{payload.build}}' } } }] } });
  const r = R.fire({ event: 'custom.event', payload: { name: 'ship', payload: { build: 'b9' } } }, { exec: fakeExec });
  assert.equal(r.runs[0].asked.length, 1); assert.equal(r.runs[0].asked[0].title, 'Go live with b9?'); assert.deepEqual(r.runs[0].asked[0].resume, { pipeline: 'ship', stage: 1, params: { build: 'b9' } });
  assert.deepEqual(calls, [['note', { build: 'b9', text: 'prep' }]]);
  calls.length = 0;
  const a = R.answer(r.runs[0].asked[0].id, 'approve', { exec: fakeExec });
  assert.equal(a.ok, true); assert.deepEqual(a.run.ran.map((x) => x.action), ['build.note', 'tool.run']); assert.equal(calls[0][1].build, 'b9');
  const d = R.fire({ event: 'custom.event', payload: { name: 'ship', payload: { build: 'b10' } } }, { exec: fakeExec });
  const deny = R.answer(d.runs[0].asked[0].id, 'deny', { exec: fakeExec });
  assert.equal(deny.ok, true); assert.equal(deny.run.planned, 0, 'deny does not resume');
});

await test('tick: a veto past its deadline runs (approve); a schedule fires when due', async () => {
  R.useTemplate('approval-veto');
  const r = R.fire({ source: 'approvals', event: 'approval.held', payload: { approval: { id: 'a1', tool: 'vps.build_start', summary: 'start', secondsLeft: 90 } } });
  const inst = r.instances[0];
  assert.equal(inst.kind, 'veto'); assert.ok(inst.expiresAt);
  const xs = R.loadInstances(); xs.find((i) => i.id === inst.id).expiresAt = new Date(Date.now() - 1000).toISOString(); writeFileSync(join(T, 'instances.json'), JSON.stringify(xs));
  R.rules.add({ id: 'every-minute', title: 'Every minute', trigger: { event: 'schedule.tick', filter: { every: '1m', schedule: 'minute' } }, ask: { kind: 'none' }, on: { fire: [{ action: 'log.note', input: { text: 'tick {{schedule}}' } }] } });
  const t = R.tick({ exec: fakeExec });
  assert.deepEqual(t.expired.map((x) => x.branch), ['approve']);
  assert.deepEqual(t.schedules, [{ rule: 'every-minute', fired: true }]);
  assert.equal(R.loadInstances().find((i) => i.id === inst.id).status, 'expired');
  const t2 = R.tick({ exec: fakeExec });
  assert.deepEqual(t2.schedules, [], 'not due again within the minute');
  assert.deepEqual(R.dueSchedules([E.normRule({ id: 'd', trigger: { event: 'schedule.tick', filter: { at: '08:00' } }, ask: { kind: 'none' }, on: { fire: ['log.note'] } })], { lastFired: {} }, '2026-11-13T08:00:30Z').map((x) => x.id), ['d']);
  assert.deepEqual(R.dueSchedules([E.normRule({ id: 'd', trigger: { event: 'schedule.tick', filter: { at: '08:00' } }, ask: { kind: 'none' }, on: { fire: ['log.note'] } })], { lastFired: { d: '2026-11-13T08:00:10Z' } }, '2026-11-13T08:30:00Z').length, 0, 'already fired today');
  assert.deepEqual(R.dueSchedules([E.normRule({ id: 'd', trigger: { event: 'schedule.tick', filter: { at: '08:00', weekday: 1 } }, ask: { kind: 'none' }, on: { fire: ['log.note'] } })], { lastFired: {} }, '2026-11-13T08:30:00Z').length, 0, 'Friday is not Monday');
  assert.equal(R.durationSec('15m'), 900); assert.equal(R.durationSec('2h'), 7200); assert.equal(R.durationSec('x'), 0);
});

await test('chained events stop at the depth cap; keys-needed and notify come back as dispatch', async () => {
  R.rules.add({ id: 'chain', title: 'Chain', trigger: { event: 'custom.event', filter: { name: 'loop' } }, ask: { kind: 'none' }, on: { fire: [{ action: 'event.fire', input: { source: 'custom', event: 'custom.event', payload: { name: 'loop' } } }] } });
  const r = R.fire({ event: 'custom.event', payload: { name: 'loop' } }, { exec: fakeExec });
  assert.equal(r.ok, true);
  const depth = (x, d = 0) => (x.runs?.[0]?.ran?.[0]?.result?.fired ? d + 1 : d);
  assert.ok(depth(r) >= 1);
  assert.ok(R.readAudit().some((l) => l.kind === 'failed' && /chain deeper/.test(l.reason || '')), 'the cap is reached and recorded');
  const s = R.useTemplate('service-down-call');
  assert.equal(s.ok, true);
  const d = R.fire({ source: 'watchdog', event: 'health.down', payload: { service: 'hub', since: 'now' } }, { exec: fakeExec });
  const kinds = d.dispatch.map((x) => x.kind);
  assert.ok(kinds.includes('keys-needed')); assert.ok(kinds.includes('notify'));
  assert.equal(d.runs[0].failed[0].error, 'needs connector voice-call');
});

await test('manifests: a plugin registers; the builder lists its events; a bad one is refused', async () => {
  const bad = R.registerManifest({ events: [{}] });
  assert.equal(bad.ok, false);
  const ok = R.registerManifest({ source: 'deploy', title: 'Deploys', events: [{ id: 'deploy.done', fields: [{ name: 'target', type: 'enum', enum: ['console', 'hub'] }] }], connectors: [{ id: 'email', available: true }] });
  assert.equal(ok.ok, true);
  const reg = R.registry();
  assert.ok(reg.events['deploy.done']); assert.equal(reg.connectors.email.available, true);
  const o = R.options({ source: 'deploy' });
  assert.deepEqual(o.events.map((e) => e.id), ['deploy.done']);
  assert.equal(R.options({ event: 'deploy.done', field: 'target' }).values.length, 2);
  assert.equal(R.rules.add({ id: 'dep', title: 'Dep', trigger: { event: 'deploy.done' }, ask: { kind: 'none' }, on: { fire: [{ action: 'notify.email', input: { subject: 'x' } }] } }).ok, true);
  assert.deepEqual(R.testRule('dep').run.keysNeeded, [], 'email is available now');
});

await test('build-hook listener: build events become prompt events, failed and blocked derived', async () => {
  const ev = { id: 'e1', event: 'status', at: '2026-11-13T18:00:00Z', by: 'cli', from: 'running', build: { id: 'b-hook', title: 'Grid', status: 'failed', branch: 'claude/grid', steps: [{ done: true }, {}] } };
  const out = H.promptEventsOf(ev);
  assert.deepEqual(out.map((x) => x.event), ['build.status', 'build.failed']);
  assert.equal(out[0].payload.build.steps.done, 1); assert.equal(out[0].payload.from, 'running'); assert.equal(out[0].id, 'e1'); assert.equal(out[1].id, 'e1:failed');
  assert.deepEqual(H.promptEventsOf({ event: 'status', build: { id: 'b', status: 'blocked' } }).map((x) => x.event), ['build.status', 'build.blocked']);
  assert.deepEqual(H.promptEventsOf({ event: 'created', build: { id: 'b' }, origin: { said: 'do it' } })[0].payload.origin, { said: 'do it' });
  assert.deepEqual(H.promptEventsOf(null), []);
  const res = H.default([ev, { junk: true }]);
  assert.equal(res.seen, 2); assert.ok(res.fired >= 1, 'the failed-build rule fired for a new build id');
});

await test('CLI: exit codes 0 / 1 / 2 / 3 and --json', async () => {
  const cli = (...a) => spawnSync(process.execPath, [join(HERE, 'engine.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, AXF_PROMPT_ENGINE_DIR: T } });
  assert.equal(cli('state', '--json').status, 0);
  assert.equal(JSON.parse(cli('state', '--json').stdout).counts.rules > 0, true);
  assert.equal(cli('rule', 'nope').status, 1);
  assert.equal(cli('nonsense').status, 2);
  assert.equal(cli('remove-rule', 'chain').status, 3);
  assert.equal(cli('remove-rule', 'chain', '--confirm', 'chain', '--json').status, 0);
  assert.equal(cli('templates').status, 0);
  assert.match(cli('rules').stdout, /build-failed-retry/);
  const h = JSON.parse(cli('history', '--kind', 'rule', '--limit', '3', '--json').stdout);
  assert.equal(h.items.length, 3); assert.ok(h.items.every((l) => l.kind === 'rule'));
});

await test('data stays in the data folder; audit lines are prompt-audit@1', async () => {
  for (const f of ['rules.json', 'macros.json', 'pipelines.json', 'instances.json', 'state.json', 'audit.jsonl', 'manifests.json']) assert.ok(readFileSync(join(T, f), 'utf8').length > 0, f);
  for (const l of R.readAudit()) { assert.equal(l.$axf, 'prompt-audit@1'); assert.ok(E.AUDIT_KINDS.includes(l.kind), l.kind); }
});

console.log(`prompt-engine plugin: ${n} test group(s) passed${process.exitCode ? ' with failures' : ''}`);
