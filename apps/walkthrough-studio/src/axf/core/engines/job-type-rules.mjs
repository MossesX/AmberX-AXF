/**
 * job-type rules — job-type@1 (Brett, Nov 1 2026: "hire agents to run that kind of stuff instead of spinning up
 * anonymous one-off builds"). A job type is a recurring kind of work (walkthrough videos, site checks, screenshots,
 * landing builds, banner cleanup, listener QA) kept as an asset in the asset@1 envelope. It names the specialty that
 * owns it (an agent's skill id in the swarm roster), the default model, the token budget per run, what triggers it
 * (on demand, a schedule, an event), the brief template the agent gets, and where its outputs go (report path, UI
 * Review group name).
 *
 * ONE registry (JOB_ENUMS, JOB_DEFAULTS, JOB_BUILTINS) drives both validators (core/validate.ts and the build engine),
 * the normalizer, the brief renderer and the scheduler every driver uses (framework/cli/agent-job.mjs, the console).
 * Pure, no I/O. Unknown fields are dropped (open registry: later job types add enum words and fields here, never a
 * new type).
 */

import { ALLOWED_MODELS, DEFAULT_MODEL, coerceModel, modelAllowed, modelProblem } from '../model-policy.mjs';

export const JOB_TYPE = 'job-type';

/** Models come from the model policy (model-policy.mjs: Opus or Fable only, never Sonnet; Brett, Nov 1 2026). */
export const JOB_ENUMS = {
  model: [...ALLOWED_MODELS],
  trigger: ['on-demand', 'schedule', 'event'],
};

/** Placeholders every brief and output template may use without declaring them as inputs. */
export const JOB_BUILTINS = ['date', 'when', 'stamp', 'agent', 'agentName', 'jobType', 'jobName', 'runId', 'report', 'group'];

export const JOB_LIMITS = { brief: 4000, inputs: 12, tools: 30, tokensMin: 1000, tokensMax: 10_000_000, turnsMax: 200, usdMax: 1000 };

export const JOB_DEFAULTS = {
  specialty: '',
  model: DEFAULT_MODEL,
  budget: { tokens: 200000, maxTurns: 30, usd: 0 },
  trigger: { kind: 'on-demand', every: '', at: '', event: '' },
  readOnly: false,
  tools: [],
  inputs: [],
  brief: '',
  command: '',
  outputs: { report: '_claude/builds/reports/jobs/{{jobType}}/{{stamp}}.md', uiReviewGroup: '', uiReviewApp: '' },
};

const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const EVERY = /^(\d{1,4})(m|h|d)$/;
const AT = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Placeholder names a template uses. */
export function placeholders(tpl) { return [...new Set([...str(tpl, 20000).matchAll(PLACEHOLDER)].map((m) => m[1]))]; }

/** A relative path inside the repo: no leading slash, no `..`, no backslashes. */
const safePath = (p) => typeof p === 'string' && p.length > 0 && p.length <= 300 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..');

/** Validation messages for a job-type asset's data (empty for other types). Same messages in both validators. */
export function jobTypeErrors(type, raw) {
  if (type !== JOB_TYPE) return [];
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (!SLUG.test(raw.specialty ?? '')) e.push('data.specialty is the owning agent skill id (lowercase letters, digits and dashes)');
  if (raw.model !== undefined && !modelAllowed(raw.model)) e.push(`data.${modelProblem(raw.model)}`);
  const b = raw.budget;
  if (!isObj(b)) e.push('data.budget must be { tokens, maxTurns, usd? }');
  else {
    if (!Number.isInteger(b.tokens) || b.tokens < JOB_LIMITS.tokensMin || b.tokens > JOB_LIMITS.tokensMax) e.push(`data.budget.tokens must be a whole number from ${JOB_LIMITS.tokensMin} to ${JOB_LIMITS.tokensMax}`);
    if (b.maxTurns !== undefined && (!Number.isInteger(b.maxTurns) || b.maxTurns < 1 || b.maxTurns > JOB_LIMITS.turnsMax)) e.push(`data.budget.maxTurns must be 1 to ${JOB_LIMITS.turnsMax}`);
    if (b.usd !== undefined && (typeof b.usd !== 'number' || b.usd < 0 || b.usd > JOB_LIMITS.usdMax)) e.push(`data.budget.usd must be 0 to ${JOB_LIMITS.usdMax}`);
  }
  const t = raw.trigger;
  if (!isObj(t) || !JOB_ENUMS.trigger.includes(t.kind)) e.push(`data.trigger.kind must be one of ${JOB_ENUMS.trigger.join(', ')}`);
  else if (t.kind === 'schedule' && !EVERY.test(t.every ?? '') && !AT.test(t.at ?? '')) e.push('a scheduled job needs data.trigger.every ("30m", "6h", "1d") or data.trigger.at ("HH:MM" UTC)');
  else if (t.kind === 'event' && !/^[a-z][a-z0-9.:-]{1,60}$/.test(t.event ?? '')) e.push('an event job needs data.trigger.event (e.g. "build.landed")');
  if (typeof raw.brief !== 'string' || !raw.brief.trim()) e.push('data.brief is the brief template (text with {{placeholders}})');
  else if (raw.brief.length > JOB_LIMITS.brief) e.push(`data.brief is longer than ${JOB_LIMITS.brief} characters (agents get only the brief: keep it short)`);
  const ids = new Set();
  if (raw.inputs !== undefined) {
    if (!Array.isArray(raw.inputs) || raw.inputs.length > JOB_LIMITS.inputs) e.push(`data.inputs must be a list of up to ${JOB_LIMITS.inputs} { id, label, required?, default? }`);
    else for (const i of raw.inputs) {
      if (!isObj(i) || !/^[a-z][a-zA-Z0-9]{0,29}$/.test(i.id ?? '')) { e.push('every input needs an id (camelCase letters and digits)'); continue; }
      if (ids.has(i.id) || JOB_BUILTINS.includes(i.id)) e.push(`input "${i.id}" is declared twice or shadows a built-in`);
      ids.add(i.id);
    }
  }
  for (const p of placeholders(raw.brief)) if (!ids.has(p) && !JOB_BUILTINS.includes(p)) e.push(`data.brief uses {{${p}}}, which is neither an input nor a built-in`);
  if (raw.tools !== undefined && (!Array.isArray(raw.tools) || raw.tools.length > JOB_LIMITS.tools || raw.tools.some((x) => typeof x !== 'string' || !x))) e.push(`data.tools must be up to ${JOB_LIMITS.tools} tool names`);
  if (raw.readOnly !== undefined && typeof raw.readOnly !== 'boolean') e.push('data.readOnly must be true or false');
  if (raw.command !== undefined && typeof raw.command !== 'string') e.push('data.command must be a string');
  const o = raw.outputs;
  if (o !== undefined) {
    if (!isObj(o)) e.push('data.outputs must be { report?, uiReviewGroup?, uiReviewApp? }');
    else {
      if (o.report !== undefined && !safePath(o.report)) e.push('data.outputs.report must be a path inside the repo');
      // UI Review rule (Nov 1 2026): every screenshot group is named and timestamped
      if (o.uiReviewGroup && !placeholders(o.uiReviewGroup).some((p) => p === 'when' || p === 'date' || p === 'stamp')) e.push('data.outputs.uiReviewGroup must carry a timestamp ({{when}}, {{date}} or {{stamp}})');
    }
  }
  return e;
}

/** Fill defaults and drop unknown fields (data only; never throws). */
export function normalizeJobType(raw) {
  const o = isObj(raw) ? raw : {};
  const b = isObj(o.budget) ? o.budget : {}; const t = isObj(o.trigger) ? o.trigger : {}; const out = isObj(o.outputs) ? o.outputs : {};
  const D = JOB_DEFAULTS;
  return {
    specialty: SLUG.test(o.specialty ?? '') ? o.specialty : D.specialty,
    model: coerceModel(o.model, D.model), // a stored sonnet/haiku job runs as opus: the policy, not the file, decides
    budget: {
      tokens: Number.isInteger(b.tokens) ? Math.min(JOB_LIMITS.tokensMax, Math.max(JOB_LIMITS.tokensMin, b.tokens)) : D.budget.tokens,
      maxTurns: Number.isInteger(b.maxTurns) ? Math.min(JOB_LIMITS.turnsMax, Math.max(1, b.maxTurns)) : D.budget.maxTurns,
      usd: typeof b.usd === 'number' && b.usd >= 0 ? Math.min(JOB_LIMITS.usdMax, b.usd) : D.budget.usd,
    },
    trigger: { kind: JOB_ENUMS.trigger.includes(t.kind) ? t.kind : D.trigger.kind, every: EVERY.test(t.every ?? '') ? t.every : '', at: AT.test(t.at ?? '') ? t.at : '', event: str(t.event, 60) },
    readOnly: o.readOnly === true,
    tools: Array.isArray(o.tools) ? o.tools.filter((x) => typeof x === 'string' && x).slice(0, JOB_LIMITS.tools) : [],
    inputs: (Array.isArray(o.inputs) ? o.inputs : []).filter((i) => isObj(i) && /^[a-z][a-zA-Z0-9]{0,29}$/.test(i.id ?? '')).slice(0, JOB_LIMITS.inputs)
      .map((i) => ({ id: i.id, label: str(i.label, 80) || i.id, required: i.required === true, default: str(i.default, 400), about: str(i.about, 200) })),
    brief: str(o.brief, JOB_LIMITS.brief),
    command: str(o.command, 600),
    outputs: { report: safePath(out.report) ? out.report : D.outputs.report, uiReviewGroup: str(out.uiReviewGroup, 120), uiReviewApp: str(out.uiReviewApp, 40) },
  };
}

/** Fill {{placeholders}} from vars; unknown ones become ''. */
export function renderTemplate(tpl, vars = {}) {
  return str(tpl, 20000).replace(PLACEHOLDER, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/**
 * Brett's clock for names and groups ("Nov 1 8:20 PM", UI Review rule). `timeZone` defaults to his (Rhode Island).
 * stamp = a file-safe UTC stamp (2026-11-01-0820).
 */
export function timeWords(at, timeZone = 'America/New_York') {
  const d = new Date(at);
  const when = d.toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '').replace(/ /g, ' ');
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), when, stamp: `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}` };
}

/**
 * Inputs for one run: declared defaults, then the caller's values. Returns { values, missing } (missing = required
 * inputs still empty). Values the type doesn't declare are dropped.
 */
export function jobInputs(data, given = {}) {
  const values = {}; const missing = [];
  for (const i of data.inputs) {
    const v = typeof given[i.id] === 'string' && given[i.id] !== '' ? given[i.id].slice(0, 2000) : i.default;
    values[i.id] = v;
    if (i.required && !v) missing.push(i.id);
  }
  return { values, missing };
}

/**
 * The brief an agent gets for one run: the type's template with inputs and built-ins filled, then where its outputs
 * go. `ctx` = { at, agent, agentName, jobType, jobName, runId }. Returns { text, report, group }.
 */
export function renderJobBrief(data, values, ctx) {
  const t = timeWords(ctx.at, ctx.timeZone);
  const base = { ...t, agent: ctx.agent ?? '', agentName: ctx.agentName ?? '', jobType: ctx.jobType ?? '', jobName: ctx.jobName ?? '', runId: ctx.runId ?? '' };
  const report = renderTemplate(data.outputs.report, base);
  const group = data.outputs.uiReviewGroup ? renderTemplate(data.outputs.uiReviewGroup, base) : '';
  const vars = { ...base, report, group, ...values };
  // a read-only job has no write tools: its final message is the report, and the router saves it
  const lines = [renderTemplate(data.brief, vars).trim(), '', 'OUTPUTS', data.readOnly ? `- Report: put it in full in your final message; it is saved as ${report}` : `- Report: write it to ${report}`];
  if (group) lines.push(`- Screenshots: send them with framework/cli/shot.mjs to UI Review group "${group}"${data.outputs.uiReviewApp ? ` (app ${data.outputs.uiReviewApp})` : ''}`);
  if (data.command) lines.push(`- Command for this job: ${renderTemplate(data.command, vars)}`);
  if (data.readOnly) lines.push('- Read-only job: change nothing anywhere; only report.');
  return { text: lines.join('\n'), report, group };
}

const MS = { m: 60e3, h: 3600e3, d: 864e5 };
/**
 * When a job runs next: '' for on-demand and event jobs. A schedule with `every` runs that long after the last run
 * (at once when it never ran); with `at` it runs at that UTC time every day. A time in the past = due now.
 */
export function nextRun(trigger, lastAt, now) {
  if (!trigger || trigger.kind !== 'schedule') return '';
  const m = EVERY.exec(trigger.every ?? '');
  if (m) return lastAt ? new Date(Date.parse(lastAt) + Number(m[1]) * MS[m[2]]).toISOString() : new Date(now).toISOString();
  const a = AT.exec(trigger.at ?? '');
  if (!a) return '';
  const from = new Date(lastAt || Date.parse(now) - 864e5);
  let next = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), Number(a[1]), Number(a[2]));
  if (next <= from.getTime()) next += 864e5;
  return new Date(next).toISOString();
}
export const isDue = (trigger, lastAt, now) => { const n = nextRun(trigger, lastAt, now); return !!n && n <= new Date(now).toISOString(); };

/** JSON Schema properties for editors (build engine → schemas/json/job-type.schema.json). */
export function jobTypeSchemaProperties() {
  return {
    specialty: { type: 'string', pattern: SLUG.source, description: 'the owning agent skill id (swarm roster)' },
    model: { enum: JOB_ENUMS.model },
    budget: { type: 'object', required: ['tokens'], properties: { tokens: { type: 'integer', minimum: JOB_LIMITS.tokensMin, maximum: JOB_LIMITS.tokensMax }, maxTurns: { type: 'integer', minimum: 1, maximum: JOB_LIMITS.turnsMax }, usd: { type: 'number', minimum: 0 } } },
    trigger: { type: 'object', required: ['kind'], properties: { kind: { enum: JOB_ENUMS.trigger }, every: { type: 'string', pattern: EVERY.source }, at: { type: 'string', pattern: AT.source }, event: { type: 'string' } } },
    readOnly: { type: 'boolean' },
    tools: { type: 'array', items: { type: 'string' }, maxItems: JOB_LIMITS.tools },
    inputs: { type: 'array', maxItems: JOB_LIMITS.inputs, items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, label: { type: 'string' }, required: { type: 'boolean' }, default: { type: 'string' }, about: { type: 'string' } } } },
    brief: { type: 'string', maxLength: JOB_LIMITS.brief },
    command: { type: 'string' },
    outputs: { type: 'object', properties: { report: { type: 'string' }, uiReviewGroup: { type: 'string' }, uiReviewApp: { type: 'string' } } },
  };
}
