/**
 * control@1 (core/engines/control-rules.mjs; build token-control s3, Nov 2026): one command schema for every token,
 * every AmberX entity and the planner. Checks: the registry (ops, effects, permissions, targets append-only and
 * complete), the static token paths agree with the layout / scale / theme registries, normalize, errors name every
 * problem, the gate in the INTEROP order (not_found → invalid → denied → validation → confirmation_required) for roles
 * × ops, the confirm flow (bound to the command, ten-minute buckets, replay on another path refused), the result
 * envelopes, the projections (MCP tools, routes, CLI, schema), the snapshot framework/schemas/control.json and the
 * fixture are current, and the spec doc names every target.
 *   npx -y tsx framework/spec/check-control.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTROL_ALIASES, CONTROL_EFFECT, CONTROL_FRAME, CONTROL_OPS, CONTROL_PERMISSIONS, CONTROL_TARGETS, CONTROL_TARGET_IDS, CONTROL_WIRE,
  canonicalControl, controlCli, controlIrreversible, controlConfirmToken, controlConfirmValid, controlErrors, controlFailure, controlGate, controlGranted, controlPaths, controlPermission, controlRegistry, controlResult, controlRoutes, controlSchema, controlTools, normalizeControl,
} from '../core/engines/control-rules.mjs';
import { layoutFieldNames } from '../core/engines/layout-rules.mjs';
import { SCALE_FIELDS, SCALE_ENUMS } from '../core/engines/scale-rules.mjs';
import { MCP_WIRE } from '../core/engines/mcp';
import { hasPermission } from '../core/engines/uac';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const spec = read('framework/schemas/asset-types.json');

/* ---- registry ---- */
eq([...CONTROL_OPS], ['list', 'get', 'set', 'reset', 'add', 'remove', 'act'], 'seven ops');
eq(CONTROL_EFFECT.remove, 'destructive', 'remove is destructive');
eq(CONTROL_EFFECT.act, 'write', 'act writes');
ok(CONTROL_TARGET_IDS.length === 24, `24 targets (${CONTROL_TARGET_IDS.length})`);
eq(CONTROL_TARGET_IDS.slice(0, 13), ['tokens.theme', 'tokens.style', 'tokens.layout', 'tokens.typography', 'tokens.density', 'tokens.sizing', 'tokens.look', 'tokens.custom', 'tokens.slots', 'amberx.items', 'amberx.lists', 'planner.plans', 'planner.builds'], 'targets are append-only');
for (const [id, t] of Object.entries(CONTROL_TARGETS)) {
  ok(/^(tokens|amberx|planner|console|pass|plugins)\.[a-z]+$/.test(id) && id.startsWith(`${t.domain}.`), `${id} is <domain>.<kind>`);
  ok(t.ops.every((o) => CONTROL_OPS.includes(o)), `${id} ops known`);
  ok(t.doc.length > 30, `${id} documented`);
  if (t.paths === 'entity') { ok(t.fields && Object.keys(t.fields).length > 3, `${id} has fields`); ok(t.ops.includes('remove') && t.ops.includes('act'), `${id} is a full entity target`); }
  else ok(!t.ops.includes('remove') && !t.ops.includes('add'), `${id}: tokens, console and plugin targets are never added or removed`);
  // console.placement (settings-placement@1, Nov 4 2026) is the one console target with a value: where settings open per screen
  if (t.domain === 'console' && id !== 'console.placement') ok(!t.ops.includes('set') && !t.ops.includes('reset'), `${id}: the console is opened and run, never set`);
  if (id === 'console.placement') ok(t.ops.includes('set') && t.ops.includes('reset') && !t.ops.includes('act') && t.value === 'host', 'console.placement: set / reset a placement word, no acts');
  for (const [verb, eff] of Object.entries(t.actEffect ?? {})) ok(verb in (t.acts ?? {}) && ['navigate', 'read', 'write', 'destructive'].includes(eff), `${id} act ${verb} effect ${eff}`);
}
eq(Object.keys(CONTROL_PERMISSIONS).length, 19, 'six domains × read / write / delete, plus console navigate');
eq(controlPermission('plugins.reads', 'act', 'read'), 'control.plugins.read', 'a plugin read only reads');
eq(controlPermission('plugins.commands', 'act', 'run'), 'control.plugins.write', 'a plugin command writes (a deleting one asks for more)');
eq(CONTROL_TARGET_IDS.slice(20, 22), ['plugins.commands', 'plugins.reads'], 'plugin targets come after the console and pass ones (append-only)');
eq(CONTROL_TARGET_IDS.slice(22), ['tokens.nav'], 'the nav-style token set comes after the plugin ones (append-only, build molly-nav-submenus)');
eq(controlPermission('console.screens', 'act', 'open'), 'control.console.navigate', 'opening a screen only navigates');
eq(controlPermission('console.nav', 'act', 'back'), 'control.console.navigate', 'going back only navigates');
eq(controlPermission('console.actions', 'act', 'run'), 'control.console.write', 'running an action writes (the host may ask for more)');
eq(controlPermission('console.actions', 'list'), 'control.console.read', 'listing reads');
eq(controlPermission('amberx.items', 'act', 'done'), 'control.amberx.write', 'other acts keep the op effect');
eq(controlPermission('pass.scopes', 'act'), 'control.pass.write', 'a pass grant / revoke / undo is a write');
eq(controlPermission('tokens.layout', 'set'), 'control.tokens.write', 'permission from domain + effect');
eq(controlPermission('amberx.items', 'remove'), 'control.amberx.delete', 'delete permission');
eq(controlPermission('planner.builds', 'list'), 'control.planner.read', 'read permission');
for (const code of Object.values(CONTROL_WIRE)) ok(Object.values(MCP_WIRE).includes(code as never), `wire code ${code} is an INTEROP code`);

/* ---- static paths = the other registries ---- */
eq(controlPaths('tokens.layout')!.map((p) => p.id), layoutFieldNames(), 'layout paths = layout-rules fields');
for (const type of ['typography', 'density', 'sizing'] as const) eq(controlPaths(`tokens.${type}`)!.map((p) => p.id), [...Object.keys(SCALE_FIELDS[type]), ...Object.keys(SCALE_ENUMS[type] ?? {})], `${type} paths = scale-rules fields`);
eq(controlPaths('tokens.theme')!.map((p) => p.id), spec.types['color-theme'].nested.tokens, 'theme paths = asset-types colour tokens');
for (const f of spec.types['style-theme'].required) ok(controlPaths('tokens.style')!.some((p) => p.id === f || p.id.startsWith(`${f}.`)), `style path ${f}`);
eq(controlPaths('tokens.look'), null, 'look paths come from the host');
eq(controlPaths('amberx.items'), null, 'entity ids are records');
ok(controlPaths('tokens.layout')!.find((p) => p.id === 'navWidth')?.token === '--fx-layout-nav-width', 'layout paths carry their CSS token');

/* ---- normalize + errors ---- */
eq(normalizeControl({ op: ' get ', target: 'tokens.theme', path: ' accent ', by: '  me ', junk: 1 }), { $axf: CONTROL_FRAME, op: 'get', target: 'tokens.theme', path: 'accent', by: 'me' }, 'normalize trims and drops unknown fields');
eq(controlErrors({ op: 'get', target: 'tokens.theme', path: 'accent' }), [], 'a good get');
eq(controlErrors({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 200 }), [], 'a good layout set');
ok(controlErrors({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 5000 })[0]!.includes('0 to 640'), 'layout range from layout-rules');
ok(controlErrors({ op: 'set', target: 'tokens.layout', path: 'railWidth', value: 1 })[0]!.includes('no token railWidth'), 'unknown token named');
ok(controlErrors({ op: 'set', target: 'tokens.theme', path: 'accent', value: 'orange-ish' })[0]!.includes('colour'), 'theme wants a colour');
eq(controlErrors({ op: 'set', target: 'tokens.theme', path: 'accent', value: 'rgb(255, 136, 0)' }), [], 'rgb() colour ok');
ok(controlErrors({ op: 'set', target: 'tokens.style', path: 'density', value: 'loose' })[0]!.includes('compact, comfortable, spacious'), 'style enum');
ok(controlErrors({ op: 'set', target: 'tokens.sizing', path: 'button.height', value: 9 })[0]!.includes('button.height'), 'scale range from scale-rules');
eq(controlErrors({ op: 'set', target: 'tokens.look', path: 'compact', value: 80 }), [], 'host target: value shape only');
ok(controlErrors({ op: 'set', target: 'tokens.look', path: 'compact', value: { a: 1 } }).length === 1, 'host target refuses an object value');
const e1 = controlErrors({ op: 'add', target: 'amberx.items', value: { kind: 'memo', title: 7, colour: 'red' } });
ok(e1.some((e) => e.includes('value.kind')) && e1.some((e) => e.includes('value.title')) && e1.some((e) => e.includes('no field colour')), `add names every bad field: ${e1.join(' | ')}`);
ok(controlErrors({ op: 'act', target: 'amberx.items', path: 'x', action: 'move' })[0]!.includes('input.list'), 'act wants its input');
ok(controlErrors({ op: 'act', target: 'amberx.items', path: 'x', action: 'explode' })[0]!.includes('no action explode'), 'unknown verb named with the known ones');
ok(controlErrors({ op: 'list', target: 'amberx.items', select: { colour: 'red' } })[0]!.includes('no filter colour'), 'unknown filter named');
ok(controlErrors({ op: 'remove', target: 'amberx.lists', path: 'inbox' })[0]!.includes('system list'), 'system lists are protected');
ok(controlErrors({ op: 'reset', target: 'amberx.items' })[0]!.includes('does not take reset'), 'entity targets take no reset');
ok(controlErrors({ op: 'add', target: 'tokens.layout', value: {} })[0]!.includes('does not take add'), 'token targets take no add');
ok(controlErrors({ op: 'list', target: 'tokens.layout', path: 'navWidth' })[0]!.includes('takes no path'), 'list takes no path');
ok(controlErrors({ op: 'get', target: 'amberx.notes', path: 'x' })[0]!.includes('target must be one of'), 'unknown target');
ok(controlErrors({ $axf: 'asset@1', op: 'list', target: 'tokens.layout' })[0]!.includes('$axf'), 'wrong frame');
eq(controlErrors({ op: 'reset', target: 'tokens.look' }), [], 'reset without a path = everything');

/* ---- the gate: order and roles ---- */
const salt = 'check';
const NOW = 1_800_000_000_000;
eq(controlGate({ op: 'get', target: 'nope', path: 'x' }, ['*']).code, 'not_found', 'unknown target → not_found (never revealed)');
eq(controlGate({ op: 'reset', target: 'amberx.items' }, ['*']).code, 'invalid', 'op the target does not take → invalid');
eq(controlGate({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 5000 }, ['control.tokens.read']).code, 'denied', 'denied before validation');
eq(controlGate({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 5000 }, ['control.tokens.write']).code, 'validation', 'validation after the permission');
const g = controlGate({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 200 }, ['control.tokens.*']);
ok(g.ok && g.effect === 'write' && g.requires === 'control.tokens.write', 'a good write passes with the wildcard');
ok(controlGate({ op: 'list', target: 'planner.builds' }, ['control.*']).ok, 'control.* covers everything');
ok(controlGate({ op: 'list', target: 'planner.builds' }, ['*']).ok, '* covers everything');
ok(!controlGate({ op: 'list', target: 'planner.builds' }, ['control.tokens.read']).ok, 'a tokens reader cannot read the planner');
ok(!controlGate({ op: 'act', target: 'amberx.items', path: 'x', action: 'done' }, ['control.amberx.read']).ok, 'a reader cannot act');
for (const perm of ['control.tokens.write', 'control.amberx.delete']) {
  const granted = new Set(['control.*']);
  eq(controlGranted(granted, perm), hasPermission(granted, perm), `controlGranted = the UAC engine's hasPermission for ${perm}`);
  eq(controlGranted(new Set(['control.tokens.*']), perm), hasPermission(new Set(['control.tokens.*']), perm), `… and with a domain wildcard (${perm})`);
}

/* ---- confirm flow ---- */
const remove = { op: 'remove', target: 'amberx.items', path: 'it-42', by: 'claude' };
const first = controlGate(remove, ['control.amberx.delete'], { salt, now: NOW });
ok(!first.ok && first.code === 'confirmation_required' && typeof first.confirm === 'string' && first.confirm!.startsWith('c1.'), 'first remove asks for confirmation with a token');
const second = controlGate({ ...remove, confirm: first.ok ? '' : first.confirm }, ['control.amberx.delete'], { salt, now: NOW + 60_000 });
ok(second.ok && second.effect === 'destructive', 'the same command with the token runs');
eq(controlGate({ ...remove, path: 'it-43', confirm: first.ok ? '' : first.confirm }, ['*'], { salt, now: NOW }).code, 'confirmation_required', 'the token does not confirm another record');
eq(controlGate({ ...remove, confirm: first.ok ? '' : first.confirm }, ['*'], { salt: 'other', now: NOW }).code, 'confirmation_required', 'another salt refuses it');
eq(controlGate({ ...remove, confirm: first.ok ? '' : first.confirm }, ['*'], { salt, now: NOW + 25 * 60_000 }).code, 'confirmation_required', 'expired after two buckets');
ok(controlGate(remove, ['*'], { salt, now: NOW, passCovers: true }).ok, 'a delete an active pass covers runs without the token (pass-all)');
ok(controlIrreversible({ op: 'remove', target: 'amberx.items' }) && controlIrreversible({ op: 'remove', target: 'amberx.lists' }), 'AmberX hard deletes are marked irreversible');
ok(!controlIrreversible({ op: 'remove', target: 'planner.plans' }) && !controlIrreversible({ op: 'remove', target: 'planner.builds' }) && !controlIrreversible({ op: 'set', target: 'amberx.items' }), 'plan and build deletes can be brought back: not irreversible');
ok(controlConfirmValid(remove, controlConfirmToken(remove, salt, NOW), salt, NOW + 10 * 60_000), 'good in the next bucket');
eq(canonicalControl({ reason: 'x', path: 'it-42', target: 'amberx.items', op: 'remove' }), canonicalControl(remove), 'canonical form ignores by / reason and key order');
ok(canonicalControl({ ...remove, value: { b: 1, a: 2 } }) === canonicalControl({ ...remove, value: { a: 2, b: 1 } }), 'nested keys sorted');
eq(controlGate({ op: 'remove', target: 'amberx.items', path: 'it-42' }, ['control.amberx.write'], { salt, now: NOW }).code, 'denied', 'write does not cover delete');

/* ---- results ---- */
const r = controlResult({ op: 'set', target: 'tokens.layout', path: 'navWidth', value: 200, by: 'me', reason: 'why' }, { changed: ['navWidth'] }, { at: '2026-11-03T12:00:00.000Z' });
eq(r, { $axf: CONTROL_FRAME, ok: true, op: 'set', target: 'tokens.layout', path: 'navWidth', changed: ['navWidth'], audit: { by: 'me', reason: 'why', at: '2026-11-03T12:00:00.000Z' } }, 'a write result carries the audit');
ok(!('audit' in controlResult({ op: 'list', target: 'tokens.layout' }, { items: [], total: 0 })), 'a read result has no audit');
eq(controlFailure('boom', 'x').code, 'unexpected', 'unknown codes read as unexpected');
eq(controlFailure('denied', 'x', { requires: 'p' }), { $axf: CONTROL_FRAME, ok: false, code: 'denied', message: 'x', requires: 'p' }, 'failure envelope');

/* ---- projections ---- */
const tools = controlTools();
eq(tools.map((t) => t.name), CONTROL_OPS.map((o) => `control_${o}`), 'one MCP tool per op');
ok(tools.every((t) => (t.annotations as { readOnlyHint: boolean }).readOnlyHint === (CONTROL_EFFECT[(t.name as string).slice(8) as keyof typeof CONTROL_EFFECT] === 'read')), 'readOnlyHint from the effect');
ok((tools.find((t) => t.name === 'control_remove')!.annotations as { destructiveHint: boolean }).destructiveHint, 'remove is destructive for MCP');
ok((tools.find((t) => t.name === 'control_remove')!.description as string).includes('confirm'), 'the remove tool explains the confirm');
const routes = controlRoutes();
ok(routes.length === 8 && routes.every((x) => (x.path as string).startsWith('/api/control')), 'routes under /api/control');
eq(routes.find((x) => x.op === 'remove')!.method, 'DELETE', 'remove is DELETE');
const cli = controlCli();
ok(cli.usage.length === 10 && Object.keys(cli.aliases).length === Object.keys(CONTROL_ALIASES).length, 'CLI usage + aliases');
ok(cli.aliases.todo!.includes('kind=todo'), 'the todo alias presets the kind');
const schema = controlSchema();
eq((schema.properties as { op: { enum: string[] } }).op.enum, [...CONTROL_OPS], 'schema ops');
for (const id of CONTROL_TARGET_IDS) ok(id in (schema.$defs as object), `schema $defs ${id}`);

/* ---- snapshot + fixture current ---- */
eq(read('framework/schemas/control.json'), JSON.parse(JSON.stringify(controlRegistry())), 'framework/schemas/control.json is the registry (npx -y tsx framework/spec/gen-fixtures.mts rewrites it)');
const fx = read('framework/spec/fixtures/control.json');
eq(fx.registry.targets, CONTROL_TARGET_IDS, 'fixture targets');
for (const [k, c] of Object.entries<unknown>(fx.commands)) { eq(controlErrors(c), fx.errors[k], `fixture errors ${k}`); eq(normalizeControl(c), fx.normalize[k], `fixture normalize ${k}`); }
ok(fx.gate['plugin-reader']['plugin-read'].ok && fx.gate['plugin-reader']['plugin-run'].code === 'denied' && fx.gate.admin['plugin-run'].ok, 'fixture plugin gate cases');
ok(fx.gate['console-navigator']['console-open-screen'].ok && fx.gate['console-navigator']['console-back'].ok && fx.gate['console-navigator']['console-run-action'].code === 'denied' && fx.gate.admin['console-set-screen'].code === 'invalid', 'fixture console gate cases');
ok(fx.gate.none['list-layout'].code === 'denied' && fx.gate.admin['remove-item'].code === 'confirmation_required' && fx.gate.reader['set-layout'].code === 'denied' && fx.gate['amberx-writer']['add-item'].ok, 'fixture gate cases');
eq(controlConfirmToken(remove, 'fixture-salt', NOW), fx.confirm.token, 'fixture confirm token (same hash on every port)');

/* ---- spec doc ---- */
const doc = readFileSync(new URL('framework/spec/CONTROL.md', root), 'utf8');
for (const id of CONTROL_TARGET_IDS) ok(doc.includes(`\`${id}\``), `CONTROL.md names ${id}`);
ok(doc.includes('control.console.navigate'), 'CONTROL.md covers console navigation');
ok(doc.includes('plugins.commands') && doc.includes('plugins.reads'), 'CONTROL.md covers plugin commands');
ok(doc.includes('confirmation_required') && doc.includes('control.<domain>.read | write | delete'), 'CONTROL.md covers confirm + permissions');

console.log(`✓ control@1 — ${n} checks, ${CONTROL_TARGET_IDS.length} targets, ${tools.length} tools`);
