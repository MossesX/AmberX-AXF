/** Types for profile-filter.mjs (profile-filter@1). */
export const PROFILE_FILTER: 'profile-filter@1';
export interface ProfileFilter { $axf: 'profile-filter@1'; all: boolean; ids: readonly string[] }
export interface ProfileRef { id: string; name?: string; tone?: string; color?: string }
export type ProfilesOf<T> = (item: T) => string[];
export const ALL_PROFILES: ProfileFilter;
export const PROFILE_TONES: readonly ('accent' | 'success' | 'warning' | 'danger' | 'neutral')[];
export function normalizeFilter(raw: unknown, known?: string[]): ProfileFilter;
export function isAll(f: ProfileFilter | null | undefined): boolean;
export function itemProfiles(item: unknown): string[];
export function isVisible<T>(item: T, f: ProfileFilter, profilesOf?: ProfilesOf<T>): boolean;
export function applyFilter<T>(items: readonly T[] | null | undefined, f: ProfileFilter, profilesOf?: ProfilesOf<T>): { shown: T[]; hidden: number; total: number };
export function countsByProfile<T>(items: readonly T[] | null | undefined, profilesOf?: ProfilesOf<T>): Record<string, number>;
export function onlyProfile(id: string): ProfileFilter;
export function toggleProfile(f: ProfileFilter, id: string, known?: string[]): ProfileFilter;
export function filterLabel(f: ProfileFilter, profiles?: readonly ProfileRef[]): string;
export function filterNote(f: ProfileFilter, hidden: number, profiles?: readonly ProfileRef[]): string;
export function bulkLabel(verb: string, n: number, f: ProfileFilter, profiles?: readonly ProfileRef[]): string;
export function bulkSummary<T>(verb: string, items: readonly T[], f: ProfileFilter, profiles?: readonly ProfileRef[], opts?: { label?: (x: T) => string; profilesOf?: ProfilesOf<T>; max?: number }): { included: T[]; hidden: number; text: string; button: string };
export function resolveFilter(arg: unknown, saved: unknown, known?: string[]): ProfileFilter;
export function filterQuery(f: ProfileFilter): string;
export function profileTone(id: string, profiles?: readonly ProfileRef[], overrides?: Record<string, string>): 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
export function orderProfiles<P extends ProfileRef>(profiles: readonly P[], opts?: { hidden?: string[]; order?: string[] }): P[];
