/**
 * drag-move@1 hosts (spec/DRAG-MOVE.md): for every host kind, a move sent by API (a drag-move@1 command through
 * rt.drag.hosts, what REST / MCP / the CLI / voice send) gives the same result as the simulated pointer drop the UI made
 * before the build (its own splice / engine call), and add / remove reach the same write the UI's buttons make.
 *
 *   npx -y tsx framework/spec/check-drag-hosts.mts
 *
 * Covers the adapters that need no UI framework (core/engines/drag-hosts.ts): banner and toolbar widgets (reorder,
 * across sides, with hidden widgets, add, remove), TabGroup rows (the old onDrop splice), window tab stacks and dock
 * panes (WindowManager.dropTab, the pointer's call), layout regions (show / hide), DataGrid columns and rows
 * (nextColumnOrder / rowDropOf) and sortable lists (the Build manager's old drop). The React wrappers only forward to these.
 */
import { DragHostRegistry, pointerDrop, type DragHostSnapshot, type DragPlan } from '../core/engines/drag-move';
import { fullSideIndex, installLayoutSlotHosts, installWindowDragHosts, nextColumnOrder, orderColumns, rowDropOf, uniqueItemIds, entryOfItemId, widgetHostAdapter } from '../core/engines/drag-hosts';
import { moveOnHost, hostSpec, type PlacedAttachment, type HostArrangement } from '../core/engines/widgets';
import { WindowManager } from '../core/engines/windows';
import { dragVoiceIntent, dragVoiceScore, looksLikeDrag } from '../core/engines/drag-voice.mjs';

let checks = 0;
const fails: string[] = [];
const eq = (what: string, a: unknown, b: unknown) => { checks++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${what}\n    api:     ${JSON.stringify(a)}\n    pointer: ${JSON.stringify(b)}`); };
const ok = (what: string, cond: unknown) => { checks++; if (!cond) fails.push(what); };

/* ------------------------------------------------------------ widget hosts (banner / toolbar), Arrange.tsx */

function widgetRt(host: string, sides: string[], start: Record<string, string[]>, hidden: string[] = []) {
  let arrange: HostArrangement = {};
  const hide = new Set(hidden);
  const all = () => {
    // placeOnHost's rule in short: arrangement first, else the start order
    const out: Record<string, PlacedAttachment[]> = Object.fromEntries(sides.map((s) => [s, []]));
    const keys = sides.flatMap((s) => (start[s] ?? []).map((k, i) => ({ k, s, o: i * 10 })));
    for (const { k, s, o } of keys) { const a = arrange[k]; out[a?.at ?? s]!.push({ key: k, type: k.split(':')[0]!, id: k.split(':')[1]!, at: a?.at ?? s, order: a?.order ?? o, origin: 'asset' }); }
    for (const s of sides) out[s]!.sort((x, y) => x.order - y.order || (x.key < y.key ? -1 : 1));
    return out;
  };
  const drawn = () => Object.fromEntries(Object.entries(all()).map(([s, l]) => [s, l.filter((p) => !hide.has(p.key))]));
  const rt = {
    hostPlaced: () => all(),
    moveHostItem: (_h: string, key: string, side: string, index: number) => { arrange = moveOnHost(all(), arrange, key, side, index, sides); return true; },
    bannerWidgets: () => sides.flatMap((s) => (start[s] ?? [])).map((key) => ({ key, label: key.split(':')[1]!, attached: true, shown: !hide.has(key), aliases: [] as string[] })),
    setBannerWidget: (key: string, patch: { hidden?: boolean }) => { if (patch.hidden) hide.add(key); else hide.delete(key); return true; },
  };
  const order = () => Object.fromEntries(Object.entries(drawn()).map(([s, l]) => [s, l.map((p) => p.key)]));
  const allOrder = () => Object.fromEntries(Object.entries(all()).map(([s, l]) => [s, l.map((p) => p.key)]));
  return { rt, drawn, order, allOrder, reset: () => { arrange = {}; } };
}

for (const host of ['banner', 'toolbar']) {
  const kind = host === 'banner' ? 'banner-widget' : 'toolbar-item';
  const sides = hostSpec(host)?.sides ?? [];
  ok(`${host}: widget host registered with sides`, sides.length >= 2);
  const start = Object.fromEntries(sides.map((s, i) => [s, [`clock:${s}a`, `badge:${s}b`, `badge:${s}c`].slice(0, 3 - (i % 2))]));
  const keys = sides.flatMap((s) => start[s]!);
  // every widget to every side and index: API (registry + adapter) = pointer (rt.moveHostItem with the drop index)
  for (const key of keys) for (const side of sides) for (let index = 0; index <= start[side]!.filter((k) => k !== key).length; index++) {
    const api = widgetRt(host, sides, start);
    const ptr = widgetRt(host, sides, start);
    const reg = new DragHostRegistry();
    reg.register({ kind, container: host, ...widgetHostAdapter(api.rt as never, host, api.drawn), list: () => ({ kind, container: host, ...widgetHostAdapter(api.rt as never, host, api.drawn).list() }) });
    const before = JSON.stringify(api.order());
    const r = await reg.run({ kind, source: { container: host, id: key }, target: { container: host, zone: 'side', side, index }, by: 'pointer' });
    const lists = ptr.order() as Record<string, string[]>;
    const len = lists[side]!.filter((k) => k !== key).length;
    ptr.rt.moveHostItem(host, key, side, Math.min(index, len));
    if (!r.ok && r.code === 'no_change') eq(`${host}: ${key} → ${side} #${index} (no change)`, before, JSON.stringify(ptr.order()));
    else { ok(`${host}: ${key} → ${side} #${index} ran (${r.ok ? 'ok' : `${r.code} ${r.message}`})`, r.ok); eq(`${host}: ${key} → ${side} #${index}`, api.order(), ptr.order()); }
  }
}

// banner with a hidden widget: the drawn order is what the API sees; the hidden one keeps its place
{
  const sides = hostSpec('banner')!.sides;
  const start = { [sides[0]!]: ['clock:a', 'badge:hidden', 'badge:b', 'badge:c'] } as Record<string, string[]>;
  const w = widgetRt('banner', sides, start, ['badge:hidden']);
  const reg = new DragHostRegistry();
  const ad = widgetHostAdapter(w.rt as never, 'banner', w.drawn);
  reg.register({ kind: 'banner-widget', container: 'banner', apply: ad.apply, list: () => ({ kind: 'banner-widget', container: 'banner', ...ad.list() }) });
  const r = await reg.run({ kind: 'banner-widget', source: { container: 'banner', id: 'badge:c' }, target: { container: 'banner', zone: 'before', ref: 'badge:b' } });
  ok('banner hidden: move ran', r.ok);
  eq('banner hidden: drawn order (c before b)', w.order()[sides[0]!], ['clock:a', 'badge:c', 'badge:b']);
  eq('banner hidden: the hidden widget stays right after clock', w.allOrder()[sides[0]!], ['clock:a', 'badge:hidden', 'badge:c', 'badge:b']);
  // remove = hide (the banner widget engine), add = show and place
  const rm = await reg.run({ op: 'remove', kind: 'banner-widget', source: { container: 'banner', id: 'clock:a' } });
  ok('banner remove ran', rm.ok);
  eq('banner remove hides it', w.order()[sides[0]!], ['badge:c', 'badge:b']);
  const add = await reg.run({ op: 'add', kind: 'banner-widget', source: { id: 'badge:hidden' }, target: { container: 'banner', zone: 'side', side: sides[sides.length - 1]!, index: 0 } });
  ok(`banner add ran (${add.ok ? '' : add.message})`, add.ok);
  eq('banner add shows it first on the last side', (w.order() as Record<string, string[]>)[sides[sides.length - 1]!]![0], 'badge:hidden');
  eq('fullSideIndex: after the last drawn', fullSideIndex(['a', 'h', 'b'], ['a', 'b', 'x'], 'x'), 3);
  eq('fullSideIndex: before the next drawn', fullSideIndex(['a', 'h', 'b'], ['x', 'a', 'b'], 'x'), 0);
}

/* ------------------------------------------------------------ TabGroup rows (the onDrop splice before this build) */

function oldTabDrop(order: string[], from: number, i: number, after: boolean): string[] {
  const o = [...order]; const [moved] = o.splice(from, 1); let at = i + (after ? 1 : 0); if (from < at) at--; o.splice(at, 0, moved!); return o;
}
{
  const tabs = ['general', 'appearance', 'plugins', 'keys', 'about'];
  for (let from = 0; from < tabs.length; from++) for (let i = 0; i < tabs.length; i++) for (const after of [false, true]) {
    if (from === i) continue;
    let current = [...tabs];
    const reg = new DragHostRegistry();
    reg.register({ kind: 'tab', container: 'settings.tabs', list: () => ({ kind: 'tab', container: 'settings.tabs', items: current.map((id) => ({ id })), accepts: { from: [] } }), apply: (p: DragPlan) => { current = p.order['settings.tabs'] as string[]; } });
    // the pointer's maths, as the row runs it now (pointerDrop builds the same target)
    const rect = { x: i * 100, y: 0, width: 100, height: 30 };
    const t = pointerDrop('settings.tabs', tabs[i]!, rect, rect.x + (after ? 80 : 20), 10);
    const r = await reg.run({ kind: 'tab', source: { container: 'settings.tabs', id: tabs[from]! }, target: t, by: 'pointer' });
    const want = oldTabDrop(tabs, from, i, after);
    if (!r.ok) eq(`tab ${from}→${i}${after ? ' after' : ''} no change`, r.code === 'no_change' && want.join() === tabs.join(), true);
    else eq(`tab ${tabs[from]} → ${after ? 'after' : 'before'} ${tabs[i]}`, current, want);
  }
}

/* ------------------------------------------------------------ window tab stacks and dock panes (dropTab = the pointer's call) */

function windowRt() {
  const wm = new WindowManager();
  const rt = { windows: wm, drag: { hosts: new DragHostRegistry() } };
  installWindowDragHosts(rt as never);
  return { wm, rt };
}
/** Tabs per stack, stacks in reading order (group ids carry a per-manager suffix, so they are left out). */
const tabsOf = (wm: WindowManager) => Object.values(wm.state.groups).map((g) => g.tabs.map((t) => t.id)).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
const shape = (wm: WindowManager) => JSON.stringify(wm.state.layouts.main).replace(/group-[\w-]+/g, 'g');
{
  const mk = () => {
    const w = windowRt();
    const g1 = w.wm.openGroup([{ id: 't1', title: 'One', kind: 'x' }, { id: 't2', title: 'Two', kind: 'x' }, { id: 't3', title: 'Three', kind: 'x' }] as never);
    const g2 = w.wm.splitGroup(g1, 'right', [{ id: 't4', title: 'Four', kind: 'x' }] as never)!;
    return { ...w, g1, g2 };
  };
  // reorder inside a stack: API index (after the tab leaves) = pointer header index (before it leaves)
  for (const [tab, to] of [['t1', 2], ['t3', 0], ['t2', 0], ['t1', 1]] as const) {
    const a = mk(); const p = mk();
    const r = await a.rt.drag.hosts.run({ kind: 'tab', source: { container: a.g1, id: tab }, target: { container: a.g1, zone: 'into', index: to } });
    const cur = p.wm.state.groups[p.g1]!.tabs.findIndex((t) => t.id === tab);
    p.wm.dropTab(tab, 'main', { target: 'group', groupId: p.g1, zone: 'header', index: to >= cur ? to + 1 : to });
    ok(`stack: ${tab} → #${to} ran (${r.ok ? '' : r.message})`, r.ok);
    eq(`stack: ${tab} → #${to}`, tabsOf(a.wm), tabsOf(p.wm));
  }
  // across stacks
  {
    const a = mk(); const p = mk();
    const r = await a.rt.drag.hosts.run({ kind: 'tab', source: { container: a.g1, id: 't2' }, target: { container: a.g2, zone: 'before', ref: 't4' } });
    p.wm.dropTab('t2', 'main', { target: 'group', groupId: p.g2, zone: 'header', index: 0 });
    ok(`stack → stack ran (${r.ok ? '' : r.message})`, r.ok);
    eq('stack → stack', tabsOf(a.wm), tabsOf(p.wm));
  }
  // a pane to a side of another pane (split) and into a stack (join)
  {
    const a = mk(); const p = mk();
    // the first pane to the bottom of the second (a split that changes the reading order; see the report for the
    // engine's no_change on a split that keeps it)
    const r = await a.rt.drag.hosts.run({ kind: 'dock-pane', source: { container: 'main', id: a.g1 }, target: { container: 'main', zone: 'side', side: 'bottom', ref: a.g2 } });
    for (const t of ['t1', 't2', 't3']) p.wm.dropTab(t, 'main', t === 't1' ? { target: 'group', groupId: p.g2, zone: 'bottom' } : { target: 'group', groupId: p.wm.groupOf('t1')!, zone: 'centre' });
    ok(`pane split ran (${r.ok ? '' : r.message})`, r.ok);
    eq('pane split: same tabs per stack', tabsOf(a.wm), tabsOf(p.wm));
    eq('pane split: same tree shape', shape(a.wm), shape(p.wm));
  }
  {
    const a = mk(); const p = mk();
    const r = await a.rt.drag.hosts.run({ kind: 'dock-pane', source: { container: 'main', id: a.g2 }, target: { container: 'main', zone: 'into', index: 0 } });
    p.wm.dropTab('t4', 'main', { target: 'group', groupId: p.g1, zone: 'centre' });
    ok(`pane join ran (${r.ok ? '' : r.message})`, r.ok);
    eq('pane join', tabsOf(a.wm), tabsOf(p.wm));
    const c = mk();
    const closed = await c.rt.drag.hosts.run({ op: 'remove', kind: 'dock-pane', source: { container: 'main', id: c.g1 } });
    eq('pane close needs confirm', closed.ok ? 'ok' : closed.code, 'confirmation_required');
  }
}

/* ------------------------------------------------------------ layout regions (show / hide = the View menu's setSlotHidden) */
{
  const hidden = new Set<string>();
  const rt = { drag: { hosts: new DragHostRegistry() }, assetOrNull: () => ({ data: { slots: { toolbar: ['toolbar'], status: ['status-bar'] } } }), slotHidden: (t: string) => hidden.has(t), setSlotHidden: (t: string, h: boolean) => { if (h) hidden.add(t); else hidden.delete(t); } };
  installLayoutSlotHosts(rt as never);
  const r = await rt.drag.hosts.run({ op: 'remove', kind: 'layout-slot', source: { container: 'toolbar', id: 'toolbar' } });
  ok(`slot hide ran (${r.ok ? '' : r.message})`, r.ok);
  eq('slot hide = setSlotHidden(true)', hidden.has('toolbar'), true);
  const a = await rt.drag.hosts.run({ op: 'add', kind: 'layout-slot', source: { id: 'toolbar' }, target: { container: 'toolbar', zone: 'into' } });
  ok(`slot show ran (${a.ok ? '' : a.message})`, a.ok);
  eq('slot show = setSlotHidden(false)', hidden.has('toolbar'), false);
  const m = await rt.drag.hosts.run({ kind: 'layout-slot', source: { container: 'status', id: 'status-bar' }, target: { container: 'status', zone: 'into', index: 0 } });
  ok(`slot move never runs (the layout asset decides): ${m.ok ? 'ok' : m.code}`, !m.ok);
}

/* ------------------------------------------------------------ DataGrid columns and rows */
{
  const all = ['title', 'state', 'model', 'cost', 'hidden1'];
  const shown = ['title', 'state', 'model', 'cost'];
  const reg = new DragHostRegistry();
  let order = [...all];
  reg.register({ kind: 'grid-column', container: 'queue', list: () => ({ kind: 'grid-column', container: 'queue', items: orderColumns(all.map((id) => ({ id })), order).filter((c) => shown.includes(c.id)).map((c) => ({ id: c.id, ...(c.id === 'title' ? { locked: true } : {}) })) }), apply: (p) => { order = nextColumnOrder(p, 'queue', order) ?? order; } });
  const r = await reg.run({ kind: 'grid-column', source: { container: 'queue', id: 'MODEL' }, target: { container: 'queue', zone: 'into', index: 1 } });
  ok(`column move ran (${r.ok ? '' : r.message})`, r.ok);
  eq('column move keeps the grid spelling and the hidden column', order, ['title', 'model', 'state', 'cost', 'hidden1']);
  eq('orderColumns puts unnamed columns after, as declared', orderColumns(all.map((id) => ({ id })), ['cost']).map((c) => c.id), ['cost', 'title', 'state', 'model', 'hidden1']);
  const locked = await reg.run({ kind: 'grid-column', source: { container: 'queue', id: 'title' }, target: { container: 'queue', zone: 'into' } });
  eq('a fixed column does not move', locked.ok ? 'ok' : locked.code, 'not_allowed');
  // rows: the grid's onMove target (rowDropOf) = what the pointer drop passed
  const rows = ['r1', 'r2', 'r3', 'r4'];
  for (const [id, ref, zone] of [['r1', 'r3', 'after'], ['r4', 'r1', 'before'], ['r2', 'r4', 'after']] as const) {
    const plan = new DragHostRegistry();
    plan.register({ kind: 'grid-row', container: 'g', list: () => ({ kind: 'grid-row', container: 'g', items: rows.map((x) => ({ id: x })) }), apply: () => undefined });
    const p = plan.plan({ kind: 'grid-row', source: { container: 'g', id }, target: { container: 'g', zone, ref } });
    const d = rowDropOf(p, 'g')!;
    // replaying the grid's own move with that target gives the plan's order
    const o = rows.filter((x) => x !== id); o.splice(o.indexOf(d.id) + (d.pos === 'after' ? 1 : 0), 0, id);
    eq(`row ${id} ${zone} ${ref}`, o, p.order.g);
  }
}

/* ------------------------------------------------------------ sortable lists (Build manager's drop before this build) and toolbar ids */
{
  const ids = ['s1', 's2', 's3', 's4', 's5'];
  for (const drag of ids) for (const target of ids) {
    if (drag === target) continue;
    const old = ids.filter((x) => x !== drag); old.splice(old.indexOf(target), 0, drag);
    let got: string[] = [];
    const reg = new DragHostRegistry();
    reg.register({ kind: 'list-item', container: 'build-manager.queue', list: () => ({ kind: 'list-item', container: 'build-manager.queue', items: ids.map((id) => ({ id })) }), apply: (p) => { got = p.order['build-manager.queue'] as string[]; } });
    const r = await reg.run({ kind: 'list-item', source: { container: 'build-manager.queue', id: drag }, target: { container: 'build-manager.queue', zone: 'before', ref: target } });
    if (r.ok) eq(`list ${drag} before ${target}`, got, old); else eq(`list ${drag} before ${target} no change`, r.code === 'no_change' && old.join() === ids.join(), true);
  }
  eq('uniqueItemIds', uniqueItemIds(['a', '|', 'b', '|', '|']), ['a', '|', 'b', '|~2', '|~3']);
  eq('entryOfItemId', ['|~3', 'a', 'x~y'].map(entryOfItemId), ['|', 'a', 'x~y']);
}

/* ------------------------------------------------------------ voice (core/engines/drag-voice.mjs) */
eq('voice: clock to the left of the banner', dragVoiceIntent('move the clock widget to the left of the banner'), { op: 'move', what: 'clock', kind: 'banner-widget', where: { at: 'side', side: 'left', host: 'banner-widget' } });
eq('voice: Logs tab first', dragVoiceIntent('Amber, drag the Logs tab first'), { op: 'move', what: 'logs', kind: 'tab', where: { at: 'first' } });
eq('voice: remove the CPU widget', dragVoiceIntent('remove the CPU widget'), { op: 'remove', what: 'cpu', kind: 'banner-widget', where: null });
eq('voice: before a named item', dragVoiceIntent('move the Logs tab before the Status tab')?.where, { at: 'before', ref: 'status' });
eq('voice: "show step 3 of x" stays console-control', dragVoiceIntent('show step 3 of skins'), null);
ok('voice: lead verbs', looksLikeDrag('put the search bar on the right') && !looksLikeDrag('scroll down'));
eq('voice: scores', [dragVoiceScore('clock', { id: 'clock:main', label: 'Clock' }), dragVoiceScore('cpu', { id: 'badge:cpu-load' }), dragVoiceScore('xyz', { id: 'a' })], [3, 2, 0]);

const _unused: DragHostSnapshot | null = null; void _unused;
if (fails.length) {
  console.error(`✗ drag hosts — ${fails.length} of ${checks} checks failed:\n  ${fails.slice(0, 30).join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ drag hosts — ${checks} checks: an API move equals the pointer's on banner / toolbar widgets, tab rows, window tab stacks, dock panes, layout regions, grid columns and rows, sortable lists`);
