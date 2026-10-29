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
import { DEFAULT_SNAP_RULES, RESIZE_EDGES, RESIZE_HANDLE, RESIZE_HANDLE_TOUCH, SNAP_ZONES, WINDOW_MIN, WindowManager, armSplit, dragRestore, hitResizeEdge, isMaximized, limitsOf, maximizeWindow, maximizedRect, rectsOverlap, resizeCursor, resizeRect, resolveOverlap, restoreWindow, snapRect, snapZoneAt, snapZoneRect, splitDrop, toggleMaximized, topmostAt, windowFrame, type ResizeEdge, type SnapZone, type SplitArm, type WindowSpec } from '../core/engines/windows';

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

// ---- s18: snapping fixture replay ----
{
  const sn = f.snap;
  eq(DEFAULT_SNAP_RULES, sn.rules, 'snap rules'); eq([...SNAP_ZONES], sn.zonesList, 'zones');
  for (const c of sn.snaps) eq(snapRect({ ...c.at, ...sn.moving }, sn.viewport, sn.others, c.rules), c.result, `snap ${c.name}`);
  for (const z of sn.zones) { eq(snapZoneAt(z.px, z.py, sn.viewport), z.zone, `zone ${z.px},${z.py}`); eq(snapZoneAt(z.px, z.py, sn.viewport, 8), z.narrow, `narrow zone ${z.px},${z.py}`); }
  for (const [z, r] of Object.entries<any>(sn.zoneRects)) { eq(snapZoneRect(z as SnapZone, { x: 0, y: 0, ...sn.viewport }), r.full, `zone rect ${z}`); eq(snapZoneRect(z as SnapZone, sn.work), r.work, `zone work rect ${z}`); eq(snapZoneRect(z as SnapZone, { x: 10, y: 20, width: 333, height: 201 }), r.odd, `zone odd rect ${z}`); }
  for (const o of sn.overlap) eq(resolveOverlap(o.rect, sn.others), o.out, `overlap ${o.name}`);
  for (const c of sn.split.cases) eq(splitDrop(sn.split.target, c.px, c.py), c.result, `split ${c.name}`);
  eq(splitDrop({ x: 0, y: 0, width: 301, height: 201 }, 10, 100), sn.split.odd, 'split odd sizes');
  for (const p of sn.topmost.probes) eq(topmostAt(sn.topmost.stack, p.px, p.py), p.index, `topmost ${p.px},${p.py}`);
  let arm: SplitArm | null = null; for (const st of sn.arm.steps) { arm = armSplit(arm, st.target, st.now); eq(arm, st.arm, `arm ${st.target} @${st.now}`); }
  eq(armSplit(null, 'a', 0, 0), sn.arm.zeroDwell, 'zero dwell arms at once');
  // invariants: halves tile the target exactly, quarters tile the area, resolved rects never overlap
  for (const c of sn.split.cases) { const d = c.result; eq(d.dropped.width * d.dropped.height + d.target.width * d.target.height, sn.split.target.width * sn.split.target.height, `split ${c.name} keeps the area`); ok(!rectsOverlap(d.dropped, d.target), `split ${c.name} halves do not overlap`); }
  { const a = { x: 0, y: 0, width: 1001, height: 777 }; const q = (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as SnapZone[]).map((z) => snapZoneRect(z, a)); eq(q.reduce((n, r) => n + r.width * r.height, 0), a.width * a.height, 'quarters tile the area'); for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) ok(!rectsOverlap(q[i]!, q[j]!), `quarters ${i},${j} disjoint`); }
  for (const o of sn.overlap) for (const other of sn.others) ok(!rectsOverlap(o.out, other), `resolved ${o.name} clear of others`);
}

// ---- s18: WindowManager drag / zone / split / no-overlap ----
{
  const wm = new WindowManager();
  wm.viewport = { width: 1000, height: 700 };
  const a = wm.openFloating([{ id: 'ta', title: 'A', kind: 'placeholder' }], 'A', 'floating', 300, 200, 100, 100);
  const b = wm.openFloating([{ id: 'tb', title: 'B', kind: 'placeholder' }], 'B', 'floating', 300, 200, 600, 100);
  const W = (id: string) => wm.state.windows.find((x) => x.id === id)!;
  // dragging A near B's left edge pulls it to abut
  eq(wm.dragTo(a, 600 - 300 - 7, 110, 400, 120), null, 'plain pull = no preview'); eq([W(a).x, W(a).y], [300, 100], 'window-to-window snap abuts (x) and aligns tops (y)');
  // pointer at the left viewport edge arms the left half zone; settle applies it
  const pz = wm.dragTo(a, -50, 300, 3, 300); eq(pz?.kind, 'zone', 'zone preview'); eq(pz?.zone, 'left', 'left zone'); eq(wm.state.preview?.rect, { x: 0, y: 0, width: 500, height: 700 }, 'half rect');
  wm.settle(a); eq([W(a).x, W(a).y, W(a).width, W(a).height, wm.state.preview ?? null], [0, 0, 500, 700, null], 'settle into the half');
  // top zone maximizes with a restore rect
  wm.dragTo(a, 200, 10, 500, 2); wm.settle(a); ok(isMaximized(W(a)) && W(a).restore?.width === 500, 'top zone maximizes'); wm.unmaximize(a);
  // split: resting over B for the dwell arms a split; settle halves B and places A
  wm.resizeFrom(a, 'se', { x: 0, y: 0, width: 500, height: 700 }, -200, -500); wm.moveTo(a, 100, 400);
  eq(wm.dragTo(a, 650, 150, 640, 200, 1000), null, 'passing over B does not split'); eq(wm.dragTo(a, 650, 150, 640, 200, 1000 + DEFAULT_SNAP_RULES.splitDwellMs - 1), null, 'still not armed');
  const ps = wm.dragTo(a, 650, 150, 640, 200, 1000 + DEFAULT_SNAP_RULES.splitDwellMs); eq(ps?.kind, 'split', 'split armed after the dwell'); eq(ps?.target, b, 'split target B'); eq(ps?.side, 'left', 'pointer on B\'s left half');
  wm.settle(a); eq([W(a).x, W(a).y, W(a).width, W(a).height], [600, 100, 150, 200], 'A takes B\'s left half'); eq([W(b).x, W(b).y, W(b).width, W(b).height], [750, 100, 150, 200], 'B keeps the right half');
  // split off = never a split preview; zones off = no zone
  wm.setSnapRules({ split: false, zones: false }); eq(wm.dragTo(a, 760, 150, 800, 150, 99999), null, 'split off'); eq(wm.dragTo(a, -50, 300, 3, 300), null, 'zones off'); wm.settle(a);
  // direct API: snapTo + splitOnto
  wm.setSnapRules({}); wm.snapTo(a, 'bottom-right'); eq([W(a).x, W(a).y, W(a).width, W(a).height], [500, 350, 500, 350], 'snapTo quarter');
  wm.workArea = { x: 0, y: 50, width: 1000, height: 650 }; wm.snapTo(a, 'right'); eq([W(a).x, W(a).y, W(a).width, W(a).height], [500, 50, 500, 650], 'snapTo honours the work area'); wm.workArea = null;
  wm.snapTo(a, 'top'); ok(isMaximized(W(a)), 'snapTo top maximizes'); wm.unmaximize(a);
  wm.moveTo(b, 600, 100); wm.resizeFrom(b, 'se', { x: 600, y: 100, width: 150, height: 200 }, 150, 0);
  const d = wm.splitOnto(a, b, 700, 110); eq(d?.side, 'top', 'splitOnto top'); eq([W(a).x, W(a).y, W(a).width, W(a).height], [600, 100, 300, 100], 'splitOnto places A'); eq([W(b).x, W(b).y, W(b).width, W(b).height], [600, 200, 300, 100], 'splitOnto shrinks B');
  eq(wm.splitOnto(a, a, 0, 0), null, 'cannot split onto itself');
  // no-overlap: settling a window that overlaps another pushes it clear (and may leave the screen)
  wm.setSnapRules({ noOverlap: true }); wm.moveTo(a, 620, 150); wm.settle(a); ok(!rectsOverlap({ x: W(a).x, y: W(a).y, width: W(a).width, height: W(a).height }, { x: W(b).x, y: W(b).y, width: W(b).width, height: W(b).height }), 'no-overlap settle clears B');
  wm.setSnapRules({});
  ok(wm.windowMenu().some((m) => m.id === 'snap' && (m.items?.length ?? 0) === 6), 'window menu has the snap submenu');
}

console.log(`check-windows: ${checks} checks passed`);
