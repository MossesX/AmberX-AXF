// Types for menu-item-rules.mjs (menu-item@2; shared by the TS app-menu engine, control@1 `tokens.menu` and the build engine).
import type { MenuChoice, MenuItem, MenuItemKind, MenuStatusAnim, MenuStatusReading, MenuStatusSpec, MenuStatusState, MenuStatusTone } from '../types';

export const MENU_ITEMS_VERSION: 2;
export const MENU_KINDS: readonly MenuItemKind[];
export const MENU_STATUS_KINDS: readonly string[];
export const MENU_STATUS_STATES: readonly MenuStatusState[];
export const MENU_STATUS_TONES: Readonly<Record<MenuStatusState, MenuStatusTone>>;
export const MENU_STATUS_TONE_OPTIONS: readonly MenuStatusTone[];
export const MENU_STATUS_ANIMS: readonly MenuStatusAnim[];
export const MENU_STATUS_DEFAULT_ANIMS: Readonly<Partial<Record<MenuStatusState, MenuStatusAnim>>>;
export const MENU_STATUS_TEXT: Readonly<Record<MenuStatusState, string>>;
export const MENU_STATUS_DEFAULT_ICON: string;
export const MENU_CHOICES_MIN: number;
export const MENU_CHOICES_MAX: number;
export const MENU_TOKENS_KEY: 'axf.tokens.menu';
export const MENU_TOKENS_TARGET: 'tokens.menu';
export const MENU_SETTING_SET: 'setting.set';
export const MENU_SETTING_TOGGLE: 'setting.toggle';
export const MENU_PATH_ROOTS: readonly string[];

export function menuItemKind(item: unknown): MenuItemKind;

export type ChoiceValue = string | number | boolean;
export function choiceAction(key: string, value: ChoiceValue): string;
export function switchAction(key: string): string;
export function parseChoiceAction(args: readonly string[]): { key: string; value: ChoiceValue } | null;
export function choiceMatches(choiceValue: ChoiceValue, settingValue: unknown): boolean;
export function currentChoice(choices: readonly MenuChoice[] | undefined, settingValue: unknown): { choice: MenuChoice; picked: boolean } | null;
export function nextChoice(choices: readonly MenuChoice[] | undefined, settingValue: unknown): MenuChoice | null;

export function parseStatusSource(source: unknown): { kind: string; ref: string } | null;
export function statusSpec(status: unknown): MenuStatusSpec | null;
export function statusTone(spec: MenuStatusSpec | null | undefined, state: MenuStatusState): MenuStatusTone;
export function statusAnim(spec: MenuStatusSpec | null | undefined, state: MenuStatusState): MenuStatusAnim;
/** A live status slot ready to draw. */
export interface CompiledMenuStatus { source: string; state: MenuStatusState; tone: MenuStatusTone; anim: MenuStatusAnim; icon: string; text: string; tooltip: string }
export function compileStatus(spec: string | MenuStatusSpec | undefined, reading: MenuStatusReading | null | undefined, fallbackLabel?: string): CompiledMenuStatus | null;

export function menuItemPath(root: string, trail: readonly string[]): string;
export function isMenuItemPath(path: unknown): boolean;
export type MenuTokenKind = 'text' | 'icon' | 'action' | 'boolean' | 'number' | 'enum';
export interface MenuTokenSpec { group: 'behavior' | 'appearance'; kind: MenuTokenKind; label: string; default?: string | number | boolean; options?: readonly string[]; min?: number; max?: number }
export const MENU_ITEM_TOKENS: Readonly<Record<string, MenuTokenSpec>>;
export const MENU_ITEM_TOKEN_IDS: readonly string[];
export const MENU_ITEM_APPEARANCE_TOKENS: readonly string[];
export const MENU_ITEM_BEHAVIOR_TOKENS: readonly string[];
export type MenuTokenValue = string | number | boolean;
export type MenuOverrides = Record<string, Record<string, MenuTokenValue>>;
export function normalizeMenuToken(token: string, v: unknown): MenuTokenValue | undefined;
export function normalizeMenuOverrides(raw: unknown): MenuOverrides;
export function withMenuOverride(raw: unknown, path: string, token: string, value: MenuTokenValue | null): MenuOverrides;
export function withoutMenuOverrides(raw: unknown, path: string, deep?: boolean): MenuOverrides;
export function listMenuOverrides(raw: unknown): { path: string; token: string; value: MenuTokenValue }[];

export function migrateMenuItems(items: unknown, trail?: readonly string[]): { items: MenuItem[]; notes: string[] };
export function migrateMenuAsset<T>(asset: T): { asset: T; notes: string[]; changed: boolean };

export function menuItemV2Errors(o: unknown, p: string): string[];
export function menuItemV2SchemaProperties(doc?: Record<string, string>): Record<string, unknown>;
