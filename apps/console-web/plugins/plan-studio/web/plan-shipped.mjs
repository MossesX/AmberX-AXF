/**
 * Plan Studio ← shipped-manifest@1 (pure, IO-free). Brett, Nov 9 2026: "Make sure it creates the plan studio, make
 * sure it gets all the correct information, the fields of the manifest are sent to the plan studio. So the plan studio's
 * gotta receive a manifest too. It has to be valid."
 *
 * When the orchestrator ships a build (framework/core/shipped-manifest.mjs, sent as the build-hook@1 `shipped` event),
 * Plan Studio takes the same manifest: the build's plan (plan id = build id, the way "Turn into a build" links them) is
 * created or updated with every manifest field. The whole normalised manifest is kept on the plan as `shipped`, and the
 * fields a plan has of its own are filled from it: Brett's verbatim words (`origin`, never replaced by a paraphrase),
 * steps with estimates and actual times, branch / PR / report links, the build link with the landed commit, status
 * (done when it landed with nothing open), planned features → have, and `actual` cost and tokens (plan `cost` stays the
 * estimate summed from the steps).
 *
 * A manifest that fails shipped-manifest@1 validation is never stored as `shipped`: the plan is flagged instead
 * (`shippedProblem`: the field errors), so the plan and the terminal both show what was wrong. A valid manifest clears
 * the flag. The same manifest id + rev applied twice changes nothing (build hooks replay).
 *
 * Validation itself lives in the shared module (framework/core/shipped-manifest.mjs); the IO side (plans.mjs) runs it
 * and hands this module the normalised manifest.
 */

const str = (v, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const nowIso = () => new Date().toISOString();
const PLAN_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/** The plan a manifest belongs to: its build id (plan id = build id), or '' when the manifest names no build. */
export function planIdFor(manifest) {
  const id = str(obj(obj(manifest).build).id, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return PLAN_ID.test(id) ? id : '';
}
/** The build's work is on main. */
export const isLanded = (m) => !!(str(obj(m).landedCommit) || str(obj(m).mergedAt) || str(obj(m).landedAt));

const addLink = (links, kind, ref, label) => (!ref || links.some((l) => l.kind === kind && l.ref === ref) ? links : [...links, { kind, ref, label }]);
const newPlan = (m) => {
  const b = obj(m.build);
  return {
    id: planIdFor(m), title: str(b.title, 200) || str(b.id, 200), status: 'building', priority: /^P[0-3]$/.test(str(b.priority)) ? b.priority : 'P2',
    category: b.category ? `Builds > ${str(b.category, 60)}` : 'Builds', profile: str(b.profile, 40), createdBy: 'orchestrator', steps: [], links: [], tags: [], features: [],
  };
};
const uniqueStepId = (steps, want) => { let id = want || `s${steps.length + 1}`; let k = 1; while (steps.some((s) => s.id === id)) { k += 1; id = `${want || 's'}-${k}`; } return id; };

/**
 * The plan with the manifest applied. Returns { plan, changed, stale }: `stale` when the plan already carries this
 * manifest at the same or a newer rev (nothing changes). `plan` may be null (a plan is created from the manifest).
 */
export function applyManifest(plan, manifest, { now = nowIso() } = {}) {
  const m = obj(manifest);
  const id = planIdFor(m); if (!id) throw new Error('shipped-manifest@1 names no build: nothing to plan');
  const have = obj(plan).id ? { ...plan } : null;
  const cur = obj(have?.shipped);
  if (have && cur.id === m.id && Number(cur.rev) >= Number(m.rev)) return { plan: have, changed: false, stale: Number(cur.rev) > Number(m.rev) };
  const base = have ?? newPlan(m);
  const landed = isLanded(m);
  const mSteps = arr(m.steps);
  const allDone = mSteps.length > 0 && mSteps.every((s) => s.done);

  // steps: the manifest's steps tick the plan's (by id, else by text) and bring their estimate and actual time; new ones are added
  const steps = arr(base.steps).map((s) => ({ ...s }));
  for (const ms of mSteps) {
    const text = str(ms.text, 2000).trim();
    let s = steps.find((x) => x.id === ms.id && str(x.text).trim() === text) ?? steps.find((x) => str(x.text).trim() === text) ?? steps.find((x) => x.id === ms.id && !mSteps.some((y) => y !== ms && str(y.text).trim() === str(x.text).trim()));
    if (!s) { s = { id: uniqueStepId(steps, ms.id), text, model: ms.model || 'Opus', minutes: ms.estimateMin || 0, dependsOn: [], done: false, doneAt: '', phase: '' }; steps.push(s); }
    if (!s.minutes && ms.estimateMin) s.minutes = ms.estimateMin;
    if (ms.estimate) s.estimate = ms.estimate;
    if (ms.startedAt) s.startedAt = ms.startedAt;
    if (ms.actualMin) s.actualMin = ms.actualMin;
    if (ms.done && !s.done) { s.done = true; s.doneAt = ms.doneAt || now; }
    else if (ms.done && ms.doneAt && !s.doneAt) s.doneAt = ms.doneAt;
  }

  // Brett's words: verbatim wins; a paraphrase never replaces verbatim words already on the plan
  const said = obj(m.said);
  const oldOrigin = obj(base.origin);
  const originFromManifest = { ...oldOrigin, said: str(said.text, 20000), verbatim: said.verbatim !== false, at: str(said.at, 40), source: str(said.source, 40), by: str(said.by, 120), addenda: arr(said.addenda).map((a) => ({ said: str(a.text, 20000), at: str(a.at, 40), source: str(a.source, 40), verbatim: a.verbatim !== false })) };
  const keepOld = str(oldOrigin.said).trim() && oldOrigin.verbatim !== false && said.verbatim === false;
  const origin = str(said.text).trim() && !keepOld ? originFromManifest : (str(oldOrigin.said).trim() ? oldOrigin : null);

  let links = arr(base.links).map((l) => ({ ...l }));
  const profile = str(m.build.profile, 40) || str(base.build?.profile, 40) || str(base.profile, 40) || 'all';
  links = addLink(links, 'build', `${profile}:${id}`, 'Orchestrator build');
  links = addLink(links, 'branch', str(m.branch, 200), '');
  if (Number(m.pr?.number) > 0) links = addLink(links, 'pr', String(m.pr.number), 'Build PR');
  links = addLink(links, 'doc', str(m.report, 300), 'Build report');

  const doneCount = mSteps.filter((s) => s.done).length;
  const status = landed && allDone ? 'done' : base.status === 'done' ? 'done' : base.status === 'dropped' ? 'dropped' : 'building';
  const build = {
    ...obj(base.build), profile, id, linkedAt: str(base.build?.linkedAt, 40) || now,
    status: landed ? 'complete' : (str(base.build?.status, 40) || 'built'), progress: mSteps.length ? Math.round((doneCount / mSteps.length) * 100) : (base.build?.progress ?? 0),
    title: str(m.build.title, 300) || str(base.build?.title, 300), branch: str(m.branch, 200) || str(base.build?.branch, 200), pr: Number(m.pr?.number) > 0 ? `#${m.pr.number}` : str(base.build?.pr, 200),
    landedCommit: str(m.landedCommit, 40), landedAt: str(m.landedAt || m.mergedAt, 40), shipped: { id: str(m.id, 120), rev: Number(m.rev) || 1, at: str(m.shippedAt, 40), source: str(m.source, 40) },
  };
  const cost = obj(m.cost); const tokens = obj(cost.tokens);
  const actual = {
    usd: Number(cost.usd) || 0, estimated: cost.estimated === true, tokens: { input: Number(tokens.input) || 0, output: Number(tokens.output) || 0, cacheRead: Number(tokens.cacheRead) || 0, cacheWrite: Number(tokens.cacheWrite) || 0 },
    minutes: mSteps.filter((s) => s.done).reduce((a, s) => a + (Number(s.actualMin) || 0), 0), estimateMinutes: mSteps.reduce((a, s) => a + (Number(s.estimateMin) || 0), 0), runs: arr(m.runs).length, models: arr(m.models), accounts: arr(m.accounts),
  };
  const next = {
    ...base, id, title: str(base.title, 200).trim() || str(m.build.title, 200) || id,
    summary: str(base.summary, 2000) || str(said.text, 600).replace(/\s+/g, ' ').trim(),
    category: str(base.category) || 'Builds', profile: str(base.profile, 40) || profile, status, steps, links, build, actual,
    tags: [...new Set([...arr(base.tags), 'shipped'])],
    features: landed && allDone ? arr(base.features).map((f) => (f.state === 'planned' ? { ...f, state: 'have', haveAt: now } : f)) : arr(base.features),
    ...(origin ? { origin } : {}),
    shipped: m,
  };
  delete next.shippedProblem;
  return { plan: next, changed: true, stale: false };
}

/**
 * The plan flagged with a refused manifest (the manifest is NOT stored; the last valid one stays). `plan` may be null:
 * the build id (when the manifest has one) gets a plan carrying only the flag, so the problem is seen in Plan Studio.
 */
export function flagManifest(plan, raw, errors, { now = nowIso(), source = '', by = '' } = {}) {
  const r = obj(raw);
  const id = planIdFor(r); if (!id) throw new Error('shipped-manifest@1 names no build: nothing to flag');
  const base = obj(plan).id ? { ...plan } : { ...newPlan({ build: { id, title: str(obj(r.build).title, 200) } }), status: 'building', summary: '' };
  const list = arr(errors).map((e) => ({ field: str(obj(e).field, 80), message: str(obj(e).message, 300) })).filter((e) => e.message);
  return {
    ...base,
    shippedProblem: { at: now, id: str(r.id, 120), rev: Number(r.rev) || 0, source: str(source || r.source, 40), by: str(by, 120), errors: list, reason: list.map((e) => `${e.field}: ${e.message}`).join('; ') },
  };
}

/** One line about a plan's shipped manifest for lists and voice, or null. */
export function shippedSummary(plan) {
  const m = obj(obj(plan).shipped); if (!m.id) return null;
  const steps = arr(m.steps); const done = steps.filter((s) => s.done);
  return {
    id: m.id, rev: Number(m.rev) || 1, build: str(m.build?.id), pr: Number(m.pr?.number) || 0, landedCommit: str(m.landedCommit, 40), landedAt: str(m.landedAt || m.mergedAt, 40), shippedAt: str(m.shippedAt, 40),
    models: arr(m.models), accounts: arr(m.accounts), files: arr(m.files).length, tests: { pass: arr(m.tests).filter((t) => t.result === 'pass').length, fail: arr(m.tests).filter((t) => t.result === 'fail').length, total: arr(m.tests).length },
    steps: { done: done.length, total: steps.length, estimateMin: steps.reduce((a, s) => a + (Number(s.estimateMin) || 0), 0), actualMin: done.reduce((a, s) => a + (Number(s.actualMin) || 0), 0) },
    costUsd: Number(obj(m.cost).usd) || 0, open: arr(m.open).length, report: str(m.report, 300), verbatim: obj(m.said).verbatim !== false,
  };
}

/**
 * Does a plan agree with the manifest it carries? Problems as strings (empty = fine): a plan with a `shipped` manifest
 * must be the build's plan, carry its build link with the same id and commit, have every manifest step, and every step
 * the manifest says is done ticked.
 */
export function checkPlanAgainstManifest(plan, manifest) {
  const p = obj(plan); const m = obj(manifest); const out = [];
  const id = planIdFor(m);
  if (!id) return ['manifest names no build'];
  if (p.id !== id) out.push(`plan id ${p.id} is not the build id ${id}`);
  if (str(p.build?.id) !== id) out.push(`plan.build.id is ${str(p.build?.id) || 'missing'}, manifest build is ${id}`);
  if (str(m.landedCommit) && str(p.build?.landedCommit) !== str(m.landedCommit)) out.push(`plan.build.landedCommit ${str(p.build?.landedCommit) || 'missing'} ≠ ${str(m.landedCommit).slice(0, 9)}`);
  const sh = obj(p.shipped);
  if (sh.id !== m.id) out.push(`plan carries ${sh.id || 'no manifest'}, expected ${m.id}`);
  else if (Number(sh.rev) < Number(m.rev)) out.push(`plan carries rev ${sh.rev}, manifest is rev ${m.rev}`);
  for (const ms of arr(m.steps)) {
    const text = str(ms.text).trim();
    const s = arr(p.steps).find((x) => str(x.text).trim() === text) ?? arr(p.steps).find((x) => x.id === ms.id);
    if (!s) { out.push(`step ${ms.id} missing on the plan`); continue; }
    if (ms.done && !s.done) out.push(`step ${ms.id} is done in the manifest, not on the plan`);
  }
  if (isLanded(m) && arr(m.steps).length && arr(m.steps).every((s) => s.done) && p.status !== 'done') out.push(`landed with every step done, plan status is ${p.status}`);
  if (!arr(p.tags).includes('shipped')) out.push('no "shipped" tag');
  return out;
}
