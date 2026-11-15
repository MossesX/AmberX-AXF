// Types for plugin-activity.mjs (plugin-activity@1: a raw event log → scored, ranked records for home-cards@1).
import type { ActivityKind } from './home-cards.mjs';
export type { ActivityKind };

/** One thing that happened under a plugin: its screen opened, a command ran, a job started, an alert fired. */
export interface ActivityEvent { $axf?: 'plugin-activity-event@1'; plugin: string; kind: ActivityKind; at: string; n?: number }
/** One plugin's score in the window; a list sorted by score desc then id asc is the ranking. */
export interface ActivityRecord {
  $axf: 'plugin-activity@1'; plugin: string; at: string;
  window: { days: number; halfLifeDays: number };
  counts: Record<ActivityKind, number>;
  score: number;
}
export interface ActivityOptions { at?: string; windowDays?: number; halfLifeDays?: number; weights?: Partial<Record<ActivityKind, number>>; plugins?: Array<string | { id?: string; folder?: string; plugin?: string }> }
export interface ActivityOptionsFilled { at: string; windowDays: number; halfLifeDays: number; weights: Record<ActivityKind, number>; plugins: string[] }

export const ACTIVITY_FRAME: 'plugin-activity@1';
export const EVENT_FRAME: 'plugin-activity-event@1';
export const EVENT_KINDS: readonly ActivityKind[];
export const WEIGHTS: Readonly<Record<ActivityKind, number>>;
export const WINDOW: { readonly days: number; readonly halfLifeDays: number; readonly minDays: number; readonly maxDays: number };

export function roundScore(x: number): number;
export function activityOptions(opts?: ActivityOptions): ActivityOptionsFilled;
export function decay(ageDays: number, halfLifeDays?: number): number;
export function normEvent(raw: unknown, at?: string): ActivityEvent | null;
export function eventErrors(ev: unknown, path?: string): string[];
export function pruneEvents(events: unknown[], opts?: ActivityOptions): ActivityEvent[];
export function scoreActivity(events: unknown[], opts?: ActivityOptions): ActivityRecord[];
export function rankedIds(recordsOrEvents: ActivityRecord[] | unknown[], opts?: ActivityOptions): string[];
export function activityErrors(r: unknown, path?: string): string[];
