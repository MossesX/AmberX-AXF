/** Types for designer-doc.mjs (designer-doc@1): the document every designer edits. */
import type { MenuEntry } from './windows';
import type { DesignerAssetLike, DesignerAddon, DesignerInterfaceData } from './designer-rules.mjs';

export interface DesignerNode { id: string; kind: string; parent: string | null; children: string[]; props: Record<string, unknown>; locked?: boolean; hidden?: boolean }
export interface CanvasRect { x: number; y: number; w: number; h: number }
export interface DesignerDoc {
  $axf: 'designer-doc@1';
  type: string; id: string; name: string; addon: string;
  root: 'root';
  nodes: Record<string, DesignerNode>;
  /** the asset's root-level fields (everything the nodes don't stand for) */
  data: Record<string, unknown>;
  canvas: Record<string, CanvasRect>;
  selection: string[];
  meta: { nextId: number; revision: number; uid?: string; keyOrder?: string[] };
}
export interface NodeProp { key: string; label: string; kind: 'text' | 'icon' | 'action' | 'toggle' | 'choice' | 'number' | 'asset' | 'view' | 'binding' | 'shortcut'; required?: boolean; options?: string[]; min?: number; max?: number }
export interface Family {
  id: string; types: string[]; structure: string[];
  accepts: Record<string, string[]>; labels: Record<string, string>; props: Record<string, NodeProp[]>;
  read(data: Record<string, unknown>, add: (parent: string, kind: string, props: Record<string, unknown>) => string): void;
  write(doc: DesignerDoc, kids: (id: string) => DesignerNode[], propsOf: (n: DesignerNode) => Record<string, unknown>): Record<string, unknown>;
}
export type DropPayload =
  | { kind: 'node'; ids: string[] }
  | { kind: 'palette'; node: string; props?: Record<string, unknown> }
  | { kind: 'asset'; ref: string; label?: string }
  | { kind: 'action'; action: string; label?: string; icon?: string }
  | { kind: 'hook'; hook: { id: string; label: string; icon: string; action: string } }
  | { kind: 'embed'; ref?: string; target?: { kind: string; url?: string; id?: string } }
  | { kind: 'text'; text: string }
  | { kind: 'file'; name: string; type: string };
export type DropTarget = { node: string; position: 'before' | 'after' | 'inside' } | { canvas: { x: number; y: number } };
export interface DropCheck { ok: boolean; reason?: string; parent?: string; index?: number; as?: string }
export interface DesignerHistory { limit: number; past: { doc: DesignerDoc; label: string }[]; present: DesignerDoc; future: { doc: DesignerDoc; label: string }[]; lastLabel: string; lastAt: number }

export const DESIGNER_DOC_FRAME: 'designer-doc@1';
export const ROOT: 'root';
export const DOC_LIMITS: { nodes: number; depth: number; label: number; text: number; selection: number };
export const CANVAS_CELL: { w: number; h: number; gap: number; columns: number };
export const ALIGN_EDGES: string[];
export const DROP_POSITIONS: string[];
export const DESIGNER_KEYS: Readonly<Record<string, string>>;
export const DESIGNER_VERBS: string[];

export function registerFamily(f: Family): void;
export function familyOf(type: string): Family;
export function familyIds(): string[];
export function nodeKinds(type: string): string[];
export function acceptsKinds(type: string, kind: string): string[];
export function nodeProps(type: string, kind: string): NodeProp[];
export function nodeKindLabel(type: string, kind: string): string;
export function newDoc(opts?: { type?: string; id?: string; name?: string; addon?: string; data?: Record<string, unknown> }): DesignerDoc;
export function docFromAsset(asset: DesignerAssetLike, addon?: string): DesignerDoc;
export function assetFromDoc(doc: DesignerDoc, base?: Partial<DesignerAssetLike>): DesignerAssetLike & { data: Record<string, unknown> };
export function docErrors(doc: unknown): string[];
export function addNode(doc: DesignerDoc, parent: string, kind: string, props?: Record<string, unknown>, index?: number): { doc: DesignerDoc; id: string } | null;
export function uniqueAssetId(doc: DesignerDoc, base: string): string;
export function removeNodes(doc: DesignerDoc, ids: string[]): DesignerDoc;
export function moveNodes(doc: DesignerDoc, ids: string[], parent: string, index?: number): DesignerDoc | null;
export function setProps(doc: DesignerDoc, ids: string[], patch: Record<string, unknown>): DesignerDoc;
export function setData(doc: DesignerDoc, patch: Record<string, unknown>): DesignerDoc;
export function renameDoc(doc: DesignerDoc, name?: string, id?: string): DesignerDoc;
export function duplicate(doc: DesignerDoc, ids: string[]): { doc: DesignerDoc; ids: string[] };
export function group(doc: DesignerDoc, ids: string[], kind: string, props?: Record<string, unknown>): { doc: DesignerDoc; id: string } | null;
export function ungroup(doc: DesignerDoc, id: string): DesignerDoc | null;
export function lockNodes(doc: DesignerDoc, ids: string[], locked?: boolean): DesignerDoc;
export function hideNodes(doc: DesignerDoc, ids: string[], hidden?: boolean): DesignerDoc;
export function stepNodes(doc: DesignerDoc, ids: string[], dir: 'forward' | 'backward'): DesignerDoc;
export function select(doc: DesignerDoc, id: string, opts?: { add?: boolean; toggle?: boolean; range?: boolean }): DesignerDoc;
export function clearSelection(doc: DesignerDoc): DesignerDoc;
export function selectAll(doc: DesignerDoc, parent?: string): DesignerDoc;
export function selectKind(doc: DesignerDoc, kind: string): DesignerDoc;
export function topSelection(doc: DesignerDoc): string[];
export function selectionBounds(doc: DesignerDoc, ids?: string[]): CanvasRect | null;
export function snapTo(v: number, grid: number, on?: boolean): number;
export function place(doc: DesignerDoc, id: string, rect: Partial<CanvasRect>, ui?: DesignerInterfaceData): DesignerDoc;
export function nudge(doc: DesignerDoc, ids: string[], dx: number, dy: number, ui?: DesignerInterfaceData): DesignerDoc;
export function align(doc: DesignerDoc, ids: string[], edge: string, ui?: DesignerInterfaceData): DesignerDoc;
export function distribute(doc: DesignerDoc, ids: string[], axis?: 'x' | 'y', ui?: DesignerInterfaceData): DesignerDoc;
export function autoLayout(doc: DesignerDoc, opts?: { cell?: { w: number; h: number }; columns?: number; gap?: number; all?: boolean }): DesignerDoc;
export function zoomSteps(ui?: DesignerInterfaceData): number[];
export function zoomFit(bounds: CanvasRect | null, viewport: { w: number; h: number }, ui?: DesignerInterfaceData, pad?: number): number;
export function parseDrop(types: Record<string, string>, files?: { name: string; type?: string }[]): DropPayload | null;
export function dropNode(doc: DesignerDoc, payload: DropPayload | null, childKinds: string[]): { kind: string; props: Record<string, unknown> } | null;
export function canDrop(doc: DesignerDoc, addon: Partial<DesignerAddon> | null, payload: DropPayload | null, target: DropTarget): DropCheck;
export function applyDrop(doc: DesignerDoc, addon: Partial<DesignerAddon> | null, payload: DropPayload | null, target: DropTarget, ui?: DesignerInterfaceData): { doc: DesignerDoc; ids?: string[]; error?: string };
export function nodeDragPayload(ids: string[]): string;
export function palette(type: string, parentKind?: string): { node: string; label: string; payload: string }[];
export function createHistory(doc: DesignerDoc, limit?: number): DesignerHistory;
export function commit(h: DesignerHistory, doc: DesignerDoc, opts?: { label?: string; at?: number; coalesceMs?: number }): DesignerHistory;
export function canUndo(h: DesignerHistory): boolean;
export function canRedo(h: DesignerHistory): boolean;
export function undo(h: DesignerHistory): DesignerHistory;
export function redo(h: DesignerHistory): DesignerHistory;
export function historyLabels(h: DesignerHistory): { undo: string; redo: string };
export function designerContextMenu(doc: DesignerDoc, addon: Partial<DesignerAddon> | null, ctx?: { node?: string; canvas?: { x: number; y: number } }, ui?: DesignerInterfaceData, opts?: { clipboard?: boolean; history?: DesignerHistory | null }): MenuEntry[];
