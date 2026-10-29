/**
 * build-queue-core — the build queue's logic, pure and IO-free so the CLI, the console API, the MCP server and the
 * browser console all compute the same thing.  State lives in framework/plan/build-queue.json (build-queue@1):
 *
 *   { $axf, order: [epicId…], steps: { [epicId]: StepRecord }, dirty, updatedAt, history }
 *   StepRecord = { completedAt, completedBy, deps, rework, reopenedAt, estimate?, steps?: [{ text, estimate?, done?, doneAt? }] }
 *
 * Steps are the plan's epics; each step carries the catalog features linked to it (feature.epic === step, or listed in
 * epic.catalog). A step is "done" when its epic is `built`.
 *
 * Small steps for big builds (Oct 21 2026): a queue step estimated at more than 30 minutes carries `steps`, the pieces
 * of at most 30 minutes it is worked on in (same shape as a pending item's sub prompts: text, estimate, done, doneAt).
 * `splitCheck` from pending-core flags a big step without them; the console's Build manager shows progress.
 *
 * Rules
 *   order      done steps keep their place as history; remaining steps run in queue order. A remaining step that sits
 *              before an unfinished dependency is a violation → the console prompts to reprocess.
 *   reprocess  done steps first (unchanged order), then the remaining steps topologically sorted with the current
 *              order as the tie-break, so the user's order wins wherever dependencies allow.
 *   rework     a done step needs rework when (a) a dependency was completed or reworked after it, (b) its dependency
 *              list changed since it was completed, or (c) a dependency it was built on was reopened.
 *   sync       feature tracker → build: a step whose linked features are all built is completed; some built → partial.
 *              build → feature tracker: completing a step marks the epic and every linked feature built.
 */

import { estimateMinutes, formatMinutes, iso, itemEstimate, splitCheck, stepsProgress } from './pending-core.mjs';

export const MODEL_TIER = { fable: 3, opus: 2, sonnet: 1 };
export const MODEL_LABEL = { fable: 'Fable 5.1', opus: 'Opus 5.5', sonnet: 'Sonnet 5.5' };
const BASELINE = '1970-01-01T00:00:00.000Z';
const isDone = (f) => f?.status === 'built';

export function emptyQueue() { return { $axf: 'build-queue@1', order: [], steps: {}, dirty: false, updatedAt: '', history: [] }; }

export function stepState(epic, rec) {
  if (!epic) return 'missing';
  if (epic.status === 'dropped') return 'dropped';
  if (isDone(epic)) return rec?.rework ? 'rework' : 'done';
  if (epic.status === 'in-progress' || epic.status === 'partial') return 'active';
  if (epic.status === 'blocked') return 'blocked';
  return 'queued';
}

export function linkedFeatures(features, epic) {
  const ids = new Set(epic.catalog ?? []);
  return features.filter((f) => f.id !== epic.id && f.kind !== 'epic' && (f.epic === epic.id || ids.has(f.id)));
}

/** The model a whole step needs: the strongest of the epic's and its unfinished features' suggestions. */
export function stepModel(epic, feats) {
  let m = epic.model ?? 'opus', why = epic.modelReason ?? '';
  for (const f of feats) if (!isDone(f) && f.status !== 'dropped' && (MODEL_TIER[f.model] ?? 2) > (MODEL_TIER[m] ?? 2)) { m = f.model; why = `${f.title} needs ${MODEL_LABEL[f.model]}: ${f.modelReason ?? ''}`; }
  return { model: m, reason: why };
}

const rank = (f) => [f.status === 'dropped' ? 1 : 0, f.wave ?? 3, ({ P0: 0, P1: 1, P2: 2, P3: 3 })[f.priority] ?? 3];
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Kahn's algorithm over `ids`, honouring only dependencies inside `ids`; `prio(id)` breaks ties. Returns order + cycle members. */
function topo(ids, depsOf, prio) {
  const set = new Set(ids), placed = new Set(), out = [], cycles = [];
  const remaining = [...ids].sort((a, b) => prio(a) - prio(b));
  while (remaining.length) {
    let i = remaining.findIndex((id) => depsOf(id).every((d) => !set.has(d) || placed.has(d)));
    if (i < 0) { i = 0; cycles.push(remaining[0]); }
    const [id] = remaining.splice(i, 1);
    placed.add(id); out.push(id);
  }
  return { order: out, cycles };
}

/** Effective order: saved order (existing epics only) + any new epics, slotted after their dependencies. */
export function effectiveOrder(features, queue) {
  const epics = features.filter((f) => f.kind === 'epic');
  const byId = new Map(epics.map((e) => [e.id, e]));
  const saved = (queue?.order ?? []).filter((id) => byId.has(id));
  const missing = epics.filter((e) => !saved.includes(e.id));
  if (!saved.length) {
    // first run: built steps first, then the rest by wave/priority/seed order, dependencies respected
    const seedIdx = new Map(epics.map((e, i) => [e.id, i]));
    const depsOf = (id) => byId.get(id)?.dependsOn ?? [];
    const done = epics.filter(isDone).map((e) => e.id);
    const rest = epics.filter((e) => !isDone(e)).sort((a, b) => cmp(rank(a), rank(b)) || seedIdx.get(a.id) - seedIdx.get(b.id)).map((e) => e.id);
    const ri = new Map(rest.map((id, i) => [id, i]));
    return [...topo(done, depsOf, (id) => seedIdx.get(id)).order, ...topo(rest, depsOf, (id) => ri.get(id)).order];
  }
  const order = [...saved];
  for (const e of missing) {
    const after = Math.max(-1, ...(e.dependsOn ?? []).map((d) => order.indexOf(d)));
    const firstUndone = order.findIndex((id) => !isDone(byId.get(id)));
    order.splice(isDone(e) ? (firstUndone < 0 ? order.length : firstUndone) : Math.max(after + 1, firstUndone < 0 ? order.length : firstUndone), 0, e.id);
  }
  return order;
}

/** Rework reasons for each done step (rules a–c). */
export function detectRework(features, queue) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const steps = queue?.steps ?? {};
  const out = {};
  for (const [id, rec] of Object.entries(steps)) {
    const epic = byId.get(id);
    if (!epic || !isDone(epic) || !rec.completedAt) continue;
    const reasons = [];
    for (const d of epic.dependsOn ?? []) {
      const dr = steps[d];
      const dep = byId.get(d);
      if (dr?.completedAt && dr.completedAt > rec.completedAt) reasons.push(`${dep?.title ?? d} was ${dr.reworkedAt === dr.completedAt ? 'reworked' : 'completed'} after this step (${dr.completedAt.slice(0, 10)}) — re-verify against it`);
      if (dr?.reopenedAt && dr.reopenedAt > rec.completedAt && !isDone(dep)) reasons.push(`${dep?.title ?? d} was reopened — this step was built on it`);
    }
    if (Array.isArray(rec.deps)) {
      const now = epic.dependsOn ?? [];
      const added = now.filter((d) => !rec.deps.includes(d)), removed = rec.deps.filter((d) => !now.includes(d));
      if (added.length || removed.length) reasons.push(`Dependencies changed since it was built (${[...added.map((d) => `+${d}`), ...removed.map((d) => `−${d}`)].join(', ')})${added.some((d) => byId.get(d) && !isDone(byId.get(d))) ? '; a new dependency is not built yet' : ''}`);
    }
    if (reasons.length) out[id] = reasons;
  }
  return out;
}

/** The queue as the console shows it. */
export function computeQueue(features, queue) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const order = effectiveOrder(features, queue);
  const pos = new Map(order.map((id, i) => [id, i]));
  const steps = order.map((id, i) => {
    const epic = byId.get(id);
    const rec = queue?.steps?.[id] ?? {};
    const feats = linkedFeatures(features, epic);
    const state = stepState(epic, rec);
    const deps = (epic.dependsOn ?? []).map((d) => {
      const f = byId.get(d);
      return { id: d, title: f?.title ?? d, status: f?.status ?? 'missing', position: pos.has(d) ? pos.get(d) + 1 : null, done: isDone(f) };
    });
    const violations = state === 'done' || state === 'rework' || state === 'dropped' ? [] : deps.filter((d) => !d.done && d.position != null && d.position > i + 1).map((d) => `Runs before its dependency ${d.title} (step ${d.position})`);
    const missing = deps.filter((d) => d.status === 'missing').map((d) => `Depends on "${d.id}", which is not in the plan`);
    const m = stepModel(epic, feats);
    return {
      id, position: i + 1, title: epic.title, area: epic.area, status: epic.status, state, priority: epic.priority, wave: epic.wave, effort: epic.effort, summary: epic.summary,
      model: m.model, modelLabel: MODEL_LABEL[m.model] ?? m.model, modelReason: m.reason, epicModel: epic.model,
      deps, ready: deps.every((d) => d.done || d.status === 'missing'), violations, missing,
      features: feats.map((f) => ({ id: f.id, title: f.title, status: f.status, model: f.model, modelReason: f.modelReason })),
      progress: feats.length ? Math.round((feats.filter(isDone).length / feats.length) * 100) : (isDone(epic) ? 100 : epic.status === 'partial' ? 50 : 0),
      acceptance: epic.acceptance ?? [],
      completedAt: rec.completedAt && rec.completedAt !== BASELINE ? rec.completedAt : null, completedBy: rec.completedBy ?? null, rework: rec.rework ?? null,
      ...stepsView(rec),
    };
  });
  const remaining = steps.filter((s) => s.state !== 'done' && s.state !== 'rework' && s.state !== 'dropped');
  const next = remaining.find((s) => s.ready) ?? null;
  const counts = steps.reduce((a, s) => ((a[s.state] = (a[s.state] ?? 0) + 1), a), {});
  const byModel = remaining.reduce((a, s) => ((a[s.model] = (a[s.model] ?? 0) + 1), a), {});
  const minutesLeftByModel = remaining.reduce((a, s) => ((a[s.model] = (a[s.model] ?? 0) + s.minutesLeft), a), {});
  return {
    steps, order, next: next?.id ?? null, counts, byModel, minutesLeftByModel,
    unsplit: remaining.filter((s) => s.needsSplit).map((s) => s.id),
    violations: steps.filter((s) => s.violations.length).length,
    rework: steps.filter((s) => s.rework).length,
    dirty: !!queue?.dirty, updatedAt: queue?.updatedAt ?? '',
  };
}

/** Normalised `steps` of a record (tolerant of hand edits), the record's estimate, and the split/progress numbers. */
export function recordSteps(rec) {
  return (Array.isArray(rec?.steps) ? rec.steps : []).map((s) => ({
    text: String(s?.text ?? ''),
    ...(String(s?.estimate ?? '').trim() ? { estimate: String(s.estimate).trim() } : {}),
    ...(s?.done === true ? { done: true, doneAt: iso(s?.doneAt) } : {}),
    ...(s?.skip === true ? { skip: true } : {}), // feature-matrix@1: skipped, never removed
    ...(String(s?.fm ?? '').trim() ? { fm: String(s.fm).trim().slice(0, 80) } : {}),
  })).filter((s) => s.text);
}
function stepsView(rec) {
  const steps = recordSteps(rec);
  const estimate = String(rec?.estimate ?? '').trim();
  const entry = { estimate, steps };
  const p = stepsProgress(entry);
  const c = splitCheck(entry);
  return { estimate: itemEstimate(entry) || formatMinutes(p.minutesTotal), steps, stepsDone: p.done, minutesTotal: p.minutesTotal, minutesLeft: p.minutesLeft, needsSplit: c.needsSplit, splitReasons: c.reasons };
}

/**
 * Edit a step's build-time estimate and its small steps (Oct 21 2026). Pure: returns the new queue state.
 *   { id, estimate }                                      set / clear ('' or null) the step's estimate
 *   { id, steps: [{ text, estimate?, done?, doneAt? }] }  replace the whole list (keeps done/doneAt where given)
 *   { id, add: { text, estimate? } }                      append one small step
 *   { id, index, done?, text?, estimate? }                tick / untick, reword or re-estimate one small step (0-based)
 *   { id, removeIndex }                                   drop one small step
 * Throws on an unknown epic, an empty text or an index out of range.
 */
export function stepsAction(features, queue, a, now = new Date().toISOString(), by = 'console') {
  const epic = features.find((f) => f.id === a?.id && f.kind === 'epic');
  if (!epic) throw new Error(`no build step "${a?.id}"`);
  const q = structuredClone(queue ?? emptyQueue());
  const rec = (q.steps[epic.id] = { ...(q.steps[epic.id] ?? {}) });
  let steps = recordSteps(rec);
  const what = [];
  const clean = (s) => { const text = String(s?.text ?? '').trim(); if (!text) throw new Error('text is required'); const e = String(s?.estimate ?? '').trim(); return { text, ...(e ? { estimate: e } : {}), ...(s?.done === true ? { done: true, doneAt: iso(s?.doneAt) || now } : {}), ...(s?.skip === true ? { skip: true } : {}), ...(String(s?.fm ?? '').trim() ? { fm: String(s.fm).trim().slice(0, 80) } : {}) }; };
  if (a.estimate !== undefined) { const e = String(a.estimate ?? '').trim(); if (e) rec.estimate = e; else delete rec.estimate; what.push(e ? `~${e}` : 'estimate cleared'); }
  if (a.steps !== undefined) { if (!Array.isArray(a.steps)) throw new Error('steps must be an array'); steps = a.steps.map(clean); what.push(`${steps.length} step(s) set`); }
  if (a.add !== undefined) { steps.push(clean(a.add)); what.push(`step ${steps.length} added`); }
  if (a.index !== undefined) {
    const k = Number(a.index);
    if (!Number.isInteger(k) || k < 0 || k >= steps.length) throw new Error(`no step ${a.index} on "${epic.id}" (it has ${steps.length})`);
    const sp = { ...steps[k] };
    if (a.text !== undefined) { const text = String(a.text).trim(); if (!text) throw new Error('text is required'); sp.text = text; what.push(`step ${k + 1} reworded`); }
    if (a.stepEstimate !== undefined) { const e = String(a.stepEstimate ?? '').trim(); if (e) sp.estimate = e; else delete sp.estimate; what.push(`step ${k + 1} ~${e || 'cleared'}`); }
    if (a.done !== undefined) { if (a.done) { if (!sp.done) { sp.done = true; sp.doneAt = now; } what.push(`step ${k + 1} done`); } else { delete sp.done; delete sp.doneAt; what.push(`step ${k + 1} not done`); } }
    steps[k] = sp;
  }
  if (a.removeIndex !== undefined) {
    const k = Number(a.removeIndex);
    if (!Number.isInteger(k) || k < 0 || k >= steps.length) throw new Error(`no step ${a.removeIndex} on "${epic.id}" (it has ${steps.length})`);
    steps.splice(k, 1); what.push(`step ${k + 1} removed`);
  }
  if (steps.length) rec.steps = steps; else delete rec.steps;
  if (!Object.keys(rec).length) delete q.steps[epic.id];
  q.updatedAt = now;
  q.history = [...(q.history ?? []), { at: now, by, text: `${epic.title}: ${what.join(', ') || 'steps unchanged'}` }].slice(-200);
  return q;
}

/** Queue steps (remaining ones) that break the small-steps rule, for `--check-steps` and the console. */
export function unsplitSteps(features, queue) {
  const v = computeQueue(features, queue);
  return v.steps.filter((s) => s.needsSplit && s.state !== 'done' && s.state !== 'rework' && s.state !== 'dropped').map((s) => ({ id: s.id, title: s.title, estimate: s.estimate, reasons: s.splitReasons }));
}
export { estimateMinutes, formatMinutes };

/** What a reprocess would do: new order, moves with reasons, rework flags. Pure — apply with applyReprocess. */
export function proposeReprocess(features, queue) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const current = effectiveOrder(features, queue);
  const ci = new Map(current.map((id, i) => [id, i]));
  const done = current.filter((id) => isDone(byId.get(id)));
  const dropped = current.filter((id) => byId.get(id)?.status === 'dropped');
  const rest = current.filter((id) => !done.includes(id) && !dropped.includes(id));
  const { order: sorted, cycles } = topo(rest, (id) => byId.get(id)?.dependsOn ?? [], (id) => ci.get(id));
  const order = [...done, ...sorted, ...dropped];
  const moves = [];
  for (const id of rest) {
    const from = ci.get(id), to = order.indexOf(id);
    if (from === to) continue;
    const late = (byId.get(id).dependsOn ?? []).filter((d) => rest.includes(d) && ci.get(d) > from);
    const pushedBy = rest.filter((o) => (byId.get(o).dependsOn ?? []).includes(id) && ci.get(o) < from);
    const reason = late.length ? `waits for ${late.map((d) => byId.get(d)?.title ?? d).join(', ')}` : pushedBy.length ? `needed earlier by ${pushedBy.map((d) => byId.get(d)?.title ?? d).join(', ')}` : 'shifted by the moves above';
    moves.push({ id, title: byId.get(id).title, from: from + 1, to: to + 1, reason });
  }
  for (const id of dropped) if (ci.get(id) !== order.indexOf(id)) moves.push({ id, title: byId.get(id).title, from: ci.get(id) + 1, to: order.indexOf(id) + 1, reason: 'dropped steps go last' });
  const reworkMap = detectRework(features, queue);
  const rework = Object.entries(reworkMap).map(([id, reasons]) => ({ id, title: byId.get(id)?.title ?? id, reasons, model: byId.get(id)?.model ?? 'opus', already: !!queue?.steps?.[id]?.rework }));
  return { order, moves, rework, cycles: cycles.map((id) => ({ id, title: byId.get(id)?.title ?? id })), changed: order.join() !== current.join() || rework.some((r) => !r.already) };
}

/** Apply a reprocess proposal to the queue state (returns a new state). */
export function applyReprocess(features, queue, now = new Date().toISOString(), by = 'console') {
  const p = proposeReprocess(features, queue);
  const q = structuredClone(queue ?? emptyQueue());
  q.order = p.order;
  for (const r of p.rework) {
    q.steps[r.id] = { ...(q.steps[r.id] ?? {}), rework: { reasons: r.reasons, at: now, by } };
  }
  q.dirty = false; q.updatedAt = now;
  q.history = [...(q.history ?? []), { at: now, by, text: `Reprocessed: ${p.moves.length} move(s), ${p.rework.length} step(s) flagged for rework${p.cycles.length ? `, ${p.cycles.length} dependency cycle(s) broken` : ''}` }].slice(-200);
  return { queue: q, proposal: p };
}

/** User reorder (drag & drop). Done steps stay in place; marks the queue dirty so the console prompts a reprocess. */
export function reorder(features, queue, order, now = new Date().toISOString(), by = 'console') {
  const byId = new Map(features.map((f) => [f.id, f]));
  const current = effectiveOrder(features, queue);
  const want = order.filter((id) => current.includes(id));
  for (const id of current) if (!want.includes(id)) want.push(id);
  const done = current.filter((id) => isDone(byId.get(id)));
  const next = [...done, ...want.filter((id) => !done.includes(id))];
  const q = structuredClone(queue ?? emptyQueue());
  q.order = next; q.dirty = next.join() !== current.join() || q.dirty; q.updatedAt = now;
  if (next.join() !== current.join()) q.history = [...(q.history ?? []), { at: now, by, text: 'Reordered the queue' }].slice(-200);
  return q;
}

/**
 * Status changes for one step action. Returns { changes: [{id,status,note}], queue } — the caller writes the
 * plan changes (plan.mjs setStatuses) and the queue state.
 *   start            epic → in-progress
 *   complete         epic + every linked unfinished feature → built; step completedAt = now (dependents may need rework)
 *   resolve-rework   clears the rework flag; completedAt = now so steps built on this one are re-checked
 *   reopen           epic → planned (or `status`), records reopenedAt
 *   status           epic → `status`
 */
export function stepAction(features, queue, { id, action, status, by = 'console', note }, now = new Date().toISOString()) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const epic = byId.get(id);
  if (!epic || epic.kind !== 'epic') throw new Error(`no build step "${id}"`);
  const q = structuredClone(queue ?? emptyQueue());
  const rec = (q.steps[id] = { ...(q.steps[id] ?? {}) });
  const changes = [];
  const pos = effectiveOrder(features, q).indexOf(id) + 1;
  const tag = note ? ` — ${note}` : '';
  if (action === 'start') changes.push({ id, status: 'in-progress', note: `Build started from the build queue (step ${pos})${tag}` });
  else if (action === 'complete') {
    changes.push({ id, status: 'built', note: `Built from the build queue (step ${pos}) by ${by}${tag}` });
    for (const f of linkedFeatures(features, epic)) if (!isDone(f) && f.status !== 'dropped') changes.push({ id: f.id, status: 'built', note: `Built with build step ${pos}: ${epic.title}` });
    Object.assign(rec, { completedAt: now, completedBy: by, deps: [...(epic.dependsOn ?? [])], rework: null });
  } else if (action === 'resolve-rework') {
    Object.assign(rec, { rework: null, completedAt: now, reworkedAt: now, completedBy: by, deps: [...(epic.dependsOn ?? [])] });
  } else if (action === 'reopen' || action === 'status') {
    const s = status ?? 'planned';
    changes.push({ id, status: s, note: `${action === 'reopen' ? 'Reopened' : 'Status set'} from the build queue (step ${pos})${tag}` });
    if (isDone(epic) && s !== 'built') rec.reopenedAt = now;
    if (s === 'built') Object.assign(rec, { completedAt: now, completedBy: by, deps: [...(epic.dependsOn ?? [])], rework: null });
  } else throw new Error(`unknown step action "${action}"`);
  q.updatedAt = now;
  if (action !== 'start') q.dirty = true; // completion / reopen changes what downstream steps can rely on
  q.history = [...(q.history ?? []), { at: now, by, text: `${epic.title}: ${action}${status ? ` (${status})` : ''}` }].slice(-200);
  return { changes, queue: q };
}

/**
 * Two-way sync, run when the console starts (and after every plan/status write through the API).
 *   features → build: all linked features built ⇒ the step is built; some built while planned ⇒ partial.
 *   steps that became done outside the queue get completedAt; steps that stopped being done get reopenedAt.
 *   First run (no state yet): every built step gets a baseline completion so nothing is flagged retroactively.
 */
export function syncQueue(features, queue, now = new Date().toISOString(), by = 'console:init') {
  const first = !queue || !queue.order?.length;
  const q = structuredClone(queue ?? emptyQueue());
  const changes = [];
  const log = [];
  const epics = features.filter((f) => f.kind === 'epic');
  for (const e of epics) {
    if (e.status === 'dropped' || isDone(e)) continue;
    const feats = linkedFeatures(features, e).filter((f) => f.status !== 'dropped');
    if (!feats.length) continue;
    const built = feats.filter(isDone).length;
    if (built === feats.length) { changes.push({ id: e.id, status: 'built', note: `All ${feats.length} linked features are built (feature tracker) → build step complete` }); log.push(`${e.title}: all linked features built → step complete`); }
    else if (built > 0 && (e.status === 'planned' || e.status === 'placeholder')) { changes.push({ id: e.id, status: 'partial', note: `${built}/${feats.length} linked features built (feature tracker)` }); log.push(`${e.title}: ${built}/${feats.length} features built → partial`); }
  }
  const statusAfter = new Map(epics.map((e) => [e.id, e.status]));
  for (const c of changes) statusAfter.set(c.id, c.status);
  for (const e of epics) {
    const rec = (q.steps[e.id] = { ...(q.steps[e.id] ?? {}) });
    const done = statusAfter.get(e.id) === 'built';
    if (done && !rec.completedAt) { Object.assign(rec, { completedAt: first ? BASELINE : now, completedBy: first ? 'baseline' : 'feature-tracker', deps: [...(e.dependsOn ?? [])] }); if (!first) { log.push(`${e.title}: built in the feature tracker → step done`); q.dirty = true; } }
    if (!done && rec.completedAt) { rec.reopenedAt = now; delete rec.completedAt; rec.rework = null; log.push(`${e.title}: no longer built → step reopened`); q.dirty = true; }
    if (!Object.keys(rec).length) delete q.steps[e.id];
  }
  if (first) q.order = effectiveOrder(features, q);
  // flag rework found by the rules (never clears an existing flag — resolving is explicit)
  const after = features.map((f) => (statusAfter.has(f.id) ? { ...f, status: statusAfter.get(f.id) } : f));
  for (const [id, reasons] of Object.entries(detectRework(after, q))) if (!q.steps[id].rework) { q.steps[id].rework = { reasons, at: now, by }; log.push(`${byTitle(features, id)}: needs rework — ${reasons[0]}`); }
  if (changes.length || log.length || first) { q.updatedAt = now; q.history = [...(q.history ?? []), { at: now, by, text: first ? 'Build queue created from the plan' : `Synced with the feature tracker: ${log.length} change(s)` }].slice(-200); }
  return { changes, queue: q, log, first };
}
const byTitle = (features, id) => features.find((f) => f.id === id)?.title ?? id;
