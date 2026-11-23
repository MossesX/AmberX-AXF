#!/usr/bin/env node
/**
 * Plan Studio 2.0 CLI + store (plan-tree@1). One file holds the whole tree, so every surface (console page, REST,
 * MCP, CLI, AmberX voice) reads and writes the same thing through the same pure core (web/tree-core.mjs):
 *
 *   <store>/tree.json          plan-tree@1 (items nested to any depth + the trash for undo)
 *   <store>/sent-history.json  plan-history@1 (the planning steps a send replaced, per item; live-core.mjs)
 *
 * <store> is the hub's shared data where /projects is mounted (the console container): /projects/amberx-axf/_data/
 * plan-studio-2/, per project (projects@1). Elsewhere it is the plugin's data folder (.axf-console/plugins/plan-studio-2).
 * AXF_PLAN_TREE_DIR overrides (tests). The store starts empty and nothing is synced into it. plans.mjs is plans@1 over
 * this tree (control@1 planner.plans, the orchestrator, the project seed CLI).
 *
 *   node apps/console-web/plugins/plan-studio-2/tree.mjs tree [<item>] [--md]     the tree (indented), or one branch
 *   … list [--kind step] [--under <item>] [--q words]                            flat rows
 *   … show <item>                                                                one item with its path and progress
 *   … find <words> [--kind k] [--under <item>]                                   matches, best first (focus to open each)
 *   … add <kind> "<title>" [--in <item>] [--at n] [--body …] [--model Opus] [--minutes 20] [--priority P1] [--tags a,b]
 *   … rename <item> "<title>" · edit <item> --title … --status … --done true --priority … --model … --minutes … --kind …
 *   … move <item> [--in <item>|--top] [--at n] · up <item> · down <item> · indent <item> · outdent <item>
 *   … duplicate <item> · delete <item> · undo [<trash id>] · trash
 *   … link <item> <todo|build|note|shipped|plan|url> <ref> [--label …] · unlink <item> <type> <ref>
 *   … collapse [<item>|--all] · expand [<item>|--all]
 *   … export [<item>] [--json] [--out file] · import <file.json> [--in <item>]
 *   … validate <item> [--id build-id]                             plan-build@1: the build id it gets and every reason it may not be sent
 *   … build <item> [--profile p] [--id build-id] [--preview]      send to the build orchestrator: must pass plan-build@1; ONE Pipeline 2.0
 *                                                                 build (flow pipeline-2, pending, its steps kept as planning) in the
 *                                                                 builds store; the orchestrator's splitting stage designs the build steps
 *   … history <item>                                              the planning steps a send replaced (kept beside the tree)
 *   … restore-steps <item> [<entry id>]                           bring those planning steps back (not while it is locked)
 *   … sync                                                        bring the tree in line with the builds store now
 *   … refresh-builds                                              read the sent builds from the builds store again (the cache)
 *   … say "<spoken sentence>"                                     one voice command (what AmberX and the page's mic send)
 *   … clear --yes                                                 everything gone (the trash too)
 *   … api '<json {op,…}>'                                         what the server calls (also reads stdin)
 *   … where
 *   --json on any command prints one JSON line.
 *
 * Sent plans (web/live-core.mjs): a sent plan's steps and statuses are read from the builds store on every read, never
 * copied. Once the orchestrator has split the build, the planning steps that were sent leave the tree (kept in
 * sent-history.json) and the orchestrator's steps are listed in their place, marked `origin: orchestrator`, checking off
 * as it moves them. A sent plan is locked until its build lands or is cancelled: every change to it is refused.
 *
 * `<item>` is an id, or the title / words in it ("the step about deploy"): tree-core resolve().
 */
import { spawn } from 'node:child_process';
import { chmodSync, chownSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tc from './web/tree-core.mjs';
import * as live from './web/live-core.mjs';
import * as P2 from '../../../../framework/core/pipeline-status.mjs';
import * as BS from '../../../../framework/cli/builds-store.mjs';
import * as core from '../../../../framework/plan/builds-store-core.mjs';
import * as dataFiles from '../../../../framework/core/data-files.mjs';
import { persistRoot, readProfiles, activeProfile } from '../../../../framework/cli/persist.mjs';
import { projectDataDir } from '../../../../framework/cli/projects.mjs';
import { ownerFrom, sendToEmergency } from '../../../../framework/cli/emergency-builds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'plan-studio-2';
export const FILE = 'tree.json';
export const HISTORY_FILE = 'sent-history.json';

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
export function save(state) { const s = tc.normalize(tc.stored(state)); writeJson(file(), s); handBack(file()); return s; }
const historyFile = () => join(storeDir(), HISTORY_FILE);
/** The planning steps sends replaced (plan-history@1): its own file, so a writer that only knows the tree cannot drop it. */
export function loadHistory() { return live.normHistory(readJson(historyFile(), live.emptyHistory())); }
export function saveHistory(history) { const h = live.normHistory(history); writeJson(historyFile(), h); handBack(historyFile()); return h; }
/* ------------------------------------------------------------------ the sent builds, read from the builds store */

/*
 * Reading the whole builds store costs seconds on a large one, and Plan Studio needs only the few builds that were sent
 * from a plan. They are kept, trimmed to what the page shows, in a small cache file beside the tree:
 *   - fresh for AXF_PLAN_BUILDS_TTL seconds (default 15; 0 = always read the store: tests);
 *   - older than that, it is still served while one background process reads the store again (never two at once);
 *   - the builds store's change event rewrites it at once when one of these builds moves (build-hook.mjs), and a send
 *     or an orchestrator action rewrites it before answering.
 * The cache is derived, never the truth: deleting it only costs the next read.
 */
export const BUILDS_CACHE = 'sent-builds.cache.json';
const STALE_MAX_S = 120;
const REFRESH_LOCK_MS = 90_000;
const cacheFile = () => join(storeDir(), BUILDS_CACHE);
const cacheTtl = () => { const n = Number(process.env.AXF_PLAN_BUILDS_TTL ?? 15); return Number.isFinite(n) && n >= 0 ? n : 15; };
const slimStep = (x) => ({ id: x.id, title: x.title ?? '', text: x.text ?? '', status: x.status ?? '', done: !!x.done, ...(x.skip ? { skip: true } : {}), model: x.model ?? '', estimate: x.estimate ?? '', attempt: x.attempt ?? 1, failedFrom: x.failedFrom ?? '', statusAt: x.statusAt ?? '', ...(x.prNumber ? { prNumber: x.prNumber } : {}), statusLog: (x.statusLog ?? []).slice(0, 1).map((l) => ({ at: l.at })) });
/** One build as Plan Studio needs it (what live-core reads, nothing else). */
const slimBuild = (b) => ({ id: b.id, flow: b.flow, planRef: b.planRef, status: b.status, deleted: !!b.deleted, failedFrom: b.failedFrom ?? '', attempt: b.attempt ?? 1, statusAt: b.statusAt ?? '', createdAt: b.createdAt ?? '', updatedAt: b.updatedAt ?? '', profiles: b.profiles ?? [], ...(b.emergency ? { emergency: true } : {}), ...(b.pipeline?.heldAt ? { pipeline: { heldAt: b.pipeline.heldAt } } : {}), steps: (b.steps ?? []).map(slimStep) });
function readCache() { try { const c = JSON.parse(readFileSync(cacheFile(), 'utf8')); return Array.isArray(c?.builds) && Number.isFinite(Date.parse(c.at)) ? c : null; } catch { return null; } }
function writeCache(builds) {
  try { const f = cacheFile(); mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify({ $axf: 'plan-sent-builds-cache@1', at: new Date().toISOString(), builds })}\n`); renameSync(tmp, f); handBack(f); } catch { /* a cache: the next read pays instead */ } // axf-data: not data (a cache derived from the builds store; deleting it loses nothing)
}
/** Read the sent builds from the builds store now and keep them. → the builds, or null when the store cannot be read. */
export function refreshBuilds() {
  let all;
  try { all = BS.loadStore().builds; } catch { return null; }
  const builds = all.filter((b) => b.flow === P2.FLOW && b.planRef).map(slimBuild);
  writeCache(builds);
  return builds;
}
/** One background read of the builds store at a time (a lock folder; one left by a killed process is taken over). */
function refreshInBackground() {
  const lock = join(storeDir(), '.sent-builds.refresh');
  try { mkdirSync(lock); } catch { try { if (Date.now() - statSync(lock).mtimeMs < REFRESH_LOCK_MS) return; rmSync(lock, { recursive: true, force: true }); mkdirSync(lock); } catch { return; } }
  try { spawn(process.execPath, [fileURLToPath(import.meta.url), 'refresh-builds'], { detached: true, stdio: 'ignore', env: process.env }).unref(); } catch { try { rmSync(lock, { recursive: true, force: true }); } catch { /* next read */ } }
}
/**
 * The builds a sent plan is read from (each trimmed to what the page shows), or null when the builds store cannot be
 * read (then nothing is laid over or synced). `fresh` reads the store now.
 */
export function storeBuilds({ fresh = false } = {}) {
  const ttl = cacheTtl();
  if (!fresh && ttl > 0) {
    const c = readCache();
    const age = c ? (Date.now() - Date.parse(c.at)) / 1000 : Infinity;
    if (age < ttl) return c.builds;
    if (age < STALE_MAX_S) { refreshInBackground(); return c.builds; }
  }
  return refreshBuilds();
}
/** The ids of the sent builds as last read (no store read), or null when nothing was read yet: the change event's filter. */
export function sentBuildIds() { const c = readCache(); return c ? new Set(c.builds.map((b) => b.id)) : null; }
/** Refuse a change to an item a sent build locks (the item itself or one above it). Every write path goes through this. */
export function assertUnlocked(state, id, builds = storeBuilds()) {
  const lock = builds && id ? live.lockOf(state, builds, id) : null;
  if (lock) throw new tc.TreeError('locked', live.lockedWhy(lock));
}
/**
 * Bring the tree in line with the builds store (live-core syncSent): planning steps of a build that has been split move
 * to the plan's history (sent-history.json); a build cancelled before it landed gives them back. Runs on every read and on the builds
 * store's change event (build-hook.mjs). → { changed, replaced, restored, state }
 */
export function sync({ by = 'plan-studio-2', fresh = false, builds = storeBuilds({ fresh }), state = load() } = {}) {
  if (!builds) return { changed: false, replaced: [], restored: [], state };
  const r = live.syncSent(state, builds, loadHistory(), { by });
  if (!r.changed) return { ...r, state };
  // the history first when steps leave the tree (never gone from both), the tree first when they come back
  if (r.replaced.length) saveHistory(r.history);
  const st = save(r.state);
  if (!r.replaced.length) saveHistory(r.history);
  return { ...r, state: st };
}
/** Written as root (a VPS session's CLI): the file goes back to the folder's owner, group-writable, so the console can still write it. */
function handBack(f) {
  if (process.getuid?.() !== 0) return;
  try { const st = statSync(dirname(f)); if (st.uid !== 0) { chownSync(f, st.uid, st.gid); chmodSync(f, 0o664); } } catch { /* best effort */ }
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
  const sent = liveSent(builds, it.id);
  if (sent) errors.push({ path: 'planItem', why: `already sent as ${sent.id} (${P2.labelOf(sent.status, sent.attempt)}): wait for it to land, or cancel it first` });
  const lock = sent ? null : live.lockOf(state, builds, it.id);
  if (lock) errors.push({ path: 'planItem', why: `inside "${lock.item.title}", which is sent as ${lock.build.id} and locked until that build lands or is cancelled` });
  return { item: it, plan, errors };
}

/**
 * Send to orchestrator (pipeline-2@1, framework/spec/PIPELINE-2.md): the plan must pass plan-build@1 (nothing invalid
 * moves on: every reason is listed), gets its build id, and goes into the builds store as ONE Pipeline 2.0 build
 * (`flow: pipeline-2`, status `pending`, no build steps; the plan's steps kept as `planning`). The orchestrator flow
 * takes it from there: splitting (Fable designs the build steps, each with minutes and a model) → split → pulling-main
 * → assigning-models → ready. The item gets a `build` link back.
 *
 * `emergency` (Send to emergency): the same build, tagged emergency once it is in the store, so it skips the line,
 * builds in the emergency slots and lands first. Brett's signed-in console only: who is asking is read from `env`
 * (framework/cli/emergency-builds.mjs ownerFrom) and checked before anything is written, so a refused ask sends nothing.
 */
export function sendToBuild(state, ref, { profile = '', id = '', preview = false, by = '', said = '', emergency = false, env = process.env } = {}) {
  if (emergency && !preview) { const o = ownerFrom(env); if (!o.ok) throw new tc.TreeError('forbidden', o.why); }
  const prof = profile || activeProfile().id;
  const { item: it, plan, errors } = planOf(state, ref, { id, said });
  const change = tc.toBuild(state, it.id, { said });
  if (preview) return { ok: !errors.length, preview: true, build: { profile: prof, id: plan.id }, change, plan, errors, planning: plan.steps.length };
  if (errors.length) throw new tc.TreeError('validation', `"${it.title}" does not pass plan-build@1, so it was not sent: ${errors.map((e) => `${e.path}: ${e.why}`).join('; ')}`);
  const now = new Date().toISOString(); const who = by || 'plan-studio-2';
  BS.withStore((s) => {
    if (core.findBuild(s, plan.id)) throw new tc.TreeError('validation', `"${plan.id}" is already a build: pick another build id`);
    const sent = liveSent(s.builds, it.id);
    if (sent) throw new tc.TreeError('validation', `"${it.title}" is already sent as ${sent.id}: wait for it to land, or cancel it first`);
    const b = P2.transition({
      id: plan.id, title: plan.title, detail: plan.detail, source: FOLDER, planRef: it.id, profiles: [prof], createdAt: now, updatedAt: now, flow: P2.FLOW,
      notes: [{ text: `Plan Studio 2.0 item: ${it.id} (${tc.pathOf(state, it.id)}). Passed plan-build@1; sent as one Pipeline 2.0 build with ${plan.steps.length} planning step${plan.steps.length === 1 ? '' : 's'}. The splitting stage designs its build steps; Plan Studio lists them from this store once they are filed.`, at: now }],
      ...(said ? { origin: { said, at: now, source: 'console', by: by || 'Brett' } } : {}),
      planning: plan.steps,
      steps: [],
    }, 'pending', { at: now, by: who, why: 'Send to orchestrator' }).rec;
    s.builds.push(core.normBuild(b, { now, profile: prof }));
    return s;
  }, { by: who, action: 'plan-studio-2:send', note: `${plan.id}: ${plan.steps.length} planning steps` });
  if (emergency) sendToEmergency(plan.id, { env });
  refreshBuilds(); // the new build locks the plan from the next read on
  const linked = tc.link(state, it.id, { type: 'build', ref: `${prof}:${plan.id}`, label: plan.title });
  return { ok: true, state: linked.state, build: { profile: prof, id: plan.id }, planning: plan.steps.length, plan, emergency: !!emergency };
}

/* ------------------------------------------------------------------ one op → one change (the server, the CLI, voice) */

const view = (s, it) => (it ? { ...it, path: tc.pathOf(s, it.id), depth: tc.depthOf(s, it.id), progress: tc.progress(s, it.id), children: tc.children(s, it.id).length } : null);

/** The whole tree as the page draws it. `s` is the live view; `watch` tells the page a sent plan is still moving. */
export function stateView(s) {
  const sent = s.items.filter((i) => i.live && !i.origin && i.live.split !== undefined);
  return { ok: true, $axf: tc.SCHEMA, rev: s.rev, sent: sent.length, watch: sent.some((i) => i.live.locked), states: live.STATES, stateLabels: live.STATE_LABEL, originLabel: live.ORIGIN_LABEL, orchestratorActions: live.ACTIONS,
    count: s.items.length, roots: tc.roots(s).length, trash: s.trash.map((t) => ({ id: t.id, title: t.title, at: t.at, items: t.items.length })), progress: tc.progress(s, null), store: storeDir(), onHub: onHub(), kinds: tc.KINDS, statuses: tc.STATUSES, priorities: tc.PRIORITIES, models: tc.MODELS, linkTypes: tc.LINK_TYPES, items: s.items };
}

/**
 * Run one operation on the store and save. `r` = { op, … }. Returns { ok, … } with the changed item when there is one.
 * Reads: state · tree · get · find · export · trash. Writes: add · rename · edit · move · nudge · indent · outdent ·
 * duplicate · delete · undo · link · unlink · collapse · import · build · say · clear.
 */
export function api(r, { by = '' } = {}) {
  const who = String(r.by ?? by ?? '');
  const builds = storeBuilds({ fresh: r.fresh === true });
  // the stored tree (writes work on it), brought in line with the builds store first; `v` is what reads show
  const synced = sync({ by: who || 'plan-studio-2', builds });
  const s = synced.state;
  const v = builds ? live.liveView(s, builds) : s;
  /** A change to a sent plan (or to a step the orchestrator filed) is refused: `ref` is the item or the place it goes. */
  const guard = (ref) => {
    if (ref == null || ref === '') return;
    if (live.parseStepRowId(String(ref))) throw new tc.TreeError('locked', 'That step was filed by the orchestrator: it is read from the builds store and is not changed in Plan Studio.');
    const it = tc.resolve(s, ref);
    const lock = it && builds ? live.lockOf(s, builds, it.id) : null;
    if (lock) throw new tc.TreeError('locked', live.lockedWhy(lock));
  };
  const done = (res, msg) => { const st = save(res.state); const it = res.item ? view(st, tc.byId(st, res.item.id) ?? res.item) : null; return { ok: true, rev: st.rev, item: it, say: msg, ...Object.fromEntries(Object.entries(res).filter(([k]) => !['state', 'item'].includes(k))) }; };
  switch (r.op) {
    case 'state': return stateView(v);
    case 'tree': { const root = r.id ? tc.resolve(v, r.id) : null; if (r.id && !root) throw new tc.TreeError('not_found', `no item "${r.id}"`); return { ok: true, rev: v.rev, root: root ? view(v, root) : null, tree: tc.tree(v, root?.id ?? null) }; }
    case 'get': { const it = tc.resolve(v, r.id); if (!it) throw new tc.TreeError('not_found', `no item "${r.id}"`); return { ok: true, item: view(v, it), children: tc.children(v, it.id).map((c) => view(v, c)), ancestors: tc.ancestors(v, it.id).map((a) => ({ id: a.id, title: a.title, kind: a.kind })) }; }
    case 'find': { const under = r.under ? tc.resolve(v, r.under)?.id ?? '' : ''; return { ok: true, hits: tc.find(v, r.q ?? '', { kind: r.kind ?? '', limit: Math.max(1, Math.min(Number(r.limit) || 20, 200)), under }) }; }
    case 'export': { if (r.format === 'json') return { ok: true, format: 'json', data: tc.toJson(s, r.id || null) }; return { ok: true, format: 'md', markdown: tc.toMarkdown(v, r.id || null) }; }
    case 'sync': { const moved = synced.replaced.length + synced.restored.length; return { ok: true, rev: s.rev, changed: synced.changed, replaced: synced.replaced, restored: synced.restored, say: synced.changed ? `Brought ${moved} sent plan${moved === 1 ? '' : 's'} in line with the builds store.` : 'Already in line with the builds store.' }; }
    case 'history': { const it = tc.resolve(s, r.id); if (!it) throw new tc.TreeError('not_found', `no item "${r.id}"`); return { ok: true, item: { id: it.id, title: it.title }, history: live.historyOf(loadHistory(), s, it.id) }; }
    case 'restore-steps': { const it = tc.resolve(s, r.id); if (!it) throw new tc.TreeError('not_found', `no item "${r.id}"`); guard(it.id); const res = live.restoreEntry(s, loadHistory(), it.id, r.entry ?? ''); const out = done({ state: res.state, item: it, restored: res.restored, entry: res.entry }, `Brought ${res.restored} planning step${res.restored === 1 ? '' : 's'} back into "${it.title}".`); saveHistory(res.history); return out; }
    case 'target': {
      // the build (and step) an orchestrator action on this row is about: the server asks the orchestrator, never the page
      const tg = builds ? live.actionTarget(s, builds, r.id) : null;
      if (!tg) throw new tc.TreeError('validation', builds ? 'That is not sent to the orchestrator yet: send it first.' : 'The builds store cannot be read right now.');
      return { ok: true, build: tg.build.id, step: tg.step, item: tg.item ? { id: tg.item.id, title: tg.item.title } : null, live: live.buildLive(tg.build) };
    }
    case 'trash': return { ok: true, trash: s.trash.map((t) => ({ id: t.id, title: t.title, at: t.at, by: t.by, items: t.items.length })) };
    case 'add': { guard(r.parent ?? r.in); const res = tc.add(s, { parent: r.parent ?? r.in ?? null, kind: r.kind, title: r.title, body: r.body, index: r.index, by: who, status: r.status, priority: r.priority, model: r.model, minutes: r.minutes, tags: r.tags }); return done(res, `Added the ${tc.KIND_LABEL[res.item.kind].toLowerCase()} "${res.item.title}"${res.item.parent ? ` inside "${tc.byId(res.state, res.item.parent).title}"` : ''}.`); }
    case 'rename': { guard(r.id); const res = tc.rename(s, r.id, r.title, who); return done(res, `Renamed to "${res.item.title}".`); }
    case 'edit': { if (Object.keys(r.patch ?? {}).some((k) => k !== 'collapsed') || !r.patch) guard(r.id); const res = tc.edit(s, r.id, r.patch ?? r, who); return done(res, res.changed ? `Changed "${res.item.title}".` : 'Nothing changed.'); }
    case 'move': { guard(r.id); guard(r.parent ?? r.in); const res = tc.move(s, r.id, { parent: r.parent ?? r.in ?? null, index: r.index }); return done(res, `Moved "${res.item.title}" ${res.item.parent ? `into "${tc.byId(res.state, res.item.parent).title}"` : 'to the top level'}.`); }
    case 'nudge': { guard(r.id); const res = tc.nudge(s, r.id, Number(r.delta) || 0); return done(res, `Moved "${res.item.title}" ${Number(r.delta) < 0 ? 'up' : 'down'}.`); }
    case 'indent': { guard(r.id); { const it = tc.resolve(s, r.id); const sibs = it ? tc.children(s, it.parent) : []; const at = sibs.findIndex((x) => x.id === it?.id); if (at > 0) guard(sibs[at - 1].id); } const res = tc.indent(s, r.id); return done(res, res.changed === false ? 'It is already first; nothing to indent into.' : `Indented "${res.item.title}".`); }
    case 'outdent': { guard(r.id); const res = tc.outdent(s, r.id); return done(res, res.changed === false ? 'It is already at the top level.' : `Outdented "${res.item.title}".`); }
    case 'duplicate': { if (live.parseStepRowId(String(r.id ?? ''))) guard(r.id); guard(tc.resolve(s, r.id)?.parent); const res = tc.duplicate(s, r.id, who); return done(res, `Duplicated it as "${res.item.title}" (${res.count} items).`); }
    case 'delete': { guard(r.id); const res = tc.remove(s, r.id, who); return done(res, `Deleted "${res.item.title}" (${res.removed} items). Say undo to bring it back.`); }
    case 'undo': { guard((r.trashId ? s.trash.find((t) => t.id === r.trashId) : s.trash[s.trash.length - 1])?.parent); const res = tc.undo(s, r.trashId ?? ''); return done(res, res.item ? `Brought back "${res.item.title}".` : `Brought ${res.restored} items back.`); }
    case 'link': { if (live.parseStepRowId(String(r.id ?? ''))) guard(r.id); const res = tc.link(s, r.id, { type: r.type, ref: r.ref, label: r.label }); return done(res, res.changed ? `Linked "${res.item.title}" to the ${r.type} ${r.label || r.ref}.` : 'That link is already there.'); }
    case 'unlink': { const res = tc.unlink(s, r.id, { type: r.type, ref: r.ref }); return done(res, res.changed ? 'Link removed.' : 'No such link.'); }
    case 'collapse': { const ids = r.all ? null : [tc.resolve(s, r.id)?.id].filter(Boolean); if (!r.all && !ids.length) throw new tc.TreeError('not_found', `no item "${r.id}"`); const res = tc.setCollapsed(s, ids, r.collapsed !== false); return done(res, `${r.collapsed === false ? 'Expanded' : 'Collapsed'} ${r.all ? 'everything' : 'it'}.`); }
    case 'import': { guard(r.parent ?? r.in); const res = tc.importItems(s, r.data, { parent: r.parent ?? r.in ?? null, by: who }); return done(res, `Imported ${res.imported} items.`); }
    case 'validate': { const { plan, errors } = planOf(s, r.id, { id: r.buildId, said: r.said }); return { ok: !errors.length, plan, errors, say: errors.length ? `Not ready to send: ${errors.map((e) => `${e.path} ${e.why}`).join('; ')}.` : `Ready to send as ${plan.id}.` }; }
    case 'build': { const res = sendToBuild(s, r.id, { profile: r.profile, id: r.buildId, preview: !!r.preview, by: who, said: r.said, emergency: r.emergency === true }); if (res.preview) return res; const st = save(res.state); return { ok: true, rev: st.rev, build: res.build, planning: res.planning, emergency: res.emergency, say: res.emergency ? `Sent it as the emergency build ${res.build.id}. It skips the line, builds in the emergency slots and lands first.` : `Sent it to the build orchestrator as ${res.build.id}. Fable splits it into build steps.` }; }
    case 'say': {
      const cmd = tc.parseVoice(r.text ?? '');
      if (!cmd) return { ok: false, understood: false, say: "I didn't catch a plan command. Try: new plan Launch, add a step Deploy to Launch, rename it, delete it, undo." };
      if (cmd.op === 'open') { const it = tc.resolve(v, cmd.id); if (!it) throw new tc.TreeError('not_found', `no item "${cmd.id}"`); return { ok: true, understood: true, command: cmd, item: view(v, it), focus: `plan-studio-2.focus:${it.id}`, say: `Opening "${it.title}".` }; }
      if (cmd.op === 'find') { const hits = tc.find(v, cmd.q, { limit: 5 }); return { ok: true, understood: true, command: cmd, hits, say: hits.length ? `Found ${hits.length}: ${hits.map((h) => h.title).join(', ')}.` : 'Nothing matches.' }; }
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
const liveMark = (r) => (r.live ? `  [${r.origin ? `${live.ORIGIN_LABEL} · ` : r.locked ? 'locked · ' : ''}${r.live.stateLabel}${r.live.label && r.live.label !== r.live.stateLabel ? `: ${r.live.label}` : ''}]` : '');
const indentTree = (rows, depth = 0, out = []) => { for (const r of rows) { const mark = tc.CHECKABLE.has(r.kind) ? (r.done ? '[x] ' : '[ ] ') : ''; out.push(`${'  '.repeat(depth)}${mark}${r.title}  (${r.kind}${r.model ? `, ${r.model}` : ''}${r.minutes ? `, ${r.minutes} min` : ''})${liveMark(r)}  ${r.id}`); indentTree(r.children, depth + 1, out); } return out; };

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
      case 'delete': { const r = api({ op: 'delete', id: a[0] }); return out(r, `${r.say} (trash ${r.trashId})`); }
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
      case 'sync': { const r = api({ op: 'sync', fresh: true }); return out(r, r.say); }
      case 'refresh-builds': { // the background read behind a stale cache (storeBuilds)
        try { const b = refreshBuilds(); return out({ ok: !!b, builds: b?.length ?? 0 }, b ? `${b.length} sent build${b.length === 1 ? '' : 's'} read from the builds store` : 'the builds store cannot be read'); }
        finally { try { rmSync(join(storeDir(), '.sent-builds.refresh'), { recursive: true, force: true }); } catch { /* gone */ } }
      }
      case 'history': { const r = api({ op: 'history', id: a[0] }); return out(r, r.history.map((h) => `${h.id}  ${h.at}  ${h.title}${h.restoredAt ? ' (brought back)' : ''}\n${h.steps.map((x) => `    - ${x.title}`).join('\n')}`).join('\n') || 'no history: nothing was replaced by a send'); }
      case 'restore-steps': { const r = api({ op: 'restore-steps', id: a[0], entry: a[1] }); return out(r, r.say); }
      case 'clear': { if (!flags.yes) throw new tc.TreeError('confirm', 'add --yes to clear everything'); return out(api({ op: 'clear', yes: true }), 'cleared'); }
      case 'api': { const raw = a[0] ?? readFileSync(0, 'utf8'); const r = api(JSON.parse(raw)); return console.log(JSON.stringify(r)); }
      default: console.error('usage: tree.mjs tree|list|show|find|add|rename|edit|move|up|down|indent|outdent|duplicate|delete|undo|trash|link|unlink|collapse|expand|export|import|build|history|restore-steps|sync|say|clear|api|where'); process.exitCode = 2;
    }
  } catch (e) {
    const err = { ok: false, error: e.message, code: e.code ?? 'error' };
    if (json || cmd === 'api') console.log(JSON.stringify(err)); else console.error(e.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
