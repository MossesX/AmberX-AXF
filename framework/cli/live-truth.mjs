#!/usr/bin/env node
/**
 * live-truth.mjs — the one source of truth for "what is running" (live-truth@1, Brett, Nov 12 2026: the console showed 15
 * in progress while the VPS had exactly 8 running). The rules are in framework/plan/live-truth-core.mjs.
 *
 * On the VPS host (where tmux and the claude processes are) it looks: axf-* tmux sessions, the claude process under each,
 * the agent-slots holders and queue, the builds store. Off the host (the console container sees no tmux) it reads what
 * the host last published to <agent-slots dir>/live.json; the cron `axf-live-truth` (deploy/install-console.sh) publishes
 * every few seconds, so a killed session leaves the count within seconds. Every reader (console Active tab, in-progress
 * counts, slot meter, orchestrator, Build Manager, REST, MCP, CLI, voice) goes through read().
 *
 *   node framework/cli/live-truth.mjs [status] [--json]      what runs now (and which records are stale)
 *   … publish                                                look and write live.json (host)
 *   … watch [--for 58] [--every 3]                           publish in a loop (the cron's job)
 *   … reconcile [--apply] [--json]                           stale running / waiting records -> their real status (dry run without --apply)
 *
 * Environment: AXF_LIVE_TRUTH_FILE (default <agent-slots dir>/live.json), AXF_LIVE_TRUTH_MAX_AGE_S (20: an older file is
 * reported not fresh), AXF_SLOTS_TMUX=off (behave as off the host). Exit 0 ok, 2 usage.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/live-truth-core.mjs';
import * as slots from './agent-slots.mjs';
import { loadStore, withStore } from './builds-store.mjs';

export const truthFile = () => process.env.AXF_LIVE_TRUTH_FILE || join(slots.slotsDir(), 'live.json');
const maxAgeS = () => Number(process.env.AXF_LIVE_TRUTH_MAX_AGE_S) || 20;
const nowIso = () => new Date().toISOString();

/** One `ps` snapshot -> (panePid) -> does a `claude` process run under it? null when ps can't be run. */
export function claudeProbe() {
  const r = spawnSync('ps', ['-e', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return () => null;
  const kids = new Map(); const comm = new Map();
  for (const ln of (r.stdout || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(ln); if (!m) continue;
    comm.set(+m[1], m[3].trim()); (kids.get(+m[2]) ?? kids.set(+m[2], []).get(+m[2])).push(+m[1]);
  }
  return (pid) => {
    if (!comm.has(pid)) return false;
    const stack = [pid]; const seen = new Set();
    while (stack.length) {
      const p = stack.pop(); if (seen.has(p)) continue; seen.add(p);
      if (p !== pid && /^claude/.test(comm.get(p) ?? '')) return true;
      stack.push(...(kids.get(p) ?? []));
    }
    return false;
  };
}

const liveBuilds = () => { try { return loadStore().builds.filter((b) => !b.deleted); } catch { return []; } };

/** Look now (host only). Returns live-truth@1 with seen=false when tmux can't be seen here. */
export function collect({ builds = liveBuilds(), tmux = slots.tmuxSessions(), claude = null, state = slots.loadState(), settings = slots.loadSettings(), now = Date.now() } = {}) {
  const probe = claude ?? (tmux ? claudeProbe() : () => null);
  const sessions = core.liveSessions({ slots: state.running, tmux, claude: probe, builds, now });
  const queue = slots.ordered(state.queue);
  const t = core.truth({ host: process.env.AXF_SLOTS_HOST || hostname(), at: new Date(now).toISOString(), slots: { running: state.running, queue, cap: settings.maxAgents }, sessions, builds, now });
  return { ...t, source: 'host', ageSec: 0, fresh: !!t.seen };
}

export function publish(t = collect()) {
  if (!t.seen) return t;
  const f = truthFile(); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(t)}\n`); renameSync(tmp, f);
  return t;
}

/** The host's last published truth, with its age; null without one. */
export function readPublished(now = Date.now()) {
  try {
    const t = JSON.parse(readFileSync(truthFile(), 'utf8'));
    if (t?.$axf !== core.SCHEMA) return null;
    const ageSec = Math.max(0, Math.round((now - Date.parse(t.at)) / 1000));
    return { ...t, source: 'published', ageSec, fresh: ageSec <= maxAgeS() };
  } catch { return null; }
}

/**
 * The truth for any reader: looked up now on the host (and published, so the console gets it at once), else the host's
 * published file. `{ seen: false }` when neither exists: callers then say "can't see the VPS" instead of guessing.
 */
export function read({ builds } = {}) {
  if (process.env.AXF_SLOTS_TMUX !== 'off') {
    const t = collect(builds ? { builds } : {});
    if (t.seen) { try { publish(t); } catch { /* read-only here */ } return t; }
  }
  return readPublished() ?? { $axf: core.SCHEMA, at: '', host: '', seen: false, fresh: false, source: 'none', ageSec: null, count: 0, sessions: [], builds: { running: [], queued: [], starting: [], active: [] }, stale: [], slots: { used: 0, cap: 0, queued: 0 } };
}

/** One line for people (CLI, voice). */
export function line(t) {
  if (!t.seen) return 'Live truth unavailable: the VPS host has not published what runs (cron axf-live-truth).';
  const n = t.builds.running.length;
  const extra = [t.builds.queued.length ? `${t.builds.queued.length} waiting for a slot` : '', t.builds.starting.length ? `${t.builds.starting.length} starting` : '', t.stale.length ? `${t.stale.length} stale record(s)` : ''].filter(Boolean).join(', ');
  return `${t.count} session${t.count === 1 ? '' : 's'} running (${n} build${n === 1 ? '' : 's'}), slots ${t.slots.used}/${t.slots.cap}${extra ? `; ${extra}` : ''}${t.fresh ? '' : ` (as of ${t.ageSec}s ago)`}.`;
}

/**
 * Writes the truth into the store: every stale running / waiting record takes its real status (one store write, a note
 * on each). Only with a fresh look; `skip` = ids another rule settles this round. Returns the changes.
 */
export function reconcile({ apply = false, by = 'live-truth', t = read(), skip = [] } = {}) {
  if (!t.seen || !t.fresh) return { applied: false, changes: [], why: 'no fresh look at the VPS' };
  const changes = t.stale.filter((x) => !skip.includes(x.id));
  if (!apply || !changes.length) return { applied: false, changes };
  withStore((s) => {
    const at = nowIso();
    for (const c of changes) {
      const b = s.builds.find((x) => x.id === c.id);
      if (!b || !(b.status === 'running' || b.status === 'waiting')) continue;
      b.status = c.status;
      if (b.pipeline) b.pipeline = { ...b.pipeline, session: '', slot: '', note: `settled by the live truth: ${c.why}` };
      if ((c.status === 'built' || c.status === 'complete') && !b.builtAt) b.builtAt = at;
      b.notes.push({ text: `Live truth: was ${c.was}, ${c.why}: now ${c.status}.`, at });
      b.updatedAt = at;
    }
    return s;
  }, { by, action: 'live-truth:reconcile', note: changes.map((c) => c.id).join(', ') });
  return { applied: true, changes };
}

/* ---------------- CLI ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cli(argv) {
  const [cmd = 'status', ...rest] = argv;
  const flag = (k) => rest.includes(`--${k}`);
  const val = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 && rest[i + 1] ? rest[i + 1] : d; };
  const out = (v) => console.log(JSON.stringify(v, null, 1));
  switch (cmd) {
    case 'status': {
      const t = read();
      if (flag('json')) return out(t);
      console.log(line(t));
      for (const x of t.sessions) console.log(`  ${x.state.padEnd(8)} ${x.session}${x.build ? ` -> ${x.build}` : ''}${x.registered ? '' : ' (not in agent slots)'}`);
      for (const x of t.stale) console.log(`  stale    ${x.id}: ${x.was} -> ${x.status} (${x.why})`);
      return;
    }
    case 'publish': { const t = publish(); return console.log(t.seen ? line(t) : 'not on the host (no tmux): nothing published'); }
    case 'watch': {
      const until = Date.now() + Number(val('for', 58)) * 1000; const every = Math.max(1, Number(val('every', 3))) * 1000;
      while (Date.now() < until) { try { publish(); } catch (e) { console.error(`live-truth: ${e.message}`); } await sleep(every); }
      return;
    }
    case 'reconcile': { const r = reconcile({ apply: flag('apply') }); return flag('json') ? out(r) : console.log(`${r.applied ? 'settled' : 'would settle'} ${r.changes.length}: ${r.changes.map((c) => `${c.id} ${c.was}->${c.status}`).join(', ') || 'none'}${r.why ? ` (${r.why})` : ''}`); }
    default: console.error('usage: live-truth.mjs [status|publish|watch|reconcile] [--json] [--apply]'); process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) cli(process.argv.slice(2)).catch((e) => { console.error(`live-truth: ${e.message}`); process.exitCode = 2; });
