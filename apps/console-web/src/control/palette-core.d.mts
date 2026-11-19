/** Types for palette-core.mjs (command palette rules, the pure part). */
export interface PaletteHit { address: string; kind: string; label: string; detail?: string; icon?: string; value?: string; recent?: boolean }
export interface PaletteMeta { personOnly?: boolean; ownerRaise?: boolean; locked?: boolean; destructive?: boolean }
export declare const DECIDING_RE: RegExp;
export declare const DESTRUCTIVE_RE: RegExp;
export declare const RECENT_MAX: number;
export declare const PALETTE_LOOKS: readonly string[];
export declare const PALETTE_LOOK_KEY: 'console.palette.look';
export declare const PALETTE_RECENT_KEY: 'axf.palette.recent';
export declare function listable(hit: PaletteHit, meta?: PaletteMeta | null): boolean;
export declare function destructive(hit: PaletteHit, meta?: PaletteMeta | null): boolean;
export declare function verbFor(hit: PaletteHit): 'press' | 'focus';
export declare function pushRecent(list: PaletteHit[] | null | undefined, hit: PaletteHit): PaletteHit[];
export declare function withRecentFirst<T extends PaletteHit>(hits: T[], recent: PaletteHit[] | null | undefined): (T & { recent?: boolean })[];
export declare function paletteLook(id: unknown): string;
