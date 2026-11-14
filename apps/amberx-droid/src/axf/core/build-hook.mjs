/**
 * build-hook@1 — the one event every build creator fires (pure, IO-free).
 *
 * Brett, Nov 4 2026: "As soon as a prompt goes through that plans on building the features, they go into that list."
 * Every way a build comes to exist or moves (vps.build_start → deploy/claude-headless.sh, orchestrator add,
 * MCP pending_change add, Plan Studio "Turn into a build", a hired agent taking a job, the reconciler marking a PR
 * merged) ends in one write of the builds store (builds@1, framework/cli/builds-store.mjs saveStore). This module
 * turns one store change (before → after of one build) into the events listeners need, so no creator has to fire
 * anything itself and no creator can forget to:
 *
 *   build-event@1 = {
 *     id:     '<build>:<rev>:<event>[:<step uid>]'   stable: replaying the same change gives the same ids
 *     event:  created | steps-added | step-done | status | pr-opened | pr-merged | addendum | cancelled | restored | shipped
 *     at:     when the store saw it (ISO, UTC)
 *     by:     who wrote the store (cli | console | mcp | headless | reconcile | plan-studio | agent:<name> | …)
 *     build:  { id, profile, profiles, title, category, status, branch, pr, mergedAt, createdAt, rev, repo }
 *     from / to:  the status before and after (status, cancelled, restored)
 *     steps:  the steps the event is about: { id, uid, title, text, files, model, done, doneAt }
 *             (created: every step; steps-added: the new ones; step-done: the ones just ticked)
 *     prompt: build-origin@1's words for created / addendum: { said, at, source, session, link, verbatim, index }
 *     shipped: (shipped only) the shipped-manifest@1 ref { id, rev, at, landedCommit }; the manifest is the sidecar
 *             _claude/builds/shipped/<build>.json (framework/core/shipped-manifest.mjs)
 *   }
 *
 * Listeners (the Shipped features ledger first) consume events in order and must be idempotent on `id`.
 * The IO side (framework/cli/build-hooks.mjs) appends events to an outbox and delivers them; replaying the builds
 * journal through `eventsFromChange` rebuilds every event since the store began (backfill).
 */

import { ALLOWED_MODELS, DEFAULT_MODEL, coerceModel } from './model-policy.mjs';
import { normRef as normShippedRef } from './shipped-manifest.mjs';

export const SCHEMA = 'build-hook@1';
export const RECORD = 'build-event@1';
export const VERSION = 1;
export const EVENTS = ['created', 'steps-added', 'step-done', 'status', 'pr-opened', 'pr-merged', 'addendum', 'cancelled', 'restored', 'shipped'];
/** builds@1 statuses, mirrored so a port does not need the store core. */
export const BUILD_STATUSES = ['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built', 'complete', 'archived'];
export const REPOS = ['amberx-axf', 'axhub'];
/** GitHub repo → ledger repo id (the PR URL is the one sure sign of where a build lives). */
export const GITHUB_REPOS = Object.freeze({ 'mossesx/amberx-axf': 'amberx-axf', 'mossesx/axhub': 'axhub' });
/** Step models as the policy spells them ('Opus', 'Fable'); a new allowed model in model-policy@1 joins by itself. */
export const STEP_MODELS = ALLOWED_MODELS.map((m) => m[0].toUpperCase() + m.slice(1));
const DEFAULT_STEP_MODEL = DEFAULT_MODEL[0].toUpperCase() + DEFAULT_MODEL.slice(1);

const str = (v, max = 8000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export function iso(v) {
  const s = str(v, 40).trim(); if (!s) return '';
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : '';
}

/**
 * The repo a build lives in. Only sure signs count: a `repo` field, or the GitHub repo in its PR URL. The branch
 * name never decides (this repo has `axhub-adapter-*` branches, and axHub work is named `axf-*` at times); without a
 * sign a build is AmberX-AXF's.
 */
export function buildRepo(b) {
  const o = isObj(b) ? b : {};
  const field = str(o.repo, 80).trim().toLowerCase();
  if (REPOS.includes(field)) return field;
  if (GITHUB_REPOS[field]) return GITHUB_REPOS[field];
  const pr = str(isObj(o.pr) ? o.pr.url ?? o.pr.href : o.pr, 300).toLowerCase();
  const m = /github\.com\/([^/\s]+\/[^/\s#]+)/.exec(pr);
  if (m && GITHUB_REPOS[m[1].replace(/\.git$/, '')]) return GITHUB_REPOS[m[1].replace(/\.git$/, '')];
  return 'amberx-axf';
}
/** A PR number from builds@1's free `pr` field ('330', '#330', a URL, or an object with number / url); 0 when none. */
export function prNumber(v) {
  if (isObj(v)) return prNumber(v.number ?? v.url ?? v.href);
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : 0;
  const s = str(v, 300).trim();
  const m = s.match(/\/pull\/(\d+)/) || s.match(/#(\d+)/) || s.match(/^(\d+)$/) || s.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}
/** 'fable', 'Fable 5.1', '[Fable]', 'claude-opus-5-5' → 'Fable' / 'Opus'; anything else runs as the policy's default. */
export const stepModel = (v) => { const k = coerceModel(v, DEFAULT_MODEL); return STEP_MODELS.find((m) => m.toLowerCase() === k) || DEFAULT_STEP_MODEL; };

export function normStep(s) {
  const o = isObj(s) ? s : {};
  return { id: str(o.id, 40), uid: str(o.uid, 60) || str(o.id, 40), title: str(o.title, 200), text: str(o.text, 2000), files: list(o.files).map((f) => str(f, 300)).filter(Boolean).slice(0, 30), model: stepModel(o.model), done: o.done === true, doneAt: o.done === true ? iso(o.doneAt) : '' };
}
export function normBuildRef(b) {
  const o = isObj(b) ? b : {};
  const profiles = [...new Set(list(o.profiles).map((p) => str(p, 40)).filter(Boolean))];
  const profile = str(o.profile, 40) || profiles[0] || 'main-framework';
  return {
    id: str(o.id, 80), profile, profiles: profiles.length ? profiles : [profile], title: str(o.title, 300), category: str(o.category, 60),
    status: BUILD_STATUSES.includes(o.status) ? o.status : 'pending', branch: str(o.branch, 200), pr: prNumber(o.pr), mergedAt: iso(o.mergedAt),
    createdAt: iso(o.createdAt), rev: Number.isInteger(o.rev) && o.rev > 0 ? o.rev : 1, repo: REPOS.includes(o.repo) ? o.repo : buildRepo(o),
  };
}
export function normPrompt(origin, index = 0) {
  const o = isObj(origin) ? origin : {};
  const said = str(o.said, 20000); if (!said.trim()) return null;
  return { said, at: iso(o.at), source: str(o.source, 40), session: str(o.session, 200), link: str(o.link, 500), verbatim: o.verbatim !== false && o.mayBeParaphrased !== true, index };
}

export function eventId(buildId, rev, event, stepUid = '') { return [str(buildId, 80), Number(rev) || 1, event, ...(stepUid ? [str(stepUid, 60)] : [])].join(':'); }

export function normEvent(v) {
  const o = isObj(v) ? v : {};
  if (!EVENTS.includes(o.event)) return null;
  const build = normBuildRef(o.build); if (!build.id) return null;
  const steps = list(o.steps).map(normStep);
  const prompt = o.prompt ? normPrompt(o.prompt, Number(o.prompt.index) || 0) : null;
  const shipped = o.event === 'shipped' ? normShippedRef(o.shipped) : null;
  if (o.event === 'shipped' && !shipped) return null;
  const ev = { $axf: RECORD, id: '', event: o.event, at: iso(o.at), by: str(o.by, 80) || 'cli', build, from: str(o.from, 20), to: str(o.to, 20), steps, prompt, ...(shipped ? { shipped } : {}) };
  ev.id = str(o.id, 200) || eventId(build.id, build.rev, ev.event, ev.event === 'step-done' && steps.length === 1 ? steps[0].uid : ev.event === 'shipped' ? String(shipped.rev) : '');
  return ev;
}
export function validateEvent(v) {
  const o = isObj(v) ? v : {}; const errors = [];
  if (!EVENTS.includes(o.event)) errors.push({ field: 'event', message: `event must be one of ${EVENTS.join(', ')}` });
  if (!str(o.build?.id).trim()) errors.push({ field: 'build.id', message: 'build.id is missing' });
  if (!iso(o.at)) errors.push({ field: 'at', message: 'at is missing or not a date' });
  return { ok: !errors.length, errors };
}

/** A shipped ref that is new or moved on (another manifest id or rev) since `before`. */
const newShipped = (a, b) => { const x = normShippedRef(a?.shipped); if (!x) return null; const y = normShippedRef(b?.shipped); return y && y.id === x.id && y.rev === x.rev ? null : x; };
const isCancel = (b) => !!b && (b.deleted === true || (b.status === 'archived' && !iso(b.mergedAt)));
const origins = (b) => {
  const o = isObj(b?.origin) ? b.origin : null; if (!o) return [];
  return [normPrompt(o, 0), ...list(o.addenda).map((a, i) => normPrompt(a, i + 1))].filter(Boolean);
};

/**
 * One builds store change → its events. `change` = { op: add | change | delete | restore, before, after } as
 * builds-store-core `diffStores` and the journal lines give it (before/after may be compact builds).
 */
export function eventsFromChange(change, { at = '', by = 'cli' } = {}) {
  const c = isObj(change) ? change : {};
  const a = isObj(c.after) ? c.after : null; const b = isObj(c.before) ? c.before : null;
  const cur = a || b; if (!cur || !str(cur.id)) return [];
  const when = iso(at) || iso(cur.updatedAt) || iso(cur.createdAt);
  const ref = normBuildRef(cur);
  const out = [];
  const push = (event, extra = {}) => { const e = normEvent({ event, at: when, by, build: ref, ...extra }); if (e) out.push(e); };
  // a delete that carries no `after` (an older journal line, a foreign writer): the build is gone, say so once
  if (!a) { if (!isCancel(b)) push('cancelled', { from: str(b.status, 20), to: 'deleted' }); return out; }
  const prompts = origins(a);
  if (!b || c.op === 'add') {
    push('created', { steps: list(a.steps), prompt: prompts[0] || null, to: ref.status });
    for (const p of prompts.slice(1)) push('addendum', { prompt: p, id: eventId(ref.id, ref.rev, 'addendum', String(p.index)) });
    if (isCancel(a)) push('cancelled', { from: '', to: a.deleted ? 'deleted' : a.status });
    else if (prNumber(a.pr)) push(iso(a.mergedAt) ? 'pr-merged' : 'pr-opened');
    const sh = newShipped(a, null); if (sh) push('shipped', { shipped: sh });
    return out;
  }
  const wasCancel = isCancel(b); const nowCancel = isCancel(a);
  if (nowCancel && !wasCancel) { push('cancelled', { from: b.status, to: a.deleted ? 'deleted' : a.status }); return out; }
  if (wasCancel && !nowCancel) push('restored', { from: b.deleted ? 'deleted' : b.status, to: a.status });
  const old = new Map(list(b.steps).map((s) => [str(s.uid) || str(s.id), s]));
  const added = list(a.steps).filter((s) => !old.has(str(s.uid) || str(s.id)));
  if (added.length) push('steps-added', { steps: added });
  for (const s of list(a.steps)) { const x = old.get(str(s.uid) || str(s.id)); if (x && !x.done && s.done) push('step-done', { steps: [s] }); }
  const before = origins(b).length; for (const p of prompts.slice(Math.max(1, before))) push('addendum', { prompt: p, id: eventId(ref.id, ref.rev, 'addendum', String(p.index)) });
  if (!before && prompts[0]) push('addendum', { prompt: prompts[0], id: eventId(ref.id, ref.rev, 'addendum', '0') });
  if (str(b.status) !== str(a.status)) push('status', { from: str(b.status), to: str(a.status) });
  if (prNumber(a.pr) && prNumber(a.pr) !== prNumber(b.pr)) push('pr-opened');
  if (iso(a.mergedAt) && !iso(b.mergedAt)) push('pr-merged');
  const sh = newShipped(a, b); if (sh) push('shipped', { shipped: sh });
  return out;
}

/** Every event of a run of journal lines (builds@1 journal: { rev, at, by, builds: [{ id, op, before, after }] }). */
export function eventsFromJournal(lines) {
  const out = []; const seen = new Set();
  for (const l of list(lines)) for (const c of list(l?.builds)) for (const e of eventsFromChange(c, { at: l.at, by: l.by })) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out;
}

export const REGISTRY = Object.freeze({ schema: SCHEMA, record: RECORD, version: VERSION, events: EVENTS, buildStatuses: BUILD_STATUSES, repos: REPOS, githubRepos: GITHUB_REPOS, stepModels: STEP_MODELS });

export function jsonSchemas() {
  const step = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, uid: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, model: { enum: STEP_MODELS }, done: { type: 'boolean' }, doneAt: { type: 'string' } } };
  return {
    'build-event.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/build-event.schema.json',
      title: 'build-event@1 (build-hook@1 record)', type: 'object', additionalProperties: false, required: ['event', 'build', 'at'],
      properties: {
        $axf: { const: RECORD }, id: { type: 'string' }, event: { enum: EVENTS }, at: { type: 'string', format: 'date-time' }, by: { type: 'string' },
        build: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, profile: { type: 'string' }, profiles: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, category: { type: 'string' }, status: { enum: BUILD_STATUSES }, branch: { type: 'string' }, pr: { type: 'integer' }, mergedAt: { type: 'string' }, createdAt: { type: 'string' }, rev: { type: 'integer' }, repo: { enum: REPOS } } },
        from: { type: 'string' }, to: { type: 'string' }, steps: { type: 'array', items: step },
        prompt: { type: ['object', 'null'], properties: { said: { type: 'string' }, at: { type: 'string' }, source: { type: 'string' }, session: { type: 'string' }, link: { type: 'string' }, verbatim: { type: 'boolean' }, index: { type: 'integer' } } },
        shipped: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, rev: { type: 'integer', minimum: 1 }, at: { type: 'string' }, landedCommit: { type: 'string' } } },
      },
    },
  };
}
