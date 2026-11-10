/**
 * reaper.mjs — the stale reaper and the running-status reconcile (real-time-slot-tracking s3 + s4, Nov 10 2026).
 *
 * Reaper (every dispatcher tick, first thing): an agent-slots entry whose heartbeat went silent past heartbeatTimeoutSec
 * is a dead or frozen session. Its tmux session (else its process) is killed, its slot released, and its build set back:
 * to the Queue for another run, or to Pending flagged stuck once it was reaped maxReaps times in reapWindowHours.
 *
 * Reconcile (every tick after the session ends, and once at host start: `pipeline.mjs reconcile`, cron @reboot): a
 * build marked running / waiting that no live session runs (no live slot entry, no axf-<id> tmux session) and that
 * nobody touched for graceMin is fixed: PR merged -> complete; every step done -> built (PR open) or complete; launched
 * by the dispatcher -> back to the Queue (or Pending, stuck, past the limit); anything else -> Pending (paused, worktree
 * kept). Plan epics take their status from the plan and are left alone. Unseen processes (no tmux here) = nothing done.
 *
 * Every action is one line in <pipeline dir>/reaper.jsonl (`pipeline.mjs reaper-log`) and in the dispatcher log.
 * Pure parts take plain data; reap() / reconcile() take their IO as `io` so pipeline.mjs wires them and tests fake them.
 */

export const DEFAULTS = { maxReaps: 2, reapWindowHours: 24, graceMin: 10 };
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const sessionBuild = (name) => str(name).replace(/^axf-/, '').split('--')[0];
const openSteps = (b) => list(b?.steps).filter((x) => !x.done && !x.skip);
const isEpic = (b) => b?.kind === 'epic' || !!str(b?.planRef);

/** Reaps / requeues of a build inside the window (history = reaper.jsonl lines). */
export function recentReaps(history, id, { now = Date.now(), windowHours = DEFAULTS.reapWindowHours } = {}) {
  return list(history).filter((h) => h.build === id && (h.event === 'reaped' || h.event === 'reconciled') && h.to === 'queued' && now - Date.parse(h.at || 0) < windowHours * 3600e3).length;
}

/** Where a build goes when its session is gone: { status, outcome, stuck, why }. */
export function settle(b, { history = [], now = Date.now(), cause = 'reaped', limits = DEFAULTS } = {}) {
  if (str(b.mergedAt)) return { status: 'complete', outcome: 'finished', stuck: false, why: 'PR merged' };
  const left = openSteps(b);
  if (list(b.steps).length && !left.length) return { status: str(b.pr) ? 'built' : 'complete', outcome: 'finished', stuck: false, why: 'every step done' };
  const dispatched = !!(b.pipeline?.queuedAt || b.pipeline?.dispatchedAt || b.pipeline?.launchedAt);
  if (cause === 'reconciled' && !dispatched) return { status: 'pending', outcome: 'returned', stuck: false, why: 'paused (worktree kept): no live session runs it' };
  const n = recentReaps(history, b.id, { now, windowHours: limits.reapWindowHours });
  if (n >= limits.maxReaps) return { status: 'pending', outcome: 'failed', stuck: true, why: `stuck: its session died ${n + 1} times in ${limits.reapWindowHours} h` };
  return { status: 'queued', outcome: 'requeued', stuck: false, why: 'back in the Queue for another run' };
}

/**
 * The reaper's work: one item per silent slot entry. `stale` = agent-slots entries past their heartbeat timeout;
 * `builds` = the store's builds. The build is the one whose pipeline session is the entry's session, else the
 * entry's build id, else the session name's id; only a build still marked running / waiting is moved.
 */
export function reapPlan({ stale = [], builds = [], history = [], now = Date.now(), limits = DEFAULTS } = {}) {
  const live = list(builds).filter((b) => !b.deleted);
  return list(stale).map((e) => {
    const b = live.find((x) => e.session && x.pipeline?.session === e.session) ?? live.find((x) => x.id === e.build) ?? live.find((x) => x.id === sessionBuild(e.session));
    const moves = b && (b.status === 'running' || b.status === 'waiting') && !isEpic(b);
    return { slot: str(e.id), session: str(e.session), pid: Number(e.pid) || 0, host: str(e.host), account: str(e.account), beatAgeSec: e.beatAgeSec ?? null, build: b?.id ?? '', ...(moves ? { to: settle(b, { history, now, cause: 'reaped', limits }) } : {}) };
  });
}

/** Builds marked running / waiting that no live session runs, untouched for graceMin. `alive` = Set of build ids, or null (unseen). */
export function reconcilePlan({ builds = [], alive = null, history = [], now = Date.now(), limits = DEFAULTS } = {}) {
  if (!alive) return [];
  const out = [];
  for (const b of list(builds)) {
    if (b.deleted || !(b.status === 'running' || b.status === 'waiting') || isEpic(b) || alive.has(b.id)) continue;
    const touched = Math.max(Date.parse(str(b.updatedAt)) || 0, Date.parse(str(b.pipeline?.launchedAt)) || 0);
    if (touched && now - touched < limits.graceMin * 60e3) continue;
    out.push({ build: b.id, from: b.status, session: str(b.pipeline?.session), to: settle(b, { history, now, cause: 'reconciled', limits }) });
  }
  return out;
}

/**
 * Run the reaper. io = { stale(): entries, builds(): builds, history(): lines, kill(entry): how, release(slotId),
 * move(buildId, to, note, entry), log(line), alert(kind, d) }. Returns the items done.
 */
export function reap(io, { now = Date.now(), limits = DEFAULTS } = {}) {
  const items = reapPlan({ stale: io.stale(), builds: io.builds(), history: io.history(), now, limits });
  const done = [];
  for (const it of items) {
    let killed = '';
    try { killed = io.kill(it) || ''; } catch (e) { killed = `kill failed: ${str(e.message).slice(0, 120)}`; }
    try { io.release(it.slot); } catch { /* already gone */ }
    const silent = it.beatAgeSec != null ? `silent ${Math.round(it.beatAgeSec / 60)} min` : 'no heartbeat';
    let note = `Reaper: session ${it.session || it.slot} ${silent}${killed ? ` (${killed})` : ''}; its slot is free.`;
    if (it.to) {
      note += ` ${it.to.why}.`;
      try { io.move(it.build, it.to, note, it); } catch (e) { note += ` Moving the build failed: ${str(e.message).slice(0, 160)}`; }
      if (it.to.stuck) io.alert?.('failed', { id: it.build, title: it.build, outcome: 'stuck', note, account: it.account });
    }
    const line = { at: new Date(now).toISOString(), event: 'reaped', build: it.build, session: it.session, slot: it.slot, account: it.account, beatAgeSec: it.beatAgeSec, killed, to: it.to?.status ?? '', stuck: !!it.to?.stuck, note };
    io.log(line); done.push(line);
  }
  return done;
}

/** Run the reconcile. io = { builds(), alive(): Set | null, history(), move(buildId, to, note, item), log(line) }. */
export function reconcile(io, { now = Date.now(), limits = DEFAULTS } = {}) {
  const items = reconcilePlan({ builds: io.builds(), alive: io.alive(), history: io.history(), now, limits });
  const done = [];
  for (const it of items) {
    const note = `Reconcile: marked ${it.from} but no live session runs it${it.session ? ` (${it.session} is gone)` : ''}. ${it.to.why}.`;
    let error = '';
    try { io.move(it.build, it.to, note, it); } catch (e) { error = str(e.message).slice(0, 200); }
    if (it.to.stuck && !error) io.alert?.('failed', { id: it.build, title: it.build, outcome: 'stuck', note });
    const line = { at: new Date(now).toISOString(), event: 'reconciled', build: it.build, from: it.from, to: it.to.status, stuck: !!it.to.stuck, note, ...(error ? { error } : {}) };
    io.log(line); done.push(line);
  }
  return done;
}
