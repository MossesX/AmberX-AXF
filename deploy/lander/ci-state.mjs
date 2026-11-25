/**
 * The lander's CI decision for the PR head in flight (running-ci), as one pure function: what the check runs on the
 * head say, whether a CI run has to be started, and whether the wait is over. run.mjs reads GitHub and acts on the
 * answer (dispatch, wait, fail, go on to the build rules); nothing here touches the network, git or the store, so
 * recorded heads can be replayed through it (test-ci-stall.mjs, fixtures/ci-stall).
 */
import * as L from './lander-core.mjs';

/**
 * → { state, since, ci, kick, fail, waiting }
 *   state    light-only | none | running | failure | missing | success
 *   since    where the CI clocks start
 *   ci       L.ciOf() on the head (null when only light PR checks ran)
 *   kick     null, or { marker: 'fullKick' | 'ciKick', said } when a CI run has to be started on the head
 *   fail     null, or { kind, ctx } for the failure ladder (L.failure)
 *   waiting  what the tick says while it waits ('' on success or failure)
 * `landing` is the build's landing record, `statusAt` when it entered its status, `at` now.
 */
export function ciDecision({ runs = [], head = '', landing = {}, statusAt = '', at, cfg }) {
  const land = landing || {};
  const short = String(head).slice(0, 9);
  // the CI clocks start at the status change, or at the last pull of main into the PR (a new head: CI starts over)
  const since = [statusAt, land.mainPull?.at].filter(Boolean).sort().pop() || at;
  const timedOut = L.ciTimedOut(since, at, cfg);
  const full = (why) => (land.fullKick?.head === head ? null : { marker: 'fullKick', said: `${why} on ${short}: started the full CI run` });
  // light PR checks only (ci-scope: a PR while the old merge queue's repo variable is on): the one CI run must be the
  // full one, so it is dispatched once per head (workflow_dispatch is always full) and only the full run counts
  if (L.lightOnly(runs)) {
    return { state: 'light-only', since, ci: null, kick: full('only light PR checks'), fail: timedOut ? { kind: 'ci-timeout', ctx: { why: `no full CI run after ${cfg.ciTimeoutMin} min` } } : null, waiting: 'waiting for the full CI run' };
  }
  const ci = L.ciOf(runs, { required: cfg.requiredChecks });
  if (ci.ci === 'none') {
    const kick = land.ciKick?.head !== head && L.ciKickDue(since, at, cfg) ? { marker: 'ciKick', said: `no CI on ${short}: started it` } : null;
    return { state: 'none', since, ci, kick, fail: null, waiting: 'CI has not started on the head' };
  }
  if (ci.ci === 'running') {
    return { state: 'running', since, ci, kick: null, fail: timedOut ? { kind: 'ci-timeout', ctx: { why: `CI still running after ${cfg.ciTimeoutMin} min` } } : null, waiting: 'CI is running' };
  }
  if (ci.ci === 'failure') {
    return { state: 'failure', since, ci, kick: null, fail: { kind: 'ci-red', ctx: { why: `CI is red on ${short} (${ci.failing.slice(0, 3).join(', ') || 'checks failed'})`, failing: ci.failing, runIds: ci.runIds, jobIds: ci.jobIds } }, waiting: '' };
  }
  // nothing red, nothing running, but a required check has not reported on this head: not green yet
  if (ci.ci === 'missing') {
    const kick = L.ciKickDue(since, at, cfg) ? full(`required checks have not reported (${ci.missing.slice(0, 3).join(', ')})`) : null;
    return { state: 'missing', since, ci, kick, fail: timedOut ? { kind: 'ci-timeout', ctx: { why: `required checks never reported in ${cfg.ciTimeoutMin} min: ${ci.missing.join(', ')}`, failing: ci.missing } } : null, waiting: `waiting for required checks: ${ci.missing.join(', ')}` };
  }
  return { state: 'success', since, ci, kick: null, fail: null, waiting: '' };
}

/** The per-head parts of a landing record, cleared when the PR head changes or the PR in flight is done. */
export const NEW_HEAD = Object.freeze({ reruns: null, rules: null, ciKick: null, fullKick: null, green: null });

/**
 * The landing-record change when the PR in flight has merged (by the lander or by hand): the PR joins `merged`, the
 * merge evidence is kept, and everything that belonged to that PR's head is cleared.
 */
export function prMerged(b, lastMerge) {
  return { merged: [...new Set([...L.landingOf(b).merged, lastMerge.pr])], lastMerge, ...NEW_HEAD, mainPull: null, fixes: null };
}
