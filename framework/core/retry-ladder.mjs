/**
 * retry-ladder@1: the reference engine for automatic fixes. A failed call is retried DIFFERENT ways, not the same call
 * over and over: each failure kind has a ladder of fixes tried in order, each one once. When the last rung has been
 * tried and the call still fails, the job stops, is marked gave-up and Brett gets one AmberX FYI saying what was tried
 * and what is missing. Permanent errors (not found, forbidden, bad input after the schema fix) fail at once.
 *
 * Pure: no IO, no clock (callers pass `now`). The IO runners are framework/cli/retry-runner.mjs (Node) and
 * framework/python/axf_server/retry.py (Python twin, used by the console server and baked into axHub's job runner).
 * Both are checked against framework/spec/fixtures/retry-ladder.json (node framework/spec/check-retry-ladder.mjs).
 *
 * Job record (one JSON file per job in the ledger, see the runners):
 *   { $axf: 'retry-job@1', id, title, source, status: 'retrying'|'fixed'|'gave-up'|'failed', kind, error,
 *     attempts: [{ n, at, kind, fix, step, of, ok, error?, note? }], tried: { <kind>: [fixId] }, missing: [text],
 *     createdAt, updatedAt, fyi? }
 */

export const FORMAT = 'retry-job@1';
/** A hard cap across kinds, so a failure that flips between two kinds still stops. */
export const MAX_ATTEMPTS = 16;

/** Each fix once, in this order. `label` = what it is doing now ("clearing stale lock"), `done` = for the log. */
export const FIXES = {
  wait: { label: 'waiting for the lock', done: 'waited for the lock', delayMs: 2000 },
  'clear-stale-lock': { label: 'clearing stale lock', done: 'cleared a stale lock' },
  'restart-store-writer': { label: 'restarting the store writer', done: 'restarted the store writer' },
  retry: { label: 'retrying', done: 'retried', delayMs: 1000 },
  'wake-console': { label: 'waking the console via AmberX', done: 'asked AmberX to open the console' },
  'other-console': { label: 'sending to another open console', done: 'sent to another open console' },
  'queue-next-console': { label: 'queueing for the next console that opens', done: 'queued for the next console' },
  'refresh-token': { label: 'refreshing the token', done: 'refreshed the token' },
  'next-subscription': { label: 'switching to the next working subscription', done: 'switched subscription' },
  'api-key': { label: 'switching to an API key', done: 'switched to an API key' },
  backoff: { label: 'backing off', done: 'backed off', delayMs: 5000 },
  'other-route': { label: 'retrying on another account or route', done: 'retried on another account or route' },
  'longer-timeout': { label: 'retrying with a longer timeout', done: 'retried with a longer timeout' },
  'background-job': { label: 'running it as a background job', done: 'ran it as a background job' },
  'reload-state': { label: 'reloading state from the server', done: 'reloaded state from the server' },
  'health-check': { label: 'health-checking the service', done: 'health-checked the service' },
  'restart-container': { label: 'restarting the container via Coolify', done: 'restarted the container via Coolify' },
  'internal-address': { label: 'retrying via the internal address', done: 'retried via the internal address' },
  'reread-schema': { label: 're-reading the tool schema and fixing the arguments', done: 're-read the schema and fixed the arguments' },
};

/** Failure kinds and their ladders. `permanent` has none: it fails at once. */
export const KINDS = {
  'store-locked': { label: 'store locked', ladder: ['wait', 'clear-stale-lock', 'restart-store-writer'] },
  'console-asleep': { label: 'console asleep', ladder: ['retry', 'wake-console', 'other-console', 'queue-next-console'] },
  auth: { label: 'login or account limit', ladder: ['refresh-token', 'next-subscription', 'api-key'] },
  'rate-limit': { label: 'rate limit or server error', ladder: ['backoff', 'other-route'] },
  timeout: { label: 'timeout', ladder: ['longer-timeout', 'background-job'] },
  'stale-state': { label: 'stale state', ladder: ['reload-state', 'retry'] },
  'service-down': { label: 'service down', ladder: ['health-check', 'restart-container', 'retry'] },
  network: { label: 'network', ladder: ['retry', 'internal-address'] },
  validation: { label: 'bad arguments', ladder: ['reread-schema'] },
  permanent: { label: 'permanent error', ladder: [] },
};

const has = (s, ...words) => words.some((w) => s.includes(w));

/**
 * The failure kind of an error: { code?, status?, message? } (or a string). Codes first, then HTTP status, then words.
 * Order matters: "store is locked" is store-locked even though "locked" alone means nothing.
 */
export function classify(err) {
  const e = typeof err === 'string' ? { message: err } : (err ?? {});
  const code = String(e.code ?? '').toLowerCase();
  const status = Number(e.status ?? 0) || 0;
  const msg = `${code} ${String(e.message ?? '')}`.toLowerCase();
  if (code === 'store_locked' || has(msg, 'store is locked', 'store locked', 'storelocked', 'database is locked', '.lock)')) return 'store-locked';
  if (has(code, 'no_console', 'console_asleep', 'console_offline', 'not_delivered') || has(msg, 'no console open', 'console is asleep', 'console asleep', 'no open console', 'console disconnected')) return 'console-asleep';
  if (status === 429 || has(code, 'rate_limit', 'rate_limited') || has(msg, 'rate limit', 'too many requests', 'overloaded')) return 'rate-limit';
  if (status === 401 || has(code, 'unauthorized', 'token_expired', 'auth', 'quota', 'usage_limit') || has(msg, 'token expired', 'expired token', 'invalid token', 'login expired', 'not logged in', 'usage limit', 'account limit', 'credit balance')) return 'auth';
  if (status === 408 || status === 504 || has(code, 'timeout', 'timed_out', 'etimedout') || has(msg, 'timed out', 'timeout')) return 'timeout';
  if (has(code, 'enotfound', 'eai_again', 'econnreset', 'ehostunreach', 'enetunreach') || has(msg, 'enotfound', 'eai_again', 'econnreset', 'getaddrinfo', 'name resolution', 'network is unreachable', 'socket hang up', 'name or service not known')) return 'network';
  if (status === 502 || status === 503 || has(code, 'econnrefused', 'service_down', 'unavailable') || has(msg, 'econnrefused', 'connection refused', 'service unavailable', 'bad gateway')) return 'service-down';
  if (status === 409 || has(code, 'stale', 'conflict', 'rev_mismatch') || has(msg, 'stale', 'out of date', 'rev mismatch', 'changed since')) return 'stale-state';
  if (status >= 500) return 'rate-limit';
  if (status === 422 || has(code, 'validation', 'invalid_args', 'invalid_params') || has(msg, 'validation error', 'invalid arguments', 'missing required')) return 'validation';
  return 'permanent';
}

/** Is this error worth any automatic fix at all? */
export const transient = (err) => classify(err) !== 'permanent';

export function newJob({ id, title, source = '', now }) {
  return { $axf: FORMAT, id, title: String(title ?? ''), source: String(source ?? ''), status: 'retrying', kind: '', error: '', attempts: [], tried: {}, missing: [], createdAt: now, updatedAt: now };
}

/** The next fix for this kind that has not been tried yet, or null (ladder done). */
export function nextFix(job, kind) {
  const tried = job.tried?.[kind] ?? [];
  return (KINDS[kind]?.ladder ?? []).find((f) => !tried.includes(f)) ?? null;
}

/**
 * A call failed. Returns { job, next } where next is { fix, step, of, delayMs } (try this fix, then call again) or
 * null (stop: the job is gave-up, or failed for a permanent error; job.fyi holds the one FYI to send).
 */
export function onFailure(job0, err, now) {
  const job = structuredClone(job0);
  const kind = classify(err);
  const message = String((typeof err === 'string' ? err : err?.message) ?? err?.code ?? 'failed').slice(0, 300);
  job.kind = kind; job.error = message; job.updatedAt = now;
  const fix = job.attempts.length >= MAX_ATTEMPTS ? null : nextFix(job, kind);
  if (!fix) {
    job.status = kind === 'permanent' ? 'failed' : 'gave-up';
    job.fyi = fyiText(job);
    return { job, next: null };
  }
  const ladder = KINDS[kind].ladder;
  job.tried[kind] = [...(job.tried[kind] ?? []), fix];
  const step = ladder.indexOf(fix) + 1;
  job.attempts.push({ n: job.attempts.length + 1, at: now, kind, fix, step, of: ladder.length, ok: false, error: message });
  job.status = 'retrying';
  return { job, next: { fix, step, of: ladder.length, delayMs: FIXES[fix].delayMs ?? 0 } };
}

/** A fix could not run here (no handler, or it threw): note what is missing; the ladder moves on to the next rung. */
export function fixUnavailable(job0, fix, why, now) {
  const job = structuredClone(job0);
  const a = [...job.attempts].reverse().find((x) => x.fix === fix);
  if (a) a.note = `not done: ${why}`;
  const line = `${FIXES[fix]?.label ?? fix}: ${why}`;
  if (!job.missing.includes(line)) job.missing.push(line);
  job.updatedAt = now;
  return job;
}

/** The call worked (after `attempts.length` fixes). */
export function onSuccess(job0, now) {
  const job = structuredClone(job0);
  const last = job.attempts[job.attempts.length - 1];
  if (last) last.ok = true;
  job.status = 'fixed'; job.updatedAt = now; job.error = '';
  return job;
}

/** One line for the Auto-fixes list: "store locked: clearing stale lock, step 2 of 3". */
export function stepText(job) {
  const a = job.attempts[job.attempts.length - 1];
  const label = KINDS[job.kind]?.label ?? job.kind;
  if (job.status === 'fixed') return a ? `fixed: ${FIXES[a.fix]?.done ?? a.fix}` : 'worked first time';
  if (job.status === 'failed') return `${label}: not retried (${job.error})`;
  if (job.status === 'gave-up') return `${label}: gave up after ${job.attempts.length} fix${job.attempts.length === 1 ? '' : 'es'}`;
  if (!a) return 'starting';
  return `${KINDS[a.kind]?.label ?? a.kind}: ${FIXES[a.fix]?.label ?? a.fix}, step ${a.step} of ${a.of}`;
}

/** The one FYI for a job that stopped: what failed, what was tried, what is missing. */
export function fyiText(job) {
  const tried = job.attempts.map((a) => FIXES[a.fix]?.done ?? a.fix);
  const head = job.status === 'failed' || job.kind === 'permanent'
    ? `${job.title} failed: ${job.error}. Not retried (a permanent error).`
    : `${job.title} still fails after every automatic fix (${KINDS[job.kind]?.label ?? job.kind}): ${job.error}.`;
  return [head, tried.length ? `Tried: ${tried.join(', ')}.` : '', job.missing.length ? `Missing: ${job.missing.join('; ')}.` : ''].filter(Boolean).join(' ');
}

/** One "Automatic fixes" log line for an attempt. */
export function logLine(job, attempt) {
  return `${job.title}: ${KINDS[attempt.kind]?.label ?? attempt.kind} (${attempt.error}); ${FIXES[attempt.fix]?.label ?? attempt.fix}, step ${attempt.step} of ${attempt.of}${attempt.note ? ` (${attempt.note})` : ''}`;
}

/** The list view: open jobs first (newest change first), then the ones that stopped, with a count for the badge. */
export function view(all, { limit = 100 } = {}) {
  const jobs = all.filter((j) => j.status !== 'dismissed');
  const rank = { retrying: 0, 'gave-up': 1, failed: 2, fixed: 3 };
  const rows = [...jobs].sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((j) => ({ id: j.id, title: j.title, source: j.source, status: j.status, kind: j.kind, error: j.error, now: stepText(j), attempts: j.attempts.length, missing: j.missing, updatedAt: j.updatedAt, note: j.note ?? '' }));
  const count = jobs.filter((j) => j.status === 'retrying' || j.status === 'gave-up').length;
  return { count, retrying: jobs.filter((j) => j.status === 'retrying').length, gaveUp: jobs.filter((j) => j.status === 'gave-up').length, rows };
}
