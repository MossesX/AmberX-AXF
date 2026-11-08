export declare const DEEP_LINK_FRAME: 'deep-link@1';
export declare const DEEP_LINK_PARAMS: Readonly<{ view: 'axf-view'; dialog: 'axf-dialog'; settings: 'axf-settings'; do: 'axf-do' }>;
export declare const DEEP_LINK_EFFECTS: readonly ('navigate' | 'read')[];
export declare const DEEP_LINK_MAX_DO: number;
export interface DeepLinkParts { view?: string; dialog?: string; settings?: string; do?: string | string[]; base?: string }
export interface ParsedDeepLink { view: string; dialog: string; settings: string; do: string[]; errors: string[] }
export declare function isDeepLinkView(v: unknown): boolean;
export declare function isDeepLinkDialog(v: unknown): boolean;
export declare function isDeepLinkSettings(v: unknown): boolean;
export declare function isDeepLinkAction(v: unknown): boolean;
export declare function deepLink(parts: DeepLinkParts): string;
export declare function parseDeepLink(search: string): ParsedDeepLink;
export declare function hasDeepLink(search: string): boolean;
export declare function stripDeepLink(search: string): string;
export declare function deepLinkRefusal(meta: { effect?: string; personOnly?: boolean } | null | undefined): string;
