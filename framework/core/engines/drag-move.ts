/**
 * Drag-move engine (drag-move@1, spec/DRAG-MOVE.md; build drag-anything-by-api-and-voice, Nov 16 2026).
 *
 * One command for everything a pointer can drag (banner widgets, toolbar items, tabs, dock panes, grid columns and rows,
 * list items, layout slots): name the kind, the item, the container it leaves and the container, zone and position it
 * lands in. Pure: hosts hand in a snapshot of what they hold, the engine validates the command, resolves the drop zone to
 * an index and returns every touched container's new order. The React seam (react/dragHost.ts) and the API transports
 * build the same command and run the same apply. No DOM here; the Kotlin twin (DragMoveEngine.kt) is deferred
 * (spec/PORTING.md) and replays spec/fixtures/drag-move.json.
 */
import { DOCK_SIDES } from './dock';
import { hostSpec } from './widgets';

export const DRAG_MOVE_CONTRACT = 'drag-move@1';
export const DRAG_MOVE_PLAN_FRAME = 'drag-move-plan@1';
export const DRAG_MOVE_RESULT_FRAME = 'drag-move-result@1';
/** The action id the runtime registers: `drag-move:<json>` carries the whole command through console.actions. */
export const DRAG_MOVE_ACTION = 'drag-move';
export const DRAG_MOVE_ID_MAX = 160;

export const DRAG_OPS = ['move', 'add', 'remove'] as const;
export type DragOp = (typeof DRAG_OPS)[number];
export const DROP_ZONES = ['before', 'after', 'into', 'side'] as const;
export type DropZone = (typeof DROP_ZONES)[number];
export const DRAG_MOVE_CODES = ['invalid', 'unknown_kind', 'unknown_container', 'unknown_item', 'unknown_ref', 'invalid_zone', 'out_of_range', 'not_allowed', 'duplicate', 'limit', 'no_change', 'confirmation_required', 'failed'] as const;
export type DragMoveCode = (typeof DRAG_MOVE_CODES)[number];

export class DragMoveError extends Error {
  constructor(public readonly code: DragMoveCode, message: string, public readonly nearest?: string[]) { super(message); this.name = 'DragMoveError'; }
}

/* ================================================================== kinds (open registry) */

/** What one draggable kind is: what its ids name, the zones it offers, fixed sides, and what it allows. */
export interface DragKindSpec {
  kind: string;
  label: string;
  /** what the container id names (for docs, help and `nearest`) */
  container: string;
  /** what the item id names */
  item: string;
  zones: readonly DropZone[];
  /** fixed sides every host of the kind has (null = not sided; a host may still report its own) */
  sides: readonly string[] | null;
  add: boolean;
  remove: boolean;
  crossContainer: boolean;
  /** a remove loses something: it needs `confirm: true` */
  confirmRemove: boolean;
}

const kinds = new Map<string, DragKindSpec>();
export function registerDragKind(spec: DragKindSpec): void {
  kinds.set(spec.kind, { ...spec, zones: [...spec.zones], sides: spec.sides ? [...spec.sides] : null });
}
export function dragKind(kind: string): DragKindSpec | undefined { return kinds.get(kind); }
export function dragKinds(): DragKindSpec[] { return [...kinds.values()]; }
export function isDragKind(kind: unknown): kind is string { return typeof kind === 'string' && kinds.has(kind); }

const ALL_ZONES: readonly DropZone[] = ['before', 'after', 'into', 'side'];
const LINEAR_ZONES: readonly DropZone[] = ['before', 'after', 'into'];
const bannerSides = hostSpec('banner')?.sides ?? ['left', 'center', 'right'];
const toolbarSides = hostSpec('toolbar')?.sides ?? ['start', 'end'];

/** The eight framework kinds, in spec order (append-only). */
export const DRAG_KINDS: readonly string[] = ['banner-widget', 'toolbar-item', 'tab', 'dock-pane', 'grid-column', 'grid-row', 'list-item', 'layout-slot'];
registerDragKind({ kind: 'banner-widget', label: 'Banner widget', container: 'the banner asset id', item: 'the attachment key type:id', zones: ALL_ZONES, sides: bannerSides, add: true, remove: true, crossContainer: true, confirmRemove: false });
registerDragKind({ kind: 'toolbar-item', label: 'Toolbar item', container: 'the toolbar id', item: 'the item or widget key', zones: ALL_ZONES, sides: toolbarSides, add: true, remove: true, crossContainer: true, confirmRemove: false });
registerDragKind({ kind: 'tab', label: 'Tab', container: 'the tab row id (tab:<row>)', item: 'the tab value', zones: LINEAR_ZONES, sides: null, add: false, remove: false, crossContainer: true, confirmRemove: false });
registerDragKind({ kind: 'dock-pane', label: 'Dock pane', container: 'the dock host (window) id', item: 'the pane id', zones: ['into', 'side'], sides: DOCK_SIDES, add: false, remove: true, crossContainer: false, confirmRemove: true });
registerDragKind({ kind: 'grid-column', label: 'Grid column', container: 'the grid id', item: 'the column id', zones: LINEAR_ZONES, sides: null, add: true, remove: true, crossContainer: false, confirmRemove: false });
registerDragKind({ kind: 'grid-row', label: 'Grid row', container: 'the grid id', item: 'the row id', zones: LINEAR_ZONES, sides: null, add: false, remove: false, crossContainer: false, confirmRemove: false });
registerDragKind({ kind: 'list-item', label: 'List item', container: 'the list id', item: 'the item id', zones: LINEAR_ZONES, sides: null, add: true, remove: true, crossContainer: true, confirmRemove: false });
registerDragKind({ kind: 'layout-slot', label: 'Layout slot', container: 'the layout region (top, left, right, bottom, main)', item: 'the slot type', zones: ALL_ZONES, sides: null, add: true, remove: true, crossContainer: true, confirmRemove: false });

/* ================================================================== command */

export interface DragSource { container?: string; id: string; type?: string }
export interface DragTarget { container: string; zone: DropZone; ref?: string; side?: string; index?: number }
export interface DragMoveCommand {
  $axf: typeof DRAG_MOVE_CONTRACT;
  op: DragOp;
  kind: string;
  source: DragSource;
  target?: DragTarget;
  confirm?: boolean;
  by?: string;
  reason?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const idOk = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= DRAG_MOVE_ID_MAX;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Every problem with a raw command, in field order; empty when it is a valid drag-move@1 command. */
export function dragMoveErrors(raw: unknown): string[] {
  const e: string[] = [];
  if (!isObj(raw)) return ['command must be an object'];
  if (raw.$axf !== undefined && raw.$axf !== DRAG_MOVE_CONTRACT) e.push(`$axf must be ${DRAG_MOVE_CONTRACT}`);
  const op = raw.op ?? 'move';
  if (!(DRAG_OPS as readonly unknown[]).includes(op)) e.push(`op must be one of ${DRAG_OPS.join(', ')}`);
  if (!idOk(raw.kind)) e.push('kind is required');
  else if (!kinds.has(raw.kind)) e.push(`unknown kind ${raw.kind}`);
  const src = raw.source;
  if (!isObj(src)) e.push('source is required');
  else {
    if (!idOk(src.id)) e.push(`source.id is required (1 to ${DRAG_MOVE_ID_MAX} characters)`);
    if (src.container !== undefined && !idOk(src.container)) e.push('source.container must be an id');
    if (src.type !== undefined && !idOk(src.type)) e.push('source.type must be an id');
    if ((op === 'move' || op === 'remove') && src.container === undefined) e.push(`source.container is required for ${op}`);
  }
  const tgt = raw.target;
  if (op === 'remove') { if (tgt !== undefined) e.push('remove takes no target'); }
  else if (!isObj(tgt)) e.push(`target is required for ${op}`);
  else {
    if (!idOk(tgt.container)) e.push('target.container is required');
    if (tgt.zone !== undefined && !(DROP_ZONES as readonly unknown[]).includes(tgt.zone)) e.push(`target.zone must be one of ${DROP_ZONES.join(', ')}`);
    if (tgt.ref !== undefined && !idOk(tgt.ref)) e.push('target.ref must be an id');
    if (tgt.side !== undefined && !idOk(tgt.side)) e.push('target.side must be a side name');
    if (tgt.index !== undefined && !(Number.isInteger(tgt.index))) e.push('target.index must be an integer');
    const zone = tgt.zone ?? (tgt.ref !== undefined ? 'after' : tgt.side !== undefined ? 'side' : 'into');
    if ((zone === 'before' || zone === 'after') && tgt.ref === undefined) e.push(`zone ${zone} needs target.ref`);
    if ((zone === 'into' || zone === 'side') && tgt.ref !== undefined) e.push(`zone ${zone} takes no target.ref`);
    if (zone === 'side' && tgt.side === undefined) e.push('zone side needs target.side');
    if (zone !== 'side' && tgt.side !== undefined) e.push(`zone ${zone} takes no target.side`);
  }
  if (raw.confirm !== undefined && typeof raw.confirm !== 'boolean') e.push('confirm must be a boolean');
  if (raw.by !== undefined && typeof raw.by !== 'string') e.push('by must be a string');
  if (raw.reason !== undefined && typeof raw.reason !== 'string') e.push('reason must be a string');
  return e;
}

/** A clean command (defaults filled: `$axf`, `op`, `target.zone`), or a `DragMoveError` (`invalid`, `unknown_kind`). */
export function normalizeDragMove(raw: unknown): DragMoveCommand {
  const errors = dragMoveErrors(raw);
  if (errors.length) {
    const r = isObj(raw) ? raw : {};
    const code: DragMoveCode = idOk(r.kind) && !kinds.has(r.kind) && errors.length === 1 ? 'unknown_kind' : 'invalid';
    throw new DragMoveError(code, errors.join('; '), code === 'unknown_kind' ? [...kinds.keys()] : undefined);
  }
  const r = raw as Record<string, unknown>;
  const src = r.source as Record<string, unknown>;
  const out: DragMoveCommand = { $axf: DRAG_MOVE_CONTRACT, op: (r.op as DragOp) ?? 'move', kind: r.kind as string, source: { id: src.id as string } };
  if (src.container !== undefined) out.source.container = src.container as string;
  if (src.type !== undefined) out.source.type = src.type as string;
  if (isObj(r.target)) {
    const t = r.target;
    const zone = (t.zone as DropZone | undefined) ?? (t.ref !== undefined ? 'after' : t.side !== undefined ? 'side' : 'into');
    out.target = { container: t.container as string, zone };
    if (t.ref !== undefined) out.target.ref = t.ref as string;
    if (t.side !== undefined) out.target.side = t.side as string;
    if (t.index !== undefined) out.target.index = t.index as number;
  }
  if (r.confirm !== undefined) out.confirm = r.confirm as boolean;
  if (r.by !== undefined) out.by = r.by as string;
  if (r.reason !== undefined) out.reason = r.reason as string;
  return out;
}

/* ================================================================== snapshots and plans */

export interface DragItemSnapshot { id: string; side?: string; type?: string; label?: string; locked?: boolean }
export interface DragHostSnapshot {
  kind: string;
  container: string;
  label?: string;
  /** a sided host: every item carries its side; order is per side */
  sides?: string[];
  items: DragItemSnapshot[];
  /** tighter than the kind, never looser */
  accepts?: { add?: boolean; remove?: boolean; from?: string[] | '*' };
  /** most items it holds (null / absent = no limit) */
  max?: number | null;
}

export type ContainerOrder = string[] | Record<string, string[]>;
export interface DragPosition { container: string; side?: string; index: number }
export interface DragPlan {
  $axf: typeof DRAG_MOVE_PLAN_FRAME;
  op: DragOp;
  kind: string;
  item: { id: string; type?: string };
  from: DragPosition | null;
  to: DragPosition | null;
  /** every touched container's whole new order (per side on a sided host) */
  order: Record<string, ContainerOrder>;
}

/** The host's order as the engine reads it: id lists per side (sided) or one list. */
export function orderOf(snap: DragHostSnapshot): ContainerOrder {
  if (snap.sides && snap.sides.length) {
    const out: Record<string, string[]> = Object.fromEntries(snap.sides.map((s) => [s, []]));
    for (const it of snap.items) { const side = it.side && out[it.side] ? it.side : snap.sides[0]!; out[side]!.push(it.id); }
    return out;
  }
  return snap.items.map((it) => it.id);
}

/** The host's items in a new order (a host that keeps objects applies the plan with this). Unknown ids are skipped; ids left out are dropped. */
export function applyOrder(snap: DragHostSnapshot, order: ContainerOrder, added?: DragItemSnapshot): DragItemSnapshot[] {
  const byId = new Map(snap.items.map((it) => [it.id.toLowerCase(), it]));
  if (added) byId.set(added.id.toLowerCase(), added);
  const pick = (id: string, side?: string) => { const it = byId.get(id.toLowerCase()); return it ? (side ? { ...it, side } : it) : null; };
  if (Array.isArray(order)) return order.map((id) => pick(id)).filter((x): x is DragItemSnapshot => !!x);
  return Object.entries(order).flatMap(([side, ids]) => ids.map((id) => pick(id, side)).filter((x): x is DragItemSnapshot => !!x));
}

const findId = (list: readonly string[], id: string) => list.findIndex((x) => same(x, id));
const sameOrder = (a: ContainerOrder, b: ContainerOrder) => JSON.stringify(a) === JSON.stringify(b);

function sideLists(snap: DragHostSnapshot): { sided: boolean; lists: Record<string, string[]> } {
  const o = orderOf(snap);
  return Array.isArray(o) ? { sided: false, lists: { '': o } } : { sided: true, lists: o };
}

/**
 * Resolve a command against the hosts' snapshots: where the item leaves, where it lands (zone → index, counted after it
 * has left a same-container list) and every touched container's new order. Throws `DragMoveError` with the code.
 */
export function planDragMove(raw: unknown, snapshots: readonly DragHostSnapshot[]): DragPlan {
  const cmd = normalizeDragMove(raw);
  const spec = kinds.get(cmd.kind)!;
  const ofKind = snapshots.filter((s) => s.kind === cmd.kind);
  const nearest = () => ofKind.map((s) => s.container);
  const host = (container: string) => {
    const h = ofKind.find((s) => same(s.container, container));
    if (!h) throw new DragMoveError('unknown_container', `no ${spec.label.toLowerCase()} host ${container}`, nearest());
    return h;
  };
  const order: Record<string, ContainerOrder> = {};
  const item: DragPlan['item'] = { id: cmd.source.id };
  if (cmd.source.type) item.type = cmd.source.type;

  // ---- where it comes from
  let from: DragPosition | null = null;
  let src: DragHostSnapshot | null = null;
  let srcLists: Record<string, string[]> = {};
  let srcSided = false;
  if (cmd.op !== 'add') {
    src = host(cmd.source.container!);
    ({ sided: srcSided, lists: srcLists } = sideLists(src));
    const side = Object.keys(srcLists).find((s) => findId(srcLists[s]!, cmd.source.id) >= 0);
    if (side === undefined) throw new DragMoveError('unknown_item', `${cmd.source.id} is not in ${src.container}`, Object.values(srcLists).flat());
    const idx = findId(srcLists[side]!, cmd.source.id);
    item.id = srcLists[side]![idx]!;
    const snapItem = src.items.find((it) => same(it.id, item.id));
    if (snapItem?.type && !item.type) item.type = snapItem.type;
    if (snapItem?.locked) throw new DragMoveError('not_allowed', `${item.id} is locked in ${src.container}`);
    from = srcSided ? { container: src.container, side, index: idx } : { container: src.container, index: idx };
    srcLists = { ...srcLists, [side]: srcLists[side]!.filter((_, i) => i !== idx) };
  }

  // ---- remove
  if (cmd.op === 'remove') {
    if (!spec.remove || src!.accepts?.remove === false) throw new DragMoveError('not_allowed', `${spec.label.toLowerCase()}s cannot be removed from ${src!.container}`);
    if (spec.confirmRemove && cmd.confirm !== true) throw new DragMoveError('confirmation_required', `removing ${item.id} closes it; send confirm: true`);
    order[src!.container] = srcSided ? srcLists : srcLists['']!;
    return { $axf: DRAG_MOVE_PLAN_FRAME, op: cmd.op, kind: cmd.kind, item, from, to: null, order };
  }

  // ---- where it lands
  const tgt = cmd.target!;
  const dst = host(tgt.container);
  const crossing = !src || !same(src.container, dst.container);
  if (cmd.op === 'add') {
    if (!spec.add || dst.accepts?.add === false) throw new DragMoveError('not_allowed', `${spec.label.toLowerCase()}s cannot be added to ${dst.container}`);
  } else if (crossing) {
    if (!spec.crossContainer) throw new DragMoveError('not_allowed', `a ${spec.label.toLowerCase()} cannot move between containers`);
    const fromOk = dst.accepts?.from === undefined || dst.accepts.from === '*' || dst.accepts.from.some((f) => same(f, src!.container));
    if (!fromOk) throw new DragMoveError('not_allowed', `${dst.container} does not take items from ${src!.container}`);
  }
  const { sided: dstSided, lists: dstLists0 } = crossing ? sideLists(dst) : { sided: srcSided, lists: srcLists };
  const dstLists: Record<string, string[]> = Object.fromEntries(Object.entries(dstLists0).map(([s, l]) => [s, [...l]]));
  if (!spec.zones.includes(tgt.zone)) throw new DragMoveError('invalid_zone', `${spec.label.toLowerCase()}s take ${spec.zones.join(', ')}, not ${tgt.zone}`);
  if (tgt.zone === 'side') {
    if (!dstSided) throw new DragMoveError('invalid_zone', `${dst.container} has no sides`);
    if (!Object.keys(dstLists).some((s) => same(s, tgt.side!))) throw new DragMoveError('invalid_zone', `${dst.container} has sides ${Object.keys(dstLists).join(', ')}, not ${tgt.side}`, Object.keys(dstLists));
  }
  if (crossing && Object.values(dstLists).flat().some((id) => same(id, item.id))) throw new DragMoveError('duplicate', `${item.id} is already in ${dst.container}`);
  if (crossing && dst.max != null && Object.values(dstLists).flat().length >= dst.max) throw new DragMoveError('limit', `${dst.container} is full (${dst.max})`);

  let side: string;
  let index: number;
  if (tgt.zone === 'side') {
    side = Object.keys(dstLists).find((s) => same(s, tgt.side!))!;
    index = tgt.index ?? dstLists[side]!.length;
  } else if (tgt.zone === 'into') {
    side = dstSided ? (from && !crossing ? from.side! : Object.keys(dstLists)[0]!) : '';
    index = tgt.index ?? dstLists[side]!.length;
  } else {
    const refSide = Object.keys(dstLists).find((s) => findId(dstLists[s]!, tgt.ref!) >= 0);
    if (refSide === undefined) throw new DragMoveError('unknown_ref', `${tgt.ref} is not in ${dst.container}`, Object.values(dstLists).flat());
    side = refSide;
    index = findId(dstLists[side]!, tgt.ref!) + (tgt.zone === 'after' ? 1 : 0);
  }
  const len = dstLists[side]!.length;
  if (index < 0 || index > len) throw new DragMoveError('out_of_range', `index ${index} is outside 0..${len} in ${dst.container}${side ? ` (${side})` : ''}`);
  dstLists[side]!.splice(index, 0, item.id);
  const to: DragPosition = dstSided ? { container: dst.container, side, index } : { container: dst.container, index };

  if (crossing && src) order[src.container] = srcSided ? srcLists : srcLists['']!;
  order[dst.container] = dstSided ? dstLists : dstLists['']!;
  const unchanged = Object.entries(order).every(([c, o]) => { const h = host(c); return sameOrder(o, orderOf(h)); });
  if (unchanged) throw new DragMoveError('no_change', `${item.id} already sits there`);
  return { $axf: DRAG_MOVE_PLAN_FRAME, op: cmd.op, kind: cmd.kind, item, from, to, order };
}

/* ================================================================== pointer maths */

export interface DropRect { x: number; y: number; width: number; height: number }
/** The half of the item under the pointer: `before` in the first half (left / top), else `after`. The same rule on every port. */
export function pointerZone(rect: DropRect, px: number, py: number, vertical = false): 'before' | 'after' {
  return vertical ? (py < rect.y + rect.height / 2 ? 'before' : 'after') : (px < rect.x + rect.width / 2 ? 'before' : 'after');
}
/** The target a pointer drop over item `overId` builds, ready for `planDragMove`. */
export function pointerDrop(container: string, overId: string, rect: DropRect, px: number, py: number, vertical = false): DragTarget {
  return { container, zone: pointerZone(rect, px, py, vertical), ref: overId };
}

/* ================================================================== envelopes */

export interface DragMoveResultOk { $axf: typeof DRAG_MOVE_RESULT_FRAME; ok: true; op: DragOp; kind: string; item: DragPlan['item']; from: DragPosition | null; to: DragPosition | null; order: Record<string, ContainerOrder>; by?: string }
export interface DragMoveResultFail { $axf: typeof DRAG_MOVE_RESULT_FRAME; ok: false; code: DragMoveCode; message: string; nearest?: string[] }
export type DragMoveResult = DragMoveResultOk | DragMoveResultFail;

export function dragMoveResult(cmd: DragMoveCommand, plan: DragPlan): DragMoveResultOk {
  const out: DragMoveResultOk = { $axf: DRAG_MOVE_RESULT_FRAME, ok: true, op: plan.op, kind: plan.kind, item: plan.item, from: plan.from, to: plan.to, order: plan.order };
  if (cmd.by) out.by = cmd.by;
  return out;
}
export function dragMoveFailure(err: unknown): DragMoveResultFail {
  if (err instanceof DragMoveError) return { $axf: DRAG_MOVE_RESULT_FRAME, ok: false, code: err.code, message: err.message, ...(err.nearest ? { nearest: err.nearest } : {}) };
  return { $axf: DRAG_MOVE_RESULT_FRAME, ok: false, code: 'failed', message: err instanceof Error ? err.message : String(err) };
}

/* ================================================================== hosts at run time */

/** One container of one kind, live: it reports what it holds and writes a plan. `apply` may be async. */
export interface DragHost {
  kind: string;
  container: string;
  list(): DragHostSnapshot;
  apply(plan: DragPlan): unknown | Promise<unknown>;
}

/** The open registry of live hosts (`rt.drag.hosts`): the API and the pointer run the same command through `run`. */
export class DragHostRegistry {
  private readonly hosts = new Map<string, DragHost>();
  private readonly subs = new Set<() => void>();
  private key(kind: string, container: string) { return `${kind}\u0000${container.toLowerCase()}`; }
  register(host: DragHost): () => void {
    const k = this.key(host.kind, host.container);
    this.hosts.set(k, host);
    this.emit();
    return () => { if (this.hosts.get(k) === host) { this.hosts.delete(k); this.emit(); } };
  }
  host(kind: string, container: string): DragHost | undefined { return this.hosts.get(this.key(kind, container)); }
  snapshot(kind: string, container: string): DragHostSnapshot | null { return this.host(kind, container)?.list() ?? null; }
  snapshots(kind?: string): DragHostSnapshot[] { return [...this.hosts.values()].filter((h) => !kind || h.kind === kind).map((h) => h.list()); }
  /** Every live host's kind + container (what `nearest` and a list call answer). */
  containers(kind?: string): { kind: string; container: string; label?: string; count: number }[] {
    return [...this.hosts.values()].filter((h) => !kind || h.kind === kind).map((h) => { const s = h.list(); return { kind: h.kind, container: h.container, ...(s.label ? { label: s.label } : {}), count: s.items.length }; });
  }
  /** Plan without applying (what a dry run or a preview reads). */
  plan(raw: unknown): DragPlan {
    const kind = isObj(raw) && typeof raw.kind === 'string' ? raw.kind : undefined;
    return planDragMove(raw, this.snapshots(kind));
  }
  /** Normalize, plan, then every touched host applies, in order. Never throws: failures come back as the envelope. */
  async run(raw: unknown): Promise<DragMoveResult> {
    let cmd: DragMoveCommand;
    let plan: DragPlan;
    try { cmd = normalizeDragMove(raw); plan = planDragMove(cmd, this.snapshots(cmd.kind)); } catch (e) { return dragMoveFailure(e); }
    try {
      for (const container of Object.keys(plan.order)) { const h = this.host(plan.kind, container); if (h) await h.apply(plan); }
    } catch (e) { return dragMoveFailure(e); }
    return dragMoveResult(cmd, plan);
  }
  /** Run from the action argument (`drag-move:<json>`). */
  run_text(text: string): Promise<DragMoveResult> {
    try { return this.run(JSON.parse(text)); } catch (e) { return Promise.resolve(dragMoveFailure(new DragMoveError('invalid', `not JSON: ${e instanceof Error ? e.message : String(e)}`))); }
  }
  subscribe(fn: () => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  private emit() { for (const fn of this.subs) fn(); }
}

/* ================================================================== schema + snapshot */

/** JSON Schema of the command, for `axf schemas`, the MCP tool and the REST route. */
export const DRAG_MOVE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://axf.amberxai.com/schemas/drag-move.schema.json',
  title: 'drag-move@1 command',
  type: 'object',
  required: ['kind', 'source'],
  additionalProperties: false,
  properties: {
    $axf: { const: DRAG_MOVE_CONTRACT },
    op: { enum: [...DRAG_OPS], default: 'move' },
    kind: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX, description: 'a registered draggable kind (DRAG_KINDS, open registry)' },
    source: { type: 'object', required: ['id'], additionalProperties: false, properties: { container: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX }, id: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX }, type: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX } } },
    target: { type: 'object', required: ['container'], additionalProperties: false, properties: { container: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX }, zone: { enum: [...DROP_ZONES] }, ref: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX }, side: { type: 'string', minLength: 1, maxLength: DRAG_MOVE_ID_MAX }, index: { type: 'integer', minimum: 0 } } },
    confirm: { type: 'boolean' },
    by: { type: 'string' },
    reason: { type: 'string' },
  },
} as const;

/** The snapshot `framework/schemas/drag-move.json` holds (check-drag-move.mts keeps it equal). */
export function dragMoveSnapshot() {
  return {
    $axf: DRAG_MOVE_CONTRACT,
    planFrame: DRAG_MOVE_PLAN_FRAME,
    resultFrame: DRAG_MOVE_RESULT_FRAME,
    action: DRAG_MOVE_ACTION,
    idMax: DRAG_MOVE_ID_MAX,
    ops: [...DRAG_OPS],
    zones: [...DROP_ZONES],
    codes: [...DRAG_MOVE_CODES],
    kinds: DRAG_KINDS.map((k) => kinds.get(k)!),
    schema: DRAG_MOVE_SCHEMA,
  };
}
