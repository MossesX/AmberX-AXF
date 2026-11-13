// Types for catalog.mjs (wake-listener-catalog@1).
export const CATALOG_FRAME: 'wake-listener-catalog@1';
export const GROUPS: readonly string[];
export const MATCH_THRESHOLD: number;
export const YES: RegExp;
export const NO: RegExp;
export const SKIP: RegExp;

export interface CatalogField { name: string; ask: string; type?: 'string' | 'number' | 'boolean' | 'duration'; enum?: string[]; optional?: boolean }
export type RunSpec =
  | { kind: 'builtin'; what: string }
  | { kind: 'voice' }
  | { kind: 'plugin-route'; folder: string; method: string; path: string; params: { name: string; in: string }[]; body: unknown }
  | { kind: 'plugin-action'; action: string }
  | { kind: 'console-action'; action: string }
  | { kind: 'plugin-info'; folder: string }
  | { kind: 'plugin-data'; folder: string; command: string }
  | { kind: 'control'; command: Record<string, unknown> };
export interface CatalogEntry {
  id: string; title: string; group: string; plugin?: string; say: string[]; fields: CatalogField[]; run: RunSpec;
  effect: string; confirm: boolean; summary: string; speak: string; verbs: Record<string, string> | null; source: string;
}
export interface Catalog { $axf: 'wake-listener-catalog@1'; builtAt: string; entries: CatalogEntry[]; groups: string[] }
export interface Match { entry: CatalogEntry; slots: Record<string, string>; missing: string[]; score: number; template: string }
export type WizardStep = 'ask' | 'confirm' | 'run' | 'cancelled' | 'retry';
export interface Wizard { entry: CatalogEntry; slots: Record<string, string>; asked: string[]; step: WizardStep; field?: string; optional?: boolean; prompt: string }
export type Request =
  | { kind: 'plugin-route'; folder: string; method: string; path: string; query: Record<string, string>; body: unknown }
  | { kind: 'control'; command: Record<string, unknown> }
  | { kind: 'action'; spec: string }
  | { kind: string; [k: string]: unknown };

export const PHRASEBOOK: Record<string, unknown>;
export const BUILTINS: CatalogEntry[];
export function parseDuration(text: unknown): number | null;
export function slug(s: unknown): string;
export function titleCase(s: unknown): string;
export function fillTemplate<T>(tpl: T, slots: Record<string, unknown>): T;
export function entryFromCommand(plugin: { folder: string; name?: string }, cmd: Record<string, unknown>): CatalogEntry;
export function sayFromTitle(title: string, fields: CatalogField[]): string[];
export function entriesFromControl(targets?: Record<string, unknown>): CatalogEntry[];
export function entriesFromActions(actions: { id: string; meta: Record<string, unknown> }[] | null | undefined): CatalogEntry[];
export function buildCatalog(opts?: { registry?: unknown; actions?: { id: string; meta: Record<string, unknown> }[] | null; targets?: Record<string, unknown> }): Catalog;
export function matchCommand(catalog: Catalog, text: unknown): Match | null;
export function coerceField(field: CatalogField, raw: unknown): string | null;
export function missingFields(entry: CatalogEntry, slots: Record<string, unknown>): string[];
export function searchCatalog(catalog: Catalog, q: unknown): CatalogEntry[];
export function startWizard(entry: CatalogEntry, slots?: Record<string, string>): Wizard;
export function answerWizard(w: Wizard, text: unknown): Wizard;
export function summaryOf(entry: CatalogEntry, slots: Record<string, unknown>): string;
export function requestFor(entry: CatalogEntry, slots: Record<string, unknown>): Request;
export function speakResult(entry: CatalogEntry, result: unknown): string;
export function helpLine(catalog: Catalog): string;
