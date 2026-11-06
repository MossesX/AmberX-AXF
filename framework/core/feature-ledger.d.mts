/** Types for feature-ledger.mjs (feature-ledger@1: every individual feature, where it came from, when it went live). */
import type { Deploy } from './deploy-log.mjs';
export { normDeploy, validateDeploy, dateMark } from './deploy-log.mjs';
export const SCHEMA: 'feature-ledger@1';
export const VERSION: 1;
export const RECORDS: { feature: 'feature@1'; edit: 'feature-edit@1'; pr: 'ledger-pr@1'; build: 'ledger-build@1'; prompt: 'prompt@1'; deploy: 'deploy@1' };
export type Status = 'planned' | 'queued' | 'building' | 'in-pr' | 'merged' | 'live' | 'cancelled' | 'removed';
export type StatusGroup = 'pending' | 'completed' | 'cancelled';
export type Event = 'planned' | 'queued' | 'building' | 'pr-opened' | 'pr-closed' | 'merged' | 'deployed' | 'cancelled' | 'removed';
export type FeatureType = 'new-feature' | 'fix' | 'ui' | 'framework-contract' | 'infra' | 'docs' | 'perf' | 'refactor' | 'test' | 'chore' | 'removal';
export type Role = 'added' | 'changed' | 'fixed' | 'removed';
export type EditKind = 'changed' | 'fixed' | 'removed' | 'renamed' | 'moved' | 'reverted' | 'restored';
export type Grouping = 'pr' | 'plugin' | 'app' | 'type' | 'build' | 'day' | 'repo' | 'flat';
export type SortKey = 'liveAt' | 'mergedAt' | 'plannedAt' | 'lastChangedAt' | 'lastEditAt' | 'editCount' | 'name' | 'status' | 'app' | 'plugin' | 'type' | 'builds' | 'prs' | 'repo';
export type Tone = 'muted' | 'info' | 'warn' | 'accent' | 'ok' | 'danger';
export const STATUSES: Status[]; export const PENDING_STATUSES: Status[]; export const COMPLETED_STATUSES: Status[]; export const ENDED_STATUSES: Status[];
export const STATUS_LABEL: Record<Status, string>; export const STATUS_TONE: Record<Status, Tone>; export const EVENTS: Event[];
export const FEATURE_TYPES: FeatureType[]; export const TYPE_LABEL: Record<FeatureType, string>; export const ROLES: Role[]; export const EDIT_KINDS: EditKind[];
export const REPOS: Record<string, { label: string; github: string }>; export const SOURCES: Array<'live' | 'import' | 'manual'>;
export const GROUPINGS: Grouping[]; export const GROUPING_LABEL: Record<Grouping, string>; export const SORT_KEYS: SortKey[];
export interface LiveEntry { at: string; guessed: boolean; deploy: string }
export interface BuildRef { id: string; profile: string; role: Role }
export interface PrRef { repo: string; number: number; role: Role }
export interface PromptRef { id: string; passage: string }
export interface Feature {
  $axf: 'feature@1'; id: string; name: string; description: string; type: FeatureType; app: string; plugin: string; repo: string; originRepo: string; movedIntoAxf: boolean;
  status: Status; stalled: boolean; plannedAt: string; mergedAt: string; mergedAtGuessed: boolean; liveAt: Record<string, LiveEntry>; firstLiveAt: string; lastChangedAt: string;
  builds: BuildRef[]; prs: PrRef[]; commits: string[]; mergeCommit: string; prompts: PromptRef[]; model: string; thinking: string; agent: string; session: string; files: string[];
  links: Record<string, string>; edits: string[]; editCount: number; lastEditAt: string; beingEdited: boolean; tags: string[]; source: 'live' | 'import' | 'manual'; confidence: 'exact' | 'guessed';
  createdAt: string; updatedAt: string; rev: number;
}
export interface Edit {
  $axf: 'feature-edit@1'; id: string; feature: string; kind: EditKind; summary: string; build: string; profile: string; pr: number; repo: string; commit: string; prompt: string; passage: string;
  model: string; agent: string; session: string; status: Status; at: string; mergedAt: string; liveAt: Record<string, LiveEntry>; files: string[]; source: 'live' | 'import' | 'manual'; createdAt: string; updatedAt: string; rev: number;
}
export interface Pr { $axf: 'ledger-pr@1'; key: string; repo: string; number: number; title: string; body: string; branch: string; author: string; url: string; createdAt: string; mergedAt: string; mergeCommit: string; closedAt: string; state: 'open' | 'merged' | 'closed'; build: string; profile: string; features: string[]; files: string[] }
export interface BuildRecord { $axf: 'ledger-build@1'; key: string; id: string; profile: string; title: string; category: string; status: string; branch: string; pr: number; repo: string; mergedAt: string; builtAt: string; createdAt: string; model: string; thinking: string; agent: string; session: string; prompt: string; report: string; features: string[] }
export interface Prompt { $axf: 'prompt@1'; id: string; build: string; profile: string; kind: 'origin' | 'addendum'; index: number; said: string; at: string; source: string; by: string; session: string; link: string; verbatim: boolean; mayBeParaphrased: boolean; from: string }
export interface Ledger { $axf: 'feature-ledger@1'; version: number; since: string; updatedAt: string; repos: Record<string, { label: string; github: string }>; features: Feature[]; edits: Edit[]; prs: Pr[]; builds: BuildRecord[]; prompts: Prompt[]; deploys: Deploy[] }
export interface View { by: Grouping; sort: { by: SortKey; dir: 'asc' | 'desc' }; hideCompleted: boolean; hidePending: boolean; hideCancelled: boolean; statuses: Status[]; hasEdits: boolean | null; beingEdited: boolean; editStatus: Status | ''; search: string; app: string; plugin: string; type: FeatureType | ''; repo: string; live: '' | 'yes' | 'no'; from: string; to: string; hiddenColumns: string[]; expanded: string[] }
export const DEFAULT_VIEW: View;
export interface Group { key: string; by: Grouping; label: string; count: number; features: Feature[]; counts: { pending: number; completed: number; cancelled: number; live: number; edited: number }; liveAt: string; mergedAt: string; lastChangedAt: string; record: Pr | BuildRecord | null }
export interface Chip { status?: Status; label: string; tone: Tone; count?: number; lastEditAt?: string }
export interface Ctx { prompts?: Prompt[] | Map<string, Prompt>; edits?: Edit[] | Map<string, Edit>; prs?: Pr[] | Map<string, Pr>; builds?: BuildRecord[] | Map<string, BuildRecord> }
export type Contains = ((deploySha: string, mergeSha: string) => boolean) | Map<string, boolean>;
export interface Validation { ok: boolean; errors: Array<{ field: string; message: string }> }
export function iso(v: unknown): string;
export function slug(s: unknown): string;
export function normStatus(v: unknown, d?: string): Status; export function statusGroup(s: Status): StatusGroup; export function isPending(s: string): boolean; export function isCompleted(s: string): boolean;
export function canTransition(from: string, to: string): boolean; export function advance(status: string, event: string): Status; export function laterStatus(a: string, b: string): Status;
export function statusFromBuild(b: { status?: string; pr?: string | number; mergedAt?: string; live?: boolean; deleted?: boolean }): { status: Status; stalled: boolean };
export function normType(v: unknown): FeatureType; export function normRepo(v: unknown): string; export function normRole(v: unknown, d?: Role): Role;
export function featureId(name: string, scope?: string): string; export function prKey(repo: string, number: number): string; export function buildKey(profile: string, id: string): string; export function promptId(buildId: string, index?: number): string; export function editId(featureId: string, at: string, seq?: number): string; export function featureKey(f: Partial<Feature>): string;
export function normFeature(v: unknown, opts?: { now?: string }): Feature | null; export function normEdit(v: unknown, opts?: { now?: string }): Edit | null; export function normPr(v: unknown): Pr | null; export function normBuildRecord(v: unknown): BuildRecord | null; export function normPrompt(v: unknown): Prompt | null;
export function promptsFromOrigin(buildId: string, origin: unknown, profile?: string): Prompt[];
export function validateFeature(v: unknown): Validation; export function validateEdit(v: unknown): Validation; export function validatePr(v: unknown): Validation; export function validatePrompt(v: unknown): Validation; export function rejection(errors: Validation['errors']): string;
export function mergeFeature(a: unknown, b: unknown): Feature | null; export function applyEdit(feature: unknown, edit: unknown, now?: string): Feature | null; export function refreshEdits(feature: unknown, edits: unknown[]): Feature | null; export function withLive(feature: unknown, deploys: unknown[], contains: Contains): Feature | null;
export function emptyLedger(now?: string): Ledger; export const MIGRATIONS: Array<(doc: any) => any>; export function migrate(doc: unknown, now?: string): Ledger; export function mergeLedgers(a: unknown, b: unknown, now?: string): Ledger;
export function normView(v: unknown): View; export function filterFeatures(features: Feature[], view: unknown, ctx?: Ctx): Feature[]; export function sortFeatures(features: Feature[], sort?: View['sort']): Feature[]; export function groupFeatures(features: Feature[], view: unknown, ctx?: Ctx): Group[];
export function statusChip(rec: unknown): Chip & { status: Status }; export function editedChip(f: unknown): Chip | null;
export function saidBlock(feature: unknown, prompts: Prompt[] | Map<string, Prompt>): Array<{ id: string; kind: 'origin' | 'addendum'; index: number; at: string; source: string; verbatim: boolean; mayBeParaphrased: boolean; said: string; passage: string; highlight: [number, number] | null }>;
export const COLUMNS: ReadonlyArray<{ id: string; label: string; sort?: SortKey }>;
export function exportRows(features: Feature[], opts?: { columns?: string[] }): { columns: string[]; rows: string[][] }; export function toCsv(t: { columns: string[]; rows: string[][] }): string; export function toMarkdown(t: { columns: string[]; rows: string[][] }): string;
export const REGISTRY: Readonly<Record<string, unknown>>;
export function jsonSchemas(): Record<string, object>;
