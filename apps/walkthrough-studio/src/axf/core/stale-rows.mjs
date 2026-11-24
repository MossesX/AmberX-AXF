/**
 * Stale rows (stale-row@1). Brett, Nov 16 2026: "I want a server fucking watchdog on the VPS to do that." Rows that
 * should have left a list stay on it: a build still Queued after its PR merged, a merge-queue entry whose PR landed by a
 * direct merge commit, a UI Review item for a PR that shipped, a Pending build whose PR was closed unmerged. The VPS
 * watchdog walks every list, asks git and GitHub for the facts and lets this module decide. Pure: no IO, no git, no
 * model. The watchdog, the console view, the CLI and the voice side all read these rules and nothing else.
 *
 * One row + the facts about it → one verdict { action, reason, evidence }:
 *   keep       the row stays (it is live, still open, or the facts are missing: absence never moves a row)
 *   complete   the work landed on main: the row is marked done where it lives (build → complete, merge-queue entry →
 *              landed, UI Review item → landed; never "approved")
 *   remove     the work is dead: a PR closed without a merge, a build failed / cancelled / deleted; the row leaves the
 *              list (build → archived, merge-queue entry / UI Review item → removed) and the cleanup log keeps it
 *
 * Order of the rules (the first that fires wins):
 *   1 bad row                                    → keep   invalid-row
 *   2 a live session on the build                → keep   live            (nothing is pulled out from under a session)
 *   3 PR merged                                  → complete pr-merged
 *   4 the branch's commits are on main           → complete on-main      (direct merge commit, squash, cherry-pick)
 *   5 the build's own record says complete       → complete build-complete
 *   6 PR closed without a merge                  → remove pr-closed
 *   7 build failed / cancelled (list rows only)  → remove build-failed / build-cancelled
 *     the same on a build row                    → keep   own-status      (the orchestrator shows the build's status)
 *   8 every fact unknown                         → keep   no-facts
 *   9 otherwise                                  → keep   open
 * A build row (pending / queued / building) with a failed or archived build keeps its own status: the orchestrator shows
 * it; only rows that point at a build (merge-queue, ui-review) are removed when that build died.
 *
 * Facts are plain data, each piece nullable (null = not looked up, never "no"):
 *   pr       { number, state: 'open' | 'closed' | 'merged', mergedAt?, mergeCommit?, url? } | null
 *   main     { landed: true | false | null, commit?, by?: 'merge-commit' | 'squash' | 'cherry-pick' | 'fast-forward' } | null
 *   build    { id?, status?, deleted?, mergedAt? } | null        (the builds@1 record the row points at)
 *   branch   { name?, exists: true | false | null } | null
 *   session  { alive: true | false | null, id? } | null          (a Claude session / tmux on the build)
 */

export const FRAME = 'stale-row@1';
export const RECORD_FRAME = 'stale-row-log@1';

/** Where a row lives. */
export const KINDS = Object.freeze(['pending', 'queued', 'building', 'merge-queue', 'ui-review']);
export const KIND_LABEL = Object.freeze({ pending: 'Pending build', queued: 'Queued build', building: 'Building', 'merge-queue': 'Merge queue entry', 'ui-review': 'UI Review item' });
/** Rows that are the build's own record (their status is the build's status). */
export const BUILD_KINDS = Object.freeze(['pending', 'queued', 'building']);
/** Rows that point at a build and go when it dies. */
export const LIST_KINDS = Object.freeze(['merge-queue', 'ui-review']);
const KIND_ALIAS = Object.freeze({ running: 'building', waiting: 'building', blocked: 'building', build: 'building', queue: 'queued', landing: 'merge-queue', 'landing-line': 'merge-queue', 'merge_queue': 'merge-queue', mergeQueue: 'merge-queue', ui: 'ui-review', review: 'ui-review', 'ui_review': 'ui-review', uiReview: 'ui-review' });

export const ACTIONS = Object.freeze(['keep', 'complete', 'remove']);
export const ACTION_LABEL = Object.freeze({ keep: 'Keep', complete: 'Complete', remove: 'Remove' });

/** Reason codes, each with the action it implies and the words the console shows. Open registry: add a code, never reuse one. */
export const REASONS = Object.freeze({
  'invalid-row': { action: 'keep', label: 'Not a row this watchdog knows' },
  live: { action: 'keep', label: 'A session is working on it' },
  'pr-merged': { action: 'complete', label: 'Its PR merged on main' },
  'on-main': { action: 'complete', label: 'Its commits are on main' },
  'build-complete': { action: 'complete', label: 'The build is complete' },
  'pr-closed': { action: 'remove', label: 'Its PR was closed without a merge' },
  'build-failed': { action: 'remove', label: 'The build failed' },
  'build-cancelled': { action: 'remove', label: 'The build was cancelled' },
  'own-status': { action: 'keep', label: 'The build row shows its own status' },
  'no-facts': { action: 'keep', label: 'No facts yet: left alone' },
  open: { action: 'keep', label: 'Still open' },
});
export const REASON_CODES = Object.freeze(Object.keys(REASONS));

const PR_STATES = ['open', 'closed', 'merged'];
const MAIN_BY = ['merge-commit', 'squash', 'cherry-pick', 'fast-forward'];
const DEAD_BUILD = ['failed'];
const CANCELLED_BUILD = ['archived', 'cancelled'];
const DONE_BUILD = ['complete'];
const LIVE_BUILD = ['running', 'waiting'];

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const bool3 = (v) => (v === true || v === false ? v : null);
export const prNumber = (pr) => { if (pr && typeof pr === 'object') return prNumber(pr.number ?? pr.url ?? ''); const m = /(\d+)\s*$/.exec(String(pr ?? '').trim()); return m ? Number(m[1]) : 0; };

/** 'running' → 'building', 'landing-line' → 'merge-queue', 'ui' → 'ui-review'; anything else → ''. */
export function normKind(v) {
  const s = str(v, 40);
  if (KINDS.includes(s)) return s;
  return KIND_ALIAS[s] ?? KIND_ALIAS[s.toLowerCase()] ?? '';
}
/** The row kind of a builds@1 record from its status ('' for a finished build: it is no row to watch). */
export function kindOfBuild(b) {
  const s = str(b?.status, 20);
  if (s === 'pending' || s === 'queued') return s;
  if (LIVE_BUILD.includes(s) || s === 'blocked') return 'building';
  return '';
}

/** A row as the classifier reads it: { kind, id, build, pr, branch, status }. Unknown kind → kind ''. */
export function normRow(r) {
  const o = r && typeof r === 'object' ? r : {};
  const kind = normKind(o.kind);
  const id = str(o.id ?? (kind === 'merge-queue' ? prNumber(o.pr) || '' : ''), 120);
  return {
    kind, id,
    build: str(o.build ?? (BUILD_KINDS.includes(kind) ? id : ''), 120),
    pr: prNumber(o.pr),
    branch: str(o.branch, 200),
    status: str(o.status ?? o.state, 40),
  };
}

/** Facts, every piece present and nullable; junk becomes null (unknown), never a claim. */
export function normFacts(f) {
  const o = f && typeof f === 'object' ? f : {};
  const pr = o.pr && typeof o.pr === 'object' ? o.pr : null;
  const prState = pr ? (pr.merged === true || pr.state === 'merged' ? 'merged' : PR_STATES.includes(pr.state) ? pr.state : (pr.merged === false && pr.closed === true ? 'closed' : null)) : null;
  const main = o.main && typeof o.main === 'object' ? o.main : (o.main === true || o.main === false ? { landed: o.main } : null);
  const build = o.build && typeof o.build === 'object' ? o.build : null;
  const branch = o.branch && typeof o.branch === 'object' ? o.branch : (o.branch === true || o.branch === false ? { exists: o.branch } : null);
  const session = o.session && typeof o.session === 'object' ? o.session : (o.session === true || o.session === false ? { alive: o.session } : null);
  return {
    pr: pr ? { number: prNumber(pr), state: prState, mergedAt: str(pr.mergedAt, 40), mergeCommit: str(pr.mergeCommit ?? pr.merge_commit_sha, 64), url: str(pr.url ?? pr.html_url, 300) } : null,
    main: main ? { landed: bool3(main.landed), commit: str(main.commit ?? main.sha, 64), by: MAIN_BY.includes(main.by) ? main.by : '' } : null,
    build: build ? { id: str(build.id, 120), status: str(build.status, 20), deleted: build.deleted === true, mergedAt: str(build.mergedAt, 40) } : null,
    branch: branch ? { name: str(branch.name, 200), exists: bool3(branch.exists) } : null,
    session: session ? { alive: bool3(session.alive), id: str(session.id, 120) } : null,
  };
}

/** True when nothing was looked up (or everything looked up came back unknown). */
export function noFacts(f) {
  const x = normFacts(f);
  return !(x.pr?.state) && x.main?.landed == null && !(x.build?.status || x.build?.deleted) && x.branch?.exists == null && x.session?.alive == null;
}

const verdict = (reason, evidence) => ({ $axf: FRAME, action: REASONS[reason].action, reason, evidence });
const prWords = (pr) => `PR #${pr.number}${pr.state ? ` ${pr.state}` : ''}${pr.mergedAt ? ` ${pr.mergedAt}` : ''}${pr.mergeCommit ? ` (${pr.mergeCommit.slice(0, 12)})` : ''}`;

/**
 * The verdict for one row: { $axf, action, reason, evidence: string[] }. `evidence` names every fact the rule used, in
 * plain words, so the cleanup log and the console can say why. Never throws; junk in → keep / invalid-row.
 */
export function classify(row, facts) {
  const r = normRow(row);
  const f = normFacts(facts);
  if (!r.kind || !r.id) return verdict('invalid-row', [r.kind ? `row ${r.kind} without an id` : `unknown row kind ${JSON.stringify(str(row?.kind, 40))}`]);

  const ev = [];
  if (f.pr?.state) ev.push(prWords(f.pr));
  if (f.main?.landed === true) ev.push(`on main${f.main.by ? ` by ${f.main.by}` : ''}${f.main.commit ? ` ${f.main.commit.slice(0, 12)}` : ''}`);
  if (f.main?.landed === false) ev.push('not on main');
  if (f.build?.status) ev.push(`build ${f.build.id || r.build || r.id}: ${f.build.status}`);
  if (f.build?.deleted) ev.push(`build ${f.build.id || r.build || r.id}: deleted`);
  if (f.branch?.exists === false) ev.push(`branch ${f.branch.name || r.branch || '?'} deleted`);
  if (f.session?.alive === true) ev.push(`session ${f.session.id || 'live'}`);

  // 2 live: a session on the build (or a build record that says running) is never touched
  if (f.session?.alive === true) return verdict('live', ev);
  if (LIVE_BUILD.includes(f.build?.status) && f.session?.alive !== false) return verdict('live', ev);

  // 3-5 landed
  if (f.pr?.state === 'merged') return verdict('pr-merged', ev);
  if (f.main?.landed === true) return verdict('on-main', ev);
  if (DONE_BUILD.includes(f.build?.status) || (f.build?.mergedAt && !f.build.deleted)) return verdict('build-complete', ev);

  // 6-7 dead
  if (f.pr?.state === 'closed') return verdict('pr-closed', ev);
  const dead = DEAD_BUILD.includes(f.build?.status) || f.build?.deleted || CANCELLED_BUILD.includes(f.build?.status);
  if (LIST_KINDS.includes(r.kind)) {
    if (DEAD_BUILD.includes(f.build?.status)) return verdict('build-failed', ev);
    if (dead) return verdict('build-cancelled', ev);
  }
  if (dead) return verdict('own-status', ev); // a build row keeps its failed / archived status: the orchestrator shows it

  // 8-9 nothing moves it
  if (noFacts(f)) return verdict('no-facts', ['no facts looked up']);
  return verdict('open', ev.length ? ev : ['nothing says it landed or died']);
}

/**
 * Every row at once: rows → [{ row, ...verdict }]. `factsFor` is a map keyed `<kind>:<id>` (or a function row → facts).
 * A row with no entry gets no facts and keeps.
 */
export function classifyRows(rows, factsFor = {}) {
  const get = typeof factsFor === 'function' ? factsFor : (r) => factsFor[rowKey(r)] ?? factsFor[r.id] ?? null;
  return (Array.isArray(rows) ? rows : []).map((raw) => { const row = normRow(raw); return { row, ...classify(row, get(row)) }; });
}
export const rowKey = (row) => { const r = normRow(row); return `${r.kind}:${r.id}`; };

/** The verdicts that change something, grouped: { complete: [...], remove: [...], keep: n }. */
export function summarize(verdicts) {
  const out = { complete: [], remove: [], keep: 0 };
  for (const v of verdicts ?? []) { if (v?.action === 'keep') out.keep += 1; else if (out[v?.action]) out[v.action].push(v); }
  return out;
}

/**
 * One cleanup log record (stale-row-log@1, framework/schemas/stale-row.json): what the watchdog did to one row and why.
 * `by` is 'watchdog' unless a hand ran it (then who, e.g. 'cli:brett'). `dry` = decided, not applied.
 */
export function logRecord(row, v, { at = new Date().toISOString(), by = 'watchdog', dry = false, note = '' } = {}) {
  const r = normRow(row);
  const action = ACTIONS.includes(v?.action) ? v.action : 'keep';
  const reason = REASON_CODES.includes(v?.reason) ? v.reason : 'invalid-row';
  const rec = {
    $axf: RECORD_FRAME,
    id: `${r.kind || 'row'}:${r.id || '?'}:${at}`,
    kind: r.kind || 'pending',
    rowId: r.id,
    build: r.build,
    pr: r.pr,
    branch: r.branch,
    action, reason,
    evidence: (Array.isArray(v?.evidence) ? v.evidence : []).map((e) => str(e, 300)).filter(Boolean).slice(0, 20),
    at: str(at, 40),
    by: str(by, 80) || 'watchdog',
  };
  if (dry) rec.dry = true;
  if (note) rec.note = str(note, 600);
  return rec;
}

/** Validate a cleanup log record: { ok, errors: [field…] }. Mirrors framework/schemas/stale-row.json. */
export function validateRecord(rec) {
  const errors = [];
  if (rec?.$axf !== RECORD_FRAME) errors.push('$axf');
  if (!str(rec?.id, 400)) errors.push('id');
  if (!KINDS.includes(rec?.kind)) errors.push('kind');
  if (typeof rec?.rowId !== 'string' || !rec.rowId) errors.push('rowId');
  if (rec?.build !== undefined && typeof rec.build !== 'string') errors.push('build');
  if (rec?.pr !== undefined && !(Number.isInteger(rec.pr) && rec.pr >= 0)) errors.push('pr');
  if (!ACTIONS.includes(rec?.action)) errors.push('action');
  if (!REASON_CODES.includes(rec?.reason)) errors.push('reason');
  else if (REASONS[rec.reason].action !== rec?.action) errors.push('reason/action');
  if (!Array.isArray(rec?.evidence) || rec.evidence.some((e) => typeof e !== 'string')) errors.push('evidence');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(str(rec?.at, 40))) errors.push('at');
  if (!str(rec?.by, 80)) errors.push('by');
  if (rec?.dry !== undefined && typeof rec.dry !== 'boolean') errors.push('dry');
  return { ok: errors.length === 0, errors };
}

/** One line for a chat, a banner or a log: "Queued build x → Complete: Its PR merged on main (PR #12 merged …)". */
export function describe(row, v) {
  const r = normRow(row);
  const reason = REASONS[v?.reason] ?? REASONS['invalid-row'];
  const ev = (v?.evidence ?? []).filter(Boolean);
  return `${KIND_LABEL[r.kind] ?? 'Row'} ${r.id || '?'} → ${ACTION_LABEL[reason.action]}: ${reason.label}${ev.length ? ` (${ev.join('; ')})` : ''}`;
}
