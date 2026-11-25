/**
 * Stuck-CI lane of the stale-status watch, the pure part (stuck-ci@1). No IO: watchdog/stale.mjs gathers the facts (the
 * builds store, the PR in flight on GitHub, the check runs on its head, the lander's settings) and this module says
 * which lander PRs have stood still too long and what moves them.
 *
 * Why (Nov 24 2026): a build split into one PR per part used up the lander's attempt ceiling on its early parts, so
 * parts 7 and 8 stopped at their first red CI ("needs Brett") and each sat until it was merged by hand. Nothing watched
 * `running-ci`: the stale-status watch skipped Pipeline 2.0 builds and the Pipeline 2.0 watchdog only nudges the lander.
 *
 * Watched: a Pipeline 2.0 build with a PR in flight that is in `running-ci`, failed in `running-ci`, or stopped by the
 * lander (`failure.retry: 'hold'`) in any landing phase, standing longer than `limit.running-ci` minutes. In order:
 *
 *   the PR merged or closed on GitHub                    → wait           the lander records it on its next tick
 *   a fix session is working on it                       → wait
 *   already marked for removal                           → wait           until Brett removes the part or re-sends it
 *   CI green, the gate's rules passed (or it stopped)    → merge-pr       the PR is merged, pinned to that head; the
 *                                                                         lander records the merge and goes on
 *   CI green in running-ci, the rules not run yet        → wait           the lander's next tick runs them
 *   a check running longer than ciStuckMin               → rerun-ci       a fresh CI run on the PR branch (the newest
 *   no CI, or a required check never reported                             run per check is the one that counts); twice
 *                                                                         per head at most
 *   CI running, younger than that                        → wait
 *   CI red (or the rules, or a conflict with main)
 *     the lander still has a retry of its own            → wait           its ladder: re-run, then a fix session
 *     the lander stopped, the watch has a fix left       → fix            the hold is released into one fix session on
 *                                                                         Fable (the lander starts it; never by hand)
 *     stopped again after that fix, a one-part PR        → mark-removal   `landing.removal` on the build, one alert
 *     stopped again, a PR of several steps               → wait           the lander already reported it to Brett
 *
 * Never: a PR whose state or CI could not be read (nothing is pushed blind), a build this lane pushed less than its
 * limit ago, a PR closed without merging or merged by hand with red CI (those two stops are Brett's to answer).
 */

export const SCHEMA = 'stuck-ci@1';
/** The settings key the lane's limit lives under (`limit.running-ci`). */
export const LIMIT_KEY = 'running-ci';
export const ACTIONS = Object.freeze(['merge-pr', 'rerun-ci', 'fix', 'mark-removal']);
/** Actions that start a session (capped per pass with the builds@1 launches). */
export const LAUNCHES = Object.freeze(['fix']);
export const DEFAULTS = Object.freeze({
  limitMin: 15,      // minutes a lander PR may stand in CI, or stopped, before the watch reads its checks
  ciStuckMin: 45,    // a check still running after this long is stuck (a full run takes about 30)
  ciFixes: 1,        // fix sessions the watch hands a stopped PR before a one-part PR is marked for removal
  maxReruns: 2,      // fresh CI runs the watch starts per head
});
export const FLOW = 'pipeline-2';
const GROUP_FLOW = Object.freeze(['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
/** Stops only Brett answers: the lane leaves them alone. */
const BRETTS = Object.freeze(['pr-closed', 'hand-merge']);
const CLASH = Object.freeze(['clash-main', 'clash-steps', 'merge']);

const MIN = 60_000;
const str = (v, n = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const ms = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const list = (v) => (Array.isArray(v) ? v : []);
const human = (min) => { const m = Math.max(0, Math.round(min)); return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`; };

/** The phase a build failed in (its own status when it has not failed). */
export const failedIn = (b) => (b?.status === 'failed' ? str(b.failure?.status || b.failedFrom, 40) : str(b?.status, 40));
/** Stopped by the lander at its ladder's top. */
export const isHeld = (b) => b?.status === 'failed' && b.failure?.retry === 'hold';
/** The minutes limit in force (0: the lane is off). */
export const limitOf = (settings) => { const n = Number(settings?.limits?.[LIMIT_KEY]); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Is this build one the lane looks at at all? */
export function watched(b, settings) {
  if (!b || b.deleted || b.demo || b.hidden || b.flow !== FLOW || !limitOf(settings)) return false;
  if (b.status === 'running-ci') return true;
  if (b.status !== 'failed') return false;
  const at = failedIn(b);
  return at === 'running-ci' || (isHeld(b) && GROUP_FLOW.includes(at));
}

/** When the build's status was last set. */
export const sinceOf = (b) => ms(b?.statusAt) || ms(b?.updatedAt) || ms(b?.createdAt);
/** Minutes past the limit (negative: inside it). */
export const overBy = (b, { now = Date.now(), settings } = {}) => (now - sinceOf(b)) / MIN - (limitOf(settings) || Infinity);

/** The removal mark in force on PR `pr`: set since the build's status last changed (a re-sent build is looked at again). */
export function removalOn(b, pr) {
  const r = b?.landing?.removal;
  return r && Number(r.pr) === Number(pr) && ms(r.at) >= ms(b.statusAt) ? r : null;
}

/**
 * The next action for one build → { stale, lane: 'ci', action, minutes, cause, why, pr, … }.
 *   facts   { inFlight: { pr, steps: [id] } | null, pr: { state: 'open' | 'closed' | 'merged', head, branch, mergeable:
 *             true | false | null } | null (not readable), ci: { ci: 'success' | 'failure' | 'running' | 'missing' |
 *             'none' | 'light', failing: [name], missing: [name], runIds, jobIds, runningMin (the age of the oldest
 *             check still running) } | null (not readable), fixTimeoutMin (the lander's) }
 *   ctx     { now, settings, pushedAt (the lane's last push of this build), memory: { pr, fixes, reruns: { head, n, at } } }
 */
export function decide(b, facts = {}, { now = Date.now(), settings = {}, pushedAt = '', memory = null } = {}) {
  const S = settings;
  const none = (why) => ({ stale: false, lane: 'ci', action: 'none', minutes: 0, cause: '', why });
  if (!watched(b, S)) return none('not watched');
  if (overBy(b, { now, settings: S }) <= 0) return none('inside its limit');
  const minutes = Math.round((now - sinceOf(b)) / MIN);
  const held = isHeld(b); const f = b.failure ?? {};
  const pr = Number(facts.inFlight?.pr) || 0;
  const where = b.status === 'running-ci' ? 'running-ci' : `${held ? 'stopped' : 'failed'} in ${failedIn(b)}`;
  const base = { stale: true, lane: 'ci', minutes, status: b.status, pr, cause: `${pr ? `PR #${pr} ` : ''}${where} for ${human(minutes)}` };
  const wait = (why) => ({ ...base, action: 'wait', why });
  if (!pr) return wait('no PR in flight: the lander opens the next one');
  const limit = limitOf(S);
  if (pushedAt && (now - ms(pushedAt)) / MIN < limit) return wait(`pushed less than ${limit} min ago`);
  if (removalOn(b, pr)) return wait(`PR #${pr} is marked for removal: remove the part or re-send the build`);
  if (!facts.pr) return wait(`the state of PR #${pr} could not be read: nothing is pushed blind`);
  if (facts.pr.state !== 'open') return wait(`PR #${pr} is ${facts.pr.state} on GitHub: the lander records it on its next tick`);
  if (held && BRETTS.includes(f.kind)) return wait(`stopped (${str(f.stopped, 120) || f.kind}): that one is Brett's to answer`);
  const fixTimeout = Number(facts.fixTimeoutMin) > 0 ? Number(facts.fixTimeoutMin) : 60;
  if (b.status === 'failed' && f.fix?.at && (now - ms(f.fix.at)) / MIN < fixTimeout) return wait(`fix session ${str(f.fix.session, 80) || f.fix.n || ''} is working on it`.replace('  ', ' '));
  const ci = facts.ci;
  if (!ci) return wait(`CI on PR #${pr} could not be read: nothing is pushed blind`);
  const head = str(facts.pr.head, 64); const short = head.slice(0, 9);
  const rules = b.landing?.rules?.head === head ? b.landing.rules : null;
  const rulesRed = !!rules && rules.ok === false && !rules.error;
  const conflict = facts.pr.mergeable === false || (held && CLASH.includes(f.kind) && facts.pr.mergeable !== true);
  const red = ci.ci === 'failure' || rulesRed || conflict;
  const mine = memory && Number(memory.pr) === pr ? memory : null;

  if (red) {
    const what = conflict ? 'it conflicts with main' : ci.ci === 'failure' ? `CI is red on ${short} (${list(ci.failing).slice(0, 3).join(', ') || 'checks failed'})` : `the build rules fail on ${short} (${list(rules?.failing).slice(0, 3).join(', ') || 'rules failed'})`;
    if (b.status === 'running-ci') return wait(`${what}: the lander's next tick records it`);
    if (!held) return wait(`${what}: the lander retries by itself (${str(f.retry, 20) || 'retry'}${f.notBefore ? ` at ${str(f.notBefore, 16).replace('T', ' ')}` : ''})`);
    const fixes = Number(mine?.fixes) || 0; const cap = Math.max(0, Number(S.ciFixes ?? DEFAULTS.ciFixes) || 0);
    const kind = conflict ? 'clash-main' : ci.ci === 'failure' ? 'ci-red' : 'rules';
    if (fixes < cap) {
      return { ...base, action: 'fix', rung: 'fix:Fable', kind, head, branch: str(facts.pr.branch, 250), n: fixes + 1, failing: conflict ? [] : ci.ci === 'failure' ? list(ci.failing).slice(0, 10) : list(rules?.failing).slice(0, 10),
        runIds: list(ci.runIds).slice(0, 10), jobIds: list(ci.jobIds).slice(0, 10), what,
        why: `the lander stopped on PR #${pr} (${str(f.stopped, 120) || 'needs Brett'}) and ${what}: handed to a Fable fix session` };
    }
    const steps = list(facts.inFlight?.steps).map((s) => str(s, 80)).filter(Boolean);
    if (steps.length === 1 || b.landing?.split === true) {
      return { ...base, action: 'mark-removal', kind, head, steps, what,
        why: `PR #${pr} (${steps.length === 1 ? `part ${steps[0]}` : `parts ${steps.join(', ')}`}) failed again after its fix session, ${what}: marked for removal` };
    }
    return wait(`${what} after the watch's fix session: the lander reported it to Brett`);
  }

  if (ci.ci === 'success') {
    const passed = (rules && rules.ok === true) || b.landing?.green?.head === head;
    if (b.status === 'running-ci' && !passed) return wait(`CI is green on ${short}: the lander runs the gate's rules on its next tick`);
    if (b.status === 'failed' && !held) return wait(`CI is green on ${short}: the lander's own retry picks it up`);
    return { ...base, action: 'merge-pr', head, branch: str(facts.pr.branch, 250), why: `CI is green on ${short} and PR #${pr} was never merged${held ? ` (the lander stopped: ${str(f.stopped, 120) || 'needs Brett'})` : ''}: merged, pinned to that head` };
  }

  // pending: running, none, missing (a required check never reported) or only the light PR checks
  const reruns = mine?.reruns?.head === head ? mine.reruns : null;
  const stuckMin = Math.max(5, Number(S.ciStuckMin ?? DEFAULTS.ciStuckMin) || DEFAULTS.ciStuckMin);
  let why = '';
  if (ci.ci === 'running') {
    const age = Number(ci.runningMin);
    if (!(age >= stuckMin)) return wait(`CI is running on ${short}${Number.isFinite(age) ? ` (${human(age)})` : ''}`);
    why = `a check on ${short} has been running for ${human(age)}`;
  } else {
    // the lander starts CI itself once per head: its kick, like the watch's own, gets time to show up
    const kicked = Math.max(...[b.landing?.ciKick, b.landing?.fullKick].filter((k) => k?.head === head).map((k) => ms(k.at)), ms(reruns?.at), 0);
    if (kicked && (now - kicked) / MIN < limit) return wait(`CI was started on ${short} ${human((now - kicked) / MIN)} ago`);
    why = ci.ci === 'missing' ? `required checks never reported on ${short} (${list(ci.missing).slice(0, 3).join(', ')})` : ci.ci === 'light' ? `only the light PR checks ran on ${short}` : `no CI ran on ${short}`;
  }
  if (reruns && (now - ms(reruns.at)) / MIN < stuckMin) return wait(`${why}; a fresh run was started ${human((now - ms(reruns.at)) / MIN)} ago`);
  if ((Number(reruns?.n) || 0) >= DEFAULTS.maxReruns) return wait(`${why} after ${reruns.n} fresh runs: the lander's CI timeout answers it`);
  return { ...base, action: 'rerun-ci', head, branch: str(facts.pr.branch, 250), n: (Number(reruns?.n) || 0) + 1, why: `${why}: a fresh CI run is started on the PR branch` };
}

/**
 * The failure record a `fix` writes on the stopped build: the lander's own shape with `retry: 'fix'`, due now, so its
 * next tick starts the fix session (deploy/lander/fix-session.mjs: the triage gate's model for CI failures and merge
 * clashes is Fable). The hold, the old fix record and the attempt count are dropped: the fix is a new landing run.
 */
export function fixFailure(b, d, at) {
  const f = b?.failure ?? {};
  const same = f.kind === d.kind;
  return {
    kind: d.kind, status: GROUP_FLOW.includes(failedIn(b)) ? failedIn(b) : 'running-ci', why: str(same && f.why ? f.why : `${d.what[0].toUpperCase()}${d.what.slice(1)}`, 600), head: str(d.head, 64), pr: d.pr, at, retry: 'fix', notBefore: at,
    ...(list(d.failing).length ? { failing: d.failing } : {}), ...(list(d.runIds).length ? { runIds: d.runIds } : {}), ...(list(d.jobIds).length ? { jobIds: d.jobIds } : {}),
    ...(same && str(f.log) ? { log: f.log } : {}),
  };
}

/** The lane's memory of one build after an action (kept per PR: a new PR in flight starts clean). */
export function nextMemory(prev, d, at) {
  const m = prev && Number(prev.pr) === Number(d.pr) ? { ...prev } : { pr: d.pr, fixes: 0 };
  if (d.action === 'fix') m.fixes = (Number(m.fixes) || 0) + 1;
  if (d.action === 'rerun-ci') m.reruns = { head: d.head, n: d.n, at };
  return m;
}

const DID = Object.freeze({ 'merge-pr': 'merged it', 'rerun-ci': 'restarted CI', fix: 'sent it to a Fable fix session', 'mark-removal': 'marked the part for removal' });
/**
 * The alert for one catch (every catch of this lane tells Brett, one alert each). Short and plain: what was stuck,
 * what was done. → the console alert ({ source, key, severity, link, title, body, meta }).
 */
export function alertOf(c, { link = '' } = {}) {
  const failed = c.ok === false;
  const removal = c.action === 'mark-removal';
  return {
    source: 'watchdog', key: `watchdog:stuck-ci:${c.build}:${c.pr || 0}:${c.action}:${c.at}`, severity: failed || removal ? 'error' : 'info', link,
    title: str(`PR #${c.pr} stuck in CI: ${failed ? `could not ${c.action === 'merge-pr' ? 'merge it' : c.action === 'rerun-ci' ? 'restart CI' : c.action === 'fix' ? 'start a fix' : 'mark it'}` : DID[c.action] ?? c.action}`, 120),
    body: str(`${c.title || c.build}\n${c.note}${removal && !failed ? '\nNothing was removed. Remove the part, or re-send the build: node deploy/lander/run.mjs retry ' + c.build : ''}`, 1500),
    meta: { kind: removal ? 'marked-removal' : 'caught', watch: 'stale', lane: 'ci', build: c.build, pr: c.pr || 0, action: c.action, ok: !failed },
  };
}

export const REGISTRY = Object.freeze({ schema: SCHEMA, limitKey: LIMIT_KEY, actions: ACTIONS, launches: LAUNCHES, defaults: DEFAULTS });
