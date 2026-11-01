/**
 * model-policy — which Claude models AmberX work may run on (Brett, Nov 1 2026: "Opus or Fable only, never Sonnet.
 * Fable for foundation work: schemas, asset types, data models, kernel/engines, cross-app GUI behaviour; Opus for the
 * rest"). Set after three headless builds ran on Sonnet because a launcher could not start Fable.
 *
 * ONE registry for every place that picks, checks, coerces or launches a model: job-type@1 (job-type-rules.mjs), the
 * agent swarm roster and planner (swarm-core.mjs), the plan's model picker (cli/plan.mjs), the builds store (Fable /
 * Opus steps) and the headless launchers. Pure, no I/O. `axf schemas` writes it as framework/schemas/model-policy.json
 * for Python readers; framework/spec/check-model-policy.mjs keeps every reader in step.
 *
 * The tier list stays open (a model the policy blocks is still a known word, so stored runs and costs keep reading);
 * only `allowed` says what may run. A blocked model is coerced UP to the cheapest allowed model at or above its tier
 * (haiku, sonnet → opus), never down.
 */

export const MODEL_POLICY = {
  $axf: 'model-policy@1',
  since: '2026-11-01',
  rule: 'Opus or Fable only, never Sonnet (or Haiku). Fable for foundation work: schemas, asset types, data models, kernel/engines, cross-app GUI behaviour. Opus for the rest.',
  /** Every model word the system knows, cheapest first (tier order). Blocked ones stay here so old records still read. */
  tiers: ['haiku', 'sonnet', 'opus', 'fable'],
  /** The models work may run on. */
  allowed: ['opus', 'fable'],
  /** What anything that does not say a model gets. */
  default: 'opus',
  /** Foundation work. */
  foundation: 'fable',
  /** Claude Code CLI ids. */
  ids: { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' },
  labels: { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5', fable: 'Fable 5.1' },
};

export const MODEL_TIERS = MODEL_POLICY.tiers;
export const ALLOWED_MODELS = MODEL_POLICY.allowed;
export const DEFAULT_MODEL = MODEL_POLICY.default;
export const FOUNDATION_MODEL = MODEL_POLICY.foundation;
export const MODEL_IDS = MODEL_POLICY.ids;
export const MODEL_LABELS = MODEL_POLICY.labels;

/** Work that goes to Fable: schemas, asset types, data models, kernel/engines, cross-app GUI behaviour, ports. */
export const FOUNDATION_WORDS = /\b(schema|asset[- ]type|data[- ]model|contract|kernel|engine|fixture|migration|conformance|porting|cross-(app|port)|registry|validator)s?\b/i;

/** The policy's key for any spelling: "Opus", "Opus 5.5", "claude-opus-5-5", "[Fable]" → "opus" / "fable"; '' when unknown. */
export function modelKey(v) {
  const s = String(v ?? '').toLowerCase();
  return MODEL_TIERS.find((k) => s.includes(k)) ?? '';
}

export const modelAllowed = (m) => ALLOWED_MODELS.includes(modelKey(m));

/** The allowed model for `m`: itself when allowed, else the cheapest allowed model at or above its tier (never down), else the default. */
export function coerceModel(m, fallback = DEFAULT_MODEL) {
  const k = modelKey(m);
  if (!k) return fallback;
  if (ALLOWED_MODELS.includes(k)) return k;
  const need = MODEL_TIERS.indexOf(k);
  return ALLOWED_MODELS.find((a) => MODEL_TIERS.indexOf(a) >= need) ?? fallback;
}

/** '' when `m` may run, else one plain sentence naming the rule. */
export function modelProblem(m) {
  const k = modelKey(m);
  if (!k) return `model "${m}" is not a Claude model the policy knows (${MODEL_TIERS.join(', ')})`;
  if (ALLOWED_MODELS.includes(k)) return '';
  return `model "${k}" is not allowed: ${ALLOWED_MODELS.map((a) => MODEL_LABELS[a]).join(' or ')} only, never ${MODEL_LABELS[k]} (Brett, ${MODEL_POLICY.since}); it runs as ${coerceModel(k)}`;
}

/** The model for a piece of work from its words: Fable for foundation work, else the default. */
export const modelForWork = (text) => (FOUNDATION_WORDS.test(String(text ?? '')) ? FOUNDATION_MODEL : DEFAULT_MODEL);

/** The CLI id for a model word (coerced to the policy first). */
export const modelId = (m) => MODEL_IDS[coerceModel(m)];
