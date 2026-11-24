/**
 * Plan Studio 2.0, sent plans (plan-live@1): what a plan looks like once it has been sent to the orchestrator. Pure
 * functions; the server (tree.mjs) runs them, the page only draws what they return.
 *
 * One source of truth: a sent plan's steps and their statuses live in the builds store. Nothing is copied into the
 * tree. Each read lays the store over the tree (liveView):
 *
 *   - the item a build was sent from (the build's `planRef`) carries `live` (the build's status as a Plan Studio state)
 *     and, while the build has not landed, `locked`: it and everything under it may not be edited, moved, added to or
 *     deleted (steps build and land in order and lean on each other);
 *   - once the orchestrator has split the build, its steps are listed under the item exactly as it filed them, as rows
 *     with `origin: 'orchestrator'` (never stored in the tree), each with its own `live` state. They check off in place
 *     as the orchestrator moves them.
 *
 * Replace on split (syncSent): when the build has its steps, the planning steps that were sent leave the tree and are
 * kept in the plan's history (recoverable, not shown in the list). A build that is archived or deleted before it
 * lands gives them back by itself.
 *
 * The history is its own document beside the tree (plan-history@1: { items: { <item id>: Entry[] } }, Entry =
 * { id, at, by, build, kind: 'sent-steps', title, items: Item[], restoredAt? }), never a field on the tree's items: a
 * writer that only knows plan-tree@1 rewrites the tree and cannot drop it.
 *
 * Builds are read as the builds store has them (pipeline-2@1 statuses). Only Pipeline 2.0 builds carry a `planRef`.
 *
 * The build of a sent plan (buildDetail, buildSummary): the build's number, its pipeline view (pipeline-status@1
 * `pipelineView`, worked out by the builds store on read), who split it, the merge line, a clash with builds that are
 * not on main yet, and its steps with each step's unique id, split mark, triage model and status. All of it is read
 * from the store's record; a field the record does not carry yet reads as empty and the raw status is shown instead.
 * A sent plan's listed status follows its build (planStatus): it is never the status the plan had before it was sent.
 */
import * as tc from './tree-core.mjs';

export const SCHEMA = 'plan-live@1';
export const ORIGIN = 'orchestrator';
export const ORIGIN_LABEL = 'From orchestrator';
export const FLOW = 'pipeline-2';
export const HISTORY_SCHEMA = 'plan-history@1';
export const HISTORY_MAX = 20;

/** The states a sent plan or step is shown in, in the order a build passes through them. */
export const STATES = Object.freeze(['sent', 'building', 'merging', 'recompiling', 'ci', 'waiting', 'landed', 'failed']);
export const STATE_LABEL = Object.freeze({
  sent: 'Sent to orchestrator', building: 'Building', merging: 'Merging', recompiling: 'Recompiling', ci: 'Running CI',
  waiting: 'Waiting for merge', landed: 'Landed', failed: 'Failed',
});
/** Build status (pipeline-2@1) → state. */
const BUILD_STATE = Object.freeze({
  pending: 'sent', splitting: 'sent', split: 'sent',
  'pulling-main': 'building', 'assigning-models': 'building', ready: 'building', sending: 'building', building: 'building',
  'build-complete': 'waiting', 'merging-pr': 'merging', 'pr-pulling-main': 'recompiling', 'running-ci': 'ci', 'merging-main': 'merging',
  landed: 'landed',
});
/** The states a finished step takes from its build while the build lands. */
const LANDING_STATES = Object.freeze(['merging', 'recompiling', 'ci', 'landed']);
const BUILD_LABEL = Object.freeze({
  pending: 'Pending', splitting: 'Splitting', split: 'Pending', 'pulling-main': 'Pulling in main', 'assigning-models': 'Assigning models',
  ready: 'Ready for build', sending: 'Sending to slot', building: 'Building', 'build-complete': 'Build complete', 'merging-pr': 'Merging to one PR',
  'pr-pulling-main': 'Pulling in main (PR)', 'running-ci': 'Running CI', 'merging-main': 'Merging into main', landed: 'Landed',
});
const STEP_LABEL = Object.freeze({ pending: 'Pending', 'pulling-main': 'Pulling in main', ready: 'Ready', sending: 'Sending to slot', building: 'Building', completed: 'Completed', 'in-pr': 'In PR' });
/** What the orchestrator may be asked to do with a sent plan or one of its steps (the server decides each one). */
export const ACTIONS = Object.freeze(['queue', 'hold', 'release', 'retry', 'rebuild', 'run-ci', 'land', 'cancel']);
/** The answers to a clash (a build rejected because it touches what is not on main yet): the orchestrator decides each. */
export const CLASH_ACTIONS = Object.freeze(['run-all', 'defer']);
export const ACTION_LABEL = Object.freeze({ queue: 'Queue', hold: 'Hold', release: 'Release', retry: 'Retry', rebuild: 'Rebuild', 'run-ci': 'Run CI', land: 'Land', cancel: 'Cancel' });

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const attemptOf = (r) => Math.max(1, Number(r?.attempt) || 1);
const failedLabel = (r) => `Failed, attempt ${attemptOf(r)}`;

/* ------------------------------------------------------------------ the builds a plan item was sent as */

const isSent = (b) => !!b && b.flow === FLOW && !!str(b.planRef) && !b.deleted && b.status !== 'archived';
/** Has the build finished (landed)? A landed build no longer locks its plan. */
export const isLanded = (b) => b?.status === 'landed';
/** Every build sent from this item that is still in the flow or has landed, oldest first. */
export function sentBuilds(builds, itemId) {
  return list(builds).filter((b) => isSent(b) && b.planRef === itemId).sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)));
}
/** The build that locks the item: sent from it and not landed yet, or null. */
export const liveBuild = (builds, itemId) => sentBuilds(builds, itemId).filter((b) => !isLanded(b)).pop() ?? null;
/** Has the orchestrator filed the build's steps (split or later)? */
export const hasSteps = (b) => list(b?.steps).length > 0;

/* ------------------------------------------------------------------ status → state */

/** The state of a sent plan: where its build is. */
export function buildState(b) {
  if (b?.status === 'failed') return 'failed';
  return BUILD_STATE[b?.status] ?? 'sent';
}
/** The state of one orchestrator step: its own status, and once it is built, where its build is on the way to main. */
export function stepState(b, s) {
  if (isLanded(b)) return 'landed';
  if (s?.status === 'failed') return 'failed';
  if (s?.status === 'sending' || s?.status === 'building') return 'building';
  if (s?.status === 'completed' || s?.status === 'in-pr' || s?.done) {
    const phase = BUILD_STATE[b?.status === 'failed' ? b?.failedFrom : b?.status];
    return LANDING_STATES.includes(phase) ? phase : 'waiting';
  }
  return 'sent';
}
const buildLabel = (b) => (b.status === 'failed' ? failedLabel(b) : BUILD_LABEL[b.status] ?? str(b.status, 40));
const stepLabel = (s) => (s.status === 'failed' ? failedLabel(s) : STEP_LABEL[s.status] ?? (s.done ? 'Completed' : 'Pending'));
const profileOf = (b) => str(list(b.profiles)[0], 80);
const isHeld = (b) => !!str(b?.pipeline?.heldAt);

/** The plan row's `live`: the build as Plan Studio shows it. */
export function buildLive(b) {
  const steps = list(b.steps).filter((s) => !s.skip);
  const state = buildState(b);
  return {
    $axf: SCHEMA, build: b.id, ...(numberOf(b) ? { number: numberOf(b) } : {}), profile: profileOf(b), status: str(b.status, 40), label: buildLabel(b), state, stateLabel: STATE_LABEL[state],
    attempt: attemptOf(b), at: str(b.statusAt || b.updatedAt, 40), locked: !isLanded(b), split: hasSteps(b), held: isHeld(b),
    ...(b.emergency ? { emergency: true } : {}), steps: { done: steps.filter((s) => s.done || isLanded(b)).length, total: steps.length },
  };
}
const firstLine = (t) => str(t, 4000).split('\n').map((l) => l.replace(/^[-*]\s+/, '').trim()).find(Boolean) ?? '';
const minutesOf = (s) => (Number(s?.minutes) > 0 ? Math.round(Number(s.minutes)) : parseInt(str(s?.estimate), 10) || 0);
/** The tree id of an orchestrator step row (never stored). */
export const stepRowId = (buildId, stepId) => `orch--${buildId}--${stepId}`.slice(0, 80);
/** An orchestrator step row id → { build, step }, or null for any other id. */
export function parseStepRowId(id) {
  const m = /^orch--(.+)--([a-z0-9._]+)$/.exec(str(id, 80));
  return m ? { build: m[1], step: m[2] } : null;
}

/** One orchestrator step as a tree row under the item it was sent from: `origin` marks it, `live` is its state. */
export function stepRow(b, s, parent, order) {
  const state = stepState(b, s);
  const text = str(s.text, 100_000);
  const title = str(s.title, 300).trim() || firstLine(text) || `Step ${s.id}`;
  return {
    ...tc.normItem({
      id: stepRowId(b.id, s.id), parent, order, kind: 'step', title, body: text === title ? '' : text, done: !!s.done || isLanded(b),
      model: tc.MODELS.includes(s.model) ? s.model : '', minutes: minutesOf(s), createdAt: str(list(s.statusLog)[0]?.at || b.createdAt, 40),
      updatedAt: str(s.statusAt || b.statusAt || b.updatedAt, 40), by: ORIGIN,
    }),
    origin: ORIGIN, locked: true,
    live: {
      $axf: SCHEMA, build: b.id, profile: profileOf(b), step: s.id, status: str(s.status, 40), label: stepLabel(s), state, stateLabel: STATE_LABEL[state],
      attempt: attemptOf(s), at: str(s.statusAt, 40), ...(Number(s.prNumber) > 0 ? { pr: Number(s.prNumber) } : {}), ...(s.skip ? { skipped: true } : {}),
    },
  };
}

/* ------------------------------------------------------------------ the build of a sent plan, as the store has it */

/** The plan-tree status a sent plan is listed with: its build is under way (`active`) or has landed (`done`). */
export const planStatus = (b) => (isLanded(b) ? 'done' : 'active');
/** A build's short unique number (builds store `number`), as text; '' while the record has none. */
export const numberOf = (b) => (b?.number == null || b.number === '' ? '' : str(b.number, 20).replace(/^#/, ''));
/** "#41", else the build id. */
export const buildName = (b) => (numberOf(b) ? `#${numberOf(b)}` : str(b?.id ?? b?.buildId, 80));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
/** A reference to another build, however it was written (a number, an id, or { number, buildId | id, title }). */
export function buildRef(v) {
  if (v == null || v === '') return null;
  const o = obj(v);
  if (!o) return typeof v === 'number' || /^#?\d+$/.test(String(v)) ? { buildId: '', number: String(v).replace(/^#/, ''), title: '' } : { buildId: str(v, 80), number: '', title: '' };
  const r = { buildId: str(o.buildId ?? o.id ?? o.build, 80), number: numberOf(o), title: str(o.title, 300) };
  return r.buildId || r.number || r.title ? r : null;
}
/** How a referenced build is named in a sentence: "build #41", else its title, else its id. */
export const refName = (r) => (!r ? '' : r.number ? `build #${r.number}` : r.title ? `"${r.title}"` : `build ${r.buildId}`);
/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n) {
  const i = Math.max(0, Math.round(Number(n) || 0));
  const t = i % 100;
  return `${i}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][i % 10] ?? 'th'}`;
}
/** Who split the build into steps (the store's `split`: { by, model, at, stepCount }), or null before the split. */
export function splitOf(b) {
  const sp = obj(b?.split) ?? obj(b?.pipelineView?.split);
  if (!sp || !str(sp.by, 40)) return null;
  return { by: str(sp.by, 40), model: str(sp.model, 80), at: str(sp.at, 40), stepCount: Number(sp.stepCount) > 0 ? Math.round(Number(sp.stepCount)) : list(b?.steps).length };
}
const isFable = (model) => /fable/i.test(str(model, 80));
/** The words of a split mark: "Split by Fable on the VPS" (the model that really ran, the place it ran). */
export function splitLabel(by, model = '') {
  const who = str(by, 40).toLowerCase();
  if (!who) return '';
  const m = isFable(model) || /fable/.test(who) ? 'Fable' : /opus/i.test(`${model} ${who}`) ? 'Opus' : '';
  const where = who.startsWith('vps') ? 'on the VPS' : who.startsWith('orchestrator') ? 'by the orchestrator' : '';
  return ['Split', m && `by ${m}`, where || (!m && `by ${str(by, 40)}`)].filter(Boolean).join(' ');
}
/** The merge line: "2nd to merge, waiting for build #41" ({ position, waitingFor }); '' when the build is not in line. */
export function mergeLineText(ml) {
  const o = obj(ml);
  if (!o) return '';
  if (str(o.text ?? o.line, 300)) return str(o.text ?? o.line, 300);
  const pos = Math.round(Number(o.position) || 0);
  const wait = buildRef(o.waitingFor);
  return [pos > 0 && `${ordinal(pos)} to merge`, wait && `waiting for ${refName(wait)}`].filter(Boolean).join(', ');
}
/** The waiting reason: the store's own words, else "Waiting: <title> holds the active place". */
export function waitingText(w) {
  const o = obj(w);
  if (!o) return '';
  const ref = buildRef(o);
  return str(o.reason, 300) || (ref ? `Waiting: ${ref.title || refName(ref)} holds the active place` : '');
}
const PV_TONES = ['accent', 'success', 'warning', 'danger', 'info', 'muted'];
/**
 * A clash with builds that are not on main yet (the store's `clash`), or null. The build was rejected as a whole; the
 * options are what may be done instead: run everything, or run the clean steps and defer the clashing ones, each
 * deferred step naming the build it waits for. → { rejected, reason, with: Ref[], options: [{ id, label, line,
 * action, steps: [{ step, uid, title, waitsFor: Ref | null }] }] }
 */
export function clashOf(b) {
  const c = obj(b?.clash) ?? obj(b?.pipelineView?.clash) ?? obj(b?.rejected) ?? obj(b?.rejection);
  if (!c) return null;
  const waitOf = (d) => buildRef(d?.waitsFor ?? d?.waitingFor ?? d?.waitingOn);
  const stepOf = (d) => (obj(d) ? { step: str(d.step ?? d.id, 40), uid: str(d.uid, 40), title: str(d.title ?? d.text, 300), waitsFor: waitOf(d) } : { step: str(d, 40), uid: '', title: '', waitsFor: null });
  const deferred = list(c.deferred ?? c.steps).map(stepOf).filter((d) => d.step || d.uid);
  let options = list(c.options).map((o) => obj(o)).filter(Boolean).map((o) => {
    const id = str(o.id ?? o.kind, 40);
    const steps = list(o.steps ?? o.deferred).map(stepOf).filter((d) => d.step || d.uid);
    return { id, label: str(o.label ?? o.title, 120) || (id === 'run-all' ? 'Run all now' : steps.length ? `Run the clean steps now, defer ${steps.length} step${steps.length === 1 ? '' : 's'}` : id), line: str(o.line ?? o.why ?? o.reason, 300), action: str(o.action, 40) || (CLASH_ACTIONS.includes(id) ? id : ''), steps };
  }).filter((o) => o.id || o.label);
  if (!options.length && deferred.length) options = [{ id: 'defer', label: `Run the clean steps now, defer ${deferred.length} step${deferred.length === 1 ? '' : 's'}`, line: '', action: 'defer', steps: deferred }];
  if (!options.length && c.runAll === true) options = [{ id: 'run-all', label: 'Run all now', line: '', action: 'run-all', steps: [] }];
  return { rejected: c.rejected !== false, reason: str(c.reason ?? c.why ?? c.line, 600), with: list(c.with ?? c.builds ?? c.clashesWith).map(buildRef).filter(Boolean), options };
}
/** The line under a deferred step: "Deferred, waiting for build #41". */
export const deferLine = (waitsFor) => (waitsFor ? `Deferred, waiting for ${refName(waitsFor)}` : '');

/** One step of the build as the page lists it: the unique id in its own field, who split it, the model and who picked it, its status. */
export function stepDetail(b, s) {
  const state = stepState(b, s);
  const text = str(s.text, 100_000);
  const sp = splitOf(b);
  const waitsFor = buildRef(s.waitsFor ?? s.waitingFor ?? obj(s.deferred)?.waitsFor);
  return {
    id: str(s.id, 40), uid: str(s.uid, 40), row: stepRowId(b.id, s.id), title: str(s.title, 300).trim() || firstLine(text) || `Step ${s.id}`, text,
    model: str(s.model, 40), modelBy: str(s.modelBy, 40), splitBy: str(s.splitBy, 40) || (sp ? `${sp.by}${isFable(sp.model) ? '-fable' : ''}` : ''),
    status: str(s.status, 40) || (s.done ? 'completed' : 'pending'), label: waitsFor && !s.done ? deferLine(waitsFor) : stepLabel(s), state, stateLabel: STATE_LABEL[state],
    attempt: attemptOf(s), done: !!s.done || isLanded(b), minutes: minutesOf(s), ...(Number(s.prNumber) > 0 ? { pr: Number(s.prNumber) } : {}), ...(s.skip ? { skipped: true } : {}), ...(waitsFor ? { waitsFor } : {}),
  };
}
/**
 * The build a plan was sent as, as the page shows it under the plan: { build, steps }. `pipelineView` is the store's
 * own (null while the store does not work one out: the raw status is shown then); nothing here is kept anywhere.
 */
export function buildDetail(b) {
  const state = buildState(b);
  return {
    build: {
      id: b.id, number: numberOf(b), title: str(b.title, 300), status: str(b.status, 40), label: buildLabel(b), state, stateLabel: STATE_LABEL[state], attempt: attemptOf(b),
      at: str(b.statusAt || b.updatedAt, 40), pipelineView: obj(b.pipelineView), split: splitOf(b), clash: clashOf(b), pr: Number(b.pr) > 0 ? Number(b.pr) : 0, prUrl: str(b.prUrl, 300), branch: str(b.branch, 200),
      held: isHeld(b), landed: isLanded(b), ...(b.emergency ? { emergency: true } : {}),
    },
    steps: list(b.steps).map((s) => stepDetail(b, s)),
  };
}
/**
 * What the page writes under a sent plan, in words (display only): the build's name, its state badge (the pipeline
 * view's label and tone; the raw status as a plain badge without one), the plain status line, the waiting reason, the
 * split mark and the merge line. `build` is buildDetail().build.
 */
export function buildSummary(build) {
  const pv = obj(build?.pipelineView);
  const sp = obj(build?.split);
  const attempt = Math.max(1, Number(pv?.attempt ?? build?.attempt) || 1);
  return {
    name: buildName(build), state: str(pv?.state, 40) || str(build?.status, 40), label: str(pv?.label, 80) || str(build?.label, 80) || str(build?.status, 40) || 'Unknown',
    tone: pv && PV_TONES.includes(pv.tone) ? pv.tone : '', icon: str(pv?.icon, 40), raw: !pv, line: str(pv?.line, 400), attempt,
    waiting: waitingText(pv?.waitingOn), waitingOn: buildRef(pv?.waitingOn), merge: mergeLineText(pv?.mergeLine),
    split: sp ? splitLabel(sp.by, sp.model) : '', splitByVps: !!sp && str(sp.by, 40).toLowerCase().startsWith('vps'),
  };
}
/** How a step's model is written: "Fable", with who picked it when the triage gate did; "model not assigned yet" before. */
export const modelText = (step) => (str(step?.model, 40) ? str(step.model, 40) : 'Model not assigned yet');
/** Did the triage gate give the step its model? */
export const byTriage = (step) => !!str(step?.model, 40) && str(step?.modelBy, 40).toLowerCase() === 'triage';

/* ------------------------------------------------------------------ the tree as shown: the store laid over it */

/** The planning steps a send takes along (tree-core toBuild picks the same ones): open steps, else open list items. */
export function sentStepItems(state, itemId) {
  const under = tc.descendants(state, itemId);
  let steps = under.filter((i) => i.kind === 'step' && !i.done);
  if (!steps.length) steps = under.filter((i) => tc.CHECKABLE.has(i.kind) && !i.done);
  return steps;
}

/**
 * The tree with the builds store laid over it (nothing is saved). Sent items carry `live` and `locked`; everything
 * under a locked item is `locked`; planning steps still waiting for the split show as sent; the orchestrator's steps
 * are added as rows under the item, after its own children. → a state (tree-core shape, extra view fields on items).
 */
export function liveView(state, builds) {
  const refs = new Set(list(builds).filter(isSent).map((b) => b.planRef));
  if (!refs.size) return state;
  const items = state.items.map((i) => ({ ...i }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const view = { ...state, items };
  const rows = [];
  for (const it of items.filter((i) => refs.has(i.id))) {
    const sent = sentBuilds(builds, it.id);
    const cur = sent[sent.length - 1];
    const live = buildLive(cur);
    it.live = live;
    it.status = planStatus(cur); // where its build is, not what the plan was before it was sent (view only)
    if (live.locked) {
      it.locked = true;
      for (const d of tc.descendants(state, it.id)) byId.get(d.id).locked = true;
      // before the split the plan's own steps are what was sent: they wait with the build
      if (!live.split) for (const d of sentStepItems(state, it.id)) byId.get(d.id).live = { $axf: SCHEMA, build: cur.id, profile: live.profile, step: '', status: live.status, label: live.label, state: live.state, stateLabel: live.stateLabel, attempt: live.attempt, at: live.at };
    }
    let order = tc.children(state, it.id).length;
    for (const b of sent) for (const s of list(b.steps)) rows.push(stepRow(b, s, it.id, order++));
  }
  view.items = [...items, ...rows];
  return view;
}

/** Is this item locked by a sent build (itself or an item above it)? → the item the lock sits on and its build, or null. */
export function lockOf(state, builds, itemId) {
  const it = tc.byId(state, itemId);
  if (!it) return null;
  for (const x of [it, ...tc.ancestors(state, itemId).reverse()]) {
    const b = liveBuild(builds, x.id);
    if (b) return { item: x, build: b };
  }
  return null;
}
/** The words a refused change answers with. */
export const lockedWhy = (lock) => `"${lock.item.title}" was sent to the orchestrator as ${lock.build.id} (${buildLabel(lock.build)}): it is locked until the build lands or is cancelled. Nothing in it is edited, moved, added or deleted.`;

/* ------------------------------------------------------------------ replace on split, and the way back */

const entryId = (taken) => { let id; do id = `h-${tc.rid(6)}`; while (taken.has(id)); return id; };
export const emptyHistory = () => ({ $axf: HISTORY_SCHEMA, items: {} });
/** The history document in its one shape: per item id, its entries (bounded), nothing else. */
export function normHistory(doc) {
  const src = doc && typeof doc === 'object' && doc.items && typeof doc.items === 'object' ? doc.items : {};
  const items = {};
  for (const [id, entries] of Object.entries(src)) {
    const l = list(entries).filter((e) => e && typeof e === 'object' && str(e.id, 40) && Array.isArray(e.items)).slice(-HISTORY_MAX).map((e) => ({
      id: str(e.id, 40), at: str(e.at, 40), by: str(e.by, 80), build: str(e.build, 80), kind: str(e.kind, 40) || 'sent-steps', title: str(e.title, 300),
      items: e.items.slice(0, 500), ...(str(e.restoredAt, 40) ? { restoredAt: str(e.restoredAt, 40) } : {}),
    }));
    if (l.length) items[id] = l;
  }
  return { $axf: HISTORY_SCHEMA, items };
}
const histOf = (history, id) => list(history?.items?.[id]);
const withHist = (history, id, entries) => { const items = { ...(history?.items ?? {}) }; if (entries.length) items[id] = entries.slice(-HISTORY_MAX); else delete items[id]; return { $axf: HISTORY_SCHEMA, items }; };

/**
 * Bring the tree in line with the builds store (the one write a sent plan gets):
 *   - a sent build that has its steps: the planning steps that were sent leave the tree and are kept in the history,
 *     once per build (the orchestrator's steps are listed in their place from the store);
 *   - a build that left the flow before it landed (archived, deleted): its history entry gives the planning steps back.
 * Idempotent. → { state, history, changed, replaced: [{ item, build, steps }], restored: [{ item, build, steps }] }
 */
export function syncSent(state, builds, history = emptyHistory(), { at = new Date().toISOString(), by = ORIGIN } = {}) {
  let s = state; let h = normHistory(history); const replaced = []; const restored = [];
  const known = new Map(list(builds).map((b) => [b.id, b]));
  // the way back first: an entry whose build never landed and is no longer in the flow
  for (const [itemId, entries] of Object.entries(h.items)) {
    if (!tc.byId(s, itemId)) continue;
    for (const e of entries) {
      if (e.restoredAt) continue;
      const b = known.get(e.build);
      if (!b || isSent(b)) continue; // a build is never dropped from the store: one that cannot be read changes nothing
      const r = restoreEntry(s, h, itemId, e.id, { at, drop: true });
      s = r.state; h = r.history; restored.push({ item: itemId, build: e.build, steps: r.restored });
    }
  }
  for (const ref of new Set(list(builds).filter(isSent).map((b) => b.planRef))) {
    for (const b of sentBuilds(builds, ref).filter(hasSteps)) {
      const it = tc.byId(s, ref);
      if (!it || histOf(h, it.id).some((e) => e.build === b.id)) continue;
      const gone = sentStepItems(s, it.id);
      const ids = new Set(gone.flatMap((g) => [g.id, ...tc.descendants(s, g.id).map((d) => d.id)]));
      const kept = s.items.filter((i) => ids.has(i.id)).map((i) => ({ ...i }));
      const taken = new Set(histOf(h, it.id).map((e) => e.id));
      h = withHist(h, it.id, [...histOf(h, it.id), { id: entryId(taken), at, by: str(by, 80), build: b.id, kind: 'sent-steps', title: `Planning steps sent as ${b.id}`, items: kept }]);
      if (kept.length) s = tc.normalize({ ...s, items: s.items.filter((i) => !ids.has(i.id)).map((i) => (i.id === it.id ? { ...i, updatedAt: at } : { ...i })), rev: (s.rev || 0) + 1 });
      replaced.push({ item: it.id, build: b.id, steps: kept.length });
    }
  }
  return { state: s, history: h, changed: replaced.length + restored.length > 0, replaced, restored };
}

/**
 * Put a history entry's planning steps back where they were (ids already in the tree are left alone). `drop` removes
 * the entry (the build never landed); otherwise it stays, marked restored. → { state, history, restored, entry }
 */
export function restoreEntry(state, history, itemId, entry = '', { at = new Date().toISOString(), drop = false } = {}) {
  const it = tc.byId(state, itemId);
  if (!it) throw new tc.TreeError('not_found', `no item "${itemId}"`);
  const hist = histOf(history, it.id);
  const e = entry ? hist.find((x) => x.id === entry) : [...hist].reverse().find((x) => !x.restoredAt);
  if (!e) throw new tc.TreeError('not_found', entry ? `no history entry ${entry} on "${it.title}"` : `"${it.title}" has no planning steps to bring back`);
  if (e.restoredAt) throw new tc.TreeError('validation', `the planning steps sent as ${e.build} were already brought back`);
  const taken = new Set(state.items.map((i) => i.id));
  const back = list(e.items).filter((i) => !taken.has(i.id)).map((i) => tc.normItem(i));
  const next = back.length ? tc.normalize({ ...state, items: [...state.items.map((i) => (i.id === it.id ? { ...i, updatedAt: at } : { ...i })), ...back], rev: (state.rev || 0) + 1 }) : state;
  return { state: next, history: withHist(history, it.id, drop ? hist.filter((x) => x.id !== e.id) : hist.map((x) => (x.id === e.id ? { ...x, restoredAt: at } : x))), restored: back.length, entry: e.id };
}

/** An item's history as a list for reading: [{ id, at, by, build, title, steps: [titles], restoredAt }]. */
export function historyOf(history, state, itemId) {
  const it = tc.byId(state, itemId);
  if (!it) throw new tc.TreeError('not_found', `no item "${itemId}"`);
  return histOf(history, it.id).map((e) => ({ id: e.id, at: e.at, by: e.by, build: e.build, title: e.title, restoredAt: e.restoredAt || '', steps: list(e.items).map((i) => ({ id: i.id, kind: i.kind, title: i.title, done: !!i.done })) }));
}

/* ------------------------------------------------------------------ what a tap on a sent row means */

/**
 * The build (and step) an orchestrator action on a row is about: an orchestrator step row names its build and step;
 * any other row is its own sent build, or the build of the sent item above it. → { build, step, item } or null.
 */
export function actionTarget(state, builds, ref) {
  const row = parseStepRowId(ref);
  if (row) {
    const b = list(builds).find((x) => x.id === row.build && isSent(x));
    return b && list(b.steps).some((s) => s.id === row.step) ? { build: b, step: row.step, item: tc.byId(state, b.planRef) } : null;
  }
  const it = tc.resolve(state, ref);
  if (!it) return null;
  for (const x of [it, ...tc.ancestors(state, it.id).reverse()]) {
    const sent = sentBuilds(builds, x.id);
    if (sent.length) return { build: sent[sent.length - 1], step: '', item: x };
  }
  return null;
}

/* ------------------------------------------------------------------ how each state looks (settings; display only) */

/** The picks a state's look is made of. Every value maps to a class drawn from theme tokens (plan-studio-2.css). */
export const LOOK_MARKS = Object.freeze(['box', 'check', 'none']);
export const LOOK_TONES = Object.freeze(['', 'accent', 'success', 'warning', 'danger', 'info', 'muted']);
export const LOOK_FONTS = Object.freeze(['', 'mono', 'display']);
export const LOOK_WEIGHTS = Object.freeze(['', 'medium', 'strong']);
export const LOOK_STYLES = Object.freeze(['', 'italic']);
const look = (o = {}) => ({ mark: 'box', badge: true, strike: false, tone: '', fill: '', font: '', weight: '', style: '', ...o });
export const DEFAULT_LOOKS = Object.freeze({
  sent: look({ tone: 'muted' }), building: look({ tone: 'accent', weight: 'medium' }), merging: look({ tone: 'info' }), recompiling: look({ tone: 'info' }),
  ci: look({ tone: 'warning' }), waiting: look({ tone: 'muted', style: 'italic' }), landed: look({ mark: 'check', strike: true, tone: 'success' }),
  failed: look({ tone: 'danger', weight: 'strong' }),
});
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
/** One look, every pick checked against its list (anything else falls back to the default of that state). */
export function normLook(v, state = 'sent') {
  const d = DEFAULT_LOOKS[state] ?? look(); const o = v && typeof v === 'object' ? v : {};
  return {
    mark: pick(o.mark, LOOK_MARKS, d.mark), badge: typeof o.badge === 'boolean' ? o.badge : d.badge, strike: typeof o.strike === 'boolean' ? o.strike : d.strike,
    tone: pick(o.tone, LOOK_TONES, d.tone), fill: pick(o.fill, LOOK_TONES, d.fill), font: pick(o.font, LOOK_FONTS, d.font),
    weight: pick(o.weight, LOOK_WEIGHTS, d.weight), style: pick(o.style, LOOK_STYLES, d.style),
  };
}
/** The saved looks (a JSON string or an object, per state) over the defaults: every state has one. */
export function normLooks(saved) {
  let o = saved;
  if (typeof saved === 'string') { try { o = JSON.parse(saved); } catch { o = null; } }
  return Object.fromEntries(STATES.map((s) => [s, normLook(o && typeof o === 'object' ? o[s] : null, s)]));
}
/** The classes a row takes for its look. */
export function lookClasses(l) {
  return [l.strike && 'is-strike', l.tone && `is-tone-${l.tone}`, l.fill && `is-fill-${l.fill}`, l.font && `is-font-${l.font}`, l.weight && `is-weight-${l.weight}`, l.style && `is-style-${l.style}`].filter(Boolean).join(' ');
}
