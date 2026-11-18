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
 *   … open <plan> [--local]                                                      open it on its own in the console (view:plan-studio-2/plan:<id>)
 *   … find <words> [--kind k] [--under <item>]                                   matches, best first (focus to open each)
 *   … add <kind> "<title>" [--in <item>] [--at n] [--body …] [--model Opus] [--minutes 20] [--priority P1] [--tags a,b]
 *   … rename <item> "<title>" · edit <item> --title … --status … --done true --priority … --model … --minutes … --kind …
 *   … move <item> [--in <item>|--top] [--at n] · up <item> · down <item> · indent <item> · outdent <item>
 *   … duplicate <item> · delete <item> · undo [<trash id>] · trash
 *   … link <item> <todo|build|note|shipped|plan|url> <ref> [--label …] · unlink <item> <type> <ref>
 *   … collapse [<item>|--all] · expand [<item>|--all]
 *   … export [<item>] [--json] [--out file] · import <file.json> [--in <item>]
 *   … build <item> [--profile p] [--id build-id] [--preview]      send to the build orchestrator (its steps = the build's)
 *   … say "<spoken sentence>"                                     one voice command (what AmberX and the page's mic send)
 *   … clear --yes                                                 everything gone (the trash too)
 *   … api '<json {op,…}>'                                         what the server calls (also reads stdin)
 *   … where
 *   --json on any command prints one JSON line.
 *
 * `<item>` is an id, or the title / words in it ("the step about deploy"): tree-core resolve().
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tc from './web/tree-core.mjs';
import { orchestratorPath, persistRoot, readProfiles, activeProfile } from '../../../../framework/cli/persist.mjs';
import { projectDataDir } from '../../../../framework/cli/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'plan-studio-2';
export const FILE = 'tree.json';

const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

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

/* ------------------------------------------------------------------ the build orchestrator (explicit hand-off) */

const orchFile = (profile) => (process.env.AXF_ORCH_FILE ? process.env.AXF_ORCH_FILE : orchestratorPath(profile || activeProfile().id));
export function profiles() { try { return readProfiles().profiles?.map((p) => ({ id: p.id, label: p.label ?? p.name ?? p.id })) ?? []; } catch { return []; } }
const buildId = (title, taken) => { const base = tc.slug(title).slice(0, 34) || 'plan'; let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`.slice(0, 40); return id; };

/** Send an item to the build orchestrator: its steps become the build's steps; the item gets a `build` link back. */
export function sendToBuild(state, ref, { profile = '', id = '', preview = false, by = '', said = '' } = {}) {
  const it = tc.resolve(state, ref);
  if (!it) throw new tc.TreeError('not_found', `no item "${ref}"`);
  const prof = profile || activeProfile().id;
  const change = tc.toBuild(state, it.id, { said });
  if (!change.steps.length) throw new tc.TreeError('validation', `"${it.title}" has no open steps to build: add steps under it first`);
  const f = orchFile(prof);
  const st = readJson(f, { $axf: 'orchestrator@1', builds: [] });
  st.builds = st.builds ?? [];
  const bid = id || buildId(it.title, new Set(st.builds.map((b) => b.id)));
  const minutes = change.steps.reduce((m, s) => m + (parseInt(s.estimate, 10) || 0), 0);
  if (preview) return { ok: true, preview: true, build: { profile: prof, id: bid }, change, minutes };
  if (st.builds.some((b) => b.id === bid)) throw new tc.TreeError('validation', `"${bid}" is already in the ${prof} orchestrator: pick another build id`);
  const now = new Date().toISOString();
  st.builds.push({
    id: bid, title: change.title, category: '', detail: change.detail, status: 'pending', hidden: false, source: FOLDER, pendingId: '', branch: '', pr: '',
    createdAt: now, updatedAt: now, builtAt: '', notes: [{ text: `Plan Studio 2.0 item: ${it.id} (${tc.pathOf(state, it.id)})`, at: now }], approvals: [],
    ...(said ? { origin: { $axf: 'build-origin@1', said: [{ text: said, at: now, by: by || 'Brett' }] } } : {}),
    steps: change.steps.map((s, i) => ({ id: `s${i + 1}`, text: s.text, model: s.model, why: '', phase: 1, group: '', estimate: s.estimate, files: [], checks: [], session: 'same', agent: false, skip: false, done: false, doneAt: '', note: '' })),
  });
  writeJson(f, st);
  const linked = tc.link(state, it.id, { type: 'build', ref: `${prof}:${bid}`, label: change.title });
  return { ok: true, state: linked.state, build: { profile: prof, id: bid }, steps: change.steps.length, minutes };
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
    // the one Open handler (REST GET/POST /plans/{id}[/open], the `plan`/`open` plugin commands → MCP + `axf plan-studio-2`,
    // `tree.mjs open`, voice "open X"): what opening a plan means, the same answer everywhere; the server relays `action`
    // to the open console (console-commands@1), the console page dispatches it itself.
    case 'open': { const it = tc.resolve(s, r.id); if (!it) throw new tc.TreeError('not_found', `no plan "${r.id}"`); return { ok: true, ...openAnswer(s, it) }; }
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
    case 'delete': { const res = tc.remove(s, r.id, who); return done(res, `Deleted "${res.item.title}" (${res.removed} items). Say undo to bring it back.`); }
    case 'undo': { const res = tc.undo(s, r.trashId ?? ''); return done(res, res.item ? `Brought back "${res.item.title}".` : `Brought ${res.restored} items back.`); }
    case 'link': { const res = tc.link(s, r.id, { type: r.type, ref: r.ref, label: r.label }); return done(res, res.changed ? `Linked "${res.item.title}" to the ${r.type} ${r.label || r.ref}.` : 'That link is already there.'); }
    case 'unlink': { const res = tc.unlink(s, r.id, { type: r.type, ref: r.ref }); return done(res, res.changed ? 'Link removed.' : 'No such link.'); }
    case 'collapse': { const ids = r.all ? null : [tc.resolve(s, r.id)?.id].filter(Boolean); if (!r.all && !ids.length) throw new tc.TreeError('not_found', `no item "${r.id}"`); const res = tc.setCollapsed(s, ids, r.collapsed !== false); return done(res, `${r.collapsed === false ? 'Expanded' : 'Collapsed'} ${r.all ? 'everything' : 'it'}.`); }
    case 'import': { const res = tc.importItems(s, r.data, { parent: r.parent ?? r.in ?? null, by: who }); return done(res, `Imported ${res.imported} items.`); }
    case 'build': { const res = sendToBuild(s, r.id, { profile: r.profile, id: r.buildId, preview: !!r.preview, by: who, said: r.said }); if (res.preview) return res; const st = save(res.state); return { ok: true, rev: st.rev, build: res.build, steps: res.steps, minutes: res.minutes, say: `Sent it to the build orchestrator as ${res.build.id} with ${res.steps} steps.` }; }
    case 'say': {
      const cmd = tc.parseVoice(r.text ?? '');
      if (!cmd) return { ok: false, understood: false, say: "I didn't catch a plan command. Try: new plan Launch, add a step Deploy to Launch, rename it, delete it, undo." };
      if (cmd.op === 'open') { const it = tc.resolve(s, cmd.id); if (!it) throw new tc.TreeError('not_found', `no item "${cmd.id}"`); return { ok: true, understood: true, command: cmd, ...openAnswer(s, it), focus: `plan-studio-2.focus:${it.id}` }; }
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

/** What opening an item means: the item, its deep-link address and link, and the console action that opens it. */
export function openAnswer(s, it) {
  const address = `view:plan-studio-2/plan:${it.id}`;
  return { item: view(s, it), address, link: `?axf-target=view:plan-studio-2/plan:${encodeURIComponent(it.id)}`, action: `plan-studio-2.open:${encodeURIComponent(it.id)}`, say: `Opening "${it.title}".` };
}

/** Ask the running console (AXF_CONSOLE_URL + AXF_TOKEN) to open it on screen; null when no console is configured. */
async function relayOpen(id) {
  const base = process.env.AXF_CONSOLE_URL, token = process.env.AXF_TOKEN;
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/plugins/plan-studio-2/plans/${encodeURIComponent(id)}/open`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    const body = await res.json().catch(() => ({}));
    return res.ok ? body : { ok: false, error: body.detail ?? `console answered ${res.status}` };
  } catch (e) { return { ok: false, error: `console unreachable: ${e.message}` }; }
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
      case 'open': {
        const r = api({ op: 'open', id: a.join(' ') });
        const relayed = flags.local ? null : await relayOpen(r.item.id);
        const res = { ...r, ...(relayed ? { console: relayed } : {}) };
        const where = relayed ? (relayed.ok ? (relayed.delivered === false ? 'no console page is open' : 'opened in the console') : `console: ${relayed.error}`) : 'set AXF_CONSOLE_URL + AXF_TOKEN to open it in the console';
        return out(res, `${r.say} ${r.address}\n${where}\nlink: ${r.link}`);
      }
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
      case 'delete': { const r = api({ op: 'delete', id: a[0] }); return out(r, `${r.say} (trash ${r.trashId})`); }
      case 'undo': { const r = api({ op: 'undo', trashId: a[0] }); return out(r, r.say); }
      case 'trash': { const r = api({ op: 'trash' }); return out(r, r.trash.map((t) => `${t.id}  ${t.at}  ${t.title} (${t.items})`).join('\n') || 'the trash is empty'); }
      case 'link': return out(api({ op: 'link', id: a[0], type: a[1], ref: a[2], label: flags.label }), 'linked');
      case 'unlink': return out(api({ op: 'unlink', id: a[0], type: a[1], ref: a[2] }), 'unlinked');
      case 'collapse': return out(api({ op: 'collapse', id: a[0], all: !!flags.all || !a[0], collapsed: true }), 'collapsed');
      case 'expand': return out(api({ op: 'collapse', id: a[0], all: !!flags.all || !a[0], collapsed: false }), 'expanded');
      case 'export': { const r = api({ op: 'export', id: a[0], format: flags.json ? 'json' : 'md' }); const text = r.format === 'json' ? JSON.stringify(r.data, null, 1) : r.markdown; if (flags.out) { writeFileSync(flags.out, text); return console.log(`wrote ${flags.out}`); } return console.log(text); }
      case 'import': { const data = JSON.parse(readFileSync(a[0] === '-' ? 0 : a[0], 'utf8')); return out(api({ op: 'import', data, parent: flags.in }), 'imported'); }
      case 'build': { const r = api({ op: 'build', id: a[0], profile: flags.profile, buildId: flags.id, preview: !!flags.preview, said: flags.said }); return out(r, r.preview ? `preview: build ${r.build.id} (${r.change.steps.length} steps, ${r.minutes} min)\n${r.change.steps.map((s) => `  - ${s.text} [${s.model}${s.estimate ? `, ${s.estimate}` : ''}]`).join('\n')}` : r.say); }
      case 'say': { const r = api({ op: 'say', text: a.join(' ') }); return out(r, r.say); }
      case 'clear': { if (!flags.yes) throw new tc.TreeError('confirm', 'add --yes to clear everything'); return out(api({ op: 'clear', yes: true }), 'cleared'); }
      case 'api': { const raw = a[0] ?? readFileSync(0, 'utf8'); const r = api(JSON.parse(raw)); return console.log(JSON.stringify(r)); }
      default: console.error('usage: tree.mjs tree|list|show|open|find|add|rename|edit|move|up|down|indent|outdent|duplicate|delete|undo|trash|link|unlink|collapse|expand|export|import|build|say|clear|api|where'); process.exitCode = 2;
    }
  } catch (e) {
    const err = { ok: false, error: e.message, code: e.code ?? 'error' };
    if (json || cmd === 'api') console.log(JSON.stringify(err)); else console.error(e.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
