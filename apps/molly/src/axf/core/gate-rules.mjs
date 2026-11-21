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
 *                    The `auto-lander` rule (kind custom, severity info) is the server's policy for what happens when a PR
 *                    cannot land: its settings are auto-lander-policy@1 (framework/core/auto-lander.mjs, AUTO-LANDER.md).
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
      maxAttempts: { type: 'integer', minimum: 1, maximum: 10, description: 'auto-lander: failures of one kind (clash, red-ci, land) on one build before it escalates' },
      backoff: { type: 'object', properties: { baseMin: { type: 'number', exclusiveMinimum: 0 }, factor: { type: 'number', exclusiveMinimum: 0 }, maxMin: { type: 'number', exclusiveMinimum: 0 } }, description: 'auto-lander: minutes before the next try after the n-th failure, min(maxMin, baseMin × factor^(n−1))' },
      attemptTimeoutMin: { type: 'number', exclusiveMinimum: 0, description: 'auto-lander: a started attempt older than this counts as a timeout' },
      mergeMain: { type: 'boolean', description: 'auto-lander: a clash merges main into the branch by itself' },
      fixSessions: { type: 'boolean', description: 'auto-lander: red CI starts a fix session by itself' },
      land: { type: 'boolean', description: 'auto-lander: green lands by itself' },
      escalateTo: { enum: ['banner', 'note', 'none'], description: 'auto-lander: where maxAttempts reached is reported' },
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

// ------------------------------------------------------------------ the default rule set

/** The auto-lander rule's settings (auto-lander-policy@1); kept in step with auto-lander.mjs POLICY_DEFAULTS by check-auto-lander. */
export const AUTO_LANDER_SETTINGS = Object.freeze({ maxAttempts: 3, backoff: Object.freeze({ baseMin: 5, factor: 3, maxMin: 60 }), attemptTimeoutMin: 45, mergeMain: true, fixSessions: true, land: true, escalateTo: 'banner' });

/** The tests the lander runs after generated files were resolved (framework/spec/generated-files.json → tests). */
export const DEFAULT_TESTS = Object.freeze([['node', 'apps/console-web/scripts/control-inventory.mjs', '--check'], ['node', 'framework/spec/check-project-fixtures.mjs']]);

/**
 * The default rules, in the order the gate reads them. `source` names what each one replaced: a push banner config.json
 * key, a CI job, or the shared rule "Only the merge queue merges" (Nov 4 2026).
 */
export const DEFAULT_RULES = Object.freeze([
  // Brett (Nov 15 2026, 06:59): one switch "Merge queue on/off", off by default = the auto-lander lands one at a time. The
  // id stays (GATE.md fixes it); the default no longer forces the merge queue, only that nothing but the lander merges.
  { id: 'merge-queue-only', kind: 'custom', enabled: true, severity: 'block', owner: 'console', title: 'Only the lander merges', description: 'A PR lands only through the lander: one at a time by default, or through the merge queue while its switch is on. No direct merge and no merge outside the lander; drafts and forks never land.', settings: { mode: 'serial', autoLand: false, directMerge: false, depth: 3, batchSize: 8 }, source: 'shared rule Nov 4 2026 (Merge queue switch Nov 15 2026); config.json autoLand, mergeQueue, queueMode, queueDepth, batchSize' },
  { id: 'ci-green', kind: 'ci', enabled: true, severity: 'block', owner: 'console', title: 'CI green', description: 'Every check is green on the commit that lands (the PR head, or the queue commit built on main). Red = needs a code fix; running or not started = waits.', settings: { on: 'head', redJoins: false, noRunMin: 10 }, source: 'land-core.blockReason ci; merge-queue-core.notReady' },
  { id: 'tests', kind: 'tests', enabled: true, severity: 'block', owner: 'console', title: 'Tests after regeneration', description: 'The quick tests the generated-files manifest asks for pass after the lander resolved generated and additive files.', settings: { commands: DEFAULT_TESTS.map((t) => [...t]) }, source: 'land-core.landTests (framework/spec/generated-files.json)' },
  { id: 'theme', kind: 'theme', enabled: true, severity: 'block', owner: 'console', title: 'Theme tokens', description: 'Every colour, size, spacing, font, radius and border comes from asset tokens (check-theme).', settings: { check: 'framework/cli/check-theme.mjs' }, source: 'CI job check-theme' },
  { id: 'controls', kind: 'controls', enabled: true, severity: 'block', owner: 'console', title: 'Framework controls', description: 'UI uses framework controls, never raw ones (check-controls).', settings: { check: 'framework/cli/check-controls.mjs' }, source: 'CI job check-controls' },
  { id: 'toolbars', kind: 'controls', enabled: true, severity: 'block', owner: 'console', title: 'Toolbars', description: 'Every toolbar has role="toolbar" and an aria-label; tab rows are the framework TabGroup (check-toolbars).', settings: { check: 'framework/cli/check-toolbars.mjs' }, source: 'CI job check-toolbars' },
  { id: 'ui-review', kind: 'ui-review', enabled: true, severity: 'block', owner: 'console', title: 'UI Review', description: "A PR whose UI Review is waiting, has changes asked or is rejected does not land; one UI Review couldn't read waits.", settings: { holdOn: ['waiting', 'changes', 'rejected', 'unknown'] }, source: 'config.json landWaitUi; push-banner ui-hold (ui-review@1)' },
  { id: 'clash', kind: 'clash', enabled: true, severity: 'block', owner: 'console', title: 'No code clash with main', description: 'Builds, union and generated files are resolved by the lander; a code conflict files a fix and the PR waits for it.', settings: { autoResolve: ['builds', 'union', 'union-json', 'generated'], fileFix: true }, source: 'land-core.planConflicts / classifyPath' },
  // Brett (Nov 16 2026): "We need the auto lander to bang shit out on its own. It needs to automatically fix it. We need a server
  // rule to do that. Make the server do it automatically without the console." The policy the VPS runner obeys with or
  // without the console; its settings are auto-lander-policy@1 (the same defaults as auto-lander.mjs POLICY_DEFAULTS).
  { id: 'auto-lander', kind: 'custom', enabled: true, severity: 'info', owner: 'console', title: 'Auto-lander fixes and lands', description: 'The server fixes and lands every PR on its own: a clash merges main in, red CI starts a fix session, green lands. After maxAttempts failures of one kind the build escalates to a systems check banner item. Enforced server-side; the console only shows it.', settings: { ...AUTO_LANDER_SETTINGS }, source: 'config.json autoLander.enabled, autoLander.maxAttempts, autoLander.backoffMin, autoLander.fix (new keys); autoLand / autoMerge stay the merge queue mode flags' },
]);

/** The default rule set document. */
export function defaultRuleSet({ at = new Date().toISOString(), owner = 'console' } = {}) {
  return normRuleSet({ $axf: SET_FRAME, rev: 1, at, rules: DEFAULT_RULES.map((r) => ({ ...r, owner, settings: JSON.parse(JSON.stringify(r.settings)) })) }, at);
}

/**
 * A saved rule set with every default rule it lacks appended (by id), so a rule added later (auto-lander, Nov 16 2026) joins
 * a store written before it existed. Nothing in the saved set changes; the set is returned as is when nothing is missing.
 */
export function joinDefaults(set, { at = new Date().toISOString() } = {}) {
  const s = normRuleSet(set, at);
  const have = new Set(s.rules.map((r) => r.id));
  const missing = defaultRuleSet({ at }).rules.filter((r) => !have.has(r.id)).map((r) => ({ ...r, updatedAt: at, updatedBy: 'defaults' }));
  return missing.length ? { ...s, rules: [...s.rules, ...missing].slice(0, RULES_MAX), joinedDefaults: missing.map((r) => r.id) } : s;
}

// ------------------------------------------------------------------ migration from today's lander settings

/** The lander settings today's push banner config.json carries, read the way land.mjs reads them. */
export function landerSettingsFrom(config = {}) {
  const c = obj(config); const a = obj(c.autoLander);
  const queueMode = ['batch', 'stack'].includes(c.queueMode) ? c.queueMode : 'batch';
  // the merge queue's shapes only while its switch is on (Nov 15 2026: off by default = one at a time)
  const mode = a.mode === 'serial' ? 'serial' : a.mode === 'merge-queue' || c.mergeQueue === true ? queueMode : 'serial';
  return {
    enabled: typeof a.enabled === 'boolean' ? a.enabled : c.mergeQueue !== false, mode, autoLand: c.autoLand === true, waitUi: c.landWaitUi !== false,
    depth: Number.isInteger(c.queueDepth) ? Math.min(6, Math.max(1, c.queueDepth)) : 3, batchSize: Number.isInteger(c.batchSize) ? Math.min(20, Math.max(1, c.batchSize)) : 8,
  };
}

/** The config.json keys the migration reads. */
export const MIGRATED_KEYS = Object.freeze(['autoLand', 'landWaitUi', 'mergeQueue', 'queueMode', 'queueDepth', 'batchSize', 'autoLander.enabled', 'autoLander.mode', 'autoLander.maxAttempts', 'autoLander.backoffMin', 'autoLander.fix']);

/**
 * Today's push banner config.json → a gate-rule-set@1: the default set with `enabled` and `settings` taken from the keys
 * the lander reads now. Nothing is dropped: the lander's On/Off and mode live on in lander-state@1 (landerSettingsFrom),
 * and the keys stay in config.json until the gate plugin's store is the one writer.
 */
export function migrate(config = {}, { at = new Date().toISOString(), by = 'migration' } = {}) {
  const c = obj(config); const a = obj(c.autoLander);
  const l = landerSettingsFrom(c);
  const present = MIGRATED_KEYS.filter((k) => (k.startsWith('autoLander.') ? a[k.slice(11)] !== undefined : c[k] !== undefined));
  const set = defaultRuleSet({ at });
  for (const r of set.rules) {
    if (r.id === 'merge-queue-only') r.settings = { ...r.settings, mode: l.mode, autoLand: l.autoLand, depth: l.depth, batchSize: l.batchSize };
    if (r.id === 'ci-green') r.settings = { ...r.settings, on: l.mode === 'serial' ? 'head' : 'queue-commit', redJoins: l.mode === 'batch' };
    if (r.id === 'ui-review') r.enabled = l.waitUi;
    if (r.id === 'auto-lander') {
      // the lander's own switch is the rule's switch; the old mode flags (autoLand, autoMerge) never turn fixing off
      if (a.enabled === false) r.enabled = false;
      const maxAttempts = Number.isInteger(a.maxAttempts) ? Math.min(10, Math.max(1, a.maxAttempts)) : r.settings.maxAttempts;
      const baseMin = typeof a.backoffMin === 'number' && a.backoffMin > 0 ? a.backoffMin : r.settings.backoff.baseMin;
      r.settings = { ...r.settings, maxAttempts, backoff: { ...r.settings.backoff, baseMin }, fixSessions: a.fix === false ? false : r.settings.fixSessions };
    }
    if (present.length) { r.updatedAt = at; r.updatedBy = by; }
  }
  return { ...set, updatedBy: by, migratedFrom: { frame: 'push-banner-config@1', at, keys: present } };
}

// ------------------------------------------------------------------ evaluate one PR

export const VERDICT_FRAME = 'gate-verdict@1';
/** pass = fine; fail = needs a fix (code, review changes); hold = waits for something that resolves by itself; skip = off or another side runs it. */
export const VERDICTS = Object.freeze(['pass', 'fail', 'hold', 'skip']);
export const CI_STATES = Object.freeze(['success', 'failure', 'running', 'none']);
export const UI_STATES = Object.freeze(['', 'waiting', 'changes', 'rejected', 'unknown']);
export const CHECK_RESULTS = Object.freeze(['pass', 'fail', 'none']);

/**
 * What the lander knows about one PR (pr-snapshot@1), normalised:
 *   { number, title, build, branch, head, draft, fork, ci, failing: [check names], checks: { theme, controls, toolbars,
 *     tests: pass|fail|none }, ui, conflicts: [code files], dataConflicts: [files resolved by itself], tests, landHeld,
 *     removed, kicked, mergeVia: queue|direct|'' }
 */
export function normSnapshot(s) {
  const x = obj(s); const ch = obj(x.checks);
  const chk = (k) => oneOf(CHECK_RESULTS, ch[k], 'none');
  return {
    number: pr(x.number), title: str(x.title, 200), build: str(x.build, 120), branch: str(x.branch, 200), head: str(x.head, 64), draft: bool(x.draft), fork: bool(x.fork),
    ci: oneOf(CI_STATES, x.ci, 'none'), failing: (Array.isArray(x.failing) ? x.failing : []).map((f) => str(f, 120)).filter(Boolean).slice(0, 20),
    checks: { theme: chk('theme'), controls: chk('controls'), toolbars: chk('toolbars'), tests: chk('tests') },
    ui: oneOf(UI_STATES, x.ui, ''), conflicts: (Array.isArray(x.conflicts) ? x.conflicts : []).map((f) => str(f, 200)).filter(Boolean).slice(0, 40),
    dataConflicts: (Array.isArray(x.dataConflicts) ? x.dataConflicts : []).map((f) => str(f, 200)).filter(Boolean).slice(0, 40),
    landHeld: str(x.landHeld, 200), removed: str(x.removed, 200), kicked: str(x.kicked, TEXT_MAX), mergeVia: oneOf(['queue', 'direct', ''], x.mergeVia, ''),
  };
}

const names = (list) => (list.length ? ` (${list.slice(0, 3).join(', ')}${list.length > 3 ? ', …' : ''})` : '');
/** A named CI check's result: the snapshot's own answer, else the failing list, else what the whole run says. */
function namedCheck(s, key, re) {
  if (s.checks[key] !== 'none') return s.checks[key];
  if (s.failing.some((f) => re.test(f))) return 'fail';
  if (s.ci === 'success') return 'pass';
  if (s.ci === 'failure') return 'none'; // red for another reason: this check has no verdict of its own
  return 'none';
}
const V = (verdict, reason, extra = {}) => ({ verdict, reason, ...extra });

/** One rule against one snapshot: { verdict, reason, agent? }. */
export function evaluateRule(rule, snapshot) {
  const r = normRule(rule); const s = normSnapshot(snapshot); const st = r.settings;
  switch (r.kind) {
    case 'ci': {
      if (s.ci === 'success') return V('pass', 'CI is green on its head.');
      if (s.ci === 'failure') return st.redJoins === true ? V('hold', `its PR checks are red${names(s.failing)}; it joins behind the green ones and the queue run decides.`) : V('fail', `CI is red${names(s.failing)}. Needs a code fix.`, { agent: true });
      if (s.ci === 'running') return V('hold', 'CI is running on its head.');
      return V('hold', 'CI has not run on its head yet.');
    }
    case 'tests': {
      const t = namedCheck(s, 'tests', /test|fixture|conformance/i);
      return t === 'pass' ? V('pass', 'The tests pass.') : t === 'fail' ? V('fail', 'The tests fail after regeneration. Needs a code fix.', { agent: true }) : V('hold', 'The tests have not run on its head yet.');
    }
    case 'theme': {
      const t = namedCheck(s, 'theme', /theme/i);
      return t === 'pass' ? V('pass', 'check-theme passes.') : t === 'fail' ? V('fail', 'check-theme fails: a colour, size, spacing, font, radius or border is a literal, not a token.', { agent: true }) : V('hold', 'check-theme has not run on its head yet.');
    }
    case 'controls': {
      const toolbars = /toolbars/.test(str(st.check, 200));
      const t = namedCheck(s, toolbars ? 'toolbars' : 'controls', toolbars ? /toolbar/i : /control/i);
      const name = toolbars ? 'check-toolbars' : 'check-controls';
      return t === 'pass' ? V('pass', `${name} passes.`) : t === 'fail' ? V('fail', toolbars ? 'check-toolbars fails: a toolbar lacks role="toolbar" or an aria-label, or a tab row is not the TabGroup.' : 'check-controls fails: a raw control is used where a framework control exists.', { agent: true }) : V('hold', `${name} has not run on its head yet.`);
    }
    case 'ui-review': {
      const holdOn = Array.isArray(st.holdOn) ? st.holdOn : ['waiting', 'changes', 'rejected', 'unknown'];
      if (!s.ui || !holdOn.includes(s.ui)) return V('pass', 'UI Review does not hold it.');
      if (s.ui === 'waiting') return V('hold', 'its screenshots are waiting in UI Review. Approve them and it lands by itself.');
      if (s.ui === 'unknown') return V('hold', "UI Review couldn't be read, so it waits.");
      return V('fail', s.ui === 'changes' ? 'UI Review asked for changes.' : 'UI Review rejected it.');
    }
    case 'clash': {
      if (s.conflicts.length) return V('fail', `it conflicts with main in code${names(s.conflicts)}. Needs a code fix${st.fileFix === false ? '' : '; a fix is filed'}.`, { agent: st.fileFix !== false, files: s.conflicts.slice(0, 20) });
      if (s.dataConflicts.length) return V('pass', `its data conflicts resolve by themselves${names(s.dataConflicts)}.`);
      return V('pass', 'It merges cleanly with main.');
    }
    default: {
      if (r.id === 'auto-lander') return V('pass', 'The server fixes and lands it on its own (auto-lander@1).');
      if (r.id === 'merge-queue-only' || st.directMerge === false) {
        if (s.draft) return V('fail', 'it is a draft.');
        if (s.fork) return V('fail', 'it comes from a fork.');
        if (s.mergeVia === 'direct') return V('fail', 'only the lander merges: a direct merge is refused.');
        return V('pass', 'It lands through the lander.');
      }
      return V('pass', `${r.title || r.id}: nothing to check here.`);
    }
  }
}

/**
 * Every rule against one PR snapshot → gate-verdict@1:
 *   { pr, head, pass, held, blockedBy, agent, holds: [by hand], results: [{ id, kind, severity, enabled, verdict, reason }], reasons }
 * `pass` = every enabled block rule passes and nothing holds it by hand; `held` = a block rule says hold (not fail);
 * `blockedBy` = the first block rule that is not pass; `agent` = a code fix is wanted (red CI, failing check, code clash).
 * `owner` limits the run to one side's rules: the other side's come back as skip.
 */
export function evaluate(rules, snapshot, { owner = null, at = new Date().toISOString() } = {}) {
  const list = Array.isArray(rules) ? rules : Array.isArray(rules?.rules) ? rules.rules : [];
  const s = normSnapshot(snapshot);
  const results = list.map((raw) => {
    const r = normRule(raw);
    const base = { id: r.id, kind: r.kind, severity: r.severity, owner: r.owner, enabled: r.enabled };
    if (!r.enabled) return { ...base, verdict: 'skip', reason: 'switched off.' };
    if (owner && r.owner !== owner) return { ...base, verdict: 'skip', reason: `evaluated by ${r.owner}.` };
    return { ...base, ...evaluateRule(r, s) };
  });
  const holds = [];
  if (s.landHeld) holds.push({ kind: 'held', reason: `held by hand (${s.landHeld}). Release it to land it.` });
  if (s.removed) holds.push({ kind: 'removed', reason: `taken out of the queue by hand (${s.removed}).` });
  if (s.kicked) holds.push({ kind: 'kicked', reason: `kicked out: ${s.kicked} Push a fix and it rejoins by itself.` });
  const blocking = results.filter((x) => x.severity === 'block' && x.verdict !== 'pass' && x.verdict !== 'skip');
  // the headline: a rule that needs a fix comes before one that only waits (a conflicting PR gets no CI run, so the clash is the reason, not the missing run)
  const first = blocking.find((x) => x.verdict === 'fail') || blocking[0] || null;
  const pass = !first && !holds.length;
  return {
    $axf: VERDICT_FRAME, at, pr: s.number, head: s.head, pass, held: !pass && (!first || first.verdict === 'hold') && !blocking.some((x) => x.verdict === 'fail'),
    blockedBy: first ? first.id : holds.length ? `hand:${holds[0].kind}` : '', agent: results.some((x) => x.agent === true && x.severity === 'block'),
    holds, results, reasons: [...holds.map((h) => h.reason), ...results.filter((x) => x.verdict === 'fail' || x.verdict === 'hold').map((x) => `${x.id}: ${x.reason}`)],
    warnings: results.filter((x) => x.severity === 'warn' && x.verdict === 'fail').map((x) => `${x.id}: ${x.reason}`),
  };
}

// ------------------------------------------------------------------ lander-state@1 from today's lander files

/** The rule id a merge queue `why` line maps onto ('' = a hold by hand or a queue state). */
export function ruleForWhy(why) {
  const w = str(why, TEXT_MAX);
  if (!w) return '';
  if (/ui review/i.test(w)) return 'ui-review';
  if (/conflicts? (with|in) (main|code)/i.test(w)) return 'clash';
  if (/checks? (are|is) red|CI is red|broke CI|its batch went red/i.test(w)) return 'ci-green';
  if (/checks? (have not run|are still running|has not run)|CI is running/i.test(w)) return 'ci-green';
  if (/draft|fork/i.test(w)) return 'merge-queue-only';
  if (/couldn't build its queue commit/i.test(w)) return 'clash';
  return '';
}

/**
 * lander-state@1 from what the lander writes today: the push banner config.json, merge-queue@1 (`queue`), its control
 * document, the run records (auto-lander-run@1, oldest first) and an optional pause { why, by, at }.
 */
export function landerStateFrom({ config = {}, queue = {}, control = {}, runs = [], pause = null, at = new Date().toISOString() } = {}) {
  const l = landerSettingsFrom(config);
  const q = obj(queue); const items = Array.isArray(q.items) ? q.items : []; const held = Array.isArray(q.waiting) ? q.waiting : [];
  const removed = obj(obj(control).removed);
  const live = items.find((x) => ['testing', 'passed', 'merging'].includes(x.state)) || null;
  const last = runs.length ? normRun(runs[runs.length - 1]) : null;
  const paused = !!(pause && typeof pause === 'object');
  const status = !l.enabled ? 'off' : paused ? 'paused' : last?.result === 'error' ? 'error' : live ? 'running' : 'idle';
  const waiting = [
    ...items.filter((x) => pr(x.pr) && x !== live).map((x) => ({ pr: x.pr, title: x.title, build: x.build, branch: x.branch, head: x.head, url: x.url, state: removed[x.pr] ? 'skipped' : 'waiting', rule: ruleForWhy(x.why), reason: str(x.why, TEXT_MAX) || 'waits its turn in the line.', since: x.since })),
    ...held.filter((x) => pr(x.pr)).map((x) => ({ pr: x.pr, title: x.title, build: x.build, branch: x.branch, head: x.head, url: x.url, state: x.state === 'kicked' ? 'kicked' : 'held', rule: ruleForWhy(x.why), reason: str(x.why, TEXT_MAX) || 'held.', since: x.since })),
  ].map((w, i) => normWaiting({ ...w, position: i + 1 }, i));
  return normLanderState({
    at, status, enabled: l.enabled, paused, pause: paused ? pause : null, mode: l.mode, source: 'merge-queue@1',
    landing: live ? { pr: live.pr, title: live.title, build: live.build, branch: live.branch, ci: live.ci, since: live.startedAt || q.at, runUrl: live.runUrl } : null,
    lastRuns: runs, waiting, landedRecently: (Array.isArray(q.merged) ? q.merged : []).map((m) => m?.pr).filter(pr).slice(-20), ...(last?.error ? { error: last.error } : {}),
  }, at);
}
