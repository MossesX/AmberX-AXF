/**
 * Retry ladder (done-means-merged@1, framework/spec/DONE-MEANS-MERGED.md). Build server-rule-done-means-merged-working,
 * Brett Nov 17 2026: "We asked you to build it. You should do whatever you have to do to build it, period. Why should we
 * say build it and then it fails and you don't say anything and we find out days later?"
 *
 * Given a build's attempts (attempt@1, build-pipeline.mjs) and the failure it is facing, say what the server tries next:
 * the same approach once more, then a different fix strategy, then a fresh session, then another model or account, and
 * only then escalate. Pure and deterministic: no IO, no clock (the caller passes `at`), the same inputs always give the
 * same answer. The dispatcher, the auto-lander and the gate all call this one engine; the Attempts tab shows ladderFor().
 *
 *   nextStrategy(attempts, failure, policy, ctx) → retry-decision@1
 *     { at, kind, n, strategy, fixStrategy, model, account, rung, tried[], notBefore, inFlight, escalate, reason }
 *   escalationOf(attempts, failure, { at, head })  → the escalation record for a decision that said escalate
 *   ladderFor(kind, policy)                         → the rung list for a kind ("what will be tried next")
 *   walk(kind, policy, ctx)                         → every decision from a clean start to escalate (checks, previews)
 *   rungOf(attempt | decision)                      → the rung key: strategy[:fixStrategy | :model | :account]
 *
 * Rules, in order (spec → The retry ladder):
 *   1. failures of this kind ≥ maxAttempts, or of every kind ≥ maxTotal → escalate
 *   2. an attempt still open (started, not past attemptTimeoutMin) → the same rung, inFlight
 *   3. inside the backoff after the kind's last failure → the decision carries notBefore
 *   4. the first rung of the kind's ladder not yet used: `retry` up to retrySame times; `switch-model` only to a model at
 *      or under the step's pin not tried for this kind; `switch-account` only to an account not tried for this kind
 *   5. nothing left → escalate
 * A rung an attempt used (any result but skipped) is never used again for the same kind; a hand reset marks attempts
 * skipped (auto-lander resetEscalation), so the ladder starts over.
 */
import { ATTEMPT_FAILURES, FAILURE_KINDS, FIX_STRATEGIES, MODELS, STRATEGIES, normAttempts, normEscalation, normFailure } from './build-pipeline.mjs';

export const SCHEMA = 'retry-ladder@1';
export const DECISION_FRAME = 'retry-decision@1';
export const POLICY_FRAME = 'retry-policy@1';

/** The default rungs per failure kind, first rung first (spec → The retry ladder). */
export const LADDERS = Object.freeze({
  crash: Object.freeze(['retry', 'fresh-session', 'switch-account', 'switch-model', 'escalate']),
  'ci-red': Object.freeze(['fix:targeted', 'fix:regenerate', 'fresh-session', 'switch-model', 'switch-account', 'escalate']),
  clash: Object.freeze(['merge-main', 'fix:targeted', 'fresh-session', 'switch-model', 'escalate']),
  'push-fail': Object.freeze(['retry', 'fresh-session', 'switch-account', 'escalate']),
  stalled: Object.freeze(['fresh-session', 'switch-account', 'switch-model', 'escalate']),
  'fell-to-pending': Object.freeze(['retry', 'fresh-session', 'switch-model', 'switch-account', 'escalate']),
});
export const DEFAULTS = Object.freeze({
  maxAttempts: 5, maxTotal: 10, retrySame: 1, backoff: Object.freeze({ baseMin: 2, factor: 2, maxMin: 30 }), attemptTimeoutMin: 45, stalledAfterMin: 20, ladders: LADDERS, models: MODELS,
});
export const MAX_ATTEMPTS_RANGE = Object.freeze([1, 10]);
export const MAX_TOTAL_RANGE = Object.freeze([1, 30]);
/** Fable sits above Opus: a step pinned Opus never runs on Fable; a step pinned Fable may fall to Opus and come back. */
const RANK = Object.freeze({ Opus: 0, Fable: 1 });

const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const int = (v, d) => (Number.isInteger(v) ? v : d);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const plusMin = (at, min) => new Date(Date.parse(at) + min * 60000).toISOString();
const KIND_WORD = Object.freeze({ crash: 'the session crashed', 'ci-red': 'CI is red', clash: 'it clashes with main', 'push-fail': 'the push failed', stalled: 'it stalled', 'fell-to-pending': 'it fell back to Pending' });
const STRATEGY_WORD = Object.freeze({ retry: 'the same approach again', 'merge-main': 'merging main in', fix: 'a fix session', 'fresh-session': 'a fresh session', 'switch-model': 'another model', 'switch-account': 'another account', escalate: 'escalate' });

// ------------------------------------------------------------------ rungs and policy

/** A rung string is valid: a strategy, or fix:<fixStrategy>. */
export const isRung = (r) => { const [s, x] = str(r, 40).split(':'); return s === 'fix' ? FIX_STRATEGIES.includes(x) : STRATEGIES.includes(s) && !x; };
/** The rung key of an attempt or a decision: strategy, fix:<fixStrategy>, switch-model:<model>, switch-account:<account>. */
export function rungOf(a) {
  const x = obj(a); const s = STRATEGIES.includes(x.strategy) ? x.strategy : 'retry';
  if (s === 'fix') return `fix:${FIX_STRATEGIES.includes(x.fixStrategy) ? x.fixStrategy : 'targeted'}`;
  if (s === 'switch-model' && str(x.model)) return `switch-model:${str(x.model, 20)}`;
  if (s === 'switch-account' && str(x.account)) return `switch-account:${str(x.account, 80)}`;
  return s;
}
const splitRung = (r) => { const [strategy, x = ''] = str(r, 40).split(':'); return { strategy, fixStrategy: strategy === 'fix' ? x : '' }; };

/** The policy, normalised: every field falls back to its default; a ladder that is not a list of rungs ending in escalate falls back too. */
export function normPolicy(p) {
  const x = obj(p); const b = obj(x.backoff); const D = DEFAULTS;
  const ladders = {};
  for (const k of FAILURE_KINDS) {
    const l = Array.isArray(obj(x.ladders)[k]) ? obj(x.ladders)[k].map((r) => str(r, 40)) : null;
    const good = l && l.length && l.every(isRung) && l[l.length - 1] === 'escalate' && l.indexOf('escalate') === l.length - 1;
    ladders[k] = good ? [...l] : [...LADDERS[k]];
  }
  const models = Array.isArray(x.models) ? x.models.filter((m) => MODELS.includes(m)) : [];
  return {
    $axf: POLICY_FRAME, maxAttempts: clamp(int(x.maxAttempts, D.maxAttempts), MAX_ATTEMPTS_RANGE), maxTotal: clamp(int(x.maxTotal, D.maxTotal), MAX_TOTAL_RANGE), retrySame: clamp(int(x.retrySame, D.retrySame), [0, 5]),
    backoff: { baseMin: num(b.baseMin, D.backoff.baseMin), factor: num(b.factor, D.backoff.factor), maxMin: num(b.maxMin, D.backoff.maxMin) },
    attemptTimeoutMin: num(x.attemptTimeoutMin, D.attemptTimeoutMin), stalledAfterMin: num(x.stalledAfterMin, D.stalledAfterMin), ladders, models: models.length ? models : [...D.models],
  };
}
/** Errors in a policy (empty = valid). */
export function policyErrors(p, path = 'policy') {
  const out = []; const x = obj(p); const b = obj(x.backoff);
  if (x.$axf !== undefined && x.$axf !== POLICY_FRAME) out.push(`${path}.$axf is ${POLICY_FRAME}`);
  if (x.maxAttempts !== undefined && (!Number.isInteger(x.maxAttempts) || x.maxAttempts < MAX_ATTEMPTS_RANGE[0] || x.maxAttempts > MAX_ATTEMPTS_RANGE[1])) out.push(`${path}.maxAttempts is ${MAX_ATTEMPTS_RANGE[0]}..${MAX_ATTEMPTS_RANGE[1]}`);
  if (x.maxTotal !== undefined && (!Number.isInteger(x.maxTotal) || x.maxTotal < MAX_TOTAL_RANGE[0] || x.maxTotal > MAX_TOTAL_RANGE[1])) out.push(`${path}.maxTotal is ${MAX_TOTAL_RANGE[0]}..${MAX_TOTAL_RANGE[1]}`);
  if (x.retrySame !== undefined && (!Number.isInteger(x.retrySame) || x.retrySame < 0 || x.retrySame > 5)) out.push(`${path}.retrySame is 0..5`);
  for (const k of ['baseMin', 'factor', 'maxMin']) if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] > 0)) out.push(`${path}.backoff.${k} is a number above 0`);
  for (const k of ['attemptTimeoutMin', 'stalledAfterMin']) if (x[k] !== undefined && !(typeof x[k] === 'number' && x[k] > 0)) out.push(`${path}.${k} is a number above 0`);
  for (const [k, l] of Object.entries(obj(x.ladders))) {
    if (!FAILURE_KINDS.includes(k)) out.push(`${path}.ladders.${k} is not a failure kind`);
    else if (!Array.isArray(l) || !l.length || !l.every(isRung) || l[l.length - 1] !== 'escalate') out.push(`${path}.ladders.${k} is a list of rungs ending in escalate`);
  }
  if (x.models !== undefined && (!Array.isArray(x.models) || !x.models.every((m) => MODELS.includes(m)))) out.push(`${path}.models is a list of ${MODELS.join(' / ')}`);
  return out;
}
/** The rung list for a kind (what the Attempts tab shows as "what will be tried next"). */
export const ladderFor = (kind, policy) => [...(normPolicy(policy).ladders[kind] ?? LADDERS.crash)];

// ------------------------------------------------------------------ counting

/** Minutes to wait after the n-th failure of a kind: min(maxMin, baseMin × factor^(n−1)) (the auto-lander's formula). */
export function backoffMinutes(n, policy) {
  const p = normPolicy(policy); const k = Math.max(1, int(n, 1));
  return Math.min(p.backoff.maxMin, p.backoff.baseMin * p.backoff.factor ** (k - 1));
}
const timedOut = (a, p, at) => a.result === 'started' && !!a.startedAt && (Date.parse(at) - Date.parse(a.startedAt)) / 60000 >= p.attemptTimeoutMin;
/** The attempts that count as failures at `at`: failed, timeout, and a started one past the timeout. */
export const failuresOf = (attempts, kind, policy, at) => normAttempts(attempts).filter((a) => (!kind || a.kind === kind) && (ATTEMPT_FAILURES.includes(a.result) || timedOut(a, normPolicy(policy), at)));
/** The rungs a kind has used (every attempt of the kind but a skipped one). */
export const triedRungs = (attempts, kind) => [...new Set(normAttempts(attempts).filter((a) => a.kind === kind && a.result !== 'skipped').map(rungOf))];

// ------------------------------------------------------------------ decide

const D = (kind, extra, at) => ({
  $axf: DECISION_FRAME, at, kind, n: int(extra.n, 1), strategy: extra.strategy, fixStrategy: extra.fixStrategy || '', model: extra.model || '', account: extra.account || '',
  rung: extra.rung || rungOf(extra), tried: extra.tried || [], notBefore: extra.notBefore || '', inFlight: extra.inFlight === true, escalate: extra.strategy === 'escalate', reason: str(extra.reason, 600),
});
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The next thing the server tries for one build → retry-decision@1.
 *   attempts  the build's attempt@1 records (all kinds)
 *   failure   the open failure ({ kind, why, head, step }); a bare kind string is accepted
 *   policy    retry-policy@1 (the done-means-merged rule's settings)
 *   ctx       { at, pinnedModel, model, account, accounts }: the step's pinned model, the model and account the last run
 *             was on, the accounts that could run the build (same model), in the order to try them
 */
export function nextStrategy(attempts, failure, policy, { at = new Date().toISOString(), pinnedModel = '', model = '', account = '', accounts = [] } = {}) {
  const p = normPolicy(policy);
  const f = normFailure(typeof failure === 'string' ? { kind: failure } : failure) ?? { kind: 'crash', why: '', head: '', step: '' };
  const kind = f.kind; const list = normAttempts(attempts);
  const mine = failuresOf(list, kind, p, at); const n = mine.length + 1; const total = failuresOf(list, '', p, at).length;
  const tried = triedRungs(list, kind);
  const what = `${cap(KIND_WORD[kind])}${f.step ? ` on ${f.step}` : ''}${f.why ? ` (${f.why})` : ''}`;
  const cur = { model: MODELS.includes(model) ? model : '', account: str(account, 80) };

  // 1. the caps
  if (mine.length >= p.maxAttempts) return D(kind, { strategy: 'escalate', n, tried, reason: `${what}: ${mine.length} attempt${mine.length === 1 ? '' : 's'} failed (the limit is ${p.maxAttempts}). Tried ${tried.join(', ') || 'nothing'}. Needs a hand.` }, at);
  if (total >= p.maxTotal) return D(kind, { strategy: 'escalate', n, tried, reason: `${what}: ${total} attempts of every kind failed on this build (the limit is ${p.maxTotal}). Needs a hand.` }, at);

  // 2. an attempt still running
  const open = list.find((a) => a.result === 'started' && !timedOut(a, p, at));
  if (open) return D(kind, { strategy: open.strategy, fixStrategy: open.fixStrategy, model: open.model, account: open.account, n: open.n, tried, inFlight: true, reason: `Attempt ${open.n} (${STRATEGY_WORD[open.strategy]}${open.fixStrategy ? `: ${open.fixStrategy}` : ''}) is still running since ${open.startedAt}.` }, at);

  // 3. backoff after the last failure of this kind
  let notBefore = '';
  const last = mine[mine.length - 1];
  if (last) {
    const since = last.endedAt || (last.startedAt ? plusMin(last.startedAt, p.attemptTimeoutMin) : at);
    const nb = plusMin(since, backoffMinutes(mine.length, p));
    if (Date.parse(at) < Date.parse(nb)) notBefore = nb;
  }

  // 4. the first rung left
  const triedModels = new Set(list.filter((a) => a.kind === kind && a.result !== 'skipped' && a.model).map((a) => a.model));
  const triedAccounts = new Set(list.filter((a) => a.kind === kind && a.result !== 'skipped' && a.account).map((a) => a.account));
  if (cur.model) triedModels.add(cur.model);
  if (cur.account) triedAccounts.add(cur.account);
  const pin = MODELS.includes(pinnedModel) ? pinnedModel : 'Fable';
  for (const rung of p.ladders[kind]) {
    const { strategy, fixStrategy } = splitRung(rung);
    if (strategy === 'escalate') break;
    if (strategy === 'retry') {
      const retries = list.filter((a) => a.kind === kind && a.strategy === 'retry' && a.result !== 'skipped').length;
      if (retries >= p.retrySame) continue;
      return D(kind, { strategy, n, tried, notBefore, ...cur, reason: `${what}: ${STRATEGY_WORD.retry} (attempt ${n} of ${p.maxAttempts})${notBefore ? `, not before ${notBefore}` : ''}.` }, at);
    }
    if (strategy === 'switch-model') {
      const next = p.models.filter((m) => m !== cur.model && !triedModels.has(m) && RANK[m] <= RANK[pin]).sort((a, b) => RANK[b] - RANK[a])[0];
      if (!next) continue;
      return D(kind, { strategy, n, tried, notBefore, model: next, account: cur.account, reason: `${what}: ${STRATEGY_WORD[strategy]} (${next}${pin === next ? ', the step\'s pin' : ', under the step\'s pin'}; attempt ${n} of ${p.maxAttempts})${notBefore ? `, not before ${notBefore}` : ''}.` }, at);
    }
    if (strategy === 'switch-account') {
      const next = (Array.isArray(accounts) ? accounts : []).map((a) => str(a, 80)).find((a) => a && a !== cur.account && !triedAccounts.has(a));
      if (!next) continue;
      return D(kind, { strategy, n, tried, notBefore, model: cur.model, account: next, reason: `${what}: ${STRATEGY_WORD[strategy]} (${next}; attempt ${n} of ${p.maxAttempts})${notBefore ? `, not before ${notBefore}` : ''}.` }, at);
    }
    if (tried.includes(rung)) continue;
    return D(kind, { strategy, fixStrategy, n, tried, notBefore, ...cur, reason: `${what}: ${STRATEGY_WORD[strategy]}${fixStrategy ? ` (${fixStrategy})` : ''} (attempt ${n} of ${p.maxAttempts})${notBefore ? `, not before ${notBefore}` : ''}.` }, at);
  }

  // 5. nothing left
  return D(kind, { strategy: 'escalate', n, tried, reason: `${what}: every rung of the ladder was tried (${tried.join(', ') || 'none left to try'}) and it still fails. Needs a hand.` }, at);
}

/** The escalation record (builds@1 `escalation`, normEscalation's shape) for a decision that said escalate. */
export function escalationOf(attempts, failure, { at = new Date().toISOString(), head = '', policy = {} } = {}) {
  const d = nextStrategy(attempts, failure, policy, { at });
  const f = normFailure(typeof failure === 'string' ? { kind: failure } : failure);
  return normEscalation({ at, kind: d.kind, attempts: failuresOf(attempts, d.kind, policy, at).length, why: d.escalate ? d.reason : `${cap(KIND_WORD[d.kind])}: escalated by hand after ${d.tried.length} tr${d.tried.length === 1 ? 'y' : 'ies'}.`, head: head || f?.head || '', tried: d.tried, bannerId: '', pushedAt: '' });
}

/**
 * Every decision from a clean start to escalate, each try failing (checks and the Attempts tab's preview). The context's
 * model and account follow the switches, as the runner's would.
 */
export function walk(kind, policy = {}, { at = new Date().toISOString(), pinnedModel = 'Fable', model = 'Fable', account = '', accounts = [] } = {}, max = 40) {
  const out = []; let attempts = []; let cur = { model, account };
  for (let i = 0; i < max; i++) {
    const d = nextStrategy(attempts, { kind }, policy, { at, pinnedModel, ...cur, accounts });
    out.push(d);
    if (d.escalate) break;
    attempts = [...attempts, { kind, strategy: d.strategy, fixStrategy: d.fixStrategy, model: d.model, account: d.account, startedAt: at, endedAt: at, result: 'failed', source: 'pipeline' }];
    cur = { model: d.model || cur.model, account: d.account || cur.account };
  }
  return out;
}

/** The snapshot framework/schemas/retry-ladder.json carries, for Python readers and ports. */
export const REGISTRY = Object.freeze({ schema: SCHEMA, decision: DECISION_FRAME, policy: POLICY_FRAME, kinds: FAILURE_KINDS, strategies: STRATEGIES, fixStrategies: FIX_STRATEGIES, ladders: LADDERS, defaults: DEFAULTS, maxAttemptsRange: MAX_ATTEMPTS_RANGE, maxTotalRange: MAX_TOTAL_RANGE, modelRank: RANK });
