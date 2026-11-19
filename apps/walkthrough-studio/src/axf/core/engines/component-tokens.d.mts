// Types for component-tokens.mjs (component-tokens@1: the grid and tab-group token families).
export type ComponentTokenFamily = 'grid' | 'tabs';
export type ComponentTokenKind = 'colour' | 'length' | 'shadow' | 'opacity' | 'number';
export type ComponentTokenLevel = 'basic' | 'pro' | 'advanced';
export interface ComponentToken { key: string; kind: ComponentTokenKind; default: string; level: ComponentTokenLevel; description: string }
export interface ComponentTokenRow extends ComponentToken { family: ComponentTokenFamily; path: string; var: string }
export interface ComponentTokenFamilySpec { label: string; prefix: string; doc: string; tokens: ComponentToken[] }
export type ComponentTokenRaw = string | number;
export type InstanceTokenValues = Record<string, ComponentTokenRaw>;
export interface InstanceTokenEntry { values: InstanceTokenValues; previous?: InstanceTokenValues }
export type InstanceTokens = Record<string, InstanceTokenEntry>;
export type VarMap = Record<string, string>;

export declare const COMPONENT_TOKENS_CONTRACT: 'component-tokens@1';
export declare const COMPONENT_TOKEN_LEVELS: readonly ComponentTokenLevel[];
export declare const COMPONENT_TOKEN_KINDS: readonly ComponentTokenKind[];
export declare const COMPONENT_TOKEN_FAMILIES: Record<ComponentTokenFamily, ComponentTokenFamilySpec>;
export declare const COMPONENT_TOKEN_FAMILY_IDS: ComponentTokenFamily[];
export declare function isComponentTokenFamily(f: unknown): f is ComponentTokenFamily;
export declare function componentTokenVar(family: string, key: string): string | null;
export declare function componentToken(family: string, key: string): ComponentToken | null;
export declare function componentTokenList(): ComponentTokenRow[];
export declare function componentTokenDefaults(): VarMap;
export declare function componentTokenValue(kind: ComponentTokenKind, raw: unknown): string | null;
export declare function componentTokenError(family: string, key: string, raw: unknown): string | null;
export declare function componentTokenVars(style: unknown): VarMap;
export declare function componentTokenFields(): Record<string, 'string' | 'number'>;
export declare function componentTokenPaths(): Array<{ id: string; token: string; kind: 'color' | 'number' | 'string'; default: string; level: ComponentTokenLevel; description: string; family: ComponentTokenFamily }>;

export declare const INSTANCE_TOKENS_KEY: 'axf.tokens.instances';
export declare const INSTANCE_TOKENS_MAX_BYTES: number;
export declare function isInstanceId(id: unknown): id is string;
export declare function instanceTokenEntry(family: string, instance: string): string;
export declare function parseInstanceTokenEntry(id: unknown): { family: ComponentTokenFamily; instance: string } | null;
export declare function parseInstanceTokenPath(path: unknown): { family: ComponentTokenFamily; instance: string; key: string | null } | null;
export declare function normalizeInstanceTokens(raw: unknown): InstanceTokens;
export declare function instanceTokenValues(raw: unknown, family: string, instance: string): InstanceTokenValues;
export declare function instanceTokenVars(raw: unknown, family: string, instance: string): VarMap;
export declare function setInstanceToken(raw: unknown, family: string, instance: string, key: string, value: ComponentTokenRaw | null): InstanceTokens;
export declare function restorePreviousInstanceTokens(raw: unknown, family: string, instance: string): InstanceTokens;
export declare function restoreInstanceTokensFromHub(raw: unknown, family: string, instance: string): InstanceTokens;
export declare function instanceHasPrevious(raw: unknown, family: string, instance: string): boolean;
export declare function instanceTokenList(raw: unknown): Array<{ id: string; family: ComponentTokenFamily; instance: string; values: InstanceTokenValues; hasPrevious: boolean }>;
