#!/usr/bin/env node
/**
 * Bugs board CLI (bugs@1): the confirmed bugs list. One file next to the builds store, `_claude/builds/bugs.json`,
 * written under a lock and published to main at once as a status-only commit (builds-live publishSidecar, newer wins
 * per bug), like the builds themselves. The console server, the MCP tools and sessions all go through here.
 *
 *   node apps/console-web/plugins/bugs-board/bugs.mjs list [--status open|all|fixed|wontfix] [--app a] [--profile p]
 *   … add "<title>" [--details d] [--severity low|normal|high|urgent] [--app a] [--area a] [--tags a,b] [--files f,g]
 *         [--said "<Brett's words>"] [--build id] [--by who]
 *   … update <id> [--title t] [--details d] [--severity s] [--app a] [--area a] [--tags …] [--files …] [--status s]
 *   … move <bug> <build|-> [--force]       into a build ('-' = unassigned); posts the handoff in the crew chat
 *   … reorder <bug> [--before <bug>] | reorder --ids a,b,c
 *   … fix <bug> [--pr <n|url>] · wontfix <bug> · remove <bug>
 *   … optimize [--apply] [--all]           proposed moves (zero tokens); --apply does them (one undo step)
 *   … undo                                 reverse the last batch of moves
 *   … settings [key=value…]                autoOptimize maxPerBuild minScore askAi chat tone whenBounced bouncesBeforeAsk
 *   … builds                               builds a bug can go into, with live state (running / queued #n / …)
 *   … sync                                 take main's newer bugs, mark bugs fixed whose build merged
 *   … seed                                 the confirmed bugs of Nov 4 2026 (only those not on the board yet)
 *   … publish                              push this checkout's bugs to main now
 *   … act --json '{"action":…}'            any change from web/bugs-core.mjs apply() (the console server uses this)
 *   --json on any command prints JSON. --by <who> names the actor (default: AXF_AGENT, else "cli").
 *
 * Moving a bug into a build: an addendum on the build's origin (build-origin@1), a "Fix bug <id>" step on the build
 * (orchestrator@1, found by capability), a nudge to its running tmux session, and the handoff in the crew group chat
 * (axf.crew@1's swarm.mjs, found by capability): the receiving agent accepts or bounces (zero tokens, template lines),
 * a bounce goes to the next best build or to Brett. Taking a bug off a build removes its step again.
 *
 * Environment: AXF_BUGS_FILE (a test file; publishing off), AXF_BUGS_LIVE=0 (never publish), AXF_BUGS_SIDE=0 (no side
 * effects on builds, chat or tmux), AXF_CONSOLE_ROOT (default /opt/axf: its copy follows every write here).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as core from './web/bugs-core.mjs';
import { readStoreNow, storeFile } from '../../../../framework/cli/builds-store.mjs';
import { REPO_ROOT, activeProfile } from '../../../../framework/cli/persist.mjs';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
export const BUGS_REL = '_claude/builds/bugs.json';
const env = (k, d = '') => process.env[k] ?? d;
const testFile = () => !!env('AXF_BUGS_FILE') || !!env('AXF_BUILDS_STORE');
export const bugsFile = () => env('AXF_BUGS_FILE') || (env('AXF_BUILDS_STORE') ? storeFile().replace(/\.json$/, '.bugs.json') : join(dirname(storeFile()), 'bugs.json'));
const profileNow = () => { try { return activeProfile()?.id ?? ''; } catch { return ''; } };
const sideOn = () => env('AXF_BUGS_SIDE') === '1' || (env('AXF_BUGS_SIDE') !== '0' && !testFile());
const liveOn = () => env('AXF_BUGS_LIVE') !== '0' && !testFile();

// ------------------------------------------------------------------ file + lock

function lock(f) {
  const d = `${f}.lock`;
  mkdirSync(dirname(f), { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { mkdirSync(d); return () => rmSync(d, { recursive: true, force: true }); } catch {
      try { if (Date.now() - statSync(d).mtimeMs > 30000) rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  throw new Error(`bugs file busy (${d})`);
}
export function readBugs(f = bugsFile()) { try { return core.normFile(JSON.parse(readFileSync(f, 'utf8'))); } catch { return core.emptyFile(); } }
function writeBugs(file, f = bugsFile()) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, core.fileText(file)); renameSync(tmp, f);
}
/** Change the file under its lock; publish to main and mirror to the console's checkout afterwards. */
export function withBugs(fn, { publish = true } = {}) {
  const f = bugsFile(); const unlock = lock(f); let r;
  try { const before = readBugs(f); r = fn(before); if (r?.file) writeBugs(r.file, f); } finally { unlock(); }
  if (r?.file) { toConsole(r.file); if (publish) publishSoon(); }
  return r;
}
function toConsole(file) {
  const root = env('AXF_CONSOLE_ROOT', '/opt/axf');
  if (testFile() || !root || root === 'off') return;
  try {
    if (realpathSync(root) === realpathSync(REPO_ROOT)) return;
    const other = join(root, BUGS_REL);
    if (!existsSync(dirname(other))) return;
    const unlock = lock(other); try { writeBugs(core.mergeFiles(readBugs(other), file), other); } finally { unlock(); }
  } catch { /* the console pulls from main on its next read */ }
}

// ------------------------------------------------------------------ main (builds-live sidecar)

async function live() { return import(pathToFileURL(resolve(REPO_ROOT, 'framework/cli/builds-live.mjs')).href); }
function publishSoon() {
  if (!liveOn()) return;
  try { spawn(process.execPath, [SELF, 'publish', '--quiet'], { cwd: REPO_ROOT, detached: true, stdio: 'ignore', env: process.env }).unref(); } catch { /* next write retries */ }
}
export async function publishNow() {
  if (!liveOn()) return { ok: true, skipped: 'off' };
  const L = await live(); const mine = readBugs();
  const r = L.publishSidecar(BUGS_REL, (mainText) => {
    const main = mainText ? core.normFile(JSON.parse(mainText)) : core.emptyFile();
    const merged = core.mergeFiles(main, mine);
    const t = core.fileText(merged);
    return mainText && core.fileText(main) === t ? mainText : t;
  }, `Bugs board: ${mine.bugs.filter((b) => !b.deleted && core.OPEN.has(b.status)).length} open bug(s) (rev ${mine.rev})`);
  if (r.ok && r.text) adoptMain(r.text);
  return r;
}
function adoptMain(text) {
  const f = bugsFile(); const unlock = lock(f);
  try { const cur = readBugs(f); const next = core.mergeFiles(cur, core.normFile(JSON.parse(text))); if (core.fileText(next) !== core.fileText(cur)) writeBugs(next, f); } finally { unlock(); }
}
/** Pull main's bugs (at most once a minute unless forced) and mark bugs fixed whose build's PR merged. */
export async function syncNow({ force = false } = {}) {
  let pulled = false;
  if (liveOn()) {
    const stamp = `${bugsFile()}.pulled`;
    let age = Infinity; try { age = Date.now() - statSync(stamp).mtimeMs; } catch { /* never */ }
    if (force || age > 60000) {
      try { writeFileSync(stamp, new Date().toISOString()); } catch { /* read-only */ }
      const L = await live(); const m = L.mainFile(BUGS_REL);
      if (m.ok && m.text) { adoptMain(m.text); pulled = true; }
    }
  }
  return { pulled, fixed: reconcile() };
}
/** Bugs on a build whose PR merged (status complete) are fixed, with the PR. */
export function reconcile(builds = buildContext()) {
  const done = new Map(builds.filter((b) => b.status === 'complete' || b.mergedAt).map((b) => [b.id, b]));
  const hits = readBugs().bugs.filter((b) => !b.deleted && core.OPEN.has(b.status) && done.has(b.build));
  if (!hits.length) return [];
  withBugs((f) => { let file = f; for (const b of hits) file = core.apply(file, { action: 'fix', id: b.id, pr: done.get(b.build).pr || '' }, { by: 'bugs-board' }).file; return { file }; });
  return hits.map((b) => b.id);
}

// ------------------------------------------------------------------ builds context

let slotsCache = null;
async function slots() {
  if (slotsCache) return slotsCache;
  try {
    const m = await import(pathToFileURL(resolve(REPO_ROOT, 'framework/cli/agent-slots.mjs')).href);
    const st = m.loadState();
    slotsCache = { running: m.holding(st), queue: m.ordered(st.queue) };
  } catch { slotsCache = { running: [], queue: [] }; }
  return slotsCache;
}
/** The plugin folder that provides a capability and ships `file`, or null (never by folder name). */
export function providerOf(service, file, root = REPO_ROOT) {
  const plugins = join(root, 'apps/console-web/plugins');
  if (!existsSync(plugins)) return null;
  for (const n of readdirSync(plugins).sort()) {
    const d = join(plugins, n);
    try { if (JSON.parse(readFileSync(join(d, 'plugin.json'), 'utf8')).provides?.includes(service) && existsSync(join(d, file))) return join(d, file); } catch { /* not a plugin */ }
  }
  return null;
}
let crewCache = null;
async function crew() {
  if (crewCache) return crewCache;
  // the crew's room lives with the console (its data folder); a session in another checkout posts there too
  const croot = env('AXF_CONSOLE_ROOT', '/opt/axf');
  const f = (!env('AXF_SWARM_DIR') && croot !== 'off' && existsSync(join(croot, 'apps/console-web/plugins')) && providerOf('service:axf.crew@1', 'swarm.mjs', croot)) || providerOf('service:axf.crew@1', 'swarm.mjs');
  try { crewCache = f ? { mod: await import(pathToFileURL(f).href) } : { mod: null }; crewCache.list = crewCache.mod?.crew?.() ?? []; } catch { crewCache = { mod: null, list: [] }; }
  return crewCache;
}

const profilesOf = (b) => (Array.isArray(b.profiles) ? b.profiles : Object.keys(b.profiles ?? {}));
/** Every build that isn't deleted, with what the board needs (live state from agent-slots, agent from the crew). */
export function buildContext(store = readStoreNow(), sl = slotsCache ?? { running: [], queue: [] }, crewList = crewCache?.list ?? []) {
  const runningBy = new Map(sl.running.map((r) => [r.name, r]));
  const queuedAt = new Map(sl.queue.map((q, i) => [q.name, i + 1]));
  return (store.builds ?? []).filter((b) => !b.deleted).map((b) => {
    const steps = (b.steps ?? []).filter((s) => !s.skip);
    const done = steps.filter((s) => s.done).length;
    const slot = runningBy.get(b.id);
    const agentId = (slot?.session?.match(/--([a-z0-9-]+)$/)?.[1]) || slot?.agent || crewList.find((a) => (a.running ?? []).some((r) => r.buildId === b.id || r.build === b.id))?.id || '';
    const agent = crewList.find((a) => a.id === agentId);
    const liveState = slot && b.status !== 'built' && b.status !== 'complete' ? 'running' : queuedAt.has(b.id) ? 'queued' : b.status;
    const left = steps.length - done;
    const last = steps.find((s) => !s.done);
    const finishing = b.status === 'built' || (steps.length > 0 && left === 0) || (liveState === 'running' && left === 1 && /\b(PR|merge|CI|land|report)\b/i.test(last?.text ?? ''));
    const files = [...new Set(steps.flatMap((s) => s.files ?? []))];
    return {
      id: b.id, title: b.title || b.id, status: b.status, live: liveState, hidden: !!b.hidden, profile: profilesOf(b)[0] ?? '', profiles: profilesOf(b), updatedAt: b.updatedAt || '',
      steps: steps.length, done, finishing, files, pr: b.pr || '', branch: b.branch || '', mergedAt: b.mergedAt || '',
      agent: agentId, agentName: agent?.name || (agentId ? agentId : ''), queuePos: queuedAt.get(b.id) ?? 0, session: slot?.session || '',
      text: [b.detail, b.origin?.said, b.origin?.brief?.slice(0, 4000), ...steps.map((s) => `${s.title} ${s.text}`)].filter(Boolean).join('\n'),
    };
  });
}
async function context() { await slots(); await crew(); return buildContext(); }
const agentFinder = (builds) => (id) => {
  const b = builds.find((x) => x.id === id); if (!b?.agent) return null;
  const a = (crewCache?.list ?? []).find((x) => x.id === b.agent);
  return a ? { id: a.id, name: a.name, works: a.works !== false, broke: !!a.pay?.broke, statusLabel: a.statusLabel } : { id: b.agent, name: b.agentName || b.agent, works: true, broke: false };
};

// ------------------------------------------------------------------ side effects of a move

function run(args, opts = {}) { const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000, ...opts }); return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; }
const stepText = (bug) => `Fix bug ${bug.id}: ${bug.title}`;

/** Addendum + step on the new build, step off the old one, nudge the running session. Returns log lines. */
export async function sideEffects(moves, file, builds, by) {
  if (!sideOn() || !moves.length) return [];
  const log = [];
  const orchF = providerOf('service:orchestrator@1', 'orchestrator.mjs');
  const orch = orchF ? await import(pathToFileURL(orchF).href) : null;
  const inProfile = (profile, fn) => { const old = process.env.AXF_BUILD_PROFILE; if (profile) process.env.AXF_BUILD_PROFILE = profile; try { return fn(); } finally { if (old === undefined) delete process.env.AXF_BUILD_PROFILE; else process.env.AXF_BUILD_PROFILE = old; } };
  for (const m of moves) {
    const bug = file.bugs.find((x) => x.id === m.bug); if (!bug) continue;
    const from = builds.find((x) => x.id === m.from); const to = builds.find((x) => x.id === m.to);
    if (from && orch) {
      try {
        const st = readStoreNow().builds.find((x) => x.id === from.id)?.steps?.find((s) => !s.done && (s.text ?? '').startsWith(`Fix bug ${bug.id}:`));
        if (st) { inProfile(from.profile, () => orch.act({ action: 'remove-step', id: from.id, step: st.id }, `bugs-board (${by})`)); log.push(`${from.id}: step ${st.id} removed`); }
      } catch (e) { log.push(`${from.id}: step not removed (${e.message})`); }
    }
    if (!to) continue;
    const text = `Bug ${bug.id} moved into this build from the bugs board (by ${by}): ${bug.title}.${bug.details ? ` ${bug.details}` : ''}${bug.said ? ` Brett said: "${bug.said}"` : ''}`;
    const a = run([resolve(REPO_ROOT, 'framework/cli/build-origin.mjs'), 'addendum', to.id, '--said', text.slice(0, 3000), '--source', 'console', '--by', by]);
    log.push(a.ok ? `${to.id}: addendum added` : `${to.id}: no addendum (${(a.err || a.out).slice(-160)})`);
    if (orch) {
      try {
        const has = readStoreNow().builds.find((x) => x.id === to.id)?.steps?.some((s) => (s.text ?? '').startsWith(`Fix bug ${bug.id}:`));
        if (!has) { inProfile(to.profile, () => orch.act({ action: 'add-step', id: to.id, stepData: { text: stepText(bug), model: 'Opus', estimate: '30m', files: bug.files } }, `bugs-board (${by})`)); log.push(`${to.id}: step added`); }
      } catch (e) { log.push(`${to.id}: step not added (${e.message})`); }
    }
    if (to.session && spawnSync('tmux', ['has-session', '-t', to.session], { encoding: 'utf8' }).status === 0) {
      const msg = `Bugs board: bug ${bug.id} "${bug.title}" was moved into this build (step "${stepText(bug)}" added). ${bug.details ? `Details: ${bug.details.slice(0, 400)} ` : ''}Fix it with this build, then tick the step.`;
      spawnSync('tmux', ['send-keys', '-t', to.session, '-l', msg], { encoding: 'utf8' }); spawnSync('tmux', ['send-keys', '-t', to.session, 'Enter'], { encoding: 'utf8' });
      log.push(`${to.id}: told ${to.session}`);
    }
  }
  return log;
}

/** Post handoff lines in the crew group chat (dropped when the chat is off; never throws). */
export async function postChat(lines) {
  if (!sideOn() || !lines.length) return 0;
  const c = await crew(); if (!c.mod?.say) return 0;
  try { return c.mod.say(lines) ?? 0; } catch { return 0; }
}

// ------------------------------------------------------------------ commands

/**
 * One change with everything it implies. A move (not forced) runs the handoff first: the bug lands where an agent
 * accepted it, or goes back to Unassigned / waits for Brett. Returns { ok, file, log, moved, chat, side }.
 */
export async function change(c, { by = env('AXF_AGENT') || 'cli' } = {}) {
  const builds = await context();
  const at = new Date().toISOString();
  let chat = [];
  let cc = c;
  const file0 = readBugs();
  const settings = file0.settings;
  const agentOf = agentFinder(builds);
  const profile = profileNow();
  const candidatesFor = (bug) => (exclude) => core.rank(bug, builds, core.live(file0), settings, { exclude, profile: bug.profile || profile });
  if (c.action === 'move' && c.build && c.build !== '-') {
    const bug = file0.bugs.find((x) => x.id === c.id && !x.deleted); if (!bug) throw new Error(`no bug ${c.id}`);
    const t = builds.find((x) => x.id === c.build); if (!t) throw new Error(`no build ${c.build}`);
    if (!core.isTarget(t)) throw new Error(`${t.id} is ${t.live}: bugs only go into queued or running builds`);
    const h = core.handoff({ bug, from: bug.build, to: c.build, builds, bugs: core.live(file0), settings, agentOf, candidates: candidatesFor(bug), at, force: c.force === true || by === 'brett' });
    chat = settings.chat ? h.lines : [];
    cc = h.accepted ? { action: 'move', id: c.id, build: h.to } : { action: 'ask-brett', id: c.id, candidates: h.candidates, why: h.why };
    if (!h.accepted && bug.build) { // the bounce chain ran out: back to Unassigned first
      const r1 = withBugs((f) => core.apply(f, { action: 'move', id: c.id, build: '' }, { at, by, builds }));
      await sideEffects(r1.moved, r1.file, builds, by);
    }
  }
  if (c.action === 'move' && c.build === '-') cc = { ...c, build: '' };
  if (c.action === 'new-build') { // a new orchestrator build (active profile) with one step per bug; the bugs move into it
    const picked = (Array.isArray(c.ids) ? c.ids : [c.id]).map((id) => file0.bugs.find((x) => x.id === id && !x.deleted)).filter(Boolean);
    if (!picked.length) throw new Error('new-build needs bug ids');
    const orchF = providerOf('service:orchestrator@1', 'orchestrator.mjs'); if (!orchF) throw new Error('no build orchestrator here');
    const orch = await import(pathToFileURL(orchF).href);
    const title = core.normBug({ title: c.title }).title || (picked.length === 1 ? `Fix: ${picked[0].title}` : `Fix ${picked.length} bugs: ${picked.map((b) => b.title).join('; ')}`).slice(0, 200);
    const taken = new Set(readStoreNow().builds.map((b) => b.id));
    let id = `fix-${core.slug(c.title || picked[0].title).slice(0, 40)}`; for (let n = 2; taken.has(id); n += 1) id = `fix-${core.slug(c.title || picked[0].title).slice(0, 40)}-${n}`;
    const said = picked.map((b) => b.said).filter(Boolean).join('\n\n');
    orch.act({ action: 'add', id, title, category: 'Bugs', detail: `From the bugs board: ${picked.map((b) => `${b.id} (${b.title})`).join(', ')}.`, ...(said ? { said, origin: { source: 'console' } } : {}),
      steps: picked.map((b) => ({ text: stepText(b), model: 'Opus', estimate: '30m', files: b.files })) }, `bugs-board (${by})`);
    const fresh = buildContext(readStoreNow());
    const r = withBugs((f) => core.apply(f, { action: 'apply-moves', moves: picked.map((b) => ({ bug: b.id, to: id })), what: `new build ${id}` }, { at, by, builds: fresh }));
    const side = await sideEffects(r.moved.map((m) => ({ ...m, to: '' })).filter((m) => m.from), r.file, fresh, by); // only the old builds' steps come off
    return { ok: true, ...r, log: [`new build ${id}`, ...r.log], chat: [], side, posted: 0, build: id };
  }
  if (c.action === 'apply-moves' || c.action === 'optimize') { // the optimizer's moves go through the same handoffs
    const plan = c.action === 'optimize' ? core.optimize(file0, builds, { all: c.all === true, profile }).moves : c.moves ?? [];
    const accepted = []; const asks = []; let bugs = core.live(file0);
    for (const m of plan) {
      const bug = bugs.find((x) => x.id === m.bug); if (!bug) continue;
      const h = core.handoff({ bug, from: bug.build, to: m.to, builds, bugs, settings, agentOf, candidates: (ex) => core.rank(bug, builds, bugs, settings, { exclude: ex, profile: bug.profile || profile }), at });
      if (settings.chat) chat.push(...h.lines);
      if (h.accepted) { accepted.push({ bug: bug.id, to: h.to }); bugs = bugs.map((x) => (x.id === bug.id ? { ...x, build: h.to, status: 'in-build' } : x)); } else asks.push({ id: bug.id, candidates: h.candidates, why: h.why });
    }
    cc = { action: 'apply-moves', moves: accepted, what: c.what || `auto-optimize: ${accepted.length} move(s)` };
    if (asks.length) withBugs((f) => { let file = f; for (const a of asks) file = core.apply(file, { action: 'ask-brett', ...a }, { at, by }).file; return { file }; }, { publish: false });
  }
  const r = withBugs((f) => core.apply(f, cc, { at, by, builds }));
  const side = await sideEffects(r.moved, r.file, builds, by);
  const posted = await postChat(chat);
  // auto-optimize: a new bug (or one put back) is homed at once when the switch is on
  if (r.file.settings.autoOptimize && (c.action === 'add' || (c.action === 'move' && !cc.build)) && c.action !== 'optimize') {
    const o = core.optimize(r.file, builds, { profile });
    if (o.moves.length) { const r2 = await change({ action: 'optimize', what: 'auto-optimize (new bug)' }, { by: 'auto-optimize' }); return { ok: true, ...r, log: [...r.log, ...r2.log], moved: [...r.moved, ...r2.moved], chat: [...chat, ...(r2.chat ?? [])], side: [...side, ...(r2.side ?? [])], posted: posted + (r2.posted ?? 0) }; }
  }
  return { ok: true, ...r, chat, side, posted };
}

/** Everything the board shows. */
export async function view({ status = 'open', app = '', profile = '' } = {}) {
  const builds = await context();
  const file = readBugs();
  const used = new Set(file.bugs.map((b) => b.build).filter(Boolean));
  const shown = builds.filter((b) => core.isTarget(b) || used.has(b.id)).map((b) => ({ ...b, text: undefined, chip: core.chip(b), target: core.isTarget(b) && !b.finishing }));
  const open = core.openBugs(file);
  return {
    ok: true, settings: file.settings, rev: file.rev, updatedAt: file.updatedAt, canUndo: file.undo.length > 0, undo: file.undo.at(-1) ?? null,
    bugs: core.sorted(core.live(file)), groups: core.groups(file, builds, { status, app, profile }), builds: shown,
    apps: [...new Set(core.live(file).map((b) => b.app).filter(Boolean))].sort(),
    banner: { open: open.length, unassigned: open.filter((b) => !b.build).length, needsBrett: open.filter((b) => b.needsBrett).length },
  };
}

export const SEED = [
  { id: 'b-build-rows-dead', title: "Build rows don't open and step actions are dead", app: 'console-web', area: 'build-manager', tags: ['build-manager', 'builds'], severity: 'urgent', build: 'hotfix-build-manager', said: 'Build rows don\'t open, step actions dead.' },
  { id: 'b-running-count-stale', title: 'Running count is wrong and statuses go stale', app: 'console-web', area: 'build-manager', tags: ['build-manager', 'status'], severity: 'high', build: 'hotfix-build-manager', said: 'Running count wrong, stale statuses.' },
  { id: 'b-terminal-jumps-front', title: 'Terminal jumps to the front on new sessions; tooltips and tap-to-confirm', app: 'console-web', area: 'console-terminal', tags: ['terminal', 'tap-confirm'], severity: 'high', build: 'terminal-no-focus', said: "I don't want the terminal to come to the front on every session." },
  { id: 'b-molly-console-commands', title: "Console embedded in Molly doesn't receive commands", app: 'molly', area: 'console-commands', tags: ['molly', 'embed', 'commands'], severity: 'high', build: 'land-round-2' },
  { id: 'b-window-size-memory', title: "Windows don't remember their size on reopen", app: 'console-web', area: 'windows', tags: ['windows', 'resize'], severity: 'normal' },
  { id: 'b-terminal-opens-in-wording', title: "Terminal 'Opens in' description wording is wrong ('Where Open a tab opens')", app: 'console-web', area: 'console-terminal', tags: ['terminal', 'settings', 'wording'], severity: 'low' },
  { id: 'b-banners-one-colour', title: 'Banners all turn one colour on some themes', app: 'console-web', area: 'banner tokens', tags: ['banners', 'theme', 'tokens'], severity: 'normal', build: 'app-style-override' },
  { id: 'b-github-rate-limit', title: 'GitHub token rate-limited (shared PAT)', app: 'console-web', area: 'github-app', tags: ['github', 'token'], severity: 'high', details: 'Needs Brett to finish the GitHub App user authorization (Settings → Plugins → GitHub) so calls stop sharing the PAT.' },
];
/** Today's confirmed bugs, linked to their builds as Brett listed them (no handoffs: these are already where they belong). */
export function seed(by = 'brett') {
  const at = new Date().toISOString(); const added = [];
  withBugs((f) => {
    let file = f;
    SEED.forEach((s, i) => {
      if (file.bugs.some((b) => b.id === s.id)) return;
      file = core.apply(file, { action: 'add', bug: { ...s, profile: 'current', reportedBy: 'brett', reportedAt: '2026-11-04T00:00:00Z', order: i } }, { at, by }).file; // builds: [] = linked as listed
      added.push(s.id);
    });
    return { file };
  });
  return added;
}

// ------------------------------------------------------------------ CLI

function opts(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i += 1; } } else o._.push(a);
  }
  return o;
}
const csv = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

export async function main(argv = process.argv.slice(2)) {
  const o = opts(argv); const [cmd = 'list', ...rest] = o._; const json = o.json !== undefined;
  const by = typeof o.by === 'string' ? o.by : env('AXF_AGENT') || 'cli';
  const out = (obj, text) => { if (!o.quiet) console.log(json ? JSON.stringify(obj) : text ?? JSON.stringify(obj, null, 1)); };
  const said = (r) => [...r.log, ...(r.side ?? []), ...(r.chat ?? []).map((l) => `chat ${l.from}: ${l.text}`)].join('\n') || 'nothing changed';
  const slim = (r) => ({ ok: true, log: r.log, moved: r.moved, chat: r.chat, side: r.side, bug: r.bug ?? null, rev: r.file?.rev });
  switch (cmd) {
    case 'list': {
      await syncNow();
      const v = await view({ status: o.status || 'open', app: o.app || '', profile: o.profile || '' });
      return out(v, v.groups.map((g) => `${g.label} (${g.items.length})\n${g.items.map((b) => `  ${b.id.padEnd(30)} ${b.severity.padEnd(7)} ${b.status.padEnd(9)} ${b.title}${b.needsBrett ? '  ← needs Brett' : ''}`).join('\n')}`).join('\n') || 'No bugs.');
    }
    case 'builds': { const b = (await context()).filter((x) => core.isTarget(x)); return out({ ok: true, builds: b.map((x) => ({ ...x, text: undefined, chip: core.chip(x) })) }, b.map((x) => `${x.id.padEnd(30)} ${core.chip(x).text}`).join('\n')); }
    case 'add': {
      if (!rest[0]) throw new Error('add "<title>" needs a title');
      const r = await change({ action: 'add', bug: { title: rest.join(' '), details: o.details, severity: o.severity, app: o.app, area: o.area, tags: csv(o.tags), files: csv(o.files), said: o.said, build: o.build } }, { by });
      return out(slim(r), `${r.bug?.id}\n${said(r)}`);
    }
    case 'update': {
      const patch = {}; for (const k of ['title', 'details', 'severity', 'app', 'area', 'said', 'status']) if (typeof o[k] === 'string') patch[k] = o[k];
      for (const k of ['tags', 'files']) if (typeof o[k] === 'string') patch[k] = csv(o[k]);
      const r = await change({ action: 'update', id: rest[0], patch }, { by }); return out(slim(r), said(r));
    }
    case 'move': { if (!rest[0] || !rest[1]) throw new Error('move <bug> <build|->'); const r = await change({ action: 'move', id: rest[0], build: rest[1], force: o.force === true }, { by }); return out(slim(r), said(r)); }
    case 'reorder': { const r = await change(o.ids ? { action: 'reorder', ids: csv(o.ids) } : { action: 'reorder', id: rest[0], before: typeof o.before === 'string' ? o.before : '' }, { by }); return out(slim(r), said(r)); }
    case 'fix': { const r = await change({ action: 'fix', id: rest[0], pr: typeof o.pr === 'string' ? o.pr : '' }, { by }); return out(slim(r), said(r)); }
    case 'wontfix': { const r = await change({ action: 'update', id: rest[0], patch: { status: 'wontfix' } }, { by }); return out(slim(r), said(r)); }
    case 'remove': { const r = await change({ action: 'remove', id: rest[0] }, { by }); return out(slim(r), said(r)); }
    case 'undo': { const r = await change({ action: 'undo' }, { by }); return out(slim(r), said(r)); }
    case 'optimize': {
      if (o.apply) { const r = await change({ action: 'optimize', all: o.all === true }, { by }); return out(slim(r), said(r)); }
      const p = core.optimize(readBugs(), await context(), { all: o.all === true, profile: profileNow() });
      return out({ ok: true, ...p }, [...p.moves.map((m) => `${m.bug} → ${m.to}  (${m.score}: ${m.why.join('; ')})`), ...(p.unclear.length ? [`no clear match: ${p.unclear.join(', ')}`] : [])].join('\n') || 'Nothing to move.');
    }
    case 'settings': {
      const values = Object.fromEntries(rest.filter((x) => x.includes('=')).map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
      if (Object.keys(values).length) { const r = await change({ action: 'settings', values }, { by }); return out({ ok: true, settings: r.file.settings }, JSON.stringify(r.file.settings, null, 1)); }
      return out({ ok: true, settings: readBugs().settings }, JSON.stringify(readBugs().settings, null, 1));
    }
    case 'sync': { const r = await syncNow({ force: true }); return out({ ok: true, ...r }, `pulled: ${r.pulled} · fixed: ${r.fixed.join(', ') || 'none'}`); }
    case 'seed': { const added = seed(by); return out({ ok: true, added }, added.length ? `seeded ${added.join(', ')}` : 'already seeded'); }
    case 'publish': { const r = await publishNow(); return out(r, r.ok ? `published ${r.sha || '(no change)'}` : `not published: ${r.error}`); }
    case 'act': {
      const c = JSON.parse(typeof o.json === 'string' ? o.json : rest[0]);
      const r = await change(c, { by }); return out(slim(r), said(r));
    }
    case 'validate': { const e = core.validate(readBugs()); return out({ ok: !e.length, errors: e }, e.length ? e.map((x) => `${x.path} ${x.message}`).join('\n') : 'bugs@1 valid'); }
    case 'where': return out({ ok: true, file: bugsFile() }, bugsFile());
    default: throw new Error(`unknown command ${cmd} (list, add, update, move, reorder, fix, wontfix, remove, optimize, undo, settings, builds, sync, seed, publish, act, validate)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`bugs: ${e.message}`);
    process.exitCode = 2;
  });
}
