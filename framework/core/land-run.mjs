/**
 * land-run@1 — one serial landing attempt of a built branch onto main (pure, IO-free).
 *
 * Brett, Nov 14 2026: "We need to make sure things are landing as soon as they're built and merged as soon as they're
 * built. I keep getting too many commits behind" (build land-finish-auto-land-live-clear-backlog). The auto-lander takes
 * built builds one at a time (serial: every attempt starts from the main the one before it produced), merges main into
 * the branch, regenerates the generated files (generated-files@1, framework/cli/land-resolve.py), runs their checks,
 * waits for CI on the merged head and lands it. Each attempt is one of these records, so the Landing view, the API and
 * the phone can say what happened to every build without reading git or GitHub again.
 *
 *   land-run@1 = {
 *     id:          lr-<build>-<yyyymmddThhmmss> (newLandRunId), stable for the attempt
 *     build:       the builds@1 id            branch, pr: the branch landed and its PR number (0 = none)
 *     startedAt, endedAt   ISO ('' while running)
 *     base:        sha of main's head the attempt merged onto     head:    sha of the branch head taken
 *     merged:      sha of the result that lands ('' until the merge is made)
 *     regenerated: files the resolver regenerated from the merged sources (paths, in manifest order)
 *     unresolved:  source files the resolver could not settle (a real clash: a person has to look)
 *     check:       { ok: true | false | null (not run), failed: [generator / test names], note }
 *     ci:          { run: run id or URL, status, conclusion, state }   state = ciState(status, conclusion):
 *                  queued | waiting | running | success | failure | cancelled. A cancelled run is NOT a failure: the
 *                  attempt is retried, no fix build is filed, the build stays waiting.
 *     outcome:     '' (still running) | landed | red | clash | cancelled | error
 *                  landed   merged sha is on main (CI success)
 *                  red      the merged tree failed: a generator check or the manifest's tests, or CI concluded failure
 *                           → a fix build is filed (fixBuild) and the build shows red
 *                  clash    unresolved source files → the build is flagged for a person
 *                  cancelled  CI was cancelled (a newer run superseded it, a runner died): try again
 *                  error    the lander itself broke (git, network, GitHub): try again, say why in `note`
 *     fixBuild:    the builds@1 id of the fix build filed on red ('' otherwise)
 *     error:       the lander's own error text ('' when none)
 *     note:        one plain line for the build's notes and the phone
 *   }
 *
 * Where attempts are kept and how they are made is the lander's (IO) side; this module only knows the record, its
 * rules (validateLandRun), how facts become an outcome (outcomeOf) and the entry a build's `land.landAttempts` gets
 * for it (attemptOf, build-pipeline@1 `land`). Every port replays spec/fixtures/land-run.json.
 */

export const SCHEMA = 'land-run@1';
export const OUTCOMES = ['', 'landed', 'red', 'clash', 'cancelled', 'error'];
export const CI_STATES = ['', 'queued', 'waiting', 'running', 'success', 'failure', 'cancelled'];
export const MAX_FILES = 200;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const iso = (v) => { const s = str(v, 40).trim(); return ISO_RE.test(s) && Number.isFinite(Date.parse(s)) ? s : ''; };
const SHA_RE = /^[0-9a-f]{7,40}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
/** A git sha (7 to 40 hex digits, lower-cased), or ''. */
export const sha = (v) => { const s = str(v, 40).trim().toLowerCase(); return SHA_RE.test(s) ? s : ''; };
const ident = (v, max = 120) => { const s = str(v, max).trim(); return ID_RE.test(s) ? s : ''; };
const files = (v) => [...new Set((Array.isArray(v) ? v : []).map((f) => str(f, 300).trim()).filter(Boolean))].slice(0, MAX_FILES);
const prNumber = (v) => { const m = /(\d+)\s*$/.exec(str(v, 200)); const n = m ? parseInt(m[1], 10) : 0; return Number.isInteger(n) && n > 0 ? n : 0; };

/** GitHub Actions (status, conclusion) → a CI state. Cancelled, skipped and neutral are `cancelled`, never `failure`. */
export function ciState(status, conclusion) {
  const st = str(status, 40).trim().toLowerCase();
  const c = str(conclusion, 40).trim().toLowerCase();
  if (st === 'in_progress') return 'running';
  if (st === 'waiting' || st === 'pending' || st === 'action_required') return 'waiting';
  if (st === 'queued' || st === 'requested') return 'queued';
  if (!st && !c) return '';
  if (c === 'success') return 'success';
  if (c === 'cancelled' || c === 'canceled' || c === 'skipped' || c === 'neutral' || c === 'stale') return 'cancelled';
  if (!c) return st === 'completed' ? 'failure' : '';
  return 'failure';
}

/** An attempt id: lr-<build>-<yyyymmddThhmmss> (UTC). */
export function newLandRunId(build, startedAt = new Date().toISOString()) {
  const t = iso(startedAt) || new Date().toISOString();
  return `lr-${ident(build, 80) || 'build'}-${new Date(t).toISOString().slice(0, 19).replace(/[-:]/g, '')}`;
}

export function emptyLandRun() {
  return { id: '', build: '', branch: '', pr: 0, startedAt: '', endedAt: '', base: '', head: '', merged: '', regenerated: [], unresolved: [], check: { ok: null, failed: [], note: '' }, ci: { run: '', status: '', conclusion: '', state: '' }, outcome: '', fixBuild: '', error: '', note: '' };
}

function normCheck(c) {
  const o = c && typeof c === 'object' ? c : {};
  const failed = files(o.failed);
  return { ok: o.ok === true ? true : o.ok === false || failed.length ? false : null, failed, note: str(o.note, 400) };
}
function normCi(c) {
  const o = c && typeof c === 'object' ? c : {};
  const status = str(o.status, 40).trim().toLowerCase(); const conclusion = str(o.conclusion, 40).trim().toLowerCase();
  const derived = ciState(status, conclusion);
  return { run: str(o.run, 300).trim(), status, conclusion, state: derived || (CI_STATES.includes(o.state) ? o.state : '') };
}

/** The record, every field in shape; null for junk that names no build and no id. */
export function normLandRun(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const build = ident(v.build, 80);
  const startedAt = iso(v.startedAt);
  const out = {
    id: ident(v.id) || (build && startedAt ? newLandRunId(build, startedAt) : ''),
    build, branch: str(v.branch, 200).trim(), pr: prNumber(v.pr),
    startedAt, endedAt: iso(v.endedAt),
    base: sha(v.base), head: sha(v.head), merged: sha(v.merged),
    regenerated: files(v.regenerated), unresolved: files(v.unresolved),
    check: normCheck(v.check), ci: normCi(v.ci),
    outcome: OUTCOMES.includes(v.outcome) ? v.outcome : '',
    fixBuild: ident(v.fixBuild, 80), error: str(v.error, 1000), note: str(v.note, 400),
  };
  if (out.outcome && out.outcome !== 'red') out.fixBuild = ''; // only a red attempt files one; an unsettled record keeps it for settleLandRun
  return out.id || out.build ? out : null;
}

/**
 * What the facts of an attempt say its outcome is ('' = still going). In order: the lander's own error; unresolved
 * source files (clash); a red generator check (red); CI: success with a merged sha (landed), failure (red), cancelled
 * (cancelled: retry, not a failure); anything else is still running.
 */
export function outcomeOf(run) {
  const r = normLandRun(run) ?? emptyLandRun();
  if (r.error) return 'error';
  if (r.unresolved.length) return 'clash';
  if (r.check.ok === false) return 'red';
  if (r.ci.state === 'success') return r.merged ? 'landed' : '';
  if (r.ci.state === 'failure') return 'red';
  if (r.ci.state === 'cancelled') return 'cancelled';
  return '';
}

/** Is this a land-run@1, and does it hold together? { ok, errors: [{ path, message }] }. */
export function validateLandRun(v) {
  const errors = []; const err = (path, message) => { errors.push({ path, message }); };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, errors: [{ path: 'run', message: 'a land run must be a JSON object' }] };
  if (!ident(v.id)) err('id', 'is missing or not an id');
  if (!ident(v.build, 80)) err('build', 'names the builds@1 build it lands');
  if (!iso(v.startedAt)) err('startedAt', 'is not an ISO timestamp');
  if (v.endedAt && !iso(v.endedAt)) err('endedAt', 'is not an ISO timestamp');
  if (iso(v.startedAt) && iso(v.endedAt) && Date.parse(v.endedAt) < Date.parse(v.startedAt)) err('endedAt', 'is before startedAt');
  for (const k of ['base', 'head', 'merged']) if (v[k] && !sha(v[k])) err(k, 'must be a git sha');
  if (v.pr !== undefined && v.pr !== '' && v.pr !== 0 && !prNumber(v.pr)) err('pr', 'must be a PR number (0 or \'\' = none)');
  for (const k of ['regenerated', 'unresolved']) if (v[k] !== undefined && (!Array.isArray(v[k]) || v[k].some((f) => typeof f !== 'string' || !f))) err(k, 'must be a list of file paths');
  if (v.check !== undefined && (!v.check || typeof v.check !== 'object' || (v.check.ok !== undefined && v.check.ok !== null && typeof v.check.ok !== 'boolean'))) err('check', 'must be { ok: true | false | null, failed: [], note }');
  if (v.ci !== undefined && (!v.ci || typeof v.ci !== 'object')) err('ci', 'must be { run, status, conclusion, state }');
  else if (v.ci?.state && !CI_STATES.includes(v.ci.state)) err('ci.state', `"${v.ci.state}" is not one of ${CI_STATES.filter(Boolean).join(', ')}`);
  else if (v.ci && (v.ci.status || v.ci.conclusion) && v.ci.state && ciState(v.ci.status, v.ci.conclusion) !== v.ci.state) err('ci.state', `does not follow from status "${v.ci.status}" / conclusion "${v.ci.conclusion}" (${ciState(v.ci.status, v.ci.conclusion)})`);
  const outcome = v.outcome ?? '';
  if (!OUTCOMES.includes(outcome)) err('outcome', `"${outcome}" is not one of ${OUTCOMES.filter(Boolean).join(', ')} (or '' while running)`);
  else {
    if (outcome && !iso(v.endedAt)) err('endedAt', 'a finished attempt says when it ended');
    if (outcome === 'landed' && !sha(v.merged)) err('merged', 'a landed attempt names the sha that landed');
    if (outcome === 'landed' && v.ci?.state && v.ci.state !== 'success') err('ci.state', 'a landed attempt has CI success');
    if (outcome === 'red' && !(v.check?.ok === false || v.ci?.state === 'failure')) err('outcome', 'red needs a failed check or CI failure');
    if (outcome === 'red' && !ident(v.fixBuild, 80) && !str(v.note).trim()) err('fixBuild', 'a red attempt names the fix build it filed, or says in the note why not');
    if (outcome === 'clash' && !(Array.isArray(v.unresolved) && v.unresolved.length)) err('unresolved', 'a clash lists the source files a person has to settle');
    if (outcome === 'cancelled' && v.ci?.state && v.ci.state !== 'cancelled') err('outcome', 'cancelled means CI was cancelled, not that it failed');
    if (outcome === 'cancelled' && v.ci?.state === 'failure') err('outcome', 'a CI failure is red, not cancelled');
    if (outcome === 'error' && !str(v.error).trim()) err('error', 'an error attempt says what broke');
    if (outcome !== 'red' && ident(v.fixBuild, 80)) err('fixBuild', 'only a red attempt files a fix build');
  }
  return { ok: !errors.length, errors };
}

/** The entry a build's land.landAttempts gets for this attempt (build-pipeline@1 normLandAttempt shape). */
export function attemptOf(run) {
  const r = normLandRun(run) ?? emptyLandRun();
  return { at: r.startedAt, run: r.id, base: r.base, merged: r.merged, outcome: r.outcome || outcomeOf(r), ci: r.ci.state, note: r.note || landRunLine(r) };
}

/** One plain line about an attempt, for the build's notes and the phone. */
export function landRunLine(run) {
  const r = normLandRun(run) ?? emptyLandRun();
  const o = r.outcome || outcomeOf(r);
  const short = (s) => (s ? s.slice(0, 7) : '');
  const regen = r.regenerated.length ? `, ${r.regenerated.length} file${r.regenerated.length === 1 ? '' : 's'} regenerated` : '';
  switch (o) {
    case 'landed': return `Landed on main as ${short(r.merged)}${r.base ? ` (on ${short(r.base)})` : ''}${regen}.`;
    case 'red': return `${r.check.ok === false ? `Checks failed after the merge (${r.check.failed.join(', ') || 'see note'})` : 'CI failed on the merged head'}${r.fixBuild ? `: fix build ${r.fixBuild} filed` : ''}.`;
    case 'clash': return `Source clash a person has to settle: ${r.unresolved.join(', ')}.`;
    case 'cancelled': return 'CI run cancelled (not a failure): trying again.';
    case 'error': return `Landing broke: ${r.error.split('\n')[0]}`;
    default: return r.ci.state ? `Landing: merged${r.merged ? ` as ${short(r.merged)}` : ''}${regen}, CI ${r.ci.state}.` : `Landing${r.base ? ` on ${short(r.base)}` : ''}${regen}.`;
  }
}

/** The record as it should be stored: in shape, outcome settled from its facts when it was left blank, note filled. */
export function settleLandRun(run, now = new Date().toISOString()) {
  const r = normLandRun(run); if (!r) return null;
  if (!r.outcome) r.outcome = outcomeOf(r);
  if (r.outcome && !r.endedAt) r.endedAt = iso(now) || r.startedAt;
  if (r.outcome !== 'red') r.fixBuild = '';
  if (!r.note) r.note = landRunLine(r);
  return r;
}
