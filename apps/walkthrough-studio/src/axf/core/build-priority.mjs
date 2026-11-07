/*
 * Build priority (Brett, Nov 5 2026: "Put a priority tag on everything in your building. And when you click on it, it
 * shows everything waiting for it."). Pure: the four levels, what a build's priority is when nobody set one, how a level
 * maps onto agent-slots@1 levels, and what is waiting on a build. No new contract: the levels are plan@1's P0-P3, a build
 * record just gains an optional `priority`, and an agent-slots entry an optional `build`.
 *
 * A build without a stored priority is worked out on read (effectivePriority): Normal, or Urgent when it is marked
 * urgent. So there is nothing to migrate, and no store write that would touch every record.
 */
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const PRIORITY_DEFAULT = 'P2';
export const PRIORITY_LABEL = { P0: 'Urgent', P1: 'High', P2: 'Normal', P3: 'Low' };
const SLOT_LEVEL = { P0: 'urgent', P1: 'high', P2: 'normal', P3: 'low' };
const NAMES = { urgent: 'P0', high: 'P1', normal: 'P2', low: 'P3', boss: 'P0' };

/** 'P1', 'p1', 'high', 'High' → 'P1'; anything else → ''. */
export function normPriority(v) {
  const s = String(v ?? '').trim();
  if (PRIORITIES.includes(s.toUpperCase())) return s.toUpperCase();
  return NAMES[s.toLowerCase()] ?? '';
}
export const priorityRank = (p) => { const i = PRIORITIES.indexOf(normPriority(p)); return i < 0 ? PRIORITIES.indexOf(PRIORITY_DEFAULT) : i; };
export const priorityLabel = (p) => PRIORITY_LABEL[normPriority(p) || PRIORITY_DEFAULT];
export const slotLevel = (p) => SLOT_LEVEL[normPriority(p) || PRIORITY_DEFAULT];

// In the title any case counts; in a long brief only a shout or a line that opens with it ("not urgent" must not count).
const TITLE_MARK = /(^|[^a-z])(urgent|hotfix)([^a-z]|$)/i;
const BRIEF_SHOUT = /\b(URGENT|HOTFIX)\b/;
const BRIEF_OPENS = /^\s*(urgent|hotfix)\b/im;
export function markedUrgent(b) {
  if (!b) return false;
  if ((b.profiles ?? []).includes('urgent')) return true;
  if (TITLE_MARK.test(`${b.id ?? ''} ${b.title ?? ''}`)) return true;
  const brief = `${b.detail ?? ''}\n${b.origin?.brief ?? ''}`;
  return BRIEF_SHOUT.test(brief) || BRIEF_OPENS.test(brief);
}
export const effectivePriority = (b) => normPriority(b?.priority) || (markedUrgent(b) ? 'P0' : PRIORITY_DEFAULT);

const FINISHED = ['complete', 'archived'];
const prNumber = (pr) => Number(/(\d+)\s*$/.exec(String(pr ?? ''))?.[1] ?? 0);
const entryOf = (e, id) => e.build === id || e.name === id;

/**
 * Everything waiting on build `id`, one row each: { kind, id, title, why, route, highlight, url? }.
 * sources (each optional, a missing one just adds nothing):
 *   builds       the store's builds
 *   slots        agent-slots status: { running, queue }
 *   mergeQueue   merge-queue state: { items: [{ pr, title, branch, build, url }] }
 *   pulls        open PRs: [{ number, title, base, branch, url }] (a PR based on this build's branch is stacked on it)
 *   ui           UI Review items still waiting: [{ id, name|title, build, branch, pr, status }]
 *   plans        plan@1 plans: [{ id, title, build: { id } }]
 *   epics        plan features: [{ id, title, dependsOn }]
 */
export function waitingOn(id, sources = {}) {
  const builds = sources.builds ?? [];
  const b = builds.find((x) => x.id === id);
  const rows = [];
  const add = (r) => { if (!rows.some((x) => x.kind === r.kind && x.id === r.id)) rows.push(r); };

  const queue = sources.slots?.queue ?? [];
  const mine = queue.findIndex((q) => entryOf(q, id));
  const holds = (sources.slots?.running ?? []).some((r) => entryOf(r, id) && r.state !== 'finished');
  if (mine >= 0 || holds) {
    for (const q of queue.slice(mine >= 0 ? mine + 1 : 0)) {
      add({ kind: 'slot', id: q.id, title: q.name, why: mine >= 0 ? 'Queued behind it for an agent slot' : 'Waiting for an agent slot it holds', route: 'build', highlight: q.name });
    }
  }

  const refs = [id, b?.planRef].filter(Boolean);
  for (const e of sources.epics ?? []) {
    if (!(e.dependsOn ?? []).some((d) => refs.includes(d))) continue;
    const o = builds.find((x) => x.id === e.id || x.planRef === e.id);
    if (o && (FINISHED.includes(o.status) || o.deleted)) continue;
    add({ kind: 'build', id: e.id, title: o?.title || e.title || e.id, why: 'Depends on it', route: 'build', highlight: o?.title || e.title || e.id });
  }
  for (const o of builds) {
    if (o.id === id || o.deleted || FINISHED.includes(o.status)) continue;
    const deps = [...(o.pending?.dependsOn ?? []), ...(o.queue?.deps ?? [])];
    if (deps.some((d) => refs.includes(d))) add({ kind: 'build', id: o.id, title: o.title, why: 'Depends on it', route: 'build-orchestrator', highlight: o.title });
  }

  const branch = b?.branch || '';
  const pr = prNumber(b?.pr);
  for (const p of sources.pulls ?? []) {
    if (branch && p.base === branch) add({ kind: 'pr', id: `#${p.number}`, title: p.title, why: `Stacked on ${branch}`, route: '', highlight: '', url: p.url });
  }
  const items = sources.mergeQueue?.items ?? [];
  const at = items.findIndex((x) => x.build === id || (pr && x.pr === pr) || (branch && x.branch === branch));
  if (at >= 0) {
    for (const x of items.slice(at + 1)) add({ kind: 'pr', id: `#${x.pr}`, title: x.title, why: `Behind #${items[at].pr} in the merge queue`, route: '', highlight: '', url: x.url });
  }

  for (const u of sources.ui ?? []) {
    const hit = u.build === id || (branch && u.branch === branch) || (pr && Number(u.pr) === pr);
    const open = !u.status || ['waiting', 'pending', 'changes'].includes(u.status);
    if (hit && open) add({ kind: 'ui', id: u.id, title: u.name || u.title || u.id, why: 'In UI Review', route: 'ui-review', highlight: u.name || u.title || '' });
  }
  for (const p of sources.plans ?? []) {
    if (p.build?.id === id) add({ kind: 'plan', id: p.id, title: p.title, why: 'Plan linked to it', route: 'plan-studio', highlight: p.title });
  }
  return rows;
}

/** One line per build for the tags: id → { id, priority, set, waiting }. Skips deleted builds. */
export function priorityMap(sources = {}) {
  const out = {};
  const live = (sources.builds ?? []).filter((b) => !b.deleted);
  for (const b of live) out[b.id] = { id: b.id, priority: effectivePriority(b), set: Boolean(normPriority(b.priority)), waiting: waitingOn(b.id, sources).length };
  // screens that know a build by its pending item or plan epic find it too
  for (const b of live) for (const a of [b.pendingId, b.planRef]) if (a && !out[a]) out[a] = out[b.id];
  return out;
}

/** The build a spoken or typed name means: exact id, exact title, then the one (open first) containing the words. */
export function resolveBuild(builds, name) {
  const live = (builds ?? []).filter((b) => !b.deleted);
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = norm(n);
  const exact = live.find((b) => b.id.toLowerCase() === n) ?? live.find((b) => norm(b.title) === words) ?? live.find((b) => norm(b.id) === words);
  if (exact) return exact;
  const hits = live.filter((b) => norm(`${b.id} ${b.title}`).includes(words));
  return hits.find((b) => !FINISHED.includes(b.status)) ?? hits[0] ?? null;
}
