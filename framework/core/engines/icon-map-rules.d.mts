// Types for icon-map-rules.mjs (icon-map@1).
export const ICON_MAP_FRAME: 'icon-map@1';
export const ICON_SLOT_KINDS: readonly string[];
export const ICON_SURFACES: readonly string[];
export const ICON_SOURCES: readonly string[];
export const ICON_OWNER_KINDS: readonly string[];
export const ICON_ROLE_GROUPS: readonly string[];
export const ICON_LIMITS: { slots: number; idChars: number; labelChars: number; roleChars: number; declaredSlots: number; declaredRoles: number };
export const SLOT_ID: RegExp;
export const ROLE_ID: RegExp;
export const ICON_SLOT_KEY: (slotId: string) => string;
export const ICON_PACK_KEY: string;
export const ICON_OK: string;
export const ICON_ROLES: Readonly<Record<string, IconRole>>;

export interface IconRole { glyph: string; group: string; label: string }
export interface IconSlot {
  id: string; kind: string; role: string; glyph: string; surface: string; label: string;
  app: string; owner: string; ownerKind: string; screen: string; source: string; file: string; line: number;
}
export interface IconLiteral { glyph: string; line: number; file: string; surface: string; name: string; label: string; ok: boolean; known: boolean }
export interface RawIcon { kind: 'svg' | 'emoji'; line: number; file: string; text: string }
export interface IconsBlock { $axf: 'icon-map@1'; roles: Record<string, IconRole>; slots: unknown[]; pins: Record<string, string> }
export interface IconOwnerFacts { app: string; owner: string; ownerKind: string; manifest?: unknown; sources?: { file: string; text: string; screen?: string }[]; assets?: { type: string; id: string; name?: string; data: unknown; file?: string }[]; roles?: Record<string, IconRole> | null }
export interface IconMap {
  $axf: 'icon-map@1'; kinds: string[]; surfaces: string[]; sources: string[]; groups: string[];
  glyphs: { names: string[]; aliases: Record<string, string>; fallback: string };
  roles: Record<string, IconRole>; slots: IconSlot[];
  counts: { slots: number; byKind: Record<string, number>; bySurface: Record<string, number>; byApp: Record<string, number>; byOwner: Record<string, number>; roles: number; glyphs: number };
  unknown: { glyph: string; file: string; line: number; ok: boolean; app?: string; owner?: string }[]; problems: string[];
}
export interface IconResolution { glyph: string; via: 'override' | 'pack-role' | 'role' | 'pack-glyph' | 'framework' | 'fallback' }

export function slug(s: unknown): string;
export function allRoles(extra?: Record<string, unknown>): Record<string, IconRole>;
export function roleForGlyph(name: unknown): string;
export function roleGlyph(role: string, roles?: Record<string, IconRole>, pack?: unknown): string;
export function resolveIcon(q: { name?: string; slot?: string; role?: string; overrides?: Record<string, string>; pack?: unknown; roles?: Record<string, IconRole> | null }): IconResolution;
export function slotId(parts: { app: string; owner: string; surface: string; name: string }): string;
export function normalizeSlot(raw: unknown, defaults?: Record<string, unknown>): IconSlot;
export function slotErrors(raw: unknown, path?: string): string[];
export function normalizeIconsBlock(raw: unknown): { block: IconsBlock; errors: string[]; declared: boolean };
export function scanIconLiterals(text: string, file?: string): IconLiteral[];
export function scanRawIcons(text: string, file?: string): RawIcon[];
export function assetIconSlots(asset: { type: string; id: string; name?: string; data: unknown; file?: string }, defaults: Record<string, unknown>): IconSlot[];
export function manifestIconSlots(manifest: unknown, defaults: Record<string, unknown>): { slots: IconSlot[]; roles: Record<string, IconRole>; pins: Record<string, string> };
export function deriveSlots(facts: IconOwnerFacts): { slots: IconSlot[]; roles: Record<string, IconRole>; unknown: IconMap['unknown'] };
export function buildIconMap(owners?: IconOwnerFacts[]): IconMap;
export function iconMapErrors(map: unknown): string[];
export function iconMapCheck(map: IconMap, raws?: RawIcon[], baseline?: { files: Record<string, number> }): { ok: boolean; failures: string[]; warnings: string[]; baseline: { $axf: string; files: Record<string, number> } };
export function iconMapTree(map: IconMap): { app: string; count: number; owners: { owner: string; ownerKind: string; count: number; surfaces: { surface: string; slots: IconSlot[] }[] }[] }[];
export function iconMapSearch(map: IconMap, q?: string, filters?: Record<string, string>): IconSlot[];
export function iconMapSchemas(): Record<string, unknown>;
