// Types for navstyle-rules.mjs (nav-style@1; shared by the TS engine, control@1 and the build engine).
export type NavFieldKind = 'color' | 'enum' | 'number' | 'boolean' | 'list';
export interface NavFieldSpec { kind: NavFieldKind; default: string | number | boolean; options?: readonly string[]; min?: number; max?: number; unit?: string }
export const NAV_STYLE_TYPE: 'nav-style';
export const NAV_STYLE_FRAME: 'nav-style@1';
export const NAV_COLOR_TOKENS: readonly string[];
export const NAV_ANIMATIONS: readonly ['slide', 'accordion', 'fade', 'push', 'none'];
export const NAV_EASINGS: readonly string[];
export const NAV_CHEVRONS: readonly string[];
export const NAV_REDUCED: readonly string[];
export const NAV_OPEN_ON: readonly string[];
export const NAV_FONT_FAMILIES: readonly string[];
export const NAV_FONT_SIZES: readonly string[];
export const NAV_FONT_WEIGHTS: readonly string[];
export const NAV_ICON_SIZES: readonly string[];
export const NAV_DENSITIES: readonly string[];
export const NAV_STYLE_FIELDS: Record<string, NavFieldSpec>;
export const NAV_ACCENT_PREFIX: 'accents.';
export const NAV_STYLE_GROUPS: string[];
export type NavAnimation = 'slide' | 'accordion' | 'fade' | 'push' | 'none';
/** Normalized nav-style data: every field filled in. */
export interface NavStyleData {
  colors: { background: string; text: string; hover: string; active: string; activeText: string; submenu: string; accent: string };
  font: { family: string; size: string; weight: string };
  icons: { show: boolean; size: 'sm' | 'md' | 'lg' };
  layout: { density: string; indent: number };
  width: { size: number; min: number; max: number; resizable: boolean; collapsible: boolean };
  animation: { kind: NavAnimation; durationMs: number; easing: string; staggerMs: number; chevron: 'rotate' | 'flip' | 'none'; reduced: 'system' | 'always' | 'never' };
  behavior: { single: boolean; openOn: 'tap' | 'hover'; autoCollapse: boolean; remember: boolean; followActive: boolean; swipe: boolean };
  items: { order: string; hidden: string; pinned: string };
  /** item id → colour token */
  accents: Record<string, string>;
}
export function navIdList(v: unknown): string[];
export function navFieldValue(path: string, v: unknown): string | number | boolean | undefined;
export function normalizeNavStyle(raw: unknown): NavStyleData;
export function navStyleErrors(raw: unknown): string[];
export function navFieldErrors(path: string, value: unknown): string[];
export function navFieldHint(f: NavFieldSpec): string;
export function navStyleTokens(): { id: string; kind: string; options?: readonly string[]; min?: number; max?: number; default: unknown }[];
export function navStyleSchemaProperties(): Record<string, unknown>;
