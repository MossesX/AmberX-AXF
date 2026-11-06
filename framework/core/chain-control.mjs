/**
 * Chain control (chain-control@1; build headless-session-efficiency-shared-chain-control, Brett, Nov 6 2026: finish the
 * optimization). One registry for how a headless session is set up: which CLAUDE.md files it takes in and how, whether a
 * build runs one session or a fresh one per step, how long the handoff note is, model rules by step type, caps on tool
 * output, file scoping and a token budget per step. The Claude plugin and MD Studio mount the same controls over it; the
 * launcher (deploy/claude-headless.sh) acts on it.
 *
 * Levels: the global config < a build's override < a step's override (`resolve`). Presets (lean / normal / full + saved
 * ones) replace the global config. A file is `always` (its text goes in the system prompt), `demand` (one line naming it:
 * read it when the step needs it) or `never`. When every file is `always`, in load order, Claude Code loads its own chain
 * (`native`); anything else drops the native chain and sends exactly what the rows say.
 *
 * Pure: no IO. Files, the progress file and prices are passed in. Store and CLI: framework/cli/chain-control.mjs. Seed:
 * framework/schemas/chain-control.json.
 */
import { DEFAULT_MODEL, FOUNDATION_MODEL, FOUNDATION_WORDS, coerceModel } from './model-policy.mjs';

export const FRAME = 'chain-control@1';
export const FILE_MODES = ['always', 'demand', 'never'];
export const SESSION_MODES = ['per-step', 'per-phase', 'per-build'];
export const SCOPE_MODES = ['listed', 'off'];
export const LEVELS = ['global', 'build', 'step'];
/** Turns a step is assumed to take when a preview prices it. */
export const TURNS_PER_STEP = 40;

/** Number limits: [min, max]; 0 = no cap (Claude Code's own default applies). */
const LIMITS = {
  'chain.maxChars': [2000, 200000], 'session.handoffChars': [200, 8000], 'session.briefChars': [500, 20000],
  'output.bashChars': [0, 500000], 'output.mcpTokens': [0, 100000], 'output.readTokens': [0, 100000],
  'budget.warnTokens': [0, 20000000], 'budget.stopTokens': [0, 20000000],
};
export const DEFAULTS = Object.freeze({
  chain: { defaultMode: 'demand', brief: true, files: [], order: [], maxChars: 40000 },
  session: { mode: 'per-step', handoffChars: 1500, briefChars: 3000 },
  models: { rules: [] },
  output: { bashChars: 20000, mcpTokens: 10000, readTokens: 12000 },
  scope: { mode: 'listed', always: [] },
  budget: { warnTokens: 150000, stopTokens: 0 },
});

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const strs = (v, max = 60) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean).slice(0, max);
export const tokensOf = (text) => Math.ceil(String(text ?? '').length / 4);
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
/** A file path the registry may name: inside the project, under ~/, or a folder above it that Claude Code reads. */
export const validPath = (p) => typeof p === 'string' && p.length > 0 && p.length < 400 && !p.split('/').includes('..');

const num = (v, key, fallback) => {
  const n = Number(v); const [lo, hi] = LIMITS[key];
  if (!Number.isFinite(n)) return fallback;
  if (n === 0 && lo === 0) return 0;
  return Math.round(Math.min(hi, Math.max(lo, n)));
};
function normFiles(v) {
  const seen = new Set(); const out = [];
  for (const f of Array.isArray(v) ? v : []) {
    if (!isObj(f) || !validPath(f.path) || seen.has(f.path) || !FILE_MODES.includes(f.mode)) continue;
    seen.add(f.path); out.push({ path: f.path, mode: f.mode });
  }
  return out;
}
function normRule(r) {
  if (!isObj(r)) return null;
  const type = slug(r.type); if (!type) return null;
  return { type, label: String(r.label ?? type).slice(0, 60), words: strs(r.words, 40), model: coerceModel(r.model) };
}

/** A whole config, every key present and in range. Unknown keys go; values out of range clamp. */
export function normConfig(c = {}) {
  const s = isObj(c) ? c : {}; const d = DEFAULTS;
  const pick = (o, key, list, fb) => (list.includes(o?.[key]) ? o[key] : fb);
  return {
    chain: {
      defaultMode: pick(s.chain, 'defaultMode', FILE_MODES, d.chain.defaultMode), brief: s.chain?.brief !== false,
      files: normFiles(s.chain?.files), order: strs(s.chain?.order, 200).filter(validPath), maxChars: num(s.chain?.maxChars, 'chain.maxChars', d.chain.maxChars),
    },
    session: { mode: pick(s.session, 'mode', SESSION_MODES, d.session.mode), handoffChars: num(s.session?.handoffChars, 'session.handoffChars', d.session.handoffChars), briefChars: num(s.session?.briefChars, 'session.briefChars', d.session.briefChars) },
    models: { rules: (Array.isArray(s.models?.rules) ? s.models.rules : []).map(normRule).filter(Boolean).slice(0, 20) },
    output: { bashChars: num(s.output?.bashChars, 'output.bashChars', d.output.bashChars), mcpTokens: num(s.output?.mcpTokens, 'output.mcpTokens', d.output.mcpTokens), readTokens: num(s.output?.readTokens, 'output.readTokens', d.output.readTokens) },
    scope: { mode: pick(s.scope, 'mode', SCOPE_MODES, d.scope.mode), always: strs(s.scope?.always, 60).filter(validPath), ...(Array.isArray(s.scope?.files) ? { files: strs(s.scope.files, 60).filter(validPath) } : {}) },
    budget: { warnTokens: num(s.budget?.warnTokens, 'budget.warnTokens', d.budget.warnTokens), stopTokens: num(s.budget?.stopTokens, 'budget.stopTokens', d.budget.stopTokens) },
  };
}

/** `over` on top of `base`: objects merge key by key, arrays replace, `chain.files` merges per path. Pure. */
export function merge(base, over) {
  if (!isObj(over)) return clone(base ?? {});
  const out = clone(base ?? {});
  for (const [k, v] of Object.entries(over)) {
    if (k === 'files' && Array.isArray(v) && Array.isArray(out.files) && out.files.every(isObj)) {
      const rows = new Map(out.files.map((f) => [f.path, f]));
      for (const f of v) if (isObj(f)) rows.set(f.path, f);
      out.files = [...rows.values()];
    } else out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : clone(v);
  }
  return out;
}

/** The keys an override may hold, cleaned; what isn't set stays unset so the level below shows through. */
export function normPartial(p) {
  if (!isObj(p)) return {};
  const full = normConfig(merge(DEFAULTS, p));
  const out = {};
  for (const [group, vals] of Object.entries(p)) {
    if (!isObj(vals) || !isObj(full[group])) continue;
    for (const k of Object.keys(vals)) if (k in full[group]) { (out[group] ??= {})[k] = full[group][k]; }
  }
  if (p.chain?.files) (out.chain ??= {}).files = normFiles(p.chain.files);
  return out;
}

/** The registry document, cleaned. `seed` fills what a live document doesn't have. */
export function normDoc(d, seed = null) {
  const src = isObj(d) && d.$axf === FRAME ? d : {};
  const presets = {};
  const add = (p, builtin) => { const id = slug(p?.id); if (id && isObj(p?.config)) presets[id] = { id, name: String(p.name ?? id).slice(0, 60), description: String(p.description ?? '').slice(0, 240), builtin, config: normConfig(p.config) }; };
  for (const p of seed?.presets ?? []) add(p, true);
  for (const p of Object.values(isObj(src.presets) ? src.presets : {})) if (!presets[slug(p?.id)]?.builtin) add(p, false);
  const preset = typeof src.preset === 'string' ? src.preset : (seed?.preset ?? '');
  const overrides = { builds: {}, steps: {} };
  for (const key of ['builds', 'steps']) for (const [id, v] of Object.entries(isObj(src.overrides?.[key]) ? src.overrides[key] : {})) { const n = normPartial(v); if (Object.keys(n).length) overrides[key][id] = n; }
  return {
    $axf: FRAME, rev: Number.isInteger(src.rev) ? src.rev : 0, preset,
    config: normConfig(isObj(src.config) ? src.config : (presets[preset]?.config ?? seed?.config ?? {})),
    overrides, presets, updatedAt: String(src.updatedAt ?? ''), updatedBy: String(src.updatedBy ?? ''),
  };
}

export const stepKey = (build, step) => `${build}/${step}`;

export const leaves = (o, pre = '') => Object.entries(o ?? {}).flatMap(([k, v]) => (isObj(v) ? leaves(v, `${pre}${k}.`) : [`${pre}${k}`]));
/**
 * The config that applies to a build and step. → { config, sources: { 'session.mode': 'build', … } }: only values that an
 * override set are named; everything else is the global config.
 */
export function resolve(doc, { build = '', step = '' } = {}) {
  const b = build ? doc.overrides.builds[build] : null;
  const s = build && step ? doc.overrides.steps[stepKey(build, step)] : null;
  const sources = {};
  for (const k of leaves(b)) sources[k] = 'build';
  for (const k of leaves(s)) sources[k] = 'step';
  return { config: normConfig(merge(merge(doc.config, b ?? {}), s ?? {})), sources };
}

/** Change a level: `patch` merged into the global config, or into a build's or step's override. Returns a new doc. */
export function applyPatch(doc, patch, { build = '', step = '' } = {}) {
  const next = clone(doc);
  if (!build) { next.config = normConfig(merge(next.config, patch)); next.preset = ''; return next; }
  const key = step ? 'steps' : 'builds'; const id = step ? stepKey(build, step) : build;
  next.overrides[key][id] = normPartial(merge(next.overrides[key][id] ?? {}, patch));
  return next;
}
/** Drop a build's or step's override. */
export function clearOverride(doc, { build = '', step = '' }) {
  const next = clone(doc);
  delete next.overrides[step ? 'steps' : 'builds'][step ? stepKey(build, step) : build];
  return next;
}
/** Make a preset the global config. Overrides stay. Null when there is no such preset. */
export function applyPreset(doc, id) {
  const p = doc.presets[id]; if (!p) return null;
  return { ...clone(doc), preset: id, config: clone(p.config) };
}

/**
 * The chain as rows, in the order this config sends it. `found` = the files Claude Code would load, in its order
 * ([{ path, via, depth, parent, chars }]). Files the config names that aren't found stay as rows (`missing`).
 */
export function chainRows(found, config) {
  const modes = new Map(config.chain.files.map((f) => [f.path, f.mode]));
  const byPath = new Map();
  found.forEach((f, i) => byPath.set(f.path, { path: f.path, via: f.via ?? '', depth: f.depth ?? 0, parent: f.parent ?? '', chars: f.chars ?? 0, load: i }));
  for (const f of config.chain.files) if (!byPath.has(f.path)) byPath.set(f.path, { path: f.path, via: 'added', depth: 0, parent: '', chars: 0, load: byPath.size, missing: true });
  const rows = [...byPath.values()].sort((a, b) => a.load - b.load);
  const placed = []; const rest = new Set(rows.map((r) => r.path));
  for (const p of config.chain.order) if (rest.delete(p)) placed.push(byPath.get(p));
  for (const r of rows) if (rest.has(r.path)) placed.push(r);
  return placed.map((r, i) => ({ ...r, i, tokens: Math.ceil(r.chars / 4), mode: modes.get(r.path) ?? config.chain.defaultMode }));
}
/** Claude Code loads its own chain only when the rows ask for exactly that. */
export const isNative = (rows) => rows.length > 0 && rows.every((r, i) => r.mode === 'always' && !r.missing && (i === 0 || r.load > rows[i - 1].load));

/**
 * What a launch sends for the chain. → { native, append, tokens: { brief, always, index, total, full }, sent: [paths],
 * listed: [paths], dropped: [paths], over: [paths] }. `read(path)` gives a file's text; `brief` is the composed rules
 * brief. A file that would pass chain.maxChars is listed on demand instead, whole, never cut.
 */
export function loadPlan(rows, config, brief, read) {
  const full = rows.reduce((n, r) => n + r.tokens, 0);
  if (isNative(rows)) return { native: true, append: '', tokens: { brief: 0, always: full, index: 0, total: full, full }, sent: rows.map((r) => r.path), listed: [], dropped: [], over: [] };
  const parts = []; const sent = []; const listed = []; const over = [];
  const briefText = config.chain.brief ? String(brief ?? '').trim() : '';
  if (briefText) parts.push(briefText);
  const files = []; let used = briefText.length;
  for (const r of rows.filter((x) => x.mode === 'always' && !x.missing)) {
    const text = String(read(r.path) ?? '').trim();
    if (!text) continue;
    if (used + text.length > config.chain.maxChars) { over.push(r.path); continue; }
    used += text.length; sent.push(r.path); files.push(`### ${r.path}\n${text}`);
  }
  if (files.length) parts.push(`## Project files loaded for this run\n${files.join('\n\n')}`);
  const demand = rows.filter((r) => (r.mode === 'demand' && !r.missing) || over.includes(r.path));
  for (const r of demand) listed.push(r.path);
  const index = demand.length ? `## On demand (not loaded)\nRead one of these only when the step truly needs it:\n${demand.map((r) => `- ${r.path} (about ${r.tokens} tokens)`).join('\n')}` : '';
  if (index) parts.push(index);
  const append = parts.join('\n\n');
  const always = rows.filter((r) => sent.includes(r.path)).reduce((n, r) => n + r.tokens, 0);
  return { native: false, append, tokens: { brief: tokensOf(briefText), always, index: tokensOf(index), total: tokensOf(append), full }, sent, listed, dropped: rows.filter((r) => r.mode === 'never').map((r) => r.path), over };
}

/** A step's type and the model the rules suggest for it. The step's pin still decides what it runs on. */
export function suggestModel(step, config) {
  const text = `${step?.text ?? ''} ${step?.title ?? ''}`.toLowerCase();
  for (const r of config.models.rules) if (r.words.some((w) => text.includes(w.toLowerCase()))) return { type: r.type, label: r.label, model: r.model, why: `${r.label}: matches "${r.words.find((w) => text.includes(w.toLowerCase()))}"` };
  if (FOUNDATION_WORDS.test(text)) return { type: 'foundation', label: 'Foundation', model: FOUNDATION_MODEL, why: 'foundation work (model policy)' };
  return { type: 'other', label: 'Other', model: DEFAULT_MODEL, why: 'no rule matched' };
}
/** Every open step with its pin and suggestion. `differs` = worth raising or lowering. */
export function suggestions(build, config) {
  return (build?.steps ?? []).filter((s) => !s.done && !s.skip).map((s) => {
    const g = suggestModel(s, config); const pinned = coerceModel(s.model);
    return { step: s.id, text: s.text ?? '', pinned, ...g, differs: g.model !== pinned };
  });
}

/** Paths a step's text names, so a step that only mentions its files still lists them. */
export const pathsIn = (text) => [...new Set(String(text ?? '').match(/\b[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,8}\b/g) ?? [])];
/** The exact files a step needs: its own list, the override's, what its text names and the always list. */
export function stepFiles(step, config) {
  if (config.scope.mode === 'off') return [];
  return [...new Set([...(step?.files ?? []), ...(config.scope.files ?? []), ...pathsIn(step?.text), ...config.scope.always])];
}

const doneIn = (progress) => new Set((progress?.steps ?? []).filter((s) => ['done', 'skipped'].includes(s.state)).map((s) => s.id));
/** The steps still to do: not ticked in the store, not done in the progress file. */
export function openSteps(build, progress) {
  const done = doneIn(progress);
  return (build?.steps ?? []).filter((s) => !s.done && !s.skip && !done.has(s.id));
}
/** What the next fresh session takes on: one step, or (per-phase) the open steps up to the next model change. */
export function nextBatch(open, mode) {
  if (!open.length) return [];
  if (mode !== 'per-phase') return [open[0]];
  const m = coerceModel(open[0].model); const out = [];
  for (const s of open) { if (coerceModel(s.model) !== m) break; out.push(s); }
  return out;
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** The handoff note: where the build stands, newest news first until the size runs out, read back oldest first. */
export function handoff(build, progress, chars) {
  const steps = build?.steps ?? [];
  const done = steps.length - openSteps(build, progress).length;
  const head = [`Handoff: ${done}/${steps.length} steps done${progress?.branch ? ` · branch ${progress.branch}` : ''}${progress?.pr ? ` · PR ${progress.pr}` : ''}.`];
  const lines = [];
  for (const s of progress?.steps ?? []) if (s.state === 'done' || s.state === 'failed') lines.push({ at: s.at, text: `- ${s.id} ${s.state === 'failed' ? 'FAILED' : 'done'}: ${clip(s.note || s.text, 200)}${s.commit ? ` (${s.commit.slice(0, 9)})` : ''}` });
  for (const n of (progress?.notes ?? []).filter((x) => !/^session .* (started|ended)/.test(x.text))) lines.push({ at: n.at, text: `- note: ${clip(n.text, 200)}` });
  lines.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  let used = head[0].length; const keep = [];
  for (const l of lines) { if (used + l.text.length + 1 > chars) break; used += l.text.length + 1; keep.push(l.text); }
  return [...head, ...keep.reverse()].join('\n');
}

/** The prompt of one fresh session. Brett's words stay at the head of the build's brief, cut only past briefChars. */
export function stepPrompt({ build, batch, brief, note, config, total }) {
  const files = [...new Set(batch.flatMap((s) => stepFiles(s, config)))];
  const label = batch.length === 1 ? `step ${batch[0].id}` : `steps ${batch[0].id} to ${batch[batch.length - 1].id}`;
  const task = String(brief ?? '').trim();
  const cut = task.length > config.session.briefChars ? `${task.slice(0, config.session.briefChars)}\n…(the rest of the brief is cut: this session only needs the step below)` : task;
  const lines = [`# Build ${build.id}: ${label} of ${total} (fresh session)`, '', note, '', '## Do this now', ...batch.map((s) => `- ${s.id} [${coerceModel(s.model)}] ${s.text}${s.why ? ` (${clip(s.why, 200)})` : ''}`)];
  const checks = [...new Set(batch.flatMap((s) => s.checks ?? []))];
  if (checks.length) lines.push('', '## Checks', ...checks.map((c) => `- ${c}`));
  if (files.length) lines.push('', '## Files for this step', 'Read these; do not explore the repo beyond them unless one of them sends you there.', ...files.map((f) => `- ${f}`));
  lines.push('', `Do only that, commit, mark it done with \`node framework/cli/build-progress.mjs step <stepId> done --note "<one line for the next session>"\`, then finish. The next step gets its own fresh session.`);
  if (cut) lines.push('', '## The build\'s brief (for context)', cut);
  return lines.join('\n');
}

/** What a budget says at this many tokens: 'stop', 'warn' or 'ok'. */
export function budgetState(tokens, budget) {
  if (budget.stopTokens > 0 && tokens >= budget.stopTokens) return 'stop';
  if (budget.warnTokens > 0 && tokens >= budget.warnTokens) return 'warn';
  return 'ok';
}
/** Tokens a budget counts: fresh ones. Cache reads are left out: they dominate every long session and cost a tenth. */
export const budgetTokens = (t) => (t?.input ?? 0) + (t?.output ?? 0) + (t?.cacheWrite ?? 0);

/** The environment that caps tool output for a run. Zero = leave Claude Code's default. */
export function outputEnv(config) {
  const o = config.output; const env = {};
  if (o.bashChars) env.BASH_MAX_OUTPUT_LENGTH = String(o.bashChars);
  if (o.mcpTokens) env.MAX_MCP_OUTPUT_TOKENS = String(o.mcpTokens);
  if (o.readTokens) env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS = String(o.readTokens);
  return env;
}

/**
 * Cost of the system-prompt payload for a preview, next to the full chain in one session: written to the cache once per
 * session, read back on every later turn. `price(model, tokens)` is injected. USD; `priced: false` when there is no price.
 */
export function costPreview({ tokens, fullTokens, model, sessions = 1, steps = 1, turns = TURNS_PER_STEP, price }) {
  const all = turns * Math.max(1, steps); const n = Math.max(1, sessions);
  const session = (t, count) => price(model, { cacheWrite: t, cacheRead: t * Math.max(0, count - 1) });
  const one = session(tokens, all / n); const whole = session(fullTokens, all);
  if (one == null || whole == null) return { model, tokens, fullTokens, priced: false };
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const build = r4(one * n);
  return { model, tokens, fullTokens, priced: true, perStep: r4(build / Math.max(1, steps)), perBuild: build, fullBuild: whole, saved: r4(whole - build), turns, steps, sessions: n };
}
