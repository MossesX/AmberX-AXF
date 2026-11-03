// Types for control-tokens.mjs (control@1 token overrides carried by the axHub appearance document).
export type TokenOverrideValue = string | number | boolean;
export type TokenOverrides = Record<string, Record<string, TokenOverrideValue>>;
export declare const CONTROL_TOKENS_PREFIX: 'axf.tokens.';
export declare const CONTROL_TOKENS_ALL: '*';
export declare const CONTROL_TOKENS_MAX_BYTES: number;
export declare const CONTROL_TOKEN_SLOTS: Record<'tokens.theme' | 'tokens.style' | 'tokens.layout' | 'tokens.typography' | 'tokens.density' | 'tokens.sizing', { slot: string; key: string; root: string }>;
export declare function tokenSettingsKey(target: string): string | null;
export declare function isTokenSettingsKey(key: string): boolean;
export declare function normalizeTokenOverrides(raw: unknown): TokenOverrides;
export declare function effectiveTokenOverrides(raw: unknown, assetId?: string | null): Record<string, TokenOverrideValue>;
export declare function applyTokenOverrides<T>(target: string, data: T, overrides: Record<string, TokenOverrideValue>): T;
export declare function tokenValueIn(target: string, data: unknown, path: string): unknown;
export declare function withTokenOverride(raw: unknown, path: string, value: TokenOverrideValue, asset?: string): TokenOverrides;
export declare function withoutTokenOverride(raw: unknown, path: string | null | undefined, asset?: string): TokenOverrides | null;
