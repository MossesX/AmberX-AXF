/**
 * builds-journal-core — the pure side of the builds journal's line format (builds-journal@1, framework/spec/BUILDS.md).
 *
 * A journal line used to hold every changed build whole, before and after: one status tick of a build with a 30 KB
 * brief wrote 60 KB+. Now a change to an existing build is stored as a diff (the fields that changed, the steps that
 * changed, list items that were added), with a full copy every FULL_EVERY build revisions and on every add, delete and
 * restore. Readers rebuild the full record by walking a build's lines in order (expandHistory / expandJournal); a
 * diff whose base is missing or whose result does not hash to what the writer saw is reported as `broken`, never
 * guessed. The writer only stores a diff when it knows the base is in the journal (the build's `journalHash`, set by
 * builds-store.mjs saveStore, still matches the record), so a broken diff means journal lines were lost. Old lines
 * (always full) read as before.
 *
 *   full line item   { id, op, rev, before, after }
 *   diff line item   { id, op: 'change', rev, base: <build rev before>, hash: <of after>, diff: { set, unset, append, steps } }
 *
 * No IO here: framework/cli/builds-store.mjs writes and reads the lines, framework/cli/build-hooks.mjs replays them.
 */
import { createHash } from 'node:crypto';

/** A full copy of a build is journalled whenever its rev is a multiple of this (and on add / delete / restore). */
export const FULL_EVERY = 20;

const J = JSON.stringify;
const plain = (v) => (v === undefined ? undefined : JSON.parse(J(v)));
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${J(k)}:${stable(v[k])}`).join(',')}}` : J(v ?? null));
/** A short content hash of a record, independent of key order. */
export const hashOf = (v) => createHash('sha1').update(stable(v)).digest('hex').slice(0, 16);

const stepKey = (s) => (s && typeof s === 'object' ? String(s.uid || s.id || '') : '');
const keyed = (list) => { if (!Array.isArray(list)) return false; const k = list.map(stepKey); return k.every(Boolean) && new Set(k).size === k.length; };

/** What turns build `a` into build `b`: changed fields, removed fields, list items added at the end, changed steps. */
export function diffBuild(a, b) {
  const set = {}; const unset = []; const append = {}; let steps = null;
  const bySteps = keyed(a.steps) && keyed(b.steps);
  for (const k of Object.keys(b)) {
    if (b[k] === undefined || (k === 'steps' && bySteps)) continue;
    if (a[k] === undefined) { set[k] = b[k]; continue; }
    const ja = J(a[k]); if (ja === J(b[k])) continue;
    if (Array.isArray(a[k]) && Array.isArray(b[k]) && b[k].length > a[k].length && J(b[k].slice(0, a[k].length)) === ja) append[k] = b[k].slice(a[k].length);
    else set[k] = b[k];
  }
  for (const k of Object.keys(a)) if (a[k] !== undefined && b[k] === undefined) unset.push(k);
  if (bySteps && J(a.steps) !== J(b.steps)) {
    const old = new Map(a.steps.map((s) => [stepKey(s), J(s)]));
    const order = b.steps.map(stepKey);
    steps = { set: b.steps.filter((s) => old.get(stepKey(s)) !== J(s)), ...(J(order) !== J(a.steps.map(stepKey)) ? { order } : {}) };
  }
  return { ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}), ...(Object.keys(append).length ? { append } : {}), ...(steps ? { steps } : {}) };
}

/** `a` with a diffBuild result applied (a new record; `a` is not changed). */
export function applyDiff(a, d = {}) {
  const out = plain(a) ?? {};
  for (const k of d.unset ?? []) delete out[k];
  for (const [k, v] of Object.entries(d.set ?? {})) out[k] = plain(v);
  for (const [k, v] of Object.entries(d.append ?? {})) out[k] = [...(Array.isArray(out[k]) ? out[k] : []), ...plain(v)];
  if (d.steps) {
    const have = new Map((Array.isArray(out.steps) ? out.steps : []).map((s) => [stepKey(s), s]));
    const order = d.steps.order ?? [...have.keys()];
    for (const s of d.steps.set ?? []) have.set(stepKey(s), plain(s));
    out.steps = order.map((k) => have.get(k)).filter(Boolean);
  }
  return out;
}

const isDiff = (b) => !!b && b.diff !== undefined && b.after === undefined;

/**
 * The line to store for a journal entry: each changed build as a diff where that is safe (an existing build changed,
 * not at a full-copy revision, and the diff provably rebuilds `after`), whole otherwise. The entry itself is not changed.
 */
export function slimEntry(entry, { fullEvery = FULL_EVERY, chained = () => true } = {}) {
  if (!Array.isArray(entry?.builds) || !(fullEvery > 1)) return entry;
  return {
    ...entry,
    builds: entry.builds.map((c) => {
      // `chained(c)`: the writer knows that `before` is exactly what this build's last journal line left (else: whole)
      if (c.op !== 'change' || !c.before || !c.after || !Number.isInteger(c.after.rev) || c.after.rev % fullEvery === 0 || !chained(c)) return c;
      const diff = diffBuild(c.before, c.after); const hash = hashOf(c.after);
      if (hashOf(applyDiff(c.before, diff)) !== hash) return c;
      return { id: c.id, op: c.op, rev: c.rev, base: c.before.rev ?? null, hash, diff };
    }),
  };
}

/**
 * One build's journal items, oldest first → the same items with `before` and `after` rebuilt. `state` carries the
 * build as of the item before. A diff with no base, or one that does not rebuild what the writer saw, comes back as
 * { id, op, rev, before: null, after: null, broken: true } and the walk picks up again at the next full copy.
 */
function expandItem(b, state) {
  if (!isDiff(b)) { if (b.after) state.set(b.id, b.after); else state.delete(b.id); return b; }
  const base = state.get(b.id);
  if (base && (b.base === null || base.rev === b.base)) {
    const after = applyDiff(base, b.diff);
    if (hashOf(after) === b.hash) { state.set(b.id, after); return { id: b.id, op: b.op, rev: b.rev, before: base, after }; }
  }
  state.delete(b.id);
  return { id: b.id, op: b.op, rev: b.rev, before: null, after: null, broken: true };
}
const byRev = (a, b) => (a.rev ?? 0) - (b.rev ?? 0) || String(a.at).localeCompare(String(b.at));

/**
 * Whole journal entries (any order, repeats allowed) → sorted by rev, one per write, every build item full. A write
 * held both whole and as a diff (two copies of the journal written by different versions) counts once, whole.
 */
export function expandJournal(entries, { only = '' } = {}) {
  const seen = new Map();
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const k = `${e.rev}|${e.at}`; const had = seen.get(k);
    if (!had || ((had.builds ?? []).some(isDiff) && !(e.builds ?? []).some(isDiff))) seen.set(k, e);
  }
  const state = new Map();
  return [...seen.values()].sort(byRev).map((e) => (Array.isArray(e.builds) ? { ...e, builds: e.builds.filter((b) => !only || b.id === only).map((b) => expandItem(b, state)) } : e));
}

/** The journal revisions of one build: [{ rev, at, by, action, op, buildRev, after, broken? }], oldest first. */
export function expandHistory(entries, id) {
  const out = [];
  for (const e of expandJournal(entries, { only: id })) for (const b of e.builds ?? []) out.push({ rev: e.rev, at: e.at, by: e.by, action: e.action, op: b.op, buildRev: b.rev, after: b.after, ...(b.broken ? { broken: true } : {}) });
  return out;
}

// ------------------------------------------------------------------ mojibake repair (U+FFFD from a split multi-byte character)

const BAD = '�';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Every string in a record that holds U+FFFD: [{ path: [...keys], value }]. Steps are addressed by uid / id. */
export function damagedStrings(rec, path = []) {
  if (typeof rec === 'string') return rec.includes(BAD) ? [{ path, value: rec }] : [];
  if (Array.isArray(rec)) { const k = keyed(rec); return rec.flatMap((v, i) => damagedStrings(v, [...path, k ? { key: stepKey(v) } : i])); }
  if (rec && typeof rec === 'object') return Object.keys(rec).flatMap((k) => damagedStrings(rec[k], [...path, k]));
  return [];
}
const step = (v, p) => (v === null || v === undefined ? undefined : typeof p === 'object' ? (Array.isArray(v) ? v.find((x) => stepKey(x) === p.key) : undefined) : v[p]);
export const valueAt = (rec, path) => path.reduce(step, rec);
export function setAt(rec, path, value) {
  const parent = valueAt(rec, path.slice(0, -1)); const last = path[path.length - 1];
  if (parent && typeof parent === 'object' && typeof last !== 'object') parent[last] = value;
}
export const pathText = (path) => path.map((p) => (typeof p === 'object' ? `[${p.key}]` : String(p))).join('.');

/**
 * Put back the characters a damaged string lost. Each run of U+FFFD stands for one character; it is looked up in the
 * clean `candidates` (earlier versions of the same string, newest first) by the text right before and after the run,
 * so a string edited since still gets its characters back. → { text, fixed, left } (left = runs with no clean source).
 */
export function repairText(damaged, candidates, { context = 24 } = {}) {
  const clean = candidates.filter((c) => typeof c === 'string' && c && !c.includes(BAD));
  let fixed = 0; let left = 0;
  const parts = damaged.split(/(\uFFFD+)/);
  // the lost character, by the text around it: a long context first, then shorter ones (the text next to the damage
  // may have been edited since); a context that fits more than one different character in a candidate is not used
  const find = (run, lead, tail) => {
    const sizes = [context, Math.ceil(context / 2), Math.ceil(context / 4), Math.ceil(context / 8)];
    for (const [n, m] of sizes.flatMap((x, i) => sizes.slice(0, i + 1).flatMap((y) => (x === y ? [[x, y]] : [[y, x], [x, y]])))) {
      const before = lead.slice(-n); const after = tail.slice(0, m);
      if (before.length + after.length < 4) continue;
      const re = new RegExp(`${esc(before)}([^\\uFFFD]{1,${Math.min(4, run.length)}}?)${esc(after)}`, 'gu');
      for (const c of clean) {
        const found = new Set([...c.matchAll(re)].map((m) => m[1]).filter((x) => /[^\x00-\x7f]/.test(x)));
        if (found.size === 1) return [...found][0];
      }
    }
    return null;
  };
  const out = parts.map((part, i) => {
    if (!part.startsWith(BAD)) return part;
    const ch = find(part, parts[i - 1] ?? '', parts[i + 1] ?? '');
    if (ch === null) { left += 1; return part; }
    fixed += 1; return ch;
  });
  return { text: out.join(''), fixed, left };
}
