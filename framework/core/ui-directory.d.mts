/** Types for ui-directory.mjs (ui-directory@1 / ui-directory-row@1). */
export const SCHEMA: 'ui-directory@1';
export const ROW: 'ui-directory-row@1';
export const VERSION: 1;
export type Kind = 'app' | 'screen' | 'tab' | 'dialog' | 'settings-tab' | 'settings-panel' | 'plugin' | 'banner' | 'window' | 'element';
export type Source = 'shell' | 'framework' | 'plugin' | 'manifest' | 'inventory' | 'ui-registry' | 'help';
export type Status = 'live' | 'dynamic' | 'unlinked' | 'off';
export type TokenFamily = 'color' | 'type' | 'dens' | 'size' | 'space' | 'radius' | 'border' | 'font' | 'motion' | 'shadow' | 'opacity' | 'component';
export type DeepLinkTool = 'console_open' | 'console_settings' | 'console_dialog';
export const KINDS: Kind[];
export const KIND_LABEL: Record<Kind, string>;
export const SOURCES: Source[];
export const STATUSES: Status[];
export const STATUS_LABEL: Record<Status, string>;
export const STATUS_TONE: Record<Status, string>;
export const TOKEN_FAMILIES: TokenFamily[];
export const DEEP_LINK_TOOLS: DeepLinkTool[];
export interface Registry {
  $id: string; schema: string; row: string; version: number; kinds: Kind[]; sources: Source[]; statuses: Status[]; tokenFamilies: TokenFamily[];
  deepLinkTools: DeepLinkTool[]; idPattern: string; appPattern: string; maxName: number; maxKeywords: number; maxRows: number;
  rowRequired: string[]; rowOptional: string[]; directoryRequired: string[];
}
export const REGISTRY: Registry;
export interface DeepLink { tool: DeepLinkTool; target: string }
export interface Row {
  $axf: 'ui-directory-row@1'; id: string; name: string; kind: Kind; app: string; parent: string; plugin: string; address: string;
  deepLink: DeepLink | null; settings: string; tokens: TokenFamily[]; status: Status; source: Source; file: string; icon: string;
  detail: string; keywords: string[]; level?: number; dynamic?: boolean; firstSeen?: string;
}
export interface Counts { kinds: Record<string, number>; apps: Record<string, number>; statuses: Record<string, number>; sources: Record<string, number>; plugins: number }
export interface Directory { $axf: 'ui-directory@1'; version: number; generatedAt: string; hash: string; counts: Counts; total: number; dropped: number; rows: Row[] }
export interface SchemaError { field: string; code: string; message: string }
export interface Validation { ok: boolean; errors: SchemaError[] }
export interface Reach { mcp: { tool: DeepLinkTool; target: string }; rest: { method: 'POST'; path: string; body: { verb: 'open'; address: string } }; cli: string; voice: string }
export interface TreeNode { id: string; name: string; kind: Kind; row?: Row; children: TreeNode[] }
export interface SearchHit { id: string; name: string; kind: Kind; app: string; address: string; score: number }
export function rowId(app: string, kind: string, ...path: unknown[]): string;
export function tokenFamily(token: string): TokenFamily | '';
export function familiesOf(text: string): TokenFamily[];
export function statusOf(facts?: { enabled?: boolean; dynamic?: boolean; address?: string; deepLink?: DeepLink | null }): Status;
export function reachOf(row: Partial<Row>): Reach | null;
export function normRow(row: unknown, opts?: { now?: string }): Row;
export function validateRow(row: unknown): Validation;
export function rejection(errors: SchemaError[]): string;
export function hashRows(rows: Row[]): string;
export function normRows(rows: unknown[], opts?: { now?: string }): { rows: Row[]; dropped: { id: string; errors: SchemaError[] }[] };
export function countRows(rows: Row[]): Counts;
export function buildDirectory(rows: unknown[], opts?: { generatedAt?: string; previous?: Directory | null }): Directory;
export function diffDirectories(prev: Directory | null, next: Directory | null): { added: string[]; removed: string[]; changed: string[] };
export function mergeHistory(prev: Directory | null, rows: Row[], now?: string): Row[];
export function validateDirectory(dir: unknown): Validation;
export function filterRows(rows: Row[], f?: { kind?: string; kinds?: string[]; app?: string; plugin?: string; status?: string; source?: string; family?: string; q?: string }): Row[];
export function search(rows: Row[], q: string, opts?: { limit?: number; kinds?: string[]; app?: string }): SearchHit[];
export function tree(rows: Row[]): TreeNode[];
export function settingsOf(rows: Row[], id: string): Row | null;
export function registrationGaps(declared: string[], provided: string[]): { unregistered: string[]; phantom: string[] };
export function jsonSchemas(): Record<string, object>;
