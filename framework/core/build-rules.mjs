/**
 * Build rules (build-rules@1). Build build-rules-tab-gate-rules-vps-owns, Brett Nov 15 2026: "Can we put these in a build
 * rules tab on the VPS in that rules plugin? Will it enforce it? Will the VPS make sure it builds the home card instead of
 * Claude? Remove it from Claude so it doesn't build it twice. Remove everything for all the builders from Claude so it don't
 * happen twice and put them all in that plugin."
 *
 * Every rule a build has to follow is one record in one store the VPS owns. Each rule says who does it (doer: vps |
 * session), whether a machine can do or verify it (kind), when the VPS acts (phase), how it is checked and fixed, and
 * which brief block carries it when the session is the doer. `briefBlocks` renders the session's share for dispatch; a
 * vps rule never reaches a brief, so nothing is done twice. Contract: framework/spec/BUILD-RULES.md.
 *
 * Records: build-rule@1, build-rules-store@1, build-rule-history@1 (append-only journal), brief-blocks@1.
 * Pure parts take their clock as an argument; the store functions (storeDir, load, save, commit, history) are the only
 * IO, and all of it goes through data-store@1 (data-files.mjs): on axf-data the store is the `build_rules` rows, one per
 * rule, and a change writes the rows it touched (data-patch@1), never the whole store.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as files from './data-files.mjs';

export const SCHEMA = 'build-rules@1';
export const RULE_FRAME = 'build-rule@1';
export const STORE_FRAME = 'build-rules-store@1';
export const HISTORY_FRAME = 'build-rule-history@1';
export const BLOCKS_FRAME = 'brief-blocks@1';
export const VERSION = 1;

/** Who does the rule: the VPS by itself (dispatcher, launcher, hooks, gate, CI, a fixer) or the Claude session. */
export const DOERS = Object.freeze(['vps', 'session']);
/** mechanical = a checker, hook or fixer can do or verify it; judgement = it needs reasoning. */
export const KINDS = Object.freeze(['mechanical', 'judgement']);
/** When the VPS acts: before dispatch, at dispatch (brief + launch context), after the session / PR, or at the gate. */
export const PHASES = Object.freeze(['before', 'dispatch', 'after', 'gate']);
/** The brief blocks a session rule can ride in (the orchestrator's Look / API / Checkpoints lines, the Rules bullets). */
export const BRIEF_BLOCKS = Object.freeze(['look', 'api', 'checkpoints', 'rules']);
/** builds = a build session or the pipeline; interactive = a session with Brett present (never in a headless brief); all = both. */
export const APPLIES = Object.freeze(['builds', 'interactive', 'all']);
/** What `check` holds: nothing, a command line, or a checker id (`gate:ui-review`, `store:home-card`, `fixer:<fixer id>`). */
export const CHECK_KINDS = Object.freeze(['none', 'command', 'checker']);
/** Fixer ids a vps rule may name in `autofix`. An open list: a new fixer is a line here and a runner in the dispatcher. */
export const FIXERS = Object.freeze(['home-card', 'scale-adopt', 'ui-review-submit', 'glossary-catalog', 'tracker', 'chrome-settings-backfill', 'shared-assets-bake', 'builds-live-link',
  'help-stub', 'shipped-features', 'api-parity', 'tracker-threads', 'run-ci-checks', 'pr-open-link']);
/** What a history line records. */
export const HISTORY_ACTIONS = Object.freeze(['seed', 'migrate', 'add', 'edit', 'toggle', 'remove', 'restore']);

export const ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,47}$';
export const RULES_MAX = 400;
export const TITLE_MAX = 160;
export const TEXT_MAX = 4000;
export const SOURCES_MAX = 40;
export const KEYWORDS_MAX = 20;
export const REASON_MAX = 600;
/** The store folder rule: the env override, the hub mount now, axf-data later, a home folder where neither exists. */
export const STORE_DIR = Object.freeze({ env: 'AXF_BUILD_RULES_DIR', now: '/projects/amberx-axf/_data/build-rules', later: 'axf-data', fallback: '~/.axf/build-rules' });
export const FILES = Object.freeze({ store: 'store.json', history: 'history.jsonl', lock: 'store.lock' });
export const SEED_REL = '_claude/builds/build-rules/seed.json';

const ID_RE = new RegExp(ID_PATTERN);
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const int = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const oneOf = (list, v, d) => (list.includes(v) ? v : d);
const strs = (v, n) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => str(s, 60)).filter(Boolean).slice(0, n);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------ records

/** What `check` holds. */
export function checkKind(rule) {
  const c = str(obj(rule).check, REASON_MAX);
  if (!c) return 'none';
  return /^(node|npx|python3?|bash|sh|pnpm|npm)\s/.test(c) ? 'command' : 'checker';
}

/** The brief conditions, cleaned: only the keys that are set. */
export function normWhen(w) {
  const x = obj(w); const out = {};
  if (typeof x.ui === 'boolean') out.ui = x.ui;
  const k = strs(x.keywords, KEYWORDS_MAX); if (k.length) out.keywords = k;
  return out;
}

/** One source line a rule was written at before the store: verbatim, with where. */
export function normSource(s) {
  const x = obj(s);
  const line = int(x.line);
  return {
    source: str(x.source, 200) || (x.file ? `${str(x.file, 200)}:${line}` : ''), file: str(x.file, 200), line,
    ...(int(x.to) ? { to: int(x.to) } : {}), ...(Number.isInteger(x.part) && x.part >= 0 ? { part: x.part } : {}),
    text: str(x.text, TEXT_MAX), ...(int(x.pass) ? { pass: int(x.pass) } : {}),
  };
}

/** One rule, normalised: bad enums fall back to the safe side (session, judgement, rules block, enabled). */
export function normRule(r, at = new Date().toISOString()) {
  const x = obj(r);
  const doer = oneOf(DOERS, x.doer, 'session');
  const createdAt = iso(x.createdAt) || at;
  return {
    $axf: RULE_FRAME, id: str(x.id, 48), title: str(x.title, TITLE_MAX), text: str(x.text, TEXT_MAX),
    doer, kind: oneOf(KINDS, x.kind, 'judgement'), phase: oneOf(PHASES, x.phase, doer === 'vps' ? 'after' : 'dispatch'), enabled: bool(x.enabled, true),
    check: str(x.check, REASON_MAX), autofix: str(x.autofix, 60), briefBlock: oneOf(BRIEF_BLOCKS, x.briefBlock, 'rules'), applies: oneOf(APPLIES, x.applies, 'builds'),
    when: normWhen(x.when), sources: (Array.isArray(x.sources) ? x.sources : []).slice(0, SOURCES_MAX).map(normSource).filter((s) => s.source && s.text),
    rev: Math.max(1, int(x.rev, 1)), createdAt, updatedAt: iso(x.updatedAt) || createdAt, updatedBy: str(x.updatedBy, 80),
    ...(x.note ? { note: str(x.note, REASON_MAX) } : {}),
  };
}

/** Errors in one rule (empty = valid). */
export function ruleErrors(r, path = 'rule') {
  const out = [];
  const x = obj(r);
  if (!ID_RE.test(String(x.id || ''))) out.push(`${path}.id must match ${ID_PATTERN}`);
  if (!str(x.title, TITLE_MAX)) out.push(`${path}.title is one line`);
  if (!str(x.text, TEXT_MAX)) out.push(`${path}.text says the rule`);
  if (!DOERS.includes(x.doer)) out.push(`${path}.doer is one of ${DOERS.join(', ')}`);
  if (!KINDS.includes(x.kind)) out.push(`${path}.kind is one of ${KINDS.join(', ')}`);
  if (!PHASES.includes(x.phase)) out.push(`${path}.phase is one of ${PHASES.join(', ')}`);
  if (typeof x.enabled !== 'boolean') out.push(`${path}.enabled is true or false`);
  if (x.check !== undefined && typeof x.check !== 'string') out.push(`${path}.check is a command or a checker id`);
  if (x.autofix !== undefined && typeof x.autofix !== 'string') out.push(`${path}.autofix is a fixer id`);
  if (x.autofix && x.doer !== 'vps') out.push(`${path}.autofix needs doer vps`);
  if (x.briefBlock !== undefined && !BRIEF_BLOCKS.includes(x.briefBlock)) out.push(`${path}.briefBlock is one of ${BRIEF_BLOCKS.join(', ')}`);
  if (x.applies !== undefined && !APPLIES.includes(x.applies)) out.push(`${path}.applies is one of ${APPLIES.join(', ')}`);
  if (x.when !== undefined && (x.when === null || typeof x.when !== 'object' || Array.isArray(x.when))) out.push(`${path}.when is an object`);
  if (x.sources !== undefined) {
    if (!Array.isArray(x.sources)) out.push(`${path}.sources is a list`);
    else { if (x.sources.length > SOURCES_MAX) out.push(`${path}.sources holds at most ${SOURCES_MAX}`); x.sources.forEach((s, i) => { const y = obj(s); if (!str(y.source, 200) && !str(y.file, 200)) out.push(`${path}.sources[${i}] names where (source or file)`); if (!str(y.text, TEXT_MAX)) out.push(`${path}.sources[${i}].text is the verbatim line`); }); }
  }
  if (x.rev !== undefined && !(Number.isInteger(x.rev) && x.rev >= 1)) out.push(`${path}.rev is a whole number from 1`);
  if (x.$axf !== undefined && x.$axf !== RULE_FRAME) out.push(`${path}.$axf is ${RULE_FRAME}`);
  return out;
}

/** An empty store. */
export function emptyStore(at = new Date().toISOString()) {
  return { $axf: STORE_FRAME, rev: 0, at, updatedBy: '', rules: [] };
}

/** The store, normalised: rules in order, duplicate ids dropped (first wins), at most RULES_MAX. */
export function normStore(doc, at = new Date().toISOString()) {
  const d = obj(doc);
  const seen = new Set(); const rules = [];
  for (const r of Array.isArray(d.rules) ? d.rules : []) { const n = normRule(r, iso(d.at) || at); if (!n.id || seen.has(n.id)) continue; seen.add(n.id); rules.push(n); }
  const sf = obj(d.seededFrom);
  return {
    $axf: STORE_FRAME, rev: int(d.rev), at: iso(d.at) || at, updatedBy: str(d.updatedBy, 80), rules: rules.slice(0, RULES_MAX),
    ...(d.seededFrom ? { seededFrom: { file: str(sf.file, 200), at: iso(sf.at) || at, pass: int(sf.pass), count: int(sf.count) } } : {}),
  };
}

/** Errors in a store document (empty = valid). */
export function storeErrors(doc) {
  const out = [];
  const d = obj(doc);
  if (d.$axf !== STORE_FRAME) out.push(`$axf is ${STORE_FRAME}`);
  if (!Number.isInteger(d.rev) || d.rev < 0) out.push('rev is a whole number');
  if (!iso(d.at)) out.push('at is an ISO date-time');
  if (!Array.isArray(d.rules)) { out.push('rules is a list'); return out; }
  if (d.rules.length > RULES_MAX) out.push(`rules holds at most ${RULES_MAX}`);
  const ids = new Set();
  d.rules.forEach((r, i) => { out.push(...ruleErrors(r, `rules[${i}]`)); const id = obj(r).id; if (ids.has(id)) out.push(`rules[${i}].id ${id} appears twice`); ids.add(id); });
  return out;
}

/** A reason for a write: { title, description }. A plain string is the title. */
export function normReason(r) {
  if (typeof r === 'string') return { title: str(r, 200), description: '' };
  const x = obj(r);
  return { title: str(x.title, 200), description: str(x.description, REASON_MAX) };
}

/** One history line, normalised. */
export function normHistory(h) {
  const x = obj(h);
  return {
    $axf: HISTORY_FRAME, at: iso(x.at), by: str(x.by, 80), action: oneOf(HISTORY_ACTIONS, x.action, 'edit'), ...(x.id ? { id: str(x.id, 48) } : {}), rev: int(x.rev),
    ...(int(x.ruleRev) ? { ruleRev: int(x.ruleRev) } : {}), ...(Number.isInteger(x.count) ? { count: int(x.count) } : {}),
    ...(x.before ? { before: normRule(x.before, iso(x.at) || undefined) } : {}), ...(x.after ? { after: normRule(x.after, iso(x.at) || undefined) } : {}),
    reason: normReason(x.reason),
  };
}

/** Errors in a history line (empty = valid). */
export function historyErrors(h, path = 'history') {
  const out = [];
  const x = obj(h);
  if (x.$axf !== HISTORY_FRAME) out.push(`${path}.$axf is ${HISTORY_FRAME}`);
  if (!iso(x.at)) out.push(`${path}.at is an ISO date-time`);
  if (!str(x.by, 80)) out.push(`${path}.by names who`);
  if (!HISTORY_ACTIONS.includes(x.action)) out.push(`${path}.action is one of ${HISTORY_ACTIONS.join(', ')}`);
  if (!Number.isInteger(x.rev) || x.rev < 0) out.push(`${path}.rev is the store revision`);
  if (['add', 'edit', 'toggle', 'remove', 'restore'].includes(x.action) && !ID_RE.test(String(x.id || ''))) out.push(`${path}.id names the rule`);
  if (['seed', 'migrate'].includes(x.action) && !Number.isInteger(x.count)) out.push(`${path}.count says how many rules`);
  if (!str(obj(x.reason).title || x.reason, 200)) out.push(`${path}.reason.title says what happened`);
  return out;
}

// ------------------------------------------------------------------ changes (pure)

/**
 * One change applied to a store → { store, entry, errors }. Pure: `at` and `by` come in. Change shapes:
 *   { action: 'add', rule, reason }                    a new rule (id unique)
 *   { action: 'edit', id, patch, reason }              fields of one rule; id, rev, createdAt and sources never change by patch
 *   { action: 'toggle', id, enabled, reason }          on / off
 *   { action: 'remove', id, reason }                   taken out (History keeps it)
 *   { action: 'restore', id, to: build-rule@1, reason } put back as an earlier `after` (or a removed rule)
 * The store's rev and at move, the rule's rev moves on edit / toggle / restore, and the entry is the history line.
 */
export function apply(store, change, { at = new Date().toISOString(), by = 'session' } = {}) {
  const s = normStore(store, at);
  const c = obj(change);
  const action = oneOf(HISTORY_ACTIONS, c.action, '');
  const reason = normReason(c.reason);
  const fail = (...errors) => ({ store: s, entry: null, errors });
  if (!action || action === 'seed' || action === 'migrate') return fail(`action is one of add, edit, toggle, remove, restore`);
  if (!reason.title) return fail('reason.title says what is about to happen');
  const rev = s.rev + 1;
  const base = { $axf: HISTORY_FRAME, at, by, action, rev, reason };
  const idx = s.rules.findIndex((r) => r.id === str(c.id, 48));
  const cur = idx >= 0 ? s.rules[idx] : null;
  let after = null; let before = cur;
  if (action === 'add') {
    const n = normRule({ ...obj(c.rule), rev: 1, createdAt: at, updatedAt: at, updatedBy: by }, at);
    const errs = ruleErrors(n);
    if (errs.length) return fail(...errs);
    if (s.rules.some((r) => r.id === n.id)) return fail(`rules.${n.id} already exists`);
    if (s.rules.length >= RULES_MAX) return fail(`rules holds at most ${RULES_MAX}`);
    after = n; before = null;
    s.rules.push(after);
  } else {
    if (!cur && action !== 'restore') return fail(`rules.${str(c.id, 48) || '?'} does not exist`);
    if (action === 'remove') { s.rules.splice(idx, 1); }
    else if (action === 'toggle') {
      if (typeof c.enabled !== 'boolean') return fail('enabled is true or false');
      if (cur.enabled === c.enabled) return fail(`rules.${cur.id} is already ${c.enabled ? 'on' : 'off'}`);
      after = { ...cur, enabled: c.enabled, rev: cur.rev + 1, updatedAt: at, updatedBy: by };
    } else if (action === 'edit') {
      const p = obj(c.patch);
      const locked = ['id', 'rev', 'createdAt', 'sources', '$axf'].filter((k) => p[k] !== undefined);
      if (locked.length) return fail(`patch cannot change ${locked.join(', ')}`);
      const n = normRule({ ...cur, ...p, when: p.when !== undefined ? p.when : cur.when, id: cur.id, rev: cur.rev + 1, createdAt: cur.createdAt, sources: cur.sources, updatedAt: at, updatedBy: by }, at);
      const errs = ruleErrors(n);
      if (errs.length) return fail(...errs);
      const same = (k) => JSON.stringify(n[k]) === JSON.stringify(cur[k]);
      if (Object.keys(n).every((k) => ['rev', 'updatedAt', 'updatedBy'].includes(k) || same(k))) return fail(`rules.${cur.id}: nothing changed`);
      after = n;
    } else if (action === 'restore') {
      const to = normRule({ ...obj(c.to), id: str(c.id, 48) || obj(c.to).id }, at);
      const errs = ruleErrors(to);
      if (errs.length) return fail(...errs);
      after = { ...to, rev: (cur ? cur.rev : to.rev) + 1, updatedAt: at, updatedBy: by };
      if (!cur) s.rules.push(after);
    }
    if (after && cur) s.rules[idx] = after;
  }
  const entry = normHistory({ ...base, id: (after || before).id, ...(after ? { ruleRev: after.rev } : {}), ...(before ? { before: { ...before, sources: [] } } : {}), ...(after ? { after } : {}) });
  return { store: { ...s, rev, at, updatedBy: by }, entry, errors: [] };
}

/** A store seeded from a list of rules (the migration's output) and its one history line. */
export function seedStore(rules, { at = new Date().toISOString(), by = 'migration', from = SEED_REL, pass = 0, action = 'seed' } = {}) {
  const store = normStore({ $axf: STORE_FRAME, rev: 1, at, updatedBy: by, rules: (Array.isArray(rules) ? rules : []).map((r) => ({ ...r, rev: 1, createdAt: at, updatedAt: at, updatedBy: by })), seededFrom: { file: from, at, pass, count: 0 } }, at);
  store.seededFrom.count = store.rules.length;
  const entry = normHistory({ at, by, action: oneOf(['seed', 'migrate'], action, 'seed'), rev: 1, count: store.rules.length, reason: { title: `${action === 'migrate' ? 'Migrated' : 'Seeded'} ${store.rules.length} build rules`, description: `from ${from}` } });
  return { store, entry };
}

// ------------------------------------------------------------------ brief blocks (pure)

const UI_WORDS = /\b(ui|gui|screen|screens|dialog|popup|pop-up|banner|toolbar|menu|tab|tabs|page|widget|button|card|settings tab|settings panel|\.tsx|\.css|viewer|editor|panel)\b/i;
/** Does this build change UI? The flag when the build says so, else a word test that errs towards yes. */
export const touchesUi = (build) => { const b = obj(build); return typeof b.ui === 'boolean' ? b.ui : UI_WORDS.test([b.title, b.text, b.words].filter(Boolean).join(' ')); };

/** Why a rule stays out of this build's brief, or '' when it goes in. */
export function whyNot(rule, build) {
  const r = normRule(rule);
  if (!r.enabled) return 'switched off';
  if (r.doer !== 'session') return 'the VPS does it';
  if (r.applies === 'interactive') return 'interactive only';
  const b = obj(build);
  if (r.when.ui === true && !touchesUi(b)) return 'UI only';
  if (r.when.ui === false && touchesUi(b)) return 'no UI';
  if (r.when.keywords) { const hay = [b.id, b.title, b.text, b.words].filter(Boolean).join(' ').toLowerCase(); if (!r.when.keywords.some((k) => hay.includes(k.toLowerCase()))) return `keywords: none of ${r.when.keywords.join(', ')}`; }
  return '';
}

const LABELS = Object.freeze({ look: 'Look', api: 'API', checkpoints: 'Checkpoints' });
export const tokensOf = (text) => Math.ceil(String(text ?? '').length / 4);

/**
 * The session's share of the rules, rendered for one build's brief (brief-blocks@1). Pure. `rules` is a store or a list.
 * look / api / checkpoints are one line each behind their label (as the orchestrator brief has them today); rules is the
 * "## Rules for this job" block, one bullet per rule. A vps rule is never in it: that is the "not twice" guarantee.
 */
export function briefBlocks(rules, build = {}, { at = new Date().toISOString() } = {}) {
  const list = Array.isArray(rules) ? rules : Array.isArray(rules?.rules) ? rules.rules : [];
  const b = obj(build);
  const lines = { look: [], api: [], checkpoints: [], rules: [] }; const texts = { look: [], api: [], checkpoints: [], rules: [] };
  const picked = []; const skipped = [];
  for (const raw of list) {
    const r = normRule(raw, at);
    if (!r.id) continue;
    const why = whyNot(r, b);
    if (why) { skipped.push({ id: r.id, why }); continue; }
    picked.push(r.id); lines[r.briefBlock].push(r.id); texts[r.briefBlock].push(r.text);
  }
  const blocks = {};
  for (const k of ['look', 'api', 'checkpoints']) blocks[k] = texts[k].length ? `${LABELS[k]}: ${texts[k].join(' ')}` : '';
  blocks.rules = texts.rules.length ? ['## Rules for this job', ...texts.rules.map((t) => `- ${t}`)].join('\n') : '';
  const text = BRIEF_BLOCKS.map((k) => blocks[k]).filter(Boolean).join('\n');
  return { $axf: BLOCKS_FRAME, at, build: str(b.id, 120), ui: touchesUi(b), blocks, lines, text, chars: text.length, tokens: tokensOf(text), picked, skipped };
}

// ------------------------------------------------------------------ registry + JSON Schemas

/** The snapshot framework/schemas/build-rules.json carries, for Python readers and ports. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, rule: RULE_FRAME, store: STORE_FRAME, history: HISTORY_FRAME, briefBlocks: BLOCKS_FRAME,
  doers: DOERS, kinds: KINDS, phases: PHASES, briefBlockNames: BRIEF_BLOCKS, applies: APPLIES, checkKinds: CHECK_KINDS, fixers: FIXERS, historyActions: HISTORY_ACTIONS,
  idPattern: ID_PATTERN, rulesMax: RULES_MAX, titleMax: TITLE_MAX, textMax: TEXT_MAX, sourcesMax: SOURCES_MAX, keywordsMax: KEYWORDS_MAX, reasonMax: REASON_MAX,
  storeDir: STORE_DIR, files: FILES, seed: SEED_REL,
});

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (n) => `https://amberx.ai/axf/schemas/${n}`;
const dateTime = { type: 'string', format: 'date-time' };

function ruleSchema(withMeta = true) {
  return {
    ...(withMeta ? { $schema, $id: $id('build-rule.schema.json'), title: `${RULE_FRAME} (${SCHEMA})` } : {}),
    type: 'object', additionalProperties: false, required: ['id', 'title', 'text', 'doer', 'kind', 'phase', 'enabled'],
    properties: {
      $axf: { const: RULE_FRAME }, id: { type: 'string', pattern: ID_PATTERN }, title: { type: 'string', minLength: 1, maxLength: TITLE_MAX }, text: { type: 'string', minLength: 1, maxLength: TEXT_MAX, description: 'the rule as the builder reads it: the brief sends this line when the session is the doer' },
      doer: { enum: DOERS, description: 'vps = the VPS does or enforces it by itself; session = the Claude session has to' }, kind: { enum: KINDS, description: 'mechanical = a checker, hook or fixer can do or verify it; judgement = it needs reasoning' },
      phase: { enum: PHASES, description: 'when the VPS acts: before dispatch, at dispatch, after the session / PR, or at the gate' }, enabled: { type: 'boolean' },
      check: { type: 'string', maxLength: REASON_MAX, description: "'' = none; a command (node …) or a checker id (gate:ui-review, ci:check-theme, store:home-card)" }, autofix: { type: 'string', maxLength: 60, description: "'' = none; a fixer id (open list in the registry), vps rules only" },
      briefBlock: { enum: BRIEF_BLOCKS, description: 'the brief block that carries the text when the session is the doer' }, applies: { enum: APPLIES },
      when: { type: 'object', additionalProperties: false, properties: { ui: { type: 'boolean' }, keywords: { type: 'array', maxItems: KEYWORDS_MAX, items: { type: 'string' } } } },
      sources: { type: 'array', maxItems: SOURCES_MAX, items: { type: 'object', required: ['source', 'text'], properties: { source: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 1 }, part: { type: 'integer', minimum: 0 }, text: { type: 'string', maxLength: TEXT_MAX }, pass: { type: 'integer', minimum: 1 } } }, description: 'every place the rule was written before this store, verbatim' },
      rev: { type: 'integer', minimum: 1 }, createdAt: dateTime, updatedAt: dateTime, updatedBy: { type: 'string', maxLength: 80 }, note: { type: 'string', maxLength: REASON_MAX },
    },
  };
}

/** The JSON Schemas written to framework/schemas/json by `axf schemas`. */
export function jsonSchemas() {
  const rule = ruleSchema(true);
  const inner = ruleSchema(false);
  return {
    'build-rule.schema.json': rule,
    'build-rules-store.schema.json': {
      $schema, $id: $id('build-rules-store.schema.json'), title: `${STORE_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'rev', 'at', 'rules'], additionalProperties: true,
      properties: {
        $axf: { const: STORE_FRAME }, rev: { type: 'integer', minimum: 0, description: 'the store revision: +1 on every write' }, at: dateTime, updatedBy: { type: 'string', maxLength: 80 },
        rules: { type: 'array', maxItems: RULES_MAX, items: inner, description: 'in tab order; ids unique' },
        seededFrom: { type: 'object', properties: { file: { type: 'string' }, at: dateTime, pass: { type: 'integer' }, count: { type: 'integer' } }, description: 'set once by the migration from the inventory' },
      },
    },
    'build-rule-history.schema.json': {
      $schema, $id: $id('build-rule-history.schema.json'), title: `${HISTORY_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'at', 'by', 'action', 'rev', 'reason'], additionalProperties: false,
      properties: {
        $axf: { const: HISTORY_FRAME }, at: dateTime, by: { type: 'string', maxLength: 80 }, action: { enum: HISTORY_ACTIONS }, id: { type: 'string', pattern: ID_PATTERN },
        rev: { type: 'integer', minimum: 0, description: 'the store revision after this write' }, ruleRev: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 0, description: 'seed / migrate: how many rules' },
        before: inner, after: inner, reason: { type: 'object', required: ['title'], properties: { title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: REASON_MAX } } },
      },
    },
  };
}

// ------------------------------------------------------------------ the store (IO)

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The one place the store folder is decided: the env override, the hub mount now (axf-data later), else a home folder. */
export function storeDir(env = process.env, { exists = existsSync, home = homedir } = {}) {
  if (env[STORE_DIR.env]) return env[STORE_DIR.env];
  if (exists(dirname(STORE_DIR.now))) return STORE_DIR.now;
  return join(home(), '.axf', 'build-rules');
}
/** The store's files in a folder. */
export const storeFiles = (dir = storeDir()) => ({ dir, store: join(dir, FILES.store), history: join(dir, FILES.history), lock: join(dir, FILES.lock) });
/** The seed in a checkout. */
export const seedPath = (root = REPO_ROOT) => join(root, SEED_REL);

export class StoreLocked extends Error {}
function lock(f, waitMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(dirname(f), { recursive: true }); closeSync(openSync(f, 'wx')); return () => rmSync(f, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(f).mtimeMs > 30000) rmSync(f, { force: true }); } catch { /* gone */ }
      if (Date.now() - t0 > waitMs) throw new StoreLocked(`build rules store is locked (${f})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
const readSeed = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
/** The key a store file has on axf-data when its namespace is served from the tables (cutover / rollback), else ''. */
const tableKey = (file) => { const key = files.keyFor(file); return key && ['cutover', 'rollback'].includes(files.modeOf(key)) ? key : ''; };
const keyPath = (key) => key.slice(key.indexOf('/') + 1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The store: the live store when it exists, else the seed (`seeded: true`), else empty (`empty: true`).
 * Read through data-files: the `build_rules` rows on axf-data, or the store file where no table serves the folder.
 * → { store, path, seeded, empty }
 */
export function load({ dir = storeDir(), seed = seedPath(), at = new Date().toISOString() } = {}) {
  const f = storeFiles(dir);
  const live = files.readJsonSync(f.store, null);
  if (live) return { store: normStore(live, at), path: f.store, seeded: false, empty: false };
  const s = readSeed(seed);
  if (s) return { store: normStore(s, at), path: f.store, seeded: true, empty: false, seed };
  return { store: emptyStore(at), path: f.store, seeded: false, empty: true };
}

/** Outside the tables one writer at a time holds the lock file; on axf-data the row revs do that job. */
const locked = (f, fn) => {
  if (tableKey(f.store)) return fn();
  const unlock = lock(f.lock);
  try { return fn(); } finally { unlock(); }
};

/** Write a whole store and its history lines (the seed, the migration, an import). Refuses an invalid store with every error named. */
export function save(store, entries = [], { dir = storeDir() } = {}) {
  const s = normStore(store);
  const errs = storeErrors(s);
  if (errs.length) throw new Error(`build rules store is invalid: ${errs.join('; ')}`);
  const lines = (Array.isArray(entries) ? entries : [entries]).filter(Boolean).map(normHistory);
  for (const e of lines) { const he = historyErrors(e); if (he.length) throw new Error(`history line is invalid: ${he.join('; ')}`); }
  const f = storeFiles(dir);
  locked(f, () => {
    files.writeJsonSync(f.store, s);
    for (const e of lines) files.appendJsonlSync(f.history, e);
  });
  return { store: s, path: f.store };
}

/**
 * One change as a row-level write (data-patch@1): the rules it changed, each with the rev it was read at, the head
 * fields that moved and the history line, in one transaction. Nothing else of the store is sent.
 */
export function rowPatch(before, after, entry, historyPath) {
  const was = new Map(before.rules.map((r) => [r.id, r])); const now = new Map(after.rules.map((r) => [r.id, r]));
  const rules = [];
  for (const r of after.rules) { const b = was.get(r.id); if (!b || !same(b, r)) rules.push({ key: r.id, ifRev: b ? b.rev : null, item: r }); }
  for (const b of before.rules) if (!now.has(b.id)) rules.push({ key: b.id, ifRev: b.rev, delete: true });
  const head = {};
  for (const [k, v] of Object.entries(after)) if (k !== 'rules' && !same(v, before[k])) head[k] = v;
  return { head, lists: { rules }, journal: { path: historyPath, entry, idem: `rev-${entry.rev}-${entry.at}` } };
}

const COMMIT_TRIES = 5;
/** Load, apply one change, write it: the one write path the CLI, REST and MCP share. Throws on a refused change. */
export function commit(change, { dir = storeDir(), seed = seedPath(), at = new Date().toISOString(), by = 'session' } = {}) {
  const f = storeFiles(dir);
  const key = tableKey(f.store);
  const once = () => {
    const cur = load({ dir, seed, at });
    const r = apply(cur.store, change, { at, by });
    if (r.errors.length) throw new Error(r.errors.join('; '));
    const errs = storeErrors(r.store);
    if (errs.length) throw new Error(`build rules store is invalid: ${errs.join('; ')}`);
    // a first write on top of the seed records the seed line too, so History starts at the beginning
    const first = cur.seeded && !files.existsAnySync(f.history) ? [seedStore(cur.store.rules, { at: cur.store.at, by: cur.store.updatedBy || 'migration', from: SEED_REL, pass: cur.store.seededFrom?.pass || 0 }).entry] : [];
    if (key && !cur.seeded && !cur.empty) {
      files.callSync({ op: 'patch', key, body: rowPatch(cur.store, r.store, r.entry, keyPath(files.keyFor(f.history))) });
    } else {
      // the first write of a store: every rule is new, so the whole store goes in once (`create`: a second first writer conflicts)
      if (key) files.callSync({ op: 'put', key, data: r.store, create: true });
      else files.writeJsonSync(f.store, r.store);
      for (const e of [...first, r.entry]) files.appendJsonlSync(f.history, e);
    }
    return { store: r.store, entry: r.entry, path: f.store };
  };
  if (!key) return locked(f, once);
  for (let i = 0; ; i += 1) {
    try { return once(); }
    catch (e) { if (!['conflict', 'exists'].includes(e.code) || i >= COMMIT_TRIES - 1) throw e; }
  }
}

/** The history, newest first. Filters: id, action, since (ISO), limit. */
export function history({ dir = storeDir(), id = '', action = '', since = '', limit = 200 } = {}) {
  const f = storeFiles(dir);
  let lines = [];
  lines = String(files.readTextSync(f.history, '') || '').split('\n').filter(Boolean).map((l) => { try { return normHistory(JSON.parse(l)); } catch { return null; } }).filter(Boolean);
  return lines.filter((e) => (!id || e.id === id) && (!action || e.action === action) && (!since || e.at >= since)).reverse().slice(0, Math.max(1, int(limit, 200)));
}
