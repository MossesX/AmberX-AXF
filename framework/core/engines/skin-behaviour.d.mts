/** Types for skin-behaviour.mjs (skin@2 behaviour axes). */

export const SKIN_BEHAVIOUR_CONTRACT: 'skin-behaviour@1';
export const BEHAVIOUR_KINDS: readonly BehaviourKind[];
export const BEHAVIOUR_TOKEN_PREFIX: 'bhv';
export const BEHAVIOUR_KEY_PREFIX: 'axf.behaviour.';

export type BehaviourKind = 'choice' | 'switch' | 'number';
export type BehaviourValue = string | number | boolean;
/** `{ <asset type>: { <axis>: value } }` */
export type BehaviourMap = Record<string, Record<string, BehaviourValue>>;

export interface BehaviourAxis {
  name: string;
  label: string;
  kind: BehaviourKind;
  default: BehaviourValue;
  values?: string[];
  min?: number;
  max?: number;
  unit?: string;
  /** the asset field the axis layers on (unset by the skin = the asset's value) */
  field?: string;
  /** the type whose asset carries `field` (default: the type itself) */
  of?: string;
  /** asset word → axis word */
  map?: Record<string, string>;
  hint?: string;
}
export interface BehaviourRow { type: string; label: string; group: string; axes: BehaviourAxis[] }
export interface BehaviourTokenInfo {
  type: string; axis: string; label: string; kind: BehaviourKind; values: string[] | null; default: BehaviourValue;
  min: number | null; max: number | null; unit: string; field: string; of: string; token: string; attr: string; key: string;
}
export interface BehaviourCoverageRow { type: string; axes: string[]; set: string[]; missing: string[] }
export interface BehaviourDescription { type: string; label: string; picks: { axis: string; label: string; value: BehaviourValue; set: boolean; isDefault: boolean }[] }
export interface BehaviourSources { instance?: unknown; pick?: unknown; asset?: unknown }

export type TypeSpecs = Record<string, Record<string, unknown>>;
export type StyleTargets = Record<string, { root: string; item?: string; behaviour?: Record<string, unknown> }>;

export function toKebab(s: string): string;
export function checkAxis(type: string, name: string, raw: unknown): { axis: BehaviourAxis | null; errors: string[] };
export function behaviourAxes(type: string, spec: TypeSpecs, targets?: StyleTargets): Record<string, BehaviourAxis>;
export function axisOf(type: string, axis: string, spec: TypeSpecs, targets?: StyleTargets): BehaviourAxis | null;
export function behaviourDeclarationErrors(type: string, spec: TypeSpecs, targets?: StyleTargets): string[];
export function behaviourTypes(spec: TypeSpecs, targets?: StyleTargets): string[];
export function behaviourTable(spec: TypeSpecs, targets?: StyleTargets): BehaviourRow[];
export function normalizeAxisValue(axis: BehaviourAxis | undefined | null, v: unknown): BehaviourValue | undefined;
export function normalizeBehaviour(raw: unknown, spec: TypeSpecs, targets?: StyleTargets): BehaviourMap;
export function axisValuesText(axis: BehaviourAxis): string;
export function behaviourErrors(raw: unknown, spec: TypeSpecs, targets?: StyleTargets, path?: string): string[];
export function behaviourDefaults(spec: TypeSpecs, targets?: StyleTargets): BehaviourMap;
export function mergeBehaviour(...layers: (BehaviourMap | Record<string, Record<string, BehaviourValue | null>> | null | undefined)[]): BehaviourMap;
export function sameBehaviour(a: unknown, b: unknown): boolean;
export function resolveBehaviour(picked: BehaviourMap | null | undefined, spec: TypeSpecs, targets?: StyleTargets, assetField?: (type: string, field: string) => unknown): BehaviourMap;
export function behaviourValue(type: string, axis: string, spec: TypeSpecs, targets?: StyleTargets, sources?: BehaviourSources): BehaviourValue | undefined;
export function applyBehaviourToAsset<T extends object>(type: string, data: T | null | undefined, picked: BehaviourMap | null | undefined, spec: TypeSpecs, targets?: StyleTargets): T;
export function behaviourFieldsOf(ofType: string, picked: BehaviourMap | null | undefined, spec: TypeSpecs, targets?: StyleTargets): Record<string, BehaviourValue>;
export function behaviourMissing(picked: BehaviourMap | null | undefined, spec: TypeSpecs, targets?: StyleTargets): Record<string, string[]>;
export function behaviourCoverage(picked: BehaviourMap | null | undefined, spec: TypeSpecs, targets?: StyleTargets): BehaviourCoverageRow[];
export function describeBehaviour(picked: BehaviourMap | null | undefined, spec: TypeSpecs, targets?: StyleTargets): BehaviourDescription[];
export function behaviourToken(type: string, axis: string): string;
export function behaviourAttr(type: string, axis: string): string;
export function behaviourKey(type: string, axis: string): string;
export function parseBehaviourKey(key: unknown): { type: string; axis: string } | null;
export function isBehaviourKey(key: unknown): boolean;
export function behaviourFromSettings(settings: unknown, spec: TypeSpecs, targets?: StyleTargets): BehaviourMap;
export function behaviourValueText(v: BehaviourValue): string;
export function behaviourTokenVars(resolved: BehaviourMap): Record<string, string>;
export function behaviourAttrs(resolved: BehaviourMap): Record<string, string>;
export function behaviourRuntimeValues(resolved: BehaviourMap): Record<string, BehaviourValue>;
export function behaviourTokens(spec: TypeSpecs, targets?: StyleTargets): BehaviourTokenInfo[];
export function axisSchema(axis: BehaviourAxis): Record<string, unknown>;
export function behaviourSchemaProperties(spec: TypeSpecs, targets?: StyleTargets): { behaviour: Record<string, unknown> };
