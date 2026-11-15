/**
 * Gate rules (gate-rules@1). Build gate-rules-plugin-in-the-console, Brett Nov 15 2026: "Where is the gate and rules
 * plugin, open it on my screen." The gate a PR must pass before it lands was spread over the push banner's lander
 * settings (autoLand, landWaitUi, mergeQueue, queueMode, …), the merge queue's control document and the UI Review hold
 * route. This is the one schema for it, the one reference engine, and the record the console's gate plugin, the CLI, MCP,
 * voice and (later) the axf-molly container read and write. Pure: no IO, no git, no model.
 *
 * Records:
 *   gate-rule@1      one rule: id, kind (ci | tests | theme | controls | ui-review | clash | custom), enabled, settings,
 *                    severity (block | warn | info), owner (console now, axf-molly once the container owns the gate)
 *   gate-rule-set@1  the rule set document: rev, at, rules (unique ids), where it was migrated from
 *   lander-state@1   what the Auto-lander tab, `lander.status` and voice read: status, paused, mode, the PR landing now,
 *                    the last runs, and every waiting PR with the rule that holds it and the reason in plain words
 *
 * The push banner's lander (land-core.blockReason, merge-queue-core.notReady) keeps its own words until the gate plugin's
 * store adapter becomes the one writer; `migrate` maps today's config.json keys onto this rule set so nothing is lost.
 */

export const SCHEMA = 'gate-rules@1';
export const RULE_FRAME = 'gate-rule@1';
export const SET_FRAME = 'gate-rule-set@1';
export const STATE_FRAME = 'lander-state@1';
export const RUN_FRAME = 'auto-lander-run@1';
export const VERSION = 1;

/** What a rule checks. `custom` carries its own check in settings (a script, a command, or a policy the gate enforces). */
export const KINDS = Object.freeze(['ci', 'tests', 'theme', 'controls', 'ui-review', 'clash', 'custom']);
/** block = the PR waits; warn = it lands and History says so; info = recorded only. */
export const SEVERITIES = Object.freeze(['block', 'warn', 'info']);
/** Who evaluates the rule. A rule is never run by both sides; the console hands rules to axf-molly one at a time. */
export const OWNERS = Object.freeze(['console', 'axf-molly']);
/** The lander as a whole. */
export const LANDER_STATUSES = Object.freeze(['running', 'paused', 'idle', 'off', 'error']);
/** How PRs are landed: serial = one at a time on the main it will sit on; batch / stack = the merge queue's two shapes. */
export const LANDER_MODES = Object.freeze(['serial', 'batch', 'stack']);
/** A waiting PR's place in the lander (merge-queue@1 states plus the hand states). */
export const WAITING_STATES = Object.freeze(['waiting', 'testing', 'passed', 'merging', 'held', 'kicked', 'skipped', 'paused']);
/** How one lander run ended (auto-lander-run@1). */
export const RUN_RESULTS = Object.freeze(['landed', 'landing', 'idle', 'skipped', 'error']);
/** Why a run landed nothing: one fixed list so the console, CLI and voice say it the same way. */
export const RUN_REASONS = Object.freeze(['switched-off', 'paused', 'queue-empty', 'ci-waiting', 'conflict', 'ui-review', 'token-missing', 'locked', 'error']);
/** What a lander-state@1 record was built from. */
export const STATE_SOURCES = Object.freeze(['merge-queue@1', 'landing-line@1', 'axf-molly']);

export const ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,40}$';
export const RULES_MAX = 60;
export const RUNS_MAX = 200;
export const WAITING_MAX = 200;
export const TEXT_MAX = 600;

const ID_RE = new RegExp(ID_PATTERN);
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const pr = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const oneOf = (list, v, d) => (list.includes(v) ? v : d);

// ------------------------------------------------------------------ records

/** One rule, normalised: bad enums fall back to the safe side (block, console), settings stay as given. */
export function normRule(r) {
  const x = obj(r);
  return {
    $axf: RULE_FRAME, id: str(x.id, 41), kind: oneOf(KINDS, x.kind, 'custom'), enabled: bool(x.enabled, true),
    severity: oneOf(SEVERITIES, x.severity, 'block'), owner: oneOf(OWNERS, x.owner, 'console'),
    title: str(x.title, 120), description: str(x.description, TEXT_MAX), settings: obj(x.settings),
    ...(x.source ? { source: str(x.source, 200) } : {}), ...(iso(x.updatedAt) ? { updatedAt: iso(x.updatedAt) } : {}), ...(x.updatedBy ? { updatedBy: str(x.updatedBy, 80) } : {}),
  };
}

/** Errors in one rule (empty = valid). */
export function ruleErrors(r, path = 'rule') {
  const out = [];
  const x = obj(r);
  if (!ID_RE.test(String(x.id || ''))) out.push(`${path}.id must match ${ID_PATTERN}`);
  if (!KINDS.includes(x.kind)) out.push(`${path}.kind is one of ${KINDS.join(', ')}`);
  if (typeof x.enabled !== 'boolean') out.push(`${path}.enabled is true or false`);
  if (!SEVERITIES.includes(x.severity)) out.push(`${path}.severity is one of ${SEVERITIES.join(', ')}`);
  if (!OWNERS.includes(x.owner)) out.push(`${path}.owner is one of ${OWNERS.join(', ')}`);
  if (x.settings !== undefined && (x.settings === null || typeof x.settings !== 'object' || Array.isArray(x.settings))) out.push(`${path}.settings is an object`);
  if (x.$axf !== undefined && x.$axf !== RULE_FRAME) out.push(`${path}.$axf is ${RULE_FRAME}`);
  return out;
}

/** An empty rule set. */
export function emptyRuleSet(at = new Date().toISOString()) {
  return { $axf: SET_FRAME, rev: 0, at, rules: [] };
}

/** A rule set, normalised (rules in order, duplicates by id dropped, keeping the first). */
export function normRuleSet(doc, at = new Date().toISOString()) {
  const d = obj(doc);
  const seen = new Set(); const rules = [];
  for (const r of Array.isArray(d.rules) ? d.rules : []) { const n = normRule(r); if (!n.id || seen.has(n.id)) continue; seen.add(n.id); rules.push(n); }
  return {
    $axf: SET_FRAME, rev: int(d.rev), at: iso(d.at) || at, rules: rules.slice(0, RULES_MAX),
    ...(d.updatedBy ? { updatedBy: str(d.updatedBy, 80) } : {}),
    ...(d.migratedFrom ? { migratedFrom: { frame: str(d.migratedFrom.frame, 60), at: iso(d.migratedFrom.at) || at, keys: Array.isArray(d.migratedFrom.keys) ? d.migratedFrom.keys.map((k) => str(k, 60)).filter(Boolean) : [] } } : {}),
  };
}

/** Errors in a rule set document (empty = valid). */
export function ruleSetErrors(doc) {
  const out = [];
  const d = obj(doc);
  if (d.$axf !== SET_FRAME) out.push(`$axf is ${SET_FRAME}`);
  if (!Number.isInteger(d.rev) || d.rev < 0) out.push('rev is a whole number');
  if (!iso(d.at)) out.push('at is an ISO date-time');
  if (!Array.isArray(d.rules)) { out.push('rules is a list'); return out; }
  if (d.rules.length > RULES_MAX) out.push(`rules holds at most ${RULES_MAX}`);
  const ids = new Set();
  d.rules.forEach((r, i) => { out.push(...ruleErrors(r, `rules[${i}]`)); const id = obj(r).id; if (ids.has(id)) out.push(`rules[${i}].id ${id} appears twice`); ids.add(id); });
  return out;
}

/** One lander run (auto-lander-run@1), normalised. */
export function normRun(r) {
  const x = obj(r);
  const landing = x.landing && typeof x.landing === 'object' ? normLanding(x.landing) : null;
  return {
    $axf: RUN_FRAME, startedAt: iso(x.startedAt), finishedAt: iso(x.finishedAt), result: oneOf(RUN_RESULTS, x.result, 'idle'),
    mode: oneOf(LANDER_MODES, x.mode === 'merge-queue' ? 'batch' : x.mode, 'serial'), reason: oneOf(RUN_REASONS, x.reason, ''), reasonText: str(x.reasonText, TEXT_MAX),
    landing, merged: (Array.isArray(x.merged) ? x.merged : []).map(pr).filter(Boolean), waiting: int(x.waiting), ...(x.error ? { error: str(x.error, 400) } : {}),
  };
}

/** The PR in flight. */
export function normLanding(l) {
  const x = obj(l);
  return { pr: pr(x.pr), title: str(x.title, 200), build: str(x.build, 120), branch: str(x.branch, 200), ci: str(x.ci, 20), since: iso(x.since), runUrl: str(x.runUrl, 300) };
}

/** One waiting PR with the rule that holds it. */
export function normWaiting(w, i = 0) {
  const x = obj(w);
  return {
    position: int(x.position) || i + 1, pr: pr(x.pr), title: str(x.title, 200), build: str(x.build, 120), branch: str(x.branch, 200), head: str(x.head, 64),
    state: oneOf(WAITING_STATES, x.state, 'waiting'), rule: ID_RE.test(String(x.rule || '')) ? x.rule : '', reason: str(x.reason, TEXT_MAX), since: iso(x.since), ...(x.url ? { url: str(x.url, 300) } : {}),
  };
}

/** A lander-state@1 record, normalised. */
export function normLanderState(s, at = new Date().toISOString()) {
  const x = obj(s);
  const pause = x.pause && typeof x.pause === 'object' ? { why: str(x.pause.why, 200), by: str(x.pause.by, 80), at: iso(x.pause.at) } : null;
  const paused = bool(x.paused, !!pause);
  return {
    $axf: STATE_FRAME, at: iso(x.at) || at, status: oneOf(LANDER_STATUSES, x.status, paused ? 'paused' : 'idle'), enabled: bool(x.enabled, true), paused, pause: paused ? pause || { why: '', by: '', at: '' } : null,
    mode: oneOf(LANDER_MODES, x.mode === 'merge-queue' ? 'batch' : x.mode, 'serial'), source: oneOf(STATE_SOURCES, x.source, 'merge-queue@1'),
    landing: x.landing && typeof x.landing === 'object' ? normLanding(x.landing) : null,
    lastRuns: (Array.isArray(x.lastRuns) ? x.lastRuns : []).slice(-RUNS_MAX).map(normRun),
    waiting: (Array.isArray(x.waiting) ? x.waiting : []).slice(0, WAITING_MAX).map(normWaiting),
    landedRecently: (Array.isArray(x.landedRecently) ? x.landedRecently : []).map(pr).filter(Boolean).slice(-20),
    ...(x.error ? { error: str(x.error, 400) } : {}),
  };
}

/** Errors in a lander-state@1 record (empty = valid). */
export function landerStateErrors(s) {
  const out = [];
  const x = obj(s);
  if (x.$axf !== STATE_FRAME) out.push(`$axf is ${STATE_FRAME}`);
  if (!iso(x.at)) out.push('at is an ISO date-time');
  if (!LANDER_STATUSES.includes(x.status)) out.push(`status is one of ${LANDER_STATUSES.join(', ')}`);
  if (typeof x.paused !== 'boolean') out.push('paused is true or false');
  if (x.paused && (!x.pause || typeof x.pause !== 'object')) out.push('pause names why, by and at while paused');
  if (x.status === 'paused' && !x.paused) out.push('status paused needs paused true');
  if (!LANDER_MODES.includes(x.mode)) out.push(`mode is one of ${LANDER_MODES.join(', ')}`);
  if (!Array.isArray(x.lastRuns)) out.push('lastRuns is a list');
  else x.lastRuns.forEach((r, i) => { if (!RUN_RESULTS.includes(obj(r).result)) out.push(`lastRuns[${i}].result is one of ${RUN_RESULTS.join(', ')}`); if (obj(r).reason && !RUN_REASONS.includes(obj(r).reason)) out.push(`lastRuns[${i}].reason is one of ${RUN_REASONS.join(', ')}`); });
  if (!Array.isArray(x.waiting)) out.push('waiting is a list');
  else x.waiting.forEach((w, i) => { const y = obj(w); if (!pr(y.pr)) out.push(`waiting[${i}].pr is a PR number`); if (!WAITING_STATES.includes(y.state)) out.push(`waiting[${i}].state is one of ${WAITING_STATES.join(', ')}`); if (!str(y.reason)) out.push(`waiting[${i}].reason says in plain words why it waits`); if (y.rule && !ID_RE.test(String(y.rule))) out.push(`waiting[${i}].rule is a rule id`); });
  if (x.landing !== null && x.landing !== undefined && !pr(obj(x.landing).pr)) out.push('landing is null or names a PR');
  return out;
}

// ------------------------------------------------------------------ registry + JSON Schemas

/** The snapshot framework/schemas/gate-rules.json carries, for Python readers and ports. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, rule: RULE_FRAME, set: SET_FRAME, state: STATE_FRAME, run: RUN_FRAME,
  kinds: KINDS, severities: SEVERITIES, owners: OWNERS, landerStatuses: LANDER_STATUSES, landerModes: LANDER_MODES,
  waitingStates: WAITING_STATES, runResults: RUN_RESULTS, runReasons: RUN_REASONS, stateSources: STATE_SOURCES,
  idPattern: ID_PATTERN, rulesMax: RULES_MAX, runsMax: RUNS_MAX, waitingMax: WAITING_MAX, textMax: TEXT_MAX,
});

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (n) => `https://amberx.ai/axf/schemas/${n}`;
const dateTime = { type: 'string', format: 'date-time' };
const prNumber = { type: 'integer', minimum: 1 };

/** Per-kind settings, typed where today's lander has a key for them; every kind may carry more. */
function settingsSchema() {
  return {
    type: 'object',
    properties: {
      on: { enum: ['head', 'queue-commit'], description: 'ci: which commit the checks must be green on' },
      redJoins: { type: 'boolean', description: 'ci: a red PR still joins a batch (the batch run is the gate)' },
      noRunMin: { type: 'integer', minimum: 1, maximum: 120, description: 'ci: minutes with no run before the lander starts one' },
      commands: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'tests: the commands run after generated files were resolved' },
      check: { type: 'string', description: 'theme / controls / custom: the repo-relative check script' },
      holdOn: { type: 'array', items: { enum: ['waiting', 'changes', 'rejected', 'unknown'] }, description: 'ui-review: the UI Review states that hold a PR' },
      autoResolve: { type: 'array', items: { enum: ['builds', 'union', 'union-json', 'generated'] }, description: 'clash: conflict kinds the lander resolves itself' },
      fileFix: { type: 'boolean', description: 'clash: a code conflict files a fix (agent job) instead of waiting' },
      mode: { enum: LANDER_MODES, description: 'merge-queue-only: how PRs land' },
      autoLand: { type: 'boolean', description: 'merge-queue-only: the builds round (clean, merge main, push, open the PR) runs' },
      directMerge: { type: 'boolean', description: 'merge-queue-only: false = nothing but the lander merges' },
    },
    additionalProperties: true,
  };
}

function ruleProps() {
  return {
    $axf: { const: RULE_FRAME }, id: { type: 'string', pattern: ID_PATTERN }, kind: { enum: KINDS }, enabled: { type: 'boolean' },
    severity: { enum: SEVERITIES, description: 'block = the PR waits; warn = it lands and History says so; info = recorded only' },
    owner: { enum: OWNERS, description: 'who evaluates it: the console now, axf-molly once the container owns the gate' },
    title: { type: 'string', maxLength: 120 }, description: { type: 'string', maxLength: TEXT_MAX }, settings: settingsSchema(),
    source: { type: 'string', maxLength: 200, description: "today's setting or check this rule replaced (push banner config.json key, CI job)" },
    updatedAt: dateTime, updatedBy: { type: 'string', maxLength: 80 },
  };
}

/** The JSON Schemas written to framework/schemas/json by `axf schemas`. */
export function jsonSchemas() {
  const rule = { $schema, $id: $id('gate-rule.schema.json'), title: `${RULE_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['id', 'kind', 'enabled', 'severity', 'owner'], properties: ruleProps() };
  const landing = { type: ['object', 'null'], required: ['pr'], properties: { pr: prNumber, title: { type: 'string' }, build: { type: 'string' }, branch: { type: 'string' }, ci: { type: 'string' }, since: { type: 'string' }, runUrl: { type: 'string' } } };
  const run = {
    type: 'object', required: ['startedAt', 'result'], properties: {
      $axf: { const: RUN_FRAME }, startedAt: dateTime, finishedAt: { type: 'string' }, result: { enum: RUN_RESULTS }, mode: { enum: LANDER_MODES },
      reason: { enum: [...RUN_REASONS, ''] }, reasonText: { type: 'string', maxLength: TEXT_MAX }, landing, merged: { type: 'array', items: prNumber }, waiting: { type: 'integer', minimum: 0 }, error: { type: 'string' },
    },
  };
  const waiting = {
    type: 'object', required: ['pr', 'state', 'reason'], properties: {
      position: { type: 'integer', minimum: 0 }, pr: prNumber, title: { type: 'string' }, build: { type: 'string' }, branch: { type: 'string' }, head: { type: 'string' }, url: { type: 'string' },
      state: { enum: WAITING_STATES }, rule: { type: 'string', pattern: `(${ID_PATTERN})|^$`, description: 'the gate rule that holds it, or empty for a hold by hand / a queue state' },
      reason: { type: 'string', minLength: 1, maxLength: TEXT_MAX, description: 'why it waits, in plain words' }, since: { type: 'string' },
    },
  };
  return {
    'gate-rule.schema.json': rule,
    'gate-rule-set.schema.json': {
      $schema, $id: $id('gate-rule-set.schema.json'), title: `${SET_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'rev', 'at', 'rules'], additionalProperties: true,
      properties: {
        $axf: { const: SET_FRAME }, rev: { type: 'integer', minimum: 0 }, at: dateTime, updatedBy: { type: 'string', maxLength: 80 },
        rules: { type: 'array', maxItems: RULES_MAX, items: { ...rule, $schema: undefined, $id: undefined }, description: 'in the order the gate reads them; ids unique' },
        migratedFrom: { type: 'object', properties: { frame: { type: 'string' }, at: dateTime, keys: { type: 'array', items: { type: 'string' } } }, description: "set once by the migration from the push banner's config.json keys" },
      },
    },
    'lander-state.schema.json': {
      $schema, $id: $id('lander-state.schema.json'), title: `${STATE_FRAME} (${SCHEMA})`, type: 'object', required: ['$axf', 'at', 'status', 'paused', 'mode', 'lastRuns', 'waiting'], additionalProperties: true,
      properties: {
        $axf: { const: STATE_FRAME }, at: dateTime, status: { enum: LANDER_STATUSES }, enabled: { type: 'boolean', description: 'the one On/Off the cron reads first' },
        paused: { type: 'boolean' }, pause: { type: ['object', 'null'], properties: { why: { type: 'string' }, by: { type: 'string' }, at: { type: 'string' } } },
        mode: { enum: LANDER_MODES }, source: { enum: STATE_SOURCES }, landing, lastRuns: { type: 'array', maxItems: RUNS_MAX, items: run },
        waiting: { type: 'array', maxItems: WAITING_MAX, items: waiting }, landedRecently: { type: 'array', items: prNumber }, error: { type: 'string' },
      },
    },
  };
}
