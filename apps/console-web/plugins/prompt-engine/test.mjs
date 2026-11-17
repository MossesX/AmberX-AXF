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

await test('tool sets: outside the set a tool is blocked and stops the run; inside it runs; no set = open; the tools list says which', async () => {
  calls.length = 0;
  assert.equal(R.runTool('activity', 'items', {}, { exec: fakeExec }).ok, true, 'no tool set yet: every tool may run');
  const bad = R.toolsets.add({ id: 'bad', tools: ['console.zap', 'Nope!'] });
  assert.equal(bad.ok, false); assert.deepEqual(bad.errors.map((e) => e.field), ['tools.0', 'tools.1']);
  const t = R.toolsets.add({ id: 'review', title: 'Review tools', tools: ['ui-review.*', 'console.open'] });
  assert.equal(t.ok, true); assert.deepEqual(t.toolset.tools, ['ui-review.*', 'console.open']);
  const denied = R.runTool('activity', 'items', {}, { exec: fakeExec });
  assert.equal(denied.ok, false); assert.equal(denied.code, 'denied'); assert.equal(denied.tool, 'activity.items');
  const okRun = R.runTool('ui-review', 'list', { group: 'x' }, { exec: fakeExec, by: 'test' });
  assert.equal(okRun.ok, true); assert.equal(okRun.toolset, 'review'); assert.equal(okRun.record.kind, 'tool'); assert.equal(okRun.record.status, 'done'); assert.deepEqual(calls.at(-1), ['tool', { plugin: 'ui-review', command: 'list', input: { group: 'x' } }]);
  const con = R.runTool('console', 'open', { address: 'builds' }, { exec: fakeExec });
  assert.equal(con.ok, true); assert.equal(con.tool, 'console.open'); assert.deepEqual(calls.at(-1), ['console', { verb: 'open', address: 'builds' }]);
  assert.equal(R.runTool('console', 'press', {}, { exec: fakeExec }).code, 'denied');
  // the cleanup macro's tool.run step (ui-review list) is in the set; a macro naming an outside tool stops there
  calls.length = 0;
  R.macros.add({ id: 'outside', title: 'Outside', steps: [{ action: 'tool.run', input: { plugin: 'activity', command: 'items' } }, { action: 'log.note', input: { text: 'never' } }] });
  const m = R.runMacro('outside', {}, { exec: fakeExec });
  assert.equal(m.ok, false); assert.deepEqual(m.toolsBlocked, ['activity.items']); assert.equal(m.failed[0].code, 'denied'); assert.equal(m.ran.length, 0, 'stopped at the blocked tool'); assert.equal(m.record.status, 'failed');
  assert.deepEqual(calls, []);
  assert.ok(R.readAudit().some((l) => l.kind === 'blocked' && l.detail?.tool === 'activity.items'), 'a blocked line in history');
  const list = R.tools();
  assert.equal(list.ok, true); assert.equal(list.open, false); assert.ok(list.counts.tools > 0);
  const uiReview = list.items.find((i) => i.key === 'ui-review.list'); const act = list.items.find((i) => i.key === 'activity.items');
  if (uiReview) { assert.equal(uiReview.allowed, true); assert.equal(uiReview.set, 'review'); }
  if (act) assert.equal(act.allowed, false);
  assert.deepEqual(R.tools({ set: 'review' }).items.filter((i) => i.kind === 'console').map((i) => i.key), ['console.open']);
  assert.equal(R.tools({ set: 'nope' }).code, 'not_found');
  assert.equal(R.setToolsetEnabled('review', false).toolset.enabled, false);
  assert.equal(R.tools().open, true, 'a disabled set does not count');
  assert.equal(R.runTool('activity', 'items', {}, { exec: fakeExec }).ok, true);
  assert.equal(R.setToolsetEnabled('review', true).toolset.enabled, true);
  assert.equal(R.toolsets.update('review', { tools: ['ui-review.*', 'console.*', 'activity.items'] }).ok, true);
  assert.equal(R.runTool('activity', 'items', {}, { exec: fakeExec }).ok, true, 'added to the set');
  assert.equal(R.toolsets.remove('review', 'x').code, 'confirmation_required');
});

await test('direct runs: a macro with params, a pipeline that waits at its gate and resumes into the same run record, deny stops it', async () => {
  calls.length = 0;
  const m = R.runMacro('cleanup', { build: 'b42' }, { exec: fakeExec, by: 'brett' });
  assert.equal(m.ok, true); assert.equal(m.macro, 'cleanup'); assert.deepEqual(m.ran.map((x) => x.action), ['build.note', 'tool.run']); assert.equal(calls[0][1].build, 'b42');
  assert.equal(m.record.kind, 'macro'); assert.equal(m.record.target, 'cleanup'); assert.equal(m.record.status, 'done');
  assert.equal(R.runMacro('nope').code, 'not_found');
  const dry = R.runMacro('cleanup', { build: 'b43' }, { exec: fakeExec, dry: true });
  assert.equal(dry.dry, true); assert.equal(dry.steps.length, 3); assert.equal(dry.record, undefined, 'a dry run leaves no record');
  calls.length = 0;
  const p = R.runPipeline('ship', { build: 'b44' }, { exec: fakeExec, by: 'brett' });
  assert.equal(p.ok, true); assert.equal(p.stages, 2); assert.equal(p.record.status, 'waiting'); assert.equal(p.waitingAt.stage, 1); assert.equal(p.waitingAt.title, 'Go live with b44?');
  assert.equal(p.dispatch[0].kind, 'ask'); assert.equal(p.asked[0].run, p.record.id, 'the gate prompt knows its run');
  const rec = R.runRecordOf(p.record.id).run;
  assert.equal(rec.status, 'waiting'); assert.deepEqual(rec.resume, { pipeline: 'ship', stage: 1, params: { build: 'b44' } }); assert.deepEqual(rec.asked, [p.asked[0].id]);
  assert.equal(R.runs({ status: 'waiting' }).items[0].id, p.record.id);
  const a = R.answer(p.asked[0].id, 'approve', { exec: fakeExec, by: 'brett' });
  assert.equal(a.ok, true); assert.equal(a.run.record.id, p.record.id, 'the same record carries on'); assert.equal(a.run.record.status, 'done');
  const after = R.runRecordOf(p.record.id).run;
  assert.equal(after.status, 'done'); assert.deepEqual(after.ran.map((x) => x.action), ['build.note', 'build.note', 'tool.run']); assert.equal(after.resume, undefined); assert.ok(after.finishedAt);
  const p2 = R.runPipeline('ship', { build: 'b45' }, { exec: fakeExec });
  const d = R.answer(p2.asked[0].id, 'deny', { exec: fakeExec });
  assert.equal(d.ok, true); assert.equal(d.run.record.status, 'stopped');
  assert.equal(R.runRecordOf(p2.record.id).run.status, 'stopped'); assert.match(R.runRecordOf(p2.record.id).run.errors[0].message, /denied at stage 2/);
  assert.equal(R.runPipeline('nope').code, 'not_found'); assert.equal(R.runRecordOf('nope').code, 'not_found');
  const all = R.runs();
  assert.ok(all.counts.total >= 4); assert.deepEqual(R.runs({ kind: 'pipeline', target: 'ship' }).items.map((r) => r.status), ['stopped', 'done']);
  assert.ok(R.runs({ rule: 'build-failed-retry' }).items.length >= 1, 'rule-fired runs are recorded too');
  for (const r of R.loadRuns()) { assert.equal(r.$axf, 'prompt-run@1'); assert.ok(E.RUN_STATUSES.includes(r.status)); }
  // two runs of one target within a second get distinct ids
  const x = R.runMacro('cleanup', { build: 'x1' }, { exec: fakeExec }); const y = R.runMacro('cleanup', { build: 'x2' }, { exec: fakeExec });
  assert.notEqual(x.record.id, y.record.id);
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
  assert.equal(cli('toolsets').status, 0); assert.match(cli('toolsets').stdout, /review/);
  assert.equal(cli('run-tool', 'console', 'press', '--json').status, 1, 'denied tool exits 1');
  const rm = JSON.parse(cli('run-macro', 'cleanup', '{"build":"cli"}', '--dry', '--json').stdout);
  assert.equal(rm.ok, true); assert.equal(rm.dry, true);
  assert.equal(cli('run-pipeline').status, 2);
  const rs = JSON.parse(cli('runs', '--kind', 'macro', '--limit', '2', '--json').stdout);
  assert.equal(rs.items.length, 2); assert.ok(rs.items.every((r) => r.kind === 'macro'));
  assert.equal(cli('run-record', 'nope').status, 1);
  const tl = JSON.parse(cli('tools', '--set', 'review', '--json').stdout);
  assert.equal(tl.ok, true); assert.ok(tl.items.every((i) => i.set === 'review'));
});

await test('MCP and axHub calls go through the MCP client plugin; an answer can chain both', async () => {
  const seen = []; const orig = R.EXEC['tool.run'];
  R.EXEC['tool.run'] = (step) => { seen.push(step.input); return { ok: true, result: { called: step.input.input.tool } }; };
  assert.equal(R.toolsets.add({ id: 'remote', title: 'Remote', tools: ['mcp.github.*', 'axhub.vps.*'] }).ok, true);
  try {
    const r = R.run([{ action: 'mcp.call', input: { server: 'github', tool: 'create-issue', arguments: { title: 'x' } } }, { action: 'axhub.call', input: { service: 'vps', tool: 'run', args: { cmd: 'uptime' }, reason: { title: 'Check uptime', description: 'Reads uptime after a failed deploy.' } } }], { kind: 'actions', target: 'remote' });
    assert.equal(r.ran.length, 2, JSON.stringify(r.failed.concat(r.errors)));
    assert.deepEqual(seen[0], { plugin: 'mcp-client', command: 'servers-by-sid-call', input: { sid: 'github', tool: 'create-issue', arguments: { title: 'x' } } });
    assert.equal(seen[1].input.sid, 'axhub'); assert.equal(seen[1].input.tool, 'call'); assert.equal(seen[1].input.arguments.reason.title, 'Check uptime');
    const refused = R.run([{ action: 'axhub.call', input: { service: 'vps', tool: 'run' } }], { kind: 'actions', target: 'remote' });
    assert.equal(refused.ran.length, 0); assert.match(refused.errors[0].message, /reason/);
    const blocked = R.run([{ action: 'mcp.call', input: { server: 'slack', tool: 'post' } }], { kind: 'actions', target: 'remote' });
    assert.deepEqual(blocked.toolsBlocked, ['mcp.slack.post']);
  } finally { R.EXEC['tool.run'] = orig; R.toolsets.remove('remote', 'remote'); }
});

await test('data stays in the data folder; audit lines are prompt-audit@1', async () => {
  for (const f of ['rules.json', 'macros.json', 'pipelines.json', 'toolsets.json', 'runs.json', 'instances.json', 'state.json', 'audit.jsonl', 'manifests.json']) assert.ok(readFileSync(join(T, f), 'utf8').length > 0, f);
  for (const l of R.readAudit()) { assert.equal(l.$axf, 'prompt-audit@1'); assert.ok(E.AUDIT_KINDS.includes(l.kind), l.kind); }
});

console.log(`prompt-engine plugin: ${n} test group(s) passed${process.exitCode ? ' with failures' : ''}`);
