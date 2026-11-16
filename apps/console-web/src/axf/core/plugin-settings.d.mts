// Types for plugin-settings.mjs (plugin-settings@1: the `settings` block of a plugin@1 manifest).
export interface PluginSettingsBlock {
  $axf: 'plugin-settings@1';
  /** its Settings → Plugins sub-tab (the `settings-tab:<id>` it provides) */
  tab: string;
  parent: 'plugins';
  /** what the tab shows, in order; enable, info and logs lead on every plugin */
  sections: string[];
  /** the real option keys it registers under its tab */
  options: string[];
  /** a gear on its screen header opens the tab (true whenever it has a screen) */
  gear: boolean;
}
export interface PluginSettingsTarget {
  tab: string;
  /** console-control@1 address of the sub-tab ('' when the plugin has no usable tab id) */
  address: string;
  /** the runtime action that opens it (settings.open:<tab>; '' when none) */
  action: string;
  /** the gear's accessible name: "<Plugin> settings" */
  label: string;
  gear: boolean;
}
export interface PluginSettingsOptions { folder?: string }
export interface PluginSettingsCheckOptions extends PluginSettingsOptions { required?: boolean }

export const SCHEMA: 'plugin-settings@1';
export const VERSION: 1;
export const PARENT: 'plugins';
export const DEFAULT_SECTIONS: readonly string[];
export const BUILTIN_SECTIONS: readonly string[];
export const KEYS: readonly string[];
export const SETTINGS_VIEW: 'view:settings';
export const SETTINGS_TAB_ROW: 'settings.tabs';
export const SETTINGS_SUBTAB_ROW: 'settings.subtabs';
export const TAB_ID: RegExp;
export const SECTION_ID: RegExp;
export const OPTION_KEY: RegExp;
export const REGISTRY: Readonly<{ schema: string; version: number; parent: string; keys: readonly string[]; defaultSections: readonly string[]; builtinSections: readonly string[] }>;

export function pluginViews(manifest: unknown): string[];
export function pluginSettingsTabs(manifest: unknown): string[];
export function hasScreen(manifest: unknown): boolean;
export function defaultSettings(manifest: unknown, opts?: PluginSettingsOptions): PluginSettingsBlock;
export function normalizeSettings(manifest: unknown, opts?: PluginSettingsOptions): PluginSettingsBlock;
export function checkSettings(manifest: unknown, opts?: PluginSettingsCheckOptions): string[];
export function settingsAddress(tab: string): string;
export function settingsOpenAction(tab: string): string;
export function settingsTarget(manifest: unknown, opts?: PluginSettingsOptions): PluginSettingsTarget;
