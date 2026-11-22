/** Types for settings-iface-rules.mjs (settings-iface@1). */

export type SettingsIfaceKind = 'app' | 'asset' | 'plugin' | 'chrome';
export interface SettingsIfaceAssetLike { id: string; name?: string; description?: string; data?: Record<string, unknown> }
export interface SettingsIfaceChoice { id: string; name: string; description: string; isDefault: boolean }
export interface SettingsIfacePick { id: string | null; defaultId: string | null; locked: boolean; source: 'pick' | 'default' }

export const SETTINGS_IFACE_CONTRACT: 'settings-iface@1';
export const SETTINGS_IFACE_KINDS: SettingsIfaceKind[];
export const SETTINGS_IFACE_FIELD: 'builtFor';
export const SETTINGS_IFACE_DEFAULT_PREFIX: 'default-';
export const SETTINGS_IFACE_PLUGIN_SUFFIX: '-plugin';
export const SETTINGS_IFACE_KEY_PREFIX: 'axf.settings.iface.';
export const SETTINGS_IFACE_DEFAULT_DATA: Record<string, unknown>;

export function parseBuiltFor(v: unknown): { kind: SettingsIfaceKind; name: string } | null;
export function ifaceOwner(kind: string, name?: string): string | null;
export function builtForErrors(v: unknown): string[];
export function pluginIfaceName(moduleId: unknown): string;
export function ifaceDefaultId(owner: string, assetTypes?: readonly string[]): string | null;
export function ifaceKey(owner: string): string | null;
export function ownerOfIfaceKey(key: unknown): string | null;
export function builtForOf(asset: SettingsIfaceAssetLike | null | undefined, assetTypes?: readonly string[]): string;
export function ifaceDefaultAsset(owner: string, opts?: { label?: string; assetTypes?: readonly string[] }): { $axf: 'asset@1'; type: 'settings'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: Record<string, unknown> } | null;
export function ifaceChoices(owner: string, assets: readonly SettingsIfaceAssetLike[], assetTypes?: readonly string[]): SettingsIfaceChoice[];
export function ifacePick(saved: unknown, owner: string, assets: readonly SettingsIfaceAssetLike[], assetTypes?: readonly string[]): SettingsIfacePick;
export function ifaceSet(owner: string, which: unknown, assets: readonly SettingsIfaceAssetLike[], assetTypes?: readonly string[]): { value: string | null; error?: undefined } | { error: string; value?: undefined };
export function parseIfaceArgs(args: readonly unknown[]): { owner: string; which: string } | null;
export function layerIface(appData: unknown, ownData: unknown): Record<string, unknown>;
export function ifacePickList(saved: unknown): { owner: string; interface: string }[];
