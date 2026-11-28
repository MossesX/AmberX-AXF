/** Types for tree-core.mjs (plan-tree@1). */
export type Kind = 'plan' | 'section' | 'step' | 'note' | 'list' | 'item';
export type Status = '' | 'idea' | 'draft' | 'active' | 'parked' | 'done';
export type LinkType = 'todo' | 'build' | 'note' | 'shipped' | 'plan' | 'url';
export interface Link { type: LinkType; ref: string; label: string }
export interface Item {
  id: string; parent: string | null; order: number; kind: Kind; title: string; body: string; status: Status; done: boolean;
  priority: string; tags: string[]; model: string; minutes: number; links: Link[]; collapsed: boolean; createdAt: string; updatedAt: string; by: string;
  /** View fields the server lays on from the builds store (never stored): see live-core.mjs. */
  origin?: 'orchestrator'; locked?: boolean; live?: Live;
  /** The shipped-manifest@1 the plan received when its build shipped (normalised, valid), see shipped.mjs. */
  shipped?: ShippedManifest;
  /** Set when a shipped manifest for this plan's build was refused: what was wrong with it. */
  shippedProblem?: ShippedProblem;
}
/** The fields of a shipped-manifest@1 the page shows (framework/core/shipped-manifest.mjs has the whole format). */
export interface ShippedManifest {
  $axf: 'shipped-manifest@1'; version: number; id: string; rev: number; source: string; by: string; shippedAt: string;
  build: { id: string; title: string; profile: string; category: string; priority: string; repo: string };
  said: { text: string; verbatim: boolean; at?: string; source?: string; addenda?: { text: string; at?: string }[] };
  brief: string; models: string[]; accounts: string[]; branch: string; pr: { number: number; url: string; title?: string };
  landedCommit: string; commits: string[]; mergedAt: string; landedAt: string; files: string[];
  steps: { id: string; text: string; model: string; estimate: string; done: boolean; estimateMin: number; actualMin: number }[];
  tests: { name: string; command: string; result: string; detail: string }[];
  cost: { usd: number; estimated: boolean; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } };
  report: string; open: string[];
  [k: string]: unknown;
}
export interface ShippedProblem { $axf: 'plan-shipped-problem@1'; at: string; build: string; id: string; rev: number; source: string; by: string; reason: string; errors: { field: string; message: string }[] }
/** A sent plan's (or one orchestrator step's) state, read from the builds store (plan-live@1). */
export interface Live {
  $axf: 'plan-live@1'; build: string; number?: string; profile: string; step?: string; status: string; label: string; state: string; stateLabel: string; attempt: number; at: string;
  locked?: boolean; split?: boolean; held?: boolean; emergency?: boolean; pr?: number; skipped?: boolean; steps?: { done: number; total: number };
}
export interface TrashEntry { id: string; at: string; by: string; title: string; root: string; parent: string | null; index: number; items: Item[] }
export interface State { $axf: 'plan-tree@1'; rev: number; items: Item[]; trash: TrashEntry[] }
export interface Hit { id: string; kind: Kind; title: string; path: string; score: number; focus: string }
export interface TreeRow extends Item { children: TreeRow[] }
export interface FlatRow { item: Item; depth: number; kids: number }
export interface Progress { done: number; total: number; minutes: number }
export type Change<T = object> = { state: State } & T;
export interface BuildChange { action: 'add'; title: string; detail: string; source: string; said?: string; steps: { text: string; model: string; estimate: string }[] } // planning steps: model and estimate are '' when not set
export type VoiceCommand =
  | { op: 'undo' } | { op: 'collapse'; all?: boolean; id?: string; collapsed: boolean }
  | { op: 'add'; kind: Kind | null; title: string; parent: string | null } | { op: 'rename'; id: string; title: string }
  | { op: 'delete' | 'duplicate' | 'send-to-build' | 'open'; id: string } | { op: 'edit'; id: string; patch: Partial<Item> }
  | { op: 'nudge'; id: string; delta: number } | { op: 'move'; id: string; parent: string | null }
  | { op: 'export'; id: string; format: 'md' } | { op: 'find'; q: string };

export const SCHEMA: 'plan-tree@1';
export const KINDS: readonly Kind[];
export const STATUSES: readonly Status[];
export const PRIORITIES: readonly string[];
export const MODELS: readonly string[];
export const LINK_TYPES: readonly LinkType[];
export const KIND_LABEL: Record<Kind, string>;
export const KIND_ICON: Record<Kind, string>;
export const CHILD_KIND: Record<Kind, Kind>;
export const CHECKABLE: Set<Kind>;
export const TRASH_MAX: number;
export class TreeError extends Error { code: string }
export function rid(n?: number): string;
export function slug(t: string): string;
export function newId(title: string, taken?: Set<string>): string;
export function emptyState(): State;
export function normLink(l: unknown): Link | null;
export function normItem(raw: unknown, at?: string): Item;
export function normalize(raw: unknown): State;
export function stored(s: State): State;
export function byId(s: State, id: string): Item | null;
export function children(s: State, parent: string | null): Item[];
export function roots(s: State): Item[];
export function descendants(s: State, id: string): Item[];
export function ancestors(s: State, id: string): Item[];
export function pathOf(s: State, id: string): string;
export function depthOf(s: State, id: string): number;
export function progress(s: State, id: string | null): Progress;
export function tree(s: State, parent?: string | null): TreeRow[];
export function flatten(s: State, opts?: { collapsed?: Set<string> | null; parent?: string | null }): FlatRow[];
export function find(s: State, q: string, opts?: { kind?: string; limit?: number; under?: string }): Hit[];
export function resolve(s: State, ref: string): Item | null;
export function add(s: State, o: { parent?: string | null; kind?: Kind | string; title?: string; body?: string; index?: number; by?: string } & Partial<Item>): Change<{ item: Item }>;
export function edit(s: State, ref: string, patch: Partial<Item>, by?: string): Change<{ item: Item; changed: boolean }>;
export function rename(s: State, ref: string, title: string, by?: string): Change<{ item: Item; changed: boolean }>;
export function move(s: State, ref: string, o?: { parent?: string | null; index?: number }): Change<{ item: Item }>;
export function nudge(s: State, ref: string, delta: number): Change<{ item: Item }>;
export function indent(s: State, ref: string): Change<{ item: Item; changed?: boolean }>;
export function outdent(s: State, ref: string): Change<{ item: Item; changed?: boolean }>;
export function duplicate(s: State, ref: string, by?: string): Change<{ item: Item; count: number }>;
export function remove(s: State, ref: string, by?: string): Change<{ trashId: string; removed: number; item: Item }>;
export function undo(s: State, trashId?: string): Change<{ restored: number; item: Item | null }>;
export function link(s: State, ref: string, l: Partial<Link>): Change<{ item: Item; changed: boolean }>;
export function unlink(s: State, ref: string, l: { type: string; ref: string }): Change<{ item: Item; changed: boolean }>;
export function setCollapsed(s: State, ids: string[] | null, collapsed: boolean): Change<{ changed: number }>;
export function clearAll(s: State): Change<{ removed: number }>;
export function toMarkdown(s: State, ref?: string | null): string;
export function toJson(s: State, ref?: string | null): { $axf: 'plan-tree-export@1'; exportedAt: string; root: string | null; items: Item[] };
export function importItems(s: State, data: unknown, o?: { parent?: string | null; by?: string }): Change<{ imported: number }>;
export function toBuild(s: State, ref: string, o?: { said?: string }): BuildChange;
export function parseVoice(text: string): VoiceCommand | null;
