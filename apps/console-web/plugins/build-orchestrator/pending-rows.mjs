/**
 * Pending rows (pending-rows-view@1; build pending-tab-one-collapsed-row-per-2, Brett, Nov 15 2026: "Why are pending
 * builds not 1 expandable row"). Pure: no file, network or DOM access, so the console page, the CLI
 * (orchestrator.mjs pending …), the server routes (GET pending/rows, POST pending/rows/<id>/expand|collapse|toggle,
 * POST pending/rows/collapse-all) and the tests share one set of rules.
 *
 *   summarize(row, { now, notes })   one pending build as its collapsed row: title, status label, why it is pending,
 *                                    priority, steps done/total, age (+ the said line, steps and notes for the body)
 *   whyPending(row)                  the one reason a build sits in Pending, in plain words
 *   viewerKey(viewer)                the storage key of a viewer's expanded set (viewer = hub user or session id)
 *   expand / collapse / toggle / collapseAll(view, viewer, id?)   the next view state (never mutates)
 *   expandedFor(view, viewer)        the viewer's expanded build ids
 *   rowsFor(rows, view, viewer, opts)   every summary plus its `expanded` flag
 *
 * The view state is { $axf: 'pending-rows-view@1', viewers: { <key>: { expanded: [id…], at } } }, one file in the
 * plugin's data dir. A viewer's set only ever holds ids; ids of builds that left Pending are dropped on the next write.
 */
import { STATUS_LABEL } from './web/orchestrator-core.mjs';

export const SCHEMA = 'pending-rows-view@1';
export const MAX_VIEWERS = 200;
export const MAX_EXPANDED = 200;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

export const emptyView = () => ({ $axf: SCHEMA, viewers: {} });

/** A view state read from disk (or anything): always the right shape, junk dropped. */
export function normView(raw) {
  const out = emptyView();
  const v = raw && typeof raw === 'object' && raw.viewers && typeof raw.viewers === 'object' ? raw.viewers : {};
  for (const [k, x] of Object.entries(v)) {
    if (!/^viewer:[a-z0-9._@-]{1,80}$/.test(k) || !x || typeof x !== 'object') continue;
    const ids = Array.isArray(x.expanded) ? [...new Set(x.expanded.filter((i) => typeof i === 'string' && ID_RE.test(i)))].slice(0, MAX_EXPANDED) : [];
    out.viewers[k] = { expanded: ids, at: str(x.at, 40) };
  }
  return out;
}

/** The storage key of a viewer (hub user name, session or console id): lower case, safe characters, `viewer:` prefix. */
export function viewerKey(viewer) {
  const v = str(viewer, 200).trim().toLowerCase().replace(/[^a-z0-9._@-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `viewer:${v || 'console'}`;
}

export const isBuildId = (id) => typeof id === 'string' && ID_RE.test(id);

export function expandedFor(view, viewer) { return [...(normView(view).viewers[viewerKey(viewer)]?.expanded ?? [])]; }

function withSet(view, viewer, fn, now) {
  const v = normView(view);
  const key = viewerKey(viewer);
  const next = fn(v.viewers[key]?.expanded ?? []).slice(-MAX_EXPANDED);
  v.viewers[key] = { expanded: next, at: str(now, 40) };
  // the oldest viewers go first when there are too many
  const keys = Object.keys(v.viewers);
  if (keys.length > MAX_VIEWERS) for (const k of keys.sort((a, b) => v.viewers[a].at.localeCompare(v.viewers[b].at)).slice(0, keys.length - MAX_VIEWERS)) delete v.viewers[k];
  return v;
}
const need = (id) => { if (!isBuildId(id)) throw Object.assign(new Error(`bad build id "${str(id, 80)}"`), { code: 2 }); return id; };

export const expand = (view, viewer, id, now = new Date().toISOString()) => { need(id); return withSet(view, viewer, (s) => (s.includes(id) ? s : [...s, id]), now); };
export const collapse = (view, viewer, id, now = new Date().toISOString()) => { need(id); return withSet(view, viewer, (s) => s.filter((x) => x !== id), now); };
export const toggle = (view, viewer, id, now = new Date().toISOString()) => { need(id); return withSet(view, viewer, (s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]), now); };
export const collapseAll = (view, viewer, now = new Date().toISOString()) => withSet(view, viewer, () => [], now);
/** Drop ids that are no longer pending from a viewer's set (kept tidy on every write). */
export const prune = (view, viewer, liveIds, now = new Date().toISOString()) => { const live = new Set(liveIds); return withSet(view, viewer, (s) => s.filter((x) => live.has(x)), now); };

/** The one reason a build sits in Pending, most pressing first. */
export function whyPending(row) {
  const r = row ?? {};
  const p = r.pipeline ?? {};
  if (r.needsApproval) return 'needs your upgrade approval';
  if (p.splitRequested) return 'splitting';
  if (!r.steps?.total) return 'no steps yet';
  if (r.needsSplit) return 'needs a split';
  if (p.lastRun?.outcome) return `back from a run (${str(p.lastRun.outcome, 60)})`;
  return 'waiting for Queue';
}

/** Age in plain words: "just now", "12 min", "5 h", "3 d". */
export function ageLabel(from, now = Date.now()) {
  const ms = (typeof now === 'number' ? now : Date.parse(now)) - Date.parse(from);
  if (!Number.isFinite(ms)) return '';
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** One pending build as its collapsed row (plus what the expanded body shows). `row` is pipeline.mjs row(b). */
export function summarize(row, { now = Date.now(), notes = [], said = '' } = {}) {
  const r = row ?? {};
  const status = str(r.status, 20) || 'pending';
  return {
    id: str(r.id, 120), title: str(r.title, 300) || str(r.id, 120), status, statusLabel: STATUS_LABEL[status] ?? status,
    why: whyPending(r), priority: str(r.priority, 10) || 'P2',
    steps: { done: Number(r.steps?.done) || 0, total: Number(r.steps?.total) || 0 },
    createdAt: str(r.createdAt, 40), age: ageLabel(r.createdAt, now),
    said: str(said || r.said, 2000), nextModel: str(r.nextModel, 20),
    stepList: (Array.isArray(r.stepList) ? r.stepList : []).map((s) => ({ id: str(s.id, 20), text: str(s.text, 200), model: str(s.model, 20), estimate: str(s.estimate, 20), done: !!s.done, skip: !!s.skip })),
    notes: (Array.isArray(notes) ? notes : []).slice(-5).map((n) => ({ text: str(n?.text, 600), at: str(n?.at, 40) })),
    actions: Array.isArray(r.actions) ? r.actions.filter((a) => typeof a === 'string') : [],
  };
}

/**
 * Every pending summary with the viewer's `expanded` flag, in the order given. `notes` = { <id>: [{text, at}] },
 * `said` = { <id>: full words } (the row's own `said` is the short subtitle).
 */
export function rowsFor(rows, view, viewer, { now = Date.now(), notes = {}, said = {} } = {}) {
  const open = new Set(expandedFor(view, viewer));
  return (Array.isArray(rows) ? rows : []).map((r) => ({ ...summarize(r, { now, notes: notes[r?.id] ?? [], said: said[r?.id] ?? '' }), expanded: open.has(r?.id) }));
}

/** The answer every interface gives (REST, MCP, CLI, voice): the viewer, its expanded ids and every row. */
export function answer(rows, view, viewer, opts = {}) {
  const list = rowsFor(rows, view, viewer, opts);
  return { ok: true, $axf: SCHEMA, viewer: viewerKey(viewer).slice(7), expanded: list.filter((r) => r.expanded).map((r) => r.id), count: list.length, rows: list };
}

/** One collapsed row as one plain line (the CLI and voice read this out). */
export function line(s) {
  return `${s.expanded ? '▾' : '▸'} ${s.title} · ${s.statusLabel}: ${s.why} · ${s.priority} · ${s.steps.done}/${s.steps.total} steps · ${s.age || '—'} [${s.id}]`;
}
