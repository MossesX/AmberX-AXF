/**
 * model-policy — which Claude models AmberX work may run on (Brett, Nov 1 2026: "Opus or Fable only, never Sonnet").
 * Set after three headless builds ran on Sonnet because a launcher could not start Fable.
 *
 * Which of the two a piece of work gets (Brett, Nov 21 2026): Fable for anything that might need it (audits, debugging,
 * root-cause work, pipeline / orchestrator / lander / builds-store code, merges and conflicts, CI fixes, security,
 * Android, architecture, any judgment call). Opus only for work that clearly doesn't (renames, copy edits, moving
 * files, simple styling, docs, boilerplate). Unsure = Fable. `MODEL_POLICY.work` is the ONE word list for that;
 * `modelForWork` reads it and nothing else keeps a second list.
 *
 * ONE registry for every place that picks, checks, coerces or launches a model: job-type@1 (job-type-rules.mjs), the
 * agent swarm roster and planner (swarm-core.mjs), the plan's model picker (cli/plan.mjs), the builds store (Fable /
 * Opus steps), the Pipeline 2.0 dispatcher and the headless launchers. Pure, no I/O. `axf schemas` writes it as
 * framework/schemas/model-policy.json for Python readers; framework/spec/check-model-policy.mjs keeps every reader in
 * step.
 *
 * The tier list stays open (a model the policy blocks is still a known word, so stored runs and costs keep reading);
 * only `allowed` says what may run. A blocked model is coerced UP to the cheapest allowed model at or above its tier
 * (haiku, sonnet → opus), never down. A model word the policy does not know is an error (`requireModel`, `stepModelName`,
 * `modelId` throw; the launch gate refuses it); where a reader of old records must not throw (`coerceModel`) it reads
 * as Fable, never as a silent Opus.
 */

export const MODEL_POLICY = {
  $axf: 'model-policy@1',
  since: '2026-11-01',
  rule: 'Opus or Fable only, never Sonnet (or Haiku). Fable for anything that might need it: audits, debugging, root-cause work, pipeline / orchestrator / lander / builds-store code, merges and conflicts, CI fixes, security, Android, architecture, schemas and contracts, any judgment call. Opus only for work that clearly does not: renames, copy edits, moving files, simple styling, docs, boilerplate. Unsure = Fable. An unknown model is an error, never a silent Opus.',
  /**
   * Every model word the system knows, lowest first. One ordered list (Brett, Nov 3 2026: "Fable is above Opus"):
   * the cost tier order AND the upgrade ranking. A step to a model later in this list is an UPGRADE and needs Brett's
   * approval; a step to an earlier one is a downgrade and passes by itself. A new model slots in here, nowhere else.
   * Blocked ones stay here so old records still read.
   */
  tiers: ['haiku', 'sonnet', 'opus', 'fable'],
  /** The models work may run on. */
  allowed: ['opus', 'fable'],
  /**
   * The cheapest allowed model: what a blocked model is coerced up to and what a reader with no model word AND no work
   * text falls back to (chat turns, job types that say nothing). Work with words goes through `modelForWork`, where
   * unsure = Fable; it never lands here.
   */
  default: 'opus',
  /** Foundation and judgment work; also what an unknown model word reads as. */
  foundation: 'fable',
  /** Claude Code CLI ids. */
  ids: { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-2' },
  labels: { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5', fable: 'Fable 5.2' },
  /**
   * The ONE word list for which work needs Fable (Brett, Nov 21 2026). Each entry is a regular-expression fragment,
   * matched case-insensitively on word boundaries. Order of judgment (modelForWork):
   *   1. a `fable` word anywhere → Fable ("might need it" wins, even next to an Opus word);
   *   2. else an `opus` word → Opus (work that clearly doesn't need Fable);
   *   3. else → `unsure` (Fable).
   * So `fable` only has to name what must override an Opus word; everything not clearly simple is Fable already.
   */
  work: {
    since: '2026-11-21',
    unsure: 'fable',
    fable: [
      // audits, debugging, root-cause work
      'audit(?:s|ed|ing)?', 'debug(?:s|ged|ging)?', 'bugs?', 'root[- ]caus(?:e|es|ed|ing)', 'diagnos(?:e|es|ed|is|ing)', 'investigat(?:e|es|ed|ing|ion)', 'regress(?:ion|ions|es|ed)?', 'flak(?:e|es|y|iness)', 'crash(?:es|ed|ing)?', 'fail(?:s|ed|ing|ure|ures)', 'broken', 'breaks?', 'incidents?', 'race(?: condition)?s?', 'deadlocks?', 'hang(?:s|ing)?', 'stuck', 'post[- ]?mortems?',
      // pipeline, orchestrator, lander, builds store
      'pipelines?', 'orchestrat(?:or|ors|ion|e|es)', 'dispatch(?:er|ers|es|ing)?', 'landers?', 'auto[- ]?land(?:er|s|ing)?', 'landing[- ]line', 'watchdogs?', 'builds?[- ]store', 'store\\.json', 'splitters?', 'launchers?', 'headless',
      // merges and conflicts, CI
      'merg(?:e|es|ed|ing)', 'merge[- ]queue', 'conflicts?', 'rebas(?:e|es|ed|ing)', 'cherry[- ]pick(?:s|ed|ing)?', 'ci', 'workflows?', 'github actions?', 'branch protection',
      // security
      'security', 'secur(?:e|ing)', 'auth(?:n|z|entication|orization|orisation)?', 'secrets?', 'credentials?', '(?:access|api|auth|github|session)[- ]tokens?', 'api[- ]keys?', 'vaults?', 'encrypt(?:s|ed|ion|ing)?', 'permissions?', 'vulnerab(?:le|ility|ilities)', 'injection', 'xss', 'csrf',
      // Android
      'android', 'kotlin', 'gradle', 'apks?', 'compose',
      // architecture and judgment calls
      'architect(?:ure|ures|ural)?', 'redesign(?:s|ed|ing)?', 'refactor(?:s|ed|ing)?', 'rewrit(?:e|es|ing|ten)', 'judg(?:e)?ment', 'decid(?:e|es|ed|ing)', 'decisions?', 'trade[- ]?offs?', 'concurren(?:t|cy)', 'data[- ]loss', 'rollbacks?',
      // foundation work (Nov 1 2026)
      'schemas?', 'asset[- ]types?', 'data[- ]models?', 'contracts?', 'kernels?', 'engines?', 'fixtures?', 'migrations?', 'conformance', 'porting', 'cross-(?:app|port)', 'registr(?:y|ies)', 'validators?', 'protocols?', 'spec(?:ification)?s?', 'model[- ]polic(?:y|ies)',
    ],
    opus: [
      'renam(?:e|es|ed|ing)', 'cop(?:y|ies)(?:[- ]edit(?:s|ed|ing)?)?', 'wording', 'reword(?:s|ed|ing)?', 'typos?', 'labels?', 'captions?', 'tooltips?', 'placeholder(?: text)?',
      'mov(?:e|es|ed|ing) (?:the |a |these |those )?(?:files?|folders?|director(?:y|ies))', 'file moves?',
      'styl(?:e|es|ing)', 'css', 'padding', 'margins?', 'spacing', 'colou?rs?', 'fonts?', 'icons?', 'border[- ]radius',
      'docs?', 'documentation', 'readme', 'changelog', 'comments?', 'jsdoc',
      'boilerplate', 'scaffold(?:s|ing)?', 'stubs?', 'tidy(?:ing)?', 'format(?:ting)?', 'lint(?:ing)?', 'whitespace',
    ],
  },
  /** Model switches (Brett, Nov 3 2026: "You can downgrade, but you can't upgrade."). */
  switches: {
    since: '2026-11-03',
    rule: 'A build may switch to a lower model on its own (recorded, no approval). Switching to a higher model needs Brett\'s explicit approval: his own signed-in console click or an axHub approval (confirm, never a veto countdown). A session, agent, headless build or the orchestrator never approves an upgrade; a session that reaches one stops and asks.',
    upgrade: 'approval',
    downgrade: 'record',
  },
};

export const MODEL_TIERS = MODEL_POLICY.tiers;
export const ALLOWED_MODELS = MODEL_POLICY.allowed;
export const DEFAULT_MODEL = MODEL_POLICY.default;
export const FOUNDATION_MODEL = MODEL_POLICY.foundation;
export const MODEL_IDS = MODEL_POLICY.ids;
export const MODEL_LABELS = MODEL_POLICY.labels;

const wordRe = (list) => new RegExp(`(?<![\\w-])(?:${list.join('|')})(?![\\w-])`, 'i');

/** Work that might need Fable (MODEL_POLICY.work.fable). The one list; a reader imports it, never keeps its own. */
export const FABLE_WORDS = wordRe(MODEL_POLICY.work.fable);
/** Work that clearly doesn't need Fable (MODEL_POLICY.work.opus). */
export const OPUS_WORDS = wordRe(MODEL_POLICY.work.opus);
/** @deprecated the old name of FABLE_WORDS (foundation work only, before Nov 21 2026). */
export const FOUNDATION_WORDS = FABLE_WORDS;

/** Thrown for a model word the policy does not know. `code` is 'model-unknown' or 'model-missing'. */
export class ModelError extends Error {
  constructor(message, code = 'model-unknown') { super(message); this.name = 'ModelError'; this.code = code; }
}

/**
 * The policy's key for any spelling: "Opus", "Opus 5.5", "claude-opus-5-5", "[Fable]", "FABLE", "claude-fable-5-2",
 * "claude-fable-9" → "opus" / "fable"; '' when unknown. The version in a spelling is ignored: "Fable" always means
 * the policy's current Fable id.
 */
export function modelKey(v) {
  const s = String(v ?? '').toLowerCase();
  return MODEL_TIERS.find((k) => s.includes(k)) ?? '';
}

const said = (m) => String(m ?? '').trim();
const unknownLine = (m) => `model "${said(m)}" is not a Claude model the policy knows (${MODEL_TIERS.join(', ')})`;

export const modelAllowed = (m) => ALLOWED_MODELS.includes(modelKey(m));

const coerceKey = (k) => (ALLOWED_MODELS.includes(k) ? k : ALLOWED_MODELS.find((a) => MODEL_TIERS.indexOf(a) >= MODEL_TIERS.indexOf(k)) ?? FOUNDATION_MODEL);

/**
 * The allowed model for `m`, for READERS that must not throw (stored records, old runs): itself when allowed, the
 * cheapest allowed model at or above its tier when blocked (never down), `fallback` when no model is given at all.
 * A model word the policy does not know reads as Fable, never as a silent Opus. Anything that stores, pins or
 * launches a model uses `requireModel` instead, which makes an unknown word an error.
 */
export function coerceModel(m, fallback = DEFAULT_MODEL) {
  const k = modelKey(m);
  if (!k) return said(m) ? FOUNDATION_MODEL : fallback;
  return coerceKey(k);
}

/**
 * The allowed model key for `m`, strictly: any spelling of an allowed model is itself, a blocked one is coerced up,
 * and an unknown word throws ModelError. No model at all throws too, unless `opts.fallback` names what it gets
 * (itself checked). Use this wherever a model is stored, pinned or launched.
 */
export function requireModel(m, opts = {}) {
  const k = modelKey(m);
  if (k) return coerceKey(k);
  if (said(m)) throw new ModelError(unknownLine(m), 'model-unknown');
  if (opts.fallback !== undefined && said(opts.fallback)) return requireModel(opts.fallback);
  throw new ModelError(`no model given: say one of ${ALLOWED_MODELS.map((a) => MODEL_LABELS[a]).join(' or ')}`, 'model-missing');
}

/** '' when `m` may run, else one plain sentence naming the rule. */
export function modelProblem(m) {
  const k = modelKey(m);
  if (!k) return unknownLine(m);
  if (ALLOWED_MODELS.includes(k)) return '';
  return `model "${k}" is not allowed: ${ALLOWED_MODELS.map((a) => MODEL_LABELS[a]).join(' or ')} only, never ${MODEL_LABELS[k]} (Brett, ${MODEL_POLICY.since}); it runs as ${coerceModel(k)}`;
}

/** The higher-ranked of two model words (a floor: `higherModel(build.model, step.model)`); unknown or empty ones are skipped, '' when both are. */
export function higherModel(a, b) {
  const ka = modelKey(a); const kb = modelKey(b);
  if (!ka || !kb) return ka || kb;
  return MODEL_TIERS.indexOf(kb) > MODEL_TIERS.indexOf(ka) ? kb : ka;
}

/**
 * The model for a piece of work, with the reason: { model, why, word }. The words decide (MODEL_POLICY.work): a Fable
 * word → Fable; else an Opus word → Opus; else unsure → Fable. `opts.floor` (a build-level model: "all Fable") is a
 * minimum the words can raise but never lower; an unknown floor throws ModelError. `opts.pin` is a model the step
 * already says: it is kept when it is at or above what the words say, raised otherwise.
 */
export function workModel(text, opts = {}) {
  const s = String(text ?? '');
  const f = FABLE_WORDS.exec(s); const o = f ? null : OPUS_WORDS.exec(s);
  let r = f ? { model: FOUNDATION_MODEL, why: `"${f[0].toLowerCase()}" might need ${MODEL_LABELS[FOUNDATION_MODEL]}`, word: f[0].toLowerCase() }
    : o ? { model: DEFAULT_MODEL, why: `"${o[0].toLowerCase()}" clearly doesn't need ${MODEL_LABELS[FOUNDATION_MODEL]}`, word: o[0].toLowerCase() }
      : { model: MODEL_POLICY.work.unsure, why: `unsure, so ${MODEL_LABELS[MODEL_POLICY.work.unsure]}`, word: '' };
  for (const [name, v] of [['pin', opts.pin], ['floor', opts.floor]]) {
    if (!said(v)) continue;
    const k = requireModel(v);
    if (MODEL_TIERS.indexOf(k) > MODEL_TIERS.indexOf(r.model)) r = { model: k, why: name === 'floor' ? `the build is set to ${MODEL_LABELS[k]}` : `pinned to ${MODEL_LABELS[k]}`, word: '' };
  }
  return r;
}

/** The model key for a piece of work from its words (see workModel): Fable unless it clearly doesn't need it. */
export const modelForWork = (text, opts = {}) => workModel(text, opts).model;

/** The CLI id for a model word (coerced up to the policy first). An unknown or missing model throws ModelError. */
export const modelId = (m) => MODEL_IDS[requireModel(m)];

/** A model key as the builds store spells a step's model: 'opus' → 'Opus', 'fable' → 'Fable'. */
const storeName = (k) => k.charAt(0).toUpperCase() + k.slice(1);
/** Step models as the builds store spells them, lowest first: ['Opus', 'Fable']. */
export const STEP_MODEL_NAMES = ALLOWED_MODELS.map(storeName);

/**
 * A step's model as the builds store keeps it ('Fable' | 'Opus') from any spelling, strictly: "fable", "FABLE",
 * "Fable 5.2", "claude-fable-5-2" → 'Fable'; an unknown word throws ModelError. A step with no model gets
 * `opts.fallback` when given, else the model its words ask for (`opts.text`, unsure = Fable).
 */
export function stepModelName(m, opts = {}) {
  if (said(m)) return storeName(requireModel(m));
  if (opts.fallback !== undefined && said(opts.fallback)) return storeName(requireModel(opts.fallback));
  return storeName(modelForWork(opts.text ?? ''));
}

// ---------------------------------------------------------------- upgrades and downgrades (Nov 3 2026)

/** Where a model sits in the ranking (MODEL_TIERS, lowest first); -1 when unknown. */
export const modelRank = (m) => MODEL_TIERS.indexOf(modelKey(m));

/** 'upgrade' | 'downgrade' | 'same' for a switch from → to ('' when either model is unknown). */
export function switchKind(from, to) {
  const a = modelRank(from); const b = modelRank(to);
  if (a < 0 || b < 0) return '';
  return b > a ? 'upgrade' : b < a ? 'downgrade' : 'same';
}

export const isUpgrade = (from, to) => switchKind(from, to) === 'upgrade';
