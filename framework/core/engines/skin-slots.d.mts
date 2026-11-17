export const SKIN_SLOTS_CONTRACT: 'skin-slots@1';
export type SkinSlotKey = 'motion' | 'behavior' | 'hooks' | 'grid' | 'dialog' | 'settings';
export const SKIN_SLOT_KEYS: readonly SkinSlotKey[];

/* motion */
export type MotionSpeed = 'fast' | 'normal' | 'slow';
export const MOTION_SPEEDS: readonly MotionSpeed[];
export const MOTION_SPEED_DEFAULTS: Readonly<Record<MotionSpeed, number>>;
export const MOTION_SPEED_RANGE: readonly [number, number];
export type MotionEasingRole = 'standard' | 'emphasized' | 'exit';
export const MOTION_EASING_ROLES: readonly MotionEasingRole[];
export const MOTION_EASING_NAMES: Readonly<Record<string, string>>;
export type MotionReduced = 'system' | 'always' | 'never';
export const MOTION_REDUCED: readonly MotionReduced[];
export const MOTION_KINDS: readonly string[];
export type MotionEnter = 'none' | 'fade' | 'rise' | 'scale' | 'slide';
export const MOTION_ENTERS: readonly MotionEnter[];
export const MOTION_STAGGER_RANGE: readonly [number, number];
export const MOTION_REDUCED_ATTR: 'data-fx-motion-reduced';
export function motionSpeedVar(speed: string): string;
export function motionEaseVar(role: string): string;
export function motionKindVar(kind: string, field: 'enter' | 'exit' | 'dur' | 'stagger'): string;
export function motionKindAttr(kind: string, field: 'enter' | 'exit'): string;
export function isEasing(v: unknown): boolean;
export function easingCss(v: string): string;
export interface SkinMotionKind { enter?: MotionEnter; exit?: MotionEnter; duration?: MotionSpeed; stagger?: number }
export interface SkinMotion {
  speed?: Partial<Record<MotionSpeed, number>>;
  easing?: Partial<Record<MotionEasingRole, string>>;
  reduced?: MotionReduced;
  chrome?: Record<string, SkinMotionKind>;
}
export function normalizeSkinMotion(raw: unknown): SkinMotion;
export function skinMotionErrors(raw: unknown): string[];
export function skinMotionStyle(raw: unknown, prefersReduced?: boolean): { vars: Record<string, string>; attrs: Record<string, string> };
export const MOTION_KEY: 'axf.motion';
export function skinMotionSettings(raw: unknown): Record<string, unknown>;

/* behaviour */
export const BEHAVIOR_TAP_KINDS: readonly string[];
export const BEHAVIOR_ARM_RANGE: readonly [number, number];
export const BEHAVIOR_FEEDBACK_ENUMS: Readonly<Record<'hover' | 'press' | 'focusRing', readonly string[]>>;
export const BEHAVIOR_OVERFLOW_KINDS: Readonly<Record<string, string>>;
export const BEHAVIOR_STICKY_KINDS: Readonly<Record<string, string>>;
export const BEHAVIOR_COLLAPSE_KINDS: Readonly<Record<string, string>>;
export const BEHAVIOR_ARM_KEY: 'axf.toolbars.armMs';
export function behaviorTapKindKey(kind: string): string;
export const BEHAVIOR_OVERRIDES_KEY: 'axf.behavior';
export function CHROME_KIND_DEFAULTS_KEY(kind: string): string;
export const NAV_COLLAPSED_SETTING: 'axf.nav.collapsedDefault';
export interface SkinBehavior {
  tapConfirm?: { armMs?: number } & Record<string, 'on' | 'off' | number | undefined>;
  hover?: string;
  press?: string;
  focusRing?: string;
  overflow?: Record<string, string>;
  sticky?: Record<string, boolean>;
  collapse?: Record<string, boolean>;
}
export function normalizeSkinBehavior(raw: unknown): SkinBehavior;
export function skinBehaviorErrors(raw: unknown): string[];
export function skinBehaviorSettings(raw: unknown): Record<string, unknown>;

/* hooks */
export const HOOK_KINDS: readonly string[];
export const HOOK_REF_CONTRACT: 'hook@1';
export function HOOKS_KEY(kind: string): string;
export function isHookId(v: unknown): v is string;
export interface HookRef { id: string; args?: Record<string, string | number | boolean> }
export interface SkinHookKind { hooks?: HookRef[]; drop?: string[] }
export type SkinHooks = Record<string, SkinHookKind>;
export interface HookRegistry { hook?: (id: string) => boolean; zone?: (id: string) => boolean }
export interface ResolvedSkinHooks { kinds: Record<string, { hooks: (HookRef & { known: boolean })[]; drop: { id: string; known: boolean }[] }>; unknown: string[] }
export function normalizeHookRef(raw: unknown): HookRef | null;
export function normalizeSkinHooks(raw: unknown): SkinHooks;
export function skinHooksErrors(raw: unknown): string[];
export function skinHookSettings(raw: unknown): Record<string, { hooks: HookRef[]; drop: string[] }>;
export function resolveSkinHooks(raw: unknown, registry?: HookRegistry): ResolvedSkinHooks;

/* grid */
export type GridDensity = 'compact' | 'regular' | 'roomy';
export type GridHeader = 'plain' | 'bold' | 'boxed' | 'hidden';
export type GridLines = 'none' | 'rows' | 'cells';
export const GRID_DENSITIES: readonly GridDensity[];
export const GRID_ROWS_RANGE: readonly [number, number];
export const GRID_HEADERS: readonly GridHeader[];
export const GRID_LINES: readonly GridLines[];
export const GRID_FIELDS: readonly string[];
export const GRID_KEY: 'axf.grid';
export const STYLE_TOKENS_KEY: 'axf.tokens.style';
export interface SkinGrid { density?: GridDensity; rows?: number; header?: GridHeader; zebra?: boolean; lines?: GridLines; sticky?: boolean }
export function normalizeSkinGrid(raw: unknown): SkinGrid;
export function skinGridErrors(raw: unknown): string[];
export function skinGridTokens(raw: unknown): Record<string, string | number>;
export function skinGridSettings(raw: unknown, existing?: unknown): Record<string, unknown>;

/* dialog chrome */
export const DIALOG_ENUMS: Readonly<Record<'variant' | 'backdrop' | 'animation' | 'header', readonly string[]>>;
export const DIALOG_WIDTH_RANGE: readonly [number, number];
export const DIALOG_FIELDS: readonly string[];
export const DIALOG_KEY: 'axf.chrome.dialog';
export interface SkinDialog { variant?: string; backdrop?: string; animation?: string; header?: string; closeOnBackdrop?: boolean; width?: number }
export function normalizeSkinDialog(raw: unknown): SkinDialog;
export function skinDialogErrors(raw: unknown): string[];
export function skinDialogSettings(raw: unknown): Record<string, unknown>;

/* settings chrome */
export const SETTINGS_CHROME_KEYS: readonly string[];
export const SETTINGS_PAGE_SLOT: 'settings';
export type SkinSettingsChrome = Record<string, string>;
export function normalizeSkinSettingsChrome(raw: unknown): SkinSettingsChrome;
export function skinSettingsChromeErrors(raw: unknown): string[];
export function skinSettingsChrome(raw: unknown): { slots: Record<string, string>; settings: Record<string, string> };

/* all five */
export interface SkinSlots { motion?: SkinMotion; behavior?: SkinBehavior; hooks?: SkinHooks; grid?: SkinGrid; dialog?: SkinDialog; settings?: SkinSettingsChrome }
export function normalizeSkinSlots(raw: unknown): SkinSlots;
export function skinSlotsErrors(raw: unknown): string[];
export function skinSlotSettings(raw: unknown, existingStyle?: unknown): Record<string, unknown>;
export const SKIN_SLOT_SETTING_PREFIXES: readonly string[];
export function skinSlotStyleKeys(): string[];
export function skinSlotsJsonSchemas(): Record<SkinSlotKey, Record<string, unknown>>;
