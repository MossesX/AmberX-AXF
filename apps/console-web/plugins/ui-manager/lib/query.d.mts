/** Types for query.mjs: search, sort and multi-filter over the UI Manager's elements and properties. */
import type { PropRow, TreeCategory, UiElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';

export type SortKey = 'label' | 'kind' | 'category' | 'plugin' | 'overrides';
export interface ElementQuery { q?: string; kinds?: string[] | string; categories?: string[] | string; plugins?: string[] | string; overriddenOnly?: boolean | string; onScreenOnly?: boolean | string; sort?: SortKey | string; desc?: boolean | string }
export interface NormalQuery { q: string; kinds: string[]; categories: string[]; plugins: string[]; overriddenOnly: boolean; onScreenOnly: boolean; sort: SortKey; desc: boolean }
export interface Facet { value: string; count: number }
export interface Facets { kinds: Facet[]; categories: Facet[]; plugins: Facet[]; overridden: number }
export type Counted = UiElement & { overrides?: number };
export type PropSortKey = 'group' | 'label' | 'changed';
export interface PropQuery { q?: string; groups?: string[] | string; changedOnly?: boolean | string; sort?: PropSortKey | string; desc?: boolean | string }

export const SORT_KEYS: SortKey[];
export const PROP_SORT_KEYS: PropSortKey[];
export const QUERY_LIMIT_MAX: number;
export function normalizeQuery(raw?: ElementQuery): NormalQuery;
export function sortElements<T extends Counted>(elements: T[], sort?: string, desc?: boolean): T[];
export function queryElements<T extends Counted>(elements: T[], raw?: ElementQuery, visible?: string[]): T[];
export function queryTree(elements: Counted[], raw?: ElementQuery, visible?: string[]): TreeCategory[];
export function facets(elements: Counted[]): Facets;
export function queryProps(rows: PropRow[], q?: PropQuery): PropRow[];
export function page<T>(items: T[], opts?: { limit?: number | string; offset?: number | string }): { items: T[]; total: number; offset: number; limit: number };
