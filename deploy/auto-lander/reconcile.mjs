/**
 * reconcile — what happened to a build since the last tick, before decide() runs (auto-lander@1 retry, backoff, re-run
 * and crash resume; framework/spec/AUTO-LANDER.md).
 *
 * The attempt log (attempts.mjs) is the truth: the state document is rebuilt from it every tick, so a runner that died
 * mid-attempt resumes cleanly; this closes what the crash left open. Per open (`started`) attempt:
 *
 *   red-ci   the fix session still runs (live tmux / claude pid / fresh lock) or is still Queued/Running waiting for a
 *            slot → left open (decide waits `in-flight`), until attemptTimeoutMin → `timeout`.
 *            The session ended: the head moved (it pushed) → the attempt stays open until CI on the NEW head is known:
 *            green → `ok`, red → `failed` with the new summary (so a fix that is red again is attempt n+1, and the count
 *            escalates), running/none → still open. The head did not move → `failed` ("ended without pushing").
 *   clash    merge-main runs inside the tick under the lock, so an open one here is a crashed tick → `failed`.
 *   land     merged → `ok` (the tick does it); CI red on the head (the merge queue kicked it) or the PR closed →
 *            `failed`; otherwise open until the timeout.
 *   any      older than attemptTimeoutMin → `timeout` (written to the log, not only counted).
 *
 * Nothing stays blocked without an attempt being scheduled: a backoff wait carries its `notBefore` (decide), and a PR
 * whose head has no CI at all for CI_NONE_KICK_MIN gets CI started once per head (workflow_dispatch, the landing line's
 * workflow), so `ci-none` never waits forever.
 */
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as AL from '../../framework/core/auto-lander.mjs';
import * as attempts from './attempts.mjs';

export const CI_NONE_KICK_MIN = 15;
const kicksFile = () => join(attempts.dataDir(), 'ci-kicks.json');
const readKicks = () => { try { return JSON.parse(readFileSync(kicksFile(), 'utf8')) || {}; } catch { return {}; } };
const writeKicks = (k) => { mkdirSync(attempts.dataDir(), { recursive: true }); writeFileSync(kicksFile(), `${JSON.stringify(k, null, 1)}\n`); };
const minutes = (from, to) => (Date.parse(to) - Date.parse(from)) / 60000;

/** Close or keep the open attempts of one build. Returns the build record (attempts re-read by the caller). */
export async function reconcile(rec, b, snap, d, { policy, at = new Date().toISOString(), dry = false, log = () => {} } = {}) {
  const open = attempts.list(b.id).filter((a) => a.result === 'started');
  const end = (a, result, why) => { log(`${b.id}: ${a.kind} attempt ${a.n} → ${result} (${why})`); if (!dry) attempts.end(a, result, { log: `${a.log ? `${a.log}\n` : ''}${why}`, at, head: snap.head }); };
  for (const a of open) {
    if (AL.timedOut(a, policy, at)) { end(a, 'timeout', `no result after ${policy.attemptTimeoutMin} min`); continue; }
    if (a.kind === 'clash') { end(a, 'failed', 'the runner stopped in the middle of merging main (resumed after a crash)'); continue; }
    if (a.kind === 'land') {
      if (snap.merged) continue; // the tick records the landing
      if (snap.closed) end(a, 'failed', `PR #${snap.number} was closed without merging`);
      else if (snap.ci === 'failure') end(a, 'failed', `CI went red on ${String(snap.head).slice(0, 9)} while landing${snap.summary ? `\n${snap.summary}` : ''}`);
      continue;
    }
    // red-ci: is the fix session still at it?
    let live = false;
    try { live = !!(await d.live?.(b.id))?.live; } catch { live = false; }
    if (live || b.status === 'queued' || b.status === 'running') continue;
    const moved = !!snap.head && (!a.head || snap.head !== a.head);
    if (!moved) { end(a, 'failed', 'the fix session ended without pushing a new head'); continue; }
    if (snap.ci === 'success') end(a, 'ok', `fixed: CI is green on ${snap.head.slice(0, 9)}`);
    else if (snap.ci === 'failure') end(a, 'failed', `the fix pushed ${snap.head.slice(0, 9)} and CI is still red${snap.summary ? `\n${snap.summary}` : ''}`);
    // running / none: wait for the new head's CI (decide says in-flight)
  }
  // CI never started on this head: start it once per head
  if (snap.number && !snap.merged && !snap.closed && snap.ci === 'none' && snap.head && rec.since && minutes(rec.since, at) >= CI_NONE_KICK_MIN && !dry) {
    const k = readKicks();
    if (k[b.id] !== snap.head && d.startCi) {
      try { await d.startCi({ branch: b.branch, head: snap.head }); k[b.id] = snap.head; writeKicks(k); log(`${b.id}: no CI on ${snap.head.slice(0, 9)} for ${CI_NONE_KICK_MIN} min: started it`); }
      catch (e) { log(`${b.id}: could not start CI: ${e.message}`); }
    }
  }
  return rec;
}
