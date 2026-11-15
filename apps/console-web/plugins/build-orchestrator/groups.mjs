#!/usr/bin/env node
/**
 * groups.mjs — custom groups and custom tabs on the orchestrator's builds board (build-groups@1, rules in groups-core.mjs).
 * Saved per project (projects@1 profile) in <pipeline dir>/groups.json, next to the pipeline's settings, so the VPS host
 * and the console container read the same file. Group actions go through the pipeline (queue, archive) and the priority
 * tags (priority, land), under the builds store lock.
 *
 *   node apps/console-web/plugins/build-orchestrator/groups.mjs list [--json]           every group: counts per state, members
 *   … show <group> [--state s]                                one group, its builds sorted by state (or its sort)
 *   … tabs                                                   the groups pinned as tabs and the builds each tab shows
 *   … create --name N [--color c] [--tab stage|all] [--sort s] [--filter s,s] [--rule JSON] [--builds a,b]
 *   … rename <group> --name N | color <group> <c> | tab <group> <stage|all|none> | sort <group> <s> | filter <group> <s,s|all>
 *   … rule <group> JSON | rule <group> --clear | rule <group> --title T --behind N --filed-days D --states s,s --priorities P0,P1
 *   … move <group> <index|up|down|first|last>
 *   … delete <group>                                         the builds stay where they are
 *   … add <group[,group…]> <build…> | remove <group[,group…]> <build…> | set <group> <build…>
 *   … act <group> queue|land|archive|priority [--priority P0-P3|urgent…] [--why w]
 *   … apply  (one op as JSON on stdin: { op: create|update|move|delete|assign, … }, the console API's door)
 * Every command takes --json; --sources reads { behind: { <build>: n } } on stdin (commits behind main, from the merge
 * queue) for "behind main" rules. Exit 0 ok, 2 refused / usage.
 *
 * land: the merge queue already lands every ready PR by itself, oldest first and by priority; "land all" tags every Done
 * build of the group Urgent so the merge queue takes them first. queue: every Pending build → the Queue. archive: every
 * build without a live session → the Archive. priority: every build of the group gets the priority.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './groups-core.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import { effectivePriority } from '../../../../framework/core/build-priority.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import { activeProfile } from '../../../../framework/cli/persist.mjs';

const nowIso = () => new Date().toISOString();
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }
const err = (m) => Object.assign(new Error(m), { code: 2 });

/** Same folder rule as pipeline.mjs pipeDir() (kept here so reading groups never loads the dispatcher). */
export function groupsFile(env = process.env) {
  if (env.AXF_GROUPS_FILE) return env.AXF_GROUPS_FILE;
  if (env.AXF_PIPELINE_DIR) return join(env.AXF_PIPELINE_DIR, 'groups.json');
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return join(existsSync(hub) ? join(hub, 'pipeline') : join(process.env.HOME || '/root', '.axf', 'pipeline'), 'groups.json');
}
export const loadDoc = () => G.normDoc(readJson(groupsFile(), {}));
export const profile = () => activeProfile().id;

/** Every build row of the active project the board can group: id, title, tab, priority, dates, steps, behind. */
export function boardRows(behind = {}) {
  const p = profile();
  return loadStore().builds.filter((b) => (b.profiles ?? []).includes(p) && !b.deleted && BP.tabOf(b) && BP.tabOf(b) !== 'deleted').map((b) => {
    const steps = b.steps ?? []; const done = steps.filter((s) => s.done).length;
    return { id: b.id, title: b.title, status: b.status, tab: BP.tabOf(b), priority: effectivePriority(b), createdAt: b.createdAt ?? '', updatedAt: b.updatedAt ?? '',
      steps: { done, total: steps.length }, pr: b.pr ?? '', branch: b.branch ?? '', held: BP.isHeld(b), ...(Number.isFinite(behind?.[b.id]) ? { behind: behind[b.id] } : {}) };
  });
}

/** The project's groups as the board shows them. */
export function listGroups({ behind = {} } = {}) {
  const doc = loadDoc(); const rows = boardRows(behind); const groups = G.view(G.groupsOf(doc, profile()), rows);
  const inGroup = new Set(groups.flatMap((g) => [...g.builds, ...g.auto]));
  return { profile: profile(), groups, loose: G.sortRows(rows.filter((r) => r.tab === 'pending' && !inGroup.has(r.id)), 'updated') };
}

/** One change (create / update / move / delete / assign), saved for the active project. */
export function change(op, { behind = {} } = {}) {
  const r = G.apply(readJson(groupsFile(), {}), profile(), op, nowIso());
  writeJson(groupsFile(), r.doc);
  const views = G.view(r.groups, boardRows(behind));
  return { group: r.group ? views.find((g) => g.id === r.group.id) ?? r.group : null, groups: views, deleted: op.op === 'delete' ? r.group?.id : undefined };
}

/** A group action on every build it reaches: { action, done: [id…], refused: [{ id, error }], skipped: [{ id, state }] }. */
export async function groupAction(ref, action, { priority = '', why = '', by = process.env.AXF_ACTOR || 'cli', behind = {} } = {}) {
  const { groups } = listGroups({ behind });
  const gv = G.findGroup(groups, ref); if (!gv) throw err(`no group "${ref}"`);
  const { ids, skipped } = G.actionTargets(gv, action);
  if (!ids.length) return { group: gv.id, action, done: [], refused: [], skipped };
  if (action === 'priority' || action === 'land') {
    const value = action === 'land' ? 'P0' : priority;
    if (!value) throw err('say which priority: urgent, high, normal, low or P0-P3');
    const { setPriority } = await import('../../../../framework/cli/build-priority.mjs');
    const r = setPriority(ids, value, by);
    return { group: gv.id, action, done: r.ids, refused: [], skipped, priority: r.priority, label: r.label };
  }
  const pipe = await import('./pipeline.mjs');
  if (action === 'archive') { const r = pipe.buildAction('archive', ids, { by, why }); return { group: gv.id, action, done: r.done.map((d) => d.id), refused: r.refused, skipped }; }
  const done = []; const refused = [];
  for (const id of ids) { try { pipe.queue(id, { by }); done.push(id); } catch (e) { refused.push({ id, error: e.message }); } }
  return { group: gv.id, action, done, refused, skipped };
}

// ------------------------------------------------------------------ CLI

const ruleFromFlags = (flag, has) => {
  if (has('clear')) return null;
  const r = {};
  if (flag('title')) r.titleContains = flag('title');
  if (flag('behind')) r.behindMoreThan = Number(flag('behind'));
  if (flag('filed-days')) r.filedWithinDays = Number(flag('filed-days'));
  if (flag('states')) r.states = flag('states').split(',');
  if (flag('priorities')) r.priorities = flag('priorities').split(',');
  return r;
};

async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json' && a !== '--sources');
  const flag = (n, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const has = (n) => args.includes(`--${n}`);
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--clear', '--json'].includes(args[i - 1])));
  const out = (o, text) => console.log(json ? JSON.stringify({ ok: true, ...o }) : text);
  const stdin = argv.includes('--sources') || argv[0] === 'apply' ? readJson(0, {}) ?? {} : {};
  const behind = stdin.behind && typeof stdin.behind === 'object' ? stdin.behind : {};
  const by = flag('by', process.env.AXF_ACTOR || 'cli');
  const [cmd = 'list', ...rest] = pos;
  const show = (r, verb) => out(r, `${verb}${r.group ? `: ${G.line(r.group)}` : ''}`);
  const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

  if (cmd === 'list') { const r = listGroups({ behind }); return out(r, r.groups.map(G.line).join('\n') || 'No groups yet: groups.mjs create --name "Console app"'); }
  if (cmd === 'show') {
    const r = listGroups({ behind }); const g = G.findGroup(r.groups, rest.join(' ')); if (!g) throw err(`no group "${rest.join(' ')}"`);
    const st = flag('state'); const rows = st ? g.rows.filter((x) => G.stateOf(x) === st) : g.rows;
    return out({ group: { ...g, rows } }, [G.line(g), ...rows.map((x) => `  ${G.stateOf(x).padEnd(8)} ${x.id}${x.title ? ` · ${x.title}` : ''}`)].join('\n'));
  }
  if (cmd === 'tabs') { const r = listGroups({ behind }); const tabs = r.groups.filter((g) => g.tab).map((g) => ({ id: `group:${g.id}`, group: g.id, label: g.name, stage: g.tab, color: g.color, count: g.tabRows.length, rows: g.tabRows })); return out({ tabs }, tabs.map((t) => `${t.label} (next to ${t.stage}) · ${t.count}`).join('\n') || 'No group is pinned as a tab.'); }
  if (cmd === 'apply') { const r = change(stdin.op ?? stdin, { behind }); return show(r, `${(stdin.op ?? stdin).op ?? 'change'}`); }
  if (cmd === 'create') { const r = change({ op: 'create', name: flag('name') || rest.join(' '), color: flag('color') || undefined, tab: flag('tab') || undefined, sort: flag('sort') || undefined, filter: flag('filter') ? csv(flag('filter')) : undefined, rule: flag('rule') ? JSON.parse(flag('rule')) : ruleFromFlags(flag, has), builds: csv(flag('builds')) }); return show(r, 'created'); }
  if (cmd === 'rename') { const r = change({ op: 'update', group: rest[0], name: flag('name') || rest.slice(1).join(' ') }); return show(r, 'renamed'); }
  if (cmd === 'color' || cmd === 'colour') { const r = change({ op: 'update', group: rest[0], color: rest[1] }); return show(r, 'colour set'); }
  if (cmd === 'tab') { const r = change({ op: 'update', group: rest[0], tab: rest[1] ?? 'pending' }); return show(r, 'tab set'); }
  if (cmd === 'sort') { const r = change({ op: 'update', group: rest[0], sort: rest[1] }); return show(r, 'sort set'); }
  if (cmd === 'filter') { const r = change({ op: 'update', group: rest[0], filter: rest[1] === 'all' ? [] : csv(rest[1]) }); return show(r, 'filter set'); }
  if (cmd === 'rule') { const r = change({ op: 'update', group: rest[0], rule: rest[1] ? JSON.parse(rest.slice(1).join(' ')) : ruleFromFlags(flag, has) }); return show(r, r.group?.rule ? 'rule set' : 'rule cleared'); }
  if (cmd === 'move') { const r = change({ op: 'move', group: rest[0], to: rest[1] }); return out(r, r.groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n')); }
  if (cmd === 'delete') { const r = change({ op: 'delete', group: rest.join(' ') }); return out(r, `deleted ${r.deleted}`); }
  if (cmd === 'add' || cmd === 'remove' || cmd === 'set') { const r = change({ op: 'assign', groups: csv(rest[0]), builds: rest.slice(1), mode: cmd }); return show(r, cmd === 'add' ? 'added' : cmd === 'remove' ? 'removed' : 'set'); }
  if (cmd === 'act') {
    const r = await groupAction(rest[0], rest[1], { priority: flag('priority') || rest[2] || '', why: flag('why'), by, behind });
    return out(r, [`${r.group} ${r.action}: ${r.done.length} done${r.done.length ? ` (${r.done.join(', ')})` : ''}`, ...r.refused.map((x) => `  refused ${x.id}: ${x.error}`), r.skipped.length ? `  skipped ${r.skipped.length} (not in the right state)` : ''].filter(Boolean).join('\n'));
  }
  throw err(`unknown command "${cmd}" (list, show, tabs, create, rename, color, tab, sort, filter, rule, move, delete, add, remove, set, act, apply)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`groups: ${e.message}`);
    process.exit(e.code === 2 || e instanceof SyntaxError ? 2 : 1);
  });
}
