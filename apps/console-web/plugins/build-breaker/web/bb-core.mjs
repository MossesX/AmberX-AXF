/**
 * Build Breaker core (build-asks@1): pure helpers shared by the page, the CLI (asks.mjs), the server part (through the
 * CLI) and the self-test. No React, no DOM, no file access.
 *
 * Data: every ask Brett made, one JSON object per line (JSON Lines, append-friendly for other sessions). Line 1 is the
 * header ({$axf: 'build-asks@1', generatedAt, sources, gaps, apps, plugins}); every other line is one ask
 * ({id, app, plugin, title, plain, quote, askedAt, timeApprox, status, model, minutes, costUsd, costEstimated, branch,
 * pr, profile, sources, note?, updatedAt?}). The schema is open: unknown fields on the header, apps, plugins and asks
 * are kept through every read, merge and write.
 */

export const SCHEMA = 'build-asks@1';
export const REPO = 'MossesX/AmberX-AXF';

/** Every status an ask can have: label, icon, chip tone, the bucket the totals strip counts it in. Open registry. */
export const STATUSES = [
  { id: 'built', label: 'Built', icon: 'check-circle', tone: 'success', bucket: 'built' },
  { id: 'in-progress', label: 'In progress', icon: 'refresh', tone: 'accent', bucket: 'active' },
  { id: 'pending', label: 'Pending', icon: 'clock', tone: 'warning', bucket: 'pending' },
  { id: 'planned', label: 'Planned', icon: 'layers', tone: '', bucket: 'planned' },
  { id: 'held', label: 'Held', icon: 'pause', tone: '', bucket: 'held' },
  { id: 'removed', label: 'Removed', icon: 'x-circle', tone: 'danger', bucket: 'removed' },
  { id: 'waiting-push', label: 'Waiting for push', icon: 'upload', tone: 'accent', bucket: 'waiting' },
  { id: 'waiting-pull', label: 'Waiting for pull', icon: 'download', tone: 'accent', bucket: 'waiting' },
  { id: 'waiting-deploy', label: 'Waiting for deploy', icon: 'rocket', tone: 'accent', bucket: 'waiting' },
  { id: 'waiting-approve', label: 'Waiting for approval', icon: 'shield', tone: 'warning', bucket: 'waiting' },
];
const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));
const STATUS_ALIASES = { done: 'built', complete: 'built', completed: 'built', merged: 'built', running: 'in-progress', 'in progress': 'in-progress', parked: 'pending', queued: 'planned', 'on-hold': 'held', hold: 'held', dropped: 'removed', 'waiting-approval': 'waiting-approve' };
export function statusInfo(id) {
  const k = normStatus(id);
  return STATUS_BY_ID.get(k) ?? { id: k || 'unknown', label: k ? k.replace(/-/g, ' ') : 'Unknown', icon: 'info', tone: '', bucket: 'other' };
}
export function normStatus(s) {
  const k = String(s ?? '').trim().toLowerCase();
  return STATUS_ALIASES[k] ?? k;
}
export const BUCKETS = [
  { id: 'built', label: 'built' }, { id: 'active', label: 'in progress' }, { id: 'pending', label: 'pending' }, { id: 'planned', label: 'planned' },
  { id: 'waiting', label: 'waiting' }, { id: 'held', label: 'held' }, { id: 'removed', label: 'removed' },
];

export const MODELS = ['Opus', 'Fable', 'Sonnet'];
export function normModel(m) {
  const s = String(m ?? '').toLowerCase();
  if (!s) return '';
  for (const k of MODELS) if (s.includes(k.toLowerCase())) return k;
  return String(m).trim();
}

/* ------------------------------------------------------------------ file format */

/** JSON Lines text → document. Blank lines and lines that aren't JSON objects are skipped (counted in `skipped`). */
export function parseJsonl(text) {
  const doc = { $axf: SCHEMA, apps: [], plugins: [], asks: [] };
  let skipped = 0, headerSeen = false;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let v;
    try { v = JSON.parse(line); } catch { skipped++; continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { skipped++; continue; }
    if (!headerSeen && v.$axf) { headerSeen = true; Object.assign(doc, v, { asks: [] }); if (!Array.isArray(doc.apps)) doc.apps = []; if (!Array.isArray(doc.plugins)) doc.plugins = []; continue; }
    doc.asks.push(v);
  }
  return Object.assign(doc, { skipped });
}

/** Document → JSON Lines text (header first, then one ask per line). */
export function toJsonl(doc) {
  const { asks = [], skipped, ...head } = doc ?? {}; // eslint-disable-line no-unused-vars
  return [JSON.stringify({ ...head, $axf: SCHEMA }), ...asks.map((a) => JSON.stringify(a))].join('\n') + '\n';
}

/** A whole build-asks@1 JSON document (the `{…, asks: []}` shape) is accepted too. */
export function parseAny(text) {
  const s = String(text ?? '').trim();
  if (s.startsWith('{') && !s.includes('\n{')) {
    try { const v = JSON.parse(s); if (v && Array.isArray(v.asks)) return { ...v, apps: v.apps ?? [], plugins: v.plugins ?? [], skipped: 0 }; } catch { /* JSON Lines then */ }
  }
  return parseJsonl(s);
}

/* ------------------------------------------------------------------ merge (seed in the repo + the plugin's data folder) */

const stamp = (a) => String(a?.updatedAt ?? '');
const unionById = (a = [], b = []) => {
  const out = new Map();
  for (const x of a) if (x && x.id) out.set(x.id, x);
  for (const x of b) if (x && x.id) out.set(x.id, { ...out.get(x.id), ...x });
  return [...out.values()];
};

/**
 * Seed (repo) + mirror (data folder) → one document. Asks join by id; when both have one, the newer `updatedAt` wins
 * (a tie keeps the mirror's, the live copy). Apps and plugins are a union (mirror fields on top). Order: seed order,
 * then asks only the mirror has.
 */
export function mergeDocs(seed, mirror) {
  if (!mirror) return seed;
  if (!seed) return mirror;
  const asks = new Map();
  for (const a of seed.asks ?? []) if (a?.id) asks.set(a.id, a);
  for (const a of mirror.asks ?? []) {
    if (!a?.id) continue;
    const s = asks.get(a.id);
    asks.set(a.id, !s || stamp(a) >= stamp(s) ? a : s);
  }
  const { skipped: _s, ...sh } = seed; const { skipped: _m, ...mh } = mirror; // eslint-disable-line no-unused-vars
  return { ...sh, ...mh, $axf: SCHEMA, generatedAt: [sh.generatedAt, mh.generatedAt].filter(Boolean).sort().pop() ?? '', apps: unionById(seed.apps, mirror.apps), plugins: unionById(seed.plugins, mirror.plugins), asks: [...asks.values()] };
}

/* ------------------------------------------------------------------ validation + changes (the CLI) */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
export const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Problems with one ask (empty = fine). Every ask needs an id, a title, an app the document knows and a date. */
export function checkAsk(a, doc) {
  const out = [];
  if (!a || typeof a !== 'object') return ['not an object'];
  if (!ID_RE.test(String(a.id ?? ''))) out.push(`bad id ${JSON.stringify(a.id)}`);
  if (!String(a.title ?? '').trim()) out.push(`${a.id}: no title`);
  if (!String(a.app ?? '').trim()) out.push(`${a.id}: no app`);
  else if (doc?.apps?.length && !doc.apps.some((x) => x.id === a.app)) out.push(`${a.id}: unknown app ${a.app}`);
  if (a.plugin && doc?.plugins?.length && !doc.plugins.some((x) => x.id === a.plugin)) out.push(`${a.id}: unknown plugin ${a.plugin}`);
  if (Number.isNaN(Date.parse(a.askedAt ?? ''))) out.push(`${a.id}: no askedAt date`);
  if (a.minutes != null && !(Number(a.minutes) >= 0)) out.push(`${a.id}: minutes not a number`);
  if (a.costUsd != null && !(Number(a.costUsd) >= 0)) out.push(`${a.id}: costUsd not a number`);
  return out;
}
export function checkDoc(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc?.asks ?? []) { out.push(...checkAsk(a, doc)); if (seen.has(a.id)) out.push(`duplicate id ${a.id}`); seen.add(a.id); }
  return out;
}

/** Price heuristic per minute when no cost is given (the same numbers the asks file was estimated with). */
export const PRICE_PER_MIN = { Fable: 0.275, Opus: 0.14, Sonnet: 0.06 };

/** A new ask from loose input (CLI flags). Unknown fields are kept. */
export function makeAsk(input, doc, now = new Date().toISOString()) {
  const title = String(input.title ?? '').trim();
  const model = normModel(input.model) || 'Opus';
  const minutes = input.minutes == null || input.minutes === '' ? null : Number(input.minutes);
  let id = slug(input.id || `${input.plugin || input.app || 'ask'}-${title}`) || `ask-${Date.now()}`;
  const ids = new Set((doc?.asks ?? []).map((a) => a.id));
  for (let i = 2; ids.has(id); i++) id = `${slug(input.id || title)}-${i}`;
  const cost = input.costUsd != null && input.costUsd !== '' ? Number(input.costUsd) : minutes != null ? Math.round(minutes * (PRICE_PER_MIN[model] ?? PRICE_PER_MIN.Opus) * 100) / 100 : null;
  return {
    ...input, id, app: String(input.app ?? '').trim(), plugin: input.plugin ? String(input.plugin) : null, title,
    plain: String(input.plain ?? ''), quote: String(input.quote ?? ''), askedAt: input.askedAt || now, timeApprox: input.timeApprox ? true : null,
    status: normStatus(input.status || 'pending'), model, minutes, costUsd: cost, costEstimated: input.costUsd == null || input.costUsd === '',
    branch: String(input.branch ?? ''), pr: input.pr ? Number(input.pr) : null, profile: String(input.profile || 'main-framework'),
    sources: Array.isArray(input.sources) ? input.sources : input.sources ? String(input.sources).split(',').map((s) => s.trim()).filter(Boolean) : [], updatedAt: now,
  };
}

/** Change fields of one ask (status, branch, pr, minutes, cost, note…); returns a new document. */
export function patchAsk(doc, id, patch, now = new Date().toISOString()) {
  const i = (doc.asks ?? []).findIndex((a) => a.id === id);
  if (i < 0) throw new Error(`no ask ${id}`);
  const p = { ...patch };
  if (p.status != null) p.status = normStatus(p.status);
  if (p.model != null) p.model = normModel(p.model);
  if (p.pr != null) p.pr = p.pr === '' ? null : Number(p.pr);
  for (const k of ['minutes', 'costUsd']) if (p[k] != null) p[k] = p[k] === '' ? null : Number(p[k]);
  if (p.costUsd != null) p.costEstimated = false;
  const asks = [...doc.asks];
  asks[i] = { ...asks[i], ...p, updatedAt: now };
  return { ...doc, asks };
}

/* ------------------------------------------------------------------ view helpers (filter, sort, group, totals) */

const ts = (a) => { const t = Date.parse(a?.askedAt ?? ''); return Number.isNaN(t) ? 0 : t; };
export const askTime = ts;

/** Free text an ask is searched by: title, plain description, his own words, plus app / plugin / branch / id. */
export const searchText = (a) => [a.title, a.plain, a.quote, a.note, a.app, a.plugin, a.branch, a.id, a.pr ? `#${a.pr}` : ''].filter(Boolean).join(' ').toLowerCase();

export const RANGES = [{ id: '7', label: '7 days', days: 7 }, { id: '30', label: '30 days', days: 30 }, { id: 'all', label: 'All', days: 0 }];

/**
 * The asks that pass the toolbar: q (every word must match), statuses (empty = all), models (empty = all), range
 * ('7' | '30' | 'all', counted back from `now`), from / to (YYYY-MM-DD, inclusive).
 */
export function filterAsks(asks, f = {}, now = Date.now()) {
  const words = String(f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const st = new Set((f.statuses ?? []).map(normStatus));
  const md = new Set((f.models ?? []).map(normModel));
  const days = RANGES.find((r) => r.id === String(f.range ?? 'all'))?.days ?? 0;
  const since = days ? now - days * 86400000 : -Infinity;
  const from = f.from ? Date.parse(`${f.from}T00:00:00`) : -Infinity;
  const to = f.to ? Date.parse(`${f.to}T23:59:59.999`) : Infinity;
  return asks.filter((a) => {
    if (st.size && !st.has(normStatus(a.status))) return false;
    if (md.size && !md.has(normModel(a.model))) return false;
    const t = ts(a);
    if (t < since || t < from || t > to) return false;
    if (words.length) { const text = searchText(a); if (!words.every((w) => text.includes(w))) return false; }
    return true;
  });
}

export const SORTS = [
  { id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }, { id: 'title', label: 'Title A–Z' },
  { id: 'minutes', label: 'Longest build' }, { id: 'cost', label: 'Most expensive' }, { id: 'status', label: 'Status' },
];
const STATUS_ORDER = new Map(STATUSES.map((s, i) => [s.id, i]));
export function sortAsks(asks, sort = 'newest') {
  const by = {
    newest: (a, b) => ts(b) - ts(a), oldest: (a, b) => ts(a) - ts(b),
    title: (a, b) => String(a.title).localeCompare(String(b.title)),
    minutes: (a, b) => (Number(b.minutes) || 0) - (Number(a.minutes) || 0), cost: (a, b) => (Number(b.costUsd) || 0) - (Number(a.costUsd) || 0),
    status: (a, b) => (STATUS_ORDER.get(normStatus(a.status)) ?? 99) - (STATUS_ORDER.get(normStatus(b.status)) ?? 99),
  }[sort] ?? ((a, b) => ts(b) - ts(a));
  return asks.map((a, i) => [a, i]).sort(([a, i], [b, j]) => by(a, b) || ts(b) - ts(a) || i - j).map(([a]) => a);
}

export const GROUPS = [{ id: 'none', label: 'No grouping' }, { id: 'status', label: 'Status' }, { id: 'model', label: 'Model' }, { id: 'day', label: 'Day' }, { id: 'profile', label: 'Profile' }];

/** Local calendar day of an ask (YYYY-MM-DD). */
export function dayKey(a) {
  const t = ts(a); if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Split (already sorted) asks into sub-groups; 'none' = one group with every ask. Group order follows the asks' order. */
export function groupAsks(asks, by = 'none') {
  if (by === 'none') return [{ id: 'all', label: '', asks }];
  const key = { status: (a) => normStatus(a.status), model: (a) => normModel(a.model) || 'unknown', day: dayKey, profile: (a) => a.profile || 'none' }[by] ?? (() => 'all');
  const out = new Map();
  for (const a of asks) { const k = key(a); if (!out.has(k)) out.set(k, { id: k, label: by === 'status' ? statusInfo(k).label : k, asks: [] }); out.get(k).asks.push(a); }
  const groups = [...out.values()];
  if (by === 'status') groups.sort((x, y) => (STATUS_ORDER.get(x.id) ?? 99) - (STATUS_ORDER.get(y.id) ?? 99));
  return groups;
}

/** Counts, minutes and dollars of a set of asks: per status bucket and per model. */
export function totals(asks) {
  const t = { asks: asks.length, minutes: 0, cost: 0, buckets: {}, statuses: {}, models: {} };
  for (const b of BUCKETS) t.buckets[b.id] = 0;
  for (const a of asks) {
    const s = statusInfo(a.status);
    t.buckets[s.bucket] = (t.buckets[s.bucket] ?? 0) + 1;
    t.statuses[s.id] = (t.statuses[s.id] ?? 0) + 1;
    const m = normModel(a.model) || 'Unknown';
    const mt = (t.models[m] ??= { asks: 0, minutes: 0, cost: 0 });
    const min = Number(a.minutes) || 0, usd = Number(a.costUsd) || 0;
    mt.asks++; mt.minutes += min; mt.cost += usd; t.minutes += min; t.cost += usd;
  }
  return t;
}

/** Apps and plugins sections: one entry per app / plugin the asks use, in the document's order, with its asks. */
export function sections(doc, asks, kind) {
  const list = kind === 'plugin' ? doc.plugins ?? [] : doc.apps ?? [];
  const key = kind === 'plugin' ? (a) => a.plugin : (a) => a.app;
  const by = new Map();
  for (const a of asks) { const k = key(a); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(a); }
  const known = list.filter((x) => by.has(x.id)).map((x) => ({ ...x, asks: by.get(x.id) }));
  const extra = [...by.keys()].filter((k) => !list.some((x) => x.id === k)).map((k) => ({ id: k, name: k, plain: '', asks: by.get(k) }));
  return [...known, ...extra];
}

/* ------------------------------------------------------------------ links and refs */

export const prUrl = (pr) => (Number(pr) > 0 ? `https://github.com/${REPO}/pull/${Number(pr)}` : '');
export const branchUrl = (b) => (b ? `https://github.com/${REPO}/tree/${String(b).split('/').map(encodeURIComponent).join('/')}` : '');

/**
 * The build an ask stands for, as a grid-hook@1 row ref (the kinds the builds grids use), from its sources: an
 * orchestrator build first, then a pending item, then a change-log entry. null when it has none.
 */
export function refFor(a) {
  const src = Array.isArray(a?.sources) ? a.sources : [];
  const find = (prefixes) => { for (const s of src) for (const p of prefixes) if (String(s).startsWith(`${p}:`)) { const id = String(s).slice(p.length + 1).trim().split(/\s+/)[0]; if (id) return id; } return ''; };
  const orch = find(['orchestrator']); if (orch) return { kind: 'orchestrator', id: orch };
  const pend = find(['pending', 'hub-pending']); if (pend) return { kind: 'pending', id: pend };
  const chg = find(['changes', 'change']); if (/^chg-/.test(chg)) return { kind: 'change', id: chg };
  return null;
}

/** A source string in plain words (chat titles, decisions lines, pending ids…). */
export function sourceLabel(s) {
  const str = String(s ?? '');
  const i = str.indexOf(':');
  const kind = i > 0 ? str.slice(0, i) : '';
  const rest = i > 0 ? str.slice(i + 1) : str;
  const names = { chat: 'Chat', git: 'Commit', pending: 'Pending list', 'hub-pending': 'Pending list (hub)', 'pending-artifact': 'Pending Builds page', changes: 'Change log', orchestrator: 'Orchestrator', threads: 'Threads', memory: 'Memory', rules: 'Rules', branch: 'Branch', matrix: 'Feature matrix', hub: 'axHub' };
  if (str.startsWith('decisions.md')) return { kind: 'Decisions', text: str.replace(/^decisions\.md#?/, 'line ').replace('line L', 'line ') };
  return { kind: names[kind] ?? (kind || 'Source'), text: rest };
}

/* ------------------------------------------------------------------ formatting */

export function fmtMinutes(n) {
  const m = Math.round(Number(n) || 0);
  if (!m) return '';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
export function fmtHours(n) {
  const h = (Number(n) || 0) / 60;
  return h >= 10 ? `${Math.round(h).toLocaleString('en-US')} h` : `${h.toFixed(1)} h`;
}
export function fmtCost(n, { whole = false } = {}) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return whole || v >= 100 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2)}`;
}
