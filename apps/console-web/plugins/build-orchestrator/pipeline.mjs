#!/usr/bin/env node
/**
 * pipeline.mjs — the orchestrator's dispatcher (IO side of pipeline-core.mjs). Runs on the VPS host, where the Claude
 * accounts, tmux and the build worktrees are (cron every minute, deploy/install-console.sh), and answers the console.
 *
 * Brett, Nov 8 2026: everything he asks for is a build in the orchestrator → the orchestrator assigns the id, splits it
 * (Claude, ≤ 10-min steps that are checkpoints inside one session, Fable only where needed) → Pending → Brett moves it to the Queue → when a slot is free the
 * dispatcher takes the next Queue build and starts a headless session on an account that runs its next phase's model.
 *
 *   node apps/console-web/plugins/build-orchestrator/pipeline.mjs status [--json]    the table (Pending / Queue / Building), accounts, slots, what the next tick would do
 *   … attempts <id> | escalated | retry <id> [strategy] [--why w] | retry-all   done-means-merged@1: every attempt, what is
 *                                     stuck; Retry by hand (the ladder starts over; a strategy runs at once)
 *   … queue <id> [--by who]        Pending → Queue (Brett's move; the console calls it with his name)
 *   … unqueue <id…>                Queue → Pending
 *   … hold <id…> [--why w] | release <id…>   On hold: stays in the Queue, the dispatcher skips it until released
 *   … archive <id…> | unarchive <id…>        the Archive (finished and retired builds; complete ones show there by themselves)
 *   … delete <id…> [--why w] | restore <id…> soft delete: kept in the store forever, Deleted tab, restorable
 *   … split <id> [--request] [--provider claude|rules]   split a build now (or ask the next tick to)
 *   … fill status [build] | fill run | fill deps <build> <step> <s1,s2|none|sequential> | fill set k=v…
 *                                  fill every slot: slots, ready steps, the next round (dry run); one round now; a step's
 *                                  dependsOn; the fill settings (fillSlots, maxParallelPerBuild, autoQueuePending: owner)
 *   … step-brief <build> <step>    the brief of a step-scoped launch (claude-headless.sh --step)
 *   … intake [--json]              split every build with no steps (and every split the console asked for); auto-queue when the Claude setting says so
 *   … tick [--json]                one dispatcher round: intake, session ends, launches, idle alert, state file
 *   … requeue-stuck [--apply]       Pending builds whose last run ended phase-done with steps left (parked by the old rule):
 *                                  list them (dry run), --apply moves them back to the Queue, journalled
 *   … launch-state <id>            runs, crashes, launch retries (lastLaunchError, retryAt, gaveUp) and the last clash bounce
 *   … launch-crashed [--requeue]   builds that stopped retrying after launch crashes (the systems check item); --requeue all
 *   … requeue-launch <id>          back to the Queue now, launch retries reset (REST POST /pipeline/requeue-launch, MCP and
 *                                  voice pipeline-requeue)
 *   … clash-bounce <id> [--files a,b] [--head sha]   a done build that clashes with main: one merge-main step, back to the
 *                                  Queue (files worked out by git merge-tree when not given; MCP / voice pipeline-clash-bounce)
 *   … dedupe-steps [--apply] [id…] collapse repeated steps (builds-store.mjs dedupe-steps; MCP / voice pipeline-dedupe)
 *   … exit <id> [--session s] [--exit n] [--kind phase-done|crash|stopped] [--phase p]   a session ended (claude-headless.sh
 *                                  calls it): end the run now and, when it is back in the Queue, run one tick in-process so the
 *                                  next phase starts at once. Under the dispatcher's lock (flock AXF_PIPELINE_LOCK, default
 *                                  /run/axf-pipeline.lock, the cron tick's), so nothing launches twice.
 *   … accounts [--json]            every account as the pipeline sees it (Fable yes / no, parallel, running)
 *   … selfcheck [--request] [--reason r] [--json]   check every account one by one, release stale claims / slots / builds,
 *                                  rebuild the account snapshot, alert AmberX on a fix or an unusable account. Off the host
 *                                  (the console container) or with --request it asks the next tick to run it.
 * The console's container has no ~/.claude-accounts: there the accounts come from accounts-host.json, the snapshot every
 * host tick writes (status.accountsFrom says which, and how old).
 *   … account <name> [--fable on|off|auto] [--parallel n] [--use on|off]   the pipeline's own record of an account
 *   … probe <name>                 ask the account's login whether it can run Fable (one tiny call), recorded for probeDays
 *   … health [--request] [--json]  the account health sweep: every account, one tiny headless Fable call each on a private
 *                                  copy of its login: can it sign in, has it credits, does it take Fable. The tick starts it
 *                                  in the background every healthEveryMin (5) minutes; it never touches a running build,
 *                                  never claims a slot and never signs anything out (a renewed token is saved back to the
 *                                  login's stores; a login due to renew is not called, so no build's copy is left on a spent
 *                                  token). The dispatcher reads the answers and never tests an account at launch time.
 *   … tab <pending|queue|active|incomplete|complete|errors|archive|deleted> [--json]   one of the orchestrator's tabs
 *   … settings [--json] | set k=v…  pipeline settings (pipeline-settings@1; apiOverflow=true|false is the overflow rule)
 *   … request --title T [--detail D | --detail-file F] [--said S] [--priority P0-P3] [--route api|subscription] [--queue] [--by who]
 *                                  file a build with the orchestrator (the id is assigned here) and, with --queue, put it in the
 *                                  Queue. Every former launch path (Build manager Start, Fix with Claude, feature assist) calls this.
 *   … show <id>                    one build as the table shows it (status, steps, pipeline record)
 *   … aliases [--apply] [--all]    builds whose id is not a valid build name (made before build-id@1) and the short alias each
 *                                  gets; --apply saves them (the tick does this for builds that may still run or land; --all
 *                                  takes in finished, archived and deleted ones). Every command takes the alias for the id.
 *   … land-alias <id|alias|folder> the landing path for such a build: <worktrees>/<alias> → its folder and local branch
 *                                  claude/<alias> at its branch, so vps.build_land takes the alias. Branch and PR stay as they are.
 *   … route <id> api|subscription|auto   the per-build override: run on an API-key account, never on one, or the default
 *
 * Pipeline 2.0 (pipeline-2@1, Nov 19 2026, framework/spec/PIPELINE-2.md): builds with `flow: pipeline-2` (sent from Plan
 * Studio) never take this path: every tick runs pipeline2.mjs advance() (split, one active build, main into each step's
 * worktree, models, steps to free slots, retries as attempt N + 1), and `exit … --step s` ends one step. While a Pipeline 2.0
 * build is active, nothing here launches. Launch failures are never benched (the old 3-per-hour wait is gone).
 * One way to start builds (Brett, Nov 9 2026: "It has to be the orchestrator"): the tick is the only caller of the
 * launcher for a build. It issues a one-build dispatch token (framework/cli/dispatch-gate.mjs) and passes it in
 * AXF_DISPATCH_TOKEN; claude-headless.sh refuses a build launch without one.
 * API jobs: a build goes to an API-key account (hulu-api, mossesx-api…) by its per-build override (route api) or the
 * overflow rule (apiOverflow, off by default), only with a key, under its caps (pipeline-core.mjs routeFor()).
 * Watchdog hook: afterTick(fn) registers fn({ state, plan, launched, ended, failed }) to run at the end of every tick
 * (build running-builds-watchdog plugs in here; a hook that throws is logged and never stops the tick).
 * Shipped manifests: the first hook ships every newly landed build's shipped-manifest@1 to Shipped features.
 * Group chat (crew-sections@1, framework/cli/crew-say.mjs): each section's key events are posted as the employee who owns
 * it: orchestrator (splits, auto-queue), dispatcher (launches, session ends, launch failures, idle), watchdog (self-check),
 * shipped (manifests). Dropped while the chat is off; AXF_CREW_SAY=off for tests.
 *
 * Files (AXF_PIPELINE_DIR, else /projects/amberx-axf/_data/pipeline where the hub is mounted, else ~/.axf/pipeline; shared
 * with the console container): settings.json, accounts.json, state.json (what the last tick saw and did), log.jsonl.
 * Environment for tests: AXF_PIPELINE_LAUNCHER (instead of deploy/claude-headless.sh), AXF_PIPELINE_SPLITTER (a command that
 * reads the prompt on stdin and prints Claude's answer), AXF_PIPELINE_WORKTREES (root of build worktrees, default
 * /root/axf-builds), AXF_PIPELINE_WORKTREE_MODE=mkdir (no git), AXF_PIPELINE_REPO (the repo step worktrees hang off), AXF_PIPELINE_CONSOLE=off | <container> (alerts),
 * AXF_PIPELINE_SETTINGS (a JSON patch over settings.json). Exit 0 ok, 2 usage / refused.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './pipeline-core.mjs';
import * as P2F from './pipeline2.mjs';
import * as P2 from '../../../../framework/core/pipeline-status.mjs';
import * as orch from './web/orchestrator-core.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import * as BR from '../../../../framework/core/build-rules.mjs';
import * as RL from '../../../../framework/core/retry-ladder.mjs';
import * as V from './verify.mjs';
import { addendumBlock, saidBlock, subtitle } from '../../../../framework/core/build-origin.mjs';
import { isBuildId, namesOf, planAliases, uniqueBuildId } from '../../../../framework/core/build-id.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { MODEL_IDS, modelKey } from '../../../../framework/core/model-policy.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, migrateStepDepsNow, withStore } from '../../../../framework/cli/builds-store.mjs';
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { activeProject, readProjects } from '../../../../framework/cli/projects.mjs';
import { loadUpgradePolicy, settingsFile as claudeSettingsFile } from '../../../../framework/cli/upgrade-policy.mjs';
import * as slots from '../../../../framework/cli/agent-slots.mjs';
import { issue as issueDispatch } from '../../../../framework/cli/dispatch-gate.mjs';
import * as lock from '../../../../framework/cli/build-lock.mjs';
import * as modelTriage from '../../../../framework/cli/model-triage.mjs';
import { shipLanded } from '../../../../framework/cli/shipped.mjs';
import { crewSay } from '../../../../framework/cli/crew-say.mjs';
import { reapFirstSync } from '../../../../framework/cli/reaper.mjs';
import { normPriority } from '../../../../framework/core/build-priority.mjs';
import { act as orchAct } from './orchestrator.mjs';
import { editConfig as editWorkersConfig, paths as workerPaths, reap as workersReap, status as workersStatus, route as workerRoute } from '../../../../deploy/claude-workers.mjs';
import { childEnv, paths as loginPaths, release as releaseLogin, snapshot as snapshotLogin } from '../../../../deploy/claude-login.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
export const SCHEMA_STATE = 'pipeline-state@1';
const MAX_SPLITS_PER_TICK = 3;
/** Launch failures are counted for the alert only: there is no bench (pipeline-2@1, Nov 19 2026: a build benched after 3 failed launches in an hour sat there silently). */
const LAUNCH_FAILS_SHOWN = 3;
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
const files = () => { const d = pipeDir(); return { dir: d, settings: join(d, 'settings.json'), accounts: join(d, 'accounts.json'), state: join(d, 'state.json'), log: join(d, 'log.jsonl'), host: join(d, 'accounts-host.json'), checkRequest: join(d, 'selfcheck-request.json'), health: join(d, 'health.json'), healthLock: join(d, 'health.lock'), healthRequest: join(d, 'health-request.json'), authWaits: join(d, 'auth-waits.json'), fillRequest: join(d, 'fill-request.json') }; };

/** The Claude settings document's values (owner-only ones included), {} when unreadable. */
export function claudeSettings(env = process.env) { return readJson(claudeSettingsFile(env))?.values ?? {}; }

const mtimeMs = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
/** claude-workers@1 as saved (null when there is no config file): tells a saved cap from the built-in default. */
const workersRaw = (env = process.env) => { const j = readJson(workerPaths(env).config); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; };
/** The saved "sessions per account" (claude-workers limits.building), or null when none was ever saved. */
export function sessionsPerAccount(env = process.env) { const n = Number(workersRaw(env)?.limits?.building); return Number.isInteger(n) && n > 0 ? n : null; }

/**
 * pipeline-settings@1: the file, then AXF_PIPELINE_SETTINGS (tests). Three of its fields have their one stored key
 * elsewhere (P.ALIAS_KEYS) and are resolved here on every load:
 *   parallelPerAccount  claude-workers limits.building  > the file's old key > the Claude setting builds.maxParallel (older still)
 *   autoQueue           the Claude setting builds.launchWithoutAsking > the file's old key
 *   briefMaxBytes       the Claude setting builds.briefMaxBytes       > the file's old key
 * The old keys are read aliases: honoured while a store still carries them, never written again (saveSettings).
 */
export function loadSettings(env = process.env) {
  const file = readJson(files().settings, {}) ?? {};
  const cs = claudeSettings(env);
  const one = {};
  const spa = sessionsPerAccount(env);
  if (spa != null) one.parallelPerAccount = spa;
  else if (file.parallelPerAccount === undefined && Number.isFinite(Number(cs['builds.maxParallel']))) one.parallelPerAccount = Number(cs['builds.maxParallel']);
  if (typeof cs['builds.launchWithoutAsking'] === 'boolean') one.autoQueue = cs['builds.launchWithoutAsking'];
  if (Number.isFinite(Number(cs['builds.briefMaxBytes'])) && cs['builds.briefMaxBytes'] !== '' && cs['builds.briefMaxBytes'] != null) one.briefMaxBytes = Number(cs['builds.briefMaxBytes']);
  let patch = {}; try { patch = env.AXF_PIPELINE_SETTINGS ? JSON.parse(env.AXF_PIPELINE_SETTINGS) : {}; } catch { patch = {}; }
  return P.normSettings({ ...file, ...one, ...patch });
}
/**
 * Save the pipeline's own keys. A key whose one source is elsewhere is never stored here: `parallelPerAccount` is saved
 * as claude-workers limits.building (the one key), `autoQueue` and `briefMaxBytes` are refused with where to set them.
 */
export function saveSettings(patch, env = process.env) {
  const f = files(); const own = { ...(patch ?? {}) };
  if (own.parallelPerAccount !== undefined) {
    const n = Math.max(1, Math.min(20, Math.round(Number(own.parallelPerAccount)) || 1));
    editWorkersConfig((c) => { c.limits.building = n; }, env);
    delete own.parallelPerAccount;
  }
  for (const k of ['autoQueue', 'briefMaxBytes']) if (own[k] !== undefined) throw Object.assign(new Error(`${k} is not stored in the pipeline settings: set the ${P.ALIAS_KEYS[k]}`), { code: 2 });
  const cur = readJson(f.settings, {}) ?? {};
  const next = P.normSettings({ ...cur, ...own });
  // old keys still in the file stay until migrateSettings() has moved them (they are read aliases); nothing adds them
  for (const k of Object.keys(P.ALIAS_KEYS)) { if (cur[k] === undefined) delete next[k]; else next[k] = cur[k]; }
  writeJson(f.settings, next);
  return loadSettings(env);
}

/**
 * One-time move of the pipeline's copies to their one stored key (runs by itself on the host's tick while a store still
 * carries an old key; each decision is one `settings-migrated` line in the pipeline's log, <pipeline dir>/log.jsonl):
 *   - sessions per account: the pipeline's `parallelPerAccount` and each account's own `parallel` against claude-workers
 *     `limits.building` / `perAccount.<name>.building`. Where they disagree the file saved last is kept; a value that
 *     only the pipeline has is moved over.
 *   - `autoQueue` / `briefMaxBytes`: dropped from the file when the Claude setting is set or the copy is the default
 *     (a copy that says something else stays as a read alias until the Claude setting is set).
 * Returns the log lines written.
 */
export function migrateSettings(env = process.env) {
  const f = files(); const file = readJson(f.settings, null); const lines = [];
  const log = (line) => { lines.push(line); logLine({ event: 'settings-migrated', ...line }); };
  const own = loadOwnAccounts();
  const ownPar = Object.entries(own).filter(([, v]) => v && Number.isInteger(v.parallel) && v.parallel > 0);
  const hasPar = file && file.parallelPerAccount !== undefined;
  const iso = (ms) => (ms ? new Date(ms).toISOString() : '');
  if (hasPar || ownPar.length) {
    const raw = workersRaw(env); const wFile = workerPaths(env).config;
    const p = hasPar ? P.normSettings({ parallelPerAccount: file.parallelPerAccount }).parallelPerAccount : null;
    const pipeAt = Math.max(hasPar ? mtimeMs(f.settings) : 0, ownPar.length ? mtimeMs(f.accounts) : 0); const workAt = mtimeMs(wFile);
    const saved = raw?.limits?.building !== undefined;
    const pipelineWins = !saved || pipeAt > workAt;
    const changes = [];
    if (pipelineWins) {
      editWorkersConfig((c) => {
        if (p != null && (!saved || c.limits.building !== p)) { changes.push({ key: 'limits.building', from: saved ? c.limits.building : null, to: p }); c.limits.building = p; }
        const names = new Set([...ownPar.map(([n]) => n), ...Object.keys(c.perAccount).filter((n) => c.perAccount[n].building !== undefined && c.perAccount[n].building > 0)]);
        for (const n of names) {
          const want = (Number.isInteger(own[n]?.parallel) && own[n].parallel > 0 ? own[n].parallel : null) ?? p; // what the dispatcher used for this account
          const have = c.perAccount[n]?.building;
          if (want == null || have === want || (have === undefined && want === c.limits.building)) continue;
          changes.push({ key: `perAccount.${n}.building`, from: have ?? null, to: want });
          c.perAccount[n] = { ...(c.perAccount[n] ?? {}), building: want };
        }
      }, env);
    }
    log({ group: 'builds.sessionsPerAccount', kept: pipelineWins ? 'pipeline (saved last)' : 'claude-workers (saved last)', savedAt: { pipeline: iso(pipeAt), workers: iso(workAt) },
      dropped: { parallelPerAccount: p, own: Object.fromEntries(ownPar.map(([n, v]) => [n, v.parallel])) }, changes, disagreed: changes.some((c) => c.from != null) });
    for (const [n] of ownPar) saveOwnAccount(n, { parallel: undefined });
  }
  if (file) {
    const cs = claudeSettings(env); const next = { ...file }; let changed = false;
    if (hasPar) { delete next.parallelPerAccount; changed = true; }
    for (const [k, csKey, dflt] of [['autoQueue', 'builds.launchWithoutAsking', P.DEFAULTS.autoQueue], ['briefMaxBytes', 'builds.briefMaxBytes', P.DEFAULTS.briefMaxBytes]]) {
      if (file[k] === undefined) continue;
      const set = cs[csKey] !== undefined && cs[csKey] !== null && cs[csKey] !== '';
      if (!set && file[k] !== dflt) continue; // the only place that value is: stays readable until the Claude setting is set
      log({ group: csKey, kept: { key: `Claude setting ${csKey}`, value: set ? cs[csKey] : dflt }, dropped: { key: `pipeline settings ${k}`, value: file[k] }, disagreed: set && cs[csKey] !== file[k] });
      delete next[k]; changed = true;
    }
    if (changed) writeJson(f.settings, next);
  }
  return lines;
}
/** On the host (the side that sees the logins): move settings still kept as copies to their one key, before anything reads them. */
function migrateOnHost(env = process.env) {
  if (!seesAccounts(env)) return;
  try { migrateSettings(env); } catch (e) { logLine({ event: 'settings-migration-failed', error: str(e.message, 300) }); }
}
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
/** The builds@1 dispatcher's builds: Pipeline 2.0 builds (flow pipeline-2) run on pipeline2.mjs, never on this path. */
const legacyLive = (store) => live(store).filter((b) => b.flow !== P2.FLOW);
/** Is the builds@1 dispatcher at work: a builds@1 build queued, building or being fixed? Pending ones alone are nobody's work yet. */
export const legacyActive = (store) => legacyLive(store).some((b) => !b.hidden && ['queued', 'running', 'waiting', 'fixing'].includes(b.status));
/**
 * Projects (projects@1): the tables and tabs show the active project's builds; the dispatcher runs the Queue of every
 * project that is not archived (switching projects never stops a build that is running or queued elsewhere).
 */
const inProfile = (b, p) => (b.profiles ?? []).includes(p);
export function projectScope() {
  const reg = readProjects();
  const archived = new Set(reg.projects.filter((p) => p.status === 'archived').map((p) => p.profile));
  const known = new Set(reg.projects.map((p) => p.profile));
  return { active: activeProject(reg), profile: profile(), archived, known, projects: reg.projects };
}
/** Builds the dispatcher may run: not deleted, and in at least one project that is listed and not archived. */
export const runnable = (store, scope = projectScope()) => legacyLive(store).filter((b) => !(b.profiles ?? []).length || (b.profiles ?? []).some((p) => !scope.archived.has(p) && (scope.known.has(p) || p === scope.profile)));
const rulesOf = (store) => storeCore.projectOrchestrator(store, profile()).rules;

/** Agent slots as agent-slots.mjs status shows them (finished sessions pruned), or a quiet default without a store. */
export function slotsNow() {
  // free = the smaller of the soft cap and the VPS's hard build limit (build-limit@1: what really runs on the host)
  try { const s = slots.loadSettings(); const sum = slots.withState((st) => { const mem = slots.prune(st, s); return slots.summary(st, s, mem); }); return slots.withHard ? slots.withHard(sum) : sum; }
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
  const running = live(store).filter((b) => (b.status === 'running' || b.status === 'waiting' || (b.status === 'fixing' && b.pipeline?.session)) && b.pipeline?.account);
  for (const r of rows) {
    const mine = running.filter((b) => b.pipeline.account === r.name).map((b) => b.pipeline.session || `build:${b.id}`);
    r.running = [...new Set([...(r.running ?? []), ...mine])];
  }
  return { accounts: P.accountViews(rows, loadOwnAccounts(), { settings }), rows: w.rows, source: w.source, at: w.at, why: w.why };
}

/** Accounts as the pipeline sees them: claude-workers rows + what the store says runs on each + the pipeline's own records. */
export function accountsNow(store, settings = loadSettings()) { return accountsRead(store, settings).accounts; }

/**
 * Why a queued build is back in the Queue after a finished phase: { reason, phase, next, at } (lastRun.reason phase-done),
 * else null. The Pipeline view shows "Next phase: <model>, waiting for slot/account"; REST / MCP read it on the row.
 */
export function requeueOf(b) {
  const lr = b?.pipeline?.lastRun;
  if (b?.status !== 'queued' || !lr || lr.reason !== 'phase-done') return null;
  return { reason: 'phase-done', phase: lr.phase || '', next: BP.nextModel(b), at: lr.at || '' };
}

const row = (b) => {
  const p = orch.progress(b); const nx = orch.nextUp(b);
  return { id: b.id, alias: b.alias ?? '', title: b.title, status: b.status, priority: priorityLabel(effectivePriority(b)), steps: { done: p.done, total: p.total, left: p.total - p.done - p.skipped }, minutesLeft: p.minutesLeft,
    nextModel: BP.nextModel(b), nextStep: nx.step ? `${nx.step.id} ${nx.step.text}`.slice(0, 200) : '', needsApproval: nx.needsApproval, needsSplit: P.needsSplit(b), pipeline: b.pipeline ?? null, said: subtitle(b.origin, 160), branch: b.branch, pr: b.pr, createdAt: b.createdAt, updatedAt: b.updatedAt,
    tab: BP.tabOf(b), held: BP.isHeld(b) || BP.stopOf(b)?.kind === 'hold', stop: BP.stopOf(b), stopLabel: BP.stopOf(b) ? BP.STOP_LABEL[BP.stopOf(b).kind] : '', actions: BP.actionsFor(b), deleted: !!b.deleted, deletedAt: b.deletedAt ?? '', builtAt: b.builtAt ?? '', demo: b.demo === true, requeue: requeueOf(b), stuck: P.stuckAfterPhase(b), stepList: (b.steps ?? []).slice(0, 40).map((x) => ({ id: x.id, text: str(x.text, 160), model: x.model, estimate: x.estimate ?? '', done: !!x.done, skip: !!x.skip })),
    ...attemptsView(b) };
};
/** done-means-merged@1 on a row: every attempt, the open failure, the merge + verify evidence, the escalation, what the ladder tries next. */
export function attemptsView(b) {
  const failure = BP.normFailure(b.failure);
  const attempts = BP.normAttempts(b.attempts);
  const next = failure && b.status === 'fixing' ? RL.nextStrategy(attempts, failure, retryPolicy(), { pinnedModel: BP.nextModel(b) || b.pipeline?.model || 'Opus', model: b.pipeline?.model || '', account: b.pipeline?.account || '' }) : null;
  return { attempts, failure, landed: BP.normLanded(b.landed), escalation: BP.normEscalation(b.escalation), ladder: failure ? RL.ladderFor(failure.kind, retryPolicy()) : [], next: next ? { strategy: next.strategy, fixStrategy: next.fixStrategy, model: next.model, account: next.account, notBefore: next.notBefore, inFlight: next.inFlight, reason: next.reason } : null };
}

/** The whole picture for the console and the CLI. */
export function status() {
  loadUpgradePolicy();
  const store = loadStore(); const settings = loadSettings(); const read = accountsRead(store, settings); const accounts = read.accounts; const sl = slotsNow();
  const scope = projectScope();
  const builds = live(store).filter((b) => inProfile(b, scope.profile));
  const ageMin = read.at ? Math.max(0, Math.round((Date.now() - Date.parse(read.at)) / 60e3)) : null;
  const accountsFrom = { source: read.source, at: read.at, ageMin, why: read.why || (read.source === 'snapshot' && ageMin > 5 ? `the host's account snapshot is ${ageMin} min old: the dispatcher cron may be stopped` : '') };
  const plan = P.plan({ builds: runnable(store, scope), accounts, slots: sl, settings, rules: rulesOf(store) });
  const byTable = { pending: [], queued: [], building: [] };
  for (const b of builds) { const t = BP.tableOf(b); if (t && !b.hidden) byTable[t].push(row(b)); }
  byTable.queued.sort((a, b) => plan.queue.indexOf(a.id) - plan.queue.indexOf(b.id));
  byTable.pending.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  byTable.building.sort((a, b) => str(b.pipeline?.launchedAt).localeCompare(str(a.pipeline?.launchedAt)));
  const tabs = Object.fromEntries(BP.TABS.map((t) => [t, []]));
  for (const b of store.builds) { if (!inProfile(b, scope.profile)) continue; const t = BP.tabOf(b); if (t) tabs[t].push(row(b)); } // every record of the project: the Deleted tab shows soft-deleted builds
  tabs.queue.sort((a, b) => plan.queue.indexOf(a.id) - plan.queue.indexOf(b.id));
  tabs.active.sort((a, b) => str(b.pipeline?.launchedAt).localeCompare(str(a.pipeline?.launchedAt)));
  for (const t of ['pending', 'incomplete', 'errors']) tabs[t].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const t of ['complete', 'archive']) tabs[t].sort((a, b) => str(b.builtAt || b.updatedAt).localeCompare(str(a.builtAt || a.updatedAt)));
  tabs.deleted.sort((a, b) => str(b.deletedAt).localeCompare(str(a.deletedAt)));
  const st = loadState();
  const elsewhere = live(store).filter((b) => !inProfile(b, scope.profile) && ['running', 'waiting'].includes(b.status)).length;
  const project = { id: scope.active.id, name: scope.active.name, profile: scope.profile, runningElsewhere: elsewhere };
  return { ok: true, $axf: 'pipeline-status@1', at: nowIso(), project, table: byTable, tabs, accounts, accountsFrom, health: loadHealth(), slots: { used: sl.used, cap: sl.cap, free: sl.free, queued: sl.queued ?? 0, unavailable: !!sl.unavailable, ...(sl.hard?.max ? { hard: { max: sl.hard.max, live: sl.hard.live, free: sl.hard.free } } : {}) }, plan, settings,
    state: { at: st.at, idle: st.idle, alerts: st.alerts, recent: st.recent.slice(-20), launchFails: st.launchFails, selfCheck: st.selfCheck ?? null, selfCheckRequested: readJson(files().checkRequest)?.at || '', authWaits: loadAuthWaits() } };
}

// ------------------------------------------------------------------ store writes

/**
 * One change to a build's pipeline record (and status / note) under the store lock. `mutate(b, now)` (optional) changes
 * the same record in the same write (the watchdog appends its recovery and resets the step this way).
 */
export function setPipeline(id, patch, { status = '', note = '', by = 'pipeline', action = 'pipeline', mutate = null } = {}) {
  let out = null;
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    const now = nowIso();
    // One Queued (build-pipeline@1): a build entering the Queue while another holds it rests in Pending instead and
    // moves up by itself (advanceQueue); a build Brett stopped is never queued by an automatic writer. Brett's own
    // second queue is refused with the holder named (queue() asks first; this is the same rule under the lock).
    // a stopped build whose session ends rests in Pending whatever the exit says (stoppedExit); the store's own guard
    // keeps the stop itself for every automatic writer
    if (status && b.flow !== P2.FLOW && BP.isStopped(b) && !BP.speaksForBrett(by) && status !== 'queued') status = BP.stoppedExit(b, status);
    if (status === 'queued' && b.status !== 'queued' && b.flow !== P2.FLOW) {
      const holder = BP.queuedBuilds(legacyLive(s), queuePriority).find((x) => x.id !== b.id);
      const stopped = BP.isStopped(b) && !BP.speaksForBrett(by);
      if (holder && BP.speaksForBrett(by)) throw Object.assign(new Error(`${holder.id} is already queued: one build waits in the Queue at a time. ${b.id} stays in Pending and moves up by itself when ${holder.id} starts.`), { code: 2, holder: holder.id });
      if (holder || stopped) {
        status = 'pending'; patch = { ...patch, queuedAt: '', queuedBy: '' };
        const why = stopped ? `${BP.STOP_LABEL[BP.stopOf(b).kind]}: only Brett queues it again.` : `Waits in Pending: ${holder.id} holds the Queue (one build waits there at a time); it moves up by itself.`;
        note = [str(note, 1500), why].filter(Boolean).join(' ');
      }
    }
    b.pipeline = BP.normPipeline({ ...(b.pipeline ?? {}), ...patch }) ?? undefined;
    if (!b.pipeline) delete b.pipeline;
    if (status) { if (!storeCore.STATUSES.includes(status)) throw new Error(`unknown status ${status}`); b.status = status; b.builtAt = storeCore.FINISHED.includes(status) ? (b.builtAt || now) : ''; }
    // a note the build already ends with is not written again (a launch failing every minute left 42 copies of one line)
    if (note && b.notes.at(-1)?.text !== str(note, 2000)) b.notes.push({ text: str(note, 2000), at: now });
    if (typeof mutate === 'function') mutate(b, now);
    b.updatedAt = now; out = b;
    return s;
  }, { by, action, note: id });
  return out;
}

/** Start order inside the Queue and the order Pending builds move up in: priority first (build-priority), then the oldest. */
const queuePriority = (b) => effectivePriority(b);
/**
 * One Queued (build-pipeline@1, Brett Nov 25 2026): the Queue holds one build, the next to start. Each dispatcher tick
 * settles a Queue that holds more (records from before the rule, a requeue that slipped in: the first in start order
 * keeps the place, the rest rest in Pending in order, a held one with its hold). `promote`: when the Queue is free,
 * the next Pending build moves up. The tick promotes when the queued build went live in it; an empty Queue nobody
 * started stays empty until Brett queues a build (or his settings do: builds.launchWithoutAsking,
 * builds.autoQueuePending), so a build parked in Pending still waits for his click. Pipeline 2.0 builds are not part
 * of it: their flow has its own one active place. → { kept, demoted: [ids], promoted }
 */
export function advanceQueue({ by = 'dispatcher', promote = true } = {}) {
  const out = { kept: '', demoted: [], promoted: '' };
  const builds = runnable(loadStore());
  const q = BP.queuedBuilds(builds, queuePriority);
  out.kept = q.find((b) => !BP.isStopped(b))?.id ?? '';
  const settle = q.length > BP.QUEUE_MAX || q.some((b) => BP.isStopped(b));
  // a build held in Pending for a Claude login failure goes back by itself once the login works (authWaitsTick): it
  // does not move up before that
  const waits = loadAuthWaits(); const authHeld = (b) => b.status === 'pending' && !!waits[b.id] && !waits[b.id].requeued;
  if (!settle && !(promote && !q.length && BP.promotable(builds.filter((b) => !authHeld(b)), queuePriority).length)) return out;
  withStore((s) => {
    const now = nowIso();
    const mine = runnable(s);
    const st = BP.settleQueue(mine, { at: now, by, priorityOf: queuePriority });
    const pr = promote ? BP.promote(st.builds.filter((b) => !authHeld(b)), { at: now, by, priorityOf: queuePriority }) : { builds: [], promoted: '' };
    out.kept = st.kept; out.demoted = st.demoted; out.promoted = pr.promoted;
    const next = new Map([...st.builds, ...pr.builds].map((b) => [b.id, b]));
    const was = new Map(mine.map((b) => [b.id, b]));
    s.builds = s.builds.map((b) => {
      const n = next.get(b.id); if (!n || n === was.get(b.id)) return b;
      const text = n.id === pr.promoted ? `Moved up from Pending into the Queue (${by}): the Queue was free.` : BP.isStopped(n) ? `${BP.STOP_LABEL[BP.stopOf(n).kind]}: rests in Pending until Brett releases it (one build waits in the Queue at a time).` : `Back in Pending (${by}): one build waits in the Queue at a time (${st.kept || 'none'} holds it). It moves up by itself.`;
      const pl = BP.normPipeline(n.pipeline);
      const rec = { ...n, notes: [...(b.notes ?? []), { text, at: now }], updatedAt: now, builtAt: '' };
      if (pl) rec.pipeline = pl; else delete rec.pipeline;
      return rec;
    });
    return s;
  }, { by, action: 'pipeline:advance-queue', note: [out.promoted && `${out.promoted} moved up`, out.demoted.length && `${out.demoted.join(', ')} back in Pending`].filter(Boolean).join('; ') });
  if (out.demoted.length) { logLine({ event: 'queue-settled', kept: out.kept, demoted: out.demoted, by }); crewSay('dispatcher', 'done', `One build waits in the Queue at a time: ${out.kept || 'none'} keeps the place, ${out.demoted.join(', ')} went back to Pending and move${out.demoted.length === 1 ? 's' : ''} up in order.`); }
  if (out.promoted) { logLine({ event: 'promoted', build: out.promoted, by }); crewSay('dispatcher', 'start', `${out.promoted} moved up from Pending into the Queue.`, { ref: out.promoted }); }
  return out;
}

export function queue(id, { by = process.env.AXF_ACTOR || 'console' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  // a Pipeline 2.0 build has no Queue of its own: its split moves it on by itself, and Queue gives that a push now
  // (split it, give it the active place when it is next) instead of refusing a build that shows as Pending
  if (b.flow === P2.FLOW && !b.deleted) { const r = P2F.actBuild(b.id, 'queue', { by }); return { ...storeCore.findBuild(loadStore(), b.id), say: r.say }; }
  if (!BP.canQueue(b)) throw Object.assign(new Error(`${b.id} is ${b.status}${b.hidden ? ' (hidden)' : ''}: only a Pending build can be queued`), { code: 2 });
  // One Queued (build-pipeline@1): a second build is refused with the holder named; a stopped build only by Brett
  const can = BP.canQueueNow(legacyLive(loadStore()), b.id, { by, priorityOf: queuePriority });
  if (!can.ok) { logLine({ event: 'queue-refused', build: b.id, by, holder: can.queued, why: can.why }); throw Object.assign(new Error(can.why), { code: 2, holder: can.queued }); }
  const now = nowIso();
  const lift = BP.isStopped(b) ? { stop: null, heldAt: '', heldBy: '', heldWhy: '' } : {};
  const r = setPipeline(b.id, { ...lift, queuedAt: now, queuedBy: str(by, 80), note: b.steps.length ? '' : 'waiting for the split before it can start' }, { status: 'queued', note: `Queued by ${by}.`, by, action: 'pipeline:queue' });
  logLine({ event: 'queued', build: b.id, by });
  return r;
}
/**
 * Repair builds the old exit rule parked: every Pending build whose last run ended phase-done with steps left
 * (pipeline-core stuckAfterPhase()) goes back to the Queue, keeping its place (queuedAt) when it had one, with a
 * journalled note. Dry run unless apply. Returns { apply, found: [{ id, phase, next, why }], moved: [ids] }.
 * The same function behind the CLI (requeue-stuck), REST, MCP and voice, and builds-reconcile.mjs --apply.
 */
export function requeueStuck({ apply = false, by = process.env.AXF_ACTOR || 'cli' } = {}) {
  const found = live(loadStore()).map((b) => P.stuckAfterPhase(b)).filter(Boolean);
  const moved = [];
  if (apply) {
    for (const f of found) {
      const b = storeCore.findBuild(loadStore(), f.id);
      if (!P.stuckAfterPhase(b)) continue; // changed meanwhile
      // one Queued: while another build holds the Queue this one waits in Pending and moves up by itself (advanceQueue)
      if (BP.isStopped(b) || BP.queuedBuilds(legacyLive(loadStore()), queuePriority).some((x) => x.id !== b.id)) continue;
      const lr = b.pipeline?.lastRun ?? {};
      const note = `phase ${f.phase || '?'} done, requeued for ${f.next || '?'}: back in the Queue (requeue-stuck by ${by}; ${f.why}).`;
      setPipeline(b.id, { queuedAt: b.pipeline?.queuedAt || nowIso(), queuedBy: b.pipeline?.queuedBy || str(by, 80), note: `requeued after ${f.phase ? `phase ${f.phase}` : 'its phase'}: next phase ${f.next || '?'} waits for a slot and an account`, lastRun: { ...lr, outcome: 'requeued', reason: 'phase-done' } },
        { status: 'queued', note, by, action: 'pipeline:requeue-stuck' });
      logLine({ event: 'requeued-stuck', build: b.id, phase: f.phase, next: f.next, by });
      moved.push(b.id);
    }
    if (moved.length) crewSay('dispatcher', 'done', `Moved ${moved.length} build(s) parked in Pending after a finished phase back to the Queue: ${moved.join(', ')}.`);
  }
  return { apply, found, moved };
}

/**
 * Who a stop or its release is from, at a surface. hold / cancel / unqueue / release are Brett's calls (build-pipeline@1
 * speaksForBrett), and they arrive on his surfaces: the console and its REST API, MCP, this CLI, voice. The CLI (which
 * the console's routes, the MCP commands and voice all run) names its caller through this: a name the contract does
 * not list (his hub name, a tool's) is kept behind the surface it came through (`cli:<name>`). Code that calls
 * stopNow / buildAction directly passes its own `by`, and one that does not speak for Brett is refused.
 */
export const stopActor = (by) => (BP.speaksForBrett(by) ? str(by, 80) : `cli:${str(by, 70) || 'unknown'}`);
/**
 * One of Brett's stops on a build (build-pipeline@1 stopBuild): hold (park it; a live session finishes its step, then
 * the build rests in Pending), cancel (its session is to end and its slot be freed: `kill`), unqueue (back to Pending).
 * The build rests in Pending with `pipeline.stop` and no automatic writer brings it back; release or queue lifts it.
 * → { build, kill, already }
 */
export function stopNow(id, kind, { by = process.env.AXF_ACTOR || 'console', why = '' } = {}) {
  const who = str(by, 80);
  let res = null;
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    if (b.flow === P2.FLOW) throw Object.assign(new Error(`${b.id} is a Pipeline 2.0 build: use its own ${kind === 'unqueue' ? 'hold' : kind} (pipeline2.mjs act ${b.id} ${kind === 'unqueue' ? 'hold' : kind})`), { code: 2 });
    const now = nowIso();
    const r = BP.stopBuild(b, kind, { at: now, by: who, why });
    if (!r.ok) throw Object.assign(new Error(r.why), { code: 2 });
    res = { kill: r.kill, already: r.already === true, session: b.pipeline?.session ?? '', slot: b.pipeline?.slot ?? '', account: b.pipeline?.account ?? '' };
    if (res.already) { res.build = b; return s; }
    const next = r.build; const pl = BP.normPipeline(next.pipeline);
    const text = kind === 'hold' ? `On hold (${who})${why ? `: ${str(why, 300)}` : ''}. ${BP.isLive(b) ? 'Its session finishes the step it is on, then the build rests in Pending' : 'It rests in Pending'}; nothing starts it until Brett releases it.`
      : kind === 'cancel' ? `Cancelled (${who})${why ? `: ${str(why, 300)}` : ''}. ${r.kill ? 'Its session is stopped and its slot freed. ' : ''}It rests in Pending; nothing starts it until Brett releases or queues it.`
        : `Back to Pending (${who})${why ? `: ${str(why, 300)}` : ''}. Nothing queues it again until Brett does.`;
    Object.assign(b, next, { notes: [...(b.notes ?? []), { text, at: now }], updatedAt: now, builtAt: '' });
    if (pl) b.pipeline = pl; else delete b.pipeline;
    res.build = b;
    return s;
  }, { by: who, action: `pipeline:${kind}`, note: id });
  if (!res.already) logLine({ event: kind === 'unqueue' ? 'unqueued' : kind, build: res.build.id, by: who, kill: res.kill });
  return res;
}
export function unqueue(id, { by = process.env.AXF_ACTOR || 'console' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  if (!BP.canUnqueue(b)) throw Object.assign(new Error(`${b.id} is ${b.status}: only a queued build goes back to Pending`), { code: 2 });
  return stopNow(b.id, 'unqueue', { by }).build;
}

/**
 * The Queue / Archive / Deleted actions (Brett, Nov 10 2026: "Anything in the queue you can send back to pending, leave in
 * queue on hold, move to the archive, or delete … A deleted tab where all deleted builds stay saved forever"):
 *   unqueue    Queue → Pending                         hold / release   stays in the Queue, the dispatcher skips it / not
 *   archive    any build without a live session → Archive (status archived; the Queue fields are cleared)
 *   unarchive  Archive → built / complete when every step is done, else Pending
 *   delete     soft delete: the record stays in the store forever (Deleted tab); a queued build leaves the Queue first
 *   restore    Deleted → back where it was (a build that was queued comes back in Pending)
 * Many ids at once (bulk select). Each id is checked on its own: one refused build never stops the others.
 * Returns { action, done: [{ id, status, tab }], refused: [{ id, error }] }.
 */
export function buildAction(action, ids, { by = process.env.AXF_ACTOR || 'console', why = '' } = {}) {
  if (!BP.BUILD_ACTIONS.includes(action)) throw Object.assign(new Error(`action is one of ${BP.BUILD_ACTIONS.join(', ')}`), { code: 2 });
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map((x) => str(x, 120).trim()).filter(Boolean))];
  if (!list.length) throw Object.assign(new Error('no build id given'), { code: 2 });
  const done = []; const refused = [];
  const reason = str(why, 300).trim(); const tail = reason ? `: ${reason}` : '';
  for (const id of list) {
    try {
      if (action === 'unqueue') { const b = unqueue(id, { by }); done.push({ id: b.id, status: b.status, tab: BP.tabOf(b) }); continue; }
      // hold and cancel are Brett's stops (build-pipeline@1): the build rests in Pending and no automatic writer brings it back
      if (action === 'hold' || action === 'cancel') {
        const have = storeCore.findBuild(loadStore(), id);
        if (have && have.flow !== P2.FLOW) {
          const r = stopNow(id, action, { by, why: reason });
          if (r.already) throw new Error(`${r.build.id} is ${action === 'hold' ? 'on hold' : 'cancelled'} already`);
          done.push({ id: r.build.id, status: r.build.status, tab: BP.tabOf(r.build), stop: action, kill: r.kill, session: r.session, slot: r.slot }); continue;
        }
        if (action === 'cancel') throw new Error(have ? `${have.id} is a Pipeline 2.0 build: cancel it with pipeline2.mjs act ${have.id} cancel` : `no build "${id}"`);
      }
      let out = null;
      withStore((s) => {
        const b = storeCore.findBuild(s, id); if (!b) throw new Error(`no build "${id}"`);
        const now = nowIso();
        const pipe = (patch) => { b.pipeline = BP.normPipeline({ ...(b.pipeline ?? {}), ...patch }) ?? undefined; if (!b.pipeline) delete b.pipeline; };
        const unq = { queuedAt: '', queuedBy: '', heldAt: '', heldBy: '', heldWhy: '' };
        let note = '';
        if (action === 'hold') {
          // a builds@1 build never comes here (stopNow above); a Pipeline 2.0 build's hold is its own flow's
          throw new Error(`${b.id} is a Pipeline 2.0 build: hold it with pipeline2.mjs act ${b.id} hold`);
        } else if (action === 'release') {
          if (!BP.isStopped(b) && !b.pipeline?.heldAt) throw new Error(`${b.id} is not on hold`);
          const was = BP.stopOf(b);
          if (was) {
            const rel = BP.releaseStop(b, { by });
            if (!rel.ok) throw new Error(rel.why);
            const pl = BP.normPipeline(rel.build.pipeline);
            b.status = rel.build.status; if (pl) b.pipeline = pl; else delete b.pipeline;
            note = b.status === 'landing' ? `Released (${by}): every step was done while it was on hold, so it goes on to land.` : `Released (${by}; it was ${BP.STOP_LABEL[was.kind].toLowerCase()}): it waits in Pending and moves up by itself.`;
          } else { pipe({ heldAt: '', heldBy: '', heldWhy: '' }); note = `Released from hold (${by}).`; }
        } else if (action === 'archive') {
          if (!BP.canArchive(b)) throw new Error(b.deleted ? `${b.id} is deleted: restore it first` : BP.isLive(b) ? `${b.id} is ${b.status}: a build with a live session is not archived under it` : `${b.id} is archived already`);
          const was = b.status; if (was === 'queued') pipe(unq); b.status = 'archived'; b.builtAt = ''; note = `Moved to the Archive from ${was} (${by})${tail}.`;
        } else if (action === 'unarchive') {
          if (b.deleted || b.status !== 'archived') throw new Error(`${b.id} is not in the Archive`);
          b.status = BP.unarchivedStatus(b); b.builtAt = storeCore.FINISHED.includes(b.status) ? (b.builtAt || now) : ''; note = `Back from the Archive as ${b.status} (${by}).`;
        } else if (action === 'delete') {
          if (!BP.canDelete(b)) throw new Error(b.deleted ? `${b.id} is deleted already` : `${b.id} is ${b.status}: a build with a live session is not deleted under it`);
          if (b.status === 'queued') { pipe(unq); b.status = 'pending'; }
          b.deleted = true; b.deletedAt = now; note = `Deleted (${by})${tail}. Kept in the builds store for good: Deleted tab, restorable.`;
        } else if (action === 'restore') {
          if (!b.deleted) throw new Error(`${b.id} is not deleted`);
          b.deleted = false; b.deletedAt = ''; note = `Restored from Deleted (${by}): back in ${BP.TAB_LABEL[BP.tabOf(b)] || b.status}.`;
        }
        b.notes.push({ text: note, at: now }); b.updatedAt = now; out = b;
        return s;
      }, { by, action: `pipeline:${action}`, note: id });
      logLine({ event: action, build: out.id, by });
      done.push({ id: out.id, status: out.status, tab: BP.tabOf(out) });
    } catch (e) { refused.push({ id, error: e.message }); }
  }
  return { action, done, refused };
}

// ------------------------------------------------------------------ the split

/**
 * The one-shot split call. No tools at all: no built-in ones (--tools '') and no MCP servers from the repo or the login
 * (--strict-mcp-config): a tool call ends the one turn without an answer (stop_reason tool_use, claude exit 1). No hooks
 * (disableAllHooks): the repo's SessionEnd hook held the process past the answer until the timeout killed it (Nov 20 2026).
 */
export const SPLIT_ARGS = (modelId) => ['-p', '--model', modelId, '--output-format', 'json', '--max-turns', '1', '--tools', '', '--strict-mcp-config', '--settings', JSON.stringify({ disableAllHooks: true })];
/** Fable thinking through a big plan took 172 s (Nov 20 2026); the tick itself is allowed 600 s. */
export const SPLIT_TIMEOUT_MS = 420e3;
/** Run the configured splitter on a prompt: { text, provider, error }. `model` = the policy key it runs on (opus | fable). */
export function askSplitter(prompt, settings, env = process.env, { model = 'opus' } = {}) {
  if (env.AXF_PIPELINE_SPLITTER) {
    const r = spawnSync('bash', ['-c', env.AXF_PIPELINE_SPLITTER], { input: prompt, encoding: 'utf8', timeout: 180e3, env });
    return r.status === 0 ? { text: r.stdout, provider: 'claude', error: '' } : { text: '', provider: 'claude', error: `splitter exit ${r.status}: ${str((r.stderr || r.stdout || '').trim(), 300)}` };
  }
  if (settings.splitProvider !== 'claude') return { text: '', provider: settings.splitProvider, error: `split provider is ${settings.splitProvider}` };
  // a one-shot Claude call on a login copy (SPLIT_ARGS): a worker account when one is free, else the active one
  const dir = join(tmpdir(), `axf-split-${process.pid}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
  let snap = null;
  try {
    let account = 'active'; try { account = workerRoute() || 'active'; } catch { account = 'active'; }
    try { snap = snapshotLogin({ dir, session: 'split', account }); } catch { snap = null; }
    const e = snap ? childEnv(snap, env) : { ...env };
    e.PATH = `${join(homedir(), '.local', 'bin')}:${e.PATH || ''}`;
    const r = spawnSync('claude', SPLIT_ARGS(MODEL_IDS[modelKey(model)] || MODEL_IDS.opus), { input: prompt, encoding: 'utf8', timeout: SPLIT_TIMEOUT_MS, env: e, cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 });
    // the answer is the one JSON result line; a late exit after it (killed at the timeout) does not lose it
    const done = (() => { try { const j = JSON.parse(String(r.stdout || '').trim()); return j?.subtype === 'success' && !j.is_error && typeof j.result === 'string' ? j.result : null; } catch { return null; } })();
    if (done !== null) return { text: done, provider: 'claude', error: '' };
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
  if (['built', 'landing', 'landed', 'complete', 'archived'].includes(b.status)) throw Object.assign(new Error(`${b.id} is ${b.status}: nothing to split`), { code: 2 });
  let steps = []; let used = 'rules'; let note = ''; let error = '';
  if (provider !== 'rules') {
    const a = askSplitter(P.splitPrompt(b, rules), settings);
    if (!a.error) { const p = P.parseSplit(a.text, rules); if (!p.error && p.steps.length) { steps = p.steps; used = 'claude'; } else error = p.error || 'empty answer'; } else error = a.error;
  }
  if (!steps.length) { steps = P.rulesSplit(b, rules); used = 'rules'; note = `Split by rules${error ? ` (Claude: ${str(error, 200)})` : ''}: one step per line of the request, review the steps.`; }
  else { const par = steps.filter((s, i) => i > 0 && Array.isArray(s.dependsOn) && !(s.dependsOn.length === 1 && s.dependsOn[0] === `s${i}`)).length; note = `Split by Claude into ${steps.length} steps (${steps.filter((s) => s.model === 'Fable').length} Fable${par ? `, ${par} can run beside earlier steps` : ''}).`; }
  // the model of every step is the VPS triage gate's (model-triage@1): the splitter's model is a suggestion it reads
  let gated = null;
  try { gated = modelTriage.triageSteps(b, steps.map((st, i) => ({ ...st, id: st.id || `s${i + 1}` })), { lane: 'orchestrator' }); steps = gated.steps.map((st) => ({ ...st, why: st.why || (st.model === 'Fable' ? str(st.triage?.why, 300) : '') })); note = note.replace(/\((\d+) Fable/, `(${steps.filter((x) => x.model === 'Fable').length} Fable`); }
  catch (e) { logLine({ event: 'triage-failed', build: b.id, error: str(e.message, 200) }); }
  const done = new Map(b.steps.filter((s) => s.done).map((s) => [s.text.trim().toLowerCase(), s]));
  let out = null;
  withStore((s) => {
    const rec = storeCore.findBuild(s, b.id); const now = nowIso();
    const next = steps.map((st, i) => { const old = done.get(st.text.trim().toLowerCase()); return storeCore.normStep({ ...st, id: `s${i + 1}`, done: !!old, doneAt: old?.doneAt ?? '', uid: old?.uid }, i, { now }); });
    // a done step the new split dropped is kept at the top so nothing done is lost
    const kept = rec.steps.filter((x) => x.done && !next.some((n) => n.uid === x.uid)).map((x, i) => ({ ...x, id: `d${i + 1}` }));
    // renumber s1… with the kept done steps first; the split's dependency ids move with their steps
    const ren = new Map(next.map((x, i) => [x.id, `s${kept.length + i + 1}`]));
    for (const x of next) if (Array.isArray(x.after)) x.after = x.after.map((d) => ren.get(d)).filter(Boolean);
    rec.steps = [...kept, ...next]; rec.steps.forEach((x, i) => { x.id = `s${i + 1}`; });
    if (!rec.rearranged) { rec.defaultSteps = rec.steps.map((x) => ({ ...x })); rec.defaultAt = now; }
    rec.pipeline = BP.normPipeline({ ...(rec.pipeline ?? {}), split: { at: now, by, provider: used, steps: rec.steps.length, note: str(note, 400) }, splitRequested: '', note: used === 'rules' ? 'steps made by rules: review them' : '' });
    rec.notes.push({ text: note, at: now }); rec.updatedAt = now; out = rec;
    return s;
  }, { by, action: 'pipeline:split', note: b.id });
  if (gated) modelTriage.logSteps(b, gated.decisions);
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
    const want = legacyLive(store).filter((b) => (b.status === 'pending' || b.status === 'queued') && !b.hidden && (b.pipeline?.splitRequested || !b.steps.length));
    for (const b of want.slice(0, max)) {
      try {
        const r = splitBuild(b.id); out.split.push(r); alert('split', { id: b.id, title: b.title, steps: r.steps, error: r.provider === 'rules' ? r.note : '', note: r.note });
        if (r.provider === 'rules') crewSay('orchestrator', 'waiting', `Split ${b.id} by rules into ${r.steps} steps (Claude couldn't). Brett, check the steps before it runs.`, { ref: b.id });
        else crewSay('orchestrator', 'done', `Split ${b.id} into ${r.steps} steps.`, { ref: b.id });
      }
      catch (e) { out.skipped.push({ id: b.id, error: e.message }); }
    }
    for (const b of want.slice(max)) out.skipped.push({ id: b.id, error: 'next round' });
  }
  if (settings.autoQueue) {
    const fresh = loadStore();
    for (const b of legacyLive(fresh)) {
      // Launch builds without asking is ON: a split build with every step still open goes to the Queue by itself; one a session
      // handed back to Pending (returned) waits for Brett
      if (b.status !== 'pending' || b.hidden || !b.steps.length || P.needsSplit(b, rules) || b.pipeline?.lastRun?.outcome === 'returned') continue;
      try { queue(b.id, { by: 'auto (Launch builds without asking)' }); out.queued.push(b.id); crewSay('orchestrator', 'start', `Queued ${b.id} by itself (Launch builds without asking is on).`, { ref: b.id }); } catch (e) { out.skipped.push({ id: b.id, error: e.message }); }
    }
  }
  return out;
}

// ------------------------------------------------------------------ launches

const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
// tests that switch tmux off for agent slots (AXF_SLOTS_TMUX=off) switch it off for the build lock too
const lockEnv = (env) => (env.AXF_SLOTS_TMUX === 'off' && env.AXF_BUILD_LOCK_TMUX == null ? { ...env, AXF_BUILD_LOCK_TMUX: 'off' } : env);
function git(cwd, ...a) { return spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 180e3 }); }

/** The build's worktree (made when missing): its own branch claude/<id> from origin/main, node_modules linked from the main checkout. */
export function ensureWorktree(id, env = process.env) {
  const dir = join(worktreesRoot(env), id);
  if (existsSync(dir)) return { dir, made: false };
  if ((env.AXF_PIPELINE_WORKTREE_MODE || 'git') === 'mkdir') { mkdirSync(dir, { recursive: true }); return { dir, made: true }; }
  mkdirSync(worktreesRoot(env), { recursive: true });
  // the repo the worktrees hang off: AXF_PIPELINE_REPO (a test's scratch repo) or this checkout, the same as step worktrees
  const repo = repoRoot(env);
  git(repo, 'fetch', '-q', 'origin', 'main');
  const base = git(repo, 'rev-parse', '--verify', '-q', 'origin/main').status === 0 ? 'origin/main' : 'HEAD';
  let r = git(repo, 'worktree', 'add', '-B', `claude/${id}`, dir, base);
  if (r.status !== 0 && /already checked out|already exists/.test(r.stderr)) r = git(repo, 'worktree', 'add', '--detach', dir, base);
  if (r.status !== 0) throw new Error(`worktree for ${id}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  linkModules(dir);
  return { dir, made: true };
}

/** Installed packages come from the main checkout: no install per build or step worktree. */
function linkModules(dir) {
  for (const rel of ['node_modules', 'apps/console-web/node_modules', 'apps/demo/node_modules', 'apps/expenses/node_modules', 'apps/axhub-web/node_modules', 'apps/molly/node_modules']) {
    const src = join(REPO_ROOT, rel); const dst = join(dir, rel);
    if (existsSync(src) && !existsSync(dst)) { try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst); } catch { /* optional */ } }
  }
}

// ------------------------------------------------------------------ parallel step worktrees (BUILD-PARALLEL §4)

/** The repo the worktrees hang off (AXF_PIPELINE_REPO for tests: a scratch git repo with an origin). */
const repoRoot = (env = process.env) => env.AXF_PIPELINE_REPO || REPO_ROOT;
const gitMode = (env = process.env) => (env.AXF_PIPELINE_WORKTREE_MODE || 'git') !== 'mkdir';
/** Where a parallel step works: /root/axf-builds/<build>--<stepId>. */
export const stepWorktreeDir = (b, stepId, env = process.env) => join(worktreesRoot(env), `${b.id}--${stepId}`);

/**
 * A parallel step's worktree and branch `<build-branch>--<stepId>`, made from the build branch (origin's copy when it
 * is there, so the step starts from everything already pushed). An existing step worktree is kept (a retry reads it).
 * → { dir, branch, base, made }
 */
export function ensureStepWorktree(b, stepId, env = process.env) {
  const step = (b.steps ?? []).find((x) => x.id === stepId);
  if (!step) throw new Error(`${b.id} has no step ${stepId}`);
  const dir = stepWorktreeDir(b, stepId, env);
  const branch = BP.stepBranch(b, step, { parallel: true }); const buildBranch = BP.stepBranch(b, step);
  if (existsSync(dir)) return { dir, branch, base: buildBranch, made: false };
  if (!gitMode(env)) { mkdirSync(dir, { recursive: true }); return { dir, branch, base: buildBranch, made: true }; }
  const root = repoRoot(env);
  mkdirSync(worktreesRoot(env), { recursive: true });
  git(root, 'fetch', '-q', 'origin', buildBranch);
  const base = git(root, 'rev-parse', '--verify', '-q', `origin/${buildBranch}`).status === 0 ? `origin/${buildBranch}`
    : git(root, 'rev-parse', '--verify', '-q', buildBranch).status === 0 ? buildBranch : '';
  if (!base) throw new Error(`step worktree for ${b.id}/${stepId}: the build branch ${buildBranch} does not exist yet`);
  // a kept branch (a retry after a conflict) is reused; otherwise a new one from the build branch
  const keep = git(root, 'rev-parse', '--verify', '-q', branch).status === 0;
  const r = keep ? git(root, 'worktree', 'add', dir, branch) : git(root, 'worktree', 'add', '-b', branch, dir, base);
  if (r.status !== 0) throw new Error(`step worktree for ${b.id}/${stepId}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  if (root === REPO_ROOT) linkModules(dir);
  return { dir, branch, base, made: true };
}

/** Remove a merged step's worktree and branch (local and on origin). Best effort. */
export function dropStepWorktree(b, stepId, env = process.env) {
  const dir = stepWorktreeDir(b, stepId, env); const step = (b.steps ?? []).find((x) => x.id === stepId) ?? { id: stepId };
  const branch = BP.stepBranch(b, step, { parallel: true });
  if (!gitMode(env)) { rmSync(dir, { recursive: true, force: true }); return { dir, branch }; }
  const root = repoRoot(env);
  git(root, 'worktree', 'remove', '--force', dir);
  git(root, 'branch', '-D', branch);
  git(root, 'push', '-q', 'origin', '--delete', branch);
  return { dir, branch };
}

/**
 * Merge a finished parallel step back into the build branch, under the store lock (one merge at a time, and the store
 * change lands with it). The merge runs in the build's own worktree (`git merge --no-ff`, then push; never main), and
 * only when that worktree has no uncommitted tracked changes (else `deferred`: the next tick tries again).
 * Merged: the step branch and worktree go. Conflict: the merge is aborted, the step goes back open as `blocked` with a
 * note (conflictBack) and re-runs after the steps it clashed with; the branch is kept, never force-pushed or deleted.
 * → { ok, merged, deferred, conflict, files, why }
 */
export function mergeStepBack(id, stepId, { env = process.env, by = 'dispatcher' } = {}) {
  let out = { ok: false, merged: false, deferred: false, conflict: false, files: [], why: '' };
  withStore((s) => {
    const rec = storeCore.findBuild(s, id); const step = rec?.steps.find((x) => x.id === stepId);
    if (!rec || !step) { out.why = `no step ${id}/${stepId}`; return s; }
    const branch = BP.stepBranch(rec, step, { parallel: true }); const buildBranch = BP.stepBranch(rec, step);
    if (gitMode(env)) {
      const wt = join(worktreesRoot(env), rec.id);
      if (!existsSync(wt)) { out.why = `no build worktree ${wt}`; out.deferred = true; return s; }
      if (git(wt, 'status', '--porcelain', '-uno').stdout.trim()) { out = { ...out, deferred: true, why: 'the build worktree has uncommitted changes: merge on a later tick' }; return s; }
      git(wt, 'fetch', '-q', 'origin', branch);
      const src = git(wt, 'rev-parse', '--verify', '-q', `origin/${branch}`).status === 0 ? `origin/${branch}` : branch;
      const m = git(wt, 'merge', '--no-ff', '--no-edit', '-m', `Merge ${branch} (${rec.id} ${stepId}) into ${buildBranch}`, src);
      if (m.status !== 0) {
        const files = git(wt, 'diff', '--name-only', '--diff-filter=U').stdout.split('\n').map((x) => x.trim()).filter(Boolean);
        git(wt, 'merge', '--abort');
        const c = P.conflictBack(rec, stepId, { files, branch });
        if (c.ok) { Object.assign(rec, c.build); rec.notes.push({ text: `${stepId}: ${c.note}`, at: nowIso() }); }
        out = { ...out, ok: true, conflict: true, files, why: c.ok ? c.note : c.why };
        return s;
      }
      git(wt, 'push', '-q', 'origin', `HEAD:${buildBranch}`);
    }
    // merged: the claim goes and the step's merge is recorded on the build
    const now = nowIso(); delete step.claim; step.updatedAt = now;
    rec.notes.push({ text: `${stepId}: ${branch} merged into ${buildBranch}`, at: now }); rec.updatedAt = now;
    out = { ...out, ok: true, merged: true };
    return s;
  }, { by, action: 'pipeline:step-merge', note: `${id}/${stepId}` });
  if (out.merged) { try { dropStepWorktree(storeCore.findBuild(loadStore(), id), stepId, env); } catch { /* best effort */ } }
  logLine({ event: 'step-merge', build: id, step: stepId, merged: out.merged, conflict: out.conflict, deferred: out.deferred, files: out.files, why: out.why });
  return out;
}

// ------------------------------------------------------------------ build names (build-id@1)

/**
 * Give every build whose id is longer than a valid build name (made before ids were capped at 40 characters) a short
 * alias. The id, folder and branch stay as they are (a branch with an open PR is not renamed); the alias is one more
 * name the store answers to. `apply: false` only lists what it would set; `only` = one build id.
 */
export function assignAliases({ apply = true, all = false, only = '', by = process.env.AXF_ACTOR || 'pipeline' } = {}) {
  const builds = loadStore().builds;
  // by default only builds that may still run or land; `all` takes in finished, archived and deleted ones too
  const want = (b) => (only ? b.id === only : b.kind !== 'epic' && (all || (!b.deleted && !['complete', 'archived'].includes(b.status))));
  const plan = planAliases(builds).filter((x) => want(builds.find((b) => b.id === x.id)));
  if (!apply || !plan.length) return plan;
  withStore((s) => { for (const { id, alias } of plan) { const rec = s.builds.find((x) => x.id === id); if (rec && !isBuildId(rec.alias ?? '')) rec.alias = alias; } return s; }, { by, action: 'pipeline:alias', note: plan.map((x) => `${x.id} → ${x.alias}`).join(', ').slice(0, 500) });
  for (const x of plan) logLine({ event: 'aliased', build: x.id, alias: x.alias });
  return plan;
}

/**
 * The landing path for a build with a long id: `ref` is its id, its alias or its worktree folder. Makes sure it has an
 * alias, then points <worktrees>/<alias> at its folder (a symlink) and sets the local branch claude/<alias> to the head
 * of claude/<id>, so vps.build_land / build_stop / build_clean can be called with the alias. The original branch and its
 * PR are left alone. Run it again right before landing: it moves claude/<alias> to the branch's latest commit.
 */
export function landAlias(ref, { env = process.env, by = process.env.AXF_ACTOR || 'cli' } = {}) {
  const name = basename(String(ref || '').replace(/\/+$/, ''));
  if (!name) throw Object.assign(new Error('give a build id, alias or worktree folder'), { code: 2 });
  let b = storeCore.findBuild(loadStore(), name);
  if (!b) throw Object.assign(new Error(`no build "${name}"`), { code: 2 });
  if (isBuildId(b.id)) return { id: b.id, alias: b.id, name: b.id, dir: join(worktreesRoot(env), b.id), branch: `claude/${b.id}`, linked: false, note: 'its id is a valid build name already' };
  if (!isBuildId(b.alias ?? '')) { assignAliases({ by, only: b.id }); b = storeCore.findBuild(loadStore(), b.id); }
  const alias = b.alias; const root = worktreesRoot(env);
  const dir = join(root, b.id); const link = join(root, alias);
  let linked = false;
  if (existsSync(dir) && !existsSync(link)) { symlinkSync(dir, link); linked = true; }
  const from = b.branch || `claude/${b.id}`;
  let branch = '';
  if (git(REPO_ROOT, 'rev-parse', '--verify', '-q', from).status === 0) {
    const r = git(REPO_ROOT, 'branch', '-f', `claude/${alias}`, from);
    if (r.status === 0) branch = `claude/${alias}`;
  }
  logLine({ event: 'land-alias', build: b.id, alias, linked, branch });
  return { id: b.id, alias, name: alias, dir: existsSync(link) ? link : '', branch, from, linked,
    note: `land it with vps.build_land name=${alias}${branch ? ` (claude/${alias} is at ${from})` : ` (no local ${from} to point claude/${alias} at)`}` };
}

// ------------------------------------------------------------------ build rules (build-rules@1, the VPS's share)

/** The plugin that provides service:axf.build-rules@1 (found by capability, never by folder name): { dir, runner } or null. */
export function buildRulesProvider(root = REPO_ROOT) {
  const base = join(root, 'apps/console-web/plugins');
  let dirs = []; try { dirs = readdirSync(base).sort(); } catch { return null; }
  for (const d of dirs) {
    const m = readJson(join(base, d, 'plugin.json'));
    if (m && Array.isArray(m.provides) && m.provides.includes('service:axf.build-rules@1')) { const runner = join(base, d, 'build-rules-runner.mjs'); return existsSync(runner) ? { dir: join(base, d), runner } : null; }
  }
  return null;
}

/** The session's share of the build rules for one build (brief-blocks@1), from the store; null when it can't be read. */
export function storeBlocks(b) {
  try { return BR.briefBlocks(BR.load().store, { id: b.id, title: b.title, text: b.detail || '' }); } catch { return null; }
}

/**
 * Run the VPS's build rules for one phase (before | after) without holding the dispatcher: the provider's runner in the
 * background; its results land in the rule history and the gate's History. AXF_BUILD_RULES=off skips it, and so does a
 * test builds store (AXF_BUILDS_STORE) unless AXF_BUILD_RULES=on.
 */
export function runBuildRules(id, phase, { env = process.env, by = 'dispatcher' } = {}) {
  if (env.AXF_BUILD_RULES === 'off' || (env.AXF_BUILDS_STORE && env.AXF_BUILD_RULES !== 'on')) return { skipped: 'off' };
  const p = buildRulesProvider();
  if (!p) return { skipped: 'no build-rules provider' };
  try {
    // in the build's worktree, so a fixer's files (home card, help stub, THREADS row) are committed on its branch
    const wt = worktreeOf(id, env);
    const at = existsSync(wt) ? ['--root', wt, '--commit'] : [];
    const child = spawn(process.execPath, [p.runner, 'run', '--build', id, '--phase', phase, '--by', by, ...at], { cwd: REPO_ROOT, detached: true, stdio: 'ignore', env });
    child.unref();
    logLine({ event: 'build-rules', build: id, phase, pid: child.pid });
    return { started: true, pid: child.pid };
  } catch (e) { return { skipped: str(e.message, 200) }; }
}

/** The brief file: what Brett said first (build-origin@1 blocks), then the orchestrator's phase brief, then the rules. */
export function briefFor(b, rules, opts, more = {}) { return fitBriefFor(b, rules, opts, more).text; }

const bytes = (t) => Buffer.byteLength(t, 'utf8');
/** `t` cut to at most `max` bytes on a character boundary. */
const cutBytes = (t, max) => { if (bytes(t) <= max) return t; let s = Buffer.from(t, 'utf8').subarray(0, Math.max(0, max)).toString('utf8'); if (s.endsWith('�')) s = s.slice(0, -1); return s; };

/**
 * The brief and how it was fitted under the byte cap (opts.maxBytes, default settings briefMaxBytes): { text, bytes,
 * maxBytes, trimmed: [what was cut] }. Trimmed in this order until it fits: fewer steps listed (40 → 20 → 10 → 5), the
 * rules block, then the end of the phase brief. "Brett said (verbatim)", the addenda, the header and the Pipeline
 * paragraph are never cut.
 */
export function fitBriefFor(b, rules, { account, model, kind = '', retry = '', maxBytes = 0 }, { blocks = storeBlocks(b) } = {}) {
  const cap = maxBytes > 0 ? maxBytes : P.DEFAULTS.briefMaxBytes;
  const o = b.origin ?? {};
  const addenda = (o.addenda ?? []).map((a, i) => addendumBlock(i + 1, a));
  const head = [`# Build: ${b.id}`, '', saidBlock(o), ...(addenda.length ? ['', ...addenda] : []), '', '## What to build'].join('\n');
  const pipeline = ['', '## Pipeline',
    `Parallel steps: steps with a dependsOn list may run in step sessions beside you (Fill every slot). Before you start a step, run \`node apps/console-web/plugins/build-orchestrator/pipeline.mjs fill status ${b.id}\`: skip any step it shows running elsewhere and every step waiting on one, and leave their files alone; their branches merge into yours by themselves.`,
    `This session was started by the orchestrator's dispatcher on Claude account ${account}${kind === 'api' ? ' (an API key: billed per token, keep it lean)' : ''} for the ${model} phase. Work through every step of the phase in this one session: they are checkpoints, not separate tasks. As each step finishes, commit it on your branch, push, and tick it (orchestrator.mjs act step ${b.id} <stepId> done), then go straight on to the next; nothing is lost if the session dies, the next one starts at the first open step on the same branch. When this phase's steps are done, stop: the dispatcher starts the next phase on the right account. If you must stop early with steps left, say why in a build note (orchestrator.mjs act note ${b.id} "…"); the build goes back to Pending for Brett.`].join('\n');
  // the session's rules from the Build rules tab; with this block the launcher appends no second one
  let rulesText = blocks?.blocks?.rules ? `\n\n${blocks.blocks.rules}` : '';
  // done-means-merged@1: a relaunch by the retry runner says what failed, what was tried and what to do differently
  const retryText = retry ? `\n\n${retry}` : '';
  const compose = (body) => `${head}\n${body}\n${pipeline}${rulesText}${retryText}`;
  const trimmed = [];
  let body = orch.brief(b, rules, { blocks });
  let text = compose(body);
  for (const lim of [20, 10, 5]) {
    if (bytes(text) <= cap) break;
    body = orch.brief(b, rules, { blocks, stepLimit: lim }); text = compose(body); trimmed.push(`step list to ${lim} open steps`);
  }
  if (bytes(text) > cap && rulesText) {
    const room = cap - bytes(compose(body)) + bytes(rulesText);
    const note = '\n… (rules block trimmed to fit the brief size cap, builds.briefMaxBytes)';
    rulesText = room > bytes(note) + 200 ? `${cutBytes(rulesText, room - bytes(note))}${note}` : '';
    text = compose(body); trimmed.push('rules block');
  }
  if (bytes(text) > cap) {
    const note = '\n… (phase brief trimmed to fit the brief size cap, builds.briefMaxBytes)';
    const room = cap - bytes(compose('')) - bytes(note);
    body = `${cutBytes(body, Math.max(0, room))}${note}`; text = compose(body); trimmed.push('phase brief');
  }
  return { text, bytes: bytes(text), maxBytes: cap, trimmed };
}

/**
 * The brief of a step-scoped launch (a parallel step, `claude-headless.sh --step`): only that step, what each of its
 * dependsOn steps produced (text, files, note, done) and the files it touches, plus the standing rules. The session works
 * in its step worktree on `<build-branch>--<step>`, ticks that one step and stops; the dispatcher merges it back.
 */
export function stepBriefFor(b, stepId, rules, { account = '', model = '' } = {}) {
  const st = (b.steps ?? []).find((x) => x.id === stepId);
  if (!st) throw Object.assign(new Error(`${b.id} has no step ${stepId}`), { code: 2 });
  const deps = BP.dependsOn(b, st).map((id) => b.steps.find((x) => x.id === id)).filter(Boolean);
  const branch = BP.stepBranch(b, st, { parallel: true }); const buildBranch = BP.stepBranch(b, st);
  const o = b.origin ?? {};
  const files = BP.stepFiles(st);
  return [
    `# Build: ${b.id} · step ${st.id} only`, '',
    saidBlock(o), '',
    '## What to build',
    `Continue build "${b.title}" (${b.id}) — one step only: ${st.id}, model ${st.model}. Other steps of this build run in other sessions at the same time; do only this one.`,
    `Rules: stay in this one session; no sub-agents; ≤ ${Math.min(10, Number(rules?.maxStepMinutes) || 10)} min; read only the files listed; stop when this step is done.`,
    `Look: ${orch.ASSET_RULE}`,
    `API: ${orch.API_RULE}`,
    '', `## Your step`,
    `[ ] ${st.id}${st.estimate ? ` (~${st.estimate})` : ''} ${st.text}`,
    files.length ? `Files it touches: ${files.join(', ')}. Change nothing else unless the step cannot be done without it; then say which file in a step note.` : 'Files it touches: not listed. Keep the change small and say which files you changed in a step note.',
    st.checks?.length ? `Checks: ${st.checks.join(' · ')}` : '',
    '', `## What it builds on (dependsOn)`,
    ...(deps.length ? deps.map((d) => `- ${d.id} ${d.done ? 'done' : d.skip ? 'skipped' : 'OPEN'}: ${d.text}${BP.stepFiles(d).length ? ` · files: ${BP.stepFiles(d).join(', ')}` : ''}${d.note ? ` · note: ${str(d.note, 400).replace(/\n/g, ' / ')}` : ''}`) : ['- nothing: this step starts from the build branch as it is']),
    `Their work is merged into ${buildBranch}, which this branch was made from.`,
    '', `## Pipeline`,
    `This step session was started by the orchestrator's dispatcher${account ? ` on Claude account ${account}` : ''}${model ? ` (${model})` : ''} in its own worktree on branch ${branch}. Commit on that branch and push it; never merge it into ${buildBranch} or main yourself: the dispatcher merges it back. When the step is done, tick it (node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step ${b.id} ${st.id} done) and stop. If you cannot finish, say why in a step note (orchestrator.mjs act note ${b.id} "${st.id}: …") and stop: the step goes back to ready.`,
  ].filter((l) => l !== '').join('\n').replace(/\n(## )/g, '\n\n$1');
}

/** Start one headless session for a queued build on an account. */
export function launch(b, { account, model, kind = '', phase = '', retry = '' }, { rules, env = process.env, launcher = env.AXF_PIPELINE_LAUNCHER || join(REPO_ROOT, 'deploy', 'claude-headless.sh') } = {}) {
  // Brett's stop (build-pipeline@1): no tick, retry or relaunch starts a held, cancelled or unqueued build
  if (BP.isStopped(b)) throw Object.assign(new Error(`${b.id} is ${BP.STOP_LABEL[BP.stopOf(b).kind].toLowerCase()}: only Brett starts it again (release or queue it)`), { code: 'stopped' });
  // vps-reaper@1: ghosts (finished sessions still running, dead slots, leftover servers) go before anything starts
  reapFirstSync('launch', { env });
  const { dir } = ensureWorktree(b.id, env);
  // the dispatch gate (build-lock@1): never a second session on a build or its worktree. Throws code 'live' (not a
  // launch failure) while a tmux session, a claude pid or a fresh lock says the build is still running.
  lock.acquire(b.id, { dir, account, by: 'dispatcher', env: lockEnv(env) });
  // the VPS's own 'before' rules (Build rules tab): run beside the launch, results in History
  runBuildRules(b.id, 'before', { env });
  const briefFile = join(dir, '.axf-brief.md');
  const fit = fitBriefFor(b, rules, { account, model, kind, retry, maxBytes: loadSettings(env).briefMaxBytes });
  if (fit.trimmed.length) {
    const why = `Launch brief trimmed to ${fit.bytes} bytes (cap ${fit.maxBytes}, builds.briefMaxBytes): ${fit.trimmed.join(', ')}.`;
    logLine({ event: 'brief-trimmed', build: b.id, bytes: fit.bytes, cap: fit.maxBytes, trimmed: fit.trimmed });
    process.stderr.write(`pipeline: ${b.id}: ${why}\n`);
    try { withStore((s) => { const r = storeCore.findBuild(s, b.id); if (r) { r.notes.push({ text: why, at: nowIso() }); r.updatedAt = nowIso(); } return s; }, { by: 'pipeline', action: 'pipeline:brief-trimmed', note: b.id }); } catch { /* the note is best effort */ }
  }
  writeFileSync(briefFile, `${fit.text}\n`);
  // the one way in: a dispatch token for this build only, spent by the launcher when the session starts
  const token = issueDispatch(b.id, { account, model, env });
  const key = modelKey(model) || 'opus';
  const args = ['--name', b.id, '--account', account, '--brief', '.axf-brief.md', '--log', `${b.id}.log`, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
  const e = { ...env, AXF_DISPATCH_TOKEN: token, AXF_SURFACE: 'pipeline', AXF_MODEL: key, AXF_BUILD_ID: b.id, AXF_BUILD_PHASE: str(phase, 80), AXF_CLAUDE_ACCOUNT: account, AXF_PRIORITY: slots.levelFor ? (['P0', 'P1', 'P2', 'P3'].includes(effectivePriority(b)) ? { P0: 'urgent', P1: 'high', P2: 'normal', P3: 'low' }[effectivePriority(b)] : 'normal') : 'normal' };
  let r;
  try { r = spawnSync('bash', [launcher, ...args], { cwd: dir, encoding: 'utf8', timeout: 180e3, env: e }); }
  catch (err) { lock.release(b.id, { dir }); throw err; }
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const session = /started (axf-\S+) in/.exec(text)?.[1] ?? /queued at position \d+ \((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
  const slot = /\((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
  if (r.status !== 0 || (!session && !/queued at position|queued for look approval/.test(text))) {
    lock.release(b.id, { dir });
    throw new Error(`launcher exit ${r.status}: ${str(text.trim().split('\n').filter(Boolean).pop() || 'no output', 300)}`);
  }
  lock.beat(b.id, { dir, session });
  return { dir, session, slot, queuedInSlots: /queued at position/.test(text), lookWait: /queued for look approval/.test(text), out: text.trim().slice(-600) };
}

// ------------------------------------------------------------------ session ends

/** Statuses a build already holds when its last step was ticked before the session ended (done-means-merged@1: landing / landed; built / complete legacy). */
const SETTLED = ['built', 'landing', 'landed', 'complete'];
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

/**
 * One run's end, written through the builds store (journalled): the exit transition (build-pipeline@1 nextStatusOnExit()
 * via pipeline-core endOutcome()) decides the status. A phase done with steps left goes back to the Queue at its place
 * with the note "phase <n> done, requeued for <model>"; Pending only when Brett is needed. `kind` is what the headless
 * wrapper reported (phase-done | crash | stopped, '' when only the exit code is known): a crash report is a crash
 * whatever the exit code says. A run that stopped on a Claude sign-in failure is held in Pending until the account
 * signs in again (authWaitsTick). `log` is the run's log file (for the failure reason), `vanished` = no end event at all.
 * Returns { id, outcome, status, reason, exit, phase, next, auth? }.
 */
/**
 * launch-retry: did this run die at launch (pipeline-core launchCrashOf)? Reads the run log's tail and whether the run's
 * stream file got any output since the launch (the launcher truncates it as claude starts). → { why } or null.
 */
export function launchCrashFor(b, { exit, kind = '', log = '', env = process.env } = {}) {
  const wt = worktreeOf(b.id, env);
  const logFile = log ? (log.startsWith('/') ? log : join(wt, log)) : join(wt, `${b.id}.log`);
  let streamBytes = -1;
  try {
    const st = statSync(join(wt, `${b.id}.jsonl`));
    // the launcher truncates it as claude starts: written since this launch and still empty = no first output;
    // older than this launch or missing = unknown (the run may not have reached the launcher at all)
    streamBytes = st.mtimeMs >= Date.parse(b.pipeline?.launchedAt || 0) - 5000 ? st.size : -1;
  } catch { streamBytes = -1; }
  return P.launchCrashOf({ exit, kind, tail: tailOf(logFile), streamBytes });
}

/**
 * A launch crash goes back to the Queue by itself after a backoff (1, 4, 16 min), outside the maxRuns cap, the reason
 * on the build. After LAUNCH_RETRY_MAX in a row it stops retrying: the record says gaveUp, a banner alert says why, and
 * the run is ended the normal way (returns null). Returns the endRun result when requeued.
 */
export function requeueLaunchCrash(b, why, { alert = () => {}, env = process.env, now = Date.now() } = {}) {
  const count = (b.pipeline?.launchRetry?.count ?? 0) + 1;
  const at = new Date(now).toISOString();
  if (count > BP.LAUNCH_RETRY_MAX) {
    setPipeline(b.id, { launchRetry: { count: count - 1, lastError: why, at, retryAt: '', gaveUp: true } }, { note: `Launch crashed again (${why}): ${count - 1} launch retries used, no more by itself. Retry by hand once the launcher error is fixed.`, action: 'pipeline:launch-retry' });
    alert('launch-crash', { id: b.id, title: b.title, count: count - 1, why, account: b.pipeline?.account });
    logLine({ event: 'launch-crash', build: b.id, count: count - 1, why, gaveUp: true });
    return null;
  }
  const mins = P.launchBackoffMin(count);
  const retryAt = new Date(now + mins * 60e3).toISOString();
  const runs = Math.max(0, (b.pipeline?.runs ?? 1) - 1); // a launch crash is not a run: it never counts towards maxRuns
  setPipeline(b.id, { session: '', slot: '', runs, launchRetry: { count, lastError: why, at, retryAt, gaveUp: false }, note: `launch crashed: retry ${count}/${BP.LAUNCH_RETRY_MAX} at ${retryAt}` },
    { status: 'queued', note: `Launch crashed (${why}). Back in the Queue: retry ${count} of ${BP.LAUNCH_RETRY_MAX} in ${mins} min (not counted as a run).`, action: 'pipeline:launch-retry' });
  lock.release(b.id, { dir: worktreeOf(b.id, env) });
  logLine({ event: 'launch-crash', build: b.id, count, why, retryAt });
  return { id: b.id, outcome: 'requeued', status: 'queued', reason: 'launch-crash', exit: null, phase: b.pipeline?.phase ?? '', next: BP.nextModel(b), launchRetry: { count, why, retryAt } };
}

export function endRun(b, { exit, kind = '', phase = '', log = '', vanished = false, alert = () => {}, settings = loadSettings(), env = process.env } = {}) {
  const settled = SETTLED.includes(b.status);
  // launch-retry: a run that died at launch is requeued with a backoff, separate from the maxRuns session cap
  let gaveUp = null;
  if (!settled) {
    const lc = launchCrashFor(b, { exit, kind, log, env });
    if (lc) { const rq = requeueLaunchCrash(b, lc.why, { alert, env }); if (rq) return rq; b = storeCore.findBuild(loadStore(), b.id) ?? b; gaveUp = b.pipeline?.launchRetry ?? null; }
  }
  // the wrapper's kind wins over the bare code: a crash is never a clean end; phase-done / stopped are clean ends whose
  // phase the store still has to confirm (a phase-done claim with its phase's steps open lands as 'stopped' in Pending)
  const code = kind === 'crash' ? (exit || 1) : kind === 'phase-done' || kind === 'stopped' ? 0 : exit;
  const r = P.endOutcome(phase && !b.pipeline?.phase ? { ...b, pipeline: { ...b.pipeline, phase } } : b, { exit: code, account: b.pipeline.account, session: b.pipeline.session }, settings);
  // a run that stopped on a Claude sign-in failure: held in Pending (a relaunch would hit the same login) until the
  // account signs in again, then re-queued once (authWaitsTick)
  const auth = !settled && r.outcome !== 'finished' && r.reason !== 'phase-done' ? P.authFailureOf(tailOf(log)) : '';
  if (auth) {
    r.status = 'pending';
    r.note = `${r.note} It stopped on a Claude login failure on ${b.pipeline.account || 'its account'}: ${auth}. Held in Pending: it goes back to the Queue by itself once the login works.`;
  }
  if (settled) { r.outcome = 'finished'; r.status = b.status; r.reason = 'all-done'; r.run = { ...r.run, outcome: 'finished', reason: 'all-done' }; r.note = `Session ${b.pipeline.session} on ${b.pipeline.account || '?'} ended (exit ${exit}); the build was already ${b.status}.`; }
  const next = BP.nextModel(b);
  const journal = r.reason === 'phase-done' && !auth ? `phase ${r.run.phase || '?'} done, requeued for ${next || '?'}: ${r.note}` : r.note;
  // a run cut off by the login is not the build's fault: it does not count towards maxRuns
  setPipeline(b.id, { ...r.patch, lastRun: r.run, note: r.outcome === 'finished' ? '' : r.note, launchRetry: gaveUp, ...(auth ? { runs: Math.max(0, (b.pipeline.runs || 1) - 1) } : {}) }, { status: r.status, note: journal, action: r.reason === 'phase-done' && !auth ? 'pipeline:requeue' : 'pipeline:end' });
  lock.release(b.id, { dir: worktreeOf(b.id, env) });
  // done-means-merged@1: a retry run that got its phase (or the whole build) done closes its attempt ok and the failure;
  // a run that failed again is closed as failed by the detector in the same tick (recordFailure)
  if (!auth && (r.reason === 'phase-done' || r.reason === 'all-done') && (b.attempts ?? []).some((a) => a.result === 'started')) closeAttempt(b.id, 'ok', r.note);
  // the build's end hook: the VPS's 'after' rules (home card, help stub, PR + link, THREADS, …) once a run ends
  if (!auth) runBuildRules(b.id, 'after', { env });
  if (auth) {
    authWait(b.id, { account: b.pipeline.account, error: auth, session: b.pipeline.session });
    alert('oauth', { id: b.id, title: b.title, account: b.pipeline.account, error: auth, everyMin: settings.healthEveryMin });
  } else {
    // a run that did not finish: the exact reason is the last error the run printed (a crash, a refused gate, a launcher error)
    const why = r.outcome === 'finished' ? '' : P.lastReasonOf(tailOf(log));
    alert(r.outcome === 'failed' ? 'failed' : 'ended', { id: b.id, title: b.title, outcome: r.outcome, note: why ? `${r.note}\nWhy: ${why}` : !vanished ? r.note : `${r.note}\nWhy: its session vanished without an end event (killed, or the VPS restarted).`, account: b.pipeline.account });
  }
  logLine({ event: 'ended', build: b.id, outcome: r.outcome, reason: r.reason, kind, exit, phase: r.run.phase, next, account: b.pipeline.account, session: b.pipeline.session, ...(auth ? { auth } : {}) });
  if (r.outcome === 'failed') crewSay('dispatcher', 'failed', `${b.id} failed: ${r.note}`, { ref: b.id });
  else if (r.outcome === 'returned' || auth) crewSay('dispatcher', 'waiting', `${b.id} stopped with steps left and is back in Pending. Brett, it needs you: ${r.note}`, { ref: b.id });
  else crewSay('dispatcher', 'done', `${b.id}: ${r.note}`, { ref: b.id });
  return { id: b.id, outcome: r.outcome, status: r.status, reason: r.reason, exit, phase: r.run.phase, next, ...(auth ? { auth } : {}) };
}

/** The build's worktree folder (where its lock lives). */
export const worktreeOf = (id, env = process.env) => join(worktreesRoot(env), id);
/** Anything alive for this build (build-lock@1: tmux axf-<id>*, claude pids in its worktree, a fresh lock). */
export function buildLive(id, { env = process.env, useLock = true } = {}) {
  return lock.liveness(id, { dir: worktreeOf(id, env), useLock, env: lockEnv(env) });
}

/** Running builds whose session ended: { id, outcome, status, reason, exit, auth? }. */
export function checkEnds({ alert = () => {}, env = process.env } = {}) {
  const store = loadStore(); const settings = loadSettings();
  const events = readEvents(env);
  const out = [];
  for (const b of live(store)) {
    // a build whose last step was ticked is already landing / landed when its session ends: close the run record, keep the status
    const settled = SETTLED.includes(b.status);
    if (!b.pipeline?.session || !(b.status === 'running' || b.status === 'waiting' || b.status === 'fixing' || settled)) continue;
    const since = Date.parse(b.pipeline.launchedAt || 0) - 5000;
    // an end already handled never ends the next run: session names repeat (axf-<build>--<agent>) and a retry may
    // relaunch within seconds of the last end (done-means-merged@1)
    const handled = Date.parse(b.pipeline.lastRun?.at || 0) || 0;
    const end = events.filter((e) => e.event === 'session-end' && e.session === b.pipeline.session && Date.parse(e.at || 0) >= since && Date.parse(e.at || 0) > handled).pop();
    let exit = null;
    if (end) exit = Number.isInteger(end.exit) ? end.exit : Number(end.exit) || 0;
    else {
      // no end event: the session may have died with tmux (a reboot, a kill). After a grace period, gone = a crash.
      const alive = tmuxHas(b.pipeline.session);
      if (alive !== false || Date.now() - Date.parse(b.pipeline.launchedAt || 0) < GONE_GRACE_MS) {
        if (alive) lock.beat(b.id, { dir: worktreeOf(b.id, env), session: b.pipeline.session });
        continue;
      }
      // its own tmux name is gone: dead only when no other session (a renamed duplicate) or claude pid is alive either
      const l = buildLive(b.id, { env, useLock: false });
      if (l.live) { logLine({ event: 'still-alive', build: b.id, session: b.pipeline.session, sessions: l.sessions, pids: l.pids }); continue; }
      exit = 1;
    }
    // its own session ended while parallel step sessions still work: the build stays in Building until they are done
    const stepLive = b.steps.filter((x) => !x.done && !x.skip && BP.claimLive(x.claim) && !str(x.claim.runId).startsWith('main:'));
    if (!settled && exit === 0 && stepLive.length) {
      const note = `Session ${b.pipeline.session} ended; ${stepLive.length} step${stepLive.length === 1 ? '' : 's'} still run${stepLive.length === 1 ? 's' : ''} in parallel (${stepLive.map((x) => x.id).join(', ')}): the build stays in Building and goes back to the Queue if steps are left when they finish.`;
      setPipeline(b.id, { session: '', slot: '', note: 'waiting on parallel steps' }, { status: b.status, note, action: 'pipeline:end' });
      logLine({ event: 'ended', build: b.id, outcome: 'parallel', exit, session: b.pipeline.session });
      out.push({ id: b.id, outcome: 'parallel', status: b.status, exit });
      continue;
    }
    out.push(endRun(b, { exit, kind: end?.kind || '', phase: end?.phase || '', log: end?.log || '', vanished: !end, alert, settings, env }));
  }
  return out;
}

// ------------------------------------------------------------------ fill every slot: parallel step sessions (BUILD-PARALLEL)

/**
 * The Claude settings the fill round follows (claude-settings registry, owner flags there): fillSlots (default on),
 * autoQueuePending (default off, Brett's click only), maxParallelPerBuild (default 3). Missing keys = defaults.
 */
export function fillSettings(env = process.env) {
  const v = claudeSettings(env);
  const n = Number(v['builds.maxParallelPerBuild']);
  return { fillSlots: v['builds.fillSlots'] !== false, autoQueuePending: v['builds.autoQueuePending'] === true, maxParallelPerBuild: Number.isInteger(n) && n >= 1 ? Math.min(12, n) : BP.FILL_DEFAULTS.maxParallelPerBuild };
}

/**
 * Fill every slot, read-only (the one handler behind REST GET /pipeline/fill, the plugin command pipeline-fill-status,
 * `pipeline.mjs fill status`, the voice action and agent-slots' `fill` view): the slots (one row per slot: which build
 * and step runs there, or free), the ready steps, what planFill would launch next (dry run), the settings and, with
 * `build`, that build's steps with their dependency state.
 */
export function fillStatus({ env = process.env, build = '', now = Date.now() } = {}) {
  const store = loadStore(); const state = loadState(); const fill = fillSettings(env); const sl = slotsNow();
  const inputs = fillInputs({ store, state, env, fill, sl, now });
  const plan = BP.planFill(inputs);
  plan.waits.push(...P.clashWaits(inputs.running, now));
  const sessions = stepRecs(state);
  const rows = (sl.running ?? []).map((r, i) => {
    const rec = Object.values(sessions).find((x) => (r.session && x.session === r.session) || (r.build && x.id === r.build && r.step && x.step === r.step));
    return { n: i + 1, id: r.id, name: r.name, build: r.build || rec?.id || '', step: r.step || rec?.step || '', state: r.state, session: r.session || '', since: r.startedAt || '', main: !(r.step || rec) };
  });
  const cap = Number(sl.cap) || rows.length;
  for (let i = rows.length; i < cap; i++) rows.push({ n: i + 1, id: '', name: '', build: '', step: '', state: 'free', session: '', since: '', main: false });
  const slotOf = (ri) => rows.find((r) => (ri.slot && r.id === ri.slot) || (ri.session && r.session === ri.session))?.n ?? 0;
  const ready = inputs.running.flatMap((b) => BP.readySteps(b, { now }).map((st) => ({ id: b.id, step: st.id, text: str(st.text, 200), model: st.model, parallel: BP.isParallelStep(st), files: BP.stepFiles(st) })));
  const parallelOf = (b) => b.steps.filter((x) => !x.done && !x.skip && BP.claimLive(x.claim, now) && !str(x.claim.runId).startsWith('main:')).length;
  const builds = inputs.running.map((b) => ({ id: b.id, title: str(b.title, 160), parallel: parallelOf(b), cap: b.pipeline?.maxParallel > 0 ? b.pipeline.maxParallel : fill.maxParallelPerBuild }));
  const one = build ? storeCore.findBuild(store, build) : null;
  if (build && !one) throw Object.assign(new Error(`no build "${build}"`), { code: 2 });
  return {
    ok: true, at: new Date(now).toISOString(), settings: fill,
    slots: { cap, used: Number(sl.used) || 0, free: Number(sl.free) || 0, ...(sl.hard?.max ? { hard: { max: sl.hard.max, live: sl.hard.live, free: sl.hard.free } } : {}), rows },
    ready, builds, plan: { launches: plan.launches, waits: plan.waits, free: plan.free, blocked: plan.blocked }, sessions: Object.entries(sessions).map(([runId, r]) => ({ runId, ...r })),
    ...(one ? { build: { id: one.id, title: one.title, status: one.status, branch: BP.stepBranch(one, null), steps: P.stepStates(P.withMainClaim(one, now), { now, root: worktreesRoot(env), sessions, slotOf }) } } : {}),
  };
}

/**
 * One dispatcher round now (REST POST /pipeline/fill/run, pipeline-fill-run, `pipeline.mjs fill run`, voice). On the VPS
 * host (it sees the Claude logins) the tick runs at once and its fill part is returned; elsewhere (the console's
 * container) the request is filed and the host's dispatcher runs it on its next minute. → { ok, ran, requested, fill }
 */
export function fillRun({ env = process.env, by = process.env.AXF_ACTOR || 'console' } = {}) {
  if (!seesAccounts(env) && !env.AXF_PIPELINE_FILL_RUN_HERE) {
    const r = { at: nowIso(), by: str(by, 80) }; writeJson(files().fillRequest, r);
    return { ok: true, ran: false, requested: r.at, note: "filed: the dispatcher on the VPS runs a round within a minute" };
  }
  const t = tick({ env });
  try { rmSync(files().fillRequest, { force: true }); } catch { /* none */ }
  return { ok: true, ran: true, at: t.at, launched: t.launched.map((l) => ({ id: l.id, account: l.account, model: l.model })), fill: { launched: t.fill.launched.map((l) => ({ id: l.id, step: l.step, account: l.account, session: l.session })), ended: t.fill.ended, autoQueued: t.fill.autoQueued ?? [], plan: t.fill.plan ? { launches: t.fill.plan.launches, waits: t.fill.plan.waits, free: t.fill.plan.free, blocked: t.fill.plan.blocked } : null } };
}

/**
 * Set one step's dependsOn (REST POST /builds/:id/steps/:step/deps, pipeline-step-deps, `pipeline.mjs fill deps`,
 * voice). `deps` = step ids of the same build ([] = independent), or null / 'sequential' = no list (it waits for the
 * step before it, as before). Refused: an unknown id, the step itself, a settled step's list, or a cycle.
 */
export function setStepDeps(id, stepId, deps, { by = process.env.AXF_ACTOR || 'console' } = {}) {
  let out = null;
  withStore((s) => {
    const rec = storeCore.findBuild(s, id); if (!rec) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    const st = rec.steps.find((x) => x.id === stepId); if (!st) throw Object.assign(new Error(`${id} has no step ${stepId}`), { code: 2 });
    if (st.done || st.skip) throw Object.assign(new Error(`${id} ${stepId} is ${st.done ? 'done' : 'skipped'}: its dependencies no longer matter`), { code: 2 });
    const seq = deps == null || deps === 'sequential';
    const list = seq ? null : (Array.isArray(deps) ? deps : String(deps).split(/[\s,]+/)).map((x) => str(x, 40).trim()).filter(Boolean);
    if (list) {
      if (list.includes(stepId)) throw Object.assign(new Error(`${stepId} cannot wait on itself`), { code: 2 });
      const bad = list.filter((x) => !rec.steps.some((y) => y.id === x)); if (bad.length) throw Object.assign(new Error(`${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a step of ${id}`), { code: 2 });
    }
    const before = BP.dependsOn(rec, st);
    if (seq) delete st.after; else st.after = [...new Set(list)].slice(0, 20);
    const cyc = storeCore.dependencyCycles(rec);
    if (cyc.length) throw Object.assign(new Error(`that makes a dependency cycle: ${cyc[0].join(' → ')}`), { code: 2 });
    const now = nowIso(); st.updatedAt = now; rec.updatedAt = now;
    const after = BP.dependsOn(rec, st);
    rec.notes.push({ text: `${stepId} dependencies set by ${str(by, 80)}: ${seq ? `sequential (after ${after.join(', ') || 'nothing'})` : after.length ? `after ${after.join(', ')}` : 'independent'} (was ${before.join(', ') || 'none'})`, at: now });
    out = { ok: true, id: rec.id, step: stepId, dependsOn: after, explicit: seq ? null : st.after, parallel: BP.isParallelStep(st) };
    return s;
  }, { by, action: 'pipeline:step-deps', note: `${id}/${stepId}` });
  return out;
}

/** One line per slot and per planned launch, for the CLI and agent-slots' `fill` view. */
export function fillLines(f) {
  const L = [`slots ${f.slots.used}/${f.slots.cap} · ${f.slots.free} free · fill every slot ${f.settings.fillSlots ? 'on' : 'off'} · max ${f.settings.maxParallelPerBuild} parallel steps per build · auto-queue pending ${f.settings.autoQueuePending ? 'on' : 'off'}`];
  for (const r of f.slots.rows) L.push(`  slot ${r.n}: ${r.state === 'free' ? 'free' : `${r.build || r.name}${r.step ? ` ${r.step}` : ''} (${r.state})`}`);
  L.push(f.plan.launches.length ? 'next (dry run):' : `next (dry run): nothing${f.plan.blocked ? ` (${f.plan.blocked})` : ''}`);
  for (const l of f.plan.launches) L.push(`  ${l.kind} ${l.id}${l.step ? ` ${l.step}` : ''} on ${l.account} (${l.model}): ${l.why}`);
  for (const w of f.plan.waits.slice(0, 12)) L.push(`  waits ${w.id}${w.step ? ` ${w.step}` : ''}: ${w.why}`);
  if (f.build) for (const st of f.build.steps) L.push(`  ${f.build.id} ${st.id} ${st.state}${st.why ? ` (${st.why})` : ''}${st.dependsOn.length ? ` after ${st.dependsOn.join(', ')}` : ''}`);
  return L.join('\n');
}

/** The step sessions the dispatcher started and still watches: state.steps = { <runId>: { id, step, session, slot, account, model, dir, branch, launchedAt, merging } }. */
const stepRecs = (state) => (state.steps && typeof state.steps === 'object' ? state.steps : (state.steps = {}));
const runKey = (id, step) => `${id}/${step}`;

/** The planner's inputs from the store, the slots, the accounts and the step sessions running now. */
export function fillInputs({ store, state, env = process.env, settings = loadSettings(env), fill = fillSettings(env), sl = slotsNow(), launchedNow = 0, now = Date.now() } = {}) {
  const builds = runnable(store);
  const running = builds.filter((b) => b.status === 'running' || b.status === 'waiting').map((b) => P.withMainClaim(b, now));
  const accounts = accountsRead(store, settings, env).accounts.map((a) => ({ ...a }));
  // step sessions are not in pipeline.account: count them on their accounts
  for (const r of Object.values(stepRecs(state))) { const a = accounts.find((x) => x.name === r.account); if (a && !r.merging) { a.running += 1; a.free = Math.max(0, a.free - 1); } }
  const slotsView = { ...sl, free: Math.max(0, (Number(sl.free) || 0) - launchedNow) };
  return { slots: slotsView, accounts, running, queue: [], pending: [], settings: { maxParallelPerBuild: fill.maxParallelPerBuild, autoQueuePending: false, apiOverflow: settings.apiOverflow !== false }, now };
}

/**
 * Start one parallel step session (a planFill `step` launch): claim the step on the build (builds-live carries it to
 * main at once), make its step worktree off the build branch, write the step-scoped brief and start
 * `claude-headless.sh --step` there, which books its own agent slot and passes the per-step model gate. A launch that
 * fails gives the claim back. → { runId, session, slot, dir, branch }
 */
export function launchStep(b, item, { rules, env = process.env, launcher = env.AXF_PIPELINE_LAUNCHER || join(REPO_ROOT, 'deploy', 'claude-headless.sh') } = {}) {
  const runId = `step-${str(b.id, 40)}-${item.step}-${Date.now().toString(36)}`;
  let claimed = null;
  withStore((s) => {
    const rec = storeCore.findBuild(s, b.id); if (!rec) { claimed = { ok: false, why: `no build ${b.id}` }; return s; }
    claimed = BP.claimStep(rec, item.step, { runId, account: item.account, branch: item.branch, model: item.model });
    if (claimed.ok) Object.assign(rec, claimed.build);
    return s;
  }, { by: 'dispatcher', action: 'pipeline:step-claim', note: `${b.id}/${item.step}` });
  if (!claimed?.ok) throw new Error(`claim refused: ${claimed?.why ?? 'unknown'}`);
  const release = (why) => withStore((s) => { const rec = storeCore.findBuild(s, b.id); const r = rec && BP.releaseStep(rec, item.step, { runId, note: why }); if (r?.ok) Object.assign(rec, r.build); return s; }, { by: 'dispatcher', action: 'pipeline:step-release', note: `${b.id}/${item.step}` });
  try {
    const fresh = storeCore.findBuild(loadStore(), b.id);
    const w = ensureStepWorktree(fresh, item.step, env);
    writeFileSync(join(w.dir, '.axf-brief.md'), `${stepBriefFor(fresh, item.step, rules, { account: item.account, model: item.model })}\n`);
    const token = issueDispatch(b.id, { account: item.account, model: item.model, env });
    const key = modelKey(item.model) || 'opus';
    const args = ['--name', b.id, '--step', item.step, '--account', item.account, '--brief', '.axf-brief.md', '--log', `${b.id}--${item.step}.log`, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
    const e = { ...env, AXF_DISPATCH_TOKEN: token, AXF_SURFACE: 'pipeline', AXF_MODEL: key, AXF_BUILD_ID: b.id, AXF_STEP_ID: item.step, AXF_STEP_BRIEF: 'off', AXF_CLAUDE_ACCOUNT: item.account };
    const r = spawnSync('bash', [launcher, ...args], { cwd: w.dir, encoding: 'utf8', timeout: 180e3, env: e });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const session = /started (axf-\S+) in/.exec(text)?.[1] ?? '';
    const slot = /\((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
    if (r.status !== 0 || (!session && !/queued at position/.test(text))) throw new Error(`launcher exit ${r.status}: ${str(text.trim().split('\n').filter(Boolean).pop() || 'no output', 300)}`);
    if (slot) withStore((s) => { const st = storeCore.findBuild(s, b.id)?.steps.find((x) => x.id === item.step); if (st?.claim?.runId === runId) st.claim.slot = slot; return s; }, { by: 'dispatcher', action: 'pipeline:step-slot', note: `${b.id}/${item.step}` });
    return { runId, session, slot, dir: w.dir, branch: w.branch, queuedInSlots: /queued at position/.test(text) };
  } catch (err) { release(`launch failed: ${str(err.message, 200)}`); throw err; }
}

/**
 * Step sessions that ended (an end event, or tmux gone past the grace period): a ticked step is merged back
 * (mergeStepBack; deferred = tried again next tick); an unticked one is a crash: its claim goes, the step is ready again,
 * and after STEP_MAX_RUNS runs it is left to the build's own session (parallel: never) with a note. Live sessions get
 * their claim renewed (a step may outlive the 45-minute TTL). → [{ id, step, outcome }]
 */
export function checkStepEnds({ state, env = process.env, alert = () => {}, now = Date.now() } = {}) {
  const recs = stepRecs(state); const events = readEvents(env); const out = [];
  state.stepRuns = state.stepRuns && typeof state.stepRuns === 'object' ? state.stepRuns : {};
  for (const [runId, r] of Object.entries(recs)) {
    const b = storeCore.findBuild(loadStore(), r.id); const st = b?.steps.find((x) => x.id === r.step);
    if (!b || !st || b.deleted) { delete recs[runId]; continue; }
    if (r.merging || (st.done && !r.session)) {
      const m = mergeStepBack(r.id, r.step, { env });
      if (!m.deferred) { delete recs[runId]; out.push({ id: r.id, step: r.step, outcome: m.merged ? 'merged' : 'conflict', why: m.why }); if (m.conflict) alert('step-conflict', { id: r.id, step: r.step, note: m.why }); }
      continue;
    }
    const since = Date.parse(r.launchedAt || 0) - 5000;
    const end = events.filter((e) => e.event === 'session-end' && Date.parse(e.at || 0) >= since && (e.session === r.session || (e.step === r.step && str(e.name).startsWith(r.id)))).pop();
    let exit = null;
    if (end) exit = Number.isInteger(end.exit) ? end.exit : Number(end.exit) || 0;
    else {
      const alive = r.session ? tmuxHas(r.session) : null;
      if (alive !== false || now - Date.parse(r.launchedAt || 0) < GONE_GRACE_MS) {
        // still working: keep its claim alive past the TTL
        if (!st.done) withStore((s) => { const rec = storeCore.findBuild(s, r.id); const c = rec && BP.claimStep(rec, r.step, { runId, slot: r.slot, account: r.account, branch: r.branch, model: r.model, now }); if (c?.ok) Object.assign(rec, c.build); return s; }, { by: 'dispatcher', action: 'pipeline:step-renew', note: `${r.id}/${r.step}` });
        continue;
      }
      exit = 1;
    }
    if (st.done) { r.merging = true; r.session = ''; const m = mergeStepBack(r.id, r.step, { env }); if (!m.deferred) delete recs[runId]; out.push({ id: r.id, step: r.step, outcome: m.deferred ? 'merge-deferred' : m.merged ? 'merged' : 'conflict', why: m.why }); if (m.conflict) alert('step-conflict', { id: r.id, step: r.step, note: m.why }); continue; }
    const k = runKey(r.id, r.step); const runs = (state.stepRuns[k] ?? 0);
    const last = runs >= P.STEP_MAX_RUNS;
    const note = last ? `step session ${r.session || runId} ended (exit ${exit}) without ticking ${r.step}: ${runs} runs, left to the build's own session` : `step session ${r.session || runId} ended (exit ${exit}) without ticking ${r.step}: ready again (run ${runs} of ${P.STEP_MAX_RUNS})`;
    withStore((s) => {
      const rec = storeCore.findBuild(s, r.id); if (!rec) return s;
      const rel = BP.releaseStep(rec, r.step, { runId, note }); if (rel.ok) Object.assign(rec, rel.build);
      if (last) { const x = rec.steps.find((y) => y.id === r.step); if (x) x.parallel = 'never'; }
      rec.notes.push({ text: `${r.step}: ${note}`, at: nowIso() }); rec.updatedAt = nowIso();
      return s;
    }, { by: 'dispatcher', action: 'pipeline:step-end', note: `${r.id}/${r.step}` });
    delete recs[runId];
    if (last) delete state.stepRuns[k];
    out.push({ id: r.id, step: r.step, outcome: last ? 'gave-up' : 'requeued', exit });
    logLine({ event: 'step-ended', build: r.id, step: r.step, exit, runs, last });
  }
  return out;
}

// ------------------------------------------------------------------ failure detector (done-means-merged@1, s7)

/** The retry policy: the done-means-merged build rule's settings when it has them, else the defaults (retry-policy@1). */
export function retryPolicy() {
  // vps-never-gives-up: the caps never cut the ladder short; only a ladder with no rung left gives up
  const ceil = { maxAttempts: RL.MAX_ATTEMPTS_RANGE[1], maxTotal: RL.MAX_TOTAL_RANGE[1] };
  try { const r = BR.load().store.rules.find((x) => x.id === 'done-means-merged'); return P.exhaustPolicy(RL.normPolicy(r?.settings ?? {}), r?.settings ?? {}, ceil); } catch { return P.exhaustPolicy(RL.normPolicy({}), {}, ceil); }
}
/** The auto-lander's land.json items by build id (the merge-queue provider's data; found by capability, never by folder). */
export function landItems(env = process.env) {
  let dir = env.AXF_PUSH_BANNER_DIR || '';
  if (!dir) {
    const plugins = join(REPO_ROOT, 'apps/console-web/plugins');
    try {
      for (const d of readdirSync(plugins).sort()) {
        const m = readJson(join(plugins, d, 'plugin.json'));
        if (m && Array.isArray(m.provides) && m.provides.includes('service:axf.merge-queue@1') && m.lifecycle?.dataDir) { dir = join(env.AXF_CONSOLE_ROOT || REPO_ROOT, m.lifecycle.dataDir); break; }
      }
    } catch { /* no plugins folder: no lander */ }
  }
  const items = dir ? readJson(join(dir, 'land.json'), {})?.items : [];
  return new Map((Array.isArray(items) ? items : []).filter((x) => x?.id).map((x) => [x.id, x]));
}
/**
 * The newest sign of life of a build's run: a store write, its launch, its run log / stream file. Not the build lock's
 * heartbeat: checkEnds beats it whenever the tmux session exists, so a hung session would look alive for ever.
 */
export function beatOf(b, env = process.env) {
  const ts = [b.updatedAt, b.pipeline?.launchedAt];
  const wt = worktreeOf(b.id, env);
  for (const f of [join(wt, `${b.id}.log`), join(wt, `${b.id}.jsonl`)]) { try { ts.push(statSync(f).mtime.toISOString()); } catch { /* none */ } }
  return ts.filter((t) => t && Number.isFinite(Date.parse(t))).sort().pop() || '';
}

/**
 * land-clash bounce (pipeline-core clashBounceStep): append the merge-main step (Opus, deduped by its text) to a build
 * with every step done, move it back to the Queue (runs reset, the open failure cleared) and record pipeline.bounce
 * { at, why, head, files, step, count }. Returns { id, step, status } or null when there is nothing to add.
 */
export function bounceClash(id, { files = [], head = '', why = '', now = Date.now(), by = 'pipeline' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  const st = P.clashBounceStep(b, { files, head });
  if (!st) return null;
  const at = new Date(now).toISOString();
  let added = null;
  withStore((s) => {
    const r = storeCore.findBuild(s, id); if (!r) return s;
    const again = P.clashBounceStep(r, { files, head }); if (!again) return s; // a writer got there first
    const taken = new Set(r.steps.map((x) => x.id)); let k = r.steps.length + 1; while (taken.has(`s${k}`)) k += 1;
    added = storeCore.normStep({ ...again, id: `s${k}`, createdAt: at }, r.steps.length, { now: at });
    r.steps.push(added);
    r.status = 'queued'; r.builtAt = ''; delete r.failure;
    r.pipeline = BP.normPipeline({ ...(r.pipeline ?? {}), queuedAt: r.pipeline?.queuedAt || at, session: '', slot: '', runs: 0, crashes: 0, note: `clash with main: ${added.id} merges main in`,
      bounce: { at, why: str(why || `merging main in conflicts in ${files.join(', ') || 'code'}`, 300), head, files, step: added.id, count: (r.pipeline?.bounce?.count ?? 0) + 1 } }) ?? r.pipeline;
    r.notes.push({ text: `Clashes with main${files.length ? ` in ${files.slice(0, 6).join(', ')}` : ''}: added ${added.id} (merge main in, resolve, push) and moved it back to the Queue.`, at });
    r.updatedAt = at;
    return s;
  }, { by, action: 'pipeline:clash-bounce', note: id });
  if (!added) return null;
  logLine({ event: 'clash-bounce', build: id, step: added.id, head, files });
  crewSay('dispatcher', 'start', `${id} clashes with main: added "${str(added.text, 120)}" and put it back in the Queue.`, { ref: id });
  return { id, step: added.id, text: added.text, status: 'queued' };
}

/**
 * The clash a build's branch has with main right now, worked out by git itself (merge-tree, nothing checked out):
 * { files, head, clash } (clash false = it merges clean). Fetches main and the branch first.
 */
export function clashOf(b, { cwd = REPO_ROOT } = {}) {
  const branch = str(b.branch, 200) || `claude/${b.id}`;
  spawnSync('git', ['fetch', '-q', 'origin', 'main', branch], { cwd, encoding: 'utf8', timeout: 120e3 });
  const head = (spawnSync('git', ['rev-parse', `origin/${branch}`], { cwd, encoding: 'utf8' }).stdout || '').trim();
  if (!head) throw Object.assign(new Error(`${b.id}: no branch origin/${branch}`), { code: 2 });
  const r = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'origin/main', `origin/${branch}`], { cwd, encoding: 'utf8', timeout: 120e3 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git merge-tree failed: ${str(r.stderr, 300)}`);
  const files = r.status === 1 ? r.stdout.split('\n').slice(1).map((x) => x.trim()).filter(Boolean) : [];
  return { files, head, clash: r.status === 1 };
}

/** Clear a build's launch-retry record (a given-up one too) and put it back in the Queue now: the hand's Retry. */
export function requeueLaunch(id, { by = 'cli' } = {}) {
  const b = storeCore.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  if (SETTLED.includes(b.status) || ['running', 'archived'].includes(b.status)) throw Object.assign(new Error(`${b.id} is ${b.status}: nothing to requeue`), { code: 2 });
  setPipeline(b.id, { launchRetry: null, session: '', slot: '', queuedAt: b.pipeline?.queuedAt || nowIso() }, { status: 'queued', note: `Requeued by ${by}: launch retries reset${b.pipeline?.launchRetry?.lastError ? ` (last launch error: ${b.pipeline.launchRetry.lastError})` : ''}.`, by, action: 'pipeline:requeue-launch' });
  return { id: b.id, status: 'queued' };
}

/** What the dispatcher knows about a build's launches, crashes and bounces (readable through REST / MCP / CLI / voice). */
export function launchState(b) {
  const p = b.pipeline ?? {};
  return { id: b.id, status: b.status, runs: p.runs ?? 0, crashes: p.crashes ?? 0, lastRun: p.lastRun ?? null, launchRetry: p.launchRetry ?? null,
    lastLaunchError: p.launchRetry?.lastError ?? '', retries: p.launchRetry?.count ?? 0, retryAt: p.launchRetry?.retryAt ?? '', gaveUp: p.launchRetry?.gaveUp === true,
    bounce: p.bounce ?? null, bounceReason: p.bounce?.why ?? '' };
}

/**
 * Classify every build the server still owes work on (pipeline-core classifyFailure): a crash, red CI, a clash, a push
 * that failed, a stalled run, a build that fell back to Pending. Each one found is written on the build in one journalled
 * store write (failure, status fixing, the open attempt closed, a note) and logged. → [{ id, failure }]
 */
export function detectFailures({ ended = [], env = process.env, now = Date.now(), policy = retryPolicy(), land = landItems(env) } = {}) {
  const store = loadStore();
  const endedBy = new Map(ended.map((e) => [e.id, e]));
  const found = [];
  for (const b of store.builds) {
    if (b.deleted) continue;
    const f = P.classifyFailure(b, { ended: endedBy.get(b.id) ?? null, land: land.get(b.id) ?? null, beatAt: beatOf(b, env), now, stalledAfterMin: policy.stalledAfterMin });
    if (!f) continue;
    // land-clash bounce: a done build that clashes with main gets a merge-main step and goes back to the Queue (the
    // dispatcher runs it) instead of sitting in fixing; only a live lander fix agent on this very head is waited for
    if (f.kind === 'clash') {
      const li = land.get(b.id) ?? null;
      const open = b.pipeline?.bounce?.step && b.steps.some((x) => x.id === b.pipeline.bounce.step && !x.done && !x.skip);
      if (open) continue; // already bounced: its merge-main step is queued or running
      if (P.landerAgentLive(li, { now, attemptTimeoutMin: policy.attemptTimeoutMin })) continue;
      const bounced = bounceClash(b.id, { files: li?.reason?.files ?? [], head: li?.head || f.head || '', why: f.why, now });
      if (bounced) continue;
    }
    found.push({ id: b.id, failure: f });
  }
  if (!found.length) return [];
  const at = new Date(now).toISOString();
  withStore((s) => {
    for (const { id, failure } of found) { const b = storeCore.findBuild(s, id); if (b) { P.recordFailure(b, failure, { at }); b.updatedAt = at; } }
    return s;
  }, { by: 'pipeline', action: 'pipeline:failure', note: found.map((x) => `${x.id}:${x.failure.kind}`).join(' ') });
  for (const { id, failure } of found) {
    logLine({ event: 'failure', build: id, kind: failure.kind, why: failure.why, step: failure.step, head: failure.head });
    crewSay('dispatcher', 'blocked', `${id}: ${failure.kind} (${str(failure.why, 160)}). Fixing it.`, { ref: id });
  }
  return found;
}

// ------------------------------------------------------------------ retry runner (done-means-merged@1, s8)

/**
 * Answer every fixing build with the retry ladder (framework/core/retry-ladder.mjs): the next strategy, then a relaunch
 * through deploy/claude-headless.sh with the strategy in the brief (retry, a fix addendum, a fresh session, another
 * model at or under the step's pin, another account). Each relaunch opens an attempt@1 (result started) on the build;
 * the run's end closes it (endRun: ok; the detector: failed). A PR-side failure the auto-lander still owns, an attempt
 * in flight and a backoff are waits; a ladder that ran out escalates (status escalated + the escalation record).
 * → [{ id, action: launched | wait | lander | escalated | failed, strategy?, account?, model?, why? }]
 */
export function retryFixing({ env = process.env, accounts = [], settings = loadSettings(), rules = rulesOf(loadStore()), policy = retryPolicy(), land = landItems(env), now = Date.now(), alert = () => {}, only = '', force = '' } = {}) {
  const store = loadStore(); const at = new Date(now).toISOString();
  const out = [];
  for (const b of store.builds) {
    if (b.deleted || b.status !== 'fixing' || (only && b.id !== only)) continue;
    const f = BP.normFailure(b.failure);
    if (!f) continue;
    if (!force && P.landerOwns(b, f, land.get(b.id), { now, attemptTimeoutMin: policy.attemptTimeoutMin })) { out.push({ id: b.id, action: 'lander', why: 'the auto-lander is fixing it on the PR' }); continue; }
    const pinned = BP.nextModel(b) || b.pipeline?.model || 'Opus';
    const usable = accounts.filter((a) => a.usable !== false).map((a) => a.name);
    let d = RL.nextStrategy(b.attempts, f, policy, { at, pinnedModel: pinned, model: b.pipeline?.model || pinned, account: b.pipeline?.account || '', accounts: usable });
    if (force) {
      // a rung picked by hand (retryBuild): runs now, never above the step's pin
      const [st, fx = ''] = force.split(':');
      d = { ...d, strategy: st, fixStrategy: st === 'fix' ? fx || 'targeted' : '', rung: force, inFlight: false, escalate: false, notBefore: '', model: st === 'switch-model' ? (d.model && d.strategy === 'switch-model' ? d.model : pinned) : (b.pipeline?.model && RL.REGISTRY.modelRank[b.pipeline.model] <= RL.REGISTRY.modelRank[pinned] ? b.pipeline.model : pinned), account: st === 'switch-account' ? usable.find((a) => a !== b.pipeline?.account) || '' : '', reason: `Picked by hand: ${force}.` };
    }
    if (d.inFlight) { out.push({ id: b.id, action: 'wait', why: d.reason }); continue; }
    if (d.escalate) { out.push({ id: b.id, action: 'escalated', why: d.reason, ...escalateBuild(b.id, f, { at, policy, alert }) }); continue; }
    if (d.notBefore && Date.parse(d.notBefore) > now) { out.push({ id: b.id, action: 'wait', why: `backoff until ${d.notBefore}` }); continue; }
    const model = d.model || pinned;
    const options = d.strategy === 'switch-account' && d.account
      ? [{ account: d.account, kind: 'subscription' }]
      : [...(d.account ? [{ account: d.account, kind: 'subscription' }] : []), ...P.routeOptions(b, accounts, model, settings)].filter((o, i, arr) => arr.findIndex((x) => x.account === o.account) === i);
    if (!options.length) { out.push({ id: b.id, action: 'wait', why: `no account can take ${model} now` }); continue; }
    const retry = P.retryAddendum(d, f, b.attempts);
    let r = null; let used = null; let lastErr = null;
    for (const o of options.slice(0, MAX_PICK_TRIES)) {
      try { r = launch(b, { account: o.account, model, kind: o.kind, phase: b.pipeline?.phase || '', retry }, { rules, env }); used = o; break; }
      catch (e) { lastErr = e; if (e.code === 'live') break; }
    }
    if (!r) {
      out.push({ id: b.id, action: lastErr?.code === 'live' ? 'wait' : 'failed', why: str(lastErr?.message || 'no account accepted the relaunch', 300) });
      logLine({ event: 'retry-launch-failed', build: b.id, strategy: d.strategy, error: str(lastErr?.message, 300) });
      continue;
    }
    const attempt = P.attemptOf(d, f, { at, account: used.account, model, session: r.session, pr: Number(String(b.pr || '').replace(/\D/g, '')) || 0 });
    withStore((s) => {
      const rec = storeCore.findBuild(s, b.id); if (!rec) return s;
      rec.attempts = BP.normAttempts([...(rec.attempts ?? []), attempt]);
      const n = rec.attempts.length;
      rec.pipeline = BP.normPipeline({ ...(rec.pipeline ?? {}), account: used.account, session: r.session, slot: r.slot, model, launchedAt: at, dispatchedAt: at, runs: (rec.pipeline?.runs ?? 0) + 1, note: `attempt ${n}: ${d.strategy}${d.fixStrategy ? ` (${d.fixStrategy})` : ''}` }) ?? rec.pipeline;
      rec.notes.push({ text: `Attempt ${n}: ${d.strategy}${d.fixStrategy ? ` (${d.fixStrategy})` : ''} on ${used.account} (${model}): ${r.session || 'queued in agent slots'}. ${d.reason}`, at });
      rec.updatedAt = at;
      return s;
    }, { by: 'pipeline', action: 'pipeline:retry', note: `${b.id} ${d.strategy}` });
    logLine({ event: 'retry', build: b.id, kind: f.kind, strategy: d.strategy, fixStrategy: d.fixStrategy, account: used.account, model, session: r.session, n: d.n });
    try {
      const lad = RL.ladderFor(f.kind, policy); const cur = d.strategy === 'fix' ? `fix:${d.fixStrategy || 'targeted'}` : d.strategy;
      const left = lad.slice(lad.indexOf(cur) + 1).filter((x) => x !== 'escalate');
      alert('attempt', { id: b.id, title: b.title, n: d.n, kind: f.kind, why: f.why, step: f.step, strategy: d.strategy, fixStrategy: d.fixStrategy, account: used.account, model, left });
    } catch (e) { logLine({ event: 'attempt-alert-failed', build: b.id, error: str(e.message, 300) }); }
    crewSay('dispatcher', 'start', `${b.id}: attempt ${d.n} (${d.strategy}${d.fixStrategy ? `: ${d.fixStrategy}` : ''}) on ${used.account}, ${model}.`, { ref: b.id });
    out.push({ id: b.id, action: 'launched', strategy: d.strategy, fixStrategy: d.fixStrategy, account: used.account, model, session: r.session });
  }
  return out;
}

/** Close a build's open attempt (result ok clears the open failure too). */
export function closeAttempt(id, result, note = '', { at = nowIso(), by = 'pipeline' } = {}) {
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) return s;
    const list = BP.normAttempts(b.attempts); const a = list.find((x) => x.result === 'started');
    if (!a) return s;
    a.result = result; a.endedAt = at; a.note = str(`${a.note ? `${a.note} ` : ''}${result === 'ok' ? 'Ok' : 'Ended'}: ${note}`, 600);
    b.attempts = list;
    if (result === 'ok') { b.failure = null; b.notes.push({ text: `Attempt ${a.n} (${a.strategy}) worked: ${str(note, 300)}`, at }); }
    b.updatedAt = at;
    return s;
  }, { by, action: 'pipeline:attempt', note: `${id} ${result}` });
}

/** The systems check item escalated builds show on (health@1, registered by the plugin's server). */
export const ESCALATION_BANNER = 'builds-escalated';

/**
 * The ladder ran out: status escalated with the escalation record, the systems check item (health@1 `builds-escalated`,
 * red while any build is escalated, with Retry) and ONE phone push for this escalation (alert pipeline:escalated:<id>:<at>,
 * notify type pipeline.escalated). pushedAt on the record means it went: the same escalation is never pushed again.
 */
export function escalateBuild(id, f, { at = nowIso(), policy = retryPolicy(), by = 'pipeline', alert = () => {} } = {}) {
  let esc = null; let fresh = false; let title = id; let since = '';
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) return s;
    title = b.title || id;
    if (b.status === 'escalated' && b.escalation) { esc = b.escalation; return s; }
    esc = { ...RL.escalationOf(b.attempts, f, { at, policy, head: f.head }), bannerId: ESCALATION_BANNER };
    since = BP.normAttempts(b.attempts).find((a) => a.kind === esc.kind && a.result !== 'skipped')?.startedAt || BP.normFailure(b.failure)?.at || at;
    b.escalation = esc; b.status = 'escalated'; b.updatedAt = at; fresh = true;
    b.notes.push({ text: `Failed: every option was used up (${esc.tried.join(', ') || 'nothing left to try'}). ${esc.why} It is on the systems check banner with Retry; one push went to the phone.`, at });
    return s;
  }, { by, action: 'pipeline:escalate', note: id });
  if (fresh && esc && !esc.pushedAt) {
    // exactly one push per escalation: the first escalated build turns the systems check item red, and that red episode
    // is the push (health@1 pushes once per episode); while it is already red, a new escalation pushes on its own
    const others = escalated().filter((x) => x.id !== id);
    if (others.length) alert('escalated', { id, title, at: esc.at, why: esc.why, tried: esc.tried, since });
    withStore((s) => { const b = storeCore.findBuild(s, id); if (b?.escalation && b.escalation.at === esc.at) { b.escalation = { ...b.escalation, pushedAt: nowIso() }; } return s; }, { by, action: 'pipeline:escalate-pushed', note: id });
    crewSay('dispatcher', 'failed', `${id} failed: every option used up after ${esc.attempts} tries (${esc.tried.join(', ')}). Brett, it's on the systems check banner with Retry.`, { ref: id });
  }
  logLine({ event: 'escalated', build: id, kind: esc?.kind, attempts: esc?.attempts, tried: esc?.tried, pushed: fresh ? 'once' : 'already' });
  return { escalation: esc };
}

/** Every escalated build, for the systems check item and the API: [{ id, title, kind, why, tried, attempts, since, pushedAt }]. */
export function escalated(store = loadStore()) {
  return store.builds.filter((b) => !b.deleted && b.status === 'escalated').map((b) => ({ id: b.id, title: b.title, kind: b.escalation?.kind || b.failure?.kind || '', why: b.escalation?.why || '', tried: b.escalation?.tried ?? [], attempts: BP.normAttempts(b.attempts).length, since: b.escalation?.at || b.updatedAt, pushedAt: b.escalation?.pushedAt || '' }));
}

/**
 * Retry a build by hand (the banner's Retry, the Attempts tab, REST / MCP / CLI / voice): the open kind's counted
 * attempts are marked skipped (the ladder starts over, as auto-lander resetEscalation does), the escalation is cleared and
 * the build is fixing again, so the next tick relaunches it. `strategy` (optional) forces the first rung of the new try.
 * A build with no open failure is queued again instead. → { id, status, strategy }
 */
export function retryBuild(id, { strategy = '', by = process.env.AXF_ACTOR || 'console', why = '', noLaunch = false } = {}) {
  // pipeline-2@1: a Pipeline 2.0 build has no ladder: its retry is the contract's reset (pipeline2.mjs retryBuild)
  { const p2 = storeCore.findBuild(loadStore(), id); if (p2?.flow === P2.FLOW) return P2F.retryBuild(p2.id, { by, why }); }
  if (strategy && !(RL.isRung(strategy) && strategy !== 'escalate')) throw Object.assign(new Error(`strategy is one of ${[...BP.STRATEGIES.filter((x) => x !== 'escalate' && x !== 'fix'), ...BP.FIX_STRATEGIES.map((x) => `fix:${x}`)].join(', ')}`), { code: 2 });
  let out = null;
  withStore((s) => {
    const b = storeCore.findBuild(s, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    if (BP.isLive(b) && b.pipeline?.session) throw Object.assign(new Error(`${b.id} has a session running (${b.pipeline.session}): it is already being worked on`), { code: 2 });
    const at = nowIso();
    const f = BP.normFailure(b.failure) ?? (b.escalation ? BP.normFailure({ kind: b.escalation.kind, at, why: b.escalation.why, head: b.escalation.head }) : null);
    const list = BP.normAttempts(b.attempts);
    if (f) for (const a of list) if (a.kind === f.kind && a.result !== 'started') a.result = 'skipped';
    b.attempts = list; b.escalation = null;
    b.status = f ? 'fixing' : 'queued'; b.failure = f; b.builtAt = ''; b.updatedAt = at;
    if (!f && b.pipeline) b.pipeline = BP.normPipeline({ ...b.pipeline, queuedAt: b.pipeline.queuedAt || at, queuedBy: by }) ?? b.pipeline;
    b.notes.push({ text: `Retry by ${by}${strategy ? ` (${strategy})` : ''}${why ? `: ${why}` : ''}. The ladder starts over${f ? ` for ${f.kind}` : ''}.`, at });
    out = { id: b.id, status: b.status, strategy };
    return s;
  }, { by, action: 'pipeline:retry-hand', note: id });
  logLine({ event: 'retry-hand', build: id, by, strategy });
  // a strategy picked by hand runs now (not on the ladder's first rung at the next tick)
  if (strategy && out.status === 'fixing' && !noLaunch) {
    const store = loadStore(); const settings = loadSettings();
    out.launch = retryFixing({ only: id, force: strategy, accounts: accountsNow(store, settings), settings, rules: rulesOf(store) })[0] ?? null;
  }
  return out;
}

/**
 * One fill round (every tick, after the build launches): planFill over the running builds, then every `step` launch it
 * returns is started until the slots or accounts run out. Off (builds.fillSlots false) = only ends are watched.
 * → { launched, failed, plan, ended, settings }
 */
export function fillRound({ state, env = process.env, alert = () => {}, rules, launchedNow = 0, now = Date.now() } = {}) {
  const fill = fillSettings(env);
  const ended = checkStepEnds({ state, env, alert, now });
  if (!fill.fillSlots) return { launched: [], failed: [], plan: null, ended, settings: fill };
  const store = loadStore();
  const inputs = fillInputs({ store, state, env, fill, launchedNow, now });
  const plan = BP.planFill(inputs);
  plan.waits.push(...P.clashWaits(inputs.running, now));
  const launched = []; const failed = [];
  state.stepRuns = state.stepRuns && typeof state.stepRuns === 'object' ? state.stepRuns : {};
  for (const item of plan.launches.filter((l) => l.kind === 'step')) {
    const b = storeCore.findBuild(loadStore(), item.id);
    try {
      const r = launchStep(b, item, { rules, env });
      const k = runKey(item.id, item.step); state.stepRuns[k] = (state.stepRuns[k] ?? 0) + 1;
      stepRecs(state)[r.runId] = { id: item.id, step: item.step, session: r.session, slot: r.slot, account: item.account, model: item.model, dir: r.dir, branch: r.branch, launchedAt: nowIso(), runs: state.stepRuns[k] };
      withStore((s) => { const rec = storeCore.findBuild(s, item.id); if (rec) { rec.notes.push({ text: `${item.step}: started in parallel on ${item.account} (${item.model}), ${r.session || 'queued in agent slots'}, worktree ${r.dir}, branch ${r.branch} (run ${state.stepRuns[k]} of ${P.STEP_MAX_RUNS})`, at: nowIso() }); rec.updatedAt = nowIso(); } return s; }, { by: 'dispatcher', action: 'pipeline:step-launch', note: `${item.id}/${item.step}` });
      launched.push({ ...item, session: r.session, slot: r.slot, dir: r.dir, runId: r.runId });
      logLine({ event: 'step-launched', build: item.id, step: item.step, account: item.account, model: item.model, session: r.session, dir: r.dir });
      crewSay('dispatcher', 'start', `Started ${item.id} ${item.step} in parallel on ${item.account}, ${item.model}.`, { ref: item.id });
    } catch (e) {
      failed.push({ id: item.id, step: item.step, error: e.message });
      logLine({ event: 'step-launch-failed', build: item.id, step: item.step, account: item.account, error: str(e.message, 300) });
    }
  }
  requeueAfterParallel({ now });
  const autoQueued = fill.autoQueuePending ? autoQueuePending({ state, env, alert, fill, launchedNow: launchedNow + launched.length, now }) : [];
  return { launched, failed, plan, ended, settings: fill, autoQueued };
}

/**
 * Auto-queue pending builds (Claude setting builds.autoQueuePending, owner-only, off by default): when agent slots are
 * still free after every ready step started and no Queue build waits for one, split Pending builds that clash with
 * nothing running move to the Queue in priority order (planFill's Pending rule: split, no file clash, accounts free),
 * each with the build note `auto-queued: slots free`, and one alert lists them. A build a session handed back to
 * Pending, or one whose steps still need a split, keeps waiting for Brett. The next tick launches them.
 */
export function autoQueuePending({ state, env = process.env, alert = () => {}, fill = fillSettings(env), launchedNow = 0, now = Date.now() } = {}) {
  if (!fill.autoQueuePending) return [];
  const store = loadStore(); const rules = rulesOf(store);
  const builds = runnable(store);
  const queueWaits = builds.filter((b) => b.status === 'queued' && !BP.isHeld(b) && BP.openSteps(b).length);
  if (queueWaits.length) return [];
  const pending = builds.filter((b) => b.status === 'pending' && !b.hidden && b.steps.length && !P.needsSplit(b, rules) && b.pipeline?.lastRun?.outcome !== 'returned');
  if (!pending.length) return [];
  const inputs = fillInputs({ store, state, env, fill, launchedNow, now });
  // ready steps first: what they would take is not left for Pending builds
  const plan = BP.planFill({ ...inputs, pending, settings: { ...inputs.settings, autoQueuePending: true }, priorityOf: (b) => effectivePriority(b) });
  const take = plan.launches.filter((l) => l.kind === 'pending');
  const moved = [];
  for (const l of take) {
    try {
      queue(l.id, { by: 'auto-queue (slots free)' });
      withStore((s) => { const rec = storeCore.findBuild(s, l.id); if (rec) { rec.notes.push({ text: 'auto-queued: slots free', at: nowIso() }); rec.updatedAt = nowIso(); } return s; }, { by: 'dispatcher', action: 'pipeline:auto-queue', note: l.id });
      moved.push(l.id);
    } catch (e) { logLine({ event: 'auto-queue-failed', build: l.id, error: str(e.message, 300) }); }
  }
  if (moved.length) {
    const byId = new Map(builds.map((b) => [b.id, b]));
    alert('autoqueue', { ids: moved, builds: moved.map((id) => ({ id, title: str(byId.get(id)?.title, 120), priority: priorityLabel(effectivePriority(byId.get(id))) })) });
    logLine({ event: 'auto-queued', builds: moved });
    crewSay('orchestrator', 'start', `Slots were free: auto-queued ${moved.join(', ')}.`, { ref: moved[0] });
  }
  return moved;
}

/**
 * A running build whose own session ended while step sessions worked (`waiting on parallel steps`): once no step
 * session is left, it goes back to the Queue when steps are left (its own session picks them up), else it is built.
 */
export function requeueAfterParallel({ now = Date.now() } = {}) {
  const out = [];
  for (const b of live(loadStore())) {
    if (b.status !== 'running' || b.pipeline?.session || b.pipeline?.note !== 'waiting on parallel steps') continue;
    if (b.steps.some((x) => !x.done && !x.skip && BP.claimLive(x.claim, now))) continue;
    const left = BP.openSteps(b).length;
    if (left) { setPipeline(b.id, { note: '', queuedAt: nowIso(), queuedBy: 'dispatcher' }, { status: 'queued', note: `Parallel steps finished; ${left} step${left === 1 ? '' : 's'} left: back in the Queue for its own session.`, action: 'pipeline:requeue' }); out.push({ id: b.id, status: 'queued' }); }
    else { setPipeline(b.id, { note: '' }, { status: 'landing', note: 'Parallel steps finished: every step is done; the auto-lander lands it (done-means-merged@1).', action: 'pipeline:end' }); out.push({ id: b.id, status: 'landing' }); }
  }
  return out;
}

/** The kinds of session end the headless wrapper reports (claude-headless.sh → pipeline.mjs exit --kind). */
export const EXIT_KINDS = ['phase-done', 'crash', 'stopped'];
/** The dispatcher's lock: the cron tick holds it (deploy/install-console.sh: flock -n /run/axf-pipeline.lock). */
export const pipelineLock = (env = process.env) => env.AXF_PIPELINE_LOCK || '/run/axf-pipeline.lock';

/**
 * A session ended (the headless wrapper calls this on exit, after its agent slot is free): end the run at once, and when
 * it went back to the Queue, run one dispatcher tick in-process so the next phase starts on a free slot and an account
 * with its model now, not on the next 1-minute cron. Runs under the pipeline lock (main() re-execs under flock), so it
 * never launches twice next to the cron tick; a run already ended (session cleared, another session) is left alone and
 * no tick runs for it. Returns { ok, id, ended, tick }.
 */
export function onExit(id, { session = '', exit = 0, kind = '', phase = '', step = '', hit = '', account = '', env = process.env, runTick = true } = {}) {
  if (kind && !EXIT_KINDS.includes(kind)) throw Object.assign(new Error(`kind is one of ${EXIT_KINDS.join(', ')}`), { code: 2 });
  const b = storeCore.findBuild(loadStore(), id);
  if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
  // pipeline-2@1: a step's session ended: written to the store now, then one pass (the retry or the next step goes out at once)
  if (b.flow === P2.FLOW) {
    const ended = step ? P2F.stepExit(id, step, { exit, hit, account, session, env }) : { ok: false, why: 'no --step: a Pipeline 2.0 build runs by step' };
    let t = null;
    if (runTick) { try { const r = P2F.advance({ env }); t = { launched: r.launched, waits: r.waits.filter((w) => w.id === id) }; } catch (e) { t = { error: str(e.message, 300) }; } }
    return { ok: true, id, ended: null, step: ended, tick: null, p2: t, why: ended.why || `${id}/${step}: ${ended.status}` };
  }
  const p = b.pipeline ?? {};
  const open = p.session && (b.status === 'running' || b.status === 'waiting' || b.status === 'fixing' || SETTLED.includes(b.status));
  if (!open || (session && p.session !== session)) return { ok: true, id, ended: null, tick: null, why: 'this run was already ended (or another session holds the build)' };
  const ended = endRun(b, { exit: Number.isInteger(exit) ? exit : Number(exit) || 0, kind, phase, settings: loadSettings(env), env });
  let t = null;
  if (runTick && ended.status === 'queued') {
    try { const r = tick({ env }); t = { at: r.at, launched: r.launched.map((l) => ({ id: l.id, account: l.account, model: l.model, phase: l.phase || '' })), waits: r.plan.waits.filter((w) => w.id === id) }; }
    catch (e) { logLine({ event: 'exit-tick-failed', build: id, error: str(e.message, 300) }); t = { error: str(e.message, 300) }; }
  }
  return { ok: true, id, ended, tick: t };
}

/** The last 64 KB of a run's log ('' when it is gone). */
function tailOf(file) {
  if (!file) return '';
  try { const buf = readFileSync(file); return buf.subarray(Math.max(0, buf.length - 65536)).toString('utf8'); } catch { return ''; }
}

// ------------------------------------------------------------------ builds held on a Claude login failure

export const SCHEMA_AUTH_WAITS = 'pipeline-auth-waits@1';
/** Builds held after a sign-in failure: { [build id]: { account, at, error, session, requeued, requeuedAt } }. */
export const loadAuthWaits = () => { const j = readJson(files().authWaits); return j?.$axf === SCHEMA_AUTH_WAITS && j.builds && typeof j.builds === 'object' ? j.builds : {}; };
const saveAuthWaits = (builds) => writeJson(files().authWaits, { $axf: SCHEMA_AUTH_WAITS, at: nowIso(), builds });

/** Hold a build on its account's login and ask for a health sweep, so the recovery is noticed without waiting a full round. */
export function authWait(id, { account = '', error = '', session = '' } = {}) {
  const all = loadAuthWaits();
  all[id] = { account: str(account, 40), at: nowIso(), error: str(error, 200), session: str(session, 120), requeued: false, requeuedAt: '' };
  saveAuthWaits(all);
  try { requestHealth({ by: `login failure: ${id}` }); } catch { /* the regular sweep notices it */ }
  return all[id];
}

/**
 * Every tick: a held build whose account signs in again (a health answer newer than the failure) goes back to the
 * Queue, once, and the phone hears so. A build that left Pending meanwhile (queued by hand, deleted) is dropped.
 * Returns the builds re-queued.
 */
export function authWaitsTick({ alert = () => {}, by = 'dispatcher' } = {}) {
  const all = loadAuthWaits(); const ids = Object.keys(all);
  if (!ids.length) return [];
  const store = loadStore(); const own = loadOwnAccounts();
  const done = []; let changed = false;
  for (const id of ids) {
    const w = all[id]; const b = storeCore.findBuild(store, id);
    if (!b || b.deleted || (b.status !== 'pending' && !w.requeued)) { delete all[id]; changed = true; continue; }
    if (w.requeued) { if (Date.now() - Date.parse(w.requeuedAt || 0) > 7 * 86400e3) { delete all[id]; changed = true; } continue; }
    if (!P.authRecovered(w, own[w.account]?.health)) continue;
    try {
      // one Queued: while another build holds the Queue this one is back in line in Pending (no longer held for its
      // login) and moves up by itself; it is queued at once when the Queue is free
      let inLine = false;
      try { queue(id, { by: `${by} (login works again on ${w.account})` }); }
      catch (e) { if (!e.holder) throw e; inLine = true; setPipeline(id, { note: `login works again on ${w.account}: in line in Pending behind ${e.holder}` }, { note: `${w.account} signs in again: back in line in Pending (${e.holder} holds the Queue); it moves up by itself.`, by, action: 'pipeline:auth-ok' }); }
      all[id] = { ...w, requeued: true, requeuedAt: nowIso() }; changed = true;
      alert('oauth-ok', { id, title: b.title, account: w.account });
      logLine({ event: 'auth-requeued', build: id, account: w.account, inLine });
      crewSay('dispatcher', 'start', `${w.account} signs in again: ${id} is back in ${inLine ? 'line in Pending' : 'the Queue'}.`, { ref: id });
      done.push(id);
    } catch (e) { logLine({ event: 'auth-requeue-failed', build: id, error: str(e.message, 300) }); }
  }
  if (changed) saveAuthWaits(all);
  return done;
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
export function reapBuilds({ sl = slotsNow(), now = Date.now(), env = process.env } = {}) {
  if (sl.unavailable) return [];
  const held = new Set([...(sl.running ?? []), ...(sl.queue ?? [])].flatMap((x) => [x.id, x.session].filter(Boolean)));
  const out = [];
  for (const b of live(loadStore())) {
    const p = b.pipeline;
    if (!(b.status === 'running' || b.status === 'waiting') || !p?.account || p.session) continue;
    if ((p.slot && held.has(p.slot)) || now - Date.parse(p.launchedAt || p.dispatchedAt || b.updatedAt || 0) < GONE_GRACE_MS) continue;
    // confirm it is really dead (tmux + claude pids, not the lock: a lock with no session behind it is what we reap)
    const l = buildLive(b.id, { env, useLock: false });
    if (l.live) {
      if (l.sessions[0]) setPipeline(b.id, { session: l.sessions[0] }, { note: `Self-check: ${b.id} had no session on record but ${l.sessions[0]} is alive: kept running and tracking it.`, action: 'pipeline:adopt' });
      logLine({ event: 'reap-skipped-alive', build: b.id, sessions: l.sessions, pids: l.pids });
      continue;
    }
    lock.release(b.id, { dir: worktreeOf(b.id, env) });
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
  for (const b of reapBuilds({ env })) fixes.push(`requeued ${b.id} (marked running on ${b.account}, nothing ran)`);
  migrateOnHost(env);
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
    if (fixes.length) crewSay('watchdog', 'done', `Self-check fixed ${fixes.length}: ${str(fixes.join('; '), 220)}.`);
    if (sum.problems.length) crewSay('watchdog', 'blocked', `Accounts I can't use: ${str(sum.problems.join('; '), 220)}. ${sum.line}.`, { dedupeMin: 360 });
  }
  // the state file is the tick's too: re-read it so this never undoes what the tick wrote
  saveState({ ...loadState(), selfCheck: result });
  try { rmSync(files().checkRequest, { force: true }); } catch { /* gone */ }
  logLine({ event: 'self-check', reason: result.reason, by: result.by, line: sum.line, fixes, problems: sum.problems, accounts: findings.map((f) => `${f.name}:${f.state}`) });
  return result;
}

// ------------------------------------------------------------------ the tick

export function tick({ env = process.env } = {}) {
  // vps-reaper@1: the orchestrator runs the same check as the VPS cron before it decides anything (throttled)
  const reaped = reapFirstSync('dispatcher', { env });
  if (reaped?.ran && reaped.actions?.length) logLine({ event: 'reaped-ghosts', by: 'dispatcher', title: reaped.summary?.title ?? '', actions: reaped.actions.map((a) => `${a.type} ${a.what}: ${a.why}`).slice(0, 40) });
  loadUpgradePolicy();
  const consoleApi = makeConsole(env);
  const state = loadState();
  const sent = [];
  const alert = (kind, d) => { const a = P.alertFor(kind, d); consoleApi('POST', '/api/alerts', a); sent.push({ key: a.key, kind, at: nowIso(), title: a.title }); };
  const started = nowIso();
  const inta = intake({ alert });
  try { assignAliases({ by: 'pipeline' }); } catch (e) { logLine({ event: 'alias-failed', error: str(e.message, 300) }); }
  const ended = checkEnds({ alert, env });
  // done-means-merged@1: every failure is classified and recorded (status fixing); the retry runner answers it below
  let failures = [];
  try { failures = detectFailures({ ended, env }); } catch (e) { logLine({ event: 'detect-failed', error: str(e.message, 300) }); }
  let authRequeued = [];
  try { authRequeued = authWaitsTick({ alert }); } catch (e) { logLine({ event: 'auth-waits-failed', error: str(e.message, 300) }); }
  migrateOnHost(env);
  // one Queued (build-pipeline@1): settle the Queue. Nothing moves up here: Brett's queue click starts the line (or
  // his settings do: builds.launchWithoutAsking in intake, builds.autoQueuePending in the fill round, each through
  // queue(), so one at a time), and each go-live below moves the next Pending build up.
  let queueMoves = { kept: '', demoted: [], promoted: '' };
  try { queueMoves = advanceQueue({ by: 'dispatcher', promote: false }); } catch (e) { logLine({ event: 'advance-queue-failed', error: str(e.message, 300) }); }
  let store = loadStore(); const settings = loadSettings(); const rules = rulesOf(store);
  // the step-dependency migration (BUILD-PARALLEL §1): once, journalled; older builds keep no dependsOn
  if (!store.meta?.versions?.stepDeps) { try { migrateStepDepsNow('dispatcher'); store = loadStore(); } catch (e) { logLine({ event: 'migrate-step-deps-failed', error: str(e.message, 300) }); } }
  const read = accountsRead(store, settings, env); const accounts = read.accounts; const sl = slotsNow();
  // the console (in its container) can't see the logins: it reads what the host saw here
  if (read.source === 'host') { try { writeHostAccounts(read.rows, read.at || nowIso()); } catch (e) { logLine({ event: 'snapshot-failed', error: str(e.message, 300) }); } }
  // done-means-merged@1: every fixing build gets the ladder's next strategy (a relaunch, a wait, or escalation)
  let retries = [];
  try { retries = retryFixing({ env, accounts, settings, rules, alert }); } catch (e) { logLine({ event: 'retry-failed', error: str(e.message, 300) }); }
  // pipeline-2@1: the Pipeline 2.0 flow (split, one active build, main into each step, models, steps to free slots)
  let p2 = null;
  try { p2 = P2F.advance({ env }); } catch (e) { logLine({ event: 'p2-advance-failed', error: str(e.message, 300) }); p2 = { error: str(e.message, 300) }; }
  // build-budget@1: one alert per pass that stopped something (the stops themselves are on the builds' records)
  if (p2?.budget?.alert) { const a = { ...P.alertFor('budget', { id: p2.budget.stopped.map((x) => x.id).join(',').slice(0, 200) }), ...p2.budget.alert }; consoleApi('POST', '/api/alerts', a); sent.push({ key: a.key, kind: 'budget', at: nowIso(), title: a.title }); }
  const plan = P.plan({ builds: runnable(store), accounts, slots: sl, settings, rules });
  // one active build at a time (Brett, Nov 19 2026): while a Pipeline 2.0 build is active nothing else starts (a start
  // pulls main into its worktree); builds@1 builds already running carry on
  { const act = P2.activeBuild(live(loadStore())).active;
    if (act && plan.launches.length) { for (const l of plan.launches) plan.waits.push({ id: l.id, why: `one active build at a time: ${act.id} is ${P2.labelOf(act.status, act.attempt)}` }); plan.launches = []; } }
  // the builds@1 planner runs only while a builds@1 build is in the Queue or being built (with none it planned, and
  // logged, builds this dispatcher will never start)
  if (legacyActive(store)) planAhead(store, accounts, settings);
  const launched = []; const failed = [];
  const hourAgo = Date.now() - 3600e3;
  for (const first of plan.launches) {
    const fails = (state.launchFails[first.id] ?? []).filter((t) => Date.parse(t) > hourAgo);
    const b = live(store).find((x) => x.id === first.id);
    // the final pick: the plan's account first, then every other account that may take it (subscriptions, then API),
    // moving on until one accepts the launch
    const options = [first, ...P.routeOptions(b, accounts, first.model, settings).filter((o) => o.account !== first.account).map((o) => ({ ...first, ...o }))].slice(0, MAX_PICK_TRIES);
    const tried = []; const reasons = [];
    let l = first; let r = null; let lastErr = null;
    for (const o of options) {
      l = o;
      try { r = launch(b, l, { rules, env }); break; }
      catch (e) {
        if (e.code === 'live') { lastErr = e; break; } // the build itself is busy: no other account may take it either
        lastErr = e; tried.push(l.account); reasons.push({ account: l.account, error: str(e.message, 300) }); logLine({ event: 'launch-refused', build: b.id, account: l.account, error: str(e.message, 300) });
      }
    }
    if (!r && lastErr?.code === 'live') {
      const lv = lastErr.liveness ?? {};
      plan.waits.push({ id: b.id, why: str(lastErr.message, 300) });
      logLine({ event: 'launch-gated', build: b.id, sessions: lv.sessions ?? [], pids: lv.pids ?? [], lock: lv.lockFresh ? lv.lock?.session || 'launching' : '' });
      // a Queued build with a live tmux session was released too early: put it back to running on that session
      if (b.status === 'queued' && lv.sessions?.[0]) setPipeline(b.id, { session: lv.sessions[0] }, { status: 'running', note: `Dispatch gate: ${b.id} still has ${lv.sessions[0]} alive: not launched again, tracking that session.`, action: 'pipeline:adopt' });
      continue;
    }
    try {
      if (!r) throw lastErr ?? new Error('no account accepted the launch');
      const runs = (b.pipeline?.runs ?? 0) + 1;
      const moved = tried.length ? ` after ${tried.join(', ')} refused` : '';
      setPipeline(b.id, { account: l.account, session: r.session, slot: r.slot, model: l.model, phase: l.phase || '', launchedAt: nowIso(), dispatchedAt: nowIso(), pickedAt: nowIso(), tried, runs, note: r.queuedInSlots ? 'in the agent-slots queue (starts when the VPS cap frees)' : r.lookWait ? 'waiting for the predicted look approval in UI Review' : '' },
        { status: 'running', note: `Started run ${runs} on ${l.account}${moved}${l.kind === 'api' ? ` (API key, ${l.rule === 'override' ? 'this build is set to API' : 'subscriptions first, then API'})` : ''} (${l.model}${l.phase ? `, ${l.phase}` : ''}): ${r.session || 'queued in agent slots'}.`, action: 'pipeline:launch' });
      if (!b.branch) withStore((s) => { const rec = storeCore.findBuild(s, b.id); if (rec && !rec.branch) rec.branch = `claude/${b.id}`; return s; }, { by: 'pipeline', action: 'pipeline:branch', note: b.id });
      alert('launched', { id: b.id, title: b.title, account: l.account, model: l.model, phase: l.phase, session: r.session });
      launched.push({ ...l, session: r.session, dir: r.dir });
      logLine({ event: 'launched', build: b.id, account: l.account, kind: l.kind || 'subscription', rule: l.rule || '', model: l.model, session: r.session });
      crewSay('dispatcher', 'start', `Started ${b.id} on ${l.account}${moved}${l.kind === 'api' ? ' (API key)' : ''}, ${l.model}${l.phase ? ` ${l.phase}` : ''}${r.queuedInSlots ? ', waiting for a free slot' : ''}.`, { ref: b.id });
      delete state.launchFails[l.id];
    } catch (e) {
      state.launchFails[l.id] = [...fails, nowIso()];
      failed.push({ id: l.id, error: e.message, tried });
      setPipeline(l.id, { note: `launch failed: ${str(e.message, 300)}`, tried }, { note: `Launch failed on ${tried.join(', ') || l.account}: ${str(e.message, 500)}`, action: 'pipeline:launch-failed' });
      logLine({ event: 'launch-failed', build: l.id, account: l.account, tried, error: e.message });
      crewSay('dispatcher', 'failed', `Couldn't start ${l.id} on ${tried.join(', ') || l.account}: ${str(e.message, 160)}`, { ref: l.id });
      // the phone hears every failed start at once, with the exact reason per account tried
      alert('launch-failed', { id: l.id, title: b.title, account: l.account, error: e.message, reasons: reasons.length ? reasons : [{ account: l.account, error: str(e.message, 300) }],
        tries: state.launchFails[l.id].filter((t) => Date.parse(t) > hourAgo).length, maxTries: LAUNCH_FAILS_SHOWN });
    }
  }
  // the queued build went live: the next Pending build moves up at once (it starts on the next tick)
  if (launched.length) { try { const m = advanceQueue({ by: 'dispatcher' }); queueMoves = { kept: m.kept, demoted: [...queueMoves.demoted, ...m.demoted], promoted: m.promoted || queueMoves.promoted }; } catch (e) { logLine({ event: 'advance-queue-failed', error: str(e.message, 300) }); } }
  // fill every slot: parallel steps of running builds into the slots still free (BUILD-PARALLEL)
  let fill = { launched: [], failed: [], plan: null, ended: [], settings: null };
  try { fill = fillRound({ state, env, alert, rules, launchedNow: launched.length }); } catch (e) { logLine({ event: 'fill-failed', error: str(e.message, 300) }); }
  // idle: nothing running while work waits. Recorded at once; the phone hears about it after idleAfterMin, once per idle spell.
  let idle = null;
  const idleNow = (plan.idle && !launched.length && !fill.launched.length) ? plan.idle : P.fillIdle(fill.plan, launched.length + fill.launched.length);
  if (idleNow) {
    const since = state.idle?.kind === idleNow.kind ? state.idle.since : started;
    idle = { ...idleNow, since };
    const dueAt = Date.parse(since) + settings.idleAfterMin * 60e3;
    const already = state.alerts.find((a) => a.key === 'pipeline:idle');
    if (!already && Date.now() >= dueAt) {
      alert('idle', { kind: idleNow.kind, reason: idleNow.reason });
      if (idleNow.kind === 'empty') crewSay('dispatcher', 'waiting', `Nothing to run. ${idleNow.reason}.`, { dedupeMin: 360 });
      else crewSay('dispatcher', 'blocked', `Stuck: ${idleNow.reason}.`, { dedupeMin: 360 });
    }
  } else if (state.alerts.some((a) => a.key === 'pipeline:idle')) {
    consoleApi('POST', '/api/alerts/resolve', { keys: ['pipeline:idle'] });
    state.alerts = state.alerts.filter((a) => a.key !== 'pipeline:idle');
  }
  const alerts = [...state.alerts.filter((a) => a.key !== 'pipeline:idle' || idle), ...sent.filter((a) => a.kind === 'idle')].filter((a, i, arr) => arr.findIndex((x) => x.key === a.key) === i);
  const next = { ...state, at: nowIso(), plan: { launches: plan.launches, waits: plan.waits, queue: plan.queue, running: plan.running, pending: plan.pending }, fill: fill.plan ? { at: nowIso(), launches: fill.plan.launches, waits: fill.plan.waits, free: fill.plan.free, blocked: fill.plan.blocked, launched: fill.launched.map((l) => ({ id: l.id, step: l.step, account: l.account, session: l.session })), ended: fill.ended } : { at: nowIso(), off: !fill.settings?.fillSlots, ended: fill.ended }, slots: { used: sl.used, cap: sl.cap, free: sl.free, ...(sl.hard?.max ? { hard: { max: sl.hard.max, live: sl.hard.live, free: sl.hard.free } } : {}) }, accounts: accounts.map((a) => ({ name: a.name, fable: a.fable, parallel: a.parallel, running: a.running, usable: a.usable, why: a.why })), idle, alerts,
    recent: [...state.recent, ...launched.map((l) => ({ at: nowIso(), event: 'launched', id: l.id, account: l.account, model: l.model })), ...ended.map((e) => ({ at: nowIso(), event: e.outcome, id: e.id })), ...failed.map((f) => ({ at: nowIso(), event: 'launch-failed', id: f.id, error: f.error }))].slice(-50) };
  saveState(next);
  // self-check: asked for (console load, voice, API), or queued work waits and this tick started nothing
  try { if (existsSync(files().fillRequest)) { logLine({ event: 'fill-run', request: readJson(files().fillRequest) }); rmSync(files().fillRequest, { force: true }); } } catch { /* a courtesy */ }
  const asked = readJson(files().checkRequest);
  let check = null;
  if (asked || (plan.queue.length && !launched.length && plan.waits.length)) {
    try { check = selfCheck({ reason: asked ? asked.reason || 'on demand' : 'queued builds wait, nothing launched', by: asked?.by || 'dispatcher', env, alert: (kind, d) => consoleApi('POST', '/api/alerts', P.alertFor(kind, d)) }); }
    catch (e) { logLine({ event: 'self-check-failed', error: str(e.message, 300) }); }
  }
  // done-means-merged@1: a landed build's feature verify runs in the background (one at a time): pass = complete, fail = fixing
  let verify = null;
  try { verify = kickVerify({ env }); } catch (e) { logLine({ event: 'verify-kick-failed', error: str(e.message, 300) }); }
  // account health: every healthEveryMin minutes, in the background, so the tick never waits on it
  let health = null;
  try { health = kickHealth({ env, settings }); } catch (e) { logLine({ event: 'health-kick-failed', error: str(e.message, 300) }); }
  for (const fn of TICK_HOOKS) {
    try { fn({ state: next, plan, launched, ended, failed, env }); } catch (e) { logLine({ event: 'hook-failed', error: str(e.message, 300) }); }
  }
  return { ok: true, at: next.at, intake: inta, ended, failures, retries, authRequeued, queueMoves, launched, failed, plan, fill, idle, alertsSent: sent, selfCheck: check, health, verify, p2 };
}

const MAX_PICK_TRIES = 4;

/**
 * The orchestrator's plan for every split build that waits (Pending, Queue): its next model and the account it expects
 * to take it (pipeline.planned). Written only when it changed, in one store write.
 */
export function planAhead(store, accounts, settings = loadSettings()) {
  const want = new Map();
  for (const b of legacyLive(store)) {
    if ((b.status !== 'pending' && b.status !== 'queued') || b.hidden || !BP.openSteps(b).length) continue;
    const p = P.planFor(b, accounts, settings);
    const cur = b.pipeline?.planned;
    if (!p || (cur && cur.model === p.model && cur.account === p.account && cur.kind === p.kind)) continue;
    want.set(b.id, p);
  }
  if (!want.size) return [];
  withStore((s) => {
    for (const [id, p] of want) { const rec = storeCore.findBuild(s, id); if (rec) rec.pipeline = BP.normPipeline({ ...(rec.pipeline ?? {}), planned: p }) ?? undefined; }
    return s;
  }, { by: 'pipeline', action: 'pipeline:plan', note: [...want.keys()].join(', ').slice(0, 300) });
  for (const [id, p] of want) logLine({ event: 'planned', build: id, model: p.model, account: p.account, kind: p.kind });
  return [...want.keys()];
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
  for (const s of r.shipped ?? []) {
    logLine(s.error ? { event: 'ship-failed', build: s.id, error: str(s.error, 300) } : { event: 'shipped', build: s.id, manifest: s.manifest, rev: s.rev });
    if (s.error) crewSay('shipped', 'failed', `Couldn't send the shipped manifest for ${s.id}: ${str(s.error, 160)}`, { ref: s.id, dedupeMin: 360 });
    else crewSay('shipped', 'done', `${s.id} landed: shipped manifest sent to Shipped features.`, { ref: s.id });
  }
});

// ------------------------------------------------------------------ the one way in: request a build, route it


/**
 * File a build with the orchestrator: it assigns the id (from the title, at most 40 characters, made unique), the next tick splits it, and with
 * `queue` it goes straight to the Queue. Returns the build. This replaces every direct launch (Build manager Start,
 * Fix with Claude, feature assist): they all end here and the dispatcher starts the build.
 */
export function request({ title, detail = '', said = '', priority = '', route = '', queue: toQueue = false, by = process.env.AXF_ACTOR || 'console', source = '' } = {}) {
  const t = str(title, 300).trim(); if (!t) throw Object.assign(new Error('a build needs a title'), { code: 2 });
  if (route && !BP.ROUTES.includes(route)) throw Object.assign(new Error(`route is api, subscription or auto, not ${route}`), { code: 2 });
  // build-id@1: the id names the folder, the branch claude/<id> and the tmux session, so it stays within 40 characters;
  // the title is the display name, kept whole
  const id = uniqueBuildId(t, new Set(loadStore().builds.flatMap(namesOf)));
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

/** A login that renews within this window is not called: a renewal would leave a running build's copy on a spent token. */
const RENEW_GUARD_MS = 15 * 60e3;

/**
 * One tiny headless call on a private copy of an account's login (claude -p, Fable, one turn, no tools), in a temp
 * folder: no build, no slot, no worker claim. The copy is released with save-back, so a renewed token reaches the
 * login's stores. A subscription login without a saved long-lived token whose access token is about to renew is not
 * called ({ skipped }): renewing it here would spend the refresh token a running build's copy still holds.
 */
export function callAccount(name, env = process.env, { session = 'probe' } = {}) {
  if (!BP.accountName(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const dir = join(tmpdir(), `axf-${session}-${process.pid}-${name}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
  let snap = null;
  try {
    snap = snapshotLogin({ dir, session, account: name });
    if (snap.kind !== 'api' && !snap.token) {
      const exp = Number(readJson(join(snap.config || snap.dir, '.credentials.json'))?.claudeAiOauth?.expiresAt) || 0;
      if (exp && exp - Date.now() < RENEW_GUARD_MS) return { skipped: true, status: null, out: '', error: 'its login renews soon: not called, so no running build is left on a spent token' };
    }
    const e = childEnv(snap, env); e.PATH = `${join(homedir(), '.local', 'bin')}:${e.PATH || ''}`;
    const r = spawnSync('claude', ['-p', '--model', MODEL_IDS.fable, '--output-format', 'json', '--max-turns', '1', '--tools', '', '--strict-mcp-config'], { input: 'Reply with the single word ok.', encoding: 'utf8', timeout: 120e3, env: e, cwd: tmpdir() });
    return { skipped: false, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, error: r.error?.message || '' };
  } catch (e) { return { skipped: false, status: null, out: '', error: str(e.message, 200) }; }
  finally { if (snap) { try { releaseLogin({ dir, session }); } catch { /* best effort */ } } try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } }
}

/** Ask an account's login whether it can run Fable: one tiny call; the answer is recorded on the account for probeDays. */
export function probe(name, env = process.env) {
  const r = callAccount(name, env, { session: 'probe' });
  const h = P.healthOf(r);
  const rec = { fable: h.fable === true, at: nowIso(), error: h.fable ? '' : str(r.error || h.error || 'no answer', 200) };
  if (!r.skipped) saveOwnAccount(name, { probe: rec });
  return rec;
}

// ------------------------------------------------------------------ account health (every 5 minutes, in the background)

export const SCHEMA_HEALTH = 'pipeline-health@1';
export const loadHealth = () => { const j = readJson(files().health); return j && typeof j === 'object' ? j : null; };
const HEALTH_LOCK_MS = 15 * 60e3;
const healthLocked = () => { try { return Date.now() - statSync(files().healthLock).mtimeMs < HEALTH_LOCK_MS; } catch { return false; } };

/** Ask for a sweep now (the console, voice, MCP): the next tick starts it. */
export function requestHealth({ by = process.env.AXF_ACTOR || 'console' } = {}) {
  const r = { at: nowIso(), by: str(by, 80) };
  writeJson(files().healthRequest, r);
  logLine({ event: 'health-requested', ...r });
  return r;
}

/**
 * Start a sweep in the background when one is due (or asked for) and none runs. Host only (the logins live there).
 * Off with healthEveryMin 0, AXF_PIPELINE_HEALTH=off, or a test launcher (AXF_PIPELINE_LAUNCHER) without AXF_PIPELINE_HEALTH=on.
 */
export function kickHealth({ env = process.env, settings = loadSettings(env), now = Date.now() } = {}) {
  if (env.AXF_PIPELINE_HEALTH === 'off' || (env.AXF_PIPELINE_LAUNCHER && env.AXF_PIPELINE_HEALTH !== 'on')) return null;
  if (!seesAccounts(env)) return null;
  const asked = readJson(files().healthRequest);
  if (!asked && !P.healthDue(loadHealth()?.startedAt, settings, now)) return null;
  if (healthLocked()) return { started: false, why: 'a sweep is running' };
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'health', '--by', asked?.by || 'dispatcher'], { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  return { started: true, pid: child.pid };
}

/** Start verify.mjs run in the background when a landed build waits for its verify and none runs (AXF_PIPELINE_VERIFY=off skips). */
export function kickVerify({ env = process.env } = {}) {
  if (env.AXF_PIPELINE_VERIFY === 'off' || (env.AXF_PIPELINE_LAUNCHER && env.AXF_PIPELINE_VERIFY !== 'on')) return null;
  const waiting = V.waiting(loadStore().builds);
  if (!waiting.length) return null;
  if (V.locked(env)) return { started: false, why: 'a verify is running', waiting: waiting.map((b) => b.id) };
  const child = spawn(process.execPath, [join(HERE, 'verify.mjs'), 'run'], { cwd: REPO_ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  logLine({ event: 'verify-started', builds: waiting.map((b) => b.id), pid: child.pid });
  return { started: true, pid: child.pid, waiting: waiting.map((b) => b.id) };
}

/**
 * The sweep: every saved account, one by one, one tiny call each (callAccount). Each answer is kept on the account
 * (accounts.json: health { at, signedIn, credits, fable, error }) and the sweep in health.json; accountView() reads them.
 * Never touches the builds store, a running build, a slot or a worker claim.
 */
export function health({ env = process.env, by = 'dispatcher' } = {}) {
  if (!seesAccounts(env)) return { ran: false, requested: requestHealth({ by }).at, why: 'the Claude logins live on the VPS host: the dispatcher runs the sweep on its next tick (within a minute)' };
  if (healthLocked()) return { ran: false, why: 'a sweep is already running' };
  mkdirSync(files().dir, { recursive: true }); writeFileSync(files().healthLock, `${process.pid}\n`);
  const startedAt = nowIso();
  try {
    try { rmSync(files().healthRequest, { force: true }); } catch { /* gone */ }
    const rows = workerRows(env).rows;
    const out = [];
    for (const row of rows) {
      const name = BP.accountName(row?.name); if (!name) continue;
      const r = callAccount(name, env, { session: 'health' });
      const prev = loadOwnAccounts()[name]?.health;
      // a skipped call keeps what the last sweep knew, marked as such
      const h = r.skipped ? { ...(prev ?? { signedIn: null, credits: null, fable: null }), at: prev?.at || nowIso(), error: r.error, skipped: true } : { ...P.healthOf(r), at: nowIso() };
      saveOwnAccount(name, { health: h, ...(typeof h.fable === 'boolean' && !r.skipped ? { probe: { fable: h.fable, at: h.at, error: h.fable ? '' : h.error } } : {}) });
      out.push({ name, kind: row?.kind === 'api' || /^api/.test(str(row?.role, 20)) ? 'api' : 'subscription', ...h });
      writeFileSync(files().healthLock, `${process.pid}\n`);
    }
    const sum = P.healthSummary(out);
    const rec = { $axf: SCHEMA_HEALTH, startedAt, at: nowIso(), by: str(by, 80), line: sum.line, problems: sum.problems, accounts: out };
    writeJson(files().health, rec);
    logLine({ event: 'health', line: sum.line, problems: sum.problems });
    return { ran: true, ...rec };
  } finally { try { rmSync(files().healthLock, { force: true }); } catch { /* gone */ } }
}

// ------------------------------------------------------------------ CLI

// pipeline2.mjs uses these (bound here: it is imported by this file, so it can't import them at load time)
P2F.bindPipeline({ pipeDir, slotsNow, accountsRead, loadSettings, ensureWorktree, pipelineLock, seesAccounts, askSplitter });

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
      `Pipeline · ${s.at} · slots ${s.slots.used}/${s.slots.cap} (${s.slots.free} free)${s.slots.hard ? ` · builds at once ${s.slots.hard.live ?? '?'}/${s.slots.hard.max}` : ''}${s.slots.unavailable ? ' (no slots store here)' : ''}`,
      `Accounts: ${s.accounts.map((a) => `${a.name}${a.kind === 'api' ? ' [API]' : ''} ${a.fable ? 'Fable' : 'Opus'} ${a.running}/${a.parallel}${a.kind === 'api' ? (a.api?.usable ? '' : ` (${a.api?.why})`) : a.usable ? '' : ` (${a.why})`}`).join(' · ') || 'none'}`,
      `API overflow: ${s.settings.apiOverflow ? 'on' : 'off'}`,
      `Pending (${s.table.pending.length})`, ...s.table.pending.map(line),
      `Queue (${s.table.queued.length})`, ...s.table.queued.map(line),
      `Building (${s.table.building.length})`, ...s.table.building.map(line),
      s.plan.launches.length ? `Next tick starts: ${s.plan.launches.map((l) => `${l.id} on ${l.account} (${l.model})`).join(', ')}` : 'Next tick starts nothing.',
      ...s.plan.waits.map((w) => `  waits: ${w.id}: ${w.why}`),
      `Archive ${s.tabs.archive.length} · Deleted ${s.tabs.deleted.length} (kept forever)`,
      s.plan.idle ? `IDLE: ${s.plan.idle.reason}` : '',
    ].filter(Boolean).join('\n'));
  }
  if (cmd === 'auth-waits') {   // builds held on a Claude login failure (also in status → state.authWaits)
    const w = loadAuthWaits();
    return out({ ok: true, authWaits: w }, Object.entries(w).map(([id, x]) => `${id} · ${x.account} · ${x.requeued ? `re-queued ${x.requeuedAt}` : `held since ${x.at}`} · ${x.error}`).join('\n') || 'no build is held on a login failure');
  }
  // the CLI is one of Brett's surfaces: his queue lifts a stop
  if (cmd === 'queue') { const b = queue(rest[0], { by: stopActor(by) }); return out({ ok: true, id: b.id, status: b.status, pipeline: b.pipeline, ...(b.say ? { say: b.say } : {}) }, b.say || `${b.id} → Queue (by ${by})`); }
  if (BP.BUILD_ACTIONS.includes(cmd)) {
    const ids = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--by', '--why'].includes(rest[i - 1])));
    const r = buildAction(cmd, ids, { by: ['unqueue', 'hold', 'cancel', 'release'].includes(cmd) ? stopActor(by) : by, why: flag('why') });
    if (!r.done.length) throw Object.assign(new Error(r.refused.map((x) => x.error).join('; ')), { code: 2 });
    const one = r.done.length === 1 ? { id: r.done[0].id, status: r.done[0].status } : {};
    return out({ ok: true, ...one, ...r }, [...r.done.map((d) => `${d.id} → ${BP.TAB_LABEL[d.tab] || d.status}${cmd === 'hold' ? ' (on hold)' : cmd === 'cancel' ? ' (cancelled)' : ''}`), ...r.refused.map((x) => `refused ${x.id}: ${x.error}`)].join('\n'));
  }
  if (cmd === 'fill' && (rest[0] ?? 'status') === 'status') { const f = fillStatus({ build: rest[1] ?? '' }); return out(f, fillLines(f)); }
  if (cmd === 'fill' && rest[0] === 'run') { const r = fillRun({ by }); return out(r, r.ran ? `ran a round: ${r.launched.length} build(s), ${r.fill.launched.length} parallel step(s) started${r.fill.autoQueued.length ? `, auto-queued ${r.fill.autoQueued.join(', ')}` : ''}` : r.note); }
  if (cmd === 'fill' && rest[0] === 'set') {
    // fill set fillSlots=false maxParallelPerBuild=2: through the console's route, which owns the owner rules
    const body = Object.fromEntries(rest.slice(1).filter((a) => a.includes('=')).map((a) => { const [k, v] = a.split('='); return [k, v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v]; }));
    if (!Object.keys(body).length) throw Object.assign(new Error('usage: fill set fillSlots=true|false maxParallelPerBuild=<1-12> autoQueuePending=true|false'), { code: 2 });
    const r = makeConsole()('POST', '/api/plugins/build-orchestrator/pipeline/fill/settings', body); // axf-plugin:build-orchestrator
    if (!r) throw new Error('the console did not answer (the fill settings change through its API: Settings → Plugins → Build orchestrator)');
    if (r.ok === false || r.detail) throw Object.assign(new Error(str(r.detail || r.error || 'refused', 300)), { code: 2 });
    return out({ ok: true, ...r }, (r.changed ?? []).map((c) => `${c.key}: ${c.from} → ${c.to}`).join('\n') || 'nothing changed');
  }
  if (cmd === 'fill' && rest[0] === 'deps') {
    // fill deps <build> <step> <s1,s2 | none | sequential>   (none = independent: [])
    const raw = rest[3] ?? ''; const deps = raw === 'sequential' ? null : raw === 'none' || raw === '[]' ? [] : raw.startsWith('[') ? JSON.parse(raw) : raw;
    const r = setStepDeps(rest[1], rest[2], deps, { by });
    return out(r, `${r.id} ${r.step}: ${r.explicit === null ? 'sequential' : r.dependsOn.length ? `after ${r.dependsOn.join(', ')}` : 'independent'}${r.parallel ? ' (may run in parallel)' : ''}`);
  }
  if (cmd === 'step-brief') { // step-brief <build> <step>: the brief of a step-scoped launch (claude-headless.sh --step)
    const store = loadStore(); const b = storeCore.findBuild(store, rest[0]);
    if (!b) throw Object.assign(new Error(`no build "${rest[0]}"`), { code: 2 });
    const text = stepBriefFor(b, rest[1], rulesOf(store), { account: flag('account'), model: flag('model') });
    return out({ ok: true, id: b.id, step: rest[1], brief: text }, text);
  }
  if (cmd === 'split') {
    if (has('request')) { const b = setPipeline(rest[0], { splitRequested: nowIso() }, { note: `Split asked for by ${by}.`, by, action: 'pipeline:split-request' }); return out({ ok: true, id: b.id, requested: b.pipeline.splitRequested }, `${b.id}: split on the next tick`); }
    const r = splitBuild(rest[0], { provider: flag('provider'), by }); return out({ ok: true, ...r }, `${r.id}: ${r.note}`);
  }
  if (cmd === 'request') {
    const df = flag('detail-file'); const detail = df ? readFileSync(df, 'utf8') : flag('detail');
    const b = request({ title: flag('title'), detail, said: flag('said'), priority: flag('priority'), route: flag('route') === 'auto' ? '' : flag('route'), queue: has('queue'), by, source: flag('source') });
    return out({ ok: true, id: b.id, status: b.status, build: { id: b.id, title: b.title, status: b.status } }, `${b.id} filed${b.status === 'queued' ? ' and queued: the dispatcher starts it' : ' in Pending'}`);
  }
  if (cmd === 'aliases') { const r = assignAliases({ apply: has('apply'), all: has('all'), by }); return out({ ok: true, applied: has('apply'), aliases: r }, r.map((x) => `${x.id} → ${x.alias}`).join('\n') || 'every build id is a valid build name'); }
  if (cmd === 'land-alias') { const r = landAlias(rest[0], { by }); return out({ ok: true, ...r }, `${r.id} → ${r.alias}${r.dir ? `\nfolder ${r.dir}` : ''}${r.branch ? `\nbranch ${r.branch}` : ''}\n${r.note}`); }
  // done-means-merged@1: what is stuck, and the hand's Retry (the banner, the Attempts tab, REST / MCP / voice reach the same)
  if (cmd === 'attempts') {
    const b = storeCore.findBuild(loadStore(), rest[0] || ''); if (!b) throw Object.assign(new Error(`no build "${rest[0] || ''}"`), { code: 2 });
    const v = attemptsView(b);
    return out({ ok: true, id: b.id, status: b.status, ...v }, [`${b.id}: ${b.status}${v.failure ? ` · fixing ${v.failure.kind}${v.failure.step ? ` on ${v.failure.step}` : ''}: ${v.failure.why}` : ''}${v.escalation ? ` · escalated: ${v.escalation.why}` : ''}`,
      ...v.attempts.map((a) => `  ${String(a.n).padStart(2)} ${a.kind.padEnd(15)} ${(a.strategy + (a.fixStrategy ? `:${a.fixStrategy}` : '')).padEnd(18)} ${(a.model || '-').padEnd(5)} ${(a.account || a.source).padEnd(12)} ${a.result.padEnd(8)} ${a.startedAt} ${a.note.slice(0, 80)}`),
      v.next ? `  next: ${v.next.strategy}${v.next.fixStrategy ? `:${v.next.fixStrategy}` : ''}${v.next.model ? ` on ${v.next.model}` : ''}${v.next.notBefore ? ` not before ${v.next.notBefore}` : ''}` : '',
      v.landed ? `  landed: merged ${v.landed.mergedAt || '-'} sha ${v.landed.sha || '-'} CI ${v.landed.ci} verify ${v.landed.verifiedAt ? `${v.landed.verifyHow} ${v.landed.verifiedAt}` : 'not yet'}` : ''].filter(Boolean).join('\n'));
  }
  if (cmd === 'escalated') { const e = escalated(); return out({ ok: true, escalated: e }, e.map((x) => `${x.id}: ${x.kind} since ${x.since} after ${x.attempts} attempt(s): ${x.why}`).join('\n') || 'nothing escalated'); }
  if (cmd === 'retry') {
    if (!rest[0] || rest[0].startsWith('--')) throw Object.assign(new Error('retry <build> [strategy] [--why "…"]'), { code: 2 });
    const st = rest[1] && !rest[1].startsWith('--') ? rest[1] : flag('strategy');
    const r = retryBuild(rest[0], { strategy: st, by, why: flag('why') });
    return out({ ok: true, ...r }, `${r.id}: ${r.status}${r.strategy ? ` (${r.strategy})` : ''}${r.launch ? ` · ${r.launch.action}${r.launch.account ? ` on ${r.launch.account}` : ''}${r.launch.why ? `: ${r.launch.why}` : ''}` : ' · the next tick relaunches it'}`);
  }
  // launch-retry / land-clash bounce / step-dedupe: the same calls as REST, MCP and voice (pipeline-requeue, pipeline-dedupe)
  if (cmd === 'launch-state') {
    const b = storeCore.findBuild(loadStore(), rest[0] || ''); if (!b) throw Object.assign(new Error(`launch-state <build>: no build "${rest[0] || ''}"`), { code: 2 });
    const v = launchState(b);
    return out({ ok: true, ...v }, `${v.id}: ${v.status} · run ${v.runs} · launch retries ${v.retries}${v.gaveUp ? ' (gave up)' : ''}${v.lastLaunchError ? ` · last launch error: ${v.lastLaunchError}` : ''}${v.retryAt ? ` · next try ${v.retryAt}` : ''}${v.bounce ? ` · bounced ${v.bounce.count}× (${v.bounce.step}): ${v.bounceReason}` : ''}`);
  }
  if (cmd === 'launch-crashed') { // builds that stopped retrying after launch crashes (the systems check item)
    const rows = loadStore().builds.filter((b) => !b.deleted && b.pipeline?.launchRetry?.gaveUp && !['archived', ...SETTLED].includes(b.status)).map(launchState);
    if (has('requeue')) { const done = rows.map((r) => requeueLaunch(r.id, { by })); return out({ ok: true, requeued: done }, done.map((x) => `${x.id}: queued`).join('\n') || 'nothing to requeue'); }
    return out({ ok: true, crashed: rows }, rows.map((r) => `${r.id}: ${r.retries} launch crashes · ${r.lastLaunchError}`).join('\n') || 'no build is stuck crashing at launch');
  }
  if (cmd === 'requeue-launch') {
    if (!rest[0] || rest[0].startsWith('--')) throw Object.assign(new Error('requeue-launch <build>'), { code: 2 });
    const r = requeueLaunch(rest[0], { by }); return out({ ok: true, ...r }, `${r.id}: back in the Queue, launch retries reset`);
  }
  if (cmd === 'clash-bounce') {
    if (!rest[0] || rest[0].startsWith('--')) throw Object.assign(new Error('clash-bounce <build> [--files a,b] [--head sha]'), { code: 2 });
    const b = storeCore.findBuild(loadStore(), rest[0]); if (!b) throw Object.assign(new Error(`no build "${rest[0]}"`), { code: 2 });
    const given = flag('files') ? flag('files').split(',').map((x) => x.trim()).filter(Boolean) : null;
    const c = given ? { files: given, head: flag('head') || '', clash: true } : clashOf(b);
    if (!c.clash) return out({ ok: true, id: b.id, bounced: null, clash: false }, `${b.id}: merges clean with main, nothing to bounce`);
    const r = bounceClash(b.id, { files: c.files, head: flag('head') || c.head, why: flag('why') || `merging main in conflicts in ${c.files.join(', ')}`, by });
    return out({ ok: true, id: b.id, bounced: r, files: c.files, head: c.head }, r ? `${b.id}: ${r.step} added (${str(r.text, 140)}); back in the Queue` : `${b.id}: not bounced (steps still open, or this clash already has its step)`);
  }
  if (cmd === 'dedupe-steps') {
    const S = await import('../../../../framework/cli/builds-store.mjs');
    const ids = rest.filter((a, i) => !a.startsWith('--') && !['--by', '--why'].includes(rest[i - 1]));
    const r = S.dedupeStepsNow({ apply: has('apply'), ids, by });
    return out({ ok: true, ...r }, `${r.apply ? 'deduped' : 'dry run (--apply writes)'}: ${r.builds.length} build(s), ${r.total.before} → ${r.total.after} steps`);
  }
  if (cmd === 'retry-all') { const done = escalated().map((x) => retryBuild(x.id, { by, why: flag('why') || 'Retry from the systems check' })); return out({ ok: true, retried: done }, done.map((x) => `${x.id}: ${x.status}`).join('\n') || 'nothing escalated'); }
  if (cmd === 'show') { const b = storeCore.findBuild(loadStore(), rest[0]); if (!b) throw Object.assign(new Error(`no build "${rest[0]}"`), { code: 2 }); const r = row(b); return out({ ok: true, build: r }, `${r.id} ${r.status} ${r.steps.done}/${r.steps.total}${r.pipeline?.account ? ` on ${r.pipeline.account}` : ''}`); }
  if (cmd === 'route') { const b = setRoute(rest[0], rest[1], { by }); return out({ ok: true, id: b.id, route: b.pipeline?.route || 'auto' }, `${b.id}: route ${b.pipeline?.route || 'auto'}`); }
  if (cmd === 'intake') { const r = intake(); return out({ ok: true, ...r }, [`split: ${r.split.map((x) => `${x.id} (${x.provider}, ${x.steps})`).join(', ') || 'nothing'}`, `queued: ${r.queued.join(', ') || 'nothing'}`, ...r.skipped.map((x) => `skipped ${x.id}: ${x.error}`)].join('\n')); }
  if (cmd === 'requeue-stuck') {
    const r = requeueStuck({ apply: has('apply'), by });
    return out({ ok: true, ...r }, r.found.length ? [...r.found.map((f) => `${r.apply ? (r.moved.includes(f.id) ? 'requeued' : 'left') : 'would requeue'} ${f.id}: ${f.why}, next ${f.next || '?'}`), r.apply ? '' : '(dry run: --apply moves them)'].filter(Boolean).join('\n') : 'no Pending build is parked after a finished phase');
  }
  if (cmd === 'exit') {
    // the dispatcher's lock first: re-exec under flock (the cron tick's lock) unless already inside it or no flock here
    const lock = pipelineLock();
    if (process.env.AXF_PIPELINE_LOCKED !== '1' && spawnSync('flock', ['-V'], { encoding: 'utf8' }).status === 0) {
      try { mkdirSync(dirname(lock), { recursive: true }); } catch { /* flock reports it */ }
      // a step's exit must be recorded: the call is detached, so it waits out a long tick instead of giving up after two
      // minutes (Nov 23 2026: a clean exit was lost that way and the finished step was failed as "session gone")
      const r = spawnSync('flock', ['-w', flag('wait', '900'), lock, process.execPath, fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, AXF_PIPELINE_LOCKED: '1' } });
      process.exitCode = r.status ?? 1; return undefined;
    }
    const r = onExit(rest[0], { session: flag('session'), exit: Number(flag('exit', '0')), kind: flag('kind'), phase: flag('phase'), step: flag('step'), hit: flag('hit'), account: flag('account') });
    const e = r.ended;
    return out(r, !e ? `${r.id}: ${r.why}` : [`${r.id}: ${e.outcome} → ${e.status}${e.reason ? ` (${e.reason})` : ''}${e.phase ? `, phase ${e.phase}` : ''}${e.next ? `, next ${e.next}` : ''}`,
      r.tick ? (r.tick.error ? `tick failed: ${r.tick.error}` : `tick: launched ${r.tick.launched.map((l) => `${l.id} on ${l.account} (${l.model})`).join(', ') || 'nothing'}${r.tick.waits.map((w) => ` · ${w.id} waits: ${w.why}`).join('')}`) : ''].filter(Boolean).join('\n'));
  }
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
    if (has('use')) patch.use = flag('use') !== 'off';
    let building;
    if (has('parallel')) { // sessions per account is one stored key: this account's cap in claude-workers@1 (perAccount.<name>.building)
      if (!BP.accountName(rest[0])) throw Object.assign(new Error(`not an account name: ${rest[0]}`), { code: 2 });
      building = Math.max(1, Math.min(20, Number(flag('parallel')) || 1));
      editWorkersConfig((c) => { c.perAccount[rest[0]] = { ...(c.perAccount[rest[0]] ?? {}), building }; });
      patch.parallel = undefined; // the old copy, if this account still had one
    }
    const r = saveOwnAccount(rest[0], patch); return out({ ok: true, name: rest[0], record: r, ...(building ? { building } : {}) }, `${rest[0]}: ${JSON.stringify(r)}${building ? ` · ${building} sessions at once` : ''}`);
  }
  if (cmd === 'health') {
    if (has('request')) { const r = requestHealth({ by }); return out({ ok: true, ran: false, requested: r.at, last: loadHealth() }, `health sweep asked for: the next tick starts it (last: ${loadHealth()?.line || 'none yet'})`); }
    const r = health({ by });
    if (!r.ran) return out({ ok: true, ...r, last: loadHealth() }, r.why);
    return out({ ok: true, ...r }, [`health ${r.at}: ${r.line}`, ...r.accounts.map((a) => `  ${a.name.padEnd(16)} sign-in ${a.signedIn == null ? '?' : a.signedIn ? 'yes' : 'NO'} · credits ${a.credits == null ? '?' : a.credits ? 'yes' : 'NO'} · Fable ${a.fable == null ? '?' : a.fable ? 'yes' : 'NO'}${a.error ? ` · ${a.error}` : ''}`)].join('\n'));
  }
  if (cmd === 'tab') {
    const t = rest[0]; if (!BP.TABS.includes(t)) throw Object.assign(new Error(`tab is one of ${BP.TABS.join(', ')}`), { code: 2 });
    const rows = status().tabs[t];
    return out({ ok: true, tab: t, rows }, [`${BP.TAB_LABEL[t]} (${rows.length})`, ...rows.map((r) => `  ${r.id.padEnd(40)} ${r.status.padEnd(9)} ${r.steps.done}/${r.steps.total}${r.pipeline?.planned ? ` · planned ${r.pipeline.planned.model} on ${r.pipeline.planned.account || '—'}` : ''}${r.pipeline?.account ? ` · took ${r.pipeline.account}` : ''}`)].join('\n'));
  }
  if (cmd === 'probe') { const r = probe(rest[0]); return out({ ok: true, name: rest[0], probe: r }, `${rest[0]}: Fable ${r.fable ? 'yes' : 'no'}${r.error ? ` (${r.error})` : ''}`); }
  if (cmd === 'settings') { const s = loadSettings(); return out({ ok: true, settings: s }, Object.entries(s).filter(([k]) => k !== '$axf').map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')); }
  if (cmd === 'set') {
    const patch = {}; for (const a of rest) { const i = a.indexOf('='); if (i < 1) throw Object.assign(new Error('usage: set key=value …'), { code: 2 }); const v = a.slice(i + 1); patch[a.slice(0, i)] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v.includes(',') ? v.split(',') : v; }
    const s = saveSettings(patch); return out({ ok: true, settings: s }, 'saved');
  }
  throw Object.assign(new Error('usage: pipeline.mjs status | queue <id> [--by who] | unqueue|hold|release|archive|unarchive|delete|restore <id…> [--why w] | split <id> [--request] [--provider claude|rules] | intake | tick | requeue-stuck [--apply] | exit <id> [--session s] [--exit n] [--kind phase-done|crash|stopped] [--phase p] | accounts | account <name> [--fable on|off|auto] [--parallel n] [--use on|off] | probe <name> | health [--request] | tab <name> | selfcheck [--request] [--reason r] | settings | set k=v… | request --title T [--detail D] [--queue] [--route api|subscription] | route <id> api|subscription|auto | attempts <id> | escalated | retry <id> [strategy] [--why w] | retry-all [--json] | launch-state <id> | launch-crashed [--requeue] | requeue-launch <id> | clash-bounce <id> [--files a,b] [--head sha] | dedupe-steps [--apply] [id…]'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`pipeline: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  });
}
