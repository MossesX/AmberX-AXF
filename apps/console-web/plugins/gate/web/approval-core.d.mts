export type Decision = 'allow' | 'veto' | 'confirm' | 'deny';
export interface ApprovalRule { match: string; policy?: Decision; vetoSeconds?: number }
export interface ApprovalRuleView extends ApprovalRule { decides: number; sample: string[] }
export interface ApprovalService { service: string; displayName: string; type: string; enabled: boolean; tools: number; own: number; counts: Record<Decision, number>; live: ApprovalRule[]; rules: ApprovalRuleView[]; clearOwn: boolean; changed: boolean }
export interface SaveBody { changes?: { service: string; tool: string; policy: null }[]; rules?: { service: string; rules: ApprovalRule[] }[]; reason: string }
export interface ApprovalRules {
  $axf: string; ok: boolean; at: string; hub: string; available: boolean; message?: string; decisions: Decision[]; ops: string[];
  hold: { default: number; min: number; max: number };
  services: ApprovalService[]; pending: number; draft: { by: string; at: string; reason: string } | null; save: SaveBody | null;
  default: { summary: string; reason: string; applied?: boolean };
  canSave?: boolean; staged?: boolean;
}
export interface StageOp { op: 'add' | 'edit' | 'remove' | 'move' | 'set' | 'clear-own' | 'default' | 'discard'; service?: string; index?: number; to?: number; rule?: Partial<Record<keyof ApprovalRule, string | number | null>>; rules?: ApprovalRule[]; clearOwn?: boolean; on?: boolean }
export interface DraftEntry { rules: ApprovalRule[]; clearOwn: boolean }
export interface PolicyTableLike { services?: { namespace: string; displayName?: string; type?: string; enabled?: boolean; rules?: ApprovalRule[]; tools?: { name: string; explicit?: Decision; policy: Decision; annotations?: Record<string, unknown> }[] }[]; veto?: { defaultSeconds: number; min: number; max: number } }
export const FRAME: string;
export const DRAFT_FRAME: string;
export const DECISIONS: readonly Decision[];
export const HOLD_MIN: number;
export const HOLD_MAX: number;
export const HOLD_DEFAULT: number;
export const MAX_RULES: number;
export const OPS: readonly string[];
export const DEFAULT: { reason: string; summary: string; services: Record<string, DraftEntry> };
export function matches(pattern: string, name: string): boolean;
export function ruleProblem(rule: unknown): string;
export function cleanRule(rule: unknown): ApprovalRule;
export function cleanRules(rules: unknown): ApprovalRule[];
export function decidingIndex(rules: ApprovalRule[], tool: { name: string; annotations?: Record<string, unknown> }): number;
export function serviceView(service: NonNullable<PolicyTableLike['services']>[number], entry: DraftEntry | null): ApprovalService;
export function saveBody(table: PolicyTableLike | null | undefined, draft: { services?: Record<string, DraftEntry> } | null | undefined, reason?: string): SaveBody | null;
export function defaultDraft(table: PolicyTableLike | null | undefined): Record<string, DraftEntry>;
export function onDefault(table: PolicyTableLike | null | undefined): boolean;
export function stage(draftServices: Record<string, DraftEntry> | null | undefined, table: PolicyTableLike | null | undefined, op: StageOp): Record<string, DraftEntry>;
export function view(live: { hub?: string; available?: boolean; table?: PolicyTableLike; message?: string } | null | undefined, draft: unknown): ApprovalRules;
export function lines(v: ApprovalRules): string[];
export function putRules(hub: string, body: SaveBody | null, opts?: { fetch?: typeof fetch }): Promise<{ ok: boolean; code?: string; message?: string; [k: string]: unknown }>;
