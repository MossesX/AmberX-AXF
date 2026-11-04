/** Types for plan-core.mjs (plan@1). Every object keeps unknown fields. */
export type Status = 'idea' | 'draft' | 'parked' | 'ready' | 'building' | 'done' | 'dropped';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type Model = 'Fable' | 'Opus' | 'Sonnet';
export type FeatureState = 'have' | 'partial' | 'planned' | 'idea';
export type ListId = 'requirements' | 'acceptance' | 'decisions' | 'questions' | 'risks' | 'outOfScope';
export interface Step { id: string; text: string; model: Model; minutes: number; dependsOn: string[]; done: boolean; doneAt: string; phase: string; [k: string]: unknown }
export interface TextItem { text: string; done?: boolean; answer?: string; mitigation?: string; [k: string]: unknown }
export interface Link { kind: string; ref: string; label: string; [k: string]: unknown }
export interface PlanFeature { entry: string; feature: string; title: string; state: FeatureState; [k: string]: unknown }
export interface Attachment { id: string; kind: 'image' | 'file' | 'voice'; name: string; url: string; size: number; transcript: string; [k: string]: unknown }
export interface Comment { id: string; by: string; at: string; text: string; [k: string]: unknown }
export interface BuildLink { profile: string; id: string; linkedAt?: string; status?: string; progress?: number; title?: string; branch?: string; pr?: string; [k: string]: unknown }
export interface Plan {
  $axf: 'plan@1'; id: string; title: string; summary: string; goal: string; why: string; category: string; tags: string[]; project: string;
  touches: { key: string; name?: string }[]; profile: string; status: Status; priority: Priority; targetDate: string; owner: string;
  steps: Step[]; requirements: TextItem[]; acceptance: TextItem[]; decisions: TextItem[]; questions: TextItem[]; risks: TextItem[]; outOfScope: TextItem[];
  links: Link[]; features: PlanFeature[]; attachments: Attachment[]; body: string; comments: Comment[]; build: BuildLink | null;
  createdAt: string; updatedAt: string; createdBy: string; version: number; effort: { minutes: number; left: number }; cost: { usd: number; estimated: boolean };
  template?: string; [k: string]: unknown;
}
export interface Version { v: number; at: string; by: string; note: string; kind: string; plan: Plan }
export interface History { $axf: string; id: string; versions: Version[] }
export interface CatNode { path: string; name: string; children: CatNode[]; count: number; total: number }
export interface Template { id: string; label: string; icon: string; builtIn: boolean; plan: Partial<Plan> & Record<string, unknown> }
export interface SavedView { id: string; label: string; layout: string; filter: Filter; sort: string; group: string }
export interface Filter { q?: string; statuses?: string[]; priorities?: string[]; categories?: string[]; tags?: string[]; projects?: string[]; profiles?: string[]; models?: string[]; hasBuild?: boolean }
export interface DiffItem { path: string; op: 'added' | 'removed' | 'changed' | 'reordered'; from: unknown; to: unknown }
export interface Totals { minutes: number; left: number; cost: number; steps: number; done: number; progress: number; models: Record<string, number>; acceptance: { total: number; done: number } }
export interface CatalogFeature { id: string; title: string; state: FeatureState; source: string; plan?: string; planTitle?: string; build?: string; description?: string; [k: string]: unknown }
export interface CatalogEntry { key: string; kind: string; id: string; name: string; version: string; status: string; description: string; folder?: string; profile: string; links: Link[]; features: CatalogFeature[]; counts: Record<FeatureState, number>; total: number; progress: number; plans: string[]; [k: string]: unknown }
export interface CatalogFilter { q?: string; kinds?: string[]; gaps?: boolean; planned?: boolean; profile?: string; status?: string }

export const SCHEMA: string; export const SEP: string;
export const STATUSES: { id: Status; label: string; icon: string; tone: '' | 'accent' | 'success' | 'warning' | 'danger' }[];
export const STATUS_IDS: Status[]; export const PRIORITIES: Priority[]; export const MODELS: Model[]; export const LINK_KINDS: string[];
export const FEATURE_STATES: FeatureState[]; export const PRICE_PER_MIN: Record<Model, number>;
export const LISTS: Record<ListId, { label: string; item: 'text' | 'check' }>; export const LIST_IDS: ListId[];
export const BUILT_IN_TEMPLATES: Template[]; export const SORTS: { id: string; label: string }[]; export const GROUPS: { id: string; label: string }[];
export const CATALOG_KINDS: { id: string; label: string; icon: string }[];
export function slug(s: string, max?: number): string; export function rid(n?: number): string; export function hid(s: string, n?: number): string;
export function normPath(p: string | string[]): string; export function pathParts(p: string): string[]; export function parentPath(p: string): string; export function leafName(p: string): string;
export function withParents(paths: string[]): string[];
export function categoryTree(paths: string[], plans?: Plan[]): CatNode[];
export function categoryOp(paths: string[], plans: Plan[], change: Record<string, unknown>): { paths: string[]; plans: Plan[]; log: string[] };
export function minutesOf(v: unknown): number; export function normModel(m: unknown): Model | '';
export function normalize(raw: unknown, opts?: { now?: string; prices?: Record<string, number> }): Plan;
export function validate(p: unknown): string[];
export function totals(p: Plan, prices?: Record<string, number>): Totals;
export function fmtMinutes(m: number): string; export function fmtCost(c: number): string;
export function orderSteps(steps: Step[]): Step[];
export function diff(a: unknown, b: unknown, base?: string): DiffItem[]; export function describeDiff(d: DiffItem[]): string[];
export function emptyHistory(id: string): History;
export function addVersion(h: History | null, plan: Plan, meta?: Record<string, unknown>, opts?: { keep?: number; coalesceMin?: number }): History;
export function restoreVersion(h: History, v: number, current?: Plan | null): Plan;
export function allTemplates(user: unknown): Template[]; export function fromTemplate(t: Template | null | undefined, fields?: Record<string, unknown>, opts?: Record<string, unknown>): Plan;
export function asTemplate(plan: Plan, label: string): { id: string; label: string; icon: string; plan: Record<string, unknown> };
export function searchText(p: Plan): string;
export function filterPlans(plans: Plan[], f?: Filter): Plan[]; export function sortPlans(plans: Plan[], by?: string): Plan[];
export function groupPlans(plans: Plan[], by: string): { id: string; label: string; plans: Plan[] }[];
export function counts(plans: Plan[]): { plans: number; statuses: Record<string, number>; priorities: Record<string, number>; minutes: number; left: number; cost: number };
export function duplicates(plan: Plan, plans: Plan[], threshold?: number): { plan: Plan; score: number }[];
export function bulk(plans: Plan[], ids: string[], change: Record<string, unknown>): Plan[];
export function roadmap(plans: Plan[]): { month: string; plans: Plan[] }[];
export function outline(md: string): { level: number; text: string; id: string }[];
export function toMarkdown(p: Plan): string; export function fromMarkdown(md: string, opts?: Record<string, unknown>): Plan;
export function toBuild(plan: Plan, o?: { profile?: string; id?: string }): { action: 'add'; id: string; title: string; category: string; detail: string; steps: { text: string; model: string; estimate: string; phase: string }[]; [k: string]: unknown };
export function linkBuild(plan: Plan, b: { profile: string; id: string }, at?: string): Plan;
export function syncBuild(plan: Plan, build: unknown): { plan: Plan; changed: boolean };
export function overlayCatalog(entries: unknown[], plans: Plan[]): CatalogEntry[];
export function filterCatalog(entries: CatalogEntry[], f?: CatalogFilter): CatalogEntry[];
export function planFromFeature(entry: CatalogEntry, feature: CatalogFeature, opts?: Record<string, unknown>): Plan;
