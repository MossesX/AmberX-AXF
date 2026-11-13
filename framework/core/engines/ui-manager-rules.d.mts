/** Types for ui-manager-rules.mjs (ui-element@1, ui-catalog@1, ui-overrides@1, ui-change@1). */
export type Scalar = string | number | boolean;
export type Json = Scalar | null | Json[] | { [k: string]: Json };

export interface UiElement {
  $axf: 'ui-element@1'; id: string; label: string; kind: string; category: string;
  assetType?: string; address?: string; selector?: string; plugin?: string; app?: string; screen?: string; tokens: string[];
}
/** An "On screen now" entry: a shortcut to the element with that id. */
export interface UiShortcut { ref: string; label: string; kind: string; category: string }
export interface Category { id: string; label: string; icon: string; live?: boolean }
export interface TreeCategory extends Category { items: (UiElement | UiShortcut)[] }

export interface TypeSpec { label?: string; group?: string; icon?: string; required?: string[]; enums?: Record<string, string[]>; nested?: Record<string, string[]>; optional_fields?: Record<string, string>; [k: string]: unknown }
export interface CatalogAsset { id: string; name: string; data: Record<string, Json> }
export interface TokenPath { id: string; kind: 'color' | 'number' | 'enum' | 'boolean' | 'string'; token?: string; unit?: string; default?: Scalar; min?: number; max?: number; step?: number; options?: string[] }
export interface UiCatalog { $axf?: 'ui-catalog@1'; types: Record<string, TypeSpec>; assets: Record<string, CatalogAsset[]>; active: Record<string, string>; paths: Record<string, TokenPath[]>; skin?: string }

export type ChoiceKind = 'bool' | 'range' | 'enum' | 'asset' | 'token';
export interface Option { value: Scalar; label: string; token?: string; swatch?: string }
export interface Prop {
  id: string; label: string; group: 'Element' | 'Asset' | 'Properties' | 'Tokens'; kind: ChoiceKind; options: Option[]; default: Scalar; source: 'asset' | 'default';
  assetType?: string; path?: string; target?: string; token?: string; min?: number; max?: number; step?: number; unit?: string;
}
export interface PropRow extends Prop { value: Scalar; base: Scalar; overridden: boolean; source: 'override' | 'skin' | 'asset' | 'default' }
export type Validation = { ok: true; value: Scalar } | { ok: false; error: string; options: Option[] };

export interface Overrides { $axf: 'ui-overrides@1'; elements: Record<string, Record<string, Scalar>>; updatedAt?: string; updatedBy?: string }
export interface Change { element: string; prop: string; from?: Scalar; to?: Scalar }
export interface ChangeEntry { $axf: 'ui-change@1'; id: string; by: string; at: string; note?: string; changes: Change[]; undone: boolean; undoes?: string }
export interface SummaryLine { element: string; elementLabel: string; prop: string; propLabel: string; from: string; to: string }
export interface PreviewPlan { css: string; swaps: { element: string; type: string; id: string }[]; patches: { element: string; type?: string; target?: string; path: string; value: Scalar }[] }

export const ELEMENT_FRAME: 'ui-element@1';
export const OVERRIDES_FRAME: 'ui-overrides@1';
export const CHANGE_FRAME: 'ui-change@1';
export const CATALOG_FRAME: 'ui-catalog@1';
export const OVERRIDES_MAX_BYTES: number;
export const RANGE_OPTIONS_MAX: number;
export const TOKEN_REF: '@';
export const ON_SCREEN: 'on-screen';
export const CATEGORIES: Category[];
export const CATEGORY_IDS: string[];
export const TOKEN_TARGETS: Record<string, string>;
export const ELEMENT_ID: RegExp;
export function slug(v: unknown): string;
export function hash(s: string): string;

export function categoryOf(kind: string, types?: Record<string, TypeSpec>, declared?: string): string;
export function normalizeElement(raw: unknown, types?: Record<string, TypeSpec>): UiElement | null;
export function frameworkElements(catalog: UiCatalog): UiElement[];
export function elementsFromManifest(manifest: unknown, types?: Record<string, TypeSpec>): UiElement[];
export function elementsFromTargets(snapshot: unknown, types?: Record<string, TypeSpec>): UiElement[];
export function resolveElement(idOrRef: string | { ref?: string; id?: string }, elements: UiElement[]): UiElement | null;
export function elementTree(elements: UiElement[], visibleIds?: string[]): TreeCategory[];
export function filterElements(elements: UiElement[], q: string): UiElement[];

export function getAt(data: unknown, path: string): Json | undefined;
export function activeId(catalog: UiCatalog, type: string): string;
export function activeData(catalog: UiCatalog, type: string): Record<string, Json> | null;
export function propsOf(element: UiElement, catalog: UiCatalog): Prop[];
export function validateValue(prop: Prop, value: unknown): Validation;

export function normalizeOverrides(raw: unknown): Overrides;
export function withOverride(raw: unknown, element: UiElement | string, prop: Prop, value: unknown, meta?: { by?: string; at?: string }): { doc: Overrides; value: Scalar } | { error: string; options?: Option[] };
export function withoutOverride(raw: unknown, element?: UiElement | string, propId?: string): Overrides;
export function propertyRows(element: UiElement, raw: unknown, catalog: UiCatalog): PropRow[];
export function overrideCount(raw: unknown, elementId?: string): number;

export function selectorOf(e: UiElement): string;
export function previewPlan(elements: UiElement[], raw: unknown, catalog: UiCatalog): PreviewPlan;

export function diffOverrides(beforeRaw: unknown, afterRaw: unknown): Change[];
export function changeEntry(changes: Change[], meta?: { by?: string; at?: string; note?: string }): ChangeEntry;
export function undoChange(raw: unknown, entry: ChangeEntry): Overrides;
export function summarize(changes: Change[], elements: UiElement[], catalog: UiCatalog): SummaryLine[];
