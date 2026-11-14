import type { Row, TreeNode } from '../../../../../framework/core/ui-directory.mjs';
export interface Filters { q: string; app: string; kind: string; status: string; family: string }
export interface DirState extends Filters { open: string[]; all: boolean }
export const FILTER_KEYS: (keyof Filters)[];
export const EMPTY: Readonly<DirState>;
export function filtering(f: Partial<Filters>): boolean;
export function matches(rows: Row[], f: Partial<Filters>): Row[];
export function visibleRows(rows: Row[], f: Partial<Filters>): Row[];
export function filtersFromArgs(args: string[] | string): Filters;
export function groupIds(nodes: TreeNode[], out?: string[]): string[];
export function countUnder(n: TreeNode): number;
