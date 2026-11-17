/**
 * build-groups — the grouping engine of step-groups@1 (pure, IO-free): which steps of a long build may run beside each
 * other in separate slots, and in what order the groups merge back. Brett, Nov 16 2026: "Any build that's over 30
 * minutes, split the steps up for multiple slots." Contract: framework/core/build-pipeline.mjs (step-groups@1 section);
 * spec: framework/spec/BUILD-GROUPS.md; golden cases: framework/spec/fixtures/build-groups.json (check-build-groups.mjs).
 *
 *   planGroups(build, { splitOverMin, stepMinutes })  →  Plan
 *     minutes    the open steps' estimates added up (a step without one counts as `stepMinutes`, the step cap)
 *     split      true when minutes > splitOverMin and the steps fall into more than one group
 *     groups     BuildGroup[] in merge order (normGroup shape, state 'planned'); one group when not split
 *     mergeOrder the group ids in that order            edges   every edge the plan used: { from, to, why }
 *     reason     one plain line why it was or was not split   error   '' or why the plan was refused (no groups then)
 *
 * Rules:
 *   1. Only the open steps (not done, not skipped) are planned: done steps are on the build branch already.
 *   2. Two steps that share a file run in sequence (an edge from the earlier to the later), so they are in one group.
 *      Groups are the connected pieces of that file graph: independent of each other, they may run at once.
 *   3. A step's `dependsOn` orders steps: inside a group it puts the dependency first; across groups it makes the step's
 *      group wait for the dependency's group to merge (group.dependsOn). Steps in a group run in topological order,
 *      ties by step order; groups merge in topological order over group.dependsOn, ties by their first step.
 *      Two groups that would wait for each other (A's step depends on B's, B's on A's) collapse into one sequential
 *      group: always safe, only less parallel.
 *   4. Refused (error, no groups): a dependsOn on a step the build lacks, on the step itself, or a circle of steps.
 *   5. At or under the threshold (or splitOverMin 0 = off, or fewer than 2 open steps) the build stays one group.
 *   withGroups(build, plan) → the build with `groups` set and each open step's `group` field pointing at its group.
 */
import { GROUPS_SCHEMA, IMPLICIT_GROUP, normGroup } from './build-pipeline.mjs';

export const SCHEMA = GROUPS_SCHEMA;
/** The threshold (minutes): a build estimated over this is split. Brett, Nov 16 2026: 30. */
export const DEFAULT_SPLIT_MINUTES = 30;
/** The pipeline-settings@1 key that carries the threshold (Settings → Plugins → Build orchestrator, "Split builds over (min)"). */
export const SPLIT_SETTING = 'splitOverMin';
/** A step without an estimate counts as the step cap (steps are ≤ 10 min since Nov 13 2026). */
export const DEFAULT_STEP_MINUTES = 10;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
/** "45 min", "2 h", "1.5 d", 12 → minutes; null when nothing readable (the same reading as framework/plan/pending-core.mjs). */
export function estimateMinutes(e) {
  if (typeof e === 'number') return Number.isFinite(e) && e > 0 ? Math.round(e) : null;
  const m = /^\s*~?\s*(\d+(?:[.,]\d+)?)\s*(min|mins|minute|minutes|m|h|hr|hrs|hour|hours|d|day|days)?\s*$/i.exec(str(e, 30));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')); const u = (m[2] || 'min').toLowerCase();
  return Math.round(n * (u.startsWith('d') ? 480 : u.startsWith('h') ? 60 : 1));
}
/** The open steps' minutes (rule 1): estimates added up, a missing one counting as `stepMinutes`. */
export function buildMinutes(build, stepMinutes = DEFAULT_STEP_MINUTES) {
  return openStepsOf(build).reduce((sum, s) => sum + (estimateMinutes(s.estimate) ?? stepMinutes), 0);
}
const openStepsOf = (b) => (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && typeof s === 'object' && !s.done && !s.skip && str(s.id));
const norm = (p) => str(p, 300).trim().replace(/^\.\//, '');

/** Kahn's topological sort over `ids` with `edges` [from, to]; ties by `rank(id)`. Returns { order, cycle: ids left in a cycle }. */
function topo(ids, edges, rank) {
  const indeg = new Map(ids.map((id) => [id, 0])); const out = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of edges) { if (!indeg.has(a) || !indeg.has(b) || a === b) continue; out.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }
  const ready = ids.filter((id) => indeg.get(id) === 0).sort((x, y) => rank(x) - rank(y));
  const order = [];
  while (ready.length) {
    const id = ready.shift(); order.push(id);
    for (const n of out.get(id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) { ready.push(n); ready.sort((x, y) => rank(x) - rank(y)); } }
  }
  return { order, cycle: ids.filter((id) => !order.includes(id)).sort((x, y) => rank(x) - rank(y)) };
}

/**
 * The plan for one build. `splitOverMin` (default 30; 0 = never split) and `stepMinutes` (default 10) come from the
 * pipeline settings; the engine itself reads nothing.
 */
export function planGroups(build, { splitOverMin = DEFAULT_SPLIT_MINUTES, stepMinutes = DEFAULT_STEP_MINUTES } = {}) {
  const threshold = Number.isFinite(Number(splitOverMin)) && Number(splitOverMin) >= 0 ? Math.round(Number(splitOverMin)) : DEFAULT_SPLIT_MINUTES;
  const perStep = Number.isFinite(Number(stepMinutes)) && Number(stepMinutes) > 0 ? Math.round(Number(stepMinutes)) : DEFAULT_STEP_MINUTES;
  const open = openStepsOf(build);
  const ids = open.map((s) => str(s.id, 40));
  const rank = new Map(ids.map((id, i) => [id, i]));
  const minutes = buildMinutes(build, perStep);
  const all = new Set((Array.isArray(build?.steps) ? build.steps : []).map((s) => str(s?.id, 40)).filter(Boolean));
  const plan = { $axf: SCHEMA, split: false, minutes, threshold, open: ids.length, groups: [], mergeOrder: [], edges: [], reason: '', error: '' };
  const one = (reason) => { plan.reason = reason; plan.groups = ids.length ? [normGroup({ id: IMPLICIT_GROUP, steps: ids, state: 'planned', mergeOrder: 0 }, 0)] : []; plan.mergeOrder = plan.groups.map((g) => g.id); return plan; };
  const refuse = (error) => { plan.error = error; plan.reason = `refused: ${error}`; return plan; };

  // explicit dependsOn: checked whatever the threshold, so a bad split is named before a slot takes it
  const explicit = []; // [from (dependency), to (the step), why]
  for (const s of open) for (const d of (Array.isArray(s.dependsOn) ? s.dependsOn : []).map((x) => str(x, 40))) {
    if (!d) continue;
    if (d === s.id) return refuse(`step ${s.id} depends on itself`);
    if (!all.has(d)) return refuse(`step ${s.id} depends on "${d}", which is not a step of the build`);
    if (rank.has(d)) explicit.push([d, s.id, `${s.id} depends on ${d}`]); // a done or skipped dependency is satisfied already
  }
  { const { cycle } = topo(ids, explicit.map(([a, b]) => [a, b]), (id) => rank.get(id)); if (cycle.length) return refuse(`steps ${cycle.join(', ')} depend on each other in a circle`); }
  if (!ids.length) return one('nothing open to plan');
  if (ids.length < 2) return one('one open step: nothing to split');
  if (!threshold) return one('splitting is off (threshold 0)');
  if (minutes <= threshold) return one(`${minutes} min is not over ${threshold} min: one group`);

  // rule 2: shared files put two steps in sequence, in step order
  const files = new Map(open.map((s) => [s.id, new Set((Array.isArray(s.files) ? s.files : []).map(norm).filter(Boolean))]));
  const shared = [];
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    const common = [...files.get(open[i].id)].filter((f) => files.get(open[j].id).has(f));
    if (common.length) shared.push([open[i].id, open[j].id, `share ${common.slice(0, 3).join(', ')}${common.length > 3 ? ` +${common.length - 3}` : ''}`]);
  }
  plan.edges = [...shared, ...explicit].map(([from, to, why]) => ({ from, to, why }));

  // groups = connected pieces of the file graph (union-find); a circle of groups waiting on each other collapses into
  // one sequential group (always safe, less parallel) until the group graph is acyclic
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rank.get(ra) < rank.get(rb) ? rb : ra, rank.get(ra) < rank.get(rb) ? ra : rb); };
  for (const [a, b] of shared) union(a, b);
  let ordered; let mergeOrder; let collapsed = 0;
  for (;;) {
    const members = new Map();
    for (const id of ids) { const r = find(id); if (!members.has(r)) members.set(r, []); members.get(r).push(id); }
    const pieces = [...members.values()].sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
    const groupOf = new Map(); pieces.forEach((p, i) => p.forEach((id) => groupOf.set(id, `g${i + 1}`)));
    // rule 3: inside a group the explicit edges order the steps (ties by step order); across groups they make the group wait
    const groupEdges = []; const groupDeps = new Map(pieces.map((_, i) => [`g${i + 1}`, new Set()]));
    for (const [from, to] of explicit) if (groupOf.get(from) !== groupOf.get(to)) { groupDeps.get(groupOf.get(to)).add(groupOf.get(from)); groupEdges.push([groupOf.get(from), groupOf.get(to)]); }
    ordered = [];
    for (const [i, piece] of pieces.entries()) {
      const gid = `g${i + 1}`; const inGroup = new Set(piece);
      const { order, cycle } = topo(piece, explicit.filter(([a, b]) => inGroup.has(a) && inGroup.has(b)).map(([a, b]) => [a, b]), (id) => rank.get(id));
      if (cycle.length) return refuse(`steps ${cycle.join(', ')} depend on each other in a circle`);
      ordered.push({ id: gid, steps: order, dependsOn: [...groupDeps.get(gid)].sort() });
    }
    const t = topo(ordered.map((g) => g.id), groupEdges, (gid) => rank.get(ordered.find((g) => g.id === gid).steps[0]));
    if (!t.cycle.length) { mergeOrder = t.order; break; }
    const stuck = t.cycle.flatMap((gid) => ordered.find((g) => g.id === gid).steps);
    for (const id of stuck.slice(1)) union(stuck[0], id);
    collapsed += 1;
  }
  if (ordered.length < 2) return one(`${minutes} min over ${threshold} min, but every step shares files with the next${collapsed ? ' or waits on one that does' : ''}: one group`);

  plan.split = true;
  // ids follow the merge order (g1 merges first), so a group's name says where it lands
  const named = new Map(mergeOrder.map((gid, i) => [gid, `g${i + 1}`]));
  plan.groups = mergeOrder.map((gid, i) => { const g = ordered.find((x) => x.id === gid); return normGroup({ id: named.get(gid), steps: g.steps, dependsOn: g.dependsOn.map((d) => named.get(d)).sort(), state: 'planned', mergeOrder: i }, i); });
  plan.mergeOrder = plan.groups.map((g) => g.id);
  const waits = plan.groups.filter((g) => g.dependsOn.length).length;
  plan.reason = `${minutes} min over ${threshold} min: ${plan.groups.length} groups${waits ? `, ${waits} waiting on another group` : ''}${collapsed ? `, ${collapsed} circle${collapsed === 1 ? '' : 's'} of waiting groups collapsed into one` : ''}`;
  return plan;
}

/** The build with the plan written on it: `groups` set (none when the plan was refused or not split), each planned step's `group` pointing at its group. */
export function withGroups(build, plan) {
  const b = JSON.parse(JSON.stringify(build ?? {}));
  const groups = plan && !plan.error && plan.split ? plan.groups : [];
  const of = new Map(groups.flatMap((g) => g.steps.map((id) => [id, g.id])));
  b.steps = (Array.isArray(b.steps) ? b.steps : []).map((s) => (of.has(s.id) ? { ...s, group: of.get(s.id) } : s.group && groups.length === 0 ? { ...s, group: '' } : s));
  if (groups.length) b.groups = groups; else delete b.groups;
  return b;
}
