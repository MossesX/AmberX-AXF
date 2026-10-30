/**
 * Plan Studio core (plan@1, Oct 30 2026, Brett: "a planning studio to store and view all plans … really powerful").
 * Pure functions only (no fs, no DOM): the console page, the CLI (plans.mjs), the server (through the CLI), the AmberX
 * app and the tests all use this one file, so a plan means the same thing everywhere.
 *
 * A plan is one JSON document (plan@1) with a Markdown body. Every object keeps fields it doesn't know (a newer
 * writer's additions survive an older reader). Older shapes are migrated on read (plan@0 drafts, pending@1 items,
 * loose {name, description, tasks} notes); the first save writes plan@1.
 *
 * Categories are paths ("Framework > Docs"); the categories list holds every path, plans point at one. Effort and
 * cost are never typed in: they are summed from the steps (cost = minutes × the model's per-minute price).
 */

export const SCHEMA = 'plan@1';
export const HISTORY_SCHEMA = 'plan-history@1';
export const CATEGORIES_SCHEMA = 'plan-categories@1';
export const VIEWS_SCHEMA = 'plan-views@1';
export const TEMPLATES_SCHEMA = 'plan-templates@1';
export const SEP = ' > ';

export const STATUSES = [
  { id: 'idea', label: 'Idea', icon: 'sparkles', tone: '' },
  { id: 'draft', label: 'Draft', icon: 'edit', tone: '' },
  { id: 'parked', label: 'Parked', icon: 'clock', tone: 'warning' },
  { id: 'ready', label: 'Ready', icon: 'check', tone: 'accent' },
  { id: 'building', label: 'Building', icon: 'play', tone: 'accent' },
  { id: 'done', label: 'Done', icon: 'check-circle', tone: 'success' },
  { id: 'dropped', label: 'Dropped', icon: 'x', tone: 'danger' },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const MODELS = ['Fable', 'Opus', 'Sonnet'];
export const LINK_KINDS = ['depends', 'blocks', 'part-of', 'related', 'pr', 'branch', 'build', 'doc', 'url'];
export const ATTACH_KINDS = ['image', 'file', 'voice'];
export const FEATURE_STATES = ['have', 'partial', 'planned', 'idea'];
/** USD per working minute, from framework/schemas/model-pricing.json's heuristic (the CLI recomputes it from the file). */
export const PRICE_PER_MIN = { Fable: 0.275, Opus: 0.14, Sonnet: 0.07 };
/** The list sections of a plan (all string or {text,…} lists, edited the same way). */
export const LISTS = {
  requirements: { label: 'Requirements', item: 'text' },
  acceptance: { label: 'Acceptance checklist', item: 'check' },
  decisions: { label: 'Decisions', item: 'text' },
  questions: { label: 'Open questions', item: 'text' },
  risks: { label: 'Risks', item: 'text' },
  outOfScope: { label: 'Out of scope', item: 'text' },
};
export const LIST_IDS = Object.keys(LISTS);

const str = (v, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const nowIso = () => new Date().toISOString();

export function slug(s, max = 48) {
  const x = str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return x || 'plan';
}
/** A short random id part (ids must survive two sessions adding plans with the same title at once). */
export function rid(n = 6) { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }

/* ------------------------------------------------------------------ categories (paths) */

export function normPath(p) {
  const parts = (Array.isArray(p) ? p : str(p, 400).split(/\s*(?:>|\/|›|»)\s*/)).map((x) => str(x, 60).trim()).filter(Boolean);
  return parts.join(SEP);
}
export const pathParts = (p) => (normPath(p) ? normPath(p).split(SEP) : []);
export const parentPath = (p) => pathParts(p).slice(0, -1).join(SEP);
export const leafName = (p) => pathParts(p).slice(-1)[0] ?? '';
const under = (p, root) => p === root || p.startsWith(root + SEP);

/** Every path and all its parents, sorted, no duplicates. */
export function withParents(paths) {
  const out = new Set();
  for (const p of paths) { const parts = pathParts(p); for (let i = 1; i <= parts.length; i += 1) out.add(parts.slice(0, i).join(SEP)); }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function normCategories(doc) {
  const d = obj(doc);
  return { ...d, $axf: CATEGORIES_SCHEMA, paths: withParents(arr(d.paths).map(normPath).filter(Boolean)) };
}

/** Category tree: [{path, name, children, count, total}] (count = plans right here, total = with every sub-category). */
export function categoryTree(paths, plans = []) {
  const all = withParents([...paths, ...plans.map((p) => p.category).filter(Boolean)]);
  const nodes = new Map();
  const roots = [];
  for (const p of all) {
    const n = { path: p, name: leafName(p), children: [], count: 0, total: 0 };
    nodes.set(p, n);
    const par = parentPath(p);
    if (par && nodes.has(par)) nodes.get(par).children.push(n); else roots.push(n);
  }
  for (const pl of plans) {
    const c = normPath(pl.category);
    if (!c || !nodes.has(c)) continue;
    nodes.get(c).count += 1;
    for (let q = c; q; q = parentPath(q)) if (nodes.has(q)) nodes.get(q).total += 1;
  }
  return roots;
}

/**
 * One Categories-editor change: add | rename | move | merge | remove. Returns {paths, plans (the changed ones), log}.
 * Plans follow their category: rename/move/merge rewrite every plan path under it; remove only takes an empty one.
 */
export function categoryOp(paths, plans, change) {
  const c = obj(change);
  let list = withParents(paths.map(normPath));
  const changed = [];
  const remap = (from, to) => {
    list = withParents(list.map((p) => (under(p, from) ? normPath(to + p.slice(from.length)) : p)).filter(Boolean));
    for (const pl of plans) {
      const cp = normPath(pl.category);
      if (cp && under(cp, from)) { changed.push({ ...pl, category: normPath(to + cp.slice(from.length)) }); }
    }
  };
  const path = normPath(c.path);
  switch (c.op) {
    case 'add': {
      const p = normPath(c.parent ? `${normPath(c.parent)}${SEP}${str(c.name, 60)}` : c.path || c.name);
      if (!p) throw new Error('a category name is needed');
      if (list.includes(p)) throw new Error(`"${p}" is already there`);
      list = withParents([...list, p]);
      return { paths: list, plans: [], log: [`added ${p}`] };
    }
    case 'rename': {
      if (!list.includes(path)) throw new Error(`no category "${path}"`);
      const name = str(c.name, 60).trim().replace(/[>/›»]/g, '-');
      if (!name) throw new Error('a new name is needed');
      const to = normPath([...pathParts(path).slice(0, -1), name]);
      if (to !== path && list.includes(to)) throw new Error(`"${to}" is already there: merge instead`);
      remap(path, to);
      return { paths: list, plans: changed, log: [`renamed ${path} → ${to}`] };
    }
    case 'move': {
      if (!list.includes(path)) throw new Error(`no category "${path}"`);
      const into = normPath(c.into);
      if (into && under(into, path)) throw new Error('a category cannot move inside itself');
      const to = normPath(into ? `${into}${SEP}${leafName(path)}` : leafName(path));
      if (to !== path && list.includes(to)) throw new Error(`"${to}" is already there: merge instead`);
      remap(path, to);
      return { paths: list, plans: changed, log: [`moved ${path} → ${to}`] };
    }
    case 'merge': {
      const into = normPath(c.into);
      if (!list.includes(path) || !into) throw new Error('merge needs two categories');
      if (under(into, path)) throw new Error('a category cannot merge into its own sub-category');
      remap(path, into);
      return { paths: list, plans: changed, log: [`merged ${path} into ${into}`] };
    }
    case 'remove': {
      if (plans.some((pl) => under(normPath(pl.category), path))) throw new Error(`"${path}" still has plans: move or merge them first`);
      list = list.filter((p) => !under(p, path));
      return { paths: list, plans: [], log: [`removed ${path}`] };
    }
    default: throw new Error(`unknown category change "${c.op}"`);
  }
}

/* ------------------------------------------------------------------ plan@1: normalize + migrate */

export function minutesOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const s = str(v).toLowerCase();
  if (!s) return 0;
  let m = 0, hit = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/g)) { hit = true; m += Number(n) * (u.startsWith('h') ? 60 : 1); }
  if (!hit && /^\d+(\.\d+)?$/.test(s.trim())) m = Number(s);
  return Math.round(m);
}
export function normModel(m) {
  const s = str(m).toLowerCase();
  return s.includes('fable') ? 'Fable' : s.includes('sonnet') ? 'Sonnet' : s.includes('opus') ? 'Opus' : '';
}
const normStatus = (s) => {
  const x = str(s).toLowerCase();
  const alias = { pending: 'parked', queued: 'ready', held: 'parked', 'in-progress': 'building', running: 'building', complete: 'done', built: 'done', archived: 'dropped', removed: 'dropped', planned: 'parked' };
  return STATUS_IDS.includes(x) ? x : alias[x] ?? 'draft';
};
const normPriority = (p) => { const s = str(p).toUpperCase().replace(/\s/g, ''); return PRIORITIES.includes(s) ? s : /^[0-3]$/.test(s) ? `P${s}` : 'P2'; };

function normStep(s, i) {
  const o = typeof s === 'string' ? { text: s } : obj(s);
  return {
    ...o,
    id: str(o.id, 40) || `s${i + 1}`,
    text: str(o.text ?? o.title ?? o.prompt, 2000).trim(),
    model: normModel(o.model) || 'Opus',
    minutes: minutesOf(o.minutes ?? o.estimate),
    dependsOn: arr(o.dependsOn ?? o.deps).map((x) => str(x, 40)).filter(Boolean),
    done: !!o.done,
    doneAt: o.done ? str(o.doneAt, 40) : '',
    phase: str(o.phase, 60),
  };
}
const normText = (x) => (typeof x === 'string' ? { text: x } : { ...obj(x), text: str(obj(x).text ?? obj(x).title, 2000) });
function normListItem(list, x) {
  const o = normText(x);
  if (list === 'acceptance') return { ...o, done: !!o.done };
  if (list === 'questions') return { ...o, answer: str(o.answer, 2000) };
  if (list === 'risks') return { ...o, mitigation: str(o.mitigation, 2000) };
  return o;
}
function normLink(l) {
  const o = typeof l === 'string' ? { kind: /^https?:/.test(l) ? 'url' : 'related', ref: l } : obj(l);
  const kind = LINK_KINDS.includes(o.kind) ? o.kind : 'related';
  return { ...o, kind, ref: str(o.ref ?? o.url ?? o.id, 600).trim(), label: str(o.label, 200) };
}
function normFeature(f) {
  const o = obj(f);
  return { ...o, entry: str(o.entry, 120), feature: str(o.feature, 160), title: str(o.title, 300), state: FEATURE_STATES.includes(o.state) ? o.state : 'planned' };
}
function normAttachment(a) {
  const o = obj(a);
  return { ...o, id: str(o.id, 40) || `a-${rid()}`, kind: ATTACH_KINDS.includes(o.kind) ? o.kind : 'file', name: str(o.name, 200), url: str(o.url, 2000), size: Number(o.size) || 0, transcript: str(o.transcript, 20000) };
}

/** Which old shape is this? plan@1 | plan@0 | pending@1 | loose */
export function detect(raw) {
  const o = obj(raw);
  if (o.$axf === SCHEMA) return 'plan@1';
  if (o.$axf === 'plan@0' || o.schema === 'plan@0') return 'plan@0';
  if (o.$axf === 'pending@1' || Array.isArray(o.subPrompts)) return 'pending@1';
  return 'loose';
}

/**
 * Any plan-ish object → plan@1 (migrations included). Unknown fields are kept. `opts.now` fixes timestamps (tests).
 * plan@0 (Oct 2026 drafts): {name, description, state, tasks:[{title, est, model, done}], notes, area}
 * pending@1 items: {id, title, detail, model, subPrompts:[{text, estimate, done}], notes:[{text}]}
 */
export function normalize(raw, opts = {}) {
  const at = opts.now ?? nowIso();
  const kind = detect(raw);
  let o = { ...obj(raw) };
  if (kind === 'plan@0') {
    const { name, description, state, tasks, notes, area, ...rest } = o;
    o = { ...rest, title: o.title ?? name, summary: o.summary ?? description, status: o.status ?? state, steps: o.steps ?? tasks, body: o.body ?? (Array.isArray(notes) ? notes.join('\n\n') : notes), category: o.category ?? area, migratedFrom: 'plan@0' };
  } else if (kind === 'pending@1') {
    const model = normModel(o.model) || 'Opus';
    o = {
      ...o, title: o.title, summary: str(o.detail, 600), body: o.body ?? str(o.detail, 20000), status: o.status && o.status !== 'pending' ? o.status : 'parked',
      steps: arr(o.subPrompts).map((p) => ({ ...obj(p), model: obj(p).model ?? model })),
      links: [...arr(o.links), ...(o.id ? [{ kind: 'related', ref: `pending:${o.id}`, label: 'Pending list item' }] : [])],
      comments: arr(o.notes).map((n) => ({ text: str(obj(n).text ?? n), at: str(obj(n).at) })),
      migratedFrom: 'pending@1',
    };
    delete o.subPrompts; delete o.detail; delete o.notes;
  } else if (kind === 'loose') {
    o = { ...o, title: o.title ?? o.name, summary: o.summary ?? o.description, steps: o.steps ?? o.tasks };
    delete o.name; delete o.description; delete o.tasks;
  }
  const title = str(o.title, 200).trim() || 'Untitled plan';
  const steps = arr(o.steps).map(normStep).filter((s) => s.text);
  const ids = new Set();
  for (const s of steps) { while (ids.has(s.id)) s.id = `${s.id}-${rid(3)}`; ids.add(s.id); }
  const lists = Object.fromEntries(LIST_IDS.map((k) => [k, arr(o[k]).map((x) => normListItem(k, x)).filter((x) => x.text.trim())]));
  const plan = {
    ...o,
    $axf: SCHEMA,
    id: str(o.id, 80) || `${slug(title)}-${rid(4)}`,
    title,
    summary: str(o.summary, 2000),
    goal: str(o.goal, 4000),
    why: str(o.why, 4000),
    category: normPath(o.category),
    tags: [...new Set(arr(o.tags).map((t) => str(t, 40).trim().toLowerCase()).filter(Boolean))],
    project: str(o.project, 80),
    touches: arr(o.touches).map((t) => (typeof t === 'string' ? { key: t } : { ...obj(t), key: str(obj(t).key, 160) })).filter((t) => t.key),
    profile: str(o.profile, 40),
    status: normStatus(o.status),
    priority: normPriority(o.priority),
    targetDate: /^\d{4}-\d{2}-\d{2}/.test(str(o.targetDate)) ? str(o.targetDate).slice(0, 10) : '',
    owner: str(o.owner, 80),
    steps,
    ...lists,
    links: arr(o.links).map(normLink).filter((l) => l.ref),
    features: arr(o.features).map(normFeature).filter((f) => f.entry && (f.feature || f.title)),
    attachments: arr(o.attachments).map(normAttachment),
    body: str(o.body, 200000),
    comments: arr(o.comments).map((c) => ({ ...obj(c), id: str(obj(c).id, 40) || `c-${rid()}`, by: str(obj(c).by, 80), at: str(obj(c).at, 40), text: str(obj(c).text, 4000) })).filter((c) => c.text),
    build: o.build && typeof o.build === 'object' ? { ...o.build, profile: str(o.build.profile, 40), id: str(o.build.id, 80) } : null,
    createdAt: str(o.createdAt, 40) || at,
    updatedAt: str(o.updatedAt, 40) || at,
    createdBy: str(o.createdBy, 80),
    version: Number.isInteger(o.version) && o.version > 0 ? o.version : 1,
  };
  if (!plan.build?.id) plan.build = null;
  const t = totals(plan, opts.prices);
  plan.effort = { minutes: t.minutes, left: t.left };
  plan.cost = { usd: t.cost, estimated: true };
  return plan;
}

/** Problems with a plan@1 document (strings; empty = valid). The JSON Schema says the same in schema/plan.schema.json. */
export function validate(p) {
  const out = [];
  const o = obj(p);
  if (o.$axf !== SCHEMA) out.push(`$axf must be "${SCHEMA}"`);
  if (!str(o.id) || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(o.id)) out.push('id: lowercase letters, digits, . _ - (up to 80)');
  if (!str(o.title).trim()) out.push('title is required');
  if (!STATUS_IDS.includes(o.status)) out.push(`status must be one of ${STATUS_IDS.join(', ')}`);
  if (!PRIORITIES.includes(o.priority)) out.push('priority must be P0–P3');
  for (const s of arr(o.steps)) {
    if (!MODELS.includes(s.model)) out.push(`step ${s.id}: model must be Fable, Opus or Sonnet`);
    for (const d of arr(s.dependsOn)) if (!arr(o.steps).some((x) => x.id === d)) out.push(`step ${s.id}: depends on unknown step ${d}`);
  }
  if (hasCycle(arr(o.steps))) out.push('steps: dependencies go round in a circle');
  for (const l of arr(o.links)) if (!LINK_KINDS.includes(l.kind)) out.push(`link ${l.ref}: unknown kind ${l.kind}`);
  return out;
}
function hasCycle(steps) {
  const by = new Map(steps.map((s) => [s.id, s]));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const d of by.get(id)?.dependsOn ?? []) if (by.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return steps.some((s) => visit(s.id));
}

/* ------------------------------------------------------------------ totals */

export function totals(plan, prices = PRICE_PER_MIN) {
  let minutes = 0, left = 0, cost = 0, done = 0;
  const models = {};
  for (const s of arr(plan.steps)) {
    const m = minutesOf(s.minutes ?? s.estimate);
    minutes += m; if (!s.done) left += m; else done += 1;
    const model = normModel(s.model) || 'Opus';
    cost += m * (prices[model] ?? PRICE_PER_MIN.Opus);
    models[model] = (models[model] ?? 0) + m;
  }
  const steps = arr(plan.steps).length;
  const acc = arr(plan.acceptance);
  return { minutes, left, cost: Math.round(cost * 100) / 100, steps, done, progress: steps ? Math.round((done / steps) * 100) : 0, models, acceptance: { total: acc.length, done: acc.filter((a) => a.done).length } };
}
export function fmtMinutes(m) {
  const n = Math.round(Number(m) || 0);
  if (!n) return '';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60), r = n % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export const fmtCost = (c) => (c ? `$${c >= 100 ? Math.round(c) : c.toFixed(2)}` : '');

/** Steps in an order that respects dependencies (stable otherwise). */
export function orderSteps(steps) {
  const by = new Map(steps.map((s) => [s.id, s]));
  const out = [], seen = new Set();
  const visit = (s, trail = new Set()) => {
    if (seen.has(s.id) || trail.has(s.id)) return;
    trail.add(s.id);
    for (const d of s.dependsOn ?? []) if (by.has(d)) visit(by.get(d), trail);
    seen.add(s.id); out.push(s);
  };
  for (const s of steps) visit(s);
  return out;
}

/* ------------------------------------------------------------------ versions + diff */

const SKIP_DIFF = new Set(['updatedAt', 'version', 'effort', 'cost']);
/** Field-by-field differences between two plans: [{path, from, to}] (lists compare by item). */
export function diff(a, b, base = '') {
  const out = [];
  const A = obj(a), B = obj(b);
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!base && SKIP_DIFF.has(k)) continue;
    const p = base ? `${base}.${k}` : k;
    const x = A[k], y = B[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (Array.isArray(x) || Array.isArray(y)) {
      const xs = arr(x), ys = arr(y);
      const key = (i) => (i && typeof i === 'object' ? i.id ?? i.text ?? i.ref ?? JSON.stringify(i) : String(i));
      const xm = new Map(xs.map((i) => [key(i), i])), ym = new Map(ys.map((i) => [key(i), i]));
      for (const [kk, i] of xm) if (!ym.has(kk)) out.push({ path: p, op: 'removed', from: i, to: undefined });
      for (const [kk, i] of ym) {
        if (!xm.has(kk)) out.push({ path: p, op: 'added', from: undefined, to: i });
        else if (JSON.stringify(xm.get(kk)) !== JSON.stringify(i)) out.push({ path: `${p}[${kk}]`, op: 'changed', from: xm.get(kk), to: i });
      }
      if (!out.some((d) => d.path.startsWith(p)) && xs.length === ys.length) out.push({ path: p, op: 'reordered', from: xs.map(key), to: ys.map(key) });
    } else if (x && y && typeof x === 'object' && typeof y === 'object') out.push(...diff(x, y, p));
    else out.push({ path: p, op: x === undefined ? 'added' : y === undefined ? 'removed' : 'changed', from: x, to: y });
  }
  return out;
}
export function describeDiff(d) {
  const show = (v) => (v == null ? '—' : typeof v === 'object' ? str(v.text ?? v.title ?? v.ref ?? JSON.stringify(v), 80) : str(v, 80));
  return d.map((x) => (x.op === 'added' ? `+ ${x.path}: ${show(x.to)}` : x.op === 'removed' ? `− ${x.path}: ${show(x.from)}` : x.op === 'reordered' ? `↕ ${x.path} reordered` : `~ ${x.path}: ${show(x.from)} → ${show(x.to)}`));
}

export function emptyHistory(id) { return { $axf: HISTORY_SCHEMA, id, versions: [] }; }
/**
 * Add a version (the plan as saved). Autosaves by the same person within `coalesceMin` replace the last autosave
 * instead of piling up. Keeps the newest `keep` versions. Returns the new history.
 */
export function addVersion(history, plan, meta = {}, { keep = 60, coalesceMin = 10 } = {}) {
  const h = { ...emptyHistory(plan.id), ...obj(history), versions: [...arr(obj(history).versions)] };
  const at = meta.at ?? nowIso();
  const last = h.versions[h.versions.length - 1];
  const entry = { v: (last?.v ?? 0) + 1, at, by: str(meta.by, 80), note: str(meta.note, 300), kind: str(meta.kind, 20) || 'save', plan };
  if (last && entry.kind === 'autosave' && last.kind === 'autosave' && last.by === entry.by && Date.parse(at) - Date.parse(last.at) < coalesceMin * 60000) {
    h.versions[h.versions.length - 1] = { ...entry, v: last.v };
  } else h.versions.push(entry);
  if (h.versions.length > keep) h.versions = h.versions.slice(-keep);
  return h;
}
/** The plan at version v, ready to save again as the newest (restore never deletes history). */
export function restoreVersion(history, v, current) {
  const e = arr(obj(history).versions).find((x) => x.v === Number(v));
  if (!e) throw new Error(`no version ${v}`);
  return { ...e.plan, version: (current?.version ?? e.plan.version ?? 1) + 1 };
}

/* ------------------------------------------------------------------ templates */

const T = (id, label, icon, fill) => ({ id, label, icon, builtIn: true, plan: fill });
export const BUILT_IN_TEMPLATES = [
  T('feature', 'Feature', 'sparkles', { status: 'draft', summary: '', goal: 'What someone can do once this is built.', requirements: ['Works on phone and desktop', 'Theme tokens only, framework controls'], acceptance: [{ text: 'Tests cover the new behaviour' }, { text: 'Screenshots desktop + phone' }], steps: [{ text: 'Contract / data shape', model: 'Opus', minutes: 20 }, { text: 'Build it', model: 'Opus', minutes: 30 }, { text: 'Tests + checks', model: 'Opus', minutes: 20 }] }),
  T('plugin', 'Plugin', 'package', { status: 'draft', category: 'Console > Plugins', requirements: ['plugin-lifecycle@1: code in its folder, data in its dataDir', 'Settings as a sub-tab of Settings → Plugins', 'App menu entry (menu.ts)'], acceptance: [{ text: 'install / uninstall --all leave nothing behind' }, { text: 'check-theme, check-controls, check-plugin-pages, menu-reach pass' }], steps: [{ text: 'plugin.json, install/uninstall/hooks', model: 'Opus', minutes: 15 }, { text: 'Server part', model: 'Opus', minutes: 25 }, { text: 'Web page', model: 'Opus', minutes: 30 }, { text: 'Tests + checks + screenshots', model: 'Opus', minutes: 25 }] }),
  T('app', 'App', 'grid', { status: 'draft', category: 'Apps', requirements: ['project.manifest.json (project-manifest@1)', 'Landing/loading screen + settings interface', 'axf init bake'], steps: [{ text: 'axf init + manifest', model: 'Opus', minutes: 20 }, { text: 'Screens', model: 'Opus', minutes: 30 }, { text: 'Deploy (Coolify)', model: 'Opus', minutes: 30 }] }),
  T('product', 'Product', 'star', { status: 'idea', category: 'Product', goal: 'Who buys it and why.', questions: [{ text: 'Price and plan?' }, { text: 'How is it installed?' }], risks: [{ text: 'Support load' }] }),
  T('fix', 'Fix', 'wrench', { status: 'ready', priority: 'P1', goal: 'What is broken, and what right looks like.', acceptance: [{ text: 'A test fails before the fix and passes after' }], steps: [{ text: 'Reproduce + test', model: 'Opus', minutes: 15 }, { text: 'Fix', model: 'Opus', minutes: 20 }] }),
  T('research', 'Research', 'search', { status: 'idea', goal: 'The question to answer.', outOfScope: ['Building anything'], steps: [{ text: 'Read + compare', model: 'Opus', minutes: 30 }, { text: 'Write up the answer', model: 'Opus', minutes: 15 }] }),
  T('refactor', 'Refactor', 'layers', { status: 'draft', why: 'What gets simpler.', requirements: ['No behaviour change', 'Fixtures unchanged (or regenerated on purpose)'], steps: [{ text: 'Map what moves', model: 'Fable', minutes: 20 }, { text: 'Move it', model: 'Fable', minutes: 30 }, { text: 'Tests before vs after', model: 'Opus', minutes: 20 }] }),
];
export function normTemplates(doc) {
  const d = obj(doc);
  return { ...d, $axf: TEMPLATES_SCHEMA, items: arr(d.items).map((t) => ({ ...obj(t), id: slug(obj(t).id || obj(t).label), label: str(obj(t).label, 80) || 'Template', icon: str(obj(t).icon, 40) || 'file', builtIn: false, plan: obj(obj(t).plan) })).filter((t) => t.id) };
}
export function allTemplates(user) { return [...BUILT_IN_TEMPLATES, ...normTemplates(user).items.filter((t) => !BUILT_IN_TEMPLATES.some((b) => b.id === t.id))]; }
/** A new plan from a template (template fields, then the caller's). */
export function fromTemplate(template, fields = {}, opts = {}) {
  const base = JSON.parse(JSON.stringify(obj(template?.plan)));
  const p = normalize({ ...base, ...fields, id: undefined, template: template?.id ?? '' }, opts);
  if (fields.id) p.id = fields.id;
  return p;
}
/** A plan as a user template (no ids, dates, history, build link). */
export function asTemplate(plan, label) {
  const { id, createdAt, updatedAt, version, build, comments, attachments, $axf, effort, cost, createdBy, ...rest } = plan;
  return { id: slug(label), label: str(label, 80), icon: 'file', plan: { ...rest, title: '', steps: rest.steps.map(({ done, doneAt, ...s }) => s) } };
}

/* ------------------------------------------------------------------ search, filters, sort, group, duplicates */

export function searchText(p) {
  return [p.title, p.summary, p.goal, p.why, p.category, p.tags.join(' '), p.project, p.profile, p.status, p.priority, p.owner, p.body,
    ...p.steps.map((s) => `${s.text} ${s.model}`), ...LIST_IDS.flatMap((k) => p[k].map((x) => `${x.text} ${x.answer ?? ''} ${x.mitigation ?? ''}`)),
    ...p.links.map((l) => `${l.ref} ${l.label}`), ...p.features.map((f) => `${f.entry} ${f.feature} ${f.title}`), ...p.touches.map((t) => t.key),
    ...p.comments.map((c) => c.text), ...p.attachments.map((a) => `${a.name} ${a.transcript}`)].join('\n').toLowerCase();
}
/** filter: {q, statuses[], priorities[], categories[] (a category includes its sub-categories), tags[], projects[], profiles[], models[], hasBuild} */
export function filterPlans(plans, f = {}) {
  const words = str(f.q).toLowerCase().split(/\s+/).filter(Boolean);
  const inList = (list, v) => !arr(list).length || arr(list).includes(v);
  return plans.filter((p) => {
    if (!inList(f.statuses, p.status) || !inList(f.priorities, p.priority) || !inList(f.projects, p.project) || !inList(f.profiles, p.profile)) return false;
    if (arr(f.categories).length && !f.categories.some((c) => under(p.category, normPath(c)))) return false;
    if (arr(f.tags).length && !f.tags.every((t) => p.tags.includes(t))) return false;
    if (arr(f.models).length && !p.steps.some((s) => f.models.includes(s.model))) return false;
    if (f.hasBuild === true && !p.build) return false;
    if (f.hasBuild === false && p.build) return false;
    if (words.length) { const t = searchText(p); if (!words.every((w) => t.includes(w))) return false; }
    return true;
  });
}
export const SORTS = [
  { id: 'updated', label: 'Last changed' }, { id: 'priority', label: 'Priority' }, { id: 'title', label: 'Title' },
  { id: 'status', label: 'Status' }, { id: 'target', label: 'Target date' }, { id: 'effort', label: 'Effort' }, { id: 'cost', label: 'Cost' }, { id: 'created', label: 'Created' },
];
export function sortPlans(plans, by = 'updated') {
  const cmp = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt), created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    priority: (a, b) => a.priority.localeCompare(b.priority) || b.updatedAt.localeCompare(a.updatedAt),
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    status: (a, b) => STATUS_IDS.indexOf(a.status) - STATUS_IDS.indexOf(b.status) || a.priority.localeCompare(b.priority),
    target: (a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'),
    effort: (a, b) => b.effort.minutes - a.effort.minutes, cost: (a, b) => b.cost.usd - a.cost.usd,
  }[by] ?? ((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...plans].sort(cmp);
}
export const GROUPS = [
  { id: 'category', label: 'Category' }, { id: 'status', label: 'Status' }, { id: 'project', label: 'Project' },
  { id: 'tag', label: 'Tag' }, { id: 'priority', label: 'Priority' }, { id: 'profile', label: 'Build profile' },
];
/** Sub-grids: [{id, label, plans}] (a plan with two tags shows in both tag groups). */
export function groupPlans(plans, by) {
  const groups = new Map();
  const put = (id, label, p) => { if (!groups.has(id)) groups.set(id, { id, label, plans: [] }); groups.get(id).plans.push(p); };
  for (const p of plans) {
    if (by === 'status') put(p.status, STATUSES.find((s) => s.id === p.status)?.label ?? p.status, p);
    else if (by === 'priority') put(p.priority, p.priority, p);
    else if (by === 'project') put(p.project || '-', p.project || 'No project', p);
    else if (by === 'profile') put(p.profile || '-', p.profile || 'No profile', p);
    else if (by === 'tag') { if (!p.tags.length) put('-', 'No tags', p); for (const t of p.tags) put(t, `#${t}`, p); }
    else put(p.category || "-", p.category || "Uncategorized", p);
  }
  const order = by === 'status' ? STATUS_IDS : by === 'priority' ? PRIORITIES : null;
  return [...groups.values()].sort((a, b) => (a.id === '-') - (b.id === '-') || (order ? order.indexOf(a.id) - order.indexOf(b.id) : a.label.localeCompare(b.label)));
}
export function counts(plans) {
  const by = (f) => plans.reduce((m, p) => { m[f(p)] = (m[f(p)] ?? 0) + 1; return m; }, {});
  const t = plans.reduce((m, p) => ({ minutes: m.minutes + p.effort.minutes, left: m.left + p.effort.left, cost: m.cost + p.cost.usd }), { minutes: 0, left: 0, cost: 0 });
  return { plans: plans.length, statuses: by((p) => p.status), priorities: by((p) => p.priority), ...t, cost: Math.round(t.cost * 100) / 100 };
}

const words = (s) => new Set(str(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(['the', 'and', 'for', 'with', 'plan', 'from', 'into', 'that', 'this', 'every', 'its', 'new', 'all']);
/** Plans that look like this one (title words overlap ≥ 0.6, or same title). Saving warns before it writes a duplicate. */
export function duplicates(plan, plans, threshold = 0.6) {
  const a = words(plan.title);
  return plans.filter((p) => p.id !== plan.id).map((p) => {
    const b = words(p.title);
    const inter = [...a].filter((w) => b.has(w)).length;
    const score = p.title.trim().toLowerCase() === plan.title.trim().toLowerCase() ? 1 : a.size && b.size ? inter / Math.min(a.size, b.size) : 0;
    return { plan: p, score: Math.round(score * 100) / 100 };
  }).filter((x) => x.score >= threshold).sort((x, y) => y.score - x.score);
}

/* ------------------------------------------------------------------ saved views */

export function normViews(doc) {
  const d = obj(doc);
  return { ...d, $axf: VIEWS_SCHEMA, items: arr(d.items).map((v) => ({ ...obj(v), id: slug(obj(v).id || obj(v).label), label: str(obj(v).label, 80) || 'View', layout: str(obj(v).layout, 20) || 'grid', filter: obj(obj(v).filter), sort: str(obj(v).sort, 20) || 'updated', group: str(obj(v).group, 20) })) };
}

/* ------------------------------------------------------------------ bulk actions */

/** One change to many plans: {status} | {priority} | {category} | {addTag} | {removeTag} | {profile}. Returns the changed plans. */
export function bulk(plans, ids, change) {
  const c = obj(change);
  return plans.filter((p) => ids.includes(p.id)).map((p) => {
    const q = { ...p, tags: [...p.tags] };
    if (c.status && STATUS_IDS.includes(c.status)) q.status = c.status;
    if (c.priority && PRIORITIES.includes(c.priority)) q.priority = c.priority;
    if (typeof c.category === 'string') q.category = normPath(c.category);
    if (typeof c.profile === 'string') q.profile = str(c.profile, 40);
    if (c.addTag) q.tags = [...new Set([...q.tags, str(c.addTag, 40).toLowerCase()])];
    if (c.removeTag) q.tags = q.tags.filter((t) => t !== str(c.removeTag).toLowerCase());
    return q;
  });
}

/* ------------------------------------------------------------------ roadmap */

/** Roadmap lanes by month of the target date (plans with no date sit in "No date"). */
export function roadmap(plans) {
  const lanes = new Map();
  for (const p of plans) {
    const k = p.targetDate ? p.targetDate.slice(0, 7) : '';
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(p);
  }
  return [...lanes.entries()].sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b)).map(([month, ps]) => ({ month, plans: sortPlans(ps, 'target') }));
}

/* ------------------------------------------------------------------ Markdown */

export function outline(md) {
  const out = [];
  let fence = false;
  for (const line of str(md, 200000).split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], id: slug(m[2], 60) });
  }
  return out;
}

const META_RE = /<!--\s*plan@1\s+([\s\S]*?)-->/;
/** A plan as Markdown a person can read (sections as headings, steps as a checklist) + the full JSON in one comment so import is exact. */
export function toMarkdown(p) {
  const lines = [`# ${p.title}`, ''];
  const meta = [`**Status:** ${p.status}`, `**Priority:** ${p.priority}`, p.category && `**Category:** ${p.category}`, p.project && `**Project:** ${p.project}`, p.profile && `**Build profile:** ${p.profile}`, p.targetDate && `**Target:** ${p.targetDate}`, p.owner && `**Owner:** ${p.owner}`, p.effort.minutes && `**Effort:** ${fmtMinutes(p.effort.minutes)} (${fmtCost(p.cost.usd)})`, p.tags.length && `**Tags:** ${p.tags.map((t) => `#${t}`).join(' ')}`].filter(Boolean);
  lines.push(meta.join(' · '), '');
  if (p.summary) lines.push(`> ${p.summary.replace(/\n/g, '\n> ')}`, '');
  if (p.goal) lines.push('## Goal', '', p.goal, '');
  if (p.why) lines.push('## Why', '', p.why, '');
  if (p.steps.length) {
    lines.push('## Steps', '');
    for (const s of p.steps) lines.push(`- [${s.done ? 'x' : ' '}] ${s.text} (${s.model}${s.minutes ? `, ${fmtMinutes(s.minutes)}` : ''}${s.dependsOn.length ? `, after ${s.dependsOn.join(', ')}` : ''})`);
    lines.push('');
  }
  for (const k of LIST_IDS) {
    if (!p[k].length) continue;
    lines.push(`## ${LISTS[k].label}`, '');
    for (const x of p[k]) lines.push(k === 'acceptance' ? `- [${x.done ? 'x' : ' '}] ${x.text}` : `- ${x.text}${x.answer ? ` — ${x.answer}` : ''}${x.mitigation ? ` (mitigation: ${x.mitigation})` : ''}`);
    lines.push('');
  }
  if (p.links.length) { lines.push('## Links', ''); for (const l of p.links) lines.push(`- ${l.kind}: ${/^https?:/.test(l.ref) ? `[${l.label || l.ref}](${l.ref})` : `${l.ref}${l.label ? ` (${l.label})` : ''}`}`); lines.push(''); }
  if (p.features.length) { lines.push('## Catalog features', ''); for (const f of p.features) lines.push(`- [${f.state === 'have' ? 'x' : ' '}] ${f.entry}: ${f.title || f.feature} (${f.state})`); lines.push(''); }
  if (p.body.trim()) lines.push('## Notes', '', p.body.trim(), '');
  const { effort, cost, ...json } = p;
  lines.push(`<!-- plan@1 ${JSON.stringify(json).replace(/--/g, '-\\u002d')} -->`, '');
  return lines.join('\n');
}

/**
 * Markdown → plan. With the plan@1 comment the plan comes back exactly; without it the headings are read: "# Title",
 * "## Steps" checklists ("(Opus, 20 min)"), "## Requirements" etc., everything else goes to the body.
 */
export function fromMarkdown(md, opts = {}) {
  const text = str(md, 400000);
  const m = META_RE.exec(text);
  if (m) { try { return normalize(JSON.parse(m[1].replace(/-\\u002d/g, '--')), opts); } catch { /* fall back to reading the headings */ } }
  const plan = { steps: [], body: '' };
  const lists = Object.fromEntries(LIST_IDS.map((k) => [k, []]));
  const byLabel = Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [v.label.toLowerCase(), k]));
  Object.assign(byLabel, { acceptance: 'acceptance', 'acceptance criteria': 'acceptance', questions: 'questions', 'open questions': 'questions', 'out of scope': 'outOfScope', 'non-goals': 'outOfScope', risks: 'risks', decisions: 'decisions', requirements: 'requirements' });
  let section = 'body';
  const body = [];
  for (const line of text.replace(META_RE, '').split('\n')) {
    const h1 = /^#\s+(.+)/.exec(line);
    if (h1 && !plan.title) { plan.title = h1[1].trim(); continue; }
    const h2 = /^##\s+(.+)/.exec(line);
    if (h2) {
      const name = h2[1].trim().toLowerCase().replace(/[:.]$/, '');
      section = /^(steps|build steps|plan|tasks)$/.test(name) ? 'steps' : name === 'goal' ? 'goal' : name === 'why' ? 'why' : name === 'summary' ? 'summary' : byLabel[name] ?? (name === 'notes' ? 'body' : 'body-h');
      if (section === 'body-h') { body.push(line); section = 'body'; }
      continue;
    }
    const sm = /^\s*(?:[-*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(line);
    if (section === 'steps' && sm) {
      const raw = sm[2];
      const paren = /\(([^()]*)\)\s*$/.exec(raw);
      const info = paren ? paren[1] : '';
      plan.steps.push({ text: (paren ? raw.slice(0, paren.index) : raw).replace(/\*\*/g, '').trim(), model: normModel(info) || normModel(raw) || 'Opus', minutes: minutesOf(info), done: !!sm[1] && sm[1] !== ' ' });
      continue;
    }
    if (lists[section] && sm) { lists[section].push(section === 'acceptance' ? { text: sm[2].trim(), done: !!sm[1] && sm[1] !== ' ' } : { text: sm[2].trim() }); continue; }
    if (['goal', 'why', 'summary'].includes(section)) { plan[section] = `${plan[section] ?? ''}${plan[section] ? '\n' : ''}${line}`.trim(); continue; }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote && !plan.summary && section === 'body' && !body.some((b) => b.trim())) { plan.summary = quote[1]; continue; }
    const st = /\*\*Status:\*\*\s*([a-z-]+)/i.exec(line);
    if (st && section === 'body' && !body.some((b) => b.trim())) {
      plan.status = st[1];
      const pr = /\*\*Priority:\*\*\s*(P[0-3])/i.exec(line); if (pr) plan.priority = pr[1];
      const ca = /\*\*Category:\*\*\s*([^·]+)/i.exec(line); if (ca) plan.category = ca[1].trim();
      continue;
    }
    body.push(line);
  }
  plan.body = body.join('\n').trim();
  return normalize({ ...plan, ...lists }, opts);
}

/* ------------------------------------------------------------------ Turn into a build (orchestrator@1) */

/** The orchestrator `add` change for a plan (steps in dependency order, each with its model and estimate). */
export function toBuild(plan, { profile, id } = {}) {
  const steps = orderSteps(plan.steps.filter((s) => !s.done));
  if (!steps.length) throw new Error('the plan has no steps left to build: add steps first');
  const buildId = slug(id || plan.id, 60);
  const detail = [
    plan.summary, plan.goal && `Goal: ${plan.goal}`, plan.why && `Why: ${plan.why}`,
    plan.requirements.length && `Requirements: ${plan.requirements.map((r) => r.text).join('; ')}`,
    plan.acceptance.length && `Done when: ${plan.acceptance.map((r) => r.text).join('; ')}`,
    plan.outOfScope.length && `Out of scope: ${plan.outOfScope.map((r) => r.text).join('; ')}`,
    `From Plan Studio plan ${plan.id}.`,
  ].filter(Boolean).join('\n');
  return {
    action: 'add', id: buildId, title: plan.title, category: pathParts(plan.category)[0] || 'Plans', detail, source: 'plan-studio', planId: plan.id, profile: profile || plan.profile || '',
    steps: steps.map((s) => ({ text: s.text, model: s.model, estimate: `${s.minutes || 20} min`, phase: s.phase || '', planStep: s.id })),
  };
}
/** The plan linked to its build (both ways: the build carries planId, the plan carries build + a build link). */
export function linkBuild(plan, { profile, id }, at = nowIso()) {
  const links = plan.links.filter((l) => !(l.kind === 'build' && l.ref === `${profile}:${id}`));
  return { ...plan, status: plan.status === 'done' ? 'done' : 'building', profile: profile || plan.profile, build: { profile, id, linkedAt: at, status: 'pending', progress: 0 }, links: [...links, { kind: 'build', ref: `${profile}:${id}`, label: 'Orchestrator build' }] };
}
/**
 * Bring a plan up to date with its orchestrator build (live progress). The build's steps tick the plan's steps
 * (matched by planStep, else by text). When the build is complete the plan is done and its planned features are have.
 * Returns {plan, changed}.
 */
export function syncBuild(plan, build) {
  if (!plan.build || !build) return { plan, changed: false };
  const bs = arr(build.steps);
  const done = bs.filter((s) => s.done || s.skip).length;
  const progress = bs.length ? Math.round((done / bs.length) * 100) : 0;
  const complete = build.status === 'complete' || (bs.length > 0 && done === bs.length);
  const steps = plan.steps.map((s) => {
    const b = bs.find((x) => x.planStep === s.id) ?? bs.find((x) => str(x.text).trim() === s.text.trim());
    return b && b.done && !s.done ? { ...s, done: true, doneAt: str(b.doneAt) || nowIso() } : s;
  });
  const next = {
    ...plan, steps,
    build: { ...plan.build, status: complete ? 'complete' : str(build.status) || plan.build.status, progress, title: str(build.title, 300), branch: str(build.branch, 200), pr: str(build.pr, 200) },
    status: complete ? 'done' : plan.status === 'done' ? 'done' : 'building',
    features: complete ? plan.features.map((f) => (f.state === 'planned' ? { ...f, state: 'have', haveAt: nowIso() } : f)) : plan.features,
  };
  if (build.pr && !next.links.some((l) => l.kind === 'pr' && l.ref === String(build.pr))) next.links = [...next.links, { kind: 'pr', ref: String(build.pr), label: 'Build PR' }];
  if (build.branch && !next.links.some((l) => l.kind === 'branch' && l.ref === build.branch)) next.links = [...next.links, { kind: 'branch', ref: build.branch, label: '' }];
  const changed = JSON.stringify(diff(plan, next)) !== '[]';
  return { plan: changed ? next : plan, changed };
}

/* ------------------------------------------------------------------ Catalog features on plans */

/** Catalog entries with their features, overlaid with what plans say (planned / have), counts and progress. */
export function overlayCatalog(entries, plans) {
  const byKey = new Map();
  for (const p of plans) for (const f of p.features) {
    const k = `${f.entry}#${f.feature || slug(f.title, 80)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ plan: p, f });
  }
  return entries.map((e) => {
    const feats = e.features.map((x) => {
      const hits = byKey.get(`${e.key}#${x.id}`) ?? [];
      const live = hits.find((h) => !['dropped'].includes(h.plan.status));
      if (!live) return x;
      const state = x.state === 'have' ? 'have' : live.f.state === 'have' ? 'have' : 'planned';
      return { ...x, state, plan: live.plan.id, planTitle: live.plan.title, build: live.plan.build ? `${live.plan.build.profile}:${live.plan.build.id}` : '' };
    });
    // features a plan adds that no source has yet (kept on the plan, shown as planned)
    for (const p of plans) for (const f of p.features) {
      if (f.entry !== e.key || p.status === 'dropped') continue;
      const id = f.feature || slug(f.title, 80);
      if (feats.some((x) => x.id === id)) continue;
      feats.push({ id, title: f.title || f.feature, state: f.state === 'have' ? 'have' : f.state === 'idea' ? 'idea' : 'planned', source: 'plan', plan: p.id, planTitle: p.title, build: p.build ? `${p.build.profile}:${p.build.id}` : '' });
    }
    const c = { have: 0, partial: 0, planned: 0, idea: 0 };
    for (const x of feats) c[x.state] = (c[x.state] ?? 0) + 1;
    const total = feats.length;
    const plansFor = plans.filter((p) => p.touches.some((t) => t.key === e.key) || p.features.some((f) => f.entry === e.key)).map((p) => p.id);
    return { ...e, features: feats, counts: c, total, progress: total ? Math.round(((c.have + c.partial * 0.5) / total) * 100) : 0, plans: plansFor };
  });
}
export const CATALOG_KINDS = [
  { id: 'plugin', label: 'Plugins', icon: 'package' }, { id: 'app', label: 'Apps', icon: 'grid' },
  { id: 'library', label: 'Libraries', icon: 'layers' }, { id: 'module', label: 'Framework modules', icon: 'cpu' }, { id: 'service', label: 'Services', icon: 'globe' },
];
/** filter: {q, kinds[], gaps (has planned/idea/partial), planned (has planned), profile, status} */
export function filterCatalog(entries, f = {}) {
  const ws = str(f.q).toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (arr(f.kinds).length && !f.kinds.includes(e.kind)) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.gaps && !(e.counts.planned + e.counts.idea + e.counts.partial > 0 || e.total === 0)) return false;
    if (f.planned && !e.counts.planned) return false;
    if (f.profile && e.profile && e.profile !== f.profile) return false;
    if (ws.length) { const t = `${e.name} ${e.key} ${e.description} ${e.features.map((x) => x.title).join(' ')}`.toLowerCase(); if (!ws.every((w) => t.includes(w))) return false; }
    return true;
  });
}
/** A plan pre-filled from one catalog feature ("Plan this"). */
export function planFromFeature(entry, feature, opts = {}) {
  const kindCat = { plugin: 'Console > Plugins', app: 'Apps', library: 'Framework > Libraries', module: 'Framework', service: 'Services' }[entry.kind] ?? 'Plans';
  return normalize({
    title: `${entry.name}: ${feature.title}`.slice(0, 200), status: 'draft', category: `${kindCat}${SEP}${entry.name}`,
    summary: `Plan the ${feature.state === 'partial' ? 'rest of the' : ''} "${feature.title}" feature of ${entry.name}.`.replace(/\s+/g, ' '),
    touches: [{ key: entry.key, name: entry.name }], features: [{ entry: entry.key, feature: feature.id, title: feature.title, state: 'planned' }],
    project: entry.project ?? '', template: 'feature',
  }, opts);
}

/* ------------------------------------------------------------------ the store document the page reads */

export function emptyState() { return { plans: [], categories: normCategories({}), templates: normTemplates({}), views: normViews({}) }; }
