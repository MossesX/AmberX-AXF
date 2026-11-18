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
export const PART_EVENTS = Object.freeze(['launch', 'ticked', 'green', 'fail', 'crash', 'rebuild', 'abandon']);
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
