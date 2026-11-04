/** Types for chrome-settings-rules.mjs (chrome-settings@1). */

export type ChromeType = 'tab-group' | 'toolbar' | 'banner' | 'nav-menu' | 'app-menu' | 'context-menu';
export type ChromeFieldKind = 'choice' | 'toggle' | 'number';
export type ChromeFieldGroup = 'look' | 'behaviour';
export type ChromeLevel = 'simple' | 'basic' | 'developer' | 'administrator';
export type ChromePosition = 'top' | 'bottom' | 'left' | 'right';

export interface ChromeField {
  key: string;
  label: string;
  kind: ChromeFieldKind;
  options?: string[];
  labels?: Record<string, string>;
  min?: number;
  max?: number;
  group: ChromeFieldGroup;
  level: ChromeLevel;
}
export interface ChromeMove { positions: ChromePosition[]; via: 'instance' | 'layout' | 'none'; field: string }
export interface ChromeSettingsTab { id: string; label: string; icon: string; order: number }
export interface ChromeSettingsChoice { id: string; name: string; custom: boolean; extends: string }
export interface ChromeSettingsPlanEntry { type: ChromeType; defaultId: string; customId: string }
export interface AssetLike { id: string; name?: string; data?: Record<string, unknown> }

export const CHROME_SETTINGS_CONTRACT: 'chrome-settings@1';
export const CHROME_TYPES: ChromeType[];
export const CHROME_LABELS: Record<ChromeType, string>;
export const CHROME_ICONS: Record<ChromeType, string>;
export const CHROME_MANY: Record<ChromeType, boolean>;
export const CHROME_SETTINGS_PREFIX: 'chrome-';
export const CHROME_SETTINGS_MAX_DEPTH: number;
export function isChromeType(t: unknown): t is ChromeType;
export function chromeLabel(t: string): string;
export function appSlug(app: unknown): string;
export function chromeSettingsDefaultId(type: ChromeType | string): string;
export function chromeSettingsCustomId(type: ChromeType | string, app: string): string;
export function chromeTypeOfSettingsId(id: unknown): ChromeType | null;
export function CHROME_SETTINGS_PICK_KEY(type: string): string;
export function CHROME_SETTINGS_PATCH_KEY(type: string): string;
export function CHROME_INSTANCE_KEY(type: string, instance: string): string;
export function CHROME_INSTANCE_ASSET_KEY(type: string, instance: string): string;
export function TAB_GROUP_LAST_KEY(instance: string): string;
export function TAB_GROUP_FOLD_KEY(instance: string): string;
export function isChromeInstanceId(id: unknown): id is string;
export const CHROME_TARGETS: Record<ChromeType, string[]>;
export function chromeTypeOfTarget(target: unknown): ChromeType | null;
export const CHROME_MOVES: Record<ChromeType, ChromeMove>;
export const POSITION_LABELS: Record<ChromePosition, string>;
export const CHROME_FIELDS: Record<ChromeType, ChromeField[]>;
export const CHROME_SETTINGS_TABS: ChromeSettingsTab[];
export function normalizeInstanceOverride(type: string, raw: unknown): Record<string, string | number | boolean>;
export function chromeInstanceData<T extends object>(type: string, base: T | null | undefined, override: unknown): T;
export function chromeFieldValue(type: string, base: unknown, override: unknown, key: string): unknown;
export function chromeSettingsErrors(asset: unknown): string[];
export function resolveSettingsChain(get: (id: string) => AssetLike | null | undefined, id: string, seen?: string[]): Record<string, unknown> | null;
export function chromeSettingsPick(saved: unknown, type: ChromeType | string, ids: string[]): string | null;
export function chromeSettingsChoices(type: ChromeType | string, assets: AssetLike[]): ChromeSettingsChoice[];
export function customCopy(defaultAsset: AssetLike, app: string | { id: string; name?: string }): { $axf: 'asset@1'; type: 'settings'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: Record<string, unknown> };
export function chromeSettingsPlan(appId: string): ChromeSettingsPlanEntry[];
export function chromeSettingsMissing(appId: string, ids: string[]): string[];
