// Types for menugen.mjs (nested-menu@1: generated nested menus from an app's UI registry).
import type { AppMenuData, NavMenuData } from '../types';

export type MenuSourceKind = 'page' | 'dialog' | 'settings' | 'action' | 'list' | 'app';

/** One registry entry as an app or a CLI hands it in (anything missing is derived). */
export interface MenuSourceInput {
  id?: string;
  label?: string;
  icon?: string;
  /** action spec (`nav:home`, `dialog:x`, `settings.open:x`, any registered action); or a live list `provider` */
  action?: string;
  provider?: string;
  kind?: MenuSourceKind;
  /** the library / plugin that brought it (`app` = the app itself) and its human label */
  module?: string;
  moduleLabel?: string;
  /** declared category id (MENU_CATEGORIES or an added one) and sub category label */
  category?: string;
  subcategory?: string;
  keywords?: string[];
  /** the menu or nav section it came from: a weak hint for the category */
  hint?: string;
  hintId?: string;
  requires?: string;
  badge?: string;
  shortcut?: string;
  order?: number;
  view?: string;
}

/** A cleaned entry. */
export interface MenuSource {
  id: string;
  kind: MenuSourceKind;
  label: string;
  icon?: string;
  action?: string;
  provider?: string;
  view?: string;
  module: string;
  moduleLabel: string;
  keywords: string[];
  category?: string;
  subcategory?: string;
  hint?: string;
  hintId?: string;
  requires?: string;
  badge?: string;
  shortcut?: string;
  order?: number;
}

export interface MenuCategory { id: string; label: string; icon: string; words: string[]; aliases?: string[]; order?: number; off?: boolean }
export type CategoryOverride = Partial<Pick<MenuCategory, 'label' | 'icon' | 'words' | 'order' | 'off'>>;

export interface NestedMenuOptions {
  app?: string;
  appLabel?: string;
  header?: string;
  maxPerLevel?: number;
  maxDepth?: number;
  recentsMax?: number;
  showFavorites?: boolean;
  showRecents?: boolean;
  groupByPlugin?: boolean;
  style?: 'list' | 'rail' | 'pills';
  favorites?: string[];
  recents?: string[];
  /** category ids or entry ids left out */
  hidden?: string[];
  categories?: Record<string, CategoryOverride>;
  jumpAction?: string;
}

export interface NormalizedOptions {
  app: string; appLabel: string; header: string; maxPerLevel: number; maxDepth: number; recentsMax: number; showFavorites: boolean; showRecents: boolean; groupByPlugin: boolean;
  style: 'list' | 'rail' | 'pills'; favorites: string[]; recents: string[]; hidden: Set<string>; categories: MenuCategory[]; jumpAction: string;
}

export type MenuNode = { src: MenuSource; group?: undefined } | { group: { id: string; label: string; icon: string }; items: MenuNode[]; src?: undefined };

export interface MenuIndexEntry {
  id: string; kind: MenuSourceKind; label: string; path: string[]; keywords: string[];
  icon?: string; action?: string; provider?: string; view?: string; requires?: string; module?: string;
}

export interface NestedMenuStats {
  sources: number; hidden: number; shown: number; placed: number; unplaced: number; categories: number; groups: number; deepest: number; widest: number; maxPerLevel: number; favorites: number; recents: number;
  perCategory: Record<string, number>;
}

export interface NestedMenuTree {
  $axf: 'nested-menu@1';
  app: string;
  categories: { id: string; label: string; icon: string; nodes: MenuNode[]; count: number }[];
  favorites: MenuSource[];
  recents: MenuSource[];
  index: MenuIndexEntry[];
  stats: NestedMenuStats;
  notes: string[];
  options: Omit<NormalizedOptions, 'hidden' | 'categories'> & { hidden: string[]; categories: undefined };
}

export interface GeneratedMenuAssets {
  tree: NestedMenuTree;
  appMenu: { $axf: 'asset@1'; type: 'app-menu'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: AppMenuData };
  navMenu: { $axf: 'asset@1'; type: 'nav-menu'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: NavMenuData };
  index: MenuIndexEntry[];
  stats: NestedMenuStats;
  notes: string[];
}

export interface MenuFieldSpec { kind: 'boolean' | 'number' | 'enum' | 'list'; default: unknown; min?: number; max?: number; options?: readonly string[]; title: string; text: string }

export const NESTED_MENU_FRAME: 'nested-menu@1';
export const GENERATED_SUFFIX: '-generated';
export const MENU_SOURCE_KINDS: readonly MenuSourceKind[];
export const KIND_LABELS: Record<MenuSourceKind, string>;
export const KIND_ICONS: Record<MenuSourceKind, string>;
export const NESTED_MENU_KEYS: { override: string; maxPerLevel: string; recentsMax: string; favorites: string; recents: string; hidden: string; style: string; showFavorites: string; showRecents: string; groupByPlugin: string; previous: string };
export const NESTED_MENU_FIELDS: Record<'override' | 'maxPerLevel' | 'recentsMax' | 'showFavorites' | 'showRecents' | 'groupByPlugin' | 'style' | 'hidden' | 'favorites', MenuFieldSpec>;
export const NESTED_MENU_DEFAULTS: Readonly<{ maxPerLevel: number; maxDepth: number; recentsMax: number; showFavorites: boolean; showRecents: boolean; groupByPlugin: boolean; style: 'list' }>;
export const NESTED_MENU_MAX_DEPTH: number;
export const MENU_CATEGORIES: readonly MenuCategory[];
export const FAVORITES_ID: 'favorites';
export const RECENTS_ID: 'recents';
export const JUMP_ACTION: 'menus.jump';

export function titleOf(id: string): string;
export function sourceIdOf(src: MenuSourceInput): string;
export function normalizeSource(raw: unknown): MenuSource | null;
export function normalizeSources(list: unknown): MenuSource[];
export function categoriesFor(opts?: NestedMenuOptions): MenuCategory[];
export function categorize(src: MenuSource, categories?: readonly MenuCategory[]): string;
export function layout(items: MenuSource[], opts: { max: number; depthLeft: number; groupByPlugin?: boolean; prefix: string }): MenuNode[];
export function normalizeOptions(opts?: NestedMenuOptions): NormalizedOptions;
export function buildNestedMenu(sources: unknown, opts?: NestedMenuOptions): NestedMenuTree;
export function toAppMenu(tree: NestedMenuTree, opts?: NestedMenuOptions): AppMenuData;
export function toNavMenu(tree: NestedMenuTree, opts?: NestedMenuOptions): NavMenuData;
export function generateMenuAssets(sources: unknown, opts?: NestedMenuOptions): GeneratedMenuAssets;
export function scoreIndexEntry(e: Pick<MenuIndexEntry, 'label' | 'path' | 'keywords' | 'kind' | 'id'>, query: string): number;
export function searchMenuIndex(index: MenuIndexEntry[], query: string, opts?: { max?: number; favorites?: string[]; recents?: string[] }): MenuIndexEntry[];
export function pushRecent(recents: string[] | unknown, id: string, max?: number): string[];
export function toggleFavorite(favorites: string[] | unknown, id: string, on?: boolean): string[];
export function menuFieldErrors(field: string, value: unknown): string[];
export function parseFieldValue(field: string, raw: unknown): unknown;
export function treeOutline(tree: NestedMenuTree, opts?: { nav?: boolean }): string;
