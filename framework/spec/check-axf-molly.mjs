#!/usr/bin/env node
/**
 * axf-molly@1 conformance: the owner lease (shadow → cutover → renew → expiry → undo), the shadow diff log, the host
 * bridge allow-list (every command checked, nothing else passes), the tool list and its HTTP routes, the axHub service
 * record, the old Molly retirement list, and the schema mirror.
 *   node framework/spec/check-axf-molly.mjs           check
 *   node framework/spec/check-axf-molly.mjs --write   regenerate fixtures/axf-molly.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../core/axf-molly.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/axf-molly.json');
const WRITE = process.argv.includes('--write');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-15T12:00:00.000Z';
const plus = (min) => new Date(Date.parse(AT) + min * 60e3).toISOString();

const out = {};

// ------------------------------------------------------------------ lease
t('install starts in shadow, console owns', () => {
  const l = M.initialLease(AT);
  assert.equal(l.mode, 'shadow'); assert.equal(l.owner, 'console'); assert.equal(M.leaseOwner(l, AT), 'console');
  assert.equal(M.canAct(l, 'console', AT), true); assert.equal(M.canAct(l, 'axf-molly', AT), false);
  assert.deepEqual(M.leaseErrors(l), []);
  out.initial = l;
});
t('cutover needs a reason, then axf-molly owns under a lease', () => {
  const l = M.initialLease(AT);
  assert.equal(M.cutover(l, { at: AT }).error, 'cutover needs a reason');
  const c = M.cutover(l, { at: plus(1), by: 'brett', reason: 'shadow clean for 2 h' });
  assert.equal(c.error, ''); assert.equal(c.lease.owner, 'axf-molly'); assert.equal(c.lease.mode, 'cutover'); assert.equal(c.lease.rev, 2);
  assert.equal(c.lease.until, plus(1 + M.LEASE_TTL_MIN));
  assert.equal(M.leaseOwner(c.lease, plus(2)), 'axf-molly'); assert.equal(M.canAct(c.lease, 'console', plus(2)), false);
  assert.equal(M.cutover(c.lease, { at: plus(2), reason: 'again' }).error, 'already cut over: renew the lease instead');
  out.cutover = c.lease;
});
t('an expired lease hands the work back by itself; renew pushes it out', () => {
  const c = M.cutover(M.initialLease(AT), { at: AT, by: 'brett', reason: 'go' }).lease;
  assert.equal(M.leaseOwner(c, plus(M.LEASE_TTL_MIN + 1)), 'console');
  assert.match(M.actingWhy(c, 'console', plus(M.LEASE_TTL_MIN + 1)), /lease expired/);
  const r = M.renew(c, { at: plus(20) });
  assert.equal(r.error, ''); assert.equal(r.lease.until, plus(20 + M.LEASE_TTL_MIN)); assert.equal(r.lease.rev, c.rev);
  assert.equal(M.leaseOwner(r.lease, plus(M.LEASE_TTL_MIN + 1)), 'axf-molly');
  assert.equal(M.renew(M.initialLease(AT), { at: AT }).error, 'nothing to renew: not in cutover');
  out.expiredWhy = M.actingWhy(c, 'console', plus(M.LEASE_TTL_MIN + 1));
});
t('undo goes back to shadow at once and History keeps the step', () => {
  const c = M.cutover(M.initialLease(AT), { at: AT, by: 'brett', reason: 'go' }).lease;
  const u = M.undo(c, { at: plus(5), by: 'brett', reason: 'lander landed the wrong PR' });
  assert.equal(u.error, ''); assert.equal(u.lease.mode, 'shadow'); assert.equal(u.lease.owner, 'console'); assert.equal(u.lease.until, '');
  assert.equal(u.lease.history.at(-1).mode, 'undo'); assert.equal(u.lease.history.length, 3);
  assert.equal(M.undo(u.lease, { at: plus(6) }).error, 'nothing to undo: already in shadow');
  out.undo = u.lease;
});
t('normLease repairs a broken record and leaseErrors names the faults', () => {
  const bad = { $axf: 'x', owner: 'axf-molly', mode: 'shadow', until: 'never' };
  assert.deepEqual(M.leaseErrors(bad), ['lease.$axf: expected molly-lease@1', 'lease.owner: axf-molly owns only in cutover']);
  const fixed = M.normLease(bad, AT);
  assert.equal(fixed.owner, 'console'); assert.deepEqual(M.leaseErrors(fixed), []);
  assert.deepEqual(M.leaseErrors({ $axf: M.LEASE_FRAME, owner: 'axf-molly', mode: 'cutover', until: 'soon' }), ['lease.until: an ISO time while mode is cutover']);
  out.repaired = fixed;
});

// ------------------------------------------------------------------ shadow log
t('diffPlans sees launches, waits, queue and running differ', () => {
  const mine = { launches: [{ id: 'a', account: 'max', model: 'Fable' }], waits: [{ id: 'b', why: 'no slot' }], queue: ['a', 'b'], running: ['c'] };
  const theirs = { launches: [{ id: 'a', account: 'hulu', model: 'Fable' }], waits: [{ id: 'b', why: 'no slot' }], queue: ['a', 'b'], running: ['c', 'd'] };
  const d = M.diffPlans(mine, theirs);
  assert.equal(d.same, false); assert.equal(d.diffs.length, 2);
  assert.deepEqual(M.diffPlans(mine, mine), { same: true, diffs: [] });
  const e = M.diffEntry('tick', { at: AT, diffs: d.diffs });
  assert.equal(e.$axf, M.DIFF_FRAME); assert.equal(e.count, 2);
  out.diff = e;
});
t('shadowSummary: a clean hour says ready for cutover', () => {
  const lines = [M.diffEntry('tick', { at: AT, diffs: [{ what: 'launch', id: 'a', mine: 'yes', theirs: 'no' }] }), M.diffEntry('tick', { at: plus(1) }), M.diffEntry('lander', { at: plus(30) })];
  const early = M.shadowSummary(lines, { now: plus(31) });
  assert.equal(early.differing, 1); assert.equal(early.readyForCutover, false); assert.equal(early.cleanForMin, 31);
  const later = M.shadowSummary(lines, { now: plus(61) });
  assert.equal(later.readyForCutover, true);
  assert.equal(M.shadowSummary([], { now: AT }).readyForCutover, false);
  out.shadowSummary = later;
});

// ------------------------------------------------------------------ bridge
t('bridgeCheck passes the fixed list and nothing else', () => {
  assert.equal(M.bridgeCheck({ cmd: 'tmux.has', args: ['axf-my-build'] }).ok, true);
  assert.equal(M.bridgeCheck({ cmd: 'tmux.has', args: ['molly'] }).error, 'tmux.has: bad session "molly"');
  assert.equal(M.bridgeCheck({ cmd: 'tmux.has', args: [] }).error, 'tmux.has: missing session');
  assert.equal(M.bridgeCheck({ cmd: 'tmux.list', args: ['x'] }).error, 'tmux.list: too many arguments');
  assert.equal(M.bridgeCheck({ cmd: 'docker', args: ['ps'] }).error, 'unknown bridge command "docker"');
  assert.equal(M.bridgeCheck({ cmd: 'sh', args: ['-c', 'ls'] }).ok, false);
  assert.equal(M.bridgeCheck(null).ok, false);
  const l = M.bridgeCheck({ cmd: 'launch', args: ['my-build', 'mossesx-max-', 'fable', '.axf-brief.md', 'my-build.log'] });
  assert.equal(l.ok, true); assert.equal(l.args.length, 5);
  const lt = M.bridgeCheck({ cmd: 'launch', args: ['my-build', 'mossesx-max-', 'fable', '.axf-brief.md', 'my-build.log', 'tok_abcdefghij', 'high'] });
  assert.equal(lt.ok, true); assert.equal(lt.args.length, 7);
  assert.equal(M.bridgeCheck({ cmd: 'launch', args: ['my-build', 'a', 'fable', 'b', 'l', 'short', 'high'] }).ok, false);
  assert.equal(M.bridgeCheck({ cmd: 'launch', args: ['my-build', 'a', 'fable', 'b', 'l', 'tok_abcdefghij', 'P0'] }).ok, false);
  assert.equal(M.bridgeCheck({ cmd: 'launch', args: ['../etc', 'a', 'fable', 'b', 'l'] }).ok, false);
  assert.equal(M.bridgeCheck({ cmd: 'launch', args: ['my-build', 'a', 'fable', '../../x', 'l'] }).ok, false);
  const g = M.bridgeCheck({ cmd: 'git', args: ['my-build', 'log', '--oneline', '-3'] });
  assert.equal(g.ok, true); assert.deepEqual(g.args, ['my-build', 'log', '--oneline', '-3']);
  assert.match(M.bridgeCheck({ cmd: 'git', args: ['my-build', 'push'] }).error, /not allowed/);
  assert.equal(M.bridgeCheck({ cmd: 'git', args: ['my-build', 'worktree', 'add', '/tmp/x'] }).error, 'git worktree: only list');
  assert.equal(M.bridgeCheck({ cmd: 'git', args: ['my-build', 'log', '--output=/etc/passwd'] }).ok, false);
  assert.equal(M.bridgeCheck({ cmd: 'tmux.capture', args: ['axf-x', '40'] }).ok, true);
  assert.equal(M.bridgeCheck({ cmd: 'tmux.capture', args: ['axf-x', 'all'] }).ok, false);
  assert.equal(M.worktreeFor('my-build'), '/root/axf-builds/my-build'); assert.equal(M.worktreeFor('../x'), '');
  out.bridge = { commands: Object.fromEntries(Object.entries(M.BRIDGE_COMMANDS).map(([k, v]) => [k, v.touches])), never: M.BRIDGE_NEVER, git: M.GIT_SUBCOMMANDS };
});
t('bridge frames', () => {
  const q = M.bridgeRequest('tmux.has', ['axf-x'], 'r1');
  assert.equal(q.$axf, M.BRIDGE_FRAME);
  const r = M.bridgeReply('r1', { ok: true, status: 0, stdout: 'yes' });
  assert.deepEqual(r, { $axf: M.BRIDGE_FRAME, id: 'r1', ok: true, status: 0, stdout: 'yes', stderr: '', error: '', ms: 0 });
});

// ------------------------------------------------------------------ tools
t('every tool has a family, a method, a path, a cli and a voice line; exclusive tools mutate', () => {
  for (const [name, tool] of Object.entries(M.TOOLS)) {
    assert.ok(M.TOOL_FAMILIES.includes(name.split('.')[0]), name);
    assert.ok(['GET', 'POST'].includes(tool.method), name);
    assert.ok(tool.path.startsWith('/'), name);
    assert.ok(tool.cli.length >= 1, name); assert.ok(tool.says.length > 3, name);
    if (tool.exclusive) assert.equal(tool.mutates, true, name);
    if (tool.method === 'GET') assert.equal(tool.mutates, false, name);
    for (const p of tool.path.match(/\{[a-z]+\}/g) ?? []) assert.ok(tool.args.includes(p.slice(1, -1)), `${name}: ${p} is an argument`);
  }
  assert.equal(M.toolNames('gate').length, 3);
  assert.equal(M.toolFor('nope'), null);
  out.tools = M.TOOLS;
});
t('routeTool maps HTTP to tools, refuses odd ids', () => {
  assert.deepEqual(M.routeTool('GET', '/v1/orchestrator/status'), { tool: 'orchestrator.status', params: {} });
  assert.deepEqual(M.routeTool('POST', '/v1/orchestrator/builds/my-build/queue'), { tool: 'orchestrator.queue', params: { id: 'my-build' } });
  assert.deepEqual(M.routeTool('POST', '/v1/orchestrator/builds/my-build/steps/s1'), { tool: 'orchestrator.step', params: { id: 'my-build', step: 's1' } });
  assert.deepEqual(M.routeTool('GET', '/v1/features/x?since=2026-11-01'), { tool: 'features.show', params: { id: 'x' } });
  assert.equal(M.routeTool('GET', '/v1/orchestrator/builds/..%2Fetc'), null);
  assert.equal(M.routeTool('DELETE', '/v1/orchestrator/status'), null);
  assert.equal(M.routeTool('GET', '/v1/nothing'), null);
  assert.deepEqual(M.routeTool('POST', '/v1/mode/cutover'), { tool: 'molly.cutover', params: {} });
});
t('the axHub service record carries every tool and the equivalents', () => {
  const s = M.axhubService();
  assert.equal(s.service, 'axf-molly'); assert.equal(s.tools.length, Object.keys(M.TOOLS).length);
  assert.equal(s.equivalents['axf-console.build_orchestrator_pipeline_request'], 'orchestrator.request');
  assert.ok(s.tools.every((x) => x.path.startsWith('/v1/')));
  assert.equal(s.reason.title, 'Register axf-molly');
  out.axhubService = s;
});
t('console targets are view: links; the alert link is one of them', () => {
  for (const v of Object.values(M.CONSOLE_TARGETS)) assert.match(v, /^view:[a-z-]+$/);
  assert.equal(M.ALERT_LINK, 'view:build-orchestrator');
});

// ------------------------------------------------------------------ old Molly
t('axf-molly does not clash with the old molly container, which is listed for retirement', () => {
  const c = M.nameClash(['axf-console', 'molly', 'axhub-web']);
  assert.deepEqual(c, { clash: false, near: ['molly'] });
  assert.equal(M.nameClash(['axf-molly']).clash, true);
  const lines = M.retirementList({ containers: ['molly (molly:latest, coolify network, molly.amberxai.com)'], images: ['molly:latest'], crons: ['/etc/cron.d/molly'], files: ['/usr/local/bin/molly-update'], domains: ['molly.amberxai.com'], dirs: ['/opt/molly'] });
  assert.equal(lines.length, 6); assert.equal(lines[0].startsWith('container: '), true);
  out.retirement = { old: M.OLD_MOLLY, lines };
});

// ------------------------------------------------------------------ status + schema
t('statusFrame says who acts and why', () => {
  const s = M.statusFrame({ at: AT, lease: M.initialLease(AT), side: 'axf-molly', shadow: M.shadowSummary([], { now: AT }) });
  assert.equal(s.owner, 'console'); assert.equal(s.acting, false); assert.match(s.why, /shadow mode/);
  out.status = s;
});
t('schemas/axf-molly.json mirrors the engine', () => {
  const j = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/axf-molly.json'), 'utf8'));
  assert.equal(j.schema, M.SCHEMA); assert.deepEqual(j.sides, M.SIDES); assert.deepEqual(j.modes, M.MODES);
  assert.equal(j.leaseTtlMin, M.LEASE_TTL_MIN); assert.equal(j.port, M.PORT); assert.equal(j.bridgeSocket, M.BRIDGE_SOCKET);
  assert.deepEqual(j.bridgeCommands, Object.keys(M.BRIDGE_COMMANDS)); assert.deepEqual(j.tools, Object.keys(M.TOOLS));
  assert.deepEqual(j.consoleTargets, M.CONSOLE_TARGETS); assert.deepEqual(j.cadence, M.CADENCE);
});

// ------------------------------------------------------------------ fixtures
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'fixture@1', schema: M.SCHEMA, at: AT, expected: out }, null, 2)}\n`); console.log(`wrote ${FIX}`); }
else {
  const fx = JSON.parse(readFileSync(FIX, 'utf8'));
  for (const [k, v] of Object.entries(out)) t(`fixture ${k}`, () => { if (!same(fx.expected[k], v)) { console.error(JSON.stringify(v)); assert.fail(`fixtures/axf-molly.json expected.${k} differs (run with --write after a deliberate change)`); } });
}
console.log(`axf-molly@1: ${n} checks ok`);
