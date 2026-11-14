/** Types for browserFallback.mjs (the console outside the Android console app). */
export declare const WRAPPER_HOSTS: readonly string[];
export declare const WRAPPER_ATTR: 'data-axf-wrapper';
export declare const APP_ONLY: string;
export declare function wrapperEnv(win: unknown): { wrapper: boolean; hosts: string[]; mode: 'app' | 'browser' };
export declare function sameOrigin(url: string, origin: string): boolean;
export declare function browserPlan(id: string, args: readonly string[] | undefined, origin?: string): { error: string } | { do: string; [k: string]: unknown };
export declare function browserCapabilities(win: unknown): { notifications: string; mic: boolean; standalone: boolean };
