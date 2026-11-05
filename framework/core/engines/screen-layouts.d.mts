// Types for screen-layouts.mjs (screen-layouts@1: three layouts per plugin screen, the shared layout-switcher toolbar).
export const SCREEN_LAYOUTS_SCHEMA: 'screen-layouts@1';
export const LAYOUT_SWITCHER_TOOLBAR: 'layout-switcher';
export const LAYOUT_SWITCHER_QUALIFIED: 'axf.toolbar.layout-switcher';
export const SCREEN_LAYOUTS_PROVIDER: 'screen-layouts';
export const MIN_LAYOUTS: number;
export const MAX_LAYOUTS: number;
export const LAYOUT_ID: RegExp;
export const VIEW_ID: RegExp;
export const ICON_ID: RegExp;
export const SCREEN_LAYOUT_KEYS: Readonly<{ toolbarDefault: string; perScreen: string; copy: string }>;
export const TOOLBAR_OVERRIDES: readonly ['inherit', 'show', 'hide'];
export const SCREEN_LAYOUT_ACTIONS: Readonly<{ pick: string; toolbar: string; copy: string; shared: string }>;
export const SCREEN_LAYOUT_CTX: Readonly<{ title: 'screen-title'; toolbar: 'layout-toolbar' }>;

export interface ScreenLayout { id: string; label: string; icon?: string; description?: string }
export interface ScreenSpec { layouts: ScreenLayout[]; default: string }
export type ScreensMap = Record<string, ScreenSpec>;

export const STARTER_LAYOUTS: readonly ScreenLayout[];
export const STARTER_DEFAULT: string;

export function screenLayoutKey(view: string): string;
export function screenToolbarKey(view: string): string;
export function toolbarCopyKey(pluginId: string): string;
export function viewOfLayoutKey(key: string): string | null;
export function copyAssetId(pluginId: string): string;

export function normalizeScreen(raw: unknown): ScreenSpec | null;
export function normalizeScreens(screens: unknown): ScreensMap;
export function checkScreen(view: string, raw: unknown, opts?: { enforceCount?: boolean; where?: string }): string[];
export function checkScreens(manifest: { screens?: unknown; provides?: unknown } | null | undefined, opts?: { enforceCount?: boolean; views?: string[] | null; grandfathered?: string[]; where?: string }): string[];
export function viewIdsInSource(text: string, readImport?: ((path: string) => string | null) | null): string[];
export function grandfathered(baseline: { screens?: string[] } | null | undefined, folder: string, view: string): boolean;

export function resolveScreenLayout(screen: unknown, saved: unknown): string;
export function layoutToolbarShown(get: (key: string) => unknown, view: string, screen: unknown): boolean;

export interface LayoutMenuRow { id: string; label: string; icon: string; action: string; checked: string; detail?: string; current?: boolean }
export interface LayoutMenuEntry { id: string; label?: string; icon?: string; action?: string; checked?: string; separator?: boolean }
export function layoutMenuItems(view: string, screen: unknown, current: string): LayoutMenuRow[];
export function screenTitleMenu(view: string, screen: unknown, shown: boolean): LayoutMenuEntry[];
export function layoutToolbarMenu(view: string, pluginId: string, hasCopy: boolean): LayoutMenuEntry[];

export interface ToolbarCopy { id: string; data: Record<string, unknown> }
export function parseToolbarCopy(raw: unknown, pluginId: string): ToolbarCopy | null;
export function newToolbarCopy(pluginId: string): ToolbarCopy;
export interface ResolvedLayoutToolbar { id: string; name: string; data: Record<string, unknown>; shared: boolean; inherits?: string; edited?: boolean }
export function resolveLayoutToolbar(shared: { id: string; name: string; data: Record<string, unknown> } | null | undefined, copy: ToolbarCopy | null | undefined, overrides?: { shared?: Record<string, unknown>; copy?: Record<string, unknown> }): ResolvedLayoutToolbar | null;

export interface ReviewLayoutChoices { view: string; options: { value: string; label: string; default: boolean }[]; disabled: boolean; reason: string; default: string }
export function reviewLayoutChoices(screens: unknown, view: string): ReviewLayoutChoices;
export function screensOfManifests(manifests: ({ id?: string; screens?: unknown } | null | undefined)[]): Record<string, ScreenSpec & { plugin: string }>;
