/**
 * model-advice — which model and thinking level a piece of work should run on (model-advice@1). Brett, Nov 4 2026:
 * "Go through my list of things that can be done and see what should be redone with Fable and put that next to it,
 * and put the level of thinking that it should be on." … "anywhere a build or a step is shown I want a check mark if
 * it's all set and doesn't need to be looked at, and like a yellow triangle if it's been changed and needs to be
 * looked at." … "Model. And thinking model. … any query or anything that shows a build or a step or anything anywhere.
 * But make it a filter. Make it so you can turn that feature on or off."
 *
 * ONE place that judges work (pure, no I/O): the builds store writes what it says onto every build and step
 * (`recommendedModel`, `recommendedThinking`, `modelWhy`, `verdict`, `adviceCost`), every reader (console screens,
 * Molly, axHub web, REST, MCP, CLI, control@1) shows it through `stepView` / `buildView`, and the launcher turns the
 * thinking level into `claude --effort`. It only RECOMMENDS: nothing here changes a build's model; Apply and Dismiss
 * are orchestrator actions that need Brett (framework/core/model-switch.mjs approverFrom).
 *
 * Rule of thumb (Brett's brief): foundation or contract work = Fable, high or max. Plugins and screens = Opus, medium.
 * Wording, small fixes and landing PRs = Opus, low. Gnarly debugging or architecture inside a plugin = Opus, high.
 * Model words come from model-policy.mjs (Opus or Fable only, never Sonnet).
 */

import { FOUNDATION_WORDS, MODEL_LABELS, modelKey } from './model-policy.mjs';

export const SCHEMA = 'model-advice@1';
/** Claude Code effort levels, lowest first (`claude --effort <level>`). */
export const THINKING = ['low', 'medium', 'high', 'max'];
/** What a step gets when nobody set a level: Fable thinks hard by default, Opus at a medium level. */
export const DEFAULT_THINKING = { fable: 'high', opus: 'medium' };
/** For work already built: leave it, read it on Fable and fix what is wrong, or build it again on Fable. */
export const VERDICTS = ['keep', 'fable-review', 'redo-on-fable'];
export const VERDICT_LABEL = { keep: 'Keep', 'fable-review': 'Fable review', 'redo-on-fable': 'Redo on Fable' };
/** The icon next to a build or step: green check (ok, dismissed) or yellow triangle (look). */
export const REVIEW = ['ok', 'look', 'dismissed'];
export const REVIEW_ICON = { ok: 'check-circle', look: 'alert', dismissed: 'check-circle' };
export const REVIEW_TONE = { ok: 'success', look: 'warning', dismissed: 'success' };
/** Kinds of work the classifier tells apart, and what each gets. */
export const KINDS = {
  kernel: { model: 'Fable', thinking: 'max', label: 'kernel / cross-port contract' },
  migration: { model: 'Fable', thinking: 'max', label: 'schema migration / store contract' },
  foundation: { model: 'Fable', thinking: 'high', label: 'foundation (schema, asset type, engine, contract)' },
  architecture: { model: 'Opus', thinking: 'high', label: 'architecture or heavy refactor inside an app or plugin' },
  debug: { model: 'Opus', thinking: 'high', label: 'gnarly debugging' },
  plugin: { model: 'Opus', thinking: 'medium', label: 'plugin, screen, server or wiring' },
  landing: { model: 'Opus', thinking: 'low', label: 'landing, docs, wording or a small fix' },
};
/** USD per working minute by model (framework/schemas/model-pricing.json heuristic; plan-core uses the same numbers). */
export const PRICE_PER_MIN = { Fable: 0.275, Opus: 0.14 };
/** How much a thinking level costs against medium (rough: more thinking = more output tokens per minute of work). */
export const THINKING_COST = { low: 0.7, medium: 1, high: 1.5, max: 2.2 };

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const MODEL = (m) => (modelKey(m) === 'fable' ? 'Fable' : 'Opus');
export const modelLabel = (m) => MODEL_LABELS[modelKey(m)] ?? str(m);

/** 'low' | 'medium' | 'high' | 'max' for any spelling ("High", "max thinking"), else ''. */
export function normThinking(v) {
  const s = str(v, 40).toLowerCase();
  return THINKING.find((t) => s === t || s.startsWith(`${t} `) || s.startsWith(`${t}-`)) ?? (s.includes('max') ? 'max' : '');
}
export const thinkingRank = (t) => THINKING.indexOf(normThinking(t));
/** The level a model runs at when nobody picked one. */
export const defaultThinking = (model) => DEFAULT_THINKING[modelKey(model)] ?? DEFAULT_THINKING.opus;
/** The level in force: the explicit one, else the model's default. */
export const thinkingOf = (model, thinking) => normThinking(thinking) || defaultThinking(model);
/** `claude -p` arguments for a thinking level (none when it is not a level). */
export const effortArgs = (thinking) => (normThinking(thinking) ? ['--effort', normThinking(thinking)] : []);

// ------------------------------------------------------------------ the classifier

const KERNEL_WORDS = /\b(kernel|cross-port|conformance|porting|wire (format|code)s?|protocol adapters?|breaking change)\b/i;
const MIGRATION_WORDS = /\b(migrations?|merge driver|newer-wins|store core|journal(led)?|one builds store|builds@1|data model)\b/i;
/** A contract tag within five words of a contract verb, either side: "new asset type tab-group@1", "embed@1 front messages addition". */
const TAG_NEAR_VERB = /\b(?:new|adds?|added|define[sd]?|design(?:ed)?|change[sd]?|extend(?:s|ed)?|contracts?|schemas?|fields?|rules|type|engine|registr(?:y|ies)|resolver|matching|messages?|protocol|addition)\b\W+(?:[\w-]+\W+){0,5}?([a-z][a-z0-9-]*@\d)\b|\b([a-z][a-z0-9-]*@\d)\b\W+(?:[\w-]+\W+){0,5}?(?:contracts?|schemas?|fields?|rules|addition|change[sd]?|type|engine|resolver|matching|messages?|protocol|registr(?:y|ies)|validators?|fixtures?)\b/gi;
const EXTRA_FOUNDATION = /\b(registries|asset[- ]types?\.json|asset types?|new asset type|token engine|hot-?swap|cross-app|across (every|all) apps?|shared assets?|appearance@1|design package|style theme engine|layout engine|rules? file|both validators|kotlin twin|android twin|gui behaviou?r)\b/i;
/**
 * Words that look like foundation signals but are not: a note that the Android twin is a deferred gap in PORTING.md
 * (every web build says so), a negation ("no docs engine", "no schema change"), and a file path mention.
 */
const NOT_SIGNALS = [/\bPORTING\.md\b/gi, /\bdeferred gap[^.;\n]*/gi, /\bporting (gap|notes?|docs?|spec|line|entry)[^.;\n]*/gi, /\bframework\/spec\/PORTING\b/gi, /\b(no|not a|without( a| an)?|never a)\s+(\w+[- ]){0,2}(engines?|schemas?|kernel|migrations?|contracts?|registry|asset types?|fixtures?)\b/gi, /\b(kotlin|android) (twin|side)[^.;\n]*(hold|deferred|later|gap)[^.;\n]*/gi];
const cleanWords = (s) => NOT_SIGNALS.reduce((t, re) => t.replace(re, ' '), s);
/** A step whose first words say it is landing work is landing work, whatever it mentions after ("Docs: … from the control@1 schema"). */
const LANDING_START = /^\s*(s\d+[a-z]?\s+)?(docs?|documentation|tests?|report|screenshots?|land(ing)?|readme|cleanup|tidy|wording|rename|commands?( once)?\s*(->|→)|redeploy|deploy|changelog|release notes|ui review|threads)\b/i;
const FOUNDATION_PATHS = /(^|\/)framework\/(core|schemas|spec|plan|android|assets)\//i;
const ARCH_WORDS = /\b(architecture|re-?architect|heavy refactor|refactor (the|every|all)|unify|rewrite|restructure|split (the|every) store|state machine|concurrency|scheduler|planner|router|orchestrat(e|or) (core|engine))\b/i;
const DEBUG_WORDS = /\b(debug|race( condition)?|flicker|stale|502|perf(ormance)?|hang|leak|investigate|root cause|deadlock|regression|intermittent|crash|infinite loop|memory|starv(e|ing)|timeout)s?\b/i;
const LANDING_WORDS = /\b(land(ing)?|merge (the )?(pr|queue|main)|redeploy|deploy|readme|docs?|documentation|wording|rename|typo|report|screenshots?|ui review|commit(s)? clean|ci green|changelog|changes log|threads(\.md)?|release notes|cleanup|tidy|label|copy change|status line|note|pr)\b/i;
const SMALL_FIX = /\b(small fix|hotfix|quick fix|one-?line|tiny|minor|cosmetic)\b/i;

/**
 * Judge one piece of work from its words (text, title, why, category) and the files it touches. Returns
 * { kind, model, thinking, why, signals: [word…] }. Foundation signals beat everything (Brett: Fable for foundation
 * work), then debugging / architecture (Opus, high), then landing / wording (Opus, low), else plugin work (Opus, medium).
 */
export function classify(text, { files = [], category = '', why = '', title = '' } = {}) {
  const words = cleanWords([title, text, why, category].map((x) => str(x)).join(' \n '));
  const paths = (Array.isArray(files) ? files : []).map((f) => str(f, 300)).join(' ');
  const hits = (re, s = words) => { const m = s.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)); return m ? [...new Set(m.map((x) => x.toLowerCase()))] : []; };
  const signals = [];
  if (LANDING_START.test(str(text)) && !KERNEL_WORDS.test(str(text)) && !MIGRATION_WORDS.test(str(text))) {
    const lead = str(text).match(LANDING_START)?.[2]?.toLowerCase() ?? 'docs';
    return { kind: 'landing', ...pick('landing'), why: `${KINDS.landing.label} (${lead}): routine, Opus on low thinking`, signals: [lead] };
  }
  const kernel = hits(KERNEL_WORDS); const migration = hits(MIGRATION_WORDS);
  const found = [...hits(FOUNDATION_WORDS), ...hits(EXTRA_FOUNDATION)];
  // a contract tag (ref@1, embed@1) counts only next to a contract verb: "embed@1 addition", "new asset type tab-group@1";
  // a step that merely USES a contract ("through embed@1") is not foundation work
  const tagged = [...new Set([...words.matchAll(TAG_NEAR_VERB)].map((m) => (m[1] ?? m[2] ?? '').toLowerCase()).filter(Boolean))];
  const fpaths = paths.split(/\s+/).filter((p) => FOUNDATION_PATHS.test(p));
  // a long text (a brief, a detail) needs more than one incidental word to be foundation work; a short step line needs one
  const distinct = new Set([...found, ...tagged, ...fpaths]).size;
  const foundation = kernel.length || migration.length || (words.length > 400 ? distinct >= 2 : distinct >= 1);
  if (foundation) {
    const kind = kernel.length ? 'kernel' : migration.length ? 'migration' : 'foundation';
    signals.push(...kernel, ...migration, ...found, ...tagged, ...fpaths.map((p) => p.replace(/^.*?(framework\/[a-z]+)\/.*$/i, '$1/')));
    const uniq = [...new Set(signals)];
    return { kind, ...pick(kind), why: `${KINDS[kind].label}: ${uniq.slice(0, 4).join(', ')}${uniq.length > 4 ? '…' : ''}; Brett's rule is Fable for foundation work, ${KINDS[kind].thinking} thinking`, signals: uniq };
  }
  const arch = hits(ARCH_WORDS); const debug = hits(DEBUG_WORDS);
  if (arch.length || debug.length) {
    const kind = arch.length ? 'architecture' : 'debug';
    const uniq = [...new Set([...arch, ...debug])];
    return { kind, ...pick(kind), why: `${KINDS[kind].label} (${uniq.slice(0, 4).join(', ')}): Opus is enough, but it needs high thinking`, signals: uniq };
  }
  const landing = hits(LANDING_WORDS); const small = hits(SMALL_FIX);
  const plain = words.replace(LANDING_WORDS, '').replace(SMALL_FIX, '').trim();
  // landing / wording work: the words are mostly about landing, or the step says it is small
  if ((landing.length && landing.length * 12 >= plain.split(/\s+/).length) || small.length) {
    const uniq = [...new Set([...landing, ...small])];
    return { kind: 'landing', ...pick('landing'), why: `${KINDS.landing.label} (${uniq.slice(0, 4).join(', ')}): routine, Opus on low thinking`, signals: uniq };
  }
  return { kind: 'plugin', ...pick('plugin'), why: `${KINDS.plugin.label}: Opus, medium thinking`, signals: [] };
}
const pick = (kind) => ({ model: KINDS[kind].model, thinking: KINDS[kind].thinking });

// ------------------------------------------------------------------ steps and builds

/** The advice for one step (builds@1 StepRecord or any { text, title, why, files, model }). */
export function adviseStep(step, build = {}) {
  const c = classify(str(step?.text), { files: step?.files, category: build?.category, why: step?.why, title: step?.title });
  return { recommendedModel: c.model, recommendedThinking: c.thinking, modelWhy: c.why, adviceKind: c.kind };
}

const minutesOf = (e) => { if (typeof e === 'number' && e > 0) return e; const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(str(e, 30)); if (!m) return 15; const n = Number(m[1]); const u = (m[2] || 'min').toLowerCase(); return Math.round(u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 480 : n); };
const r2 = (x) => Math.round(x * 100) / 100;
/** Cost of `minutes` of work on a model at a thinking level (USD). */
export function costOf(model, minutes, thinking = '', price = PRICE_PER_MIN) {
  return r2((price[MODEL(model)] ?? price.Opus) * (THINKING_COST[thinkingOf(model, thinking)] ?? 1) * Math.max(0, minutes));
}
const open = (s) => !s.done && !s.skip;
export const FINISHED = ['built', 'complete', 'archived'];

/** The model a build runs on now: its next open step's, else its last step's, else the Pending item's. */
export function currentModel(build) {
  const steps = Array.isArray(build?.steps) ? build.steps : [];
  const next = steps.find(open) ?? steps[steps.length - 1];
  return next ? MODEL(next.model) : MODEL(build?.pending?.model || build?.model || 'Opus');
}
/** The thinking level in force for a build: its own, else its next step's, else its model's default. */
export function currentThinking(build) {
  const steps = Array.isArray(build?.steps) ? build.steps : [];
  const next = steps.find(open) ?? steps[steps.length - 1];
  return normThinking(build?.thinking) || (next ? thinkingOf(next.model, next.thinking) : defaultThinking(currentModel(build)));
}

/**
 * The advice for a whole build from its steps (each step's own advice when it has one, else fresh). Returns
 * { recommendedModel, recommendedThinking, modelWhy, verdict, adviceCost: { minutes, usd, what }, adviceKind, steps }.
 * Unbuilt work: the model / thinking it should run on and what the Fable steps would cost. Built work: keep (no
 * foundation step ran on Opus), Fable review (some did: read and fix) or redo on Fable (most of it did, or a kernel /
 * migration step did), with the cost of that review or redo.
 */
export function adviseBuild(build, { price = PRICE_PER_MIN, stepAdvice = null } = {}) {
  const steps = Array.isArray(build?.steps) ? build.steps : [];
  const advised = steps.map((s) => ({ step: s, a: stepAdvice?.(s) ?? (s.recommendedModel ? { recommendedModel: s.recommendedModel, recommendedThinking: s.recommendedThinking, modelWhy: s.modelWhy, adviceKind: s.adviceKind } : adviseStep(s, build)) }));
  const base = steps.length ? null : classify(str(build?.detail), { category: build?.category, title: build?.title });
  const fable = advised.filter((x) => x.a.recommendedModel === 'Fable');
  const kinds = [...new Set(advised.map((x) => x.a.adviceKind))];
  const topThinking = advised.reduce((m, x) => (thinkingRank(x.a.recommendedThinking) > thinkingRank(m) ? x.a.recommendedThinking : m), base?.thinking ?? 'low');
  const recommendedModel = base ? base.model : fable.length ? 'Fable' : 'Opus';
  const recommendedThinking = base ? base.thinking : advised.length ? topThinking : 'medium';
  const adviceKind = base ? base.kind : kinds.includes('kernel') ? 'kernel' : kinds.includes('migration') ? 'migration' : fable.length ? 'foundation' : kinds.includes('architecture') ? 'architecture' : kinds.includes('debug') ? 'debug' : kinds.length === 1 && kinds[0] === 'landing' ? 'landing' : 'plugin';
  const finished = FINISHED.includes(build?.status) && (steps.some((s) => s.done) || !steps.length);
  let verdict = ''; let cost;
  if (finished) {
    const onOpus = fable.filter((x) => x.step.done && MODEL(x.step.model) === 'Opus');
    const doneMin = advised.filter((x) => x.step.done).reduce((t, x) => t + minutesOf(x.step.estimate), 0);
    const fableMin = onOpus.reduce((t, x) => t + minutesOf(x.step.estimate), 0);
    const heavy = onOpus.some((x) => x.a.adviceKind === 'kernel' || x.a.adviceKind === 'migration');
    if (base) { verdict = base.model === 'Fable' && MODEL(build?.pending?.model || 'Opus') === 'Opus' ? 'fable-review' : 'keep'; cost = verdict === 'keep' ? { minutes: 0, usd: 0, what: 'nothing to change' } : { minutes: 30, usd: costOf('Fable', 30, 'high', price), what: 'a Fable read of the contract (no steps recorded; rough)' }; }
    else if (!onOpus.length) { verdict = 'keep'; cost = { minutes: 0, usd: 0, what: fable.length ? 'its foundation steps already ran on Fable' : 'no foundation work in it' }; }
    else if (heavy || (doneMin && fableMin / doneMin >= 0.5)) { verdict = 'redo-on-fable'; cost = { minutes: fableMin, usd: costOf('Fable', fableMin, recommendedThinking, price), what: `${onOpus.length} foundation step(s) built again on Fable (${heavy ? 'a kernel / migration step ran on Opus' : 'most of the build is foundation work'})` }; }
    else { verdict = 'fable-review'; const m = Math.max(15, Math.round(fableMin * 0.35)); cost = { minutes: m, usd: costOf('Fable', m, 'high', price), what: `a Fable read of ${onOpus.length} foundation step(s) built on Opus, fixing only what is wrong` }; }
  } else {
    const openFable = fable.filter((x) => open(x.step) && MODEL(x.step.model) !== 'Fable');
    const min = openFable.reduce((t, x) => t + minutesOf(x.step.estimate), 0);
    cost = openFable.length
      ? { minutes: min, usd: r2(costOf('Fable', min, recommendedThinking, price) - costOf('Opus', min, undefined, price)), what: `${openFable.length} open step(s) moved to Fable: the extra over Opus` }
      : base && base.model === 'Fable' ? { minutes: 0, usd: 0, what: 'no steps yet; the Fable extra is known once it has steps' } : { minutes: 0, usd: 0, what: 'nothing to change' };
  }
  const parts = [];
  if (base) parts.push(base.why);
  else {
    if (fable.length) parts.push(`${fable.length} of ${steps.length} step(s) are foundation work (${[...new Set(fable.flatMap((x) => (x.a.modelWhy.match(/: (.*?);/)?.[1] ?? '').split(', ')).filter(Boolean))].slice(0, 5).join(', ')})`);
    const rest = advised.filter((x) => x.a.recommendedModel !== 'Fable');
    if (rest.length) parts.push(`${rest.length} step(s) are ${[...new Set(rest.map((x) => KINDS[x.a.adviceKind]?.label.split(' (')[0]))].join(' / ')} work for Opus`);
    if (!steps.length) parts.push('no steps yet');
  }
  if (verdict) parts.push(verdict === 'keep' ? 'built on the right model' : verdict === 'redo-on-fable' ? 'built on Opus though it is foundation work: redo on Fable' : 'foundation steps built on Opus: a Fable review (read and fix) is enough');
  return { recommendedModel, recommendedThinking, modelWhy: parts.join('. '), verdict, adviceCost: cost, adviceKind, steps: advised.map((x) => ({ uid: x.step.uid, id: x.step.id, ...x.a })) };
}

// ------------------------------------------------------------------ review status (the check / the triangle)

/**
 * 'ok' (green check: it is on what is recommended, or there is no recommendation), 'look' (yellow triangle: the
 * recommendation differs from what it is on, or a built item should be reviewed or redone), or 'dismissed' (Brett OK'd it
 * as is, for exactly this model, thinking and recommendation; any change since brings the triangle back).
 */
export function reviewStatus(rec, cur) {
  const recModel = rec?.recommendedModel ? MODEL(rec.recommendedModel) : '';
  if (!recModel) return 'ok';
  const model = MODEL(cur?.model); const thinking = thinkingOf(model, cur?.thinking);
  const recThinking = normThinking(rec.recommendedThinking) || defaultThinking(recModel);
  const verdict = str(rec.verdict);
  const differs = verdict ? verdict !== 'keep' : recModel !== model || recThinking !== thinking;
  if (!differs) return 'ok';
  const ok = rec.reviewOk && typeof rec.reviewOk === 'object' ? rec.reviewOk : null;
  if (ok && MODEL(ok.model) === model && thinkingOf(model, ok.thinking) === thinking && MODEL(ok.recommendedModel) === recModel && (normThinking(ok.recommendedThinking) || defaultThinking(recModel)) === recThinking && str(ok.verdict) === verdict) return 'dismissed';
  return 'look';
}

/** What every reader shows for a step: model, thinking, the recommendation, why and the review status. */
export function stepView(step, build = {}) {
  const model = MODEL(step?.model); const thinking = thinkingOf(model, step?.thinking);
  const rec = { recommendedModel: step?.recommendedModel ? MODEL(step.recommendedModel) : '', recommendedThinking: normThinking(step?.recommendedThinking), verdict: '', reviewOk: step?.reviewOk };
  const out = { model, thinking, recommendedModel: rec.recommendedModel, recommendedThinking: rec.recommendedThinking || (rec.recommendedModel ? defaultThinking(rec.recommendedModel) : ''), modelWhy: str(step?.modelWhy, 600), adviceKind: str(step?.adviceKind, 20), reviewStatus: reviewStatus(rec, { model, thinking }) };
  if (build?.id) out.build = build.id;
  return out;
}
/** The same for a build (its current model / thinking derived from its steps). */
export function buildView(build) {
  const model = currentModel(build); const thinking = currentThinking(build);
  const rec = { recommendedModel: build?.recommendedModel ? MODEL(build.recommendedModel) : '', recommendedThinking: normThinking(build?.recommendedThinking), verdict: str(build?.verdict), reviewOk: build?.reviewOk };
  return { model, thinking, recommendedModel: rec.recommendedModel, recommendedThinking: rec.recommendedThinking || (rec.recommendedModel ? defaultThinking(rec.recommendedModel) : ''), modelWhy: str(build?.modelWhy, 1200), verdict: rec.verdict, adviceCost: build?.adviceCost && typeof build.adviceCost === 'object' ? { minutes: Number(build.adviceCost.minutes) || 0, usd: Number(build.adviceCost.usd) || 0, what: str(build.adviceCost.what, 300) } : null, adviceKind: str(build?.adviceKind, 20), reviewStatus: reviewStatus(rec, { model, thinking }), stepsToLook: (Array.isArray(build?.steps) ? build.steps : []).filter((s) => stepView(s).reviewStatus === 'look').length };
}

/** The why-panel: current vs recommended, the reasons, what could go wrong if left as is, the cost to change. */
export function whyLines(view) {
  const v = view ?? {}; const lines = [];
  const cur = `${v.model}${v.thinking ? ` · ${v.thinking} thinking` : ''}`;
  const rec = v.recommendedModel ? `${v.recommendedModel} · ${v.recommendedThinking || defaultThinking(v.recommendedModel)} thinking` : 'no recommendation yet';
  lines.push({ label: 'Now', text: cur });
  lines.push({ label: 'Recommended', text: v.verdict ? `${VERDICT_LABEL[v.verdict] ?? v.verdict} (${rec})` : rec });
  if (v.modelWhy) lines.push({ label: 'Why', text: v.modelWhy });
  const risk = riskOf(v);
  if (risk) lines.push({ label: 'If left as is', text: risk });
  if (v.adviceCost && (v.adviceCost.usd || v.adviceCost.minutes)) lines.push({ label: 'Cost to change', text: `~$${v.adviceCost.usd} · ~${v.adviceCost.minutes} min (${v.adviceCost.what})` });
  else if (v.adviceCost?.what) lines.push({ label: 'Cost to change', text: v.adviceCost.what });
  if (v.reviewStatus === 'dismissed') lines.push({ label: 'Status', text: 'Brett OK\'d it as is' });
  return lines;
}
function riskOf(v) {
  if (!v.recommendedModel || v.reviewStatus === 'ok') return '';
  if (v.verdict === 'redo-on-fable') return 'a contract or engine designed on Opus is what every later app and port builds on; the longer it stays, the dearer a redo gets';
  if (v.verdict === 'fable-review') return 'foundation work nobody read on Fable may hide a scaling or cross-port flaw that only shows once apps depend on it';
  if (v.recommendedModel === 'Fable' && v.model !== 'Fable') return 'foundation work on Opus: a design that may not hold across ports or apps, and a redo later';
  if (v.recommendedModel === 'Opus' && v.model === 'Fable') return 'Fable prices for routine work';
  if (thinkingRank(v.recommendedThinking) > thinkingRank(v.thinking)) return 'too little thinking on a hard step: missed edge cases, more retries and a dearer fix';
  if (thinkingRank(v.recommendedThinking) < thinkingRank(v.thinking)) return 'tokens spent on thinking a routine step does not need';
  return '';
}

// ------------------------------------------------------------------ filters (every build / step list, by voice too)

/** { model?, thinking?, status?: 'ok'|'look', needsLook?, fable? } from words ("needs a look", "fable", "model:Opus", "thinking:high"). */
export function parseFilter(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return normFilter(input);
  const f = {};
  for (const w of str(input, 200).toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (w === 'clear' || w === 'all' || w === 'off') return {};
    if (w === 'needs-a-look' || w === 'needs-look' || w === 'look' || w === 'triangle') f.needsLook = true;
    else if (w === 'ok' || w === 'check' || w === 'all-set') f.status = 'ok';
    else if (w === 'fable-candidates' || w === 'fable' || w === 'candidates') f.fable = true;
    else if (w.startsWith('model:')) f.model = MODEL(w.slice(6));
    else if (w.startsWith('thinking:')) f.thinking = normThinking(w.slice(9));
    else if (THINKING.includes(w)) f.thinking = w;
    else if (modelKey(w)) f.model = MODEL(w);
  }
  return normFilter(f);
}
export function normFilter(f) {
  const o = f && typeof f === 'object' ? f : {}; const out = {};
  if (o.model && modelKey(o.model)) out.model = MODEL(o.model);
  if (normThinking(o.thinking)) out.thinking = normThinking(o.thinking);
  if (o.status === 'ok' || o.status === 'look') out.status = o.status;
  if (o.needsLook === true) out.needsLook = true;
  if (o.fable === true) out.fable = true;
  return out;
}
export const filterIsEmpty = (f) => !Object.keys(normFilter(f)).length;
/** Does a step or build view pass the filter? Fable candidates = recommended Fable but not on it, or a built item to review / redo. */
export function matchesFilter(view, filter) {
  const f = normFilter(filter); const v = view ?? {};
  if (f.model && v.model !== f.model) return false;
  if (f.thinking && v.thinking !== f.thinking) return false;
  const looks = v.reviewStatus === 'look';
  if (f.status === 'look' && !looks) return false;
  if (f.status === 'ok' && looks) return false;
  if (f.needsLook && !looks) return false;
  if (f.fable && !((v.recommendedModel === 'Fable' && v.model !== 'Fable') || (v.verdict && v.verdict !== 'keep'))) return false;
  return true;
}
export function filterLabel(filter) {
  const f = normFilter(filter); const parts = [];
  if (f.needsLook) parts.push('Needs a look'); if (f.fable) parts.push('Fable candidates');
  if (f.status && !f.needsLook) parts.push(f.status === 'ok' ? 'All set' : 'Needs a look');
  if (f.model) parts.push(f.model); if (f.thinking) parts.push(`${f.thinking} thinking`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ record fields (what the builds store keeps)

/** Brett OK'd a build or step as is (dismiss) or accepted its recommendation (apply): kept with what it was for, so any change since shows the triangle again. */
export function normReviewOk(v) {
  if (!v || typeof v !== 'object') return null;
  const o = { at: str(v.at, 40), by: str(v.by, 120), via: str(v.via, 20), how: v.how === 'apply' ? 'apply' : 'dismiss', model: MODEL(v.model), thinking: normThinking(v.thinking), recommendedModel: MODEL(v.recommendedModel), recommendedThinking: normThinking(v.recommendedThinking), verdict: VERDICTS.includes(v.verdict) ? v.verdict : '' };
  if (str(v.note)) o.note = str(v.note, 500);
  return o;
}
/** The model-advice@1 record fields of a build or step, only those set (records and exports without advice stay byte-identical). */
export function adviceRecord(o, { build = false } = {}) {
  const out = {}; const x = o && typeof o === 'object' ? o : {};
  if (normThinking(x.thinking)) out.thinking = normThinking(x.thinking);
  if (x.recommendedModel && modelKey(x.recommendedModel)) out.recommendedModel = MODEL(x.recommendedModel);
  if (normThinking(x.recommendedThinking)) out.recommendedThinking = normThinking(x.recommendedThinking);
  if (str(x.modelWhy).trim()) out.modelWhy = str(x.modelWhy, 1200).trim();
  if (str(x.adviceKind).trim()) out.adviceKind = str(x.adviceKind, 20).trim();
  if (x.advicePinned === true) out.advicePinned = true;
  if (str(x.adviceAt)) out.adviceAt = str(x.adviceAt, 40);
  const ok = normReviewOk(x.reviewOk); if (ok) out.reviewOk = ok;
  if (build) {
    if (VERDICTS.includes(x.verdict)) out.verdict = x.verdict;
    if (x.adviceCost && typeof x.adviceCost === 'object') out.adviceCost = { minutes: Math.max(0, Number(x.adviceCost.minutes) || 0), usd: Math.max(0, Number(x.adviceCost.usd) || 0), what: str(x.adviceCost.what, 300) };
  }
  return out;
}
/** A reviewOk record for "Brett OK'd it as is" (dismiss) or "Brett took the recommendation" (apply), bound to what it was for. */
export function reviewOkFor(view, { at, by, via = '', how = 'dismiss', note = '' } = {}) {
  return normReviewOk({ at, by, via, how, model: view?.model, thinking: view?.thinking, recommendedModel: view?.recommendedModel, recommendedThinking: view?.recommendedThinking, verdict: view?.verdict, note });
}

// ------------------------------------------------------------------ merging and the sidecar (never lost on a merge or an old-code write)

const REC_GROUP = ['recommendedModel', 'recommendedThinking', 'modelWhy', 'adviceKind', 'adviceAt', 'advicePinned', 'verdict', 'adviceCost'];
/**
 * Two copies of one record's advice → one: the recommendation group from the copy with the newer `adviceAt` (a pinned
 * one beats an unpinned one of the same age), `reviewOk` from the newer `reviewOk.at`, `thinking` from whichever has it
 * (a's when both). A copy without any advice never blanks the other's. Returns the merged advice fields only.
 */
export function mergeAdvice(a, b) {
  const x = adviceRecord(a ?? {}, { build: true }); const y = adviceRecord(b ?? {}, { build: true });
  const out = {};
  const ax = str(x.adviceAt); const ay = str(y.adviceAt);
  const xHas = REC_GROUP.some((k) => k in x); const yHas = REC_GROUP.some((k) => k in y);
  const from = !yHas ? x : !xHas ? y : ax > ay ? x : ay > ax ? y : x.advicePinned && !y.advicePinned ? x : y.advicePinned && !x.advicePinned ? y : x;
  for (const k of REC_GROUP) if (k in from) out[k] = from[k];
  const ok = !y.reviewOk ? x.reviewOk : !x.reviewOk ? y.reviewOk : str(x.reviewOk.at) >= str(y.reviewOk.at) ? x.reviewOk : y.reviewOk;
  if (ok) out.reviewOk = ok;
  if (x.thinking || y.thinking) out.thinking = x.thinking || y.thinking;
  return out;
}
/** The sidecar entry of one build: its advice fields and each step's, keyed by step uid (empty object when it has none). */
export function sidecarOf(build) {
  const entry = adviceRecord(build, { build: true });
  const steps = {};
  for (const s of Array.isArray(build?.steps) ? build.steps : []) { const a = adviceRecord(s); if (Object.keys(a).length && s.uid) steps[s.uid] = a; }
  if (Object.keys(steps).length) entry.steps = steps;
  return entry;
}
/** Two sidecar entries → one (mergeAdvice on the build and on every step). */
export function mergeSidecarEntry(a, b) {
  const out = mergeAdvice(a, b);
  const steps = {}; const sa = a?.steps ?? {}; const sb = b?.steps ?? {};
  for (const uid of new Set([...Object.keys(sa), ...Object.keys(sb)])) { const m = mergeAdvice(sa[uid], sb[uid]); if (Object.keys(m).length) steps[uid] = m; }
  if (Object.keys(steps).length) out.steps = steps;
  return out;
}
/** Record ← sidecar entry (in place): the merged advice on the build and on each step it still has. Returns true when something changed. */
export function healAdvice(build, entry) {
  if (!build || !entry) return false;
  const before = JSON.stringify(sidecarOf(build));
  const { steps: es, ...eb } = entry;
  Object.assign(build, mergeAdvice(build, eb));
  for (const s of Array.isArray(build.steps) ? build.steps : []) if (s.uid && es?.[s.uid]) Object.assign(s, mergeAdvice(s, es[s.uid]));
  return JSON.stringify(sidecarOf(build)) !== before;
}

/** Every field a reader adds to a build or step record (the API / MCP / CLI contract of model-advice@1). */
export const VIEW_FIELDS = ['model', 'thinking', 'recommendedModel', 'recommendedThinking', 'modelWhy', 'reviewStatus'];
export const BUILD_VIEW_FIELDS = [...VIEW_FIELDS, 'verdict', 'adviceCost', 'adviceKind', 'stepsToLook'];
/** The record fields the store keeps (what the engine writes; `thinking` and `reviewOk` are set by people). */
export const STEP_RECORD_FIELDS = ['thinking', 'recommendedModel', 'recommendedThinking', 'modelWhy', 'adviceKind', 'advicePinned', 'adviceAt', 'reviewOk'];
export const BUILD_RECORD_FIELDS = [...STEP_RECORD_FIELDS, 'verdict', 'adviceCost'];
