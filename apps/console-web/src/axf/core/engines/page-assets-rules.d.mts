/** Types for page-assets-rules.mjs (page-assets@1). */

export type PageAssetType = 'toolbar' | 'tab-group' | 'nav-menu' | 'app-menu' | 'banner' | 'widget' | 'grid' | 'container';
export type PageAssetColour = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'muted';
export interface PageAssetSummary { id: string; type: PageAssetType; label: string; hidden: boolean }

export const PAGE_ASSETS_CONTRACT: 'page-assets@1';
export const PAGE_ASSET_TYPES: PageAssetType[];
export const PAGE_ASSET_LABELS: Record<PageAssetType, string>;
export const PAGE_ASSET_ICONS: Record<PageAssetType, string>;
export const PAGE_ASSET_COLOURS: PageAssetColour[];
export const PAGE_ASSET_DEFAULT_COLOURS: Record<PageAssetType, PageAssetColour>;
export const PAGE_ASSET_HIDDEN_DEFAULT: PageAssetColour;
export const PAGE_ASSETS_HIDDEN_KEY: string;
export function PAGE_ASSET_COLOUR_KEY(type: string): string;
export const PAGE_ASSET_HIDDEN_COLOUR_KEY: string;
export const PAGE_ANY: '*';
export const PAGE_ASSETS_HIDDEN_MAX: number;
export const PAGE_ASSET_HIGHLIGHT_MS: number;
export const PAGE_ASSET_HIGHLIGHT_MAX: number;

export function isPageAssetType(t: unknown): t is PageAssetType;
export function pageAssetLabel(t: string): string;
export function isPageAssetColour(c: unknown): c is PageAssetColour;
export function pageAssetSlug(label: unknown): string;
export function pageAssetId(type: string, instance: string): string;
export function parsePageAssetId(id: unknown): { type: PageAssetType; instance: string } | null;
export function normalizeHiddenAssets(raw: unknown): string[];
export function isAssetHidden(hidden: unknown, page: string, id: string): boolean;
export function withAssetHidden(hidden: unknown, page: string, id: string, on: boolean): string[];
export function hiddenOnPage(hidden: unknown, page: string): string[];
export function pageAssetColourOf(type: string, value: unknown): PageAssetColour;
export function pageAssetHiddenColourOf(value: unknown): PageAssetColour;
export function pageAssetHighlightMs(raw: unknown): number;
export function normalizePageAssetSummary(raw: unknown): PageAssetSummary[];
