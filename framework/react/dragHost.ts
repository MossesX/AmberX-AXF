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
import { DRAG_MOVE_ACTION, DRAG_MOVE_CONTRACT, dragMoveFailure, isDragKind, pointerDrop, type DragMoveCommand, type DragMoveResult, type DragPlan, type DropRect, type DropZone } from '../core/engines/drag-move';
import { installLayoutSlotHosts, installWindowDragHosts, setDragLocator, type DragHostAdapter } from '../core/engines/drag-hosts';
import { useRuntime } from './AxfProvider';

export { cssEsc, dragLocate, entryOfItemId, fullSideIndex, installLayoutSlotHosts, installWindowDragHosts, setDragLocator, uniqueItemIds, widgetHostAdapter, type DragHostAdapter } from '../core/engines/drag-hosts';

/** What a host hands the hook: the snapshot without `kind` / `container` (the hook fills them) and the apply. */
export interface DraggableHostOptions extends DragHostAdapter {
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
    const off = rt.drag.hosts.register({
      kind, container,
      list: () => ({ ...ref.current.list(), kind, container }),
      apply: (plan) => ref.current.apply(plan),
    });
    const offLoc = setDragLocator(kind, container, (id) => ref.current.locate?.(id) ?? null);
    return () => { offLoc(); off(); };
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
    const offs = (ids ? ids.split('\u0000') : []).filter(Boolean).flatMap((container) => [rt.drag.hosts.register({
      kind, container,
      list: () => ({ ...ref.current(container).list(), kind, container }),
      apply: (plan) => ref.current(container).apply(plan),
    }), setDragLocator(kind, container, (id) => ref.current(container).locate?.(id) ?? null)]);
    return () => offs.forEach((off) => off());
  }, [rt, kind, ids]);
}

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
