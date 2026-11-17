// Types for instance-look-rules.mjs (instance-look@1; shared by the TS engine, both validators, the schema writer, the CLI and gen-fixtures).
export type InstanceLookKind = 'tab-group' | 'grid';
export type InstanceLookKeyId = 'rowBg' | 'rowAltBg' | 'textSize' | 'spacing' | 'borderW' | 'borderColor' | 'radius' | 'hoverBg' | 'selectedBg' | 'selectedFg';
export type InstanceLookValueKind = 'colour' | 'text' | 'space' | 'border' | 'radius';
/** A look record: key → stored value (a colour-theme token name, `transparent`, or a step word). */
export type InstanceLook = Partial<Record<InstanceLookKeyId, string>>;
export interface InstanceLookKeySpec { key: InstanceLookKeyId; kind: InstanceLookValueKind; label: string; description: string; transparent?: boolean }
/** The instance-look asset's data: a named look a skin or an app ships for a kind. */
export interface InstanceLookData { kind: InstanceLookKind; look: InstanceLook; for?: string[] }

export const INSTANCE_LOOK_CONTRACT: 'instance-look@1';
export const INSTANCE_LOOK_TYPE: 'instance-look';
export const INSTANCE_LOOK_KINDS: InstanceLookKind[];
export const INSTANCE_LOOK_KIND_LABELS: Record<InstanceLookKind, string>;
export const INSTANCE_LOOK_VAR_PREFIX: '--fx-inst-';
export const TEXT_STEPS: string[];
export const SPACE_STEPS: string[];
export const BORDER_STEPS: string[];
export const RADIUS_STEPS: string[];
export const INSTANCE_LOOK_VALUE_KINDS: InstanceLookValueKind[];
export const INSTANCE_LOOK_KEYS: InstanceLookKeySpec[];
export const INSTANCE_LOOK_KEY_IDS: InstanceLookKeyId[];
export const INSTANCE_LOOK_BINDINGS: Record<InstanceLookKind, Record<InstanceLookKeyId, string[]>>;
export function instanceLookKey(key: string): InstanceLookKeySpec | null;
export function isInstanceLookKind(kind: unknown): kind is InstanceLookKind;
export function isInstanceLookId(id: unknown): id is string;
export function instanceLookScope(kind: InstanceLookKind, id: string): string;
export function parseInstanceLookScope(scope: unknown): { kind: InstanceLookKind; id: string } | null;
export function instanceLookVar(key: string): string;
export function colourTokensOf(registry: unknown): string[];
export function colourTokenName(raw: unknown, colourTokens: readonly string[]): string | null;
export function instanceLookValue(key: string, raw: unknown, colourTokens: readonly string[]): string | null;
export function instanceLookStored(key: string, raw: string, colourTokens: readonly string[]): string | null;
export function instanceLookWants(key: string, colourTokens: readonly string[]): string;
export function instanceLookKeyError(key: string, raw: unknown, colourTokens: readonly string[]): string | null;
export function normalizeInstanceLook(raw: unknown, colourTokens: readonly string[]): InstanceLook;
export function instanceLookRecordErrors(raw: unknown, colourTokens: readonly string[], path?: string): string[];
export function instanceLookErrors(type: string, data: unknown, colourTokens: readonly string[]): string[];
export function instanceLookSchemaProperties(colourTokens: readonly string[]): Record<string, unknown>;
