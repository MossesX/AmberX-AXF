/** Types for shots-core.mjs (ui-screenshot@1). Every object keeps unknown fields. */
export type Viewport = 'phone' | 'desktop';
export type Side = 'before' | 'after' | '';
export interface Screenshot {
  $axf: string; id: string; title: string; source: string; session: string; build: string; agent: string; app: string; screen: string;
  viewport: Viewport; takenAt: string; addedAt: string; pair: string; side: Side; note: string; branch: string; pr: number | null; by: string;
  file: string; size: number; promoted: string[]; [k: string]: unknown;
}
export interface SourceInfo { id: string; label: string; icon: string }
export interface ShotFilter { q?: string; app?: string; source?: string; viewport?: string; screen?: string }
export interface ShotGroup { id: string; label: string; shots: Screenshot[] }
export type GroupBy = 'app' | 'screen' | 'source' | 'day' | 'none';

export const SCHEMA: string;
export const SOURCES: SourceInfo[];
export const SOURCE_IDS: string[];
export const VIEWPORTS: Viewport[];
export const SIDES: ('before' | 'after')[];
export const GROUPS: { id: GroupBy; label: string }[];
export const SORTS: { id: string; label: string }[];
export const MIGRATE_PREFIXES: string[];
export function viewportOf(name?: string): Viewport;
export function titleOf(name?: string): string;
export function newId(now?: string): string;
export function normShot(raw: unknown, opts?: { now?: string }): { shot: Screenshot; problems: string[] };
export function sideFor(shots: Screenshot[], pair: string, side?: string): Side;
export function pairOf(shots: Screenshot[], shot: Screenshot | null | undefined): { before: Screenshot; after: Screenshot } | null;
export function dayOf(t: string): string;
export function sourceInfo(id: string): SourceInfo;
export function filterShots(shots: Screenshot[], f?: ShotFilter): Screenshot[];
export function sortShots(shots: Screenshot[], sort?: string): Screenshot[];
export function groupShots(shots: Screenshot[], by?: GroupBy | string): ShotGroup[];
export function distinct(shots: Screenshot[], f: keyof Screenshot): string[];
export function migrateItems(items: unknown[], opts?: { now?: string }): { keep: unknown[]; shots: { shot: Screenshot; from: string }[]; moved: string[] };
