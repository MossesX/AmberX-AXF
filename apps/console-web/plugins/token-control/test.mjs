#!/usr/bin/env node
/**
 * Token control tests (node apps/console-web/plugins/token-control/test.mjs). Every store is a temp copy: the look
 * document, the AmberX tables, the plans and an orchestrator@1 file (AXF_ORCH_FILE), so nothing shared is touched.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const T = mkdtempSync(join(tmpdir(), 'axf-tc-'));
Object.assign(process.env, {
  AXF_APPEARANCE_FILE: join(T, 'appearance.json'), AXF_AMBERX_NOTES_DIR: join(T, 'notes'), AXF_CONTROL_DATA_DIR: join(T, 'data'),
  AXF_PLANS_DIR: join(T, 'plans'), AXF_ORCH_FILE: join(T, 'orch.json'), AXF_CONTROL_SALT: 'test-salt',
  AXF_THREADS_FILE: join(T, 'THREADS.md'), AXF_PASS_SECRET: 'pass-secret', AXF_NO_TTY_APPROVAL: '1',
});
writeFileSync(process.env.AXF_APPEARANCE_FILE, JSON.stringify({ $axf: 'appearance@1', slots: { 'design-package': 'hub-default', layout: 'axhub-console' }, settings: { 'axf.banners.x': 1 } }));

const { runControl, commandFromArgv, formatAnswer, main } = await import('./control.mjs');
const ov = await import('../../../../framework/core/engines/control-tokens.mjs');
const { controlForms } = await import('./web/client.mjs');
const doc = () => JSON.parse(readFileSync(process.env.AXF_APPEARANCE_FILE, 'utf8'));

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}\n  ${e.stack}`); process.exitCode = 1; } };

/* ---- the overrides engine */
await test('overrides: apply, effective, with/without', () => {
  const raw = ov.withTokenOverride({}, 'navWidth', 200);
  assert.deepEqual(raw, { '*': { navWidth: 200 } });
  assert.equal(ov.applyTokenOverrides('tokens.layout', { navWidth: 224, nav: 'left' }, ov.effectiveTokenOverrides(raw, 'x')).navWidth, 200);
  assert.equal(ov.applyTokenOverrides('tokens.theme', { tokens: { accent: '#000' } }, { accent: '#fff' }).tokens.accent, '#fff'); // theme-ok
  assert.equal(ov.applyTokenOverrides('tokens.style', { radius: { md: 4 } }, { 'radius.md': 9 }).radius.md, 9);
  assert.deepEqual(ov.effectiveTokenOverrides({ '*': { a: 1 }, amber: { a: 2 } }, 'amber'), { a: 2 });
  assert.equal(ov.withoutTokenOverride(raw, 'navWidth'), null);
  assert.deepEqual(ov.normalizeTokenOverrides({ '*': { ok: 1, 'bad key!': 2, obj: {} }, 'Bad Id': { a: 1 } }), { '*': { ok: 1 } });
  assert.throws(() => ov.withTokenOverride({ '*': Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, 'x'.repeat(10)])) }, 'more', 1));
  const src = { tokens: { accent: '#000' } }; ov.applyTokenOverrides('tokens.theme', src, { accent: '#fff' }); assert.equal(src.tokens.accent, '#000'); // theme-ok
});

/* ---- tokens */
await test('tokens: get / set / list / reset ride the look document', async () => {
  const g = await runControl({ op: 'get', target: 'tokens.layout', path: 'navWidth' });
  assert.equal(g.ok, true); assert.equal(g.item.asset, 'axhub-console'); assert.equal(g.item.overridden, false);
  const s = await runControl({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 200, by: 'test', reason: 'r' });
  assert.equal(s.ok, true); assert.equal(s.item.value, 200); assert.equal(s.audit.by, 'test');
  assert.deepEqual(doc().settings['axf.tokens.layout'], { '*': { navWidth: 200 } });
  assert.equal(doc().settings['axf.banners.x'], 1, 'other look settings are kept');
  const l = await runControl({ op: 'list', target: 'tokens.layout' });
  assert.ok(l.items.find((x) => x.id === 'navWidth').overridden);
  const bad = await runControl({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 99999 });
  assert.equal(bad.code, 'validation');
  const r = await runControl({ op: 'reset', target: 'tokens.layout', path: 'navWidth' });
  assert.equal(r.ok, true); assert.equal(doc().settings['axf.tokens.layout'], undefined);
});
await test('tokens: theme colour, style field, design package resolves the theme', async () => {
  const g = await runControl({ op: 'get', target: 'tokens.theme', path: 'accent' });
  assert.equal(g.item.asset, 'hub-night');
  assert.equal((await runControl({ op: 'set', target: 'tokens.theme', path: 'accent', value: 'not a colour' })).code, 'validation');
  assert.equal((await runControl({ op: 'set', target: 'tokens.style', path: 'radius.md', value: 8 })).ok, true);
  assert.equal((await runControl({ op: 'reset', target: 'tokens.style' })).ok, true);
  assert.equal(doc().settings['axf.tokens.style'], undefined);
});
await test('tokens: slots swap, override under a design package, reset needs a slot', async () => {
  const s = await runControl({ op: 'set', target: 'tokens.slots', path: 'color-theme', value: 'arctic-daylight' });
  assert.equal(s.ok, true); assert.equal(s.item.value, 'arctic-daylight');
  assert.equal(doc().settings['axf.appearance.overrides']['color-theme'], 'arctic-daylight');
  assert.equal((await runControl({ op: 'set', target: 'tokens.slots', path: 'color-theme', value: 'nope' })).code, 'validation');
  assert.equal((await runControl({ op: 'reset', target: 'tokens.slots' })).code, 'validation');
  assert.equal((await runControl({ op: 'reset', target: 'tokens.slots', path: 'color-theme' })).ok, true);
  assert.equal(doc().settings['axf.appearance.overrides'], undefined);
});
await test('tokens: look / custom are retired', async () => {
  assert.equal((await runControl({ op: 'set', target: 'tokens.look', path: 'compact', value: true })).code, 'not_implemented');
  assert.equal((await runControl({ op: 'list', target: 'tokens.custom' })).ok, true);
});

/* ---- the gate */
await test('gate: denied, not_found, invalid, confirm bound to the command', async () => {
  assert.equal((await runControl({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 1 }, { grants: ['control.tokens.read'] })).code, 'denied');
  assert.equal((await runControl({ op: 'get', target: 'tokens.layout', path: 'navWidth' }, { grants: ['control.tokens.read'] })).ok, true);
  assert.equal((await runControl({ op: 'list', target: 'nope' })).code, 'not_found');
  assert.equal((await runControl({ op: 'add', target: 'tokens.layout', value: {} })).code, 'invalid');
});

/* ---- AmberX */
await test('amberx: add / list / act / set / remove with confirm', async () => {
  const a = await runControl({ op: 'add', target: 'amberx.items', value: { kind: 'todo', text: 'Buy milk' }, by: 'test' });
  assert.equal(a.ok, true); const id = a.item.id; assert.equal(a.item.list, 'inbox');
  assert.equal((await runControl({ op: 'list', target: 'amberx.items', select: { kind: 'todo', status: 'not-done' } })).total, 1);
  assert.equal((await runControl({ op: 'act', target: 'amberx.items', path: id, action: 'done' })).item.status, 'done');
  assert.equal((await runControl({ op: 'set', target: 'amberx.items', path: id, value: { title: 'Milk' } })).item.title, 'Milk');
  const l = await runControl({ op: 'add', target: 'amberx.lists', value: { name: 'Groceries' } });
  assert.equal((await runControl({ op: 'act', target: 'amberx.items', path: id, action: 'move', input: { list: 'groceries' } })).item.list, l.item.id);
  const first = await runControl({ op: 'remove', target: 'amberx.items', path: id });
  assert.equal(first.code, 'confirmation_required'); assert.match(first.confirm, /^c1\./);
  assert.equal((await runControl({ op: 'remove', target: 'amberx.items', path: 'other', confirm: first.confirm })).code, 'confirmation_required', 'a token is bound to its record');
  assert.equal((await runControl({ op: 'remove', target: 'amberx.items', path: id, confirm: first.confirm })).removed, 1);
  assert.equal((await runControl({ op: 'get', target: 'amberx.items', path: id })).code, 'not_found');
  assert.equal((await runControl({ op: 'remove', target: 'amberx.lists', path: 'inbox' })).code, 'validation');
  const head = JSON.parse(readFileSync(join(process.env.AXF_AMBERX_NOTES_DIR, 'lists', 'head.json'), 'utf8'));
  assert.equal(head.$axf, 'hub-table@1'); assert.ok(head.rows.inbox);
});
await test('amberx: an alias preset fixes the kind', async () => {
  const a = await runControl({ op: 'add', target: 'amberx.items', value: { text: 'a task' } }, { preset: { kind: 'task' } });
  assert.equal(a.item.kind, 'task');
  assert.equal((await runControl({ op: 'list', target: 'amberx.items' }, { preset: { kind: 'note' } })).total, 0);
});

/* ---- planner */
await test('planner: plans add (parked) / comment / remove; builds add / step / note / move-step / remove', async () => {
  const p = await runControl({ op: 'add', target: 'planner.plans', value: { title: 'Control test plan' } });
  assert.equal(p.ok, true, p.message); assert.equal(p.item.status, 'parked');
  assert.equal((await runControl({ op: 'act', target: 'planner.plans', path: p.item.id, action: 'comment', input: { text: 'hi' } })).item.comments.length, 1);
  const c1 = await runControl({ op: 'remove', target: 'planner.plans', path: p.item.id });
  assert.equal((await runControl({ op: 'remove', target: 'planner.plans', path: p.item.id, confirm: c1.confirm })).removed, 1);
  const b = await runControl({ op: 'add', target: 'planner.builds', value: { title: 'Control test build', steps: [{ text: 'one', model: 'Opus', estimate: '10 min' }, { text: 'two', model: 'Opus', estimate: '10 min' }] } });
  assert.equal(b.ok, true, b.message);
  const id = b.item.id;
  assert.equal((await runControl({ op: 'act', target: 'planner.builds', path: id, action: 'step', input: { step: 's1', done: true } })).item.steps[0].done, true);
  assert.equal((await runControl({ op: 'act', target: 'planner.builds', path: id, action: 'note', input: { text: 'n' } })).item.notes.length, 1);
  assert.equal((await runControl({ op: 'act', target: 'planner.builds', path: id, action: 'move-step', input: { step: 's2', to: 0 } })).item.steps[0].id, 's2');
  assert.equal((await runControl({ op: 'set', target: 'planner.builds', path: id, value: { status: 'running' } })).item.status, 'running');
  const c2 = await runControl({ op: 'remove', target: 'planner.builds', path: id });
  assert.equal((await runControl({ op: 'remove', target: 'planner.builds', path: id, confirm: c2.confirm })).ok, true);
  assert.equal((await runControl({ op: 'list', target: 'planner.builds' })).total, 0);
});

/* ---- CLI words, printing, client forms */
await test('cli: aliases, verbs, shortcuts, flags', () => {
  assert.deepEqual(commandFromArgv(['token', 'layout', 'set', 'navWidth', '200']).command, { op: 'set', target: 'tokens.layout', path: 'navWidth', value: 200 });
  assert.deepEqual(commandFromArgv(['todo', 'add', 'Buy', 'milk', '--list', 'groceries']).command.value, { text: 'Buy milk', list: 'groceries' });
  assert.equal(commandFromArgv(['todo', 'add', 'x']).preset.kind, 'todo');
  assert.deepEqual(commandFromArgv(['todo', 'done', 'd-1']).command, { op: 'act', target: 'amberx.items', action: 'done', path: 'd-1', input: {} });
  assert.deepEqual(commandFromArgv(['build', 'step', 'b', 's3', 'undo']).command.input, { step: 's3', done: false });
  assert.deepEqual(commandFromArgv(['build', 'note', 'b', 'half', 'way']).command.input, { text: 'half way' });
  assert.deepEqual(commandFromArgv(['control', 'list', 'amberx.items', '--select', 'kind=todo']).command.select, { kind: 'todo' });
  assert.equal(commandFromArgv(['note', 'remove', 'n-1', '--confirm', 'c1.x']).command.confirm, 'c1.x');
  assert.ok(commandFromArgv(['token', 'nope', 'get']).error);
  assert.ok(commandFromArgv(['control', 'frob', 'amberx.items']).error);
  assert.match(formatAnswer({ ok: false, code: 'confirmation_required', message: 'm', confirm: 'c1.y' }), /c1\.y/);
});
await test('cli main: exit codes (0 ok, 2 usage, 3 confirm)', async () => {
  const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {};
  try {
    assert.equal(await main(['token', 'layout', 'get', 'navWidth']), 0);
    assert.equal(await main(['control', 'frob', 'x']), 2);
    const a = await runControl({ op: 'add', target: 'amberx.items', value: { text: 'gone soon' } });
    assert.equal(await main(['note', 'remove', a.item.id]), 3);
  } finally { console.log = log; console.error = err; }
});
await test('client forms: REST, MCP and CLI agree', () => {
  const f = controlForms({ op: 'act', target: 'planner.builds', path: 'token-control', action: 'step', input: { step: 's14', done: true } });
  assert.match(f.rest, /\/api\/control\/planner\.builds\/token-control\/act\/step/);
  assert.equal(f.mcp.tool, 'control_act'); assert.equal(f.mcp.arguments.action, 'step');
  assert.match(f.cli, /^axf control act planner\.builds token-control step/);
});
await test('audit log: every write, no reads', async () => {
  const { readAudit } = await import('./lib/common.mjs');
  const rows = readAudit(500);
  assert.ok(rows.length > 5); assert.ok(rows.every((r) => r.op !== 'get' && r.op !== 'list'));
});

/* ---- veto passes (control-pass@1) */
const pc = await import('../../../../framework/core/engines/control-pass.mjs');
const passLib = await import('./lib/pass.mjs');
const BRETT = { via: 'console', name: 'brett' };
const grant = (scope, minutes, opts = {}) => runControl({ op: 'act', target: 'pass.scopes', path: scope, action: 'grant', input: minutes === undefined ? {} : { minutes }, by: 'claude' }, opts);
const passOf = async (scope, now) => (await runControl({ op: 'get', target: 'pass.scopes', path: scope }, { now })).item;

await test('pass engine: scopes, coverage, minutes, narrow scopes never cover deletes', () => {
  assert.equal(pc.passScopeOf({ op: 'set', target: 'tokens.theme' }), 'tokens.theme');
  assert.equal(pc.passScopeOf({ op: 'reset', target: 'tokens.layout' }), 'tokens.layout');
  assert.equal(pc.passScopeOf({ op: 'remove', target: 'amberx.items' }), 'all', 'every other write falls in all');
  assert.equal(pc.passScopeOf({ op: 'set', target: 'tokens.slots' }), 'all', 'slot swaps are in no token scope, only all');
  assert.equal(pc.passScopeOf({ op: 'set', target: 'amberx.items' }), 'all');
  assert.equal(pc.passScopeOf({ op: 'get', target: 'amberx.items' }), null, 'reads need no pass');
  assert.equal(pc.passScopeOf({ op: 'act', target: 'pass.scopes', action: 'grant' }), null, 'a pass never covers the pass target');
  assert.deepEqual(pc.passScopesFor({ op: 'set', target: 'tokens.style' }), ['all', 'tokens.style', 'tokens.*']);
  assert.equal(pc.passMinutes(undefined), 30); assert.equal(pc.passMinutes(0), 1); assert.equal(pc.passMinutes(999), 240); assert.equal(pc.passMinutes(90, 60), 60);
  assert.equal(pc.passScopeId('colours'), 'tokens.theme'); assert.equal(pc.passScopeId('all'), 'all'); assert.equal(pc.passScopeId('everything'), 'all'); assert.equal(pc.passScopeId(''), 'all', 'no scope = everything'); assert.equal(pc.passScopeId('tokens'), 'tokens.*'); assert.equal(pc.passScopeId('nope'), null);
  const p = { id: 'p', scope: 'tokens.*', state: 'active', expiresAt: new Date(1e12 + 60000).toISOString() };
  for (const op of ['remove', 'add', 'act']) assert.equal(pc.passCovering([p], { op, target: 'tokens.theme' }, 1e12), null, `${op} is never covered`);
  assert.equal(pc.passCovering([p], { op: 'set', target: 'tokens.theme' }, 1e12), p);
  assert.equal(pc.passCovering([p], { op: 'set', target: 'tokens.theme' }, 1e12 + 60000), null, 'expiry is the clock');
});

await test('pass: a grant is only a request until Brett approves it', async () => {
  const r = await grant('tokens.theme', 20);
  assert.equal(r.ok, true); assert.equal(r.item.state, 'pending'); assert.equal(r.approval.required, true);
  const s = await runControl({ op: 'set', target: 'tokens.theme', path: 'accent', value: '#112233', by: 'claude' }); // theme-ok
  assert.equal(s.passScope, 'tokens.theme'); assert.equal(s.pass, undefined, 'a waiting request covers nothing');
  const self = await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'approve', input: { request: r.item.id }, by: 'claude' });
  assert.equal(self.code, 'denied', 'no approver = an agent can never approve its own pass');
  const forged = await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'approve', input: { request: r.item.id } }, { approver: { via: 'axhub', name: 'brett' } });
  assert.equal(forged.code, 'denied', 'axhub approval needs the signed proof, not a claim');
  const bad = await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'approve', input: { request: r.item.id } }, { proof: { approver: 'brett', signature: 't=1,v1=' + '0'.repeat(64) } });
  assert.equal(bad.code, 'denied', 'a bad signature is refused');
  const sig = passLib.signPayload(passLib.approvalMessage(r.item.id, 'tokens.theme', 20, 'brett'));
  const ok = await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'approve', input: { request: r.item.id } }, { proof: { approver: 'brett', signature: sig } });
  assert.equal(ok.ok, true); assert.equal(ok.item.state, 'active'); assert.equal(ok.item.approvedVia, 'axhub');
  assert.match(ok.text, /^Theme changes run without veto until \d{1,2}:\d{2} [AP]M \(20 min left\)\.$/);
  await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'revoke', by: 'test' });
  await runControl({ op: 'reset', target: 'tokens.theme' });
});

await test('pass: Brett\'s own grant is on at once; covered writes are logged; deletes still confirm', async () => {
  const g = await grant('tokens.*', 30, { approver: BRETT });
  assert.equal(g.item.state, 'active'); assert.equal(g.item.approvedBy, 'brett');
  const s = await runControl({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 210, by: 'claude' });
  assert.equal(s.pass.id, g.item.id); assert.equal(s.passScope, 'tokens.layout');
  await runControl({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 220, by: 'claude' });
  await runControl({ op: 'set', target: 'tokens.style', path: 'radius.md', value: 9, by: 'claude' });
  assert.equal((await passOf('tokens.*')).active.changes, 3);
  const other = await runControl({ op: 'set', target: 'tokens.sizing', path: 'button.height', value: 2.5 });
  assert.equal(other.ok, true);
  assert.equal(other.passScope, 'all'); assert.equal(other.pass, undefined, 'sizing is outside every token scope: only an all pass covers it');
  const a = await runControl({ op: 'add', target: 'amberx.items', value: { text: 'pass cannot delete me' } });
  const rm = await runControl({ op: 'remove', target: 'amberx.items', path: a.item.id });
  assert.equal(rm.code, 'confirmation_required', 'a token pass never covers deletes');
  const log = readFileSync(process.env.AXF_THREADS_FILE, 'utf8');
  assert.match(log, /## Token passes \(log\)/); assert.match(log, /granted 30 min by brett \(console\)/); assert.match(log, /claude: tokens\.layout navWidth .* → 220/);
  const { readAudit } = await import('./lib/common.mjs');
  assert.ok(readAudit(50).some((r) => r.pass === g.item.id && r.action === 'change' && r.change.path === 'navWidth'));
});

await test('pass: undo puts back every token as it was before the pass', async () => {
  const u = await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.*', action: 'undo', by: 'brett' });
  assert.equal(u.ok, true); assert.equal(u.restored.length, 2, 'navWidth once (first value), radius.md');
  assert.equal(doc().settings['axf.tokens.layout'], undefined, 'navWidth back to the theme');
  assert.equal(doc().settings['axf.tokens.style'], undefined);
  assert.equal((await passOf('tokens.*')).active.state, 'active', 'the pass stays on');
  // an override that existed before the pass comes back to its old value, not the theme's
  await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.*', action: 'revoke', by: 'test' });
  await runControl({ op: 'set', target: 'tokens.theme', path: 'accent', value: '#123456' }); // theme-ok
  await grant('tokens.theme', 10, { approver: BRETT });
  await runControl({ op: 'set', target: 'tokens.theme', path: 'accent', value: '#abcdef' }); // theme-ok
  await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'undo' });
  assert.equal((await runControl({ op: 'get', target: 'tokens.theme', path: 'accent' })).value, '#123456'); // theme-ok
});

await test('pass: extend replaces and keeps the change log; revoke; expiry on the server clock', async () => {
  const now = Date.now();
  const first = await passOf('tokens.theme', now);
  await runControl({ op: 'set', target: 'tokens.theme', path: 'bg', value: '#000000' }); // theme-ok
  const ext = await grant('tokens.theme', 45, { approver: BRETT, now: now + 1000 });
  assert.notEqual(ext.item.id, first.active.id); assert.equal(ext.item.changes, 1, 'the log carries over'); assert.equal(ext.item.minutes, 45);
  assert.equal((await runControl({ op: 'list', target: 'pass.scopes' }, { now })).items.filter((x) => x.active).length, 1, 'one pass per scope');
  const later = now + 46 * 60000;
  const st = await passOf('tokens.theme', later);
  assert.equal(st.active, null); assert.match(st.text, /go through the veto/);
  const s = await runControl({ op: 'set', target: 'tokens.theme', path: 'bg', value: '#111111' }, { now: later }); // theme-ok
  assert.equal(s.pass, undefined, 'an ended pass covers nothing');
  assert.match(readFileSync(process.env.AXF_THREADS_FILE, 'utf8'), /ended at/);
  await grant('tokens.layout', 5, { approver: BRETT });
  const rv = await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.layout', action: 'revoke', by: 'brett' });
  assert.equal(rv.ok, true); assert.match(rv.text, /revoked/);
  assert.equal((await passOf('tokens.layout')).active, null);
  // a request nobody approves lapses
  const req = await grant('tokens.style', 10);
  assert.equal((await passOf('tokens.style', Date.now() + pc.PASS_REQUEST_TTL_MS + 1000)).pending, null);
  assert.ok(req.ok);
  await runControl({ op: 'reset', target: 'tokens.theme' });
});

await test('pass: signed publication, check, CLI words', async () => {
  await grant('tokens.theme', 15, { approver: BRETT });
  const p = passLib.publication();
  assert.equal(p.body.$axf, 'control-pass@1'); assert.equal(p.body.active.length, 1); assert.equal(p.body.default, 'all'); assert.deepEqual(p.body.excluded, ['pass.scopes']); assert.deepEqual(p.body.scopes.all.targets, ['*']);
  assert.ok(passLib.verifyPayload(p.payload, p.signature)); assert.ok(!passLib.verifyPayload(p.payload.replace('tokens.theme', 'tokens.style'), p.signature));
  assert.ok(!passLib.verifyPayload(p.payload, p.signature, Date.now() + 10 * 60000), 'old signatures expire');
  assert.ok(passLib.coveringPass({ op: 'set', target: 'tokens.theme' })); assert.equal(passLib.coveringPass({ op: 'remove', target: 'tokens.theme' }), null);
  assert.deepEqual(commandFromArgv(['token', 'pass', 'grant', 'theme', '30']).command, { op: 'act', target: 'pass.scopes', action: 'grant', path: 'tokens.theme', input: { minutes: 30 } });
  assert.equal(commandFromArgv(['token', 'pass', 'status']).command.op, 'list');
  assert.ok(commandFromArgv(['token', 'pass', 'revoke', 'nope']).error);
  const log = console.log; let printed = ''; console.log = (x) => { printed += x; };
  try { assert.equal(await main(['token', 'pass', 'status']), 0); assert.equal(await main(['token', 'pass', 'grant', 'layout', '5']), 0); } finally { console.log = log; }
  assert.match(printed, /Theme changes run without veto until/); assert.match(printed, /waiting for Brett/, 'the CLI without a terminal only files a request');
  await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'revoke' });
});

await test('pass all: everything by default, ordinary deletes skip the confirm, irreversible ones only when included', async () => {
  // CLI: no scope = everything; --scope narrows; the old word order still works
  assert.deepEqual(commandFromArgv(['pass', 'grant', '30']).command, { op: 'act', target: 'pass.scopes', action: 'grant', path: 'all', input: { minutes: 30 } });
  assert.equal(commandFromArgv(['pass', 'grant', '30', '--scope', 'theme']).command.path, 'tokens.theme');
  assert.equal(commandFromArgv(['pass', 'grant', '--include-irreversible']).command.input.include_irreversible, true);
  assert.equal(commandFromArgv(['pass', 'revoke']).command.path, 'all');
  assert.equal(commandFromArgv(['pass', 'status']).command.op, 'list');
  assert.equal((await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'grant', input: { include_irreversible: true } })).code, 'validation', 'include_irreversible only goes with all');

  const g = await grant('all', 30, { approver: BRETT });
  assert.equal(g.item.state, 'active'); assert.equal(g.item.label, 'Everything'); assert.equal(g.item.include_irreversible, false);
  assert.match(g.text, /^Every command runs without veto until /);
  // a token write in a narrow scope, a host token, an AmberX add and set: all covered and logged
  const t = await runControl({ op: 'set', target: 'tokens.theme', path: 'accent', value: '#224466', by: 'claude' }); // theme-ok
  assert.equal(t.pass.scope, 'all'); assert.equal(t.passScope, 'tokens.theme');
  const sz = await runControl({ op: 'set', target: 'tokens.sizing', path: 'button.height', value: 2.25, by: 'claude' });
  assert.equal(sz.pass.id, g.item.id, 'sizing is covered by all');
  const a = await runControl({ op: 'add', target: 'amberx.items', value: { kind: 'todo', text: 'made under the pass' }, by: 'claude' });
  assert.equal(a.pass.id, g.item.id);
  assert.equal((await runControl({ op: 'set', target: 'amberx.items', path: a.item.id, value: { pinned: true }, by: 'claude' })).pass.id, g.item.id);
  // an ordinary delete (a plan: its history brings it back) runs without the confirm token
  const plan = await runControl({ op: 'add', target: 'planner.plans', value: { title: 'Pass plan' }, by: 'claude' });
  const prm = await runControl({ op: 'remove', target: 'planner.plans', path: plan.item.id, by: 'claude' });
  assert.equal(prm.ok, true); assert.equal(prm.confirmSkipped, true); assert.equal(prm.pass.id, g.item.id);
  // an AmberX hard delete is irreversible: it still confirms, and says why
  const irr = await runControl({ op: 'remove', target: 'amberx.items', path: a.item.id, by: 'claude' });
  assert.equal(irr.code, 'confirmation_required'); assert.equal(irr.irreversible, true);
  // a pass never grants or approves a pass
  const self = await grant('tokens.layout', 10);
  assert.equal(self.item.state, 'pending', 'a grant under an all pass is still only a request');
  await runControl({ op: 'act', target: 'pass.scopes', path: 'tokens.layout', action: 'revoke', by: 'test' });
  // axHub's question for any held call
  assert.ok(passLib.coveringCall({ tool: 'vps.run' })); assert.equal(passLib.coveringCall({ tool: 'github.repos/delete', irreversible: true }), null);
  // undo: tokens go back, the rest is listed
  const before = (await passOf('all')).active;
  assert.equal(before.undoable, 2); assert.ok(before.notUndoable >= 4, 'add, set, plan add, plan remove');
  const u = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'undo', by: 'brett' });
  assert.equal(u.restored.length, 2); assert.ok(u.notUndoable.some((x) => x.op === 'remove' && x.target === 'planner.plans'));
  assert.match(u.text, /can't be rolled back automatically: .*add amberx\.items .*made under the pass/);
  assert.equal((await runControl({ op: 'get', target: 'tokens.sizing', path: 'button.height' })).value, 2.5, 'sizing back to its override from before the pass');
  assert.match(readFileSync(process.env.AXF_THREADS_FILE, 'utf8'), /\(all\) · claude: remove planner\.plans/);

  // include_irreversible: Brett's own grant (or axHub's signature over the flag) reaches hard deletes
  const req = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { minutes: 10, include_irreversible: true }, by: 'claude' });
  assert.equal(req.item.state, 'pending');
  const narrowSig = passLib.signPayload(passLib.approvalMessage(req.item.id, 'all', 10, 'brett'));
  assert.equal((await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'approve', input: { request: req.item.id } }, { proof: { approver: 'brett', signature: narrowSig } })).code, 'denied', 'an approval without the flag does not approve a wider request');
  const sig = passLib.signPayload(passLib.approvalMessage(req.item.id, 'all', 10, 'brett', true));
  const ok = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'approve', input: { request: req.item.id } }, { proof: { approver: 'brett', signature: sig } });
  assert.equal(ok.item.state, 'active'); assert.equal(ok.item.include_irreversible, true); assert.match(ok.text, /irreversible deletes included/);
  const gone = await runControl({ op: 'remove', target: 'amberx.items', path: a.item.id, by: 'claude' });
  assert.equal(gone.ok, true); assert.equal(gone.confirmSkipped, true);
  assert.ok(passLib.coveringCall({ tool: 'github.repos/delete', irreversible: true }));
  const rv = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'revoke', by: 'brett' });
  assert.match(rv.text, /^Everything pass revoked: commands need the veto again\.$/);
  assert.equal((await runControl({ op: 'remove', target: 'planner.plans', path: 'nope' })).code, 'confirmation_required', 'after the pass deletes confirm again');
  await runControl({ op: 'reset', target: 'tokens.theme' });
});

/* ---- Auto-approve (build approvals-page-auto-approve-toggle): 1h / 2h / until off on the all pass */
await test('auto-approve: until off renews itself, 1h / 2h presets, off from the same control', async () => {
  const pass = await import('./lib/pass.mjs');
  const owner = { approver: { via: 'console', name: 'brett' } };
  const t0 = Date.now();
  assert.equal(pass.autoState(t0).on, false);
  assert.deepEqual(['1 hour', '2h', 'until I turn it off', 'off'].map(pass.autoPresetId), ['1h', '2h', 'until-off', null]);
  const r = pass.runPass({ op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { until_off: true }, by: 'brett' }, { ...owner, now: t0 });
  assert.equal(r.item.state, 'active'); assert.equal(r.item.until_off, true);
  assert.match(r.text, /^Auto-approve is on until you turn it off: every command except irreversible deletes skips the veto\.$/);
  let a = pass.autoState(t0);
  assert.deepEqual([a.on, a.preset, a.until_off], [true, 'until-off', true]);
  a = pass.autoState(t0 + 3 * 3600e3); // under half of the 240 min left: renewed to 240 again
  assert.deepEqual([a.on, Math.round(a.remainingMs / 60000), a.pass.renewals], [true, 240, 1]);
  const cover = await runControl({ op: 'list', target: 'pass.scopes' });
  assert.equal(cover.items.find((x) => x.id === 'all').active.until_off, true);
  pass.runPass({ op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { minutes: 120 }, by: 'brett' }, { ...owner, now: t0 + 3 * 3600e3 });
  assert.equal(pass.autoState(t0 + 3 * 3600e3).preset, '2h', 'switching to 2 hours replaces until-off');
  pass.runPass({ op: 'act', target: 'pass.scopes', path: 'all', action: 'revoke', by: 'brett' }, { now: t0 + 3 * 3600e3 });
  assert.equal(pass.autoState(t0 + 3 * 3600e3).on, false);
  assert.throws(() => pass.runPass({ op: 'act', target: 'pass.scopes', path: 'tokens.theme', action: 'grant', input: { until_off: true }, by: 'brett' }, owner), /all scope/);
  // an agent's until-off grant is only a request
  const req = await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { until_off: true }, by: 'claude' });
  assert.equal(req.item.state, 'pending'); assert.equal(req.approval.required, true);
  assert.equal(pass.autoState().pending.until_off, true);
  await runControl({ op: 'act', target: 'pass.scopes', path: 'all', action: 'revoke', by: 'brett' });
  // CLI: axf pass auto <preset|off|status>
  const cli = (...w) => commandFromArgv(['pass', 'auto', ...w]).command;
  assert.deepEqual(cli('until-off'), { op: 'act', target: 'pass.scopes', action: 'grant', path: 'all', reason: 'Auto-approve from the CLI', input: { until_off: true, reason: 'Auto-approve from the CLI' } });
  assert.equal(cli('2h').input.minutes, 120);
  assert.equal(cli('1', 'hour').input.minutes, 60);
  assert.deepEqual([cli('off').action, cli('off').path], ['revoke', 'all']);
  assert.deepEqual([cli('status').op, cli().path], ['get', 'all']);
  assert.match(commandFromArgv(['pass', 'auto', 'later']).error, /1h \| 2h \| until-off/);
});

rmSync(T, { recursive: true, force: true });
console.log(`${process.exitCode ? '✗' : '✓'} token-control: ${n} tests passed`);
