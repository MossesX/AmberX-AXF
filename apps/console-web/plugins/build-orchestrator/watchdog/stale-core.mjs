/**
 * Stale-status watch, the pure part (stale-status@1). No IO: watchdog/stale.mjs gathers the facts (the builds store,
 * the PR on GitHub, CI on the merge commit, live sessions, the clock) and this module says which builds have stood in
 * one status too long and what the next action on their ladder is.
 *
 * The ladder is done-means-merged@1's (framework/spec/DONE-MEANS-MERGED.md): landing ── merged + CI green ──▶ landed,
 * and every failure on the way is `fixing`, answered by the retry ladder (framework/core/retry-ladder.mjs) until it
 * runs out (`escalated`). A build that stands still is somewhere on that line with nobody moving it. In order:
 *
 *   its PR merged, the merge not on the build yet        → record-merge   mergedAt + the merge commit; status landing
 *   merged, CI green on the merge commit                 → land           landed.ci success; status landed
 *   merged, CI red on the merge commit                   → fail           a ci-red failure at the merge commit: fixing
 *                                                          or land        when main is green now with the merge in it
 *   merged, CI still running or none                     → wait           until ciWaitMin; then land when main is green
 *                                                                         now with the merge in it, else escalate (no
 *                                                                         rung is left that this watch can take)
 *   fixing with a failure, the PR open or none           → ladder         the retry ladder's next rung, launched now
 *   fixing with a failure, the ladder ran out            → escalate       status escalated, banner item, one push
 *   fixing with no failure on it                         → to-landing     every step done and a PR: it is the lander's
 *                                                          or requeue     steps left: back to the Queue
 *   landing / merging, the PR open, closed or missing    → fail           a stalled failure (fixing); the next pass
 *                                                                         answers it with the ladder
 *
 * Never: a build with a live session or an attempt in flight, a build pushed less than cooldownMin ago, a Pipeline 2.0
 * build (deploy/watchdog is its watchdog), and a build whose PR state could not be read (no blind pushes).
 */

export const SCHEMA = 'stale-status@1';
export const JOURNAL_ACTION = 'watchdog-stale';

/**
 * The statuses watched and the minutes each may stand without movement (settings `limit.<status>` override them; a
 * status added here, or by a later flow, is watched the same way). `owner` says whose status it is.
 */
export const STATUSES = Object.freeze({
  landing: Object.freeze({ limitMin: 90, owner: 'lander' }),
  merging: Object.freeze({ limitMin: 30, owner: 'lander' }),
  fixing: Object.freeze({ limitMin: 60, owner: 'ladder' }),
});
export const ACTIONS = Object.freeze(['none', 'wait', 'record-merge', 'land', 'fail', 'ladder', 'to-landing', 'requeue', 'escalate']);
/**
 * Actions that start a session, now (`ladder`) or within a minute (`fail`: the dispatcher's retry runner answers a new
 * failure on its next tick). Capped per pass on their own, so a backlog drains one build at a time and never floods the slots.
 */
export const LAUNCHES = Object.freeze(['ladder', 'fail']);

export const DEFAULTS = Object.freeze({
  enabled: true,
  intervalMin: 10,        // minutes between passes
  cooldownMin: 30,        // a build this watch pushed is left alone this long
  ciWaitMin: 120,         // a merged build waits this long for CI on its merge commit before it is escalated
  attemptTimeoutMin: 45,  // an open attempt younger than this is in flight
  maxPerPass: 5,          // pushes per pass
  maxLaunchPerPass: 1,    // of those, the ones that start a session
  limits: Object.freeze(Object.fromEntries(Object.entries(STATUSES).map(([s, v]) => [s, v.limitMin]))),
});

const MIN = 60_000;
const str = (v, n = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const ms = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const list = (v) => (Array.isArray(v) ? v : []);
const prNum = (v) => { const n = Number(String(v ?? '').replace(/\D/g, '')); return Number.isInteger(n) && n > 0 ? n : 0; };

export function normSettings(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (k, lo, hi) => { const n = Number(r[k]); return r[k] == null || r[k] === '' || !Number.isFinite(n) ? DEFAULTS[k] : Math.min(hi, Math.max(lo, Math.round(n))); };
  const limits = { ...DEFAULTS.limits };
  for (const [s, m] of Object.entries(r.limits ?? {})) if (Number(m) > 0) limits[s] = Math.min(10080, Math.round(Number(m)));
  return { enabled: r.enabled !== false && r.enabled !== 'off', intervalMin: num('intervalMin', 1, 1440), cooldownMin: num('cooldownMin', 0, 1440), ciWaitMin: num('ciWaitMin', 5, 10080),
    attemptTimeoutMin: num('attemptTimeoutMin', 5, 1440), maxPerPass: num('maxPerPass', 1, 100), maxLaunchPerPass: num('maxLaunchPerPass', 0, 20), limits };
}

export const openSteps = (b) => list(b?.steps).filter((s) => !s?.done && !s?.skip);
export const mergedAtOf = (b) => str(b?.mergedAt, 40) || str(b?.landed?.mergedAt, 40);
const openAttempt = (b) => list(b?.attempts).find((a) => a?.result === 'started') ?? null;

/**
 * When the build last moved: the newest mark of real progress (a failure recorded, an attempt started or ended, a step
 * ticked, a launch, the merge, CI recorded). Not `updatedAt`: bulk store writes bump it on builds nobody touched. Not
 * this watch's own push either: the cooldown spaces the pushes, the limit is about the build. With no mark at all:
 * updatedAt, then createdAt.
 */
export function movedAt(b) {
  const marks = [b?.failure?.at, b?.pipeline?.launchedAt, b?.mergedAt, b?.landed?.mergedAt, b?.landed?.ciAt, b?.escalation?.at,
    ...list(b?.attempts).flatMap((a) => [a?.startedAt, a?.endedAt]), ...list(b?.steps).map((s) => s?.doneAt)].map(ms).filter(Boolean);
  return marks.length ? Math.max(...marks) : ms(b?.updatedAt) || ms(b?.createdAt);
}

/** Is this build one the watch looks at at all (status watched, builds@1, not gone)? */
export const watched = (b, settings = DEFAULTS) => !!b && !b.deleted && !b.demo && b.flow !== 'pipeline-2' && settings.limits[b.status] > 0;

/** Minutes the build has stood past its status limit (negative: inside it). */
export function overBy(b, { now = Date.now(), settings = DEFAULTS } = {}) {
  return (now - movedAt(b)) / MIN - (settings.limits[b?.status] ?? Infinity);
}

/**
 * The next action for one build → { stale, action, minutes, cause, why, … }.
 *   facts   { pr: { state: 'open' | 'closed' | 'merged', mergedAt, mergeCommit } | null (unknown), ci: 'success' |
 *             'failure' | 'pending' | 'none' | null (not read; CI on the merge commit), mainCi + mainHead (CI on
 *             main's newest commit, read only when the merge commit's own CI does not prove it), live: true | false | null }
 *   ctx     { now, settings, pushedAt (this watch's last push of the build), next (the retry ladder's decision for a
 *             fixing build with a failure: { strategy, fixStrategy, rung, escalate, inFlight, notBefore, reason }) }
 */
export function decide(b, facts = {}, { now = Date.now(), settings = DEFAULTS, pushedAt = '', next = null } = {}) {
  const S = settings;
  const none = (why) => ({ stale: false, action: 'none', minutes: 0, cause: '', why });
  if (!watched(b, S)) return none('not watched');
  const over = overBy(b, { now, settings: S });
  if (over <= 0) return none('inside its limit');
  const minutes = Math.round((now - movedAt(b)) / MIN);
  const base = { stale: true, minutes, status: b.status, cause: `${b.status} for ${human(minutes)}` };
  const wait = (why) => ({ ...base, action: 'wait', why });
  if (facts.live === true) return wait('a session is running on it');
  const att = openAttempt(b);
  if (att && (now - ms(att.startedAt)) / MIN < S.attemptTimeoutMin) return wait(`attempt ${att.n ?? ''} is in flight`.replace('  ', ' '));
  if (pushedAt && (now - ms(pushedAt)) / MIN < S.cooldownMin) return wait(`pushed less than ${S.cooldownMin} min ago`);

  const pr = prNum(b.pr) || prNum(b.landed?.pr);
  const merged = facts.pr?.state === 'merged' || !!mergedAtOf(b);
  if (pr && !facts.pr && !mergedAtOf(b)) return wait(`the state of PR #${pr} could not be read: nothing is pushed blind`);

  if (merged) {
    const sha = str(b.landed?.sha, 64) || str(facts.pr?.mergeCommit, 64);
    const at = mergedAtOf(b) || str(facts.pr?.mergedAt, 40);
    if (!mergedAtOf(b) || !str(b.landed?.sha, 64)) {
      if (!sha) return wait(`PR #${pr} merged but its merge commit could not be read`);
      return { ...base, action: 'record-merge', pr, sha, mergedAt: at || new Date(now).toISOString(), why: `PR #${pr} merged${at ? ` ${at.slice(0, 16).replace('T', ' ')}` : ''} and the build never heard: the merge is recorded, CI on ${sha.slice(0, 10)} is next` };
    }
    if (facts.ci === 'success') return { ...base, action: 'land', sha, why: `merged and CI is green on ${sha.slice(0, 10)}: landed` };
    // CI on the merge commit itself is red, was cancelled or never ran, but main is green now with this merge in it: the
    // code is on a green main. Landed, with the proof named (landed.ciRun says main at which commit).
    const viaMain = facts.mainCi === 'success' && facts.mainHead && facts.mainHead !== sha
      ? { ...base, action: 'land', sha, via: 'main', mainHead: str(facts.mainHead, 64), why: `merged, and main is green at ${str(facts.mainHead, 10)} with ${sha.slice(0, 10)} in it (CI on the merge commit itself: ${facts.ci === 'failure' ? 'red, fixed on main since' : 'no finished run'}): landed` }
      : null;
    if (facts.ci === 'failure') return viaMain ?? { ...base, action: 'fail', kind: 'ci-red', head: sha, why: `CI is red on main at ${sha.slice(0, 10)} after its merge` };
    if (b.status === 'fixing' && b.failure) return ladder(b, base, next); // a failure recorded after the merge: the ladder's
    const sinceMerge = (now - ms(at)) / MIN;
    if (facts.ci == null) return wait(`CI on ${sha.slice(0, 10)} could not be read`);
    if (sinceMerge < S.ciWaitMin) return wait(`CI on ${sha.slice(0, 10)} is ${facts.ci === 'pending' ? 'still running' : 'not there yet'} (${human(Math.round(sinceMerge))} since the merge)`);
    if (viaMain) return viaMain;
    return { ...base, action: 'escalate', kind: 'ci-red', head: sha, why: `merged ${human(Math.round(sinceMerge))} ago and CI on ${sha.slice(0, 10)} ${facts.ci === 'pending' ? 'never finished' : 'never ran'}: it cannot be proved landed` };
  }

  if (b.status === 'fixing') {
    if (b.failure) return ladder(b, base, next);
    if (!openSteps(b).length && pr && b.branch && b.branch !== 'main') return { ...base, action: 'to-landing', why: 'fixing with no failure on it, every step done and a PR open: back to landing' };
    return { ...base, action: 'requeue', why: `fixing with no failure on it${openSteps(b).length ? ` and ${openSteps(b).length} step(s) left` : ''}: back to the Queue` };
  }
  // landing / merging and nothing merged it: the lander's status, and the lander said nothing. A failure the ladder answers.
  const prWord = !pr ? 'no PR reached GitHub' : facts.pr?.state === 'closed' ? `PR #${pr} was closed without merging` : `PR #${pr} is still open`;
  return { ...base, action: 'fail', kind: pr && facts.pr?.state !== 'closed' ? 'stalled' : 'push-fail', head: '', why: `${b.status} for ${human(minutes)}: ${prWord} and nothing moved it` };
}

function ladder(b, base, next) {
  if (!next) return { ...base, action: 'wait', why: 'the retry ladder gave no answer' };
  if (next.inFlight) return { ...base, action: 'wait', why: str(next.reason, 200) || 'an attempt is in flight' };
  if (next.escalate) return { ...base, action: 'escalate', kind: b.failure.kind, head: str(b.failure.head, 64), why: str(next.reason, 300) || 'the ladder ran out' };
  const rung = next.strategy === 'fix' ? `fix:${next.fixStrategy || 'targeted'}` : str(next.strategy, 40);
  return { ...base, action: 'ladder', rung, kind: b.failure.kind, why: `fixing (${b.failure.kind}) with nothing tried for ${human(base.minutes)}: ${rung} now` };
}

export function human(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 120) return `${m} min`;
  if (m < 2880) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

/**
 * Which decisions a pass acts on: the longest-standing first, at most maxPerPass, at most maxLaunchPerPass launches.
 * → { act: [decision…], held: [{ id, why }] }
 */
export function pick(decisions, settings = DEFAULTS) {
  const todo = decisions.filter((d) => d.stale && d.action !== 'wait' && d.action !== 'none').sort((a, b) => b.minutes - a.minutes);
  const act = []; const held = []; let launches = 0;
  for (const d of todo) {
    if (act.length >= settings.maxPerPass) { held.push({ id: d.id, why: `over ${settings.maxPerPass} pushes this pass: next pass` }); continue; }
    if (LAUNCHES.includes(d.action)) { if (launches >= settings.maxLaunchPerPass) { held.push({ id: d.id, why: `one launch at a time (${settings.maxLaunchPerPass} per pass): next pass` }); continue; } launches += 1; }
    act.push(d);
  }
  return { act, held };
}

/** CI on a commit from GitHub check runs already classified (landing-line@1 classifyCheckRuns verdict) → facts.ci. */
export const ciOf = (verdict) => ({ green: 'success', red: 'failure', running: 'pending', retry: 'pending', none: 'none' }[verdict] ?? null);

/** A failure record for `fail` (the shape build-pipeline@1 normFailure takes). */
export const failureOf = (d, at) => ({ kind: d.kind, at, why: str(d.why, 300), head: str(d.head, 64), step: '', exit: null });

export const REGISTRY = Object.freeze({ schema: SCHEMA, journalAction: JOURNAL_ACTION, statuses: STATUSES, actions: ACTIONS, launches: LAUNCHES, defaults: DEFAULTS });
