/**
 * Self-test for element-inspector@1 on the web port (CI: npx -y tsx framework/spec/check-inspector.mts).
 *  1. replays spec/fixtures/element-inspector.json against core/engines/inspect.ts (the kernel's InspectEngine replays
 *     the same file in ElementInspectorConformanceTest)
 *  2. the rules the fixture is built to show: left only, press-drag follows live, release closes, double click pins,
 *     the pinned panel moves and resizes inside the viewport, a press swallows its click
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INSPECT_DEFAULTS, INSPECT_VERSION, clampPanel, followPanel, inspectInit, inspectStep, isLeftPress, movePanel, pinPanel, resizePanel, type InspectConfig, type InspectEvent, type InspectState } from '../core/engines/inspect';

const f = JSON.parse(readFileSync(new URL('./fixtures/element-inspector.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };
const ok = (v: unknown, what: string) => { assert.ok(v, what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(INSPECT_VERSION, f.contract, 'contract');
eq(INSPECT_DEFAULTS, f.defaults, 'defaults');
for (const sc of f.scenarios) {
  const cfg: InspectConfig = { ...INSPECT_DEFAULTS, ...sc.config };
  let s = inspectInit(sc.viewport);
  sc.steps.forEach((st: { event: InspectEvent }, i: number) => {
    const r = inspectStep(s, st.event, cfg);
    const { event: _e, ...want } = st as Record<string, unknown>;
    eq(r, want, `${sc.name} step ${i} ${JSON.stringify(st.event)}`);
    s = r.state;
  });
}
for (const c of f.follow) eq(followPanel(c.at, c.size, f.viewport), c.out, `follow ${JSON.stringify(c)}`);
for (const c of f.clamp) eq(clampPanel(c.in, f.viewport), c.out, `clamp ${JSON.stringify(c.in)}`);
for (const c of f.move) eq(movePanel(c.from, c.dx, c.dy, f.viewport), c.out, `move ${c.dx},${c.dy}`);
for (const c of f.resize) eq(resizePanel(c.from, c.dw, c.dh, f.viewport), c.out, `resize ${c.dw},${c.dh}`);
for (const c of f.pin) eq(pinPanel(c.at, f.viewport), c.out, `pin ${JSON.stringify(c.at)}`);

/* ---------- 2. the rules ---------- */
const vp = { w: 1000, h: 700 };
const run = (events: InspectEvent[], s: InspectState = inspectInit(vp)) => events.reduce<{ s: InspectState; out: ReturnType<typeof inspectStep>[] }>((acc, e) => { const r = inspectStep(acc.s, e); return { s: r.state, out: [...acc.out, r] }; }, { s, out: [] });
const P = (type: 'down' | 'move' | 'up' | 'cancel', t: number, x: number, y: number, more: object = {}): InspectEvent => ({ type, t, x, y, ...more } as InspectEvent);

ok(isLeftPress({}) && isLeftPress({ button: 0, primary: true }) && !isLeftPress({ button: 2 }) && !isLeftPress({ button: 1 }) && !isLeftPress({ primary: false }), 'left only');
{ // hover alone shows nothing; a right press is left to the page (context menu)
  const r = run([P('move', 0, 5, 5), P('down', 1, 5, 5, { button: 2 }), P('up', 2, 5, 5, { button: 2 })]);
  ok(r.out.every((o) => !o.look && !o.consume && !o.state.follow), 'no hover panel, right button untouched');
}
{ // press → follow; every move a fresh look; release closes and swallows the click
  const r = run([P('down', 0, 10, 10), P('move', 5, 50, 60), P('move', 10, 70, 80), P('up', 15, 70, 80)]);
  eq(r.out.map((o) => o.look), [{ x: 10, y: 10 }, { x: 50, y: 60 }, { x: 70, y: 80 }, null], 'live look while dragging');
  eq(r.out.map((o) => o.state.follow), [{ x: 10, y: 10 }, { x: 50, y: 60 }, { x: 70, y: 80 }, null], 'panel follows, release closes');
  eq([r.out[0]!.consume, r.out[3]!.consume], [true, true], 'press and release swallowed');
}
{ // double click pins; the pin outlives the release and later presses
  const r = run([P('down', 0, 100, 100), P('up', 50, 100, 100), P('down', 150, 102, 101), P('up', 200, 102, 101), P('down', 900, 400, 400), P('up', 950, 400, 400)]);
  eq(r.out[2]!.pinned, { x: 102, y: 101 }, 'second press pins');
  ok(r.out[5]!.state.pin && !r.out[5]!.state.follow, 'pin stays after later presses');
  eq(r.out[5]!.state.pin!.at, { x: 102, y: 101 }, 'pin keeps its element point');
}
{ // pinned panel: drag + resize, never off screen or under the minimum
  const pinned = run([P('down', 0, 100, 100), P('up', 10, 100, 100), P('down', 20, 100, 100), P('up', 30, 100, 100)]).s;
  const p0 = pinned.pin!.panel;
  const moved = run([P('down', 40, p0.x + 10, p0.y + 5, { on: 'head' }), P('move', 50, -900, -900), P('up', 60, -900, -900)], pinned).s.pin!.panel;
  eq({ x: moved.x, y: moved.y }, { x: INSPECT_DEFAULTS.margin, y: INSPECT_DEFAULTS.margin }, 'drag stops at the edge');
  const tiny = run([P('down', 40, 0, 0, { on: 'resize' }), P('move', 50, -900, -900), P('up', 60, -900, -900)], pinned).s.pin!.panel;
  eq({ w: tiny.w, h: tiny.h }, INSPECT_DEFAULTS.min, 'resize stops at the minimum');
  const big = run([P('down', 40, 0, 0, { on: 'resize' }), P('move', 50, 9000, 9000)], pinned).s.pin!.panel;
  eq([big.x + big.w, big.y + big.h], [vp.w - INSPECT_DEFAULTS.margin, vp.h - INSPECT_DEFAULTS.margin], 'resize stops at the viewport');
  const gone = run([{ type: 'unpin' }], pinned).s;
  eq(gone.pin, null, 'unpin closes it');
}

console.log(`element-inspector@1: ${checks} checks passed (${f.scenarios.length} scenarios)`);
