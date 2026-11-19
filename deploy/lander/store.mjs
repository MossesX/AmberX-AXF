/**
 * The lander's one seam to the builds store (the single source of truth, Postgres axf-data through
 * framework/cli/builds-store.mjs). The lander keeps no build state of its own: every status it sets is written here as
 * it changes, with `at` and `by`, and read back so a refused write is never silent.
 *
 * Fields the lander writes (Pipeline 2.0 contract; the builds@1 schema itself belongs to p2-status-core):
 *   build  status, statusAt, statusBy, statusLog[{ status, at, by, attempt?, why? }], attempt, failure, pr,
 *          landing { split, merged[pr], closed[pr], reruns { head, n }, rules { head, ok, failing }, ciKick { head, at } }
 *   step   status, prNumber, statusAt, statusBy, statusLog[…]
 *          mergedAt, landed { pr, sha, mergedAt, ci, ciAt } with `landed` (done-means-merged@1 evidence); failedFrom with `failed`
 * applyChange() is pure; makeStore() binds it to the real store, memoryStore() to a list (tests, dry runs).
 */
import * as L from './lander-core.mjs';

const LOG_MAX = 200;
const STEP_LOG_MAX = 50;
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * One change to a build → { build, refused: [why] }. `ch` = { status, group, attempt, failure (null clears), landing
 * (merged into), pr, note, steps: [{ id, status, prNumber }] }. A backward move is refused (forward-only), the rest of
 * the change still applies.
 */
export function applyChange(build, ch = {}, { at = new Date().toISOString(), by = 'lander' } = {}) {
  const b = clone(build || {}); const refused = [];
  const log = (list, entry, max) => [...(Array.isArray(list) ? list : []), entry].slice(-max);
  if (ch.status && ch.status !== b.status) {
    if (L.canMove(b.status, ch.status, { group: ch.group === true })) {
      // pipeline-2@1: a failed build records the status it failed in (failedFrom), so it keeps the one active place and
      // the watchdog and the table see where; it is dropped once the build leaves failed
      if (ch.status === 'failed') b.failedFrom = b.status; else delete b.failedFrom;
      b.status = ch.status; b.statusAt = at; b.statusBy = by;
      b.statusLog = log(b.statusLog, { status: ch.status, at, by, ...(ch.status === 'failed' ? { attempt: ch.attempt ?? b.attempt ?? 0 } : {}), ...(ch.note ? { why: str(ch.note, 300) } : {}) }, LOG_MAX);
      if (ch.status === 'landed') b.landedAt = at;
    } else refused.push(`${b.id}: ${b.status} → ${ch.status} goes back`);
  } else if (ch.status && ch.group === true && ch.status === b.status) {
    b.statusAt = at; b.statusBy = by; b.statusLog = log(b.statusLog, { status: ch.status, at, by, why: str(ch.note || 'next PR', 300) }, LOG_MAX);
  }
  if (ch.attempt !== undefined) b.attempt = Math.max(0, Number(ch.attempt) || 0);
  if (ch.failure !== undefined) { if (ch.failure) b.failure = clone(ch.failure); else delete b.failure; }
  if (ch.landing) b.landing = { ...(b.landing || {}), ...clone(ch.landing) };
  if (ch.pr !== undefined) b.pr = str(ch.pr, 200);
  if (ch.mergedAt) b.mergedAt = str(ch.mergedAt, 40);
  if (ch.landed) b.landed = { ...(b.landed || {}), ...clone(ch.landed) };
  if (ch.note) b.notes = log(b.notes, { text: str(ch.note, 2000), at, by }, 500);
  for (const sc of ch.steps || []) {
    const s = (b.steps || []).find((x) => x.id === sc.id);
    if (!s) { refused.push(`${b.id}: no step ${sc.id}`); continue; }
    if (sc.status && sc.status !== s.status) {
      if (!L.canMoveStep(s.status || 'pending', sc.status)) { refused.push(`${b.id}/${s.id}: ${s.status} → ${sc.status} goes back`); continue; }
    }
    const moved = sc.status && (sc.status !== s.status || (sc.prNumber && Number(sc.prNumber) !== Number(s.prNumber)));
    if (sc.status) s.status = sc.status;
    if (sc.prNumber !== undefined) s.prNumber = Number(sc.prNumber) || null;
    if (moved) { s.statusAt = at; s.statusBy = by; s.statusLog = log(s.statusLog, { status: s.status, at, by, ...(s.prNumber ? { prNumber: s.prNumber } : {}) }, STEP_LOG_MAX); }
  }
  b.updatedAt = at;
  return { build: b, refused };
}

/** Did the store keep what was written? → [what it dropped]. */
export function lost(after, ch) {
  const out = [];
  if (!after) return ['the build is gone'];
  if (ch.status && after.status !== ch.status) out.push(`status ${ch.status} (store has ${after.status})`);
  if (ch.attempt !== undefined && Number(after.attempt || 0) !== Number(ch.attempt)) out.push('attempt');
  for (const sc of ch.steps || []) {
    const s = (after.steps || []).find((x) => x.id === sc.id);
    if (sc.status && s?.status !== sc.status) out.push(`step ${sc.id} status ${sc.status}`);
    if (sc.prNumber && Number(s?.prNumber) !== Number(sc.prNumber)) out.push(`step ${sc.id} prNumber`);
  }
  return out;
}

/** An in-memory store over a list of builds (tests, --dry-run). */
export function memoryStore(builds = [], { by = 'lander', now = () => new Date().toISOString() } = {}) {
  const list = clone(builds);
  return {
    list,
    read: () => clone(list.filter((b) => !b.deleted)),
    write(id, ch) {
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) return { ok: false, why: `no build ${id}`, refused: [] };
      const r = applyChange(list[i], ch, { at: now(), by });
      list[i] = r.build;
      return { ok: !r.refused.length, build: clone(r.build), refused: r.refused, why: r.refused.join('; ') };
    },
  };
}

/**
 * The real builds store (framework/cli/builds-store.mjs: readStoreNow / withStore, one lock, every write journaled and
 * published live). A write the store does not keep (a schema without the lander@1 fields) comes back { ok: false, lost }.
 */
export async function makeStore({ by = 'lander', repo } = {}) {
  const base = repo ? new URL(`file://${repo.replace(/\/?$/, '/')}`) : new URL('../../', import.meta.url);
  const S = await import(new URL('framework/cli/builds-store.mjs', base).href);
  const find = (store, id) => (store?.builds || []).find((b) => b.id === id) || null;
  return {
    read: () => (S.readStoreNow().builds || []).filter((b) => !b.deleted),
    write(id, ch) {
      let refused = []; let missing = false;
      try {
        S.withStore((x) => {
          const i = (x?.builds || []).findIndex((b) => b.id === id); if (i < 0) { missing = true; return x; }
          const r = applyChange(x.builds[i], ch, { by }); refused = r.refused;
          x.builds[i] = r.build; // whole record: a cleared field (failure: null, failedFrom) must go, not linger
          return x;
        }, { by, action: 'lander', note: `${id}${ch.status ? ` → ${ch.status}` : ''}${ch.attempt ? ` (attempt ${ch.attempt})` : ''}` });
      } catch (e) { return { ok: false, why: `store write failed: ${str(e.message, 300)}`, refused }; }
      if (missing) return { ok: false, why: `no build ${id}`, refused };
      const after = find(S.readStoreNow(), id);
      const gone = lost(after, ch);
      return { ok: !refused.length && !gone.length, build: after, refused, lost: gone, why: [...refused, ...(gone.length ? [`the builds store did not keep: ${gone.join(', ')}`] : [])].join('; ') };
    },
  };
}
