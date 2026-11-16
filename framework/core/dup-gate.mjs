/**
 * dup-gate@1 — the duplicate gate: before a build is filed, split or launched, the VPS checks what already exists and
 * answers with one verdict (pure, IO-free).
 *
 * Brett, Nov 16 2026: "You rebuilt this thing five times over the last three days, even though it's already landed on
 * main. Can we put some kind of gate on the server? With shipped features? Because shipped features is already on the
 * server."
 *
 * The gate is a build rule (build-rules@1 `dup-gate`, doer vps, phase before) in the Gate & rules plugin. Its fixer
 * gathers the corpora (Shipped features manifests, builds@1 records still in progress, plugin inventory, settings keys,
 * files on main) and the lander / plugin state, and calls this engine:
 *
 *   candidate  dup-gate-candidate@1   what is about to be built: { id, title, said, detail, plugins, settings, files }
 *   match      dup-gate-match@1       one thing that already exists: kind (shipped | plugin | file | setting | build),
 *                                     score 0..1 with the per-field scores, where it lives, its on/off state with the
 *                                     source of that state, and the one fix that would make the build unnecessary
 *   verdict    dup-gate-verdict@1     what was checked (corpora, counts, thresholds), every match best first, the top
 *                                     match, block | warn | pass, the reason in plain words, the one fix, the override
 *   override   dup-gate-override@1    Brett's "build it anyway": who, when, why, through which surface
 *
 * The verdict is what every surface shows and answers with: the Build rules row, the build's hold note, History
 * (gate-history@1 kind build-rule), REST / MCP / CLI / voice. A block never deletes or edits the build: the record
 * stays where it is with the verdict attached until Brett overrides or the fix is applied.
 *
 * Thresholds and weights live in the registry and are open to settings: the fixer passes the plugin's values in.
 */

export const SCHEMA = 'dup-gate@1';
export const VERSION = 1;
export const VERDICT_FRAME = 'dup-gate-verdict@1';
export const MATCH_FRAME = 'dup-gate-match@1';
export const CANDIDATE_FRAME = 'dup-gate-candidate@1';
export const OVERRIDE_FRAME = 'dup-gate-override@1';

/** What a match is: a shipped feature on main, a plugin on main, a file on main, a setting that already exists, or a build record not yet landed. */
export const MATCH_KINDS = Object.freeze(['shipped', 'plugin', 'file', 'setting', 'build']);
/** The answer: block = the build waits with the fix named; warn = it goes on and History says so; pass = nothing like it exists. */
export const VERDICTS = Object.freeze(['block', 'warn', 'pass']);
/** The one fix a match offers: a setting to turn (key + value), an action to run, an existing build / PR to reuse, or none. */
export const FIX_KINDS = Object.freeze(['setting', 'action', 'reuse', 'none']);
/** Where an on/off state was read (open: a reader may name another source as a plain string). */
export const STATE_SOURCES = Object.freeze(['lander-config', 'gate-lander', 'plugin-settings', 'plugin-enabled', 'build-options', 'unknown']);
/** The fields the engine compares, and what each one weighs in the score. */
export const FIELDS = Object.freeze(['title', 'said', 'detail', 'plugin', 'setting', 'file', 'id']);
export const WEIGHTS = Object.freeze({ title: 0.45, said: 0.25, detail: 0.1, plugin: 0.1, setting: 0.05, file: 0.03, id: 0.02 });
/** Default thresholds: at or above `block` the build is held, at or above `warn` it is flagged. Settings may move both. */
export const THRESHOLDS = Object.freeze({ block: 0.82, warn: 0.6 });
/** A `build` match's status: the builds@1 statuses still in progress, plus `recorded` = a shipped manifest with no landed commit. */
export const BUILD_STATES = Object.freeze(['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built', 'recorded']);
/** Which surface an override came through. */
export const OVERRIDE_VIAS = Object.freeze(['console', 'voice', 'cli', 'mcp', 'api']);
/** Which corpora a verdict says it checked (open: `checked.corpora[].kind` is one of these). */
export const CORPORA = Object.freeze(['shipped', 'builds', 'plugins', 'settings', 'files']);
export const MATCHES_MAX = 20;
export const TEXT_MAX = 600;
export const SAID_MAX = 4000;
export const LIST_MAX = 200;
export const ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,80}$';

const ID_RE = new RegExp(ID_PATTERN);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = TEXT_MAX) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v, max = LIST_MAX) => (Array.isArray(v) ? v.slice(0, max) : []);
const strList = (v, max = LIST_MAX, each = 300) => [...new Set(list(v, max).map((x) => str(x, each).trim()).filter(Boolean))];
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const unit = (v) => Math.min(1, Math.max(0, Math.round(num(v) * 1000) / 1000));
const oneOf = (allowed, v, d) => (allowed.includes(v) ? v : d);
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
/** An ISO time, or '' when it is not one. */
export const iso = (v) => { const s = str(v, 40).trim(); if (!ISO.test(s)) return ''; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : ''; };
/** A slug id ('Auto-Land' → 'auto-land'). */
export const slug = (s) => str(s, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// ------------------------------------------------------------------ records

/** dup-gate-candidate@1: what is about to be built, in shape. Null without any text to match on. */
export function normCandidate(v) {
  const o = isObj(v) ? v : { title: v };
  const c = {
    $axf: CANDIDATE_FRAME, id: slug(o.id), title: str(o.title, 300).trim(), said: str(o.said ?? o.origin?.said, SAID_MAX).trim(), detail: str(o.detail ?? o.text, SAID_MAX).trim(),
    plugins: strList(o.plugins, 40, 80), settings: strList(o.settings, 40, 120), files: strList(o.files, LIST_MAX, 300),
  };
  return c.title || c.said || c.detail ? c : null;
}

/** The thresholds the fixer passes in (settings), clamped so `warn` never sits above `block`. */
export function normThresholds(t) {
  const o = isObj(t) ? t : {};
  const block = unit(o.block === undefined ? THRESHOLDS.block : o.block);
  const warn = Math.min(block, unit(o.warn === undefined ? THRESHOLDS.warn : o.warn));
  return { block, warn };
}

/** The one fix a match offers (dup-gate-fix): setting { key, value }, action { action, args }, reuse { build, pr }, or none. */
export function normFix(v) {
  if (!isObj(v)) return { kind: 'none', text: '' };
  const kind = oneOf(FIX_KINDS, v.kind, 'none');
  const f = { kind, text: str(v.text, TEXT_MAX) };
  if (kind === 'setting') { f.key = str(v.key, 120); f.value = v.value === undefined ? null : (typeof v.value === 'object' ? JSON.parse(JSON.stringify(v.value)) : v.value); f.source = str(v.source, 200); }
  if (kind === 'action') { f.action = str(v.action, 120); f.args = isObj(v.args) ? JSON.parse(JSON.stringify(v.args)) : {}; }
  if (kind === 'reuse') { f.build = slug(v.build); f.pr = Math.max(0, Math.floor(num(v.pr))); }
  return f;
}

/** The on/off state of a matched thing and where that was read: { on: true | false | null, source, key, since }. */
export function normState(v) {
  if (!isObj(v)) return null;
  return { on: typeof v.on === 'boolean' ? v.on : null, source: str(v.source, 200) || 'unknown', key: str(v.key, 120), since: iso(v.since) };
}

/** dup-gate-match@1 in shape, or null without a kind and an id / title. */
export function normMatch(v) {
  if (!isObj(v)) return null;
  const kind = oneOf(MATCH_KINDS, v.kind, '');
  const id = str(v.id, 300).trim(); const title = str(v.title, 300).trim();
  if (!kind || (!id && !title)) return null;
  const w = isObj(v.where) ? v.where : {};
  return {
    $axf: MATCH_FRAME, kind, id, title, score: unit(v.score),
    fields: list(v.fields, FIELDS.length * 2).filter(isObj).map((f) => ({ field: oneOf(FIELDS, f.field, 'title'), score: unit(f.score), against: str(f.against, 300) })),
    where: {
      path: str(w.path, 300), pr: Math.max(0, Math.floor(num(w.pr))), commit: /^[0-9a-f]{7,40}$/i.test(str(w.commit, 40)) ? str(w.commit, 40).toLowerCase() : '',
      plugin: str(w.plugin, 80), key: str(w.key, 120), branch: str(w.branch, 200), build: slug(w.build), status: oneOf(BUILD_STATES, w.status, ''),
    },
    landed: v.landed === true, since: iso(v.since), state: normState(v.state), fix: normFix(v.fix), note: str(v.note, TEXT_MAX),
  };
}

/** dup-gate-override@1 in shape, or null without a `by`. */
export function normOverride(v) {
  if (!isObj(v)) return null;
  const by = str(v.by, 80).trim(); if (!by) return null;
  return { $axf: OVERRIDE_FRAME, by, at: iso(v.at), reason: str(v.reason, TEXT_MAX), via: oneOf(OVERRIDE_VIAS, v.via, 'console'), build: slug(v.build) };
}

/** What the verdict says it checked: corpora with counts and sources, how long it took, the thresholds used. */
export function normChecked(v, thresholds) {
  const o = isObj(v) ? v : {};
  return {
    corpora: list(o.corpora, CORPORA.length * 2).filter(isObj).map((c) => ({ kind: oneOf(CORPORA, c.kind, 'builds'), count: Math.max(0, Math.floor(num(c.count))), source: str(c.source, 300), at: iso(c.at) })),
    tookMs: Math.max(0, Math.floor(num(o.tookMs))), thresholds: normThresholds(thresholds ?? o.thresholds), synonyms: Math.max(0, Math.floor(num(o.synonyms))),
  };
}

/**
 * block | warn | pass from the best score, the thresholds and an override: an override turns a block into a pass (the
 * verdict keeps the override so History shows it); a warn is never overridden because it never held anything.
 */
export function decide(topScore, thresholds = THRESHOLDS, override = null) {
  const t = normThresholds(thresholds); const s = unit(topScore);
  if (s >= t.block) return override ? 'pass' : 'block';
  return s >= t.warn ? 'warn' : 'pass';
}

/** One plain line for the verdict: what exists, where, on or off, and the fix. */
export function reasonOf(verdict, top, override) {
  if (override) return `Overridden by ${override.by}${override.reason ? `: ${override.reason}` : ''} (${override.via}).`;
  if (!top) return 'Nothing like it exists: no shipped feature, plugin, setting or open build matches.';
  const pct = `${Math.round(top.score * 100)}%`;
  const name = top.title || top.id;
  const where = top.kind === 'shipped' ? `landed on main${top.where.pr ? ` in PR #${top.where.pr}` : ''}${top.since ? ` on ${top.since.slice(0, 10)}` : ''}`
    : top.kind === 'build' ? `build ${top.where.build || top.id} is ${top.where.status || 'in progress'}${top.where.pr ? ` (PR #${top.where.pr})` : ''}`
      : top.kind === 'plugin' ? `plugin ${top.where.plugin || top.id} is on main`
        : top.kind === 'setting' ? `setting ${top.where.key || top.id} already exists${top.state?.source ? ` (${top.state.source})` : ''}`
          : `${top.where.path || top.id} is on main`;
  const state = top.state && typeof top.state.on === 'boolean' ? `, switched ${top.state.on ? 'on' : 'off'}${top.state.since ? ` since ${top.state.since.slice(0, 10)}` : ''}` : '';
  const fix = top.fix.kind === 'setting' ? ` Fix: set ${top.fix.key} to ${JSON.stringify(top.fix.value)}.`
    : top.fix.kind === 'action' ? ` Fix: ${top.fix.text || top.fix.action}.`
      : top.fix.kind === 'reuse' ? ` Fix: use ${top.fix.build ? `build ${top.fix.build}` : ''}${top.fix.pr ? ` PR #${top.fix.pr}` : ''} instead.`
        : top.fix.text ? ` ${top.fix.text}` : '';
  const head = verdict === 'block' ? 'Blocked' : verdict === 'warn' ? 'Looks like' : 'Near';
  return `${head}: "${name}" (${pct}) ${where}${state}.${fix}`.replace(/\s+/g, ' ').trim();
}

/**
 * dup-gate-verdict@1 from a candidate, its matches and what was checked. Matches are sorted best first and capped;
 * `verdict`, `reason`, `fix`, `blocked` and `pass` are derived here so every surface answers the same.
 */
export function normVerdict(v, { now = '' } = {}) {
  const o = isObj(v) ? v : {};
  const candidate = normCandidate(o.candidate) || { $axf: CANDIDATE_FRAME, id: slug(o.build), title: '', said: '', detail: '', plugins: [], settings: [], files: [] };
  const thresholds = normThresholds(o.thresholds ?? o.checked?.thresholds);
  const matches = list(o.matches, MATCHES_MAX * 4).map(normMatch).filter(Boolean).sort((a, b) => b.score - a.score || MATCH_KINDS.indexOf(a.kind) - MATCH_KINDS.indexOf(b.kind) || a.id.localeCompare(b.id)).slice(0, MATCHES_MAX);
  const top = matches[0] || null;
  const override = normOverride(o.override);
  const verdict = o.verdict && VERDICTS.includes(o.verdict) && !top ? o.verdict : decide(top?.score ?? 0, thresholds, override);
  return {
    $axf: VERDICT_FRAME, version: VERSION, at: iso(o.at) || iso(now), build: candidate.id || slug(o.build), rule: str(o.rule, 60) || 'dup-gate',
    candidate, checked: normChecked(o.checked, thresholds), matches, top, verdict, blocked: verdict === 'block', pass: verdict === 'pass',
    // derived every time, like the verdict: a re-normalised verdict with a new override never keeps a stale line
    reason: reasonOf(verdict, top, override), fix: top ? top.fix : normFix(null), override,
  };
}

const need = (errors, cond, field, message) => { if (!cond) errors.push({ field, message }); };
/** Field-named problems with a match as given. */
export function validateMatch(v, path = 'match') {
  const errors = []; const o = isObj(v) ? v : {};
  need(errors, MATCH_KINDS.includes(o.kind), `${path}.kind`, `kind is one of ${MATCH_KINDS.join(', ')}`);
  need(errors, str(o.id, 300).trim() || str(o.title, 300).trim(), `${path}.id`, 'a match names what exists: id or title');
  need(errors, o.score === undefined || (Number.isFinite(Number(o.score)) && Number(o.score) >= 0 && Number(o.score) <= 1), `${path}.score`, 'score is 0..1');
  need(errors, o.fields === undefined || (Array.isArray(o.fields) && o.fields.every((f) => isObj(f) && FIELDS.includes(f.field))), `${path}.fields`, `fields are [{ field: ${FIELDS.join(' | ')}, score, against }]`);
  need(errors, o.fix === undefined || o.fix === null || (isObj(o.fix) && FIX_KINDS.includes(o.fix.kind)), `${path}.fix`, `fix.kind is one of ${FIX_KINDS.join(', ')}`);
  need(errors, !isObj(o.fix) || o.fix.kind !== 'setting' || str(o.fix.key, 120).trim(), `${path}.fix.key`, 'a setting fix names its key');
  need(errors, o.state === undefined || o.state === null || (isObj(o.state) && (o.state.on === undefined || o.state.on === null || typeof o.state.on === 'boolean')), `${path}.state`, 'state is { on: true | false | null, source, key, since }');
  need(errors, !isObj(o.where) || o.where.status === undefined || o.where.status === '' || BUILD_STATES.includes(o.where.status), `${path}.where.status`, `where.status is one of ${BUILD_STATES.join(', ')}`);
  need(errors, o.since === undefined || o.since === '' || iso(o.since), `${path}.since`, 'since is an ISO time');
  return errors;
}
/** Field-named problems with a verdict as given (before normalising). */
export function validateVerdict(v) {
  const errors = []; const o = isObj(v) ? v : {};
  need(errors, o.$axf === undefined || o.$axf === VERDICT_FRAME, '$axf', `$axf must be ${VERDICT_FRAME}`);
  need(errors, normCandidate(o.candidate) || slug(o.build), 'candidate', 'a verdict names what was checked: candidate { id, title, said, detail } or build');
  need(errors, o.verdict === undefined || VERDICTS.includes(o.verdict), 'verdict', `verdict is one of ${VERDICTS.join(', ')}`);
  need(errors, o.matches === undefined || Array.isArray(o.matches), 'matches', 'matches is a list of dup-gate-match@1');
  for (const [i, m] of list(o.matches).entries()) errors.push(...validateMatch(m, `matches[${i}]`));
  need(errors, o.override === undefined || o.override === null || (isObj(o.override) && str(o.override.by, 80).trim()), 'override', 'an override says who: { by, at, reason, via }');
  need(errors, !isObj(o.override) || o.override.via === undefined || OVERRIDE_VIAS.includes(o.override.via), 'override.via', `override.via is one of ${OVERRIDE_VIAS.join(', ')}`);
  const t = isObj(o.thresholds) ? o.thresholds : isObj(o.checked) && isObj(o.checked.thresholds) ? o.checked.thresholds : null;
  need(errors, !t || ((t.block === undefined || (num(t.block, -1) >= 0 && num(t.block, -1) <= 1)) && (t.warn === undefined || (num(t.warn, -1) >= 0 && num(t.warn, -1) <= 1))), 'thresholds', 'thresholds are { block: 0..1, warn: 0..1 }');
  need(errors, !t || t.block === undefined || t.warn === undefined || num(t.warn) <= num(t.block), 'thresholds', 'warn never sits above block');
  need(errors, o.at === undefined || o.at === '' || iso(o.at), 'at', 'at is an ISO time');
  return { ok: !errors.length, errors };
}
export const rejection = (errors) => errors.map((e) => `${e.field}: ${e.message}`).join('; ');

/** One line per verdict for lists, History and voice. */
export function summaryOf(v) {
  const d = normVerdict(v);
  return { build: d.build, verdict: d.verdict, blocked: d.blocked, score: d.top?.score ?? 0, kind: d.top?.kind ?? '', match: d.top ? d.top.title || d.top.id : '', fix: d.fix.kind, reason: d.reason, matches: d.matches.length, overridden: !!d.override, at: d.at };
}

/** The gate-history@1 entry a verdict writes (kind build-rule, rule dup-gate): pass, fail (a block) or override. */
export function historyEntry(v, { by = 'vps', at = '' } = {}) {
  const d = normVerdict(v, { now: at });
  const action = d.override ? 'override' : d.blocked ? 'fail' : 'pass';
  return {
    $axf: 'gate-history@1', at: d.at || iso(at), by: d.override?.by || by, kind: 'build-rule', action, id: d.rule,
    after: { build: d.build, phase: 'before', result: d.blocked ? 'fail' : 'pass', verdict: d.verdict, score: d.top?.score ?? 0, match: d.top ? { kind: d.top.kind, id: d.top.id, title: d.top.title } : null, fix: d.fix, override: d.override, detail: d.reason },
    reason: { title: `${d.rule}: ${action}${d.build ? ` (${d.build})` : ''}`, description: d.reason },
  };
}

// ------------------------------------------------------------------ registry + JSON Schemas

/** The snapshot framework/schemas/dup-gate.json carries, for Python readers and ports. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, verdict: VERDICT_FRAME, match: MATCH_FRAME, candidate: CANDIDATE_FRAME, override: OVERRIDE_FRAME,
  matchKinds: MATCH_KINDS, verdicts: VERDICTS, fixKinds: FIX_KINDS, stateSources: STATE_SOURCES, fields: FIELDS, weights: WEIGHTS, thresholds: THRESHOLDS,
  buildStates: BUILD_STATES, overrideVias: OVERRIDE_VIAS, corpora: CORPORA, matchesMax: MATCHES_MAX, textMax: TEXT_MAX, saidMax: SAID_MAX, listMax: LIST_MAX, idPattern: ID_PATTERN,
  rule: { id: 'dup-gate', doer: 'vps', kind: 'mechanical', phase: 'before', check: 'fixer:dup-gate' },
  history: { kind: 'build-rule', actions: ['pass', 'fail', 'override'] },
});

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (n) => `https://amberx.ai/axf/schemas/${n}`;
const S = { type: 'string' };
const text = (max) => ({ type: 'string', maxLength: max });
const dateTime = { type: 'string', format: 'date-time' };
const unitNum = { type: 'number', minimum: 0, maximum: 1 };
const int0 = { type: 'integer', minimum: 0 };
const strArr = (max) => ({ type: 'array', maxItems: max, items: S });

function candidateSchema() {
  return { type: 'object', additionalProperties: false, properties: { $axf: { const: CANDIDATE_FRAME }, id: S, title: text(300), said: text(SAID_MAX), detail: text(SAID_MAX), plugins: strArr(40), settings: strArr(40), files: strArr(LIST_MAX) }, description: 'what is about to be built: the build id when it has one, the title, Brett\'s words, the detail, and the plugins / settings keys / files it names' };
}
function fixSchema() {
  return {
    type: 'object', required: ['kind'], additionalProperties: false,
    properties: { kind: { enum: FIX_KINDS }, text: text(TEXT_MAX), key: text(120), value: {}, source: text(200), action: text(120), args: { type: 'object' }, build: S, pr: int0 },
    description: 'the one fix that makes the build unnecessary: setting = turn key to value; action = run a named console action; reuse = the build / PR already carrying it; none',
  };
}
function stateSchema() {
  return { type: ['object', 'null'], additionalProperties: false, properties: { on: { type: ['boolean', 'null'] }, source: text(200), key: text(120), since: dateTime }, description: 'whether the matched thing is switched on, read from `source` (lander-config, gate-lander, plugin-settings, plugin-enabled, build-options, or another named reader); null when it has no switch' };
}
function overrideSchema() {
  return { type: ['object', 'null'], required: ['by'], additionalProperties: false, properties: { $axf: { const: OVERRIDE_FRAME }, by: text(80), at: dateTime, reason: text(TEXT_MAX), via: { enum: OVERRIDE_VIAS }, build: S }, description: 'Brett\'s "build it anyway": turns a block into a pass and is kept on the verdict and in History' };
}
function matchProps() {
  return {
    $axf: { const: MATCH_FRAME }, kind: { enum: MATCH_KINDS, description: 'shipped = a Shipped features manifest landed on main; plugin = a plugin on main; file = a file on main; setting = an existing setting key; build = a builds@1 record not landed yet (or a shipped manifest with no landed commit)' },
    id: text(300), title: text(300), score: { ...unitNum, description: 'weighted fuzzy similarity 0..1 (trigram Dice + token Jaccard over the fields, synonyms folded)' },
    fields: { type: 'array', items: { type: 'object', required: ['field', 'score'], additionalProperties: false, properties: { field: { enum: FIELDS }, score: unitNum, against: text(300) } } },
    where: { type: 'object', additionalProperties: false, properties: { path: text(300), pr: int0, commit: S, plugin: text(80), key: text(120), branch: text(200), build: S, status: { enum: ['', ...BUILD_STATES] } }, description: 'where it lives: the manifest / file path, PR, landed commit, plugin id, setting key, branch, build id and status' },
    landed: { type: 'boolean', description: 'true when it is on main (a sha or a merged PR), false for a record or branch only' }, since: dateTime, state: stateSchema(), fix: fixSchema(), note: text(TEXT_MAX),
  };
}
/** The JSON Schemas written to framework/schemas/json by `axf schemas`. */
export function jsonSchemas() {
  const match = { $schema, $id: $id('dup-gate-match.schema.json'), title: `${MATCH_FRAME} (${SCHEMA}): one thing that already exists`, type: 'object', additionalProperties: false, required: ['kind', 'score'], properties: matchProps() };
  const verdict = {
    $schema, $id: $id('dup-gate-verdict.schema.json'), title: `${VERDICT_FRAME} (${SCHEMA}): what the duplicate gate found before a build is filed, split or launched`, type: 'object', additionalProperties: false,
    required: ['candidate', 'checked', 'matches', 'verdict'],
    properties: {
      $axf: { const: VERDICT_FRAME }, version: { const: VERSION }, at: dateTime, build: S, rule: { type: 'string', maxLength: 60, description: 'the build rule that produced it (dup-gate)' },
      candidate: candidateSchema(),
      checked: { type: 'object', additionalProperties: false, properties: { corpora: { type: 'array', items: { type: 'object', required: ['kind', 'count'], additionalProperties: false, properties: { kind: { enum: CORPORA }, count: int0, source: text(300), at: dateTime } } }, tookMs: int0, thresholds: { type: 'object', additionalProperties: false, properties: { block: unitNum, warn: unitNum } }, synonyms: int0 }, description: 'what was checked: each corpus with its size and source, how long it took, the thresholds and synonym count used' },
      matches: { type: 'array', maxItems: MATCHES_MAX, items: { $ref: $id('dup-gate-match.schema.json') }, description: 'best first' },
      top: { oneOf: [{ type: 'null' }, { $ref: $id('dup-gate-match.schema.json') }] },
      verdict: { enum: VERDICTS, description: 'block = held with the fix named (top.score ≥ thresholds.block, no override); warn = goes on, History says so (≥ warn); pass' },
      blocked: { type: 'boolean' }, pass: { type: 'boolean' }, reason: { ...text(TEXT_MAX), description: 'one plain line: what exists, where, on or off since when, and the fix' },
      fix: fixSchema(), override: overrideSchema(),
    },
  };
  return { 'dup-gate-match.schema.json': match, 'dup-gate-verdict.schema.json': verdict };
}
