/**
 * build-clash@1 — which steps and builds would touch the same files. Pure: no IO, no clock unless one is passed.
 *
 * Brett, Nov 23 2026: "when the VPS splits into steps, it needs to make sure that they can all merge cleanly on their
 * own. They can never conflict with each other after they build ... And that goes for adding new builds too ... if it
 * can't start building something that's going to conflict with main, with something that's not merged, then it needs
 * to reject it. The whole build. ... offer solutions and workarounds ... be able to do most of this build while
 * deferring certain steps ... one step may be deferred, waiting for another build, and put what other build it's
 * waiting for."
 *
 * Two rules, both decided from the files each step names (a step that names none cannot be judged and never clashes):
 *   1. inside one build   no two steps share a file. disjointParts() puts every step that shares a file with another,
 *                         directly or through a third, in the same part (one session does them together), so the parts
 *                         never overlap and each merges cleanly alone.
 *   2. between builds     a new build is checked against every build that is not on main yet: building, or built and
 *                         waiting to merge (unmergedBuilds). On a clash the whole build is rejected (clashRecord) with
 *                         a plain reason and two answers: `run-all` (run every step now anyway) or `defer` (run the
 *                         clean steps now; each clashing step waits for the build it clashes with and starts by itself
 *                         once that build has landed: stillDeferred).
 *
 * Stored on the build as `clash`: { rejected, at, reason, with: [ref], options: [{ id, label, line, action, steps:
 * [{ step, uid, title, files, waitsFor: ref }] }], answer?, answeredBy?, answeredAt? } and, after a `defer` answer, on
 * each deferred step as `waitsFor: ref`. ref = { buildId, number, title }.
 *
 * A clash never blocks (Brett, Nov 25 2026: the pipeline "pulls main into the branch, runs a fix session, re-runs
 * checks and carries on by itself"). The record is still made, so the build says what it clashes with, but the
 * pipeline answers it at once (autoAnswer: `run-all`, `auto: true`, answeredBy `pipeline`) and the build takes its
 * turn like any other; a conflict that really shows up when main is pulled in is fixed by a session, never by a
 * person. `run-all` / `defer` stay as answers by hand: a hand answer replaces the pipeline's own (canAnswer), and
 * `defer` then holds back only the steps that have not started.
 */

export const SCHEMA = 'build-clash@1';
export const ANSWERS = Object.freeze(['run-all', 'defer']);
/** Statuses of a Pipeline 2.0 build whose work is not on main yet: from the first main pull to the merge. */
export const UNMERGED = Object.freeze(['pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
/** A build that is over: nothing waits for it any more. */
const OVER = Object.freeze(['landed', 'archived', 'complete', 'built']);

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const normPath = (p) => str(p, 300).trim().replace(/^\.\//, '').replace(/\*.*$/, '').replace(/\/+$/, '');
const paths = (s) => list(s?.files).map(normPath).filter(Boolean);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The paths two file lists share: one path equal to, or inside, the other. → the narrower path of each hit, once. */
export function sharedFiles(a = [], b = []) {
  const out = new Set();
  for (const x of list(a).map(normPath).filter(Boolean)) for (const y of list(b).map(normPath).filter(Boolean)) {
    if (x === y || x.startsWith(`${y}/`)) out.add(x); else if (y.startsWith(`${x}/`)) out.add(y);
  }
  return [...out];
}

/** How another build is named: { buildId, number, title }. */
export const refOf = (b) => ({ buildId: str(b?.id ?? b?.buildId, 80), number: str(b?.number, 24), title: str(b?.title, 300) });
/** "B-0041 (Title)", else the title, else the id. */
export const refName = (r) => (r?.number ? `${r.number}${r.title ? ` (${str(r.title, 80)})` : ''}` : str(r?.title, 80) || str(r?.buildId, 80));

/**
 * Steps into parts that never share a file. Steps stay in order; a part is every step tied to another by a shared file,
 * directly or through a third step, and sits where its first step was. A step with no files is a part of its own.
 * → [[step…]…]
 */
export function disjointParts(steps = []) {
  const rows = list(steps);
  const parent = rows.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < rows.length; i += 1) for (let j = 0; j < i; j += 1) {
    if (sharedFiles(rows[i]?.files, rows[j]?.files).length) { const a = find(i); const b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  }
  const parts = new Map();
  rows.forEach((s, i) => { const k = find(i); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(s); });
  return [...parts.values()];
}

/** Parts joined until none shares a file with another (the same rule, for parts cut some other way). → [[step…]…] */
export function separateParts(parts = []) {
  const out = [];
  for (const p of list(parts).map(list).filter((x) => x.length)) {
    const files = () => p.flatMap(paths);
    let hit = out.findIndex((q) => sharedFiles(q.flatMap(paths), files()).length);
    if (hit < 0) { out.push([...p]); continue; }
    out[hit].push(...p);
    // the joined part may now touch a later one too
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length; i += 1) {
        if (i === hit || !sharedFiles(out[i].flatMap(paths), out[hit].flatMap(paths)).length) continue;
        const lo = Math.min(i, hit); const hi = Math.max(i, hit);
        out[lo].push(...out[hi]); out.splice(hi, 1); hit = lo; again = true; break;
      }
    }
  }
  return out;
}

/** Every pair of steps of one list that still shares a file: [{ a, b, files }] (empty = each merges cleanly alone). */
export function stepOverlaps(steps = []) {
  const rows = list(steps).filter((s) => s && !s.skip);
  const out = [];
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    const files = sharedFiles(rows[i].files, rows[j].files);
    if (files.length) out.push({ a: str(rows[i].id, 40), b: str(rows[j].id, 40), files });
  }
  return out;
}

const beside = (b) => !!(obj(b?.emergency)?.at || obj(b?.hand)?.at);
/** Where a build stands for this rule: its status, or the one it failed at / was archived from. */
const standing = (b) => (b?.status === 'failed' ? str(b.failedFrom, 40) : str(b?.status, 40));

/**
 * Every build that is not on main yet, other than `self`: a Pipeline 2.0 build from its first main pull to its merge
 * (building, or built and waiting to merge; one that failed there too). Deleted, archived and landed builds are out.
 */
export function unmergedBuilds(all = [], self = '') {
  return list(all).filter((b) => b && b.id !== self && !b.deleted && b.flow === 'pipeline-2' && UNMERGED.includes(standing(b)));
}

/**
 * The steps of `build` that share files with a build not yet on main.
 * → [{ step, uid, title, files, with: [{ ...ref, files }] }] (empty = no clash; a build with no files named is never judged)
 */
export function findClashes(build, all = []) {
  const others = unmergedBuilds(all, build?.id);
  const out = [];
  for (const s of list(build?.steps).filter((x) => x && !x.skip && !x.done)) {
    const hits = [];
    for (const o of others) {
      const files = [...new Set(list(o.steps).filter((x) => x && !x.skip).flatMap((x) => sharedFiles(s.files, x.files)))];
      if (files.length) hits.push({ ...refOf(o), files: files.slice(0, 10) });
    }
    if (hits.length) out.push({ step: str(s.id, 40), uid: str(s.uid, 60), title: str(s.title, 200) || str(s.text, 120).split('\n')[0], files: [...new Set(hits.flatMap((h) => h.files))].slice(0, 10), with: hits });
  }
  return out;
}

/**
 * The rejection of a build that clashes with builds not on main yet, or null when it is clean. The whole build is
 * rejected; `options` are what may be done instead. `emergency` and hand builds are never checked by the caller.
 */
export function clashRecord(build, all = [], { at = '' } = {}) {
  const clashes = findClashes(build, all);
  if (!clashes.length) return null;
  const withRefs = [];
  for (const c of clashes) for (const w of c.with) if (!withRefs.some((r) => r.buildId === w.buildId)) withRefs.push({ buildId: w.buildId, number: w.number, title: w.title });
  const total = list(build?.steps).filter((x) => x && !x.skip && !x.done).length;
  const clean = total - clashes.length;
  const files = [...new Set(clashes.flatMap((c) => c.files))];
  const names = withRefs.map(refName).join(', ');
  const reason = `Rejected: ${plural(clashes.length, 'step')} of ${total} ${clashes.length === 1 ? 'touches' : 'touch'} files that ${names} ${withRefs.length === 1 ? 'has' : 'have'} not landed yet (${files.slice(0, 4).join(', ')}${files.length > 4 ? `, +${files.length - 4} more` : ''}).`;
  const deferred = clashes.map((c) => ({ step: c.step, uid: c.uid, title: c.title, files: c.files, waitsFor: { buildId: c.with[0].buildId, number: c.with[0].number, title: c.with[0].title }, ...(c.with.length > 1 ? { alsoWaitsFor: c.with.slice(1).map((w) => ({ buildId: w.buildId, number: w.number, title: w.title })) } : {}) }));
  const options = [
    { id: 'run-all', action: 'run-all', label: 'Run all now', line: `Run every step now. The ${plural(clashes.length, 'clashing step')} may need main pulled in again before ${clashes.length === 1 ? 'it merges' : 'they merge'}.`, steps: [] },
    { id: 'defer', action: 'defer', label: clean > 0 ? `Run ${plural(clean, 'clean step')} now, defer ${clashes.length}` : `Defer ${clashes.length === 1 ? 'the step' : `all ${clashes.length} steps`}`,
      line: deferred.map((d) => `${d.step} waits for ${refName(d.waitsFor)}`).join('; ') + '. Each starts by itself when that build lands.', steps: deferred },
  ];
  return { $axf: SCHEMA, rejected: true, at: str(at, 40), reason, with: withRefs, options };
}

/** The stored clash record in shape, or null. */
export function normClash(c) {
  const x = obj(c); if (!x || !str(x.reason)) return null;
  const ref = (r) => { const o = obj(r); return o && (str(o.buildId) || str(o.number)) ? { buildId: str(o.buildId, 80), number: str(o.number, 24), title: str(o.title, 300) } : null; };
  const step = (d) => { const o = obj(d); if (!o || !str(o.step)) return null; const also = list(o.alsoWaitsFor).map(ref).filter(Boolean); return { step: str(o.step, 40), uid: str(o.uid, 60), title: str(o.title, 200), files: list(o.files).map((f) => str(f, 300)).filter(Boolean).slice(0, 10), waitsFor: ref(o.waitsFor), ...(also.length ? { alsoWaitsFor: also } : {}) }; };
  return {
    $axf: SCHEMA, rejected: x.rejected !== false, at: str(x.at, 40), reason: str(x.reason, 600), with: list(x.with).map(ref).filter(Boolean),
    options: list(x.options).map((o) => (obj(o) && ANSWERS.includes(o.id) ? { id: o.id, action: o.id, label: str(o.label, 120), line: str(o.line, 600), steps: list(o.steps).map(step).filter(Boolean) } : null)).filter(Boolean),
    ...(ANSWERS.includes(x.answer) ? { answer: x.answer, answeredBy: str(x.answeredBy, 80), answeredAt: str(x.answeredAt, 40), ...(x.auto === true ? { auto: true } : {}) } : {}),
  };
}

/** Does the build carry a clash record nobody answered (one written before clashes stopped blocking)? The pipeline answers it itself: autoAnswer. */
export const isRejected = (b) => { const c = obj(b?.clash); return !!c && c.rejected !== false && !ANSWERS.includes(c.answer); };
/** Who answers when nobody does. */
export const AUTO_BY = 'pipeline';
/** May the clash be answered by hand: there is one, and no person answered it yet (the pipeline's own answer may be replaced). */
export const canAnswer = (b) => { const c = normClash(b?.clash); return !!c && (!c.answer || c.auto === true); };

/**
 * The pipeline's own answer, so a clash never waits for a person: `run-all`, marked `auto`. The reason no longer says
 * "Rejected". → { clash }, or null when there is no record or it is answered already.
 */
export function autoAnswer(build, { at = '' } = {}) {
  const c = normClash(build?.clash);
  if (!c || c.answer) return null;
  return { clash: { ...c, reason: c.reason.replace(/^Rejected: /, 'Clash: '), rejected: false, answer: 'run-all', answeredBy: AUTO_BY, answeredAt: str(at, 40), auto: true } };
}

/**
 * The build's clash record after an answer by hand. `run-all`: nothing waits. `defer`: the option's steps are the ones
 * to mark (`waitsFor` on each). The pipeline's own answer (`auto`) may be replaced; a person's stands.
 * → { clash, defer: [{ step, uid, waitsFor, alsoWaitsFor? }] }; throws when there is nothing to answer.
 */
export function answerClash(build, answer, { by = '', at = '' } = {}) {
  const c = normClash(build?.clash);
  if (!c) throw new Error(`${str(build?.id, 80) || 'the build'} has no clash to answer`);
  if (!ANSWERS.includes(answer)) throw new Error(`the answer is one of ${ANSWERS.join(', ')}`);
  if (c.answer && !c.auto) throw new Error(`${str(build?.id, 80)} was already answered: ${c.answer}`);
  const defer = answer === 'defer' ? (c.options.find((o) => o.id === 'defer')?.steps ?? []) : [];
  const { auto: _auto, ...rest } = c;
  return { clash: { ...rest, rejected: false, answer, answeredBy: str(by, 80), answeredAt: str(at, 40) }, defer };
}

/** The builds a deferred step waits for (its `waitsFor`, plus `alsoWaitsFor`). */
export const waitsOf = (step) => [obj(step?.waitsFor), ...list(step?.alsoWaitsFor).map(obj)].filter((r) => r && str(r.buildId));

/**
 * Is this step still deferred: it waits for a build that is neither landed nor gone. Once every build it waits for is
 * on main (or was archived, deleted, or is unknown) it starts like any other step. → the first build it still waits
 * for ({ buildId, number, title }), or null.
 */
export function stillDeferred(step, all = []) {
  for (const r of waitsOf(step)) {
    const b = list(all).find((x) => x && x.id === r.buildId);
    if (b && !b.deleted && !OVER.includes(str(b.status, 40))) return { buildId: b.id, number: str(b.number, 24) || str(r.number, 24), title: str(b.title, 300) || str(r.title, 300) };
  }
  return null;
}
