#!/usr/bin/env node
/**
 * pipeline.mjs — the orchestrator's dispatcher (IO side of pipeline-core.mjs). Runs on the VPS host, where the Claude
 * accounts, tmux and the build worktrees are (cron every minute, deploy/install-console.sh), and answers the console.
 *
 * Brett, Nov 8 2026: everything he asks for is a build in the orchestrator → the orchestrator assigns the id, splits it
 * (Claude, ≤ 30-min steps, Fable only where needed) → Pending → Brett moves it to the Queue → when a slot is free the
 * dispatcher takes the next Queue build and starts a headless session on an account that runs its next phase's model.
 *
 *   node apps/console-web/plugins/build-orchestrator/pipeline.mjs status [--json]    the table (Pending / Queue / Building), accounts, slots, what the next tick would do
 *   … queue <id> [--by who]        Pending → Queue (Brett's move; the console calls it with his name)
 *   … unqueue <id>                 Queue → Pending
 *   … split <id> [--request] [--provider claude|rules]   split a build now (or ask the next tick to)
 *   … intake [--json]              split every build with no steps (and every split the console asked for); auto-queue when the Claude setting says so
 *   … tick [--json]                one dispatcher round: intake, session ends, launches, idle alert, state file
 *   … accounts [--json]            every account as the pipeline sees it (Fable yes / no, parallel, running)
 *   … selfcheck [--request] [--reason r] [--json]   check every account one by one, release stale claims / slots / builds,
 *                                  rebuild the account snapshot, alert AmberX on a fix or an unusable account. Off the host
 *                                  (the console container) or with --request it asks the next tick to run it.
 * The console's container has no ~/.claude-accounts: there the accounts come from accounts-host.json, the snapshot every
 * host tick writes (status.accountsFrom says which, and how old).
 *   … account <name> [--fable on|off|auto] [--parallel n] [--use on|off]   the pipeline's own record of an account
 *   … probe <name>                 ask the account's login whether it can run Fable (one tiny call), recorded for probeDays
 *   … settings [--json] | set k=v…  pipeline settings (pipeline-settings@1; apiOverflow=true|false is the overflow rule)
 *   … request --title T [--detail D | --detail-file F] [--said S] [--priority P0-P3] [--route api|subscription] [--queue] [--by who]
 *                                  file a build with the orchestrator (the id is assigned here) and, with --queue, put it in the
 *                                  Queue. Every former launch path (Build manager Start, Fix with Claude, feature assist) calls this.
 *   … show <id>                    one build as the table shows it (status, steps, pipeline record)
 *   … route <id> api|subscription|auto   the per-build override: run on an API-key account, never on one, or the default
 *
 * One way to start builds (Brett, Nov 9 2026: "It has to be the orchestrator"): the tick is the only caller of the
 * launcher for a build. It issues a one-build dispatch token (framework/cli/dispatch-gate.mjs) and passes it in
 * AXF_DISPATCH_TOKEN; claude-headless.sh refuses a build launch without one.
 * API jobs: a build goes to an API-key account (hulu-api, mossesx-api…) by its per-build override (route api) or the
 * overflow rule (apiOverflow, off by default), only with a key, under its caps (pipeline-core.mjs routeFor()).
 * Watchdog hook: afterTick(fn) registers fn({ state, plan, launched, ended, failed }) to run at the end of every tick
 * (build running-builds-watchdog plugs in here; a hook that throws is logged and never stops the tick).
 * Shipped manifests: the first hook ships every newly landed build's shipped-manifest@1 to Shipped features.
 *
 * Files (AXF_PIPELINE_DIR, else /projects/amberx-axf/_data/pipeline where the hub is mounted, else ~/.axf/pipeline; shared
 * with the console container): settings.json, accounts.json, state.json (what the last tick saw and did), log.jsonl.
 * Environment for tests: AXF_PIPELINE_LAUNCHER (instead of deploy/claude-headless.sh), AXF_PIPELINE_SPLITTER (a command that
 * reads the prompt on stdin and prints Claude's answer), AXF_PIPELINE_WORKTREES (root of build worktrees, default
 * /root/axf-builds), AXF_PIPELINE_WORKTREE_MODE=mkdir (no git), AXF_PIPELINE_CONSOLE=off | <container> (alerts),
 * AXF_PIPELINE_SETTINGS (a JSON patch over settings.json). Exit 0 ok, 2 usage / refused.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './pipeline-core.mjs';
import * as orch from './web/orchestrator-core.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import { addendumBlock, saidBlock, subtitle } from '../../../../framework/core/build-origin.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { MODEL_IDS, modelKey } from '../../../../framework/core/model-policy.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { loadUpgradePolicy, settingsFile as claudeSettingsFile } from '../../../../framework/cli/upgrade-policy.mjs';
import * as slots from '../../../../framework/cli/agent-slots.mjs';
import { issue as issueDispatch } from '../../../../framework/cli/dispatch-gate.mjs';
import { shipLanded } from '../../../../framework/cli/shipped.mjs';
import { normPriority } from '../../../../framework/core/build-priority.mjs';
import { act as orchAct } from './orchestrator.mjs';
import { reap as workersReap, status as workersStatus, route as workerRoute } from '../../../../deploy/claude-workers.mjs';
import { childEnv, paths as loginPaths, release as releaseLogin, snapshot as snapshotLogin } from '../../../../deploy/claude-login.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
export const SCHEMA_STATE = 'pipeline-state@1';
const MAX_SPLITS_PER_TICK = 3;
const LAUNCH_FAILS_PER_HOUR = 3;
const GONE_GRACE_MS = 10 * 60e3;
const CLAUDE_ARGS = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Grep', 'Glob'];
const nowIso = () => new Date().toISOString();
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

// ------------------------------------------------------------------ files

export function pipeDir(env = process.env) {
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(homedir(), '.axf', 'pipeline');
}
const files = () => { const d = pipeDir(); return { dir: d, settings: join(d, 'settings.json'), accounts: join(d, 'accounts.json'), state: join(d, 'state.json'), log: join(d, 'log.jsonl'), host: join(d, 'accounts-host.json'), checkRequest: join(d, 'selfcheck-request.json') }; };

/** The Claude settings document's values (owner-only ones included), {} when unreadable. */
export function claudeSettings(env = process.env) { return readJson(claudeSettingsFile(env))?.values ?? {}; }

/** pipeline-settings@1: the file, the Claude settings that feed it, then AXF_PIPELINE_SETTINGS (tests). */
export function loadSettings(env = process.env) {
  const file = readJson(files().settings, {}) ?? {};
  const cs = claudeSettings(env);
  const fromClaude = {};
  if (file.parallelPerAccount === undefined && Number.isFinite(Number(cs['builds.maxParallel']))) fromClaude.parallelPerAccount = Number(cs['builds.maxParallel']);
  if (typeof cs['builds.launchWithoutAsking'] === 'boolean') fromClaude.autoQueue = cs['builds.launchWithoutAsking'];
  let patch = {}; try { patch = env.AXF_PIPELINE_SETTINGS ? JSON.parse(env.AXF_PIPELINE_SETTINGS) : {}; } catch { patch = {}; }
  return P.normSettings({ ...fromClaude, ...file, ...patch });
}
export function saveSettings(patch) { const f = files(); const next = P.normSettings({ ...(readJson(f.settings, {}) ?? {}), ...patch }); writeJson(f.settings, next); return next; }
export const loadOwnAccounts = () => { const j = readJson(files().accounts, {}); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; };
export function saveOwnAccount(name, patch) {
  if (!BP.accountName(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const all = loadOwnAccounts(); const cur = all[name] && typeof all[name] === 'object' ? all[name] : {};
  const next = { ...cur, ...patch }; for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  all[name] = next; writeJson(files().accounts, all); return next;
}
export const loadState = () => ({ $axf: SCHEMA_STATE, at: '', plan: null, slots: null, accounts: [], idle: null, alerts: [], launchFails: {}, recent: [], ...(readJson(files().state, {}) ?? {}) });
const saveState = (s) => writeJson(files().state, { ...s, $axf: SCHEMA_STATE });
const logLine = (o) => { try { mkdirSync(files().dir, { recursive: true }); appendFileSync(files().log, `${JSON.stringify({ at: nowIso(), ...o })}\n`); } catch { /* the log is a courtesy */ } };

// ------------------------------------------------------------------ reads

const profile = () => activeProfile().id;
const live = (store) => store.builds.filter((b) => !b.deleted);
const rulesOf = (store) => storeCore.projectOrchestrator(store, profile()).rules;

/** Agent slots as agent-slots.mjs status shows them (finished sessions pruned), or a quiet default without a store. */
export function slotsNow() {
  try { const s = slots.loadSettings(); return slots.withState((st) => { const mem = slots.prune(st, s); return slots.summary(st, s, mem); }); }
  catch { return { used: 0, cap: 1, free: 1, running: [], queue: [], unavailable: true }; }
}

/** Does this process see the saved Claude logins? The VPS host does; the console container does not (no ~/.claude-accounts). */
export const seesAccounts = (env = process.env) => { try { return statSync(loginPaths(env).accounts).isDirectory(); } catch { return false; } };

/** The host's claude-workers rows as the last tick on the host wrote them (no credential: names, roles, limits, counts). */
export const SCHEMA_HOST = 'pipeline-host-accounts@1';
export function writeHostAccounts(rows, at = nowIso()) { writeJson(files().host, { $axf: SCHEMA_HOST, at, rows }); }
export function readHostAccounts() { const j = readJson(files().host); return j && Array.isArray(j.rows) ? { at: str(j.at, 40), rows: j.rows } : null; }

/**
 * claude-workers rows and where they came from: { rows, source: host | snapshot | none, at, why }. The console runs in a
 * container that has no ~/.claude-accounts, so there claude-workers sees no account at all ("no Claude account is signed in
 * on the VPS" while the host had several). There the host's last snapshot (written every tick) stands in.
 */
export function workerRows(env = process.env) {
  if (seesAccounts(env)) {
    try { const s = workersStatus(env); return { rows: s.accounts, source: 'host', at: s.at, why: '' }; }
    catch (e) { return { rows: [], source: 'none', at: '', why: `claude-workers failed: ${str(e.message, 200)}` }; }
  }
  const snap = readHostAccounts();
  if (snap) return { rows: snap.rows, source: 'snapshot', at: snap.at, why: '' };
  return { rows: [], source: 'none', at: '', why: 'this process can\'t see the Claude logins and the dispatcher on the host has not written its account snapshot yet' };
}

/** Accounts as the pipeline sees them, with where they came from: { accounts, source, at, why }. */
export function accountsRead(store, settings = loadSettings(), env = process.env) {
  const w = workerRows(env);
  const rows = w.rows.map((r) => ({ ...r }));
  const running = live(store).filter((b) => (b.status === 'running' || b.status === 'waiting') && b.pipeline?.account);
  for (const r of rows) {
    const mine = running.filter((b) => b.pipeline.account === r.name).map((b) => b.pipeline.session || `build:${b.id}`);
    r.running = [...new Set([...(r.running ?? []), ...mine])];
  }
  return { accounts: P.accountViews(rows, loadOwnAccounts(), { settings }), rows: w.rows, source: w.source, at: w.at, why: w.why };
}

/** Accounts as the pipeline sees them: claude-workers rows + what the store says runs on each + the pipeline's own records. */
export function accountsNow(store, settings = loadSettings()) { return accountsRead(store, settings).accounts; }

const row = (b) => {
  const p = orch.progress(b); const nx = orch.nextUp(b);
  return { id: b.id, title: b.title, status: b.status, priority: priorityLabel(effectivePriority(b)), steps: { done: p.done, total: p.total, left: p.total - p.done - p.skipped }, minutesLeft: p.minutesLeft,
    nextModel: BP.nextModel(b), nextStep: nx.step ? `${nx.step.id} ${nx.step.text}`.slice(0, 200) : '', needsApproval: nx.needsApproval, needsSplit: P.needsSplit(b), pipeline: b.pipeline ?? null, said: subtitle(b.origin, 160), branch: b.branch, pr: b.pr, createdAt: b.createdAt, updatedAt: b.updatedAt };
};

/** The whole picture for the console and the CLI. */
export function status() {
  loadUpgradePolicy();
  const store = loadStore(); const settings = loadSettings(); const read = accountsRead(store, settings); const accounts = read.accounts; const sl = slotsNow();
  const builds = live(store);
  const ageMin = read.at ? Math.max(0, Math.round((Date.now() - Date.parse(read.at)) / 60e3)) : null;
  const accountsFrom = { source: read.source, at: read.at, ageMin, why: read.why || (read.source === 'snapshot' && ageMin > 5 ? `the host's account snapshot is ${ageMin} min old: the dispatcher cron may be stopped` : '') };
  const plan = P.plan({ builds, accounts, slots: sl, settings, rules: rulesOf(store) });
  const byTable = { pending: [], queued: [], building: [] };
  for (const b of builds) { const t = BP.tableOf(b); if (t && !b.hidden) byTable[t].push(row(b)); }
  byTable.queued.sort((a, b) => plan.queue.indexOf(a.id) - plan.queue.indexOf(b.id));
  byTable.pending.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  byTable.building.sort((a, b) => str(b.pipeline?.launchedAt).localeCompare(str(a.pipeline?.launchedAt)));
  const st = loadState();
  return { ok: true, $axf: 'pipeline-status@1', at: nowIso(), table: byTable, accounts, accountsFrom, slots: { used: sl.used, cap: sl.cap, free: sl.free, queued: sl.queued ?? 0, unavailable: !!sl.unavailable }, plan, settings,
    state: { at: st.at, idle: st.idle, alerts: st.alerts, recent: st.recent.slice(-20), launchFails: st.launchFails, selfCheck: st.selfCheck ?? null, selfCheckRequested: readJson(files().checkRequest)?.at || '' } };
}

// ------------------------------------------------------------------ store writes

/** One change to a build's pipeline record (and status / note) under the store lock. */
export function setPipeline(id, patch, { status = '', note = '', by = 'pipeline', action = 'pipeline' } = {}) {
  let out = null;
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    const now = nowIso();
    b.pipeline = BP.normPipeline({ ...(b.pipeline ?? {}), ...patch }) ?? undefined;
    if (!b.pipeline) delete b.pipeline;
    if (status) { if (!storeCore.STATUSES.includes(status)) throw new Error(`unknown status ${status}`); b.status = status; b.builtAt = storeCore.FINISHED.includes(status) ? (b.builtAt || now) : ''; }
    if (note) b.notes.push({ text: str(note, 2000), at: now });
    b.updatedAt = now; out = b;
    return s;
  }, { by, action, note: id });
  return out;
}

export function queue(id, { by = process.env.AXF_ACTOR || 'console' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  if (!BP.canQueue(b)) throw Object.assign(new Error(`${b.id} is ${b.status}${b.hidden ? ' (hidden)' : ''}: only a Pending build can be queued`), { code: 2 });
  const now = nowIso();
  const r = setPipeline(b.id, { queuedAt: now, queuedBy: str(by, 80), note: b.steps.length ? '' : 'waiting for the split before it can start' }, { status: 'queued', note: `Queued by ${by}.`, by, action: 'pipeline:queue' });
  logLine({ event: 'queued', build: b.id, by });
  return r;
}
export function unqueue(id, { by = process.env.AXF_ACTOR || 'console' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  if (!BP.canUnqueue(b)) throw Object.assign(new Error(`${b.id} is ${b.status}: only a queued build goes back to Pending`), { code: 2 });
  const r = setPipeline(b.id, { queuedAt: '', queuedBy: '', note: '' }, { status: 'pending', note: `Back to Pending (${by}).`, by, action: 'pipeline:unqueue' });
  logLine({ event: 'unqueued', build: b.id, by });
  return r;
}

// ------------------------------------------------------------------ the split

/** Run the configured splitter on a prompt: { text, provider, error }. */
export function askSplitter(prompt, settings, env = process.env) {
  if (env.AXF_PIPELINE_SPLITTER) {
    const r = spawnSync('bash', ['-c', env.AXF_PIPELINE_SPLITTER], { input: prompt, encoding: 'utf8', timeout: 180e3, env });
    return r.status === 0 ? { text: r.stdout, provider: 'claude', error: '' } : { text: '', provider: 'claude', error: `splitter exit ${r.status}: ${str((r.stderr || r.stdout || '').trim(), 300)}` };
  }
  if (settings.splitProvider !== 'claude') return { text: '', provider: settings.splitProvider, error: `split provider is ${settings.splitProvider}` };
  // a one-shot Claude call on a login copy: a worker account when one is free, else the active one
  const dir = join(tmpdir(), `axf-split-${process.pid}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
  let snap = null;
  try {
    let account = 'active'; try { account = workerRoute() || 'active'; } catch { account = 'active'; }
    try { snap = snapshotLogin({ dir, session: 'split', account }); } catch { snap = null; }
    const e = snap ? childEnv(snap, env) : { ...env };
    e.PATH = `${join(homedir(), '.local', 'bin')}:${e.PATH || ''}`;
    const r = spawnSync('claude', ['-p', '--model', MODEL_IDS.opus, '--output-format', 'json', '--max-turns', '1', '--tools', '', prompt], { encoding: 'utf8', timeout: 240e3, env: e, cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 });
    if (r.error) return { text: '', provider: 'claude', error: `claude not available: ${r.error.message}` };
    if (r.status !== 0) return { text: '', provider: 'claude', error: `claude exit ${r.status}: ${str((r.stderr || r.stdout || '').trim(), 300)}` };
    let text = r.stdout; try { const j = JSON.parse(r.stdout); text = typeof j?.result === 'string' ? j.result : r.stdout; } catch { /* plain text */ }
    return { text, provider: 'claude', error: '' };
  } finally {
    if (snap) { try { releaseLogin({ dir, session: 'split' }); } catch { /* best effort */ } }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  }
}

/** Split one build: Claude first, rules when Claude can't answer; writes the steps and the split record. */
export function splitBuild(id, { provider = '', by = 'orchestrator' } = {}) {
  const store = loadStore(); const settings = loadSettings(); const rules = rulesOf(store);
  const b = storeCore.findBuild(store, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  if (['built', 'complete', 'archived'].includes(b.status)) throw Object.assign(new Error(`${b.id} is ${b.status}: nothing to split`), { code: 2 });
  let steps = []; let used = 'rules'; let note = ''; let error = '';
  if (provider !== 'rules') {
    const a = askSplitter(P.splitPrompt(b, rules), settings);
    if (!a.error) { const p = P.parseSplit(a.text, rules); if (!p.error && p.steps.length) { steps = p.steps; used = 'claude'; } else error = p.error || 'empty answer'; } else error = a.error;
  }
  if (!steps.length) { steps = P.rulesSplit(b, rules); used = 'rules'; note = `Split by rules${error ? ` (Claude: ${str(error, 200)})` : ''}: one step per line of the request, review the steps.`; }
  else note = `Split by Claude into ${steps.length} steps (${steps.filter((s) => s.model === 'Fable').length} Fable).`;
  const done = new Map(b.steps.filter((s) => s.done).map((s) => [s.text.trim().toLowerCase(), s]));
  let out = null;
  withStore((s) => {
    const rec = storeCore.findBuild(s, b.id); const now = nowIso();
    const next = steps.map((st, i) => { const old = done.get(st.text.trim().toLowerCase()); return storeCore.normStep({ ...st, id: `s${i + 1}`, done: !!old, doneAt: old?.doneAt ?? '', uid: old?.uid }, i, { now }); });
    // a done step the new split dropped is kept at the top so nothing done is lost
    const kept = rec.steps.filter((x) => x.done && !next.some((n) => n.uid === x.uid)).map((x, i) => ({ ...x, id: `d${i + 1}` }));
    rec.steps = [...kept, ...next]; rec.steps.forEach((x, i) => { x.id = `s${i + 1}`; });
    if (!rec.rearranged) { rec.defaultSteps = rec.steps.map((x) => ({ ...x })); rec.defaultAt = now; }
    rec.pipeline = BP.normPipeline({ ...(rec.pipeline ?? {}), split: { at: now, by, provider: used, steps: rec.steps.length, note: str(note, 400) }, splitRequested: '', note: used === 'rules' ? 'steps made by rules: review them' : '' });
    rec.notes.push({ text: note, at: now }); rec.updatedAt = now; out = rec;
    return s;
  }, { by, action: 'pipeline:split', note: b.id });
  logLine({ event: 'split', build: b.id, provider: used, steps: out.steps.length, error });
  return { id: b.id, provider: used, steps: out.steps.length, error, note };
}

/** Every build that needs the orchestrator's split gets one (a few per round); auto-queue when the Claude setting says so. */
export function intake({ max = MAX_SPLITS_PER_TICK, alert = () => {} } = {}) {
  loadUpgradePolicy();
  const store = loadStore(); const settings = loadSettings(); const rules = rulesOf(store);
  const out = { split: [], queued: [], skipped: [] };
  if (settings.splitProvider !== 'off' || process.env.AXF_PIPELINE_SPLITTER) {
    // only a build with no steps at all is split by itself: steps someone wrote by hand (even with a missing estimate) are
    // never replaced unless the console asked for a split (splitRequested); the table flags them as "needs split"
    const want = live(store).filter((b) => (b.status === 'pending' || b.status === 'queued') && !b.hidden && (b.pipeline?.splitRequested || !b.steps.length));
    for (const b of want.slice(0, max)) {
      try { const r = splitBuild(b.id); out.split.push(r); alert('split', { id: b.id, title: b.title, steps: r.steps, error: r.provider === 'rules' ? r.note : '', note: r.note }); }
      catch (e) { out.skipped.push({ id: b.id, error: e.message }); }
    }
    for (const b of want.slice(max)) out.skipped.push({ id: b.id, error: 'next round' });
  }
  if (settings.autoQueue) {
    const fresh = loadStore();
    for (const b of live(fresh)) {
      // Launch builds without asking is ON: a split build with every step still open goes to the Queue by itself; one a session
      // handed back to Pending (returned) waits for Brett
      if (b.status !== 'pending' || b.hidden || !b.steps.length || P.needsSplit(b, rules) || b.pipeline?.lastRun?.outcome === 'returned') continue;
      try { queue(b.id, { by: 'auto (Launch builds without asking)' }); out.queued.push(b.id); } catch (e) { out.skipped.push({ id: b.id, error: e.message }); }
    }
  }
  return out;
}

// ------------------------------------------------------------------ launches

const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
function git(cwd, ...a) { return spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 180e3 }); }

/** The build's worktree (made when missing): its own branch claude/<id> from origin/main, node_modules linked from the main checkout. */
export function ensureWorktree(id, env = process.env) {
  const dir = join(worktreesRoot(env), id);
  if (existsSync(dir)) return { dir, made: false };
  if ((env.AXF_PIPELINE_WORKTREE_MODE || 'git') === 'mkdir') { mkdirSync(dir, { recursive: true }); return { dir, made: true }; }
  mkdirSync(worktreesRoot(env), { recursive: true });
  git(REPO_ROOT, 'fetch', '-q', 'origin', 'main');
  const base = git(REPO_ROOT, 'rev-parse', '--verify', '-q', 'origin/main').status === 0 ? 'origin/main' : 'HEAD';
  let r = git(REPO_ROOT, 'worktree', 'add', '-B', `claude/${id}`, dir, base);
  if (r.status !== 0 && /already checked out|already exists/.test(r.stderr)) r = git(REPO_ROOT, 'worktree', 'add', '--detach', dir, base);
  if (r.status !== 0) throw new Error(`worktree for ${id}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  // installed packages come from the main checkout: no install per build
  for (const rel of ['node_modules', 'apps/console-web/node_modules', 'apps/demo/node_modules', 'apps/expenses/node_modules', 'apps/axhub-web/node_modules', 'apps/molly/node_modules']) {
    const src = join(REPO_ROOT, rel); const dst = join(dir, rel);
    if (existsSync(src) && !existsSync(dst)) { try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst); } catch { /* optional */ } }
  }
  return { dir, made: true };
}

/** The brief file: what Brett said first (build-origin@1 blocks), then the orchestrator's phase brief. */
export function briefFor(b, rules, { account, model, kind = '' }) {
  const o = b.origin ?? {};
  const addenda = (o.addenda ?? []).map((a, i) => addendumBlock(i + 1, a));
  return [
    `# Build: ${b.id}`, '',
    saidBlock(o), ...(addenda.length ? ['', ...addenda] : []), '',
    '## What to build', orch.brief(b, rules), '',
    `## Pipeline`,
    `This session was started by the orchestrator's dispatcher on Claude account ${account}${kind === 'api' ? ' (an API key: billed per token, keep it lean)' : ''} for the ${model} phase. Tick every step as you finish it (orchestrator.mjs act step ${b.id} <stepId> done). When this phase's steps are done, stop: the dispatcher starts the next phase on the right account. If you must stop early with steps left, say why in a build note (orchestrator.mjs act note ${b.id} "…"); the build goes back to Pending for Brett.`,
  ].join('\n');
}

/** Start one headless session for a queued build on an account. */
export function launch(b, { account, model, kind = '' }, { rules, env = process.env, launcher = env.AXF_PIPELINE_LAUNCHER || join(REPO_ROOT, 'deploy', 'claude-headless.sh') } = {}) {
  const { dir } = ensureWorktree(b.id, env);
  const briefFile = join(dir, '.axf-brief.md');
  writeFileSync(briefFile, `${briefFor(b, rules, { account, model, kind })}\n`);
  // the one way in: a dispatch token for this build only, spent by the launcher when the session starts
  const token = issueDispatch(b.id, { account, model, env });
  const key = modelKey(model) || 'opus';
  const args = ['--name', b.id, '--account', account, '--brief', '.axf-brief.md', '--log', `${b.id}.log`, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
  const e = { ...env, AXF_DISPATCH_TOKEN: token, AXF_SURFACE: 'pipeline', AXF_MODEL: key, AXF_BUILD_ID: b.id, AXF_CLAUDE_ACCOUNT: account, AXF_PRIORITY: slots.levelFor ? (['P0', 'P1', 'P2', 'P3'].includes(effectivePriority(b)) ? { P0: 'urgent', P1: 'high', P2: 'normal', P3: 'low' }[effectivePriority(b)] : 'normal') : 'normal' };
  const r = spawnSync('bash', [launcher, ...args], { cwd: dir, encoding: 'utf8', timeout: 180e3, env: e });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const session = /started (axf-\S+) in/.exec(text)?.[1] ?? /queued at position \d+ \((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
  const slot = /\((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
  if (r.status !== 0 || (!session && !/queued at position|queued for look approval/.test(text))) throw new Error(`launcher exit ${r.status}: ${str(text.trim().split('\n').filter(Boolean).pop() || 'no output', 300)}`);
  return { dir, session, slot, queuedInSlots: /queued at position/.test(text), lookWait: /queued for look approval/.test(text), out: text.trim().slice(-600) };
}

// ------------------------------------------------------------------ session ends

const headlessDir = (env = process.env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';
function readEvents(env = process.env) {
  let t = ''; try { t = readFileSync(join(headlessDir(env), 'events.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } });
}
function tmuxHas(name) {
  if (process.env.AXF_SLOTS_TMUX === 'off') return null;
  const r = spawnSync('tmux', ['has-session', '-t', `=${name}`], { encoding: 'utf8' });
  return r.error ? null : r.status === 0;
}

/** Running builds whose session ended: { id, outcome, status, exit }. */
export function checkEnds({ alert = () => {}, env = process.env } = {}) {
  const store = loadStore(); const settings = loadSettings();
  const events = readEvents(env);
  const out = [];
  for (const b of live(store)) {
    // a build whose last step was ticked is already built / complete when its session ends: close the run record, keep the status
    const settled = b.status === 'built' || b.status === 'complete';
    if (!b.pipeline?.session || !(b.status === 'running' || b.status === 'waiting' || settled)) continue;
    const since = Date.parse(b.pipeline.launchedAt || 0) - 5000;
    const end = events.filter((e) => e.event === 'session-end' && e.session === b.pipeline.session && Date.parse(e.at || 0) >= since).pop();
    let exit = null;
    if (end) exit = Number.isInteger(end.exit) ? end.exit : Number(end.exit) || 0;
    else {
      // no end event: the session may have died with tmux (a reboot, a kill). After a grace period, gone = a crash.
      const alive = tmuxHas(b.pipeline.session);
      if (alive !== false || Date.now() - Date.parse(b.pipeline.launchedAt || 0) < GONE_GRACE_MS) continue;
      exit = 1;
    }
    const r = P.endOutcome(b, { exit, account: b.pipeline.account, session: b.pipeline.session }, settings);
    if (settled) { r.outcome = 'finished'; r.status = b.status; r.run = { ...r.run, outcome: 'finished' }; r.note = `Session ${b.pipeline.session} on ${b.pipeline.account || '?'} ended (exit ${exit}); the build was already ${b.status}.`; }
    setPipeline(b.id, { lastRun: r.run, session: '', slot: '', note: r.outcome === 'finished' ? '' : r.note }, { status: r.status, note: r.note, action: 'pipeline:end' });
    alert(r.outcome === 'failed' ? 'failed' : 'ended', { id: b.id, title: b.title, outcome: r.outcome, note: r.note, account: b.pipeline.account });
    logLine({ event: 'ended', build: b.id, outcome: r.outcome, exit, account: b.pipeline.account, session: b.pipeline.session });
    out.push({ id: b.id, outcome: r.outcome, status: r.status, exit });
  }
  return out;
}

// ------------------------------------------------------------------ alerts (the console's alerts API, from the host)

export function makeConsole(env = process.env) {
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off') return () => null;
  return (method, path, body) => {
    const cmd = `curl -s -m 20 -X ${method} -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" ${body ? '--data-binary @-' : ''} "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}${path}"`;
    const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', cmd], { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', timeout: 30e3 });
    if (r.error || r.status !== 0) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  };
}

// ------------------------------------------------------------------ self-check and stale reaper

/**
 * Builds the store calls running on an account that hold nothing on the VPS: no session, and their agent slot is neither
 * running nor queued (a launch that never started, a slot that was cleared). After the grace period they go back to the
 * Queue (the dispatcher starts them again) and their account count drops. Builds with a session are checkEnds()'s.
 */
export function reapBuilds({ sl = slotsNow(), now = Date.now() } = {}) {
  if (sl.unavailable) return [];
  const held = new Set([...(sl.running ?? []), ...(sl.queue ?? [])].flatMap((x) => [x.id, x.session].filter(Boolean)));
  const out = [];
  for (const b of live(loadStore())) {
    const p = b.pipeline;
    if (!(b.status === 'running' || b.status === 'waiting') || !p?.account || p.session) continue;
    if ((p.slot && held.has(p.slot)) || now - Date.parse(p.launchedAt || p.dispatchedAt || b.updatedAt || 0) < GONE_GRACE_MS) continue;
    const note = `Self-check: ${b.id} was marked running on ${p.account} with no session${p.slot ? ` and agent slot ${p.slot} gone` : ''}: released and back in the Queue.`;
    setPipeline(b.id, { account: '', slot: '', session: '', note: 'released by the self-check (nothing ran): back in the Queue' }, { status: 'queued', note, action: 'pipeline:reap' });
    logLine({ event: 'reaped', build: b.id, account: p.account, slot: p.slot || '' });
    out.push({ id: b.id, account: p.account, slot: p.slot || '' });
  }
  return out;
}

/** Ask the host for a self-check (the console and voice: the next tick runs it, within a minute). */
export function requestSelfCheck({ by = process.env.AXF_ACTOR || 'console', reason = 'on demand' } = {}) {
  const r = { at: nowIso(), by: str(by, 80), reason: str(reason, 80) };
  writeJson(files().checkRequest, r);
  logLine({ event: 'self-check-requested', ...r });
  return r;
}

/**
 * The orchestrator's self-check (Brett, Nov 9 2026: the dispatcher said no account was signed in while several were).
 * On the host only: reap dead worker claims and expired limits, reap builds that hold nothing, then check every saved
 * account one by one (subscription: signed in, limited, free slots; API key: saved, not rejected, caps, free slots),
 * write the account snapshot the console reads, log it, keep it as state.selfCheck, and alert when it fixed something or
 * an account it can't use turned up. Returns the result.
 */
export function selfCheck({ reason = 'on demand', by = 'pipeline', env = process.env, alert = null } = {}) {
  if (!seesAccounts(env)) {
    const r = requestSelfCheck({ by, reason });
    return { ran: false, requested: r.at, why: 'the Claude logins live on the VPS host: the dispatcher runs the self-check on its next tick (within a minute)' };
  }
  const fixes = [];
  try {
    const r = workersReap(env);
    for (const c of r.claims) fixes.push(`released ${c.account || '?'} slot held by ended session ${c.session}`);
    for (const n of r.limits) fixes.push(`cleared ${n}'s expired limit`);
  } catch (e) { logLine({ event: 'self-check-reap-failed', error: str(e.message, 300) }); }
  for (const b of reapBuilds()) fixes.push(`requeued ${b.id} (marked running on ${b.account}, nothing ran)`);
  const store = loadStore(); const settings = loadSettings();
  const read = accountsRead(store, settings, env);
  if (read.source === 'host') writeHostAccounts(read.rows, read.at || nowIso());
  const findings = read.accounts.map((v) => P.checkAccount(v, read.rows.find((r) => r.name === v.name)));
  const sum = P.checkSummary(findings, fixes);
  const prev = loadState().selfCheck;
  const result = { at: nowIso(), reason: str(reason, 80), by: str(by, 80), ran: true, line: sum.line, fixes, problems: sum.problems, signature: sum.signature, findings, notified: false };
  if (P.checkNotify(result, prev)) {
    try { result.notified = !!(alert ?? ((kind, d) => makeConsole(env)('POST', '/api/alerts', P.alertFor(kind, d))))('selfcheck', { fixes, problems: sum.problems, line: sum.line }); }
    catch (e) { logLine({ event: 'self-check-alert-failed', error: str(e.message, 300) }); }
  }
  // the state file is the tick's too: re-read it so this never undoes what the tick wrote
  saveState({ ...loadState(), selfCheck: result });
  try { rmSync(files().checkRequest, { force: true }); } catch { /* gone */ }
  logLine({ event: 'self-check', reason: result.reason, by: result.by, line: sum.line, fixes, problems: sum.problems, accounts: findings.map((f) => `${f.name}:${f.state}`) });
  return result;
}

// ------------------------------------------------------------------ the tick

export function tick({ env = process.env } = {}) {
  loadUpgradePolicy();
  const consoleApi = makeConsole(env);
  const state = loadState();
  const sent = [];
  const alert = (kind, d) => { const a = P.alertFor(kind, d); consoleApi('POST', '/api/alerts', a); sent.push({ key: a.key, kind, at: nowIso(), title: a.title }); };
  const started = nowIso();
  const inta = intake({ alert });
  const ended = checkEnds({ alert, env });
  const store = loadStore(); const settings = loadSettings(); const rules = rulesOf(store);
  const read = accountsRead(store, settings, env); const accounts = read.accounts; const sl = slotsNow();
  // the console (in its container) can't see the logins: it reads what the host saw here
  if (read.source === 'host') { try { writeHostAccounts(read.rows, read.at || nowIso()); } catch (e) { logLine({ event: 'snapshot-failed', error: str(e.message, 300) }); } }
  const plan = P.plan({ builds: live(store), accounts, slots: sl, settings, rules });
  const launched = []; const failed = [];
  const hourAgo = Date.now() - 3600e3;
  for (const l of plan.launches) {
    const fails = (state.launchFails[l.id] ?? []).filter((t) => Date.parse(t) > hourAgo);
    if (fails.length >= LAUNCH_FAILS_PER_HOUR) { plan.waits.push({ id: l.id, why: `launch failed ${fails.length} times in the last hour: waiting` }); continue; }
    const b = live(store).find((x) => x.id === l.id);
    try {
      const r = launch(b, l, { rules, env });
      const runs = (b.pipeline?.runs ?? 0) + 1;
      setPipeline(b.id, { account: l.account, session: r.session, slot: r.slot, model: l.model, launchedAt: nowIso(), dispatchedAt: nowIso(), runs, note: r.queuedInSlots ? 'in the agent-slots queue (starts when the VPS cap frees)' : r.lookWait ? 'waiting for the predicted look approval in UI Review' : '' },
        { status: 'running', note: `Started run ${runs} on ${l.account}${l.kind === 'api' ? ` (API key, ${l.rule === 'override' ? 'this build is set to API' : 'overflow rule'})` : ''} (${l.model}${l.phase ? `, ${l.phase}` : ''}): ${r.session || 'queued in agent slots'}.`, action: 'pipeline:launch' });
      if (!b.branch) withStore((s) => { const rec = storeCore.findBuild(s, b.id); if (rec && !rec.branch) rec.branch = `claude/${b.id}`; return s; }, { by: 'pipeline', action: 'pipeline:branch', note: b.id });
      alert('launched', { id: b.id, title: b.title, account: l.account, model: l.model, phase: l.phase, session: r.session });
      launched.push({ ...l, session: r.session, dir: r.dir });
      logLine({ event: 'launched', build: b.id, account: l.account, kind: l.kind || 'subscription', rule: l.rule || '', model: l.model, session: r.session });
      delete state.launchFails[l.id];
    } catch (e) {
      state.launchFails[l.id] = [...fails, nowIso()];
      failed.push({ id: l.id, error: e.message });
      setPipeline(l.id, { note: `launch failed: ${str(e.message, 300)}` }, { note: `Launch on ${l.account} failed: ${str(e.message, 500)}`, action: 'pipeline:launch-failed' });
      logLine({ event: 'launch-failed', build: l.id, account: l.account, error: e.message });
    }
  }
  // idle: nothing running while work waits. Recorded at once; the phone hears about it after idleAfterMin, once per idle spell.
  let idle = null;
  if (plan.idle && !launched.length) {
    const since = state.idle?.kind === plan.idle.kind ? state.idle.since : started;
    idle = { ...plan.idle, since };
    const dueAt = Date.parse(since) + settings.idleAfterMin * 60e3;
    const already = state.alerts.find((a) => a.key === 'pipeline:idle');
    if (!already && Date.now() >= dueAt) alert('idle', { kind: plan.idle.kind, reason: plan.idle.reason });
  } else if (state.alerts.some((a) => a.key === 'pipeline:idle')) {
    consoleApi('POST', '/api/alerts/resolve', { keys: ['pipeline:idle'] });
    state.alerts = state.alerts.filter((a) => a.key !== 'pipeline:idle');
  }
  const alerts = [...state.alerts.filter((a) => a.key !== 'pipeline:idle' || idle), ...sent.filter((a) => a.kind === 'idle')].filter((a, i, arr) => arr.findIndex((x) => x.key === a.key) === i);
  const next = { ...state, at: nowIso(), plan: { launches: plan.launches, waits: plan.waits, queue: plan.queue, running: plan.running, pending: plan.pending }, slots: { used: sl.used, cap: sl.cap, free: sl.free }, accounts: accounts.map((a) => ({ name: a.name, fable: a.fable, parallel: a.parallel, running: a.running, usable: a.usable, why: a.why })), idle, alerts,
    recent: [...state.recent, ...launched.map((l) => ({ at: nowIso(), event: 'launched', id: l.id, account: l.account, model: l.model })), ...ended.map((e) => ({ at: nowIso(), event: e.outcome, id: e.id })), ...failed.map((f) => ({ at: nowIso(), event: 'launch-failed', id: f.id, error: f.error }))].slice(-50) };
  saveState(next);
  // self-check: asked for (console load, voice, API), or queued work waits and this tick started nothing
  const asked = readJson(files().checkRequest);
  let check = null;
  if (asked || (plan.queue.length && !launched.length && plan.waits.length)) {
    try { check = selfCheck({ reason: asked ? asked.reason || 'on demand' : 'queued builds wait, nothing launched', by: asked?.by || 'dispatcher', env, alert: (kind, d) => consoleApi('POST', '/api/alerts', P.alertFor(kind, d)) }); }
    catch (e) { logLine({ event: 'self-check-failed', error: str(e.message, 300) }); }
  }
  for (const fn of TICK_HOOKS) {
    try { fn({ state: next, plan, launched, ended, failed, env }); } catch (e) { logLine({ event: 'hook-failed', error: str(e.message, 300) }); }
  }
  return { ok: true, at: next.at, intake: inta, ended, launched, failed, plan, idle, alertsSent: sent, selfCheck: check };
}

/** Run `fn` at the end of every tick (the running-builds watchdog's way in). Returns a function that removes it. */
const TICK_HOOKS = [];
export function afterTick(fn) { if (typeof fn === 'function') TICK_HOOKS.push(fn); return () => { const i = TICK_HOOKS.indexOf(fn); if (i >= 0) TICK_HOOKS.splice(i, 1); }; }

/**
 * shipped-manifest@1 (Brett, Nov 9 2026: "The orchestrator should send a manifest with the information on the shipped
 * feature"): after every tick, builds that landed in the last few days and have no manifest get one, gathered and sent
 * to Shipped features through the builds store (framework/cli/shipped.mjs). A few per tick; AXF_SHIPPED=off = none.
 */
afterTick(({ env }) => {
  const r = shipLanded({ env });
  for (const s of r.shipped ?? []) logLine(s.error ? { event: 'ship-failed', build: s.id, error: str(s.error, 300) } : { event: 'shipped', build: s.id, manifest: s.manifest, rev: s.rev });
});

// ------------------------------------------------------------------ the one way in: request a build, route it

const slugId = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'build';

/**
 * File a build with the orchestrator: it assigns the id (from the title, made unique), the next tick splits it, and with
 * `queue` it goes straight to the Queue. Returns the build. This replaces every direct launch (Build manager Start,
 * Fix with Claude, feature assist): they all end here and the dispatcher starts the build.
 */
export function request({ title, detail = '', said = '', priority = '', route = '', queue: toQueue = false, by = process.env.AXF_ACTOR || 'console', source = '' } = {}) {
  const t = str(title, 300).trim(); if (!t) throw Object.assign(new Error('a build needs a title'), { code: 2 });
  if (route && !BP.ROUTES.includes(route)) throw Object.assign(new Error(`route is api, subscription or auto, not ${route}`), { code: 2 });
  const taken = new Set(loadStore().builds.map((b) => b.id));
  const base = slugId(t); let id = base; let k = 2;
  while (taken.has(id)) id = `${base}-${k++}`;
  orchAct({ action: 'add', id, title: t, detail: str(detail, 8000), ...(said ? { said: str(said, 6000) } : {}), source: str(source || by, 60) }, by);
  const p = normPriority(priority);
  if (p || route) withStore((s) => { const rec = storeCore.findBuild(s, id); if (rec) { if (p) rec.priority = p; if (route) rec.pipeline = BP.normPipeline({ ...(rec.pipeline ?? {}), route }) ?? undefined; rec.updatedAt = nowIso(); } return s; }, { by, action: 'pipeline:request', note: id });
  logLine({ event: 'requested', build: id, by, queue: !!toQueue, route });
  return toQueue ? queue(id, { by }) : storeCore.findBuild(loadStore(), id);
}

/** The per-build override: api (API-key accounts only), subscription (never API), auto ('' = the default rules). */
export function setRoute(id, route, { by = process.env.AXF_ACTOR || 'console' } = {}) {
  const r = route === 'auto' ? '' : route;
  if (!BP.ROUTES.includes(r)) throw Object.assign(new Error('route is api, subscription or auto'), { code: 2 });
  const out = setPipeline(id, { route: r }, { note: `Runs on ${r === 'api' ? 'API-key accounts only (billed per token, under their caps)' : r === 'subscription' ? 'subscription accounts only' : 'the default accounts (subscriptions; API only by the overflow rule)'} (${by}).`, by, action: 'pipeline:route' });
  logLine({ event: 'route', build: id, route: r || 'auto', by });
  return out;
}

// ------------------------------------------------------------------ probe

/** Ask an account's login whether it can run Fable: one tiny call; the answer is recorded on the account for probeDays. */
export function probe(name, env = process.env) {
  if (!BP.accountName(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const dir = join(tmpdir(), `axf-probe-${process.pid}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
  let snap = null; let rec;
  try {
    snap = snapshotLogin({ dir, session: 'probe', account: name });
    const e = childEnv(snap, env); e.PATH = `${join(homedir(), '.local', 'bin')}:${e.PATH || ''}`;
    const r = spawnSync('claude', ['-p', '--model', MODEL_IDS.fable, '--output-format', 'json', '--max-turns', '1', '--tools', '', 'Reply with the single word ok.'], { encoding: 'utf8', timeout: 120e3, env: e, cwd: REPO_ROOT });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const ok = !r.error && r.status === 0 && !/not available|no access|permission|does not exist|invalid model|not found/i.test(out);
    rec = { fable: ok, at: nowIso(), error: ok ? '' : str((r.error?.message || out).trim().split('\n').pop(), 200) };
  } catch (e) { rec = { fable: false, at: nowIso(), error: str(e.message, 200) }; }
  finally { if (snap) { try { releaseLogin({ dir, session: 'probe' }); } catch { /* best effort */ } } try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } }
  saveOwnAccount(name, { probe: rec });
  return rec;
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json' && a !== '--expect-fail');
  const flag = (n, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const has = (n) => args.includes(`--${n}`);
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'status', ...rest] = args;
  const by = flag('by', process.env.AXF_ACTOR || 'cli');
  if (cmd === 'status') {
    const s = status();
    const line = (r) => `  ${r.id.padEnd(40)} ${r.priority.padEnd(7)} ${String(r.steps.done).padStart(2)}/${r.steps.total} · next ${r.nextModel || '—'}${r.pipeline?.account ? ` · ${r.pipeline.account}` : ''}${r.needsSplit ? ' · needs split' : ''}${r.pipeline?.note ? ` · ${r.pipeline.note}` : ''}`;
    return out(s, [
      `Pipeline · ${s.at} · slots ${s.slots.used}/${s.slots.cap} (${s.slots.free} free)${s.slots.unavailable ? ' (no slots store here)' : ''}`,
      `Accounts: ${s.accounts.map((a) => `${a.name}${a.kind === 'api' ? ' [API]' : ''} ${a.fable ? 'Fable' : 'Opus'} ${a.running}/${a.parallel}${a.kind === 'api' ? (a.api?.usable ? '' : ` (${a.api?.why})`) : a.usable ? '' : ` (${a.why})`}`).join(' · ') || 'none'}`,
      `API overflow: ${s.settings.apiOverflow ? 'on' : 'off'}`,
      `Pending (${s.table.pending.length})`, ...s.table.pending.map(line),
      `Queue (${s.table.queued.length})`, ...s.table.queued.map(line),
      `Building (${s.table.building.length})`, ...s.table.building.map(line),
      s.plan.launches.length ? `Next tick starts: ${s.plan.launches.map((l) => `${l.id} on ${l.account} (${l.model})`).join(', ')}` : 'Next tick starts nothing.',
      ...s.plan.waits.map((w) => `  waits: ${w.id}: ${w.why}`),
      s.plan.idle ? `IDLE: ${s.plan.idle.reason}` : '',
    ].filter(Boolean).join('\n'));
  }
  if (cmd === 'queue') { const b = queue(rest[0], { by }); return out({ ok: true, id: b.id, status: b.status, pipeline: b.pipeline }, `${b.id} → Queue (by ${by})`); }
  if (cmd === 'unqueue') { const b = unqueue(rest[0], { by }); return out({ ok: true, id: b.id, status: b.status }, `${b.id} → Pending`); }
  if (cmd === 'split') {
    if (has('request')) { const b = setPipeline(rest[0], { splitRequested: nowIso() }, { note: `Split asked for by ${by}.`, by, action: 'pipeline:split-request' }); return out({ ok: true, id: b.id, requested: b.pipeline.splitRequested }, `${b.id}: split on the next tick`); }
    const r = splitBuild(rest[0], { provider: flag('provider'), by }); return out({ ok: true, ...r }, `${r.id}: ${r.note}`);
  }
  if (cmd === 'request') {
    const df = flag('detail-file'); const detail = df ? readFileSync(df, 'utf8') : flag('detail');
    const b = request({ title: flag('title'), detail, said: flag('said'), priority: flag('priority'), route: flag('route') === 'auto' ? '' : flag('route'), queue: has('queue'), by, source: flag('source') });
    return out({ ok: true, id: b.id, status: b.status, build: { id: b.id, title: b.title, status: b.status } }, `${b.id} filed${b.status === 'queued' ? ' and queued: the dispatcher starts it' : ' in Pending'}`);
  }
  if (cmd === 'show') { const b = storeCore.findBuild(loadStore(), rest[0]); if (!b) throw Object.assign(new Error(`no build "${rest[0]}"`), { code: 2 }); const r = row(b); return out({ ok: true, build: r }, `${r.id} ${r.status} ${r.steps.done}/${r.steps.total}${r.pipeline?.account ? ` on ${r.pipeline.account}` : ''}`); }
  if (cmd === 'route') { const b = setRoute(rest[0], rest[1], { by }); return out({ ok: true, id: b.id, route: b.pipeline?.route || 'auto' }, `${b.id}: route ${b.pipeline?.route || 'auto'}`); }
  if (cmd === 'intake') { const r = intake(); return out({ ok: true, ...r }, [`split: ${r.split.map((x) => `${x.id} (${x.provider}, ${x.steps})`).join(', ') || 'nothing'}`, `queued: ${r.queued.join(', ') || 'nothing'}`, ...r.skipped.map((x) => `skipped ${x.id}: ${x.error}`)].join('\n')); }
  if (cmd === 'tick') {
    const r = tick();
    return out(r, [`tick ${r.at}`, `split ${r.intake.split.length} · ended ${r.ended.map((e) => `${e.id} ${e.outcome}`).join(', ') || 'none'} · launched ${r.launched.map((l) => `${l.id} on ${l.account} (${l.model})`).join(', ') || 'none'}${r.failed.length ? ` · launch failed ${r.failed.map((f) => `${f.id}: ${f.error}`).join('; ')}` : ''}`,
      ...r.plan.waits.map((w) => `  waits: ${w.id}: ${w.why}`), r.idle ? `IDLE since ${r.idle.since}: ${r.idle.reason}` : '', r.selfCheck ? `self-check: ${r.selfCheck.line}` : ''].filter(Boolean).join('\n'));
  }
  if (cmd === 'selfcheck') {
    const reason = flag('reason', 'on demand');
    if (has('request')) { const r = requestSelfCheck({ by, reason }); return out({ ok: true, ran: false, requested: r.at, last: loadState().selfCheck ?? null }, `self-check asked for: the next tick runs it (last: ${loadState().selfCheck?.line || 'none yet'})`); }
    const r = selfCheck({ reason, by });
    if (!r.ran) return out({ ok: true, ...r, last: loadState().selfCheck ?? null }, r.why);
    return out({ ok: true, ...r }, [`self-check ${r.at}: ${r.line}`, ...r.fixes.map((f) => `  fixed: ${f}`), ...r.findings.map((f) => `  ${f.name.padEnd(16)} ${f.kind.padEnd(12)} ${f.state.padEnd(8)} ${f.running}/${f.parallel} · ${f.note}`), r.notified ? '  (AmberX told)' : ''].filter(Boolean).join('\n'));
  }
  if (cmd === 'accounts') { const a = accountsNow(loadStore()); return out({ ok: true, accounts: a }, a.map((x) => `${x.name.padEnd(16)} ${x.role.padEnd(11)} ${x.fable ? 'Fable' : 'Opus '} (${x.fableFrom}) · ${x.running}/${x.parallel}${x.usable ? '' : ` · ${x.why}`}`).join('\n') || 'no accounts'); }
  if (cmd === 'account') {
    const patch = {};
    if (has('fable')) patch.fable = flag('fable') === 'auto' ? undefined : flag('fable') === 'on';
    if (has('parallel')) patch.parallel = Math.max(1, Math.min(12, Number(flag('parallel')) || 1));
    if (has('use')) patch.use = flag('use') !== 'off';
    const r = saveOwnAccount(rest[0], patch); return out({ ok: true, name: rest[0], record: r }, `${rest[0]}: ${JSON.stringify(r)}`);
  }
  if (cmd === 'probe') { const r = probe(rest[0]); return out({ ok: true, name: rest[0], probe: r }, `${rest[0]}: Fable ${r.fable ? 'yes' : 'no'}${r.error ? ` (${r.error})` : ''}`); }
  if (cmd === 'settings') { const s = loadSettings(); return out({ ok: true, settings: s }, Object.entries(s).filter(([k]) => k !== '$axf').map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')); }
  if (cmd === 'set') {
    const patch = {}; for (const a of rest) { const i = a.indexOf('='); if (i < 1) throw Object.assign(new Error('usage: set key=value …'), { code: 2 }); const v = a.slice(i + 1); patch[a.slice(0, i)] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v.includes(',') ? v.split(',') : v; }
    const s = saveSettings(patch); return out({ ok: true, settings: s }, 'saved');
  }
  throw Object.assign(new Error('usage: pipeline.mjs status | queue <id> [--by who] | unqueue <id> | split <id> [--request] [--provider claude|rules] | intake | tick | accounts | account <name> [--fable on|off|auto] [--parallel n] [--use on|off] | probe <name> | selfcheck [--request] [--reason r] | settings | set k=v… | request --title T [--detail D] [--queue] [--route api|subscription] | route <id> api|subscription|auto [--json]'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`pipeline: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  });
}
