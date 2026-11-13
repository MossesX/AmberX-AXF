#!/usr/bin/env node
/**
 * session-liveness.mjs — what really runs, joined to the builds that say they run (build auto-recover-stuck-builds,
 * Nov 13 2026, Brett: "Detect builds marked running with no live session (killed exit 143, failed exit 1)").
 *
 * Joins four facts for every build the builds store (builds@1) has as running / waiting / failed:
 *   1. live tmux sessions on this host (agent-slots tmuxSessions: axf-* names and their pane pid)
 *   2. session-status@1 records the headless runs write (deploy/claude-headless.sh → agent-slots `session`):
 *      start, end (exit code, signal), account, the run's pid and host
 *   3. heartbeats (<session>.heartbeat: when claude's stream last moved)
 *   4. agent slots that hold a build (agent-slots@1 state: running / starting entries only; finished ones hold nothing)
 *
 * and returns exactly the input framework/core/build-recovery.mjs plan(builds, sessions, slots, now) expects:
 *   { builds, sessions: [{ name, alive, exit, heartbeatAt }], slots: { running, queue }, now, rows }
 * `rows` is the readable join per build (its session, pid, heartbeat age, exit, the assess() verdict) for the CLI,
 * the Recovery log and the systems check. Nothing here changes a build, a slot or a session: recover.mjs does that.
 *
 * A session is alive when its record says running and (on the host that wrote it) its pid or its tmux session is still
 * there; on another host the record and its heartbeat are taken as they are. A record that says running whose process
 * is gone with no end written (SIGKILL, a host reboot) reads as ended with no exit code. A build whose pipeline record
 * names no session borrows the newest record written for it (the run's build id), so plan() can match it.
 *
 *   node framework/cli/session-liveness.mjs list [--json]     every live build with its session facts and verdict
 *   … input [--json]                                           the plan() input only (builds trimmed to live ones)
 *
 * Tests pass facts: liveness({ store, records, tmux, slots, alive, now, host }).
 */
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { holding, loadState, readSessionStatuses, tmuxSessions } from './agent-slots.mjs';
import { loadStore } from './builds-store.mjs';
import { assess, POLICY } from '../core/build-recovery.mjs';

export const SCHEMA = 'session-liveness@1';
const LIVE = ['running', 'waiting', 'failed'];
const pidAlive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));

/** The session record that belongs to a build: its named session (or that name with an --agent suffix), else its newest record. */
export function recordFor(b, records) {
  const want = b?.pipeline?.session || '';
  const named = want ? records.filter((r) => r.session === want || r.session.startsWith(`${want}--`) || r.session.startsWith(`${want}-`)) : [];
  const pool = named.length ? named : records.filter((r) => r.build && r.build === b?.id);
  return [...pool].sort((x, y) => String(y.startedAt).localeCompare(String(x.startedAt)))[0] ?? null;
}

/** Is a running record really running? Only judged on its own host; another host's record is taken as written. */
export function recordAlive(r, { tmux = null, alive = pidAlive, host = hostname() } = {}) {
  if (!r || r.state === 'ended') return false;
  if (r.host && r.host !== host) return true;
  if (tmux && tmux.has(r.session)) return true;
  return alive(r.pid);
}

/**
 * The plan() input. facts (all optional): store (builds@1), records (session-status@1 list), tmux (Map name → { pid }
 * or null), slots (agent-slots@1 state), alive(pid), host, now.
 */
export function liveness(facts = {}) {
  const now = facts.now ?? Date.now();
  const host = facts.host ?? process.env.AXF_SLOTS_HOST ?? hostname();
  const store = facts.store ?? loadStore();
  const records = facts.records ?? readSessionStatuses({ now });
  const tmux = facts.tmux !== undefined ? facts.tmux : tmuxSessions();
  const st = facts.slots ?? loadState();
  const slots = { running: holding(st), queue: st.queue ?? [] };
  const alive = facts.alive ?? pidAlive;
  const builds = (store.builds ?? []).filter((b) => b && !b.deleted && LIVE.includes(b.status));
  const sessions = new Map();   // name → plan() session row
  const add = (name, row) => { if (name && !sessions.has(name)) sessions.set(name, { name, ...row }); };
  const rows = []; const outBuilds = [];
  for (const b of builds) {
    const rec = recordFor(b, records);
    const p = b.pipeline ?? {};
    const name = p.session || rec?.session || '';
    const live = rec ? recordAlive(rec, { tmux, alive, host }) : !!(name && tmux?.has(name));
    if (rec) add(name, { alive: live, exit: live ? null : rec.exit, heartbeatAt: rec.heartbeatAt || rec.startedAt || '' });
    else if (name && tmux?.has(name)) add(name, { alive: true, exit: null, heartbeatAt: '' });
    // plan() matches a build to its session by pipeline.session: lend it the record's name when the build has none
    const nb = !p.session && rec ? { ...b, pipeline: { ...p, session: rec.session } } : b;
    outBuilds.push(nb);
    rows.push({ b, nb, rec, name, live });
  }
  // every live tmux session not tied to a build still counts (plan() knows it is alive)
  for (const [name] of tmux ?? []) add(name, { alive: true, exit: null, heartbeatAt: records.find((r) => r.session === name)?.heartbeatAt || '' });
  const sessionList = [...sessions.values()];
  const view = rows.map(({ b, nb, rec, name, live }) => {
    const v = assess(nb, { sessions: sessionList, slots, now, policy: facts.policy ?? POLICY });
    const hb = rec?.heartbeatAt ? Math.round((now - ms(rec.heartbeatAt)) / 1000) : null;
    return {
      build: b.id, title: b.title, status: b.status, session: name, account: rec?.account || b.pipeline?.account || '', host: rec?.host || '',
      pid: rec?.pid ?? null, alive: live, recorded: !!rec, startedAt: rec?.startedAt || '', endedAt: rec?.endedAt || '',
      exit: rec && !live ? rec.exit : null, signal: rec && !live ? rec.signal : '', heartbeatAgeSec: hb, log: rec?.log || '',
      slot: slots.running.find((s) => s.build === b.id || (name && s.session === name))?.id ?? '', state: v.state, why: v.why,
    };
  });
  return { $axf: SCHEMA, at: new Date(now).toISOString(), host, tmux: tmux != null, builds: outBuilds, sessions: sessionList, slots, rows: view };
}

/** Just what plan() takes, in order: [builds, sessions, slots, now]. */
export const planArgs = (l) => [l.builds, l.sessions, l.slots, Date.parse(l.at)];

/* ---------------- CLI ---------------- */

const age = (s) => (s == null ? '-' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

function cli(argv) {
  const [cmd = 'list', ...rest] = argv;
  const json = rest.includes('--json');
  const l = liveness();
  if (cmd === 'input') return console.log(JSON.stringify({ builds: l.builds, sessions: l.sessions, slots: l.slots, now: l.at }, null, json ? 2 : 0));
  if (cmd !== 'list') throw new Error(`unknown command ${cmd} (list, input)`);
  if (json) return console.log(JSON.stringify(l, null, 2));
  if (!l.rows.length) return console.log('no build is marked running, waiting or failed');
  for (const r of l.rows) {
    const facts = r.recorded ? `${r.alive ? 'alive' : `ended${r.exit == null ? '' : ` exit ${r.exit}${r.signal ? ` ${r.signal}` : ''}`}`} · heartbeat ${age(r.heartbeatAgeSec)}` : 'no session record';
    console.log(`${(r.state || 'ok').padEnd(15)} ${r.build} (${r.status}) ${r.session || '-'} · ${facts}${r.slot ? ` · slot ${r.slot}` : ''} · ${r.why}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { cli(process.argv.slice(2)); } catch (e) { console.error(`session-liveness: ${e.message}`); process.exitCode = 2; }
}
