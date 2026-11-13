/**
 * merge-confirm@1 — a merge is "merged" once GitHub confirms it (pure, IO-free).
 *
 * Build `merges-are-only-merged-once-github-confirms-every-merge-path-console-auto-me` (Nov 13 2026). Every merge path
 * (merge queue, auto-land, console auto-merge, the GitHub plugin's merge action, the server merge gate, deploy and CLI
 * scripts) used to take GitHub's merge API 200 as "merged". That answer is a promise, not proof: the PR was seen open
 * afterwards, and a client timeout on a merge that went through read as a failure. This module is the one state
 * machine every path runs; nothing is merged until `isMerged(record)`.
 *
 *   merge-requested ─called─▶ pending-github-confirmation ─observe─▶ merged | merge-failed
 *                                        └─timeout─▶ merge-unconfirmed ─recheck─▶ pending-github-confirmation
 *
 *   merge-confirm@1 = {
 *     id: '<owner>/<repo>#<pr>', repo, pr, url, path, by, build,
 *     state, label, attempt, rechecks, checks,
 *     requestedAt, calledAt, deadlineAt, nextCheckAt, confirmedAt, endedAt,
 *     call:     { ok, status, merged, sha, message } | null        what the merge API answered: a hint, never evidence
 *     evidence: { state, mergedAt, mergeCommitSha, onMain, mainSha, shaMatch, readAt, missing, error } | null
 *     why, history: [{ at, from, to, why }] }
 *
 * Evidence for `merged` (all four, from the PR read back): state MERGED, merged_at, merge_commit_sha, and that commit
 * reachable from main (the host's compare / ancestry read). Spec: framework/spec/MERGE-CONFIRM.md. Every time comes in
 * through `at`; the module never reads the clock.
 */

export const SCHEMA = 'merge-confirm@1';
export const RECORD = SCHEMA;
export const VERSION = 1;
export const STATES = ['merge-requested', 'pending-github-confirmation', 'merged', 'merge-unconfirmed', 'merge-failed'];
/** States a poller stops at. merge-unconfirmed reopens through `recheck`, and a later read that proves the merge still wins. */
export const TERMINAL = ['merged', 'merge-unconfirmed', 'merge-failed'];
export const LABELS = Object.freeze({
  'merge-requested': 'Merge requested',
  'pending-github-confirmation': 'Pending GitHub confirmation',
  merged: 'Merged',
  'merge-unconfirmed': "GitHub hasn't confirmed",
  'merge-failed': 'Merge failed',
});
export const PENDING_LABEL = LABELS['pending-github-confirmation'];
export const PATHS = ['merge-queue', 'auto-land', 'console-auto-merge', 'github-plugin', 'server-gate', 'script', 'cli', 'reconcile'];
export const EVIDENCE = ['state MERGED', 'merged_at', 'merge_commit_sha', 'merge commit on main'];
export const VERDICTS = ['merged', 'pending', 'not-merged', 'closed', 'unknown'];
/** Seconds between read-backs: the first right after the merge call answers, then 5, 15, 30, 60, and 120 from then on. */
export const BACKOFF_S = [0, 5, 15, 30, 60, 120];
/** No full evidence within this many seconds of the request (or the recheck) = merge-unconfirmed. */
export const TIMEOUT_S = 600;
/** A merge call with no answer for this long is read back as if it had answered "unknown". */
export const CALL_TIMEOUT_S = 120;
/** GitHub's definitive refusals of a merge call: 405 not mergeable, 409 head moved, 422 validation. */
export const REFUSAL_STATUSES = [405, 409, 422];
export const HISTORY_MAX = 40;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const SHA_RE = /^[0-9a-f]{7,40}$/;
export function iso(v) {
  const s = str(v, 40).trim(); if (!s) return '';
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : '';
}
const ms = (v) => { const t = Date.parse(iso(v)); return Number.isFinite(t) ? t : NaN; };
export const addSeconds = (at, s) => { const t = ms(at); return Number.isFinite(t) ? iso(new Date(t + s * 1000).toISOString()) : ''; };
/** `at` is at or after `when` (missing `when` = never reached). */
const reached = (at, when) => Number.isFinite(ms(when)) && Number.isFinite(ms(at)) && ms(at) >= ms(when);
export const normSha = (v) => { const s = str(v, 40).trim().toLowerCase(); return SHA_RE.test(s) ? s : ''; };
export const sameSha = (a, b) => { const x = normSha(a); const y = normSha(b); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)); };
const short = (sha) => normSha(sha).slice(0, 7);
/** 'Owner/Name', 'https://github.com/Owner/Name/pull/5', 'Owner/Name.git' → 'owner/name'; '' when it isn't a repo. */
export function normRepo(v) {
  let s = str(v, 300).trim();
  const m = /github\.com[/:]([^/\s]+\/[^/\s#?]+)/i.exec(s); if (m) s = m[1];
  s = s.replace(/\.git$/i, '').toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9_.-]+$/.test(s) ? s : '';
}
/** A PR number from a number, '532', '#532', a PR URL or { number }; 0 when none. */
export function prNumber(v) {
  if (isObj(v)) return prNumber(v.number ?? v.pr ?? v.url ?? v.html_url);
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : 0;
  const s = str(v, 300).trim();
  const m = s.match(/\/pull\/(\d+)/) || s.match(/#(\d+)/) || s.match(/^(\d+)$/);
  return m ? Number(m[1]) : 0;
}
export const recordId = (repo, pr) => `${normRepo(repo)}#${prNumber(pr)}`;
export const labelOf = (state) => LABELS[state] || '';
export const isTerminal = (state) => TERMINAL.includes(state);
/** The one question every merge path asks. */
export const isMerged = (rec) => isObj(rec) && rec.state === 'merged';
/** Delay before the next read-back after `checks` read-backs so far, in ms. */
export const nextDelayMs = (checks) => BACKOFF_S[Math.max(0, Math.min(Number(checks) || 0, BACKOFF_S.length - 1))] * 1000;

/** The merge API's answer in shape. `null` in = "no answer". */
export function normCall(v) {
  if (v === null || v === undefined) return { ok: false, status: 0, merged: false, sha: '', message: 'no answer' };
  const o = isObj(v) ? v : {};
  const status = Number.isInteger(o.status) ? o.status : Number.isInteger(o.statusCode) ? o.statusCode : 0;
  const merged = o.merged === true;
  const ok = o.ok === true || (o.ok !== false && ((status >= 200 && status < 300) || (merged && !status)));
  return { ok, status, merged, sha: normSha(o.sha), message: str(o.message, 300) };
}
export const refused = (call) => isObj(call) && REFUSAL_STATUSES.includes(call.status);

/**
 * What GitHub says, read back. `prRead`: the REST PR object (`state`, `merged`, `merged_at`, `merge_commit_sha`), a GraphQL
 * node (`state: 'MERGED'`, `mergedAt`, `mergeCommit.oid`) or `{ error: { status, message } }`. `mainRead`: whether the
 * merge commit is on main: a boolean, `{ contains }`, a compare result `{ status: ahead|identical|behind|diverged }`
 * (base = merge commit, head = main), or `{ sha }` of main's head (equal to the merge commit = on main).
 */
export function evidence(prRead, mainRead, at = '', { expectSha = '' } = {}) {
  const readAt = iso(at);
  const p = isObj(prRead) ? prRead : null;
  const e = { state: '', mergedAt: '', mergeCommitSha: '', onMain: null, mainSha: '', shaMatch: null, readAt, missing: [...EVIDENCE], error: '' };
  if (!p) { e.error = 'no PR read'; return e; }
  if (p.error) { const er = isObj(p.error) ? p.error : { message: p.error }; e.error = `${er.status ? `HTTP ${er.status} ` : ''}${str(er.message, 200)}`.trim() || 'read failed'; return e; }
  const st = str(p.state, 20).toUpperCase();
  e.state = p.merged === true || st === 'MERGED' ? 'MERGED' : st === 'CLOSED' ? 'CLOSED' : st === 'OPEN' ? 'OPEN' : '';
  if (!e.state) { e.error = 'PR read has no state'; return e; }
  e.mergedAt = iso(p.merged_at ?? p.mergedAt);
  e.mergeCommitSha = normSha(p.merge_commit_sha ?? p.mergeCommitSha ?? p.mergeCommit?.oid);
  const m = mainRead;
  if (typeof m === 'boolean') e.onMain = m;
  else if (isObj(m)) {
    e.mainSha = normSha(m.sha ?? m.main ?? m.head);
    if (typeof m.contains === 'boolean') e.onMain = m.contains;
    else if (['ahead', 'identical'].includes(str(m.status, 20))) e.onMain = true;
    else if (['behind', 'diverged'].includes(str(m.status, 20))) e.onMain = false;
    else if (e.mainSha && e.mergeCommitSha && sameSha(e.mainSha, e.mergeCommitSha)) e.onMain = true;
  }
  e.shaMatch = normSha(expectSha) && e.mergeCommitSha ? sameSha(expectSha, e.mergeCommitSha) : null;
  e.missing = [];
  if (e.state !== 'MERGED') e.missing.push(EVIDENCE[0]);
  if (!e.mergedAt) e.missing.push(EVIDENCE[1]);
  if (!e.mergeCommitSha) e.missing.push(EVIDENCE[2]);
  if (e.onMain !== true) e.missing.push(EVIDENCE[3]);
  return e;
}
/** merged | pending (MERGED, proof incomplete) | not-merged (open) | closed (closed, never merged) | unknown (read failed). */
export function verdict(e) {
  if (!isObj(e) || e.error || !e.state) return 'unknown';
  if (e.state === 'MERGED') return e.missing.length ? 'pending' : 'merged';
  return e.state === 'CLOSED' ? 'closed' : 'not-merged';
}

function normEvidence(v) {
  if (!isObj(v)) return null;
  const onMain = typeof v.onMain === 'boolean' ? v.onMain : null;
  return { state: ['MERGED', 'OPEN', 'CLOSED'].includes(v.state) ? v.state : '', mergedAt: iso(v.mergedAt), mergeCommitSha: normSha(v.mergeCommitSha), onMain, mainSha: normSha(v.mainSha), shaMatch: typeof v.shaMatch === 'boolean' ? v.shaMatch : null, readAt: iso(v.readAt), missing: (Array.isArray(v.missing) ? v.missing : []).filter((x) => EVIDENCE.includes(x)), error: str(v.error, 300) };
}
const normHistory = (v) => (Array.isArray(v) ? v : []).filter(isObj).map((h) => ({ at: iso(h.at), from: STATES.includes(h.from) ? h.from : '', to: STATES.includes(h.to) ? h.to : '', why: str(h.why, 300) })).slice(-HISTORY_MAX);
const int = (v, min = 0) => (Number.isInteger(v) && v >= min ? v : min);

/** merge-confirm@1 in shape (unknown fields dropped, every field present); null when there is no repo or PR. */
export function normRecord(v) {
  const o = isObj(v) ? v : {};
  const repo = normRepo(o.repo); const pr = prNumber(o.pr);
  if (!repo || !pr) return null;
  const state = STATES.includes(o.state) ? o.state : 'merge-requested';
  return {
    $axf: RECORD, id: recordId(repo, pr), repo, pr, url: str(o.url, 300), path: PATHS.includes(o.path) ? o.path : 'script', by: str(o.by, 120), build: str(o.build, 120),
    state, label: labelOf(state), attempt: int(o.attempt, 1), rechecks: int(o.rechecks), checks: int(o.checks),
    requestedAt: iso(o.requestedAt), calledAt: iso(o.calledAt), deadlineAt: iso(o.deadlineAt), nextCheckAt: iso(o.nextCheckAt), confirmedAt: iso(o.confirmedAt), endedAt: iso(o.endedAt),
    call: o.call === null || o.call === undefined ? null : normCall(o.call), evidence: normEvidence(o.evidence), why: str(o.why, 300), history: normHistory(o.history),
  };
}
/** Field-named errors; `ok` only when every port would accept the record. */
export function validateRecord(v) {
  const o = isObj(v) ? v : {}; const errors = [];
  if (!normRepo(o.repo)) errors.push({ field: 'repo', message: 'repo is missing or not owner/name' });
  if (!prNumber(o.pr)) errors.push({ field: 'pr', message: 'pr is missing or not a PR number' });
  if (!STATES.includes(o.state)) errors.push({ field: 'state', message: `state must be one of ${STATES.join(', ')}` });
  if (o.path !== undefined && !PATHS.includes(o.path)) errors.push({ field: 'path', message: `path must be one of ${PATHS.join(', ')}` });
  if (!iso(o.requestedAt)) errors.push({ field: 'requestedAt', message: 'requestedAt is missing or not a date' });
  if (o.state === 'merged' && (!isObj(o.evidence) || verdict(normEvidence(o.evidence)) !== 'merged')) errors.push({ field: 'evidence', message: 'a merged record needs the full evidence (state MERGED, merged_at, merge_commit_sha, merge commit on main)' });
  return { ok: !errors.length, errors };
}

function transition(rec, to, at, why, extra = {}) {
  const from = rec.state;
  const history = [...rec.history, { at: iso(at), from, to, why: str(why, 300) }].slice(-HISTORY_MAX);
  const next = { ...rec, ...extra, state: to, label: labelOf(to), history };
  if (isTerminal(to)) { next.endedAt = iso(at); next.nextCheckAt = ''; }
  return next;
}

/**
 * A merge path is about to call GitHub's merge API (or, path `reconcile`, has seen a merge it wants proven): write this
 * first. `prev` (the record for the same PR, if any) makes it a new attempt with the history kept; a merged record is
 * left alone. `call` given = the call already answered (`called` is applied at once).
 */
export function request({ repo, pr, path = 'script', by = '', build = '', url = '', at = '', call } = {}, prev = null) {
  const when = iso(at); const r = normRepo(repo); const n = prNumber(pr);
  if (!when || !r || !n) return null;
  const id = recordId(r, n);
  const base = prev ? normRecord(prev) : null;
  const same = !!base && base.id === id;
  if (same && base.state === 'merged') return base;
  const p = PATHS.includes(path) ? path : 'script';
  const attempt = same ? base.attempt + 1 : 1;
  const why = `${p === 'reconcile' ? 'reconcile saw a merge of' : `${p} asked GitHub to merge`} #${n}${attempt > 1 ? ` (attempt ${attempt})` : ''}`;
  const rec = {
    $axf: RECORD, id, repo: r, pr: n, url: str(url, 300) || (same ? base.url : ''), path: p, by: str(by, 120) || (same ? base.by : ''), build: str(build, 120) || (same ? base.build : ''),
    state: 'merge-requested', label: labelOf('merge-requested'), attempt, rechecks: 0, checks: 0,
    requestedAt: when, calledAt: '', deadlineAt: addSeconds(when, TIMEOUT_S), nextCheckAt: '', confirmedAt: '', endedAt: '',
    call: null, evidence: null, why: '', history: [...(same ? base.history : []), { at: when, from: same ? base.state : '', to: 'merge-requested', why }].slice(-HISTORY_MAX),
  };
  return call === undefined ? rec : called(rec, call, when);
}

/** The merge call answered (any answer; `null` = none). Nothing is decided from it: the record goes to pending and is due now. */
export function called(record, call, at) {
  const rec = normRecord(record); const when = iso(at);
  if (!rec || !when || rec.state !== 'merge-requested') return rec;
  const c = normCall(call);
  const why = c.ok ? `merge call answered HTTP ${c.status}${c.sha ? `, sha ${short(c.sha)}` : ''}` : refused(c) ? `GitHub refused the merge (HTTP ${c.status})${c.message ? `: ${c.message}` : ''}` : `merge call did not answer cleanly${c.status ? ` (HTTP ${c.status})` : ''}${c.message ? `: ${c.message}` : ''}`;
  return transition(rec, 'pending-github-confirmation', when, why, { call: c, calledAt: when, nextCheckAt: when, why: c.ok ? '' : why });
}

/** Whether a read-back is due at `at`. */
export function due(record, at) {
  const rec = normRecord(record); if (!rec) return false;
  if (rec.state === 'pending-github-confirmation') return reached(at, rec.nextCheckAt);
  if (rec.state === 'merge-requested') return reached(at, addSeconds(rec.requestedAt, CALL_TIMEOUT_S));
  return false;
}

/**
 * One read-back. `merged` needs the full evidence; a PR closed without a merge, or still open after a refused call, is
 * `merge-failed`; anything else waits with backoff until the deadline, then `merge-unconfirmed`. Merged and failed records
 * never change; an unconfirmed one still becomes merged when a later read proves it.
 */
export function observe(record, prRead, mainRead, at) {
  const rec = normRecord(record); const when = iso(at);
  if (!rec || !when || rec.state === 'merged' || rec.state === 'merge-failed') return rec;
  const e = evidence(prRead, mainRead, when, { expectSha: rec.call?.sha || '' });
  const v = verdict(e);
  const checks = rec.checks + 1;
  const seen = { ...rec, checks, evidence: e };
  if (v === 'merged') {
    const note = e.shaMatch === false ? `; the merge call said ${short(rec.call.sha)}` : '';
    return transition(seen, 'merged', when, `GitHub: MERGED at ${e.mergedAt}, merge commit ${short(e.mergeCommitSha)} on main${note}`, { confirmedAt: when, why: '' });
  }
  if (v === 'closed') return transition(seen, 'merge-failed', when, 'PR closed on GitHub without merging', { why: 'PR closed on GitHub without merging' });
  if (v === 'not-merged' && refused(rec.call)) { const why = `GitHub refused the merge (HTTP ${rec.call.status})${rec.call.message ? `: ${rec.call.message}` : ''}; the PR is still open`; return transition(seen, 'merge-failed', when, why, { why }); }
  const why = v === 'pending' ? `GitHub says merged; merge commit ${short(e.mergeCommitSha) || '?'} not seen on main yet` : v === 'unknown' ? `GitHub read failed: ${e.error}` : 'PR still open on GitHub';
  if (rec.state === 'merge-unconfirmed') return { ...seen, why };
  if (reached(when, rec.deadlineAt)) return transition(seen, 'merge-unconfirmed', when, `no confirmation within ${TIMEOUT_S / 60} min: ${why}`, { why });
  const next = { ...seen, why, nextCheckAt: addSeconds(when, nextDelayMs(checks) / 1000) };
  return rec.state === 'merge-requested' ? transition(next, 'pending-github-confirmation', when, 'read back before the merge call answered') : next;
}

/** Past the deadline with no proof = merge-unconfirmed. Anything else is returned as it is. */
export function timeout(record, at) {
  const rec = normRecord(record); const when = iso(at);
  if (!rec || !when || isTerminal(rec.state) || !reached(when, rec.deadlineAt)) return rec;
  const why = rec.state === 'merge-requested' ? `no answer from the merge call and no read-back within ${TIMEOUT_S / 60} min` : `no confirmation within ${TIMEOUT_S / 60} min${rec.why ? `: ${rec.why}` : ''}`;
  return transition(rec, 'merge-unconfirmed', when, why, { why });
}

/** Ask GitHub again: merge-unconfirmed → pending with a fresh deadline, due now. */
export function recheck(record, at, by = '') {
  const rec = normRecord(record); const when = iso(at);
  if (!rec || !when || rec.state !== 'merge-unconfirmed') return rec;
  return transition(rec, 'pending-github-confirmation', when, `recheck asked${by ? ` by ${str(by, 80)}` : ''}`, { rechecks: rec.rechecks + 1, deadlineAt: addSeconds(when, TIMEOUT_S), nextCheckAt: when, endedAt: '', why: '' });
}

/** Replay a list of ops ({ op: request|called|observe|timeout|recheck, ... }) from nothing; the fixture runner and ports use it. */
export function replay(ops, start = null) {
  let rec = start ? normRecord(start) : null; const trace = [];
  for (const o of Array.isArray(ops) ? ops : []) {
    if (!isObj(o)) continue;
    if (o.op === 'request') rec = request(o, rec);
    else if (o.op === 'called') rec = called(rec, o.call, o.at);
    else if (o.op === 'observe') rec = observe(rec, o.pr, o.main, o.at);
    else if (o.op === 'timeout') rec = timeout(rec, o.at);
    else if (o.op === 'recheck') rec = recheck(rec, o.at, o.by);
    trace.push(rec ? rec.state : null);
  }
  return { record: rec, trace };
}

export const REGISTRY = Object.freeze({ schema: SCHEMA, record: RECORD, version: VERSION, states: STATES, terminal: TERMINAL, labels: LABELS, pendingLabel: PENDING_LABEL, paths: PATHS, evidence: EVIDENCE, verdicts: VERDICTS, backoffS: BACKOFF_S, timeoutS: TIMEOUT_S, callTimeoutS: CALL_TIMEOUT_S, refusalStatuses: REFUSAL_STATUSES, historyMax: HISTORY_MAX });

export function jsonSchemas() {
  return {
    'merge-confirm.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/merge-confirm.schema.json',
      title: 'merge-confirm@1 (one record per merge call; merged only once GitHub confirms)', type: 'object', additionalProperties: false,
      required: ['repo', 'pr', 'state', 'requestedAt'],
      properties: {
        $axf: { const: RECORD }, id: { type: 'string' }, repo: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]*/[a-z0-9_.-]+$' }, pr: { type: 'integer', minimum: 1 }, url: { type: 'string' },
        path: { enum: PATHS }, by: { type: 'string' }, build: { type: 'string' },
        state: { enum: STATES }, label: { enum: Object.values(LABELS) }, attempt: { type: 'integer', minimum: 1 }, rechecks: { type: 'integer', minimum: 0 }, checks: { type: 'integer', minimum: 0 },
        requestedAt: { type: 'string', format: 'date-time' }, calledAt: { type: 'string' }, deadlineAt: { type: 'string' }, nextCheckAt: { type: 'string' }, confirmedAt: { type: 'string' }, endedAt: { type: 'string' },
        call: { type: ['object', 'null'], additionalProperties: false, properties: { ok: { type: 'boolean' }, status: { type: 'integer' }, merged: { type: 'boolean' }, sha: { type: 'string' }, message: { type: 'string' } } },
        evidence: { type: ['object', 'null'], additionalProperties: false, properties: { state: { enum: ['', 'MERGED', 'OPEN', 'CLOSED'] }, mergedAt: { type: 'string' }, mergeCommitSha: { type: 'string' }, onMain: { type: ['boolean', 'null'] }, mainSha: { type: 'string' }, shaMatch: { type: ['boolean', 'null'] }, readAt: { type: 'string' }, missing: { type: 'array', items: { enum: EVIDENCE } }, error: { type: 'string' } } },
        why: { type: 'string' },
        history: { type: 'array', maxItems: HISTORY_MAX, items: { type: 'object', additionalProperties: false, properties: { at: { type: 'string' }, from: { type: 'string' }, to: { enum: STATES }, why: { type: 'string' } } } },
      },
    },
  };
}
