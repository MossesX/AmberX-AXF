/**
 * build-renames@1 — a build moved to a new internal id. Pure, IO-free.
 *
 * A build's id names its worktree folder, its branch (claude/<id>), its tmux session and its report; axHub's
 * vps.build_land / build_stop / build_clean accept only ids matching ^[a-z0-9][a-z0-9-]{0,39}$. Builds filed before
 * that limit can be moved to a short id. The move keeps everything a later lookup needs:
 *
 *   _claude/builds/renames.json   { "<old id>": "<new id>", … }   every old id still resolves (resolveRename)
 *   the store                     a new record under the new id (same title, steps, notes, origin), and the old record
 *                                 soft-deleted with a note naming the new id and no steps (they moved, uid and all). The
 *                                 old record stays a tombstone so a
 *                                 stale copy of it elsewhere (an older checkout's store) can never bring it back: the
 *                                 newer-wins merge keeps the tombstone.
 *
 * The title is the display name and is never changed by a rename.
 */

export const SCHEMA = 'build-renames@1';
export const RENAMED_NOTE = 'Renamed to';

export const ID_MAX = 40;
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Words dropped from an over-long id before it is cut ("to" and "out" carry meaning: "to-do", "take-it-out"). */
export const FILLER = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'into', 'by', 'it', 'its', 'is', 'be', 'so', 'that', 'this', 'as']);

const str = (v) => (typeof v === 'string' ? v : '');
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Cut at the last dash that fits in `max` characters. */
function cutAtDash(s, max) {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1); const at = head.lastIndexOf('-');
  return (at > 0 ? head.slice(0, at) : s.slice(0, max)).replace(/-+$/, '');
}

/**
 * A short id for a long one: filler words dropped (never the first word), cut at a dash to 40 characters, then -2, -3 …
 * (still inside 40) while `taken(id)` says it is used. Ids that already fit are returned as they are.
 */
export function shortId(id, taken = () => false) {
  const slug = str(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'build';
  const base = slug.length <= ID_MAX ? slug : cutAtDash(slug.split('-').filter((w, i) => i === 0 || !FILLER.has(w)).join('-'), ID_MAX);
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) { const sfx = `-${n}`; const c = `${cutAtDash(base, ID_MAX - sfx.length)}${sfx}`; if (!taken(c)) return c; }
  throw new Error(`no free short id for "${id}"`);
}

/** { old: new } with only string pairs, old ≠ new. Anything else in the file is ignored. */
export function normRenames(map) {
  const out = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [from, to] of Object.entries(map)) if (str(to) && from !== to && !from.startsWith('$')) out[from] = to;
  return out;
}

/** The current id for `id`: follows a chain of renames (a → b → c); unknown ids come back unchanged. */
export function resolveRename(map, id) {
  const m = normRenames(map);
  let cur = str(id); const seen = new Set();
  while (m[cur] && !seen.has(cur)) { seen.add(cur); cur = m[cur]; }
  return cur;
}

/** Every old id that now resolves to `id`. */
export const formerIds = (map, id) => Object.keys(normRenames(map)).filter((k) => k !== id && resolveRename(map, k) === id);

/** The map with `from → to` added; earlier renames that pointed at `from` now point at `to` too. */
export function addRename(map, from, to) {
  const out = normRenames(map);
  if (!str(from) || !str(to) || from === to) throw new Error('a rename needs two different ids');
  if (out[to]) throw new Error(`"${to}" was itself renamed to "${out[to]}"`);
  for (const k of Object.keys(out)) if (out[k] === from) out[k] = to;
  out[from] = to;
  return out;
}

/** The text of renames.json: keys sorted, one pair per line. */
export const renamesText = (map) => {
  const m = normRenames(map);
  return `${JSON.stringify(Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]])), null, 1)}\n`;
};

/**
 * Move one build record in a builds@1 store (in place) from `from` to `to`.
 * `branch` / `pr` replace the record's (default: claude/<to> when the branch was claude/<from>; the PR is kept).
 * Returns { record, tombstone }. Throws when `from` is missing or `to` is already taken.
 */
export function renameInStore(store, from, to, { branch, pr, at = new Date().toISOString(), by = 'build-rename' } = {}) {
  const builds = store?.builds;
  if (!Array.isArray(builds)) throw new Error('not a builds store');
  const old = builds.find((b) => b.id === from && !b.deleted) ?? builds.find((b) => b.id === from);
  if (!old) throw new Error(`no build "${from}"`);
  if (builds.some((b) => b.id === to)) throw new Error(`"${to}" is already a build`);
  const rec = clone(old);
  rec.id = to;
  rec.branch = typeof branch === 'string' ? branch : str(old.branch) === `claude/${from}` ? `claude/${to}` : str(old.branch);
  if (typeof pr === 'string') rec.pr = pr;
  if (str(old.pendingId) === from) rec.pendingId = to; // Pending builds lists it by this id
  rec.updatedAt = at;
  rec.notes = [...(rec.notes ?? []), { text: `Renamed from ${from} (build names are at most 40 characters). By ${by}.`, at }];
  builds.splice(builds.indexOf(old), 0, rec);
  old.deleted = true; old.deletedAt = at; old.hidden = true; old.updatedAt = at;
  old.steps = []; old.defaultSteps = []; old.removedSteps = []; // step uids are unique across the store: they moved with the record
  old.notes = [...(old.notes ?? []), { text: `${RENAMED_NOTE} ${to}: this record is kept as a tombstone, use ${to}.`, at }];
  return { record: rec, tombstone: old };
}
