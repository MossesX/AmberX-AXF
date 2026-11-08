/** Types for walkthrough-rules.mjs (glossary-walkthrough-request@1 → glossary-walkthrough@1). */

export type Audience = 'investors' | 'customers' | 'developers' | 'team';
export type WtStyle = 'showcase' | 'tour' | 'tutorial' | 'deep-dive';
export type Depth = 'brief' | 'standard' | 'deep';
export type Mode = 'template' | 'claude';
export type StepKind = 'narrate' | 'show' | 'try' | 'docs';

export interface WalkRequest {
  $axf: 'glossary-walkthrough-request@1';
  id: string; title: string; prompt: string; terms: string[];
  audience: Audience; style: WtStyle; depth: Depth; mode: Mode; tryIt: boolean; intro: boolean; app: string;
}
export interface WalkStep { kind: StepKind; title: string; say: string; do: string; target: string; highlight: string; wait: number }
export interface PlayStep extends WalkStep { feature: number; part: number; parts: number }
export interface FeatureDocs {
  headline: string; summary: string; detail: string; points: string[];
  api: { kind: string; name: string }[]; where: string[]; related: { id: string; term: string }[];
}
export interface Feature { entry: string; term: string; kind: string; category: string; demonstration: string; source: 'claude' | 'template'; error: string; docs: FeatureDocs; steps: WalkStep[] }
export interface HistoryEntry { version: string; at: string; mode: Mode; terms: number; note: string }
export interface Bundle {
  $axf: 'glossary-walkthrough@1';
  id: string; name: string; version: string; createdAt: string; updatedAt: string;
  request: WalkRequest; brief: string;
  generator: { mode: Mode; model: string; at: string; ms: number; chain: { entry: string; source: 'claude' | 'template'; ms: number; error: string }[] };
  intro: WalkStep | null; outro: WalkStep | null; features: Feature[]; book: string; history: HistoryEntry[];
}
export interface BundleSummary {
  id: string; name: string; version: string; updatedAt: string; createdAt: string; mode: Mode; model: string;
  features: number; steps: number; claude: number; terms: string[]; prompt: string; audience: Audience; versions: number; book: string;
}

export const REQUEST_FRAME: 'glossary-walkthrough-request@1';
export const BUNDLE_FRAME: 'glossary-walkthrough@1';
export const WT_ENUMS: { audience: Audience[]; style: WtStyle[]; depth: Depth[]; mode: Mode[]; stepKind: StepKind[]; source: ('claude' | 'template')[] };
export const WT_LIMITS: Record<string, number | [number, number]> & { terms: [number, number]; prompt: number; title: number };
export const WT_DEFAULTS: { audience: Audience; style: WtStyle; depth: Depth; tryIt: boolean; app: string; mode: Mode; intro: boolean };
export const DEPTH_STEPS: Record<Depth, number>;
export const FEATURE_SYSTEM: string;

export function slugify(s: string, fallback?: string): string;
export function shortHash(s: string): string;
export function requestErrors(raw: unknown): string[];
export function normalizeRequest(raw: unknown): WalkRequest;
export function walkthroughIdOf(request: unknown): string;
export function titleOf(request: unknown, entries?: { term?: string }[]): string;
export function briefOf(request: unknown, entries?: ({ id: string; term: string; kind: string; summary: string } | null | undefined)[]): string;
export function featurePrompt(request: unknown, entry: unknown, opts?: { template?: Partial<WalkStep>[]; index?: number; total?: number; related?: { term: string }[] }): { system: string; messages: { role: 'user'; content: string }[] };
export function cleanStep(raw: unknown, allowed?: { do: Set<string>; target: Set<string> }): WalkStep | null;
export function extractJson(text: string): Record<string, unknown> | null;
export function parseFeatureReply(text: string, opts?: { template?: Partial<WalkStep>[]; tryIt?: boolean }): { ok: boolean; steps: WalkStep[]; headline: string; points: string[]; error: string };
export function tryStepOf(entry: unknown, template?: Partial<WalkStep>[]): WalkStep;
export function featureOf(entry: unknown, template?: Partial<WalkStep>[], request?: unknown, opts?: { reply?: ReturnType<typeof parseFeatureReply> | null; demonstration?: string; related?: { id: string; term: string }[]; error?: string }): Feature;
export function nextVersion(prev?: string): string;
export function introOf(title: string, features: Feature[], request: unknown): { intro: WalkStep | null; outro: WalkStep | null };
export function assembleBundle(opts: { request: unknown; brief?: string; features?: Feature[]; previous?: Bundle | null; at?: string; generator?: Record<string, unknown>; note?: string; book?: string }): Bundle;
export function bundleErrors(raw: unknown): string[];
export function normalizeBundle(raw: unknown): Bundle;
export function summarizeBundle(b: unknown): BundleSummary;
export function playSteps(bundle: unknown): PlayStep[];
export function featureStarts(bundle: unknown): number[];
export function bundleToWalkthrough(bundle: unknown): { $axf: 'walkthrough@1'; id: string; title: string; app: string; steps: { say: string; do: string; target: string }[]; source: string };
export function tryHit(step: PlayStep | WalkStep | null | undefined, el: unknown, selectorsOf: (t: string) => string[], closest: (el: unknown, sel: string) => boolean): boolean;
export function diffBundles(a: unknown, b: unknown): { added: string[]; removed: string[]; changed: string[] };
export function safeSrc(src: string): string;
