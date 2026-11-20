#!/usr/bin/env node
/**
 * Plan Studio 2.0 CLI + store (plan-tree@1). One file holds the whole tree, so every surface (console page, REST,
 * MCP, CLI, AmberX voice) reads and writes the same thing through the same pure core (web/tree-core.mjs):
 *
 *   <store>/tree.json          plan-tree@1 (items nested to any depth + the trash for undo)
 *
 * <store> is the hub's shared data where /projects is mounted (the console container): /projects/amberx-axf/_data/
 * plan-studio-2/, per project (projects@1). Elsewhere it is the plugin's data folder (.axf-console/plugins/plan-studio-2).
 * AXF_PLAN_TREE_DIR overrides (tests). The store starts empty: nothing is synced into it, and the old Plan Studio's
 * plans are never read.
 *
 *   node apps/console-web/plugins/plan-studio-2/tree.mjs tree [<item>] [--md]     the tree (indented), or one branch
 *   … list [--kind step] [--under <item>] [--q words]                            flat rows
 *   … show <item>                                                                one item with its path and progress
 *   … find <words> [--kind k] [--under <item>]                                   matches, best first (focus to open each)
 *   … add <kind> "<title>" [--in <item>] [--at n] [--body …] [--model Opus] [--minutes 20] [--priority P1] [--tags a,b]
 *   … rename <item> "<title>" · edit <item> --title … --status … --done true --priority … --model … --minutes … --kind …
 *   … move <item> [--in <item>|--top] [--at n] · up <item> · down <item> · indent <item> · outdent <item>
 *   … duplicate <item> · delete|remove <item> [<id>…] · undo [<trash id>] · trash     delete takes any item (plan, section,
 *                                                                 step, note …) with everything under it to the trash; undo brings it back.
 *                                                                 Every delete is also appended to deleted.jsonl in the store folder
 *   … link <item> <todo|build|note|shipped|plan|url> <ref> [--label …] · unlink <item> <type> <ref>
 *   … collapse [<item>|--all] · expand [<item>|--all]
 *   … export [<item>] [--json] [--out file] · import <file.json> [--in <item>]
 *   … validate <item> [--id build-id]                             plan-build@1: the build id it gets and every reason it may not be sent
 *   … build <item> [--profile p] [--id build-id] [--preview]      send to the build orchestrator: must pass plan-build@1; ONE Pipeline 2.0
 *                                                                 build (flow pipeline-2, pending, its steps kept as planning) in the
 *                                                                 builds store; the orchestrator's splitting stage designs the build steps
 *   … say "<spoken sentence>"                                     one voice command (what AmberX and the page's mic send)
 *   … clear --yes                                                 everything gone (the trash too)
 *   … api '<json {op,…}>'                                         what the server calls (also reads stdin)
 *   … where
 *   --json on any command prints one JSON line.
 *
 * `<item>` is an id, or the title / words in it ("the step about deploy"): tree-core resolve().
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tc from './web/tree-core.mjs';
import * as P2 from '../../../../framework/core/pipeline-status.mjs';
import * as BS from '../../../../framework/cli/builds-store.mjs';
import * as core from '../../../../framework/plan/builds-store-core.mjs';
import * as dataFiles from '../../../../framework/core/data-files.mjs';
import { persistRoot, readProfiles, activeProfile } from '../../../../framework/cli/persist.mjs';
import { projectDataDir } from '../../../../framework/cli/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'plan-studio-2';
export const FILE = 'tree.json';

// Through data-files (data-store@1): the hub copy maps to planner/v2/tree.json (planner_tree rows on axf-data), so the
// tree follows the planner namespace's mode (local file, shadow copy, or axf-data only after the cut-over).
const readJson = (f, d = null) => { try { return dataFiles.readJsonSync(f, d); } catch { return d; } };
const writeJson = (f, v) => dataFiles.writeJsonSync(f, v, 1);

/** Where the tree lives: the hub's shared data per project, else the plugin's data folder; AXF_PLAN_TREE_DIR as given. */
export function storeDir() {
  if (process.env.AXF_PLAN_TREE_DIR) return process.env.AXF_PLAN_TREE_DIR;
  const root = persistRoot();
  return projectDataDir(root ? join(root, FOLDER) : join(ROOT, '.axf-console/plugins', FOLDER));
}
export const onHub = () => !process.env.AXF_PLAN_TREE_DIR && !!persistRoot();
const file = () => join(storeDir(), FILE);

export function load() { return tc.normalize(readJson(file(), tc.emptyState())); }
export function save(state) { const s = tc.normalize(state); writeJson(file(), s); return s; }

/** Every delete, one JSON line each (the trash keeps only the newest TRASH_MAX; this file keeps them all). */
export const DELETED_FILE = 'deleted.jsonl';
/** Append what a delete removed (the trash entry: the item and everything under it) before the tree is saved without it. */
export function backupDeleted(entry) {
  mkdirSync(storeDir(), { recursive: true });
  appendFileSync(join(storeDir(), DELETED_FILE), `${JSON.stringify({ $axf: 'plan-tree-deleted@1', ...entry })}\n`);
  return DELETED_FILE;
}

/* ------------------------------------------------------------------ the build orchestrator (explicit hand-off) */

export function profiles() { try { return readProfiles().profiles?.map((p) => ({ id: p.id, label: p.label ?? p.name ?? p.id })) ?? []; } catch { return []; } }
const buildId = (title, taken) => { const base = tc.slug(title).slice(0, 34) || 'plan'; let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`.slice(0, 40); return id; };

/** A build sent from this item that has not landed or left the flow yet (pending, split, active or failed), or null. */
const liveSent = (builds, itemId) => builds.find((b) => b.planRef === itemId && b.flow === P2.FLOW && !b.deleted && ![P2.EXIT, 'landed'].includes(b.status)) ?? null;

/**
 * The item as a plan-build@1 manifest (framework/schemas/json/plan-build.schema.json): one build, the plan as a whole
 * (title, body, its open steps as planning steps). `id` is the build id Plan Studio gives it (from the title, unique in
 * the builds store). Steps need no minutes or model: the orchestrator's splitting stage designs the build steps.
 * → { plan, errors: [{ path, why }] } (errors empty = it may be sent).
 */
export function planOf(state, ref, { id = '', said = '' } = {}) {
  const it = tc.resolve(state, ref);
  if (!it) throw new tc.TreeError('not_found', `no item "${ref}"`);
  const change = tc.toBuild(state, it.id, { said });
  const builds = BS.loadStore().builds;
  const taken = new Set(builds.flatMap((b) => [b.id, b.alias].filter(Boolean)));
  const plan = P2.normPlan({ ...change, id: id || buildId(it.title, taken), planItem: it.id, said,
    steps: change.steps.map((x) => ({ text: x.text, model: x.model, estimate: x.estimate })) });
  const errors = P2.validatePlan(plan);
  if (id && taken.has(id)) errors.push({ path: 'id', why: `"${id}" is already a build: pick another build id` });
  const live = liveSent(builds, it.id);
  if (live) errors.push({ path: 'planItem', why: `already sent as ${live.id} (${P2.labelOf(live.status, live.attempt)}): wait for it to land, or archive it first` });
  return { item: it, plan, errors };
}

/**
 * Send to orchestrator (pipeline-2@1, framework/spec/PIPELINE-2.md): the plan must pass plan-build@1 (nothing invalid
 * moves on: every reason is listed), gets its build id, and goes into the builds store as ONE Pipeline 2.0 build
 * (`flow: pipeline-2`, status `pending`, no build steps; the plan's steps kept as `planning`). The orchestrator flow
 * takes it from there: splitting (Fable designs the build steps, each with minutes and a model) → split → pulling-main
 * → assigning-models → ready. The item gets a `build` link back.
 */
export function sendToBuild(state, ref, { profile = '', id = '', preview = false, by = '', said = '' } = {}) {
  const prof = profile || activeProfile().id;
  const { item: it, plan, errors } = planOf(state, ref, { id, said });
  const change = tc.toBuild(state, it.id, { said });
  if (preview) return { ok: !errors.length, preview: true, build: { profile: prof, id: plan.id }, change, plan, errors, planning: plan.steps.length };
  if (errors.length) throw new tc.TreeError('validation', `"${it.title}" does not pass plan-build@1, so it was not sent: ${errors.map((e) => `${e.path}: ${e.why}`).join('; ')}`);
  const now = new Date().toISOString(); const who = by || 'plan-studio-2';
  BS.withStore((s) => {
    if (core.findBuild(s, plan.id)) throw new tc.TreeError('validation', `"${plan.id}" is already a build: pick another build id`);
    const live = liveSent(s.builds, it.id);
    if (live) throw new tc.TreeError('validation', `"${it.title}" is already sent as ${live.id}: wait for it to land, or archive it first`);
    const b = P2.transition({
      id: plan.id, title: plan.title, detail: plan.detail, source: FOLDER, planRef: it.id, profiles: [prof], createdAt: now, updatedAt: now, flow: P2.FLOW,
      notes: [{ text: `Plan Studio 2.0 item: ${it.id} (${tc.pathOf(state, it.id)}). Passed plan-build@1; sent as one Pipeline 2.0 build with ${plan.steps.length} planning step${plan.steps.length === 1 ? '' : 's'}. The splitting stage designs its build steps.`, at: now }],
      ...(said ? { origin: { said, at: now, source: 'console', by: by || 'Brett' } } : {}),
      planning: plan.steps,
      steps: [],
    }, 'pending', { at: now, by: who, why: 'Send to orchestrator' }).rec;
    s.builds.push(core.normBuild(b, { now, profile: prof }));
    return s;
  }, { by: who, action: 'plan-studio-2:send', note: `${plan.id}: ${plan.steps.length} planning steps` });
  const linked = tc.link(state, it.id, { type: 'build', ref: `${prof}:${plan.id}`, label: plan.title });
  return { ok: true, state: linked.state, build: { profile: prof, id: plan.id }, planning: plan.steps.length, plan };
}

/* ------------------------------------------------------------------ one op → one change (the server, the CLI, voice) */

const view = (s, it) => (it ? { ...it, path: tc.pathOf(s, it.id), depth: tc.depthOf(s, it.id), progress: tc.progress(s, it.id), children: tc.children(s, it.id).length } : null);

export function stateView(s) {
  return { ok: true, $axf: tc.SCHEMA, rev: s.rev, count: s.items.length, roots: tc.roots(s).length, trash: s.trash.map((t) => ({ id: t.id, title: t.title, at: t.at, items: t.items.length })), progress: tc.progress(s, null), store: storeDir(), onHub: onHub(), kinds: tc.KINDS, statuses: tc.STATUSES, priorities: tc.PRIORITIES, models: tc.MODELS, linkTypes: tc.LINK_TYPES, items: s.items };
}

/**
 * Run one operation on the store and save. `r` = { op, … }. Returns { ok, … } with the changed item when there is one.
 * Reads: state · tree · get · find · export · trash. Writes: add · rename · edit · move · nudge · indent · outdent ·
 * duplicate · delete · undo · link · unlink · collapse · import · build · say · clear.
 */
export function api(r, { by = '' } = {}) {
  const s = load();
  const who = String(r.by ?? by ?? '');
  const done = (res, msg) => { const st = save(res.state); const it = res.item ? view(st, tc.byId(st, res.item.id) ?? res.item) : null; return { ok: true, rev: st.rev, item: it, say: msg, ...Object.fromEntries(Object.entries(res).filter(([k]) => !['state', 'item'].includes(k))) }; };
  switch (r.op) {
    case 'state': return stateView(s);
    case 'tree': { const root = r.id ? tc.resolve(s, r.id) : null; if (r.id && !root) throw new tc.TreeError('not_found', `no item "${r.id}"`); return { ok: true, rev: s.rev, root: root ? view(s, root) : null, tree: tc.tree(s, root?.id ?? null) }; }
    case 'get': { const it = tc.resolve(s, r.id); if (!it) throw new tc.TreeError('not_found', `no item "${r.id}"`); return { ok: true, item: view(s, it), children: tc.children(s, it.id).map((c) => view(s, c)), ancestors: tc.ancestors(s, it.id).map((a) => ({ id: a.id, title: a.title, kind: a.kind })) }; }
    case 'find': { const under = r.under ? tc.resolve(s, r.under)?.id ?? '' : ''; return { ok: true, hits: tc.find(s, r.q ?? '', { kind: r.kind ?? '', limit: Math.max(1, Math.min(Number(r.limit) || 20, 200)), under }) }; }
    case 'export': { if (r.format === 'json') return { ok: true, format: 'json', data: tc.toJson(s, r.id || null) }; return { ok: true, format: 'md', markdown: tc.toMarkdown(s, r.id || null) }; }
    case 'trash': return { ok: true, trash: s.trash.map((t) => ({ id: t.id, title: t.title, at: t.at, by: t.by, items: t.items.length })) };
    case 'add': { const res = tc.add(s, { parent: r.parent ?? r.in ?? null, kind: r.kind, title: r.title, body: r.body, index: r.index, by: who, status: r.status, priority: r.priority, model: r.model, minutes: r.minutes, tags: r.tags }); return done(res, `Added the ${tc.KIND_LABEL[res.item.kind].toLowerCase()} "${res.item.title}"${res.item.parent ? ` inside "${tc.byId(res.state, res.item.parent).title}"` : ''}.`); }
    case 'rename': { const res = tc.rename(s, r.id, r.title, who); return done(res, `Renamed to "${res.item.title}".`); }
    case 'edit': { const res = tc.edit(s, r.id, r.patch ?? r, who); return done(res, res.changed ? `Changed "${res.item.title}".` : 'Nothing changed.'); }
    case 'move': { const res = tc.move(s, r.id, { parent: r.parent ?? r.in ?? null, index: r.index }); return done(res, `Moved "${res.item.title}" ${res.item.parent ? `into "${tc.byId(res.state, res.item.parent).title}"` : 'to the top level'}.`); }
    case 'nudge': { const res = tc.nudge(s, r.id, Number(r.delta) || 0); return done(res, `Moved "${res.item.title}" ${Number(r.delta) < 0 ? 'up' : 'down'}.`); }
    case 'indent': { const res = tc.indent(s, r.id); return done(res, res.changed === false ? 'It is already first; nothing to indent into.' : `Indented "${res.item.title}".`); }
    case 'outdent': { const res = tc.outdent(s, r.id); return done(res, res.changed === false ? 'It is already at the top level.' : `Outdented "${res.item.title}".`); }
    case 'duplicate': { const res = tc.duplicate(s, r.id, who); return done(res, `Duplicated it as "${res.item.title}" (${res.count} items).`); }
    case 'delete': { const res = tc.remove(s, r.id, who); const backup = backupDeleted(res.state.trash.find((t) => t.id === res.trashId)); return done({ ...res, backup }, `Deleted "${res.item.title}" (${res.removed} items). Say undo to bring it back.`); }
    case 'undo': { const res = tc.undo(s, r.trashId ?? ''); return done(res, res.item ? `Brought back "${res.item.title}".` : `Brought ${res.restored} items back.`); }
    case 'link': { const res = tc.link(s, r.id, { type: r.type, ref: r.ref, label: r.label }); return done(res, res.changed ? `Linked "${res.item.title}" to the ${r.type} ${r.label || r.ref}.` : 'That link is already there.'); }
    case 'unlink': { const res = tc.unlink(s, r.id, { type: r.type, ref: r.ref }); return done(res, res.changed ? 'Link removed.' : 'No such link.'); }
    case 'collapse': { const ids = r.all ? null : [tc.resolve(s, r.id)?.id].filter(Boolean); if (!r.all && !ids.length) throw new tc.TreeError('not_found', `no item "${r.id}"`); const res = tc.setCollapsed(s, ids, r.collapsed !== false); return done(res, `${r.collapsed === false ? 'Expanded' : 'Collapsed'} ${r.all ? 'everything' : 'it'}.`); }
    case 'import': { const res = tc.importItems(s, r.data, { parent: r.parent ?? r.in ?? null, by: who }); return done(res, `Imported ${res.imported} items.`); }
    case 'validate': { const { plan, errors } = planOf(s, r.id, { id: r.buildId, said: r.said }); return { ok: !errors.length, plan, errors, say: errors.length ? `Not ready to send: ${errors.map((e) => `${e.path} ${e.why}`).join('; ')}.` : `Ready to send as ${plan.id}.` }; }
    case 'build': { const res = sendToBuild(s, r.id, { profile: r.profile, id: r.buildId, preview: !!r.preview, by: who, said: r.said }); if (res.preview) return res; const st = save(res.state); return { ok: true, rev: st.rev, build: res.build, planning: res.planning, say: `Sent it to the build orchestrator as ${res.build.id}. Fable splits it into build steps.` }; }
    case 'say': {
      const cmd = tc.parseVoice(r.text ?? '');
      if (!cmd) return { ok: false, understood: false, say: "I didn't catch a plan command. Try: new plan Launch, add a step Deploy to Launch, rename it, delete it, undo." };
      if (cmd.op === 'open') { const it = tc.resolve(s, cmd.id); if (!it) throw new tc.TreeError('not_found', `no item "${cmd.id}"`); return { ok: true, understood: true, command: cmd, item: view(s, it), focus: `plan-studio-2.focus:${it.id}`, say: `Opening "${it.title}".` }; }
      if (cmd.op === 'find') { const hits = tc.find(s, cmd.q, { limit: 5 }); return { ok: true, understood: true, command: cmd, hits, say: hits.length ? `Found ${hits.length}: ${hits.map((h) => h.title).join(', ')}.` : 'Nothing matches.' }; }
      if (cmd.op === 'export') { const it = tc.resolve(s, cmd.id); if (!it) throw new tc.TreeError('not_found', `no item "${cmd.id}"`); return { ok: true, understood: true, command: cmd, markdown: tc.toMarkdown(s, it.id), say: `Exported "${it.title}" as Markdown.` }; }
      const map = { 'send-to-build': { op: 'build', id: cmd.id, said: r.text }, add: { op: 'add', kind: cmd.kind, title: cmd.title, parent: cmd.parent }, collapse: { op: 'collapse', id: cmd.id, all: !!cmd.all, collapsed: cmd.collapsed } };
      const out = api({ ...(map[cmd.op] ?? cmd), by: who });
      return { ...out, understood: true, command: cmd };
    }
    case 'clear': { if (r.confirm !== true && r.yes !== true) throw new tc.TreeError('confirm', 'clearing everything needs confirm: true'); const res = tc.clearAll(s); const st = save(res.state); return { ok: true, rev: st.rev, removed: res.removed, say: `Cleared ${res.removed} items.` }; }
    default: throw new tc.TreeError('validation', `unknown op "${r.op}"`);
  }
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++; } } else pos.push(a);
  }
  return { pos, flags };
}
const indentTree = (rows, depth = 0, out = []) => { for (const r of rows) { const mark = tc.CHECKABLE.has(r.kind) ? (r.done ? '[x] ' : '[ ] ') : ''; out.push(`${'  '.repeat(depth)}${mark}${r.title}  (${r.kind}${r.model ? `, ${r.model}` : ''}${r.minutes ? `, ${r.minutes} min` : ''})  ${r.id}`); indentTree(r.children, depth + 1, out); } return out; };

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const [cmd, ...a] = pos;
  const json = !!flags.json;
  const out = (v, text) => { if (json || text === undefined) console.log(JSON.stringify(v)); else console.log(text); };
  const bool = (v) => (v === undefined ? undefined : v === true || v === 'true' || v === 'yes' || v === '1');
  try {
    switch (cmd) {
      case 'where': return out({ store: storeDir(), onHub: onHub() }, storeDir());
      case 'tree': { const r = api({ op: 'tree', id: a[0] }); if (flags.md) return out(r, api({ op: 'export', id: a[0] }).markdown); return out(r, indentTree(r.tree).join('\n') || '(empty: nothing in Plan Studio 2.0 yet)'); }
      case 'list': { const s = load(); const under = flags.under ? tc.resolve(s, flags.under)?.id ?? '' : ''; const rows = tc.find(s, flags.q ?? '', { kind: flags.kind ?? '', limit: 1000, under }); return out({ ok: true, rows }, rows.map((h) => `${h.kind.padEnd(7)} ${h.id.padEnd(40)} ${h.path}`).join('\n')); }
      case 'show': { const r = api({ op: 'get', id: a[0] }); return out(r, `${r.item.path}\n${r.item.kind} · ${r.item.status || '-'} · ${r.item.priority || '-'} · ${r.item.model || '-'}${r.item.minutes ? ` · ${r.item.minutes} min` : ''} · ${r.item.progress.done}/${r.item.progress.total} done\n${r.item.body}\n${r.item.links.map((l) => `↳ ${l.type}: ${l.label || l.ref}`).join('\n')}`); }
      case 'find': { const r = api({ op: 'find', q: a.join(' '), kind: flags.kind, under: flags.under }); return out(r, r.hits.map((h) => `${h.kind.padEnd(7)} ${h.path}  →  ${h.focus}`).join('\n') || 'nothing matches'); }
      case 'add': { const r = api({ op: 'add', kind: a[0], title: a.slice(1).join(' '), parent: flags.in, index: flags.at === undefined ? undefined : Number(flags.at), body: flags.body, model: flags.model, minutes: flags.minutes, priority: flags.priority, status: flags.status, tags: flags.tags ? String(flags.tags).split(',') : undefined }); return out(r, `${r.say} id ${r.item.id}`); }
      case 'rename': return out(api({ op: 'rename', id: a[0], title: a.slice(1).join(' ') }), 'renamed');
      case 'edit': { const patch = { title: flags.title, body: flags.body, status: flags.status, done: bool(flags.done), priority: flags.priority, model: flags.model, minutes: flags.minutes, kind: flags.kind, tags: flags.tags ? String(flags.tags).split(',') : undefined }; for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k]; const r = api({ op: 'edit', id: a[0], patch }); return out(r, r.say); }
      case 'move': { const r = api({ op: 'move', id: a[0], parent: flags.top ? null : flags.in ?? null, index: flags.at === undefined ? undefined : Number(flags.at) }); return out(r, r.say); }
      case 'up': return out(api({ op: 'nudge', id: a[0], delta: -1 }), 'moved up');
      case 'down': return out(api({ op: 'nudge', id: a[0], delta: 1 }), 'moved down');
      case 'indent': return out(api({ op: 'indent', id: a[0] }), 'indented');
      case 'outdent': return out(api({ op: 'outdent', id: a[0] }), 'outdented');
      case 'duplicate': { const r = api({ op: 'duplicate', id: a[0] }); return out(r, `${r.say} id ${r.item.id}`); }
      case 'delete': case 'remove': case 'rm': {
        if (!a.length) throw new tc.TreeError('validation', `usage: ${cmd} <item> [<id>…]`);
        // every item is resolved before anything goes, so a typo deletes nothing; several items are given by id only
        // (an unquoted title would otherwise read as several items)
        const st = load(); const ids = a.map((ref) => { const it = a.length > 1 ? tc.byId(st, ref) : tc.resolve(st, ref); if (!it) throw new tc.TreeError('not_found', `no item "${ref}"${a.length > 1 ? ' (several items are deleted by id; nothing was deleted)' : ''}`); return it.id; });
        const done = [...new Set(ids)].filter((id, _i, all) => !tc.ancestors(st, id).some((x) => all.includes(x.id))).map((id) => api({ op: 'delete', id }));
        if (done.length === 1) return out(done[0], `${done[0].say} (trash ${done[0].trashId})`);
        return out({ ok: true, rev: done.at(-1).rev, deleted: done.map((r) => ({ id: r.item.id, title: r.item.title, removed: r.removed, trashId: r.trashId })) }, done.map((r) => `${r.say} (trash ${r.trashId})`).join('\n'));
      }
      case 'undo': { const r = api({ op: 'undo', trashId: a[0] }); return out(r, r.say); }
      case 'trash': { const r = api({ op: 'trash' }); return out(r, r.trash.map((t) => `${t.id}  ${t.at}  ${t.title} (${t.items})`).join('\n') || 'the trash is empty'); }
      case 'link': return out(api({ op: 'link', id: a[0], type: a[1], ref: a[2], label: flags.label }), 'linked');
      case 'unlink': return out(api({ op: 'unlink', id: a[0], type: a[1], ref: a[2] }), 'unlinked');
      case 'collapse': return out(api({ op: 'collapse', id: a[0], all: !!flags.all || !a[0], collapsed: true }), 'collapsed');
      case 'expand': return out(api({ op: 'collapse', id: a[0], all: !!flags.all || !a[0], collapsed: false }), 'expanded');
      case 'export': { const r = api({ op: 'export', id: a[0], format: flags.json ? 'json' : 'md' }); const text = r.format === 'json' ? JSON.stringify(r.data, null, 1) : r.markdown; if (flags.out) { writeFileSync(flags.out, text); return console.log(`wrote ${flags.out}`); } return console.log(text); }
      case 'import': { const data = JSON.parse(readFileSync(a[0] === '-' ? 0 : a[0], 'utf8')); return out(api({ op: 'import', data, parent: flags.in }), 'imported'); }
      case 'validate': { const r = api({ op: 'validate', id: a[0], buildId: flags.id, said: flags.said }); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? `ok: plan-build@1, build id ${r.plan.id}, ${r.plan.steps.length} planning steps` : `not valid (plan-build@1):\n${r.errors.map((e) => `  ${e.path}: ${e.why}`).join('\n')}`); }
      case 'build': { const r = api({ op: 'build', id: a[0], profile: flags.profile, buildId: flags.id, preview: !!flags.preview, said: flags.said }); return out(r, r.preview ? `preview: build ${r.build.id} (${r.change.steps.length} steps, ${r.minutes} min)\n${r.change.steps.map((s) => `  - ${s.text} [${s.model}${s.estimate ? `, ${s.estimate}` : ''}]`).join('\n')}` : r.say); }
      case 'say': { const r = api({ op: 'say', text: a.join(' ') }); return out(r, r.say); }
      case 'clear': { if (!flags.yes) throw new tc.TreeError('confirm', 'add --yes to clear everything'); return out(api({ op: 'clear', yes: true }), 'cleared'); }
      case 'api': { const raw = a[0] ?? readFileSync(0, 'utf8'); const r = api(JSON.parse(raw)); return console.log(JSON.stringify(r)); }
      default: console.error('usage: tree.mjs tree|list|show|find|add|rename|edit|move|up|down|indent|outdent|duplicate|delete|remove|undo|trash|link|unlink|collapse|expand|export|import|build|say|clear|api|where'); process.exitCode = 2;
    }
  } catch (e) {
    const err = { ok: false, error: e.message, code: e.code ?? 'error' };
    if (json || cmd === 'api') console.log(JSON.stringify(err)); else console.error(e.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
