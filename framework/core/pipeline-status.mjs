/**
 * pipeline-2@1 — the Pipeline 2.0 status contract (framework/spec/PIPELINE-2.md, JSON Schema
 * framework/schemas/pipeline-2.json). Pure: no IO, no clock unless one is passed. Shared by the builds store (which
 * enforces it on every write), the orchestrator flow, the lander, the watchdog and the builds table.
 *
 * Brett, Nov 19 2026: everything is status, forward-only. A build or a step only ever moves forward through its flow;
 * `failed` (with `attempt: N`, shown "failed, attempt N") may be entered from any status but the last, and a retry
 * leaves `failed` forward again: at the status it failed at or later, never earlier, as attempt N + 1.
 * Every status change records `at` and `by` (statusAt, statusBy, and one statusLog line).
 *
 * A build follows this contract when `flow === 'pipeline-2'` (set by Plan Studio's Send to orchestrator, or by the
 * first write that gives a build a Pipeline 2.0-only status). Builds made before it keep their builds@1 statuses.
 */

export const SCHEMA = 'pipeline-2@1';
export const FLOW = 'pipeline-2';
export const FAILED = 'failed';

/** Build statuses, in order. `split` is shown as "Pending" (the build row reads pending again once its steps exist). */
export const BUILD_FLOW = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
/** Step statuses, in order. `in-pr` carries the PR number (prNumber). */
export const STEP_FLOW = Object.freeze(['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr']);
export const BUILD_STATUSES = Object.freeze([...BUILD_FLOW, FAILED]);
export const STEP_STATUSES = Object.freeze([...STEP_FLOW, FAILED]);
/** Statuses only Pipeline 2.0 uses (a build given one of these joins the contract). */
export const P2_ONLY = Object.freeze(BUILD_FLOW.filter((s) => !['pending', 'landed'].includes(s)));
/**
 * Active: from the first main pull to the merge into main. Only ONE build may be active at a time, and nothing pulls
 * main, merges or touches main while one is (the dispatcher's gate, the lander's and the watchdog's).
 */
export const ACTIVE = Object.freeze(BUILD_FLOW.slice(BUILD_FLOW.indexOf('pulling-main'), BUILD_FLOW.indexOf('landed')));
/** A build that failed while active still holds the one active place (its retry continues forward). */
export const holdsActive = (b) => !!b && b.flow === FLOW && !b.deleted && (ACTIVE.includes(b.status) || (b.status === FAILED && ACTIVE.includes(b.failedFrom)));
/** A Pipeline 2.0 build may also be archived (removed from the table); that is the one way out of the flow. */
export const EXIT = 'archived';

export const BUILD_LABELS = Object.freeze({
  pending: 'Pending', splitting: 'Splitting', split: 'Pending', 'pulling-main': 'Pulling in main', 'assigning-models': 'Assigning models',
  ready: 'Ready for build', sending: 'Sending to slot', building: 'Building', 'build-complete': 'Build complete', 'merging-pr': 'Merging to one PR',
  'pr-pulling-main': 'Pulling in main (PR)', 'running-ci': 'Running CI', 'merging-main': 'Merging into main', landed: 'Landed', failed: 'Failed',
});
export const STEP_LABELS = Object.freeze({
  pending: 'Pending', 'pulling-main': 'Pulling in main', ready: 'Ready', sending: 'Sending to slot', building: 'Building', completed: 'Completed', 'in-pr': 'In PR', failed: 'Failed',
});
/** The fields a build or step carries for the contract. */
export const BUILD_FIELDS = Object.freeze(['flow', 'status', 'statusAt', 'statusBy', 'attempt', 'failedFrom', 'statusLog']);
export const STEP_FIELDS = Object.freeze(['status', 'statusAt', 'statusBy', 'attempt', 'failedFrom', 'statusLog', 'model', 'account', 'slot', 'prNumber', 'worktree', 'branch', 'tmux']);
export const LOG_MAX = 60;

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const flowOf = (kind) => (kind === 'step' ? STEP_FLOW : BUILD_FLOW);
const statusesOf = (kind) => (kind === 'step' ? STEP_STATUSES : BUILD_STATUSES);
export const rank = (status, kind = 'build') => flowOf(kind).indexOf(status);
export const isStatus = (status, kind = 'build') => statusesOf(kind).includes(status);
export const isP2 = (b) => !!b && (b.flow === FLOW || P2_ONLY.includes(b.status));

/** "Pending", "Pulling in main", "failed, attempt 2". */
export function labelOf(status, attempt = 1, kind = 'build') {
  if (status === FAILED) return `failed, attempt ${Math.max(1, Number(attempt) || 1)}`;
  return (kind === 'step' ? STEP_LABELS : BUILD_LABELS)[status] ?? str(status, 40);
}

/**
 * May `rec` move from its status to `to`? → { ok, why, retry }. `rec` = { status, failedFrom }.
 *  - the same status is a no-op (ok);
 *  - a status outside the contract is refused;
 *  - a record not yet in the contract (no status, or a builds@1 status) may enter it anywhere;
 *  - `failed` from anything but the last status of the flow;
 *  - out of `failed`: to the status it failed at or later (retry = true, attempt + 1);
 *  - otherwise forward only (skips allowed), never back.
 */
export function checkTransition(rec, to, kind = 'build') {
  const cur = str(rec?.status, 40);
  if (cur === to) return { ok: true, why: '', retry: false, same: true };
  if (kind === 'build' && to === EXIT) return { ok: true, why: '', retry: false };
  if (!isStatus(to, kind)) return { ok: false, why: `"${to}" is not a ${kind} status of ${SCHEMA} (${statusesOf(kind).join(', ')})` };
  if (!isStatus(cur, kind)) return { ok: true, why: '', retry: false, entered: true };
  const flow = flowOf(kind); const last = flow[flow.length - 1];
  if (to === FAILED) return cur === last ? { ok: false, why: `${cur} is final: it cannot fail any more` } : { ok: true, why: '', retry: false };
  if (cur === FAILED) {
    const from = rank(str(rec?.failedFrom, 40), kind);
    if (from >= 0 && rank(to, kind) < from) return { ok: false, why: `a retry continues forward: ${kind} failed at ${rec.failedFrom}, so it cannot go back to ${to}` };
    return { ok: true, why: '', retry: true };
  }
  if (rank(to, kind) < rank(cur, kind)) return { ok: false, why: `forward-only: ${cur} → ${to} goes back` };
  return { ok: true, why: '', retry: false };
}

/**
 * Move one record (a build, or a step with kind 'step'), pure: → { ok, why, rec } (rec is a copy; unchanged when
 * refused). Records at / by, the attempt (failed keeps the attempt it failed on; a retry is attempt + 1), the status it
 * failed at, and one statusLog line. `extra` is merged into the record on success (account, slot, prNumber…).
 */
export function transition(rec, to, { at, by = 'pipeline', why = '', kind = 'build', extra = null } = {}) {
  const r = { ...(rec ?? {}) };
  const c = checkTransition(r, to, kind);
  if (!c.ok) return { ok: false, why: c.why, rec: r };
  if (c.same) { if (extra) Object.assign(r, extra); return { ok: true, why: '', rec: r, same: true }; }
  const when = str(at, 40) || new Date().toISOString();
  const attempt = Math.max(1, Number(r.attempt) || 1);
  if (to === FAILED) { r.failedFrom = r.status && isStatus(r.status, kind) ? r.status : (r.failedFrom || ''); r.attempt = attempt; }
  else if (c.retry) { r.attempt = attempt + 1; }
  else if (!r.attempt) r.attempt = 1;
  if (to !== FAILED) delete r.failedFrom; // only meaningful while failed (the log keeps the history)
  r.status = to; r.statusAt = when; r.statusBy = str(by, 80) || 'pipeline';
  if (kind === 'build') r.flow = FLOW;
  r.statusLog = [...(Array.isArray(r.statusLog) ? r.statusLog : []), { status: to, at: when, by: r.statusBy, attempt: r.attempt, ...(why ? { why: str(why, 300) } : {}) }].slice(-LOG_MAX);
  if (kind === 'step') r.done = to === 'completed' || to === 'in-pr';
  if (extra) Object.assign(r, extra);
  return { ok: true, why: '', rec: r };
}

/** One statusLog line, normalised. */
export function normLogLine(l) {
  if (!l || typeof l !== 'object') return null;
  const status = str(l.status, 40); if (!status) return null;
  return { status, at: str(l.at, 40), by: str(l.by, 80), attempt: Math.max(1, Number(l.attempt) || 1), ...(str(l.why) ? { why: str(l.why, 300) } : {}) };
}

/** The contract's fields of a record, normalised (kept only when set, so builds@1 records stay as they were). */
export function normFields(o, kind = 'build') {
  const x = o && typeof o === 'object' ? o : {};
  const out = {};
  if (kind === 'build' && (x.flow === FLOW || P2_ONLY.includes(x.status))) out.flow = FLOW;
  if (str(x.statusAt)) out.statusAt = str(x.statusAt, 40);
  if (str(x.statusBy)) out.statusBy = str(x.statusBy, 80);
  if (Number(x.attempt) >= 1) out.attempt = Math.floor(Number(x.attempt));
  if (str(x.failedFrom) && isStatus(x.failedFrom, kind)) out.failedFrom = x.failedFrom;
  const log = (Array.isArray(x.statusLog) ? x.statusLog : []).map(normLogLine).filter(Boolean).slice(-LOG_MAX);
  if (log.length) out.statusLog = log;
  if (kind === 'step') {
    if (isStatus(x.status, 'step')) out.status = x.status;
    for (const k of ['account', 'slot', 'worktree', 'branch', 'tmux']) if (str(x[k])) out[k] = str(x[k], 300);
    if (Number.isInteger(Number(x.prNumber)) && Number(x.prNumber) > 0) out.prNumber = Number(x.prNumber);
  }
  return out;
}

const sameStatus = (a, b) => (a?.status ?? '') === (b?.status ?? '');

/**
 * The store's guard (builds-store withStore runs it on every write): for every Pipeline 2.0 build, and every step of
 * one, a status change that breaks the contract is refused (the record keeps its old status and status fields), and a
 * legal change a writer made by hand gets its at / by / log line stamped. Pure. → { store, refused: [{ id, step?, from, to, why }] }
 */
export function enforceFlow(before, after, { at, by = 'store' } = {}) {
  const old = new Map((before?.builds ?? []).map((b) => [b.id, b]));
  const when = str(at, 40) || new Date().toISOString();
  const refused = [];
  const keep = (prev, cur, kind) => { const out = { ...cur }; for (const k of ['status', 'statusAt', 'statusBy', 'attempt', 'failedFrom', 'statusLog', ...(kind === 'step' ? ['done', 'doneAt'] : [])]) { if (prev && k in prev) out[k] = prev[k]; else delete out[k]; } return out; };
  const stamp = (prev, cur, kind) => {
    const t = transition({ ...cur, status: prev?.status ?? '', attempt: prev?.attempt ?? cur.attempt, failedFrom: prev?.failedFrom ?? '', statusLog: prev?.statusLog ?? cur.statusLog }, cur.status, { at: when, by, kind });
    return { ...cur, ...t.rec, ...(kind === 'step' ? { done: cur.done === true || t.rec.done === true } : {}) };
  };
  const builds = (after?.builds ?? []).map((b) => {
    const prev = old.get(b.id);
    if (!isP2(b) && !isP2(prev)) return b;
    let next = b;
    if (prev && !sameStatus(prev, b)) {
      const c = checkTransition(prev, b.status, 'build');
      if (!c.ok) { refused.push({ id: b.id, from: prev.status, to: b.status, why: c.why }); next = keep(prev, b, 'build'); }
      else if (b.statusAt === prev.statusAt || !b.statusAt) next = stamp(prev, b, 'build');
    } else if (!prev && b.status && !b.statusAt) next = stamp(null, b, 'build');
    if (isP2(next) && next.flow !== FLOW) next = { ...next, flow: FLOW };
    const oldSteps = new Map((prev?.steps ?? []).map((s) => [s.uid || s.id, s]));
    let stepsChanged = false;
    const steps = (next.steps ?? []).map((s) => {
      const ps = oldSteps.get(s.uid || s.id);
      if (!s.status && !ps?.status) return s;
      if (ps && !sameStatus(ps, s)) {
        const c = checkTransition(ps, s.status, 'step');
        if (!c.ok) { refused.push({ id: b.id, step: s.id, from: ps.status || '', to: s.status || '', why: c.why }); stepsChanged = true; return keep(ps, s, 'step'); }
        if (s.statusAt === ps.statusAt || !s.statusAt) { stepsChanged = true; return stamp(ps, s, 'step'); }
      } else if (!ps && s.status && !s.statusAt) { stepsChanged = true; return stamp(null, s, 'step'); }
      return s;
    });
    return stepsChanged ? { ...next, steps } : next;
  });
  return { store: { ...after, builds }, refused };
}

/* ------------------------------------------------------------------ the flow's pure decisions */

/** Do two steps' file lists overlap (one path equal to, or inside, the other)? Steps with no files never clash. */
export function filesOverlap(a = [], b = []) {
  const norm = (p) => str(p, 300).replace(/\/+$/, '').replace(/\*.*$/, '').replace(/\/+$/, '');
  for (const x of a.map(norm).filter(Boolean)) for (const y of b.map(norm).filter(Boolean)) if (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
  return false;
}

/**
 * Split a build's steps into at most `slots` parts that never touch the same files (Brett: "as many as there are
 * slots, without the parts stepping on each other"). Steps are kept in order; each goes to the first part it does not
 * clash with, the least loaded first; a step that clashes with every part joins the part it clashes with (one session
 * then does both). Pure → [[step…]…], never more parts than steps or slots, at least one when there are steps.
 */
export function splitParts(steps = [], slots = 1) {
  const n = Math.max(1, Math.min(Number(slots) || 1, steps.length || 1));
  const parts = [];
  for (const s of steps) {
    const files = Array.isArray(s.files) ? s.files : [];
    const clash = parts.map((p, i) => ({ i, hit: p.some((x) => filesOverlap(x.files, files)), load: p.length }));
    const hits = clash.filter((c) => c.hit);
    if (hits.length) { parts[hits[0].i].push(s); continue; }
    if (parts.length < n) { parts.push([s]); continue; }
    parts[clash.sort((a, b) => a.load - b.load || a.i - b.i)[0].i].push(s);
  }
  return parts;
}

/** Words that mark a step as Fable work (schemas, asset types, contracts, engines / kernel, cross-app protocols). */
export const FABLE_WORDS = /\b(schemas?|asset types?|contracts?|engines?|kernel|cross-app|protocols?|spec(?:ification)?s?)\b/i;
/** Fable where needed, Opus for everything else; a step already pinned to Fable stays Fable. */
export const modelFor = (step) => (step?.model === 'Fable' || FABLE_WORDS.test(`${str(step?.text, 2000)} ${str(step?.title, 200)}`) ? 'Fable' : 'Opus');

/**
 * Accounts by usage left, then spread: the account for the next step is the one with usage left that has the fewest
 * steps of this build on it, then the most usage left, then the fewest running sessions, then by name. Accounts
 * marked out (limited until a reset), unusable or full are never picked. Pure → the account row or null.
 *   accounts: [{ name, usable, limited, free, running, usageLeft (0..1, 1 when unknown), fable }]
 */
export function pickAccount(accounts = [], { model = 'Opus', onBuild = {}, exclude = [], now = Date.now() } = {}) {
  const out = (a) => a.limited && (!a.limited.until || Date.parse(a.limited.until) > now);
  const ok = accounts.filter((a) => a && a.usable !== false && !out(a) && (a.free ?? 1) > 0 && !(exclude || []).includes(a.name) && (model !== 'Fable' || a.fable !== false) && (a.usageLeft ?? 1) > 0);
  ok.sort((a, b) => (onBuild[a.name] ?? 0) - (onBuild[b.name] ?? 0) || (b.usageLeft ?? 1) - (a.usageLeft ?? 1) || (a.running?.length ?? a.running ?? 0) - (b.running?.length ?? b.running ?? 0) || a.name.localeCompare(b.name));
  return ok[0] ?? null;
}

/** The one build allowed to be active, or null; `others` = every other build that also holds the place (a breach). */
export function activeBuild(builds = []) {
  const act = builds.filter(holdsActive).sort((a, b) => String(a.statusLog?.find((l) => ACTIVE.includes(l.status))?.at ?? a.statusAt).localeCompare(String(b.statusLog?.find((l) => ACTIVE.includes(l.status))?.at ?? b.statusAt)));
  return { active: act[0] ?? null, others: act.slice(1) };
}

/* ------------------------------------------------------------------ plan-build@1: what Plan Studio may send */

export const PLAN_SCHEMA = 'plan-build@1';
export const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/; // build-id@1
export const PLAN_MODELS = Object.freeze(['Fable', 'Opus']);
export const STEP_MAX_MINUTES = 30;

/** The plan manifest in its one shape (model names capitalised, minutes as numbers), before validation. */
export function normPlan(p) {
  const o = p && typeof p === 'object' ? p : {};
  const cap = (m) => { const x = str(m, 20).toLowerCase(); return x === 'fable' ? 'Fable' : x === 'opus' ? 'Opus' : str(m, 20); };
  return {
    $axf: PLAN_SCHEMA, id: str(o.id, 80), title: str(o.title, 300).trim(), detail: str(o.detail, 8000), source: str(o.source, 40) || 'plan-studio-2',
    planItem: str(o.planItem, 80), ...(str(o.said) ? { said: str(o.said, 2000) } : {}),
    steps: (Array.isArray(o.steps) ? o.steps : []).map((s) => ({ text: str(s?.text, 2000).trim(), model: cap(s?.model || 'Opus'), minutes: Number.isFinite(Number(s?.minutes)) && Number(s?.minutes) > 0 ? Math.round(Number(s.minutes)) : (parseInt(str(s?.estimate), 10) || 0), files: Array.isArray(s?.files) ? s.files.map((f) => str(f, 300)).filter(Boolean) : [] })),
  };
}

/** Every reason a plan may not be sent (empty = valid). Nothing invalid moves on. */
export function validatePlan(p) {
  const errs = []; const e = (path, why) => errs.push({ path, why });
  if (!p || typeof p !== 'object') return [{ path: '', why: 'not an object' }];
  if (p.$axf !== PLAN_SCHEMA) e('$axf', `must be ${PLAN_SCHEMA}`);
  if (!PLAN_ID_RE.test(p.id ?? '')) e('id', 'a build id: a-z, 0-9 and -, at most 40 characters (build-id@1)');
  if (!str(p.title).trim()) e('title', 'a plan needs a title');
  if (!Array.isArray(p.steps) || !p.steps.length) e('steps', 'a plan needs at least one open step');
  (Array.isArray(p.steps) ? p.steps : []).forEach((s, i) => {
    if (!str(s?.text).trim()) e(`steps[${i}].text`, 'a step needs text');
    if (!PLAN_MODELS.includes(s?.model)) e(`steps[${i}].model`, `Fable or Opus, not ${s?.model || 'nothing'} (never Sonnet or Haiku)`);
    if (!(Number(s?.minutes) > 0)) e(`steps[${i}].minutes`, 'every step needs an estimate in minutes');
    else if (Number(s.minutes) > STEP_MAX_MINUTES) e(`steps[${i}].minutes`, `a step is ${STEP_MAX_MINUTES} minutes or less (split it): ${s.minutes}`);
    if (s?.files !== undefined && !Array.isArray(s.files)) e(`steps[${i}].files`, 'a list of paths');
  });
  const seen = new Set();
  (Array.isArray(p.steps) ? p.steps : []).forEach((s, i) => { const k = str(s?.text).trim().toLowerCase(); if (k && seen.has(k)) e(`steps[${i}].text`, 'the same step twice'); seen.add(k); });
  return errs;
}
