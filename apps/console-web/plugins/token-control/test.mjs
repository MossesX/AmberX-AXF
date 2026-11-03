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

rmSync(T, { recursive: true, force: true });
console.log(`${process.exitCode ? '✗' : '✓'} token-control: ${n} tests passed`);
