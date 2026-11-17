/** Types for layout-core.mjs (Plan Studio 2.0 page layouts and dock state). */
export interface StudioLayout { id: string; label: string; icon: string; kind: 'nav' | 'tabs' | 'dock'; preset?: string; hint?: string }
export interface SectionInfo { id: string; label: string; icon: string }
export type DockTree = { kind: 'leaf'; pane: string } | { kind: 'split'; vertical: boolean; children: DockTree[]; weights: number[] };
export interface DockPane { tabs: string[]; active: string }
export interface Dock { tree: DockTree | null; panes: Record<string, DockPane>; closed: string[] }
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type DropZone = DockSide | 'centre' | 'header';
export interface PresetData { panes: number; tree: unknown; main?: number }

export const SECTIONS: SectionInfo[];
export const SECTION_IDS: string[];
export const DEFAULT_LAYOUT: string;
export const MIN_WEIGHT: number;
export const PANE_LIMIT: number;
export const FALLBACK_PRESET: PresetData;
export function layouts(): StudioLayout[];
export function registerLayout(l: StudioLayout): () => void;
export function resolveLayout(q: unknown): StudioLayout | null;
export function resolveSection(q: unknown): string | null;
export function paneIds(tree: DockTree | null): string[];
export function paneOf(dock: Dock, tab: string): string | null;
export function normalizeTree(tree: unknown, keep?: (id: string) => boolean): DockTree | null;
export function fromPreset(preset: PresetData | null | undefined, sections: string[]): Dock;
export function normalizeDock(dock: unknown, sections: string[]): Dock;
export function activate(dock: Dock, tab: string, sections: string[]): Dock;
export function moveTab(dock: Dock, tab: string, toPane: string, index: number | undefined, sections: string[]): Dock;
export function reorder(dock: Dock, pane: string, order: string[], sections: string[]): Dock;
export function splitWith(dock: Dock, tab: string, pane: string, side: DockSide, sections: string[]): Dock;
export function closePane(dock: Dock, pane: string, sections: string[]): Dock;
export function closeTab(dock: Dock, tab: string, sections: string[]): Dock;
export function reopen(dock: Dock, tab: string, sections: string[]): Dock;
export function resize(dock: Dock, path: number[], index: number, delta: number): Dock;
export function dropZone(x: number, y: number, inHeader: boolean, edge?: number): DropZone;
export function applyDrop(dock: Dock, tab: string, pane: string, zone: DropZone, sections: string[], index?: number): Dock;
export function runDockOp(dock: Dock, op: string, args: string[], sections: string[]): Dock;
