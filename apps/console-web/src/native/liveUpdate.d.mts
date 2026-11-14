/** Types for liveUpdate.mjs (an open console follows the live deploy). */
export declare const MIN_GAP_MS: number;
export declare const PERIOD_MS: number;
export declare function entryOf(html: unknown): string;
export declare function pathOf(src: unknown): string;
export declare function decide(s: { loaded: string; live: string; hidden: boolean; wrapper: boolean }): 'none' | 'reload' | 'notify';
export declare function due(lastAt: number, now: number, forced?: boolean): boolean;
