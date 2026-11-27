/**
 * build-id@1 — internal build names.
 *
 * A build's id names its worktree folder (<worktrees>/<id>), its branch (claude/<id>), its tmux session and log, and is
 * what axHub's vps.build_start / build_land / build_stop / build_clean take. Those tools accept only
 * ^[a-z0-9][a-z0-9-]{0,39}$, so every new id is at most 40 characters of lowercase letters, digits and dashes, starting
 * with a letter or digit. The title is the display name and is kept separately, with no length limit.
 *
 * Shortening keeps the key words: filler words are dropped first (only when the slug is too long), then the slug is cut
 * at the last dash that fits. A collision gets a numeric suffix (-2, -3, …) inside the same 40 characters.
 *
 * Builds made before this rule may have longer ids. They keep them (branches with open PRs are not renamed) and get a
 * short `alias` that satisfies the pattern; lookups accept either.
 */

export const SCHEMA = 'build-id@1';
export const BUILD_ID_MAX = 40;
export const BUILD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FALLBACK_ID = 'build';

/** Words dropped from an over-long slug. "to" and "out" stay: they carry meaning ("to-do", "take-it-out"). */
export const FILLER = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'into', 'by', 'it', 'its', 'is', 'be', 'so', 'that', 'this', 'as']);

/** True when `id` is a valid internal build name. */
export const isBuildId = (id) => typeof id === 'string' && BUILD_ID_RE.test(id);

/** Lowercase, non-alphanumerics to single dashes, no leading or trailing dash. No length limit. */
export const slugWords = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Cut a slug to at most `max` characters at a dash (mid-word only when its first word alone is longer). */
export function cutAtDash(s, max = BUILD_ID_MAX) {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const at = head.lastIndexOf('-');
  return (at > 0 ? head.slice(0, at) : s.slice(0, max)).replace(/-+$/, '');
}

/** The short id for a title or a long id: at most `max` characters, the key words kept. */
export function shortBuildId(text, max = BUILD_ID_MAX) {
  const full = slugWords(text);
  if (!full) return FALLBACK_ID;
  if (full.length <= max) return full;
  const words = full.split('-');
  const kept = words.filter((w, i) => i === 0 || !FILLER.has(w));
  return cutAtDash(kept.join('-'), max) || FALLBACK_ID;
}

/**
 * A new id that is not in `taken` (a Set, an array or a predicate): the short id, else the short id cut to leave room
 * for "-2", "-3", ….
 */
export function uniqueBuildId(text, taken = new Set()) {
  const has = typeof taken === 'function' ? taken : taken instanceof Set ? (x) => taken.has(x) : (x) => [...taken].includes(x);
  const base = shortBuildId(text);
  if (!has(base)) return base;
  for (let n = 2; n < 100000; n++) {
    const sfx = `-${n}`;
    const id = `${cutAtDash(base, BUILD_ID_MAX - sfx.length) || base.slice(0, BUILD_ID_MAX - sfx.length)}${sfx}`;
    if (!has(id)) return id;
  }
  throw new Error('no free build id');
}

/** Every name a build answers to: its id and, for a legacy long id, its alias. */
export const namesOf = (b) => [b?.id, b?.alias].filter((x) => typeof x === 'string' && x);

/**
 * Aliases for builds whose id is not a valid build name and that have none yet. Returns [{ id, alias }]; an alias never
 * collides with another build's id or alias, nor with one handed out earlier in the same call.
 */
export function planAliases(builds) {
  const list = Array.isArray(builds) ? builds : [];
  const taken = new Set(list.flatMap(namesOf));
  const out = [];
  for (const b of list) {
    if (!b?.id || isBuildId(b.id) || isBuildId(b.alias ?? '')) continue;
    const alias = uniqueBuildId(b.id, taken);
    taken.add(alias); out.push({ id: b.id, alias });
  }
  return out;
}
