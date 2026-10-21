// Types for reminders.mjs (the plugin imports it from TypeScript).
import type { AlertInput } from '@console/axf/core';
export const SOURCE: 'approvals';
export const REMEMBER_CAP: number;
export interface ReviewChoice { id: 'approve' | 'decline' | 'postpone' | 'revoke'; label: string; page: 'approval' | 'postpone'; hint: string }
export const REVIEW_CHOICES: ReviewChoice[];
export function reminderKey(id: string, slot: number): string;
export function age(minutes: number): string;
export interface ReminderItem { id: string; tool: string; waitingFor: string; url: string; slot: number; minutes: number; review: boolean }
export function reminderPlan(items: ReminderItem[], remembered: Record<string, number>): { raise: AlertInput[]; resolve: string[]; next: Record<string, number> };
export interface ReviewRow extends ReminderItem { choice: ReviewChoice['id'] | '' }
export function reviewState<T extends { id: string; review: boolean }>(items: T[], choices: Record<string, string>): { blocking: boolean; rows: (T & { choice: ReviewChoice['id'] | '' })[]; chosen: number; choices: Record<string, string> };
