/** Types for engine.mjs (build-search@1). */
export const FRAME: 'build-search@1';
export const RESULT_FRAME: 'build-search-result@1';
export const TYPES: Record<string, { icon: string; label: string }>;
export function typeIcon(t: string): string;
export function typeLabel(t: string): string;
export interface BuiltinAction { id: string; label: string; icon: string; builtin: true; when?: 'build' }
export const BUILTIN_ACTIONS: BuiltinAction[];
export interface BsSource { id: string; name: string; path: string; type: string }
export interface BsAction { id: string; label: string; icon: string; run: string; types?: string[] }
export interface BsSettings { $axf: string; types: string[]; maxHits: number; maxPerDoc: number; context: number; snippet: number; sources: BsSource[]; actions: BsAction[]; ai: { enabled: boolean } }
export const DEFAULT_SETTINGS: Readonly<BsSettings>;
export function slug(s: unknown): string;
export function normalizeSource(raw: unknown): BsSource | null;
export function normalizeAction(raw: unknown): BsAction | null;
export function normalizeSettings(raw: unknown): BsSettings;
export interface ParsedQuery { terms: RegExp[]; exclude: RegExp[]; types: string[]; builds: string[]; text: string; error: string }
export function parseQuery(q: string): ParsedQuery;
export function matchLine(line: string, pq: ParsedQuery): [number, number][] | null;
export function snippet(line: string, ranges: [number, number][], width: number): { text: string; ranges: [number, number][] };
export function hitId(docId: string, line: number): string;
export function parseHitId(id: string): { doc: string; line: number };
export interface BsDoc { id: string; type: string; title: string; build?: string; path?: string; at?: string; lines: string[] }
export interface BsHit { id: string; n: number; line: number; text: string; ranges: [number, number][] }
export interface BsGroup { doc: string; type: string; icon: string; typeLabel: string; title: string; build: string; path: string; at: string; count: number; hits: BsHit[] }
export interface BsResult { $axf: string; q: string; error: string; total: number; shown: number; docs: number; searched: number; truncated: boolean; groups: BsGroup[] }
export function search(docs: BsDoc[], q: string, opts?: { settings?: unknown; types?: string[]; build?: string; limit?: number | string; perDoc?: number | string }): BsResult;
export function around(doc: BsDoc, line: number, context?: number): { start: number; end: number; line: number; total: number; lines: string[] };
export function actionsFor(group: { type?: string; build?: string } | null, settings: unknown): (BuiltinAction | BsAction)[];
export function fillAction(run: string, ctx: Record<string, unknown>): string;
export const COMMAND_HELP: string[];
export type BsCommand = { op: string; [k: string]: unknown };
export function parseCommand(text: string): BsCommand;
export function applyCommand(settings: unknown, cmd: BsCommand): { settings: BsSettings; changed: boolean; message?: string; error?: string };
