#!/usr/bin/env node
/**
 * Pipeline 2.0 watchdog, layer 2 (pipeline-watchdog@2): its own cron, its own code, every minute. Layer 1 (the
 * orchestrator tick) does the normal work; this pass finds what did not move and fixes it with no human:
 *
 *   stuck status (past its time budget)   → re-run the transition (the orchestrator tick for that build), then failed
 *   `building` step with no tmux session   → failed, then relaunched as attempt N+1 (through `ready`)
 *   `building` step whose log hit a limit  → account marked out (deploy/claude-workers.mjs markLimit), session killed,
 *                                            failed, relaunched on another account with usage left as attempt N+1
 *   hung `building` step (over budget, silent log) → session killed, failed, relaunched
 *   failed build / step                    → retried forward at the status it failed in, attempt N+1
 *   attempts used up                       → stays failed, ONE alert to Brett (the only page from this layer)
 *
 * The decisions are deploy/watchdog/core.mjs (pure). Every action is a note on the build in the builds store
 * (`by: watchdog`) and a line in <dir>/actions.jsonl. The pass writes <dir>/heartbeat.json for layer 3.
 *
 *   node deploy/watchdog/layer2.mjs scan [--json]          dry run: every issue and the planned action, nothing changes
 *   node deploy/watchdog/layer2.mjs run [--json]           one pass (the cron line runs this)
 *   node deploy/watchdog/layer2.mjs status [--json]        last pass, its age, recent actions
 *   node deploy/watchdog/layer2.mjs settings [--json] · set key=value…
 *
 * <dir> = AXF_WATCHDOG2_DIR, else <pipeline dir>/watchdog2 (the hub data store's pipeline folder, else ~/.axf/pipeline).
 * Layer 1 command: AXF_WATCHDOG2_TICK (default DEFAULT_TICK: the build orchestrator's `orchestrator.mjs tick`),
 * run with `--build <id>` appended for a nudge. Tests: AXF_WATCHDOG2_PROBES (JSON map "<build>/<step>" → probe),
 * AXF_WATCHDOG2_ACCOUNTS (JSON list of { name, usable, left }), AXF_WATCHDOG2_DRY_EXEC=1 (no tmux kill, no tick, no
 * markLimit: logged only), AXF_WATCHDOG_NOTIFY_LOG (alerts to a file), AXF_WATCHDOG2_STORE (a plain JSON store file).
 */
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './core.mjs';

const SELF = fileURLToPath(import.meta.url);
export const REPO = resolve(dirname(SELF), '../..');

export function pipeDir(env = process.env) {
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(homedir(), '.axf', 'pipeline');
}
export const dirOf = (env = process.env) => env.AXF_WATCHDOG2_DIR || join(pipeDir(env), 'watchdog2');
export const files = (env = process.env) => { const d = dirOf(env); return { dir: d, heartbeat: join(d, 'heartbeat.json'), memory: join(d, 'memory.json'), settings: join(d, 'settings.json'), actions: join(d, 'actions.jsonl') }; };
export const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
// layer 1's command; the marked line goes with the build-orchestrator plugin (then a nudge has nothing to run)
let orchTickCmd = '';
orchTickCmd = 'node apps/console-web/plugins/build-orchestrator/orchestrator.mjs tick'; // axf-plugin:build-orchestrator
export const DEFAULT_TICK = orchTickCmd;
/** The lander's statuses are nudged with one lander tick for that build (deploy/lander/run.mjs, under its own lock). */
export const DEFAULT_LANDER_TICK = 'node deploy/lander/run.mjs tick';

export const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
export function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); } // axf-data: not data (the watchdog's host-local heartbeat, memory and settings; build state goes through the builds store)
export function logAction(env, a) { const f = files(env).actions; mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, `${JSON.stringify({ at: new Date().toISOString(), by: C.BY, ...a })}\n`); } // axf-data: not data (the watchdog's host-local action log)

export const loadSettings = (env = process.env) => C.normSettings(readJson(files(env).settings, {}) ?? {});
export function saveSettings(patch, env = process.env) { const f = files(env).settings; const cur = readJson(f, {}) ?? {}; const next = { ...cur, ...patch }; writeJson(f, next); return C.normSettings(next); }

function tail(file, bytes = 16384) {
  try {
    const st = statSync(file); const n = Math.min(bytes, st.size); const buf = Buffer.alloc(n);
    const fd = openSync(file, 'r'); try { readSync(fd, buf, 0, n, st.size - n); } finally { closeSync(fd); }
    return { text: buf.toString('utf8'), ageMin: (Date.now() - st.mtimeMs) / 60000 };
  } catch { return null; }
}
export function tmuxHas(name) {
  if (!name) return null;
  const r = spawnSync('tmux', ['has-session', '-t', `=${name}`], { encoding: 'utf8', timeout: 10000 });
  if (r.error) return null; // no tmux here: unknown, never "dead"
  return r.status === 0;
}

/** Where a step runs: the step's own fields first (tmux, worktree, log), then the build-id naming the launcher uses. */
export function placeOf(b, s, env = process.env) {
  // the dispatcher names a step <build>--<step> (pipeline2.mjs stepName): worktree, branch claude/<name>, tmux axf-<name>[--agent]
  const name = s.worktree || (s.branch ? String(s.branch).replace(/^claude\//, '') : '') || `${b.id}--${s.id}`;
  const wt = name.startsWith('/') ? name : join(worktreesRoot(env), name);
  const base = wt.split('/').pop();
  // pipeline-2@1 keeps the tmux session name in `tmux` (`session` is the builds@1 same/new field); without it the
  // session is found by its prefix (guessed: never a reason on its own to call the step dead)
  return { session: s.tmux || '', prefix: `axf-${base}`, worktree: wt, log: s.log || join(wt, `${base}.log`), jsonl: join(wt, `${base}.jsonl`) };
}
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** tmux sessions named <prefix>, <prefix>--<agent>, either with the launcher's -HHMMSS suffix; null without tmux. */
export function tmuxByPrefix(prefix) {
  const r = spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8', timeout: 10000 });
  if (r.error) return null;
  if (r.status !== 0) return /no server running|error connecting/.test(r.stderr || '') ? [] : null;
  const re = new RegExp(`^${escRe(prefix)}(--[A-Za-z0-9._:-]+?)?(-\\d{6})?$`);
  return r.stdout.split('\n').filter((n) => re.test(n));
}

/** What is alive for every `building` step: tmux, the log tail (limit text), how long the log has been silent. */
export function probe(store, env = process.env) {
  if (env.AXF_WATCHDOG2_PROBES) return JSON.parse(env.AXF_WATCHDOG2_PROBES);
  const out = {};
  for (const b of store.builds ?? []) for (const s of b.steps ?? []) {
    if (s.status !== 'building') continue;
    const p = placeOf(b, s, env);
    const log = tail(p.log); const js = tail(p.jsonl, 8192);
    const ages = [log?.ageMin, js?.ageMin].filter((x) => x != null);
    let session = p.session; let tmux = session ? tmuxHas(session) : null;
    if (!session) { const found = tmuxByPrefix(p.prefix); if (found?.length) { session = found[0]; tmux = true; } else if (found) { session = p.prefix; tmux = false; } }
    out[`${b.id}/${s.id}`] = { session, tmux, logTail: `${log?.text ?? ''}\n${js?.text ?? ''}`, logAgeMin: ages.length ? Math.min(...ages) : null };
  }
  return out;
}

/** Claude accounts a relaunch may use: subscription logins that take jobs and are not out; fewest running jobs first. */
export async function accounts(env = process.env) {
  if (env.AXF_WATCHDOG2_ACCOUNTS) return JSON.parse(env.AXF_WATCHDOG2_ACCOUNTS);
  try {
    const { status } = await import('../claude-workers.mjs');
    return status(env).accounts.map((a) => ({ name: a.name, usable: a.kind === 'subscription' && !!a.takesJobs && !a.limited, left: Math.max(0.01, 1 - (a.running?.length ?? 0) * 0.1) }));
  } catch { return []; }
}

const dry = (env) => env.AXF_WATCHDOG2_DRY_EXEC === '1';
function sh(cmd, env, timeout = 300000) {
  if (dry(env)) return { ok: true, dry: true, cmd };
  const r = spawnSync('bash', ['-c', cmd], { cwd: REPO, env: { ...env, AXF_ACTOR: C.BY }, encoding: 'utf8', timeout });
  return { ok: r.status === 0, code: r.status, out: String(r.stdout || '').slice(-400), err: String(r.stderr || r.error?.message || '').slice(-400) };
}
export function nudge(build, env = process.env, { lander = false } = {}) {
  if (lander) return sh(`${env.AXF_WATCHDOG2_LANDER_TICK || DEFAULT_LANDER_TICK} --only ${JSON.stringify(build)}`, env, 600000);
  const tick = env.AXF_WATCHDOG2_TICK || DEFAULT_TICK;
  if (!tick) return { ok: false, code: 'no-orchestrator', out: '', err: 'no orchestrator tick here (the build orchestrator plugin is not installed)' };
  return sh(`${tick} --build ${JSON.stringify(build)}`, env, 600000);
}
function kill(session, env) { if (!session || dry(env)) return; spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 10000 }); }
async function outAccount(name, text, env) {
  if (!name || dry(env)) return;
  try { const { markLimit } = await import('../claude-workers.mjs'); markLimit(name, { kind: 'usage', text }, env); } catch { /* the relaunch still excludes it (tried) */ }
}

/** One alert to the console (axf.notify@1 pushes it to Brett's phone). Only give-ups use it. */
export function sendAlert(alert, env = process.env) {
  if (env.AXF_WATCHDOG_NOTIFY_LOG) { appendFileSync(env.AXF_WATCHDOG_NOTIFY_LOG, `${JSON.stringify(alert)}\n`); return true; } // axf-data: not data (test sink for alerts)
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off') return false;
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}/api/alerts"`;
  const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', cmd], { input: JSON.stringify(alert), encoding: 'utf8', timeout: 30000 });
  return !r.error && r.status === 0;
}

/**
 * The builds store: framework/cli/builds-store.mjs (Postgres on axf-data in cutover mode). AXF_WATCHDOG2_STORE=<file>
 * = a plain JSON file read and written as is (tests, and checking the pass before the store knows the 2.0 statuses).
 */
async function storeApi(env = process.env) {
  const f = env.AXF_WATCHDOG2_STORE;
  if (!f) return import('../../framework/cli/builds-store.mjs');
  return { loadStore: () => readJson(f, { builds: [] }), withStore: (fn) => { const s = readJson(f, { builds: [] }); const r = fn(s); writeJson(f, r?.builds ? r : s); return r; } };
}

/** Issues + decisions, nothing changed. */
export async function scan({ env = process.env, store = null, now = Date.now() } = {}) {
  const S = loadSettings(env);
  const st = store ?? (await storeApi(env)).loadStore();
  const probes = probe(st, env);
  const accts = await accounts(env);
  const memory = readJson(files(env).memory, {}) ?? {};
  const issues = C.findIssues(st, { probes, now, settings: S });
  const decisions = issues.map((i) => ({ issue: i, d: C.plan(i, { memory, settings: S, now, accounts: accts, store: st }) }));
  return { settings: S, issues, decisions, probes, memory };
}

/** One pass: apply every decision (one store write for all of them), run the side effects, beat the heartbeat. */
export async function run({ env = process.env, now = Date.now() } = {}) {
  const f = files(env);
  const started = new Date().toISOString();
  const S = loadSettings(env);
  if (!S.enabled) { writeJson(f.heartbeat, { $axf: C.SCHEMA, at: started, ok: true, off: true }); return { off: true, actions: [] }; }
  const api = await storeApi(env);
  const { issues, decisions, memory, probes } = await scan({ env, now });
  const acting = decisions.filter((x) => x.d.action !== 'wait');
  const actions = [];
  // side effects that must happen before the status change: the account out, the dead or hung session gone
  for (const { issue, d } of acting) {
    if (d.action === 'fail-limit') { await outAccount(issue.account, issue.evidence, env); kill(probes[`${issue.build}/${issue.step}`]?.session, env); }
    if (d.action === 'fail-dead' && d.kill) kill(probes[`${issue.build}/${issue.step}`]?.session, env);
  }
  const writes = acting.filter(({ d }) => d.action !== 'nudge');
  if (writes.length) {
    try {
      const planned = [];
      const w = api.withStore((store) => {
        planned.length = 0; // the store may run this again on a conflict: only the last run counts
        for (const { issue, d } of writes) { const note = C.applyDecision(store, issue, d, { now }); if (note) planned.push({ build: issue.build, step: issue.step || '', kind: issue.kind, action: d.action, note }); }
        return store;
      }, { by: C.BY, action: 'watchdog-heal', note: `${writes.length} fix(es)` });
      // a fix the store's guard refused was not kept (nothing of it, for that build): logged as refused, never as done
      const refused = new Set((w?.flowRefused ?? []).map((x) => x.id));
      for (const a of planned) actions.push(refused.has(a.build) ? { ...a, action: 'store-refused', note: `Watchdog: the store refused its fix for ${a.build}${a.step ? ` / ${a.step}` : ''} (${a.action}); nothing was changed.` } : a);
    } catch (e) { actions.push({ action: 'store-write-failed', note: String(e.message || e).slice(0, 300) }); }
  }
  // re-run stuck transitions (layer 1 for that build), each one note on the build
  const nudged = [];
  for (const { issue, d } of acting.filter(({ d }) => d.action === 'nudge')) {
    const r = nudge(issue.build, env, { lander: d.lander === true });
    const note = `Watchdog: ${issue.step ? `step ${issue.step}` : 'build'} stuck at ${issue.status} (${issue.minutes} min past budget): re-ran the transition (${d.n})${r.ok ? '' : `, the tick exited ${r.code}`}.`;
    nudged.push({ build: issue.build, note });
    actions.push({ build: issue.build, step: issue.step || '', kind: issue.kind, action: 'nudge', note, ok: r.ok });
  }
  if (nudged.length) {
    try {
      api.withStore((store) => { const at = new Date(now).toISOString(); for (const n of nudged) { const b = store.builds.find((x) => x.id === n.build); if (b) b.notes = [...(b.notes ?? []), { text: n.note, at, by: C.BY }]; } return store; }, { by: C.BY, action: 'watchdog-nudge' });
    } catch { /* the action log keeps it */ }
  }
  // the one page: attempts used up
  for (const a of actions.filter((x) => x.action === 'give-up')) {
    sendAlert({ source: C.BY, key: `watchdog:gave-up:${a.build}:${a.step}`, severity: 'error', title: `Watchdog could not heal ${a.build}${a.step ? ` / ${a.step}` : ''}`, body: `${a.note}\nFix: look at the build's notes; \`node deploy/watchdog/layer2.mjs scan\` shows what the watchdog sees.`, link: 'build-orchestrator.focus:watchdog', meta: { build: a.build, step: a.step } }, env);
  }
  // the watchers watch each other: a layer-3 heartbeat older than 10 min restarts its timer
  const l3 = readJson(join(f.dir, 'l3-heartbeat.json'), null);
  const l3Age = l3 ? (now - Date.parse(l3.at)) / 60000 : null;
  if (l3 && l3Age > 10 && !dry(env)) {
    const r = spawnSync('systemctl', ['restart', 'axf-watchdog-l3.timer'], { encoding: 'utf8', timeout: 30000 });
    actions.push({ action: 'l3-restart', ok: r.status === 0, note: `Watchdog: layer 3 last ran ${Math.round(l3Age)} min ago: restarted its timer${r.status === 0 ? '' : ' (failed)'}.` });
  }
  for (const a of actions) logAction(env, a);
  writeJson(f.memory, C.nextMemory(memory, issues, decisions.map((x) => x.d), now));
  writeJson(f.heartbeat, { $axf: C.SCHEMA, at: new Date().toISOString(), started, ok: true, pid: process.pid, issues: issues.length, actions: actions.length });
  return { issues, actions };
}

export function status(env = process.env, now = Date.now()) {
  const f = files(env);
  const hb = readJson(f.heartbeat, null);
  let recent = [];
  try { recent = readFileSync(f.actions, 'utf8').trim().split('\n').slice(-10).map((l) => JSON.parse(l)); } catch { /* none yet */ }
  const ageMin = hb ? (now - Date.parse(hb.at)) / 60000 : null;
  return { $axf: C.SCHEMA, dir: f.dir, lastPass: hb?.at || '', ageMin: ageMin == null ? null : +ageMin.toFixed(1), stale: ageMin == null || ageMin > 3, settings: loadSettings(env), recent };
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'status'; const json = argv.includes('--json');
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 1) : text);
  if (cmd === 'scan') {
    const r = await scan();
    return out({ issues: r.issues, decisions: r.decisions.map((x) => ({ ...x.issue, ...x.d })) }, r.decisions.length ? r.decisions.map(({ issue: i, d }) => `${i.build}${i.step ? `/${i.step}` : ''} ${i.status} ${i.kind} → ${d.action}: ${d.why}`).join('\n') : 'nothing stuck');
  }
  if (cmd === 'run') { const r = await run(); return out(r, r.off ? 'watchdog off' : `${new Date().toISOString()} ${r.issues.length} issue(s), ${r.actions.length} action(s)${r.actions.map((a) => `\n  ${a.note}`).join('')}`); }
  if (cmd === 'status') { const s = status(); return out(s, `layer 2: last pass ${s.lastPass || 'never'}${s.ageMin != null ? ` (${s.ageMin} min ago)` : ''}${s.stale ? ' STALE' : ''}\n${s.recent.map((a) => `  ${a.at} ${a.note}`).join('\n')}`); }
  if (cmd === 'settings') return out(loadSettings(), JSON.stringify(loadSettings(), null, 1));
  if (cmd === 'set') {
    const patch = {}; for (const kv of argv.slice(1).filter((a) => a.includes('='))) { const [k, v] = kv.split('='); patch[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v; }
    return out(saveSettings(patch), JSON.stringify(saveSettings(patch), null, 1));
  }
  console.error('usage: layer2.mjs scan|run|status|settings|set key=value… [--json]'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(`watchdog layer 2: ${e.message || e}`); process.exitCode = 1; });
