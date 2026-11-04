// Types for optimizer-core.mjs (build-optimize@1).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Candidate } from './packager-core.mjs';

export type Mode = 'auto' | 'deep' | 'basic';
export type Target = 'fewest' | 'balanced' | 'fastest';
export type RuleId = 'area' | 'chain' | 'category' | 'app' | 'profile' | 'modelSplit' | 'urgentApart';
export interface Settings {
  mode: Mode; aiModel: 'Fable' | 'Opus'; aiThinking: string; tokenBudget: number; agent: string;
  maxSteps: number; maxMinutes: number; maxBuilds: number; target: Target; slots: number; overheadMin: number;
  rules: Record<RuleId, { on: boolean; weight: number }>;
  safety: { neverTouchRunning: true; respectPins: boolean; pullFromRunning: boolean; emptied: 'archive' | 'delete'; requireConfirm: true };
  drops: 'flag' | 'untick'; naming: string; categoryRule: 'common' | 'first' | 'fixed'; fixedCategory: string;
  schedule: 'manual' | 'after-new' | 'nightly'; notify: 'no-ai' | 'every' | 'off'; pins: string[];
}
export interface Filter {
  profiles: string[]; categories: string[]; models: string[]; thinking: string[]; agents: string[]; statuses: string[]; areas: string[]; tags: string[];
  minAgeDays: number; maxAgeDays: number; fableCandidates: boolean; include: string[]; exclude: string[]; q: string;
}
export interface Item extends Candidate { agent: string; tags: string[]; createdAt: string; app: string }
export interface Flag { kind: 'built' | 'duplicate'; ref: string; why: string; score: number; ai?: boolean }
export interface Pack {
  id: string; name: string; category: string; model: 'Fable' | 'Opus' | 'Mixed'; thinking: string; minutes: number; keys: string[];
  sources: string[]; areas: string[]; why: string; after: { id: string; why: string }[]; ai?: { name: string; why: string };
}
export interface Summary { from: number; to: number; packs: number; steps: number; emptied: string[]; partial: string[]; left: number; minutes: number; saved: { fewer: number; minutes: number; usd: number }; line: string }
export interface Plan {
  $axf: string; mode: 'basic' | 'deep'; at: string; packs: Pack[]; stays?: string[]; unticked: string[]; flags: Record<string, Flag>; settings: Settings;
  warnings: string[]; summary: Summary; open?: Record<string, string[]>; filter?: Filter; out?: { key: string; build: string; why: string }[]; inProgress?: string[]; profile?: string;
  reasons?: Record<string, { kind: string; why: string }>; notes?: Record<string, { why: string; model?: string; upgrade?: boolean; thinking?: string; split?: boolean }>;
  deps?: { key: string; needs: string; why: string }[]; rejected?: string[];
  run?: { wanted: string; fellBack: boolean; why: string; estimate: number; usage: any; agent: string; scheduled: boolean; booked?: boolean };
}
export const SCHEMA: string;
export const MODES: Mode[];
export const TARGETS: Target[];
export const NOTIFY: Settings['notify'][];
export const SCHEDULES: Settings['schedule'][];
export const EMPTIED: Settings['safety']['emptied'][];
export const DROPS: Settings['drops'][];
export const CATEGORY_RULES: Settings['categoryRule'][];
export const RULES: RuleId[];
export const RULE_LABEL: Record<RuleId, string>;
export const STATUS_SCOPE: string[];
export const DEFAULT_SETTINGS: Settings;
export const LOCKED: string[];
export const DEFAULT_FILTER: Filter;
export const PRESETS: Record<string, { label: string; settings: Partial<Settings>; filter?: Partial<Filter> }>;
export function normSettings(s?: any): Settings;
export function withPreset(settings: any, preset: any): Settings;
export function normFilter(f?: any): Filter;
export function scope(builds: any[], opts?: { plans?: any[]; profileOrder?: any; settings?: any; filter?: any; now?: string }): { items: Item[]; out: { key: string; build: string; why: string }[]; inProgress: string[] };
export function facets(items: Item[]): Record<string, { value: string; n: number }[]>;
export function words(t: string): Set<string>;
export function similarity(a: string, b: string): number;
export function findDuplicates(items: Item[], builds: any[], opts?: { min?: number }): Record<string, Flag>;
export function packName(template: string, items: Item[], n: number): string;
export function describePack(keys: string[], byKey: Map<string, Item>, opts?: any): Pack;
export function orderPacks(packs: Pack[], byKey: Map<string, Item>): { packs: Pack[]; warnings: string[] };
export function savings(from: number, to: number, st: Settings, pricing: any): Summary['saved'];
export function plan(items: Item[], opts?: { settings?: any; builds?: any[]; pricing?: any; now?: string }): Plan;
export function finish(pl: Plan, items: Item[], opts?: any): Plan;
export function validate(pl: Plan, items: Item[], settings: any): string[];
export function moveKeys(pl: Plan, keys: string[], to: string, index?: number | null, opts?: { items?: Item[]; settings?: any }): Plan;
export function missingPrereqs(pl: Plan, keys: string[], to: string, items: Item[]): string[];
export function tick(pl: Plan, key: string, on: boolean, items: Item[]): Plan;
export function rename(pl: Plan, id: string, name: string, items: Item[]): Plan;
export function applyRequest(pl: Plan): { $axf: string; mode: string; packs: { id: string; name: string; category: string; thinking: string; keys: string[]; after: string[]; why: string; order: number }[]; emptied: string };
export function estimateTokens(prompt: string): number;
export function applyAi(pl: Plan, ai: any, items: Item[], opts?: any): Plan;
export function notice(pl: Plan, opts?: { fellBack?: boolean; why?: string }): string;
export function shouldNotify(setting: string, opts: { fellBack?: boolean }): boolean;
