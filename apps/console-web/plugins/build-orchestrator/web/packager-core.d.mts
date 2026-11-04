// Types for packager-core.mjs (build-package@1).
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Prior { key: string; text: string; model: 'Fable' | 'Opus'; inProgress?: boolean; packaged?: string; helper?: boolean }
export interface Candidate {
  key: string; kind: 'step' | 'plan-step'; build: string; buildTitle: string; buildStatus: string; category: string; profiles: string[]; order: number;
  package: string; step: string; uid: string; index: number; text: string; fullText?: string; model: 'Fable' | 'Opus'; recommendedModel: string;
  thinking: string; why: string; estimate: string; minutes: number; files: string[]; areas: string[]; after: string[]; phase: string; before: (string | Prior)[];
}
export interface Need { key: string; text: string; model: string; selectable: boolean; inProgress: boolean; packaged: string; helper: boolean }
export interface Dependency { key: string; text: string; build: string; needs: Need[] }
export interface Group { build: string; title: string; status: string; kind: string; items: Candidate[]; minutes: number }
export const SCHEMA: string;
export const MODELS: ('Fable' | 'Opus')[];
export const THINKING: string[];
export const DEFAULT_THINKING: Record<string, string>;
export const WAITING_STATUSES: string[];
export const DESTINATIONS: string[];
export const PRESETS: Record<string, { label: string; filter: Record<string, string>; dest: string; now: boolean }>;
export const DEFAULT_FILTER: { model: string; thinking: string; area: string; profile: string; status: string; q: string };
export function minutesOf(e: unknown): number | null;
export function fmtMinutes(min: number): string;
export function normThinking(t: unknown): string;
export function areaOf(path: string): string;
export function areasOf(paths: string[]): string[];
export function adviceModel(step: any): string;
export function candidates(builds: any[], opts?: { plans?: any[]; profileOrder?: Record<string, Record<string, number>> }): { candidates: Candidate[]; skipped: { noSteps: string[]; inProgress: string[] } };
export function matches(c: Candidate, f?: Partial<typeof DEFAULT_FILTER>): boolean;
export function filterCandidates(list: Candidate[], f?: Partial<typeof DEFAULT_FILTER>): Candidate[];
export function facets(list: Candidate[]): Record<string, { value: string; n: number }[]>;
export function groups(list: Candidate[]): Group[];
export function select(sel: string[], op: string, keys?: string[]): string[];
export function presetKeys(list: Candidate[], preset?: string): string[];
export function move(order: string[], key: string, to: number): string[];
export function dependencies(list: Candidate[], sel: string[]): Dependency[];
export function bringAlong(sel: string[], deps: Dependency[]): string[];
export function keepDeps(order: string[], list: Candidate[]): { order: string[]; fixed: string[] };
export function packageId(name: string, taken?: string[]): string;
export function suggestName(items: Candidate[], model?: string): string;
export function makePackage(list: Candidate[], order: string[], opts?: Record<string, unknown>): { build: any; marks: any[]; upgrades: string[]; minutes: number; thinking: string };
export function confirmLines(list: Candidate[], order: string[]): string[];
export function packageEdges(builds: any[]): { before: string; after: string; why: string }[];
export function reanalyze(builds: any[], ids: string[], opts?: { now?: string }): { order: string[]; moves: { id: string; from: number; to: number; why: string }[]; conflicts: string[]; at: string };
