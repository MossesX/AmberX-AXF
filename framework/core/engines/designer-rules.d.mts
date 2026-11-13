/** Types for designer-rules.mjs (designer@1, designer-addon@1, designed@1, embed-asset@1, asset-context@1). */
import type { MenuEntry } from './windows';

export type DesignerCapability = 'canvas' | 'tree' | 'preview' | 'context-menu' | 'drag-drop' | 'multi-select' | 'undo' | 'map' | 'voice' | 'api' | 'standalone' | 'embedded';
export type DesignerDropKind = 'node' | 'palette' | 'asset' | 'action' | 'hook' | 'embed' | 'text' | 'file';
export type ManifestFieldKind = 'text' | 'number' | 'toggle' | 'choice' | 'asset' | 'action' | 'list';
export type DesignerLevel = 'simple' | 'basic' | 'developer' | 'administrator';
export type DesignerPanel = 'library' | 'layers' | 'inspector' | 'preview' | 'help' | 'history';
export type DesignerPanelSide = 'left' | 'right' | 'bottom' | 'float' | 'hidden';
export type AssetInfoMode = 'tooltip' | 'hover-card' | 'side-panel' | 'help-text' | 'say';
export type EmbedTargetKind = 'ui' | 'plugin' | 'command' | 'url' | 'asset';
export type EmbedHost = 'toolbar' | 'tab-group' | 'grid-row' | 'banner' | 'region' | 'dialog';

export interface ManifestField { key: string; label: string; kind: ManifestFieldKind; options?: string[]; required?: boolean; default?: string | number | boolean }

/** designer-addon@1: what a designer add-on declares. */
export interface DesignerAddon {
  $axf: 'designer-addon@1';
  id: string; label: string; icon: string;
  /** the asset types it designs */
  types: string[];
  /** the standalone plugin's id and folder */
  plugin: string; folder: string;
  /** its standalone screen (view id) */
  view: string;
  /** its settings interface: a `settings` asset (`designer-<addon>`, for designer:<addon>, extends designer) */
  settings: string;
  /** its designer interface: a `designer` asset (`<addon>`, extends default) */
  interface: string;
  capabilities: DesignerCapability[];
  drops: DesignerDropKind[];
  /** the node kinds of its document it exposes (default: every kind of the type's family) */
  nodes?: string[];
  /** extra manifest fields written into designed.extras */
  manifest: { fields: ManifestField[] };
  voice: string[];
  standalone: boolean;
  version: string;
  detail?: string;
}
export interface DesignerAddonChoice { id: string; label: string; icon: string; types: string[]; plugin: string; installed: boolean; view: string; settings: string; interface: string }

/** A field of the designer interface (dotted path into data). */
export interface DesignerField { key: string; label: string; kind: 'choice' | 'toggle' | 'number' | 'text'; options?: string[]; labels?: Record<string, string>; min?: number; max?: number; default: string | number | boolean; group: string; level: DesignerLevel }
/** The `designer` asset's data, every field present (normalizeDesigner). */
export interface DesignerInterfaceData {
  for?: string; extends?: string;
  canvas: { mode: 'free' | 'flow' | 'both'; grid: number; snap: boolean; zoomMin: number; zoomMax: number; rulers: boolean; guides: boolean };
  panels: Record<DesignerPanel, DesignerPanelSide>;
  preview: { mode: 'inline' | 'floating' | 'docked'; device: 'desktop' | 'phone' | 'both'; refresh: 'live' | 'on-save' };
  info: { tooltip: boolean; hoverCard: boolean; sidePanel: boolean; helpText: boolean; say: boolean };
  context: { preview: boolean; insert: boolean; arrange: boolean; clipboard: boolean; help: boolean };
  history: { limit: number; coalesceMs: number };
  output: { to: 'app' | 'framework' | 'hub'; idPrefix: string; register: boolean; version: 'patch' | 'minor' | 'keep' };
  voice: boolean; autosave: boolean;
}

/** The `embed` asset's data (embed-asset@1). */
export interface EmbedAssetData {
  target: { kind: EmbedTargetKind; id?: string; url?: string; params?: Record<string, unknown> };
  manifest?: string; label?: string; icon?: string;
  size?: { width?: 'auto' | number; height?: 'auto' | number; minHeight?: number; maxHeight?: number };
  hosts?: EmbedHost[]; load?: 'live' | 'lazy' | 'snapshot'; sandbox?: boolean; expand?: 'inline' | 'side' | 'popout'; passData?: boolean; remember?: boolean;
}

/** designed@1: the manifest a designed asset carries in its envelope (`designed`). */
export interface DesignedManifest {
  $axf: 'designed@1';
  /** the identifier: never changes, survives renames */
  uid: string;
  ref: string; type: string; id: string; name: string; version: string;
  addon: string; designer: 'designer@1';
  app?: string; by?: string;
  createdAt: string; updatedAt: string; revision: number;
  origin?: { said?: string; source?: string; at?: string };
  registry: { kind: string; id: string; aliases: string[] };
  extras?: Record<string, string | number | boolean | unknown[]>;
  hash: string;
}
export interface DesignedRegistryItem { id: string; kind: string; label: string; aliases: string[]; owner: string; source: 'declared'; open: { via: 'action'; action: string }; detail: string; icon: string; keywords: string[]; effect: 'navigate'; app?: string }
export interface DesignerLibraryEntry { uid: string; ref: string; type: string; id: string; name: string; addon: string; revision: number; updatedAt: string; app?: string; path: string }
export interface DesignerLibrary { $axf: 'designer-library@1'; items: DesignerLibraryEntry[] }
export interface DesignerAssetLike { $axf?: string; type: string; id: string; name?: string; version?: string; description?: string; tags?: string[]; data?: Record<string, unknown>; designed?: DesignedManifest }

export interface AssetHoverCard { title: string; subtitle: string; lines: string[]; preview: string }
export interface AssetSidePanel { title: string; sections: { label: string; rows: [string, string][] }[] }
export interface AssetHelpEntry { id: string; kind: string; title: string; text: string; more: string }

export const DESIGNER_CONTRACT: 'designer@1';
export const DESIGNER_ADDON_FRAME: 'designer-addon@1';
export const DESIGNED_FRAME: 'designed@1';
export const DESIGNER_LIBRARY_FRAME: 'designer-library@1';
export const EMBED_ASSET_CONTRACT: 'embed-asset@1';
export const ASSET_CONTEXT_CONTRACT: 'asset-context@1';
export const DESIGNER_TYPE: 'designer';
export const EMBED_TYPE: 'embed';
export const DESIGNER_HOST_PLUGIN: string;
export const DESIGNER_HOST_FOLDER: string;
export const DESIGNER_SERVICE: 'axf.designer@1';
export const DESIGNER_ADDON_SERVICE: 'axf.designer-addon@1';
export const DESIGNER_PLUGIN_PREFIX: string;
export const DESIGNER_DEFAULT_ID: 'default';
export const DESIGNER_SETTINGS_ID: 'designer';
export const DESIGNER_SETTINGS_FOR: RegExp;
export const ASSET_ATTR: 'data-axf-asset';
export const ASSET_ID_PATTERN: string;
export const DESIGNER_DROP_MIME: string;
export const DESIGNER_LIMITS: Record<string, number>;
export const DESIGNER_WIDGET_TYPES: string[];
export const UI_ASSET_TYPES: string[];
export const UI_ASSET_LABELS: Readonly<Record<string, string>>;
export const UI_ASSET_ICONS: Readonly<Record<string, string>>;
export const DESIGNED_UI_KIND: Readonly<Record<string, string>>;
export const DESIGNER_CAPABILITIES: DesignerCapability[];
export const DESIGNER_DROP_KINDS: DesignerDropKind[];
export const MANIFEST_FIELD_KINDS: ManifestFieldKind[];
export const DESIGNER_ADDONS: readonly DesignerAddon[];
export const DESIGNER_ADDON_IDS: string[];
export const DESIGNER_FIELDS: readonly DesignerField[];
export const DESIGNER_FIELD_GROUPS: string[];
export const DESIGNER_PANELS: DesignerPanel[];
export const DESIGNER_PANEL_SIDES: DesignerPanelSide[];
export const DESIGNER_DEFAULT: Readonly<DesignerInterfaceData>;
export const EMBED_TARGET_KINDS: EmbedTargetKind[];
export const EMBED_HOSTS: EmbedHost[];
export const EMBED_LOADS: string[];
export const EMBED_EXPANDS: string[];
export const EMBED_SIZE_MAX: number;
export const DESIGNED_UID: RegExp;
export const ASSET_INFO_MODES: AssetInfoMode[];
export const ASSET_CONTEXT_KEYS: { on: string; preview: string; info: string; perType: (t: string) => string };
export const ASSET_CONTEXT_ACTIONS: { preview: string; about: string; copyId: string; usage: string; help: string; edit: string; change: string };
export const DESIGNER_ACTIONS: { open: string; new: string; preview: string; save: string; publish: string };

export function slug(s: unknown): string;
export function designerSettingsId(addon?: string): string;
export function designerSettingsFor(addon?: string): string;
export function isUiAssetType(t: unknown): boolean;
export function assetTypeLabel(t: string): string;
export function assetTypeIcon(t: string): string;
export function designedUiKind(type: string): string;
export function normalizeManifestField(raw: unknown): ManifestField | null;
export function normalizeDesignerAddon(raw: unknown, defaults?: { plugin?: string; folder?: string }): DesignerAddon | null;
export function designerAddonErrors(raw: unknown): string[];
export function addonsFromPluginManifest(manifest: unknown, folder?: string): DesignerAddon[];
export function mergeAddons(...lists: unknown[][]): DesignerAddon[];
export function addonForType(addons: DesignerAddon[], type: string): DesignerAddon | null;
export function designerAddonChoices(addons: DesignerAddon[], installed?: string[]): DesignerAddonChoice[];
export function addonProvides(a: DesignerAddon): string[];
export function normalizeDesigner(raw: unknown): DesignerInterfaceData;
export function designerInterfaceErrors(raw: unknown): string[];
export function resolveDesignerChain(get: (id: string) => DesignerAssetLike | null | undefined, id: string): DesignerInterfaceData | null;
export function designerInterfacePick(addonId: string, ids: string[]): string | null;
export function designerCopy(defaultAsset: DesignerAssetLike, addon: DesignerAddon): DesignerAssetLike;
export function designerSettingsCopy(hostSettings: DesignerAssetLike, addon: DesignerAddon): DesignerAssetLike;
export function designerSettingsErrors(asset: unknown): string[];
export function designerPlan(addons?: readonly DesignerAddon[]): { addon: string; interfaceId: string; settingsId: string }[];
export function designerMissing(designerIds: string[], settingsIds: string[], addons?: readonly DesignerAddon[]): string[];
export function normalizeEmbed(raw: unknown): EmbedAssetData | null;
export function embedAssetErrors(raw: unknown): string[];
export function designerErrors(type: string, data: unknown): string[];
export function designerSchemaProperties(type: string): Record<string, unknown>;
export function assetRef(type: string, id: string): string;
export function parseAssetRef(ref: unknown): { type: string; id: string } | null;
export function designedHash(value: unknown): string;
export function designedUid(now?: number, rand?: number): string;
export function makeDesigned(opts: { asset: DesignerAssetLike; addon?: DesignerAddon | string; app?: string; by?: string; now?: string; uid?: string; previous?: DesignedManifest | null; origin?: { said?: string; source?: string; at?: string } | null; aliases?: string[]; extras?: Record<string, unknown>; output?: DesignerInterfaceData['output'] }): DesignedManifest;
export function withDesigned<T extends DesignerAssetLike>(asset: T, manifest: DesignedManifest): T & { designed: DesignedManifest };
export function designedOf(asset: unknown): DesignedManifest | null;
export function designedErrors(raw: unknown, asset?: unknown): string[];
export function designedRegistryItem(manifest: DesignedManifest, opts?: { ownerFolder?: string }): DesignedRegistryItem | null;
export function designedLibraryEntry(manifest: DesignedManifest, path?: string): DesignerLibraryEntry;
export function designedLibraryPath(manifest: DesignedManifest, to?: 'app' | 'framework' | 'hub', app?: string): string;
export function normalizeDesignerLibrary(raw: unknown): DesignerLibrary;
export function upsertDesignerLibrary(lib: unknown, entry: DesignerLibraryEntry): DesignerLibrary;
export function designedIdErrors(id: unknown, opts?: { existing?: string[]; builtin?: string[]; prefix?: string }): string[];
export function suggestAssetId(name: string, opts?: { existing?: string[]; prefix?: string }): string;
export function assetHelpId(ref: string): string;
export function assetSummary(asset: DesignerAssetLike): string;
export function assetInfo(asset: DesignerAssetLike, mode: 'tooltip' | 'say', ctx?: { manifest?: DesignedManifest | null; usedIn?: string[] }): string | null;
export function assetInfo(asset: DesignerAssetLike, mode: 'hover-card', ctx?: { manifest?: DesignedManifest | null; usedIn?: string[] }): AssetHoverCard | null;
export function assetInfo(asset: DesignerAssetLike, mode: 'side-panel', ctx?: { manifest?: DesignedManifest | null; usedIn?: string[] }): AssetSidePanel | null;
export function assetInfo(asset: DesignerAssetLike, mode: 'help-text', ctx?: { manifest?: DesignedManifest | null; usedIn?: string[] }): AssetHelpEntry | null;
export function assetInfo(asset: DesignerAssetLike, mode: AssetInfoMode, ctx?: { manifest?: DesignedManifest | null; usedIn?: string[] }): unknown;
export function assetContextSection(asset: DesignerAssetLike, opts?: { addon?: DesignerAddon | null; interface?: Partial<DesignerInterfaceData>; isChrome?: boolean; usedIn?: string[]; manifest?: DesignedManifest | null }): MenuEntry[];
export function assetRefFromAttr(value: unknown): { type: string; id: string } | null;
