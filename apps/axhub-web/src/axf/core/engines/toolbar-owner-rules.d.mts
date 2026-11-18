/** Types for toolbar-owner-rules.mjs (toolbar-owner@1: generic or screen toolbars, a locked default per plugin). */
export declare const TOOLBAR_OWNER_CONTRACT: 'toolbar-owner@1';
export declare const TOOLBAR_OWNER_FIELD: 'builtFor';
export declare const TOOLBAR_GENERIC: 'generic';
export declare const TOOLBAR_SCREEN_KINDS: readonly ['view', 'plugin'];
export declare const TOOLBAR_DEFAULT_PREFIX: 'default-';
export declare const TOOLBAR_DEFAULT_SUFFIX: '-toolbar';
export declare const TOOLBAR_PLACEHOLDER_TAG: 'placeholder';
export declare const TOOLBAR_LOOK_KEYS: readonly string[];

export interface ToolbarOwnerAsset { id: string; type?: string; name?: string; description?: string; tags?: string[]; data?: Record<string, unknown> | object }
export interface ToolbarOwnerPage { view?: string | null; plugin?: string | null; slot?: string | null }
export interface ToolbarBuiltFor { kind: 'generic' | 'view' | 'plugin'; id: string }
export interface ToolbarChoice { id: string; name: string; description: string; builtFor: string; generic: boolean; isDefault: boolean }
export interface ToolbarPickResult { id: string | null; defaultId: string | null; locked: boolean; source: 'pick' | 'default'; generic: boolean }

export declare function toolbarPluginName(moduleId: unknown): string;
export declare function parseToolbarBuiltFor(v: unknown): ToolbarBuiltFor | null;
export declare function toolbarBuiltForErrors(v: unknown): string[];
export declare function pluginToolbarDefaultId(plugin: unknown): string | null;
export declare function pluginOfToolbarDefaultId(id: unknown): string | null;
export declare function toolbarBuiltForOf(asset: unknown): string;
export declare function isGenericToolbar(asset: unknown): boolean;
export declare function toolbarBuiltForPage(builtFor: unknown, page: ToolbarOwnerPage | null | undefined): boolean;
export declare function toolbarIsForScreen(asset: unknown, page: ToolbarOwnerPage | null | undefined): boolean;
export declare function pluginToolbarDefaultAsset(plugin: unknown, opts?: { label?: string }): (ToolbarOwnerAsset & { $axf: 'asset@1'; type: 'toolbar'; data: Record<string, unknown> }) | null;
export declare function toolbarScopedTo(asset: unknown, page: ToolbarOwnerPage | null | undefined, kind: 'view' | 'plugin'): boolean;
export declare function pageDefaultToolbar<T extends ToolbarOwnerAsset>(page: ToolbarOwnerPage | null | undefined, assets: readonly T[]): T | null;
export declare function isPlaceholderToolbar(asset: unknown): boolean;
export declare function toolbarChoices(page: ToolbarOwnerPage | null | undefined, assets: readonly ToolbarOwnerAsset[]): ToolbarChoice[];
export declare function toolbarPick(saved: unknown, page: ToolbarOwnerPage | null | undefined, assets: readonly ToolbarOwnerAsset[]): ToolbarPickResult;
export declare function toolbarPickSet(page: ToolbarOwnerPage | null | undefined, which: unknown, assets: readonly ToolbarOwnerAsset[]): { value: string | null } | { error: string };
export declare function toolbarLookOnly(data: unknown): Record<string, unknown>;
export declare function toolbarNonLookKeys(data: unknown): string[];
export declare function layerToolbarLook<T extends object>(ownData: T, pickedData: unknown): T;
