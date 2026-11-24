/** Types for build-id.mjs (build-id@1: internal build names, max 40 characters). */
export const SCHEMA: 'build-id@1';
export const BUILD_ID_MAX: 40;
export const BUILD_ID_RE: RegExp;
export const FALLBACK_ID: 'build';
export const FILLER: Set<string>;
export function isBuildId(id: unknown): boolean;
export function slugWords(text: unknown): string;
export function cutAtDash(s: string, max?: number): string;
export function shortBuildId(text: unknown, max?: number): string;
export function uniqueBuildId(text: unknown, taken?: Set<string> | Iterable<string> | ((id: string) => boolean)): string;
export function namesOf(b: { id?: string; alias?: string } | null | undefined): string[];
export function planAliases(builds: Array<{ id?: string; alias?: string }>): Array<{ id: string; alias: string }>;
