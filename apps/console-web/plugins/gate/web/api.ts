/**
 * The gate plugin's web client: every press calls the same REST routes the CLI and MCP use (server/routes.py →
 * gate.mjs), so the page, `axf gate …`, the gate_* / lander_* tools and voice give the same answers.
 */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'gate';
export const TABS = ['rules', 'build-rules', 'auto-lander', 'build-cap', 'passes', 'history'] as const;
export type GateTab = (typeof TABS)[number];

export interface GateRule { id: string; kind: string; enabled: boolean; severity: 'block' | 'warn' | 'info'; owner: string; title: string; description: string; settings: Record<string, unknown>; source?: string; updatedAt?: string; updatedBy?: string }
export interface RuleSet { rev: number; at: string; rules: GateRule[]; migratedFrom?: { keys: string[] } }
export interface Verdict { pr: number; pass: boolean; held: boolean; blockedBy: string; reasons: string[]; warnings: string[]; known?: boolean; results: { id: string; verdict: string; reason: string; severity: string }[] }
export interface Waiting { position: number; pr: number; title: string; build: string; branch: string; state: string; rule: string; reason: string; since: string; url?: string; gate?: { pass: boolean; blockedBy: string; reasons: string[] } }
export interface Run { startedAt: string; finishedAt: string; result: string; mode: string; reasonText: string; landing: { pr: number; title: string; build: string } | null; merged: number[] }
export interface LanderStatus { status: string; enabled: boolean; paused: boolean; pause: { why: string; by: string; at: string } | null; mode: string; mergeQueue: boolean; modeSince: string; modeBy: string; landing: { pr: number; title: string; build: string; since: string } | null; counts: { waiting: number; runs: number }; lastRun: Run | null; at: string }
export interface HistoryEntry { at: string; by: string; kind: 'rule' | 'lander'; action: string; id?: string; pr?: number; before?: unknown; after?: unknown; reason: string | { title: string; description: string } }
export interface GateSettings { refreshSec: number; historySize: number; defaultTab: GateTab }
/** build-rule@1 as the list sends it (sources left out, their count kept) with its last run. */
export interface BuildRule { id: string; title: string; text: string; doer: 'vps' | 'session'; kind: 'mechanical' | 'judgement'; phase: 'before' | 'dispatch' | 'after' | 'gate'; enabled: boolean; check: string; autofix: string; briefBlock: 'look' | 'api' | 'checkpoints' | 'rules'; applies: 'builds' | 'interactive' | 'all'; when: { ui?: boolean; keywords?: string[] }; note?: string; rev: number; updatedAt: string; updatedBy: string; sourceCount?: number; checkKind?: string; last?: BuildRuleRunSummary | null }
export interface BuildRuleRunSummary { result: 'pass' | 'fixed' | 'fail' | 'skipped'; at: string; build: string; phase: string; detail: string }
export interface BuildRuleRun extends BuildRuleRunSummary { id: string; by: string; dryRun?: boolean; fix?: { fixer: string; ok: boolean; detail: string; changed: string[] } }
export interface BuildRuleHistory { at: string; by: string; action: string; id?: string; rev: number; reason: { title: string; description: string }; before?: Partial<BuildRule>; after?: Partial<BuildRule> }
export interface BuildRuleEnums { doers: string[]; kinds: string[]; phases: string[]; briefBlocks: string[]; applies: string[]; fixers: string[] }
export interface BuildRuleList { rev: number; at: string; source: 'live' | 'seed' | 'empty'; counts: { total: number; vps: number; session: number; on: number }; rules: BuildRule[]; enums: BuildRuleEnums }
export interface Answer { ok: boolean; code?: string; message?: string; confirm?: string; [k: string]: unknown }

/** One call: the JSON answer; a failure throws with the server's message (a confirm request is an answer). */
export async function gateCall<T = Answer>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T & Answer> {
  const r = await pluginFetch(FOLDER, path, method === 'GET' ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  let j: Answer;
  try { j = (await r.json()) as Answer; } catch { throw new Error(r.status === 404 ? 'The VPS Configuration plugin is off or its server part is not running.' : `The gate answered ${r.status}.`); }
  if (!j.ok && j.code !== 'confirmation_required') throw new Error(String(j.message || j.detail || `The gate answered ${r.status}.`));
  return j as T & Answer;
}

/** A two-step press (Reset, Land now): ask for the token, then send it back. Call only after the person confirmed. */
export async function confirmed<T = Answer>(path: string, body: Record<string, unknown>): Promise<T & Answer> {
  const first = await gateCall<T>(path, 'POST', body);
  if (first.code !== 'confirmation_required') return first;
  return gateCall<T>(path, 'POST', { ...body, confirm: first.confirm });
}

// ------------------------------------------------------------------ the open tab (deep links, actions, the view)

type Listener = (tab: GateTab) => void;
const listeners = new Set<Listener>();
let wanted: GateTab | null = null;
export const isTab = (t: unknown): t is GateTab => typeof t === 'string' && (TABS as readonly string[]).includes(t);
/** Ask the view to show a tab (it may not be mounted yet: it reads `takeWantedTab` when it mounts). */
export function showTab(tab: GateTab): void { wanted = tab; for (const l of listeners) l(tab); }
export function takeWantedTab(): GateTab | null { const t = wanted; wanted = null; return t; }
export function onShowTab(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
