/** Types for skin-modes.mjs (skin-modes@1): every skin's light and dark colour themes. */
export declare const SKIN_MODES_CONTRACT: 'skin-modes@1';
export declare const SKIN_MODES: readonly ['light', 'dark', 'system'];
export declare const SKIN_SCHEMES: readonly ['light', 'dark'];
export type SkinMode = 'light' | 'dark' | 'system';
export type SkinScheme = 'light' | 'dark';
type SkinLike = unknown;
type ThemeLike = unknown;
export declare function skinModePair(skin: SkinLike | null | undefined): { light: string; dark: string };
export declare function isSkinMode(v: unknown): v is SkinMode;
export declare function effectiveScheme(mode: string, prefersDark?: boolean | string): SkinScheme;
export declare function skinModeColor(skin: SkinLike | null | undefined, mode: string, prefersDark?: boolean | string): { scheme: SkinScheme; theme: string; pick: string };
export declare function skinSchemeOf(skin: SkinLike | null | undefined, themeId: string): SkinScheme | '';
export declare function skinModeProblems(skins: SkinLike[] | null | undefined, themes: ThemeLike[] | null | undefined): string[];
export declare function skinModeRows(skins: SkinLike[] | null | undefined): { id: string; name: string; light: string; dark: string; own: string; ownScheme: SkinScheme | '' }[];
