/**
 * Self-test for the dock engine (dock@1, core/engines/dock.ts; CI: npx -y tsx framework/spec/check-dock.mts). Replays
 * spec/fixtures/dock.json through the reference engine (the Kotlin DockEngine replays the same file once the Android
 * twin lands; see PORTING.md), checks the ten dock-layout@1 starters validate, and exercises the WindowManager API the
 * fixture can't cover: a tab drag over reported bounds that lands in a zone, the pane limit, splitter resize,
 * snapshot → restore, presets, re-docking a floating window, and that the older API still behaves the same.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DOCK_RULES, DOCK_CONTRACT, DOCK_LAYOUT_MAX_PANES, DOCK_SIDES, DOCK_ZONES, applyDockDrop, applyPreset, clampWeights, countPanes, dockDropAt, dockDropRect, dockLayoutErrors, dockZoneAt, dropIsLimited, enforcePaneLimit, headerIndexAt, normalizeDockLayout, normalizeDockRules, normalizeTree, paneAt, parseTab, parseTree, pathOf, presetRects, presetSvg, presetTree, removePane, resizeSplit, restoreDock, serializeDock, splitPane, splitRoot, type DockDrop, type DockState, type GroupBox, type PanePath } from '../core/engines/dock';
import { WindowManager, paneGroups, type Pane, type TabGroup } from '../core/engines/windows';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/dock.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };
const groupsOf = (groups: Record<string, TabGroup>) => Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { tabs: g.tabs.map((t) => t.id), active: g.active, windowId: g.windowId }]));
const stateOf = (raw: { tree: Pane | null; groups: Record<string, { tabs: string[]; active: number; windowId: string }> }): DockState => ({ tree: raw.tree, groups: Object.fromEntries(Object.entries(raw.groups).map(([k, g]) => [k, { id: k, tabs: g.tabs.map((t) => ({ id: t, title: t.toUpperCase(), kind: 'doc', payload: `p/${t}` })), active: g.active, windowId: g.windowId }])) });

// ---- fixture replay ----
eq(f.contract, DOCK_CONTRACT, 'contract'); eq(f.rules, DEFAULT_DOCK_RULES, 'default rules'); eq(f.sides, DOCK_SIDES, 'sides'); eq(f.zoneList, DOCK_ZONES, 'zones'); eq(f.maxPresetPanes, DOCK_LAYOUT_MAX_PANES, 'max preset panes');
for (const c of f.normalizeRules) eq(normalizeDockRules(c.input), c.rules, `rules ${JSON.stringify(c.input)}`);
for (const c of f.weights) eq(clampWeights(c.weights, c.n, c.min ?? undefined), c.out, `weights ${JSON.stringify(c.weights)} / ${c.n}`);
for (const c of f.normalize) { eq(normalizeTree(c.tree), c.out, `normalize ${c.name}`); eq(countPanes(normalizeTree(c.tree)), c.panes, `panes ${c.name}`); }
for (const c of f.paths.of) eq(pathOf(f.paths.tree, c.group), c.path, `path of ${c.group}`);
for (const c of f.paths.at) eq(paneAt(f.paths.tree, c.path), c.node, `node at ${JSON.stringify(c.path)}`);
for (const c of f.split.cases) eq(splitPane(f.split.base, c.group, c.side, 'new', c.ratio ?? undefined), c.out, `split ${c.name}`);
for (const c of f.splitRoot) eq(splitRoot(c.tree, c.side, 'new', c.ratio ?? undefined), c.out, `split root ${c.side}`);
f.remove.forEach((c: { group: string; out: Pane | null }, i: number) => eq(removePane(i === f.remove.length - 1 ? { kind: 'leaf', groupId: 'a' } : f.split.base, c.group), c.out, `remove ${c.group} #${i}`));
for (const c of f.resize) eq(resizeSplit(f.split.base, c.path, c.index, c.delta === 'NaN' ? NaN : c.delta), c.out, `resize ${JSON.stringify(c.path)} ${c.index} ${c.delta}`);
for (const c of f.zones.probes) { eq(dockZoneAt(f.zones.box, c.px, c.py), c.zone, `zone ${c.px},${c.py}`); eq(dockZoneAt({ groupId: f.zones.box.groupId, rect: f.zones.box.rect }, c.px, c.py), c.zoneDefaultHeader, `zone (default header) ${c.px},${c.py}`); }
for (const c of f.headerIndex) eq(headerIndexAt(c.px, c.rights), c.index, `header index ${c.px}`);
{
  const rights = (gid: string) => f.drops.tabRights[gid] as number[] | undefined;
  for (const c of f.drops.probes) {
    const d = dockDropAt(f.drops.host, f.drops.boxes, c.px, c.py, DEFAULT_DOCK_RULES, rights);
    eq(d, c.drop, `drop at ${c.px},${c.py}`);
    eq(d ? dockDropRect(d, f.drops.host, d.target === 'group' ? (f.drops.boxes as GroupBox[]).find((b) => b.groupId === d.groupId) ?? null : null) : null, c.rect, `drop rect at ${c.px},${c.py}`);
  }
  eq(dockDropAt(f.drops.host, [], 8, 300, DEFAULT_DOCK_RULES, rights), f.drops.noBoxesEdge, 'no panes: the host edge is not a split');
}
{
  const state = stateOf(f.apply.state);
  for (const c of f.apply.cases) {
    const rules = normalizeDockRules({ ...DEFAULT_DOCK_RULES, ...(c.rules ?? {}) });
    const out = applyDockDrop(state, c.tab, c.drop as DockDrop, 'new', 'main', rules);
    eq(dropIsLimited(state, c.tab, c.drop as DockDrop, rules), c.limited, `limited ${c.name}`);
    eq(out === state, c.unchanged, `unchanged ${c.name}`);
    eq(out.tree, c.tree, `tree ${c.name}`); eq(groupsOf(out.groups), c.groups, `groups ${c.name}`);
  }
}
{
  const st = f.limit.state;
  const state: DockState = { tree: st.tree, groups: Object.fromEntries(Object.entries(st.groups as Record<string, string[]>).map(([k, tabs]) => [k, { id: k, tabs: tabs.map((t) => ({ id: t, title: t.toUpperCase(), kind: 'doc', payload: `p/${t}` })), active: 0, windowId: k === 'x' ? 'win-1' : 'main' }])) };
  const out = enforcePaneLimit(state, normalizeDockRules({ paneLimit: f.limit.paneLimit }));
  eq(out.tree, f.limit.out.tree, 'limit tree'); eq(Object.fromEntries(Object.entries(out.groups).map(([k, g]) => [k, g.tabs.map((t) => t.id)])), f.limit.out.groups, 'limit groups');
}
eq(serializeDock(stateOf(f.apply.state)), f.snapshot, 'snapshot');
for (const c of f.restore) {
  const r = restoreDock(c.raw, 'main', normalizeDockRules(c.name === 'over the limit' ? { paneLimit: 2 } : null));
  eq(r ? { tree: r.tree, groups: Object.fromEntries(Object.entries(r.groups).map(([k, g]) => [k, { tabs: g.tabs, active: g.active, windowId: g.windowId }])) } : null, c.out, `restore ${c.name}`);
}
for (const c of f.parseTab) eq(parseTab(c.raw), c.tab, `parseTab ${JSON.stringify(c.raw)}`);
for (const c of f.parseTree) eq(parseTree(c.raw, (g) => ['a', 'b', 'c'].includes(g)), c.tree, `parseTree ${JSON.stringify(c.raw).slice(0, 60)}`);
{
  const dir = join(root, 'assets/dock-layout');
  const starters = readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')));
  eq(starters.length, 10, 'ten starter layouts ship');
  eq(Object.keys(f.presets.starters).sort(), starters.map((a) => a.id).sort(), 'every starter is in the fixture');
  for (const a of starters) {
    const v = validateAsset(a); ok(v.ok, `starter ${a.id} validates: ${v.errors.join('; ')}`);
    const d = normalizeDockLayout(a.data); const fx = f.presets.starters[a.id];
    eq(d, fx.normalized, `starter ${a.id} normalized`); eq(dockLayoutErrors(a.data), fx.errors, `starter ${a.id} errors`); eq(fx.errors, [], `starter ${a.id} has no engine errors`);
    eq(presetTree(d, ['g1', 'g2', 'g3', 'g4']), fx.tree, `starter ${a.id} tree`); eq(presetRects(d), fx.rects, `starter ${a.id} rects`); eq(presetSvg(d), fx.svg, `starter ${a.id} svg`);
    ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(fx.svg) && fx.svg.includes('var(--fx-'), `starter ${a.id} thumbnail reads theme tokens only`);
    eq(fx.rects.length, d.panes, `starter ${a.id} draws every pane`);
  }
  const apply: DockState = { tree: f.presets.applyState.tree, groups: Object.fromEntries(Object.entries(f.presets.applyState.groups as Record<string, { tabs: TabGroup['tabs']; active: number; windowId: string }>).map(([k, g]) => [k, { id: k, tabs: g.tabs, active: g.active, windowId: g.windowId }])) };
  for (const c of f.presets.apply) {
    const d = normalizeDockLayout(starters.find((a) => a.id === c.preset)!.data);
    const out = applyPreset(apply, d, 'main', (n) => `new-${n}`, normalizeDockRules({ paneLimit: c.paneLimit }));
    eq(out.tree, c.tree, `apply ${c.preset}`); eq(Object.fromEntries(Object.entries(out.groups).map(([k, g]) => [k, { tabs: g.tabs.map((t) => t.id), windowId: g.windowId }])), c.groups, `apply groups ${c.preset}`);
    ok(countPanes(out.tree) <= c.paneLimit, `apply ${c.preset} stays within the limit`);
    eq(paneGroups(out.tree!).flatMap((g) => out.groups[g]!.tabs.map((t) => t.id)).sort(), c.tabs, `apply ${c.preset} keeps every tab`);
  }
  for (const c of f.presets.bad) { eq(normalizeDockLayout(c.raw), c.normalized, `bad layout ${c.name} normalized`); eq(dockLayoutErrors(c.raw), c.errors, `bad layout ${c.name} errors`); }
  eq(applyPreset({ tree: null, groups: {} }, normalizeDockLayout(starters[0]!.data), 'main', (n) => `new-${n}`), f.presets.applyEmpty, 'apply to nothing');
  // the validator and the engine agree on a bad starter shape
  const bad = validateAsset({ $axf: 'asset@1', type: 'dock-layout', id: 'x', name: 'X', version: '1', data: { panes: 2, tree: { kind: 'leaf', pane: 1 } } });
  ok(!bad.ok && bad.errors.some((e) => e.includes('data.panes must be 1')), 'validator uses the engine errors');
  ok((ASSET_TYPES as readonly string[]).includes('dock-layout') && (OPTIONAL_TYPES as readonly string[]).includes('dock-layout'), 'dock-layout is an optional asset type');
}

// ---- invariants over random trees: normalize is idempotent, weights sum to 1, splits never nest the same orientation ----
{
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let n = 0;
  const gen = (depth: number): Pane => { n++; if (depth > 3 || rnd() < 0.35) return { kind: 'leaf', groupId: `g${n}` }; const k = 2 + Math.floor(rnd() * 3); return { kind: 'split', vertical: rnd() < 0.5, children: Array.from({ length: k }, () => gen(depth + 1)), weights: Array.from({ length: k }, () => rnd() * 3) }; };
  const walk = (p: Pane, fn: (p: Pane, parent: Pane | null) => void, parent: Pane | null = null) => { fn(p, parent); if (p.kind === 'split') p.children.forEach((c) => walk(c, fn, p)); if (p.kind === 'grid') p.cells.forEach((c) => walk(c, fn, p)); };
  for (let i = 0; i < 40; i++) {
    const t = normalizeTree(gen(0))!;
    eq(normalizeTree(t), t, `normalize idempotent #${i}`);
    walk(t, (p, parent) => {
      if (p.kind !== 'split') return;
      ok(Math.abs(p.weights.reduce((a, b) => a + b, 0) - 1) < 0.001, `weights sum to 1 #${i}`);
      // the floor holds unless there are too many children for it, then they share equally
      const floor = p.children.length * DEFAULT_DOCK_RULES.minWeight >= 1 ? 1 / p.children.length : DEFAULT_DOCK_RULES.minWeight;
      ok(p.weights.every((w) => w >= floor - 1e-4), `weights above the floor #${i}`);
      ok(p.children.length >= 2, `no single-child split #${i}`);
      ok(!(parent?.kind === 'split' && parent.vertical === p.vertical), `no nested same-orientation split #${i}`);
    });
    // splitting then removing the new pane gives the tree's shape back (the split's weights are shared out again)
    const shape = (p: Pane | null): unknown => (!p ? null : p.kind === 'leaf' ? p.groupId : p.kind === 'split' ? { v: p.vertical, c: p.children.map(shape) } : { g: p.cells.map(shape) });
    const first = paneGroups(t)[0]!;
    for (const side of DOCK_SIDES) {
      const s = splitPane(t, first, side, 'new');
      eq(countPanes(s), countPanes(t) + 1, `split adds one pane #${i} ${side}`);
      ok(pathOf(s, 'new') !== null && pathOf(s, first) !== null, `both panes in the tree #${i} ${side}`);
      eq(shape(removePane(s, 'new')), shape(t), `split then remove restores the shape #${i} ${side}`);
    }
    const snap = serializeDock({ tree: t, groups: Object.fromEntries(paneGroups(t).map((g) => [g, { id: g, tabs: [{ id: `${g}-t`, title: g, kind: 'doc' }], active: 0, windowId: 'main' }])) });
    const back = restoreDock(snap, 'main', normalizeDockRules({ paneLimit: 64 }));
    if (countPanes(t) <= 64) eq(back?.tree, t, `snapshot round trip #${i}`);
    else eq(countPanes(back?.tree), 64, `snapshot restore enforces the limit #${i}`);
  }
}

// ---- WindowManager API ----
{
  const wm = new WindowManager();
  wm.viewport = { width: 1000, height: 700 };
  const tab = (id: string) => ({ id, title: id, kind: 'doc' });
  const a = wm.openGroup([tab('t1'), tab('t2')]);
  eq(wm.paneCount(), 1, 'one pane'); eq(wm.snapshot()!.$axf, DOCK_CONTRACT, 'snapshot contract');
  // the UI reports where things are: the main dock host and the one pane
  wm.hostBounds.set('main', { x: 0, y: 0, width: 800, height: 600 });
  wm.groupBounds.set(a, [0, 0, 800, 600]); wm.groupHeaders.set(a, 32); wm.tabEdges.set(a, [60, 120]);
  // a tab drag that ends on the right edge of the pane splits it
  wm.dragStart('t2', a, 400, 300); wm.dragMove(780, 300);
  eq(wm.state.dockPreview?.drop, { target: 'group', groupId: a, zone: 'right' }, 'preview: right zone of the pane');
  eq(wm.state.dockPreview?.rect, { x: 400, y: 0, width: 400, height: 600 }, 'preview rect: the right half');
  ok(wm.dragEnd(), 'drop applied'); eq(wm.paneCount(), 2, 'two panes'); eq(wm.state.dockPreview ?? null, null, 'preview cleared');
  const tree = wm.state.layouts.main!; ok(tree.kind === 'split' && !tree.vertical, 'horizontal split');
  const b = paneGroups(tree)[1]!; eq(wm.state.groups[b]!.tabs.map((t) => t.id), ['t2'], 'the dragged tab is in the new pane');
  // a drag that ends over nothing falls back to the plain group drop
  wm.groupBounds.set(a, [0, 0, 400, 600]); wm.groupBounds.set(b, [400, 0, 800, 600]);
  wm.dragStart('t1', a, 100, 300); wm.dragMove(950, 300); eq(wm.state.dockPreview ?? null, null, 'outside every host: no preview'); ok(!wm.dragEnd(), 'nothing happens');
  // header drop at an index
  wm.tabEdges.set(b, [460]);
  wm.dragStart('t1', a, 100, 300); wm.dragMove(420, 24); // below the host's top edge band, inside the 32 px header
  eq(wm.state.dockPreview?.drop, { target: 'group', groupId: b, zone: 'header', index: 0 }, 'header drop at the start');
  ok(wm.dragEnd(), 'header drop applied'); eq(wm.state.groups[b]!.tabs.map((t) => t.id), ['t1', 't2'], 'inserted before t2'); eq(wm.paneCount(), 1, 'the emptied pane went');
  // pane limit: splitGroup joins once the limit is reached
  wm.setDockRules({ paneLimit: 2 });
  const c = wm.splitGroup(b, 'bottom', [tab('t3')]); ok(c && c !== b, 'split below'); eq(wm.paneCount(), 2, 'two panes again');
  const d = wm.splitGroup(b, 'left', [tab('t4')]); eq(d, b, 'at the limit the tabs join the target'); eq(wm.state.groups[b]!.tabs.map((t) => t.id), ['t1', 't2', 't4'], 'joined');
  ok(wm.paneLimitReached(), 'limit reached');
  wm.setDockRules({ paneLimit: 6 });
  // splitter resize with the floor
  const before = (wm.state.layouts.main as Extract<Pane, { kind: 'split' }>).weights.slice();
  wm.resizeSplit('main', [], 0, 0.2); const after = (wm.state.layouts.main as Extract<Pane, { kind: 'split' }>).weights;
  ok(Math.abs(after[0]! - (before[0]! + 0.2)) < 0.001 && Math.abs(after[0]! + after[1]! - 1) < 0.001, 'divider moved, total kept');
  wm.resizeSplit('main', [], 0, 5); ok(Math.abs((wm.state.layouts.main as Extract<Pane, { kind: 'split' }>).weights[1]! - DEFAULT_DOCK_RULES.minWeight) < 0.001, 'floor holds');
  // snapshot → restore round trip, then a preset
  const snap = wm.snapshot()!; const json = JSON.parse(JSON.stringify(snap));
  wm.closeGroup(b); wm.closeGroup(c!); eq(wm.paneCount(), 0, 'emptied');
  ok(wm.restoreLayout(json), 'restored'); eq(wm.snapshot(), snap, 'same snapshot after restore');
  const ide = normalizeDockLayout(JSON.parse(readFileSync(join(root, 'assets/dock-layout/ide.json'), 'utf8')).data);
  ok(wm.applyPreset(ide), 'preset applied'); eq(wm.paneCount(), 4, 'four tabs → four panes'); ok(paneGroups(wm.state.layouts.main!).every((g) => wm.state.groups[g]!.tabs.length === 1), 'one tab per pane');
  ok(!wm.applyPreset(ide, 'nope'), 'unknown window: nothing');
  // undock a pane, then re-dock it into the top of the main dock
  const gid = paneGroups(wm.state.layouts.main!)[0]!;
  const win = wm.undock(gid)!; ok(wm.state.windows.some((w) => w.id === win), 'floating window'); eq(wm.paneCount(), 3, 'three panes left');
  ok(wm.redockInto(win, { target: 'root', zone: 'top' }), 're-docked'); ok(!wm.state.windows.some((w) => w.id === win), 'floating window closed');
  const top = wm.state.layouts.main!; ok(top.kind === 'split' && top.vertical && top.children[0]!.kind === 'leaf', 'the pane sits along the top'); eq(wm.paneCount(), 4, 'four panes');
  // dropping a floating window's only tab into the main dock closes that window
  const fl = wm.openFloating([tab('t9')], 'Float'); const fg = paneGroups(wm.state.layouts[fl]!)[0]!;
  const into = paneGroups(wm.state.layouts.main!)[0]!;
  ok(wm.dropTab('t9', 'main', { target: 'group', groupId: into, zone: 'centre' }), 'dropped into main'); ok(!wm.state.windows.some((w) => w.id === fl), 'emptied floating window closed'); ok(!wm.state.groups[fg], 'its group is gone');
  ok(wm.state.groups[into]!.tabs.some((t) => t.id === 't9'), 'tab joined the pane');
  // the old API still works on the same tree
  wm.split(into, 'vertical'); ok(wm.paneCount() >= 4, 'legacy split still works');
  const m = wm.groupMenu(); ok(m.some((i) => i.id === 'layout' && i.action === 'dialog:dock-layout:{payload}'), 'group menu offers the pane layouts');
  ok(wm.windowMenu().some((i) => i.id === 'redock-into'), 'window menu offers re-dock into');
}

console.log(`check-dock: ok (${checks} checks)`);
