/**
 * builds-core — one builds dataset (builds@1), pure and IO-free. Spec: framework/spec/BUILDS.md.
 *
 * `framework/plan/plan.json` (plan@1) is the only thing anyone edits. The Pending builds list (pending@1), the Build
 * queue state (build-queue@1), the Build orchestrator tracker (orchestrator@1), the catalog status map and
 * tracker.json (tracker@1) are VIEWS of it, derived here and written back here:
 *
 *   pendingState(plan)       ⇄ pendingIntoPlan(plan, state)         framework/plan/pending-core.mjs keeps working on the state
 *   queueState(plan)         ⇄ queueIntoPlan(plan, state)           framework/plan/build-queue-core.mjs likewise
 *   orchestratorState(plan)  ⇄ orchestratorIntoPlan(plan, state)    the build-orchestrator plugin's core likewise
 *   trackerState(plan, catalog), statusMap(plan)                    exports only (status edits go through plan.mjs)
 *   rows(plan, opts)                                                one row per build with the nested info every view shows
 *   migrate({ plan, pending, queue, orchestrator })                 the old four files → one plan (+ a report)
 *
 * Additive: a plan without a `builds` block or `build` fields is read as "nothing on any list". Every write-back is
 * a pure merge that touches only the fields its view owns, and round trips are lossless (fixture spec/fixtures/builds.json).
 */

export const SCHEMA = 'builds@1';
export const PLAN_STATUSES = ['built', 'partial', 'in-progress', 'placeholder', 'planned', 'unsafe', 'blocked', 'failed', 'broken', 'dropped'];
export const PENDING_STATUSES = ['pending', 'unsafe', 'broken', 'failed', 'complete'];
export const ORCH_STATUSES = ['pending', 'running', 'waiting', 'blocked', 'failed', 'complete', 'archived'];
export const MODELS = ['fable', 'opus', 'sonnet'];
export const VIEWS = ['plan', 'tracker', 'queue', 'pending', 'orchestrator'];
export const VIEW_LABEL = { plan: 'Plan', tracker: 'Tracker', queue: 'Build queue', pending: 'Pending builds', orchestrator: 'Build orchestrator' };
export const DEFAULT_RULES = { sameSession: true, subAgents: false, approveModelSwitch: true, maxStepMinutes: 30 };
export const ARTIFACT_URL = 'https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye';
export const BUILD_KIND = 'build';
const GENERATED_SOURCES = new Set(['seed', 'catalog']);

/* ---------- helpers ---------- */
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export function iso(v) {
  if (v == null || v === '') return '';
  const d = typeof v === 'number' ? new Date(v) : new Date(str(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
const cap = (m) => (m ? m[0].toUpperCase() + m.slice(1) : '');
const low = (m) => { const s = str(m).toLowerCase(); return MODELS.includes(s) ? s : ''; };
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null && !(Array.isArray(v) && !v.length)));
const list = (v) => (Array.isArray(v) ? v : []);
export const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'build';

/** pending@1 status → plan status, and the way back. */
export const PENDING_TO_PLAN = { pending: 'planned', unsafe: 'unsafe', broken: 'broken', failed: 'failed', complete: 'built' };
export function pendingStatusOf(f) {
  switch (f.status) {
    case 'built': return 'complete';
    case 'unsafe': case 'broken': case 'failed': return f.status;
    case 'dropped': return null;
    default: return 'pending';
  }
}
/** orchestrator@1 status → plan status, and the way back (archived is a flag, not a status, in the plan). */
export const ORCH_TO_PLAN = { pending: 'planned', running: 'in-progress', waiting: 'in-progress', blocked: 'blocked', failed: 'failed', complete: 'built', archived: 'built' };
export function orchStatusOf(f) {
  const b = f.build ?? {};
  if (b.archived) return 'archived';
  const stored = b.orchestration?.status;
  if (stored && stored !== 'archived' && ORCH_TO_PLAN[stored] === f.status) return stored;
  switch (f.status) {
    case 'built': return 'complete';
    case 'partial': case 'in-progress': return 'running';
    case 'blocked': case 'unsafe': case 'broken': return 'blocked';
    case 'failed': return 'failed';
    case 'dropped': return 'archived';
    default: return 'pending';
  }
}

/* ---------- normalisation ---------- */
export function normStep(s, i, now = '') {
  const o = s && typeof s === 'object' ? s : {};
  return clean({
    id: str(o.id) || `s${i + 1}`,
    text: str(o.text),
    estimate: str(o.estimate).trim(),
    model: low(o.model),
    why: str(o.why), phase: str(o.phase), group: str(o.group),
    files: list(o.files).map(str).filter(Boolean), checks: list(o.checks).map(str).filter(Boolean),
    session: o.session === 'new' ? 'new' : '',
    agent: o.agent === true ? true : undefined,
    done: o.done === true ? true : undefined,
    doneAt: o.done === true ? iso(o.doneAt) || iso(o.at) : '',
    at: iso(o.at), note: str(o.note),
  });
}
const notes = (v) => list(v).map((n) => ({ text: str(n?.text), at: iso(n?.at) })).filter((n) => n.text);
export function normBuild(b) {
  if (!b || typeof b !== 'object') return undefined;
  const steps = list(b.steps).map((s, i) => normStep(s, i));
  const seen = new Set(); steps.forEach((s, i) => { if (seen.has(s.id)) s.id = `s${i + 1}-${i}`; seen.add(s.id); });
  const out = clean({
    parked: b.parked && typeof b.parked === 'object' ? clean({ pendingId: str(b.parked.pendingId), source: str(b.parked.source), planId: str(b.parked.planId), createdAt: iso(b.parked.createdAt), updatedAt: iso(b.parked.updatedAt), builtAt: iso(b.parked.builtAt) }) : undefined,
    record: b.record && typeof b.record === 'object' ? { ...clean({ completedAt: str(b.record.completedAt), completedBy: str(b.record.completedBy), rework: b.record.rework ?? undefined, reopenedAt: str(b.record.reopenedAt), reworkedAt: str(b.record.reworkedAt) }), ...(Array.isArray(b.record.deps) ? { deps: b.record.deps.map(str) } : {}) } : undefined,
    detail: str(b.detail),
    estimate: str(b.estimate).trim(),
    steps,
    notes: notes(b.notes),
    orchestration: b.orchestration && typeof b.orchestration === 'object' ? clean({ id: str(b.orchestration.id), category: str(b.orchestration.category), branch: str(b.orchestration.branch), pr: str(b.orchestration.pr), source: str(b.orchestration.source), status: ORCH_STATUSES.includes(b.orchestration.status) ? b.orchestration.status : '', approvals: list(b.orchestration.approvals).map((a) => ({ phase: Number(a?.phase) || 0, from: str(a?.from), to: str(a?.to), at: iso(a?.at) })), createdAt: iso(b.orchestration.createdAt), updatedAt: iso(b.orchestration.updatedAt), builtAt: iso(b.orchestration.builtAt) }) : undefined,
    hidden: b.hidden === true ? true : undefined,
    archived: b.archived === true ? true : undefined,
  });
  if (out.parked && !Object.keys(out.parked).length) out.parked = {};
  if (out.record && !Object.keys(out.record).length) delete out.record;
  if (out.orchestration && !Object.keys(out.orchestration).length) out.orchestration = {};
  return Object.keys(out).length ? out : undefined;
}
export function normalizePlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const b = p.builds && typeof p.builds === 'object' ? p.builds : {};
  const q = b.queue && typeof b.queue === 'object' ? b.queue : {};
  const features = list(p.features).map((f) => { const nb = normBuild(f?.build); const { build: _b, ...rest } = f ?? {}; return nb ? { ...rest, build: nb } : rest; });
  return {
    ...p, $axf: 'plan@1', statuses: PLAN_STATUSES, features,
    builds: {
      ...(b.$axf === SCHEMA ? { $axf: SCHEMA } : {}), updatedAt: iso(b.updatedAt), artifact: str(b.artifact) || ARTIFACT_URL,
      queue: { order: list(q.order).map(str), dirty: q.dirty === true, updatedAt: iso(q.updatedAt), history: list(q.history).map((h) => ({ at: iso(h?.at), by: str(h?.by), text: str(h?.text) })) },
      rules: { ...DEFAULT_RULES, ...(b.rules && typeof b.rules === 'object' ? b.rules : {}) },
      ...(b.migratedAt ? { migratedAt: iso(b.migratedAt), migratedFrom: b.migratedFrom ?? {} } : {}),
    },
  };
}
export const isMigrated = (plan) => !!(plan?.builds && typeof plan.builds === 'object' && plan.builds.$axf === SCHEMA);
export const isBuild = (f) => !!f?.build;
export const modelOf = (f) => low(f?.model) || 'opus';
const withBuild = (f, patch) => { const b = { ...(f.build ?? {}), ...patch }; return { ...f, build: normBuild(b) ?? {} }; };
const replaceFeature = (plan, id, fn) => ({ ...plan, features: plan.features.map((f) => (f.id === id ? fn(f) : f)) });
/** A view's date that equals what the view already derived keeps the stored value (so a write-back never invents a field). */
const keepDate = (prev, val, stored) => (prev != null && iso(val) === iso(prev) ? stored ?? '' : iso(val));
const touchBuilds = (plan, now) => ({ ...plan, builds: { ...plan.builds, updatedAt: now } });

/* ---------- Pending builds view ---------- */
const pendingIdOf = (f) => f.build?.parked?.pendingId || f.id;
export function pendingItem(f) {
  const b = f.build ?? {}; const p = b.parked ?? {};
  const status = pendingStatusOf(f);
  if (!status) return null;
  const pendingId = pendingIdOf(f);
  return clean({
    id: pendingId, title: f.title, detail: b.detail ?? '', model: cap(modelOf(f)), status,
    notes: (b.notes ?? []).map((n) => ({ text: n.text, at: n.at })),
    subPrompts: (b.steps ?? []).map((s) => clean({ text: s.text, at: s.at, estimate: s.estimate, ...(s.done ? { done: true, doneAt: s.doneAt } : {}) })),
    createdAt: p.createdAt || b.orchestration?.createdAt || '', builtAt: status === 'complete' ? p.builtAt || b.orchestration?.builtAt || '' : '', updatedAt: p.updatedAt || b.orchestration?.updatedAt || p.createdAt || '',
    planId: pendingId !== f.id ? f.id : p.planId || undefined,
    estimate: b.estimate, source: p.source || 'console',
    ...(b.hidden ? { hidden: true } : {}), ...(b.archived ? { archived: true } : {}),
  });
}
/** pending@1 state. Items in plan order; sort with pending-core's sortItems. */
export function pendingState(plan) {
  const p = normalizePlan(plan);
  return { $axf: 'pending@1', updatedAt: p.builds.updatedAt, artifact: p.builds.artifact, items: p.features.filter((f) => f.build?.parked).map(pendingItem).filter(Boolean) };
}
/** Find the feature a pending item lives on: its own pendingId, else its id, else its planId. */
export function featureOfPending(plan, item) {
  const id = str(item?.id);
  return plan.features.find((f) => f.build?.parked && pendingIdOf(f) === id) ?? plan.features.find((f) => f.id === id) ?? (item?.planId ? plan.features.find((f) => f.id === item.planId) : undefined) ?? null;
}
/** Steps as the plan keeps them, merged from a view's list: text/estimate/done/doneAt win per position, other fields kept. */
function mergeSteps(oldSteps, viewSteps, now, map) {
  const old = list(oldSteps);
  const out = list(viewSteps).map((s, i) => normStep({ ...(old[i] ?? {}), ...map(s, i), id: old[i]?.id ?? str(s?.id) ?? '' }, i, now));
  const seen = new Set(); out.forEach((s, i) => { if (seen.has(s.id)) s.id = `s${i + 1}-${i}`; seen.add(s.id); });
  return out;
}
const fromSub = (s) => clean({ text: str(s?.text), estimate: str(s?.estimate).trim(), at: iso(s?.at), done: s?.done === true ? true : undefined, doneAt: s?.done === true ? iso(s?.doneAt) : '' });
/** Write a pending@1 state back: items changed/added/removed through pending-core.apply land on their features. */
export function pendingIntoPlan(plan, state, now = new Date().toISOString()) {
  let p = normalizePlan(plan);
  const items = list(state?.items);
  const keep = new Set();
  for (const it of items) {
    const f = featureOfPending(p, it);
    const model = low(it.model);
    const prev = f ? pendingItem(f) : null;
    const sp = f?.build?.parked ?? {};
    const parked = clean({ pendingId: f && f.id !== str(it.id) ? str(it.id) : '', source: prev && str(it.source) === prev.source ? sp.source : str(it.source), planId: !f || (str(it.planId) && it.planId !== f.id && !p.features.some((x) => x.id === it.planId)) ? str(it.planId) : '', createdAt: keepDate(prev?.createdAt, it.createdAt, sp.createdAt), updatedAt: keepDate(prev?.updatedAt, it.updatedAt, sp.updatedAt), builtAt: keepDate(prev?.builtAt, it.builtAt, sp.builtAt) });
    const patch = { parked, detail: str(it.detail), estimate: str(it.estimate).trim(), notes: notes(it.notes), steps: mergeSteps(f?.build?.steps, it.subPrompts, now, fromSub), hidden: it.hidden === true ? true : undefined, archived: it.archived === true ? true : undefined };
    if (f) {
      keep.add(f.id);
      p = replaceFeature(p, f.id, (x) => {
        let y = withBuild(x, patch);
        if (model && model !== modelOf(x)) y = { ...y, model, modelEdited: true, modelReason: 'Picked on the pending list' };
        if (it.title && it.title !== x.title) y = { ...y, title: it.title };
        if (prev && it.status !== prev.status && PENDING_TO_PLAN[it.status]) y = { ...y, status: PENDING_TO_PLAN[it.status], edited: true, statusEdited: true, history: [...list(x.history), { at: now, text: `Pending builds: ${prev.status} → ${it.status}` }].slice(-100) };
        return y;
      });
    } else {
      const id = p.features.some((x) => x.id === str(it.id)) ? `${slug(it.id)}-${p.features.length}` : str(it.id) || slug(it.title);
      keep.add(id);
      p = { ...p, features: [...p.features, newBuildFeature({ id, title: it.title, status: PENDING_TO_PLAN[it.status] ?? 'planned', model: model || 'fable', source: str(it.source) || 'pending', now, build: patch })] };
    }
  }
  // items gone from the state: unpark (a pending-born feature with nothing else on it goes away)
  for (const f of p.features) {
    if (!f.build?.parked || keep.has(f.id)) continue;
    if (f.kind === BUILD_KIND && !f.build.orchestration && !f.build.record) p = { ...p, features: p.features.filter((x) => x.id !== f.id) };
    else p = replaceFeature(p, f.id, (x) => { const { parked: _p, ...rest } = x.build; return { ...x, build: normBuild(rest) ?? {} }; });
  }
  if (str(state?.artifact)) p = { ...p, builds: { ...p.builds, artifact: str(state.artifact) } };
  return touchBuilds(p, iso(state?.updatedAt) || now);
}
export function newBuildFeature({ id, title, status = 'planned', model = 'opus', source = 'pending', area = 'Builds', now = new Date().toISOString(), build = {} }) {
  return {
    id, title: str(title).trim() || 'Untitled build', area, kind: BUILD_KIND, status: PLAN_STATUSES.includes(status) ? status : 'planned', priority: 'P2', wave: 2, effort: '', summary: '',
    ports: {}, capabilities: [], dependsOn: [], catalog: [], modules: [], files: [], acceptance: [], warnings: [], recommendations: [], previews: [], screenshots: [], links: [], tags: ['build'], notes: '',
    model: low(model) || 'opus', modelReason: 'Set when the build was added', modelEdited: true, source, edited: true,
    history: [{ at: now, text: `Added from the ${source} list` }],
    build: normBuild(build) ?? {},
  };
}

/* ---------- Build queue view ---------- */
export function queueRecord(f) {
  const b = f.build ?? {};
  const rec = { ...(b.record ?? {}) };
  if (b.estimate) rec.estimate = b.estimate;
  if (b.steps?.length) rec.steps = b.steps.map((s) => clean({ text: s.text, estimate: s.estimate, ...(s.done ? { done: true, doneAt: s.doneAt } : {}) }));
  return Object.keys(rec).length ? rec : null;
}
/** build-queue@1 state (what build-queue-core's computeQueue and friends take). */
export function queueState(plan) {
  const p = normalizePlan(plan);
  const steps = {};
  for (const f of p.features) if (f.kind === 'epic') { const r = queueRecord(f); if (r) steps[f.id] = r; }
  const q = p.builds.queue;
  return { $axf: 'build-queue@1', order: [...q.order], steps, dirty: q.dirty, updatedAt: q.updatedAt, history: q.history.map((h) => ({ ...h })) };
}
const fromQueueStep = (s) => clean({ text: str(s?.text), estimate: str(s?.estimate).trim(), done: s?.done === true ? true : undefined, doneAt: s?.done === true ? iso(s?.doneAt) : '' });
/** Write a build-queue@1 state back (order/dirty/history to `builds.queue`, each record onto its epic). */
export function queueIntoPlan(plan, state, now = new Date().toISOString()) {
  let p = normalizePlan(plan);
  const s = state && typeof state === 'object' ? state : {};
  const recs = s.steps && typeof s.steps === 'object' ? s.steps : {};
  p = { ...p, builds: { ...p.builds, updatedAt: iso(s.updatedAt) || now, queue: { order: list(s.order).map(str), dirty: s.dirty === true, updatedAt: iso(s.updatedAt), history: list(s.history).map((h) => ({ at: iso(h?.at), by: str(h?.by), text: str(h?.text) })) } } };
  p = { ...p, features: p.features.map((f) => {
    if (f.kind !== 'epic') return f;
    const r = recs[f.id];
    if (!r) return f.build?.record || f.build?.estimate ? withBuild(f, { record: undefined, estimate: '' }) : f;
    const { estimate, steps, ...record } = r;
    return withBuild(f, { record: Object.keys(record).length ? record : undefined, estimate: str(estimate).trim(), ...(steps !== undefined ? { steps: mergeSteps(f.build?.steps, steps, now, fromQueueStep) } : {}) });
  }) };
  return p;
}

/* ---------- Build orchestrator view ---------- */
const orchIdOf = (f) => f.build?.orchestration?.id || f.id;
export function orchestratorBuild(f) {
  const b = f.build ?? {}; const o = b.orchestration ?? {}; const p = b.parked;
  const model = cap(modelOf(f));
  return {
    id: orchIdOf(f), title: f.title, category: o.category ?? '', detail: b.detail ?? '', status: orchStatusOf(f), hidden: b.hidden === true,
    source: o.source || p?.source || 'console', pendingId: p ? pendingIdOf(f) : '', branch: o.branch ?? '', pr: o.pr ?? '',
    createdAt: o.createdAt || p?.createdAt || '', updatedAt: o.updatedAt || p?.updatedAt || '', builtAt: orchStatusOf(f) === 'complete' || orchStatusOf(f) === 'archived' ? o.builtAt || p?.builtAt || '' : '',
    notes: (b.notes ?? []).map((n) => ({ text: n.text, at: n.at })),
    approvals: (o.approvals ?? []).map((a) => ({ ...a })),
    steps: (b.steps ?? []).map((s, i) => ({ id: s.id || `s${i + 1}`, text: s.text, model: cap(s.model || modelOf(f)) === 'Sonnet' ? 'Opus' : cap(s.model || modelOf(f)), why: s.why ?? '', phase: s.phase ?? '', group: s.group ?? '', estimate: s.estimate ?? '', files: [...(s.files ?? [])], checks: [...(s.checks ?? [])], session: s.session === 'new' ? 'new' : 'same', agent: s.agent === true, done: s.done === true, doneAt: s.done ? s.doneAt ?? '' : '', note: s.note ?? '' })),
  };
}
/** orchestrator@1 state. */
export function orchestratorState(plan) {
  const p = normalizePlan(plan);
  return { $axf: 'orchestrator@1', updatedAt: p.builds.updatedAt, rules: { ...p.builds.rules }, builds: p.features.filter((f) => f.build?.orchestration).map(orchestratorBuild) };
}
export function featureOfOrchestrator(plan, build) {
  const id = str(build?.id);
  return plan.features.find((f) => f.build?.orchestration && orchIdOf(f) === id) ?? (build?.pendingId ? plan.features.find((f) => f.build?.parked && pendingIdOf(f) === build.pendingId) : undefined) ?? plan.features.find((f) => f.id === id) ?? null;
}
const fromOrchStep = (s) => clean({ id: str(s?.id), text: str(s?.text), estimate: str(s?.estimate).trim(), model: low(s?.model), why: str(s?.why), phase: str(s?.phase), group: str(s?.group), files: list(s?.files).map(str), checks: list(s?.checks).map(str), session: s?.session === 'new' ? 'new' : '', agent: s?.agent === true ? true : undefined, done: s?.done === true ? true : undefined, doneAt: s?.done === true ? iso(s?.doneAt) : '', note: str(s?.note) });
/** Write an orchestrator@1 state back. */
export function orchestratorIntoPlan(plan, state, now = new Date().toISOString()) {
  let p = normalizePlan(plan);
  const s = state && typeof state === 'object' ? state : {};
  p = { ...p, builds: { ...p.builds, updatedAt: iso(s.updatedAt) || now, rules: { ...DEFAULT_RULES, ...(s.rules && typeof s.rules === 'object' ? s.rules : {}) } } };
  const keep = new Set();
  for (const b of list(s.builds)) {
    const f = featureOfOrchestrator(p, b);
    const prev = f ? orchestratorBuild(f) : null;
    const so = f?.build?.orchestration ?? {};
    const orch = clean({ id: f && f.id !== str(b.id) ? str(b.id) : '', category: str(b.category), branch: str(b.branch), pr: str(b.pr), source: prev && str(b.source) === prev.source ? so.source : str(b.source), status: ORCH_STATUSES.includes(b.status) && b.status !== 'archived' ? b.status : '', approvals: list(b.approvals).map((a) => ({ phase: Number(a?.phase) || 0, from: str(a?.from), to: str(a?.to), at: iso(a?.at) })), createdAt: keepDate(prev?.createdAt, b.createdAt, so.createdAt), updatedAt: keepDate(prev?.updatedAt, b.updatedAt, so.updatedAt), builtAt: keepDate(prev?.builtAt, b.builtAt, so.builtAt) });
    const orchSteps = list(b.steps);
    const patch = { orchestration: orch, detail: str(b.detail), notes: notes(b.notes), hidden: b.hidden === true ? true : undefined, archived: b.status === 'archived' ? true : undefined, steps: orchSteps.map((x, i) => normStep({ ...(f?.build?.steps?.find((o) => o.id === str(x?.id)) ?? f?.build?.steps?.[i] ?? {}), ...fromOrchStep(x) }, i, now)) };
    if (f) {
      keep.add(f.id);
      p = replaceFeature(p, f.id, (x) => {
        let y = withBuild(x, patch);
        if (b.title && b.title !== x.title) y = { ...y, title: b.title };
        if (prev && b.status !== prev.status && b.status !== 'archived' && ORCH_TO_PLAN[b.status] && ORCH_TO_PLAN[b.status] !== x.status) y = { ...y, status: ORCH_TO_PLAN[b.status], edited: true, statusEdited: true, history: [...list(x.history), { at: now, text: `Build orchestrator: ${prev.status} → ${b.status}` }].slice(-100) };
        if (prev && prev.status === 'archived' && b.status !== 'archived') y = withBuild(y, { archived: undefined });
        return y;
      });
    } else {
      const id = p.features.some((x) => x.id === str(b.id)) ? `${slug(b.id)}-${p.features.length}` : str(b.id) || slug(b.title);
      keep.add(id);
      const status = b.status === 'archived' ? 'built' : ORCH_TO_PLAN[b.status] ?? 'planned';
      const model = low(orchSteps.find((x) => !x?.done)?.model) || low(orchSteps[0]?.model) || 'opus';
      p = { ...p, features: [...p.features, newBuildFeature({ id, title: b.title, status, model, source: str(b.source) || 'console', area: str(b.category) || 'Builds', now, build: patch })] };
    }
  }
  for (const f of p.features) {
    if (!f.build?.orchestration || keep.has(f.id)) continue;
    if (f.kind === BUILD_KIND && !f.build.parked && !f.build.record) p = { ...p, features: p.features.filter((x) => x.id !== f.id) };
    else p = replaceFeature(p, f.id, (x) => { const { orchestration: _o, ...rest } = x.build; return { ...x, build: normBuild(rest) ?? {} }; });
  }
  return p;
}

/* ---------- Tracker + status exports ---------- */
const TRACKER_STATUSES = ['built', 'partial', 'placeholder', 'planned'];
const trackerStatus = (s) => (TRACKER_STATUSES.includes(s) ? s : s === 'in-progress' ? 'partial' : s === 'dropped' ? 'planned' : 'planned');
/** status.json shape: every catalog feature's { status, wave, module?, notes? }. */
export function statusMap(plan) {
  const out = {};
  for (const f of list(plan?.features)) if (f.source === 'catalog') out[f.id] = clean({ status: trackerStatus(f.status), wave: f.wave, module: f.modules?.[0] ?? undefined, notes: f.notes || undefined });
  return out;
}
/** tracker@1 from the plan's catalog features (ids from `tab` / `groupId` / `tag`, falling back to the labels). `catalog` gives the tab order + frameworkVersion. */
export function trackerState(plan, catalog, generatedAt = '') {
  const feats = list(plan?.features).filter((f) => f.source === 'catalog');
  const items = feats.map((f) => ({ id: f.id, tab: f.tab ?? f.tags?.[0] ?? '', group: f.groupId ?? slug(f.group), ...(f.parent ? { parent: f.parent } : {}), title: f.title, tag: f.tag ?? (f.parent ? 'suggested' : f.tags?.[1] ?? ''), status: trackerStatus(f.status), wave: f.wave ?? 3, module: f.modules?.[0] ?? null, notes: f.notes ?? '' }));
  const tabs = list(catalog?.tabs).map((t) => t.id);
  for (const it of items) if (!tabs.includes(it.tab)) tabs.push(it.tab);
  const summary = {};
  for (const tab of tabs) {
    const rows = items.filter((i) => i.tab === tab && !i.parent);
    summary[tab] = Object.fromEntries(TRACKER_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
    summary[tab].total = rows.length;
    summary[tab].coverage = rows.length ? Math.round((rows.filter((r) => r.status === 'built').length / rows.length) * 100) : 0;
  }
  return { $axf: 'tracker@1', frameworkVersion: catalog?.frameworkVersion ?? '', generatedAt, summary, items };
}

/* ---------- rows: one row per build, nested info for every view ---------- */
const minutes = (e) => { const m = /^\s*~?\s*(\d+(?:[.,]\d+)?)\s*(min|mins|minute|minutes|m|h|hr|hrs|hour|hours|d|day|days)\b/i.exec(str(e)); if (!m) return null; const n = Number(m[1].replace(',', '.')); const u = m[2].toLowerCase(); return Math.round(n * (u.startsWith('d') ? 480 : u.startsWith('h') ? 60 : 1)); };
export function stepsSummary(f) {
  const steps = f.build?.steps ?? [];
  const mins = steps.map((s) => minutes(s.estimate));
  const own = minutes(f.build?.estimate);
  const total = steps.length && mins.every((n) => n != null) ? mins.reduce((a, b) => a + b, 0) : own ?? (mins.some((n) => n != null) ? mins.reduce((a, b) => a + (b ?? 0), 0) : null);
  const left = steps.length ? steps.filter((s) => !s.done).reduce((a, s, i) => a + (minutes(s.estimate) ?? 0), 0) : total;
  return { total: steps.length, done: steps.filter((s) => s.done).length, minutesTotal: total, minutesLeft: total == null ? null : Math.min(left ?? total, total), needsSplit: total != null && total > 30 && (!steps.length || mins.some((n) => n == null || n > 30)) };
}
/** Phases of a build's steps (the orchestrator's rule): a run of consecutive steps with one phase label and one model; a gate where the model changes. */
export function phasesOf(f) {
  const out = [];
  for (const [i, s] of (f.build?.steps ?? []).entries()) {
    const model = s.model || modelOf(f);
    const last = out[out.length - 1];
    if (last && last.model === model && (!s.phase || s.phase === last.label)) last.steps.push({ ...s, index: i });
    else out.push({ index: out.length, model, label: s.phase || '', steps: [{ ...s, index: i }], gate: !!last && last.model !== model, from: last?.model ?? '' });
  }
  const approvals = f.build?.orchestration?.approvals ?? [];
  for (const p of out) {
    p.name = p.label || `Phase ${p.index + 1}`;
    p.done = p.steps.every((s) => s.done);
    p.approved = !p.gate || approvals.some((a) => a.phase === p.index && low(a.to) === p.model);
    p.minutesLeft = p.steps.filter((s) => !s.done).reduce((t, s) => t + (minutes(s.estimate) ?? 0), 0);
  }
  return out;
}
export function viewsOf(f, plan) {
  const v = ['plan'];
  if (f.source === 'catalog') v.push('tracker');
  if (f.kind === 'epic' && (plan?.builds?.queue?.order ?? []).includes(f.id)) v.push('queue');
  if (f.build?.parked && f.status !== 'dropped') v.push('pending');
  if (f.build?.orchestration) v.push('orchestrator');
  return v;
}
/**
 * One row per feature with everything a view nests under it. opts.view narrows to that view's members (plan = every
 * feature); opts.filter(row) narrows further. Rows keep plan order, except the queue view, which follows the queue order.
 */
export function rows(plan, opts = {}) {
  const p = normalizePlan(plan);
  const byId = new Map(p.features.map((f) => [f.id, f]));
  const pos = new Map(p.builds.queue.order.map((id, i) => [id, i + 1]));
  const row = (f) => {
    const views = viewsOf(f, p);
    const linked = f.kind === 'epic' ? p.features.filter((x) => x.id !== f.id && x.kind !== 'epic' && (x.epic === f.id || (f.catalog ?? []).includes(x.id))).map((x) => ({ id: x.id, title: x.title, status: x.status, model: modelOf(x) })) : [];
    const deps = (f.dependsOn ?? []).map((d) => { const x = byId.get(d); return { id: d, title: x?.title ?? d, status: x?.status ?? 'missing', position: pos.get(d) ?? null, done: x?.status === 'built' }; });
    const dependents = p.features.filter((x) => (x.dependsOn ?? []).includes(f.id)).map((x) => ({ id: x.id, title: x.title, status: x.status }));
    const sum = stepsSummary(f);
    return {
      id: f.id, title: f.title, kind: f.kind, area: f.area ?? '', group: f.group ?? '', category: f.build?.orchestration?.category ?? '', status: f.status,
      pendingStatus: pendingStatusOf(f), orchestratorStatus: orchStatusOf(f), trackerStatus: f.source === 'catalog' ? trackerStatus(f.status) : null,
      model: modelOf(f), modelReason: f.modelReason ?? '', source: f.source ?? '', priority: f.priority ?? '', wave: f.wave ?? null, effort: f.effort ?? '',
      views, position: pos.get(f.id) ?? null, parent: f.parent ?? null, epic: f.epic ?? null, tab: f.tab ?? f.tags?.[0] ?? '', tag: f.tag ?? '',
      summary: f.summary ?? '', detail: f.build?.detail ?? '', estimate: f.build?.estimate ?? '', ...sum,
      steps: (f.build?.steps ?? []).map((s) => ({ ...s, model: s.model || modelOf(f) })), phases: phasesOf(f), notes: f.build?.notes ?? [], history: f.history ?? [],
      deps, dependents, linked, acceptance: f.acceptance ?? [], ports: f.ports ?? {}, modules: f.modules ?? [], files: f.files ?? [], links: f.links ?? [], warnings: f.warnings ?? [],
      parked: f.build?.parked ?? null, record: f.build?.record ?? null, orchestration: f.build?.orchestration ?? null, hidden: f.build?.hidden === true, archived: f.build?.archived === true,
      createdAt: f.build?.parked?.createdAt || f.build?.orchestration?.createdAt || f.history?.[0]?.at || '', builtAt: f.build?.parked?.builtAt || f.build?.orchestration?.builtAt || f.build?.record?.completedAt || '',
    };
  };
  let feats = p.features;
  if (opts.view && opts.view !== 'plan') {
    if (opts.view === 'queue') { const seq = p.builds.queue.order.map((id) => byId.get(id)).filter(Boolean); feats = seq.length ? seq : p.features.filter((f) => f.kind === 'epic'); }
    else feats = p.features.filter((f) => viewsOf(f, p).includes(opts.view));
  }
  let out = feats.map(row);
  if (typeof opts.filter === 'function') out = out.filter(opts.filter);
  return out;
}
export function countsByView(plan) {
  const p = normalizePlan(plan);
  const c = Object.fromEntries(VIEWS.map((v) => [v, 0]));
  for (const f of p.features) for (const v of viewsOf(f, p)) c[v] += 1;
  return c;
}

/* ---------- migration: the four files → one plan ---------- */
/**
 * migrate({ plan, pending, queue, orchestrator, now }) → { plan, report }. Pure. Attaches each pending item to the
 * feature its planId names (else a feature of its own id, else a new `build` feature), each orchestrator build to
 * the feature holding its pendingId / id (else a new feature), each queue record to its epic. Steps: the orchestrator's
 * list wins when it has one; a pending list with the same count as the queue's is the same list (merged by position);
 * otherwise lists are concatenated and reported. Statuses: a list that knows more than the plan (complete, failed,
 * broken, unsafe, running) updates the plan and is reported, so the drift this build fixes is visible once.
 */
export function migrate({ plan, pending, queue, orchestrator, status, now = new Date().toISOString() }) {
  const report = { attached: [], created: [], statusChanges: [], stepsMerged: [], titles: [], orphans: [], catalogFilled: 0, counts: {} };
  let p = normalizePlan(plan);
  // 0. catalog features edited in the console may lack what status.json knows (module, wave, notes): fill the gaps, never overwrite
  if (status && typeof status === 'object') p = { ...p, features: p.features.map((f) => {
    if (f.source !== 'catalog' || !status[f.id]) return f;
    const st = status[f.id]; let g = f; let filled = false;
    if (!list(f.modules).length && st.module) { g = { ...g, modules: [str(st.module)] }; filled = true; }
    if ((f.wave == null) && st.wave != null) { g = { ...g, wave: st.wave }; filled = true; }
    if (!str(f.notes) && str(st.notes)) { g = { ...g, notes: str(st.notes) }; filled = true; }
    if (filled) report.catalogFilled += 1;
    return g;
  }) };
  const q = queue && typeof queue === 'object' ? queue : {};
  const pend = pending && typeof pending === 'object' ? pending : {};
  const orch = orchestrator && typeof orchestrator === 'object' ? orchestrator : {};
  // 1. file-level state
  p = { ...p, builds: { ...p.builds, $axf: SCHEMA, artifact: str(pend.artifact) || p.builds.artifact, queue: { order: list(q.order).map(str), dirty: q.dirty === true, updatedAt: iso(q.updatedAt), history: list(q.history).map((h) => ({ at: iso(h?.at), by: str(h?.by), text: str(h?.text) })) }, rules: { ...DEFAULT_RULES, ...(orch.rules ?? {}) }, migratedAt: now, migratedFrom: { pending: list(pend.items).length, queue: Object.keys(q.steps ?? {}).length, orchestrator: list(orch.builds).length } } };
  // 2. queue records → epics
  for (const [id, r] of Object.entries(q.steps ?? {})) {
    const f = p.features.find((x) => x.id === id);
    if (!f) { report.orphans.push({ from: 'queue', id, why: 'no such feature in the plan' }); continue; }
    const { estimate, steps, ...record } = r ?? {};
    p = replaceFeature(p, id, (x) => withBuild(x, { record: Object.keys(record).length ? record : undefined, estimate: str(estimate).trim(), steps: list(steps).map((s, i) => normStep(fromQueueStep(s), i, now)) }));
    report.attached.push({ from: 'queue', id, to: id });
  }
  // 3. pending items
  for (const it of list(pend.items)) {
    const item = { ...it, id: str(it.id) };
    let f = item.planId ? p.features.find((x) => x.id === item.planId) : null;
    if (!f) f = p.features.find((x) => x.id === item.id) ?? null;
    const subs = list(item.subPrompts).map((s, i) => normStep(fromSub(s), i, now));
    if (f) {
      const old = f.build?.steps ?? [];
      let steps;
      if (!old.length) steps = subs;
      else if (old.length === subs.length) steps = old.map((o, i) => normStep({ ...subs[i], ...o, at: subs[i].at || o.at, done: o.done || subs[i].done, doneAt: o.doneAt || subs[i].doneAt }, i, now));
      else { steps = [...old, ...subs.map((s, i) => ({ ...s, id: `p${i + 1}` }))]; report.stepsMerged.push({ id: f.id, from: 'pending', queueSteps: old.length, pendingSteps: subs.length, kept: 'both (concatenated)' }); }
      const parked = clean({ pendingId: item.id !== f.id ? item.id : '', source: str(item.source), createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt), builtAt: iso(item.builtAt) });
      const planStatus = PENDING_TO_PLAN[item.status];
      p = replaceFeature(p, f.id, (x) => {
        let y = withBuild(x, { parked, detail: str(item.detail), estimate: str(item.estimate).trim() || x.build?.estimate, notes: notes(item.notes), steps });
        if (planStatus && planStatus !== x.status && (item.status !== 'pending' || !['partial', 'in-progress', 'placeholder', 'blocked'].includes(x.status))) { report.statusChanges.push({ id: x.id, from: x.status, to: planStatus, by: `pending item ${item.id} (${item.status})` }); y = { ...y, status: planStatus, edited: true, statusEdited: true, history: [...list(x.history), { at: now, text: `Builds migration: pending list said ${item.status} (was ${x.status})` }].slice(-100) }; }
        if (low(item.model) && low(item.model) !== modelOf(x)) y = { ...y, model: low(item.model), modelEdited: true, modelReason: 'From the pending list' };
        return y;
      });
      if (str(item.title).trim() && item.title !== f.title) report.titles.push({ id: f.id, plan: f.title, pending: item.title });
      report.attached.push({ from: 'pending', id: item.id, to: f.id });
    } else {
      const parked = clean({ source: str(item.source), planId: str(item.planId), createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt), builtAt: iso(item.builtAt) });
      p = { ...p, features: [...p.features, newBuildFeature({ id: item.id || slug(item.title), title: item.title, status: PENDING_TO_PLAN[item.status] ?? 'planned', model: low(item.model) || 'fable', source: str(item.source) || 'pending', now, build: { parked, detail: str(item.detail), estimate: str(item.estimate).trim(), notes: notes(item.notes), steps: subs } })] };
      if (item.planId) report.orphans.push({ from: 'pending', id: item.id, why: `planId ${item.planId} is not in the plan; kept on the entry` });
      report.created.push({ from: 'pending', id: item.id, status: PENDING_TO_PLAN[item.status] ?? 'planned' });
    }
  }
  // 4. orchestrator builds
  for (const b of list(orch.builds)) {
    const id = str(b.id);
    let f = (b.pendingId ? p.features.find((x) => x.build?.parked && pendingIdOf(x) === b.pendingId) : null) ?? p.features.find((x) => x.id === id || (x.build?.parked && pendingIdOf(x) === id)) ?? null;
    const steps = list(b.steps).map((x, i) => normStep(fromOrchStep(x), i, now));
    const orchestration = clean({ id: f && f.id !== id ? id : '', category: str(b.category), branch: str(b.branch), pr: str(b.pr), source: str(b.source), status: ORCH_STATUSES.includes(b.status) && b.status !== 'archived' ? b.status : '', approvals: list(b.approvals).map((a) => ({ phase: Number(a?.phase) || 0, from: str(a?.from), to: str(a?.to), at: iso(a?.at) })), createdAt: iso(b.createdAt), updatedAt: iso(b.updatedAt), builtAt: iso(b.builtAt) });
    if (f) {
      const old = f.build?.steps ?? [];
      if (old.length && old.length !== steps.length) report.stepsMerged.push({ id: f.id, from: 'orchestrator', had: old.length, orchestrator: steps.length, kept: 'orchestrator' });
      const merged = steps.map((s, i) => normStep({ ...(old[i] ?? {}), ...s, done: s.done || old[i]?.done, doneAt: s.doneAt || old[i]?.doneAt }, i, now));
      const ticks = steps.filter((s, i) => !!s.done !== !!old[i]?.done && old[i]).length;
      if (ticks) report.stepsMerged.push({ id: f.id, from: 'orchestrator', ticks, kept: 'done where either list said done' });
      const planStatus = b.status === 'archived' ? null : ORCH_TO_PLAN[b.status];
      p = replaceFeature(p, f.id, (x) => {
        let y = withBuild(x, { orchestration, detail: str(b.detail) || x.build?.detail, notes: [...(x.build?.notes ?? []), ...notes(b.notes).filter((n) => !(x.build?.notes ?? []).some((o) => o.text === n.text))], hidden: b.hidden === true ? true : undefined, archived: b.status === 'archived' ? true : undefined, steps: merged });
        if (planStatus && planStatus !== x.status && b.status !== 'pending') { report.statusChanges.push({ id: x.id, from: x.status, to: planStatus, by: `orchestrator build ${id} (${b.status})` }); y = { ...y, status: planStatus, edited: true, statusEdited: true, history: [...list(x.history), { at: now, text: `Builds migration: orchestrator said ${b.status} (was ${x.status})` }].slice(-100) }; }
        return y;
      });
      report.attached.push({ from: 'orchestrator', id, to: f.id });
    } else {
      const status = b.status === 'archived' ? 'built' : ORCH_TO_PLAN[b.status] ?? 'planned';
      const model = low(steps.find((x) => !x.done)?.model) || low(steps[0]?.model) || 'opus';
      p = { ...p, features: [...p.features, newBuildFeature({ id, title: b.title, status, model, source: str(b.source) || 'console', area: str(b.category) || 'Builds', now, build: { orchestration, detail: str(b.detail), notes: notes(b.notes), hidden: b.hidden === true ? true : undefined, archived: b.status === 'archived' ? true : undefined, steps } })] };
      report.created.push({ from: 'orchestrator', id, status });
    }
  }
  p = touchBuilds(normalizePlan(p), now);
  report.counts = { features: p.features.length, ...countsByView(p) };
  return { plan: p, report };
}
