// Types for brand-rules.mjs (shared by the TS engines, the build engine and the generators).
export const BRAND_TYPES: readonly string[];
export const MARK_COLORS: readonly string[];
export const MARK_FORMS: readonly string[];
export const MARK_LIMITS: { paths: number; pathChars: number; totalChars: number; textChars: number; palette: number; viewBoxMax: number };
export const PATH_DATA: RegExp;
export const HEX: RegExp;
export const ANIMATION_PRESETS: readonly string[];
export const ANIMATION_LIMITS: { durationMs: readonly [number, number]; delayMs: readonly [number, number] };
export const ICON_STYLES: readonly string[];
export const ICON_LIMITS: { grid: readonly [number, number]; stroke: readonly [number, number]; glyphs: number; pathChars: number; nameChars: number };
export const GLYPH_NAME: RegExp;
export const BRAND_SLOTS: readonly string[];
export const BRAND_SLOT_MODES: readonly string[];
export const BRAND_DEFAULT_MODES: Record<string, string>;
export const BRAND_LIMITS: { nameChars: number; taglineChars: number; extraSlots: number };

export interface MarkPath { d: string; fill: string; stroke: string; strokeWidth: number; opacity: number; round: boolean }
export interface MarkText { value: string; weight: number; tracking: number; font: 'ui' | 'display' | 'mono'; fill: string }
export interface MarkData { form: 'mark' | 'wordmark' | 'lockup'; brand: string; viewBox: number[]; paths: MarkPath[]; text: MarkText | null; palette: Record<string, string>; safeArea: number; minSize: number; tags: string[] }
export interface AnimatedLogoData { mark: string; preset: string; durationMs: number; delayMs: number; loop: boolean | 'hover'; still: 'first' | 'last'; intensity: number; tags: string[] }
export interface Glyph { d: string; fill: boolean; secondary: string }
export interface IconPackData { style: string; grid: number; stroke: number; linecap: 'round' | 'square' | 'butt'; fallback: 'framework' | 'none'; glyphs: Record<string, Glyph>; tags: string[] }
export interface BrandingData { brand: { name: string; tagline: string }; marks: { mark: string; wordmark: string; lockup: string; animated: string }; iconPack: string; decorations: Record<string, string>; palette: Record<string, string>; accentFromBrand: boolean; tags: string[] }

export function normalizeMark(raw: unknown): MarkData;
export function parseViewBox(v: unknown): number[] | null;
export function markErrors(raw: unknown): string[];
export function normalizeAnimatedLogo(raw: unknown): AnimatedLogoData;
export function animatedLogoErrors(raw: unknown): string[];
export function normalizeIconPack(raw: unknown): IconPackData;
export function iconPackErrors(raw: unknown): string[];
export function registerBrandSlot(slot: string): void;
export function brandSlots(): string[];
export function normalizeBranding(raw: unknown): BrandingData;
export function brandingErrors(raw: unknown): string[];
export function brandAssetErrors(type: string, data: unknown): string[] | null;
