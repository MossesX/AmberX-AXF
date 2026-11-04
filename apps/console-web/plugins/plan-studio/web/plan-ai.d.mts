/** Types for plan-ai.mjs (plain English → plan@1 edits). */
import type { Plan, CatalogEntry } from './plan-core.mjs';
export type Op = { op: string; [k: string]: unknown };
export interface Ctx { plan?: Plan | null; plans?: Plan[]; catalog?: CatalogEntry[]; categories?: string[]; builds?: unknown[]; now?: string }
export interface Applied { plan: Plan | null; others: Map<string, Plan>; created: Plan[]; summary: string[]; answer: string; ask: string; changed: boolean }
export const OP_KINDS: string[]; export const SET_FIELDS: string[];
export function clauses(text: string): string[];
export function rules(text: string, ctx?: Ctx): { ops: Op[]; understood: boolean } | null;
export function applyOps(ops: Op[], ctx?: Ctx): Applied;
export function isSmall(ops: Op[]): boolean; export function isBig(ops: Op[]): boolean;
export function modelPrompt(text: string, ctx?: Ctx): { system: string; messages: { role: string; content: string }[] };
export function parseModelReply(text: string): { ops: Op[]; reply: string };
export function interpret(text: string, ctx?: Ctx, complete?: ((p: { system: string; messages: unknown[] }) => Promise<string>) | null): Promise<{ ops: Op[]; reply: string; via: string; needsAi?: boolean }>;
export function speakable(res: Partial<Applied> & { summary?: string[]; answer?: string; ask?: string }): string;
export function answerLeft(p: Plan): string;
export function findPlan(plans: Plan[] | undefined, name: string): Plan | null;
export function findCatalog(catalog: CatalogEntry[] | undefined, name: string): { entry: CatalogEntry; feature: unknown; score: number } | null;
