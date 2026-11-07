// Types for iconmap-rules.mjs (icon-map@1 + icon-source@1; shared by the TS engines, the build engine and the CLI).
export const ICON_MAP_TYPE: 'icon-map';
export const ICON_SOURCE_TYPE: 'icon-source';
export const ICON_MAP_CONTRACT: 'icon-map@1';
export const ICON_SOURCE_CONTRACT: 'icon-source@1';
export const ICON_LIBRARY_CONTRACT: 'icon-library@1';
export const ICON_SETTING_PREFIX: 'axf.icons.';
export function ICON_MAP_KEY(scopeKey: string): string;
export function ICON_SLOTS_KEY(scopeKey: string): string;
export function ICON_PACK_KEY(scopeKey: string): string;
export const ICON_SCOPE_KINDS: readonly string[];
export const ICON_REF_KINDS: readonly string[];
export const ICON_MAP_LIMITS: { slots: number; slotChars: number; refChars: number; idChars: number; aliasDepth: number; tags: number };
export const SLOT_NAME: RegExp;
export const GLYPH_NAME: RegExp;
export const ASSET_ID: RegExp;
export const APP_ID: RegExp;
export const ICON_AUTH_MODES: readonly string[];
export const SECRET_FIELD_NAMES: readonly string[];
export const ICON_SOURCE_LIMITS: { label: number; root: number; options: number; optionChars: number; secretRef: number };
export const ICON_SOURCE_FORMATS: readonly string[];

export type IconScopeKind = 'app' | 'ui' | 'plugin';
export type IconRefKind = 'name' | 'pack' | 'none';
export type IconVia = 'slot' | 'pack' | 'branding' | 'framework' | 'none';

export interface IconScope { app: string; ui: string; plugin: string }
export interface IconMapData { scope: IconScope; extends: string; pack: string; slots: Record<string, string>; tags: string[] }
export interface IconRef { kind: IconRefKind; glyph: string; pack: string }
export interface IconResolution { glyph: string; pack: string; via: IconVia; from: string }
export interface IconMapLink { id: string; data: unknown; slots?: Record<string, unknown> }
export interface IconLookup { hasGlyph?: (packId: string, glyph: string) => boolean; brandingPack?: string }

export interface IconSourceField { id: string; label: string; kind: 'text' | 'number' | 'path' | 'url' | 'select' | 'password-ref'; required?: boolean; about?: string; options?: string[] }
export interface IconSourceKind { id: string; label: string; icon: string; about: string; fields: IconSourceField[]; auth: string[]; host?: boolean }
export interface IconSourceData { kind: string; label: string; root: string; auth: { mode: string; secretRef: string }; options: Record<string, string | number | boolean>; format: string; enabled: boolean; tags: string[] }

export function registerIconSourceKind(k: Partial<IconSourceKind> & { id: string }): IconSourceKind;
export function iconSourceKinds(): IconSourceKind[];
export function iconSourceKindIds(): string[];
export function isSecretName(k: string): boolean;

export function parseIconRef(ref: unknown): IconRef | null;
export function iconRef(r: IconRef | null | undefined): string;
export function iconScopeKey(scope: unknown): string;
export function iconScopeKind(scope: unknown): IconScopeKind;
export function iconScopeChain(scope: unknown): string[];
export function normalizeScope(raw: unknown): IconScope;
export function normalizeIconMap(raw: unknown): IconMapData;
export function iconMapErrors(type: string, data: unknown): string[];
export function normalizeIconSource(raw: unknown): IconSourceData;
export function iconSourceErrors(type: string, data: unknown): string[];

export function resolveIcon(name: string, chain: IconMapLink[], lookup?: IconLookup): IconResolution;
export function foldIconMap(id: string, byId: Record<string, { data?: unknown } | unknown>, depth?: number): IconMapData | null;
export function explainIcons(names: string[], chain: IconMapLink[], lookup?: IconLookup): Record<string, IconResolution>;

export function seededRandom(seed: unknown): () => number;
export function registerIconSynonyms(name: string, words: string[]): string[];
export function iconSynonyms(name: string): string[];
export function iconSynonymTable(): Record<string, string[]>;
export function matchGlyph(name: string, packId: string, has: (packId: string, glyph: string) => boolean): string;
export function generateCohesiveMap(names: string[], packIds: string | string[], lookup: IconLookup, scope?: Partial<IconScope>): { data: IconMapData; covered: string[]; missing: string[] };
export function randomizeMap(names: string[], packIds: string[], lookup: IconLookup, seed?: unknown, scope?: Partial<IconScope>): { data: IconMapData; changed: string[]; kept: string[] };
export function allIcons(packs: { id: string; data?: { glyphs?: Record<string, unknown> } }[]): { name: string; pack: string; ref: string }[];

export function iconMapSchemaProperties(): Record<string, unknown>;
export function iconSourceSchemaProperties(): Record<string, unknown>;
