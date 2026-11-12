/**
 * Auto-merge and the merge banner, the pure part (build auto-merge-switch, Brett Nov 11 2026: "I need to be able to set
 * a switch for every build in the orchestrator if I want it to auto merge on its own as soon as it's done … The merge
 * banner needs to group those actions: the ones waiting for that answer for the toggle, the ones that are ready to
 * merge, and the ones that are merged."). No I/O: pipeline.mjs reads the store and writes the answers, the server adds
 * what the merge queue knows (axf.merge-queue@1), the banner draws the groups.
 *
 * Every builds@1 record carries `autoMerge` (false by default):
 *   off  the finished build waits in Ready to merge until Brett says Merge (mergeApproval { by, at }); the merge queue
 *        keeps its PR out until then (push banner land/merge-queue.mjs reads the same fields from the store);
 *   on   the finished build joins the merge queue by itself: main merged in, the queue's one CI run is the test gate,
 *        it lands only on green; red or a clash holds it (Blocked) and Brett gets the high-priority merge.blocked push.
 * `autoMergeAt` set = Brett answered the "Auto-merge this build when done?" question (on or off).
 */

export const FRAME = 'merge-banner@1';
export const GROUPS = ['ask', 'ready', 'blocked', 'merged'];
export const GROUP_LABEL = { ask: 'Auto-merge?', ready: 'Ready to merge', blocked: 'Blocked', merged: 'Merged' };
export const DECISIONS = ['merge', 'skip', 'rebuild'];
/** Builds still on their way (asked about auto-merge while they are not finished). */
const ON_THE_WAY = ['pending', 'queued', 'running', 'waiting', 'blocked'];
const CLOSED = ['complete', 'archived', 'failed', 'broken', 'cancelled'];
/** Merged builds stay in the banner this long (unless dismissed). */
export const MERGED_DAYS = 7;
export const MERGED_MAX = 30;

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const prNum = (pr) => { const n = Number(str(pr).replace(/^#/, '').replace(/.*\/pull\//, '')); return Number.isInteger(n) && n > 0 ? n : 0; };
const allDone = (b) => Array.isArray(b.steps) && b.steps.length > 0 && b.steps.every((s) => s.done || s.skip);

/** Did Brett answer the auto-merge question for this build? */
export const answered = (b) => !!str(b?.autoMergeAt);
/** Has this build Brett's yes to land (auto-merge on, or his Merge on it)? */
export const approved = (b) => b?.autoMerge === true || !!str(b?.mergeApproval?.at);
/** A finished build that is not on main yet (the same rule as push-banner land-core isCandidate). */
export function finished(b) {
  if (!b || b.deleted || b.hidden) return false;
  if (!str(b.branch) || b.branch === 'main') return false;
  if (str(b.mergedAt) || CLOSED.includes(b.status)) return false;
  return b.status === 'built' || allDone(b);
}
/** On main: merged or complete. */
export const merged = (b) => !!b && !b.deleted && (!!str(b.mergedAt) || b.status === 'complete');

/**
 * Why the merge queue must keep this build's PR out ('' = it may join). The queue's own copy of this rule lives in
 * push-banner land/merge-queue-core.mjs (awaitsBrett): the two are held together by the tests.
 */
export function gate(b) {
  if (!b) return '';
  if (approved(b)) return '';
  return 'waiting for Brett: auto-merge is off (Merge it in the merge banner, Ready to merge)';
}

/** What the merge queue says about a build's PR: { state, ci, why, kicked, pr, url }. */
export function queueFact(b, q = {}) {
  const pr = prNum(b.pr);
  const pick = (x) => x && (x.build === b.id || (pr && x.pr === pr) || (b.branch && x.branch === b.branch));
  const it = [...(q.items || []), ...(q.waiting || [])].find(pick) || null;
  const kick = [...(q.kicked || [])].reverse().find((x) => pr && x.pr === pr) || null;
  return {
    pr: pr || it?.pr || 0, url: str(it?.url, 300), state: str(it?.state, 20), ci: str(it?.prCi || it?.ci, 20), why: str(it?.why, 300),
    kicked: kick ? { why: str(kick.why, 400), at: str(kick.at, 40), runUrl: str(kick.runUrl, 300) } : null,
  };
}

/** Is a finished build blocked: failed tests or a clash with main? Returns the reason or ''. */
export function blockedWhy(f) {
  if (f.kicked) return `Failed its merge-queue run: ${f.kicked.why}`;
  if (/conflict/i.test(f.why)) return `Clashes with main: ${f.why}`;
  if (f.ci === 'failure') return 'Its tests are red (PR checks failed).';
  return '';
}

const testsWord = (f) => (f.kicked ? 'red' : f.ci === 'success' ? 'green' : f.ci === 'failure' ? 'red' : f.ci === 'running' ? 'running' : f.ci ? 'not run' : 'unknown');
const clashWord = (f) => (/conflict/i.test(f.why) ? 'clashes with main' : f.why ? 'merges cleanly' : 'not checked yet');

/** One banner entry for a build. */
function entry(b, group, extra = {}) {
  return { id: b.id, title: str(b.title, 200), group, status: str(b.status, 20), autoMerge: b.autoMerge === true, answered: answered(b), branch: str(b.branch, 200), pr: str(b.pr, 200), agent: str(b.agent || b.origin?.by, 80).replace(/\s*\(.*$/, ''), createdAt: str(b.createdAt, 40), builtAt: str(b.builtAt, 40), ...extra };
}

/**
 * The merge banner: four groups, newest first.
 *   ask      every build on its way (pending … running) whose auto-merge question Brett has not answered;
 *   ready    finished builds not on main and not blocked: waiting for his Merge (off), or landing (on / approved);
 *   blocked  finished builds whose tests failed or that clash with main;
 *   merged   builds on main in the last MERGED_DAYS days, not dismissed.
 * `queue` = axf.merge-queue@1 queue() (may be empty), `dismissed` = ids Brett cleared from Merged.
 */
export function groups(store, { queue = {}, dismissed = [], now = Date.now() } = {}) {
  const builds = (store?.builds || []).filter((b) => b && !b.deleted && !b.hidden);
  const gone = new Set(dismissed);
  const out = { ask: [], ready: [], blocked: [], merged: [] };
  const seenBranch = new Set();
  for (const b of builds) {
    if (finished(b)) {
      if (seenBranch.has(b.branch)) continue; // a build and its follow-up on one branch land as one
      seenBranch.add(b.branch);
      const f = queueFact(b, queue);
      const why = blockedWhy(f);
      const facts = { tests: testsWord(f), clash: clashWord(f), queueState: f.state, queueWhy: f.why, prNumber: f.pr, url: f.url, approved: approved(b), mergeApproval: b.mergeApproval || null };
      if (why) out.blocked.push(entry(b, 'blocked', { ...facts, why, runUrl: f.kicked?.runUrl || '' }));
      else out.ready.push(entry(b, 'ready', { ...facts, landing: approved(b) }));
    } else if (merged(b)) {
      const at = Date.parse(str(b.mergedAt) || str(b.builtAt) || str(b.updatedAt));
      if (gone.has(b.id) || !(at > now - MERGED_DAYS * 864e5)) continue;
      out.merged.push(entry(b, 'merged', { mergedAt: new Date(at).toISOString(), commit: str(b.shipped?.landedCommit, 40) }));
    } else if (ON_THE_WAY.includes(b.status) && !answered(b)) out.ask.push(entry(b, 'ask'));
  }
  const by = (k) => (a, b) => str(b[k] || b.createdAt).localeCompare(str(a[k] || a.createdAt));
  out.ask.sort(by('createdAt'));
  out.ready.sort(by('builtAt'));
  out.blocked.sort(by('builtAt'));
  out.merged.sort(by('mergedAt'));
  out.merged = out.merged.slice(0, MERGED_MAX);
  const counts = Object.fromEntries(GROUPS.map((g) => [g, out[g].length]));
  return { $axf: FRAME, groups: out, counts, total: GROUPS.reduce((n, g) => n + counts[g], 0) };
}

/** Set auto-merge on a build record (mutates). Answering also moves it out of the Auto-merge? group. */
export function setAutoMerge(b, on, { by = '', at = new Date().toISOString() } = {}) {
  b.autoMerge = on === true;
  b.autoMergeAt = at;
  b.autoMergeBy = str(by, 120);
  return b;
}

/** Brett's answer on a Ready / Blocked entry. merge = his yes (the queue may land it), skip = archive, rebuild = queue again. */
export function decision(b, d, { by = '', at = new Date().toISOString() } = {}) {
  if (!DECISIONS.includes(d)) throw Object.assign(new Error(`answer is one of ${DECISIONS.join(', ')}`), { code: 2 });
  if (!finished(b)) throw Object.assign(new Error(`${b.id} is not a finished build waiting to merge (status ${b.status})`), { code: 2 });
  if (d === 'merge') return { mergeApproval: { by: str(by, 120), at }, note: `Merge: Brett said yes (${by}). The merge queue lands it once its test run is green.` };
  if (d === 'skip') return { status: 'archived', note: `Merge banner: skipped by ${by}; archived, never merged.` };
  return { status: 'queued', note: `Merge banner: rebuild on current main (${by}). Start from main and keep every newer change.` };
}

/** The Breakroom line for a merge result, said by the build's owning employee. */
export function chatLine(e, kind) {
  const t = e.title || e.id;
  if (kind === 'merged') return `Landed on main: ${t}${e.commit ? ` (${e.commit.slice(0, 8)})` : ''}.`;
  if (kind === 'blocked') return `Couldn't land ${t}: ${e.why} Holding it for Brett.`;
  return '';
}
