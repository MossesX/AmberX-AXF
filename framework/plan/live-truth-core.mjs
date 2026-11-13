/**
 * live-truth-core — what is really running on the VPS, and what every build record is once that is known
 * (live-truth@1, Brett, Nov 12 2026: "the console showed 15 in progress while the server had exactly 8 running").
 *
 * Pure: the IO side (framework/cli/live-truth.mjs) passes the facts in. The one rule: a session runs when its axf-* tmux
 * session exists AND a `claude` process runs under it. Agent-slots entries name the build a session works on; a tmux
 * session nobody registered is matched to a build by its (truncated) name. A build is active only when a live session
 * runs it, the agent-slots queue holds it, or it was launched moments ago (`startGraceMs`). Every other record that says
 * running / waiting is stale and is shown (and, by the dispatcher, written) as its real state:
 *   PR merged -> complete · every step done -> built (PR open) or complete · otherwise -> pending (paused, worktree kept).
 */

export const SCHEMA = 'live-truth@1';
export const START_GRACE_MS = 120_000;
const s = (v, n = 200) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);

/** `axf-<build>--<agent>` (the build part truncated by the launcher) -> { stem, agent }. */
export function parseSession(name) {
  const bare = s(name).replace(/^axf-/, '');
  const i = bare.lastIndexOf('--');
  return i > 0 ? { stem: bare.slice(0, i).replace(/-+$/, ''), agent: bare.slice(i + 2) } : { stem: bare.replace(/-+$/, ''), agent: '' };
}

/** The build a session works on: the build whose pipeline names the session, else the one id its stem starts. */
export function buildForSession(name, builds = []) {
  const exact = builds.find((b) => s(b.pipeline?.session) === name);
  if (exact) return exact.id;
  const { stem } = parseSession(name);
  if (!stem) return '';
  const hits = builds.filter((b) => b.id === stem || b.id.startsWith(`${stem}-`) || b.id.startsWith(stem));
  return hits.length === 1 ? hits[0].id : (hits.find((b) => b.id === stem)?.id ?? '');
}

/**
 * Live sessions from the facts.
 *   slots   agent-slots running entries ({ id, build, name, session, state, pid, startedAt })
 *   tmux    Map session name -> { pid, created } (axf-* only), or null when tmux can't be seen here
 *   claude  (panePid) -> true | false | null (null = can't tell: counted as live, never drop real work)
 * Returns [{ session, build, slot, agent, state: 'running' | 'starting', pid, startedAt, registered }].
 */
export function liveSessions({ slots = [], tmux = null, claude = () => null, builds = [], now = Date.now(), startGraceMs = START_GRACE_MS } = {}) {
  if (!tmux) return null;
  const out = [];
  const seen = new Set();
  for (const r of slots) {
    if (!r || !(r.state === 'running' || r.state === 'starting') || !r.session) continue;
    const t = tmux.get(r.session);
    if (!t) continue;
    seen.add(r.session);
    const has = claude(t.pid);
    const young = now - Date.parse(r.startedAt || r.enqueuedAt || 0) < startGraceMs;
    if (has === false && !young) continue;
    out.push({ session: r.session, build: s(r.build) || buildForSession(r.session, builds), slot: s(r.id, 80), agent: parseSession(r.session).agent,
      state: has === false ? 'starting' : 'running', pid: t.pid, startedAt: s(r.startedAt, 40), registered: true });
  }
  for (const [name, t] of tmux) {
    if (seen.has(name)) continue;
    const has = claude(t.pid);
    const young = now - (t.created || now) < startGraceMs;
    if (has === false && !young) continue;
    out.push({ session: name, build: buildForSession(name, builds), slot: '', agent: parseSession(name).agent,
      state: has === false ? 'starting' : 'running', pid: t.pid, startedAt: t.created ? new Date(t.created).toISOString() : '', registered: false });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

const ACTIVE = new Set(['running', 'waiting']);

/** What a stale record really is: { status, why }. */
export function settledStatus(b) {
  if (s(b.mergedAt)) return { status: 'complete', why: 'its PR is merged' };
  const steps = (b.steps ?? []).filter((x) => !x.skip);
  if (steps.length && steps.every((x) => x.done)) return { status: s(b.pr) ? 'built' : 'complete', why: 'every step is done and no session runs it' };
  return { status: 'pending', why: 'no live session runs it (paused, worktree kept)' };
}

/**
 * The truth for the builds: { running: [{ id, sessions }], queued: [ids in the agent-slots queue], starting: [ids launched
 * < startGraceMs ago with no session yet], stale: [{ id, was, status, why }] }. `sessions` null (tmux unseen) = nothing is
 * judged stale.
 */
export function buildsTruth({ builds = [], sessions = null, slotQueue = [], now = Date.now(), startGraceMs = START_GRACE_MS } = {}) {
  const by = new Map();
  for (const x of sessions ?? []) if (x.build) (by.get(x.build) ?? by.set(x.build, []).get(x.build)).push(x.session);
  const queuedIds = new Set(slotQueue.map((q) => s(q.build) || s(q.name)).filter(Boolean));
  const running = []; const queued = []; const starting = []; const stale = [];
  for (const b of builds) {
    if (!b || b.deleted) continue;
    if (by.has(b.id)) { running.push({ id: b.id, sessions: by.get(b.id) }); continue; }
    if (!ACTIVE.has(b.status) || sessions == null) continue;
    if (queuedIds.has(b.id) || [...queuedIds].some((q) => b.id.startsWith(q))) { queued.push(b.id); continue; }
    const at = Date.parse(b.pipeline?.launchedAt || b.pipeline?.dispatchedAt || '');
    if (Number.isFinite(at) && now - at < startGraceMs) { starting.push(b.id); continue; }
    const to = settledStatus(b);
    stale.push({ id: b.id, was: b.status, status: to.status, why: to.why, session: s(b.pipeline?.session, 120) });
  }
  return { running, queued, starting, stale };
}

/** The whole live-truth@1 document. */
export function truth({ host = '', at = new Date().toISOString(), slots = { running: [], queue: [], cap: 0 }, sessions = null, builds = [], now = Date.parse(at), startGraceMs = START_GRACE_MS } = {}) {
  const bt = buildsTruth({ builds, sessions, slotQueue: slots.queue ?? [], now, startGraceMs });
  const list = sessions ?? [];
  return {
    $axf: SCHEMA, at, host, seen: sessions != null,
    count: list.length,
    sessions: list,
    builds: { running: bt.running, queued: bt.queued, starting: bt.starting, active: [...bt.running.map((r) => r.id), ...bt.queued, ...bt.starting] },
    stale: bt.stale,
    slots: { used: list.length, cap: Number(slots.cap) || 0, queued: (slots.queue ?? []).length },
  };
}

/** Is this build active per the truth? (unseen truth = trust the record) */
export function isActive(t, id) {
  if (!t || !t.seen) return null;
  return t.builds.active.includes(id);
}

/** A build record as the truth shows it: a stale running / waiting record takes its real status (marked `stale`). */
export function view(b, t) {
  if (!b || !t?.seen) return b;
  const st = t.stale.find((x) => x.id === b.id);
  return st ? { ...b, status: st.status, stale: { was: st.was, why: st.why } } : b;
}
