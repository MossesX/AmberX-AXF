// Types for jumpmenu-rules.mjs (jump-menu@1; shared by the TS engine, control@1 and the build engine).
export type JumpFieldKind = 'enum' | 'number' | 'boolean';
export interface JumpFieldSpec { kind: JumpFieldKind; default: string | number | boolean; options?: readonly string[]; min?: number; max?: number; unit?: string }
export const JUMP_MENU_TYPE: 'jump-menu';
export const JUMP_MENU_FRAME: 'jump-menu@1';
export const JUMP_LOCATIONS: readonly ['top', 'left', 'right', 'bottom', 'floating'];
export const JUMP_DISPLAYS: readonly ['icons-text', 'text', 'icons', 'numbered'];
export const JUMP_VARIANTS: readonly ['chips', 'underline', 'rail', 'pill'];
export const JUMP_SIZES: readonly ['sm', 'md', 'lg'];
export const JUMP_DENSITIES: readonly ['theme', 'compact', 'regular', 'roomy'];
export const JUMP_OVERFLOWS: readonly ['wrap', 'scroll', 'more'];
export const JUMP_FIELDS: Record<string, JumpFieldSpec>;
export const JUMP_FIELD_IDS: string[];
export const JUMP_FIELD_LEVELS: Record<string, 'simple' | 'basic' | 'developer'>;
export const JUMP_MENU_PREFIX: 'menu.';
export const JUMP_ASSET_FIELD: 'asset';
export const JUMP_MENU_ID: RegExp;
export const JUMP_SECTIONS_MAX: number;
export const JUMP_LABEL_MAX: number;
export type JumpLocation = 'top' | 'left' | 'right' | 'bottom' | 'floating';
export type JumpDisplay = 'icons-text' | 'text' | 'icons' | 'numbered';
export type JumpVariant = 'chips' | 'underline' | 'rail' | 'pill';
export type JumpOverflow = 'wrap' | 'scroll' | 'more';
export interface JumpSection { id: string; label: string; icon?: string }
/** Normalized jump-menu data: every field filled in. */
export interface JumpMenuData {
  location: JumpLocation;
  display: JumpDisplay;
  variant: JumpVariant;
  size: 'sm' | 'md' | 'lg';
  density: 'theme' | 'compact' | 'regular' | 'roomy';
  sticky: boolean;
  collapsible: boolean;
  collapsed: boolean;
  spy: boolean;
  smooth: boolean;
  overflow: JumpOverflow;
  offset: number;
  sections: JumpSection[];
}
export function jumpMenuPath(path: unknown): { menu: string; field: string } | null;
export function jumpFieldValue(path: string, v: unknown): string | number | boolean | undefined;
export function jumpSection(raw: unknown): JumpSection | null;
export function jumpSections(raw: unknown): JumpSection[];
export function normalizeJumpMenu(raw: unknown): JumpMenuData;
export function jumpFieldHint(f: JumpFieldSpec): string;
export function jumpMenuErrors(raw: unknown): string[];
export function jumpFieldErrors(path: string, value: unknown): string[];
export function jumpConfig(assetData: unknown, overrides: unknown, menuId?: string | null): { config: JumpMenuData; asset: string | null };
export function jumpFieldSource(overrides: unknown, menuId: string | null | undefined, field: string): 'menu' | 'app' | 'asset';
export function jumpMenuTokens(): { id: string; kind: string; options?: readonly string[]; min?: number; max?: number; default: unknown }[];
export function jumpMenuSchemaProperties(): Record<string, unknown>;
