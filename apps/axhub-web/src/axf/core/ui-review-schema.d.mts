/** Types for ui-review-schema.mjs (ui-review-item@1 / ui-review-group@1). */
export const ITEM_TAG: 'ui-review-item@1';
export const GROUP_TAG: 'ui-review-group@1';
export interface Registry {
  $id: string; item: string; group: string; kinds: string[]; sources: string[]; statuses: string[]; statusAliases: Record<string, string>;
  submitterTypes: string[]; viewports: string[]; idPattern: string; sectionPattern: string; maxName: number; maxFiles: number;
  itemRequired: string[]; reviewRequired: string[]; groupRequired: string[]; itemOptional: string[]; groupOptional: string[];
}
export const REGISTRY: Registry;
export interface SchemaError { field: string; code: 'missing' | 'invalid'; message: string }
export interface UiReviewFile { src: string; name?: string; viewport?: string; [k: string]: unknown }
export interface UiReviewItem {
  $axf: 'ui-review-item@1'; id: string; name: string; group: { id: string; name: string }; createdAt: string; kind: 'review' | 'screenshot'; source: string;
  submittedBy: { type: string; id: string; label?: string }; app: string; screen: string; viewport: string; files: { before: UiReviewFile[]; after: UiReviewFile[] };
  status?: string; note?: string; pr?: number; branch?: string; build?: { id?: string; step?: string }; section?: string; comment?: string; [k: string]: unknown;
}
export interface UiReviewGroup { $axf: 'ui-review-group@1'; id: string; name: string; createdAt: string; source: string; [k: string]: unknown }
export function isId(v: unknown): boolean;
export function isTimestamp(v: unknown): boolean;
export function nameProblem(name: unknown, id?: string): string;
export function validateItem(it: unknown): { ok: boolean; errors: SchemaError[] };
export function validateGroup(g: unknown, opts?: { ref?: boolean }): { ok: boolean; errors: SchemaError[] };
export function rejection(errors: SchemaError[], tag?: string): string;
export class UiReviewSchemaError extends Error { errors: SchemaError[]; fields: string[]; constructor(errors: SchemaError[], tag?: string) }
export function assertItem<T>(it: T): T;
export function assertGroup<T>(g: T): T;
export function stamp(iso: string): string;
export function slug(s: unknown, n?: number): string;
export function groupId(name: string, iso: string): string;
export function autoGroupName(o: { source?: string; session?: string; now: string }): string;
export function makeGroup(o: { name?: string; now: string; source?: string; submittedBy?: unknown; app?: string; note?: string; build?: unknown; session?: string }): UiReviewGroup;
export function parseSubmitter(v: unknown): { type: string; id: string } | undefined;
export function viewportOf(files: { before?: { viewport?: string }[]; after?: { viewport?: string }[] }): string;
export function prepareItem(raw: unknown, opts?: { now?: string; autoGroup?: boolean; session?: string }): { ok: boolean; item: Record<string, unknown>; group?: UiReviewGroup; errors: SchemaError[] };
export function sourceFrom(s: unknown): string;
export function readableName(src: unknown): string;
export function migrateLegacy(old: unknown, ctx?: { kind?: 'review' | 'screenshot'; fileTime?: (src: string) => string; groupFor?: (o: any, createdAt: string) => { id: string; name: string }; now?: string }): { item: UiReviewItem; changes: string[] };
export function jsonSchemas(): Record<string, unknown>;
