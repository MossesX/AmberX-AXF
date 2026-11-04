/** Types for build-todo-sync.mjs (build-todo-sync@1: build names, categories and the to-do mirror of a build). */
export const SCHEMA: 'build-todo-sync@1';
export const CATEGORIES: Category[];
export const DEFAULT_CATEGORY: Category;
export const MAX_NAME: number;
export const ROOT_LIST: string;
export const DONE_LIST: string;
export const ARCHIVE_LIST: string;
export const DEFAULT_COMPLETED_DAYS: number;
export const MIRROR_TAG: string;
export const STATE_TAGS: string[];
export const DRIFT_KINDS: DriftKind[];
export const EVENT_KIND: 'store-write';

export type Category = 'Plugin' | 'Plugin extension' | 'Add-on' | 'Framework' | 'App' | 'Feature' | 'Module';
export type Confidence = 'high' | 'medium' | 'low';
export type DriftKind = 'ticked' | 'unticked' | 'stray' | 'list-missing';

export interface Naming { displayName: string; category: Category; area: string; nameReview: boolean }
export interface StepLike { id?: string; uid?: string; title?: string; text?: string; model?: string; estimate?: string; phase?: string; group?: string; session?: string; agent?: boolean; skip?: boolean; done?: boolean; doneAt?: string; note?: string; thinking?: string; assignee?: string; files?: string[]; updatedAt?: string }
export interface BuildLike { id?: string; title?: string; detail?: string; category?: string; area?: string; displayName?: string; nameReview?: boolean; status?: string; kind?: string; deleted?: boolean; mergedAt?: string; builtAt?: string; updatedAt?: string; profiles?: string[]; steps?: StepLike[]; files?: string[]; upgradeRequests?: { state?: string }[] }

export interface ListRow { id: string; name: string; parent: string | null; order?: number }
export interface ItemRow { id: string; list: string; title?: string; text?: string; status?: string; tags?: string[]; order?: number; url?: string; updatedAt?: string; doneAt?: string }
export interface MirrorItem { kind: 'todo'; title: string; text: string; status: 'open' | 'doing' | 'done'; tags: string[]; priority: number; order: number; url: string }
export interface Links { $axf: 'build-todo-sync@1'; lists: Record<string, string>; items: Record<string, string>; updatedAt: string }
export interface Op { target: 'amberx.lists' | 'amberx.items'; op: 'add' | 'set' | 'remove'; path?: string; value?: Record<string, unknown>; confirm?: boolean; ref?: string; why?: string }
export interface Drift { kind: DriftKind; build: string; step?: string; stepId?: string; item?: string; listName?: string; title?: string; at: string }
export interface Ask { id: string; kind: 'ticked' | 'unticked'; build: string; step: string; stepId: string; item: string; at: string; state: 'open' | 'approved' | 'denied' | 'settled'; title: string; closedAt?: string }
export interface PlanResult { ops: Op[]; links: Links; drift: Drift[]; summary: { builds: number; groups: number; ops: number; adds: number; sets: number; removes: number; drift: number } }
export interface PlanInput { store: { builds: BuildLike[] }; lists?: ListRow[]; items?: ItemRow[]; links?: unknown; asks?: { build: string; step: string }[]; now?: string; opts?: { linkBase?: string; completedDays?: number; profiles?: string[]; statusNote?: { title: string; text: string } | null } }
export interface StoreEvent { $axf: 'build-todo-sync@1'; kind: 'store-write'; rev: number; at: string; by: string; action: string; builds: { id: string; op: string }[] }

export function normCategory(v: unknown): Category | '';
export function suggestCategory(b: BuildLike): { category: Category; why: string; confidence: Confidence };
export function shorten(text: string, max?: number): string;
export function suggestDisplayName(title: unknown, opts?: { max?: number; id?: string }): string;
export function naming(b: BuildLike): Naming;
export function listNameOf(b: BuildLike): string;
export function placeOf(b: BuildLike, opts?: { now?: string; completedDays?: number }): string;
export function stateTags(b: BuildLike, s: StepLike): string[];
export function linkTo(linkBase: string, buildId: string, stepUid?: string): string;
export function parseLink(url: unknown): { build: string; step: string } | null;
export function stepTitle(s: StepLike, max?: number): string;
export function itemFor(b: BuildLike, s: StepLike, index: number, opts?: { linkBase?: string; nextStepUid?: string }): MirrorItem;
export function nextOpenUid(b: BuildLike): string;
export function normLinks(v: unknown): Links;
export function plan(input: PlanInput): PlanResult;
export function resolveOp(op: Op, refs: Record<string, string>): Omit<Op, 'ref' | 'why'>;
export function resolveLinks(links: unknown, refs: Record<string, string>): Links;
export function asksFrom(drift: Drift[], now?: string): Ask[];
export function mergeAsks(open: Ask[], fresh: Ask[], now?: string): Ask[];
export function storeEvent(e: Partial<StoreEvent>): StoreEvent;
export function parseEvent(v: unknown): StoreEvent | null;
