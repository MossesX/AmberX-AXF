export type Decision = 'allow' | 'veto' | 'confirm' | 'deny';
export interface PolicyTool { name: string; description?: string; annotations?: { readOnly?: boolean; destructive?: boolean; explicitApproval?: boolean; ownerGrant?: boolean }; explicit?: Decision; policy: Decision; vetoSeconds?: number }
export interface PolicyService { namespace: string; type: string; enabled: boolean; defaultPolicy: Decision; policyPreset?: string; tools: PolicyTool[]; toolsStale?: boolean }
export interface PolicyTable { services: PolicyService[]; veto?: { defaultSeconds: number; min: number; max: number } }
export interface PolicyRules { hold?: { service: string; tools: string[] | '*'; why?: string }[]; holdMatch?: string[] }
export interface PolicyChange { service: string; tool: string; policy?: Decision | null; vetoSeconds?: number }
export interface PlanRow { service: string; tool: string; from: Decision; to: Decision; why: string }
export const TABLE_FRAME: string;
export const DECISIONS: Decision[];
export const VETO_MIN: number;
export const VETO_MAX: number;
export function secondsOk(n: number): boolean;
export function onHoldList(service: string, tool: string, rules?: PolicyRules): string;
export function defaultFor(service: PolicyService, tool: PolicyTool, rules?: PolicyRules): { decision: Decision | null; why: string };
export function planDefaults(table: PolicyTable | null | undefined, rules?: PolicyRules): PlanRow[];
export function groupChanges(service: PolicyService, policy: Decision | null, vetoSeconds?: number): PolicyChange[];
export function groupDecision(service: PolicyService): Decision | 'mixed';
export function counts(table: PolicyTable | null | undefined): Record<Decision, number>;
export function changesProblem(changes: PolicyChange[]): string;
export function putPolicy(hub: string, changes: PolicyChange[], reason: string, opts?: { fetch?: typeof fetch }): Promise<{ ok: boolean; code?: string; message?: string; [k: string]: unknown }>;
