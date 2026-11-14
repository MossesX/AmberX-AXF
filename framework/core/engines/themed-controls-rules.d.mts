// Types for themed-controls-rules.mjs (themed-controls@1; shared by the TS engine, control@1 and the build engine).
export type TcFieldKind = 'color' | 'enum' | 'number' | 'boolean';
export interface TcFieldSpec { kind: TcFieldKind; default: string | number | boolean; options?: readonly string[]; min?: number; max?: number; unit?: string }
export type ThemedFamily = 'checkbox' | 'radio' | 'range' | 'number' | 'datetime' | 'color' | 'dialogs' | 'file' | 'tooltip' | 'scrollbar';
export const THEMED_CONTROLS_TYPE: 'themed-controls';
export const THEMED_CONTROLS_FRAME: 'themed-controls@1';
export const THEMED_FAMILIES: readonly ThemedFamily[];
export const THEMED_FAMILY_LABELS: Record<ThemedFamily, string>;
export const THEMED_FAMILY_NATIVE: Record<ThemedFamily, string>;
export const TC_COLOR_TOKENS: readonly string[];
export const TC_RADII: readonly string[];
export const TC_BORDER_WIDTHS: readonly string[];
export const TC_SHOW_VALUE: readonly string[];
export const TC_STEPPERS: readonly string[];
export const TC_STATES: Record<ThemedFamily, readonly string[]>;
export const TC_WEEK_STARTS: readonly string[];
export const TC_HOUR_CYCLES: readonly string[];
export const TC_BUTTON_TONES: readonly string[];
export const TC_BORDER_STYLES: readonly string[];
export const TC_PLACEMENTS: readonly string[];
export const TC_GUTTERS: readonly string[];
export const THEMED_CONTROL_FIELDS: Record<string, TcFieldSpec>;
export const THEMED_CONTROL_GROUPS: string[];
/** One state's colours: prop → `theme`, a colour token id or a `light|dark` pair. */
export type TcStateColors = Record<string, string>;
/** One family: its scalar fields and one entry per state. */
export type TcFamilyData = Record<string, string | number | boolean | TcStateColors>;
/** Normalized themed-controls data: every field filled in, nested family → field | state → prop. */
export type ThemedControlsData = Record<string, TcFamilyData>;
export function tcColorValue(v: unknown): string | undefined;
export function tcColorFor(value: unknown, scheme?: 'light' | 'dark'): string;
export function tcFieldValue(path: string, v: unknown): string | number | boolean | undefined;
export function normalizeThemedControls(raw: unknown): ThemedControlsData;
export function themedControlsErrors(raw: unknown): string[];
export function tcFieldErrors(path: string, value: unknown): string[];
export function tcFieldHint(f: TcFieldSpec): string;
export function tcFamilyFields(family: string): Record<string, TcFieldSpec>;
export function themedControlsTokens(): { id: string; kind: string; options?: readonly string[]; pair?: string; min?: number; max?: number; unit?: string; default: unknown }[];
export function themedControlsSchemaProperties(): Record<string, unknown>;
