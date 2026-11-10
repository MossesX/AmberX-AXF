/**
 * stall-core.mjs: the stall watchdog's decisions, no IO (stall-watchdog.mjs does the IO).
 *
 * Brett, Nov 10 2026: "Why am I not being notified when it stalls? You need to be monitoring it so you know when it
 * stalls, then try to fix it, then let me know."
 *
 * A stall is one of:
 *   idle        nothing is building while the Queue (or Pending, for Urgent / High builds) has work
 *   dead        a build is marked running but its headless session is gone
 *   tick        the dispatcher's tick has not finished for STALE_TICK_MIN minutes (cron stopped, tick crashing or hung)
 * The fixes run in order, each followed by a fresh look: pipeline self-check, release dead slots, auto-queue Urgent / High
 * Pending builds when the Queue is empty, restart the dispatcher. Every attempt is logged and announced; Brett is asked
 * for something only when every fix failed.
 */
import { effectivePriority } from '../../../../framework/core/build-priority.mjs';

export const SCHEMA = 'pipeline-stall@1';
export const STALE_TICK_MIN = 3;
/** A finding must last this long before anything is fixed (one tick can be between launches). */
export const CONFIRM_MIN = 2;
/** A session younger than this may not have registered with tmux yet. */
export const DEAD_GRACE_MIN = 3;
/** While a stall lasts, the fixes run again (and Brett hears again) this often. */
export const RETRY_MIN = 20;
/** A tick running longer than this is hung: the restart kills it (the cron's own limit is 10 minutes). */
export const HUNG_TICK_MIN = 8;
export const FIXES = ['selfcheck', 'release', 'autoqueue', 'restart'];
export const FIX_LABEL = { selfcheck: 'Pipeline self-check', release: 'Release dead slots', autoqueue: 'Auto-queue Urgent / High builds', restart: 'Restart the dispatcher' };
export const URGENT = new Set(['P0', 'P1']);

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const live = (builds) => (builds ?? []).filter((b) => b && !b.deleted && !b.hidden);

/**
 * What is stuck right now. `alive(session)` answers true / false, or null when it can't tell (no tmux): unknown is not dead.
 * `tick` = { at (last good tick), error (the last failed tick's message), runningMin (a tick still running) }.
 * Returns findings [{ kind, key, line, ids? }]: key is stable for one problem so a spell can be followed.
 */
export function detect({ builds, tick = {}, alive = () => null, waits = [], now = Date.now() } = {}) {
  const out = [];
  const bs = live(builds);
  const running = bs.filter((b) => b.status === 'running' || b.status === 'waiting');
  const queued = bs.filter((b) => b.status === 'queued');
  const urgentPending = bs.filter((b) => b.status === 'pending' && URGENT.has(effectivePriority(b)) && (b.steps ?? []).some((s) => !s.done && !s.skip));
  // (c) the dispatcher's tick
  const lastAt = ms(tick.at);
  const ageMin = lastAt ? (now - lastAt) / 60e3 : Infinity;
  if (ageMin >= STALE_TICK_MIN) {
    const why = tick.runningMin >= 1 ? `a tick has been running for ${Math.round(tick.runningMin)} min` : tick.error ? `the tick fails: ${str(tick.error, 200)}` : 'no tick is running (cron stopped?)';
    out.push({ kind: 'tick', key: 'tick', line: `The dispatcher has not finished a tick for ${Number.isFinite(ageMin) ? `${Math.round(ageMin)} min` : 'ever'}: ${why}.`, ageMin: Number.isFinite(ageMin) ? Math.round(ageMin) : null, error: str(tick.error, 300) });
  }
  // (b) running builds whose session is gone
  const dead = running.filter((b) => {
    const p = b.pipeline ?? {};
    if (!p.session) return false;
    if (now - ms(p.launchedAt || p.dispatchedAt || b.updatedAt) < DEAD_GRACE_MIN * 60e3) return false;
    return alive(p.session, b.id) === false;
  });
  if (dead.length) out.push({ kind: 'dead', key: 'dead', ids: dead.map((b) => b.id), line: `${plural(dead.length, 'build')} marked running with no live session: ${dead.map((b) => `${b.id} (${b.pipeline.session})`).join(', ')}.` });
  // (a) nothing building while work waits
  const building = running.filter((b) => !dead.includes(b));
  if (!building.length && (queued.length || urgentPending.length)) {
    const parts = [];
    if (queued.length) parts.push(`${plural(queued.length, 'build')} in the Queue`);
    if (urgentPending.length) parts.push(`${plural(urgentPending.length, 'Urgent / High build')} in Pending`);
    const reasons = [...new Set((waits ?? []).map((w) => str(w.why, 160)).filter(Boolean))].slice(0, 3);
    out.push({ kind: 'idle', key: 'idle', ids: [...queued, ...urgentPending].map((b) => b.id), line: `Nothing is building while ${parts.join(' and ')} wait${reasons.length ? ` (dispatcher: ${reasons.join('; ')})` : ''}.` });
  }
  return out;
}

/** Urgent / High Pending builds the auto-queue fix may move when the Queue is empty: split, open steps, not handed back. */
export function autoQueueable(builds) {
  const bs = live(builds);
  if (bs.some((b) => b.status === 'queued')) return [];
  return bs.filter((b) => b.status === 'pending' && URGENT.has(effectivePriority(b)) && (b.steps ?? []).some((s) => !s.done && !s.skip) && b.pipeline?.lastRun?.outcome !== 'returned');
}

/** A newly filed Urgent build goes to the Queue by itself (never run, never handed back, split). */
export function urgentNew(b) {
  return !!b && !b.deleted && !b.hidden && b.status === 'pending' && effectivePriority(b) === 'P0' && (b.steps ?? []).some((s) => !s.done && !s.skip)
    && !b.pipeline?.runs && !b.pipeline?.lastRun && !b.pipeline?.queuedAt;
}

/**
 * The next step for the watchdog given what it sees and what it remembers (the spell):
 *   { action: 'clear' }       nothing stuck; a spell that was open is closed (and announced when fixes ran)
 *   { action: 'wait' }        stuck, but not for CONFIRM_MIN yet, or fixes ran less than RETRY_MIN ago
 *   { action: 'fix' }         run the fixes now
 * `force` (asked for from the console, voice or MCP) fixes at once.
 */
export function decide(findings, spell, { now = Date.now(), force = false } = {}) {
  if (!findings.length) return { action: spell ? 'clear' : 'none' };
  if (force) return { action: 'fix' };
  const since = ms(spell?.since) || now;
  if (now - since < CONFIRM_MIN * 60e3) return { action: 'wait', why: `confirming (seen for ${Math.round((now - since) / 1000)} s)` };
  const last = ms(spell?.lastRound);
  if (last && now - last < RETRY_MIN * 60e3) return { action: 'wait', why: `fixes ran ${Math.round((now - last) / 60e3)} min ago; next round in ${Math.ceil((RETRY_MIN * 60e3 - (now - last)) / 60e3)} min` };
  return { action: 'fix' };
}

/** Open or carry on a spell: { id, since, keys, lines, rounds, lastRound, escalatedAt }. */
export function spellFor(findings, spell, now = Date.now()) {
  const at = new Date(now).toISOString();
  const keys = [...new Set([...(spell?.keys ?? []), ...findings.map((f) => f.key)])];
  if (spell) return { ...spell, keys, lines: findings.map((f) => f.line), seenAt: at };
  return { id: at.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-'), since: at, seenAt: at, keys, lines: findings.map((f) => f.line), rounds: 0, lastRound: '', escalatedAt: '', attempts: [] };
}

/** What Brett has to supply when every fix failed: plain lines, the exact thing missing. */
export function missing(findings, attempts = []) {
  const out = [];
  for (const f of findings) {
    if (f.kind === 'tick') {
      if (/JSON|Unexpected end|Unterminated/i.test(f.error || '')) out.push(`The builds store (_claude/builds/store.json) does not parse: ${str(f.error, 160)}. Restore it from the store history (node framework/cli/builds-store.mjs history, then restore).`);
      else if (f.error) out.push(`The dispatcher tick fails: ${str(f.error, 200)}.`);
      else out.push('The dispatcher cron (/etc/cron.d/axf-pipeline) does not run: check that cron is running on the VPS (systemctl status cron).');
    }
    if (f.kind === 'dead') out.push(`Could not release ${f.ids.join(', ')}: put them back in the Queue from Builds → Active.`);
    if (f.kind === 'idle') out.push(f.line.replace(/^Nothing is building while /, 'Still nothing building: ').replace(/\.$/, '') + '. If no account can take them, sign one in or free a limit (Settings → Claude → Accounts).');
  }
  const errs = attempts.filter((a) => a.error).map((a) => `${FIX_LABEL[a.fix] || a.fix} failed: ${str(a.error, 160)}`);
  return [...new Set([...out, ...errs])];
}

/** Alerts (the console's alerts API → AmberX). Keys are per spell and per attempt so each one reaches the phone. */
export function alertFor(kind, d = {}) {
  const base = { source: 'pipeline', link: '/builds?tab=queue', meta: { kind: `stall-${kind}`, spell: d.spell ?? '' } };
  switch (kind) {
    case 'attempt': return { ...base, key: `pipeline:stall:${d.spell}:${d.round}:${d.fix}`, severity: 'info', title: `Stall: ${d.ok ? 'fixed by' : 'tried'} ${FIX_LABEL[d.fix] || d.fix}`, body: str([d.result, d.ok ? '' : `Still stuck: ${d.still}`].filter(Boolean).join('\n'), 1500) };
    case 'fixed': return { ...base, key: `pipeline:stall:${d.spell}:fixed`, severity: 'success', title: 'Stall fixed: builds are moving again', body: str(`${d.what}\nFixed by: ${d.by}.`, 1500) };
    case 'cleared': return { ...base, key: `pipeline:stall:${d.spell}:fixed`, severity: 'success', title: 'Stall cleared: builds are moving again', body: str(d.what, 1500) };
    case 'escalate': return { ...base, key: `pipeline:stall-escalate:${d.spell}`, severity: 'error', title: 'Builds are stuck and every fix failed: needs you', body: str([d.what, '', 'Needed:', ...(d.needs ?? []).map((n) => `- ${n}`)].join('\n'), 1500) };
    default: throw new Error(`unknown stall alert ${kind}`);
  }
}

const hhmm = (iso) => str(iso, 16).replace('T', ' ');
/** "Automatic fixes" note lines: an entry per spell, a sub-list item per attempt, a closing line. */
export const noteEntry = (spell) => `\n## ${hhmm(spell.since)} UTC · Builds stalled\n${spell.lines.map((l) => `- Seen: ${l}`).join('\n')}\n`;
export const noteAttempt = (a) => `  - ${hhmm(a.at).slice(11)} ${FIX_LABEL[a.fix] || a.fix}: ${a.ok ? 'fixed' : a.error ? 'failed' : 'still stuck'}. ${str(a.result || a.error, 400)}\n`;
export const noteClose = (at, line) => `- ${hhmm(at).slice(11)} ${line}\n`;
