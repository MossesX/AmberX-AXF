import type { Ledger } from '../../../src/axf/core/feature-ledger.mjs';

export type ShipStatus = 'live' | 'switch' | 'partial' | 'pending' | 'removed';
export type Reach = 'deeplink' | 'rest' | 'mcp' | 'cli' | 'voice';
export type GroupBy = 'area' | 'date' | 'build' | 'pr' | 'status' | 'none';
export type SortKey = { col: string; dir: 'asc' | 'desc' };
export interface TableView { by: GroupBy; sorts: SortKey[]; hidden: string[]; order: string[]; search: string; plugins: string[]; statuses: ShipStatus[]; from: string; to: string; hasApi: boolean; notDeployed: boolean; collapsed: string[]; expanded: string[] }
export interface Row {
  id: string; name: string; area: string; plugin: string; app: string; description: string; status: ShipStatus; ledgerStatus: string;
  build: string; builds: string[]; pr: number; prUrl: string; prs: { repo: string; number: number; url: string }[];
  commit: string; shipped: string; shippedGuessed: boolean; onMain: boolean; deployed: boolean; liveAt: Record<string, { at: string; guessed?: boolean }>;
  reach: Reach[]; hasApi: boolean; settings: string; help: string; version: string; asked: string; askedVerbatim: boolean;
  tests: { pass: number; total: number }; type: string; editCount: number; deepLink: string; duplicates: string[];
}
export interface Group { key: string; title: string; rows: Row[]; count: number; counts: Record<ShipStatus, number>; notDeployed: number }
export interface ManifestSummary { build: string | { id: string }; tests?: { pass: number; total: number } }
export const SCHEMA: 'shipped-table@1';
export const SHIP_STATUSES: ShipStatus[];
export const SHIP_STATUS_LABEL: Record<ShipStatus, string>;
export const SHIP_STATUS_TONE: Record<ShipStatus, 'success' | 'accent' | 'warning' | 'danger' | undefined>;
export const REACH: Reach[];
export const REACH_LABEL: Record<Reach, string>;
export const GROUP_BY: GroupBy[];
export const GROUP_LABEL: Record<GroupBy, string>;
export const COLUMNS: readonly { id: string; label: string; fixed?: boolean }[];
export const COLUMN_IDS: string[];
export const DEFAULT_HIDDEN: string[];
export const DEFAULT_VIEW: TableView;
export function normTableView(v: unknown): TableView;
export function reachOf(f: unknown): Reach[];
export function shipStatus(f: unknown): ShipStatus;
export function toRows(ledger: Partial<Ledger> | null | undefined, manifests?: ManifestSummary[]): { rows: Row[]; folded: number };
export function cellText(r: Row, c: string): string;
export function sortValue(r: Row, c: string): number | string;
export function filterRows(rows: Row[], view: Partial<TableView>): Row[];
export function sortRows(rows: Row[], sorts: SortKey[]): Row[];
export function groupRows(rows: Row[], by: GroupBy): Group[];
export function tableOf(ledger: Partial<Ledger>, manifests: ManifestSummary[], view: Partial<TableView>): { $axf: 'shipped-table@1'; view: TableView; total: number; count: number; folded: number; columns: string[]; plugins: string[]; rows: Row[]; groups: (Omit<Group, 'rows'> & { rows: string[] })[] };
export function toCsv(rows: Row[], columns?: string[]): string;
