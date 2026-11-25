/**
 * build-split@1 — the split engine: one build cut into as many parallel parts as there are free slots, no two parts
 * on the same file. Pure: no IO, no clock unless one is passed.
 *
 * Brett, Nov 18 2026: "ONE build at a time on the VPS. The splitter breaks it into as many parallel parts as there are
 * free slots (use every slot it possibly can), parts never touch the same files; each part gets its own branch and
 * slot and starts from current main ... When all parts finish they are combined into one branch, one CI run, one
 * landing (all or nothing)." And the gate: "the VPS rejects any build start lacking an orchestrator build ID AND a
 * split ID proving it went through the splitter."
 *
 * How a build is cut (planParts):
 *   1. the steps still to build are taken in order (skipped and done steps are left out);
 *   2. each step's files are its own `files` plus what `fileClaims` adds for it;
 *   3. steps that may not be separated are tied into one group: steps that share a file (one path equal to, or inside,
 *      the other), directly or through a third step, and a step tied to a step it explicitly waits for (`after` /
 *      `dependsOn`): every part starts from the same main, so a step cannot see work done in another part;
 *   4. the groups are dealt into min(free slots, groups) parts, biggest group first onto the lightest part, so every
 *      slot that can be used is used and the parts come out even. Fewer groups than slots = fewer parts, and the plan
 *      says why (`short`): a group is never cut in two to fill a slot;
 *   5. each part gets a number, an id, a branch and one of the free slots; the plan gets its split id.
 * A step that names no files cannot be judged: it is a group of its own and goes wherever the load is lightest.
 *
 * The plan (stored on the build as `splitPlan`, each part's id on its session start):
 *   { schema, splitId, buildId, at, by, wanted, parts: [part], short: { wanted, got, why } | null }
 *   part = { n, id, slot, branch, steps: [stepId], files: [path], minutes }
 *
 * Ids:
 *   split id  `sp-<yyyymmddhhmmss>-<8 hex>`  the stamp is when the split was made; the hex is a digest of the build id,
 *             the stamp and which step went to which part (splitDigest). Anyone holding the plan can recompute it
 *             (provesSplit), so an id that was typed in or carried over from another build or another cut does not pass.
 *   part id   `<split id>.p<n>`              what a part's session start carries (parseSplitId reads either form).
 *   branch    `<build branch>--p<n>`         the build branch is `build.branch`, else `claude/<build id>`.
 *
 * validatePlan(build, plan, { slots, fileClaims }) is the check before anything starts: every step still to build is
 * in exactly one part, no part holds an unknown or settled step, no two parts share a file, no slot or part id is
 * used twice, and the split id is the one this plan gives. gateStart(start, build) is the gate's question for one
 * build start: does it carry the build id and a split id of this build's plan.
 */

import { sharedFiles } from './build-clash.mjs';

export const SCHEMA = 'build-split@1';
export const SPLIT_ID_RE = /^sp-(\d{14})-([0-9a-f]{8})$/;
export const PART_ID_RE = /^(sp-\d{14}-[0-9a-f]{8})\.p([1-9]\d{0,2})$/;
/** Why a plan has fewer parts than free slots. */
export const SHORT_WHY = Object.freeze({ steps: 'steps', files: 'files' });

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const normPath = (p) => str(p, 300).trim().replace(/^\.\//, '').replace(/\*.*$/, '').replace(/\/+$/, '');
const uniq = (a) => [...new Set(a)];
const minutesOf = (s) => (Number.isFinite(Number(s?.minutes)) && Number(s.minutes) > 0 ? Math.round(Number(s.minutes)) : (parseInt(str(s?.estimate), 10) || 0));
const isoOf = (at) => { const t = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(str(at, 40)); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/** The steps a split cuts: the ones still to build, in order (skipped and done steps are out). */
export const openSteps = (build) => list(build?.steps).filter((s) => s && str(s.id, 40) && !s.skip && !s.done);

/**
 * `fileClaims` in one shape: Map(step id → [path]). Accepts { stepId: [path] }, a Map, or [{ step, files }] (`id` and
 * `stepId` are read too). These are files a step will touch beyond the ones it names itself.
 */
export function normClaims(fileClaims) {
  const out = new Map();
  const put = (k, files) => { const id = str(k, 40); const f = list(typeof files === 'string' ? [files] : files).map(normPath).filter(Boolean); if (id && f.length) out.set(id, uniq([...(out.get(id) ?? []), ...f])); };
  if (fileClaims instanceof Map) for (const [k, v] of fileClaims) put(k, v);
  else if (Array.isArray(fileClaims)) for (const c of fileClaims) put(c?.step ?? c?.stepId ?? c?.id, c?.files);
  else if (obj(fileClaims)) for (const [k, v] of Object.entries(fileClaims)) put(k, v);
  return out;
}

/** Every file a step touches: its own `files` and its claims, each path once, in shape. */
export function stepFiles(step, fileClaims) {
  const claims = fileClaims instanceof Map ? fileClaims : normClaims(fileClaims);
  return uniq([...list(step?.files).map(normPath).filter(Boolean), ...(claims.get(str(step?.id, 40)) ?? [])]);
}

/**
 * The free slots in shape: a count (→ '' for each: the dispatcher names the slot later), or a list of slot ids or
 * rows ({ id } / { slot } / { name }; a row marked `free: false` or `busy: true` is left out). A slot named twice counts once.
 */
export function normSlots(freeSlots) {
  if (Array.isArray(freeSlots)) {
    const named = freeSlots.filter((s) => s != null && !(obj(s) && (s.free === false || s.busy === true))).map((s) => str(obj(s) ? (s.id ?? s.slot ?? s.name) : s, 60).trim());
    const seen = new Set();
    return named.filter((s) => (s === '' ? true : seen.has(s) ? false : (seen.add(s), true)));
  }
  const n = Math.floor(Number(obj(freeSlots) ? (freeSlots.free ?? freeSlots.count) : freeSlots));
  return Array.from({ length: Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0 }, () => '');
}

/** The steps a step explicitly waits for (`after`, or `dependsOn`): ids. A step with neither waits for none here. */
const waitsFor = (s) => (Array.isArray(s?.after) ? s.after : list(s?.dependsOn)).map((x) => str(x, 40)).filter(Boolean);

/**
 * Steps into the groups a split may never cut: steps tied by a shared file, or (tieDeps) by an explicit `after` /
 * `dependsOn`, directly or through other steps. Order is kept; a group sits where its first step was.
 * → [{ steps: [step], files: [path], minutes, first }]
 */
export function tiedGroups(steps = [], fileClaims = null, { tieDeps = true } = {}) {
  const rows = list(steps).filter(Boolean);
  const claims = normClaims(fileClaims);
  const files = rows.map((s) => stepFiles(s, claims));
  const parent = rows.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const tie = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let i = 0; i < rows.length; i += 1) for (let j = 0; j < i; j += 1) if (sharedFiles(files[i], files[j]).length) tie(i, j);
  if (tieDeps) {
    const at = new Map(rows.map((s, i) => [str(s.id, 40), i]));
    rows.forEach((s, i) => { for (const id of waitsFor(s)) if (at.has(id) && at.get(id) !== i) tie(i, at.get(id)); });
  }
  const groups = new Map();
  rows.forEach((s, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, { steps: [], files: [], minutes: 0, first: i });
    const g = groups.get(k); g.steps.push(s); g.files.push(...files[i]); g.minutes += minutesOf(s);
  });
  return [...groups.values()].map((g) => ({ ...g, files: uniq(g.files) }));
}

/** FNV-1a (32 bit) of a string → 8 hex. Small and the same everywhere; this is a fingerprint, not a secret. */
export function digest(text) {
  let h = 0x811c9dc5;
  const s = unescape(encodeURIComponent(String(text ?? '')));
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const stampOf = (iso) => iso.replace(/\D/g, '').slice(0, 14);
/** What a split id fingerprints: the build, when it was cut, and which step went to which part (in part order). */
const cutLine = (buildId, stamp, parts) => `${SCHEMA}|${str(buildId, 80)}|${stamp}|${list(parts).map((p) => list(obj(p) ? p.steps : p).map((s) => str(obj(s) ? s.id : s, 40)).join(',')).join('|')}`;

/** The 8 hex of a cut: (build id, stamp, parts as lists of step ids). */
export const splitDigest = (buildId, stamp, parts) => digest(cutLine(buildId, stamp, parts));

/**
 * The split id of a cut made at `at`: `sp-<yyyymmddhhmmss>-<digest>`. '' when the build has no id, there is no time,
 * or there are no parts.
 */
export function makeSplitId(buildId, parts, at) {
  const iso = isoOf(at);
  if (!str(buildId, 80) || !iso || !list(parts).length) return '';
  const stamp = stampOf(iso);
  return `sp-${stamp}-${splitDigest(buildId, stamp, parts)}`;
}

export const isSplitId = (id) => typeof id === 'string' && SPLIT_ID_RE.test(id);
export const isPartId = (id) => typeof id === 'string' && PART_ID_RE.test(id);
/** The id of part `n` of a split. */
export const partId = (splitId, n) => `${str(splitId, 40)}.p${Math.max(1, Math.floor(Number(n)) || 1)}`;
/** The branch of part `n`: `<build branch>--p<n>`. */
export const partBranch = (build, n) => `${str(build?.branch, 200) || `claude/${str(build?.id, 80)}`}--p${Math.max(1, Math.floor(Number(n)) || 1)}`;

/** A split id or a part id read apart → { splitId, part (0 for a split id), stamp, digest, at } or null. */
export function parseSplitId(id) {
  const text = str(id, 60).trim();
  const p = PART_ID_RE.exec(text);
  const m = SPLIT_ID_RE.exec(p ? p[1] : text);
  if (!m) return null;
  const s = m[1];
  return { splitId: m[0], part: p ? Number(p[2]) : 0, stamp: s, digest: m[2], at: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}.000Z` };
}

/** Is `splitId` (or a part id of it) the id this plan gives for this build: right shape, right digest. */
export function provesSplit(splitId, build, plan) {
  const got = parseSplitId(splitId);
  const p = obj(plan);
  const buildId = str(build?.id ?? build, 80);
  if (!got || !p || !buildId || str(p.buildId, 80) !== buildId || p.splitId !== got.splitId) return false;
  if (got.part && !list(p.parts).some((x) => x?.n === got.part)) return false;
  return splitDigest(buildId, got.stamp, p.parts) === got.digest;
}

/**
 * Cut a build into parts for the free slots.
 *   build       { id, branch?, steps: [{ id, files?, after? | dependsOn?, minutes? | estimate?, skip?, done? }] }
 *   freeSlots   how many slots are free, or which (see normSlots)
 *   fileClaims  files steps touch beyond the ones they name (see normClaims)
 *   at          when the split is made (ISO, ms or Date): needed for the split id; by: who made it
 *   tieDeps     false = an explicit `after` no longer keeps two steps in one part
 * → { ok, why, plan }. ok false (plan null) when the build has no id, nothing is left to build, no slot is free or
 *   there is no time. The plan always passes validatePlan for the same build, slots and claims.
 */
export function planParts(build, freeSlots, fileClaims = null, { at = '', by = 'orchestrator', tieDeps = true } = {}) {
  const buildId = str(build?.id, 80);
  const no = (why) => ({ ok: false, why, plan: null });
  if (!buildId) return no('the build has no orchestrator build id');
  const steps = openSteps(build);
  if (!steps.length) return no(list(build?.steps).length ? 'every step is done or skipped: nothing to split' : 'the build has no steps yet');
  const slots = normSlots(freeSlots);
  if (!slots.length) return no('no slot is free');
  const iso = isoOf(at);
  if (!iso) return no('a split needs the time it was made');

  const claims = normClaims(fileClaims);
  const groups = tiedGroups(steps, claims, { tieDeps });
  const count = Math.min(slots.length, groups.length);
  // biggest group first onto the lightest part (minutes, then steps, then the earlier part)
  const bins = Array.from({ length: count }, () => ({ groups: [], minutes: 0, steps: 0 }));
  const dealt = [...groups].sort((a, b) => b.minutes - a.minutes || b.steps.length - a.steps.length || a.first - b.first);
  for (const g of dealt) {
    const bin = bins.reduce((best, x) => (x.minutes < best.minutes || (x.minutes === best.minutes && x.steps < best.steps) ? x : best), bins[0]);
    bin.groups.push(g); bin.minutes += g.minutes; bin.steps += g.steps.length;
  }
  const order = new Map(steps.map((s, i) => [s, i]));
  const cut = bins
    .map((b) => ({ steps: b.groups.flatMap((g) => g.steps).sort((x, y) => order.get(x) - order.get(y)), files: uniq(b.groups.flatMap((g) => g.files)), minutes: b.minutes }))
    .sort((a, b) => order.get(a.steps[0]) - order.get(b.steps[0]));
  const splitId = makeSplitId(buildId, cut, iso);
  const parts = cut.map((p, i) => ({ n: i + 1, id: partId(splitId, i + 1), slot: slots[i], branch: partBranch(build, i + 1), steps: p.steps.map((s) => str(s.id, 40)), files: p.files, minutes: p.minutes }));

  let short = null;
  if (count < slots.length) {
    const why = steps.length < slots.length && groups.length === steps.length ? SHORT_WHY.steps : SHORT_WHY.files;
    short = { wanted: slots.length, got: count, why, line: why === SHORT_WHY.steps
      ? `${plural(slots.length, 'slot')} free, ${plural(steps.length, 'step')} to build: ${plural(count, 'part')}`
      : `${plural(slots.length, 'slot')} free, but the steps only come apart into ${plural(count, 'part')} without two parts touching the same files` };
  }
  return { ok: true, why: '', plan: { schema: SCHEMA, splitId, buildId, at: iso, by: str(by, 80) || 'orchestrator', wanted: slots.length, parts, short } };
}

/** Every pair of parts that shares a file: [{ a, b, files }] (part numbers; empty = no two parts touch the same file). */
export function partOverlaps(build, plan, fileClaims = null) {
  const claims = normClaims(fileClaims);
  const byId = new Map(list(build?.steps).filter(Boolean).map((s) => [str(s.id, 40), s]));
  const parts = list(plan?.parts).map((p) => ({ n: p?.n, files: uniq([...list(p?.files).map(normPath).filter(Boolean), ...list(p?.steps).flatMap((id) => stepFiles(byId.get(str(id, 40)) ?? { id }, claims))]) }));
  const out = [];
  for (let i = 0; i < parts.length; i += 1) for (let j = i + 1; j < parts.length; j += 1) {
    const files = sharedFiles(parts[i].files, parts[j].files);
    if (files.length) out.push({ a: parts[i].n, b: parts[j].n, files });
  }
  return out;
}

/**
 * Check a plan against its build before any part starts → { ok, errors: [{ code, line, ... }] }.
 *   no-plan / schema / build      not a build-split@1 plan of this build
 *   no-parts / part-shape         no parts, or a part without a number, id, branch or steps
 *   split-id                      the split id is not the one this cut gives (shape or digest), or a part id is not its
 *   missing-step                  a step still to build is in no part
 *   repeated-step                 a step is in two parts (or twice in one)
 *   unknown-step / settled-step   a part holds a step the build does not have, or one that is done or skipped
 *   overlap                       two parts touch the same file
 *   tied-steps                    a step and one it explicitly waits for are in different parts (tieDeps)
 *   repeated-slot / repeated-part / repeated-branch   a slot, part id or branch is used twice
 *   too-many-parts                more parts than free slots (only when `slots` is given)
 */
export function validatePlan(build, plan, { slots = null, fileClaims = null, tieDeps = true } = {}) {
  const errors = [];
  const bad = (code, line, more = {}) => errors.push({ code, line, ...more });
  const p = obj(plan);
  if (!p) return { ok: false, errors: [{ code: 'no-plan', line: 'there is no split plan' }] };
  if (p.schema !== SCHEMA) bad('schema', `the plan is not ${SCHEMA}`);
  const buildId = str(build?.id, 80);
  if (!buildId || str(p.buildId, 80) !== buildId) bad('build', `the plan is for ${str(p.buildId, 80) || 'no build'}, not ${buildId || 'a build with an id'}`);
  const parts = list(p.parts);
  if (!parts.length) { bad('no-parts', 'the plan has no parts'); return { ok: false, errors }; }

  const stamp = parseSplitId(p.splitId)?.stamp ?? '';
  if (!isSplitId(p.splitId)) bad('split-id', 'the plan has no valid split id');
  else if (parseSplitId(p.splitId).digest !== splitDigest(buildId, stamp, parts)) bad('split-id', `split id ${p.splitId} does not match this build and these parts`);

  const all = new Map(list(build?.steps).filter(Boolean).map((s) => [str(s.id, 40), s]));
  const open = new Set(openSteps(build).map((s) => str(s.id, 40)));
  const where = new Map();
  const used = { slot: new Map(), part: new Map(), branch: new Map() };
  const once = (kind, value, n) => { if (!value) return; if (used[kind].has(value)) bad(`repeated-${kind}`, `${kind} ${value} is used by part ${used[kind].get(value)} and part ${n}`, { parts: [used[kind].get(value), n] }); else used[kind].set(value, n); };
  parts.forEach((part, i) => {
    const n = part?.n;
    if (!obj(part) || n !== i + 1 || !str(part.branch, 200) || !list(part.steps).length) { bad('part-shape', `part ${i + 1} needs its number, a branch and at least one step`, { part: i + 1 }); if (!obj(part)) return; }
    if (isSplitId(p.splitId) && part.id !== partId(p.splitId, i + 1)) bad('split-id', `part ${i + 1} does not carry part id ${partId(p.splitId, i + 1)}`, { part: i + 1 });
    once('slot', str(part.slot, 60), i + 1); once('part', str(part.id, 60), i + 1); once('branch', str(part.branch, 200), i + 1);
    for (const raw of list(part.steps)) {
      const id = str(raw, 40);
      if (where.has(id)) { bad('repeated-step', where.get(id) === i + 1 ? `step ${id} is in part ${i + 1} twice` : `step ${id} is in part ${where.get(id)} and part ${i + 1}`, { step: id, parts: [where.get(id), i + 1] }); continue; }
      where.set(id, i + 1);
      if (!all.has(id)) bad('unknown-step', `part ${i + 1} holds step ${id}, which the build does not have`, { step: id, part: i + 1 });
      else if (!open.has(id)) bad('settled-step', `part ${i + 1} holds step ${id}, which is already done or skipped`, { step: id, part: i + 1 });
    }
  });
  for (const id of open) if (!where.has(id)) bad('missing-step', `step ${id} is in no part`, { step: id });
  for (const o of partOverlaps(build, p, fileClaims)) bad('overlap', `part ${o.a} and part ${o.b} both touch ${o.files.slice(0, 3).join(', ')}${o.files.length > 3 ? ` and ${o.files.length - 3} more` : ''}`, { parts: [o.a, o.b], files: o.files });
  if (tieDeps) for (const id of open) for (const dep of waitsFor(all.get(id))) {
    if (dep !== id && open.has(dep) && where.has(id) && where.has(dep) && where.get(id) !== where.get(dep)) bad('tied-steps', `step ${id} waits for step ${dep}, which is in part ${where.get(dep)}, not part ${where.get(id)}`, { step: id, after: dep, parts: [where.get(dep), where.get(id)] });
  }
  if (slots != null) { const free = normSlots(slots).length; if (parts.length > free) bad('too-many-parts', `${plural(parts.length, 'part')} for ${plural(free, 'free slot')}`, { parts: parts.length, slots: free }); }
  return { ok: !errors.length, errors };
}

/** The part of a plan a step is in, or the part with this number or part id → the part or null. */
export function partOf(plan, ref) {
  const parts = list(plan?.parts);
  if (typeof ref === 'number') return parts.find((p) => p?.n === ref) ?? null;
  const text = str(ref, 60);
  return parts.find((p) => p?.id === text) ?? parts.find((p) => list(p?.steps).includes(text)) ?? null;
}

/**
 * The gate's question for one build start: { buildId, splitId } (a split id or a part id) against the build it names
 * and that build's stored plan (`build.splitPlan`, or `plan`) → { ok, code, reason, part }.
 *   no-build-id   the start carries no orchestrator build id, or names a build the orchestrator does not have
 *   no-split-id   the start carries no split id
 *   bad-split-id  the split id is not one the splitter makes
 *   not-split     the build has not been through the splitter (no plan)
 *   wrong-split   the split id is not this build's current split (another build's, an older cut, or made up)
 * `reason` is the plain line shown on the Failed tab.
 */
export function gateStart(start, build, { plan = build?.splitPlan } = {}) {
  const no = (code, reason) => ({ ok: false, code, reason, part: null });
  const buildId = str(start?.buildId, 80).trim();
  const splitId = str(start?.splitId, 60).trim();
  if (!buildId) return no('no-build-id', 'Rejected: the start carries no orchestrator build ID.');
  if (!build || str(build.id, 80) !== buildId) return no('no-build-id', `Rejected: ${buildId} is not a build the orchestrator has.`);
  if (!splitId) return no('no-split-id', 'Rejected: the start carries no split ID, so it did not go through the splitter.');
  const got = parseSplitId(splitId);
  if (!got) return no('bad-split-id', `Rejected: ${splitId} is not a split ID the splitter makes.`);
  if (!obj(plan)) return no('not-split', `Rejected: ${buildId} has not been through the splitter.`);
  if (!provesSplit(splitId, build, plan)) return no('wrong-split', `Rejected: split ID ${splitId} is not the current split of ${buildId}.`);
  return { ok: true, code: '', reason: '', part: got.part ? partOf(plan, got.part) : null };
}
