/**
 * Screenshot groups (shot-group@1): pure functions shared by the Screenshots tab, framework/cli/shot.mjs and the tests.
 * No DOM, no fetch, no Node APIs. The server (server/__init__.py) mirrors resolveGroup / autoName / dayKey / merge.
 *
 * A group: { id, name, createdAt, source, session, build, agent, app, note, …unknown fields kept }
 * Every screenshot carries exactly one `group` (a group id). A name given at intake picks the group of that name
 * created the same day (in the console's time zone), else a new group; no name = '<source/session> - <YYYY-MM-DD HH:mm>'.
 */

export const GROUP_SCHEMA = 'shot-group@1';
export const DEFAULT_TZ = 'America/New_York';
const ID_RE = /^g-[a-z0-9-]{4,60}$/;
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export const isGroupId = (v) => typeof v === 'string' && ID_RE.test(v);

/** { y, mo, d, h, mi } of an ISO time in a time zone. */
function parts(at, tz = DEFAULT_TZ) {
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return null;
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  const o = Object.fromEntries(f.formatToParts(t).map((p) => [p.type, p.value]));
  return { y: o.year, mo: o.month, d: o.day, h: o.hour === '24' ? '00' : o.hour, mi: o.minute };
}

/** "2026-10-31" — the day a time falls on in the console's zone (same name + same day = same group). */
export const dayKey = (at, tz = DEFAULT_TZ) => { const p = parts(at, tz); return p ? `${p.y}-${p.mo}-${p.d}` : ''; };
/** "2026-10-31 20:20". */
export const stamp = (at, tz = DEFAULT_TZ) => { const p = parts(at, tz); return p ? `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}` : ''; };
/** Name for shots sent without one: '<source/session> - <YYYY-MM-DD HH:mm>'. */
export const autoName = (by, at, tz = DEFAULT_TZ) => `${str(by, 80) || 'Screenshots'} - ${stamp(at, tz)}`;
/** The friendly default Claude offers when it asks Brett for a name: 'Breakroom check - Oct 31 8:20 PM'. */
export function suggestName(what, at, tz = DEFAULT_TZ) {
  const t = new Date(at);
  let s;
  try { s = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t); }
  catch { s = stamp(at, tz); }
  return `${str(what, 80) || 'Screenshots'} - ${s.replace(',', '').replace(/ /g, ' ')}`;
}

const sameName = (a, b) => str(a, 200).toLowerCase().replace(/\s+/g, ' ') === str(b, 200).toLowerCase().replace(/\s+/g, ' ');

export function newGroupId(at, rand = Math.random) {
  const d = String(at ?? '').slice(0, 10).replace(/-/g, '') || '00000000';
  return `g-${d}-${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0')}`;
}

/** A group, cleaned (unknown fields kept). */
export function normGroup(raw, now = new Date().toISOString()) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const createdAt = str(o.createdAt, 40) || now;
  return {
    ...o, $axf: GROUP_SCHEMA, id: isGroupId(o.id) ? o.id : newGroupId(createdAt), name: str(o.name, 200) || autoName(o.source, createdAt),
    createdAt, source: str(o.source, 40), session: str(o.session, 120), build: str(o.build, 120), agent: str(o.agent, 120),
    app: str(o.app, 80), note: str(o.note, 2000),
  };
}

/**
 * The group a new shot goes in. `name` empty → auto name. Same name (case/space-insensitive) created the same day →
 * that group (created: false); else a new one (created: true). Returns { group, created }. Does not mutate `groups`.
 */
export function resolveGroup(groups, { name = '', source = '', session = '', build = '', agent = '', app = '', note = '' } = {}, at = new Date().toISOString(), tz = DEFAULT_TZ, rand = Math.random) {
  const n = str(name, 200) || autoName(session || build || agent || source, at, tz);
  const day = dayKey(at, tz);
  const hit = (groups ?? []).find((g) => g && sameName(g.name, n) && dayKey(g.createdAt, tz) === day);
  if (hit) return { group: hit, created: false };
  return { group: normGroup({ id: newGroupId(at, rand), name: n, createdAt: at, source, session, build, agent, app, note }, at), created: true };
}

/** Group list rows: count, cover (first shot), newest first. */
export function groupRows(groups, shots) {
  const by = new Map();
  for (const s of shots ?? []) { if (!s?.group) continue; const l = by.get(s.group) ?? []; l.push(s); by.set(s.group, l); }
  return (groups ?? []).map((g) => {
    const list = (by.get(g.id) ?? []).slice().sort((a, b) => String(a.takenAt ?? '').localeCompare(String(b.takenAt ?? '')));
    const apps = [...new Set([g.app, ...list.map((s) => s.app)].filter(Boolean))];
    return { ...g, count: list.length, cover: list[0] ?? null, apps, lastAt: list.length ? list[list.length - 1].takenAt ?? g.createdAt : g.createdAt };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Search a group by name, date (2026-10-31, Oct 31, 10-31), app or source. Words all have to match. */
export function matchGroup(row, q, tz = DEFAULT_TZ) {
  const words = str(q, 200).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = new Date(row.createdAt);
  let human = '';
  try { human = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(t); } catch { /* bad date */ }
  const hay = [row.name, row.source, row.session, row.build, row.agent, row.note, ...(row.apps ?? [row.app]), stamp(row.createdAt, tz), human]
    .filter(Boolean).join(' \u0001 ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Merge group `fromId` into `intoId`: its shots move, it goes. Returns { groups, shots, moved }. */
export function mergeGroups(groups, shots, fromId, intoId) {
  if (fromId === intoId) throw new Error('pick two different groups');
  if (!(groups ?? []).some((g) => g.id === intoId) || !(groups ?? []).some((g) => g.id === fromId)) throw new Error('no such group');
  let moved = 0;
  const out = (shots ?? []).map((s) => (s.group === fromId ? (moved++, { ...s, group: intoId }) : s));
  return { groups: groups.filter((g) => g.id !== fromId), shots: out, moved };
}

/** Move shots (ids) into a group. Returns { shots, moved }. */
export function moveShots(groups, shots, ids, intoId) {
  if (!(groups ?? []).some((g) => g.id === intoId)) throw new Error('no such group');
  const want = new Set(ids ?? []);
  let moved = 0;
  return { shots: (shots ?? []).map((s) => (want.has(s.id) && s.group !== intoId ? (moved++, { ...s, group: intoId }) : s)), moved };
}

export function renameGroup(groups, id, name) {
  const n = str(name, 200);
  if (!n) throw new Error('a name is needed');
  if (!(groups ?? []).some((g) => g.id === id)) throw new Error('no such group');
  return groups.map((g) => (g.id === id ? { ...g, name: n } : g));
}

/**
 * Give every shot a group (migration + repair). Shots without a valid group are bucketed by their title prefix
 * ("Breakroom check: Group chat" → "Breakroom check") or source/session, and day; each bucket becomes
 * '<prefix> - <YYYY-MM-DD HH:mm of its first shot>'. Returns { groups, shots, made: [names] }.
 */
export function assignGroups(groups, shots, tz = DEFAULT_TZ, rand = Math.random) {
  const gs = [...(groups ?? [])];
  const ids = new Set(gs.map((g) => g.id));
  const loose = (shots ?? []).filter((s) => !ids.has(s.group)).sort((a, b) => String(a.takenAt ?? '').localeCompare(String(b.takenAt ?? '')));
  const bucket = new Map();
  for (const s of loose) {
    const m = /^(.{2,80}?)\s*:\s/.exec(str(s.title, 200));
    const label = m ? m[1] : (s.session || s.build || s.agent || s.source || 'Screenshots');
    const key = `${label.toLowerCase()}\u0001${dayKey(s.takenAt, tz)}`;
    if (!bucket.has(key)) bucket.set(key, { label, first: s, ids: new Set() });
    bucket.get(key).ids.add(s.id);
  }
  const made = [];
  const assign = new Map();
  for (const b of bucket.values()) {
    const at = b.first.takenAt || new Date().toISOString();
    const g = normGroup({ id: newGroupId(at, rand), name: `${b.label} - ${stamp(at, tz)}`, createdAt: at, source: b.first.source ?? '', session: b.first.session ?? '', build: b.first.build ?? '', agent: b.first.agent ?? '', app: b.first.app ?? '', note: 'Made when screenshot groups came in.' }, at);
    gs.push(g);
    made.push(g.name);
    for (const id of b.ids) assign.set(id, g.id);
  }
  return { groups: gs, shots: (shots ?? []).map((s) => (assign.has(s.id) ? { ...s, group: assign.get(s.id) } : s)), made };
}
