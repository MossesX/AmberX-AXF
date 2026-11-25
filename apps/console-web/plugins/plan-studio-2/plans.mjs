/**
 * plans@1 over the planning tree (plan-tree@1): what control@1 `planner.plans`, the orchestrator's priority rows and the
 * project seed CLI read and write. A plan is a tree item of kind `plan` (at any depth); its steps are the checkable
 * steps under it. Nothing is stored beside the tree: every call goes through tree.mjs (the same store, rules and
 * build hand-off as the page, the plugin's routes, its CLI and voice).
 *
 * plans@1 field → tree: title, body (summary + body), status, priority, tags map one to one; `category` is read-only
 * (the titles above the plan; on add it names the item the new plan goes inside); steps `{ id, text, done, model }` are the plan's steps in tree order. plans@1 statuses
 * the tree does not have are folded on write (ready → draft, building → active, dropped → parked) and `active` reads
 * back as `building`. The tree keeps no versions: a deleted plan comes back with the tree's undo (`restoreDeleted`).
 */
import * as tc from './web/tree-core.mjs';
import * as live from './web/live-core.mjs';
import { assertUnlocked, load, save, sendToBuild, storeBuilds, storeDir, onHub } from './tree.mjs';

export { storeDir, onHub };
export const FOLDER = 'plan-studio-2';

const TO_TREE = { ready: 'draft', building: 'active', dropped: 'parked' };
const FROM_TREE = { active: 'building' };
const text = (v) => (typeof v === 'string' ? v : '');
const stepsOf = (s, id) => tc.descendants(s, id).filter((i) => i.kind === 'step');
/** The steps in the order the page shows them (depth first). */
function orderedSteps(s, id, out = []) {
  for (const c of tc.children(s, id)) { if (c.kind === 'step') out.push(c); orderedSteps(s, c.id, out); }
  return out;
}

const notesOf = (s, id) => tc.children(s, id).filter((i) => i.kind === 'note');

/** The build a plan was sent as (the builds store, as Plan Studio last read it), or null: a plan with none keeps its own status and steps. */
function sentAs(it) {
  let builds = null;
  try { builds = storeBuilds(); } catch { /* the store cannot be read: the plan as it is */ }
  const sent = builds ? live.sentBuilds(builds, it.id) : [];
  return sent.length ? sent[sent.length - 1] : null;
}

function toPlan(s, it) {
  const body = it.body ?? '';
  const build = it.links.find((l) => l.type === 'build');
  const buildId = build ? build.ref.slice(build.ref.indexOf(':') + 1) : '';
  // a sent plan reads from its build: its status follows the build and its steps are the ones the build has (never copied)
  const sent = sentAs(it);
  if (sent) {
    const d = live.buildDetail(sent);
    return {
      id: it.id, title: it.title, status: d.build.landed ? 'done' : 'building', priority: it.priority, tags: it.tags,
      category: tc.ancestors(s, it.id).map((a) => a.title).join(' > '), project: '', profile: build && build.ref.includes(':') ? build.ref.slice(0, build.ref.indexOf(':')) : '',
      summary: body.split('\n').find((l) => l.trim())?.trim().slice(0, 300) ?? '', body,
      steps: (d.steps.length ? d.steps.map((x) => ({ id: x.id, uid: x.uid, text: x.title, done: x.done, model: x.model, minutes: x.minutes, status: x.status })) : orderedSteps(s, it.id).map((x) => ({ id: x.id, text: x.title, done: x.done, model: x.model, minutes: x.minutes }))),
      comments: notesOf(s, it.id).map((n) => ({ text: n.body || n.title, by: n.by, at: n.createdAt })),
      links: it.links, build: { id: d.build.id, number: d.build.number, status: d.build.status, label: live.buildSummary(d.build).label },
      focus: `${FOLDER}.focus:${it.id}`, createdAt: it.createdAt, updatedAt: it.updatedAt, by: it.by,
    };
  }
  return {
    id: it.id, title: it.title, status: FROM_TREE[it.status] ?? it.status, priority: it.priority, tags: it.tags,
    category: tc.ancestors(s, it.id).map((a) => a.title).join(' > '), project: '', profile: build && build.ref.includes(':') ? build.ref.slice(0, build.ref.indexOf(':')) : '',
    summary: body.split('\n').find((l) => l.trim())?.trim().slice(0, 300) ?? '', body,
    steps: orderedSteps(s, it.id).map((x) => ({ id: x.id, text: x.title, done: x.done, model: x.model, minutes: x.minutes })),
    comments: notesOf(s, it.id).map((n) => ({ text: n.body || n.title, by: n.by, at: n.createdAt })),
    links: it.links, ...(buildId ? { build: { id: buildId } } : {}),
    focus: `${FOLDER}.focus:${it.id}`, createdAt: it.createdAt, updatedAt: it.updatedAt, by: it.by,
  };
}

const planItem = (s, id) => { const it = tc.byId(s, text(id)); return it && it.kind === 'plan' ? it : null; };

export function loadPlans() { const s = load(); return s.items.filter((i) => i.kind === 'plan').map((i) => toPlan(s, i)); }
export function getPlan(id) { const s = load(); const it = planItem(s, id); return it ? toPlan(s, it) : null; }
/** The tree keeps no versions of an item. */
export function history(id) { return { id, versions: [] }; }

const bodyOf = (raw) => [text(raw.summary), text(raw.goal) && `Goal: ${raw.goal}`, text(raw.why) && `Why: ${raw.why}`, text(raw.body)].filter(Boolean).join('\n\n');
const patchOf = (raw, was) => {
  const p = {};
  if (typeof raw.title === 'string') p.title = raw.title;
  if (typeof raw.status === 'string') p.status = TO_TREE[raw.status] ?? raw.status;
  if (typeof raw.priority === 'string') p.priority = raw.priority;
  if (Array.isArray(raw.tags)) p.tags = raw.tags;
  if (!was) p.body = bodyOf(raw); else if (typeof raw.body === 'string') p.body = raw.body;
  return p;
};

/** Where a new plan goes: inside the item `category` names (its last `A > B` part, by id or words), else the top level. */
const parentFor = (s, category) => { const last = text(category).split('>').pop().trim(); return last ? tc.resolve(s, last)?.id ?? null : null; };

/** Everything a plan holds except its own status and change stamp (what the lock on a sent plan protects). */
const shape = (s, id) => JSON.stringify([tc.byId(s, id), ...tc.descendants(s, id)].map((i) => (i.id === id ? { ...i, status: '', updatedAt: '', by: '' } : i)));

/**
 * Add a plan (no id, or an id the tree does not have) or change one. Steps: one with a known id is updated (text, done,
 * model), one without is added at the end of the plan; a step missing from `raw.steps` stays. Comments are the notes
 * directly inside the plan: one more in `raw.comments` adds a note. → { ok, plan, created, unchanged }.
 */
export function savePlan(raw = {}, meta = {}) {
  const by = text(meta.by);
  let s = load();
  const was = planItem(s, raw.id);
  if (!was && !text(raw.title).trim()) throw new Error('a plan needs a title');
  const before = s;
  let id = was?.id; let changed = !was;
  if (was) { const r = tc.edit(s, was.id, patchOf(raw, was), by); s = r.state; changed = r.changed; } else { const r = tc.add(s, { kind: 'plan', parent: parentFor(s, raw.category), by, ...patchOf(raw, null) }); s = r.state; id = r.item.id; }
  if (Array.isArray(raw.steps)) {
    const known = new Map(stepsOf(s, id).map((x) => [x.id, x]));
    for (const st of raw.steps) {
      const title = text(st?.text) || text(st?.title);
      const patch = { ...(title ? { title } : {}), ...(typeof st?.done === 'boolean' ? { done: st.done } : {}), ...(typeof st?.model === 'string' ? { model: st.model } : {}) };
      if (st?.id && known.has(st.id)) { const r = tc.edit(s, st.id, patch, by); s = r.state; changed ||= r.changed; } else if (title) { s = tc.add(s, { kind: 'step', parent: id, by, ...patch }).state; changed = true; }
    }
  }
  const comments = Array.isArray(raw.comments) ? raw.comments.slice(was ? notesOf(s, id).length : 0) : []; // the notes it has are its comments so far
  for (const c of comments) if (text(c?.text).trim()) { s = tc.add(s, { kind: 'note', parent: id, title: c.text.trim().slice(0, 300), body: c.text, by: text(c.by) || by }).state; changed = true; }
  // a sent plan is locked until its build lands or is cancelled: only its own status may still be set
  if (was && changed && shape(before, was.id) !== shape(s, was.id)) assertUnlocked(before, was.id);
  if (changed) s = save(s);
  return { ok: true, plan: toPlan(s, tc.byId(s, id)), created: !was, unchanged: !changed };
}

/** To the tree's trash (everything under the plan goes along); `restoreDeleted` brings it back. */
export function deletePlan(id) {
  const s = load();
  if (!planItem(s, id)) throw new Error(`no plan ${id}`);
  assertUnlocked(s, id);
  const r = tc.remove(s, id);
  save(r.state);
  return { ok: true, removed: r.removed, trashId: r.trashId };
}
export function restoreDeleted(trashId = '') { const r = tc.undo(load(), trashId); const s = save(r.state); return { ok: true, plan: r.item?.kind === 'plan' ? toPlan(s, tc.byId(s, r.item.id)) : null }; }
/** plans@1 `restore` named a saved version; the tree has none. */
export function restore() { throw new Error('Plan Studio 2.0 keeps no versions of a plan: a deleted plan comes back with undo (plan-studio-2 undo)'); }

/** One Pipeline 2.0 build in Pending, never Queued, from the plan (tree.mjs sendToBuild: plan-build@1 checked, the plan linked to it). */
export function turnIntoBuild(id, { profile = '', buildId = '', preview = false, by = '', said = '' } = {}) {
  const s = load();
  if (!planItem(s, id)) throw new Error(`no plan ${id}`);
  const r = sendToBuild(s, id, { profile, id: buildId, preview, by, said });
  if (r.preview) return r;
  const st = save(r.state);
  return { ok: true, plan: toPlan(st, tc.byId(st, id)), build: r.build, status: r.status, queued: false };
}

export function exportPlans(ids, format = 'json') {
  const s = load();
  const list = (Array.isArray(ids) && ids.length ? ids : s.items.filter((i) => i.kind === 'plan' && !i.parent).map((i) => i.id)).filter((id) => planItem(s, id));
  return format === 'md' ? list.map((id) => tc.toMarkdown(s, id)).join('\n\n') : JSON.stringify(list.map((id) => tc.toJson(s, id)), null, 1);
}
