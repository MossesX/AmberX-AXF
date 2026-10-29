/**
 * Self-test for the window engine's geometry (CI: npx -y tsx framework/spec/check-windows.mts). Replays
 * spec/fixtures/windows.json through the reference engine (the Kotlin ConformanceTest replays the same file once the
 * Android twin lands; see PORTING.md) and exercises the WindowManager API the fixture can't cover: resize from every
 * handle, maximize / restore / drag-restore, frames, per-window size floors, and that the older API (openFloating,
 * move, resize, minimize, undock) still behaves the same.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESIZE_EDGES, RESIZE_HANDLE, RESIZE_HANDLE_TOUCH, WINDOW_MIN, WindowManager, dragRestore, hitResizeEdge, isMaximized, limitsOf, maximizeWindow, maximizedRect, resizeCursor, resizeRect, restoreWindow, toggleMaximized, windowFrame, type ResizeEdge, type WindowSpec } from '../core/engines/windows';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/windows.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };
const pick = (w: WindowSpec) => ({ x: w.x, y: w.y, width: w.width, height: w.height, maximized: w.maximized ?? false, restore: w.restore ?? null });

// ---- fixture replay ----
eq(f.contract, 'windows@1', 'contract');
eq([...RESIZE_EDGES], f.edges, 'edges');
eq(RESIZE_HANDLE, f.handle, 'handle'); eq(RESIZE_HANDLE_TOUCH, f.handleTouch, 'touch handle'); eq(WINDOW_MIN, f.min, 'min');
eq(Object.fromEntries(RESIZE_EDGES.map((e) => [e, resizeCursor(e)])), f.cursors, 'cursors');
eq(windowFrame({}), f.frameDefault, 'frame default'); eq(windowFrame({ frame: 'frameless' }), 'frameless', 'frameless reads');
for (const h of f.hits) { eq(hitResizeEdge(f.rect, h.px, h.py), h.edge, `hit ${h.name}`); eq(hitResizeEdge(f.rect, h.px, h.py, RESIZE_HANDLE_TOUCH), h.touch, `touch hit ${h.name}`); }
for (const r of f.resizes) eq(resizeRect(r.start, r.edge as ResizeEdge, r.dx, r.dy, r.limits ?? undefined), r.rect, `resize ${r.name}`);
{
  const m = f.maximize;
  eq(maximizedRect(m.viewport), m.rect, 'maximized rect'); eq(maximizedRect(m.viewport, m.work), m.rectWork, 'maximized work rect');
  const base: WindowSpec = { id: 'w1', type: 'floating', title: 'T', toolbarsAllowed: true, toolbarEnabled: true, origin: null, settings: { corner: 'bottom-right', mode: 'stacked', toolbarAsset: null, alwaysOnTop: false, opacity: 1 }, ...m.from, maximized: undefined, restore: undefined, minimized: null, minimizedAtX: 0, minimizedAtY: 0, closable: true, z: 1, mode: 'tree' };
  const max = maximizeWindow(base, m.viewport);
  eq(pick(max), m.maximized, 'maximize'); eq(pick(maximizeWindow(base, m.viewport, m.work)), m.maximizedWork, 'maximize into work area');
  eq(pick(maximizeWindow(max, m.viewport)), m.maximizedTwice, 'maximize twice keeps restore'); eq(pick(restoreWindow(max)), m.restored, 'restore');
  eq(pick(toggleMaximized(toggleMaximized(base, m.viewport), m.viewport)), m.toggledTwice, 'toggle twice'); eq(pick(restoreWindow(base)), m.restoreWhenNotMaximized, 'restore when not maximized');
  for (const d of m.dragRestore) eq(pick(dragRestore(d.name.startsWith('not') ? base : max, d.px, d.py, d.grab)), d.rect, `dragRestore ${d.name}`);
}

// ---- hit-testing invariants: every edge is reachable and the body never is ----
{
  const r = { x: 0, y: 0, width: 300, height: 200 };
  const found = new Set<string>();
  for (let x = -RESIZE_HANDLE; x <= r.width + RESIZE_HANDLE; x += 2) for (let y = -RESIZE_HANDLE; y <= r.height + RESIZE_HANDLE; y += 2) { const e = hitResizeEdge(r, x, y); if (e) found.add(e); }
  eq([...found].sort(), [...RESIZE_EDGES].sort(), 'every handle reachable');
  ok(hitResizeEdge(r, 150, 100) === null, 'centre is not a handle');
  ok(hitResizeEdge(r, -RESIZE_HANDLE - 1, 100) === null, 'too far outside misses');
}
// resize never breaks the floor or the fixed edge, whatever the drag
{
  const start = { x: 40, y: 40, width: 300, height: 200 };
  for (const e of RESIZE_EDGES) for (const [dx, dy] of [[-1000, -1000], [1000, 1000], [-1000, 1000], [3, -7]]) {
    const r = resizeRect(start, e, dx, dy);
    ok(r.width >= WINDOW_MIN.minWidth && r.height >= WINDOW_MIN.minHeight, `floor ${e} ${dx},${dy}`);
    if (!e.includes('w')) eq(r.x, start.x, `x fixed for ${e}`); else eq(r.x + r.width, start.x + start.width, `right edge fixed for ${e}`);
    if (!e.includes('n')) eq(r.y, start.y, `y fixed for ${e}`); else eq(r.y + r.height, start.y + start.height, `bottom edge fixed for ${e}`);
  }
}

// ---- WindowManager API ----
{
  const wm = new WindowManager();
  wm.viewport = { width: 1000, height: 700 };
  const id = wm.openFloating([{ id: 't', title: 'Tab', kind: 'placeholder' }], 'Term', 'floating', 500, 300, 100, 80, { frame: 'frameless', minWidth: 320, minHeight: 200 });
  const w = () => wm.state.windows.find((x) => x.id === id)!;
  eq(windowFrame(w()), 'frameless', 'openFloating frame option'); eq(limitsOf(w()), { minWidth: 320, minHeight: 200 }, 'openFloating min size');
  eq(pick(w()), { x: 100, y: 80, width: 500, height: 300, maximized: false, restore: null }, 'opened where asked');
  // resize from each handle with a start rect, fixed edge kept, own floor honoured
  const start = { x: 100, y: 80, width: 500, height: 300 };
  wm.resizeFrom(id, 'w', start, 400, 0); eq(pick(w()), { x: 280, y: 80, width: 320, height: 300, maximized: false, restore: null }, 'west resize to own floor');
  wm.resizeFrom(id, 'se', start, 60, 60); eq(pick(w()), { x: 100, y: 80, width: 560, height: 360, maximized: false, restore: null }, 'se resize from start rect');
  wm.resizeFrom(id, 'n', start, 0, -2000); eq(w().y, -1920, 'north resize may leave the screen (no keep-on-screen)');
  wm.resizeFrom(id, 'nw', start, 0, 0);
  // maximize / unmaximize / toggle
  wm.maximize(id); eq(pick(w()), { x: 0, y: 0, width: 1000, height: 700, maximized: true, restore: start }, 'maximize fills viewport');
  eq(wm.state.focused, id, 'maximize focuses');
  wm.resize(id, 400, 250); ok(!isMaximized(w()) && w().restore == null, 'plain resize leaves maximized');
  wm.toggleMaximize(id); ok(isMaximized(w()), 'toggle maximizes'); wm.toggleMaximize(id); eq(pick(w()), { x: 0, y: 0, width: 400, height: 250, maximized: false, restore: null }, 'toggle restores');
  wm.workArea = { x: 0, y: 40, width: 1000, height: 660 }; wm.maximize(id); eq(w().y, 40, 'work area honoured'); wm.workArea = null;
  // drag restore from maximized puts the window under the pointer
  const r = wm.dragRestore(id, 500, 20, 10); ok(r && !isMaximized(w()) && r.width === 400 && r.y === 10, 'dragRestore restores under the pointer'); eq(wm.dragRestore(id, 1, 1), null, 'dragRestore on a normal window = null');
  // moving past the screen is allowed
  wm.moveTo(id, -900, -600); eq([w().x, w().y], [-900, -600], 'windows may leave the screen');
  // per-window floor grows the window
  wm.setMinSize(id, 600, 500); eq([w().width, w().height], [600, 500], 'setMinSize grows to the floor'); wm.setMinSize(id, null, null); eq(limitsOf(w()), WINDOW_MIN, 'setMinSize null = default floor');
  wm.setFrame(id, 'standard'); eq(windowFrame(w()), 'standard', 'setFrame');
  // the old API still works unchanged
  const id2 = wm.openFloating([{ id: 't2', title: 'Tab 2', kind: 'placeholder' }], 'Plain');
  const w2 = () => wm.state.windows.find((x) => x.id === id2)!;
  eq(windowFrame(w2()), 'standard', 'default frame standard'); eq(limitsOf(w2()), WINDOW_MIN, 'default floor');
  wm.resize(id2, 10, 10); eq([w2().width, w2().height], [WINDOW_MIN.minWidth, WINDOW_MIN.minHeight], 'legacy resize floor');
  wm.move(id2, 5, 5); wm.minimize(id2, 'corner-titlebar'); eq(w2().minimized, 'corner-titlebar', 'minimize'); wm.restore(id2); eq(w2().minimized, null, 'restore (un-minimize)');
  ok(wm.windowMenu().some((m) => m.action === 'windows.maximize:{payload}'), 'window menu has maximize');
  wm.close(id); wm.close(id2); eq(wm.state.windows.length, 1, 'closed');
}

console.log(`check-windows: ${checks} checks passed`);
