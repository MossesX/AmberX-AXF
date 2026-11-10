import type { SearchEntry } from '@console/axf/core';

export type Scope = 'everything' | 'settings';
export type Mode = 'words' | 'prefix' | 'exact' | 'regex';
export interface Options { mode: Mode; caseSensitive: boolean; details: boolean; perCategory: number; total: number }
export interface Category { id: string; label: string; icon: string; kinds: string[] }
export interface Hit extends SearchEntry { score: number; category: string; locked?: boolean }
export interface TreeNode { id: string; label: string; children: TreeNode[]; hits: Hit[] }
export interface Group extends Category { count: number; root: TreeNode }
export interface QuickItem { value: string | boolean; label: string; checked: boolean }
export interface Quick { multi: boolean; items: QuickItem[] }
type SpecLike = { kind: string; options?: { value: string; label: string }[] } | undefined;
type Value = string | number | boolean | string[] | null;

export const CATEGORIES: Category[];
export const OTHER_CATEGORY: Category;
export const SCOPES: Scope[];
export const MODES: Mode[];
export const DEFAULT_OPTIONS: Readonly<Options>;
export function normOptions(o: Partial<Options> | null | undefined): Options;
export function categoryOf(kind: string): Category;
export function inScope(entry: Pick<SearchEntry, 'kind'>, scope: Scope): boolean;
export function compileQuery(query: string, options: Partial<Options>): { test: ((label: string, rest: string) => number) | null; error: string };
export function matchEntries(entries: readonly SearchEntry[], query: string, options: Partial<Options>, scope?: Scope): { hits: Hit[]; error: string };
export function pathOf(hit: Pick<SearchEntry, 'detail'>, categoryLabel: string): string[];
export function groupHits(hits: readonly Hit[], options: Partial<Options>): Group[];
export function flatten(node: TreeNode, out?: Hit[]): Hit[];
export function quickOptions(spec: SpecLike, value: Value): Quick | null;
export function pickValue(spec: SpecLike, current: Value, item: QuickItem): Value;
export function parseValue(spec: SpecLike, raw: unknown): Value | undefined;
export function submenuSide(rowRight: number, rowLeft: number, menuWidth: number, viewportWidth: number, margin?: number): 'left' | 'right';
export function aiActive(s: { ollama: boolean; capability: boolean; enabled: boolean }): boolean;
export function applyRanking<T extends { id: string }>(hits: T[], ids: string[] | null | undefined): T[];
