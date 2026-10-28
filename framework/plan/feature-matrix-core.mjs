/**
 * Feature matrix core (feature-matrix@1). Pure: no fs, no DOM. Shared by the Feature Matrix plugin (console page +
 * server), the CLI, the Apply engine (./feature-matrix-apply.mjs) and the checks (spec/check-feature-matrix.mjs).
 *
 * Every build has a feature matrix (Brett, Oct 28 2026): a grouped list of feature items, each with its time cost
 * (minutes), its model (Fable | Opus) and why it is there. Ticked = `keep`, unticked = `skip`. Items can be added at any
 * time and are NEVER deleted: "removing" one sets it to `skip`, and skipped items stay in the matrix (and are skipped
 * when the build runs). All matrices live in ONE dataset, one matrix per build reference + build profile. Editing a
 * matrix bumps its `version`; `appliedVersion` is the last version pushed to the other tables (orchestrator, pending
 * list, build queue, build manager, plan) by the Apply engine, so `dirty` = version > appliedVersion lights the Apply
 * button. Every change is kept in the matrix's history.
 *
 * Dataset        { $axf: 'feature-matrix@1', updatedAt, matrices: Matrix[] }
 * Matrix         { id, ref: { kind, id }, profile, title, createdAt, updatedAt, version, appliedVersion, appliedAt,
 *                  items: Item[], history: [{ at, action, item?, from?, to?, by? }] }
 * Item           { id, name, why, group, minutes, model, state: 'keep' | 'skip', addedAt, updatedAt,
 *                  source: { kind: 'step' | 'sub' | 'acceptance' | 'manual', id }, history: [{ at, action, from?, to? }] }
 *
 * `ref.kind` says which table the build lives in: orchestrator (build id), pending (item id), queue (build-queue step
 * id), plan (feature id), change (change-log entry id). A matrix id is `<profile>:<ref.kind>:<ref.id>` so the same
 * build in two profiles has two matrices and the plugin can find one from any grid row without a lookup table.
 */

export const SCHEMA = 'feature-matrix@1';
export const MODELS = ['Fable', 'Opus'];
export const STATES = ['keep', 'skip'];
export const REF_KINDS = ['orchestrator', 'pending', 'queue', 'plan', 'change'];
export const SOURCE_KINDS = ['step', 'sub', 'acceptance', 'manual'];
export const SORTS = ['updated', 'added', 'cost', 'title', 'profile', 'dirty'];
export const SORT_LABEL = { updated: 'Last updated', added: 'Date added', cost: 'Time cost', title: 'Build', profile: 'Profile', dirty: 'Needs apply' };
export const LIMITS = { items: 500, history: 300, itemHistory: 60, name: 300, why: 1000, group: 80, title: 300, id: 120 };
/** Added to a target's step id / entry tag when Apply creates it for a matrix item (see feature-matrix-apply.mjs). */
export const APPLIED_PREFIX = 'fm-';

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
export const iso = (v) => { if (v == null || v === '') return ''; const d = typeof v === 'number' ? new Date(v) : new Date(str(v, 40)); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
export const slug = (t) => str(t, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const nowIso = () => new Date().toISOString();
const minutesOf = (v) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').trim()); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const modelOf = (v) => { const m = str(v, 20).toLowerCase(); return m.startsWith('fable') ? 'Fable' : 'Opus'; };

export function formatMinutes(min) {
  if (!min || !Number.isFinite(min) || min <= 0) return '';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.round(min / 30) / 2} h`;
}

/** The id of the matrix for a build reference in a profile: `<profile>:<kind>:<id>`. */
export function matrixId(ref, profile) {
  const r = normRef(ref); const p = slug(profile) || 'main-framework';
  if (!r) throw new Error('a build reference { kind, id } is needed');
  return `${p}:${r.kind}:${r.id}`;
}
export function normRef(ref) {
  const o = ref && typeof ref === 'object' ? ref : {};
  const kind = str(o.kind, 20); const id = str(o.id, LIMITS.id).trim();
  return REF_KINDS.includes(kind) && id ? { kind, id } : null;
}

function normItem(raw, i, now) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const name = str(o.name ?? o.text, LIMITS.name).trim();
  const src = o.source && typeof o.source === 'object' ? o.source : {};
  const sk = SOURCE_KINDS.includes(src.kind) ? src.kind : 'manual';
  const addedAt = iso(o.addedAt) || now;
  return {
    id: slug(o.id) || slug(name) || `item-${i + 1}`,
    name,
    why: str(o.why, LIMITS.why),
    group: str(o.group, LIMITS.group),
    minutes: minutesOf(o.minutes ?? o.estimate),
    model: modelOf(o.model),
    state: o.state === 'skip' ? 'skip' : 'keep',
    addedAt,
    updatedAt: iso(o.updatedAt) || addedAt,
    source: { kind: sk, id: sk === 'manual' ? '' : str(src.id, LIMITS.id) },
    history: (Array.isArray(o.history) ? o.history : []).map((h) => ({ at: iso(h?.at), action: str(h?.action, 40), ...(h?.from != null ? { from: str(String(h.from), 300) } : {}), ...(h?.to != null ? { to: str(String(h.to), 300) } : {}) })).filter((h) => h.at && h.action).slice(-LIMITS.itemHistory),
  };
}

function normMatrix(raw, now) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const ref = normRef(o.ref); if (!ref) return null;
  const profile = slug(o.profile) || 'main-framework';
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, LIMITS.items).map((it, i) => normItem(it, i, now)).filter((it) => it.name);
  const seen = new Set();
  items.forEach((it, i) => { let id = it.id; let n = 2; while (seen.has(id)) id = `${it.id}-${n++}`; it.id = id; seen.add(id); if (!it.id) it.id = `item-${i + 1}`; });
  const version = Math.max(0, Math.floor(Number(o.version) || 0));
  const createdAt = iso(o.createdAt) || now;
  return {
    id: matrixId(ref, profile),
    ref, profile,
    title: str(o.title, LIMITS.title).trim() || ref.id,
    createdAt,
    updatedAt: iso(o.updatedAt) || createdAt,
    version,
    appliedVersion: Math.min(version, Math.max(0, Math.floor(Number(o.appliedVersion) || 0))),
    appliedAt: iso(o.appliedAt),
    items,
    history: (Array.isArray(o.history) ? o.history : []).map((h) => ({ at: iso(h?.at), action: str(h?.action, 40), ...(h?.item ? { item: str(h.item, 120) } : {}), ...(h?.from != null ? { from: str(String(h.from), 300) } : {}), ...(h?.to != null ? { to: str(String(h.to), 300) } : {}), ...(h?.by ? { by: str(h.by, 80) } : {}) })).filter((h) => h.at && h.action).slice(-LIMITS.history),
  };
}

export function emptyState(now = nowIso()) { return { $axf: SCHEMA, updatedAt: now, matrices: [] }; }
export function normalizeState(raw, now = nowIso()) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const list = (Array.isArray(o.matrices) ? o.matrices : []).map((m) => normMatrix(m, now)).filter(Boolean);
  const byId = new Map(); for (const m of list) byId.set(m.id, m); // last one wins on a duplicate id
  return { $axf: SCHEMA, updatedAt: iso(o.updatedAt) || now, matrices: [...byId.values()] };
}

export const isDirty = (m) => m.version > m.appliedVersion;
export const isKept = (it) => it.state !== 'skip';

/** Kept / skipped counts and minutes, the Fable/Opus split, per group, and whether Apply is needed. */
export function totals(matrix) {
  const items = matrix?.items ?? [];
  const sum = (list) => list.reduce((t, it) => t + (it.minutes || 0), 0);
  const kept = items.filter(isKept); const skipped = items.filter((it) => !isKept(it));
  const byModel = Object.fromEntries(MODELS.map((m) => {
    const k = kept.filter((it) => it.model === m); const s = skipped.filter((it) => it.model === m);
    return [m, { kept: k.length, skipped: s.length, keptMinutes: sum(k), skippedMinutes: sum(s) }];
  }));
  const groups = [];
  for (const it of items) {
    let g = groups.find((x) => x.label === it.group);
    if (!g) { g = { label: it.group, items: 0, kept: 0, skipped: 0, keptMinutes: 0, skippedMinutes: 0 }; groups.push(g); }
    g.items += 1; if (isKept(it)) { g.kept += 1; g.keptMinutes += it.minutes || 0; } else { g.skipped += 1; g.skippedMinutes += it.minutes || 0; }
  }
  return { items: items.length, kept: kept.length, skipped: skipped.length, keptMinutes: sum(kept), skippedMinutes: sum(skipped), totalMinutes: sum(items), byModel, groups, dirty: matrix ? isDirty(matrix) : false, applied: matrix ? matrix.appliedVersion > 0 : false };
}

export function findMatrix(state, ref, profile) { const id = typeof ref === 'string' ? ref : matrixId(ref, profile); return state.matrices.find((m) => m.id === id) ?? null; }

/** Rows for the matrices grid: one per build, newest change first (Brett: every build grid sorted most recent at top). */
export function grid(state, sort = 'updated', dir = 'desc') {
  const rows = state.matrices.map((m) => { const t = totals(m); return { id: m.id, ref: m.ref, profile: m.profile, title: m.title, addedAt: m.createdAt, updatedAt: m.updatedAt, version: m.version, appliedVersion: m.appliedVersion, appliedAt: m.appliedAt, dirty: t.dirty, items: t.items, kept: t.kept, skipped: t.skipped, keptMinutes: t.keptMinutes, skippedMinutes: t.skippedMinutes, cost: formatMinutes(t.keptMinutes), byModel: t.byModel }; });
  return sortRows(rows, sort, dir);
}
export function sortRows(rows, sort = 'updated', dir = 'desc') {
  const k = (r) => sort === 'added' ? r.addedAt : sort === 'cost' ? r.keptMinutes : sort === 'title' ? r.title.toLowerCase() : sort === 'profile' ? r.profile : sort === 'dirty' ? (r.dirty ? 1 : 0) : r.updatedAt;
  const out = [...rows].sort((a, b) => { const x = k(a); const y = k(b); if (x < y) return -1; if (x > y) return 1; return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0; });
  return dir === 'asc' ? out : out.reverse();
}

// ---- seeding: items from the tables a build already lives in (a projection of what exists; nothing is invented)

/** orchestrator@1 steps → items (source step; skipped steps stay in the matrix as `skip`). */
export function itemsFromSteps(steps, now = nowIso()) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => ({ id: slug(s?.id) || `s${i + 1}`, name: str(s?.text, LIMITS.name), why: str(s?.why, LIMITS.why), group: str(s?.group || s?.phase, LIMITS.group), minutes: estimateMinutes(s?.estimate) ?? 0, model: s?.model, state: s?.skip === true ? 'skip' : 'keep', addedAt: now, source: { kind: 'step', id: str(s?.id, LIMITS.id) || `s${i + 1}` } }));
}
/** pending@1 sub prompts or build-queue@1 small steps → items (source sub = index, or the `fm` tag Apply wrote). */
export function itemsFromSubPrompts(subPrompts, model = 'Opus', now = nowIso()) {
  return (Array.isArray(subPrompts) ? subPrompts : []).map((p, i) => ({ id: str(p?.fm, 80) || slug(p?.text) || `sub-${i + 1}`, name: str(p?.text, LIMITS.name), group: '', minutes: estimateMinutes(p?.estimate) ?? 0, model, state: p?.skip === true ? 'skip' : 'keep', addedAt: iso(p?.at) || now, source: { kind: 'sub', id: str(p?.fm, 80) || String(i) } }));
}
/** plan@1 acceptance lines → items. */
export function itemsFromAcceptance(acceptance, model = 'Opus', now = nowIso()) {
  return (Array.isArray(acceptance) ? acceptance : []).map((a, i) => ({ id: str(a?.fm, 80) || slug(a?.text) || `acc-${i + 1}`, name: str(a?.text, LIMITS.name), group: '', minutes: 0, model, state: a?.skip === true ? 'skip' : 'keep', addedAt: now, source: { kind: 'acceptance', id: str(a?.fm, 80) || String(i) } }));
}
/** "45 min", "2 h", "1.5 d", 90 → minutes (a day = 8 working hours), null when unreadable. */
export function estimateMinutes(e) {
  if (typeof e === 'number' && e > 0) return Math.round(e);
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(str(e, 30));
  if (!m) return null;
  const n = Number(m[1]); const u = (m[2] || 'min').toLowerCase();
  return Math.round(u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 480 : n);
}

// ---- changes

/**
 * Apply one change; returns { state, matrix?, item?, log } or throws an Error with a plain message. Pass `now` for
 * reproducible output (fixtures). Content changes bump `version` and append to the history; nothing ever deletes.
 *
 *   add        { ref, profile, title?, items? }            a matrix (refused when it exists; use seed to merge)
 *   seed       { ref, profile, title?, items }             add the matrix if missing, then add only the items it lacks (idempotent)
 *   add-item   { matrix, item: { id?, name, why?, group?, minutes?, model?, state?, source? } }   existing id → set back to keep + merge fields
 *   keep|skip  { matrix, item }                            tick / untick
 *   set-state  { matrix, item, state }
 *   edit-item  { matrix, item, data: { name?, why?, group?, minutes?, model? } }
 *   rename     { matrix, title }
 *   applied    { matrix, version?, by? }                   the Apply engine pushed this version to the other tables
 *   remove-item / remove                                   always refused: items and matrices are never deleted
 */
export function apply(state, change, now = nowIso()) {
  const s = normalizeState(state, now);
  const c = change && typeof change === 'object' ? change : {};
  const log = [];
  const find = () => { const id = typeof c.matrix === 'string' ? c.matrix : c.matrix ? matrixId(c.matrix.ref ?? c.matrix, c.matrix.profile ?? c.profile) : matrixId(c.ref, c.profile); const m = s.matrices.find((x) => x.id === id); if (!m) throw new Error(`no matrix "${id}"`); return m; };
  const itemOf = (m) => { const id = slug(c.item); const it = m.items.find((x) => x.id === id); if (!it) throw new Error(`no item "${c.item}" in ${m.id}`); return it; };
  const bump = (m, action, extra = {}) => { m.version += 1; m.updatedAt = now; m.history.push({ at: now, action, ...extra, ...(c.by ? { by: str(c.by, 80) } : {}) }); if (m.history.length > LIMITS.history) m.history = m.history.slice(-LIMITS.history); };
  const addItem = (m, raw) => {
    const it = normItem(raw, m.items.length, now); if (!it.name) throw new Error('an item needs a name');
    const have = m.items.find((x) => x.id === it.id);
    if (have) {
      const from = have.state;
      for (const k of ['name', 'why', 'group', 'model']) if (raw[k] != null && str(String(raw[k])).trim()) have[k] = it[k];
      if (raw.minutes != null || raw.estimate != null) have.minutes = it.minutes;
      if (have.state !== 'keep') { have.state = 'keep'; have.history.push({ at: now, action: 'state', from, to: 'keep' }); }
      have.updatedAt = now; bump(m, 'restore-item', { item: have.id }); log.push(`${m.id}: ${have.id} back in (keep)`); return have;
    }
    if (m.items.length >= LIMITS.items) throw new Error(`a matrix holds at most ${LIMITS.items} items`);
    it.history = [{ at: now, action: 'added' }];
    m.items.push(it); bump(m, 'add-item', { item: it.id }); log.push(`${m.id}: + ${it.id}`); return it;
  };
  let m = null; let item;
  switch (c.action) {
    case 'add': case 'seed': {
      const ref = normRef(c.ref); if (!ref) throw new Error('a build reference { kind, id } is needed');
      const id = matrixId(ref, c.profile);
      m = s.matrices.find((x) => x.id === id);
      if (m && c.action === 'add') throw new Error(`matrix "${id}" already exists (seed merges into it)`);
      if (!m) { m = normMatrix({ ref, profile: c.profile, title: c.title, createdAt: now, updatedAt: now, version: 0, items: [], history: [] }, now); m.items = []; s.matrices.push(m); bump(m, 'created'); log.push(`created ${m.id}`); }
      else if (str(c.title).trim() && m.title !== str(c.title, LIMITS.title).trim()) { m.title = str(c.title, LIMITS.title).trim(); }
      let added = 0;
      for (const raw of Array.isArray(c.items) ? c.items : []) {
        const it = normItem(raw, m.items.length, now); if (!it.name) continue;
        if (m.items.some((x) => x.id === it.id)) continue; // seed never touches what is already there
        it.history = [{ at: now, action: 'added' }]; m.items.push(it); added += 1;
      }
      if (added) { bump(m, 'seeded', { to: String(added) }); log.push(`${m.id}: seeded ${added} item${added === 1 ? '' : 's'}`); }
      break;
    }
    case 'add-item': { m = find(); item = addItem(m, c.item && typeof c.item === 'object' ? c.item : { name: c.item }); break; }
    case 'keep': case 'skip': case 'set-state': {
      m = find(); item = itemOf(m); const to = c.action === 'set-state' ? c.state : c.action;
      if (!STATES.includes(to)) throw new Error(`state is one of ${STATES.join(', ')}`);
      if (item.state === to) { log.push(`${m.id}: ${item.id} already ${to}`); break; }
      item.history.push({ at: now, action: 'state', from: item.state, to }); if (item.history.length > LIMITS.itemHistory) item.history = item.history.slice(-LIMITS.itemHistory);
      bump(m, 'state', { item: item.id, from: item.state, to }); item.state = to; item.updatedAt = now; log.push(`${m.id}: ${item.id} → ${to}`); break;
    }
    case 'edit-item': {
      m = find(); item = itemOf(m); const d = c.data && typeof c.data === 'object' ? c.data : {}; const edits = [];
      const next = normItem({ ...item, ...d, id: item.id, state: item.state, addedAt: item.addedAt, source: item.source, history: item.history }, 0, now);
      for (const k of ['name', 'why', 'group', 'minutes', 'model']) if (k in d && next[k] !== item[k]) { item.history.push({ at: now, action: k, from: String(item[k]), to: String(next[k]) }); edits.push(`${k} ${JSON.stringify(item[k])} → ${JSON.stringify(next[k])}`); item[k] = next[k]; }
      if (!item.name) throw new Error('an item needs a name');
      if (edits.length) { item.updatedAt = now; bump(m, 'edit-item', { item: item.id, to: edits.join('; ').slice(0, 300) }); log.push(`${m.id}: ${item.id} edited (${edits.join('; ')})`); } else log.push(`${m.id}: ${item.id} unchanged`);
      break;
    }
    case 'rename': { m = find(); const t = str(c.title, LIMITS.title).trim(); if (!t) throw new Error('a title is needed'); if (t !== m.title) { bump(m, 'rename', { from: m.title, to: t }); m.title = t; log.push(`${m.id}: renamed`); } break; }
    case 'applied': {
      m = find(); const v = c.version == null ? m.version : Math.floor(Number(c.version));
      if (!Number.isFinite(v) || v < 0 || v > m.version) throw new Error(`version ${c.version} is not one this matrix has`);
      if (v > m.appliedVersion) { m.appliedVersion = v; m.appliedAt = now; m.history.push({ at: now, action: 'applied', to: String(v), ...(c.by ? { by: str(c.by, 80) } : {}) }); log.push(`${m.id}: version ${v} applied`); }
      else log.push(`${m.id}: version ${v} was already applied`);
      break; // applying does not bump the version: the matrix is clean afterwards
    }
    case 'remove-item': throw new Error('items are never deleted from a feature matrix: skip it instead');
    case 'remove': throw new Error('a feature matrix is never deleted: skip every item instead');
    default: throw new Error(`unknown action ${c.action}`);
  }
  s.updatedAt = now;
  return { state: s, matrix: m ?? undefined, item, log };
}

/** Problems in a dataset a writer should refuse (the check and the server call this). */
export function validate(raw) {
  const errors = [];
  const o = raw && typeof raw === 'object' ? raw : null;
  if (!o) return ['not an object'];
  if (o.$axf !== SCHEMA) errors.push(`$axf must be ${SCHEMA}`);
  if (!Array.isArray(o.matrices)) return [...errors, 'matrices is a list'];
  const ids = new Set();
  o.matrices.forEach((m, i) => {
    const where = `matrix ${i + 1}${m?.id ? ` (${m.id})` : ''}`;
    const ref = normRef(m?.ref); if (!ref) errors.push(`${where}: ref.kind is one of ${REF_KINDS.join(', ')} and ref.id is set`);
    if (ref && m?.id && m.id !== matrixId(ref, m.profile)) errors.push(`${where}: id must be ${matrixId(ref, m.profile)}`);
    if (ids.has(m?.id)) errors.push(`${where}: duplicate id`); ids.add(m?.id);
    if ((Number(m?.appliedVersion) || 0) > (Number(m?.version) || 0)) errors.push(`${where}: appliedVersion is ahead of version`);
    const seen = new Set();
    (Array.isArray(m?.items) ? m.items : []).forEach((it, j) => {
      const w = `${where} item ${j + 1}`;
      if (!str(it?.name).trim()) errors.push(`${w}: name is needed`);
      if (it?.state != null && !STATES.includes(it.state)) errors.push(`${w}: state is keep or skip`);
      if (it?.model != null && !MODELS.includes(it.model)) errors.push(`${w}: model is Fable or Opus`);
      if (it?.minutes != null && !(Number.isFinite(Number(it.minutes)) && Number(it.minutes) >= 0)) errors.push(`${w}: minutes is a number ≥ 0`);
      if (it?.id) { if (seen.has(it.id)) errors.push(`${w}: duplicate item id ${it.id}`); seen.add(it.id); }
    });
  });
  return errors;
}
