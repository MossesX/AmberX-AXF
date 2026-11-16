/**
 * drag-move@1 (core/engines/drag-move.ts; build drag-anything-by-api-and-voice, Nov 16 2026): the registry (eight kinds, three
 * ops, four zones, the codes; append-only), every fixture case replays to the same plan or the same code, the plans hold
 * their invariants (the item sits at `to.index`, left `from`, every touched container is complete, no id lost or doubled),
 * the live registry runs the same command the pointer would, the schema snapshot framework/schemas/drag-move.json is
 * current, and the spec doc names every kind, zone, op and code.
 *   npx -y tsx framework/spec/check-drag-move.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRAG_KINDS, DRAG_MOVE_ACTION, DRAG_MOVE_CODES, DRAG_MOVE_CONTRACT, DRAG_MOVE_PLAN_FRAME, DRAG_MOVE_RESULT_FRAME, DRAG_MOVE_SCHEMA, DRAG_OPS, DROP_ZONES, DragHostRegistry, DragMoveError,
  applyOrder, dragKind, dragKinds, dragMoveErrors, dragMoveFailure, dragMoveSnapshot, isDragKind, normalizeDragMove, orderOf, planDragMove, pointerDrop, pointerZone, registerDragKind,
  type DragHostSnapshot, type DragMoveResult, type DragPlan,
} from '../core/engines/drag-move';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const f = read('framework/spec/fixtures/drag-move.json');
const fails = (fn: () => unknown, code: string, m: string) => { try { fn(); assert.fail(`${m}: did not throw`); } catch (e) { ok(e instanceof DragMoveError && e.code === code, `${m} (${e instanceof DragMoveError ? e.code : String(e)})`); } };

/* ---- registry ---- */
eq(DRAG_KINDS.slice(0, 8), ['banner-widget', 'toolbar-item', 'tab', 'dock-pane', 'grid-column', 'grid-row', 'list-item', 'layout-slot'], 'eight kinds, append-only');
eq(DRAG_OPS.slice(0, 3), ['move', 'add', 'remove'], 'three ops'); eq(DROP_ZONES.slice(0, 4), ['before', 'after', 'into', 'side'], 'four zones');
eq(DRAG_MOVE_CODES.slice(0, 13), ['invalid', 'unknown_kind', 'unknown_container', 'unknown_item', 'unknown_ref', 'invalid_zone', 'out_of_range', 'not_allowed', 'duplicate', 'limit', 'no_change', 'confirmation_required', 'failed'], 'codes, append-only');
for (const k of DRAG_KINDS) {
  const s = dragKind(k)!;
  ok(s && isDragKind(k) && s.label && s.container && s.item, `${k} registered and documented`);
  ok(s.zones.length >= 1 && s.zones.every((z) => DROP_ZONES.includes(z)), `${k} zones are zones`);
  ok(s.zones.includes('side') ? !!s.sides?.length || k === 'layout-slot' : true, `${k} offers side only with sides (layout-slot: the host names its regions)`);
}
ok(dragKinds().length >= 8 && !isDragKind('sticker'), 'kinds list; unknown kind is not a kind');
eq(dragKind('banner-widget')!.sides, ['left', 'center', 'right'], 'banner sides come from asset-types.json');
eq(dragKind('toolbar-item')!.sides, ['start', 'end'], 'toolbar sides come from asset-types.json');
eq(dragKind('dock-pane')!.sides, ['left', 'right', 'top', 'bottom'], 'dock sides come from the dock engine');
ok(dragKind('dock-pane')!.confirmRemove && !dragKind('tab')!.remove && !dragKind('tab')!.add && dragKind('tab')!.crossContainer, 'kind flags');
/* ---- snapshot + schema ---- */
eq(read('framework/schemas/drag-move.json'), dragMoveSnapshot(), 'framework/schemas/drag-move.json is current (regen: dragMoveSnapshot())');
eq(f.snapshot, dragMoveSnapshot(), 'fixture snapshot current');
eq(f.contract, DRAG_MOVE_CONTRACT, 'fixture contract');
eq(f.registry, { kinds: [...DRAG_KINDS], ops: [...DRAG_OPS], zones: [...DROP_ZONES], codes: [...DRAG_MOVE_CODES], specs: Object.fromEntries(DRAG_KINDS.map((k) => [k, dragKind(k)])) }, 'fixture registry');
eq(DRAG_MOVE_SCHEMA.properties.op.enum, [...DRAG_OPS], 'schema ops'); eq(DRAG_MOVE_SCHEMA.properties.target.properties.zone.enum, [...DROP_ZONES], 'schema zones');
eq(Object.keys(DRAG_MOVE_SCHEMA.properties).sort(), ['$axf', 'by', 'confirm', 'kind', 'op', 'reason', 'source', 'target'], 'schema names every command field');
eq(dragMoveSnapshot().action, DRAG_MOVE_ACTION, 'action id in snapshot');

/* ---- fixture replay ---- */
const hosts: DragHostSnapshot[] = f.hosts;
for (const [name, h] of Object.entries(f.orders)) eq(orderOf(hosts.find((x) => `${x.kind}:${x.container}` === name)!), h, `order ${name}`);
let plans = 0, codes = 0;
for (const [name, c] of Object.entries<any>(f.cases)) {
  eq(dragMoveErrors(c.command), f.errors[name], `errors ${name}`);
  if (c.plan) {
    const p = planDragMove(c.command, hosts); plans++;
    eq(p, c.plan, `plan ${name}`);
    eq(normalizeDragMove(c.command), f.normalized[name], `normalized ${name}`);
    checkPlan(name, p, c.command);
  } else {
    codes++;
    ok(DRAG_MOVE_CODES.includes(c.code), `${name}: ${c.code} is a code`);
    fails(() => planDragMove(c.command, hosts), c.code, `code ${name}`);
    try { planDragMove(c.command, hosts); } catch (e) { eq({ code: (e as DragMoveError).code, message: (e as Error).message, ...((e as DragMoveError).nearest ? { nearest: (e as DragMoveError).nearest } : {}) }, { code: c.code, message: c.message, ...(c.nearest ? { nearest: c.nearest } : {}) }, `message ${name}`); }
    if (c.code === 'invalid' || c.code === 'unknown_kind') ok(f.errors[name].length > 0, `${name} normalizer lists the problem`);
    else eq(f.errors[name], [], `${name} is well formed, refused by the plan`);
  }
}
ok(plans >= 18 && codes >= 30, `coverage: ${plans} plans, ${codes} refusals`);
for (const code of DRAG_MOVE_CODES.filter((c) => c !== 'failed')) ok(Object.values<any>(f.cases).some((c) => c.code === code), `code ${code} has a fixture case`);
for (const zone of DROP_ZONES) ok(Object.values<any>(f.cases).some((c) => c.plan && c.command.target?.zone === zone), `zone ${zone} has a plan`);
for (const op of DRAG_OPS) ok(Object.values<any>(f.cases).some((c) => c.plan && (c.command.op ?? 'move') === op), `op ${op} has a plan`);
ok(Object.values<any>(f.cases).some((c) => c.plan && c.plan.from && c.plan.to && c.plan.from.container !== c.plan.to.container), 'a cross-container plan');

function checkPlan(name: string, p: DragPlan, command: any) {
  eq(p.$axf, DRAG_MOVE_PLAN_FRAME, `${name} frame`);
  const ids = (o: unknown) => (Array.isArray(o) ? o : Object.values(o as Record<string, string[]>).flat()) as string[];
  for (const [container, order] of Object.entries(p.order)) {
    const h = hosts.find((x) => x.kind === p.kind && x.container.toLowerCase() === container.toLowerCase())!;
    ok(h, `${name}: touched container ${container} exists`);
    const before = ids(orderOf(h)).map((x) => x.toLowerCase()); const after = ids(order).map((x) => x.toLowerCase());
    ok(new Set(after).size === after.length, `${name}: no id doubled in ${container}`);
    const leaves = p.from?.container.toLowerCase() === container.toLowerCase(); const lands = p.to?.container.toLowerCase() === container.toLowerCase();
    const expect = before.filter((x) => !(leaves && x === p.item.id.toLowerCase())).concat(lands ? [p.item.id.toLowerCase()] : []).sort();
    eq([...after].sort(), expect, `${name}: ${container} complete`);
    ok(h.sides ? !Array.isArray(order) && Object.keys(order).join() === h.sides.join() : Array.isArray(order), `${name}: ${container} order shape follows sides`);
  }
  if (p.to) {
    const o = p.order[p.to.container]!; const list = Array.isArray(o) ? o : (o as Record<string, string[]>)[p.to.side!]!;
    eq(list[p.to.index], p.item.id, `${name}: item sits at to.index`);
    if (command.target?.zone === 'side' && command.target.ref) eq(list[p.to.index - 1], p.to.ref, `${name}: side with ref lands right after the ref`);
  }
  if (p.op === 'add') ok(p.from === null, `${name}: add has no from`); else ok(p.from && Number.isInteger(p.from.index), `${name}: from set`);
  if (p.op === 'remove') ok(p.to === null, `${name}: remove has no to`);
}

/* ---- maths and helpers ---- */
for (const pr of f.pointer.probes) { eq(pointerZone(f.pointer.rect, pr.px, pr.py), pr.horizontal, `pointer h ${pr.px},${pr.py}`); eq(pointerZone(f.pointer.rect, pr.px, pr.py, true), pr.vertical, `pointer v ${pr.px},${pr.py}`); eq(pointerDrop('settings.tabs', 'appearance', f.pointer.rect, pr.px, pr.py), pr.drop, `pointer drop ${pr.px},${pr.py}`); }
eq(pointerZone({ x: 0, y: 0, width: 10, height: 10 }, 5, 0), 'after', 'the middle is after');
eq(applyOrder(hosts[0]!, ['about', 'general', 'plugins', 'appearance']), f.applyOrder.reorder, 'applyOrder reorder');
eq(applyOrder(hosts[3]!, { left: [], center: ['clock:utc', 'logo:brand'], right: ['status:ci', 'counter:alerts'] }), f.applyOrder.sided, 'applyOrder sided re-sides items');
eq(applyOrder(hosts[3]!, { left: ['theme-switch:main', 'logo:brand'], center: ['clock:utc'], right: ['counter:alerts', 'status:ci'] }, { id: 'theme-switch:main', type: 'theme-switch' }), f.applyOrder.added, 'applyOrder with an added item');
eq(applyOrder(hosts[0]!, ['general', 'ghost', 'about']), f.applyOrder.arrivals, 'applyOrder keeps arrivals as bare items and drops left-out ones');
eq(f.applyOrder.arrivals, [{ id: 'general' }, { id: 'ghost' }, { id: 'about' }], 'arrivals shape');

/* ---- envelopes ---- */
eq(f.envelopes.ok.$axf, DRAG_MOVE_RESULT_FRAME, 'result frame'); ok(f.envelopes.ok.ok && f.envelopes.ok.by === 'claude' && f.envelopes.okNoBy.by === undefined, 'by echoed only when given');
eq(dragMoveFailure(new DragMoveError('unknown_container', 'no tab host nowhere', ['settings.tabs'])), f.envelopes.fail, 'failure envelope with nearest');
eq(dragMoveFailure(new Error('boom')), f.envelopes.failPlain, 'plain error is failed'); eq(dragMoveFailure('text').code, 'failed', 'text is failed');
eq(Object.keys(f.envelopes.ok).sort(), ['$axf', 'by', 'from', 'item', 'kind', 'ok', 'op', 'order', 'to'], 'result fields');

/* ---- live registry ---- */
{
  const reg = new DragHostRegistry();
  let tabs = ['general', 'appearance', 'plugins', 'about'];
  let applied = 0; let ticks = 0;
  reg.subscribe(() => ticks++);
  const off = reg.register({ kind: 'tab', container: 'settings.tabs', list: () => ({ kind: 'tab', container: 'settings.tabs', items: tabs.map((id) => ({ id })) }), apply: (p) => { tabs = p.order['settings.tabs'] as string[]; applied++; } });
  const r1 = await reg.run({ kind: 'tab', source: { container: 'settings.tabs', id: 'plugins' }, target: { container: 'settings.tabs', zone: 'before', ref: 'appearance' } });
  ok(r1.ok && applied === 1, 'run applies'); eq(tabs, ['general', 'plugins', 'appearance', 'about'], 'host wrote the order');
  const r2 = await reg.run({ kind: 'tab', source: { container: 'settings.tabs', id: 'plugins' }, target: { container: 'settings.tabs', zone: 'before', ref: 'appearance' } });
  ok(!r2.ok && r2.code === 'no_change' && applied === 1, 'no change does not apply');
  const r3 = await reg.run({ kind: 'tab', source: { container: 'nowhere', id: 'x' }, target: { container: 'settings.tabs' } });
  ok(!r3.ok && r3.code === 'unknown_container' && r3.nearest?.includes('settings.tabs'), 'nearest names the live containers');
  eq(reg.plan({ kind: 'tab', source: { container: 'settings.tabs', id: 'about' }, target: { container: 'settings.tabs', index: 0 } }).order, { 'settings.tabs': ['about', 'general', 'plugins', 'appearance'] }, 'plan without applying'); eq(applied, 1, 'plan did not apply');
  eq(reg.containers(), [{ kind: 'tab', container: 'settings.tabs', count: 4 }], 'containers'); eq(reg.snapshot('TAB', 'settings.tabs'), null, 'kind is exact'); ok(reg.snapshot('tab', 'SETTINGS.TABS'), 'container is case-insensitive');
  const codeOf = (r: DragMoveResult) => (r.ok ? null : r.code);
  ok(codeOf(await reg.run_text('{')) === 'invalid' && codeOf(await reg.run_text('"x"')) === 'invalid', 'run_text refuses non-commands');
  off(); eq(reg.containers(), [], 'unregister'); ok(ticks === 2, 'subscribers hear register and unregister');
  const r4 = await reg.run({ kind: 'tab', source: { container: 'settings.tabs', id: 'about' }, target: { container: 'settings.tabs', index: 0 } });
  ok(!r4.ok && r4.code === 'unknown_container' && r4.nearest?.length === 0, 'gone host is unknown');
}
for (const [name, r] of Object.entries<any>(f.replay)) if (name !== 'after') ok(r.$axf === DRAG_MOVE_RESULT_FRAME && typeof r.ok === 'boolean', `replay ${name} is a result`);
ok(f.replay['move tab'].ok && f.replay['same move again is no change'].code === 'no_change' && f.replay['add widget'].ok && f.replay['remove widget'].ok && f.replay['cross-container'].ok, 'replay outcomes');
eq(f.replay['host apply throws'], { $axf: DRAG_MOVE_RESULT_FRAME, ok: false, code: 'failed', message: 'host refused' }, 'a throwing apply answers failed');
eq(f.replay['not json'].code, 'invalid', 'replay not json');
eq(f.replay.after.tabs.items.map((x: any) => x.id), ['general', 'appearance', 'about'], 'replay: tab moved then left');
eq(f.replay.after.paneB.items.map((x: any) => x.id), ['readme', 'plugins'], 'replay: tab arrived');
ok(f.replay.after.banner.items.some((x: any) => x.id === 'theme-switch:main' && x.side === 'left' && x.type === 'theme-switch') && !f.replay.after.banner.items.some((x: any) => x.id === 'status:ci'), 'replay: widget added with its type, widget removed');
ok(f.replay.after.containers.length === hosts.length + 1 && f.replay.after.tabContainers.length === 3 && f.replay.after.missing === null, 'replay: containers');

/* ---- open registry (after the replay: `nearest` lists the live kinds) ---- */
// open registry: a plugin adds a kind and it is a first-class citizen
registerDragKind({ kind: 'test-chip', label: 'Chip', container: 'the chip bar', item: 'the chip', zones: ['before', 'after', 'into'], sides: null, add: true, remove: true, crossContainer: false, confirmRemove: false });
ok(isDragKind('test-chip') && dragKinds().some((k) => k.kind === 'test-chip'), 'registered kind is listed');
eq(planDragMove({ kind: 'test-chip', source: { container: 'bar', id: 'b' }, target: { container: 'bar', index: 0 } }, [{ kind: 'test-chip', container: 'bar', items: [{ id: 'a' }, { id: 'b' }] }]).order, { bar: ['b', 'a'] }, 'registered kind plans');
ok(!DRAG_KINDS.includes('test-chip'), 'the framework list stays the eight');

/* ---- spec doc ---- */
const doc = readFileSync(new URL('framework/spec/DRAG-MOVE.md', root), 'utf8');
for (const k of DRAG_KINDS) ok(doc.includes(`\`${k}\``), `spec names kind ${k}`);
for (const z of DROP_ZONES) ok(doc.includes(`\`${z}\``), `spec names zone ${z}`);
for (const o of DRAG_OPS) ok(doc.includes(`\`${o}\``), `spec names op ${o}`);
for (const c of DRAG_MOVE_CODES) ok(doc.includes(`\`${c}\``), `spec names code ${c}`);
ok(doc.includes('rt.drag.hosts') && doc.includes('useDraggableHost') && doc.includes(`${DRAG_MOVE_ACTION}:<json>`), 'spec names the seam and the action');
ok(readFileSync(new URL('framework/spec/PORTING.md', root), 'utf8').includes('drag-move@1'), 'PORTING.md records the deferred Kotlin twin');

console.log(`check-drag-move: ${n} checks passed`);
