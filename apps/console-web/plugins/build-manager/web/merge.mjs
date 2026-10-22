/**
 * Build manager — the merge, timing, totals and live-link logic, pure and IO-free so the console view, the banner and
 * the node self-test (test.mjs) compute the same thing. Nothing here fetches or names another plugin.
 *
 * Inputs (all optional, each degrades to "nothing from that source"):
 *   pending    pending@1 items as the API returns them (framework/plan/pending.json). Read tolerantly: sub prompts may
 *              carry {estimate?, done?, doneAt?} and the item `estimate?` (the step fields arrive from a parallel branch).
 *   queue      computeQueue(...) view (framework/plan/build-queue-core.mjs).
 *   queueState build-queue@1 state: StepRecord.estimate? and StepRecord.steps?: [{text, estimate?, done?, doneAt?}].
 *   features   plan features (framework/plan/plan.json): unbuilt features no epic covers become "Plan" rows; epics
 *              are already queue steps. Optional `estimate` / `steps` on a feature are read the same way.
 *   helpers    { estimateMinutes, formatMinutes } from pending-core (one parser for every estimate string).
 *
 * No double counting: one row per build. A pending item linked to a plan epic/feature (planId) wins over the queue
 * step or plan feature with that id (the row notes the queue position). Plan features linked to an epic belong to that
 * queue step and are listed inside it, never as their own rows.
 *
 * Small steps rule (Oct 21 2026): a build over 30 minutes without steps is flagged "needs split".
 */

export const SOURCES = ['pending', 'queue', 'plan'];
export const SOURCE_LABEL = { pending: 'Pending', queue: 'Queue', plan: 'Plan' };
/**
 * Who added a build (Brett, Oct 22 2026: filter "added automatically" vs "added from a user prompt").
 * `prompt` = a person asked for it: a pending item whose `source` says it came from a chat or Claude Code session,
 * the console's Add form or the claude.ai page. Everything else is `auto`: pending items parked by tools
 * (fable-rebuilds, feature-assist, plan sync, …, or no source at all), every build-queue step and every plan feature.
 */
export const ORIGINS = ['prompt', 'auto'];
export const ORIGIN_LABEL = { prompt: 'From a prompt', auto: 'Added automatically' };
export const PROMPT_SOURCES = ['chat', 'claude-code', 'console', 'artifact'];
export const originOf = (source, addedBy) => (source === 'pending' && PROMPT_SOURCES.includes(str(addedBy).toLowerCase()) ? 'prompt' : 'auto');
export const MODELS = ['Fable', 'Opus', 'Sonnet'];
export const SORTS = ['order', 'left', 'model'];
export const SORT_LABEL = { order: 'Build order', left: 'Time left', model: 'Model' };
export const SPLIT_LIMIT_MIN = 30;

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const modelName = (m) => { const s = str(m).toLowerCase(); return s.startsWith('fable') ? 'Fable' : s.startsWith('sonnet') ? 'Sonnet' : 'Opus'; };
/** ids compared loosely: `harvest/f-py-contracts` matches plan id `f.py.contracts`. */
export const normId = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const PENDING_OPEN = ['pending', 'unsafe', 'broken', 'failed'];
const PENDING_LABEL = { pending: 'Pending', unsafe: 'Unsafe', broken: 'Broken', failed: 'Failed' };
const QUEUE_OPEN = ['queued', 'active', 'blocked', 'rework'];
const QUEUE_LABEL = { queued: 'Queued', active: 'In progress', blocked: 'Blocked', rework: 'Needs rework' };
const PLAN_OPEN = ['planned', 'placeholder', 'partial', 'in-progress', 'blocked'];
const PLAN_LABEL = { planned: 'Planned', placeholder: 'Placeholder', partial: 'Partial', 'in-progress': 'In progress', blocked: 'Blocked' };
const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Steps from any source, tolerant of the fields that may not exist yet. */
function readSteps(list, h) {
  return (Array.isArray(list) ? list : []).filter((s) => s && str(s.text).trim()).map((s) => {
    const estimateText = str(s.estimate).trim();
    return { text: str(s.text).trim(), estimate: h.estimateMinutes(estimateText), estimateText, done: s.done === true, doneAt: str(s.doneAt) };
  });
}

/**
 * Timing of one build. total = its own estimate, else its steps added up. left = total minus the done steps (a done
 * step without its own estimate counts as an equal share). null when nothing gives a time ("no estimate").
 */
export function timing(ownEstimate, steps, h) {
  const own = h.estimateMinutes(str(ownEstimate));
  const known = steps.map((s) => s.estimate).filter((n) => n != null);
  const total = own ?? (known.length ? sum(known) : null);
  const done = steps.filter((s) => s.done).length;
  let left = null;
  if (total != null) {
    if (!steps.length) left = total;
    else if (done === steps.length) left = 0;
    else left = Math.max(0, Math.round(total - sum(steps.filter((s) => s.done).map((s) => s.estimate ?? total / steps.length))));
  }
  return {
    total, left, stepsDone: done, stepsTotal: steps.length,
    needsSplit: total != null && total > SPLIT_LIMIT_MIN && steps.length === 0,
    estimateText: own != null ? str(ownEstimate).trim() : total != null ? h.formatMinutes(total) : '',
  };
}

/* ---------- already built or removed (the Clean up button) ---------- */

export const GONE_LABEL = { built: 'Already built', removed: 'Removed' };
const goneOf = (g) => (g ? { gone: g } : {});

/** Built when every listed feature is built (an empty list says nothing). */
function featuresBuilt(list, why) {
  const fs = (list ?? []).filter((f) => f && f.status !== 'dropped');
  return fs.length && fs.every((f) => f.status === 'built') ? { kind: 'built', why } : null;
}

/** A pending item whose plan entry is built, dropped or gone, or whose every step is ticked. */
function pendingGone(p, t, byFeature) {
  if (p.planId) {
    const f = byFeature.get(p.planId);
    if (byFeature.size && !f) return { kind: 'removed', why: `its plan entry ${p.planId} is no longer in the plan` };
    if (f?.status === 'built') return { kind: 'built', why: `the plan says ${p.planId} is built` };
    if (f?.status === 'dropped') return { kind: 'removed', why: `${p.planId} was dropped from the plan` };
  }
  if (t.stepsTotal > 0 && t.stepsDone === t.stepsTotal) return { kind: 'built', why: 'every step is ticked' };
  return null;
}

/** Rows the list thinks are already built or removed. */
export const goneRows = (rows) => rows.filter((r) => r.gone);

/**
 * The console writes that take one row off the list. how = 'built' | 'removed'.
 *   pending  built → status complete (keeps it, with builtAt) · removed → remove the item
 *   queue    built → build-queue/step complete (its features become built too) · removed → epic status dropped
 *   plan     the feature's status → built | dropped (needs the feature as the plan holds it)
 */
export function takeOffRequests(row, how, feature) {
  const note = how === 'built' ? 'Taken off the build list as already built (Build manager)' : 'Taken off the build list as removed (Build manager)';
  if (how !== 'built' && how !== 'removed') return [];
  if (row?.source === 'pending') return [{ path: 'pending', body: how === 'built' ? { action: 'status', id: row.id, status: 'complete' } : { action: 'remove', id: row.id } }];
  if (row?.source === 'queue') return [{ path: 'build-queue/step', body: how === 'built' ? { id: row.id, action: 'complete', note } : { id: row.id, action: 'status', status: 'dropped', note } }];
  if (row?.source === 'plan' && feature?.id === row.id) return [{ path: 'plan/feature', body: { feature: { ...feature, status: how === 'built' ? 'built' : 'dropped' }, note } }];
  return [];
}

/** The moment a plan item was started (its last "Build started …" history line), or 0. */
function startedAt(feature) {
  const hit = [...(feature?.history ?? [])].reverse().find((x) => /\bstarted\b/i.test(str(x?.text)));
  const t = hit ? Date.parse(hit.at) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

export function buildRows({ pending = [], queue = null, queueState = null, features = [] } = {}, h) {
  const rows = [];
  const byFeature = new Map(features.map((f) => [f.id, f]));
  const openPending = pending.filter((p) => p && PENDING_OPEN.includes(p.status));
  const claimed = new Map(openPending.filter((p) => p.planId).map((p) => [p.planId, p.id]));
  const queuePos = new Map((queue?.steps ?? []).map((s) => [s.id, s.position]));
  const linkedBuilding = (planId) => !!planId && byFeature.get(planId)?.status === 'in-progress';
  // A complete pending item linked to a queue step / plan feature means that one was built too.
  const completeFor = new Map(pending.filter((p) => p && p.status === 'complete' && p.planId).map((p) => [p.planId, p.id]));
  const completedBy = (id) => (completeFor.has(id) ? { kind: 'built', why: `pending item ${completeFor.get(id)} is complete` } : null);

  // 1. Pending items not complete (Fable items are the Fable rebuilds).
  const pendingOrder = [...openPending].sort((a, b) => PENDING_OPEN.indexOf(a.status) - PENDING_OPEN.indexOf(b.status) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || str(a.title).localeCompare(str(b.title)));
  pendingOrder.forEach((p, i) => {
    const steps = readSteps(p.subPrompts, h);
    const t = timing(p.estimate, steps, h);
    const model = modelName(p.model);
    rows.push({
      key: `pending:${p.id}`, id: str(p.id), source: 'pending', title: str(p.title) || p.id, detail: str(p.detail), model,
      origin: originOf('pending', p.source), addedBy: str(p.source),
      status: p.status, statusLabel: PENDING_LABEL[p.status] ?? p.status, order: i, steps, ...t,
      ...(p.planId ? { planId: str(p.planId) } : {}),
      ...(p.planId && queuePos.has(p.planId) ? { queuePosition: queuePos.get(p.planId) } : {}),
      fable: model === 'Fable', building: linkedBuilding(p.planId), startedAt: linkedBuilding(p.planId) ? startedAt(byFeature.get(p.planId)) : 0,
      aliases: [p.id, p.planId, `${p.id}-fable`].filter(Boolean), ...goneOf(pendingGone(p, t, byFeature)),
    });
  });

  // 2. Build-queue steps not done (rework counts: it still has to be built again).
  for (const s of queue?.steps ?? []) {
    if (!QUEUE_OPEN.includes(s.state) || claimed.has(s.id)) continue;
    const rec = queueState?.steps?.[s.id] ?? {};
    const steps = readSteps(rec.steps, h);
    const t = timing(rec.estimate, steps, h);
    const epic = byFeature.get(s.id);
    const building = epic?.status === 'in-progress';
    rows.push({
      key: `queue:${s.id}`, id: s.id, source: 'queue', title: s.title, detail: str(s.summary), model: modelName(s.model), origin: 'auto', addedBy: 'build queue',
      status: s.state, statusLabel: s.state === 'active' && epic?.status === 'partial' ? 'Partial' : QUEUE_LABEL[s.state] ?? s.state,
      order: 1000 + s.position, queuePosition: s.position, steps, ...t, effort: str(s.effort),
      features: (s.features ?? []).map((f) => ({ id: f.id, title: f.title, status: f.status })),
      building, startedAt: building ? startedAt(epic) : 0, fable: false, aliases: [s.id],
      ...goneOf(featuresBuilt(s.features, 'every plan feature in this step is built') ?? completedBy(s.id)),
    });
  }

  // 3. Plan features nothing else covers: not built, no epic (feature.epic / epic.catalog), not claimed by a pending item.
  const epics = features.filter((f) => f.kind === 'epic');
  const covered = new Set();
  for (const e of epics) { covered.add(e.id); for (const c of e.catalog ?? []) covered.add(c); }
  const epicIds = new Set(epics.map((e) => e.id));
  features.forEach((f, i) => {
    if (f.kind === 'epic' || !PLAN_OPEN.includes(f.status)) return;
    if (covered.has(f.id) || (f.epic && epicIds.has(f.epic)) || claimed.has(f.id)) return;
    const steps = readSteps(f.steps, h);
    const t = timing(f.estimate, steps, h);
    const building = f.status === 'in-progress';
    rows.push({
      key: `plan:${f.id}`, id: f.id, source: 'plan', title: f.title || f.id, detail: str(f.summary), model: modelName(f.model), origin: 'auto', addedBy: 'plan',
      status: f.status, statusLabel: PLAN_LABEL[f.status] ?? f.status,
      order: 100000 + (Number(f.wave) || 9) * 1000 + (PRIORITY[f.priority] ?? 3) * 100 + i / 1000, steps, ...t,
      building, startedAt: building ? startedAt(f) : 0, fable: false, aliases: [f.id],
      ...goneOf(featuresBuilt((f.catalog ?? []).map((c) => byFeature.get(c)).filter(Boolean), 'everything it lists in the catalog is built') ?? completedBy(f.id)),
    });
  });
  return rows;
}

/** Time left per model (+ how many builds have no estimate), and the grand total. */
export function totalsByModel(rows) {
  const out = Object.fromEntries(MODELS.map((m) => [m, { left: 0, count: 0, noEstimate: 0, needsSplit: 0 }]));
  const all = { left: 0, count: 0, noEstimate: 0, needsSplit: 0 };
  for (const r of rows) {
    for (const t of [out[r.model] ?? (out[r.model] = { left: 0, count: 0, noEstimate: 0, needsSplit: 0 }), all]) {
      t.count++;
      if (r.left == null) t.noEstimate++; else t.left += r.left;
      if (r.needsSplit) t.needsSplit++;
    }
  }
  return { ...out, all };
}

/** Filters: model ('' = any), sources (list), origins (list: who added it), status ('' = any), split (only "needs split"). */
export function filterRows(rows, { model = '', sources = SOURCES, origins = ORIGINS, status = '', split = false } = {}) {
  return rows.filter((r) => (!model || r.model === model) && sources.includes(r.source) && origins.includes(r.origin ?? 'auto')
    && (!status || r.status === status) && (!split || r.needsSplit));
}

export function sortRows(rows, key = 'order') {
  const byOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title);
  const cmp = {
    order: byOrder,
    // shortest first (quick wins); no estimate last
    left: (a, b) => (a.left == null) - (b.left == null) || (a.left ?? 0) - (b.left ?? 0) || byOrder(a, b),
    model: (a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || byOrder(a, b),
  }[key] ?? byOrder;
  return [...rows].sort(cmp);
}

/** Statuses present in the rows, for the status filter. */
export function statusesOf(rows) {
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.status)) seen.set(r.status, r.statusLabel);
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

/* ---------------- live tracker ---------------- */

const ACTIVE = ['queued', 'running', 'waiting'];
const BRANCH_RE = /\b(fable|rebuild|harvest|pilot)\/([A-Za-z0-9._-]+)/;

/** The build row an activity item is about: its branch (fable/<id>, rebuild/<id>, harvest/…, pilot/…) or a report naming it. */
export function linkRow(item, rows) {
  const text = `${str(item?.title)}\n${str(item?.detail)}\n${str(item?.id)}`;
  const index = new Map();
  for (const r of rows) for (const a of r.aliases ?? [r.id]) { const n = normId(a); if (n && !index.has(n)) index.set(n, r); }
  const m = BRANCH_RE.exec(text);
  if (m) {
    const b = normId(m[2]);
    const hit = index.get(b) ?? index.get(`${b}-fable`) ?? index.get(`${b}-plugin`) ?? index.get(b.replace(/-(fable|plugin)$/, ''));
    if (hit) return { row: hit, via: `${m[1]}/${m[2]}` };
  }
  const hay = `-${normId(text)}-`;
  let best = null;
  for (const [n, r] of index) if (n.length >= 5 && hay.includes(`-${n}-`) && (!best || n.length > best.n.length)) best = { n, r };
  return best ? { row: best.r, via: 'named in the report' } : null;
}

/**
 * Everything building right now: activity items (linked to their build row when ids match) plus build rows marked
 * in progress that no activity item covers. Each entry: elapsed vs estimate, current step, progress (0..1 or null).
 */
export function liveEntries(activity, rows, now = Date.now()) {
  const out = [];
  const linked = new Set();
  for (const it of activity ?? []) {
    if (!it || !it.id) continue;
    const l = linkRow(it, rows);
    if (l) linked.add(l.row.key);
    out.push(entry({
      id: `act:${it.id}`, title: str(it.title), state: ACTIVE.includes(it.state) ? 'running' : str(it.state) || 'running', activityState: str(it.state),
      startedAt: Number(it.startedAt) || now, finishedAt: Number(it.finishedAt) || 0, url: str(it.url), source: str(it.source),
      runningStep: (it.steps ?? []).filter((s) => s.state === 'running').pop()?.name ?? '', progress: typeof it.progress === 'number' ? it.progress : null,
      row: l?.row ?? null, via: l?.via ?? '',
    }, now));
  }
  for (const r of rows) {
    if (!r.building || linked.has(r.key)) continue;
    out.push(entry({ id: `row:${r.key}`, title: r.title, state: 'running', activityState: 'running', startedAt: r.startedAt || 0, finishedAt: 0, url: '', source: r.source, runningStep: '', progress: null, row: r, via: 'marked in progress' }, now));
  }
  return out;
}

function entry(e, now) {
  const r = e.row;
  const estimate = r ? (r.left != null && r.left > 0 ? r.left : r.total) : null;
  const end = e.finishedAt || now;
  const elapsed = e.startedAt ? Math.max(0, end - e.startedAt) : null;
  const nextStep = r?.steps?.find((s) => !s.done)?.text ?? '';
  let progress = e.progress;
  if (progress == null && estimate && elapsed != null) progress = Math.min(0.99, elapsed / (estimate * 60_000));
  if (progress == null && r?.stepsTotal) progress = r.stepsDone / r.stepsTotal;
  return { ...e, estimate, elapsed, currentStep: e.runningStep || nextStep, progress, over: estimate && elapsed != null ? Math.max(0, Math.round(elapsed / 60_000 - estimate)) : 0 };
}

/** Is this entry about something on the build list (the banner shows only those)? */
export const onBuildList = (e) => !!e.row;

/* ---------- step ticks (small-steps rule: pending sub prompts + build-queue steps) ---------- */

/**
 * The console route and body that tick one step of a row, or null for rows without tickable steps.
 * Pending: `POST /api/pending {action:'step', id, index, done}` (pending-core `apply`).
 * Queue: `POST /api/build-queue/steps {id, index, done}` (build-queue-core `stepsAction`; `/build-queue/step` is the
 * epic start/complete/reopen route, not the small steps).
 */
export function tickRequest(row, index, done) {
  if (row?.source === 'pending') return { path: 'pending', body: { action: 'step', id: row.id, index, done: !!done } };
  if (row?.source === 'queue') return { path: 'build-queue/steps', body: { id: row.id, index, done: !!done } };
  return null;
}

/**
 * Whether the shared cores this console ships can tick steps, tried on a throwaway state (so an older console that
 * lacks the step actions shows ticks read-only instead of failing). Pass the pending and build-queue cores.
 */
export function probeTicks(pendingCore, queueCore) {
  let pending = false, queue = false;
  try {
    const s = { $axf: 'pending@1', updatedAt: '', artifact: '', items: [{ id: 'probe', title: 'probe', subPrompts: [{ text: 'a', at: '' }] }] };
    const r = pendingCore.apply(s, { action: 'step', id: 'probe', index: 0, done: true });
    pending = r?.item?.subPrompts?.[0]?.done === true;
  } catch { pending = false; }
  try {
    const f = [{ id: 'probe', title: 'probe', kind: 'epic', status: 'planned' }];
    const qs = { ...queueCore.emptyQueue(), steps: { probe: { steps: [{ text: 'a' }] } } };
    const q = queueCore.stepsAction(f, qs, { id: 'probe', index: 0, done: true });
    queue = q?.steps?.probe?.steps?.[0]?.done === true;
  } catch { queue = false; }
  return { canTickPending: pending, canTickQueue: queue };
}
