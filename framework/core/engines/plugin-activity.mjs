/**
 * plugin-activity@1 — "pick the most active" (Brett, Nov 15 2026). A raw event log (which plugin, what happened, when)
 * becomes one score record per plugin and a ranking the home-cards@1 resolver fills free slots with.
 *
 *   score(plugin) = Σ over its events inside the window of  weight(kind) × n × 2^(−ageDays / halfLifeDays)
 *
 * Opens, actions, live jobs and alerts each have a weight; an event fades with a half-life and is ignored past the
 * window; a future-stamped event counts as age 0. Pure: the clock is `at` (an ISO string), never Date.now() unless
 * `at` is missing. Defaults (window, half-life, weights) live in core/engines/home-cards.mjs REGISTRY and are
 * settings in the console; this engine takes them as options. Contract: spec/HOME-CARDS.md; fixture:
 * spec/fixtures/home-cards.json. Every port replays it.
 */
import { ACTIVITY_FRAME, COUNT_MAX, EVENTS_MAX, EVENT_FRAME, EVENT_KINDS, SCORE_DECIMALS, WEIGHTS, WINDOW, byRank, isPluginId } from './home-cards.mjs';

export { ACTIVITY_FRAME, EVENT_FRAME, EVENT_KINDS, WEIGHTS, WINDOW };

const DAY_MS = 86400000;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const clampDays = (v, d) => Math.min(WINDOW.maxDays, Math.max(WINDOW.minDays, Number.isFinite(v) ? v : d));
const SCALE = 10 ** SCORE_DECIMALS;
export const roundScore = (x) => Math.round(x * SCALE) / SCALE;

/* ================================================================== options */

/** Options with every field filled and clamped: `{ at, windowDays, halfLifeDays, weights, plugins }`. */
export function activityOptions(opts = {}) {
  const o = isObj(opts) ? opts : {};
  const w = isObj(o.weights) ? o.weights : {};
  return {
    at: isIso(o.at) ? o.at : new Date().toISOString(),
    windowDays: clampDays(o.windowDays, WINDOW.days),
    halfLifeDays: clampDays(o.halfLifeDays, WINDOW.halfLifeDays),
    weights: Object.fromEntries(EVENT_KINDS.map((k) => [k, Number.isFinite(w[k]) && w[k] >= 0 ? w[k] : WEIGHTS[k]])),
    plugins: Array.isArray(o.plugins) ? o.plugins.map((p) => (isObj(p) ? str(p.id ?? p.folder ?? p.plugin) : str(p))).filter(isPluginId) : [],
  };
}

/** The fade for an event `ageDays` old: 1 now, ½ after one half-life, ¼ after two. Future events count as now. */
export function decay(ageDays, halfLifeDays = WINDOW.halfLifeDays) {
  const h = clampDays(halfLifeDays, WINDOW.halfLifeDays);
  return 2 ** (-Math.max(0, ageDays) / h);
}

/* ================================================================== events */

/** A clean plugin-activity-event@1, or null when the event names no plugin or no known kind. */
export function normEvent(raw, at = new Date().toISOString()) {
  if (!isObj(raw)) return null;
  const plugin = str(raw.plugin ?? raw.id ?? raw.folder);
  const kind = EVENT_KINDS.includes(raw.kind) ? raw.kind : EVENT_KINDS.find((k) => raw[k] === true || raw.kind === `${k}s`) ?? '';
  if (!isPluginId(plugin) || !kind) return null;
  const out = { $axf: EVENT_FRAME, plugin, kind, at: isIso(raw.at) ? new Date(raw.at).toISOString() : at };
  const n = Math.min(COUNT_MAX, Math.max(1, Number.isFinite(raw.n) ? Math.round(raw.n) : 1));
  if (n !== 1) out.n = n;
  return out;
}

/** Errors in a plugin-activity-event@1 (empty = valid). */
export function eventErrors(ev, path = 'event') {
  const e = [];
  if (!isObj(ev)) return [`${path} must be an object`];
  if (ev.$axf !== undefined && ev.$axf !== EVENT_FRAME) e.push(`${path}.$axf must be ${EVENT_FRAME}`);
  if (!isPluginId(ev.plugin)) e.push(`${path}.plugin must be a plugin id`);
  if (!EVENT_KINDS.includes(ev.kind)) e.push(`${path}.kind must be one of ${EVENT_KINDS.join(', ')}`);
  if (!isIso(ev.at)) e.push(`${path}.at must be an ISO date-time`);
  if (ev.n !== undefined && !(Number.isInteger(ev.n) && ev.n >= 1 && ev.n <= COUNT_MAX)) e.push(`${path}.n must be an integer 1–${COUNT_MAX}`);
  return e;
}

/** The events inside the window, clean, newest first, at most EVENTS_MAX (what a store keeps after a prune). */
export function pruneEvents(events, opts = {}) {
  const o = activityOptions(opts);
  const now = Date.parse(o.at);
  const floor = now - o.windowDays * DAY_MS;
  const list = (Array.isArray(events) ? events : []).map((ev) => normEvent(ev, o.at)).filter((ev) => ev && Date.parse(ev.at) >= floor);
  list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0));
  return list.slice(0, EVENTS_MAX);
}

/* ================================================================== scores */

/**
 * The ranking: one plugin-activity@1 record per plugin seen in the window (plus every id in `opts.plugins`, at zero),
 * sorted score desc then id asc. Counts are raw sums of `n` inside the window; the score is the decayed, weighted sum.
 */
export function scoreActivity(events, opts = {}) {
  const o = activityOptions(opts);
  const now = Date.parse(o.at);
  const fresh = () => ({ counts: Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])), score: 0 });
  const by = new Map(o.plugins.map((id) => [id, fresh()]));
  for (const ev of pruneEvents(events, o)) {
    const n = ev.n ?? 1;
    const age = (now - Date.parse(ev.at)) / DAY_MS;
    const r = by.get(ev.plugin) ?? fresh();
    r.counts[ev.kind] = Math.min(COUNT_MAX, r.counts[ev.kind] + n);
    r.score += o.weights[ev.kind] * n * decay(age, o.halfLifeDays);
    by.set(ev.plugin, r);
  }
  const scores = new Map([...by].map(([id, r]) => [id, roundScore(r.score)]));
  return [...by.keys()].sort(byRank(scores)).map((plugin) => ({
    $axf: ACTIVITY_FRAME,
    plugin,
    at: o.at,
    window: { days: o.windowDays, halfLifeDays: o.halfLifeDays },
    counts: by.get(plugin).counts,
    score: scores.get(plugin),
  }));
}

/** Plugin ids in rank order from a list of records (or from events, scored with `opts`). */
export function rankedIds(recordsOrEvents, opts) {
  const list = Array.isArray(recordsOrEvents) ? recordsOrEvents : [];
  const records = list.every((r) => isObj(r) && r.$axf === ACTIVITY_FRAME) ? list : scoreActivity(list, opts);
  return records.map((r) => r.plugin);
}

/** Errors in a plugin-activity@1 record (empty = valid). */
export function activityErrors(r, path = 'activity') {
  const e = [];
  if (!isObj(r)) return [`${path} must be an object`];
  if (r.$axf !== ACTIVITY_FRAME) e.push(`${path}.$axf must be ${ACTIVITY_FRAME}`);
  if (!isPluginId(r.plugin)) e.push(`${path}.plugin must be a plugin id`);
  if (!isIso(r.at)) e.push(`${path}.at must be an ISO date-time`);
  if (!isObj(r.window) || !(r.window.days >= WINDOW.minDays && r.window.days <= WINDOW.maxDays) || !(r.window.halfLifeDays >= WINDOW.minDays && r.window.halfLifeDays <= WINDOW.maxDays)) e.push(`${path}.window must be { days, halfLifeDays } within ${WINDOW.minDays}–${WINDOW.maxDays}`);
  if (!isObj(r.counts)) e.push(`${path}.counts must be an object`);
  else for (const k of EVENT_KINDS) if (!(Number.isInteger(r.counts[k]) && r.counts[k] >= 0 && r.counts[k] <= COUNT_MAX)) e.push(`${path}.counts.${k} must be an integer 0–${COUNT_MAX}`);
  if (!(Number.isFinite(r.score) && r.score >= 0)) e.push(`${path}.score must be a number ≥ 0`);
  return e;
}
