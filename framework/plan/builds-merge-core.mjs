/**
 * builds-merge-core — merging two copies of the builds store (builds@1) without ever going back in time. Pure, IO-free.
 *
 * Why: since Nov 3 2026 (Brett: "every completed step, no matter how small, must reach the orchestrator and appear on
 * main immediately") every store write is published to main as its own status-only commit (framework/cli/builds-live.mjs),
 * while the session's feature branch keeps its own copy of the same files. Two copies of one store meet in three places:
 *   1. the live publish: this checkout's changed builds go into main's store (fetched seconds ago);
 *   2. the pull after it: main's newer builds come back into this checkout's store;
 *   3. a git merge of a feature branch (the `axf-builds` merge driver, `builds-live.mjs merge-driver`).
 * Each of them is mergeStores(): per build and per step, the NEWER copy wins (updatedAt, then rev, then done), so a
 * stale copy can never undo a step another session ticked, and a status never regresses because a branch merged late.
 *
 * Build status after a merge is derived again from the merged steps (liveStatus): explicit blocked / failed / archived /
 * fixing / escalated stay; all steps done = `landing` until the PR is merged, `landed` once merged (done-means-merged@1;
 * `complete` only through the verify runner).
 */
import { STATUSES, dedupeSteps, normBuild, normalizeStore, stepKey } from './builds-store-core.mjs';
import { mergeOrigin } from '../core/build-origin.mjs';
import { markLine } from '../core/demo-build.mjs';

const str = (v) => (typeof v === 'string' ? v : '');
const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v) => (Number.isInteger(v) ? v : 0);

/** > 0 when a is newer than b. updatedAt first, then rev; a tie is no change. */
export function newer(a, b) {
  const ta = str(a?.updatedAt); const tb = str(b?.updatedAt);
  if (ta !== tb) return ta > tb ? 1 : -1;
  return num(a?.rev) - num(b?.rev);
}

/**
 * The status a build should show from its steps. `built` = every step done but its PR is not merged yet (Brett, Nov 3
 * 2026: built-awaiting-merge until the PR merges, complete once merged). A build without a PR stays complete.
 */
export function liveStatus(b) {
  // done-means-merged@1: fixing, escalated and landed are set by the pipeline / lander with their records; steps never override them
  if (['blocked', 'failed', 'archived', 'fixing', 'escalated'].includes(b.status)) return b.status;
  if (b.status === 'complete' && str(b.mergedAt)) return 'complete'; // its PR merged and verified: done, even with steps left unticked
  if (b.status === 'landed' && str(b.mergedAt)) return 'landed';
  const steps = (b.steps ?? []).filter((s) => !s.skip);
  const settled = ['built', 'landing', 'landed', 'complete'].includes(b.status);
  // a complete record with no PR, no branch and no merge is unprovable (pre-pipeline): left as it is, like migrateDone does
  const unprovable = b.status === 'complete' && !str(b.mergedAt) && !str(b.pr) && !str(b.branch);
  if (!steps.length) return settled && str(b.mergedAt) && b.status !== 'complete' ? 'landed' : settled && !str(b.mergedAt) && !unprovable ? 'landing' : b.status;
  const done = steps.filter((s) => s.done).length;
  // every step done: landed once merged (complete only through the verify), else landing (the auto-lander's), never built
  if (done === steps.length) return str(b.mergedAt) ? 'landed' : unprovable ? 'complete' : 'landing';
  if (!done && settled) return str(b.mergedAt) || unprovable ? b.status : 'landing'; // built without ticking its steps: still not proven merged
  if (b.status === 'waiting') return 'waiting';
  if (b.status === 'queued') return done > 0 ? 'running' : 'queued'; // in the Queue until the dispatcher's session ticks a step
  // a pending build with ticked steps stays pending (paused: nothing is running it); a tick through the Builds page or
  // the orchestrator moves it back to running
  return b.status === 'running' || (done > 0 && b.status !== 'pending') ? 'running' : 'pending';
}

/** Apply liveStatus in place (and builtAt when it turns complete or built). Returns true when it changed. */
export function settleStatus(b, now = new Date().toISOString()) {
  const st = liveStatus(b);
  if (st === b.status || !STATUSES.includes(st)) return false;
  b.status = st;
  const finished = ['complete', 'built', 'landing', 'landed'].includes(st);
  if (finished && !b.builtAt) b.builtAt = now;
  if (!finished) b.builtAt = '';
  return true;
}

/**
 * Merge two copies of one build record. Build-level fields come from the newer copy; steps are merged by uid, each
 * from its newer copy (so session A ticking s2 and session B ticking s3 both survive). Steps only in the newer copy are
 * kept in its order; a step only in the older copy is kept when it was changed after the newer copy was written (added
 * there later), else it was removed in the newer copy and stays removed. Fields only one side has (branch, pr, mergedAt)
 * are never blanked by the other.
 */
export function mergeBuild(a, b) {
  if (!a) return clone(b);
  if (!b) return clone(a);
  const [win, lose] = newer(a, b) >= 0 ? [a, b] : [b, a];
  const out = clone(win);
  const other = new Map(lose.steps.map((s) => [s.uid, s]));
  // step-dedupe: a copy that gave the same step another uid (a re-split, an export without uids) is still that step,
  // matched by its text; without this every merge kept both and the list doubled
  const byText = new Map(); for (const s of lose.steps) { const k = stepKey(s.text); if (k && !byText.has(k)) byText.set(k, s); }
  const matched = new Set();
  let combined = false;
  out.steps = win.steps.map((s) => {
    const o = other.get(s.uid) ?? (() => { const t = byText.get(stepKey(s.text)); return t && !matched.has(t.uid) && !win.steps.some((w) => w.uid === t.uid) ? t : null; })();
    if (!o) return clone(s);
    matched.add(o.uid);
    if (o.uid !== s.uid && o.done && !s.done) { combined = true; return { ...clone(o), id: s.id }; } // the tick survives the uid split
    if (o.uid === s.uid && newer(o, s) > 0) { combined = true; return clone(o); }
    return clone(s);
  });
  const have = new Set(out.steps.map((s) => s.uid));
  lose.steps.forEach((s, i) => { if (!have.has(s.uid) && !matched.has(s.uid) && str(s.createdAt) > str(win.updatedAt)) { combined = true; out.steps.splice(Math.min(i, out.steps.length), 0, clone(s)); } });
  { const d = dedupeSteps(out.steps); if (d.dropped) { out.steps = d.steps; combined = true; } }
  for (const k of ['branch', 'pr', 'mergedAt', 'category', 'priority', 'alias']) if (!str(out[k]) && str(lose[k])) { out[k] = lose[k]; combined = true; }
  // what Brett said that started it: never blanked or replaced by a copy that has less (build-origin@1)
  if (win.origin || lose.origin) { const og = mergeOrigin(win.origin, lose.origin); if (og) out.origin = og; }
  const key = (n) => `${n.at}|${n.text}`;
  const seenNotes = new Set(out.notes.map(key));
  for (const n of lose.notes ?? []) if (!seenNotes.has(key(n))) { out.notes.push(clone(n)); seenNotes.add(key(n)); combined = true; }
  out.rev = Math.max(num(a.rev), num(b.rev));
  // a status set by hand on the newer copy stays; one derived from steps that came from both copies is derived again
  if (combined) settleStatus(out, out.updatedAt);
  return out;
}

/**
 * Merge `ours` into `base` (both builds@1 stores). `ids` limits which of our builds are taken (the live publish takes
 * only the builds this checkout changed; undefined = all). Store-level rules/meta/drafts come from base, with ours
 * filling what base lacks. rev = the higher of the two. Returns { store, taken: [ids changed in base] }.
 */
export function mergeStores(base, ours, { ids } = {}) {
  const s = normalizeStore(clone(base));
  const o = normalizeStore(clone(ours));
  const want = ids ? new Set(ids) : null;
  const taken = [];
  for (const ob of o.builds) {
    if (want && !want.has(ob.id)) continue;
    const i = s.builds.findIndex((x) => x.id === ob.id);
    const cur = i >= 0 ? s.builds[i] : null;
    const m = normBuild(mergeBuild(cur, ob));
    if (cur && JSON.stringify(m) === JSON.stringify(cur)) continue;
    if (i >= 0) s.builds[i] = m; else s.builds.push(m);
    taken.push(ob.id);
  }
  for (const k of ['rules', 'drafts']) for (const [p, v] of Object.entries(o[k] ?? {})) if (!(p in s[k])) s[k][p] = v;
  s.rev = Math.max(num(s.rev), num(o.rev));
  if (str(o.updatedAt) > str(s.updatedAt) && taken.length) s.updatedAt = o.updatedAt;
  if (!s.migratedAt) s.migratedAt = o.migratedAt;
  return { store: s, taken };
}

/** Three-way form for the git merge driver: the common ancestor only decides nothing — newer always wins. */
export function mergeStoreFiles(oursText, theirsText) {
  const ours = JSON.parse(oursText); const theirs = JSON.parse(theirsText);
  return mergeStores(theirs, ours).store;
}

/** orchestrator@1 exports (read-only projections): builds merged by id with the same newer-wins rule. */
export function mergeOrchestratorDocs(a, b) {
  const out = clone(newer(a, b) >= 0 ? a : b);
  const other = newer(a, b) >= 0 ? b : a;
  const byId = new Map(out.builds.map((x, i) => [x.id, i]));
  for (const x of other.builds ?? []) {
    const i = byId.get(x.id);
    if (i === undefined) out.builds.push(clone(x));
    else { const m = mergeBuild({ notes: [], ...out.builds[i] }, { notes: [], ...x }); out.builds[i] = m; }
  }
  return out;
}

/**
 * Journal files are <YYYY-MM>.jsonl, then <YYYY-MM>-p2.jsonl, -p3… : GitHub refuses a file over 100 MiB, and one refused
 * push stops every status commit, so a month rolls into a new part well before that. A full part is never rewritten.
 */
export const JOURNAL_PART_BYTES = 80 * 1024 * 1024;
const partKey = (month, n) => (n === 1 ? month : `${month}-p${n}`);
/** Which journal file takes `add` more bytes this month. `sizes` = { fileKey: bytes } of every journal file there. */
export function journalPart(month, sizes, add = 0, max = JOURNAL_PART_BYTES) {
  const parts = Object.keys(sizes).map((k) => (k === month ? 1 : k.startsWith(`${month}-p`) ? Number(k.slice(month.length + 2)) : 0)).filter((n) => Number.isInteger(n) && n > 0);
  const last = parts.length ? Math.max(...parts) : 1;
  const size = sizes[partKey(month, last)] ?? 0;
  return partKey(month, size > 0 && size + add > max ? last + 1 : last);
}

/** Journal files (JSON lines, append-only): the first text as it is, then every line of the others it lacks, in order. */
export function mergeJournalText(...texts) {
  const seen = new Set(); const lines = [];
  for (const t of texts) for (const l of str(t).split('\n')) { if (!l.trim() || seen.has(l)) continue; seen.add(l); lines.push(l); }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** One line per live change for the threads log: when, build, what changed, profile, who. */
export function changeLines(entry) {
  const out = [];
  const when = str(entry?.at).slice(0, 16).replace('T', ' ');
  for (const c of entry?.builds ?? []) {
    const a = c.after; const b = c.before;
    if (!a) continue;
    const what = [];
    if (!b) what.push(`added (${a.steps?.length ?? 0} steps)`);
    else {
      const old = new Map((b.steps ?? []).map((s) => [s.uid, s]));
      for (const s of a.steps ?? []) { const o = old.get(s.uid); if (o && o.done !== s.done) what.push(`${s.id} ${s.done ? 'done' : 'undone'}`); }
      if (a.status !== b.status) what.push(`→ ${a.status}`);
      if (str(a.branch) !== str(b.branch) && a.branch) what.push(`branch ${a.branch}`);
      if (str(a.pr) !== str(b.pr) && a.pr) what.push(`PR ${a.pr}`);
      if (str(a.mergedAt) !== str(b.mergedAt) && a.mergedAt) what.push('merged');
      if ((a.notes?.length ?? 0) > (b.notes?.length ?? 0)) what.push('note');
      if (a.deleted && !b.deleted) what.push('removed');
    }
    if (!what.length) continue;
    // demo-build@1: a demo build's line carries the mark, so the builds-live commit says demo-only on main
    out.push(`- ${when} UTC · ${markLine(c.id, `\`${c.id}\` ${what.join(', ')}`)} (${(a.profiles ?? []).join(', ')}) · ${str(entry.by) || 'cli'}`);
  }
  return out;
}
