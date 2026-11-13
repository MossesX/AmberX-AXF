/**
 * prompt-engine@1 — the general prompting / rules engine (Brett, Nov 13 2026: "a general prompting engine which will
 * run set tools and maybe some macros or pipelines").
 *
 * Pure and dependency-free: no Node APIs, no IO, no clock of its own (every function takes `now`). The Prompt engine
 * console plugin (apps/console-web/plugins/prompt-engine) stores rules and runs actions; this file decides.
 *
 * Records:
 *   prompt-manifest@1   what a source (plugin, app, tool, service) registers: its events (with fields), actions (with
 *                       inputs) and connectors. Built-in manifests cover builds (build-hook@1), UI Review, approvals,
 *                       schedules, voice, webhooks, the watchdog, the merge queue and custom events.
 *   prompt-event@1      a rule: trigger (source + event + equality filter) → conditions (all / any / not groups over the
 *                       event's fields: eq, ne, in, contains, matches, gt … exists) → limits (cooldown, dedupe, per hour)
 *                       → what to ask Brett (approve / veto countdown / pick / text / nothing) → actions per answer.
 *   prompt-macro@1      a saved sequence of actions with parameters.
 *   prompt-pipeline@1   ordered stages of actions; a stage may carry a gate (a prompt Brett answers before it goes on).
 *   prompt-instance@1   one prompt waiting for (or holding) Brett's answer; resumes a pipeline when it was a gate.
 *   prompt-audit@1      one line of history: fired, skipped (and why), asked, answered, expired, planned, ran, failed, dry-run.
 *
 * Actions are ids from the registry (`tool.run`, `console.command`, `macro.run`, `pipeline.run`, `event.fire`,
 * `build.create` … `notify.call`, `prompt.ask`) with a templated input (`{{build.id}}` reads the event). `plan` expands
 * macros and pipelines into flat steps the runner executes, stops at a gate, and lists the connectors that are missing
 * (a `keys needed` item), so nothing runs that cannot.
 */

export const SCHEMA = 'prompt-engine@1';
export const VERSION = 1;
export const RULE = 'prompt-event@1';
export const MACRO = 'prompt-macro@1';
export const PIPELINE = 'prompt-pipeline@1';
export const MANIFEST = 'prompt-manifest@1';
export const INSTANCE = 'prompt-instance@1';
export const AUDIT = 'prompt-audit@1';

export const ASK_KINDS = ['none', 'approve', 'veto', 'pick', 'text'];
export const OUTPUTS = ['dialog', 'push', 'email', 'sms', 'call'];
/** Outputs that go through an axHub connector; missing one = a keys-needed item, never a silent drop. */
export const CONNECTOR_OUTPUTS = ['email', 'sms', 'call'];
export const ANSWERS = ['approve', 'deny', 'pick', 'text', 'timeout', 'later'];
export const INSTANCE_STATUSES = ['waiting', 'answered', 'expired', 'shelved', 'ran', 'failed'];
export const AUDIT_KINDS = ['fired', 'skipped', 'asked', 'answered', 'expired', 'shelved', 'planned', 'ran', 'failed', 'dry-run', 'rule', 'macro', 'pipeline', 'keys-needed'];
export const SKIP_REASONS = ['disabled', 'no-match', 'filter', 'conditions', 'cooldown', 'dedupe', 'rate'];
export const OPS = ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'matches', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing', 'truthy', 'falsy'];
export const EFFECTS = ['read', 'write', 'destructive', 'navigate', 'ask'];
export const SOURCE_KINDS = ['app', 'plugin', 'tool', 'service', 'framework'];
export const FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'list', 'build', 'plugin', 'macro', 'pipeline', 'rule', 'command', 'address', 'duration', 'cron', 'text'];
export const DEFAULT_VETO_SEC = 90;
export const MAX_DEPTH = 8;
export const MAX_STEPS = 200;
export const MAX_OPTIONS = 12;
export const MAX_TEXT = 4000;
export const ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,79}$';
const ID_RE = new RegExp(ID_PATTERN);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const uniq = (xs) => [...new Set(xs)];

/** A clean id from a title or raw id: lower-case, dots / dashes, 80 chars. */
export function slug(v) {
  const s = str(v, 120).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 80);
  return ID_RE.test(s) ? s : '';
}

export function iso(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v !== 'string' || !v.trim()) return '';
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
const ms = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : NaN; };

/* ------------------------------------------------------------------ paths + templates */

/** `a.b.0.c` into an object; '' / '.' = the object itself. */
export function getPath(obj, path) {
  const p = str(path, 200);
  if (!p || p === '.') return obj;
  let cur = obj;
  for (const k of p.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(k) ? cur[Number(k)] : isObj(cur) || Array.isArray(cur) ? cur[k] : undefined;
  }
  return cur;
}

const show = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** `{{path}}` and `{{path|upper}}`, `{{path|lower}}`, `{{path|json}}`, `{{path|or:text}}` from the context. Unknown = ''. */
export function render(template, ctx) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*([^}|\s]+)\s*(?:\|\s*([a-z]+)(?::([^}]*))?)?\s*\}\}/g, (_, path, fn, arg) => {
    const v = getPath(ctx, path);
    if (fn === 'or') return v === undefined || v === null || v === '' ? String(arg ?? '') : show(v);
    if (fn === 'upper') return show(v).toUpperCase();
    if (fn === 'lower') return show(v).toLowerCase();
    if (fn === 'json') return JSON.stringify(v ?? null);
    return show(v);
  });
}
/** Every string in a value rendered; a string that is exactly one `{{path}}` keeps the value's type (numbers, objects). */
export function renderDeep(value, ctx, depth = 0) {
  if (depth > 20) return value;
  if (typeof value === 'string') {
    const m = /^\{\{\s*([^}|\s]+)\s*\}\}$/.exec(value);
    if (m) { const v = getPath(ctx, m[1]); return v === undefined ? '' : v; }
    return render(value, ctx);
  }
  if (Array.isArray(value)) return value.map((x) => renderDeep(x, ctx, depth + 1));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, renderDeep(x, ctx, depth + 1)]));
  return value;
}

/* ------------------------------------------------------------------ conditions */

const cmpNum = (a, b) => { const x = Number(a); const y = Number(b); return Number.isFinite(x) && Number.isFinite(y) ? x - y : NaN; };
/** One leaf: `{ field, op, value }` against a context. Unknown ops are false. */
export function testCondition(cond, ctx) {
  if (!isObj(cond)) return false;
  if ('all' in cond || 'any' in cond || 'not' in cond) return evalGroup(cond, ctx);
  const v = getPath(ctx, cond.field);
  const w = cond.value;
  switch (cond.op) {
    case 'eq': return Array.isArray(v) ? v.some((x) => show(x) === show(w)) : show(v) === show(w);
    case 'ne': return show(v) !== show(w);
    case 'in': return arr(w).some((x) => show(x) === show(v));
    case 'nin': return !arr(w).some((x) => show(x) === show(v));
    case 'contains': return Array.isArray(v) ? v.some((x) => show(x) === show(w)) : show(v).toLowerCase().includes(show(w).toLowerCase());
    case 'startsWith': return show(v).toLowerCase().startsWith(show(w).toLowerCase());
    case 'endsWith': return show(v).toLowerCase().endsWith(show(w).toLowerCase());
    case 'matches': try { return new RegExp(String(w), 'i').test(show(v)); } catch { return false; }
    case 'gt': return cmpNum(v, w) > 0;
    case 'gte': return cmpNum(v, w) >= 0;
    case 'lt': return cmpNum(v, w) < 0;
    case 'lte': return cmpNum(v, w) <= 0;
    case 'exists': return v !== undefined && v !== null && v !== '';
    case 'missing': return v === undefined || v === null || v === '';
    case 'truthy': return Boolean(v) && v !== '0' && v !== 'false';
    case 'falsy': return !v || v === '0' || v === 'false';
    default: return false;
  }
}
/** `{ all: [...] }` (AND), `{ any: [...] }` (OR), `{ not: c }`; nested freely. Null / empty = true. */
export function evalGroup(group, ctx, depth = 0) {
  if (!group || depth > MAX_DEPTH) return true;
  if (Array.isArray(group)) return group.every((c) => testCondition(c, ctx));
  if (!isObj(group)) return true;
  if ('not' in group) return !evalGroup(group.not, ctx, depth + 1);
  if (Array.isArray(group.all)) return group.all.every((c) => (isObj(c) && ('all' in c || 'any' in c || 'not' in c) ? evalGroup(c, ctx, depth + 1) : testCondition(c, ctx)));
  if (Array.isArray(group.any)) return group.any.length === 0 || group.any.some((c) => (isObj(c) && ('all' in c || 'any' in c || 'not' in c) ? evalGroup(c, ctx, depth + 1) : testCondition(c, ctx)));
  if ('field' in group) return testCondition(group, ctx);
  return true;
}
function normCond(c, depth = 0) {
  if (!isObj(c) || depth > MAX_DEPTH) return null;
  if ('not' in c) { const n = normCond(c.not, depth + 1); return n ? { not: n } : null; }
  if (Array.isArray(c.all)) return { all: c.all.map((x) => normCond(x, depth + 1)).filter(Boolean) };
  if (Array.isArray(c.any)) return { any: c.any.map((x) => normCond(x, depth + 1)).filter(Boolean) };
  const field = str(c.field, 200); const op = OPS.includes(c.op) ? c.op : '';
  if (!field || !op) return null;
  const out = { field, op };
  if (!['exists', 'missing', 'truthy', 'falsy'].includes(op)) out.value = c.value === undefined ? '' : c.value;
  return out;
}
function condErrors(c, path, out, depth = 0) {
  if (c === null || c === undefined) return;
  if (depth > MAX_DEPTH) { out.push({ field: path, message: `conditions nest deeper than ${MAX_DEPTH}` }); return; }
  if (!isObj(c)) { out.push({ field: path, message: 'a condition is an object' }); return; }
  if ('not' in c) return condErrors(c.not, `${path}.not`, out, depth + 1);
  if ('all' in c || 'any' in c) {
    const k = 'all' in c ? 'all' : 'any';
    if (!Array.isArray(c[k])) out.push({ field: `${path}.${k}`, message: `${k} is a list of conditions` });
    else c[k].forEach((x, i) => condErrors(x, `${path}.${k}.${i}`, out, depth + 1));
    return;
  }
  if (!str(c.field)) out.push({ field: `${path}.field`, message: 'a condition names a field (a path into the event, e.g. build.status)' });
  if (!OPS.includes(c.op)) out.push({ field: `${path}.op`, message: `op is one of ${OPS.join(', ')}` });
  if (['gt', 'gte', 'lt', 'lte'].includes(c.op) && !Number.isFinite(Number(c.value))) out.push({ field: `${path}.value`, message: `${c.op} needs a number (a threshold)` });
  if (c.op === 'matches') { try { new RegExp(String(c.value ?? '')); } catch { out.push({ field: `${path}.value`, message: 'matches needs a valid regular expression' }); } }
}

/** Field errors as one sentence (what the API and the CLI say when a record is refused). */
export function rejectionText(errors) {
  const xs = arr(errors).filter((e) => isObj(e) && e.message);
  if (!xs.length) return '';
  return xs.slice(0, 6).map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join('; ') + (xs.length > 6 ? `; and ${xs.length - 6} more` : '');
}

/* ------------------------------------------------------------------ manifests + registry */

const F = (name, type, title, extra = {}) => ({ name, type, title, ...extra });
const BUILD_FIELDS = [
  F('build.id', 'build', 'Build id'), F('build.title', 'string', 'Build title'), F('build.status', 'enum', 'Build status', { enum: ['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built', 'complete', 'archived'] }),
  F('build.priority', 'enum', 'Priority', { enum: ['P0', 'P1', 'P2', 'P3'] }), F('build.repo', 'enum', 'Repo', { enum: ['amberx-axf', 'axhub'] }), F('build.branch', 'string', 'Branch'), F('build.pr', 'number', 'PR number'),
  F('build.profile', 'string', 'Profile / project'), F('build.steps.total', 'number', 'Steps'), F('build.steps.done', 'number', 'Steps done'), F('by', 'string', 'Who wrote the store'),
];
const A = (id, title, effect, input, extra = {}) => ({ id, title, effect, input, ...extra });

/** The manifests the engine always has (every other source registers its own prompt-manifest@1). */
export const BUILTIN_MANIFESTS = Object.freeze([
  {
    $axf: MANIFEST, source: 'builds', title: 'Builds', kind: 'framework', group: 'Builds', description: 'build-hook@1: every builds store change (any creator) as an event.',
    events: [
      { id: 'build.created', title: 'Build created', fields: [...BUILD_FIELDS, F('origin.said', 'text', "Brett's words")] },
      { id: 'build.steps-added', title: 'Steps added to a build', fields: [...BUILD_FIELDS, F('steps.added', 'number', 'Steps added')] },
      { id: 'build.step-done', title: 'A step finished', fields: [...BUILD_FIELDS, F('step.id', 'string', 'Step id'), F('step.title', 'string', 'Step title'), F('step.model', 'enum', 'Step model', { enum: ['Opus', 'Fable'] })] },
      { id: 'build.status', title: 'Build status changed', fields: [...BUILD_FIELDS, F('from', 'string', 'Status before')] },
      { id: 'build.failed', title: 'Build failed', fields: [...BUILD_FIELDS, F('reason', 'text', 'Why')] },
      { id: 'build.blocked', title: 'Build blocked or waiting on Brett', fields: BUILD_FIELDS },
      { id: 'build.pr-opened', title: 'PR opened', fields: BUILD_FIELDS },
      { id: 'build.pr-merged', title: 'PR merged', fields: BUILD_FIELDS },
      { id: 'build.addendum', title: 'Brett added to a build', fields: [...BUILD_FIELDS, F('addendum', 'text', 'What he said')] },
      { id: 'build.cancelled', title: 'Build cancelled', fields: BUILD_FIELDS },
      { id: 'build.restored', title: 'Build restored', fields: BUILD_FIELDS },
      { id: 'build.shipped', title: 'Build shipped (manifest landed)', fields: [...BUILD_FIELDS, F('shipped.id', 'string', 'Manifest id')] },
      { id: 'build.upgrade-requested', title: 'A step asks for a model upgrade', fields: [...BUILD_FIELDS, F('phase', 'string', 'Phase'), F('to', 'enum', 'Model wanted', { enum: ['Fable'] })] },
    ],
    actions: [
      A('build.create', 'Create a build', 'write', [F('title', 'string', 'Title', { required: true }), F('detail', 'text', 'What to build'), F('priority', 'enum', 'Priority', { enum: ['P0', 'P1', 'P2', 'P3'] }), F('queue', 'boolean', 'Queue it right away')]),
      A('build.note', 'Add a note to a build', 'write', [F('build', 'build', 'Build', { required: true }), F('text', 'text', 'Note', { required: true })]),
      A('build.status', 'Set a build status', 'write', [F('build', 'build', 'Build', { required: true }), F('status', 'enum', 'Status', { required: true, enum: ['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built', 'complete'] })]),
      A('build.archive', 'Archive a build', 'destructive', [F('build', 'build', 'Build', { required: true })]),
      A('build.delete', 'Delete a build', 'destructive', [F('build', 'build', 'Build', { required: true })], { confirm: true }),
      A('build.approve-upgrade', 'Approve a model upgrade (Brett only)', 'write', [F('build', 'build', 'Build', { required: true }), F('phase', 'string', 'Phase', { required: true })], { brettOnly: true }),
    ],
  },
  {
    $axf: MANIFEST, source: 'ui-review', title: 'UI Review', kind: 'plugin', group: 'Review', description: 'ui-review-item@1 items and groups.',
    events: [
      { id: 'ui-review.submitted', title: 'Something went to UI Review', fields: [F('item.id', 'string', 'Item id'), F('item.name', 'string', 'Name'), F('item.group', 'string', 'Group'), F('item.app', 'string', 'App'), F('item.screen', 'string', 'Screen'), F('item.build', 'build', 'Build'), F('item.kind', 'string', 'Kind'), F('item.options', 'number', 'Options to pick from'), F('item.shots', 'number', 'Screenshots')] },
      { id: 'ui-review.decided', title: 'A review item was decided', fields: [F('item.id', 'string', 'Item id'), F('item.name', 'string', 'Name'), F('decision', 'enum', 'Decision', { enum: ['approved', 'changes', 'rejected', 'reopened'] }), F('option', 'string', 'Option picked')] },
    ],
    actions: [
      A('ui-review.decide', 'Decide a review item', 'write', [F('item', 'string', 'Item id', { required: true }), F('decision', 'enum', 'Decision', { required: true, enum: ['approve', 'changes', 'reject', 'reopen'] }), F('comment', 'text', 'Comment'), F('option', 'string', 'Option id')]),
    ],
  },
  {
    $axf: MANIFEST, source: 'approvals', title: 'Approvals (axHub)', kind: 'service', group: 'Review', description: 'Held calls and approvals on axHub (veto@1).',
    events: [
      { id: 'approval.held', title: 'A call is held on its countdown', fields: [F('approval.id', 'string', 'Approval id'), F('approval.tool', 'string', 'Tool'), F('approval.summary', 'text', 'What it does'), F('approval.secondsLeft', 'number', 'Seconds left'), F('approval.by', 'string', 'Who asked')] },
      { id: 'approval.waiting', title: 'A call waits for approval', fields: [F('approval.id', 'string', 'Approval id'), F('approval.tool', 'string', 'Tool'), F('approval.summary', 'text', 'What it does'), F('approval.by', 'string', 'Who asked')] },
      { id: 'approval.decided', title: 'An approval was decided', fields: [F('approval.id', 'string', 'Approval id'), F('decision', 'enum', 'Decision', { enum: ['approved', 'denied', 'shelved', 'ran'] })] },
    ],
    actions: [],
  },
  {
    $axf: MANIFEST, source: 'merge-queue', title: 'Merge queue', kind: 'service', group: 'Builds',
    events: [
      { id: 'merge.clash', title: 'Merge clash', fields: [F('pr', 'number', 'PR'), F('build.id', 'build', 'Build'), F('files', 'list', 'Files in conflict'), F('with', 'number', 'Clashing PR')] },
      { id: 'merge.landed', title: 'PR landed on main', fields: [F('pr', 'number', 'PR'), F('build.id', 'build', 'Build'), F('commit', 'string', 'Commit')] },
      { id: 'merge.ci-failed', title: 'CI failed on a PR', fields: [F('pr', 'number', 'PR'), F('build.id', 'build', 'Build'), F('job', 'string', 'Job'), F('url', 'string', 'Run url')] },
    ],
    actions: [],
  },
  {
    $axf: MANIFEST, source: 'watchdog', title: 'Watchdog & health', kind: 'service', group: 'Systems',
    events: [
      { id: 'watchdog.alert', title: 'Watchdog alert', fields: [F('check', 'string', 'Check'), F('severity', 'enum', 'Severity', { enum: ['info', 'warning', 'danger'] }), F('detail', 'text', 'Detail'), F('value', 'number', 'Measured value'), F('threshold', 'number', 'Threshold')] },
      { id: 'health.down', title: 'A service went down', fields: [F('service', 'string', 'Service'), F('since', 'string', 'Down since'), F('detail', 'text', 'Detail')] },
      { id: 'health.up', title: 'A service came back', fields: [F('service', 'string', 'Service'), F('downSec', 'number', 'Seconds down')] },
      { id: 'session.idle', title: 'A build session went idle', fields: [F('session', 'string', 'Session'), F('build.id', 'build', 'Build'), F('idleMin', 'number', 'Minutes idle')] },
      { id: 'keys.needed', title: 'A key or service is missing', fields: [F('what', 'string', 'What is missing'), F('for', 'string', 'Needed by')] },
    ],
    actions: [],
  },
  {
    $axf: MANIFEST, source: 'schedule', title: 'Schedules', kind: 'framework', group: 'Time',
    events: [
      { id: 'schedule.tick', title: 'On a schedule', fields: [F('schedule', 'string', 'Schedule id'), F('every', 'duration', 'Every (e.g. 15m, 1h, 1d)'), F('at', 'string', 'Time of day (HH:MM)'), F('cron', 'cron', 'Cron (optional)'), F('hour', 'number', 'Hour'), F('weekday', 'number', 'Weekday (0 = Sunday)')] },
    ],
    actions: [],
  },
  {
    $axf: MANIFEST, source: 'voice', title: 'Voice (AmberX)', kind: 'app', group: 'Input',
    events: [
      { id: 'voice.phrase', title: 'A spoken phrase', fields: [F('phrase', 'string', 'Phrase'), F('speaker', 'string', 'Speaker'), F('device', 'string', 'Device')] },
    ],
    actions: [A('voice.say', 'Say something (AmberX)', 'write', [F('text', 'text', 'Text', { required: true })])],
  },
  {
    $axf: MANIFEST, source: 'webhook', title: 'Webhooks', kind: 'framework', group: 'Input',
    events: [{ id: 'webhook.received', title: 'A webhook arrived', fields: [F('hook', 'string', 'Hook id'), F('headers', 'object', 'Headers'), F('body', 'object', 'Body')] }],
    actions: [A('webhook.send', 'Send a webhook', 'write', [F('url', 'string', 'URL', { required: true }), F('body', 'object', 'Body')], { needs: ['connector:outbound-http'] })],
  },
  {
    $axf: MANIFEST, source: 'custom', title: 'Custom events', kind: 'framework', group: 'Input',
    events: [{ id: 'custom.event', title: 'A custom event (fired by API, CLI, voice or another rule)', fields: [F('name', 'string', 'Name'), F('payload', 'object', 'Payload')] }],
    actions: [],
  },
  {
    $axf: MANIFEST, source: 'engine', title: 'Prompt engine', kind: 'framework', group: 'Engine', description: 'What the engine itself can do with any answer.',
    events: [
      { id: 'prompt.answered', title: 'A prompt was answered', fields: [F('instance.id', 'string', 'Prompt id'), F('rule.id', 'rule', 'Rule'), F('answer.kind', 'enum', 'Answer', { enum: ANSWERS })] },
      { id: 'prompt.expired', title: 'A prompt timed out', fields: [F('instance.id', 'string', 'Prompt id'), F('rule.id', 'rule', 'Rule')] },
    ],
    actions: [
      A('tool.run', 'Run a tool (a plugin command: REST / MCP / CLI)', 'write', [F('plugin', 'plugin', 'Plugin', { required: true }), F('command', 'command', 'Command', { required: true, dependsOn: 'plugin' }), F('input', 'object', 'Input')]),
      A('console.command', 'Console command (console-control@1 verb on an address)', 'navigate', [F('verb', 'enum', 'Verb', { required: true, enum: ['open', 'press', 'set', 'focus', 'scroll', 'state', 'search', 'plugin.enable', 'plugin.disable'] }), F('address', 'address', 'Address'), F('value', 'string', 'Value')]),
      A('macro.run', 'Run a macro', 'write', [F('macro', 'macro', 'Macro', { required: true }), F('params', 'object', 'Parameters')]),
      A('pipeline.run', 'Run a pipeline', 'write', [F('pipeline', 'pipeline', 'Pipeline', { required: true }), F('params', 'object', 'Parameters')]),
      A('event.fire', 'Fire another event (chain rules)', 'write', [F('source', 'string', 'Source', { required: true }), F('event', 'string', 'Event', { required: true }), F('payload', 'object', 'Payload')]),
      A('rule.enable', 'Turn a rule on', 'write', [F('rule', 'rule', 'Rule', { required: true })]),
      A('rule.disable', 'Turn a rule off', 'write', [F('rule', 'rule', 'Rule', { required: true })]),
      A('notify.push', 'Push notification', 'write', [F('title', 'string', 'Title', { required: true }), F('text', 'text', 'Text'), F('priority', 'enum', 'Priority', { enum: ['low', 'normal', 'high'] })]),
      A('notify.email', 'Email Brett', 'write', [F('subject', 'string', 'Subject', { required: true }), F('text', 'text', 'Text')], { needs: ['connector:email'] }),
      A('notify.sms', 'Text Brett', 'write', [F('text', 'text', 'Text', { required: true })], { needs: ['connector:sms'] }),
      A('notify.call', 'Call Brett', 'write', [F('text', 'text', 'What to say', { required: true })], { needs: ['connector:voice-call'] }),
      A('prompt.ask', 'Ask Brett (a nested prompt)', 'ask', [F('kind', 'enum', 'Kind', { required: true, enum: ASK_KINDS.filter((k) => k !== 'none') }), F('title', 'string', 'Title', { required: true }), F('text', 'text', 'Text'), F('options', 'list', 'Options'), F('countdownSec', 'number', 'Countdown (s)')]),
      A('log.note', 'Write a line to the audit log', 'read', [F('text', 'text', 'Text', { required: true })]),
    ],
  },
]);

export function normManifest(v) {
  if (!isObj(v)) return null;
  const source = slug(v.source);
  if (!source) return null;
  const fields = (fs) => arr(fs).map((f) => (isObj(f) && str(f.name) ? { name: str(f.name, 120), type: FIELD_TYPES.includes(f.type) ? f.type : 'string', title: str(f.title) || str(f.name), ...(f.required ? { required: true } : {}), ...(Array.isArray(f.enum) ? { enum: f.enum.map((x) => str(x)).filter(Boolean) } : {}), ...(str(f.dependsOn) ? { dependsOn: str(f.dependsOn) } : {}), ...(str(f.from) ? { from: str(f.from) } : {}) } : null)).filter(Boolean);
  return {
    $axf: MANIFEST, source, title: str(v.title) || source, kind: SOURCE_KINDS.includes(v.kind) ? v.kind : 'plugin', group: str(v.group) || 'Other', description: str(v.description, 600),
    events: arr(v.events).map((e) => (isObj(e) && slug(e.id) ? { id: slug(e.id), title: str(e.title) || slug(e.id), description: str(e.description, 600), fields: fields(e.fields) } : null)).filter(Boolean),
    actions: arr(v.actions).map((a) => (isObj(a) && slug(a.id) ? { id: slug(a.id), title: str(a.title) || slug(a.id), description: str(a.description, 600), effect: EFFECTS.includes(a.effect) ? a.effect : 'write', input: fields(a.input), ...(a.confirm ? { confirm: true } : {}), ...(a.brettOnly ? { brettOnly: true } : {}), needs: arr(a.needs).map((x) => str(x)).filter(Boolean) } : null)).filter(Boolean),
    connectors: arr(v.connectors).map((c) => (isObj(c) && str(c.id) ? { id: str(c.id), available: Boolean(c.available), ...(str(c.detail) ? { detail: str(c.detail) } : {}) } : null)).filter(Boolean),
  };
}
export function validateManifest(v) {
  const errors = [];
  if (!isObj(v)) return { ok: false, errors: [{ field: '', message: 'a manifest is an object' }] };
  if (v.$axf !== undefined && v.$axf !== MANIFEST) errors.push({ field: '$axf', message: `must be ${MANIFEST}` });
  if (!slug(v.source)) errors.push({ field: 'source', message: 'source is an id (letters, digits, . _ -)' });
  const seen = new Set();
  for (const [i, e] of arr(v.events).entries()) {
    if (!isObj(e) || !slug(e.id)) { errors.push({ field: `events.${i}.id`, message: 'an event has an id' }); continue; }
    if (seen.has(slug(e.id))) errors.push({ field: `events.${i}.id`, message: `event ${e.id} is declared twice` });
    seen.add(slug(e.id));
  }
  for (const [i, a] of arr(v.actions).entries()) {
    if (!isObj(a) || !slug(a.id)) { errors.push({ field: `actions.${i}.id`, message: 'an action has an id' }); continue; }
    if (a.effect !== undefined && !EFFECTS.includes(a.effect)) errors.push({ field: `actions.${i}.effect`, message: `effect is one of ${EFFECTS.join(', ')}` });
    for (const [j, f] of arr(a.input).entries()) if (!isObj(f) || !str(f.name)) errors.push({ field: `actions.${i}.input.${j}.name`, message: 'an input has a name' });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Every manifest (built-in first) merged into one registry: sources, events and actions by id, which connectors are
 * there. A later manifest with the same source id replaces the earlier one (a plugin overriding a built-in stub).
 */
export function buildRegistry(manifests = []) {
  const bySource = new Map();
  for (const m of [...BUILTIN_MANIFESTS, ...arr(manifests)]) { const n = normManifest(m); if (n) bySource.set(n.source, n); }
  const sources = [...bySource.values()];
  const events = {}; const actions = {}; const connectors = {};
  for (const s of sources) {
    for (const e of s.events) events[e.id] = { ...e, source: s.source, group: s.group };
    for (const a of s.actions) actions[a.id] = { ...a, source: s.source, group: s.group };
    for (const c of s.connectors) connectors[c.id] = c;
  }
  const groups = uniq(sources.map((s) => s.group));
  return { $axf: SCHEMA, sources, events, actions, connectors, groups };
}
export const eventDef = (registry, id) => registry?.events?.[slug(id)] ?? null;
export const actionDef = (registry, id) => registry?.actions?.[slug(id)] ?? null;
/** The connectors an action still needs (`connector:<id>` in `needs` with no available connector). */
export function missingConnectors(registry, action) {
  const a = isObj(action) && action.id ? action : actionDef(registry, action);
  if (!a) return [];
  return a.needs.filter((n) => n.startsWith('connector:')).map((n) => n.slice('connector:'.length)).filter((id) => !registry.connectors?.[id]?.available);
}

/* ------------------------------------------------------------------ context-aware options (the builder) */

/**
 * What the builder may offer next, given what is already picked: only valid choices (events of the picked source,
 * fields of the picked event, inputs of the picked action with live lists filled in). `live` holds the live lists:
 * { builds: [{id,title}], plugins: [{id, commands:[{id,title}]}], macros, pipelines, rules, addresses }.
 */
export function optionsFor(registry, picked = {}, live = {}) {
  const p = isObj(picked) ? picked : {};
  const out = { groups: registry.groups, sources: registry.sources.map((s) => ({ id: s.source, title: s.title, group: s.group, kind: s.kind, events: s.events.length, actions: s.actions.length })) };
  const src = p.source ? registry.sources.find((s) => s.source === slug(p.source)) : null;
  out.events = (src ? src.events : Object.values(registry.events)).map((e) => ({ id: e.id, title: e.title, source: e.source ?? src?.source }));
  const ev = p.event ? eventDef(registry, p.event) : null;
  out.fields = ev ? ev.fields : [];
  out.ops = ev ? OPS : [];
  if (p.field && ev) {
    const f = ev.fields.find((x) => x.name === p.field);
    out.ops = f ? opsForType(f.type) : OPS;
    out.values = f?.enum ?? liveValues(f?.type, live);
  }
  out.askKinds = ASK_KINDS; out.outputs = OUTPUTS.map((o) => ({ id: o, available: !CONNECTOR_OUTPUTS.includes(o) || Boolean(registry.connectors?.[connectorOf(o)]?.available) }));
  out.answers = p.ask ? answersFor(p.ask) : ANSWERS;
  out.actions = Object.values(registry.actions).map((a) => ({ id: a.id, title: a.title, source: a.source, group: a.group, effect: a.effect, missing: missingConnectors(registry, a) }));
  const act = p.action ? actionDef(registry, p.action) : null;
  out.inputs = act ? act.input.map((f) => ({ ...f, choices: f.enum ? f.enum.map((v) => ({ id: v, title: v })) : liveChoices(f, p.input, live) })) : [];
  return out;
}
const connectorOf = (o) => ({ email: 'email', sms: 'sms', call: 'voice-call' })[o] ?? o;
function opsForType(t) {
  if (t === 'number' || t === 'duration') return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing'];
  if (t === 'boolean') return ['truthy', 'falsy'];
  if (t === 'enum') return ['eq', 'ne', 'in', 'nin'];
  if (t === 'list' || t === 'object') return ['contains', 'exists', 'missing'];
  return ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'matches', 'exists', 'missing'];
}
const liveValues = (t, live) => (liveChoices({ type: t }, {}, live) ?? []).map((c) => c.id);
function liveChoices(f, input, live) {
  const L = isObj(live) ? live : {};
  const list = (xs) => arr(xs).map((x) => (isObj(x) ? { id: str(x.id), title: str(x.title) || str(x.name) || str(x.id) } : { id: str(x), title: str(x) })).filter((x) => x.id);
  switch (f.type) {
    case 'build': return list(L.builds);
    case 'plugin': return list(L.plugins);
    case 'macro': return list(L.macros);
    case 'pipeline': return list(L.pipelines);
    case 'rule': return list(L.rules);
    case 'address': return list(L.addresses);
    case 'command': {
      const plugin = str(isObj(input) ? input[f.dependsOn || 'plugin'] : '');
      const p = arr(L.plugins).find((x) => isObj(x) && str(x.id) === plugin);
      return p ? list(p.commands) : [];
    }
    default: return null;
  }
}
/** Which `on` branches a prompt kind can answer with. */
export function answersFor(ask) {
  const kind = isObj(ask) ? ask.kind : ask;
  switch (kind) {
    case 'none': return ['fire'];
    case 'approve': return ['approve', 'deny', 'later'];
    case 'veto': return ['approve', 'deny', 'timeout', 'later'];
    case 'pick': return ['pick', 'deny', 'later', ...(isObj(ask) && ask.countdownSec > 0 ? ['timeout'] : [])];
    case 'text': return ['text', 'deny', 'later'];
    default: return ANSWERS;
  }
}

/* ------------------------------------------------------------------ actions, macros, pipelines */

function normAction(a) {
  if (typeof a === 'string') return slug(a) ? { action: slug(a), input: {} } : null;
  if (!isObj(a)) return null;
  const action = slug(a.action ?? a.do ?? a.id);
  if (!action) return null;
  const out = { action, input: isObj(a.input) ? a.input : isObj(a.with) ? a.with : {} };
  if (str(a.title)) out.title = str(a.title);
  if (a.continueOnError) out.continueOnError = true;
  return out;
}
export function normMacro(v, opts = {}) {
  if (!isObj(v)) return null;
  const id = slug(v.id) || slug(v.title);
  if (!id) return null;
  return {
    $axf: MACRO, id, title: str(v.title) || id, description: str(v.description, 600),
    params: arr(v.params).map((p) => (isObj(p) && str(p.name) ? { name: str(p.name, 80), type: FIELD_TYPES.includes(p.type) ? p.type : 'string', title: str(p.title) || str(p.name), ...(p.default !== undefined ? { default: p.default } : {}), ...(p.required ? { required: true } : {}) } : typeof p === 'string' && str(p) ? { name: str(p, 80), type: 'string', title: str(p) } : null)).filter(Boolean),
    steps: arr(v.steps).map(normAction).filter(Boolean),
    createdAt: iso(v.createdAt) || iso(opts.now) || '', updatedAt: iso(opts.now) || iso(v.updatedAt) || '', by: str(v.by, 120),
  };
}
export function normPipeline(v, opts = {}) {
  if (!isObj(v)) return null;
  const id = slug(v.id) || slug(v.title);
  if (!id) return null;
  return {
    $axf: PIPELINE, id, title: str(v.title) || id, description: str(v.description, 600),
    params: normMacro({ id, params: v.params })?.params ?? [],
    stages: arr(v.stages).map((s, i) => {
      if (!isObj(s)) return null;
      const stage = { id: slug(s.id) || `stage-${i + 1}`, title: str(s.title) || `Stage ${i + 1}`, actions: arr(s.actions ?? s.steps).map(normAction).filter(Boolean) };
      const gate = normAsk(s.gate);
      if (gate && gate.kind !== 'none') stage.gate = gate;
      if (s.continueOnError) stage.continueOnError = true;
      return stage;
    }).filter(Boolean),
    createdAt: iso(v.createdAt) || iso(opts.now) || '', updatedAt: iso(opts.now) || iso(v.updatedAt) || '', by: str(v.by, 120),
  };
}
function actionErrors(a, path, registry, out) {
  if (!isObj(a) || !slug(a.action ?? a.do ?? a.id)) { out.push({ field: path, message: 'an action names a registry action (tool.run, macro.run, notify.push …)' }); return; }
  if (!registry) return;
  const def = actionDef(registry, a.action ?? a.do ?? a.id);
  if (!def) { out.push({ field: `${path}.action`, message: `no action ${a.action ?? a.do ?? a.id} in the registry` }); return; }
  const input = isObj(a.input) ? a.input : isObj(a.with) ? a.with : {};
  for (const f of def.input) {
    const v = input[f.name];
    if (f.required && (v === undefined || v === null || v === '')) out.push({ field: `${path}.input.${f.name}`, message: `${def.title} needs ${f.title}` });
    if (f.enum && v !== undefined && v !== '' && typeof v === 'string' && !/\{\{/.test(v) && !f.enum.includes(v)) out.push({ field: `${path}.input.${f.name}`, message: `${f.title} is one of ${f.enum.join(', ')}` });
  }
}
export function validateMacro(v, registry = null) {
  const errors = [];
  if (!isObj(v)) return { ok: false, errors: [{ field: '', message: 'a macro is an object' }] };
  if (v.$axf !== undefined && v.$axf !== MACRO) errors.push({ field: '$axf', message: `must be ${MACRO}` });
  if (!slug(v.id) && !slug(v.title)) errors.push({ field: 'id', message: 'a macro has an id or a title' });
  if (!arr(v.steps).length) errors.push({ field: 'steps', message: 'a macro has at least one step' });
  arr(v.steps).forEach((s, i) => actionErrors(typeof s === 'string' ? { action: s } : s, `steps.${i}`, registry, errors));
  return { ok: errors.length === 0, errors };
}
export function validatePipeline(v, registry = null) {
  const errors = [];
  if (!isObj(v)) return { ok: false, errors: [{ field: '', message: 'a pipeline is an object' }] };
  if (v.$axf !== undefined && v.$axf !== PIPELINE) errors.push({ field: '$axf', message: `must be ${PIPELINE}` });
  if (!slug(v.id) && !slug(v.title)) errors.push({ field: 'id', message: 'a pipeline has an id or a title' });
  if (!arr(v.stages).length) errors.push({ field: 'stages', message: 'a pipeline has at least one stage' });
  arr(v.stages).forEach((s, i) => {
    if (!isObj(s)) { errors.push({ field: `stages.${i}`, message: 'a stage is an object' }); return; }
    const acts = arr(s.actions ?? s.steps);
    if (!acts.length && !s.gate) errors.push({ field: `stages.${i}.actions`, message: 'a stage has actions or a gate' });
    acts.forEach((a, j) => actionErrors(typeof a === 'string' ? { action: a } : a, `stages.${i}.actions.${j}`, registry, errors));
    if (s.gate) askErrors(s.gate, `stages.${i}.gate`, errors);
  });
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ rules */

function normAsk(v) {
  if (!isObj(v)) return v === undefined || v === null ? { kind: 'none', title: '', text: '', options: [], countdownSec: 0, outputs: ['dialog'] } : null;
  const kind = ASK_KINDS.includes(v.kind) ? v.kind : 'approve';
  const out = {
    kind, title: str(v.title, 200), text: str(v.text, MAX_TEXT),
    options: kind === 'pick' ? arr(v.options).slice(0, MAX_OPTIONS).map((o, i) => (isObj(o) ? { id: slug(o.id) || `option-${i + 1}`, label: str(o.label) || str(o.id) || `Option ${i + 1}` } : { id: slug(o) || `option-${i + 1}`, label: str(o) || `Option ${i + 1}` })) : [],
    countdownSec: kind === 'veto' ? Math.max(5, Math.round(num(v.countdownSec, DEFAULT_VETO_SEC))) : Math.max(0, Math.round(num(v.countdownSec, 0))),
    outputs: uniq(arr(v.outputs).filter((o) => OUTPUTS.includes(o))),
  };
  if (!out.outputs.length) out.outputs = ['dialog'];
  if (str(v.defaultOption) && out.options.some((o) => o.id === str(v.defaultOption))) out.defaultOption = str(v.defaultOption);
  return out;
}
function askErrors(v, path, out) {
  if (!isObj(v)) { out.push({ field: path, message: 'ask is an object { kind, title, … }' }); return; }
  if (v.kind !== undefined && !ASK_KINDS.includes(v.kind)) out.push({ field: `${path}.kind`, message: `kind is one of ${ASK_KINDS.join(', ')}` });
  if (v.kind && v.kind !== 'none' && !str(v.title)) out.push({ field: `${path}.title`, message: 'a prompt has a title (what Brett sees first)' });
  if (v.kind === 'pick') {
    const n = arr(v.options).length;
    if (n < 2) out.push({ field: `${path}.options`, message: 'a pick offers at least two options' });
    if (n > MAX_OPTIONS) out.push({ field: `${path}.options`, message: `a pick offers at most ${MAX_OPTIONS} options` });
  }
  if (v.kind === 'veto' && v.countdownSec !== undefined && num(v.countdownSec, 0) < 5) out.push({ field: `${path}.countdownSec`, message: 'a veto countdown is at least 5 seconds' });
  for (const o of arr(v.outputs)) if (!OUTPUTS.includes(o)) out.push({ field: `${path}.outputs`, message: `outputs are ${OUTPUTS.join(', ')}` });
}
function normOn(v, ask) {
  const on = {};
  if (!isObj(v)) return on;
  for (const k of ['approve', 'deny', 'timeout', 'later', 'text', 'fire']) if (v[k] !== undefined) on[k] = arr(v[k]).map(normAction).filter(Boolean);
  if (isObj(v.pick)) {
    on.pick = {};
    for (const [opt, acts] of Object.entries(v.pick)) if (slug(opt) && (!ask || ask.kind !== 'pick' || ask.options.some((o) => o.id === slug(opt)))) on.pick[slug(opt)] = arr(acts).map(normAction).filter(Boolean);
  }
  return on;
}
export function normRule(v, opts = {}) {
  if (!isObj(v)) return null;
  const id = slug(v.id) || slug(v.title);
  if (!id) return null;
  const trigger = isObj(v.trigger) ? v.trigger : {};
  const ask = normAsk(v.ask) ?? normAsk(null);
  const limits = isObj(v.limits) ? v.limits : {};
  const out = {
    $axf: RULE, id, title: str(v.title, 200) || id, description: str(v.description, 600), enabled: v.enabled !== false,
    trigger: { source: slug(trigger.source), event: slug(trigger.event), filter: isObj(trigger.filter) ? Object.fromEntries(Object.entries(trigger.filter).filter(([k]) => str(k)).map(([k, x]) => [str(k, 200), x])) : {} },
    when: normCond(v.when ?? v.conditions ?? null),
    limits: { cooldownSec: Math.max(0, Math.round(num(limits.cooldownSec, 0))), dedupeKey: str(limits.dedupeKey, 400), dedupeSec: Math.max(0, Math.round(num(limits.dedupeSec, 0))), maxPerHour: Math.max(0, Math.round(num(limits.maxPerHour, 0))), retries: Math.min(5, Math.max(0, Math.round(num(limits.retries, 0)))), retryDelaySec: Math.max(0, Math.round(num(limits.retryDelaySec, 30))) },
    ask, on: normOn(v.on, ask),
    template: slug(v.template), tags: uniq(arr(v.tags).map((t) => slug(t)).filter(Boolean)),
    createdAt: iso(v.createdAt) || iso(opts.now) || '', updatedAt: iso(opts.now) || iso(v.updatedAt) || '', by: str(v.by, 120),
  };
  return out;
}
export function validateRule(v, registry = null) {
  const errors = [];
  if (!isObj(v)) return { ok: false, errors: [{ field: '', message: 'a rule is an object' }] };
  if (v.$axf !== undefined && v.$axf !== RULE) errors.push({ field: '$axf', message: `must be ${RULE}` });
  if (!slug(v.id) && !slug(v.title)) errors.push({ field: 'id', message: 'a rule has an id or a title' });
  const t = isObj(v.trigger) ? v.trigger : null;
  if (!t || !slug(t.event)) errors.push({ field: 'trigger.event', message: 'a rule fires on an event (trigger.event, e.g. build.failed)' });
  else if (registry) {
    const def = eventDef(registry, t.event);
    if (!def) errors.push({ field: 'trigger.event', message: `no event ${t.event} in the registry` });
    else if (slug(t.source) && def.source !== slug(t.source)) errors.push({ field: 'trigger.source', message: `${t.event} belongs to ${def.source}, not ${t.source}` });
  }
  condErrors(v.when ?? v.conditions ?? null, 'when', errors);
  if (v.ask !== undefined && v.ask !== null) askErrors(v.ask, 'ask', errors);
  const ask = normAsk(v.ask) ?? { kind: 'approve', options: [] };
  const on = isObj(v.on) ? v.on : {};
  const allowed = answersFor(ask);
  for (const [k, acts] of Object.entries(on)) {
    if (!['approve', 'deny', 'timeout', 'later', 'text', 'fire', 'pick'].includes(k)) { errors.push({ field: `on.${k}`, message: `on.${k} is not an answer (approve, deny, timeout, later, text, fire, pick)` }); continue; }
    if (!allowed.includes(k)) errors.push({ field: `on.${k}`, message: `a ${ask.kind} prompt is never answered with ${k}` });
    if (k === 'pick') {
      if (!isObj(acts)) { errors.push({ field: 'on.pick', message: 'on.pick maps option ids to actions' }); continue; }
      for (const [opt, oa] of Object.entries(acts)) {
        if (ask.kind === 'pick' && !ask.options.some((o) => o.id === slug(opt))) errors.push({ field: `on.pick.${opt}`, message: `no option ${opt} in ask.options` });
        arr(oa).forEach((a, i) => actionErrors(typeof a === 'string' ? { action: a } : a, `on.pick.${opt}.${i}`, registry, errors));
      }
    } else arr(acts).forEach((a, i) => actionErrors(typeof a === 'string' ? { action: a } : a, `on.${k}.${i}`, registry, errors));
  }
  const total = Object.values(on).reduce((n, x) => n + (isObj(x) ? Object.values(x).reduce((m, y) => m + arr(y).length, 0) : arr(x).length), 0);
  if (ask.kind === 'none' && total === 0) errors.push({ field: 'on.fire', message: 'a rule that asks nothing does something on fire' });
  const L = isObj(v.limits) ? v.limits : {};
  for (const k of ['cooldownSec', 'dedupeSec', 'maxPerHour', 'retries', 'retryDelaySec']) if (L[k] !== undefined && (!Number.isFinite(Number(L[k])) || Number(L[k]) < 0)) errors.push({ field: `limits.${k}`, message: `${k} is a number of seconds / times, 0 or more` });
  return { ok: errors.length === 0, errors };
}
/** One plain sentence for the list: "When a build fails (status = failed): ask approve ‘Retry?’ → on approve run 1 action." */
export function summarize(rule, registry = null) {
  const r = normRule(rule);
  if (!r) return '';
  const ev = registry ? eventDef(registry, r.trigger.event) : null;
  const filt = Object.entries(r.trigger.filter).map(([k, v]) => `${k} = ${show(v)}`).join(', ');
  const askText = r.ask.kind === 'none' ? 'runs' : r.ask.kind === 'veto' ? `asks (veto, ${r.ask.countdownSec}s)` : r.ask.kind === 'pick' ? `asks to pick from ${r.ask.options.length}` : `asks ${r.ask.kind}`;
  const branches = Object.entries(r.on).map(([k, v]) => `${k}: ${isObj(v) ? Object.values(v).reduce((n, x) => n + x.length, 0) : v.length}`).join(', ');
  return `On ${ev?.title ?? r.trigger.event}${filt ? ` (${filt})` : ''}${r.when ? ', with conditions' : ''}: ${askText}${r.ask.title ? ` "${r.ask.title}"` : ''}${branches ? ` → ${branches}` : ''}${r.limits.cooldownSec ? `; cooldown ${r.limits.cooldownSec}s` : ''}${r.enabled ? '' : ' (off)'}`;
}

/* ------------------------------------------------------------------ events + evaluation */

/** An incoming event normalised: { source, event, at, payload, by, id }. */
export function normEvent(v, opts = {}) {
  if (!isObj(v)) return null;
  const event = slug(v.event ?? v.type ?? v.name);
  if (!event) return null;
  const source = slug(v.source);
  const payload = isObj(v.payload) ? v.payload : Object.fromEntries(Object.entries(v).filter(([k]) => !['event', 'type', 'name', 'source', 'at', 'by', 'id', '$axf'].includes(k)));
  const at = iso(v.at) || iso(opts.now) || '';
  const id = str(v.id, 160) || `${source || event.split('.')[0]}:${event}:${at}`;
  return { source, event, at, by: str(v.by, 120), id, payload };
}
/** The context templates and conditions read: the payload's fields at the top plus `event`, `source`, `at`, `by`, `now`, `rule`. */
export function eventContext(event, rule = null, extra = {}) {
  const e = normEvent(event) ?? { source: '', event: '', at: '', by: '', id: '', payload: {} };
  return { ...e.payload, event: e.event, source: e.source, at: e.at, by: e.by, eventId: e.id, ...(rule ? { rule: { id: rule.id, title: rule.title } } : {}), ...(isObj(extra) ? extra : {}) };
}
export function matchTrigger(rule, event) {
  const r = normRule(rule); const e = normEvent(event);
  if (!r || !e) return { match: false, reason: 'no-match' };
  if (r.trigger.event !== e.event && !(r.trigger.event.endsWith('.*') && e.event.startsWith(r.trigger.event.slice(0, -1)))) return { match: false, reason: 'no-match' };
  if (r.trigger.source && e.source && r.trigger.source !== e.source) return { match: false, reason: 'no-match' };
  const ctx = eventContext(e, r);
  for (const [k, v] of Object.entries(r.trigger.filter)) if (!testCondition({ field: k, op: Array.isArray(v) ? 'in' : 'eq', value: v }, ctx)) return { match: false, reason: 'filter' };
  return { match: true, reason: '' };
}
/** The engine's per-rule memory (cooldowns, dedupe keys, fires this hour); `normState` keeps it well formed. */
export function normState(v) {
  const s = isObj(v) ? v : {};
  return { lastFired: isObj(s.lastFired) ? { ...s.lastFired } : {}, seen: isObj(s.seen) ? { ...s.seen } : {}, fires: isObj(s.fires) ? Object.fromEntries(Object.entries(s.fires).map(([k, x]) => [k, arr(x).map((t) => iso(t)).filter(Boolean)])) : {} };
}
/** Drop memory older than a day (dedupe keys past their window, fires past the hour). */
export function pruneState(state, now) {
  const s = normState(state); const t = ms(iso(now));
  if (!Number.isFinite(t)) return s;
  for (const [k, v] of Object.entries(s.seen)) { const until = ms(isObj(v) ? v.until : v); if (!Number.isFinite(until) || until < t) delete s.seen[k]; }
  for (const [k, xs] of Object.entries(s.fires)) { s.fires[k] = xs.filter((x) => t - ms(x) < 3600_000); if (!s.fires[k].length) delete s.fires[k]; }
  return s;
}
/**
 * Does this rule fire on this event now? Checks enabled → trigger (+ filter) → conditions → cooldown → dedupe → rate.
 * Returns { fire, reason, instance (when it asks), actions (when it just runs), state (updated), ctx }.
 */
export function evaluate(rule, event, state, now, opts = {}) {
  const r = normRule(rule); const e = normEvent(event, { now });
  const at = iso(now) || e?.at || '';
  const s = normState(state);
  const skip = (reason) => ({ fire: false, reason, rule: r?.id ?? '', event: e?.id ?? '', state: s });
  if (!r || !e) return skip('no-match');
  if (!r.enabled && !opts.force) return skip('disabled');
  const m = matchTrigger(r, e);
  if (!m.match) return skip(m.reason);
  const ctx = eventContext(e, r, { now: at });
  if (r.when && !evalGroup(r.when, ctx)) return skip('conditions');
  const t = ms(at);
  if (!opts.force) {
    if (r.limits.cooldownSec > 0) { const last = ms(s.lastFired[r.id]); if (Number.isFinite(last) && t - last < r.limits.cooldownSec * 1000) return skip('cooldown'); }
    if (r.limits.dedupeKey) {
      const key = `${r.id}|${render(r.limits.dedupeKey, ctx)}`;
      const seen = s.seen[key];
      const until = ms(isObj(seen) ? seen.until : seen);
      if (Number.isFinite(until) && until > t) return skip('dedupe');
      s.seen[key] = { at, until: iso(t + (r.limits.dedupeSec || 86400) * 1000) };
    }
    if (r.limits.maxPerHour > 0) {
      const recent = (s.fires[r.id] ?? []).filter((x) => t - ms(x) < 3600_000);
      if (recent.length >= r.limits.maxPerHour) return skip('rate');
      s.fires[r.id] = [...recent, at];
    }
  }
  s.lastFired[r.id] = at;
  if (r.ask.kind === 'none') return { fire: true, reason: '', rule: r.id, event: e.id, actions: r.on.fire ?? [], ctx, state: s };
  return { fire: true, reason: '', rule: r.id, event: e.id, instance: instanceFor(r, e, at, opts), ctx, state: s };
}
/** Every rule against one event, in order; the state threads through. */
export function evaluateAll(rules, event, state, now, opts = {}) {
  let s = normState(state);
  const results = [];
  for (const rule of arr(rules)) { const res = evaluate(rule, event, s, now, opts); s = res.state; results.push(res); }
  return { results, fired: results.filter((r) => r.fire), state: s };
}

/* ------------------------------------------------------------------ instances (prompts waiting for Brett) */

export function instanceId(ruleId, eventId, at) {
  const base = `${slug(ruleId) || 'rule'}-${iso(at).replace(/[-:.TZ]/g, '').slice(0, 14) || '0'}`;
  let h = 0; const s = `${ruleId}|${eventId}|${at}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `${base}-${h.toString(36)}`.slice(0, 80);
}
/** A prompt-instance@1 from a rule and the event that fired it: rendered title / text / options, the deadline, outputs. */
export function instanceFor(rule, event, now, opts = {}) {
  const r = normRule(rule); const e = normEvent(event, { now });
  if (!r || !e) return null;
  const at = iso(now) || e.at;
  const ctx = eventContext(e, r, { now: at });
  const ask = r.ask;
  const countdown = ask.countdownSec > 0 ? ask.countdownSec : 0;
  const inst = {
    $axf: INSTANCE, id: str(opts.id) || instanceId(r.id, e.id, at), rule: r.id, ruleTitle: r.title, event: { source: e.source, event: e.event, id: e.id, at: e.at, payload: e.payload },
    kind: ask.kind, title: render(ask.title, ctx) || r.title, text: render(ask.text, ctx), options: ask.options.map((o) => ({ id: o.id, label: render(o.label, ctx) })),
    countdownSec: countdown, askedAt: at, expiresAt: countdown ? iso(ms(at) + countdown * 1000) : '', status: 'waiting', outputs: ask.outputs, answers: answersFor(ask),
    ...(ask.defaultOption ? { defaultOption: ask.defaultOption } : {}), ...(isObj(opts.resume) ? { resume: opts.resume } : {}),
  };
  if (opts.registry) inst.keysNeeded = ask.outputs.filter((o) => CONNECTOR_OUTPUTS.includes(o) && !opts.registry.connectors?.[connectorOf(o)]?.available).map((o) => connectorOf(o));
  return inst;
}
export function normInstance(v) {
  if (!isObj(v) || !str(v.id)) return null;
  return { ...v, $axf: INSTANCE, id: str(v.id, 80), status: INSTANCE_STATUSES.includes(v.status) ? v.status : 'waiting', options: arr(v.options), answers: arr(v.answers), outputs: arr(v.outputs) };
}
/** An answer: { kind: approve|deny|pick|text|timeout|later, option?, text?, by? }. */
export function normAnswer(v) {
  if (typeof v === 'string') {
    const k = v.trim().toLowerCase();
    if (['approve', 'approved', 'yes', 'ok', 'go', 'run it'].includes(k)) return { kind: 'approve' };
    if (['deny', 'denied', 'no', 'stop', 'reject', 'cancel'].includes(k)) return { kind: 'deny' };
    if (['later', 'shelve', 'wait', 'not now'].includes(k)) return { kind: 'later' };
    if (k === 'timeout') return { kind: 'timeout' };
    const m = /^(?:pick|option|choose|select)\s+(?:option\s+)?(\S+)$/i.exec(v.trim());
    if (m) return { kind: 'pick', option: m[1] };
    return { kind: 'text', text: v.trim().slice(0, MAX_TEXT) };
  }
  if (!isObj(v)) return null;
  const kind = ANSWERS.includes(v.kind) ? v.kind : v.option !== undefined ? 'pick' : v.text !== undefined ? 'text' : '';
  if (!kind) return null;
  return { kind, ...(v.option !== undefined ? { option: str(v.option, 80) } : {}), ...(v.text !== undefined ? { text: str(v.text, MAX_TEXT) } : {}), ...(str(v.by) ? { by: str(v.by, 120) } : {}) };
}
/** An option by id, 1-based number or label (voice: "pick option 2", "pick the dark one"). */
export function pickOption(instance, want) {
  const opts = arr(instance?.options);
  const w = str(want, 200).toLowerCase();
  if (!w) return null;
  const byId = opts.find((o) => o.id === w); if (byId) return byId;
  if (/^\d+$/.test(w)) return opts[Number(w) - 1] ?? null;
  const byLabel = opts.filter((o) => str(o.label).toLowerCase() === w || str(o.label).toLowerCase().includes(w));
  return byLabel.length === 1 ? byLabel[0] : null;
}
/**
 * Brett's answer to a waiting prompt: the instance moves on and the matching `on` branch's actions come back to run.
 * A veto timeout approves (the call runs by itself); any other timeout picks the default option or runs `on.timeout`.
 */
export function answerInstance(instance, rule, answer, now) {
  const inst = normInstance(instance); const r = normRule(rule); const a = normAnswer(answer); const at = iso(now) || '';
  if (!inst) return { ok: false, error: 'no such prompt', code: 'not_found' };
  if (!a) return { ok: false, error: 'an answer is approve, deny, later, pick <option> or text', code: 'validation', instance: inst };
  if (inst.status !== 'waiting' && inst.status !== 'shelved') return { ok: false, error: `this prompt is already ${inst.status}`, code: 'validation', instance: inst };
  if (!inst.answers.includes(a.kind) && !(a.kind === 'timeout')) return { ok: false, error: `a ${inst.kind} prompt takes ${inst.answers.join(', ')}, not ${a.kind}`, code: 'validation', instance: inst };
  if (a.kind === 'later') return { ok: true, instance: { ...inst, status: 'shelved', shelvedAt: at }, actions: [], branch: 'later' };
  const on = r?.on ?? {};
  let branch = a.kind; let actions = []; let option = null;
  if (a.kind === 'pick') {
    option = pickOption(inst, a.option);
    if (!option) return { ok: false, error: `no option ${a.option}; the options are ${inst.options.map((o, i) => `${i + 1} ${o.label} (${o.id})`).join(', ')}`, code: 'validation', instance: inst };
    actions = on.pick?.[option.id] ?? [];
  } else if (a.kind === 'timeout') {
    if (inst.kind === 'veto') { branch = on.timeout ? 'timeout' : 'approve'; actions = on.timeout ?? on.approve ?? []; }
    else if (inst.kind === 'pick' && inst.defaultOption) { option = pickOption(inst, inst.defaultOption); branch = 'pick'; actions = on.pick?.[option?.id] ?? []; }
    else { branch = 'timeout'; actions = on.timeout ?? []; }
  } else actions = on[a.kind] ?? [];
  const answered = { ...inst, status: a.kind === 'timeout' ? 'expired' : 'answered', answeredAt: at, answer: { ...a, ...(option ? { option: option.id, optionLabel: option.label } : {}) }, branch };
  return { ok: true, instance: answered, actions, branch, option };
}
/** Waiting prompts past their deadline are answered `timeout`; returns the ones that changed with their actions. */
export function expireInstances(instances, rulesById, now) {
  const t = ms(iso(now)); const out = [];
  for (const i of arr(instances)) {
    const inst = normInstance(i);
    if (!inst || inst.status !== 'waiting' || !inst.expiresAt) continue;
    if (ms(inst.expiresAt) <= t) { const res = answerInstance(inst, rulesById?.[inst.rule] ?? null, { kind: 'timeout' }, now); if (res.ok) out.push(res); }
  }
  return out;
}

/* ------------------------------------------------------------------ planning (macros, pipelines, gates) */

/**
 * Flatten actions into steps the runner executes, in order: inputs rendered with the context, macros expanded (their
 * params become `params.*` in the context), pipelines expanded stage by stage until a gate (the gate becomes one
 * `prompt.ask` step with `resume` so the answer carries on), connectors checked. Never runs anything.
 */
export function plan(actions, opts = {}) {
  const registry = opts.registry ?? buildRegistry();
  const macros = Object.fromEntries(arr(opts.macros).map((m) => normMacro(m)).filter(Boolean).map((m) => [m.id, m]));
  const pipelines = Object.fromEntries(arr(opts.pipelines).map((p) => normPipeline(p)).filter(Boolean).map((p) => [p.id, p]));
  const ctx = isObj(opts.ctx) ? opts.ctx : {};
  const steps = []; const errors = []; const keysNeeded = new Set(); let gate = null;
  const visit = (acts, c, trail, depth) => {
    if (gate) return;
    if (depth > MAX_DEPTH) { errors.push({ at: trail.join(' > '), message: `nested deeper than ${MAX_DEPTH}` }); return; }
    for (const raw of arr(acts)) {
      if (gate) return;
      if (steps.length >= MAX_STEPS) { errors.push({ at: trail.join(' > '), message: `more than ${MAX_STEPS} steps` }); return; }
      const a = normAction(raw);
      if (!a) { errors.push({ at: trail.join(' > '), message: 'not an action' }); continue; }
      const def = actionDef(registry, a.action);
      if (!def) { errors.push({ at: [...trail, a.action].join(' > '), message: `no action ${a.action} in the registry` }); continue; }
      const input = renderDeep(a.input, c);
      const missingIn = def.input.filter((f) => f.required && (input[f.name] === undefined || input[f.name] === null || input[f.name] === '')).map((f) => f.name);
      if (missingIn.length) { errors.push({ at: [...trail, a.action].join(' > '), message: `${def.title} needs ${missingIn.join(', ')}` }); continue; }
      if (a.action === 'macro.run') {
        const m = macros[slug(input.macro)];
        if (!m) { errors.push({ at: [...trail, a.action].join(' > '), message: `no macro ${input.macro}` }); continue; }
        if (trail.includes(`macro:${m.id}`)) { errors.push({ at: [...trail, `macro:${m.id}`].join(' > '), message: `macro ${m.id} runs itself` }); continue; }
        const params = { ...Object.fromEntries(m.params.filter((p) => p.default !== undefined).map((p) => [p.name, p.default])), ...(isObj(input.params) ? input.params : {}) };
        const miss = m.params.filter((p) => p.required && (params[p.name] === undefined || params[p.name] === '')).map((p) => p.name);
        if (miss.length) { errors.push({ at: [...trail, `macro:${m.id}`].join(' > '), message: `macro ${m.id} needs ${miss.join(', ')}` }); continue; }
        steps.push({ action: 'macro.run', title: m.title, input: { macro: m.id, params }, effect: 'read', marker: 'macro-start', at: [...trail, `macro:${m.id}`].join(' > ') });
        visit(m.steps, { ...c, params }, [...trail, `macro:${m.id}`], depth + 1);
        continue;
      }
      if (a.action === 'pipeline.run') {
        const p = pipelines[slug(input.pipeline)];
        if (!p) { errors.push({ at: [...trail, a.action].join(' > '), message: `no pipeline ${input.pipeline}` }); continue; }
        if (trail.includes(`pipeline:${p.id}`)) { errors.push({ at: [...trail, `pipeline:${p.id}`].join(' > '), message: `pipeline ${p.id} runs itself` }); continue; }
        const params = { ...Object.fromEntries(p.params.filter((x) => x.default !== undefined).map((x) => [x.name, x.default])), ...(isObj(input.params) ? input.params : {}) };
        const from = Math.max(0, Math.round(num(input.stage, 0)));
        for (let i = from; i < p.stages.length && !gate; i++) {
          const st = p.stages[i];
          if (st.gate && !(i === from && input.gatePassed)) {
            const g = renderDeep(st.gate, { ...c, params, stage: { id: st.id, title: st.title, index: i } });
            gate = { pipeline: p.id, stage: i, stageTitle: st.title, ask: g, params, trail: [...trail, `pipeline:${p.id}`, st.id] };
            steps.push({ action: 'prompt.ask', title: g.title || `${p.title}: ${st.title}`, input: { ...g, resume: { pipeline: p.id, stage: i, params } }, effect: 'ask', marker: 'gate', at: gate.trail.join(' > ') });
            return;
          }
          steps.push({ action: 'pipeline.run', title: `${p.title}: ${st.title}`, input: { pipeline: p.id, stage: i, params }, effect: 'read', marker: 'stage', at: [...trail, `pipeline:${p.id}`, st.id].join(' > ') });
          visit(st.actions, { ...c, params, stage: { id: st.id, title: st.title, index: i } }, [...trail, `pipeline:${p.id}`, st.id], depth + 1);
        }
        continue;
      }
      for (const k of missingConnectors(registry, def)) keysNeeded.add(k);
      const step = { action: a.action, title: a.title || def.title, input, effect: def.effect, at: [...trail, a.action].join(' > ') };
      if (def.confirm) step.confirm = true;
      if (def.brettOnly) step.brettOnly = true;
      if (a.continueOnError) step.continueOnError = true;
      const miss = missingConnectors(registry, def);
      if (miss.length) step.blocked = `needs ${miss.map((k) => `connector ${k}`).join(', ')}`;
      if (a.action === 'prompt.ask') { gate = { ask: normAsk(input), trail: step.at }; step.marker = 'gate'; }
      steps.push(step);
    }
  };
  visit(actions, ctx, arr(opts.trail).length ? arr(opts.trail) : ['run'], 0);
  return { steps, errors, keysNeeded: [...keysNeeded], gate, runnable: steps.filter((s) => !s.blocked && !s.marker).length, ok: errors.length === 0 };
}

/* ------------------------------------------------------------------ audit */

export function auditEntry(kind, detail = {}, now = '', by = '') {
  const k = AUDIT_KINDS.includes(kind) ? kind : 'rule';
  const d = isObj(detail) ? detail : { detail };
  const line = { $axf: AUDIT, at: iso(now) || '', kind: k, ...(str(d.rule) ? { rule: str(d.rule) } : {}), ...(str(d.instance) ? { instance: str(d.instance) } : {}), ...(str(d.event) ? { event: str(d.event, 200) } : {}), ...(str(d.reason) ? { reason: str(d.reason) } : {}), ...(str(by) ? { by: str(by, 120) } : {}) };
  const rest = Object.fromEntries(Object.entries(d).filter(([key]) => !['rule', 'instance', 'event', 'reason'].includes(key)));
  if (Object.keys(rest).length) line.detail = rest;
  return line;
}
/** Which history lines belong to one rule / instance, newest first, capped. */
export function historyOf(lines, filter = {}, limit = 100) {
  const f = isObj(filter) ? filter : {};
  return arr(lines).filter((l) => isObj(l) && (!f.rule || l.rule === f.rule) && (!f.instance || l.instance === f.instance) && (!f.kind || l.kind === f.kind)).slice(-Math.max(1, limit)).reverse();
}

/* ------------------------------------------------------------------ templates */

/** Ready-made rules for the common cases; `fromTemplate(id, overrides)` makes one. */
export const TEMPLATES = Object.freeze([
  {
    id: 'ui-review-popup', title: 'UI Review: pop up every new item', group: 'Review', description: 'Whenever something goes to UI Review, a dialog with approve / request changes / reject pops up wherever Brett is, plus a push.',
    rule: { trigger: { source: 'ui-review', event: 'ui-review.submitted' }, ask: { kind: 'pick', title: 'UI Review: {{item.name}}', text: '{{item.group}} · {{item.app}} / {{item.screen}}', options: [{ id: 'approve', label: 'Approve' }, { id: 'changes', label: 'Request changes' }, { id: 'reject', label: 'Reject' }], outputs: ['dialog', 'push'] }, limits: { dedupeKey: '{{item.id}}', dedupeSec: 86400 },
      on: { pick: { approve: [{ action: 'ui-review.decide', input: { item: '{{item.id}}', decision: 'approve' } }], changes: [{ action: 'ui-review.decide', input: { item: '{{item.id}}', decision: 'changes' } }], reject: [{ action: 'ui-review.decide', input: { item: '{{item.id}}', decision: 'reject' } }] } } },
  },
  {
    id: 'build-failed-retry', title: 'Build failed: retry or archive', group: 'Builds', description: 'A failed build asks whether to queue it again or archive it; one prompt per build per day.',
    rule: { trigger: { source: 'builds', event: 'build.status', filter: { 'build.status': 'failed' } }, ask: { kind: 'pick', title: 'Build failed: {{build.title}}', text: '{{build.id}} on {{build.branch|or:no branch}}', options: [{ id: 'retry', label: 'Queue it again' }, { id: 'archive', label: 'Archive it' }, { id: 'leave', label: 'Leave it' }], outputs: ['dialog', 'push'] }, limits: { dedupeKey: '{{build.id}}', dedupeSec: 86400 },
      on: { pick: { retry: [{ action: 'build.status', input: { build: '{{build.id}}', status: 'queued' } }], archive: [{ action: 'build.archive', input: { build: '{{build.id}}' } }], leave: [{ action: 'log.note', input: { text: 'Left {{build.id}} failed.' } }] } } },
  },
  {
    id: 'approval-veto', title: 'Held call: veto countdown', group: 'Review', description: 'A call held on axHub shows a veto countdown; silence lets it run, deny stops it.',
    rule: { trigger: { source: 'approvals', event: 'approval.held' }, ask: { kind: 'veto', title: '{{approval.tool}} runs in {{approval.secondsLeft}}s', text: '{{approval.summary}}', countdownSec: 90, outputs: ['dialog', 'push'] }, limits: { dedupeKey: '{{approval.id}}', dedupeSec: 3600 }, on: { deny: [{ action: 'log.note', input: { text: 'Denied {{approval.id}}' } }] } },
  },
  {
    id: 'merge-clash-pick', title: 'Merge clash: pick what to do', group: 'Builds', description: 'A merge clash asks whether to rebase, hold, or drop the PR.',
    rule: { trigger: { source: 'merge-queue', event: 'merge.clash' }, ask: { kind: 'pick', title: 'Merge clash on PR #{{pr}}', text: 'Files: {{files|json}}', options: [{ id: 'rebase', label: 'Rebase and retry' }, { id: 'hold', label: 'Hold it' }, { id: 'drop', label: 'Drop the PR' }] }, limits: { dedupeKey: '{{pr}}', dedupeSec: 3600 },
      on: { pick: { rebase: [{ action: 'build.note', input: { build: '{{build.id}}', text: 'Brett: rebase PR #{{pr}} and retry.' } }], hold: [{ action: 'build.status', input: { build: '{{build.id}}', status: 'blocked' } }], drop: [{ action: 'build.archive', input: { build: '{{build.id}}' } }] } } },
  },
  {
    id: 'upgrade-approve', title: 'Model upgrade asked: approve or deny', group: 'Builds', description: 'A step that needs Fable asks Brett; approve records the upgrade on the build.',
    rule: { trigger: { source: 'builds', event: 'build.upgrade-requested' }, ask: { kind: 'approve', title: '{{build.title}} wants {{to}} for {{phase}}', text: 'Approve to run that phase on {{to}}.', outputs: ['dialog', 'push'] }, limits: { dedupeKey: '{{build.id}}|{{phase}}', dedupeSec: 86400 },
      on: { approve: [{ action: 'build.approve-upgrade', input: { build: '{{build.id}}', phase: '{{phase}}' } }], deny: [{ action: 'build.note', input: { build: '{{build.id}}', text: 'Upgrade to {{to}} denied for {{phase}}.' } }] } },
  },
  {
    id: 'watchdog-danger', title: 'Watchdog danger: push Brett', group: 'Systems', description: 'Any danger-level watchdog alert pushes a notification, at most 6 an hour.',
    rule: { trigger: { source: 'watchdog', event: 'watchdog.alert' }, when: { all: [{ field: 'severity', op: 'eq', value: 'danger' }] }, ask: { kind: 'none' }, limits: { maxPerHour: 6, dedupeKey: '{{check}}', dedupeSec: 900 }, on: { fire: [{ action: 'notify.push', input: { title: 'Watchdog: {{check}}', text: '{{detail}}', priority: 'high' } }] } },
  },
  {
    id: 'service-down-call', title: 'Service down over 10 min: call Brett', group: 'Systems', description: 'A service down for ten minutes gets a phone call (needs the voice-call connector; shows as keys needed until then).',
    rule: { trigger: { source: 'watchdog', event: 'health.down' }, ask: { kind: 'none' }, limits: { dedupeKey: '{{service}}', dedupeSec: 3600 }, on: { fire: [{ action: 'notify.call', input: { text: '{{service}} is down since {{since}}.' } }, { action: 'notify.push', input: { title: '{{service}} is down', text: '{{detail}}', priority: 'high' } }] } },
  },
  {
    id: 'daily-digest', title: 'Daily digest at 08:00', group: 'Time', description: 'Every morning, push a note with what landed; a macro picks up the rest.',
    rule: { trigger: { source: 'schedule', event: 'schedule.tick', filter: { schedule: 'daily-08' } }, ask: { kind: 'none' }, on: { fire: [{ action: 'notify.push', input: { title: 'Good morning', text: 'Builds landed yesterday are in Shipped features.' } }] } },
  },
  {
    id: 'build-shipped-note', title: 'Build shipped: say so', group: 'Builds', description: 'When a build lands and ships its manifest, push a note and write the audit line.',
    rule: { trigger: { source: 'builds', event: 'build.shipped' }, ask: { kind: 'none' }, limits: { dedupeKey: '{{build.id}}', dedupeSec: 86400 }, on: { fire: [{ action: 'notify.push', input: { title: 'Shipped: {{build.title}}', text: 'PR #{{build.pr}} landed.' } }, { action: 'log.note', input: { text: 'Shipped {{build.id}}' } }] } },
  },
]);
export function fromTemplate(id, overrides = {}, opts = {}) {
  const t = TEMPLATES.find((x) => x.id === slug(id));
  if (!t) return null;
  const o = isObj(overrides) ? overrides : {};
  return normRule({ ...t.rule, id: slug(o.id) || t.id, title: str(o.title) || t.title, description: str(o.description) || t.description, template: t.id, enabled: o.enabled !== false, ...Object.fromEntries(Object.entries(o).filter(([k]) => !['id', 'title', 'description', 'enabled'].includes(k))) }, opts);
}

/* ------------------------------------------------------------------ registry snapshot + JSON Schemas */

export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, records: [RULE, MACRO, PIPELINE, MANIFEST, INSTANCE, AUDIT], askKinds: ASK_KINDS, outputs: OUTPUTS, connectorOutputs: CONNECTOR_OUTPUTS, answers: ANSWERS,
  instanceStatuses: INSTANCE_STATUSES, auditKinds: AUDIT_KINDS, skipReasons: SKIP_REASONS, ops: OPS, effects: EFFECTS, sourceKinds: SOURCE_KINDS, fieldTypes: FIELD_TYPES,
  defaultVetoSec: DEFAULT_VETO_SEC, maxDepth: MAX_DEPTH, maxSteps: MAX_STEPS, maxOptions: MAX_OPTIONS, idPattern: ID_PATTERN,
  builtinSources: BUILTIN_MANIFESTS.map((m) => m.source), builtinEvents: BUILTIN_MANIFESTS.flatMap((m) => m.events.map((e) => e.id)), builtinActions: BUILTIN_MANIFESTS.flatMap((m) => m.actions.map((a) => a.id)), templates: TEMPLATES.map((t) => t.id),
});
export function jsonSchemas() {
  const s = { type: 'string' }; const id = { type: 'string', pattern: ID_PATTERN }; const int0 = { type: 'integer', minimum: 0 }; const strArr = { type: 'array', items: s };
  const base = (name, title) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://amberx.ai/axf/schemas/${name}.schema.json`, title });
  const action = { type: 'object', required: ['action'], additionalProperties: false, properties: { action: id, input: { type: 'object' }, title: s, continueOnError: { type: 'boolean' } } };
  const actions = { type: 'array', items: action };
  const condition = { $id: '#condition', oneOf: [
    { type: 'object', required: ['field', 'op'], additionalProperties: false, properties: { field: s, op: { enum: OPS }, value: {} } },
    { type: 'object', required: ['all'], additionalProperties: false, properties: { all: { type: 'array', items: { $ref: '#condition' } } } },
    { type: 'object', required: ['any'], additionalProperties: false, properties: { any: { type: 'array', items: { $ref: '#condition' } } } },
    { type: 'object', required: ['not'], additionalProperties: false, properties: { not: { $ref: '#condition' } } },
  ] };
  const field = { type: 'object', required: ['name'], additionalProperties: false, properties: { name: s, type: { enum: FIELD_TYPES }, title: s, required: { type: 'boolean' }, enum: strArr, dependsOn: s, from: s } };
  const ask = { type: 'object', additionalProperties: false, properties: { kind: { enum: ASK_KINDS }, title: s, text: { type: 'string', maxLength: MAX_TEXT }, options: { type: 'array', maxItems: MAX_OPTIONS, items: { type: 'object', required: ['id'], properties: { id: id, label: s } } }, countdownSec: int0, outputs: { type: 'array', items: { enum: OUTPUTS } }, defaultOption: s } };
  const params = { type: 'array', items: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: s, type: { enum: FIELD_TYPES }, title: s, default: {}, required: { type: 'boolean' } } } };
  return {
    'prompt-event.schema.json': { ...base('prompt-event', 'prompt-event@1: a rule of the prompting engine (trigger → conditions → limits → ask → actions per answer)'), type: 'object', required: ['id', 'trigger'], additionalProperties: false,
      properties: { $axf: { const: RULE }, id, title: s, description: s, enabled: { type: 'boolean' }, trigger: { type: 'object', required: ['event'], additionalProperties: false, properties: { source: id, event: id, filter: { type: 'object' } } }, when: { anyOf: [condition, { type: 'null' }] },
        limits: { type: 'object', additionalProperties: false, properties: { cooldownSec: int0, dedupeKey: s, dedupeSec: int0, maxPerHour: int0, retries: { type: 'integer', minimum: 0, maximum: 5 }, retryDelaySec: int0 } }, ask,
        on: { type: 'object', additionalProperties: false, properties: { approve: actions, deny: actions, timeout: actions, later: actions, text: actions, fire: actions, pick: { type: 'object', additionalProperties: actions } } },
        template: s, tags: strArr, createdAt: s, updatedAt: s, by: s } },
    'prompt-macro.schema.json': { ...base('prompt-macro', 'prompt-macro@1: a saved sequence of actions with parameters'), type: 'object', required: ['id', 'steps'], additionalProperties: false, properties: { $axf: { const: MACRO }, id, title: s, description: s, params, steps: { ...actions, minItems: 1 }, createdAt: s, updatedAt: s, by: s } },
    'prompt-pipeline.schema.json': { ...base('prompt-pipeline', 'prompt-pipeline@1: ordered stages of actions; a stage may carry a gate Brett answers before it goes on'), type: 'object', required: ['id', 'stages'], additionalProperties: false,
      properties: { $axf: { const: PIPELINE }, id, title: s, description: s, params, stages: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: { id, title: s, actions, gate: ask, continueOnError: { type: 'boolean' } } } }, createdAt: s, updatedAt: s, by: s } },
    'prompt-manifest.schema.json': { ...base('prompt-manifest', 'prompt-manifest@1: the events, actions and connectors a plugin, app, tool or service registers with the prompting engine'), type: 'object', required: ['source'], additionalProperties: false,
      properties: { $axf: { const: MANIFEST }, source: id, title: s, kind: { enum: SOURCE_KINDS }, group: s, description: s,
        events: { type: 'array', items: { type: 'object', required: ['id'], additionalProperties: false, properties: { id, title: s, description: s, fields: { type: 'array', items: field } } } },
        actions: { type: 'array', items: { type: 'object', required: ['id'], additionalProperties: false, properties: { id, title: s, description: s, effect: { enum: EFFECTS }, input: { type: 'array', items: field }, confirm: { type: 'boolean' }, brettOnly: { type: 'boolean' }, needs: strArr } } },
        connectors: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: s, available: { type: 'boolean' }, detail: s } } } } },
    'prompt-instance.schema.json': { ...base('prompt-instance', 'prompt-instance@1: one prompt waiting for (or holding) Brett\'s answer'), type: 'object', required: ['id', 'rule', 'kind', 'status'], additionalProperties: true,
      properties: { $axf: { const: INSTANCE }, id: s, rule: id, ruleTitle: s, event: { type: 'object' }, kind: { enum: ASK_KINDS }, title: s, text: s, options: { type: 'array', items: { type: 'object', properties: { id: s, label: s } } }, countdownSec: int0, askedAt: s, expiresAt: s, status: { enum: INSTANCE_STATUSES }, outputs: { type: 'array', items: { enum: OUTPUTS } }, answers: { type: 'array', items: { enum: ANSWERS } }, answer: { type: 'object' }, answeredAt: s, branch: s, resume: { type: 'object' }, keysNeeded: strArr } },
    'prompt-audit.schema.json': { ...base('prompt-audit', 'prompt-audit@1: one line of the prompting engine\'s history'), type: 'object', required: ['at', 'kind'], additionalProperties: false, properties: { $axf: { const: AUDIT }, at: s, kind: { enum: AUDIT_KINDS }, rule: s, instance: s, event: s, reason: s, by: s, detail: { type: 'object' } } },
  };
}
