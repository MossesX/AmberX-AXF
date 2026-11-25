/**
 * split-plan@1 — one build at a time, split across every free slot (pure, IO-free). Contract: framework/spec/BUILD-SPLIT.md;
 * schema framework/schemas/split-plan.json; golden fixtures framework/spec/fixtures/build-split.json
 * (framework/spec/check-build-split.mjs).
 *
 * Brett, Nov 18 2026: one build runs at a time, and that build is split across every free agent slot so the slots stay
 * full and nothing lands on a moved main. The record lives on a builds@1 build (`splitId`, `split`) and the main lock
 * on the store's `meta.mainLock` (main-lock@1).
 *
 *   ids          splitIdOf(buildId, run) · parseSplitId(id) · partRef(splitId, partId) · partBranch(splitId, partId)
 *   records      normPart · normSplit · normMainLock · buildStatusOf(runState)
 *   states       PART_TRANSITIONS · RUN_TRANSITIONS · partNext(plan, partId, event) · runNext(plan, to) · rollUp(parts)
 *                combineReady(plan) · onPartFailed(plan, partId, why) · applyRollUp(plan)
 *   one at a time  RUN_ACTIVE · activeRuns(builds) · canStartRun(plan, { lock, builds }) · startRun(plan, { lock, sha })
 *                takeMainLock · releaseMainLock · lockAfterRun(plan, lock) · mainLockStale · oneBase(plan, lock)
 */

export const SCHEMA = 'split-plan@1';
export const LOCK_SCHEMA = 'main-lock@1';

/** `<build id>.r<n>`: the build's id (build-id@1) and the run number, 1-based, counted up on every re-split. */
export const SPLIT_ID_RE = /^([a-z0-9][a-z0-9-]{0,39})\.r([1-9][0-9]{0,3})$/;
/** `p<k>`, k 1-based in step order. */
export const PART_ID_RE = /^p([1-9][0-9]?)$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const BUILD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const PART_BRANCH_RE = /^claude\/([a-z0-9][a-z0-9-]{0,39})--r([1-9][0-9]{0,3})-(p[1-9][0-9]?)$/;
export const COMBINE_BRANCH_RE = /^claude\/[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_PARTS = 64;
export const HISTORY_MAX = 200;
export const DEFAULT_MAX_REBUILDS = 2;
/** A main lock older than this with no live session on its build is stale (the watchdog releases it). */
export const MAIN_LOCK_STALE_MS = 6 * 60 * 60 * 1000;

export const PART_STATUSES = Object.freeze(['waiting', 'building', 'testing', 'rebuilding', 'failed', 'done']);
export const RUN_STATES = Object.freeze(['splitting', 'queued', 'building', 'combining', 'ci', 'merging', 'merged', 'live', 'finished', 'failed']);
export const PART_EVENTS = Object.freeze(['launch', 'ticked', 'green', 'fail', 'crash', 'rebuild', 'abandon', 'conflict']);
export const COMBINE_CI = Object.freeze(['', 'running', 'success', 'failure']);
export const MODELS = Object.freeze(['', 'Fable', 'Opus']);
export const PLANNERS = Object.freeze(['dispatcher', 'console', 'cli', 'mcp', 'voice', 'hand']);

/**
 * The builds@1 status a run state shows as. `splitting` is its own status (the table's Splitting); the parts phase is
 * `running`; the combine, CI and merge are `landing` (done-means-merged@1: the lander's); `merged` and `live` are
 * `landed`; `finished` is `complete`; a failed run is `fixing` (the retry ladder takes it: the next try is a new run).
 */
export const BUILD_STATUS_OF_RUN = Object.freeze({ splitting: 'splitting', queued: 'running', building: 'running', combining: 'landing', ci: 'landing', merging: 'landing', merged: 'landed', live: 'landed', finished: 'complete', failed: 'fixing' });
export const buildStatusOf = (run) => BUILD_STATUS_OF_RUN[run] ?? '';

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v) => { const s = str(v, 40).trim(); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const int = (v, d = 0, max = Number.MAX_SAFE_INTEGER) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : d);
const oneOf = (list, v, d) => (list.includes(v) ? v : d);
const sha = (v) => (SHA_RE.test(str(v, 64)) ? str(v, 64) : '');
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');
const strList = (v, max, each) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, each).trim()).filter(Boolean))].slice(0, max);

// ------------------------------------------------------------------ ids

/** The split id of a build's n-th run, or '' when the inputs are not valid. */
export function splitIdOf(buildId, run = 1) {
  const id = str(buildId, 80); const n = Number(run);
  if (!BUILD_ID_RE.test(id) || !Number.isInteger(n) || n < 1 || n > 9999) return '';
  return `${id}.r${n}`;
}
/** { build, run } of a split id, or null. */
export function parseSplitId(id) {
  const m = SPLIT_ID_RE.exec(str(id, 60));
  return m ? { build: m[1], run: Number(m[2]) } : null;
}
export const isSplitId = (id) => !!parseSplitId(id);
export const isPartId = (id) => PART_ID_RE.test(str(id, 8));
/** `<split id>/<part id>`: how a part is addressed everywhere. */
export function partRef(splitId, partId) { return isSplitId(splitId) && isPartId(partId) ? `${splitId}/${partId}` : ''; }
/** { build, run, part } of a part ref, or null. */
export function parsePartRef(ref) {
  const [s, p, extra] = str(ref, 80).split('/');
  if (extra !== undefined || !isPartId(p)) return null;
  const sp = parseSplitId(s); return sp ? { ...sp, part: p } : null;
}
/** `claude/<build id>--r<n>-p<k>`: a sibling of the build branch, never under it (git refs cannot nest). */
export function partBranch(splitId, partId) {
  const sp = parseSplitId(splitId); if (!sp || !isPartId(partId)) return '';
  return `claude/${sp.build}--r${sp.run}-${partId}`;
}
/** The combine branch: the build branch itself. */
export const combineBranch = (buildId) => (BUILD_ID_RE.test(str(buildId, 80)) ? `claude/${buildId}` : '');
/** `axf-<build id>--r<n>-p<k>[--<agent>]`: a part's tmux session (build-lock@1 reads it as the build's). */
export function partSession(splitId, partId, agent = '') {
  const sp = parseSplitId(splitId); if (!sp || !isPartId(partId)) return '';
  const a = str(agent, 40).trim();
  return `axf-${sp.build}--r${sp.run}-${partId}${a ? `--${a}` : ''}`;
}
/** The split id a part branch belongs to ({ splitId, part }), or null. */
export function parsePartBranch(branch) {
  const m = PART_BRANCH_RE.exec(str(branch, 120));
  return m ? { splitId: `${m[1]}.r${m[2]}`, part: m[3] } : null;
}

// ------------------------------------------------------------------ records

/** One part, every field in shape. Unknown enums fall to the safe side: an unknown status is `failed`, never `done`. */
export function normPart(p, i = 0, ctx = {}) {
  const x = obj(p) ?? {};
  const id = isPartId(x.id) ? x.id : `p${i + 1}`;
  const splitId = isSplitId(ctx.splitId) ? ctx.splitId : '';
  const base = sha(x.base) || sha(ctx.base);
  return {
    id,
    status: oneOf(PART_STATUSES, x.status, x.status === undefined ? 'waiting' : 'failed'),
    steps: strList(x.steps, 400, 40),
    files: strList(x.files, 2000, 300),
    branch: PART_BRANCH_RE.test(str(x.branch, 120)) ? str(x.branch, 120) : (splitId ? partBranch(splitId, id) : ''),
    base,
    slot: str(x.slot, 60), account: accountName(x.account), session: str(x.session, 120), model: oneOf(MODELS, x.model, ''),
    head: sha(x.head),
    startedAt: iso(x.startedAt), endedAt: iso(x.endedAt),
    rebuilds: int(x.rebuilds, 0, 99),
    lastError: str(x.lastError, 600), note: str(x.note, 400),
  };
}

export function normCombine(c, ctx = {}) {
  const x = obj(c) ?? {};
  const branch = COMBINE_BRANCH_RE.test(str(x.branch, 120)) ? str(x.branch, 120) : combineBranch(ctx.build);
  const pr = (() => { const n = Number(String(x.pr ?? '').replace(/^#/, '').replace(/^.*\/pull\//, '')); return Number.isInteger(n) && n > 0 ? n : 0; })();
  return { branch, head: sha(x.head), pr, ci: oneOf(COMBINE_CI, x.ci, ''), ciRun: str(x.ciRun, 300), startedAt: iso(x.startedAt), mergedAt: iso(x.mergedAt), liveAt: iso(x.liveAt), finishedAt: iso(x.finishedAt), attempts: int(x.attempts), note: str(x.note, 400) };
}

export function normFailure(f) {
  const x = obj(f); if (!x || !iso(x.at)) return null;
  return { at: iso(x.at), part: isPartId(x.part) ? x.part : '', why: str(x.why, 600) };
}

export function normTransition(t) {
  const x = obj(t); if (!x || !iso(x.at)) return null;
  const out = { at: iso(x.at), from: str(x.from, 20), to: str(x.to, 20) };
  if (isPartId(x.part)) out.part = x.part;
  if (str(x.why).trim()) out.why = str(x.why, 300);
  return out.from || out.to ? out : null;
}

/**
 * The split record on a build, every field in shape, or null for nothing. `ctx.build` is the build's id: a plan whose
 * id names another build is not that build's plan (null). Parts keep the order they came in (plans are made in part-id
 * order) so a list sorted by anything else is caught by validatePlan, not silently fixed.
 */
export function normSplit(s, ctx = {}) {
  const x = obj(s); if (!x) return null;
  const id = isSplitId(x.id) ? x.id : '';
  if (!id) return null;
  const build = str(ctx.build, 80);
  if (build && parseSplitId(id).build !== build) return null;
  const base = sha(x.base);
  const slots = obj(x.slots);
  const parts = (Array.isArray(x.parts) ? x.parts : []).filter((p) => obj(p)).slice(0, MAX_PARTS).map((p, i) => normPart(p, i, { splitId: id, base }));
  return {
    $axf: SCHEMA,
    id,
    run: oneOf(RUN_STATES, x.run, parts.length ? 'queued' : 'splitting'),
    base,
    at: iso(x.at), by: str(x.by, 80),
    ...(slots ? { slots: { free: int(slots.free), used: int(slots.used) } } : {}),
    parts,
    combine: normCombine(x.combine, { build: build || parseSplitId(id).build }),
    maxRebuilds: x.maxRebuilds === undefined ? DEFAULT_MAX_REBUILDS : int(x.maxRebuilds, DEFAULT_MAX_REBUILDS, 10),
    failure: normFailure(x.failure),
    history: (Array.isArray(x.history) ? x.history : []).map(normTransition).filter(Boolean).slice(-HISTORY_MAX),
  };
}

/** The store's main lock (main-lock@1), or null for none / not in shape (a lock without a build, split id or sha is no lock). */
export function normMainLock(l) {
  const x = obj(l); if (!x) return null;
  const build = BUILD_ID_RE.test(str(x.build, 80)) ? str(x.build, 80) : '';
  const splitId = isSplitId(x.splitId) ? x.splitId : '';
  const base = sha(x.base); const lockedAt = iso(x.lockedAt);
  if (!build || !splitId || !base || !lockedAt || parseSplitId(splitId).build !== build) return null;
  return { $axf: LOCK_SCHEMA, build, splitId, base, lockedAt, by: str(x.by, 80), ...(str(x.note).trim() ? { note: str(x.note, 300) } : {}) };
}

// ------------------------------------------------------------------ planner (planParts) and validator (validatePlan)

/** A step's file claims, normalised: trimmed, a leading `./` dropped, no empties, no repeats, ≤ 300 chars each. */
export function claimsOf(step, fileClaims = {}) {
  const s = obj(step) ?? {};
  const extra = obj(fileClaims)?.[s.id];
  const raw = [...(Array.isArray(s.files) ? s.files : []), ...(Array.isArray(extra) ? extra : [])];
  return [...new Set(raw.map((f) => str(f, 300).trim().replace(/^\.\//, '')).filter(Boolean))];
}

/** A step's estimate in minutes (`10 min`, `~15m`, `1 h`, `1.5 h`); DEFAULT_STEP_MINUTES when it says nothing usable. */
export const DEFAULT_STEP_MINUTES = 10;
export function estimateMinutes(step) {
  const m = /(\d+(?:\.\d+)?)\s*(h|hr|hour|hours|m|min|mins|minute|minutes)?\b/i.exec(str(obj(step)?.estimate, 20));
  if (!m) return DEFAULT_STEP_MINUTES;
  const n = Number(m[1]); const unit = (m[2] || 'min').toLowerCase();
  const mins = /^h/.test(unit) ? n * 60 : n;
  return Number.isFinite(mins) && mins > 0 ? Math.round(mins) : DEFAULT_STEP_MINUTES;
}

/** The open steps of a build (not done, not skipped), with their index in the build's list. */
export const openStepsOf = (build) => (Array.isArray(obj(build)?.steps) ? build.steps : []).map((s, i) => ({ step: s, i })).filter(({ step }) => obj(step) && !step.done && !step.skip);

/**
 * Open steps grouped by shared file claims (union-find): two steps that claim the same file are one group; a step
 * with no claim joins the previous step's group (it keeps its checkpoint order), the first such step opens its own.
 * Groups come back in first-step order: [{ steps: [step id…], files: [path…], minutes }].
 */
export function groupSteps(build, fileClaims = {}) {
  const open = openStepsOf(build);
  const parent = open.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const owner = new Map(); // file → first open-step index claiming it
  const claims = open.map(({ step }) => claimsOf(step, fileClaims));
  claims.forEach((files, i) => {
    if (!files.length) { if (i > 0) union(i, i - 1); return; }
    for (const f of files) { if (owner.has(f)) union(i, owner.get(f)); else owner.set(f, i); }
  });
  const groups = new Map();
  open.forEach(({ step }, i) => {
    const r = find(i);
    const g = groups.get(r) ?? { steps: [], files: new Set(), minutes: 0, first: i };
    g.steps.push(str(step.id, 40)); for (const f of claims[i]) g.files.add(f); g.minutes += estimateMinutes(step);
    groups.set(r, g);
  });
  return [...groups.values()].sort((a, b) => a.first - b.first).map((g) => ({ steps: g.steps, files: [...g.files].sort(), minutes: g.minutes }));
}

/**
 * Groups packed into at most `n` bins: heaviest first (minutes, ties by first appearance) onto the lightest bin so the
 * parts finish close together. Bins come back ordered by the index of their earliest group; each bin's steps keep the
 * build's order.
 */
export function packGroups(groups, n) {
  const bins = Math.max(0, Math.min(Number(n) || 0, groups.length));
  if (!bins) return [];
  const order = groups.map((g, i) => ({ g, i })).sort((a, b) => b.g.minutes - a.g.minutes || a.i - b.i);
  const out = Array.from({ length: bins }, () => ({ groups: [], minutes: 0, first: Infinity }));
  for (const { g, i } of order) {
    const bin = out.reduce((best, b) => (b.minutes < best.minutes || (b.minutes === best.minutes && b.first < best.first) ? b : best), out[0]);
    bin.groups.push({ g, i }); bin.minutes += g.minutes; bin.first = Math.min(bin.first, i);
  }
  return out.filter((b) => b.groups.length).sort((a, b) => a.first - b.first).map((b) => {
    const gs = b.groups.sort((x, y) => x.i - y.i).map((x) => x.g);
    return { steps: gs.flatMap((g) => g.steps), files: [...new Set(gs.flatMap((g) => g.files))].sort(), minutes: b.minutes };
  });
}

/** The run number the next plan of a build gets: its last split id's run + 1 (1 for a build never split). */
export const nextRunOf = (build) => (parseSplitId(obj(build)?.splitId)?.run ?? parseSplitId(obj(obj(build)?.split)?.id)?.run ?? 0) + 1;

/**
 * Plan a run: as many parts as there are free slots, never more than the build's independent file groups, never fewer
 * than one while a slot is free; no two parts claim the same file; every open step in exactly one part.
 *   build       a builds@1 record (id, splitId, steps)
 *   freeSlots   free agent slots right now (0 → nothing is planned)
 *   fileClaims  { [step id]: [path…] } extra claims (the splitter's predictions), merged with step.files
 *   opts        { base: main sha ('' until main is locked), run, at, by, maxRebuilds, used }
 * → { ok, plan | null, why, groups, fill: { parts, slots } }. The plan is in shape (normSplit) and valid (validatePlan).
 */
export function planParts(build, freeSlots, fileClaims = {}, opts = {}) {
  const b = obj(build) ?? {};
  const id = str(b.id, 80);
  const free = Math.max(0, Math.floor(Number(freeSlots) || 0));
  const out = (ok, plan, why, groups = [], parts = 0) => ({ ok, plan, why, groups, fill: { parts, slots: free } });
  if (!BUILD_ID_RE.test(id)) return out(false, null, `"${id}" is not a build id (build-id@1)`);
  const run = Number.isInteger(opts.run) && opts.run >= 1 ? opts.run : nextRunOf(b);
  const splitId = splitIdOf(id, run);
  if (!splitId) return out(false, null, `run ${run} of ${id} has no valid split id`);
  const groups = groupSteps(b, fileClaims);
  if (!groups.length) return out(false, null, 'no open step: nothing to plan', groups);
  if (!free) return out(false, null, 'no free agent slot: the run waits', groups);
  const bins = packGroups(groups, Math.min(free, MAX_PARTS)).map((bin) => ({ ...bin, steps: inBuildOrder(b, bin.steps) }));
  const base = sha(opts.base);
  const at = iso(opts.at) || new Date().toISOString();
  const parts = bins.map((bin, k) => ({ id: `p${k + 1}`, status: 'waiting', steps: bin.steps, files: bin.files, branch: partBranch(splitId, `p${k + 1}`), base, slot: '', account: '', session: '', model: oneOf(MODELS, firstModel(b, bin.steps), ''), head: '', startedAt: '', endedAt: '', rebuilds: 0, lastError: '', note: `${bin.minutes} min planned` }));
  const plan = normSplit({
    $axf: SCHEMA, id: splitId, run: 'queued', base, at, by: str(opts.by, 80) || 'dispatcher',
    slots: { free, used: int(opts.used) }, parts, combine: { branch: combineBranch(id) },
    maxRebuilds: opts.maxRebuilds === undefined ? DEFAULT_MAX_REBUILDS : int(opts.maxRebuilds, DEFAULT_MAX_REBUILDS, 10),
    failure: null, history: [{ at, from: 'splitting', to: 'queued', why: `${parts.length} part${parts.length === 1 ? '' : 's'} for ${free} free slot${free === 1 ? '' : 's'} (${groups.length} file group${groups.length === 1 ? '' : 's'})` }],
  }, { build: id });
  const v = validatePlan(plan, b);
  if (!v.ok) return out(false, null, `planned, but invalid: ${v.errors.join('; ')}`, groups, parts.length);
  const why = parts.length < free ? `${parts.length} part${parts.length === 1 ? '' : 's'}: only ${groups.length} independent file group${groups.length === 1 ? '' : 's'}, ${free} slot${free === 1 ? '' : 's'} free` : `${parts.length} part${parts.length === 1 ? '' : 's'}: every free slot filled`;
  return out(true, plan, why, groups, parts.length);
}
/** Step ids sorted by their place in the build's list (a part's steps run in build order). */
function inBuildOrder(build, stepIds) {
  const at = new Map((Array.isArray(build.steps) ? build.steps : []).map((s, i) => [str(obj(s)?.id, 40), i]));
  return [...stepIds].sort((x, y) => (at.get(x) ?? 1e9) - (at.get(y) ?? 1e9));
}
/** The model of a part's first step (the phase it launches on), '' when unknown. */
function firstModel(build, stepIds) {
  const first = (Array.isArray(build.steps) ? build.steps : []).find((s) => obj(s) && str(s.id, 40) === stepIds[0]);
  return first ? str(first.model, 20) : '';
}

/**
 * Is this plan sound for this build? → { ok, errors[] }. Shape (normSplit round-trip), the id names the build, part
 * ids p1..pn in order, no file in two parts, every open step in exactly one part and no done / skipped / unknown step
 * in any, one base on every part equal to the plan's, part branches and the combine branch in format, parts ≤ free
 * slots when slots are recorded, failure only on a failed run.
 */
export function validatePlan(plan, build, opts = {}) {
  const errors = []; const err = (m) => errors.push(m);
  const b = obj(build) ?? {};
  const p = obj(plan);
  if (!p) return { ok: false, errors: ['no plan'] };
  const norm = normSplit(p, { build: str(b.id, 80) });
  if (!norm) return { ok: false, errors: [str(b.id) ? `not a split-plan@1 of ${b.id}` : 'not a split-plan@1'] };
  if (JSON.stringify(norm) !== JSON.stringify(p)) err('not in shape: differs from its normSplit form');
  if (str(b.splitId) && str(b.splitId) !== norm.id && parseSplitId(b.splitId).run >= parseSplitId(norm.id).run) err(`run ${parseSplitId(norm.id).run} is not after the build's last run (${b.splitId})`);
  if (norm.parts.length > MAX_PARTS) err(`more than ${MAX_PARTS} parts`);
  norm.parts.forEach((part, k) => { if (part.id !== `p${k + 1}`) err(`parts[${k}].id is ${part.id}, expected p${k + 1} (ids in order)`); });
  // files: one part per file
  const fileOwner = new Map();
  for (const part of norm.parts) for (const f of part.files) { if (fileOwner.has(f) && fileOwner.get(f) !== part.id) err(`file ${f} is in ${fileOwner.get(f)} and ${part.id}`); else fileOwner.set(f, part.id); }
  // steps: every open step once, nothing else
  const steps = Array.isArray(b.steps) ? b.steps.filter(obj) : [];
  const byId = new Map(steps.map((s) => [str(s.id, 40), s]));
  const seen = new Map();
  for (const part of norm.parts) {
    if (!part.steps.length) err(`${part.id} has no step`);
    for (const sid of part.steps) {
      const s = byId.get(sid);
      if (!s) err(`${part.id} names step ${sid}, which the build does not have`);
      else if (s.done || s.skip) err(`${part.id} names step ${sid}, which is ${s.done ? 'done' : 'skipped'}`);
      if (seen.has(sid) && seen.get(sid) !== part.id) err(`step ${sid} is in ${seen.get(sid)} and ${part.id}`); else seen.set(sid, part.id);
    }
  }
  if (steps.length) for (const s of steps) { const sid = str(s.id, 40); if (!s.done && !s.skip && !seen.has(sid)) err(`open step ${sid} is in no part`); }
  for (const part of norm.parts) { const idx = part.steps.map((sid) => steps.findIndex((s) => str(s.id, 40) === sid)); if (idx.some((x, i) => i && x >= 0 && idx[i - 1] >= 0 && x < idx[i - 1])) err(`${part.id} steps are not in the build's order`); }
  // one base, branches in format
  for (const part of norm.parts) {
    if (part.base !== norm.base) err(`${part.id} base ${part.base || '(none)'} differs from the plan's ${norm.base || '(none)'}`);
    if (part.branch !== partBranch(norm.id, part.id)) err(`${part.id} branch ${part.branch || '(none)'} is not ${partBranch(norm.id, part.id)}`);
    if (opts.base && sha(opts.base) && part.base && part.base !== sha(opts.base)) err(`${part.id} base is not the main lock's (${sha(opts.base)})`);
  }
  if (norm.combine.branch !== combineBranch(parseSplitId(norm.id).build)) err(`combine branch ${norm.combine.branch || '(none)'} is not ${combineBranch(parseSplitId(norm.id).build)}`);
  if (norm.slots && norm.parts.length > norm.slots.free) err(`${norm.parts.length} parts for ${norm.slots.free} free slot${norm.slots.free === 1 ? '' : 's'}`);
  if (norm.run !== 'splitting' && !norm.parts.length) err(`run is ${norm.run} with no parts`);
  if (norm.failure && norm.run !== 'failed') err(`failure recorded while the run is ${norm.run}`);
  if (norm.run === 'failed' && !norm.failure) err('a failed run says why (failure)');
  return { ok: !errors.length, errors };
}

// ------------------------------------------------------------------ part and run state machines

/** Part transitions (BUILD-SPLIT.md → Part status): from → the states it may go to. */
export const PART_TRANSITIONS = Object.freeze({
  waiting: Object.freeze(['building', 'failed']),
  building: Object.freeze(['testing', 'waiting', 'failed']),
  testing: Object.freeze(['done', 'failed']),
  failed: Object.freeze(['rebuilding']),
  rebuilding: Object.freeze(['building', 'failed']),
  done: Object.freeze(['rebuilding']), // a combine conflict (combining → building) sends a done part back for a rebuild
});
export const canPart = (from, to) => (PART_TRANSITIONS[from] ?? []).includes(to);
/** Run transitions (BUILD-SPLIT.md → Run state). combining → building: a merge conflict sends a part back for a rebuild. */
export const RUN_TRANSITIONS = Object.freeze({
  splitting: Object.freeze(['queued', 'failed']),
  queued: Object.freeze(['building', 'failed']),
  building: Object.freeze(['combining', 'failed']),
  combining: Object.freeze(['ci', 'building', 'failed']),
  ci: Object.freeze(['merging', 'combining', 'failed']),
  merging: Object.freeze(['merged', 'ci', 'failed']),
  merged: Object.freeze(['live']),
  live: Object.freeze(['finished']),
  finished: Object.freeze([]),
  failed: Object.freeze([]),
});
export const canRun = (from, to) => (RUN_TRANSITIONS[from] ?? []).includes(to);
/** The run states in which the parts decide the state (rollUp applies); past them the combine, CI and landing events do. */
export const PARTS_PHASE = Object.freeze(['splitting', 'queued', 'building']);
export const RUN_TERMINAL = Object.freeze(['finished', 'failed']);
/** The part statuses in which work is under way or owed: the part's badge animates in these and is still on `failed` and `done`. */
export const PART_WORKING = Object.freeze(['waiting', 'building', 'testing', 'rebuilding']);
export const isPartWorking = (part) => PART_WORKING.includes(obj(part)?.status);
/** `done`, or `failed` with no rebuild left. */
export const isPartTerminal = (part, maxRebuilds = DEFAULT_MAX_REBUILDS) => part?.status === 'done' || (part?.status === 'failed' && int(part.rebuilds) >= int(maxRebuilds, DEFAULT_MAX_REBUILDS));

const withHistory = (plan, entry) => ({ ...plan, history: [...(plan.history ?? []), entry].slice(-HISTORY_MAX) });
const partIndex = (plan, partId) => (plan?.parts ?? []).findIndex((p) => p.id === partId);
const replacePart = (plan, i, part) => ({ ...plan, parts: plan.parts.map((p, k) => (k === i ? part : p)) });
const refuse = (plan, why) => ({ ok: false, plan, why, change: null });

/** The part status an event asks for from a given status, or '' when the event does not apply there. */
export function partTarget(status, event) {
  switch (event) {
    case 'launch': return status === 'waiting' || status === 'rebuilding' ? 'building' : '';
    case 'ticked': return status === 'building' ? 'testing' : '';
    case 'green': return status === 'testing' ? 'done' : '';
    case 'fail': return status === 'building' || status === 'testing' ? 'failed' : '';
    case 'crash': return status === 'building' ? 'waiting' : '';
    case 'rebuild': return status === 'failed' ? 'rebuilding' : '';
    case 'abandon': return status === 'waiting' || status === 'rebuilding' ? 'failed' : '';
    case 'conflict': return status === 'done' ? 'rebuilding' : '';
    default: return '';
  }
}

/**
 * Apply one event to one part (pure): → { ok, plan, why, change: { part, from, to } | null }.
 *   launch   { slot, account, session, model }   waiting | rebuilding → building; startedAt = at
 *   ticked                                       building → testing (every step of the part ticked; checks run)
 *   green    { head }                            testing → done (head = the pushed branch tip, required)
 *   fail     { why }                             building | testing → failed (lastError, endedAt); onPartFailed decides what next
 *   crash    { why }                             building → waiting (died before its first tick): slot and session cleared
 *   rebuild                                      failed → rebuilding while rebuilds < maxRebuilds (rebuilds + 1, head cleared)
 *   abandon  { why }                             waiting | rebuilding → failed (the run failed elsewhere: it never runs)
 *   conflict { why }                             done → rebuilding (its branch would not merge at combine) while rebuilds < maxRebuilds
 * A refused event changes nothing and says why; the run state is not touched here (applyRollUp does that).
 */
export function partNext(plan, partId, event, args = {}) {
  const i = partIndex(plan, partId); if (i < 0) return refuse(plan, `no part ${partId}`);
  if (!PART_EVENTS.includes(event)) return refuse(plan, `unknown part event ${event}`);
  if (RUN_TERMINAL.includes(plan.run)) return refuse(plan, `run is ${plan.run}: no part moves (the dispatcher stops what still runs)`);
  const part = plan.parts[i];
  const to = partTarget(part.status, event);
  if (!to) return refuse(plan, `${partId} is ${part.status}: ${event} does not apply`);
  if (!canPart(part.status, to)) return refuse(plan, `${partId}: ${part.status} → ${to} is not allowed`);
  const at = iso(args.at) || new Date().toISOString();
  let next = { ...part, status: to };
  if (event === 'launch') next = { ...next, slot: str(args.slot, 60), account: accountName(args.account), session: str(args.session, 120), model: oneOf(MODELS, args.model, part.model), startedAt: at, endedAt: '', lastError: '' };
  if (event === 'green') { if (!sha(args.head)) return refuse(plan, `${partId}: green needs the pushed head sha`); next = { ...next, head: sha(args.head), endedAt: at }; }
  if (event === 'fail' || event === 'abandon') next = { ...next, lastError: str(args.why, 600) || (event === 'abandon' ? 'the run failed before this part ran' : 'failed'), endedAt: at, slot: '', session: '' };
  if (event === 'crash') next = { ...next, slot: '', session: '', lastError: str(args.why, 600) || 'session died before its first tick', startedAt: '' };
  if (event === 'rebuild' || event === 'conflict') {
    if (int(part.rebuilds) >= int(plan.maxRebuilds, DEFAULT_MAX_REBUILDS)) return refuse(plan, `${partId}: no rebuild left (${part.rebuilds}/${plan.maxRebuilds})`);
    if (event === 'conflict' && plan.run !== 'combining') return refuse(plan, `${partId}: a conflict is only found while combining (run is ${plan.run})`);
    next = { ...next, rebuilds: int(part.rebuilds) + 1, head: '', slot: '', account: '', session: '', startedAt: '', endedAt: '', lastError: event === 'conflict' ? str(args.why, 600) || 'did not merge at combine' : part.lastError };
  }
  const why = str(args.why, 300);
  return { ok: true, plan: withHistory(replacePart(plan, i, next), { at, from: part.status, to, part: partId, ...(why ? { why } : {}) }), why: '', change: { part: partId, from: part.status, to } };
}

/**
 * The run state the parts imply (the parts phase only): no parts → splitting; a part failed with no rebuild left →
 * failed; every part done → combining; every part waiting → queued; anything else (building, testing, rebuilding, a
 * failed part that still has a rebuild) → building.
 */
export function rollUp(parts, maxRebuilds = DEFAULT_MAX_REBUILDS) {
  const list = Array.isArray(parts) ? parts.filter(obj) : [];
  if (!list.length) return 'splitting';
  if (list.some((p) => p.status === 'failed' && isPartTerminal(p, maxRebuilds))) return 'failed';
  if (list.every((p) => p.status === 'done')) return 'combining';
  if (list.every((p) => p.status === 'waiting')) return 'queued';
  return 'building';
}
/** The expandable queue row's badge: { state, done, total, label } ('Building 2/4', 'Combining', 'Queued', …). */
export function rollUpBadge(plan) {
  const parts = Array.isArray(plan?.parts) ? plan.parts.filter(obj) : []; const total = parts.length; const done = parts.filter((p) => p.status === 'done').length;
  const state = PARTS_PHASE.includes(plan?.run) || !plan?.run ? rollUp(parts, plan?.maxRebuilds) : plan.run;
  const word = state.charAt(0).toUpperCase() + state.slice(1);
  const label = state === 'building' ? `Building ${done}/${total}` : state === 'ci' ? 'CI' : word;
  return { state, done, total, label };
}

/**
 * All-or-nothing: → { ok, why }. Every part done with a pushed head, every part on the plan's base, a base set, and the
 * run not failed (a failed run never combines, whatever its parts say: the next try is a new run).
 */
export function combineReady(plan) {
  const parts = Array.isArray(plan?.parts) ? plan.parts.filter(obj) : [];
  if (!parts.length) return { ok: false, why: 'no parts' };
  if (plan.run === 'failed') return { ok: false, why: `the run failed: nothing combines${plan.failure?.why ? ` (${plan.failure.why})` : ''}` };
  if (!sha(plan.base)) return { ok: false, why: 'no base: main was never locked for this run' };
  const open = parts.filter((p) => p.status !== 'done');
  if (open.length) return { ok: false, why: `${open.length} of ${parts.length} part${parts.length === 1 ? '' : 's'} not done: ${open.map((p) => `${p.id} ${p.status}`).join(', ')}` };
  const noHead = parts.filter((p) => !sha(p.head)); if (noHead.length) return { ok: false, why: `${noHead.map((p) => p.id).join(', ')} done without a pushed head` };
  const offBase = parts.filter((p) => p.base !== plan.base); if (offBase.length) return { ok: false, why: `${offBase.map((p) => p.id).join(', ')} not on the run's base` };
  return { ok: true, why: '' };
}

/**
 * Move the run (pure): → { ok, plan, why, change }. Combine events ride along in `args`: head, pr, ci, ciRun
 * (combining → ci), mergedAt (→ merged), liveAt (→ live), finishedAt (→ finished); `why` goes to the history and to
 * `failure` on → failed (with `part`). building → combining is refused until combineReady; failed is terminal. Leaving
 * ci for combining or failed records the red run (combine.ci = failure).
 */
export function runNext(plan, to, args = {}) {
  if (!RUN_STATES.includes(to)) return refuse(plan, `unknown run state ${to}`);
  const from = plan.run;
  if (!canRun(from, to)) return refuse(plan, `run: ${from} → ${to} is not allowed`);
  if (to === 'combining' && from === 'building') { const r = combineReady(plan); if (!r.ok) return refuse(plan, `not ready to combine: ${r.why}`); }
  const at = iso(args.at) || new Date().toISOString();
  const why = str(args.why, 300);
  let next = { ...plan, run: to };
  const c = { ...plan.combine };
  if (to === 'combining') { c.startedAt = c.startedAt || at; c.attempts = int(c.attempts) + 1; c.ci = ''; }
  if (to === 'ci') { c.head = sha(args.head) || c.head; if (args.pr !== undefined) c.pr = normCombine({ pr: args.pr }).pr; c.ci = oneOf(COMBINE_CI, args.ci, 'running'); c.ciRun = str(args.ciRun, 300) || c.ciRun; }
  if (to === 'merging') c.ci = 'success';
  if (to === 'merged') c.mergedAt = iso(args.mergedAt) || at;
  if (to === 'live') c.liveAt = iso(args.liveAt) || at;
  if (to === 'finished') c.finishedAt = iso(args.finishedAt) || at;
  if (from === 'ci' && (to === 'combining' || to === 'failed')) c.ci = 'failure';
  if (to === 'failed') {
    next.failure = { at, part: isPartId(args.part) ? args.part : '', why: why || 'failed' };
    next.parts = next.parts.map((p) => (partTarget(p.status, 'abandon') ? { ...p, status: 'failed', lastError: p.lastError || 'the run failed before this part ran', endedAt: at, slot: '', session: '' } : p));
  }
  next.combine = c;
  return { ok: true, plan: withHistory(next, { at, from, to, ...(isPartId(args.part) ? { part: args.part } : {}), ...(why ? { why } : {}) }), why: '', change: { from, to } };
}

/**
 * After a part failed (pure): the part goes `failed`; while it has a rebuild left it goes straight on to `rebuilding`
 * (its steps are to be un-ticked on the build: `resetSteps`) and the run keeps building; otherwise the run is failed,
 * every waiting / rebuilding part is abandoned and `failure` says which part and why.
 * → { ok, plan, action: 'rebuild' | 'run-failed' | '', resetSteps: [step id…], why }
 */
export function onPartFailed(plan, partId, why = '', at = new Date().toISOString()) {
  const i = partIndex(plan, partId); if (i < 0) return { ok: false, plan, action: '', resetSteps: [], why: `no part ${partId}` };
  let p = plan; const part = p.parts[i];
  const left = int(part.rebuilds) < int(p.maxRebuilds, DEFAULT_MAX_REBUILDS);
  if (part.status === 'done') {
    // a done part that would not merge at combine: rebuilt on the same base, the run back to building; else the run fails
    if (p.run !== 'combining') return { ok: false, plan, action: '', resetSteps: [], why: `${partId} is done and the run is ${p.run}: nothing failed` };
    if (left) {
      const c = partNext(p, partId, 'conflict', { at, why: str(why, 300) || 'did not merge at combine' });
      if (!c.ok) return { ok: false, plan, action: '', resetSteps: [], why: c.why };
      const run = runNext(c.plan, 'building', { at, part: partId, why: `rebuild ${int(part.rebuilds) + 1}/${p.maxRebuilds}: ${partId} did not merge` });
      return { ok: true, plan: run.ok ? run.plan : c.plan, action: 'rebuild', resetSteps: [...part.steps], why: str(why, 300) };
    }
  } else {
    if (part.status !== 'failed') { const f = partNext(p, partId, 'fail', { at, why }); if (!f.ok) return { ok: false, plan, action: '', resetSteps: [], why: f.why }; p = f.plan; }
    const r = partNext(p, partId, 'rebuild', { at, why: `rebuild ${int(part.rebuilds) + 1}/${p.maxRebuilds}` });
    if (r.ok) return { ok: true, plan: r.plan, action: 'rebuild', resetSteps: [...part.steps], why: r.plan.history.at(-1)?.why ?? '' };
  }
  const f = RUN_TERMINAL.includes(p.run) ? { ok: true, plan: p } : runNext(p, 'failed', { at, part: partId, why: `${partId} failed for good (${int(part.rebuilds)}/${p.maxRebuilds} rebuilds): ${str(why, 200) || 'no reason given'}` });
  return { ok: true, plan: f.plan, action: 'run-failed', resetSteps: [], why: f.plan.failure?.why ?? '' };
}

/**
 * The parts phase's run state from its parts (pure): queued → building once a part launched, building → combining
 * once every part is done; a terminal failure fails the run (through runNext, so the parts are abandoned and the
 * failure named). Outside the parts phase the plan is returned as is. → { plan, change: { from, to } | null }
 */
export function applyRollUp(plan, at = new Date().toISOString()) {
  if (!PARTS_PHASE.includes(plan?.run)) return { plan, change: null };
  const want = rollUp(plan.parts, plan.maxRebuilds);
  if (want === plan.run || want === 'splitting') return { plan, change: null };
  if (want === 'failed') { const bad = plan.parts.find((p) => p.status === 'failed' && isPartTerminal(p, plan.maxRebuilds)); const r = runNext(plan, 'failed', { at, part: bad?.id, why: `${bad?.id ?? 'a part'} failed for good` }); return { plan: r.plan, change: r.change }; }
  // the parts phase is a line (splitting → queued → building → combining): walk it, never back (every part crashed
  // back to waiting reads as building still: they relaunch)
  const line = [...PARTS_PHASE, 'combining'];
  const from = line.indexOf(plan.run); const to = line.indexOf(want);
  if (to <= from) return { plan, change: null };
  let cur = plan;
  for (let k = from; k < to; k += 1) { const r = runNext(cur, line[k + 1], { at }); if (!r.ok) return { plan: cur, change: cur === plan ? null : { from: plan.run, to: cur.run } }; cur = r.plan; }
  return { plan: cur, change: { from: plan.run, to: cur.run } };
}

// ------------------------------------------------------------------ one run at a time and the main lock (main-lock@1)

/**
 * A run is active from `building` through `live`: main belongs to it. `queued` runs wait their turn; `finished` and
 * `failed` have given main back (BUILD-SPLIT.md → One run at a time and the main lock).
 */
export const RUN_ACTIVE = Object.freeze(['building', 'combining', 'ci', 'merging', 'merged', 'live']);
export const isRunActive = (plan) => RUN_ACTIVE.includes(obj(plan)?.run);

/** The split record of a builds@1 build in shape (its `split`, read as the build's own plan), or null. */
export const planOf = (build) => normSplit(obj(build)?.split, { build: str(obj(build)?.id, 80) });

/**
 * The builds whose run is active, in the order given: [{ build: id, splitId, run }]. One at most when the rule held;
 * more than one is what the dispatcher inherited (reported, never started by it).
 */
export function activeRuns(builds) {
  return (Array.isArray(builds) ? builds : []).filter((b) => obj(b) && !b.deleted).map((b) => ({ b, plan: planOf(b) }))
    .filter(({ plan }) => isRunActive(plan)).map(({ b, plan }) => ({ build: str(b.id, 80), splitId: plan.id, run: plan.run }));
}

/** Does this lock belong to this split? */
export const holdsMainLock = (lock, splitId) => { const l = normMainLock(lock); return !!l && isSplitId(splitId) && l.splitId === splitId; };

/**
 * Take the main lock for a split (pure) → { ok, lock, why, taken }. `sha` is main's head at this moment: it becomes the
 * one base of the whole run. Refused while another split holds the lock, and for the same split with another sha (the
 * base of a run is never rewritten). Taking a lock this split already holds changes nothing (`taken: false`).
 */
export function takeMainLock(lock, { splitId, sha: head, at = new Date().toISOString(), by = 'dispatcher', note = '' } = {}) {
  const held = normMainLock(lock);
  const sp = parseSplitId(splitId);
  if (!sp) return { ok: false, lock: held, why: `"${str(splitId, 60)}" is not a split id: main is locked only for a split run`, taken: false };
  const base = sha(head);
  if (!base) return { ok: false, lock: held, why: 'the main lock needs main\'s full commit sha', taken: false };
  if (held && held.splitId !== splitId) return { ok: false, lock: held, why: `main is locked by ${held.build} (${held.splitId}) since ${held.lockedAt}: one build at a time`, taken: false };
  if (held && held.base !== base) return { ok: false, lock: held, why: `${splitId} already holds main at ${held.base.slice(0, 12)}: the base of a run is never rewritten`, taken: false };
  if (held) return { ok: true, lock: held, why: '', taken: false };
  const next = normMainLock({ build: sp.build, splitId, base, lockedAt: iso(at) || new Date().toISOString(), by: str(by, 80) || 'dispatcher', note });
  return { ok: true, lock: next, why: '', taken: true };
}

/**
 * Give main back (pure) → { ok, lock, why, released }. With `splitId`, only that split's lock is released (another
 * run's lock is left alone and the call refused); without it, whatever lock there is (the watchdog's stale release).
 * No lock held = ok, nothing released.
 */
export function releaseMainLock(lock, { splitId = '' } = {}) {
  const held = normMainLock(lock);
  if (!held) return { ok: true, lock: null, why: '', released: null };
  if (splitId && held.splitId !== splitId) return { ok: false, lock: held, why: `main is locked by ${held.splitId}, not ${str(splitId, 60)}`, released: null };
  return { ok: true, lock: null, why: '', released: held };
}

/**
 * A lock nobody is working under: older than `staleMs` with no live session on its build (`live` = the dispatcher's
 * answer), or one whose run is over (`plan` = the holder's plan: finished, failed, or another split by now).
 * → { stale, why }.
 */
export function mainLockStale(lock, { now = Date.now(), live = false, plan = undefined, staleMs = MAIN_LOCK_STALE_MS } = {}) {
  const held = normMainLock(lock);
  if (!held) return { stale: false, why: '' };
  const p = obj(plan);
  if (plan !== undefined && (!p || p.id !== held.splitId)) return { stale: true, why: `${held.splitId} is no longer ${held.build}'s plan` };
  if (p && RUN_TERMINAL.includes(p.run)) return { stale: true, why: `run ${held.splitId} is ${p.run}: main was never given back` };
  const age = (typeof now === 'number' ? now : Date.parse(now)) - Date.parse(held.lockedAt);
  if (!live && age > staleMs) return { stale: true, why: `held ${Math.round(age / 3600e3)} h with no live session on ${held.build}` };
  return { stale: false, why: '' };
}

/**
 * May this run start now? (pure) → { ok, why }. One build at a time: a `queued` run starts only when no other run is
 * active (`builds` = the store's builds) and main is free or already held by this split.
 */
export function canStartRun(plan, { lock = null, builds = [] } = {}) {
  const p = obj(plan);
  if (!p || !isSplitId(p.id)) return { ok: false, why: 'no split plan: a build starts only through the splitter' };
  if (p.run !== 'queued') return { ok: false, why: `run is ${p.run}: only a queued run starts` };
  if (!(Array.isArray(p.parts) ? p.parts : []).length) return { ok: false, why: 'the plan has no parts' };
  const held = normMainLock(lock);
  if (held && held.splitId !== p.id) return { ok: false, why: `main is locked by ${held.build} (${held.splitId}): one build at a time` };
  const other = activeRuns(builds).find((r) => r.splitId !== p.id);
  if (other) return { ok: false, why: `${other.build} is ${other.run} (${other.splitId}): one build at a time` };
  return { ok: true, why: '' };
}

/**
 * Start a run (pure): take the main lock and, in the same step, move the run `queued` → `building` with the locked sha
 * as its base and as the base of every part (no part pulls main again). → { ok, plan, lock, why, change }. The caller
 * writes `plan` and `lock` in one store write. Refused by canStartRun, by takeMainLock, and when the plan already has
 * another base. Nothing changes on a refusal.
 */
export function startRun(plan, { lock = null, builds = [], sha: head, at = new Date().toISOString(), by = 'dispatcher' } = {}) {
  const refuseStart = (why) => ({ ok: false, plan, lock: normMainLock(lock), why, change: null });
  const can = canStartRun(plan, { lock, builds });
  if (!can.ok) return refuseStart(can.why);
  const base = sha(head);
  if (plan.base && base && plan.base !== base) return refuseStart(`the plan is already based on ${plan.base.slice(0, 12)}: the base of a run is never rewritten`);
  const took = takeMainLock(lock, { splitId: plan.id, sha: base || plan.base, at, by });
  if (!took.ok) return refuseStart(took.why);
  const based = { ...plan, base: took.lock.base, parts: plan.parts.map((p) => ({ ...p, base: took.lock.base })) };
  const run = runNext(based, 'building', { at, why: `main locked at ${took.lock.base.slice(0, 12)}` });
  if (!run.ok) return refuseStart(run.why);
  return { ok: true, plan: run.plan, lock: took.lock, why: '', change: run.change };
}

/**
 * The lock after a run moved (pure): released once the run is `finished` or `failed`, kept otherwise.
 * → { lock, released }. Call it with the plan a transition returned, in the same store write.
 */
export function lockAfterRun(plan, lock) {
  const held = normMainLock(lock);
  if (!held || !obj(plan) || held.splitId !== plan.id || !RUN_TERMINAL.includes(plan.run)) return { lock: held, released: null };
  return { lock: null, released: held };
}

/** Every part is on the run's one base (the locked main sha): → { ok, why }. */
export function oneBase(plan, lock = undefined) {
  const p = obj(plan); const parts = Array.isArray(p?.parts) ? p.parts.filter(obj) : [];
  const off = parts.filter((x) => x.base !== p.base);
  if (off.length) return { ok: false, why: `${off.map((x) => x.id).join(', ')} not on the run's base (${p.base ? p.base.slice(0, 12) : 'none'})` };
  const held = lock === undefined ? null : normMainLock(lock);
  if (isRunActive(p) && !sha(p.base)) return { ok: false, why: `run is ${p.run} with no base: main was never locked for it` };
  if (held && held.splitId === p.id && held.base !== p.base) return { ok: false, why: `the plan's base ${p.base ? p.base.slice(0, 12) : '(none)'} is not the main lock's (${held.base.slice(0, 12)})` };
  return { ok: true, why: '' };
}
