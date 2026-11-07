/** Types for skin-coverage.mjs (skin-coverage@1). */

export const SKIN_COVERAGE_CONTRACT: 'skin-coverage@1';
export const COVERAGE_KINDS: readonly CoverageKind[];
export const PART_ELEMENTS: readonly PartElement[];
export const SKIN_SCOPE_KINDS: readonly SkinScopeKind[];
export const SKIN_SCOPE_GLOBAL: 'global';
export const SKIN_SCOPE_APP: 'app';

export type CoverageKind = 'slot' | 'parts' | 'reference' | 'bundle' | 'none';
export type PartElement = 'box' | 'text' | 'icon' | 'items';
export type SkinScopeKind = 'global' | 'app' | 'ui' | 'plugin';

/** One place in an app: the app, a UI / screen in it, a plugin in it. */
export interface SkinScope { app: string; ui: string; plugin: string }
/** One level's skin state: on with a skin, off, or inherit from the parent level. */
export interface SkinScopeState { use: 'on' | 'off' | 'inherit'; id: string; overrides: Record<string, string> }
export interface ResolvedSkin { id: string; overrides: Record<string, string>; from: string }

export interface CoverageRow {
  type: string;
  label: string;
  group: string;
  by: CoverageKind | 'uncovered';
  /** other ways the skin also reaches it (a slot type with a style target: ['parts']) */
  also: CoverageKind[];
  /** the elements its style parts reach (composite assets) */
  elements: PartElement[];
  declared: boolean;
  via: string;
  why: string;
}
export interface CoverageSummary { total: number; uncovered: number; slot: number; parts: number; reference: number; bundle: number; none: number }

export type TypeSpecs = Record<string, Record<string, unknown>>;
export type StyleTargets = Record<string, { root: string; item?: string }>;

export function normalizeSkinScope(raw: unknown): SkinScope;
export function skinScopeKey(scope: Partial<SkinScope> | null | undefined): string;
export function skinScopeKind(key: string): SkinScopeKind;
export function isSubScopeKey(key: unknown): key is string;
export function skinScopeChain(scope: Partial<SkinScope> | null | undefined): string[];
export function skinScopeOf(key: string, app?: string): SkinScope;
export function skinScopeSelector(key: string): string;
export function resolveSkinChain(chain: readonly string[], stateOf: (key: string) => Partial<SkinScopeState> | null | undefined): ResolvedSkin;

export function declaredCoverage(typeSpec: unknown): { by: CoverageKind | ''; via: string; why: string } | null;
export function declarationErrors(type: string, typeSpec: unknown): string[];
export function partElements(target: unknown): PartElement[];
export function coverageOf(type: string, spec: TypeSpecs, targets?: StyleTargets, never?: readonly string[]): CoverageRow;
export function coverageTable(spec: TypeSpecs, targets?: StyleTargets, never?: readonly string[]): CoverageRow[];
export function uncoveredTypes(spec: TypeSpecs, targets?: StyleTargets, never?: readonly string[]): CoverageRow[];
export function coverageSummary(rows: readonly CoverageRow[]): CoverageSummary;
export function partsTypes(spec: TypeSpecs, targets?: StyleTargets): string[];
export function partsErrors(parts: unknown, spec: TypeSpecs, targets?: StyleTargets): string[];
