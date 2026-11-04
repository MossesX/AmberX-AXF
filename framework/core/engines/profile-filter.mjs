/**
 * Build profile view filter (profile-filter@1; Brett, Nov 3 2026: "Basically make it a filter. Always just show
 * everything in every build profile, but it just effectively filters to hide them." … "it's gonna act upon what's
 * visible.").
 *
 * Build profiles are a field on every build (builds@1 `profiles`), so a builds view always loads the builds of every
 * profile and this filter only decides what is drawn. One filter is shared by every builds table and by the CLI / MCP
 * bulk commands; it is separate from the *active* profile (where new builds go, framework/cli/profiles.mjs).
 *
 *   { $axf: 'profile-filter@1', all: true,  ids: [] }                every profile (no filter)
 *   { $axf: 'profile-filter@1', all: false, ids: ['current', …] }    only builds in at least one of these profiles
 *
 * Every bulk action (run, merge, approve, land, stop, re-run CI, archive, select all, counts, totals, exports) works on
 * `applyFilter(...).shown` only; hidden builds are never touched. A build that names no profile is always shown, so
 * nothing silently disappears. Pure functions, no I/O: the console (web), the CLI and the server use the same code.
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const PROFILE_FILTER = 'profile-filter@1';
export const ALL_PROFILES = Object.freeze({ $axf: PROFILE_FILTER, all: true, ids: Object.freeze([]) });
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Theme tones a profile chip may use (Chip tones, so every colour comes from the style theme). */
export const PROFILE_TONES = Object.freeze(['accent', 'success', 'warning', 'danger', 'neutral']);

const uniq = (xs) => [...new Set(xs)];

/**
 * Any spelling of a filter → profile-filter@1. Takes 'all' / '' / '*', one id, 'a,b', an id list, or a filter object.
 * With `known` (profile ids), unknown ids are dropped; no id left = all profiles.
 */
export function normalizeFilter(raw, known) {
  let ids;
  if (raw == null || raw === '' || raw === 'all' || raw === '*') return { ...ALL_PROFILES, ids: [] };
  if (typeof raw === 'string') ids = raw.split(',');
  else if (Array.isArray(raw)) ids = raw;
  else if (typeof raw === 'object') { if (raw.all === true) return { ...ALL_PROFILES, ids: [] }; ids = Array.isArray(raw.ids) ? raw.ids : []; }
  else return { ...ALL_PROFILES, ids: [] };
  ids = uniq(ids.map((x) => String(x ?? '').trim().toLowerCase()).filter((x) => ID.test(x) && x !== 'all'));
  if (Array.isArray(known)) ids = ids.filter((x) => known.includes(x));
  return ids.length ? { $axf: PROFILE_FILTER, all: false, ids } : { ...ALL_PROFILES, ids: [] };
}

export const isAll = (f) => !f || f.all === true || !Array.isArray(f.ids) || f.ids.length === 0;

/** The profiles a row belongs to: builds@1 `profiles`, or a single `profile` field (pending items, queue steps …). */
export function itemProfiles(item) {
  if (!item || typeof item !== 'object') return [];
  if (Array.isArray(item.profiles)) return item.profiles.filter((x) => typeof x === 'string');
  return typeof item.profile === 'string' && item.profile ? [item.profile] : [];
}

/** Is this row drawn under the filter? Rows that name no profile always are. */
export function isVisible(item, f, profilesOf = itemProfiles) {
  if (isAll(f)) return true;
  const ps = profilesOf(item);
  return ps.length === 0 || ps.some((p) => f.ids.includes(p));
}

/** Split rows into what is drawn and how many are hidden. Bulk actions take `shown` only. */
export function applyFilter(items, f, profilesOf = itemProfiles) {
  const shown = [];
  let hidden = 0;
  for (const it of items ?? []) { if (isVisible(it, f, profilesOf)) shown.push(it); else hidden += 1; }
  return { shown, hidden, total: shown.length + hidden };
}

/** Rows per profile (a row in two profiles counts in both), for the switcher's counts. */
export function countsByProfile(items, profilesOf = itemProfiles) {
  const out = {};
  for (const it of items ?? []) for (const p of profilesOf(it)) out[p] = (out[p] ?? 0) + 1;
  return out;
}

/** Show only one profile. */
export const onlyProfile = (id) => normalizeFilter([id]);

/** Multi-select: add or take off one profile. Taking off the last one = all profiles; ticking every known one = all. */
export function toggleProfile(f, id, known) {
  const cur = isAll(f) ? [] : f.ids;
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  if (Array.isArray(known) && known.length && known.every((k) => next.includes(k))) return { ...ALL_PROFILES, ids: [] };
  return normalizeFilter(next, known);
}

const nameOf = (id, profiles) => (profiles ?? []).find((p) => p.id === id)?.name || id;

/** 'All profiles' · 'Current' · 'Current + Urgent' · 'Current + 2 more'. */
export function filterLabel(f, profiles) {
  if (isAll(f)) return 'All profiles';
  const names = f.ids.map((id) => nameOf(id, profiles));
  return names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more`;
}

/** The note a filtered view shows ('Filtered: Current · 12 hidden'), or '' when nothing is filtered. */
export function filterNote(f, hidden, profiles) {
  if (isAll(f)) return '';
  return `Filtered: ${filterLabel(f, profiles)} · ${hidden} hidden`;
}

/** A bulk action's button text: 'Merge 5' unfiltered, 'Merge 5 (filtered: Current)' under a filter. */
export function bulkLabel(verb, n, f, profiles) {
  return isAll(f) ? `${verb} ${n}` : `${verb} ${n} (filtered: ${filterLabel(f, profiles)})`;
}

/**
 * What a bulk action's confirm dialog says: which rows it includes (visible ones only) and how many hidden rows it
 * leaves alone. `label` names a row (default its title or id).
 */
export function bulkSummary(verb, items, f, profiles, { label = (x) => x?.title || x?.id || '?', profilesOf = itemProfiles, max = 20 } = {}) {
  const { shown, hidden } = applyFilter(items, f, profilesOf);
  const names = shown.map(label);
  const list = names.slice(0, max).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '');
  const text = `${verb} ${shown.length}${shown.length ? `: ${list}` : ''}.` + (hidden ? ` ${hidden} hidden by the profile filter (${filterLabel(f, profiles)}) stay untouched.` : '');
  return { included: shown, hidden, text, button: bulkLabel(verb, shown.length, f, profiles) };
}

/**
 * The filter a CLI / MCP bulk command uses: an explicit `profiles` argument ('all', 'a,b' or a list) wins over the
 * saved filter (the switcher's), which wins over all profiles.
 */
export function resolveFilter(arg, saved, known) {
  if (arg !== undefined && arg !== null && arg !== '') return normalizeFilter(arg, known);
  return normalizeFilter(saved ?? null, known);
}

/** The query value a filter travels as: 'all' or 'a,b'. */
export const filterQuery = (f) => (isAll(f) ? 'all' : f.ids.join(','));

/** A profile chip's tone: its own `tone`/`color` when it names a theme tone, else one picked from its place in the list. */
export function profileTone(id, profiles, overrides) {
  const o = overrides?.[id];
  if (o && PROFILE_TONES.includes(o)) return o;
  const p = (profiles ?? []).find((x) => x.id === id);
  const own = p?.tone ?? p?.color;
  if (own && PROFILE_TONES.includes(own)) return own;
  const i = Math.max(0, (profiles ?? []).findIndex((x) => x.id === id));
  return PROFILE_TONES[i % PROFILE_TONES.length];
}

/** The profiles a switcher lists: hidden ones out, then the saved order, then the rest in registry order. */
export function orderProfiles(profiles, { hidden = [], order = [] } = {}) {
  const list = (profiles ?? []).filter((p) => !hidden.includes(p.id));
  const rank = (p) => { const i = order.indexOf(p.id); return i < 0 ? order.length + list.indexOf(p) : i; };
  return [...list].sort((a, b) => rank(a) - rank(b));
}
