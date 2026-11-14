/**
 * groups-core.mjs — custom groups and custom tabs on the builds board (build-groups@1). Pure: no IO, so the CLI
 * (groups.mjs), the console server and the tests share one set of rules.
 *
 * Brett, Nov 13 2026: "I want to be able to add some custom groups to my board, sorted by state from partials to done,
 * running; mostly for pending; custom pending tabs, custom groups".
 *
 *   build-groups@1 = { $axf, projects: { <profile>: { groups: Group[], updatedAt } } }   one list per project
 *   Group = { id, name, color, builds: [build id…], rule: Rule | null, tab: '' | Stage | 'all', sort, filter: State[],
 *             createdAt, updatedAt }
 *     builds  the builds put in by hand (drag, assign, voice, API); a build may sit in several groups
 *     rule    a smart group: every build that matches joins by itself (plus the hand-picked ones)
 *     tab     '' = only on the Groups board; a stage = its own tab next to Pending, Queue … showing the group's builds
 *             in that stage ('pending' is the usual one: a custom Pending tab); 'all' = every stage
 *     sort    state (partial → pending → queued → running → failed → done → landed, Brett's order) | priority | updated | title
 *     filter  states shown (empty = all)
 *   Rule = { titleContains, behindMoreThan, filedWithinDays, states, priorities }   every set field must hold
 *
 * The array order is the board order (move reorders it). Deleted builds never show in a group.
 */

export const SCHEMA = 'build-groups@1';
/** A build's state on the board, in Brett's order: partials first, then pending, queued, running … done, landed. */
export const STATES = ['partial', 'pending', 'queued', 'running', 'failed', 'done', 'landed'];
export const STATE_LABEL = Object.freeze({ partial: 'Partial', pending: 'Pending', queued: 'Queued', running: 'Running', failed: 'Failed', done: 'Done', landed: 'Landed' });
/** Orchestrator tab (build-pipeline@1 tabOf) → board state. Deleted builds have none. */
export const STATE_OF_TAB = Object.freeze({ incomplete: 'partial', pending: 'pending', queue: 'queued', active: 'running', errors: 'failed', complete: 'done', archive: 'landed' });
/** Where a custom tab may sit: next to one of the orchestrator's stage tabs, or across all of them. */
export const TAB_STAGES = ['pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'all'];
export const COLORS = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'];
export const SORTS = ['state', 'priority', 'updated', 'title'];
export const ACTIONS = ['queue', 'land', 'archive', 'priority'];
export const MAX_GROUPS = 60;
export const MAX_MEMBERS = 500;

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const BUILD_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const err = (m) => Object.assign(new Error(m), { code: 2 });

export const slug = (name) => str(name, 80).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'group';

export function normRule(r) {
  if (!r || typeof r !== 'object') return null;
  const out = {};
  const t = str(r.titleContains, 120).trim(); if (t) out.titleContains = t;
  const b = Number(r.behindMoreThan); if (Number.isFinite(b) && b >= 0 && r.behindMoreThan !== '' && r.behindMoreThan != null) out.behindMoreThan = Math.floor(b);
  const d = Number(r.filedWithinDays); if (Number.isFinite(d) && d >= 0 && r.filedWithinDays !== '' && r.filedWithinDays != null) out.filedWithinDays = Math.min(3650, Math.floor(d));
  const st = (Array.isArray(r.states) ? r.states : []).filter((x) => STATES.includes(x)); if (st.length) out.states = [...new Set(st)];
  const pr = (Array.isArray(r.priorities) ? r.priorities : []).map((x) => str(x, 4).toUpperCase()).filter((x) => /^P[0-3]$/.test(x)); if (pr.length) out.priorities = [...new Set(pr)];
  return Object.keys(out).length ? out : null;
}

export function normGroup(g, now = new Date().toISOString()) {
  if (!g || typeof g !== 'object') return null;
  const name = str(g.name, 60).trim(); if (!name) return null;
  return {
    id: slug(g.id || name), name,
    color: COLORS.includes(g.color) ? g.color : 'neutral',
    builds: [...new Set((Array.isArray(g.builds) ? g.builds : []).map((x) => str(x, 120)).filter((x) => BUILD_RE.test(x)))].slice(0, MAX_MEMBERS),
    rule: normRule(g.rule),
    tab: TAB_STAGES.includes(g.tab) ? g.tab : '',
    sort: SORTS.includes(g.sort) ? g.sort : 'state',
    filter: [...new Set((Array.isArray(g.filter) ? g.filter : []).filter((x) => STATES.includes(x)))],
    createdAt: str(g.createdAt, 40) || now, updatedAt: str(g.updatedAt, 40) || now,
  };
}

export function normDoc(doc) {
  const projects = {};
  const src = doc && typeof doc === 'object' && doc.projects && typeof doc.projects === 'object' ? doc.projects : {};
  for (const [p, v] of Object.entries(src)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(p)) continue;
    const seen = new Set(); const groups = [];
    for (const g of Array.isArray(v?.groups) ? v.groups : []) { const n = normGroup(g); if (n && !seen.has(n.id)) { seen.add(n.id); groups.push(n); } }
    projects[p] = { groups: groups.slice(0, MAX_GROUPS), updatedAt: str(v?.updatedAt, 40) };
  }
  return { $axf: SCHEMA, projects };
}

export const groupsOf = (doc, profile) => doc.projects[profile]?.groups ?? [];

/** Find a group by id or by name (case-insensitive), for the CLI, the API and voice ("the console app group"). */
export function findGroup(groups, ref) {
  const r = str(ref, 80).trim().toLowerCase().replace(/\s+group$/, '');
  if (!r) return null;
  return groups.find((g) => g.id === r) ?? groups.find((g) => g.name.toLowerCase() === r) ?? groups.find((g) => g.id === slug(r)) ?? null;
}

function uniqueId(groups, name) {
  const base = slug(name); let id = base; let n = 2;
  while (groups.some((g) => g.id === id)) id = `${base}-${n++}`;
  return id;
}

/**
 * One change to a project's groups. op = { op: create | update | move | delete | assign, … }:
 *   create { name, color?, tab?, rule?, sort?, filter?, builds? }
 *   update { group, name?, color?, tab?, rule? (null clears), sort?, filter? }
 *   move   { group, to: index | 'up' | 'down' | 'first' | 'last' }
 *   delete { group }                                   the builds stay where they are
 *   assign { groups: [ref…] | group, builds: [id…], mode: add | remove | set }
 * Returns { doc, group?, groups, changed }. Throws (code 2) on a bad request.
 */
export function apply(docIn, profile, op, now = new Date().toISOString()) {
  const doc = normDoc(docIn);
  const cur = (doc.projects[profile]?.groups ?? []).map((g) => ({ ...g }));
  const need = (ref) => { const g = findGroup(cur, ref); if (!g) throw err(`no group "${str(ref, 60)}"`); return g; };
  let group = null;
  const kind = str(op?.op, 20);
  if (kind === 'create') {
    const name = str(op.name, 60).trim(); if (!name) throw err('a group needs a name');
    if (cur.length >= MAX_GROUPS) throw err(`at most ${MAX_GROUPS} groups per project`);
    if (cur.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw err(`there is a group called "${name}" already`);
    group = normGroup({ ...op, id: uniqueId(cur, name), name, createdAt: now, updatedAt: now }, now);
    cur.push(group);
  } else if (kind === 'update') {
    group = need(op.group);
    const patch = {};
    if (op.name !== undefined) {
      const name = str(op.name, 60).trim(); if (!name) throw err('a group needs a name');
      if (cur.some((g) => g !== group && g.name.toLowerCase() === name.toLowerCase())) throw err(`there is a group called "${name}" already`);
      patch.name = name;
    }
    if (op.color !== undefined) { if (!COLORS.includes(op.color)) throw err(`colour is one of ${COLORS.join(', ')}`); patch.color = op.color; }
    if (op.tab !== undefined) { if (op.tab !== '' && op.tab !== 'none' && !TAB_STAGES.includes(op.tab)) throw err(`tab is none or one of ${TAB_STAGES.join(', ')}`); patch.tab = op.tab === 'none' ? '' : op.tab; }
    if (op.sort !== undefined) { if (!SORTS.includes(op.sort)) throw err(`sort is one of ${SORTS.join(', ')}`); patch.sort = op.sort; }
    if (op.filter !== undefined) patch.filter = Array.isArray(op.filter) ? op.filter : [];
    if (op.rule !== undefined) patch.rule = op.rule;
    Object.assign(group, normGroup({ ...group, ...patch, updatedAt: now }, now));
  } else if (kind === 'move') {
    group = need(op.group);
    const i = cur.indexOf(group);
    const to = op.to === 'up' ? i - 1 : op.to === 'down' ? i + 1 : op.to === 'first' ? 0 : op.to === 'last' ? cur.length - 1 : Number(op.to);
    if (!Number.isFinite(to)) throw err('move to an index, up, down, first or last');
    cur.splice(i, 1); cur.splice(Math.max(0, Math.min(cur.length, Math.floor(to))), 0, group);
  } else if (kind === 'delete') {
    group = need(op.group);
    cur.splice(cur.indexOf(group), 1);
  } else if (kind === 'assign') {
    const refs = Array.isArray(op.groups) ? op.groups : [op.group];
    const targets = refs.filter((x) => str(x).trim()).map(need);
    if (!targets.length) throw err('name at least one group');
    const ids = [...new Set((Array.isArray(op.builds) ? op.builds : [op.builds]).map((x) => str(x, 120).trim()).filter(Boolean))];
    const bad = ids.filter((x) => !BUILD_RE.test(x)); if (bad.length) throw err(`not a build id: ${bad.join(', ')}`);
    const mode = op.mode === 'remove' || op.mode === 'set' ? op.mode : 'add';
    if (!ids.length && mode !== 'set') throw err('name at least one build');
    for (const g of targets) {
      const next = mode === 'set' ? ids : mode === 'remove' ? g.builds.filter((x) => !ids.includes(x)) : [...g.builds, ...ids.filter((x) => !g.builds.includes(x))];
      if (next.length > MAX_MEMBERS) throw err(`at most ${MAX_MEMBERS} builds in a group`);
      g.builds = next; g.updatedAt = now;
    }
    group = targets[0];
  } else throw err('op is create, update, move, delete or assign');
  doc.projects[profile] = { groups: cur, updatedAt: now };
  return { doc, group, groups: cur };
}

/** The board state of a build row ({ tab } from build-pipeline@1), or '' (deleted). */
export const stateOf = (row) => STATE_OF_TAB[row?.tab] ?? '';

const DAY = 86400e3;
/** Start of the local day `days` ago (0 = today) for "filed today" / "filed this week". */
const since = (days, now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() - days * DAY; };

/**
 * Does a build row match a smart rule? row = { id, title, tab, priority (P0-P3 or label), createdAt, behind? }.
 * behind = commits behind main (from the merge queue); a build with no known number never matches a "behind" rule.
 */
export function matchesRule(rule, row, now = Date.now()) {
  if (!rule) return false;
  if (rule.titleContains && !`${row.title ?? ''} ${row.id ?? ''}`.toLowerCase().includes(rule.titleContains.toLowerCase())) return false;
  if (rule.behindMoreThan != null && !(Number.isFinite(row.behind) && row.behind > rule.behindMoreThan)) return false;
  if (rule.filedWithinDays != null) { const t = Date.parse(row.createdAt ?? ''); if (!Number.isFinite(t) || t < since(rule.filedWithinDays, now)) return false; }
  if (rule.states && !rule.states.includes(stateOf(row))) return false;
  if (rule.priorities && !rule.priorities.includes(priorityCode(row.priority))) return false;
  return true;
}

const PRIO_CODE = { urgent: 'P0', high: 'P1', normal: 'P2', low: 'P3' };
export const priorityCode = (p) => { const s = str(p, 10); return /^P[0-3]$/i.test(s) ? s.toUpperCase() : PRIO_CODE[s.toLowerCase()] ?? 'P2'; };

/** Sort rows the group's way (state is Brett's order; ties go newest first). */
export function sortRows(rows, sort = 'state') {
  const upd = (r) => str(r.updatedAt || r.createdAt, 40);
  const by = {
    state: (a, b) => STATES.indexOf(stateOf(a)) - STATES.indexOf(stateOf(b)),
    priority: (a, b) => priorityCode(a.priority).localeCompare(priorityCode(b.priority)),
    title: (a, b) => str(a.title).toLowerCase().localeCompare(str(b.title).toLowerCase()),
    updated: () => 0,
  }[sort] ?? (() => 0);
  return [...rows].sort((a, b) => by(a, b) || upd(b).localeCompare(upd(a)));
}

/** Count per state (every state present, 0 when none). */
export function countStates(rows) {
  const c = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const r of rows) { const s = stateOf(r); if (s) c[s] += 1; }
  return c;
}

/**
 * The board view of every group: members (hand-picked ∪ rule matches, deleted builds left out), counts per state over
 * all members, the rows shown (filter, then sort) and, for a group pinned as a tab, the rows that tab shows.
 * rows = every build row of the project (build-pipeline@1 rows with tab). opts.stage / opts.state narrow one call.
 */
export function view(groups, rows, { now = Date.now() } = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return groups.map((g) => {
    const manual = g.builds.map((id) => byId.get(id)).filter((r) => r && stateOf(r));
    const auto = g.rule ? rows.filter((r) => stateOf(r) && !g.builds.includes(r.id) && matchesRule(g.rule, r, now)) : [];
    const members = [...manual, ...auto];
    const shown = sortRows(g.filter.length ? members.filter((r) => g.filter.includes(stateOf(r))) : members, g.sort);
    const tabRows = !g.tab ? [] : g.tab === 'all' ? shown : sortRows(members.filter((r) => r.tab === g.tab), g.sort);
    return { ...g, smart: !!g.rule, counts: countStates(members), total: members.length, missing: g.builds.filter((id) => !byId.has(id)),
      auto: auto.map((r) => r.id), rows: shown, tabRows };
  });
}

/** The builds a group action reaches and the ones it skips: queue = Pending ones, land = Done ones, archive = any not running, priority = all. */
export function actionTargets(groupView, action) {
  const pick = {
    queue: (r) => r.tab === 'pending',
    land: (r) => r.tab === 'complete',
    archive: (r) => r.tab !== 'active' && r.tab !== 'archive',
    priority: () => true,
  }[action];
  if (!pick) throw err(`action is one of ${ACTIONS.join(', ')}`);
  const members = groupView.rows ?? []; // the action reaches what the group shows (after its state filter)
  return { ids: members.filter(pick).map((r) => r.id), skipped: members.filter((r) => !pick(r)).map((r) => ({ id: r.id, state: stateOf(r) })) };
}

/** One short line per group for the CLI and voice: "Console app · 7 builds: 2 partial, 3 pending, 1 running, 1 done". */
export function line(gv) {
  const parts = STATES.filter((s) => gv.counts[s]).map((s) => `${gv.counts[s]} ${s}`);
  return `${gv.name}${gv.smart ? ' (smart)' : ''}${gv.tab ? ` · tab ${gv.tab}` : ''} · ${gv.total} build${gv.total === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}
