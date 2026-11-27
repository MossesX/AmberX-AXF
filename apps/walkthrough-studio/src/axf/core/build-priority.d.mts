export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export interface WaitingRow { kind: 'slot' | 'build' | 'pr' | 'ui' | 'plan'; id: string; title: string; why: string; route: string; highlight: string; url?: string }
export interface PriorityInfo { id: string; priority: Priority; set: boolean; waiting: number }
export const PRIORITIES: Priority[];
export const PRIORITY_DEFAULT: Priority;
export const PRIORITY_LABEL: Record<Priority, string>;
export function normPriority(v: unknown): Priority | '';
export function priorityRank(p: unknown): number;
export function priorityLabel(p: unknown): string;
export function slotLevel(p: unknown): string;
export function markedUrgent(b: unknown): boolean;
export function effectivePriority(b: unknown): Priority;
export function waitingOn(id: string, sources?: Record<string, unknown>): WaitingRow[];
export function priorityMap(sources?: Record<string, unknown>): Record<string, PriorityInfo>;
export function resolveBuild<T>(builds: T[], name: string): T | null;
