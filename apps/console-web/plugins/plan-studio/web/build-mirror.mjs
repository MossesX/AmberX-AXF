/**
 * build-mirror@1 — every orchestrator build has its stepped plan in Plan Studio, kept in step both ways (pure, IO-free).
 *
 * Brett, Nov 8 2026: "It also needs to make the stepped plan in Plan Studio for the build. And it needs to update any
 * plan in the Plan Studio. So the Plan Studio needs to be uh, somehow synced with future builds."
 *
 * One source of truth: the builds store (builds@1). A build's plan is a view of it:
 *   - planFromBuild(build, existing): the plan@1 the build should have. Steps mirror the build's steps exactly (same
 *     ids, order, text, estimates, models, done); the plan keeps only what a build does not carry (its body,
 *     requirements, comments, features, category once set…).
 *   - compare(plan, build): every way a plan's steps differ from the build's split (empty = in sync). The check
 *     (`plans.mjs check-builds`, CI test, systems check) fails on any.
 *   - editsFor(plan, build): what a Plan Studio edit asks of the build (step text / model / estimate / done, added and
 *     removed open steps, title), applied to the store by plans.mjs — then the store's build-hook event mirrors the
 *     build back into the plan, so both converge on the store.
 */

export const SCHEMA = 'build-mirror@1';
/** builds@1 status → plan@1 status. */
export const STATUS_MAP = Object.freeze({ pending: 'parked', queued: 'ready', running: 'building', waiting: 'building', blocked: 'building', failed: 'building', built: 'building', complete: 'done', archived: 'dropped' });
/** Builds that get a plan when the mirror is backfilled (future builds always get one, whatever their status). */
export const BACKFILL_STATUSES = Object.freeze(['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built']);
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function minutes(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const s = str(v).toLowerCase(); let m = 0, hit = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/g)) { hit = true; m += Number(n) * (u.startsWith('h') ? 60 : 1); }
  if (!hit && /^\d+(\.\d+)?$/.test(s.trim())) m = Number(s);
  return Math.round(m);
}
const model = (m) => (/fable/i.test(str(m)) ? 'Fable' : 'Opus');
const priority = (b) => { const p = str(b.priority).toUpperCase(); return /^P[0-3]$/.test(p) ? p : b.urgent === true ? 'P0' : 'P2'; };

/** The plan id for a build: the build id when it is a valid plan id, else a slug of it. */
export function planIdFor(buildId) {
  const id = str(buildId, 200).toLowerCase();
  if (ID_RE.test(id)) return id;
  return (id.replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 80) || 'build').replace(/-+$/, '');
}
/** The live (not removed) steps of a build, in order. */
export const buildSteps = (b) => arr(b?.steps).filter((s) => isObj(s) && !s.removed && !s.deleted && str(s.text || s.title).trim());
/** One build step as a plan step. */
export function stepFromBuild(s) {
  return { id: str(s.id, 40), uid: str(s.uid, 60), text: str(s.text || s.title, 2000).trim(), model: model(s.model), minutes: minutes(s.estimate), phase: str(s.phase, 60), done: s.done === true || s.skip === true, doneAt: s.done === true ? str(s.doneAt, 40) : '', ...(s.skip === true ? { skip: true } : {}) };
}
/** Find the plan of a build: one linked to it, else one with its id. */
export function findPlan(plans, b) {
  const id = str(b?.id, 200);
  return arr(plans).find((p) => p?.build?.id === id) ?? arr(plans).find((p) => p?.id === planIdFor(id)) ?? null;
}
const progressOf = (steps) => (steps.length ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100) : 0);

/** The plan@1 a build should have (not normalized: plans.mjs savePlan does that). `existing` keeps its own fields. */
export function planFromBuild(b, existing = null, { now = new Date().toISOString(), profile = 'all' } = {}) {
  const steps = buildSteps(b).map(stepFromBuild);
  const prof = str(existing?.build?.profile, 40) || profile;
  const ref = `${prof}:${b.id}`;
  const keep = arr(existing?.links).filter((l) => !(l.kind === 'build' && l.ref === ref) && !(l.kind === 'pr' && l.label === 'Build PR') && !(l.kind === 'branch' && l.label === 'Build branch'));
  const links = [...keep, { kind: 'build', ref, label: 'Orchestrator build' }, ...(b.pr ? [{ kind: 'pr', ref: str(b.pr, 300), label: 'Build PR' }] : []), ...(b.branch ? [{ kind: 'branch', ref: str(b.branch, 200), label: 'Build branch' }] : [])];
  const o = isObj(b.origin) ? b.origin : null;
  const origin = o && (o.said || arr(o.addenda).length) ? { said: str(o.said, 8000), at: str(o.at, 40), source: str(o.source, 40), session: str(o.session, 200), link: str(o.link, 600), by: str(o.by, 120), addenda: arr(o.addenda).map((a) => ({ said: str(a?.said, 8000), at: str(a?.at, 40), source: str(a?.source, 40) })) } : existing?.origin;
  const status = STATUS_MAP[str(b.status)] ?? 'parked';
  const complete = str(b.status) === 'complete';
  const base = existing ?? { id: planIdFor(b.id), category: b.category ? `Builds > ${str(b.category, 80)}` : 'Builds', body: '', createdBy: 'orchestrator', createdAt: str(b.createdAt, 40) || now };
  return {
    ...base,
    title: str(b.title, 200).trim() || str(b.id, 200),
    summary: str(b.detail, 2000),
    status: b.deleted ? 'dropped' : status,
    priority: priority(b),
    profile: prof,
    steps,
    links,
    ...(origin ? { origin } : {}),
    build: { ...(isObj(existing?.build) ? existing.build : {}), profile: prof, id: str(b.id, 200), linkedAt: str(existing?.build?.linkedAt, 40) || now, status: str(b.status), progress: progressOf(steps), title: str(b.title, 300), branch: str(b.branch, 200), pr: str(b.pr, 300), mirror: SCHEMA },
    features: complete ? arr(base.features).map((f) => (f?.state === 'planned' ? { ...f, state: 'have', haveAt: now } : f)) : arr(base.features),
  };
}

/** How a plan's steps differ from its build's split: [{ step, field, plan, build }] (empty = exactly in sync). */
export function compare(plan, b) {
  const out = [];
  if (!plan) return [{ step: '', field: 'plan', plan: null, build: str(b?.id) }];
  const want = buildSteps(b).map(stepFromBuild);
  const have = arr(plan.steps);
  if (have.length !== want.length) out.push({ step: '', field: 'count', plan: have.length, build: want.length });
  for (let i = 0; i < Math.max(have.length, want.length); i += 1) {
    const h = have[i], w = want[i];
    if (!h || !w) { if (h || w) out.push({ step: str((w ?? h).id), field: h ? 'extra' : 'missing', plan: h?.id ?? null, build: w?.id ?? null }); continue; }
    for (const f of ['id', 'text', 'model', 'minutes', 'done']) {
      const a = f === 'text' ? str(h.text).trim() : f === 'done' ? !!h.done : f === 'minutes' ? Number(h.minutes) || 0 : str(h[f]);
      const c = f === 'text' ? w.text : w[f];
      if (a !== c) out.push({ step: w.id, field: f, plan: a, build: c });
    }
  }
  return out;
}

/**
 * What a Plan Studio edit of a linked plan asks of its build: { title?, steps: [{ op: set|add|remove, id, … }] }.
 * Steps match by uid, else id. Done steps are never removed or rewritten from a plan (the build's history wins);
 * a plan may tick a step done.
 */
export function editsFor(plan, b) {
  const steps = buildSteps(b);
  const byKey = (s) => steps.find((x) => (s.uid && x.uid === s.uid)) ?? steps.find((x) => x.id === s.id);
  const ops = [];
  const seen = new Set();
  for (const s of arr(plan?.steps)) {
    const t = byKey(s);
    if (!t) { if (str(s.text).trim() && !s.done) ops.push({ op: 'add', text: str(s.text, 2000).trim(), model: model(s.model), estimate: `${Number(s.minutes) || 20} min`, phase: str(s.phase, 60), planStep: str(s.id, 40) }); continue; }
    seen.add(t.id);
    const cur = stepFromBuild(t);
    const set = {};
    if (!t.done) {
      if (str(s.text).trim() && str(s.text).trim() !== cur.text) set.text = str(s.text, 2000).trim();
      if (model(s.model) !== cur.model) set.model = model(s.model);
      if ((Number(s.minutes) || 0) !== cur.minutes && Number(s.minutes) > 0) set.estimate = `${Number(s.minutes)} min`;
      if (s.done === true) set.done = true;
    }
    if (Object.keys(set).length) ops.push({ op: 'set', id: t.id, ...set });
  }
  for (const t of steps) if (!seen.has(t.id) && !t.done && !t.skip) ops.push({ op: 'remove', id: t.id });
  const title = str(plan?.title, 200).trim();
  return { ...(title && title !== str(b?.title).trim() ? { title } : {}), steps: ops };
}
export const hasEdits = (e) => !!e && (!!e.title || arr(e.steps).length > 0);

/** Apply editsFor() to an orchestrator@1 build (a copy). New steps get the next free s<n> id. */
export function applyEdits(b, edits, { now = new Date().toISOString() } = {}) {
  const next = { ...b, steps: arr(b.steps).map((s) => ({ ...s })) };
  if (edits.title) next.title = edits.title;
  let n = next.steps.reduce((m, s) => Math.max(m, Number(/^s(\d+)$/.exec(str(s.id))?.[1]) || 0), 0);
  for (const e of arr(edits.steps)) {
    if (e.op === 'set') { const s = next.steps.find((x) => x.id === e.id); if (!s) continue; for (const k of ['text', 'model', 'estimate']) if (e[k] !== undefined) s[k] = e[k]; if (e.done) { s.done = true; s.doneAt = now; } s.updatedAt = now; }
    else if (e.op === 'remove') {
      const gone = next.steps.find((x) => x.id === e.id && !x.done); if (!gone) continue;
      next.steps = next.steps.filter((x) => x !== gone);
      next.removedSteps = [...arr(next.removedSteps), { step: gone, at: now, why: 'removed in Plan Studio', by: 'plan-studio' }];
    }
    else if (e.op === 'add') { n += 1; next.steps.push({ id: `s${n}`, text: e.text, model: e.model, estimate: e.estimate, phase: e.phase, why: '', group: '', files: [], checks: [], session: 'same', agent: false, skip: false, done: false, doneAt: '', note: `Added in Plan Studio (${e.planStep || 'new step'})`, createdAt: now, updatedAt: now }); }
  }
  next.updatedAt = now;
  return next;
}
