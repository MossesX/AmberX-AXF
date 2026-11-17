/**
 * Auto-lander (auto-lander@1). Build server-auto-lander-fixes-lands, Brett Nov 16 2026: "We need the auto lander to bang
 * shit out on its own. It needs to automatically fix it. We need a server rule to do that. Make the server do it
 * automatically without the console."
 *
 * The gate (gate-rules@1) says whether a PR may land; the landing line (landing-line@1) says in which order. This is the
 * part in between: when a PR cannot land, the server decides the next thing itself (merge main on a clash, a fix session
 * on red CI, wait while CI runs, land when green) and escalates once a kind of try has failed maxAttempts times. Pure: no
 * IO, no git, no model. The VPS runner carries the actions out and records the attempts. Contract: spec/AUTO-LANDER.md.
 *
 * Records:
 *   auto-lander-attempt@1  one try: build, kind (clash | red-ci | land), n, account, session, branch, head, pr, result,
 *                          log excerpt, at, endedAt
 *   auto-lander-build@1    one build in the lander: state, since, attempts, reason, escalation
 *   auto-lander-policy@1   maxAttempts, backoff { baseMin, factor, maxMin }, attemptTimeoutMin, per-kind switches
 *   auto-lander-action@1   what decide() answers: action, next state, kind, attempt n, notBefore, waitReason, reason
 *   auto-lander-state@1    every build the lander tracks + the policy; migrated from lander-state@1
 */
import { normSnapshot } from './gate-rules.mjs';

export const SCHEMA = 'auto-lander@1';
export const ATTEMPT_FRAME = 'auto-lander-attempt@1';
export const BUILD_FRAME = 'auto-lander-build@1';
export const POLICY_FRAME = 'auto-lander-policy@1';
export const ACTION_FRAME = 'auto-lander-action@1';
export const STATE_FRAME = 'auto-lander-state@1';
export const VIEW_FRAME = 'auto-lander-view@1';
export const COMMAND_FRAME = 'auto-lander-command@1';
export const VERSION = 1;

/** What the console, CLI, MCP and voice may tell the lander (POST …/auto-lander/<command>). */
export const COMMANDS = Object.freeze(['run', 'retry', 'pause', 'resume', 'settings']);
/** Commands that take a build; `run`, `pause` and `resume` without one address the whole lander. */
export const COMMAND_BUILD = Object.freeze({ run: 'optional', retry: 'required', pause: 'optional', resume: 'optional', settings: 'none' });
/** Who runs the lander: the push banner's cron lander today, axf-molly later; '' while unknown. */
export const RUNNERS = Object.freeze(['cron-lander', 'axf-molly', '']);
/** How the queue is ordered: the in-flight build first, then CI running, then waiting by `since`; terminal builds are not in it. */
export const QUEUE_ORDER = Object.freeze(['merging-main', 'fixing', 'landing', 'ci-running', 'waiting']);
/** `behind` on a row when the runner has not counted the commits behind main. */
export const BEHIND_UNKNOWN = -1;

/** What a try is for. */
export const KINDS = Object.freeze(['clash', 'red-ci', 'land']);
/** Where a build is. */
export const STATES = Object.freeze(['waiting', 'merging-main', 'fixing', 'ci-running', 'landing', 'landed', 'escalated']);
/** States with an attempt open. */
export const IN_FLIGHT = Object.freeze(['merging-main', 'fixing', 'landing']);
/** States the engine never leaves by itself (escalated: until a hand resets). */
export const TERMINAL = Object.freeze(['landed', 'escalated']);
/** How one try ended. */
export const ATTEMPT_RESULTS = Object.freeze(['started', 'ok', 'failed', 'timeout', 'skipped']);
/** The results that count towards maxAttempts. */
export const FAILURES = Object.freeze(['failed', 'timeout']);
/** What decide() may answer. */
export const ACTIONS = Object.freeze(['merge-main', 'fix-session', 'wait', 'land', 'escalate', 'none']);
export const ACTION_KIND = Object.freeze({ 'merge-main': 'clash', 'fix-session': 'red-ci', land: 'land' });
export const KIND_ACTION = Object.freeze({ clash: 'merge-main', 'red-ci': 'fix-session', land: 'land' });
export const ACTION_STATE = Object.freeze({ 'merge-main': 'merging-main', 'fix-session': 'fixing', land: 'landing', escalate: 'escalated' });
/** Why a wait is a wait: one fixed list so the console, CLI and voice say it the same way. */
export const WAIT_REASONS = Object.freeze(['switched-off', 'ci-running', 'ci-none', 'in-flight', 'backoff', 'ui-review', 'held', 'draft', 'fork', 'no-pr']);
export const ESCALATE_TO = Object.freeze(['banner', 'note', 'none']);
/** The gate rule whose settings are the policy (gate-rules@1 DEFAULT_RULES). */
export const RULE_ID = 'auto-lander';

export const POLICY_DEFAULTS = Object.freeze({
  enabled: true, maxAttempts: 3, backoff: Object.freeze({ baseMin: 5, factor: 3, maxMin: 60 }), attemptTimeoutMin: 45,
  mergeMain: true, fixSessions: true, land: true, escalateTo: 'banner',
});
export const MAX_ATTEMPTS_RANGE = Object.freeze([1, 10]);
export const ATTEMPTS_MAX = 60;
export const BUILDS_MAX = 400;
export const LOG_MAX = 2000;
export const TEXT_MAX = 600;

const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const int = (v, d = 0) => (Number.isInteger(v) && v >= 0 ? v : d);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
const pr = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const oneOf = (list, v, d) => (list.includes(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const minutes = (ms) => ms / 60000;
const plusMin = (at, min) => new Date(Date.parse(at) + min * 60000).toISOString();
const names = (list) => (list.length ? ` (${list.slice(0, 3).join(', ')}${list.length > 3 ? ', …' : ''})` : '');
const KIND_WORD = Object.freeze({ clash: 'merging main in', 'red-ci': 'fixing red CI', land: 'landing' });

// ------------------------------------------------------------------ records

/** One attempt, normalised: bad enums fall to the safe side (result failed counts; kind land never starts a fix). */
export function normAttempt(a) {
  const x = obj(a);
  return {
    $axf: ATTEMPT_FRAME, build: str(x.build, 120), kind: oneOf(KINDS, x.kind, 'land'), n: int(x.n) || 1,
    account: str(x.account, 80), session: str(x.session, 120), branch: str(x.branch, 200), head: str(x.head, 64), pr: pr(x.pr),
    result: oneOf(ATTEMPT_RESULTS, x.result, 'failed'), log: str(x.log, LOG_MAX), at: iso(x.at), endedAt: iso(x.endedAt),
  };
}

/** Errors in one attempt (empty = valid). */
export function attemptErrors(a, path = 'attempt') {
  const out = []; const x = obj(a);
  if (x.$axf !== undefined && x.$axf !== ATTEMPT_FRAME) out.push(`${path}.$axf is ${ATTEMPT_FRAME}`);
  if (!str(x.build)) out.push(`${path}.build names the build`);
  if (!KINDS.includes(x.kind)) out.push(`${path}.kind is one of ${KINDS.join(', ')}`);
  if (!Number.isInteger(x.n) || x.n < 1) out.push(`${path}.n is a whole number from 1`);
  if (!ATTEMPT_RESULTS.includes(x.result)) out.push(`${path}.result is one of ${ATTEMPT_RESULTS.join(', ')}`);
  if (!iso(x.at)) out.push(`${path}.at is an ISO date-time`);
  if (x.result !== 'started' && x.endedAt !== undefined && x.endedAt !== '' && !iso(x.endedAt)) out.push(`${path}.endedAt is an ISO date-time`);
  if (x.result === 'started' && x.endedAt) out.push(`${path}.endedAt is empty while started`);
  if (x.log !== undefined && typeof x.log !== 'string') out.push(`${path}.log is a string`);
  return out;
}

/** The policy, normalised: every field falls back to its default; maxAttempts is clamped to 1..10. */
export function normPolicy(p) {
  const x = obj(p); const b = obj(x.backoff); const D = POLICY_DEFAULTS;
  return {
    $axf: POLICY_FRAME, enabled: bool(x.enabled, D.enabled), maxAttempts: clamp(int(x.maxAttempts, D.maxAttempts) || D.maxAttempts, MAX_ATTEMPTS_RANGE[0], MAX_ATTEMPTS_RANGE[1]),
    backoff: { baseMin: num(b.baseMin, D.backoff.baseMin), factor: num(b.factor, D.backoff.factor), maxMin: num(b.maxMin, D.backoff.maxMin) },
    attemptTimeoutMin: num(x.attemptTimeoutMin, D.attemptTimeoutMin), mergeMain: bool(x.mergeMain, D.mergeMain), fixSessions: bool(x.fixSessions, D.fixSessions),
    land: bool(x.land, D.land), escalateTo: oneOf(ESCALATE_TO, x.escalateTo, D.escalateTo),
  };
}

/** Errors in a policy (empty = valid). */
export function policyErrors(p, path = 'policy') {
  const out = []; const x = obj(p); const b = obj(x.backoff);
  if (x.$axf !== undefined && x.$axf !== POLICY_FRAME) out.push(`${path}.$axf is ${POLICY_FRAME}`);
  if (x.enabled !== undefined && typeof x.enabled !== 'boolean') out.push(`${path}.enabled is true or false`);
  if (x.maxAttempts !== undefined && (!Number.isInteger(x.maxAttempts) || x.maxAttempts < MAX_ATTEMPTS_RANGE[0] || x.maxAttempts > MAX_ATTEMPTS_RANGE[1])) out.push(`${path}.maxAttempts is ${MAX_ATTEMPTS_RANGE[0]}..${MAX_ATTEMPTS_RANGE[1]}`);
  for (const k of ['baseMin', 'factor', 'maxMin']) if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] > 0)) out.push(`${path}.backoff.${k} is a number above 0`);
  if (x.attemptTimeoutMin !== undefined && !(typeof x.attemptTimeoutMin === 'number' && x.attemptTimeoutMin > 0)) out.push(`${path}.attemptTimeoutMin is a number above 0`);
  for (const k of ['mergeMain', 'fixSessions', 'land']) if (x[k] !== undefined && typeof x[k] !== 'boolean') out.push(`${path}.${k} is true or false`);
  if (x.escalateTo !== undefined && !ESCALATE_TO.includes(x.escalateTo)) out.push(`${path}.escalateTo is one of ${ESCALATE_TO.join(', ')}`);
  return out;
}

/** The policy an auto-lander gate rule carries (gate-rule-set@1 or a list of rules); the defaults without the rule. */
export function policyFromRules(rules) {
  const list = Array.isArray(rules) ? rules : Array.isArray(rules?.rules) ? rules.rules : [];
  const r = list.find((x) => obj(x).id === RULE_ID);
  if (!r) return normPolicy({});
  return normPolicy({ ...obj(r.settings), enabled: bool(r.enabled, true) && bool(obj(r.settings).enabled, true) });
}

/** One build record, normalised (attempts oldest first, n dense per kind is the writer's job; order is kept). */
export function normBuild(b, at = new Date().toISOString()) {
  const x = obj(b);
  const esc = x.escalation && typeof x.escalation === 'object' ? { at: iso(x.escalation.at) || at, kind: oneOf(KINDS, x.escalation.kind, 'land'), attempts: int(x.escalation.attempts), why: str(x.escalation.why, TEXT_MAX), head: str(x.escalation.head, 64) } : null;
  const state = oneOf(STATES, x.state, 'waiting');
  return {
    $axf: BUILD_FRAME, build: str(x.build, 120), pr: pr(x.pr), branch: str(x.branch, 200), head: str(x.head, 64),
    state: state === 'escalated' && !esc ? 'waiting' : state, since: iso(x.since) || iso(x.at) || at, at: iso(x.at) || at,
    attempts: (Array.isArray(x.attempts) ? x.attempts : []).slice(-ATTEMPTS_MAX).map(normAttempt), reason: str(x.reason, TEXT_MAX),
    escalation: state === 'escalated' ? esc : null,
  };
}

/** Errors in a build record (empty = valid). */
export function buildErrors(b, path = 'build') {
  const out = []; const x = obj(b);
  if (x.$axf !== undefined && x.$axf !== BUILD_FRAME) out.push(`${path}.$axf is ${BUILD_FRAME}`);
  if (!str(x.build)) out.push(`${path}.build names the build`);
  if (!STATES.includes(x.state)) out.push(`${path}.state is one of ${STATES.join(', ')}`);
  if (!iso(x.since)) out.push(`${path}.since is an ISO date-time`);
  if (!Array.isArray(x.attempts)) out.push(`${path}.attempts is a list`);
  else {
    x.attempts.forEach((a, i) => out.push(...attemptErrors(a, `${path}.attempts[${i}]`)));
    const open = x.attempts.filter((a) => obj(a).result === 'started');
    if (open.length > 1) out.push(`${path}.attempts has more than one open attempt`);
    if (open.length && !IN_FLIGHT.includes(x.state)) out.push(`${path}.attempts has an open attempt while ${x.state}`);
    for (const k of KINDS) { const ns = x.attempts.filter((a) => obj(a).kind === k).map((a) => obj(a).n); if (ns.some((n, i) => n !== i + 1)) out.push(`${path}.attempts ${k} are numbered 1.. in order`); }
  }
  if (x.state === 'escalated' && (!x.escalation || typeof x.escalation !== 'object')) out.push(`${path}.escalation says kind, attempts and why while escalated`);
  if (x.state !== 'escalated' && x.escalation) out.push(`${path}.escalation is null unless escalated`);
  return out;
}

/** An empty state document. */
export function emptyState(at = new Date().toISOString(), policy = {}) {
  return { $axf: STATE_FRAME, at, policy: normPolicy(policy), builds: [] };
}

/** The state document, normalised (one record per build, the first kept). */
export function normState(doc, at = new Date().toISOString()) {
  const d = obj(doc); const seen = new Set(); const builds = [];
  for (const b of Array.isArray(d.builds) ? d.builds : []) { const n = normBuild(b, at); if (!n.build || seen.has(n.build)) continue; seen.add(n.build); builds.push(n); }
  return {
    $axf: STATE_FRAME, at: iso(d.at) || at, policy: normPolicy(d.policy), builds: builds.slice(0, BUILDS_MAX),
    ...(d.migratedFrom ? { migratedFrom: { frame: str(d.migratedFrom.frame, 60), at: iso(d.migratedFrom.at) || at } } : {}),
  };
}

/** Errors in a state document (empty = valid). */
export function stateErrors(doc) {
  const out = []; const d = obj(doc);
  if (d.$axf !== STATE_FRAME) out.push(`$axf is ${STATE_FRAME}`);
  if (!iso(d.at)) out.push('at is an ISO date-time');
  out.push(...policyErrors(d.policy));
  if (!Array.isArray(d.builds)) { out.push('builds is a list'); return out; }
  if (d.builds.length > BUILDS_MAX) out.push(`builds holds at most ${BUILDS_MAX}`);
  const ids = new Set();
  d.builds.forEach((b, i) => { out.push(...buildErrors(b, `builds[${i}]`)); const id = obj(b).build; if (ids.has(id)) out.push(`builds[${i}].build ${id} appears twice`); ids.add(id); });
  return out;
}

// ------------------------------------------------------------------ attempts

/** Minutes to wait after the n-th failure of a kind: min(maxMin, baseMin × factor^(n−1)). */
export function backoffMinutes(n, policy) {
  const p = normPolicy(policy); const k = Math.max(1, int(n, 1));
  return Math.min(p.backoff.maxMin, p.backoff.baseMin * p.backoff.factor ** (k - 1));
}

/** The attempts of one kind, oldest first. */
export const attemptsOf = (attempts, kind) => (Array.isArray(attempts) ? attempts : []).map(normAttempt).filter((a) => a.kind === kind);
/** The open attempt (result started), or null. */
export const openAttempt = (attempts) => (Array.isArray(attempts) ? attempts : []).map(normAttempt).find((a) => a.result === 'started') || null;
/** Whether a started attempt has run past the policy's timeout at `at`. */
export const timedOut = (attempt, policy, at) => attempt?.result === 'started' && !!iso(attempt.at) && minutes(Date.parse(at) - Date.parse(attempt.at)) >= normPolicy(policy).attemptTimeoutMin;

/** The failures of one kind at `at`: failed, timeout, and a started attempt that has timed out. */
export function failuresOf(attempts, kind, policy, at) {
  return attemptsOf(attempts, kind).filter((a) => FAILURES.includes(a.result) || timedOut(a, policy, at));
}

/** A new started attempt for an action (merge-main, fix-session, land) on a build. */
export function startAttempt(build, action, { account = '', session = '', at = new Date().toISOString() } = {}) {
  const b = normBuild(build, at); const a = obj(action); const kind = ACTION_KIND[a.action];
  if (!kind) throw Object.assign(new Error(`${a.action || 'this action'} starts no attempt`), { code: 'invalid' });
  const n = int(a.attempt) || attemptsOf(b.attempts, kind).length + 1;
  return normAttempt({ build: b.build, kind, n, account, session, branch: b.branch, head: b.head, pr: b.pr, result: 'started', log: '', at, endedAt: '' });
}

/** The open attempt of a build ended with a result and a log excerpt; the build's attempts list updated. */
export function endAttempt(build, result, { log = '', at = new Date().toISOString(), head = '' } = {}) {
  const b = normBuild(build, at); const open = b.attempts.find((a) => a.result === 'started');
  if (!open) throw Object.assign(new Error(`${b.build} has no open attempt`), { code: 'invalid' });
  const r = oneOf(ATTEMPT_RESULTS.filter((x) => x !== 'started'), result, 'failed');
  const done = { ...open, result: r, log: str(log, LOG_MAX), endedAt: at };
  return { ...b, at, ...(head ? { head: str(head, 64) } : {}), attempts: b.attempts.map((a) => (a === open ? done : a)) };
}

/** A build with an attempt added (the runner's record of a try it made outside startAttempt/endAttempt). */
export function recordAttempt(build, attempt, at = new Date().toISOString()) {
  const b = normBuild(build, at); const a = normAttempt({ ...obj(attempt), build: b.build });
  return { ...b, at, attempts: [...b.attempts, a].slice(-ATTEMPTS_MAX) };
}

// ------------------------------------------------------------------ decide

const A = (build, action, extra = {}, at) => ({
  $axf: ACTION_FRAME, at, build: build.build, pr: build.pr, head: build.head, action, state: extra.state || build.state,
  kind: extra.kind || '', attempt: int(extra.attempt), notBefore: extra.notBefore || '', waitReason: extra.waitReason || '', reason: str(extra.reason, TEXT_MAX),
});

/**
 * The next thing the server does for one build → auto-lander-action@1.
 *   build     auto-lander-build@1 (state, head, attempts)
 *   prState   pr-snapshot@1 as the gate reads it (gate-rules.normSnapshot): ci, conflicts, draft, fork, ui, holds, merged
 *   attempts  the build's attempts (defaults to build.attempts)
 *   policy    auto-lander-policy@1 (the auto-lander rule's settings)
 * merge-main on a clash, fix-session on red CI, wait while CI runs, land when green, escalate once a kind's failures
 * reach maxAttempts. Every head counts; a reset by hand starts the count again.
 *   now       true for a `run` command by hand: the backoff after a failure is not waited for (nothing else changes)
 */
export function decide(build, prState, attempts, policy, { at = new Date().toISOString(), now = false } = {}) {
  const b = normBuild(build, at); const p = normPolicy(policy); const s = normSnapshot(prState);
  const list = Array.isArray(attempts) ? attempts.map(normAttempt) : b.attempts;
  const merged = obj(prState).merged === true || obj(prState).state === 'merged';
  if (b.state === 'landed' || merged) return A(b, 'none', { state: 'landed', reason: 'It has landed.' }, at);
  if (!p.enabled) return A(b, 'none', { waitReason: 'switched-off', reason: 'The auto-lander rule is off: nothing is done by itself.' }, at);
  if (b.state === 'escalated') return A(b, 'none', { state: 'escalated', reason: `Escalated${b.escalation?.why ? `: ${b.escalation.why}` : ''} Reset it to try again.` }, at);

  // mid-flight: an attempt is open and not yet timed out → wait where it is
  const open = openAttempt(list);
  if (open && !timedOut(open, p, at)) return A(b, 'wait', { waitReason: 'in-flight', kind: open.kind, attempt: open.n, state: IN_FLIGHT.includes(b.state) ? b.state : ACTION_STATE[KIND_ACTION[open.kind]], reason: `Attempt ${open.n} of ${KIND_WORD[open.kind]} is still running (since ${open.at}).` }, at);

  // nothing the server may do about these
  if (s.draft) return A(b, 'wait', { waitReason: 'draft', state: 'waiting', reason: 'It is a draft: it lands when it is marked ready.' }, at);
  if (s.fork) return A(b, 'wait', { waitReason: 'fork', state: 'waiting', reason: 'It comes from a fork: the lander never lands a fork.' }, at);
  if (s.landHeld || s.removed) return A(b, 'wait', { waitReason: 'held', state: 'waiting', reason: `Held by hand (${s.landHeld || s.removed}). Release it and the lander goes on.` }, at);
  if (!(b.pr || s.number)) return A(b, 'wait', { waitReason: 'no-pr', state: 'waiting', reason: 'No PR yet: the lander starts when the PR is open.' }, at);

  // what kind of try is wanted
  let kind = '';
  if (s.conflicts.length) kind = 'clash';
  else if (s.ci === 'failure') kind = 'red-ci';
  else if (s.ci === 'running') return A(b, 'wait', { waitReason: 'ci-running', state: 'ci-running', reason: 'CI is running on its head.' }, at);
  else if (s.ci !== 'success') return A(b, 'wait', { waitReason: 'ci-none', state: 'waiting', reason: 'CI has not run on its head yet.' }, at);
  else if (s.ui && s.ui !== '') return A(b, 'wait', { waitReason: 'ui-review', state: 'waiting', reason: s.ui === 'waiting' ? 'Its screenshots are waiting in UI Review. Approve them and it lands by itself.' : s.ui === 'unknown' ? "UI Review couldn't be read, so it waits." : `UI Review ${s.ui === 'changes' ? 'asked for changes' : 'rejected it'}: it waits for the review.` }, at);
  else kind = 'land';

  const action = KIND_ACTION[kind];
  const failures = failuresOf(list, kind, p, at);
  const n = failures.length;
  const detail = kind === 'clash' ? `it conflicts with main in code${names(s.conflicts)}` : kind === 'red-ci' ? `CI is red${names(s.failing)}` : 'CI is green';
  const allowed = kind === 'clash' ? p.mergeMain : kind === 'red-ci' ? p.fixSessions : p.land;
  if (!allowed && kind === 'land') return A(b, 'wait', { waitReason: 'held', state: 'waiting', kind, reason: 'CI is green; landing by the server is off, so a hand lands it.' }, at);
  if (!allowed) return A(b, 'escalate', { state: 'escalated', kind, reason: `${detail[0].toUpperCase()}${detail.slice(1)} and ${KIND_WORD[kind]} by the server is off.` }, at);
  if (n >= p.maxAttempts) return A(b, 'escalate', { state: 'escalated', kind, attempt: n, reason: `${detail[0].toUpperCase()}${detail.slice(1)}; ${KIND_WORD[kind]} failed ${n} time${n === 1 ? '' : 's'} (the limit is ${p.maxAttempts}). Needs a hand.` }, at);
  const last = failures[n - 1];
  if (last && !now) {
    const since = last.endedAt || (timedOut(last, p, at) ? plusMin(last.at, p.attemptTimeoutMin) : last.at);
    const notBefore = plusMin(since, backoffMinutes(n, p));
    if (Date.parse(at) < Date.parse(notBefore)) return A(b, 'wait', { waitReason: 'backoff', state: 'waiting', kind, attempt: n + 1, notBefore, reason: `${detail[0].toUpperCase()}${detail.slice(1)}; attempt ${n} of ${KIND_WORD[kind]} failed. Attempt ${n + 1} starts at ${notBefore}.` }, at);
  }
  return A(b, action, { state: ACTION_STATE[action], kind, attempt: n + 1, reason: `${detail[0].toUpperCase()}${detail.slice(1)}: ${KIND_WORD[kind]}${n ? ` (attempt ${n + 1} of ${p.maxAttempts})` : ''}.` }, at);
}

/** The build after an action is taken: state, since, reason; an escalation recorded; a started attempt added for a try. */
export function apply(build, action, { account = '', session = '', at = new Date().toISOString() } = {}) {
  const b = normBuild(build, at); const a = obj(action);
  const state = oneOf(STATES, a.state, b.state);
  let next = { ...b, at, reason: str(a.reason, TEXT_MAX) || b.reason };
  if (state !== b.state) next = { ...next, state, since: at };
  if (a.action === 'escalate') next = { ...next, state: 'escalated', since: state !== b.state ? at : next.since, escalation: { at, kind: oneOf(KINDS, a.kind, 'land'), attempts: int(a.attempt), why: str(a.reason, TEXT_MAX), head: b.head } };
  if (ACTION_KIND[a.action]) next = { ...next, attempts: [...next.attempts, startAttempt(next, a, { account, session, at })].slice(-ATTEMPTS_MAX) };
  return next;
}

/** A hand reset: the escalation is cleared and the counted attempts of that kind are marked skipped, so the next try is attempt 1. */
export function resetEscalation(build, { at = new Date().toISOString(), by = '' } = {}) {
  const b = normBuild(build, at);
  if (b.state !== 'escalated') return b;
  const kind = b.escalation?.kind;
  const attempts = b.attempts.map((a) => (a.kind === kind && FAILURES.includes(a.result) ? { ...a, result: 'skipped', log: `${a.log}${a.log ? '\n' : ''}reset${by ? ` by ${by}` : ''} at ${at}`.slice(0, LOG_MAX) } : a));
  // renumber the kind so the next attempt is 1 again while the history stays in the list
  let k = 0; const renumbered = attempts.map((a) => (a.kind === kind ? { ...a, n: (k += 1) } : a));
  const live = renumbered.filter((a) => !(a.kind === kind && a.result === 'skipped'));
  const skipped = renumbered.filter((a) => a.kind === kind && a.result === 'skipped').map((a, i) => ({ ...a, n: i + 1 }));
  const rest = live.filter((a) => a.kind !== kind);
  return { ...b, at, state: 'waiting', since: at, escalation: null, reason: `Reset${by ? ` by ${by}` : ''}: the lander tries again.`, attempts: [...rest, ...skipped].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)) };
}

/** The state document with one build replaced (or added). */
export function putBuild(state, build, at = new Date().toISOString()) {
  const s = normState(state, at); const b = normBuild(build, at);
  const i = s.builds.findIndex((x) => x.build === b.build);
  const builds = i >= 0 ? s.builds.map((x, k) => (k === i ? b : x)) : [...s.builds, b].slice(-BUILDS_MAX);
  return { ...s, at, builds };
}

// ------------------------------------------------------------------ migration from lander-state@1

/** The lander-state@1 the gate plugin shows today → auto-lander-state@1. Nothing is dropped. */
export function fromLanderState(landerState, { policy = {}, at = new Date().toISOString() } = {}) {
  const ls = obj(landerState); const builds = [];
  const idOf = (x) => str(x.build, 120) || (pr(x.pr) ? `pr-${x.pr}` : '');
  const landing = ls.landing && typeof ls.landing === 'object' && pr(ls.landing.pr) ? ls.landing : null;
  if (landing) builds.push(normBuild({ build: idOf(landing), pr: landing.pr, branch: landing.branch, head: landing.head, state: landing.ci === 'running' ? 'ci-running' : 'landing', since: iso(landing.since) || at, at, attempts: landing.ci === 'running' ? [] : [{ build: idOf(landing), kind: 'land', n: 1, branch: landing.branch, head: landing.head, pr: landing.pr, result: 'started', at: iso(landing.since) || at }], reason: landing.ci === 'running' ? 'CI is running on its head.' : 'Landing now.' }, at));
  for (const w of Array.isArray(ls.waiting) ? ls.waiting : []) {
    const x = obj(w); const id = idOf(x); if (!id) continue;
    const why = str(x.reason, TEXT_MAX); const since = iso(x.since) || at;
    const red = x.state === 'kicked' || (x.rule === 'ci-green' && /red|broke CI|went red/i.test(why));
    const running = x.rule === 'ci-green' && /running|not run/i.test(why) && !red;
    const attempts = red ? [{ build: id, kind: 'red-ci', n: 1, branch: x.branch, head: x.head, pr: x.pr, result: 'failed', log: why, at: since, endedAt: since }] : [];
    builds.push(normBuild({ build: id, pr: x.pr, branch: x.branch, head: x.head, state: running ? 'ci-running' : 'waiting', since, at, attempts, reason: why || 'Waits its turn.' }, at));
  }
  for (const n of Array.isArray(ls.landedRecently) ? ls.landedRecently : []) if (pr(n)) builds.push(normBuild({ build: `pr-${n}`, pr: n, state: 'landed', since: iso(ls.at) || at, at, reason: 'Landed.' }, at));
  return normState({ $axf: STATE_FRAME, at, policy, builds, migratedFrom: { frame: 'lander-state@1', at } }, at);
}

// ------------------------------------------------------------------ the view (what GET …/auto-lander answers)

/** The latest ended attempt of a build (ok, failed, timeout or skipped), or null: the grid's "last result" column. */
export function lastResultOf(attempts) {
  const ended = (Array.isArray(attempts) ? attempts : []).map(normAttempt).filter((a) => a.result !== 'started');
  if (!ended.length) return null;
  const a = ended.reduce((x, y) => (Date.parse(y.endedAt || y.at) >= Date.parse(x.endedAt || x.at) ? y : x));
  return { kind: a.kind, n: a.n, result: a.result, at: a.endedAt || a.at, head: a.head, log: a.log };
}

/** The lander's queue: ids of every build it still works on, in the order it works on them (QUEUE_ORDER, then `since`). */
export function queueOf(builds) {
  const rank = (b) => { const i = QUEUE_ORDER.indexOf(b.state); return i < 0 ? QUEUE_ORDER.length : i; };
  return (Array.isArray(builds) ? builds : []).map((b) => normBuild(b)).filter((b) => !TERMINAL.includes(b.state))
    .sort((x, y) => rank(x) - rank(y) || Date.parse(x.since) - Date.parse(y.since) || x.build.localeCompare(y.build)).map((b) => b.build);
}

/**
 * One grid row: the build record plus what the runner knows around it.
 *   behind   commits the branch is behind main (BEHIND_UNKNOWN while uncounted)
 *   hold     the gate's hold by hand on its PR ('' when none): a paused build is a held one
 *   title    the build's title from builds@1 ('' when the joiner has none)
 */
export function rowOf(build, { behind = BEHIND_UNKNOWN, hold = '', title = '', at = new Date().toISOString() } = {}) {
  const b = normBuild(build, at);
  return { ...b, title: str(title, 200), behind: Number.isInteger(behind) && behind >= 0 ? behind : BEHIND_UNKNOWN, paused: !!str(hold), hold: str(hold, TEXT_MAX), lastResult: lastResultOf(b.attempts) };
}

/**
 * auto-lander-view@1: the state document as every surface reads it.
 *   service  { up, runner, since, lastTick } from the runner's heartbeat (up = false when the heartbeat is older than attemptTimeoutMin)
 *   behind   { [build]: commits behind main }       holds  { [build]: why it is held by hand }       titles  { [build]: title }
 * `current` is the first build in the queue that is in flight or on CI; `queue` is queueOf; `builds` carries every row,
 * queue first and then the terminal ones, newest `at` first.
 */
export function viewOf(state, { service = {}, behind = {}, holds = {}, titles = {}, at = new Date().toISOString() } = {}) {
  const s = normState(state, at); const sv = obj(service); const bh = obj(behind); const hd = obj(holds); const tt = obj(titles);
  const rows = s.builds.map((b) => rowOf(b, { behind: bh[b.build], hold: hd[b.build], title: tt[b.build], at }));
  const queue = queueOf(rows); const pos = new Map(queue.map((id, i) => [id, i]));
  const byId = new Map(rows.map((r) => [r.build, r]));
  const live = queue.map((id) => byId.get(id)); const done = rows.filter((r) => !pos.has(r.build)).sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const current = live.find((r) => IN_FLIGHT.includes(r.state) || r.state === 'ci-running') || null;
  const lastTick = iso(sv.lastTick) || iso(sv.at) || '';
  const up = typeof sv.up === 'boolean' ? sv.up : !!lastTick && minutes(Date.parse(at) - Date.parse(lastTick)) < s.policy.attemptTimeoutMin;
  const count = (st) => rows.filter((r) => r.state === st).length;
  return {
    $axf: VIEW_FRAME, at,
    service: { up, runner: oneOf(RUNNERS, sv.runner, ''), since: iso(sv.since), lastTick, paused: !s.policy.enabled, policy: s.policy,
      counts: { builds: rows.length, queue: queue.length, inFlight: rows.filter((r) => IN_FLIGHT.includes(r.state)).length, ciRunning: count('ci-running'), waiting: count('waiting'), landed: count('landed'), escalated: count('escalated'), paused: rows.filter((r) => r.paused).length } },
    current, queue, builds: [...live, ...done],
  };
}

/** Errors in a view (empty = valid): the shape every surface relies on. */
export function viewErrors(v) {
  const out = []; const x = obj(v); const sv = obj(x.service);
  if (x.$axf !== VIEW_FRAME) out.push(`$axf is ${VIEW_FRAME}`);
  if (!iso(x.at)) out.push('at is an ISO date-time');
  if (typeof sv.up !== 'boolean') out.push('service.up is true or false');
  if (!RUNNERS.includes(sv.runner)) out.push(`service.runner is one of ${RUNNERS.filter(Boolean).join(', ')} or empty`);
  out.push(...policyErrors(sv.policy, 'service.policy'));
  if (!Array.isArray(x.queue) || x.queue.some((id) => typeof id !== 'string' || !id)) out.push('queue is a list of build ids');
  if (!Array.isArray(x.builds)) { out.push('builds is a list'); return out; }
  const ids = new Set(x.builds.map((r) => obj(r).build));
  x.builds.forEach((r, i) => { out.push(...buildErrors(r, `builds[${i}]`)); const row = obj(r); if (!(Number.isInteger(row.behind) && row.behind >= BEHIND_UNKNOWN)) out.push(`builds[${i}].behind is a count or ${BEHIND_UNKNOWN}`); if (typeof row.paused !== 'boolean') out.push(`builds[${i}].paused is true or false`); if (row.lastResult !== null && !ATTEMPT_RESULTS.includes(obj(row.lastResult).result)) out.push(`builds[${i}].lastResult is null or an ended attempt`); });
  if (Array.isArray(x.queue)) x.queue.forEach((id, i) => { if (!ids.has(id)) out.push(`queue[${i}] ${id} is not in builds`); });
  if (x.current !== null && !ids.has(obj(x.current).build)) out.push('current is null or one of builds');
  return out;
}

// ------------------------------------------------------------------ commands (what POST …/auto-lander/<command> takes)

/**
 * auto-lander-command@1, normalised. What each does, in terms of the records above:
 *   run       decide + carry out now for the build (every queued build when none); a backoff is not waited for (decide now: true)
 *   retry     resetEscalation on the build, then run it (a build that is not escalated is simply run)
 *   pause     with a build: the gate's hold by hand on its PR (decide answers wait / held); without: the auto-lander rule off
 *   resume    with a build: the hold released; without: the rule on
 *   settings  the policy patched with `settings` (auto-lander-policy@1 fields), validated by policyErrors
 * Every command carries `by` and `reason: { title, description }`, and lands in gate.history.
 */
export function normCommand(c) {
  const x = obj(c); const r = obj(x.reason);
  return {
    $axf: COMMAND_FRAME, command: oneOf(COMMANDS, x.command, 'run'), build: str(x.build, 120), by: str(x.by, 80), at: iso(x.at),
    reason: { title: str(r.title, 200), description: str(r.description, TEXT_MAX) }, ...(x.settings !== undefined ? { settings: obj(x.settings) } : {}),
  };
}

/** Errors in a command (empty = valid). */
export function commandErrors(c, path = 'command') {
  const out = []; const x = obj(c);
  if (x.$axf !== undefined && x.$axf !== COMMAND_FRAME) out.push(`${path}.$axf is ${COMMAND_FRAME}`);
  if (!COMMANDS.includes(x.command)) { out.push(`${path}.command is one of ${COMMANDS.join(', ')}`); return out; }
  const need = COMMAND_BUILD[x.command];
  if (need === 'required' && !str(x.build)) out.push(`${path}.build names the build to ${x.command}`);
  if (need === 'none' && str(x.build)) out.push(`${path}.build is empty for ${x.command}`);
  if (x.command === 'settings') { if (!x.settings || typeof x.settings !== 'object' || Array.isArray(x.settings) || !Object.keys(x.settings).length) out.push(`${path}.settings carries the policy fields to change`); else out.push(...policyErrors(x.settings, `${path}.settings`)); }
  if (!str(obj(x.reason).title)) out.push(`${path}.reason.title says what is about to happen`);
  return out;
}

// ------------------------------------------------------------------ registry + JSON Schemas

/** The snapshot framework/schemas/auto-lander.json carries, for Python readers and ports. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, attempt: ATTEMPT_FRAME, build: BUILD_FRAME, policy: POLICY_FRAME, action: ACTION_FRAME, state: STATE_FRAME, view: VIEW_FRAME, command: COMMAND_FRAME,
  kinds: KINDS, states: STATES, inFlight: IN_FLIGHT, terminal: TERMINAL, attemptResults: ATTEMPT_RESULTS, failures: FAILURES, actions: ACTIONS,
  actionKind: ACTION_KIND, actionState: ACTION_STATE, waitReasons: WAIT_REASONS, escalateTo: ESCALATE_TO, policyDefaults: POLICY_DEFAULTS,
  maxAttemptsRange: MAX_ATTEMPTS_RANGE, attemptsMax: ATTEMPTS_MAX, buildsMax: BUILDS_MAX, logMax: LOG_MAX, textMax: TEXT_MAX, ruleId: RULE_ID, migratesFrom: ['lander-state@1'],
  commands: COMMANDS, commandBuild: COMMAND_BUILD, runners: RUNNERS, queueOrder: QUEUE_ORDER, behindUnknown: BEHIND_UNKNOWN,
});

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (n) => `https://amberx.ai/axf/schemas/${n}`;
const dateTime = { type: 'string', format: 'date-time' };
const dateOrEmpty = { type: 'string', description: 'an ISO date-time, or empty' };
const positive = { type: 'number', exclusiveMinimum: 0 };

/** The JSON Schemas written to framework/schemas/json by `axf schemas`. */
export function jsonSchemas() {
  const attempt = {
    $schema, $id: $id('auto-lander-attempt.schema.json'), title: `${ATTEMPT_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['build', 'kind', 'n', 'result', 'at'],
    properties: {
      $axf: { const: ATTEMPT_FRAME }, build: { type: 'string', minLength: 1, maxLength: 120 }, kind: { enum: KINDS, description: 'clash = merge main in; red-ci = a fix session; land = merge the PR' },
      n: { type: 'integer', minimum: 1, description: 'the attempt number for this build and kind, 1-based, dense' }, account: { type: 'string', maxLength: 80, description: 'the Claude account or API key that did it' },
      session: { type: 'string', maxLength: 120 }, branch: { type: 'string', maxLength: 200 }, head: { type: 'string', maxLength: 64 }, pr: { type: 'integer', minimum: 0 },
      result: { enum: ATTEMPT_RESULTS, description: 'timeout = started and older than attemptTimeoutMin; skipped never counts as a failure' }, log: { type: 'string', maxLength: LOG_MAX, description: 'an excerpt of the output' },
      at: dateTime, endedAt: dateOrEmpty,
    },
  };
  const policy = {
    $schema, $id: $id('auto-lander-policy.schema.json'), title: `${POLICY_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: true,
    properties: {
      $axf: { const: POLICY_FRAME }, enabled: { type: 'boolean' }, maxAttempts: { type: 'integer', minimum: MAX_ATTEMPTS_RANGE[0], maximum: MAX_ATTEMPTS_RANGE[1], description: 'failures of one kind on one build before it escalates' },
      backoff: { type: 'object', properties: { baseMin: positive, factor: positive, maxMin: positive }, description: 'wait after the n-th failure: min(maxMin, baseMin × factor^(n−1)) minutes' },
      attemptTimeoutMin: positive, mergeMain: { type: 'boolean' }, fixSessions: { type: 'boolean' }, land: { type: 'boolean' }, escalateTo: { enum: ESCALATE_TO },
    },
  };
  const escalation = { type: ['object', 'null'], required: ['at', 'kind', 'why'], properties: { at: dateTime, kind: { enum: KINDS }, attempts: { type: 'integer', minimum: 0 }, why: { type: 'string', maxLength: TEXT_MAX }, head: { type: 'string', maxLength: 64 } } };
  const build = {
    $schema, $id: $id('auto-lander-build.schema.json'), title: `${BUILD_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['build', 'state', 'since', 'attempts'],
    properties: {
      $axf: { const: BUILD_FRAME }, build: { type: 'string', minLength: 1, maxLength: 120 }, pr: { type: 'integer', minimum: 0 }, branch: { type: 'string', maxLength: 200 }, head: { type: 'string', maxLength: 64 },
      state: { enum: STATES }, since: dateTime, at: dateTime, attempts: { type: 'array', maxItems: ATTEMPTS_MAX, items: { ...attempt, $schema: undefined, $id: undefined }, description: 'oldest first; at most one started' },
      reason: { type: 'string', maxLength: TEXT_MAX, description: 'why it is in this state, in plain words' }, escalation,
    },
  };
  const action = {
    $schema, $id: $id('auto-lander-action.schema.json'), title: `${ACTION_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false, required: ['action', 'state', 'reason'],
    properties: {
      $axf: { const: ACTION_FRAME }, at: dateTime, build: { type: 'string' }, pr: { type: 'integer', minimum: 0 }, head: { type: 'string' }, action: { enum: ACTIONS }, state: { enum: STATES, description: 'the state after the action is taken' },
      kind: { enum: [...KINDS, ''] }, attempt: { type: 'integer', minimum: 0, description: 'the n of the attempt the action starts; 0 for wait / none' }, notBefore: dateOrEmpty, waitReason: { enum: [...WAIT_REASONS, ''] }, reason: { type: 'string', maxLength: TEXT_MAX },
    },
  };
  const state = {
    $schema, $id: $id('auto-lander-state.schema.json'), title: `${STATE_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: true, required: ['$axf', 'at', 'policy', 'builds'],
    properties: {
      $axf: { const: STATE_FRAME }, at: dateTime, policy: { ...policy, $schema: undefined, $id: undefined }, builds: { type: 'array', maxItems: BUILDS_MAX, items: { ...build, $schema: undefined, $id: undefined }, description: 'one record per build' },
      migratedFrom: { type: 'object', properties: { frame: { type: 'string' }, at: dateTime }, description: 'set once by fromLanderState' },
    },
  };
  const row = {
    ...build, $schema: undefined, $id: undefined, title: 'one grid row: auto-lander-build@1 plus what the runner knows around it', additionalProperties: false, required: [...build.required, 'behind', 'paused', 'lastResult'],
    properties: {
      ...build.properties, title: { type: 'string', maxLength: 200, description: "the build's title from builds@1" }, behind: { type: 'integer', minimum: BEHIND_UNKNOWN, description: `commits behind main; ${BEHIND_UNKNOWN} while uncounted` },
      paused: { type: 'boolean', description: "held by hand on the gate (the lander's pause)" }, hold: { type: 'string', maxLength: TEXT_MAX, description: 'why it is held, or empty' },
      lastResult: { type: ['object', 'null'], required: ['kind', 'n', 'result', 'at'], properties: { kind: { enum: KINDS }, n: { type: 'integer', minimum: 1 }, result: { enum: ATTEMPT_RESULTS.filter((x) => x !== 'started') }, at: dateTime, head: { type: 'string', maxLength: 64 }, log: { type: 'string', maxLength: LOG_MAX } }, description: 'the latest ended attempt' },
    },
  };
  const view = {
    $schema, $id: $id('auto-lander-view.schema.json'), title: `${VIEW_FRAME} (${SCHEMA})`, description: 'What GET …/auto-lander answers and every surface (console tab, CLI, MCP, voice) reads.', type: 'object', additionalProperties: false, required: ['$axf', 'at', 'service', 'current', 'queue', 'builds'],
    properties: {
      $axf: { const: VIEW_FRAME }, at: dateTime,
      service: { type: 'object', required: ['up', 'runner', 'paused', 'policy', 'counts'], properties: {
        up: { type: 'boolean', description: 'the runner has ticked within attemptTimeoutMin' }, runner: { enum: RUNNERS }, since: dateOrEmpty, lastTick: dateOrEmpty, paused: { type: 'boolean', description: 'the auto-lander rule is off' }, policy: { ...policy, $schema: undefined, $id: undefined },
        counts: { type: 'object', properties: Object.fromEntries(['builds', 'queue', 'inFlight', 'ciRunning', 'waiting', 'landed', 'escalated', 'paused'].map((k) => [k, { type: 'integer', minimum: 0 }])) },
      } },
      current: { oneOf: [{ type: 'null' }, row], description: 'the build being worked on (in flight or on CI), or null' },
      queue: { type: 'array', items: { type: 'string' }, description: `build ids still to land, in the order worked: ${QUEUE_ORDER.join(', ')}, then since` },
      builds: { type: 'array', maxItems: BUILDS_MAX, items: row, description: 'every tracked build: the queue first, then landed and escalated, newest first' },
    },
  };
  const command = {
    $schema, $id: $id('auto-lander-command.schema.json'), title: `${COMMAND_FRAME} (${SCHEMA})`, description: 'What POST …/auto-lander/<command> takes; the same on MCP, the CLI and voice.', type: 'object', additionalProperties: false, required: ['command', 'reason'],
    properties: {
      $axf: { const: COMMAND_FRAME }, command: { enum: COMMANDS, description: 'run = decide and act now, skipping a backoff; retry = reset an escalation then run; pause / resume = hold or release a build (the gate hold), or the rule off / on without a build; settings = patch the policy' },
      build: { type: 'string', maxLength: 120, description: `required for retry, optional for run / pause / resume (the whole lander when empty), empty for settings` }, by: { type: 'string', maxLength: 80 }, at: dateOrEmpty,
      reason: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: TEXT_MAX } } },
      settings: { ...policy, $schema: undefined, $id: undefined, description: 'for settings: the auto-lander-policy@1 fields to change' },
    },
  };
  return { 'auto-lander-attempt.schema.json': attempt, 'auto-lander-policy.schema.json': policy, 'auto-lander-build.schema.json': build, 'auto-lander-action.schema.json': action, 'auto-lander-state.schema.json': state, 'auto-lander-view.schema.json': view, 'auto-lander-command.schema.json': command };
}
