// Types for glyphs.mjs (the framework glyph set, icon-map@1).
export const GLYPH_GRID: number;
export const GLYPH_STROKE: number;
export const GLYPH_FALLBACK: string;
export const GLYPHS: Readonly<Record<string, string>>;
export const GLYPH_ALIASES: Readonly<Record<string, string>>;
export const GLYPH_NAMES: readonly string[];
export function glyphName(name: unknown): string | null;
export function glyphPath(name: unknown): string;
export function isGlyph(name: unknown): boolean;
