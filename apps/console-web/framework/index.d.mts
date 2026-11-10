/**
 * Types for apps/console-web/framework/index.mjs (inline-edit-tokens@1 + inline-override@1 + the capture layer), so
 * TypeScript code in the console (the inline-edit plugin) can import the plain ESM under `strict`. Only the members
 * TypeScript callers use are typed in detail; the source of truth stays the .mjs files and their tests.
 */
export type ElementRole = 'root' | 'group' | 'item' | 'text' | 'icon' | 'badge' | 'separator' | 'part';
export interface ParsedPath { root: { kind: string; instance: string }; rootText: string; segments: { name: string; id?: string }[]; parts: string[] }
export interface ElementAddress { path: string; root: { kind: string; instance: string }; rootText: string; segments: { name: string; id?: string; role: string; text: string }[]; role: string; element: Element; owners: Element[]; own: boolean }

export const INLINE_EDIT_FRAME: string;
export const EL_ROOT_ATTR: string;
export const EL_ATTR: string;
export const ELEMENT_ROOTS: Record<string, { classes: string[]; instance: string[]; fallback: string; type: string; label: string }>;
export const ELEMENT_ROOT_KINDS: string[];
export function encodeId(id: string): string;
export function decodeId(s: string): string;
export function rootOf(el: Element): { kind: string; instance: string } | null;
export function addressOf(el: Element): ElementAddress | null;
export function pathOf(el: Element): string | null;
export function parsePath(path: string): ParsedPath | null;
export function isPath(path: unknown): boolean;
export function rootTextOf(path: string): string | null;
export function chainOf(path: string): string[];
export function parentOf(path: string): string | null;
export function isWithin(path: string, ancestor: string): boolean;
export function roleOfPath(path: string): ElementRole | null;
export function typeOfKind(kind: string): string | null;
export function labelOfSegment(seg: { name: string; id?: string }, kind: string): string;

export const LAYERS: string[];
export const LAYER_WHERE: Record<string, string>;
export function rootKinds(): { kind: string; label: string; type: string }[];

export const INLINE_EDIT_MODE_KEY: string;
export const INLINE_EDIT_OPEN_EVENT: string;
export const INLINE_EDIT_IGNORE_ATTR: string;
export interface InlineEditOpenDetail { $axf: string; path: string; chain: string[]; root: string; role: string; element: Element; owners: Element[]; target: Element; own: boolean; x: number; y: number }
export interface InlineEditCapture { readonly enabled: boolean; enable(): void; disable(): void; handle(ev: MouseEvent): boolean }
export function createInlineEditCapture(opts: { doc?: Document; onOpen?: (detail: InlineEditOpenDetail) => void; emit?: boolean }): InlineEditCapture;
export function inlineEditModeOn(value: unknown): boolean;
export function bindInlineEditMode(capture: InlineEditCapture, settings: { get(key: string): unknown; onChange?(key: string, fn: () => void): () => void; subscribe?(fn: () => void): () => void }): () => void;
export function hitTest(doc: Document, ev: MouseEvent): Omit<InlineEditOpenDetail, '$axf'> | null;

export interface InlineOverrideRecord { $axf: string; id: string; root: string; key: string; path: string; scope: 'item' | 'parent'; token: string; asset: string | null; value: string | number | boolean | null; axHubValue: string | number | boolean | null; by: string; at: string; reason: string; migratedFrom: string | null }
export function recordId(path: string, scope: string, token: string, asset?: string): string;
export function parseRecordId(id: string): { path: string; scope: 'item' | 'parent'; token: string; asset: string | null } | null;
export function inlineLayer(records: InlineOverrideRecord[], path: string, activeAsset?: string): Record<string, InlineOverrideRecord>;
export function inlineUnder(records: InlineOverrideRecord[], path: string): InlineOverrideRecord[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveElementTokens(path: string, sources: any): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolvePath(path: string, sources: any): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOverridesStore(opts: any): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSettings(init?: any): any;
