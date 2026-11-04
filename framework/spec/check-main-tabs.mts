/**
 * Self-test for the main-area tab group (main-tabs@1, core/engines/maintabs.ts; CI: npx -y tsx framework/spec/check-main-tabs.mts).
 * Replays spec/fixtures/main-tabs.json through the reference engine (the Kotlin twin replays it once Android work
 * resumes, PORTING.md), then drives the WindowManager calls the tab group adds: floating a tab out of its group,
 * cancelling a drag, the ghost-only drag step, docking a floating window back onto a group as tabs, and a dock
 * snapshot of screen tabs that restores with every tab, title and icon.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeOthersIds, closeRightIds, evictIds, normalizeMainTabSettings, normalizeMainTabsSession, pinnedFirst, pushClosed, resolveView, stripDropIndex,
  swipeIndex, swipeOf, tabView, touchOrder, viewTab, DEFAULT_MAIN_TAB_SETTINGS, MAIN_TABS_FRAME, MAIN_VIEW_TAB,
} from '../core/engines/maintabs';
import { PLACED_VIEW_TAB } from '../core/engines/placement';
import { WindowManager, paneGroups, type TabSpec } from '../core/engines/windows';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/main-tabs.json'), 'utf8'));
let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const tabs: TabSpec[] = f.tabs.map((id: string) => ({ id, title: id.toUpperCase(), kind: 'doc' }));

// ---- fixture replay ----
eq(f.contract, MAIN_TABS_FRAME, 'contract');
eq(DEFAULT_MAIN_TAB_SETTINGS, f.defaults, 'default settings');
eq(MAIN_VIEW_TAB, PLACED_VIEW_TAB, 'screen tabs use the placed-view kind (floated screens render anywhere)');
for (const c of f.normalizeSettings) eq(normalizeMainTabSettings(c.input), c.out, `settings ${JSON.stringify(c.input)}`);
for (const c of f.closeOthers) eq(closeOthersIds(tabs, c.keep, f.pinned), c.out, `close others keep ${c.keep}`);
for (const c of f.closeRight) eq(closeRightIds(tabs, c.of, f.pinned), c.out, `close right of ${c.of}`);
for (const c of f.evict) eq(evictIds(tabs, c.active, f.pinned, c.max, c.order), c.out, `evict max ${c.max} active ${c.active}`);
eq(pinnedFirst(tabs, f.pinnedFirst.pinned).map((t) => t.id), f.pinnedFirst.out, 'pinned first');
for (const c of f.swipe) eq(swipeIndex(c.index, c.dir, c.count), c.out, `swipe ${c.index} ${c.dir} of ${c.count}`);
for (const c of f.swipeOf) eq(swipeOf(c.dx, c.dy), c.out, `swipe of ${c.dx},${c.dy}`);
for (const c of f.stripDrop.probes) eq(stripDropIndex(f.stripDrop.spans, c.at), c.out, `strip drop at ${c.at}`);
for (const c of f.resolve) eq(resolveView(f.views, c.q), c.out, `resolve "${c.q}"`);
for (const c of f.session) eq(normalizeMainTabsSession(c.input), c.out, `session ${JSON.stringify(c.input)}`);
eq(pushClosed(f.pushClosed.stack, f.pushClosed.tab), f.pushClosed.out, 'push closed: newest first, one per screen');
eq(pushClosed(f.pushClosed.stack, f.pushClosed.notAScreen), f.pushClosed.stack, 'push closed: non-screen tabs are not remembered');
eq(touchOrder(['a', 'b', 'c'], 'a'), ['b', 'c', 'a'], 'most recently used goes last');
eq(viewTab('plan', 'Plan', 'layers'), { id: 'view-plan', title: 'Plan', kind: MAIN_VIEW_TAB, payload: 'plan', icon: 'layers' }, 'screen tab');
eq(viewTab('plan', 'Plan', null, 2).id, 'view-plan-2', 'duplicate screen tab id');
eq(tabView(viewTab('plan', 'Plan', null)), 'plan', 'tab view'); eq(tabView({ kind: 'terminal', payload: 'x' }), null, 'non-screen tab has no view');

// ---- WindowManager: float, cancel, ghost, dock back, snapshot ----
{
  const wm = new WindowManager();
  const g = wm.openGroup([viewTab('home', 'Home', 'home'), viewTab('plan', 'Plan', 'layers'), viewTab('build', 'Build queue', 'play')]);
  const wid = wm.floatTab('view-plan', 400, 300, 600, 400)!;
  ok(wid, 'floatTab opens a window');
  const w = wm.state.windows.find((x) => x.id === wid)!;
  eq([w.type, w.x, w.y, w.width, w.height], ['floating', 100, 284, 600, 400], 'floated window: centred on the pointer, its size');
  eq(wm.state.groups[g]!.tabs.map((t) => t.id), ['view-home', 'view-build'], 'the tab left its group');
  eq(wm.state.groups[paneGroups(wm.state.layouts[wid]!)[0]!]!.tabs.map((t) => t.id), ['view-plan'], 'the window holds the tab');
  eq(wm.floatTab('nope'), null, 'floating a missing tab does nothing');

  wm.dragStart('view-home', g, 10, 10); wm.dragGhost(50, 60);
  eq([wm.state.drag?.x, wm.state.drag?.y, wm.state.dockPreview ?? null], [50, 60, null], 'ghost step: moves the ghost, no dock preview');
  wm.dragCancel(); eq([wm.state.drag, wm.state.dockPreview ?? null], [null, null], 'drag cancelled, nothing moved');
  eq(wm.state.groups[g]!.tabs.length, 2, 'cancel keeps the tabs where they were');

  ok(wm.redockInto(wid, { target: 'group', groupId: g, zone: 'centre' }), 'dock the window onto the group');
  ok(!wm.state.windows.some((x) => x.id === wid), 'the docked window closed');
  eq(wm.state.groups[g]!.tabs.map((t) => t.id), ['view-home', 'view-build', 'view-plan'], 'its tab joined the group');

  const snap = wm.snapshot();
  const wm2 = new WindowManager();
  ok(wm2.restoreLayout(snap), 'snapshot restores');
  const back = Object.values(wm2.state.groups).flatMap((x) => x.tabs);
  eq(back.map((t) => [t.id, t.title, t.kind, t.payload, t.icon]), [['view-home', 'Home', MAIN_VIEW_TAB, 'home', 'home'], ['view-build', 'Build queue', MAIN_VIEW_TAB, 'build', 'play'], ['view-plan', 'Plan', MAIN_VIEW_TAB, 'plan', 'layers']], 'restored tabs keep screen, title and icon');
}

console.log(`check-main-tabs: ${checks} checks passed`);
