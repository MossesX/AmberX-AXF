/**
 * Engine check for toolbar-widgets@1 (core/engines/toolbar-widgets.ts): attach, detach, reorder, banner widget style and
 * shape resolution, the snap-not-overlap fit order and a full replay of spec/fixtures/toolbar-widgets.json.
 * CI: npx -y tsx framework/spec/check-toolbar-widgets.mts
 *
 * check-widgets.mts replays the same fixture as part of the widget host suite; this file states the behaviour a person
 * sees (what they attach stays, what they detach goes, a move renumbers the whole bar, a pick beats a default, nothing
 * overlaps) as scenarios that do not depend on the golden outputs, then checks the golden outputs still match.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIDGET_TYPES } from '../core/engines/widgets';
import {
  TOOLBAR_PERSON_ORDER, TOOLBAR_WIDGETS_CONTRACT, TOOLBAR_WIDGETS_KEY, TOOLBAR_WIDGETS_MAX, TOOLBAR_WIDGET_STYLE_KEY,
  addToolbarWidget, fitToolbar, foldArrangement, matchToolbarInstance, mergeWidgetStyle, moveToolbarWidget,
  normalizeToolbarWidgetSlots, normalizeWidgetStyle, parseToolbarWidgetArgs, parseToolbarWidgetShapeArgs,
  patchToolbarWidget, removeToolbarWidget, resetToolbarWidgets, resolveToolbarWidgets,
  type ToolbarFitPlan, type ToolbarWidgetSlot, type ToolbarWidgetsInput,
} from '../core/engines/toolbar-widgets';

const root = new URL('../', import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(join(root, 'spec/fixtures/toolbar-widgets.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

const exists = new Set(['clock:digital-12h', 'status:online', 'status:cpu', 'avatar:account', 'counter:alerts', 'search-bar:everything', 'label:build']);
const has = (t: string, id: string) => exists.has(`${t}:${id}`);
const toolbar = { widgets: [{ type: 'clock', id: 'digital-12h', at: 'start' }, { type: 'search-bar', id: 'everything', at: 'end', widget: { size: 'wide' as const, priority: 2 } }], shape: { icon: 'circle', chip: 'pill' } };
const plugin = { type: 'status', id: 'cpu', at: 'end', origin: 'plugin', widget: { label: 'CPU', size: 'compact' as const } };
const resolve = (over: Partial<ToolbarWidgetsInput> = {}) => resolveToolbarWidgets({ toolbar, extra: [plugin], has, ...over }, WIDGET_TYPES);
const keys = (r: ReturnType<typeof resolve>, side: string) => r.sides[side]!.map((w) => w.key);

// contract and keys
{
  eq(TOOLBAR_WIDGETS_CONTRACT, 'toolbar-widgets@1', 'contract id');
  eq(TOOLBAR_WIDGETS_KEY('settings-toolbar'), 'axf.toolbar.settings-toolbar.widgets', 'slots key per toolbar instance');
  eq(TOOLBAR_WIDGET_STYLE_KEY('app'), 'axf.toolbar.app.widgetStyle', 'style key per toolbar instance');
}

// attach
{
  let s: ToolbarWidgetSlot[] = [];
  s = addToolbarWidget(s, 'avatar', 'account', 'start', WIDGET_TYPES);
  eq(s, [{ type: 'avatar', id: 'account', at: 'start', order: TOOLBAR_PERSON_ORDER }], 'attach writes one slot after everything on the side');
  const r = resolve({ slots: s });
  eq(keys(r, 'start'), ['clock:digital-12h', 'avatar:account'], 'an attached widget is drawn after the asset widgets');
  eq(r.sides.start[1]!.origin, 'person', 'its origin is the person');
  eq(addToolbarWidget(s, 'badge', 'new', 'start', WIDGET_TYPES), s, 'a non-widget type is refused');
  eq(addToolbarWidget(s, 'avatar', 'account', 'top', WIDGET_TYPES), s, 'an unknown side is refused');
  eq(addToolbarWidget(s, 'Bad Type', 'x', 'start', WIDGET_TYPES), s, 'a malformed type is refused');
  const again = addToolbarWidget([{ type: 'avatar', id: 'account', at: 'start', order: 2000, hidden: true, size: 'icon' }], 'avatar', 'account', 'end', WIDGET_TYPES);
  eq(again, [{ type: 'avatar', id: 'account', at: 'end', order: TOOLBAR_PERSON_ORDER, size: 'icon' }], 'attaching again moves it, shows it and keeps its style');
  eq(keys(resolve({ slots: [{ type: 'clock', id: 'nope', at: 'start' }] }), 'start'), ['clock:digital-12h'], 'a slot for a missing asset is not drawn');
  let full: ToolbarWidgetSlot[] = Array.from({ length: TOOLBAR_WIDGETS_MAX }, (_, i) => ({ type: 'label', id: `l${i}`, at: 'end', order: i }));
  eq(addToolbarWidget(full, 'avatar', 'account', 'end', WIDGET_TYPES).length, TOOLBAR_WIDGETS_MAX, `at most ${TOOLBAR_WIDGETS_MAX} slots`);
  full = addToolbarWidget(full, 'label', 'l3', 'start', WIDGET_TYPES);
  eq(full.length, TOOLBAR_WIDGETS_MAX, 'moving a slot that is already there is allowed at the cap');
  // a widget attached to one instance is not on another
  const other = resolveToolbarWidgets({ toolbar: { widgets: [] }, slots: [], has }, WIDGET_TYPES);
  eq(other.sides.start.length + other.sides.end.length, 0, 'another toolbar instance draws nothing of this one');
  eq(resolve({ toolbar: null, slots: s }).sides, { start: [], end: [] }, 'a hidden toolbar draws no widgets at all');
}

// detach
{
  const s = addToolbarWidget([], 'avatar', 'account', 'end', WIDGET_TYPES);
  eq(removeToolbarWidget(s, 'avatar:account'), [], 'detach drops the slot');
  eq(keys(resolve({ slots: removeToolbarWidget(s, 'avatar:account') }), 'end'), ['search-bar:everything', 'status:cpu'], 'the bar is back to the asset + plugin widgets');
  const hid = patchToolbarWidget([], 'status:cpu', { hidden: true });
  const r = resolve({ slots: hid });
  ok(!keys(r, 'end').includes('status:cpu') && r.hidden.some((w) => w.key === 'status:cpu'), 'a plugin widget cannot be removed, only hidden, and it is listed as hidden');
  eq(keys(resolve({ slots: patchToolbarWidget(hid, 'status:cpu', { hidden: null }) }), 'end').includes('status:cpu'), true, 'show brings it back');
  eq(resetToolbarWidgets(), [], 'reset empties the list');
}

// reorder (within a side and between sides)
{
  const base = resolve();
  eq(keys(base, 'end'), ['search-bar:everything', 'status:cpu'], 'start order');
  let s = moveToolbarWidget([], base.sides, 'status:cpu', 'end', 0);
  let r = resolve({ slots: s });
  eq(keys(r, 'end'), ['status:cpu', 'search-bar:everything'], 'move within a side');
  ok(s.every((x) => x.at && x.order !== undefined && x.order % 10 === 0), 'a move writes every drawn widget with side and order × 10');
  s = moveToolbarWidget(s, r.sides, 'clock:digital-12h', 'end', 99);
  r = resolve({ slots: s });
  eq([keys(r, 'start'), keys(r, 'end')], [[], ['status:cpu', 'search-bar:everything', 'clock:digital-12h']], 'move between sides, past the end = last');
  eq(moveToolbarWidget(s, r.sides, 'status:cpu', 'middle', 0), s, 'an unknown side changes nothing');
  eq(moveToolbarWidget(s, r.sides, 'avatar:account', 'end', 0), s, 'a widget that is not drawn cannot be moved');
  // the legacy app-toolbar arrangement folds in without moving anything
  const arrange = { 'clock:digital-12h': { at: 'end', order: 5 } };
  const before = resolve({ arrange });
  const after = resolve({ slots: foldArrangement([], arrange) });
  eq([keys(after, 'start'), keys(after, 'end')], [keys(before, 'start'), keys(before, 'end')], 'folding the legacy arrangement moves nothing');
}

// banner widget style and shape resolution
{
  const r = resolve();
  const cpu = r.sides.end.find((w) => w.key === 'status:cpu')!;
  eq([cpu.view.size, cpu.shape, cpu.shapeFrom], ['compact', 'pill', 'host'], 'a chip takes its hint size and the toolbar chip shape');
  eq(cpu.attrs['data-fx-wsize'], 'compact', 'the size is an attribute on the item');
  ok(typeof cpu.attrs['--fx-widget-cap'] === 'string' && cpu.attrs['--fx-widget-cap'].includes('--fx-space'), 'the width cap is a multiple of the space token');
  const clock = r.sides.start[0]!;
  eq(clock.attrs['--fx-widget-cap'], undefined, 'a clock keeps its own width');
  // style layers: entry hint < app style < toolbar style < the person's choice for the widget
  const style = mergeWidgetStyle(normalizeWidgetStyle({ size: 'normal', shape: 'square' }), normalizeWidgetStyle({ size: 'icon', shape: 'diamond' }));
  eq(style, { size: 'icon', shape: 'diamond' }, 'the toolbar style beats the app style');
  const styled = resolve({ style });
  const c2 = styled.sides.end.find((w) => w.key === 'status:cpu')!;
  eq([c2.view.size, c2.shape, c2.shapeFrom, c2.attrs['data-fx-shape']], ['icon', 'diamond', 'style', 'diamond'], 'the toolbar style beats the hint');
  const picked = resolve({ style, slots: [{ type: 'status', id: 'cpu', size: 'wide', shape: 'tag' }] });
  const c3 = picked.sides.end.find((w) => w.key === 'status:cpu')!;
  eq([c3.view.size, c3.shape, c3.shapeFrom], ['wide', 'tag', 'slot'], 'the person\'s pick beats every default');
  const iconOnly = resolve({ slots: [{ type: 'status', id: 'cpu', size: 'icon' }] }).sides.end.find((w) => w.key === 'status:cpu')!;
  eq([iconOnly.shape, iconOnly.shapeFrom], ['circle', 'host'], 'icon-only takes the toolbar icon shape');
  const bare = resolveToolbarWidgets({ toolbar: { widgets: [{ type: 'status', id: 'online', at: 'end' }] }, has }, WIDGET_TYPES).sides.end[0]!;
  eq([bare.shape, bare.shapeFrom, 'data-fx-shape' in bare.attrs], [null, 'none', false], 'no shape anywhere: the engine default, no attribute');
  const back = patchToolbarWidget([{ type: 'status', id: 'cpu', shape: 'tag' }], 'status:cpu', { shape: null });
  eq(back, [], 'shape null goes back to the toolbar\'s; a slot with nothing left is dropped');
  eq(normalizeToolbarWidgetSlots([{ type: 'status', id: 'cpu', shape: 'Bad!' }]), [], 'a malformed shape id never reaches the bar');
}

// snap, never overlap: the fit order
{
  const plan: ToolbarFitPlan = { sides: { start: [{ key: 'logo', width: 80, priority: 5, overflow: true }], end: [{ key: 'search', width: 120, priority: 2, overflow: true }, { key: 'cpu', width: 70, priority: 5, overflow: true }, { key: 'avatar', width: 32, priority: 9, overflow: false }] }, flex: { width: 400, min: 160 }, gap: 8, moreWidth: 32, padding: 12 };
  const roomy = fitToolbar(plan, 2000);
  eq([roomy.flex, roomy.overflow, roomy.scroll], [400, [], false], 'room enough: nothing changes');
  const tight = fitToolbar(plan, roomy.width - 100);
  eq([tight.flex, tight.overflow, tight.scroll], [300, [], false], 'the flexible piece gives way first, by exactly what is missing');
  eq(tight.sides, roomy.sides, 'the sides never shrink');
  const floor = fitToolbar(plan, 420);
  eq(floor.flex, 160, 'the flexible piece stops at its minimum');
  ok(floor.overflow.length > 0 && floor.overflow[0] === 'search', 'then widgets leave for ⋯, lowest priority first');
  ok(floor.width <= 420 || floor.scroll, 'what is left fits, or the bar scrolls');
  const tiny = fitToolbar(plan, 120);
  ok(!tiny.overflow.includes('avatar'), 'a widget that may not leave stays on the bar');
  ok(tiny.scroll && tiny.snap.length > 0, 'still too wide: the bar scrolls sideways with snap points');
  ok(tiny.snap.every((x, i, a) => i === 0 || x > a[i - 1]!), 'snap points run left to right, never on top of each other');
  const noMenu = fitToolbar({ ...plan, overflowMenu: false }, 330);
  eq([noMenu.overflow, noMenu.scroll], [[], true], 'no ⋯ menu: straight to scrolling');
  for (const w of [900, 760, 600, 500, 420, 330, 260, 120, 0]) {
    const f = fitToolbar(plan, w);
    ok(Object.values(f.sides).every((x) => x >= 0) && f.flex >= 0, `w${w}: nothing goes negative`);
    ok(f.flex >= 160 || f.flex === 400, `w${w}: the flexible piece never drops below its minimum`);
  }
}

// action grammar and voice instance match
{
  eq(parseToolbarWidgetArgs(['cpu', 'add']), { instance: 'app', name: 'cpu', op: 'add' }, 'two arguments mean the app toolbar');
  eq(parseToolbarWidgetArgs(['settings', 'status:online', 'hide']), { instance: 'settings', name: 'status:online', op: 'hide' }, 'a key with a colon needs the instance');
  eq(parseToolbarWidgetArgs(['x', 'cpu', 'explode']), null, 'an unknown op is refused');
  eq(parseToolbarWidgetShapeArgs(['app', 'cpu', 'inherit']), { instance: 'app', name: 'cpu', shape: null }, 'inherit clears the shape');
  eq(matchToolbarInstance([{ id: 'app', label: 'Main' }, { id: 'settings-toolbar', label: 'Settings' }], 'the settings toolbar'), 'settings-toolbar', 'voice names a toolbar');
}

// fixture match: every golden output replays through the engine
{
  const f = fixture;
  const fx = new Set<string>(f.exists);
  const fhas = (t: string, id: string) => fx.has(`${t}:${id}`);
  for (const [name, c] of Object.entries<any>(f.resolve)) eq(resolveToolbarWidgets({ toolbar: c.toolbar, extra: c.extra ?? [], slots: normalizeToolbarWidgetSlots(c.slots), style: normalizeWidgetStyle(c.style), arrange: c.arrange ?? null, has: fhas }, WIDGET_TYPES), c.out, `fixture resolve ${name}`);
  for (const [name, c] of Object.entries<any>(f.fit)) eq(fitToolbar(c.plan, c.available), c.fit, `fixture fit ${name}`);
  eq(foldArrangement(f.fold.slots, f.fold.arrange), f.fold.out, 'fixture fold');
  for (const [k, v] of Object.entries<any>(f.parse)) eq(parseToolbarWidgetArgs(k === '(empty)' ? [] : k.split(':').length > 3 ? [k.split(':')[0]!, k.split(':').slice(1, -1).join(':'), k.split(':').at(-1)!] : k.split(':')), v, `fixture parse ${k}`);
  for (const [k, v] of Object.entries<any>(f.parseShape)) eq(parseToolbarWidgetShapeArgs(k.split(':').length > 3 ? [k.split(':')[0]!, k.split(':').slice(1, -1).join(':'), k.split(':').at(-1)!] : k.split(':')), v, `fixture parseShape ${k}`);
  ok(Array.isArray(f.edits) && f.edits.length > 0, 'fixture has the edit sequence');
}

console.log(`check-toolbar-widgets: ${checks} checks ok`);
