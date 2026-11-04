/** Types for requests-core.mjs (request@1, request-ledger@1). Every object keeps unknown fields. */
export interface Where { kind: string; id: string; label?: string; file?: string; [k: string]: unknown }
export interface HistoryEntry { at: string; text: string; status?: string; [k: string]: unknown }
export interface QueuePlace { list: string; position: number; of: number }
export interface SlotPlace { state: 'running' | 'waiting'; position?: number; of?: number; agent?: string; session?: string; since?: string }
export interface Request {
  $axf: string; id: string; kind: string; title: string; said: string; verbatim: boolean; at: string; source: string; capturedBy: string;
  parent?: string; where: Where[]; status: string; supersededBy?: string; supersedes?: string[]; reversedBy?: string; amendedBy?: string[];
  queue?: QueuePlace | null; slot?: SlotPlace | null; agent?: string; agentId?: string; pr?: string; branch?: string;
  costUsd?: number | null; costEstimated?: boolean | null; profile?: string; app?: string; summary?: string; category?: string;
  steps?: { done: number; total: number; next?: string; nextText?: string };
  history: HistoryEntry[]; notes?: { at: string; text: string; by?: string }[]; updatedAt: string;
  [k: string]: unknown;
}
export interface Summary { total: number; open: number; statuses: Record<string, number>; kinds: Record<string, number>; running: number; queued: number; awaitingMerge: number; costUsd: number }
export interface RequestsRes { ok: boolean; error?: string; generatedAt?: string; fingerprint?: string; summary?: Summary; counts?: Record<string, number>; requests: Request[] }
export interface StatusInfo { id: string; label: string; icon: string; tone: '' | 'accent' | 'success' | 'warning' | 'danger'; open: boolean }
export interface KindInfo { id: string; label: string; icon: string }
export interface Filter { q?: string; statuses?: string[]; kinds?: string[]; profiles?: string[]; apps?: string[]; open?: boolean; range?: string; from?: string; to?: string }
export interface Group { id: string; label: string; items: Request[] }
export interface Ledger { $axf: string; updatedAt: string; records: Record<string, Record<string, unknown>> }

export const SCHEMA: string;
export const LEDGER: string;
export const REPO: string;
export const STATUSES: StatusInfo[];
export const KINDS: KindInfo[];
export const KIND_IDS: string[];
export const SOURCES: string[];
export const SORTS: { id: string; label: string }[];
export const GROUPS: { id: string; label: string }[];
export function normStatus(s: unknown): string;
export function statusInfo(id: unknown): StatusInfo;
export function kindInfo(id: unknown): KindInfo;
export function isOpen(r: Pick<Request, 'status'> | null | undefined): boolean;
export function slug(s: unknown): string;
export function sameText(s: unknown): string;
export function prUrl(pr: unknown): string;
export function normRequest(r: unknown, now?: string): Request;
export function buildStatus(b: unknown): string;
export function queuePositions(builds: unknown[]): Map<string, QueuePlace>;
export function slotsByBuild(state: unknown): Map<string, SlotPlace>;
export function agentFromNotes(notes: unknown[]): string;
export function costsByBuild(entries: unknown[]): Map<string, { usd: number; estimated: boolean; sessions: number }>;
export function buildHistory(b: unknown): HistoryEntry[];
export function fromBuild(b: unknown, ctx?: unknown): Partial<Request>[];
export function parseBrief(text: string, folder?: string): { build: string; title: string; said: string; at: string; source: string; addenda: { n: number; heading: string; said: string; at: string; source: string; reverses: boolean; overrides: boolean }[] };
export function fromBrief(p: unknown, buildReq?: unknown): Partial<Request>[];
export function fromPlan(p: unknown): Partial<Request> | null;
export function fromBug(g: unknown): Partial<Request> | null;
export function parseMemory(text: string, file: string, kind?: string): Partial<Request>[];
export function parseThreads(text: string): { build: string; said: string; title: string; state: string; date: string }[];
export function askBuild(a: unknown): string;
export function fromAsk(a: unknown): Partial<Request> | null;
export function emptyLedger(): Ledger;
export function normLedger(raw: unknown): Ledger;
export function assemble(src?: Record<string, unknown>, ledger?: unknown, now?: string): Request[];
export function applyPatch(base: Partial<Request>, rec: unknown): Partial<Request>;
export function recordChanges(requests: Request[], ledger: unknown, now?: string): { ledger: Ledger; changed: string[] };
export function patchLedger(ledger: unknown, id: string, patch: Record<string, unknown>, opts?: { by?: string; now?: string }): Ledger;
export function captureRecord(input: Record<string, unknown>, now?: string): { id: string; record: Record<string, unknown> };
export const requestTime: (r: Request) => number;
export const searchText: (r: Request) => string;
export function filterRequests(rs: Request[], f?: Filter, now?: number): Request[];
export function sortRequests(rs: Request[], sort?: string): Request[];
export const buildOf: (r: Pick<Request, 'where'>) => string;
export function groupRequests(rs: Request[], by?: string): Group[];
export function summarize(rs: Request[]): Summary;
export const fmtUsd: (n: unknown) => string;
export function age(at: string | undefined, now?: number): string;
export function whereLine(r: Request): string;
export function fingerprint(rs: Request[]): string;
