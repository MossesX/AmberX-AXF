/**
 * Drag hosts on the web (drag-move@1, spec/DRAG-MOVE.md; build drag-anything-by-api-and-voice, Nov 16 2026).
 *
 * The runtime seam: a UI piece that can be dragged (a tab row, the banner's widgets, a toolbar's items, a grid, a list)
 * registers itself as a *host* of one kind with `useDraggableHost`, handing the runtime two callbacks — `list()` (what
 * it holds, in order) and `apply(plan)` (write the new order). From then on a move can run without a pointer: the API,
 * MCP, the CLI and AmberX send the same drag-move@1 command the pointer drop builds, and `rt.drag.hosts.run` validates
 * it against the live hosts (core/engines/drag-move.ts) and calls the touched hosts' `apply`.
 *
 *   useDraggableHost('tab', id, { list: () => ({ items: tabs.map((t) => ({ id: t.value, label: t.label })) }), apply: (p) => onReorder(p.order[id]) });
 *
 * `installDragHosts(rt)` (AxfProvider) registers the action `drag-move:<json>` on the ActionBus, so every transport that
 * already carries console actions (console.actions run, console_action, `axf console action`, voice) reaches it today.
 */
import { useEffect, useRef } from 'react';
import type { AxfRuntime } from '../core';
import { DRAG_MOVE_ACTION, DRAG_MOVE_CONTRACT, dragMoveFailure, isDragKind, pointerDrop, type DragHostSnapshot, type DragMoveCommand, type DragMoveResult, type DragPlan, type DropRect, type DropZone } from '../core/engines/drag-move';
import { hostSpec, type PlacedAttachment } from '../core/engines/widgets';
import { paneGroups } from '../core/engines/windows';
import type { DockSide } from '../core/engines/dock';
import { SLOT_REGIONS, compileSlots } from '../core/engines/layout';
import { hideable } from '../core/engines/hide';
import type { AssetType, LayoutData } from '../core/types';
import { useRuntime } from './AxfProvider';

/** What a host hands the hook: the snapshot without `kind` / `container` (the hook fills them) and the apply. */
export interface DraggableHostOptions {
  list: () => Omit<DragHostSnapshot, 'kind' | 'container'>;
  apply: (plan: DragPlan) => unknown | Promise<unknown>;
  /** false keeps the host off the registry (a row that cannot be reordered); default true */
  enabled?: boolean;
}

/**
 * Register this component as the live host of `kind` / `container` while it is mounted. The callbacks are read through
 * a ref, so the latest render's `tabs` / `onReorder` are what the API sees without re-registering on every render.
 */
export function useDraggableHost(kind: string, container: string, opts: DraggableHostOptions): void {
  const rt = useRuntime();
  const ref = useRef(opts);
  ref.current = opts;
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (!enabled || !container) return;
    return rt.drag.hosts.register({
      kind, container,
      list: () => ({ ...ref.current.list(), kind, container }),
      apply: (plan) => ref.current.apply(plan),
    });
  }, [rt, kind, container, enabled]);
}

/**
 * Register a varying set of hosts of one kind (a workspace's toolbars, every column header of several grids): one host
 * per container id, re-registered when the set of ids changes. `make(container)` is read through a ref like the hook's.
 */
export function useDraggableHostSet(kind: string, containers: readonly string[], make: (container: string) => DraggableHostOptions): void {
  const rt = useRuntime();
  const ref = useRef(make);
  ref.current = make;
  const ids = containers.join('\u0000');
  useEffect(() => {
    const offs = (ids ? ids.split('\u0000') : []).filter(Boolean).map((container) => rt.drag.hosts.register({
      kind, container,
      list: () => ({ ...ref.current(container).list(), kind, container }),
      apply: (plan) => ref.current(container).apply(plan),
    }));
    return () => offs.forEach((off) => off());
  }, [rt, kind, ids]);
}

/**
 * Item ids for a list whose entries may repeat (a toolbar's separators, the same command twice): the entry itself, the
 * second and later copies `entry~2`, `entry~3`. `entryOfItemId` strips the suffix back off.
 */
export function uniqueItemIds(entries: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => { const n = (seen.get(e) ?? 0) + 1; seen.set(e, n); return n === 1 ? e : `${e}~${n}`; });
}
export function entryOfItemId(id: string): string { return id.replace(/~\d+$/, ''); }

/** What a sortable list hands `useSortableListHost`: its items in order and how it writes a new order (and, optionally, takes items in or out). */
export interface SortableListHost {
  label?: string;
  items: readonly { id: string; label?: string; locked?: boolean }[];
  /** the new order of the whole list (ids); arrivals from another list are in it, departures are not */
  onReorder: (ids: string[], plan: DragPlan) => unknown;
  /** lists that may hand this one an item (container ids); default none */
  acceptsFrom?: readonly string[] | '*';
  add?: boolean;
  remove?: boolean;
  max?: number | null;
  enabled?: boolean;
}

/**
 * Any sortable list (a queue, a board column, a library shelf) as a `list-item` host in one line: the same command the
 * pointer drop sends reorders it by API. A cross-list move calls both lists' onReorder with their new orders.
 *
 *   useSortableListHost('build-queue', { items: rows.map((r) => ({ id: r.id, label: r.title })), onReorder: (ids) => saveOrder(ids) });
 */
export function useSortableListHost(listId: string, host: SortableListHost): void {
  useDraggableHost('list-item', listId, {
    enabled: host.enabled,
    list: () => ({ label: host.label ?? listId, items: host.items.map((i) => ({ id: i.id, ...(i.label ? { label: i.label } : {}), ...(i.locked ? { locked: true } : {}) })), accepts: { add: !!host.add, remove: !!host.remove, from: host.acceptsFrom === '*' ? '*' : [...(host.acceptsFrom ?? [])] }, ...(host.max !== undefined ? { max: host.max } : {}) }),
    apply: (plan) => { const next = Object.entries(plan.order).find(([c]) => c.toLowerCase() === listId.toLowerCase())?.[1]; if (Array.isArray(next)) return host.onReorder(next, plan); },
  });
}

/** The command a pointer drop builds: `source` leaves `container`, lands `zone` of `ref` (or at `index` on `side`). */
export function dragCommand(kind: string, container: string, sourceId: string, target: { container?: string; zone?: DropZone; ref?: string; side?: string; index?: number }, by = 'pointer'): DragMoveCommand {
  const t: DragMoveCommand['target'] = { container: target.container ?? container, zone: target.zone ?? (target.ref !== undefined ? 'after' : target.side !== undefined ? 'side' : 'into') };
  if (target.ref !== undefined) t.ref = target.ref;
  if (target.side !== undefined) t.side = target.side;
  if (target.index !== undefined) t.index = target.index;
  return { $axf: DRAG_MOVE_CONTRACT, op: 'move', kind, source: { container, id: sourceId }, target: t, by };
}

/** Run a command through the live hosts (the one path the pointer and the API share). Never throws. */
export function runDragMove(rt: AxfRuntime, cmd: unknown): Promise<DragMoveResult> {
  return rt.drag.hosts.run(cmd);
}

/** A pointer drop of `sourceId` over `overId` (whose box is `rect`): before / after by the pointer's half, then run. */
export function runPointerDrop(rt: AxfRuntime, kind: string, container: string, sourceId: string, overId: string, rect: DropRect, px: number, py: number, vertical = false): Promise<DragMoveResult> {
  return runDragMove(rt, dragCommand(kind, container, sourceId, pointerDrop(container, overId, rect, px, py, vertical)));
}

/** The drag-move kind of a widget host type (widgets engine hosts: `banner` → `banner-widget`, `toolbar` → `toolbar-item`); null when none is registered. */
export function dragKindOfHost(host: string): string | null {
  const kind = ({ banner: 'banner-widget', toolbar: 'toolbar-item' } as Record<string, string>)[host] ?? `${host}-item`;
  return isDragKind(kind) ? kind : null;
}

/**
 * Where `key` lands in the host's *full* side list (hidden widgets included, what rt.moveHostItem counts) given the new
 * order of the side as drawn: right before the next drawn item, else right after the previous one, else last. Pure.
 */
export function fullSideIndex(all: readonly string[], drawn: readonly string[], key: string): number {
  const rest = all.filter((k) => k !== key);
  const i = drawn.indexOf(key);
  const next = i >= 0 ? drawn.slice(i + 1).find((k) => rest.includes(k)) : undefined;
  if (next !== undefined) return rest.indexOf(next);
  const prev = i > 0 ? [...drawn.slice(0, i)].reverse().find((k) => rest.includes(k)) : undefined;
  return prev !== undefined ? rest.indexOf(prev) + 1 : rest.length;
}

/**
 * The list / apply pair of a widget host (widgets engine: banner, toolbar, any host a library registers). Items are the
 * attachments as drawn, per side. A move goes through rt.moveHostItem (the arrangement setting), the same write the
 * pointer and the arrow keys make. The banner also adds and removes: add shows a widget the banner knows (the banner
 * widget engine's `hidden` choice) and places it, remove hides it; a widget is never deleted, so add brings it back.
 */
export function widgetHostAdapter(rt: AxfRuntime, host: string, placed: () => Record<string, PlacedAttachment[]>): Pick<DraggableHostOptions, 'list' | 'apply'> {
  const isBanner = host === 'banner';
  const sides = () => hostSpec(host)?.sides ?? [];
  const place = (key: string, plan: DragPlan) => {
    const to = plan.to!;
    const side = to.side ?? sides()[0]!;
    const order = plan.order[host];
    const drawn = (order && !Array.isArray(order) ? order[side] ?? [] : []).map((k) => (k.toLowerCase() === key.toLowerCase() ? key : k));
    const all = (rt.hostPlaced(host)[side] ?? []).map((p) => p.key);
    if (!rt.moveHostItem(host, key, side, fullSideIndex(all, drawn, key))) throw new Error(`${host}: ${key} could not move (no arrange permission, or it is not attached)`);
  };
  return {
    list: () => {
      const p = placed();
      const ss = sides();
      return {
        label: isBanner ? 'Banner' : host === 'toolbar' ? 'Toolbar' : host, sides: [...ss],
        items: ss.flatMap((s) => (p[s] ?? []).map((a) => ({ id: a.key, side: s, type: a.type, ...(isBanner ? { label: rt.bannerWidgets().find((w) => w.key === a.key)?.label ?? a.id } : {}) }))),
        accepts: { add: isBanner, remove: isBanner },
      };
    },
    apply: (plan) => {
      const key = plan.item.id;
      if (plan.op === 'remove') {
        if (!isBanner || !rt.setBannerWidget(key, { hidden: true })) throw new Error(`${host}: ${key} could not be removed`);
        return;
      }
      if (plan.op === 'add') {
        const w = isBanner ? rt.bannerWidgets().find((x) => x.key.toLowerCase() === key.toLowerCase()) : undefined;
        if (!w) throw new Error(`${host}: no widget "${key}" to add (${rt.bannerWidgets().filter((x) => !x.shown).map((x) => x.key).join(', ') || 'every widget is on the banner'})`);
        if (!w.attached) throw new Error(`${host}: ${w.key} is not attached right now (its plugin is off)`);
        if (!rt.setBannerWidget(w.key, { hidden: false })) throw new Error(`${host}: ${w.key} could not be shown`);
        place(w.key, plan);
        return;
      }
      place(key, plan);
    },
  };
}

/**
 * The window engine's tab stacks and panes as drag hosts (dock@1 through the same engine call a pointer drop makes,
 * WindowManager.dropTab → applyDockDrop):
 *  - every tab stack (window group) is a `tab` host (container = the group id): reorder, or move a tab to another stack;
 *  - every window with a pane tree is a `dock-pane` host (container = the window id, items = its panes in reading
 *    order): `side` splits the pane named by `ref` (or the whole tree without one) and moves the pane's tabs there;
 *    `into` joins the pane at `index` of the list without the moved pane (the tabs join that stack); remove closes the
 *    pane's tabs (confirm). Registered once per runtime (installDragHosts) and kept in step with the window state.
 */
export function installWindowDragHosts(rt: AxfRuntime): () => void {
  const wm = rt.windows;
  const offs = new Map<string, () => void>();
  const tabs = (gid: string) => wm.state.groups[gid]?.tabs ?? [];
  const groupIds = () => Object.keys(wm.state.groups);
  const tabHost = (gid: string) => rt.drag.hosts.register({
    kind: 'tab', container: gid,
    list: () => ({ kind: 'tab', container: gid, label: `Tab stack ${gid}`, items: tabs(gid).map((t) => ({ id: t.id, label: t.title })), accepts: { from: groupIds() } }),
    apply: (plan) => {
      const to = plan.to; if (!to || to.container.toLowerCase() !== gid.toLowerCase()) return; // the target stack places it
      const g = wm.state.groups[gid]; if (!g) throw new Error(`tab stack ${gid} is gone`);
      const cur = g.tabs.findIndex((t) => t.id === plan.item.id);
      // applyDockDrop counts a header index before the tab leaves its own stack; the plan counts after
      const index = cur >= 0 && to.index >= cur ? to.index + 1 : to.index;
      if (!wm.dropTab(plan.item.id, g.windowId, { target: 'group', groupId: g.id, zone: 'header', index })) throw new Error(`${plan.item.id} could not move to ${gid}`);
    },
  });
  const panesOf = (wid: string) => { const l = wm.state.layouts[wid]; return l ? paneGroups(l) : []; };
  const moveAll = (wid: string, from: string, first: Parameters<typeof wm.dropTab>[2]) => {
    const ids = tabs(from).map((t) => t.id);
    if (!ids.length || !wm.dropTab(ids[0]!, wid, first)) throw new Error(`pane ${from} could not move`);
    const into = wm.groupOf(ids[0]!);
    for (const id of ids.slice(1)) if (into) wm.dropTab(id, wid, { target: 'group', groupId: into, zone: 'centre' });
  };
  const paneHost = (wid: string) => rt.drag.hosts.register({
    kind: 'dock-pane', container: wid,
    list: () => ({ kind: 'dock-pane', container: wid, label: wm.state.windows.find((w) => w.id === wid)?.title ?? wid, items: panesOf(wid).map((gid) => ({ id: gid, label: tabs(gid).map((t) => t.title).join(', ') || gid })) }),
    apply: (plan) => {
      const gid = plan.item.id;
      if (plan.op === 'remove') { for (const t of [...tabs(gid)]) wm.closeTab(t.id); return; }
      const to = plan.to!;
      if (to.side) return moveAll(wid, gid, to.ref ? { target: 'group', groupId: to.ref, zone: to.side as DockSide } : { target: 'root', zone: to.side as DockSide });
      const others = panesOf(wid).filter((x) => x !== gid);
      const join = others[Math.min(to.index, others.length - 1)];
      if (!join) throw new Error(`no other pane in ${wid} to join`);
      moveAll(wid, gid, { target: 'group', groupId: join, zone: 'centre' });
    },
  });
  const sync = () => {
    const want = new Set([...groupIds().map((g) => `tab\u0000${g}`), ...Object.keys(wm.state.layouts).map((w) => `dock-pane\u0000${w}`)]);
    for (const [k, off] of offs) if (!want.has(k)) { off(); offs.delete(k); }
    for (const k of want) if (!offs.has(k)) { const [kind, id] = k.split('\u0000') as [string, string]; offs.set(k, kind === 'tab' ? tabHost(id) : paneHost(id)); }
  };
  sync();
  const unsub = wm.subscribe(sync);
  return () => { unsub(); for (const off of offs.values()) off(); offs.clear(); };
}

/**
 * The layout's regions as `layout-slot` hosts (container = the region: menubar, toolbar, nav, main, inspector, status,
 * fab, sheet, overlay; items = the slot types drawn there). Add shows a hidden slot (rt.setSlotHidden), remove hides
 * one; both obey the hide rules and the UAC gate like the View menu. Which region holds a slot type is the layout
 * asset's (`data.slots`), so a move answers `failed` and names the way: edit the layout.
 */
export function installLayoutSlotHosts(rt: AxfRuntime): () => void {
  const slots = () => compileSlots((rt.assetOrNull('layout')?.data ?? {}) as LayoutData);
  const offs = SLOT_REGIONS.map((region) => rt.drag.hosts.register({
    kind: 'layout-slot', container: region,
    list: () => ({ kind: 'layout-slot', container: region, label: `${region} region`, items: slots()[region].filter((t) => !rt.slotHidden(t as AssetType)).map((t) => ({ id: t, type: t, ...(hideable(t as AssetType) ? {} : { locked: true }) })), accepts: { from: [] } }),
    apply: (plan) => {
      const type = plan.item.id as AssetType;
      if (plan.op === 'move') throw new Error(`which region holds ${type} is set by the layout asset (data.slots); edit the layout to move it`);
      if (plan.op === 'add' && !slots()[region].includes(type)) throw new Error(`the ${region} region does not take ${type} (${slots()[region].join(', ') || 'nothing'})`);
      rt.setSlotHidden(type, plan.op === 'remove');
      if (rt.slotHidden(type) !== (plan.op === 'remove')) throw new Error(`${type} could not be ${plan.op === 'remove' ? 'hidden' : 'shown'} (not hideable, owned by the host app, or no permission)`);
    },
  }));
  return () => offs.forEach((off) => off());
}

/** AxfProvider: the `drag-move:<json>` action, so console.actions / console_action / the CLI / voice move things. */
export function installDragHosts(rt: AxfRuntime): () => void {
  const offWindows = installWindowDragHosts(rt);
  const offSlots = installLayoutSlotHosts(rt);
  const offAction = rt.actions.register(DRAG_MOVE_ACTION, (args) => {
    void rt.drag.hosts.run_text(args.join(':')).then((r) => {
      if (!r.ok) rt.terminal.warn('drag', `${r.code}: ${r.message}`);
      else rt.terminal.ok('drag', `${r.kind} ${r.item.id}${r.from ? ` from ${r.from.container}` : ''}${r.to ? ` → ${r.to.container}${r.to.side ? ` ${r.to.side}` : ''} #${r.to.index + 1}` : ' removed'}`);
    }).catch((e) => rt.terminal.warn('drag', dragMoveFailure(e).message));
    return true;
  }, { label: 'Move, add or remove a draggable item (drag-move@1)', params: true, module: 'axf.framework' });
  return () => { offAction(); offSlots(); offWindows(); };
}
