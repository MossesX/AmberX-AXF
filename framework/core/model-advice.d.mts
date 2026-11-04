// Types for model-advice.mjs (model-advice@1): which model and thinking level work should run on, and the review state.
export type Model = 'Fable' | 'Opus';
export type Thinking = 'low' | 'medium' | 'high' | 'max';
export type Verdict = 'keep' | 'fable-review' | 'redo-on-fable';
export type ReviewStatus = 'ok' | 'look' | 'dismissed';
export type AdviceKind = 'kernel' | 'migration' | 'foundation' | 'architecture' | 'debug' | 'plugin' | 'landing';

export interface Classification { kind: AdviceKind; model: Model; thinking: Thinking; why: string; signals: string[] }
export interface StepAdvice { recommendedModel: Model; recommendedThinking: Thinking; modelWhy: string; adviceKind: AdviceKind }
export interface AdviceCost { minutes: number; usd: number; what: string }
export interface BuildAdvice extends StepAdvice { verdict: Verdict | ''; adviceCost: AdviceCost; steps: (StepAdvice & { uid?: string; id?: string })[] }
export interface ReviewOk { at: string; by: string; via: string; how: 'apply' | 'dismiss'; model: Model; thinking: Thinking | ''; recommendedModel: Model; recommendedThinking: Thinking | ''; verdict: Verdict | ''; note?: string }
/** The fields a build or step record may carry (builds@1). */
export interface AdviceRecord { thinking?: Thinking; recommendedModel?: Model; recommendedThinking?: Thinking; modelWhy?: string; adviceKind?: AdviceKind; advicePinned?: true; adviceAt?: string; reviewOk?: ReviewOk; verdict?: Verdict; adviceCost?: AdviceCost }
/** What every reader shows for a step. */
export interface StepView { model: Model; thinking: Thinking; recommendedModel: Model | ''; recommendedThinking: Thinking | ''; modelWhy: string; adviceKind: string; reviewStatus: ReviewStatus; build?: string }
/** The same for a build, with its verdict and cost. */
export interface BuildView extends Omit<StepView, 'build'> { verdict: Verdict | ''; adviceCost: AdviceCost | null; stepsToLook: number }
export interface AdviceFilter { model?: Model; thinking?: Thinking; status?: 'ok' | 'look'; needsLook?: true; fable?: true }
export interface WhyLine { label: string; text: string }

export const SCHEMA: 'model-advice@1';
export const THINKING: readonly Thinking[];
export const DEFAULT_THINKING: Record<'fable' | 'opus', Thinking>;
export const VERDICTS: readonly Verdict[];
export const VERDICT_LABEL: Record<Verdict, string>;
export const REVIEW: readonly ReviewStatus[];
export const REVIEW_ICON: Record<ReviewStatus, string>;
export const REVIEW_TONE: Record<ReviewStatus, 'success' | 'warning'>;
export const KINDS: Record<AdviceKind, { model: Model; thinking: Thinking; label: string }>;
export const PRICE_PER_MIN: Record<Model, number>;
export const THINKING_COST: Record<Thinking, number>;
export const FINISHED: readonly string[];
export const VIEW_FIELDS: readonly string[];
export const BUILD_VIEW_FIELDS: readonly string[];
export const STEP_RECORD_FIELDS: readonly string[];
export const BUILD_RECORD_FIELDS: readonly string[];

export function modelLabel(m: unknown): string;
export function normThinking(v: unknown): Thinking | '';
export function thinkingRank(t: unknown): number;
export function defaultThinking(model: unknown): Thinking;
export function thinkingOf(model: unknown, thinking?: unknown): Thinking;
export function effortArgs(thinking: unknown): string[];
export function classify(text: unknown, opts?: { files?: unknown[]; category?: string; why?: string; title?: string }): Classification;
export function adviseStep(step: { text?: string; title?: string; why?: string; files?: unknown[] } | null | undefined, build?: { category?: string }): StepAdvice;
export function costOf(model: unknown, minutes: number, thinking?: unknown, price?: Record<string, number>): number;
export function currentModel(build: unknown): Model;
export function currentThinking(build: unknown): Thinking;
export function adviseBuild(build: unknown, opts?: { price?: Record<string, number>; stepAdvice?: ((step: unknown) => StepAdvice) | null }): BuildAdvice;
export function reviewStatus(rec: Partial<AdviceRecord> | null | undefined, cur: { model?: unknown; thinking?: unknown }): ReviewStatus;
export function stepView(step: unknown, build?: { id?: string }): StepView;
export function buildView(build: unknown): BuildView;
export function whyLines(view: Partial<BuildView & StepView> | null | undefined): WhyLine[];
export function parseFilter(input: unknown): AdviceFilter;
export function normFilter(f: unknown): AdviceFilter;
export function filterIsEmpty(f: unknown): boolean;
export function matchesFilter(view: Partial<BuildView & StepView> | null | undefined, filter: unknown): boolean;
export function filterLabel(filter: unknown): string;
export function normReviewOk(v: unknown): ReviewOk | null;
export function adviceRecord(o: unknown, opts?: { build?: boolean }): AdviceRecord;
export function reviewOkFor(view: Partial<BuildView & StepView> | null | undefined, opts?: { at?: string; by?: string; via?: string; how?: 'apply' | 'dismiss'; note?: string }): ReviewOk | null;
