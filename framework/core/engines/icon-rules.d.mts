export const ICON_MAP_TYPE: 'icon-map';
export const ICON_PACK_TYPE: 'icon-pack';
export const ICON_MAP_CONTRACT: 'icon-map@1';
export const ICON_PACK_CONTRACT: 'icon-pack@1';
export const SPOT_KINDS: readonly SpotKind[];
export const SPOT_ID: RegExp;
export const SPOT_SIZES: readonly string[];
export const SIZE_TOKEN: RegExp;
export const TINT_TOKENS: readonly string[];
export const GLYPH_SOURCES: readonly GlyphSource[];
export const PACK_SOURCE_KINDS: readonly PackSourceKind[];
export const GEN_STYLES: readonly GenStyle[];
export const APP_ICON_SHAPES: readonly AppIconShape[];
export const GLYPH_REF: RegExp;
export const PNG_DATA_URI: RegExp;
export const LICENSE_ID: RegExp;
export const PACK_ID: RegExp;
export const ICON_MAP_LIMITS: { spots: number; tags: number; tagChars: number; labelChars: number; helpChars: number; files: number; appChars: number; extendsDepth: number };
export const ICON_PACK_LIMITS: { glyphs: number; spots: number; pathChars: number; svgChars: number; pngChars: number; fontChars: number; extendsDepth: number; tags: number; licenseChars: number; urlChars: number; seedChars: number; padding: [number, number] };

export type SpotKind = 'icon' | 'badge' | 'app-icon';
export type GlyphSource = 'path' | 'svg' | 'png' | 'font' | 'ref';
export type PackSourceKind = 'builtin' | 'upload' | 'url' | 'library' | 'generated' | 'mixed';
export type GenStyle = 'line' | 'solid' | 'duotone' | 'rounded' | 'geometric' | 'pixel';
export type AppIconShape = 'circle' | 'squircle' | 'rounded' | 'square';

export interface IconSpot { id: string; kind: SpotKind; glyph: string; dynamic: boolean; size: string; tint: string; tags: string[]; label: string; help: string; files: string[] }
export interface IconMapData { app: string; spots: Record<string, IconSpot>; extends: string; generatedAt: string }
export interface GlyphSourceMeta { kind: PackSourceKind; url?: string; library?: string; importedAt?: string }
export interface GlyphLicense { id: string; holder?: string; url?: string }
/** One glyph entry; `d` / `fill` / `secondary` keep the brand-rules Glyph shape so path glyphs draw through glyphSvg. */
export interface PackGlyph { kind: GlyphSource; d: string; secondary: string; fill: boolean; svg: string; png: string; font: { family: string; char: string } | null; ref: string; source: GlyphSourceMeta | null; license: GlyphLicense | null; tags: string[] }
export interface PackSeed { seed: string; style: GenStyle; grammar: string }
export interface AppIconStyle { shape: AppIconShape; bg: string; fg: string; padding: number }
export interface IconPackFull { style: string; grid: number; stroke: number; linecap: 'round' | 'square' | 'butt'; fallback: 'framework' | 'none'; glyphs: Record<string, PackGlyph>; spots: Record<string, PackGlyph | string>; extends: string; source: GlyphSourceMeta | null; license: GlyphLicense | null; seed: PackSeed | null; appIcon: AppIconStyle; tags: string[] }

export function parseSpotId(id: unknown): { app: string; area: string; slot: string } | null;
export function spotSizeOk(v: unknown): boolean;
export function spotTintOk(v: unknown): boolean;
export function normalizeSpot(id: string, raw: unknown): IconSpot;
export function normalizeIconMap(raw: unknown): IconMapData;
export function iconMapErrors(raw: unknown): string[];
export function glyphSourceOf(raw: unknown): GlyphSource | '';
export function normalizeGlyph(raw: unknown): PackGlyph | null;
export function glyphErrors(raw: unknown, where: string): string[];
export function normalizeIconPackFull(raw: unknown): IconPackFull;
export function iconPackExtendedErrors(raw: unknown): string[];
export function iconAssetErrors(type: string, data: unknown): string[] | null;
export function iconSchemaProperties(type: string): { $defs: Record<string, unknown>; properties: Record<string, unknown> };
