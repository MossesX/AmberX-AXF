/** Types for toolbar-migrate.mjs (toolbar-list@1 → page-toolbar@1, no visible change). */

export const TOOLBAR_MIGRATION: string;

export interface ToolbarMigration<T = unknown> { asset: T; data: unknown; changed: boolean; changes: string[] }
export interface ToolbarMigrationRecord { id: string | null; contract: 'page-toolbar@1'; wasOldShape: boolean; changed: boolean; changes: string[]; sameLook: boolean }

export function needsToolbarMigration(data: unknown): boolean;
export function canonicalBadge(badge: string): string;
export function migrateToolbar<T = unknown>(input: T): ToolbarMigration<T>;
export function toolbarSignature(data: unknown): Record<string, unknown> | null;
export function toolbarMigrationErrors(type: string, data: unknown): string[];
export function toolbarMigrationRecord(asset: { id?: string; data?: unknown } | null | undefined): ToolbarMigrationRecord;
