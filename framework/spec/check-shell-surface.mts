/**
 * Molly as the one shell (build molly-one-shell s4–s6): replays the three fixtures through the reference engines (the
 * Kotlin twins are deferred, spec/PORTING.md; the fixtures are what they will replay) and checks the properties the
 * fixtures can't show on their own.
 *   - shell-surface@1 (core/engines/shell-surface.ts): spec/fixtures/shell-surface.json
 *   - menu-index@1 (core/engines/menu-index.ts): spec/fixtures/menu-index.json
 *   - xlayout@1 layout modes (core/engines/xlayout.ts): spec/fixtures/xlayout-modes.json
 *   npx -y tsx framework/spec/check-shell-surface.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_KINDS, EFFECTS, KIND_CATEGORY, MOUNT_KINDS, REFUSED_MOUNTS, SEARCH_KIND_MAP, SHELL_SURFACE_CONTRACT, SURFACE_KINDS, SURFACE_LIMITS, categoryOf, mergeSurfaces, normalizeSurface, parseCategory, parseRef, qualify, resolveRef, surfaceCounts, surfaceErrors, surfaceFromCatalog, surfaceFromSearch, type ShellSurface } from '../core/engines/shell-surface';
import { FAVORITES_ID, MENU_INDEX_CONTRACT, MENU_INDEX_DEFAULTS, RECENTS_ID, buildMenuIndex, fitBar, foldLevel, menuItems, menuNode, menuPath, pruneRefs, pushRecent, searchMenu, toggleFavorite, type MenuNode } from '../core/engines/menu-index';
import { LAYOUT_MODES, LAYOUT_MODE_PRESET, closeTab, containerIsTabs, effectiveLayout, moveTab, normalizeXLayout, openInContainer, parseOpenMap, removeLayout, saveLayout, setContainerTabs, setLayoutMode, snapshotLayout, switchLayout, xlayoutErrors, type XOpenMap } from '../core/engines/xlayout';

const root = new URL('../', import.meta.url).pathname;
const fx = (n: string) => JSON.parse(readFileSync(join(root, 'spec/fixtures', n), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

// ---------- shell-surface@1 ----------
{
  const f = fx('shell-surface.json');
  eq(f.contract, SHELL_SURFACE_CONTRACT, 'contract'); eq(f.kinds, SURFACE_KINDS, 'kinds'); eq(f.kindCategory, KIND_CATEGORY, 'kind categories');
  eq(f.mounts, MOUNT_KINDS, 'mount kinds'); eq(f.refused, REFUSED_MOUNTS, 'refused mounts'); eq(f.auth, AUTH_KINDS, 'auth kinds'); eq(f.effects, EFFECTS, 'effects'); eq(f.limits, SURFACE_LIMITS, 'limits'); eq(f.searchKinds, SEARCH_KIND_MAP, 'search kinds');
  ok(!(MOUNT_KINDS as readonly string[]).some((k) => (REFUSED_MOUNTS as readonly string[]).includes(k)), 'no embedding: native is the only mount kind');
  for (const c of f.normalize) eq(normalizeSurface(c.raw), c.out, `normalize ${c.name}`);
  for (const c of f.errors) eq(surfaceErrors(c.raw), c.errors, `errors ${c.name}`);
  for (const c of f.errors.filter((c: { name: string }) => c.name.endsWith('mount'))) ok(c.errors.some((e: string) => /refused/.test(e)), `${c.name} is refused by name`);
  for (const c of f.categories) eq(parseCategory(c.raw), c.out, `category ${JSON.stringify(c.raw)}`);
  const good = normalizeSurface(f.normalize[0].raw)!;
  eq(good.items.map((i) => ({ kind: i.kind, id: i.id, path: categoryOf(i) })), f.categoryOf, 'category of each item');
  eq(good.items.map((i) => qualify(good.app.id, i)), f.refs.make, 'qualified refs');
  for (const c of f.refs.parse) eq(parseRef(c.ref), c.out, `parse ${c.ref}`);
  for (const c of f.refs.resolve) eq(resolveRef([good], c.ref)?.item ?? null, c.out, `resolve ${c.ref}`);
  for (const i of good.items) { const p = parseRef(qualify(good.app.id, i))!; eq([p.app, p.kind, p.id], [good.app.id, i.kind, i.id], `round trip ${i.kind}:${i.id}`); }
  eq(surfaceFromSearch({ id: 'console', label: 'Console' }, f.normalize[0].raw.mount, f.fromSearch.search), f.fromSearch.out, 'surface from a search index');
  const fromSearch = f.fromSearch.out as ShellSurface;
  ok(!fromSearch.items.some((i) => ['asset', 'window', 'text'].includes(String(i.kind))), 'assets, windows and page text are not menu places');
  eq(surfaceFromCatalog({ id: 'console', label: 'Console' }, f.normalize[0].raw.mount, { items: f.fromCatalog.items }), f.fromCatalog, 'surface from console-catalog@1');
  eq(mergeSurfaces([f.normalize[0].raw, { ...f.normalize[0].raw, app: { id: 'axhub', label: 'axHub' } }, { ...f.normalize[0].raw, app: { id: 'console', label: 'Console 2' } }, 'junk']).map((m) => ({ app: m.app, items: m.items.length })), f.merge, 'merge by app');
  eq(surfaceCounts(good), f.counts, 'counts');
  // the validator and the normalizer agree: no errors ⇒ normalizes; frame mounts never normalize
  for (const c of f.errors) if (!c.errors.length) ok(normalizeSurface(c.raw), `${c.name}: valid ⇒ normalizes`);
  for (const k of REFUSED_MOUNTS) eq(normalizeSurface({ app: { id: 'a', label: 'A' }, mount: { kind: k, module: 'a' }, items: [] }), null, `${k} mount never normalizes`);
}

// ---------- menu-index@1 ----------
{
  const f = fx('menu-index.json');
  eq(f.contract, MENU_INDEX_CONTRACT, 'contract'); eq(f.defaults, MENU_INDEX_DEFAULTS, 'defaults');
  const { surfaces, favorites, recents, deniedPermission } = f.input;
  const allowed = (p: string) => p !== deniedPermission;
  const idx = buildMenuIndex(surfaces, { favorites, recents, allowed });
  eq(idx, f.index, 'index');
  eq(buildMenuIndex(surfaces, { kinds: ['screen', 'plugin'], maxPerLevel: 8 }), f.variants.navOnly, 'nav-only variant');
  eq(buildMenuIndex(surfaces, { appOrder: ['axhub'], hiddenApps: ['console'] }).roots.map((r) => r.id), f.variants.ordered, 'ordered + hidden');
  eq(buildMenuIndex(surfaces, { maxPerLevel: 1 }).roots.map((r) => (r.kind === 'group' ? [r.id, r.children.length] : r.id)), f.variants.tinyMax, 'max clamps to 4');
  for (const c of f.fold) {
    const nodes = c.out as MenuNode[];
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const input = Array.from({ length: c.n }, (_, i) => ({ kind: 'item' as const, id: `a:screen:${i}`, label: `${letters[(i * 5) % 26]} ${i}`, app: 'a', itemKind: 'screen' }));
    eq(foldLevel(input, 6, 'p'), nodes, `fold ${c.n}`);
  }
  for (const c of f.paths) { eq(menuPath(idx, c.id), c.path, `path ${c.id}`); eq(menuNode(idx, c.id)?.label ?? null, c.node, `node ${c.id}`); }
  eq(menuItems(idx).map((n) => n.id), f.items, 'items');
  for (const c of f.search) eq(searchMenu(idx, c.q, { recents, limit: 5 }), c.hits, `search "${c.q}"`);
  eq([toggleFavorite([], 'a:screen:x'), toggleFavorite(['a:screen:x', 'a:screen:y'], 'a:screen:x'), toggleFavorite(['1', '2', '3'], '4', 3), toggleFavorite(['a'], '')], f.favorites, 'favorites');
  eq([pushRecent([], 'a'), pushRecent(['a', 'b', 'c'], 'c'), pushRecent(['a', 'b', 'c'], 'd', 3)], f.recents, 'recents');
  eq(pruneRefs(favorites, idx), f.prune, 'prune');
  for (const c of f.fit) eq(fitBar(c.widths, c.available, c.more, c.gap), c.kept, `fit ${JSON.stringify(c.widths)} in ${c.available}`);

  // properties: slim (no level over the max), every allowed item reachable once, ids unique, denied ones gone
  const max = MENU_INDEX_DEFAULTS.maxPerLevel;
  const ids = new Set<string>();
  const walk = (nodes: readonly MenuNode[], inHead: boolean) => {
    ok(nodes.length <= max, `level of ${nodes.length} ≤ ${max}`);
    for (const n of nodes) {
      if (!inHead && n.kind === 'group') { ok(!ids.has(n.id), `group id ${n.id} unique`); ids.add(n.id); }
      if (n.kind === 'group') walk(n.children, inHead || n.id === FAVORITES_ID || n.id === RECENTS_ID);
    }
  };
  walk(idx.roots, false);
  const all = (surfaces as ShellSurface[]).flatMap((s) => s.items.filter((i) => !i.requires || allowed(i.requires)).map((i) => qualify(s.app.id, i)));
  eq([...menuItems(idx).map((n) => n.id)].sort(), [...all].sort(), 'every allowed item is in the menu exactly once');
  eq(idx.total, all.length, 'total');
  ok(!menuItems(idx).some((n) => n.requires === deniedPermission), 'denied items are left out');
  for (const r of all) ok(menuPath(idx, r)?.at(-1) === r, `jump reaches ${r}`);
  ok(idx.roots[0]?.id === FAVORITES_ID && idx.roots[1]?.id === RECENTS_ID, 'Favorites then Recent first');
  // a new plugin's screen appears with no menu edit: add an item to a surface and it is in the next index
  const more = (surfaces as ShellSurface[]).map((s) => (s.app.id === 'amberx' ? { ...s, items: [...s.items, { kind: 'screen', id: 'new-plugin', label: 'New plugin' }] } : s));
  ok(menuPath(buildMenuIndex(more), 'amberx:screen:new-plugin'), 'a newly registered screen shows up by itself');
}

// ---------- xlayout@1 layout modes ----------
{
  const f = fx('xlayout-modes.json');
  eq(f.modes, LAYOUT_MODES, 'modes'); eq(f.modePreset, LAYOUT_MODE_PRESET, 'mode presets');
  ok(LAYOUT_MODES.includes('ide') && LAYOUT_MODES.length > 1, 'IDE is one mode among others');
  for (const c of f.normalize) eq(normalizeXLayout(c.raw), c.out, `normalize ${c.name}`);
  for (const c of f.errors) { eq(xlayoutErrors(c.raw), c.errors, `errors ${c.name}`); ok(c.errors.length, `errors ${c.name}: something is wrong`); }
  const base = normalizeXLayout({ apps: [{ id: 'console', label: 'Console', url: 'https://console.example' }], ide: { on: true, containers: [{ pane: 1, tabs: true }, { pane: 2 }] } });
  eq({ base: effectiveLayout(base), named: effectiveLayout(normalizeXLayout(f.normalize.find((c: { name: string }) => c.name === 'named layouts').raw)), tabsMode: effectiveLayout(normalizeXLayout({ apps: [], mode: 'tabs' })) }, f.effective, 'effective layouts');
  for (const c of f.isTabs) eq(containerIsTabs({ mode: c.mode, containers: base.ide.containers }, c.pane), c.tabs, `is tabs ${c.mode} ${c.pane}`);
  eq([setContainerTabs(base.ide.containers, 2, true), setContainerTabs(base.ide.containers, 4, true), setContainerTabs(base.ide.containers, 1, false), setContainerTabs(base.ide.containers, 0, true)], f.setTabs, 'set container tabs');
  const R = (n: string) => `console:screen:${n}`;
  let open: XOpenMap = {};
  const ops: [string, () => XOpenMap][] = [
    ['open a in 1 (tabs)', () => openInContainer(open, 1, R('a'), true)], ['open b in 1 (tabs)', () => openInContainer(open, 1, R('b'), true)], ['open a again (front)', () => openInContainer(open, 1, R('a'), true)],
    ['open c after a', () => openInContainer(open, 1, R('c'), true)], ['open d in 2 (single)', () => openInContainer(open, 2, R('d'), false)], ['open e in 2 (single replaces)', () => openInContainer(open, 2, R('e'), false)],
    ['bad ref ignored', () => openInContainer(open, 1, 'nope', true)], ['bad pane ignored', () => openInContainer(open, 13, R('x'), true)], ['move c 1 → 2 (tabs, at 0)', () => moveTab(open, 1, 2, R('c'), true, 0)],
    ['move a 1 → 3 (single)', () => moveTab(open, 1, 3, R('a'), false)], ['reorder in 2', () => moveTab(open, 2, 2, R('c'), true, 5)], ['move unknown ignored', () => moveTab(open, 1, 2, R('zz'), true)],
    ['close e', () => closeTab(open, 2, R('e'))], ['close last in 3', () => closeTab(open, 3, R('a'))],
  ];
  ops.forEach(([op, run], i) => { eq(op, f.openSteps[i].op, `step ${i} name`); open = run(); eq(open, f.openSteps[i].out, `open step: ${op}`); });
  const many = Array.from({ length: 45 }, (_, i) => R(`t${i}`)).reduce((o, r) => openInContainer(o, 1, r, true), {} as XOpenMap);
  eq(many, f.manyTabs, '40-tab cap'); ok(many['1']!.tabs.length === 40 && many['1']!.tabs[many['1']!.active] === R('t44'), 'the newest tab stays in front');
  eq([parseOpenMap({ 1: { tabs: [R('a'), 1, R('a')], active: -2 } }), parseOpenMap('x'), parseOpenMap({ x: { tabs: [R('a')] } })], f.openMap, 'open map');
  let lay = base;
  const steps: [string, () => typeof lay][] = [
    ['save review', () => saveLayout(lay, { id: 'review', label: 'Review', mode: 'split' })], ['save coding', () => saveLayout(lay, snapshotLayout(lay, 'coding', 'Coding', { 1: { tabs: [R('a')], active: 0 } }))],
    ['switch review', () => switchLayout(lay, 'review')], ['switch unknown', () => switchLayout(lay, 'nope')], ['replace review', () => saveLayout(lay, { id: 'review', label: 'Review 2', mode: 'tabs' })],
    ['remove review', () => removeLayout(lay, 'review')], ['mode tabs', () => setLayoutMode(lay, 'tabs')], ['switch default', () => switchLayout(lay, null)],
  ];
  steps.forEach(([op, run], i) => { lay = run(); eq({ op, layouts: lay.layouts.map((l) => `${l.id}:${l.mode}`), active: lay.active, mode: lay.mode }, f.layoutSteps[i], `layout step: ${op}`); });
  const overflow = Array.from({ length: 22 }, (_, i) => ({ id: `l${i}` })).reduce((d, l) => saveLayout(d, l), base);
  eq({ count: overflow.layouts.length, first: overflow.layouts[0]!.id, active: overflow.active }, f.overflow, '20-layout cap');
  // a saved layout validates and normalizes back to itself
  for (const l of lay.layouts) { const d = { apps: [], layouts: [l], active: l.id }; eq(xlayoutErrors(d), [], `saved layout ${l.id} validates`); eq(normalizeXLayout(d).layouts[0], l, `saved layout ${l.id} round trips`); }
}

console.log(`check-shell-surface: ${checks} checks passed (shell-surface@1, menu-index@1, xlayout@1 layout modes)`);
