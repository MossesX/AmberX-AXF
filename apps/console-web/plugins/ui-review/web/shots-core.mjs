/**
 * UI Review → Screenshots (ui-screenshot@1), the pure part: shared by the page, the CLI (shots.mjs, framework/cli/shot.mjs)
 * and the tests; the server's screenshots.py mirrors normShot / migrateItems.
 *
 * A screenshot is a picture someone took for its own sake (a check session looking at a screen, a live capture, PR
 * before/after, Brett's own upload). It never enters the approve / reject queue; "Send to review" copies one into it.
 */

export const SCHEMA = 'ui-screenshot@1';
export const SOURCES = [
  { id: 'check', label: 'Check', icon: 'eye' },
  { id: 'build', label: 'Build', icon: 'hammer' },
  { id: 'pr', label: 'PR', icon: 'branch' },
  { id: 'manual', label: 'Upload', icon: 'upload' },
  { id: 'watch-live', label: 'Watch live', icon: 'monitor' },
];
export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const VIEWPORTS = ['phone', 'desktop'];
export const SIDES = ['before', 'after'];
export const GROUPS = [
  { id: 'app', label: 'App' }, { id: 'screen', label: 'Screen' }, { id: 'source', label: 'Source' }, { id: 'day', label: 'Day' }, { id: 'none', label: 'No groups' },
];
/** Review items titled like this (a check session's pictures that went to the review queue by mistake) move here. */
export const MIGRATE_PREFIXES = ['Breakroom check:'];
const ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const FILE = /^[a-z0-9][a-z0-9._-]{0,120}\.(png|jpe?g|webp)$/;

const s = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
const iso = (v) => { const t = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString().replace(/\.\d{3}Z$/, 'Z') : ''; };
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** phone when the file name says so (…-phone.png), else desktop. */
export const viewportOf = (name = '') => (/(^|[-_.\s])phone([-_.\s]|$)/i.test(name) ? 'phone' : 'desktop');
/** A title from a file name: "breakroom-home-phone.png" → "Breakroom home". */
export function titleOf(name = '') {
  const stem = String(name).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/([-_.])(phone|desktop)$/i, '');
  const t = stem.replace(/[-_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Screenshot';
}
export const newId = (now = new Date().toISOString()) => `s-${now.slice(0, 10).replace(/-/g, '')}-${hex(8)}`;

/** Clean one screenshot record; unknown fields are kept. Returns { shot, problems }. */
export function normShot(raw, { now = new Date().toISOString() } = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const title = s(o.title, 200) || (o.file ? titleOf(o.file) : '');
  if (!title) problems.push('a title is needed');
  const source = SOURCE_IDS.includes(o.source) ? o.source : 'manual';
  const prRaw = s(o.pr, 12).replace(/^#/, '');
  let pr = null;
  if (prRaw) { if (/^\d+$/.test(prRaw) && Number(prRaw) > 0) pr = Number(prRaw); else problems.push('pr must be a PR number'); }
  const pair = s(o.pair, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const file = s(o.file, 140);
  if (file && !FILE.test(file)) problems.push(`file "${file}" is not a screenshot file name`);
  const shot = {
    ...o, $axf: SCHEMA,
    id: typeof o.id === 'string' && ID.test(o.id) ? o.id : newId(now),
    title, source,
    session: s(o.session, 120), build: s(o.build, 120), agent: s(o.agent, 80),
    app: s(o.app, 80), screen: s(o.screen, 200),
    viewport: VIEWPORTS.includes(o.viewport) ? o.viewport : viewportOf(file || title),
    takenAt: iso(o.takenAt) || now, addedAt: iso(o.addedAt) || now,
    pair, side: pair && SIDES.includes(o.side) ? o.side : '',
    note: s(o.note, 4000), branch: s(o.branch, 200), pr, by: s(o.by, 60),
    file, size: Number.isFinite(o.size) && o.size > 0 ? Math.floor(o.size) : 0,
    promoted: Array.isArray(o.promoted) ? o.promoted.filter((x) => typeof x === 'string').slice(-20) : [],
  };
  return { shot, problems };
}

/** A pair with no side given: before when nothing holds that pair yet, else after. */
export function sideFor(shots, pair, side = '') {
  if (!pair) return '';
  if (SIDES.includes(side)) return side;
  return shots.some((x) => x.pair === pair && x.side === 'before') ? 'after' : 'before';
}

/** The other half of a shot's before/after pair: { before, after } when both exist, else null. */
export function pairOf(shots, shot) {
  if (!shot?.pair) return null;
  const mates = shots.filter((x) => x.pair === shot.pair);
  const before = mates.find((x) => x.side === 'before') ?? null;
  const after = [...mates].reverse().find((x) => x.side === 'after') ?? null;
  return before && after && before.id !== after.id ? { before, after } : null;
}

export const dayOf = (t) => (typeof t === 'string' && t.length >= 10 ? t.slice(0, 10) : 'unknown');
export const sourceInfo = (id) => SOURCES.find((x) => x.id === id) ?? { id, label: id || 'Other', icon: 'file' };

/** Search + filters: q (title, app, screen, session, build, note, branch, #PR), app, source, viewport, screen. */
export function filterShots(shots, { q = '', app = '', source = '', viewport = '', screen = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return shots.filter((x) => {
    if (app && x.app !== app) return false;
    if (source && x.source !== source) return false;
    if (viewport && x.viewport !== viewport) return false;
    if (screen && x.screen !== screen) return false;
    if (!words.length) return true;
    const hay = [x.title, x.app, x.screen, x.session, x.build, x.agent, x.note, x.branch, x.pr ? `#${x.pr}` : '', x.id].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export const SORTS = [{ id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }, { id: 'title', label: 'Title' }, { id: 'app', label: 'App' }];
export function sortShots(shots, sort = 'newest') {
  const xs = [...shots];
  const t = (x) => x.takenAt || '';
  if (sort === 'oldest') return xs.sort((a, b) => t(a).localeCompare(t(b)));
  if (sort === 'title') return xs.sort((a, b) => a.title.localeCompare(b.title) || t(b).localeCompare(t(a)));
  if (sort === 'app') return xs.sort((a, b) => (a.app || '~').localeCompare(b.app || '~') || t(b).localeCompare(t(a)));
  return xs.sort((a, b) => t(b).localeCompare(t(a)));
}

/** Groups in a stable order: days newest first, the rest by label, "none" last. */
export function groupShots(shots, by = 'app') {
  if (by === 'none') return [{ id: 'all', label: 'All screenshots', shots }];
  const key = (x) => (by === 'day' ? dayOf(x.takenAt) : by === 'source' ? x.source : by === 'screen' ? x.screen : x.app) || '';
  const m = new Map();
  for (const x of shots) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  const label = (k) => (by === 'source' ? sourceInfo(k).label : k || (by === 'app' ? 'No app' : by === 'screen' ? 'No screen' : 'Unknown'));
  const ids = [...m.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : by === 'day' ? b.localeCompare(a) : label(a).localeCompare(label(b))));
  return ids.map((k) => ({ id: k || '-', label: label(k), shots: m.get(k) }));
}

export const distinct = (shots, f) => [...new Set(shots.map((x) => x[f]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

/**
 * Migration: review items whose title starts with a MIGRATE_PREFIXES entry become screenshots (one per picture). Returns
 * { keep: items left in the review queue, shots: [{ shot, from: 'items/<id>/<file>' }], moved: item ids }.
 */
export function migrateItems(items, { now = new Date().toISOString() } = {}) {
  const keep = [], shots = [], moved = [];
  for (const it of Array.isArray(items) ? items : []) {
    const title = typeof it?.title === 'string' ? it.title : '';
    if (!MIGRATE_PREFIXES.some((p) => title.startsWith(p)) || String(it.id).startsWith('pack:')) { keep.push(it); continue; }
    moved.push(it.id);
    const pics = Array.isArray(it.shots) ? it.shots : [];
    pics.forEach((p, i) => {
      const many = pics.length > 1;
      const screen = title.slice(title.indexOf(':') + 1).trim();
      const { shot } = normShot({
        title: many ? `${title} · ${p.name || titleOf(p.src)}` : title, source: 'check', app: it.app || 'Breakroom', screen: p.name || screen,
        viewport: p.device, takenAt: it.submittedAt, session: it.build || it.branch || '', build: it.build || '', branch: it.branch || '', pr: it.pr || null,
        note: [it.notes, `Moved from UI Review item ${it.id}.`].filter(Boolean).join('\n'), by: it.history?.[0]?.by || 'check', migratedFrom: it.id,
        id: `s-${String(it.id).replace(/[^a-z0-9]+/gi, '').slice(-24).toLowerCase()}-${i + 1}`,
      }, { now });
      shots.push({ shot, from: p.src });
    });
  }
  return { keep, shots, moved };
}
