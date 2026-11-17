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

/** AxfProvider: the `drag-move:<json>` action, so console.actions / console_action / the CLI / voice move things. */
export function installDragHosts(rt: AxfRuntime): () => void {
  return rt.actions.register(DRAG_MOVE_ACTION, (args) => {
    void rt.drag.hosts.run_text(args.join(':')).then((r) => {
      if (!r.ok) rt.terminal.warn('drag', `${r.code}: ${r.message}`);
      else rt.terminal.ok('drag', `${r.kind} ${r.item.id}${r.from ? ` from ${r.from.container}` : ''}${r.to ? ` → ${r.to.container}${r.to.side ? ` ${r.to.side}` : ''} #${r.to.index + 1}` : ' removed'}`);
    }).catch((e) => rt.terminal.warn('drag', dragMoveFailure(e).message));
    return true;
  }, { label: 'Move, add or remove a draggable item (drag-move@1)', params: true, module: 'axf.framework' });
}
