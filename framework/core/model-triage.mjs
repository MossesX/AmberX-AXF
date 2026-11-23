/**
 * model-triage@1: the VPS gate that decides which model a piece of build work runs on (Brett, Nov 21 2026: "the
 * orchestrator stops choosing models. It only sends builds to the VPS; a VPS-level gate decides which model each
 * build/step runs on"). Every lane asks it: orchestrator steps after the split, emergency builds, hand builds
 * (deploy/claude-headless.sh) and the lander's fix sessions. Nothing else picks a model.
 *
 * The rules are the Fable profiling plan's (Brett, Nov 19 2026): measurable conditions with starting numbers, every one
 * editable (VPS Configuration → Model triage). `decide(work, config, ctx)` walks them in order:
 *
 *   1. An explicit override wins, whatever the rules say: a pin on the step, a brief that names its model, or the
 *      build-wide model Brett set (Claude settings `builds.defaultModel`).
 *   2. The first enabled rule that covers the lane and matches the work decides, and is named on the decision.
 *   3. No rule matched: `defaults.model`.
 *   4. `defaults.handRequest`: the model a hand launch asked for is a floor (the gate may raise it, never lower it),
 *      a pin, or ignored.
 *   5. While "Fable upgrades need my approval" is on (`ctx.approvalRequired`), a rule that would raise the work above
 *      the model it already has is held: the lower model stays, the decision says what the gate wanted.
 *
 * Pure, no I/O: the store, the measured facts (files that depend on the step's files) and the decision log are
 * framework/cli/model-triage.mjs. Models are the policy's (framework/core/model-policy.mjs): the words rules read its
 * one word list, never a second copy. Contract: framework/spec/MODEL-TRIAGE.md.
 */
import { ALLOWED_MODELS, FABLE_WORDS, MODEL_LABELS, MODEL_POLICY, OPUS_WORDS, modelKey, modelRank } from './model-policy.mjs';

export const SCHEMA = 'model-triage@1';
export const DECISION = 'model-decision@1';
/** Every lane a launch can come from. */
export const LANES = Object.freeze(['orchestrator', 'emergency', 'hand', 'lander-fix']);
export const LANE_LABELS = Object.freeze({ orchestrator: 'Orchestrator steps', emergency: 'Emergency builds', hand: 'Hand builds', 'lander-fix': 'Lander fix sessions' });
/** What a hand launch's own `--model` means to the gate. */
export const HAND_REQUEST = Object.freeze(['floor', 'pin', 'ignore']);
/** Rule ids the gate itself owns (never in the editable list). */
export const OVERRIDE = 'override';
export const DEFAULT = 'default';
export const REQUESTED = 'requested';

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const label = (k) => MODEL_LABELS[k]?.split(' ')[0] ?? k;
/** A model key as the builds store spells it: 'fable' → 'Fable'. */
export const storeName = (k) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : '');
const allowedKey = (m) => { const k = modelKey(m); return ALLOWED_MODELS.includes(k) ? k : ''; };
const TOP = ALLOWED_MODELS[ALLOWED_MODELS.length - 1];
const LOW = ALLOWED_MODELS[0];

/**
 * The editable settings of each rule: what the Model triage tab draws and what an edit is checked against.
 * number: whole, within min..max (0 = that measure is off) · list: plain phrases or path patterns, one per entry ·
 * toggle: true or false.
 */
export const RULE_FIELDS = Object.freeze({
  'ci-fix': [{ key: 'phrases', kind: 'list', label: 'Phrases that mark a CI fix', hint: 'Matched on whole words, any case.' }],
  'merge-clash': [{ key: 'phrases', kind: 'list', label: 'Phrases that mark a merge clash', hint: 'Matched on whole words, any case.' }],
  'second-try': [{ key: 'failures', kind: 'number', min: 1, max: 10, label: 'Failed tries before it goes up', hint: 'A session that ran and ended in an error counts. A launch that never started or a usage limit does not.' }],
  contracts: [
    { key: 'paths', kind: 'list', label: 'Contract paths', hint: 'A path prefix, or a pattern with * (framework/spec/, *.schema.json).' },
    { key: 'phrases', kind: 'list', label: 'Contract words', hint: 'Matched on whole words, any case.' },
  ],
  'blast-radius': [{ key: 'dependents', kind: 'number', min: 1, max: 1000, label: 'Files that depend on what it touches', hint: 'Counted on the VPS from the step\'s files.' }],
  size: [
    { key: 'lines', kind: 'number', min: 0, max: 100000, label: 'Lines changed', hint: '0 = off. Used when the size is known (a fix on an open PR).' },
    { key: 'files', kind: 'number', min: 0, max: 500, label: 'Files touched', hint: '0 = off.' },
    { key: 'minutes', kind: 'number', min: 0, max: 600, label: 'Estimated minutes', hint: '0 = off.' },
  ],
  'cross-cutting': [
    { key: 'areas', kind: 'number', min: 0, max: 50, label: 'Areas touched', hint: '0 = off. An area is one plugin, one app or one framework folder.' },
    { key: 'phrases', kind: 'list', label: 'Architecture words', hint: 'Matched on whole words, any case.' },
  ],
  designer: [{ key: 'keepOpus', kind: 'toggle', label: 'Keep the splitter\'s Opus as well', hint: 'On: a step the splitting stage judged simple stays on Opus unless a rule above matched. Off: its suggestion only raises.' }],
  'fable-words': [],
  'simple-work': [],
});

const rule = (id, title, text, model, settings = {}, lanes = LANES) => ({ id, title, text, enabled: true, model, lanes: [...lanes], settings });

/** The rules a fresh VPS starts with (Fable profiling, Nov 19 2026; the numbers are starting points). Order = precedence. */
export const DEFAULT_RULES = Object.freeze([
  rule('ci-fix', 'CI failures', 'A red CI is fixed on the stronger model: find the real cause and check nearby code for the same break.', 'fable',
    { phrases: ['ci is red', 'red ci', 'ci red', 'fix ci', 'ci fix', 'ci failure', 'ci failures', 'ci failed', 'failing check', 'failing checks', 'main is red'] }),
  rule('merge-clash', 'Merge clashes', 'A merge that conflicts in code needs both sides understood.', 'fable',
    { phrases: ['merge conflict', 'merge conflicts', 'merge clash', 'merge clashes', 'conflicts with main', 'clash with main', 'resolve the conflicts', 'resolve conflicts', 'rebase conflict'] }),
  rule('second-try', 'Second try', 'The lower model already tried this step and failed or was sent back: the retry goes up.', 'fable', { failures: 1 }),
  rule('contracts', 'Contracts', 'Touching a schema, a spec, the builds store or shared core code.', 'fable', {
    paths: ['framework/spec/', 'framework/schemas/', 'framework/core/', 'framework/plan/', 'framework/cli/builds-store', '*.schema.json', '*/schema.json'],
    phrases: ['schema', 'schemas', 'asset type', 'asset types', 'contract', 'contracts', 'builds store', 'spec', 'specs', 'kernel', 'engine', 'engines', 'protocol', 'protocols', 'cross-app'],
  }),
  rule('blast-radius', 'Blast radius', 'Many other files or plugins depend on what the step touches.', 'fable', { dependents: 10 }),
  rule('size', 'Size', 'A step over a set size.', 'fable', { lines: 400, files: 8, minutes: 0 }),
  rule('cross-cutting', 'Cross-cutting or architectural', 'Work that spans several plugins or apps, or changes how parts fit together.', 'fable',
    { areas: 3, phrases: ['architecture', 'architectural', 'cross-cutting', 'refactor', 'redesign', 'rewrite', 'every plugin', 'all plugins', 'every app', 'all apps'] }),
  rule('designer', 'Splitter\'s suggestion', 'The splitting stage designed the step and judged which model it needs. The rules above still raise it; a model that only came with an older record raises and never lowers.', 'fable', { keepOpus: true }, ['orchestrator', 'emergency']),
  rule('fable-words', 'Work that might need Fable', 'The model policy\'s word list: audits, debugging, pipeline and lander code, security, Android, judgment calls.', 'fable'),
  rule('simple-work', 'Clearly simple work', 'The model policy\'s word list: renames, copy edits, file moves, simple styling, docs, boilerplate.', 'opus'),
]);
export const RULE_IDS = Object.freeze(DEFAULT_RULES.map((r) => r.id));

/** The gate's own settings. `model` = what work no rule matched runs on (the policy's "unsure"). */
export const DEFAULTS = Object.freeze({ model: MODEL_POLICY.work.unsure, handRequest: 'floor', briefWords: true });

export const defaultConfig = () => ({ $axf: SCHEMA, rev: 0, at: '', by: '', enabled: true, defaults: { ...DEFAULTS }, rules: DEFAULT_RULES.map((r) => JSON.parse(JSON.stringify(r))) });

const listOf = (v, max = 60) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []).map((x) => str(x, 120).trim()).filter(Boolean))].slice(0, max);

/** One rule's settings, checked against its fields: a bad or missing value falls back to the default's. */
function normSettings(id, raw, base) {
  const out = {};
  for (const f of RULE_FIELDS[id] ?? []) {
    const v = raw?.[f.key];
    if (f.kind === 'number') { const n = Number(v); out[f.key] = Number.isInteger(n) && n >= f.min && n <= f.max ? n : base[f.key]; }
    else if (f.kind === 'toggle') out[f.key] = typeof v === 'boolean' ? v : base[f.key];
    else out[f.key] = v === undefined ? [...base[f.key]] : listOf(v);
  }
  return out;
}

/**
 * A stored config made whole: every known rule once (stored order first, then any the store has never seen, in their
 * default place at the end), unknown rules dropped, each value checked. A missing or broken store reads as the defaults.
 */
export function normConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const base = new Map(DEFAULT_RULES.map((r) => [r.id, r]));
  const seen = new Set();
  const rules = [];
  for (const r of [...(Array.isArray(o.rules) ? o.rules : []), ...DEFAULT_RULES]) {
    const b = base.get(r?.id);
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    const lanes = Array.isArray(r.lanes) ? LANES.filter((l) => r.lanes.includes(l)) : [...b.lanes];
    rules.push({ id: b.id, title: b.title, text: b.text, enabled: r.enabled !== false, model: allowedKey(r.model) || b.model, lanes, settings: normSettings(b.id, r.settings, b.settings) });
  }
  const d = o.defaults && typeof o.defaults === 'object' ? o.defaults : {};
  return {
    $axf: SCHEMA, rev: Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0, at: str(o.at, 40), by: str(o.by, 80), enabled: o.enabled !== false,
    defaults: { model: allowedKey(d.model) || DEFAULTS.model, handRequest: HAND_REQUEST.includes(d.handRequest) ? d.handRequest : DEFAULTS.handRequest, briefWords: d.briefWords !== false },
    rules,
  };
}

/**
 * One edit → { config, entry, errors }. Every value is checked; any error = nothing changes.
 *   { op: 'rule', id, enabled?, model?, lanes?, settings?: { key: value } }
 *   { op: 'move', id, to }            the rule's new place (0 = first)
 *   { op: 'defaults', model?, handRequest?, briefWords? }
 *   { op: 'enabled', enabled }        the whole gate (off = every lane gets `defaults.model`, overrides still win)
 *   { op: 'reset' }                   back to the starting rules
 */
export function applyEdit(config, edit, { at = '', by = '' } = {}) {
  const cur = normConfig(config);
  const e = edit && typeof edit === 'object' ? edit : {};
  const errors = [];
  let next = JSON.parse(JSON.stringify(cur));
  const model = (v, path) => { const k = allowedKey(v); if (!k) errors.push(`${path}: ${ALLOWED_MODELS.map(label).join(' or ')}, not ${str(v, 40) || 'nothing'}`); return k; };
  if (e.op === 'reset') next = { ...defaultConfig(), rev: cur.rev };
  else if (e.op === 'enabled') { if (typeof e.enabled !== 'boolean') errors.push('enabled: true or false'); else next.enabled = e.enabled; }
  else if (e.op === 'defaults') {
    let n = 0;
    if (e.model !== undefined) { n += 1; const k = model(e.model, 'defaults.model'); if (k) next.defaults.model = k; }
    if (e.handRequest !== undefined) { n += 1; if (!HAND_REQUEST.includes(e.handRequest)) errors.push(`defaults.handRequest: one of ${HAND_REQUEST.join(', ')}`); else next.defaults.handRequest = e.handRequest; }
    if (e.briefWords !== undefined) { n += 1; if (typeof e.briefWords !== 'boolean') errors.push('defaults.briefWords: true or false'); else next.defaults.briefWords = e.briefWords; }
    if (!n) errors.push('defaults: send model, handRequest or briefWords');
  } else if (e.op === 'rule' || e.op === 'move') {
    const i = next.rules.findIndex((r) => r.id === e.id);
    if (i < 0) errors.push(`no rule ${str(e.id, 40) || '(none)'} (${RULE_IDS.join(', ')})`);
    else if (e.op === 'move') {
      const to = Number(e.to);
      if (!Number.isInteger(to) || to < 0 || to >= next.rules.length) errors.push(`to: a place from 0 to ${next.rules.length - 1}`);
      else { const [r] = next.rules.splice(i, 1); next.rules.splice(to, 0, r); }
    } else {
      const r = next.rules[i]; let n = 0;
      if (e.enabled !== undefined) { n += 1; if (typeof e.enabled !== 'boolean') errors.push('enabled: true or false'); else r.enabled = e.enabled; }
      if (e.model !== undefined) { n += 1; const k = model(e.model, 'model'); if (k) r.model = k; }
      if (e.lanes !== undefined) { n += 1; const bad = (Array.isArray(e.lanes) ? e.lanes : [e.lanes]).filter((l) => !LANES.includes(l)); if (!Array.isArray(e.lanes) || bad.length) errors.push(`lanes: a list of ${LANES.join(', ')}`); else r.lanes = LANES.filter((l) => e.lanes.includes(l)); }
      if (e.settings !== undefined) {
        const s = e.settings && typeof e.settings === 'object' ? e.settings : null;
        if (!s || !Object.keys(s).length) errors.push('settings: { key: value }');
        for (const [k, v] of Object.entries(s ?? {})) {
          n += 1;
          const f = (RULE_FIELDS[r.id] ?? []).find((x) => x.key === k);
          if (!f) { errors.push(`${r.id} has no setting ${k} (${(RULE_FIELDS[r.id] ?? []).map((x) => x.key).join(', ') || 'none'})`); continue; }
          if (f.kind === 'number') { const num = Number(v); if (v === '' || v === null || !Number.isInteger(num) || num < f.min || num > f.max) errors.push(`${r.id}.${k}: a whole number from ${f.min} to ${f.max}`); else r.settings[k] = num; }
          else if (f.kind === 'toggle') { if (typeof v !== 'boolean') errors.push(`${r.id}.${k}: true or false`); else r.settings[k] = v; }
          else if (!Array.isArray(v) && typeof v !== 'string') errors.push(`${r.id}.${k}: a list`);
          else r.settings[k] = listOf(v);
        }
      }
      if (!n && !errors.length) errors.push('nothing to change: send enabled, model, lanes or settings');
    }
  } else errors.push('op: one of rule, move, defaults, enabled, reset');
  if (errors.length) return { config: cur, entry: null, errors };
  next = normConfig({ ...next, rev: cur.rev + 1, at, by: str(by, 80) });
  const what = e.op === 'rule' || e.op === 'move' ? `${e.op} ${e.id}` : e.op;
  return { config: next, errors, entry: { $axf: 'model-triage-history@1', at, by: str(by, 80), rev: next.rev, op: e.op, what, edit: JSON.parse(JSON.stringify(e)), reason: e.reason && typeof e.reason === 'object' ? { title: str(e.reason.title, 200), description: str(e.reason.description, 600) } : { title: str(e.reason, 200) || what, description: '' } } };
}

// ---------------------------------------------------------------- reading the work

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The first phrase of a list found in the text on word boundaries (any case), or ''. */
export function phraseIn(text, phrases) {
  const list = listOf(phrases, 200);
  if (!list.length) return '';
  const m = new RegExp(`(?<![\\w-])(?:${list.map((p) => esc(p).replace(/\s+/g, '\\s+')).join('|')})(?![\\w-])`, 'i').exec(str(text, 20000));
  return m ? m[0].toLowerCase().replace(/\s+/g, ' ') : '';
}

/** Does a path match a pattern: a prefix (`framework/spec/`), or a pattern with `*` matched against the whole path. */
export function pathMatches(path, pattern) {
  const p = str(path, 400).replace(/^\.\//, ''); const pat = str(pattern, 200).trim();
  if (!p || !pat) return false;
  if (!pat.includes('*')) return p.startsWith(pat);
  const re = new RegExp(`^${pat.split('*').map(esc).join('.*')}$`);
  return re.test(p) || (pat.startsWith('*') && re.test(`/${p}`));
}

/** The area a path belongs to: one plugin, one app, one framework or deploy folder, else its top folder. */
export function areaOf(path) {
  const seg = str(path, 400).replace(/^\.\//, '').split('/').filter(Boolean);
  if (seg[0] === 'apps' && seg[2] === 'plugins' && seg[3]) return seg.slice(0, 4).join('/');
  if (seg[0] === 'apps' && seg[1]) return seg.slice(0, 2).join('/');
  if (['framework', 'deploy', 'services'].includes(seg[0]) && seg[1]) return seg.slice(0, 2).join('/');
  return seg[0] ?? '';
}
export const areasOf = (files) => [...new Set((Array.isArray(files) ? files : []).map(areaOf).filter(Boolean))];

/**
 * The model a text names for itself, or '': a `Model: Fable` line, a leading `[Fable]`, "run it on Fable", "pinned to
 * Opus", or a title that ends "(…, Fable)". Talking about the models is not naming one, and a text that names both
 * names neither.
 */
export function explicitModel(text) {
  const s = str(text, 20000);
  const names = ALLOWED_MODELS.join('|');
  const found = new Set();
  const pats = [
    new RegExp(`(?:^|[.;]\\s+)[\\s>*_#-]*model[*_]*\\s*[:=]\\s*[*_\`]*\\s*(${names})\\b(?!\\s*(?:or\\b|/|,))`, 'gim'),
    new RegExp(`^\\s*\\[(${names})\\]`, 'gim'),
    new RegExp(`\\b(?:run|runs|build|built|do|launch)\\s+(?:it|this|this (?:build|step|job)|the (?:build|step|job)|everything)\\s+on\\s+(${names})\\b`, 'gi'),
    new RegExp(`\\bpin(?:ned)?\\s+(?:it |this |the (?:build|step) )?to\\s+(${names})\\b`, 'gi'),
  ];
  for (const re of pats) for (const m of s.matchAll(re)) found.add(m[1].toLowerCase());
  // a title that ends "(Earl, Fable)": the first line only
  const title = new RegExp(`\\((?:[^()]{0,60},\\s*)?(${names})\\)\\s*$`, 'i').exec(s.split('\n')[0]);
  if (title) found.add(title[1].toLowerCase());
  return found.size === 1 ? [...found][0] : '';
}

/** The work as the rules read it, with every measure counted: what a decision records as its facts. */
export function factsOf(work = {}) {
  const w = work && typeof work === 'object' ? work : {};
  const files = (Array.isArray(w.files) ? w.files : []).map((f) => str(f, 300)).filter(Boolean);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= 0 ? Math.floor(Number(v)) : null);
  return { files: files.length, areas: areasOf(files).length, minutes: num(w.minutes), lines: num(w.lines), dependents: num(w.dependents), priorFailures: num(w.priorFailures) ?? 0 };
}

/** rule id → (work, settings, facts, text) → why it matches ('' = it does not). */
const MATCH = {
  'ci-fix': (w, s, f, text) => (['ci-red', 'rules', 'ci-fix'].includes(w.kind) ? 'a CI fix' : (phraseIn(text, s.phrases) && `it says "${phraseIn(text, s.phrases)}"`) || ''),
  'merge-clash': (w, s, f, text) => (['clash-main', 'clash-steps', 'merge-clash'].includes(w.kind) ? 'a merge clash' : (phraseIn(text, s.phrases) && `it says "${phraseIn(text, s.phrases)}"`) || ''),
  'second-try': (w, s, f) => (f.priorFailures >= s.failures ? `${f.priorFailures} failed ${f.priorFailures === 1 ? 'try' : 'tries'} (limit ${s.failures})` : ''),
  contracts: (w, s, f, text) => {
    const hit = (Array.isArray(w.files) ? w.files : []).find((p) => s.paths.some((pat) => pathMatches(p, pat)));
    if (hit) return `it touches ${str(hit, 120)}`;
    const p = phraseIn(text, s.phrases);
    return p ? `it says "${p}"` : '';
  },
  'blast-radius': (w, s, f) => (f.dependents !== null && f.dependents >= s.dependents ? `${f.dependents} files depend on what it touches (limit ${s.dependents})` : ''),
  size: (w, s, f) => (s.lines > 0 && f.lines !== null && f.lines >= s.lines ? `${f.lines} lines (limit ${s.lines})`
    : s.files > 0 && f.files >= s.files ? `${f.files} files (limit ${s.files})`
      : s.minutes > 0 && f.minutes !== null && f.minutes >= s.minutes ? `${f.minutes} minutes (limit ${s.minutes})` : ''),
  'cross-cutting': (w, s, f, text) => (s.areas > 0 && f.areas >= s.areas ? `it spans ${f.areas} areas (limit ${s.areas})` : (phraseIn(text, s.phrases) && `it says "${phraseIn(text, s.phrases)}"`) || ''),
  designer: (w, s) => {
    const k = allowedKey(w.suggested);
    if (k === TOP) return `marked ${label(TOP)} when it was split`;
    return k && s.keepOpus && w.suggestedBy === 'splitter' ? { model: k, why: `the splitting stage judged it ${label(k)} work` } : '';
  },
  'fable-words': (w, s, f, text) => { const m = FABLE_WORDS.exec(text); return m ? `"${m[0].toLowerCase()}" might need ${label(TOP)}` : ''; },
  'simple-work': (w, s, f, text) => { const m = OPUS_WORDS.exec(text); return m ? `"${m[0].toLowerCase()}" clearly doesn't need ${label(TOP)}` : ''; },
};

/**
 * The gate's answer for one piece of work → model-decision@1
 *   { model: 'Fable' | 'Opus', rule, why, lane, facts, at, [wanted, held], [from] }
 * work: { lane, kind, title, text, files, minutes, lines, dependents, priorFailures, current, suggested, suggestedBy, requested,
 *         pin: { model, by }, buildPin: { model, by } }
 * ctx:  { approvalRequired, at }
 */
export function decide(work = {}, config = null, ctx = {}) {
  const cfg = normConfig(config ?? defaultConfig());
  const w = work && typeof work === 'object' ? work : {};
  const lane = LANES.includes(w.lane) ? w.lane : 'orchestrator';
  const text = `${str(w.title, 400)}\n${str(w.text, 20000)}`;
  const facts = factsOf(w);
  const current = allowedKey(w.current);
  const done = (key, ruleId, why, extra = {}) => ({ $axf: DECISION, model: storeName(key), rule: ruleId, why: str(why, 300), lane, facts, at: str(ctx.at, 40), ...(current && current !== key ? { from: storeName(current) } : {}), ...extra });

  // 1. explicit overrides
  const pin = allowedKey(w.pin?.model ?? w.pin);
  if (pin) return done(pin, OVERRIDE, `pinned to ${label(pin)}${str(w.pin?.by, 80) ? ` by ${str(w.pin.by, 80)}` : ''}`);
  const said = cfg.defaults.briefWords ? explicitModel(text) : '';
  if (said) return done(said, OVERRIDE, `${lane === 'hand' || lane === 'lander-fix' ? 'the brief' : 'the step'} names ${label(said)}`);
  const buildPin = allowedKey(w.buildPin?.model ?? w.buildPin);
  if (buildPin) return done(buildPin, OVERRIDE, `every build runs on ${label(buildPin)}${str(w.buildPin?.by, 80) ? ` (${str(w.buildPin.by, 80)})` : ''}`);
  const requested = lane === 'hand' ? allowedKey(w.requested) : '';
  if (requested && cfg.defaults.handRequest === 'pin') return done(requested, OVERRIDE, `the launch asked for ${label(requested)}`);

  // 2. the rules, in order; 3. the default
  let hit = null;
  if (cfg.enabled) {
    for (const r of cfg.rules) {
      if (!r.enabled || !r.lanes.includes(lane)) continue;
      // a match is its reason; a rule that reads a judgement (the splitter's) may name the model with it
      const m = MATCH[r.id]?.(w, r.settings, facts, text);
      if (m) { hit = { key: m.model ?? r.model, rule: r.id, why: `${r.title}: ${m.why ?? m}` }; break; }
    }
  }
  hit ??= { key: cfg.defaults.model, rule: DEFAULT, why: cfg.enabled ? `no rule matched: ${label(cfg.defaults.model)} by default` : `the gate is off: ${label(cfg.defaults.model)} by default` };

  // 4. a hand launch's own model as a floor
  if (requested && cfg.defaults.handRequest === 'floor' && modelRank(requested) > modelRank(hit.key)) hit = { key: requested, rule: REQUESTED, why: `the launch asked for ${label(requested)} (${hit.why}; the request is a floor)` };

  // 5. upgrades wait for Brett while his approval setting is on
  const baseline = current || requested || allowedKey(w.suggested) || LOW;
  if (ctx.approvalRequired && modelRank(hit.key) > modelRank(baseline)) return done(baseline, hit.rule, `${hit.why}. Held on ${label(baseline)}: Fable upgrades need Brett's approval`, { wanted: storeName(hit.key), held: true });
  return done(hit.key, hit.rule, hit.why);
}

/** A decision as a record keeps it (a step's `triage`, a log line): known fields only, clipped. null when it is not one. */
export function normDecision(d) {
  const o = d && typeof d === 'object' ? d : null;
  const key = allowedKey(o?.model);
  if (!o || !key || !str(o.rule)) return null;
  const f = o.facts && typeof o.facts === 'object' ? o.facts : {};
  const facts = {};
  for (const k of ['files', 'areas', 'minutes', 'lines', 'dependents', 'priorFailures']) if (Number.isFinite(f[k])) facts[k] = f[k];
  return {
    model: storeName(key), rule: str(o.rule, 40), why: str(o.why, 300), lane: LANES.includes(o.lane) ? o.lane : 'orchestrator', at: str(o.at, 40),
    ...(allowedKey(o.from) ? { from: storeName(allowedKey(o.from)) } : {}),
    ...(o.held === true && allowedKey(o.wanted) ? { held: true, wanted: storeName(allowedKey(o.wanted)) } : {}),
    ...(allowedKey(o.suggested) ? { suggested: storeName(allowedKey(o.suggested)), ...(o.suggestedBy === 'splitter' ? { suggestedBy: 'splitter' } : {}) } : {}),
    ...(Object.keys(facts).length ? { facts } : {}),
  };
}

/** One plain line for a note, a log or the console: "s2 Fable · Contracts: it touches framework/spec/GATE.md". */
export const decisionLine = (d, name = '') => `${name ? `${name} ` : ''}${d.model} · ${d.why}`;

/** What the tab and every other reader need to draw the rules without knowing them. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, decision: DECISION, lanes: LANES, laneLabels: LANE_LABELS, handRequest: HAND_REQUEST, models: ALLOWED_MODELS.map((k) => ({ value: k, label: MODEL_LABELS[k] })),
  fixed: [OVERRIDE, REQUESTED, DEFAULT], ruleIds: RULE_IDS, fields: RULE_FIELDS,
});
