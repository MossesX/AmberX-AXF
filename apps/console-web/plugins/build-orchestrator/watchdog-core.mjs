/**
 * watchdog-core.mjs — the running-builds watchdog's pure side (Brett, Nov 9 2026: "verify that the correct number of
 * builds are running that he has marked running, and then do something about it if they're not").
 *
 * Every tick (watchdog.mjs, from the dispatcher's per-minute tick) compares each build marked `running` with what the
 * VPS really runs: its tmux session (axf-<id> or axf-<id>--<agent>), a live `claude -p` process in its worktree, its log
 * and the headless events. This file only decides; it never reads the disk or tmux, so the tests feed it fake state.
 *
 *   classify(obs, settings, now)  → { id, kind, why }       kind: ok | stalled | finished | waiting | phase-done | auth | crashed | stale
 *   decide(finding, ctx)          → action | null           what to do with the build (status, note, kill, retry, alert)
 *   strays(sessions, builds)      → [{ id, session }]       live sessions whose build is not marked running (the reverse)
 */

export const WATCHDOG_DEFAULTS = Object.freeze({ watchdogOn: true, watchdogEverySec: 60, watchdogStallMin: 20, watchdogMaxRetries: 2 });
export const WATCHDOG_LIMITS = Object.freeze({ watchdogEverySec: [60, 3600], watchdogStallMin: [5, 240], watchdogMaxRetries: [0, 5] });

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (t) => String(t ?? '').replace(ANSI, '');
/**
 * Claude's own sign-in failure, on a line of its own. Tool output in the log is indented or prefixed (▸ / ↳), so a build
 * that greps for these words never matches.
 */
const AUTH_LINE_RE = /^(?:Failed to authenticate\b|OAuth (?:session|token) (?:has )?expired\b|Invalid API key\b|Please run \/login\b|API Error: 401\b)/im;

/** Did the run stop on a dead Claude login? `tail` = the end of the log (a few KB). */
export const authFailed = (tail) => AUTH_LINE_RE.test(plain(tail));
/** The auth line itself, for notes and alerts. */
export const authLine = (tail) => plain(tail).split('\n').find((l) => AUTH_LINE_RE.test(l))?.trim().slice(0, 200) ?? '';

/**
 * How the last run in the log ended: 'done' (claude-stream's "■ done"), 'error' (any other "■ …" result line: an error
 * result, including the old "■ success" printed for an error result) or '' (no result line: still running or killed).
 */
export function endLabel(tail) {
  const m = [...plain(tail).matchAll(/^■ (\S+)/gm)].pop();
  if (!m) return '';
  return m[1] === 'done' ? 'done' : 'error';
}

/** Tmux sessions that belong to a build: axf-<id> or axf-<id>--<agent>. */
export const sessionsOf = (id, sessions) => (sessions ?? []).filter((n) => n === `axf-${id}` || n.startsWith(`axf-${id}--`));
/** The build id a session name carries ('' for a non-build session). */
export function idOfSession(name) {
  const m = /^axf-(.+?)(?:--[a-z0-9-]+)?$/.exec(String(name ?? ''));
  return m && !/^(?:signin|auto-land|console)\b/.test(m[1]) ? m[1] : '';
}

const mins = (ms) => Math.max(0, Math.round(ms / 60000));
const ago = (ms) => (ms < 2 * 3600e3 ? `${mins(ms)} min ago` : ms < 2 * 86400e3 ? `${Math.round(ms / 3600e3)} h ago` : `${Math.round(ms / 86400e3)} days ago`);
/** A build marked running with no sign of life for this long is stale: back to Pending, not relaunched. */
export const STALE_MS = 24 * 3600e3;

/**
 * One build marked running against what the VPS shows. `obs`:
 *   id, stepsLeft, phaseSwitch (the next open step runs on another model than the last run)
 *   sessions [names]   its tmux sessions          procs n        live `claude -p` processes in its worktree
 *   ended bool         the last session-start has a session-end after it (the tmux pane lingers ~2 min after claude exits)
 *   lastEnd { exit, at } | null    slotQueued bool (waiting in agent-slots for the VPS cap)
 *   log { mtimeMs, tail } | null   lastSignMs (the build's own last change: updatedAt, launch, last ticked step)
 */
export function classify(obs, settings = WATCHDOG_DEFAULTS, now = Date.now()) {
  const id = obs.id;
  const stallMs = (Number(settings.watchdogStallMin) || WATCHDOG_DEFAULTS.watchdogStallMin) * 60e3;
  const tail = obs.log?.tail ?? '';
  const alive = (obs.procs ?? 0) > 0 || ((obs.sessions ?? []).length > 0 && !obs.ended);
  if (obs.slotQueued) return { id, kind: 'ok', why: 'waiting for an agent slot' };
  if (alive) {
    const quiet = obs.log ? now - obs.log.mtimeMs : 0;
    if (obs.log && quiet > stallMs) return { id, kind: 'stalled', why: `session ${obs.sessions[0] ?? '(no tmux)'} alive but no log output for ${mins(quiet)} min` };
    return { id, kind: 'ok', why: 'running' };
  }
  if (!obs.stepsLeft) return { id, kind: 'finished', why: 'every step is ticked and no session runs' };
  if (authFailed(tail)) return { id, kind: 'auth', why: `the run stopped on a dead Claude login: ${authLine(tail)}` };
  const label = endLabel(tail);
  const clean = obs.lastEnd ? obs.lastEnd.exit === 0 && label !== 'error' : label === 'done';
  const left = `${obs.stepsLeft} step${obs.stepsLeft === 1 ? '' : 's'} left`;
  if (clean) return obs.phaseSwitch
    ? { id, kind: 'phase-done', why: `the session ended cleanly with ${left}; the next step runs on another model` }
    : { id, kind: 'waiting', why: `the session ended cleanly with ${left}: waiting on Brett` };
  if (obs.lastEnd && obs.lastEnd.exit !== 0) return { id, kind: 'crashed', why: `the session ended with exit ${obs.lastEnd.exit} (${left})` };
  const lastSign = Math.max(Number(obs.lastSignMs) || 0, obs.log?.mtimeMs ?? 0, obs.lastEnd ? Date.parse(obs.lastEnd.at) || 0 : 0);
  if (now - lastSign < stallMs) return { id, kind: 'ok', why: `no session on this VPS, last sign of life ${mins(now - lastSign)} min ago` };
  // dead for over a day: the code moved on since, so it goes back to Brett instead of being relaunched blind
  if (now - lastSign > STALE_MS) return { id, kind: 'stale', why: `no session and no claude process; last sign of life ${lastSign ? ago(now - lastSign) : 'never on this VPS'} (${left})` };
  return { id, kind: 'crashed', why: `no session and no claude process; last sign of life ${ago(now - lastSign)} (${left})` };
}

/**
 * What to do with one finding. ctx: { title, account, retries (auto relaunches so far), maxRetries, healthy (another
 * account can take the build now), mergedAt, sessions }. Returns null for ok, else
 *   { id, kind, status, note, retry, kill [sessions], markAuth account, alert { severity, title, body } }
 */
export function decide(f, ctx = {}) {
  if (!f || f.kind === 'ok') return null;
  const t = ctx.title || f.id;
  const max = Number.isFinite(ctx.maxRetries) ? ctx.maxRetries : WATCHDOG_DEFAULTS.watchdogMaxRetries;
  const retries = ctx.retries ?? 0;
  const base = { id: f.id, kind: f.kind, retry: false, kill: [], markAuth: '' };
  switch (f.kind) {
    case 'finished': {
      const status = ctx.mergedAt ? 'complete' : 'built';
      return { ...base, status, note: `Watchdog: ${f.why}: marked ${status}.`, alert: { severity: 'success', title: `Built: ${t}`, body: `${f.why}. Status ${status}.` } };
    }
    case 'waiting':
      return { ...base, status: 'pending', note: `Watchdog: ${f.why}. Back in Pending (UI Review or the next step waits on Brett).`, alert: { severity: 'info', title: `Waiting on you: ${t}`, body: `${f.why}. Moved from Running to Pending.` } };
    case 'stale':
      return { ...base, status: 'pending', note: `Watchdog: ${f.why}. Back in Pending, not relaunched: queue it again if it is still wanted.`, alert: { severity: 'warning', title: `Stale, back in Pending: ${t}`, body: `${f.why}. Marked running but dead for over a day; queue it again if it is still wanted.` } };
    case 'phase-done':
      return { ...base, status: 'queued', note: `Watchdog: ${f.why}: queued for the next phase.`, alert: { severity: 'info', title: `Next phase queued: ${t}`, body: f.why } };
    case 'auth': {
      const who = ctx.account || 'its account';
      const signIn = `Sign ${who} in again (console → AI keys → ${who} → Sign in).`;
      if (ctx.healthy && retries < max) return { ...base, status: 'queued', retry: true, markAuth: ctx.account || '', note: `Watchdog: ${f.why}. ${who} is off the worker list; requeued on a healthy account (auto retry ${retries + 1}/${max}).`, alert: { severity: 'error', title: `Claude login dead: ${who}`, body: `${t}: ${f.why}. Requeued on another account. ${signIn}` } };
      return { ...base, status: 'blocked', markAuth: ctx.account || '', note: `Watchdog: blocked: ${f.why}. ${signIn}`, alert: { severity: 'error', title: `Blocked, Claude login dead: ${who}`, body: `${t}: ${f.why}. ${ctx.healthy ? `Auto retries used up (${max}).` : 'No other account has room.'} ${signIn}` } };
    }
    case 'crashed':
    case 'stalled': {
      const kill = f.kind === 'stalled' ? [...(ctx.sessions ?? [])] : [];
      if (retries < max) return { ...base, status: 'queued', retry: true, kill, note: `Watchdog: ${f.why}. Relaunching through the Queue (auto retry ${retries + 1}/${max}).`, alert: { severity: 'warning', title: `${f.kind === 'stalled' ? 'Stalled' : 'Died'}, relaunching: ${t}`, body: `${f.why}. Auto retry ${retries + 1}/${max}.` } };
      return { ...base, status: 'failed', kill, note: `Watchdog: ${f.why}. Failed after ${max} auto retries.`, alert: { severity: 'error', title: `Build failed: ${t}`, body: `${f.why}. ${max} auto retries used up; it needs a look.` } };
    }
    default: return null;
  }
}

/**
 * The reverse: a live build session (a claude process or a session that has not ended) whose build is not marked
 * running. Only statuses the dispatcher would act on are fixed (a queued build would get a second session).
 */
export function strays(live, builds) {
  const byId = new Map((builds ?? []).filter((b) => !b.deleted).map((b) => [b.id, b]));
  const out = [];
  for (const s of live ?? []) {
    const b = byId.get(s.id);
    if (b && ['pending', 'queued', 'failed', 'blocked', 'waiting'].includes(b.status) && !out.some((o) => o.id === b.id)) out.push({ id: b.id, session: s.session, was: b.status });
  }
  return out;
}

/** The one-line summary the console shows. */
export function summaryLine(r) {
  if (!r?.at) return 'Watchdog has not run yet';
  return `${r.marked} marked running, ${r.real} really running${r.actions?.length ? `, ${r.actions.length} ${r.dry ? 'to fix' : 'fixed'}` : ''}`;
}
