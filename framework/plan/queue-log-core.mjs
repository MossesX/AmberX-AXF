/**
 * queue-log@1 — what changed in "everything still to build" and why (Brett, Oct 21 2026: "keep a detailed log of the
 * build queue and changes to it … all moves and rearrangements, additions, removals, why and what prompt caused it").
 *
 * Pure and IO-free (the recorder in framework/cli/queue-log.mjs, the console and the tests share it). Three lists:
 *   pending  framework/plan/pending.json      (pending@1: builds parked for a model)
 *   queue    framework/plan/build-queue.json  (build-queue@1: the ordered build queue, its steps and small steps)
 *   plan     framework/plan/plan.json         (the plan's features: status, model, epic, dependencies)
 *
 * A write is compared as reduced snapshots (snapshotOf), so a diff only reports what a person would care about:
 *
 *   added, removed (with the item's last snapshot, so the browser can show what went), moved (from → to position,
 *   only the items that really changed place: everything else keeps its relative order), status, model, title,
 *   detail, estimate, priority, wave, effort, parent, deps, step-added, step-removed, step-done, step-undone,
 *   step-edited, steps-estimate, note-added, completed, reopened, rework, rework-cleared, dirty
 *
 * One write = one batch: {id, at, by, surface, source (tool | outside), reason, prompt, changeId, files, events}.
 */

export const LOG_KINDS = ['pending', 'queue', 'plan'];
export const KIND_LABEL = { pending: 'Pending list', queue: 'Build queue', plan: 'Plan' };
export const OP_LABEL = {
  added: 'Added', removed: 'Removed', moved: 'Moved', status: 'Status', model: 'Model', title: 'Renamed', detail: 'Details edited',
  estimate: 'Estimate', priority: 'Priority', wave: 'Wave', effort: 'Effort', parent: 'Epic', deps: 'Dependencies',
  'step-added': 'Step added', 'step-removed': 'Step removed', 'step-done': 'Step done', 'step-undone': 'Step reopened', 'step-edited': 'Step edited',
  'note-added': 'Note', completed: 'Completed', reopened: 'Reopened', rework: 'Needs rework', 'rework-cleared': 'Rework cleared', dirty: 'Needs reprocess',
};
/** Ops grouped for filters in the browser. */
export const OP_GROUPS = {
  structure: ['added', 'removed', 'moved'],
  state: ['status', 'completed', 'reopened', 'rework', 'rework-cleared', 'dirty'],
  fields: ['model', 'title', 'detail', 'estimate', 'priority', 'wave', 'effort', 'parent', 'deps'],
  steps: ['step-added', 'step-removed', 'step-done', 'step-undone', 'step-edited', 'steps-estimate'],
  notes: ['note-added'],
};
export const LIMITS = { text: 300, prompt: 600, reason: 400, events: 2000, by: 60 };

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const clip = (v, n) => { const s = str(v).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/** Tiny stable hash (FNV-1a) so long text (details, summaries) is compared without being stored. */
export function hash(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* ---------------- snapshots ---------------- */

const stepList = (list) => (Array.isArray(list) ? list : []).map((s) => (typeof s === 'string' ? { text: clip(s, LIMITS.text) } : { text: clip(s?.text, LIMITS.text), ...(s?.done ? { done: true } : {}), ...(s?.estimate ? { estimate: str(s.estimate) } : {}) }));

/** The reduced form of one list document (what diffs compare). Unknown or broken input → an empty snapshot. */
export function snapshotOf(kind, doc) {
  if (kind === 'pending') {
    const items = Array.isArray(doc?.items) ? doc.items : [];
    return {
      order: items.map((x) => str(x?.id)).filter(Boolean),
      items: Object.fromEntries(items.filter((x) => x?.id).map((x) => [str(x.id), {
        title: clip(x.title, LIMITS.text), model: str(x.model), status: str(x.status), estimate: str(x.estimate),
        detail: hash(str(x.detail)), detailText: clip(x.detail, LIMITS.text), planId: str(x.planId),
        notes: (Array.isArray(x.notes) ? x.notes : []).map((n) => clip(typeof n === 'string' ? n : n?.text, LIMITS.text)),
        steps: [...stepList(x.subPrompts), ...stepList(x.steps)],
      }])),
    };
  }
  if (kind === 'queue') {
    const steps = doc?.steps && typeof doc.steps === 'object' ? doc.steps : {};
    return {
      order: (Array.isArray(doc?.order) ? doc.order : []).map(str).filter(Boolean),
      dirty: !!doc?.dirty,
      steps: Object.fromEntries(Object.entries(steps).map(([id, r]) => [id, {
        completedAt: str(r?.completedAt), reopenedAt: str(r?.reopenedAt), rework: r?.rework ? clip((r.rework.reasons ?? []).join('; ') || 'yes', LIMITS.text) : '',
        estimate: str(r?.estimate), steps: stepList(r?.steps),
      }])),
    };
  }
  if (kind === 'plan') {
    const feats = Array.isArray(doc?.features) ? doc.features : [];
    return {
      order: [], // plan order isn't meaningful: the build queue carries the order
      items: Object.fromEntries(feats.filter((f) => f?.id).map((f) => [str(f.id), {
        title: clip(f.title, LIMITS.text), kind: str(f.kind), status: str(f.status), model: str(f.model), priority: str(f.priority),
        wave: str(f.wave), effort: str(f.effort), parent: str(f.parent || f.epic), deps: (Array.isArray(f.dependsOn) ? f.dependsOn : []).map(str).sort(),
        detail: hash(str(f.summary)), detailText: clip(f.summary, LIMITS.text),
      }])),
    };
  }
  throw new Error(`unknown list "${kind}"`);
}

/* ---------------- moves ---------------- */

/**
 * Which items really moved between two orders: the longest run that kept its relative order stays put, every other
 * common item is a move {id, from, to} (1-based positions). Added / removed items are not moves.
 */
export function moves(before, after) {
  const a = before.filter((id) => after.includes(id));
  const b = after.filter((id) => before.includes(id));
  if (!a.length) return [];
  const pos = new Map(a.map((id, i) => [id, i]));
  const seq = b.map((id) => pos.get(id));
  // longest increasing subsequence over seq (patience), keeping indexes into b
  const tails = [], prev = new Array(seq.length).fill(-1), tailIdx = [];
  for (let i = 0; i < seq.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < seq[i]) lo = m + 1; else hi = m; }
    tails[lo] = seq[i]; tailIdx[lo] = i; prev[i] = lo ? tailIdx[lo - 1] : -1;
  }
  const keep = new Set();
  for (let k = tailIdx[tails.length - 1]; k >= 0; k = prev[k]) keep.add(b[k]);
  return b.filter((id) => !keep.has(id)).map((id) => ({ id, from: before.indexOf(id) + 1, to: after.indexOf(id) + 1 }));
}

/* ---------------- diff ---------------- */

const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

function stepEvents(push, id, title, before = [], after = []) {
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const x = before[i], y = after[i];
    if (!x && y) push({ op: 'step-added', id, title, index: i + 1, to: y.text, ...(y.estimate ? { estimate: y.estimate } : {}) });
    else if (x && !y) push({ op: 'step-removed', id, title, index: i + 1, from: x.text });
    else if (x && y) {
      if (!x.done && y.done) push({ op: 'step-done', id, title, index: i + 1, text: y.text });
      else if (x.done && !y.done) push({ op: 'step-undone', id, title, index: i + 1, text: y.text });
      if (x.text !== y.text) push({ op: 'step-edited', id, title, index: i + 1, from: x.text, to: y.text });
      else if (str(x.estimate) !== str(y.estimate)) push({ op: 'step-edited', id, title, index: i + 1, field: 'estimate', from: str(x.estimate), to: str(y.estimate) });
    }
  }
}

function fieldEvents(push, id, title, x, y, fields) {
  for (const f of fields) {
    if (same(x[f], y[f])) continue;
    if (f === 'detail') push({ op: 'detail', id, title, from: x.detailText ?? '', to: y.detailText ?? '' });
    else if (f === 'deps') push({ op: 'deps', id, title, added: y.deps.filter((d) => !x.deps.includes(d)), removed: x.deps.filter((d) => !y.deps.includes(d)) });
    else push({ op: f, id, title, from: x[f], to: y[f] });
  }
}

/**
 * Events between two snapshots of one list (`before` may be null: a first sighting logs nothing, it is the baseline).
 * `titles` (id → title) names queue epics, which have no title of their own in build-queue.json.
 */
export function diff(kind, before, after, titles = {}) {
  if (!before || !after) return [];
  const out = [];
  const push = (e) => { if (out.length < LIMITS.events) out.push({ kind, ...e }); };
  const nameOf = (id, snap) => snap?.items?.[id]?.title || titles[id] || id;
  if (kind === 'pending' || kind === 'plan') {
    const bi = before.items ?? {}, ai = after.items ?? {};
    for (const id of Object.keys(ai)) if (!bi[id]) {
      const y = ai[id];
      push({ op: 'added', id, title: y.title, to: kind === 'pending' ? { model: y.model, status: y.status, estimate: y.estimate } : { status: y.status, model: y.model, parent: y.parent }, position: (after.order ?? []).indexOf(id) + 1 || undefined, snapshot: y });
    }
    for (const id of Object.keys(bi)) if (!ai[id]) push({ op: 'removed', id, title: bi[id].title, position: (before.order ?? []).indexOf(id) + 1 || undefined, snapshot: bi[id] });
    for (const m of moves(before.order ?? [], after.order ?? [])) push({ op: 'moved', id: m.id, title: nameOf(m.id, after), from: m.from, to: m.to });
    const fields = kind === 'pending' ? ['title', 'status', 'model', 'estimate', 'detail', 'planId'] : ['title', 'status', 'model', 'priority', 'wave', 'effort', 'parent', 'deps', 'detail'];
    for (const id of Object.keys(ai)) {
      const x = bi[id], y = ai[id];
      if (!x) continue;
      fieldEvents(push, id, y.title, x, y, fields);
      if (kind === 'pending') {
        stepEvents(push, id, y.title, x.steps, y.steps);
        for (const n of (y.notes ?? []).slice((x.notes ?? []).length)) push({ op: 'note-added', id, title: y.title, text: n });
      }
    }
    return out.map((e) => (e.op === 'planId' ? { ...e, op: 'parent', field: 'planId' } : e));
  }
  if (kind === 'queue') {
    const bo = before.order ?? [], ao = after.order ?? [];
    for (const id of ao) if (!bo.includes(id)) push({ op: 'added', id, title: nameOf(id), position: ao.indexOf(id) + 1 });
    for (const id of bo) if (!ao.includes(id)) push({ op: 'removed', id, title: nameOf(id), position: bo.indexOf(id) + 1 });
    for (const m of moves(bo, ao)) push({ op: 'moved', id: m.id, title: nameOf(m.id), from: m.from, to: m.to });
    if (!before.dirty && after.dirty) push({ op: 'dirty', id: '', title: 'Build queue', to: true });
    const bs = before.steps ?? {}, as = after.steps ?? {};
    for (const id of new Set([...Object.keys(bs), ...Object.keys(as)])) {
      const x = bs[id] ?? { steps: [] }, y = as[id] ?? { steps: [] }, title = nameOf(id);
      if (!x.completedAt && y.completedAt) push({ op: 'completed', id, title, at: y.completedAt });
      else if (x.completedAt && y.completedAt && x.completedAt !== y.completedAt) push({ op: 'completed', id, title, at: y.completedAt, again: true });
      if (y.reopenedAt && y.reopenedAt !== x.reopenedAt) push({ op: 'reopened', id, title, at: y.reopenedAt });
      if (!x.rework && y.rework) push({ op: 'rework', id, title, text: y.rework });
      else if (x.rework && !y.rework) push({ op: 'rework-cleared', id, title });
      if (str(x.estimate) !== str(y.estimate)) push({ op: 'estimate', id, title, from: str(x.estimate), to: str(y.estimate) });
      stepEvents(push, id, title, x.steps, y.steps);
    }
    return out;
  }
  throw new Error(`unknown list "${kind}"`);
}

/* ---------------- batches and the browser ---------------- */

/** One readable line for an event (the browser shows it; the CLI prints it). */
export function describe(e) {
  const t = e.title || e.id;
  const q = (v) => `“${clip(v, 80)}”`;
  switch (e.op) {
    case 'added': return `${t} added${e.position ? ` at #${e.position}` : ''}${e.to?.model ? ` (${e.to.model})` : ''}`;
    case 'removed': return `${t} removed${e.position ? ` from #${e.position}` : ''}`;
    case 'moved': return `${t} moved #${e.from} → #${e.to}`;
    case 'status': return `${t}: ${e.from || '—'} → ${e.to || '—'}`;
    case 'model': return `${t}: model ${e.from || '—'} → ${e.to || '—'}`;
    case 'title': return `Renamed ${q(e.from)} → ${q(e.to)}`;
    case 'detail': return `${t}: details edited`;
    case 'estimate': return `${t}: estimate ${e.from || '—'} → ${e.to || '—'}`;
    case 'priority': case 'wave': case 'effort': return `${t}: ${e.op} ${e.from || '—'} → ${e.to || '—'}`;
    case 'parent': return `${t}: ${e.field === 'planId' ? 'plan link' : 'epic'} ${e.from || '—'} → ${e.to || '—'}`;
    case 'deps': return `${t}: dependencies${e.added?.length ? ` +${e.added.join(', +')}` : ''}${e.removed?.length ? ` −${e.removed.join(', −')}` : ''}`;
    case 'step-added': return `${t}: step ${e.index} added ${q(e.to)}`;
    case 'step-removed': return `${t}: step ${e.index} removed ${q(e.from)}`;
    case 'step-done': return `${t}: step ${e.index} done ${q(e.text)}`;
    case 'step-undone': return `${t}: step ${e.index} reopened ${q(e.text)}`;
    case 'step-edited': return e.field === 'estimate' ? `${t}: step ${e.index} estimate ${e.from || '—'} → ${e.to || '—'}` : `${t}: step ${e.index} reworded`;
    case 'note-added': return `${t}: note ${q(e.text)}`;
    case 'completed': return `${t} completed${e.again ? ' again' : ''}`;
    case 'reopened': return `${t} reopened`;
    case 'rework': return `${t} needs rework: ${clip(e.text, 120)}`;
    case 'rework-cleared': return `${t}: rework cleared`;
    case 'dirty': return 'The build queue needs reprocessing';
    default: return `${t}: ${e.op}`;
  }
}

/** Cleans the who/why of a write (meta from the environment or a request). */
export function cleanMeta(m = {}) {
  const o = {};
  const by = clip(m.by, LIMITS.by); if (by) o.by = by;
  const surface = str(m.surface).toLowerCase(); if (/^[a-z][a-z0-9-]{0,31}$/.test(surface)) o.surface = surface;
  const reason = clip(m.reason, LIMITS.reason); if (reason) o.reason = reason;
  const prompt = clip(m.prompt, LIMITS.prompt); if (prompt) o.prompt = prompt;
  const changeId = str(m.changeId); if (/^chg-\d{8}-[0-9a-f]{6,16}$/.test(changeId)) o.changeId = changeId;
  const op = clip(m.op, 60); if (op) o.op = op;
  const session = str(m.session).replace(/[^A-Za-z0-9-]/g, '').slice(0, 12); if (session) o.session = session;
  return o;
}

/** A batch id: q-<yyyymmddhhmmss>-<6 hex>, sortable by time. */
export function batchId(at, seed = '') {
  return `q-${at.replace(/[^0-9]/g, '').slice(0, 14)}-${hash(`${at}|${seed}|${Math.random()}`).slice(0, 6)}`;
}

/** Flattened events for browsing: each carries its batch's who/why. Newest first. */
export function flatten(batches) {
  const out = [];
  for (const b of batches ?? []) for (const [i, e] of (b.events ?? []).entries()) out.push({ ...e, key: `${b.id}:${i}`, batch: b.id, at: b.at, by: b.by, surface: b.surface, source: b.source, reason: b.reason, prompt: b.prompt, changeId: b.changeId, wop: b.op });
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/**
 * Filter flattened events: kinds [], ops [] (or groups via OP_GROUPS), item id, who (by/surface substring),
 * source (tool | outside), since / until (ISO), q (search across titles, ids, reasons, prompts, text).
 */
export function filterEvents(events, f = {}) {
  const ops = new Set([...(f.ops ?? []), ...(f.groups ?? []).flatMap((g) => OP_GROUPS[g] ?? [])]);
  const q = str(f.q).toLowerCase().trim();
  const who = str(f.who).toLowerCase().trim();
  return events.filter((e) => (!f.kinds?.length || f.kinds.includes(e.kind))
    && (!ops.size || ops.has(e.op))
    && (!f.item || e.id === f.item)
    && (!f.source || e.source === f.source)
    && (!who || `${e.by ?? ''} ${e.surface ?? ''}`.toLowerCase().includes(who))
    && (!f.since || e.at >= f.since) && (!f.until || e.at <= f.until)
    && (!f.changeId || e.changeId === f.changeId)
    && (!q || [e.title, e.id, e.reason, e.prompt, e.text, e.from, e.to, e.by, e.surface, e.changeId, describe(e)].some((v) => str(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase().includes(q))));
}

/** Everything that ever happened to one item, oldest first, with where it was at each point. */
export function itemHistory(events, id, kind) {
  return events.filter((e) => e.id === id && (!kind || e.kind === kind)).slice().sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

/** Counts for the browser's header and filter chips. */
export function summarize(events) {
  const by = {}, ops = {}, kinds = {}, sources = {};
  for (const e of events) {
    ops[e.op] = (ops[e.op] ?? 0) + 1; kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; sources[e.source ?? 'tool'] = (sources[e.source ?? 'tool'] ?? 0) + 1;
    const w = e.by || e.surface || 'unknown'; by[w] = (by[w] ?? 0) + 1;
  }
  return { total: events.length, ops, kinds, sources, by, batches: new Set(events.map((e) => e.batch)).size };
}
