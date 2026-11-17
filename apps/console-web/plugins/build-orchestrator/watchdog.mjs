#!/usr/bin/env node
/**
 * watchdog.mjs — the orchestrator's build watchdog (build-watchdog@1, IO side of framework/core/build-watchdog.mjs).
 *
 * Brett, Nov 13 2026: "if anything stops working, the server/orchestrator fixes it automatically with no one asking.
 * Detect builds marked running with no live session (e.g. killed exit 143, failed exit 1), reset and requeue them, retry
 * failed sessions, keep every slot filled, and send an FYI to the phone for each fix. Never wait for Brett to notice."
 *
 * One pass: read the builds store, take every build marked Building (isMarkedRunning), probe what is alive for it on this
 * host (framework/cli/agent-slots.mjs alive: pid, tmux, heartbeat, the run-status file) plus the evidence the headless
 * wrapper left on the build (pipeline.runEnd, the session-end event), and let the decision table say what to do.
 *
 *   node apps/console-web/plugins/build-orchestrator/watchdog.mjs scan [--json]     dry run: every stuck build, its cause and
 *                                                                                   the planned action; nothing changes
 *
 * Files: <pipeline dir>/watchdog.json (watchdog-state@1: last pass, recent fixes), next to the dispatcher's state.
 * Environment for tests: AXF_WATCHDOG_SETTINGS (a JSON patch over the settings), AXF_WATCHDOG_ACCOUNTS (comma list of usable
 * accounts instead of deploy/claude-workers.mjs status), AXF_WATCHDOG_PROBE (a JSON map build → probe instead of the host).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../../../../framework/core/build-watchdog.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import * as slots from '../../../../framework/cli/agent-slots.mjs';
import { hitOf, status as workersStatus } from '../../../../deploy/claude-workers.mjs';
import { pipeDir, worktreeOf } from './pipeline.mjs';

const SELF = fileURLToPath(import.meta.url);
export const SCHEMA_STATE = 'watchdog-state@1';
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const headlessDir = (env = process.env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';

export const stateFile = (env = process.env) => join(pipeDir(env), 'watchdog.json');
export const loadState = (env = process.env) => ({ $axf: SCHEMA_STATE, lastPass: '', lastFix: '', passes: 0, recent: [], ...(readJson(stateFile(env), {}) ?? {}) });

/** The watchdog settings (build-watchdog@1 normSettings): defaults, then the saved settings, then AXF_WATCHDOG_SETTINGS. */
export function loadSettings(env = process.env) {
  let patch = {};
  try { patch = env.AXF_WATCHDOG_SETTINGS ? JSON.parse(env.AXF_WATCHDOG_SETTINGS) : {}; } catch { /* a bad patch is ignored */ }
  return W.normSettings({ ...(readJson(join(pipeDir(env), 'watchdog-settings.json'), {}) ?? {}), ...patch });
}

/** Accounts a retry may go to (claude-workers: every account that takes jobs). [] = unknown (the table then never gives up on accounts). */
export function usableAccounts(env = process.env) {
  if (env.AXF_WATCHDOG_ACCOUNTS != null) return env.AXF_WATCHDOG_ACCOUNTS.split(',').map((s) => s.trim()).filter(Boolean);
  try { return workersStatus(env).accounts.filter((a) => a.takesJobs).map((a) => a.name); } catch { return []; }
}

function sessionEnd(b, env) {
  const ses = b.pipeline?.session; if (!ses) return null;
  let t = ''; try { t = readFileSync(join(headlessDir(env), 'events.jsonl'), 'utf8'); } catch { return null; }
  const since = Date.parse(b.pipeline.launchedAt || 0) - 5000;
  let end = null;
  for (const l of t.split('\n')) {
    if (!l.includes('"session-end"') || !l.includes(ses)) continue;
    try { const e = JSON.parse(l); if (e.event === 'session-end' && e.session === ses && Date.parse(e.at || 0) >= since) end = e; } catch { /* skip */ }
  }
  return end;
}
function tailOf(file, bytes = 16384) {
  try { const t = readFileSync(file, 'utf8'); return t.slice(-bytes); } catch { return ''; }
}

/**
 * The probe for one build: what the host sees (agent-slots alive) merged with the evidence on the build (pipeline.runEnd,
 * newer than its launch) and the session-end event. An exit on either is the exit; a usage / login stop on either is the limit.
 */
export function probeBuild(b, env = process.env) {
  let fake = null; try { fake = env.AXF_WATCHDOG_PROBE ? JSON.parse(env.AXF_WATCHDOG_PROBE) : null; } catch { /* ignored */ }
  if (fake && fake[b.id]) return W.normProbe(fake[b.id]);
  const p = b.pipeline ?? {};
  const since = p.launchedAt || p.dispatchedAt || '';
  const a = slots.alive(b.id, { dir: worktreeOf(b.id, env), since });
  const re = p.runEnd && (!since || p.runEnd.at > since) ? p.runEnd : null;
  const ev = sessionEnd(b, env);
  const exit = re?.exit ?? a.exit ?? (ev && Number.isInteger(ev.exit) ? ev.exit : null);
  const exitKind = re?.kind || a.exitKind || (ev?.kind && W.EXIT_KINDS.includes(ev.kind) ? ev.kind : '');
  let limit = re?.limit || a.limit || '';
  if (!limit && exit != null && exit !== 0 && ev?.log) limit = hitOf(tailOf(ev.log), exit) || '';
  return { ...W.normProbe({ pid: a.pid, tmux: a.tmux, lastSeenAt: a.lastSeenAt, exit, exitKind, limit, at: a.at }), sessions: a.sessions, pids: a.pids, slots: a.slots, heartbeat: a.heartbeat };
}

/**
 * The dry run: every build marked Building, probed and decided. Returns { at, settings, builds: [{ id, title, status,
 * probe, decision }], stuck: [...the stuck ones] }. Nothing changes.
 */
export function scan({ env = process.env, store = loadStore(), settings = loadSettings(env), accounts = null } = {}) {
  const at = new Date().toISOString();
  const usable = accounts ?? usableAccounts(env);
  const builds = [];
  for (const b of store.builds) {
    if (!W.isMarkedRunning(b)) continue;
    let probe;
    try { probe = probeBuild(b, env); } catch (e) { probe = { ...W.normProbe({}, at), error: str(e.message, 200) }; }
    const decision = W.decide(b, probe, settings, { accounts: usable, now: probe.at || at });
    builds.push({ id: b.id, title: str(b.title, 120), status: b.status, account: b.pipeline?.account ?? '', session: b.pipeline?.session ?? '', launchedAt: b.pipeline?.launchedAt ?? '', probe, decision });
  }
  return { $axf: 'watchdog-scan@1', at, settings, accounts: usable, builds, stuck: builds.filter((x) => x.decision.stuck) };
}

const line = (x) => `${x.id}: ${x.decision.cause}${x.decision.exit != null ? ` (exit ${x.decision.exit})` : ''} → ${x.decision.action}${x.decision.attempt ? ` · attempt ${x.decision.attempt}` : ''} · ${x.decision.note}`;

// ------------------------------------------------------------------ CLI

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i += 1; } } else out._.push(a);
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd = 'scan', ...rest] = argv;
  const f = flags(rest);
  const out = (o, text) => console.log(f.json ? JSON.stringify(o, null, 1) : text);
  if (cmd === 'scan') {
    const r = scan();
    return out(r, r.builds.length ? [`${r.builds.length} marked running · ${r.stuck.length} stuck${r.settings.enabled ? '' : ' · watchdog off'}`, ...r.builds.map((x) => `  ${x.decision.stuck ? '!' : ' '} ${line(x)}`)].join('\n') : 'nothing marked running');
  }
  throw Object.assign(new Error(`unknown command ${cmd} (scan)`), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().catch((e) => { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`watchdog: ${e.message}`); process.exitCode = e.code === 2 ? 2 : 1; });
}
