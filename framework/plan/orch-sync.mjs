/**
 * orch-sync — keeps the Build orchestrator (orchestrator@1) and the Pending builds list (pending@1) of one build
 * profile in step. Pure and IO-free; the IO side is framework/cli/orch-sync.mjs.
 *
 * Brett, Oct 27 2026 20:46: "All builds go to the orchestrator, which then splits everything into steps. It sorts the
 * steps into Opus and Fable and sends out the list to the pending build and the build manager. They need to all stay
 * in sync." The orchestrator is the source of truth for steps, per-step models and status; the Pending list is its
 * published copy (and the Build manager reads the Pending list). Changes made on the Pending side (console, CLI, MCP,
 * plugins, the claude.ai page) flow back into the orchestrator so nothing is lost.
 *
 * Matching: a pending item and an orchestrator build are the same build when item.id === build.pendingId || build.id.
 * Steps ↔ sub prompts: one step = one sub prompt, text prefixed "[Fable] " / "[Opus] " on the Pending side.
 * Status: orchestrator complete → complete, failed → failed, everything else open → pending; archived builds (merged
 * into another build) leave their pending item as it is. Pending complete/failed → orchestrator complete/failed;
 * broken/unsafe → blocked; a removed pending item archives its build.
 *
 * Bridge until builds-one-page (one dataset, no sync needed) lands; it then replaces this module.
 */

const OPEN_O = ['pending', 'running', 'waiting', 'blocked'];
const PREFIX = /^\[(Fable|Opus|Sonnet)\]\s*/;
const str = (v) => (typeof v === 'string' ? v : '');
const plain = (t) => str(t).replace(PREFIX, '').trim();
const stepModel = (m) => (m === 'Fable' ? 'Fable' : 'Opus');

/** Pending status for an orchestrator build (null = leave the pending item alone). */
export function pendingStatusOf(build) {
  if (build.status === 'archived') return null;
  if (build.status === 'complete') return 'complete';
  if (build.status === 'failed') return 'failed';
  return 'pending';
}
/** Orchestrator status for a pending status (null = keep the build's own, e.g. running vs pending). */
export function orchStatusOf(pendingStatus) {
  return { complete: 'complete', failed: 'failed', broken: 'blocked', unsafe: 'blocked' }[pendingStatus] ?? null;
}

export const keyOf = (b) => str(b.pendingId) || str(b.id);
const findBuild = (orch, id) => orch.builds.find((b) => keyOf(b) === id || b.id === id);

/** The pending item that publishes `build` (old = the item it replaces, kept for its own notes and dates). */
export function itemFromBuild(build, old, now) {
  const status = pendingStatusOf(build) ?? old?.status ?? 'pending';
  const next = build.steps.find((s) => !s.done) ?? build.steps[build.steps.length - 1];
  const oldAt = new Map((old?.subPrompts ?? []).map((p) => [plain(p.text), p.at]));
  const notes = [...(old?.notes ?? [])];
  for (const n of build.notes ?? []) if (n?.text && !notes.some((m) => m.text === n.text)) notes.push({ text: n.text, at: n.at || now });
  const item = {
    id: keyOf(build), title: build.title, detail: build.detail,
    model: next ? stepModel(next.model) : old?.model ?? 'Opus', status, notes,
    subPrompts: build.steps.map((s) => ({
      text: `[${stepModel(s.model)}] ${plain(s.text)}`, at: oldAt.get(plain(s.text)) || build.createdAt || now,
      ...(s.estimate ? { estimate: s.estimate } : {}), ...(s.done ? { done: true, doneAt: s.doneAt || build.updatedAt || now } : {}),
    })),
    createdAt: old?.createdAt || build.createdAt || now,
    builtAt: status === 'complete' ? build.builtAt || old?.builtAt || build.updatedAt || now : '',
    updatedAt: build.updatedAt || now, // the orchestrator's copy: only a later Pending edit flows back
    source: old?.source || build.source || 'console',
  };
  if (old?.planId) item.planId = old.planId;
  if (!build.steps.length && old?.estimate) item.estimate = old.estimate; // no steps: the item keeps its own time
  return item;
}

/** Orchestrator → Pending: every build published, newest change wins on dates. Items with no build stay. */
export function orchestratorToPending(orch, pending, now = new Date().toISOString()) {
  const items = [...(pending.items ?? [])];
  const log = [];
  for (const b of orch.builds) {
    const id = keyOf(b);
    const i = items.findIndex((x) => x.id === id || x.id === b.id);
    const old = i >= 0 ? items[i] : null;
    if (b.status === 'archived' && !old) continue; // merged elsewhere and never published: nothing to show
    if (b.status === 'archived') continue;          // keep the item's own record (e.g. built, merged into another build)
    const item = itemFromBuild(b, old, now);
    if (old && same(old, item)) continue;
    if (old) items[i] = item; else items.push(item);
    log.push(`${old ? '~' : '+'} pending ${id}`);
  }
  return { pending: { ...pending, items, updatedAt: log.length ? now : pending.updatedAt }, log };
}

/** Pending → Orchestrator. `change` = the pending action just applied (for removals), optional. */
export function pendingToOrchestrator(pending, orch, change = null, now = new Date().toISOString()) {
  const builds = orch.builds.map((b) => ({ ...b, steps: b.steps.map((s) => ({ ...s })), notes: [...(b.notes ?? [])] }));
  const out = { ...orch, builds };
  const log = [];
  if (change?.action === 'remove' && change.id) {
    const b = findBuild(out, change.id);
    if (b && b.status !== 'archived') {
      b.status = 'archived'; b.updatedAt = now;
      b.notes.push({ text: 'Removed from Pending builds; archived here (orch-sync).', at: now });
      log.push(`archived ${b.id} (removed from Pending)`);
    }
  }
  for (const it of pending.items ?? []) {
    const b = findBuild(out, it.id);
    if (!b) {
      const model = stepModel(it.model);
      const done = it.status === 'complete';
      builds.push({
        id: it.id, title: it.title, category: '', detail: it.detail, status: orchStatusOf(it.status) ?? 'pending', hidden: false,
        source: it.source || 'pending', pendingId: it.id, branch: '', pr: '',
        createdAt: it.createdAt || now, updatedAt: it.updatedAt || now, builtAt: done ? it.builtAt || now : '',
        notes: [...(it.notes ?? []), { text: 'Added to the orchestrator from Pending builds (orch-sync). Split it into steps of 30 min or less if it has none.', at: now }],
        approvals: [],
        steps: (it.subPrompts ?? []).map((p, k) => ({
          id: `s${k + 1}`, text: plain(p.text), model: stepModel(PREFIX.exec(str(p.text))?.[1] ?? model), why: '', phase: '', group: '',
          estimate: str(p.estimate), files: [], checks: [], session: 'same', agent: false,
          done: p.done === true || done, doneAt: p.done === true || done ? p.doneAt || it.builtAt || now : '', note: '',
        })),
      });
      log.push(`+ orchestrator ${it.id}`);
      continue;
    }
    if (b.status === 'archived' || str(it.updatedAt) <= str(b.updatedAt)) continue; // the orchestrator already has the newer copy
    let changed = false;
    const st = orchStatusOf(it.status);
    if (st && st !== b.status) { b.status = st; b.builtAt = st === 'complete' ? it.builtAt || now : ''; changed = true; }
    else if (it.status === 'pending' && ['complete', 'failed'].includes(b.status)) { b.status = b.steps.some((s) => s.done) ? 'running' : 'pending'; b.builtAt = ''; changed = true; }
    if (it.title && it.title !== b.title) { b.title = it.title; changed = true; }
    if (str(it.detail) !== str(b.detail)) { b.detail = it.detail; changed = true; }
    (it.subPrompts ?? []).forEach((p, k) => {
      const s = b.steps.find((x) => plain(x.text) === plain(p.text)) ?? (b.steps.length === it.subPrompts.length ? b.steps[k] : null);
      if (!s) {
        b.steps.push({ id: `s${b.steps.length + 1}`, text: plain(p.text), model: stepModel(PREFIX.exec(str(p.text))?.[1] ?? it.model), why: '', phase: '', group: '', estimate: str(p.estimate), files: [], checks: [], session: 'same', agent: false, done: p.done === true, doneAt: p.done ? p.doneAt || now : '', note: '' });
        changed = true; return;
      }
      if ((p.done === true) !== s.done) { s.done = p.done === true; s.doneAt = s.done ? p.doneAt || now : ''; changed = true; }
      if (plain(p.text) !== plain(s.text)) { s.text = plain(p.text); changed = true; }
      const pm = PREFIX.exec(str(p.text))?.[1]; if (pm && stepModel(pm) !== s.model) { s.model = stepModel(pm); changed = true; }
      if (p.estimate && p.estimate !== s.estimate) { s.estimate = p.estimate; changed = true; }
    });
    for (const n of it.notes ?? []) if (n?.text && !b.notes.some((m) => m.text === n.text)) { b.notes.push({ text: n.text, at: n.at || now }); changed = true; }
    if (changed) {
      b.updatedAt = it.updatedAt || now;
      if (OPEN_O.includes(b.status) && b.steps.length && b.steps.every((s) => s.done)) { b.status = 'complete'; b.builtAt = b.builtAt || now; }
      log.push(`~ orchestrator ${b.id}`);
    }
  }
  return { orch: log.length ? { ...out, updatedAt: now } : orch, log };
}

function same(a, b) {
  const pick = (x) => JSON.stringify([x.title, x.detail, x.model, x.status, x.subPrompts, x.notes?.map((n) => n.text), x.builtAt]);
  return pick(a) === pick(b);
}
