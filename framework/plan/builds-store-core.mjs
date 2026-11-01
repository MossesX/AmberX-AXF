/**
 * builds-store-core — the one builds store (builds@1), pure and IO-free. Brett, Oct 31 2026 (master cleanup): the
 * same builds lived in ~7 places (each profile's orchestrator.json, pending.json, build-queue.json, plan epics …) and
 * drifted; Refactor's queue was wiped on every console boot while Main survived. Now there is ONE store, owned by
 * the Build orchestrator, and every older list is a projection of it:
 *
 *   orchestrator@1  = projectOrchestrator(store, profile)   (the orchestrator's builds + steps, in order)
 *   pending@1       = projectPending(store, profile)        (Pending = a status of a build, not a copy)
 *   build-queue@1   = projectQueue(store, profile)          (the queue = the order field of plan-epic builds)
 *
 * and every writer applies its change to the projection, then absorbs it back (absorbOrchestrator / absorbPending /
 * absorbQueue), so the old tools, the console, the CLI and the MCP tools all keep working on one set of records.
 *
 * Store shape:
 *   { $axf: 'builds@1', rev, updatedAt, migratedAt, rules: { <profile>: orchestrator rules },
 *     meta: { queue: { <profile>: { dirty, updatedAt, history } }, pending: { <profile>: { artifact, updatedAt } } },
 *     drafts: { <profile>: { ops: [Op…], updatedAt, by } },
 *     builds: [BuildRecord…] }
 *
 *   BuildRecord = every orchestrator@1 build field (id, title, category, detail, status, hidden, source, pendingId,
 *     branch, pr, createdAt, updatedAt, builtAt, notes, approvals, steps) plus
 *     profiles: [profileId…]      the profiles it belongs to (a field, never a copy; one record shown in each)
 *     order: { <profile>: n }     its place in that profile's list (the build queue = this order for plan epics)
 *     kind: 'build' | 'epic'      epic = a plan epic from the build queue (planRef = its plan feature id)
 *     rev                          bumped on every change to the record (the journal keeps every revision)
 *     deleted, deletedAt           soft delete: nothing is ever dropped from the store
 *     pending                      what only the Pending list knew (model, its own status, estimate, source, planId,
 *                                  step dates, whether steps carry a [Model] prefix) or null
 *     queue                        the build-queue record of an epic (completedAt, deps, rework, estimate …) or null
 *     defaultSteps, defaultAt      the build's DEFAULT breakdown (Restore default); follows orchestrator edits until
 *                                  the Steps view rearranges the build (rearranged: true), then it stays put
 *     removedSteps                 steps taken out (removed, divided, harvested away), kept with why and when
 *     legacy                       where the record came from in the migration ({ file, profile, id })
 *     copies                       other copies of the same build found during the migration, kept verbatim
 *
 *   StepRecord = orchestrator@1 step fields (id, text, model, why, phase, group, estimate, files, checks, session,
 *     agent, skip, done, doneAt, note) plus uid (never changes, also across a harvest), title (rename; shown instead
 *     of the text when set), rev, createdAt, updatedAt, origin ({ build, step } it was harvested or divided from).
 *
 * Ids never change: renaming changes title only, so links, PRs and history keep pointing at the same record.
 */

export const SCHEMA = 'builds@1';
export const MODELS = ['Fable', 'Opus'];
export const STATUSES = ['pending', 'running', 'waiting', 'blocked', 'failed', 'complete', 'archived'];
export const DEFAULT_RULES = { sameSession: true, subAgents: false, approveModelSwitch: true, maxStepMinutes: 30 };
export const BASE_PROFILE = 'main-framework';

const PREFIX = /^\[(Fable|Opus|Sonnet)\]\s*/;
const str = (v, max = 8000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const plain = (t) => str(t).replace(PREFIX, '').trim();
const stepModel = (m) => (m === 'Fable' ? 'Fable' : 'Opus');
const clone = (o) => JSON.parse(JSON.stringify(o));
const nowIso = () => new Date().toISOString();
export const slug = (t) => str(t, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'build';
const ORCH_BUILD_KEYS = ['id', 'title', 'category', 'detail', 'status', 'hidden', 'source', 'pendingId', 'branch', 'pr', 'createdAt', 'updatedAt', 'builtAt', 'notes', 'approvals', 'steps'];
const ORCH_STEP_KEYS = ['id', 'text', 'model', 'why', 'phase', 'group', 'estimate', 'files', 'checks', 'session', 'agent', 'skip', 'done', 'doneAt', 'note'];

// ------------------------------------------------------------------ records

let uidSeq = 0;
/** A step uid: unique, stable, short. Deterministic when `seed` is given (migration), so a re-run gives the same ids. */
export function newUid(seed) {
  if (seed) return `st-${hash(seed)}`;
  uidSeq += 1;
  return `st-${Date.now().toString(36)}${(uidSeq % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export function normStep(s, i = 0, ctx = {}) {
  const o = s && typeof s === 'object' ? s : {};
  const at = ctx.now || nowIso();
  return {
    id: str(o.id, 40) || `s${i + 1}`,
    uid: str(o.uid, 60) || newUid(ctx.seed ? `${ctx.seed}/${str(o.id, 40) || i}/${i}` : ''),
    title: str(o.title, 200),
    text: str(o.text, 2000),
    model: MODELS.includes(o.model) ? o.model : 'Opus',
    why: str(o.why, 300),
    phase: str(o.phase, 80),
    group: str(o.group, 80),
    estimate: str(o.estimate, 20),
    files: Array.isArray(o.files) ? o.files.map((f) => str(f, 300)).filter(Boolean).slice(0, 30) : [],
    checks: Array.isArray(o.checks) ? o.checks.map((f) => str(f, 300)).filter(Boolean).slice(0, 20) : [],
    session: o.session === 'new' ? 'new' : 'same',
    agent: o.agent === true,
    skip: o.skip === true,
    done: o.done === true,
    doneAt: o.done === true ? str(o.doneAt, 40) : '',
    note: str(o.note, 1000),
    ...(str(o.fm).trim() ? { fm: str(o.fm, 80).trim() } : {}),
    rev: Number.isInteger(o.rev) && o.rev > 0 ? o.rev : 1,
    createdAt: str(o.createdAt, 40) || at,
    updatedAt: str(o.updatedAt, 40) || at,
    ...(o.origin && typeof o.origin === 'object' ? { origin: { build: str(o.origin.build, 80), step: str(o.origin.step, 60), how: str(o.origin.how, 20) } } : {}),
  };
}

export function normBuild(b, ctx = {}) {
  const o = b && typeof b === 'object' ? b : {};
  const at = ctx.now || nowIso();
  const id = str(o.id, 80) || slug(o.title);
  const steps = (Array.isArray(o.steps) ? o.steps : []).map((s, i) => normStep(s, i, { ...ctx, seed: ctx.seed ? `${ctx.seed}/${id}` : '' }));
  const seen = new Set();
  steps.forEach((s, i) => { if (seen.has(s.id)) s.id = `s${i + 1}-${i}`; seen.add(s.id); });
  const profiles = [...new Set((Array.isArray(o.profiles) ? o.profiles : [o.profile || ctx.profile || BASE_PROFILE]).map((p) => str(p, 40)).filter(Boolean))];
  const order = {};
  for (const p of profiles) order[p] = Number.isFinite(o.order?.[p]) ? o.order[p] : (Number.isFinite(ctx.order) ? ctx.order : 0);
  return {
    id,
    title: str(o.title, 300) || 'Untitled build',
    category: str(o.category, 60),
    detail: str(o.detail, 8000),
    status: STATUSES.includes(o.status) ? o.status : 'pending',
    hidden: o.hidden === true,
    source: str(o.source, 40) || 'console',
    pendingId: str(o.pendingId, 80),
    branch: str(o.branch, 200),
    pr: str(o.pr, 200),
    createdAt: str(o.createdAt, 40) || at,
    updatedAt: str(o.updatedAt, 40) || at,
    builtAt: o.status === 'complete' ? str(o.builtAt, 40) : '',
    notes: (Array.isArray(o.notes) ? o.notes : []).map((n) => ({ text: str(n?.text, 2000), at: str(n?.at, 40) })).filter((n) => n.text),
    approvals: (Array.isArray(o.approvals) ? o.approvals : []).map((a) => ({ phase: Number(a?.phase) || 0, from: str(a?.from, 10), to: str(a?.to, 10), at: str(a?.at, 40) })),
    steps,
    profiles,
    order,
    kind: o.kind === 'epic' ? 'epic' : 'build',
    planRef: str(o.planRef, 80),
    rev: Number.isInteger(o.rev) && o.rev > 0 ? o.rev : 1,
    deleted: o.deleted === true,
    deletedAt: o.deleted === true ? str(o.deletedAt, 40) : '',
    pending: o.pending && typeof o.pending === 'object' ? clone(o.pending) : null,
    queue: o.queue && typeof o.queue === 'object' ? clone(o.queue) : null,
    defaultSteps: Array.isArray(o.defaultSteps) ? o.defaultSteps.map((s, i) => normStep(s, i, ctx)) : steps.map((s) => ({ ...s })),
    defaultAt: str(o.defaultAt, 40) || (steps.length ? at : ''),
    rearranged: o.rearranged === true,
    removedSteps: Array.isArray(o.removedSteps) ? o.removedSteps.map((r) => ({ step: normStep(r?.step, 0, ctx), at: str(r?.at, 40), why: str(r?.why, 300), by: str(r?.by, 80) })) : [],
    legacy: Array.isArray(o.legacy) ? o.legacy.map((l) => ({ file: str(l?.file, 300), profile: str(l?.profile, 40), id: str(l?.id, 80) })) : [],
    copies: Array.isArray(o.copies) ? clone(o.copies) : [],
  };
}

export function emptyStore(now = nowIso()) {
  return { $axf: SCHEMA, rev: 0, updatedAt: now, migratedAt: '', rules: {}, meta: { queue: {}, pending: {} }, drafts: {}, builds: [] };
}
export function normalizeStore(s) {
  const o = s && typeof s === 'object' ? s : {};
  const e = emptyStore(str(o.updatedAt, 40) || nowIso());
  return {
    ...e,
    rev: Number.isInteger(o.rev) ? o.rev : 0,
    migratedAt: str(o.migratedAt, 40),
    rules: o.rules && typeof o.rules === 'object' ? clone(o.rules) : {},
    meta: { queue: clone(o.meta?.queue ?? {}), pending: clone(o.meta?.pending ?? {}) },
    drafts: o.drafts && typeof o.drafts === 'object' ? clone(o.drafts) : {},
    builds: (Array.isArray(o.builds) ? o.builds : []).map((b) => normBuild(b)),
  };
}

// ------------------------------------------------------------------ store self-check (builds@1)

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
/**
 * Is this a builds@1 store? `normalizeStore` coerces anything into shape and never says what was wrong; this names it,
 * so a corrupt or hand-edited store is caught (builds-store.mjs verify, check-builds-store, CI) instead of silently
 * "repaired". Checks what the normalizer promises plus the invariants: unique build ids, unique live step uids across the
 * store (a harvested step keeps its uid and leaves its source), an order in every profile a build belongs to, and only
 * Fable / Opus steps (model policy). Returns { ok, errors: [{ path, message }] }.
 */
export function validateStore(store) {
  const errors = []; const err = (path, message) => { errors.push({ path, message }); };
  if (!store || typeof store !== 'object' || Array.isArray(store)) return { ok: false, errors: [{ path: 'store', message: 'the store must be a JSON object' }] };
  if (store.$axf !== SCHEMA) err('$axf', `must be "${SCHEMA}"`);
  if (!Number.isInteger(store.rev) || store.rev < 0) err('rev', 'must be a whole number');
  if (store.updatedAt && !ISO.test(store.updatedAt)) err('updatedAt', 'is not an ISO timestamp');
  for (const k of ['rules', 'meta', 'drafts']) if (store[k] !== undefined && (typeof store[k] !== 'object' || store[k] === null || Array.isArray(store[k]))) err(k, 'must be an object');
  if (!Array.isArray(store.builds)) { err('builds', 'must be a list'); return { ok: false, errors }; }
  const ids = new Set(); const uids = new Map();
  store.builds.forEach((b, i) => {
    const at = `builds[${i}]${typeof b?.id === 'string' ? `(${b.id})` : ''}`;
    if (!b || typeof b !== 'object') return err(at, 'must be an object');
    if (typeof b.id !== 'string' || !BUILD_ID.test(b.id)) err(`${at}.id`, 'is missing or not an id');
    else if (ids.has(b.id)) err(`${at}.id`, `"${b.id}" appears twice (one record per build)`); else ids.add(b.id);
    if (typeof b.title !== 'string' || !b.title.trim()) err(`${at}.title`, 'is missing');
    if (!STATUSES.includes(b.status)) err(`${at}.status`, `"${b.status}" is not one of ${STATUSES.join(', ')}`);
    if (!Array.isArray(b.profiles) || !b.profiles.length || b.profiles.some((p) => typeof p !== 'string' || !p)) err(`${at}.profiles`, 'needs at least one profile id');
    else for (const p of b.profiles) if (!Number.isFinite(b.order?.[p])) err(`${at}.order.${p}`, 'is missing: a build has an order in every profile it belongs to');
    if (b.kind !== 'build' && b.kind !== 'epic') err(`${at}.kind`, 'must be build or epic');
    if (!Number.isInteger(b.rev) || b.rev < 1) err(`${at}.rev`, 'must be a whole number from 1');
    for (const k of ['createdAt', 'updatedAt']) if (typeof b[k] !== 'string' || !ISO.test(b[k])) err(`${at}.${k}`, 'is not an ISO timestamp');
    if (b.deleted === true && !ISO.test(b.deletedAt ?? '')) err(`${at}.deletedAt`, 'a deleted build says when');
    if (!Array.isArray(b.notes) || b.notes.some((n) => !n || typeof n.text !== 'string')) err(`${at}.notes`, 'must be a list of { text, at }');
    if (!Array.isArray(b.steps)) return err(`${at}.steps`, 'must be a list');
    const sids = new Set();
    b.steps.forEach((s, j) => {
      const sa = `${at}.steps[${j}]`;
      if (!s || typeof s !== 'object') return err(sa, 'must be an object');
      if (typeof s.id !== 'string' || !s.id) err(`${sa}.id`, 'is missing'); else if (sids.has(s.id)) err(`${sa}.id`, `"${s.id}" appears twice in the build`); else sids.add(s.id);
      if (typeof s.uid !== 'string' || !s.uid) err(`${sa}.uid`, 'is missing'); else if (uids.has(s.uid)) err(`${sa}.uid`, `"${s.uid}" is also a live step of ${uids.get(s.uid)}`); else uids.set(s.uid, at);
      if (!MODELS.includes(s.model)) err(`${sa}.model`, `"${s.model}" is not one of ${MODELS.join(', ')} (model policy: Opus or Fable, never Sonnet)`);
      if (typeof s.text !== 'string' || !s.text.trim()) err(`${sa}.text`, 'is missing');
      if (!Number.isInteger(s.rev) || s.rev < 1) err(`${sa}.rev`, 'must be a whole number from 1');
    });
  });
  return { ok: !errors.length, errors };
}

/** The form written to disk: the default breakdown is left out while it equals the steps (not rearranged). */
export function compactStore(store) {
  return { ...store, builds: store.builds.map(compactBuild) };
}
export function compactBuild(b) {
  if (!b || b.rearranged) return b;
  const { defaultSteps, ...rest } = b;
  return rest;
}

/** Builds of one profile (not deleted), in that profile's order. */
export function buildsOf(store, profile, { withDeleted = false } = {}) {
  return store.builds.filter((b) => b.profiles.includes(profile) && (withDeleted || !b.deleted))
    .sort((a, b) => (a.order[profile] ?? 0) - (b.order[profile] ?? 0) || (a.createdAt < b.createdAt ? -1 : 1));
}
const nextOrder = (store, profile) => buildsOf(store, profile, { withDeleted: true }).reduce((m, b) => Math.max(m, b.order[profile] ?? 0), -1) + 1;
export const findBuild = (store, id) => store.builds.find((b) => b.id === id) ?? store.builds.find((b) => b.pendingId && b.pendingId === id) ?? null;

/** A record's content without bookkeeping, to tell whether a write really changed it. */
const content = (b) => JSON.stringify({ ...b, rev: 0, updatedAt: '', steps: b.steps.map((s) => ({ ...s, rev: 0, updatedAt: '' })), defaultSteps: b.defaultSteps.map((s) => ({ ...s, rev: 0, updatedAt: '' })) });
const stepContent = (s) => JSON.stringify({ ...s, rev: 0, updatedAt: '' });

/**
 * Compare two stores: which builds were added, changed or deleted. Bumps rev on changed builds and steps in `after`
 * (in place) and returns the journal changes [{ id, op, before, after }]. The IO layer appends them to the journal.
 */
export function diffStores(before, after, now = nowIso()) {
  const old = new Map(before.builds.map((b) => [b.id, b]));
  const changes = [];
  for (const b of after.builds) {
    const o = old.get(b.id);
    if (!o) { changes.push({ id: b.id, op: 'add', before: null, after: b }); continue; }
    if (content(o) === content(b)) continue;
    const os = new Map(o.steps.map((s) => [s.uid, s]));
    for (const s of b.steps) { const x = os.get(s.uid); if (x && stepContent(x) !== stepContent(s)) { s.rev = x.rev + 1; s.updatedAt = now; } }
    b.rev = o.rev + 1;
    changes.push({ id: b.id, op: b.deleted && !o.deleted ? 'delete' : !b.deleted && o.deleted ? 'restore' : 'change', before: o, after: b });
  }
  for (const o of before.builds) if (!after.builds.some((b) => b.id === o.id)) {
    // never drop a record: put it back, soft-deleted
    const keep = { ...clone(o), deleted: true, deletedAt: now, rev: o.rev + 1 };
    after.builds.push(keep);
    changes.push({ id: o.id, op: 'delete', before: o, after: keep });
  }
  return changes;
}

// ------------------------------------------------------------------ status helpers

/** Pending status for a build. */
export function pendingStatusOf(b) {
  const own = b.pending?.status;
  if (b.status === 'archived') return own || 'complete';
  if (b.status === 'complete') return 'complete';
  if (b.status === 'failed') return 'failed';
  if (b.status === 'blocked' && (own === 'unsafe' || own === 'broken')) return own;
  return 'pending';
}
export function orchStatusOfPending(st) {
  return { complete: 'complete', failed: 'failed', broken: 'blocked', unsafe: 'blocked' }[st] ?? null;
}
const PLAN_TO_STATUS = { built: 'complete', 'in-progress': 'running', partial: 'running', planned: 'pending', placeholder: 'pending', blocked: 'blocked', dropped: 'archived' };
export const statusOfPlan = (s) => PLAN_TO_STATUS[s] ?? 'pending';

// ------------------------------------------------------------------ progress (live progress bars)

export function buildProgress(b) {
  const steps = b.steps.filter((s) => !s.skip);
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  const finished = ['complete', 'archived'].includes(b.status);
  const pct = total ? Math.round((done / total) * 100) : finished ? 100 : 0;
  const active = b.status === 'running' || (done > 0 && done < total && !finished);
  return { total, done, pct, active, status: b.status };
}
/** One profile's progress: steps done over all steps of builds still on the list (archived builds left out). */
export function profileProgress(store, profile) {
  const list = buildsOf(store, profile).filter((b) => b.status !== 'archived');
  let total = 0; let done = 0; let active = false; let complete = 0;
  for (const b of list) {
    const p = buildProgress(b);
    if (p.total) { total += p.total; done += p.done; } else { total += 1; done += b.status === 'complete' ? 1 : 0; }
    if (p.active) active = true;
    if (b.status === 'complete') complete += 1;
  }
  return { builds: list.length, complete, total, done, pct: total ? Math.round((done / total) * 100) : 0, active };
}

// ------------------------------------------------------------------ orchestrator@1 projection

const orchStep = (s) => { const o = {}; for (const k of ORCH_STEP_KEYS) o[k] = s[k]; o.uid = s.uid; if (s.title) o.title = s.title; return o; };
const orchBuild = (b) => { const o = {}; for (const k of ORCH_BUILD_KEYS) o[k] = k === 'steps' ? b.steps.map(orchStep) : clone(b[k]); return o; };

export function projectOrchestrator(store, profile) {
  return { $axf: 'orchestrator@1', updatedAt: store.updatedAt, rules: { ...DEFAULT_RULES, ...(store.rules[profile] ?? {}) }, builds: buildsOf(store, profile).map(orchBuild) };
}

/** Steps of an updated build: matched to the old records by uid, else id, else text; unmatched old ones are kept as removed. */
function mergeSteps(rec, incoming, now, by, why) {
  const byUid = new Map(rec.steps.map((s) => [s.uid, s]));
  const byId = new Map(rec.steps.map((s) => [s.id, s]));
  const used = new Set();
  const out = incoming.map((x, i) => {
    const old = (x.uid && byUid.get(x.uid)) || (!used.has(byId.get(x.id)?.uid) && byId.get(x.id)) || rec.steps.find((s) => !used.has(s.uid) && plain(s.text) === plain(x.text)) || null;
    if (old) used.add(old.uid);
    const base = old ?? { uid: newUid(), createdAt: now };
    return normStep({ ...base, ...x, uid: base.uid, title: x.title ?? base.title, origin: base.origin, rev: base.rev, createdAt: base.createdAt, updatedAt: base.updatedAt, fm: x.fm ?? base.fm }, i);
  });
  for (const s of rec.steps) if (!used.has(s.uid)) rec.removedSteps.push({ step: s, at: now, why, by });
  rec.steps = out;
}

/** Follow orchestrator edits in the default snapshot until the Steps view has rearranged the build. */
function followDefault(rec, now) { if (!rec.rearranged) { rec.defaultSteps = rec.steps.map((s) => ({ ...s })); rec.defaultAt = rec.steps.length ? (rec.defaultAt || now) : ''; } }

/** Take an orchestrator@1 state (after a change) back into the store for one profile. */
export function absorbOrchestrator(store, profile, orch, { now = nowIso(), by = 'orchestrator', newerOnly = false } = {}) {
  const s = clone(store);
  if (orch.rules && !newerOnly) s.rules[profile] = { ...DEFAULT_RULES, ...orch.rules };
  const ids = new Set();
  (orch.builds ?? []).forEach((ob, i) => {
    ids.add(ob.id);
    let rec = s.builds.find((b) => b.id === ob.id);
    // a file written outside the store (an old checkout, a merge): only builds it has NEWER than the store come in
    if (newerOnly && rec && !(str(ob.updatedAt) > str(rec.updatedAt))) return;
    if (!rec) {
      rec = normBuild({ ...ob, profiles: [profile], order: { [profile]: nextOrder(s, profile) } }, { now });
      rec.steps = ob.steps.map((x, k) => normStep({ ...x, uid: x.uid || newUid() }, k, { now }));
      rec.defaultSteps = rec.steps.map((x) => ({ ...x })); rec.defaultAt = rec.steps.length ? now : '';
      s.builds.push(rec);
      return;
    }
    if (rec.deleted) { rec.deleted = false; rec.deletedAt = ''; }
    if (!rec.profiles.includes(profile)) { rec.profiles.push(profile); rec.order[profile] = nextOrder(s, profile); }
    for (const k of ORCH_BUILD_KEYS) if (k !== 'steps' && k !== 'id' && ob[k] !== undefined) rec[k] = clone(ob[k]);
    mergeSteps(rec, ob.steps ?? [], now, by, 'removed in the orchestrator');
    followDefault(rec, now);
    if (!newerOnly) rec.order[profile] = i;
  });
  // the projection's order is the profile's new order; builds not in the projection were removed there
  // (never for a foreign file: it may simply be older than the store)
  if (!newerOnly) for (const b of buildsOf(s, profile)) if (!ids.has(b.id)) {
    if (b.profiles.length > 1) { b.profiles = b.profiles.filter((p) => p !== profile); delete b.order[profile]; }
    else { b.deleted = true; b.deletedAt = now; }
  }
  renumber(s, profile);
  s.updatedAt = now;
  return s;
}

function renumber(s, profile) { buildsOf(s, profile).forEach((b, i) => { b.order[profile] = i; }); }

// ------------------------------------------------------------------ pending@1 projection

/** The pending item that shows build `b` (pending = a status of the build). */
export function itemOfBuild(b, now = nowIso()) {
  const p = b.pending ?? {};
  const prefix = p.prefixSteps !== false;
  const status = pendingStatusOf(b);
  const next = b.steps.find((s) => !s.done && !s.skip) ?? b.steps[b.steps.length - 1];
  const at = p.stepAt ?? {};
  const item = {
    id: b.pendingId || b.id, title: b.title, detail: b.detail,
    model: p.model === 'Sonnet' && !b.steps.length ? 'Sonnet' : next ? stepModel(next.model) : (p.model || 'Opus'),
    status,
    notes: b.notes.map((n) => ({ text: n.text, at: n.at })), // a note without a date keeps none (exports stay byte-stable)
    subPrompts: b.steps.map((s) => ({
      text: prefix ? `[${stepModel(s.model)}] ${plain(s.text)}` : s.text,
      at: at[s.uid] ?? (s.createdAt || b.createdAt || now),
      ...(s.estimate ? { estimate: s.estimate } : {}),
      ...(s.done ? { done: true, doneAt: s.doneAt || b.updatedAt || now } : {}),
      ...(s.skip ? { skip: true } : {}),
      ...(s.fm ? { fm: s.fm } : {}),
    })),
    createdAt: p.createdAt || b.createdAt || now,
    builtAt: status === 'complete' ? (b.builtAt || p.builtAt || b.updatedAt || now) : '',
    updatedAt: b.updatedAt || now,
    source: p.source || b.source || 'console',
  };
  if (p.planId || b.planRef) item.planId = p.planId || b.planRef;
  if (p.estimate) item.estimate = p.estimate;
  return item;
}

/** JSON with sorted keys: two items are the same whatever order their fields were written in. */
function canon(v) { return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x)); }

/** Which builds the Pending list shows: every build of the profile except plan epics with no pending record and recovered ones. */
const onPendingList = (b) => (b.kind !== 'epic' || !!b.pending) && !b.pending?.recovered; // recovered-from-history builds stay archived, off the list

export function projectPending(store, profile) {
  const m = store.meta.pending?.[profile] ?? {};
  return { $axf: 'pending@1', updatedAt: m.updatedAt || store.updatedAt, artifact: m.artifact || '', items: buildsOf(store, profile).filter(onPendingList).map((b) => itemOfBuild(b)) };
}

/** A build made from a pending item (migration and new items added on the Pending side). */
export function buildFromItem(it, profile, { now = nowIso(), seed = '', order = 0, file = '' } = {}) {
  const done = it.status === 'complete';
  const subs = Array.isArray(it.subPrompts) ? it.subPrompts : [];
  const prefixSteps = subs.some((p) => PREFIX.test(str(p.text)));
  const b = normBuild({
    id: it.id, title: it.title, detail: it.detail, status: orchStatusOfPending(it.status) ?? 'pending', source: it.source || 'pending', pendingId: it.id,
    createdAt: it.createdAt || now, updatedAt: it.updatedAt || now, builtAt: done ? it.builtAt || now : '', notes: it.notes ?? [],
    profiles: [profile], order: { [profile]: order },
    steps: subs.map((p, k) => ({
      id: `s${k + 1}`, text: prefixSteps ? plain(p.text) : str(p.text), model: stepModel(PREFIX.exec(str(p.text))?.[1] ?? it.model), estimate: str(p.estimate),
      done: p.done === true, doneAt: p.done === true ? p.doneAt || it.builtAt || now : '', skip: p.skip === true, fm: p.fm,
      createdAt: p.at || it.createdAt || now,
    })),
  }, { now, seed: seed ? `${seed}/pending` : '' });
  b.pending = pendingMeta(it, b, prefixSteps);
  if (file) b.legacy.push({ file, profile, id: it.id });
  return b;
}
function pendingMeta(it, b, prefixSteps) {
  const stepAt = {};
  (it.subPrompts ?? []).forEach((p, k) => { if (b.steps[k]) stepAt[b.steps[k].uid] = str(p.at); }); // '' kept: the item had no date
  return {
    model: MODELS.includes(it.model) || it.model === 'Sonnet' ? it.model : 'Opus', status: str(it.status) || 'pending', estimate: str(it.estimate),
    source: str(it.source), planId: str(it.planId), createdAt: str(it.createdAt), builtAt: str(it.builtAt), prefixSteps, stepAt,
  };
}

/**
 * Take a pending@1 state (after a change) back into the store. `change` = the pending action applied (a removal
 * deletes the build softly). Items that equal their build's projection are left alone.
 */
export function absorbPending(store, profile, pending, change = null, { now = nowIso(), newerOnly = false } = {}) {
  const s = clone(store);
  const shown = new Map(buildsOf(s, profile).filter(onPendingList).map((b) => [b.pendingId || b.id, b]));
  if (pending.artifact !== undefined || pending.updatedAt) s.meta.pending[profile] = { artifact: str(pending.artifact), updatedAt: str(pending.updatedAt) };
  const seen = new Set();
  for (const it of pending.items ?? []) {
    seen.add(it.id);
    let b = shown.get(it.id) ?? s.builds.find((x) => x.id === it.id || x.pendingId === it.id);
    if (!b) { s.builds.push(buildFromItem(it, profile, { now, order: nextOrder(s, profile) })); continue; }
    if (newerOnly && !(str(it.updatedAt) > str(b.updatedAt))) continue;
    if (b.deleted) { b.deleted = false; b.deletedAt = ''; }
    if (!b.profiles.includes(profile)) { b.profiles.push(profile); b.order[profile] = nextOrder(s, profile); }
    const shownItem = itemOfBuild(b, now);
    if (canon(shownItem) === canon(it)) continue;
    const prefix = b.pending?.prefixSteps ?? (it.subPrompts ?? []).some((p) => PREFIX.test(str(p.text)));
    b.title = str(it.title, 300) || b.title;
    b.detail = str(it.detail, 8000);
    if (it.status !== shownItem.status) { // only a real status change on the Pending side moves the build
      const st = orchStatusOfPending(it.status);
      if (st) { if (st !== b.status) { b.status = st; b.builtAt = st === 'complete' ? it.builtAt || now : ''; } }
      else if (['complete', 'failed', 'blocked', 'archived'].includes(b.status) && it.status === 'pending') { b.status = b.steps.some((x) => x.done) ? 'running' : 'pending'; b.builtAt = ''; }
    }
    const incoming = (it.subPrompts ?? []).map((p, k) => {
      const t = prefix ? plain(p.text) : str(p.text);
      const old = b.steps.find((x) => (prefix ? plain(x.text) : x.text) === t) ?? ((it.subPrompts.length === b.steps.length) ? b.steps[k] : null);
      return { ...(old ?? {}), id: old?.id ?? `s${b.steps.length + k + 1}`, text: t, model: stepModel(PREFIX.exec(str(p.text))?.[1] ?? old?.model ?? it.model), estimate: str(p.estimate) || old?.estimate || '', done: p.done === true, doneAt: p.done === true ? p.doneAt || old?.doneAt || now : '', skip: p.skip === true, fm: p.fm };
    });
    mergeSteps(b, incoming, now, 'pending', 'removed on the Pending list');
    followDefault(b, now);
    const notes = [...b.notes];
    for (const n of it.notes ?? []) if (n?.text && !notes.some((m) => m.text === n.text)) notes.push({ text: str(n.text, 2000), at: n.at || now });
    b.notes = (it.notes ?? []).length < notes.length && change?.action === 'remove-note' ? (it.notes ?? []).map((n) => ({ text: n.text, at: n.at })) : notes;
    const meta = pendingMeta(it, b, prefix);
    if (it.model === shownItem.model && b.pending?.model) meta.model = b.pending.model; // the shown model is derived from the next step
    if (it.status === shownItem.status && b.pending?.status) meta.status = b.pending.status;
    b.pending = { ...(b.pending ?? {}), ...meta };
    b.updatedAt = it.updatedAt || now;
    if (['pending', 'running', 'waiting'].includes(b.status) && b.steps.length && b.steps.every((x) => x.done || x.skip) && b.steps.some((x) => x.done)) { b.status = 'complete'; b.builtAt = b.builtAt || now; }
  }
  if (!newerOnly) for (const [id, b] of shown) if (!seen.has(id)) {
    if (b.profiles.length > 1) { b.profiles = b.profiles.filter((p) => p !== profile); delete b.order[profile]; }
    else { b.deleted = true; b.deletedAt = now; b.notes.push({ text: 'Removed from Pending builds (kept in the builds store, soft-deleted).', at: now }); }
  }
  s.updatedAt = now;
  return s;
}

// ------------------------------------------------------------------ build-queue@1 projection (plan epics)

export function projectQueue(store, profile) {
  const m = store.meta.queue?.[profile];
  if (!m) return null; // no queue yet: the queue core creates one (only when missing)
  const epics = buildsOf(store, profile).filter((b) => b.kind === 'epic' || b.queue);
  const steps = {};
  for (const b of epics) {
    const rec = { ...(b.queue ?? {}) };
    delete rec.steps;
    if (b.steps.length) rec.steps = b.steps.map((x) => ({ text: x.text, ...(x.estimate ? { estimate: x.estimate } : {}), ...(x.done ? { done: true, doneAt: x.doneAt } : {}), ...(x.skip ? { skip: true } : {}), ...(x.fm ? { fm: x.fm } : {}) }));
    if (Object.keys(rec).length) steps[b.planRef || b.id] = rec;
  }
  return { $axf: 'build-queue@1', order: epics.map((b) => b.planRef || b.id), steps, dirty: m.dirty === true, updatedAt: m.updatedAt || store.updatedAt, history: clone(m.history ?? []) };
}

/** A build for a plan epic (the queue's unit). */
export function buildFromEpic(f, profile, { now = nowIso(), order = 0, rec = null, seed = '', file = '' } = {}) {
  const b = normBuild({
    id: f.id, title: f.title || f.id, detail: f.summary || '', category: str(f.area, 60), status: statusOfPlan(f.status), source: 'plan', kind: 'epic', planRef: f.id,
    profiles: [profile], order: { [profile]: order }, createdAt: now, updatedAt: now,
    steps: (rec?.steps ?? []).map((x, k) => ({ id: `s${k + 1}`, text: x.text, estimate: x.estimate, done: x.done, doneAt: x.doneAt, skip: x.skip, fm: x.fm, model: f.model === 'fable' || f.model === 'Fable' ? 'Fable' : 'Opus' })),
  }, { now, seed: seed ? `${seed}/queue` : '' });
  if (b.status === 'complete') b.builtAt = rec?.completedAt && !rec.completedAt.startsWith('1970') ? rec.completedAt : '';
  b.queue = rec ? (({ steps, ...r }) => r)(rec) : {};
  if (file) b.legacy.push({ file, profile, id: f.id });
  return b;
}

/** Take a build-queue@1 state back into the store (features = the plan's, for new epics and their status). */
export function absorbQueue(store, profile, q, features = [], { now = nowIso() } = {}) {
  const s = clone(store);
  s.meta.queue[profile] = { dirty: q.dirty === true, updatedAt: str(q.updatedAt), history: clone(q.history ?? []) };
  const fById = new Map(features.map((f) => [f.id, f]));
  const epicsBefore = buildsOf(s, profile).filter((b) => b.kind === 'epic' || b.queue);
  const slots = epicsBefore.map((b) => b.order[profile]).sort((a, b) => a - b);
  const ordered = [];
  for (const id of q.order ?? []) {
    let b = s.builds.find((x) => (x.planRef || x.id) === id && (x.kind === 'epic' || x.queue));
    if (!b) { const f = fById.get(id); if (!f) continue; b = buildFromEpic(f, profile, { now, order: nextOrder(s, profile) }); s.builds.push(b); }
    if (!b.profiles.includes(profile)) { b.profiles.push(profile); b.order[profile] = nextOrder(s, profile); }
    ordered.push(b);
  }
  for (const b of epicsBefore) if (!ordered.includes(b)) ordered.push(b); // the queue never drops an epic
  let extra = slots.length ? slots[slots.length - 1] + 1 : nextOrder(s, profile);
  ordered.forEach((b, i) => { b.order[profile] = i < slots.length ? slots[i] : extra++; });
  for (const b of ordered) {
    const key = b.planRef || b.id;
    const rec = q.steps?.[key];
    const { steps: small, ...r } = rec ?? {};
    b.queue = Object.keys(r).length || b.queue ? r : b.queue;
    const incoming = (small ?? []).map((x, k) => ({ ...(b.steps[k] ?? {}), id: b.steps[k]?.id ?? `s${k + 1}`, text: str(x.text), estimate: str(x.estimate), done: x.done === true, doneAt: x.done ? x.doneAt || now : '', skip: x.skip === true, fm: x.fm }));
    if (JSON.stringify(incoming.map((x) => [x.text, x.estimate, x.done, x.skip])) !== JSON.stringify(b.steps.map((x) => [x.text, x.estimate, x.done, x.skip]))) { mergeSteps(b, incoming, now, 'build-queue', 'removed in the build queue'); followDefault(b, now); }
    const f = fById.get(key);
    if (f && b.kind === 'epic' && b.status !== 'archived') { const st = statusOfPlan(f.status); if (st !== b.status) { b.status = st; b.builtAt = st === 'complete' ? (r.completedAt && !r.completedAt.startsWith('1970') ? r.completedAt : now) : ''; } }
  }
  renumber(s, profile);
  s.updatedAt = now;
  return s;
}

// ------------------------------------------------------------------ migration (dry-run first)

/**
 * Build the store from every older data set. `sources` = { profiles: [{ id, orch, orchFile, pending: [{ file, state }],
 * queue, queueFile, features, history: [{ file, commit, items }] }] }. Nothing is lost:
 *   - every orchestrator build → a record (orchestrator wins for steps/status; it was the source of truth since Oct 27);
 *   - every pending item → merged into its build (same id or pendingId), else a record of its own; the Pending-only
 *     fields go to `pending`; a pending copy with more steps/notes is kept verbatim in `copies`;
 *   - repo and hub copies of the same pending list are unioned (the newer updatedAt wins on a clash, the other is kept);
 *   - the same build in several profiles → one record tagged with each profile (the newest copy wins, the rest in copies);
 *   - every build-queue epic → a record of kind epic with its queue record, or merged into the pending build that
 *     links it (planId);
 *   - items seen only in git history → records with status archived, tagged recovered (never active by surprise).
 * Returns { store, report } where report lists every merge, dedupe and conflict.
 */
export function migrate(sources, { now = nowIso() } = {}) {
  const store = emptyStore(now);
  store.migratedAt = now;
  const report = { at: now, profiles: [], merges: [], conflicts: [], recovered: [], counts: {} };
  const byId = new Map();
  const put = (b) => { store.builds.push(b); byId.set(b.id, b); };
  const tag = (b, profile) => { if (!b.profiles.includes(profile)) { b.profiles.push(profile); b.order[profile] = nextOrder(store, profile); } };
  const keepCopy = (b, from, data) => { b.copies.push({ from, data: clone(data) }); };

  for (const P of sources.profiles) {
    const pr = { id: P.id, orchestrator: 0, pendingItems: 0, pendingMerged: 0, pendingNew: 0, queueEpics: 0, queueMerged: 0, recovered: 0, files: [] };
    report.profiles.push(pr);
    if (P.orch?.rules) store.rules[P.id] = { ...DEFAULT_RULES, ...P.orch.rules };
    // 1. orchestrator builds
    for (const ob of P.orch?.builds ?? []) {
      pr.orchestrator += 1;
      const ex = byId.get(ob.id);
      if (ex) {
        tag(ex, P.id);
        const newer = str(ob.updatedAt) > str(ex.updatedAt);
        report.merges.push({ id: ob.id, what: `orchestrator build in ${P.id} and ${ex.legacy[0]?.profile}: one record in both profiles (${newer ? P.id : ex.legacy[0]?.profile} copy is newer and wins; the other is kept in copies)` });
        if (newer) {
          keepCopy(ex, ex.legacy[0]?.file, orchBuild(ex));
          const fresh = normBuild({ ...ob, profiles: ex.profiles, order: ex.order }, { now, seed: `${P.id}/orch` });
          Object.assign(ex, { ...fresh, copies: ex.copies, legacy: ex.legacy, profiles: ex.profiles, order: ex.order });
        } else keepCopy(ex, P.orchFile, ob);
        ex.legacy.push({ file: P.orchFile, profile: P.id, id: ob.id });
        continue;
      }
      const b = normBuild({ ...ob, profiles: [P.id], order: { [P.id]: nextOrder(store, P.id) } }, { now, seed: `${P.id}/orch` });
      if (ob.status && !STATUSES.includes(ob.status)) { b.notes.push({ text: `Status was "${ob.status}" in ${P.orchFile} (not an orchestrator@1 status; the orchestrator always read it as ${b.status}).`, at: now }); report.conflicts.push({ id: ob.id, profile: P.id, what: `status "${ob.status}" is not an orchestrator@1 status → ${b.status} (note added)` }); }
      b.legacy.push({ file: P.orchFile, profile: P.id, id: ob.id });
      put(b);
    }
    // 2. pending items: union of every copy (repo, hub), newer updatedAt first
    const items = new Map();
    for (const src of P.pending ?? []) {
      pr.files.push(`${src.file}: ${src.state?.items?.length ?? 0} item(s)`);
      if (src.state && !store.meta.pending[P.id]) store.meta.pending[P.id] = { artifact: str(src.state.artifact), updatedAt: str(src.state.updatedAt) };
      for (const it of src.state?.items ?? []) {
        const have = items.get(it.id);
        if (!have) { items.set(it.id, { it, file: src.file, others: [] }); continue; }
        if (JSON.stringify(have.it) === JSON.stringify(it)) continue;
        const newer = str(it.updatedAt) > str(have.it.updatedAt);
        report.conflicts.push({ id: it.id, profile: P.id, what: `pending item differs between ${have.file} and ${src.file}; ${newer ? src.file : have.file} is newer and wins, the other is kept in copies` });
        if (newer) items.set(it.id, { it, file: src.file, others: [...have.others, { file: have.file, it: have.it }] });
        else have.others.push({ file: src.file, it });
      }
    }
    for (const { it, file, others } of items.values()) {
      pr.pendingItems += 1;
      const b = byId.get(it.id) ?? store.builds.find((x) => x.pendingId === it.id);
      if (!b) {
        const nb = buildFromItem(it, P.id, { now, seed: P.id, order: nextOrder(store, P.id), file });
        for (const o of others) keepCopy(nb, o.file, o.it);
        put(nb); pr.pendingNew += 1; continue;
      }
      tag(b, P.id);
      pr.pendingMerged += 1;
      b.legacy.push({ file, profile: P.id, id: it.id });
      const meta = pendingMeta(it, b, (it.subPrompts ?? []).some((p) => PREFIX.test(str(p.text))));
      if (!b.pending) b.pending = meta; else b.pending = { ...meta, ...b.pending };
      // notes the orchestrator copy never had
      for (const n of it.notes ?? []) if (n?.text && !b.notes.some((m) => m.text === n.text)) b.notes.push({ text: str(n.text, 2000), at: str(n.at) || now });
      // steps: the orchestrator's win; a pending copy that differs is kept verbatim
      const subs = (it.subPrompts ?? []).map((p) => plain(p.text));
      const steps = b.steps.map((s) => plain(s.text));
      if (!b.steps.length && subs.length) {
        const nb = buildFromItem(it, P.id, { now, seed: P.id });
        b.steps = nb.steps; b.defaultSteps = nb.steps.map((s) => ({ ...s })); b.defaultAt = now; b.pending.stepAt = nb.pending.stepAt;
        report.merges.push({ id: b.id, what: `${P.id}: steps taken from the pending item (the orchestrator build had none)` });
      } else if (JSON.stringify(subs) !== JSON.stringify(steps)) {
        keepCopy(b, file, it);
        report.conflicts.push({ id: b.id, profile: P.id, what: `pending item's ${subs.length} step(s) differ from the orchestrator's ${steps.length}: orchestrator kept, pending copy saved in copies` });
      } else {
        // same steps: carry the pending side's ticks the orchestrator missed (never un-tick)
        (it.subPrompts ?? []).forEach((p, k) => { if (p.done && !b.steps[k].done) { b.steps[k].done = true; b.steps[k].doneAt = p.doneAt || now; report.merges.push({ id: b.id, what: `${P.id}: step ${k + 1} ticked on Pending only → ticked` }); } });
      }
      const pst = orchStatusOfPending(it.status);
      if (b.status !== 'archived' && pst && pst !== b.status && str(it.updatedAt) > str(b.updatedAt)) {
        report.conflicts.push({ id: b.id, profile: P.id, what: `status: orchestrator ${b.status}, pending ${it.status} (newer) → ${pst}` });
        b.status = pst; if (pst === 'complete') b.builtAt = it.builtAt || now;
      }
      for (const o of others) keepCopy(b, o.file, o.it);
    }
    // 3. build queue: plan epics in queue order
    const order = P.queue?.order ?? [];
    const fById = new Map((P.features ?? []).map((f) => [f.id, f]));
    if (P.queue) store.meta.queue[P.id] = { dirty: P.queue.dirty === true, updatedAt: str(P.queue.updatedAt), history: clone(P.queue.history ?? []) };
    const seenEpic = new Set();
    for (const id of [...order, ...Object.keys(P.queue?.steps ?? {})]) {
      if (seenEpic.has(id)) continue; seenEpic.add(id);
      pr.queueEpics += 1;
      const rec = P.queue?.steps?.[id] ?? null;
      const linked = store.builds.find((b) => b.profiles.includes(P.id) && (b.pending?.planId === id || b.planRef === id));
      if (linked) {
        linked.planRef = id; linked.queue = rec ? (({ steps, ...r }) => r)(rec) : {};
        if (rec?.steps?.length && !linked.steps.length) { const e = buildFromEpic(fById.get(id) ?? { id, title: id }, P.id, { now, rec, seed: P.id }); linked.steps = e.steps; linked.defaultSteps = e.steps.map((s) => ({ ...s })); }
        else if (rec?.steps?.length) keepCopy(linked, P.queueFile, { queueSteps: rec.steps });
        linked.legacy.push({ file: P.queueFile, profile: P.id, id });
        pr.queueMerged += 1;
        report.merges.push({ id: linked.id, what: `${P.id}: build-queue step ${id} is the same build (pending planId) → one record` });
        continue;
      }
      const f = fById.get(id) ?? { id, title: id, status: rec?.completedAt ? 'built' : 'planned' };
      if (!fById.get(id)) report.conflicts.push({ id, profile: P.id, what: 'queued step has no plan feature: kept with its id as the title' });
      const ex = byId.get(id);
      if (ex) { tag(ex, P.id); ex.queue = rec ? (({ steps, ...r }) => r)(rec) : {}; ex.planRef = id; ex.legacy.push({ file: P.queueFile, profile: P.id, id }); pr.queueMerged += 1; continue; }
      put(buildFromEpic(f, P.id, { now, order: nextOrder(store, P.id), rec, seed: P.id, file: P.queueFile }));
    }
  }
  // 4. git history (after every profile, so a build that lives elsewhere is never "recovered" twice)
  for (const P of sources.profiles) {
    const pr = report.profiles.find((x) => x.id === P.id);
    for (const h of P.history ?? []) for (const it of h.items ?? []) {
      if (byId.has(it.id) || store.builds.some((b) => b.pendingId === it.id)) continue;
      const b = buildFromItem(it, P.id, { now, seed: `${P.id}/history`, order: nextOrder(store, P.id), file: `${h.file}@${h.commit}` });
      b.notes.push({ text: `Recovered from git history (${h.file} at ${h.commit}); it was in no current list, so it is archived, not active. Reopen it if it is still wanted.`, at: now });
      b.pending.status = it.status; b.pending.recovered = true; b.status = 'archived';
      put(b); pr.recovered += 1; report.recovered.push({ id: it.id, profile: P.id, from: `${h.file}@${h.commit}`, title: it.title });
    }
  }
  for (const p of report.profiles) renumber(store, p.id);
  report.counts = { builds: store.builds.length, steps: store.builds.reduce((t, b) => t + b.steps.length, 0), byProfile: Object.fromEntries(report.profiles.map((p) => [p.id, buildsOf(store, p.id).length])) };
  return { store, report };
}

/**
 * Everything in the sources that must be in the store, as checkable facts: [{ what, ok }]. Used by the dry-run report,
 * the real migration and the tests (no data lost).
 */
export function verifyNothingLost(sources, store) {
  const out = [];
  const has = (id, profile) => store.builds.some((b) => (b.id === id || b.pendingId === id || b.planRef === id) && b.profiles.includes(profile));
  const recOf = (id) => store.builds.find((b) => b.id === id || b.pendingId === id) ?? store.builds.find((b) => b.planRef === id);
  const allText = (b) => [b, ...b.copies.map((c) => c.data)].map((x) => JSON.stringify(x)).join('\n');
  for (const P of sources.profiles) {
    for (const ob of P.orch?.builds ?? []) {
      const r = recOf(ob.id);
      out.push({ what: `${P.id} orchestrator ${ob.id}`, ok: !!r && has(ob.id, P.id) });
      if (r) for (const s of ob.steps ?? []) out.push({ what: `${P.id} orchestrator ${ob.id} step ${s.id}`, ok: allText(r).includes(JSON.stringify(plain(s.text)).slice(1, -1).slice(0, 120)) });
      if (r) for (const n of ob.notes ?? []) out.push({ what: `${P.id} orchestrator ${ob.id} note`, ok: allText(r).includes(JSON.stringify(n.text).slice(1, -1).slice(0, 120)) });
      if (r && ob.status !== r.status) out.push({ what: `${P.id} orchestrator ${ob.id} status ${ob.status} kept (now ${r.status})`, ok: r.copies.length > 0 || r.status === 'complete' || r.legacy.length > 1 || r.notes.some((n) => n.text.includes(`"${ob.status}"`)) });
    }
    for (const src of P.pending ?? []) for (const it of src.state?.items ?? []) {
      const r = recOf(it.id);
      out.push({ what: `${P.id} pending ${it.id} (${src.file})`, ok: !!r && has(it.id, P.id) });
      if (r) for (const p of it.subPrompts ?? []) out.push({ what: `${P.id} pending ${it.id} step`, ok: allText(r).includes(JSON.stringify(plain(p.text)).slice(1, -1).slice(0, 120)) });
      if (r) for (const n of it.notes ?? []) out.push({ what: `${P.id} pending ${it.id} note`, ok: allText(r).includes(JSON.stringify(n.text).slice(1, -1).slice(0, 120)) });
    }
    for (const id of P.queue?.order ?? []) out.push({ what: `${P.id} queue ${id}`, ok: has(id, P.id) });
  }
  return out;
}

// ------------------------------------------------------------------ Steps view: drafts, Apply, Discard

/**
 * Draft ops (nothing touches a build until Apply):
 *   { op: 'reorder-steps', build, uids: [uid…] }        new step order inside a build (warning: refactors the build)
 *   { op: 'reorder-builds', ids: [id…] }                new build order in the profile
 *   { op: 'rename-build', id, title }                   { op: 'rename-step', build, uid, title }
 *   { op: 'rename-profile', id, name }                  applied to the profile registry by the IO layer
 *   { op: 'divide-step', build, uid, parts: [{ text, estimate?, model? }…] }   one step → several
 *   { op: 'harvest', from: [{ build, uid }…], into: [{ title, id?, uids: [uid…] }…] }   selected steps → 1..N new builds
 *   { op: 'restore-default', id }                       the build back to its default breakdown
 * A rename with an empty title is refused. Ids never change.
 */
export const DRAFT_OPS = ['reorder-steps', 'reorder-builds', 'rename-build', 'rename-step', 'rename-profile', 'divide-step', 'harvest', 'restore-default'];

export function validateOp(op) {
  if (!op || !DRAFT_OPS.includes(op.op)) throw new Error(`unknown draft op ${op?.op}`);
  if (op.op === 'rename-build' && !str(op.title).trim()) throw new Error('a build needs a name');
  if (op.op === 'rename-step' && !str(op.title).trim()) throw new Error('a step needs a name');
  if (op.op === 'rename-profile' && !str(op.name).trim()) throw new Error('a profile needs a name');
  if (op.op === 'divide-step' && (!Array.isArray(op.parts) || op.parts.length < 2 || op.parts.some((p) => !str(p?.text).trim()))) throw new Error('divide a step into 2 or more parts, each with text');
  if (op.op === 'harvest') {
    if (!Array.isArray(op.from) || !op.from.length) throw new Error('select the steps to harvest');
    if (!Array.isArray(op.into) || !op.into.length) throw new Error('harvest into one build or more');
    if (op.into.some((x) => !str(x?.title).trim())) throw new Error('every harvested build needs a name');
    const all = op.from.map((f) => f.uid); const used = op.into.flatMap((x) => x.uids ?? []);
    if (used.some((u) => !all.includes(u)) || all.some((u) => !used.includes(u))) throw new Error('every selected step goes to exactly one new build');
  }
  return op;
}

export function addDraftOp(store, profile, op, { now = nowIso(), by = 'console' } = {}) {
  validateOp(op);
  const s = clone(store);
  const d = s.drafts[profile] ?? { ops: [], updatedAt: now, by };
  // try it on a copy first: an op that can't apply is refused now, not at Apply time
  applyOps(clone(s), profile, [...d.ops, op], { now, by, dry: true });
  d.ops.push(op); d.updatedAt = now; d.by = by;
  s.drafts[profile] = d;
  return s;
}
export function discardDraft(store, profile) { const s = clone(store); delete s.drafts[profile]; return s; }
export function draftOf(store, profile) { return store.drafts[profile] ?? { ops: [], updatedAt: '', by: '' }; }

/** The profile as it would be after the draft (for the Steps view preview). */
export function previewDraft(store, profile) {
  const d = draftOf(store, profile);
  const r = applyOps(clone(store), profile, d.ops, { dry: true });
  return { store: r.store, log: r.log, profileName: r.profileName };
}

/** Apply ops at once (no draft): the Builds view's renames and reorders. Same rules as a draft. */
export function applyNow(store, profile, ops, { now = nowIso(), by = 'console' } = {}) {
  for (const op of ops) validateOp(op);
  const r = applyOps(clone(store), profile, ops, { now, by });
  r.store.updatedAt = now;
  return r;
}

/** Apply the draft: the orchestrator refactors the builds it touches. Returns { store, log, profileRename? }. */
export function applyDraft(store, profile, { now = nowIso(), by = 'console' } = {}) {
  const d = draftOf(store, profile);
  if (!d.ops.length) return { store, log: ['nothing to apply'] };
  const r = applyOps(clone(store), profile, d.ops, { now, by });
  delete r.store.drafts[profile];
  r.store.updatedAt = now;
  return r;
}

function stepIdIn(b, want) { const ids = new Set(b.steps.map((s) => s.id)); if (want && !ids.has(want)) return want; let n = b.steps.length + 1; while (ids.has(`s${n}`)) n += 1; return `s${n}`; }

function applyOps(s, profile, ops, { now = nowIso(), by = 'console', dry = false } = {}) {
  const log = [];
  let profileName = null;
  const get = (id) => { const b = s.builds.find((x) => x.id === id && !x.deleted); if (!b) throw new Error(`no build "${id}"`); return b; };
  const touched = new Set();
  for (const op of ops) {
    validateOp(op);
    switch (op.op) {
      case 'reorder-steps': {
        const b = get(op.build);
        const by_ = new Map(b.steps.map((x) => [x.uid, x]));
        if (op.uids.length !== b.steps.length || op.uids.some((u) => !by_.has(u))) throw new Error(`reorder of ${b.id} must list each of its ${b.steps.length} steps once`);
        b.steps = op.uids.map((u) => by_.get(u)); b.rearranged = true; touched.add(b.id);
        log.push(`${b.id}: steps reordered`); break;
      }
      case 'reorder-builds': {
        const list = buildsOf(s, profile); const known = new Set(list.map((b) => b.id));
        const ids = op.ids.filter((id) => known.has(id));
        const rest = list.filter((b) => !ids.includes(b.id)).map((b) => b.id);
        [...ids, ...rest].forEach((id, i) => { get(id).order[profile] = i; });
        log.push(`${profile}: builds reordered`); break;
      }
      case 'rename-build': { const b = get(op.id); b.title = str(op.title, 300).trim(); touched.add(b.id); log.push(`${b.id}: renamed "${b.title}"`); break; }
      case 'rename-step': {
        const b = get(op.build); const st = b.steps.find((x) => x.uid === op.uid); if (!st) throw new Error(`no step ${op.uid} in ${b.id}`);
        st.title = str(op.title, 200).trim(); touched.add(b.id);
        const ds = b.defaultSteps.find((x) => x.uid === op.uid); if (ds) ds.title = st.title; // a rename isn't a rearrangement
        log.push(`${b.id} ${st.id}: renamed "${st.title}"`); break;
      }
      case 'rename-profile': profileName = { id: str(op.id, 40), name: str(op.name, 80).trim() }; log.push(`profile ${op.id}: renamed "${profileName.name}"`); break;
      case 'divide-step': {
        const b = get(op.build); const k = b.steps.findIndex((x) => x.uid === op.uid); if (k < 0) throw new Error(`no step ${op.uid} in ${b.id}`);
        const st = b.steps[k];
        const parts = op.parts.map((p, i) => normStep({ id: i === 0 ? st.id : stepIdIn({ steps: [...b.steps, ...op.parts.slice(0, i).map((_, j) => ({ id: j === 0 ? st.id : `${st.id}.${j + 1}` }))] }, `${st.id}.${i + 1}`), text: str(p.text, 2000).trim(), estimate: str(p.estimate, 20), model: MODELS.includes(p.model) ? p.model : st.model, phase: st.phase, group: st.group, files: st.files, checks: st.checks, session: st.session, agent: st.agent, origin: { build: b.id, step: st.uid, how: 'divided' }, createdAt: now }, i, { now }));
        b.steps.splice(k, 1, ...parts);
        b.removedSteps.push({ step: st, at: now, why: `divided into ${parts.length}`, by });
        b.rearranged = true; touched.add(b.id);
        log.push(`${b.id} ${st.id}: divided into ${parts.length}`); break;
      }
      case 'harvest': {
        const picked = op.from.map((f) => { const b = get(f.build); const st = b.steps.find((x) => x.uid === f.uid); if (!st) throw new Error(`no step ${f.uid} in ${f.build}`); return { b, st }; });
        const made = [];
        for (const t of op.into) {
          let id = slug(t.id || t.title); let n = 2; while (s.builds.some((x) => x.id === id)) id = `${slug(t.id || t.title)}-${n++}`;
          const steps = t.uids.map((u) => picked.find((p) => p.st.uid === u)).map((p, i) => ({ ...p.st, id: `s${i + 1}`, origin: { build: p.b.id, step: p.st.uid, how: 'harvested' } }));
          const nb = normBuild({ id, title: str(t.title, 300).trim(), category: picked[0].b.category, status: 'pending', source: 'harvest', profiles: [profile], order: { [profile]: nextOrder(s, profile) }, steps, createdAt: now, updatedAt: now, notes: [{ text: `Harvested from ${[...new Set(picked.map((p) => p.b.id))].join(', ')} in the Steps view.`, at: now }] }, { now });
          nb.steps = steps.map((x, i) => normStep(x, i, { now }));
          nb.defaultSteps = nb.steps.map((x) => ({ ...x })); nb.defaultAt = now;
          if (nb.steps.some((x) => x.done)) nb.status = nb.steps.every((x) => x.done) ? 'complete' : 'running';
          s.builds.push(nb); made.push(nb.id);
        }
        // the orchestrator refactors what is left in the source builds
        for (const src of new Set(picked.map((p) => p.b))) {
          const gone = picked.filter((p) => p.b === src).map((p) => p.st);
          src.steps = src.steps.filter((x) => !gone.includes(x));
          for (const g of gone) src.removedSteps.push({ step: g, at: now, why: `harvested into ${made.join(', ')}`, by });
          src.notes.push({ text: `${gone.length} step(s) harvested into ${made.join(', ')}.`, at: now });
          src.rearranged = true; touched.add(src.id);
        }
        log.push(`harvested ${picked.length} step(s) into ${made.join(', ')}`); break;
      }
      case 'restore-default': {
        const b = get(op.id);
        if (!b.defaultSteps.length) throw new Error(`${b.id} has no default breakdown`);
        const live = new Map(); // where each default step is now
        for (const x of s.builds) for (const st of x.steps) live.set(st.uid, { b: x, st });
        const restored = b.defaultSteps.map((d) => {
          const now_ = live.get(d.uid);
          if (now_ && now_.b !== b) { now_.b.steps = now_.b.steps.filter((y) => y !== now_.st); now_.b.removedSteps.push({ step: now_.st, at: now, why: `given back to ${b.id} (Restore default)`, by }); touched.add(now_.b.id); }
          const kids = [...live.values()].filter((v) => v.st.origin?.step === d.uid && v.st.origin?.how === 'divided');
          const done = now_ ? now_.st.done : kids.length ? kids.every((k) => k.st.done) : d.done;
          return { ...(now_?.st ?? d), id: d.id, done, doneAt: done ? (now_?.st.doneAt || d.doneAt || now) : '' };
        });
        const keepUids = new Set(restored.map((x) => x.uid));
        for (const x of b.steps) if (!keepUids.has(x.uid)) b.removedSteps.push({ step: x, at: now, why: 'Restore default', by });
        b.steps = restored.map((x, i) => normStep(x, i, { now }));
        b.rearranged = false; touched.add(b.id);
        log.push(`${b.id}: restored to its default breakdown (${b.steps.length} steps)`); break;
      }
      default: throw new Error(`unknown op ${op.op}`);
    }
  }
  for (const id of touched) { const b = s.builds.find((x) => x.id === id); if (!b) continue; if (!dry) b.updatedAt = now; if (b.status !== 'archived' && b.status !== 'blocked' && b.status !== 'failed' && b.steps.length) { const d = b.steps.filter((x) => !x.skip); b.status = d.length && d.every((x) => x.done) ? 'complete' : d.some((x) => x.done) ? 'running' : b.status === 'complete' ? 'running' : b.status; } }
  renumber(s, profile);
  return { store: s, log, profileName };
}

/** Claude-picked default name for a harvested build: the common words of its steps, else the first step's start. */
export function suggestName(steps) {
  const texts = steps.map((x) => (x.title || plain(x.text)).toLowerCase());
  if (!texts.length) return 'New build';
  const words = (t) => t.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  const count = new Map();
  for (const t of texts) for (const w of new Set(words(t))) count.set(w, (count.get(w) ?? 0) + 1);
  const common = [...count.entries()].filter(([, n]) => n > 1 || texts.length === 1).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  const base = common.length ? common.join(' ') : words(texts[0]).slice(0, 4).join(' ');
  return (base.charAt(0).toUpperCase() + base.slice(1)) || 'New build';
}
const STOP = new Set(['with', 'from', 'into', 'that', 'this', 'every', 'each', 'when', 'then', 'their', 'there', 'them', 'also', 'only', 'what', 'have', 'make', 'sure', 'step', 'steps', 'build', 'builds']);

/** Split selected steps into N proposed builds (contiguous, balanced by estimate), each with a default name. */
export function proposeSplit(steps, n) {
  const k = Math.max(1, Math.min(Number(n) || 1, steps.length || 1));
  const est = (x) => { const m = /^\s*(\d+(?:\.\d+)?)\s*(h|m|min)?/i.exec(str(x.estimate)); return m ? Number(m[1]) * (/^h/i.test(m[2] || '') ? 60 : 1) : 15; };
  const total = steps.reduce((t, x) => t + est(x), 0);
  const out = []; let cur = []; let acc = 0;
  steps.forEach((x, i) => {
    cur.push(x); acc += est(x);
    const left = steps.length - i - 1; const need = k - out.length - 1;
    if (out.length < k - 1 && (acc >= (total / k) * (out.length + 1) || left === need) && left >= need) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out.map((g) => ({ title: suggestName(g), uids: g.map((x) => x.uid), steps: g }));
}
