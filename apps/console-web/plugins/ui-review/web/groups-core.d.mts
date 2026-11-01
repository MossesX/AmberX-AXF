/** Types for groups-core.mjs (shot-group@1). Every object keeps unknown fields. */
import type { Screenshot } from './shots-core.mjs';

export interface ShotGroupRec {
  $axf: string; id: string; name: string; createdAt: string; source: string; session: string; build: string; agent: string; app: string; note: string;
  [k: string]: unknown;
}
export interface GroupRow extends ShotGroupRec { count: number; cover: Screenshot | null; apps: string[]; lastAt: string }
export interface GroupMeta { name?: string; source?: string; session?: string; build?: string; agent?: string; app?: string; note?: string }

export const GROUP_SCHEMA: string;
export const DEFAULT_TZ: string;
export function isGroupId(v: unknown): v is string;
export function dayKey(at: string, tz?: string): string;
export function stamp(at: string, tz?: string): string;
export function autoName(by: string, at: string, tz?: string): string;
export function suggestName(what: string, at: string, tz?: string): string;
export function newGroupId(at: string, rand?: () => number): string;
export function normGroup(raw: unknown, now?: string): ShotGroupRec;
export function resolveGroup(groups: ShotGroupRec[], meta?: GroupMeta, at?: string, tz?: string, rand?: () => number): { group: ShotGroupRec; created: boolean };
export function groupRows(groups: ShotGroupRec[], shots: Screenshot[]): GroupRow[];
export function matchGroup(row: GroupRow, q: string, tz?: string): boolean;
export function mergeGroups(groups: ShotGroupRec[], shots: Screenshot[], fromId: string, intoId: string): { groups: ShotGroupRec[]; shots: Screenshot[]; moved: number };
export function moveShots(groups: ShotGroupRec[], shots: Screenshot[], ids: string[], intoId: string): { shots: Screenshot[]; moved: number };
export function renameGroup(groups: ShotGroupRec[], id: string, name: string): ShotGroupRec[];
export function assignGroups(groups: ShotGroupRec[], shots: Screenshot[], tz?: string, rand?: () => number): { groups: ShotGroupRec[]; shots: Screenshot[]; made: string[] };
