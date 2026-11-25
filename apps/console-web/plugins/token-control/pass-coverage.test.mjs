#!/usr/bin/env node
/**
 * Pass coverage reproductions (build approval-pass-covers-every-call, step s2).
 *   node apps/console-web/plugins/token-control/pass-coverage.test.mjs
 *
 * Brett: "Why do I keep getting approvals when I set a pass?" Each test below says what an active pass for everything
 * must do (framework/spec/AXHUB-PASS.md) and FAILS on main: it reproduces one place the call path skips the pass.
 * The trace with every such place is _claude/builds/reports/approval-pass-covers-every-call/s2-pass-skips.md.
 *
 *   veto case     vps.run still counts down                        → tests V1-V3 (what the console hands the hub)
 *   confirm case  console_terminal_sessions_stop still asks        → tests C1-C2 (the console's own confirm)
 *
 * Tests marked "control" pass today and pin what already works. This file is not in the CI workflow while it is
 * red: the steps that fix the path (s3-s5) turn it green and s10 wires it. The hub's half of the veto case is
 * reproduced in the axHub repo (packages/core/test/passes.test.ts on claude/approval-pass-covers-every-call).
 * Every store is a temp copy.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const T = mkdtempSync(join(tmpdir(), 'axf-pass-cov-'));
Object.assign(process.env, {
  AXF_APPEARANCE_FILE: join(T, 'appearance.json'), AXF_AMBERX_NOTES_DIR: join(T, 'notes'), AXF_CONTROL_DATA_DIR: join(T, 'data'),
  AXF_PLAN_TREE_DIR: join(T, 'plans'), AXF_ORCH_FILE: join(T, 'orch.json'), AXF_CONTROL_SALT: 'test-salt',
  AXF_THREADS_FILE: join(T, 'THREADS.md'), AXF_PASS_SECRET: 'pass-secret', AXF_NO_TTY_APPROVAL: '1',
  AXF_PLUGIN_COMMANDS_DATA_DIR: join(T, 'plugin-commands'),
});
writeFileSync(process.env.AXF_APPEARANCE_FILE, JSON.stringify({ $axf: 'appearance@1', slots: { 'design-package': 'hub-default', layout: 'axhub-console' }, settings: {} }));

const { runControl } = await import('./control.mjs');
const { coveringCall, publication } = await import('./lib/pass.mjs');
const { plan } = await import('../plugin-commands/commands.mjs');

const BRETT = { via: 'console', name: 'brett' };
const HOUR = 60 * 60 * 1000;
/** Brett switches on a pass for everything in the console (what Claude settings → No wait does), asking for a day. */
const granted = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { minutes: 24 * 60, reason: 'do what I tell you today' }, by: 'brett' }, { approver: BRETT });
const pass = granted.item;

/**
 * What axHub's feed reader takes from a pass publication, entry by entry: the rules of `parseFeed` in axHub
 * packages/server/src/pass-feed.ts (main at 5dd64b6; docs/veto-pass.md §4). A document without a `passes` list is
 * refused whole, and the hub then honours no pass from this console (fail closed).
 */
function hubReads(doc) {
  if (!doc || doc.$axf !== 'control-pass@1') throw new Error('not control-pass@1');
  if (!Array.isArray(doc.passes)) throw new Error('no passes list');
  const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? v : null);
  return doc.passes.filter((p) => p && /^[A-Za-z0-9._-]{1,64}$/.test(p.id ?? '')
    && (p.scope !== undefined || p.tools !== undefined) && (p.scope === undefined || strings(p.scope)) && (p.tools === undefined || strings(p.tools))
    && typeof p.grantedBy === 'string' && p.grantedBy.trim() && Number.isFinite(Date.parse(p.expiresAt)));
}

test('control: Brett\'s grant is on at once and the console says it covers vps.run', () => {
  assert.equal(granted.ok, true);
  assert.equal(pass.state, 'active');
  assert.equal(pass.scope, 'all');
  assert.ok(coveringCall({ service: 'vps', tool: 'run' }), 'the console\'s own check: an all pass covers any held call');
});

/* ------------------------------------------------------------------ the veto case: vps.run */

test('V1 the hub can read the pass the console publishes (today: "no passes list", so the hub honours none and vps.run counts down)', () => {
  const { body } = publication();
  let read = [];
  assert.doesNotThrow(() => { read = hubReads(body); }, 'the publication is a document the hub\'s feed reader accepts');
  assert.ok(read.some((p) => p.id === pass.id), 'and the active pass is in it, with the owner who granted it');
});

test('V2 the published pass says it covers every tool (covers: all), not a console scope id the hub matches against a target argument', () => {
  const { body } = publication();
  const published = (body.passes ?? body.active ?? []).find((p) => p.id === pass.id);
  assert.ok(published, 'the pass is published');
  assert.equal(published.covers, 'all', 'pass@2: covers is all (today it is the scope\'s target list, ["*"], which the hub never reads)');
});

test('V3 a 24-hour pass lasts 24 hours (today it is cut to 4 h, after which every call prompts again)', () => {
  assert.equal(pass.minutes, 24 * 60, 'the minutes Brett asked for');
  assert.ok(coveringCall({ service: 'vps', tool: 'run' }, Date.now() + 23 * HOUR), 'vps.run is still covered 23 hours in');
});

/* ------------------------------------------------------------------ the confirm case: console_terminal_sessions_stop */

const stop = (extra = {}) => ({ op: 'act', target: 'plugins.commands', path: 'console-terminal/sessions-stop', action: 'run', input: { name: 'axf-some-session', where: 'vps' }, by: 'claude', ...extra });

test('control: sessions-stop is the confirm tool console_terminal_sessions_stop, and asks when no pass is on the call', () => {
  const item = plan({ op: 'get', target: 'plugins.commands', path: 'console-terminal/sessions-stop' }).item;
  assert.equal(item.tool, 'console_terminal_sessions_stop');
  assert.equal(item.confirm, true);
  assert.equal(item.effect, 'destructive');
});

test('C1 console_terminal_sessions_stop runs at once under the active pass (today: confirmation_required)', () => {
  // The pass is active in the console's own store, and is handed to plan() as well: whichever way the fix learns
  // about the pass, this call must not ask.
  const r = plan(stop(), { pass });
  assert.notEqual(r.code, 'confirmation_required', 'no confirm token is asked for while a pass covers the call');
  assert.equal(r.ok, true);
  assert.equal(r.dispatch?.kind, 'route', 'the stop is handed to the console server to run');
});

test('C2 the covered stop says which pass it ran under (ranUnder, policySkipped)', () => {
  const r = plan(stop(), { pass });
  assert.equal(r.ranUnder, pass.id, 'ranUnder names the pass');
  assert.equal(r.policySkipped, 'always-approve', 'a destructive confirm tool is the always-approve class');
});

test('control: an ended pass covers nothing', () => {
  const ended = Date.now() + 25 * HOUR;
  assert.equal(coveringCall({ service: 'vps', tool: 'run' }, ended), null);
  assert.equal(plan(stop(), { now: ended }).code, 'confirmation_required');
});
