/**
 * slot-registry.mjs — slot-registry@1: the live slot picture (real-time-slot-tracking s1, Nov 10 2026). Pure: no IO.
 *
 * How many slots are configured, in use and free, for the VPS, per Claude account and per model, judged from live
 * sessions only: an agent-slots entry counts while it runs and (once it beats) its heartbeat is fresh. A build's status
 * field never holds a slot: builds marked running / waiting with no live session are listed as ghosts (the reaper and
 * the reconcile in reaper.mjs fix them).
 *
 *   registry({ accounts, slots, builds, now }) → {
 *     $axf: 'slot-registry@1', at,
 *     vps:      { cap, used, free, queued, stale },
 *     accounts: [{ name, kind, fable, usable, why, configured, inUse, free, sessions: [session…] }],
 *     models:   { fable: { configured, inUse, free }, opus: { … } },
 *     sessions: [{ session, slot, build, account, model, live, beatAgeSec, startedAt, kind }],
 *     unassigned: [session…],   live sessions with no known account (adopted tmux, the swarm)
 *     stale:    [session…],     heartbeat silent past the timeout: the reaper's work
 *     ghosts:   [{ id, status, session, account, why }]   builds marked running / waiting that no live session runs
 *   }
 */

export const SCHEMA = 'slot-registry@1';
export const MODELS = ['fable', 'opus'];
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const modelOf = (v) => { const s = str(v).toLowerCase(); return s.includes('fable') ? 'fable' : s.includes('opus') ? 'opus' : s; };

/** The build id a tmux session name carries (axf-<id>--<agent> or axf-<id>), '' when none. */
export const buildOfSession = (name) => str(name).replace(/^axf-/, '').split('--')[0];

/**
 * One row per agent-slots running entry: which build, account and model it is, and whether it is live. Account and
 * model come from the entry's heartbeat, else from the build's pipeline record (sessions started before heartbeats).
 */
export function sessionsOf(slots, builds) {
  const byId = new Map(list(builds).map((b) => [b.id, b]));
  const bySession = new Map(list(builds).filter((b) => str(b.pipeline?.session)).map((b) => [b.pipeline.session, b]));
  return list(slots?.running).map((r) => {
    const session = str(r.session);
    const b = bySession.get(session) ?? byId.get(str(r.build)) ?? byId.get(buildOfSession(session)) ?? byId.get(str(r.name));
    const holding = r.state === 'running' || r.state === 'starting';
    return {
      session: session || str(r.name), slot: str(r.id), build: b?.id ?? str(r.build), kind: str(r.kind),
      account: str(r.account) || str(b?.pipeline?.account), model: modelOf(r.model) || modelOf(b?.pipeline?.model),
      live: holding && r.live !== false, finished: !holding, beatAgeSec: Number.isFinite(r.beatAgeSec) ? r.beatAgeSec : null, hb: !!r.hb,
      startedAt: str(r.startedAt),
    };
  });
}

/** Build ids that a live session runs (by slot entry or by a tmux session name). `tmux` = live tmux names or null. */
export function liveBuildIds(sessions, tmux = null) {
  const ids = new Set(list(sessions).filter((s) => s.live && s.build).map((s) => s.build));
  for (const n of tmux ?? []) { const id = buildOfSession(n); if (id) ids.add(id); }
  return ids;
}

export function registry({ accounts = [], slots = {}, builds = [], tmux = null, now = Date.now() } = {}) {
  const sessions = sessionsOf(slots, builds);
  const live = sessions.filter((s) => s.live);
  const accts = list(accounts).map((a) => {
    const mine = live.filter((s) => s.account === a.name);
    const configured = Math.max(0, Number(a.parallel) || 0);
    return { name: a.name, kind: a.kind === 'api' ? 'api' : 'subscription', fable: !!a.fable, usable: !!(a.usable || a.api?.usable), why: str(a.why),
      configured, inUse: mine.length, free: Math.max(0, configured - mine.length), sessions: mine.map((s) => s.session) };
  });
  const vpsFree = Math.max(0, Number(slots?.free) || 0);
  const models = {};
  for (const m of MODELS) {
    const able = accts.filter((a) => (m === 'fable' ? a.fable : true));
    models[m] = {
      configured: able.reduce((n, a) => n + a.configured, 0),
      inUse: live.filter((s) => s.model === m).length,
      free: Math.min(vpsFree, able.filter((a) => a.usable).reduce((n, a) => n + a.free, 0)),
    };
  }
  const known = new Set(accts.map((a) => a.name));
  const alive = liveBuildIds(sessions, tmux);
  const ghosts = list(builds)
    .filter((b) => !b.deleted && (b.status === 'running' || b.status === 'waiting') && b.kind !== 'epic' && !str(b.planRef) && !alive.has(b.id))
    .map((b) => ({ id: b.id, status: b.status, session: str(b.pipeline?.session), account: str(b.pipeline?.account), why: b.pipeline?.session ? `session ${b.pipeline.session} is not live` : 'no session recorded' }));
  return {
    $axf: SCHEMA, at: new Date(now).toISOString(),
    vps: { cap: Number(slots?.cap) || 0, used: Number(slots?.used) || 0, free: vpsFree, queued: Number(slots?.queued) || 0, stale: list(slots?.stale).length },
    accounts: accts, models, sessions,
    unassigned: live.filter((s) => !s.account || !known.has(s.account)).map((s) => s.session),
    stale: sessions.filter((s) => !s.live && !s.finished).map((s) => s.session),
    ghosts,
  };
}

/** One line per part, for the CLI and voice. */
export function describe(r) {
  const m = (k) => `${k[0].toUpperCase()}${k.slice(1)} ${r.models[k].inUse} in use, ${r.models[k].free} free of ${r.models[k].configured}`;
  return [
    `VPS slots: ${r.vps.used}/${r.vps.cap} in use, ${r.vps.free} free${r.vps.queued ? `, ${r.vps.queued} waiting` : ''}${r.vps.stale ? `, ${r.vps.stale} silent (reaper)` : ''}`,
    ...r.accounts.map((a) => `  ${a.name}${a.kind === 'api' ? ' [API]' : ''}: ${a.inUse}/${a.configured} in use, ${a.free} free${a.usable ? '' : ` (${a.why || 'not usable'})`}${a.sessions.length ? ` · ${a.sessions.join(', ')}` : ''}`),
    `Models: ${MODELS.map(m).join(' · ')}`,
    r.unassigned.length ? `No account known: ${r.unassigned.join(', ')}` : '',
    r.stale.length ? `Silent sessions: ${r.stale.join(', ')}` : '',
    r.ghosts.length ? `Marked running with no live session: ${r.ghosts.map((g) => g.id).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
