// Types for model-policy.mjs (model-policy@1: which Claude models work may run on; Brett, Nov 1 2026).
export type ModelKey = 'haiku' | 'sonnet' | 'opus' | 'fable';
export type AllowedModel = 'opus' | 'fable';
export interface ModelPolicy {
  $axf: 'model-policy@1';
  since: string;
  rule: string;
  tiers: readonly ModelKey[];
  allowed: readonly AllowedModel[];
  default: AllowedModel;
  foundation: AllowedModel;
  ids: Record<ModelKey, string>;
  labels: Record<ModelKey, string>;
}
export const MODEL_POLICY: ModelPolicy;
export const MODEL_TIERS: readonly ModelKey[];
export const ALLOWED_MODELS: readonly AllowedModel[];
export const DEFAULT_MODEL: AllowedModel;
export const FOUNDATION_MODEL: AllowedModel;
export const MODEL_IDS: Record<ModelKey, string>;
export const MODEL_LABELS: Record<ModelKey, string>;
export const FOUNDATION_WORDS: RegExp;
export function modelKey(v: unknown): ModelKey | '';
export function modelAllowed(m: unknown): boolean;
export function coerceModel(m: unknown, fallback?: AllowedModel): AllowedModel;
export function modelProblem(m: unknown): string;
export function modelForWork(text: unknown): AllowedModel;
export function modelId(m: unknown): string;
