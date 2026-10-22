/**
 * Build manager — Live + Built from the build log (change-log@1 summaries with build stats, read through the capability
 * axf.changes@1 by this plugin's server part), plus the search used across Remaining / Live / Built. Pure and IO-free:
 * the view, the banner, the server-side orchestrator and test.mjs compute the same thing.
 *
 * A summary (from codebase-changes' store) carries: id, title, kind, model, state, createdAt, updatedAt, steps {total,
 * done, failed, running}, result {state, summary} | null, closed, repos, where, and the build stats when recorded:
 * status, buildRef {kind, id}, surface, host, startedAt, finishedAt, lastSeenAt, estimate {minutes, costUsd},
 * actual {minutes, costUsd, inputTokens, outputTokens, source}, costEstimated, branch, areas, parent, progress,
 * doing, verify {state, …}, commits [sha], links {name: url|path}.
 */

export const STALE_MS = 10 * 60_000;
export const SURFACE_LABEL = {
  'vps-claude-code': 'VPS', 'claude-code': 'Claude Code', 'claude-code-cloud': 'Cloud', 'claude-ai': 'claude.ai',
  'console-launch': 'Console launch', subagent: 'Subagent', backfill: 'Backfill',
};
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const ms = (iso) => { const t = Date.parse(str(iso)); return Number.isFinite(t) ? t : 0; };
export const modelOf = (m) => { const s = str(m).toLowerCase(); return s.includes('fable') ? 'Fable' : s.includes('sonnet') ? 'Sonnet' : s.includes('opus') ? 'Opus' : s ? 'Other' : 'Opus'; };
export const statusOf = (s) => s?.status ?? (s?.result ? (['failed', 'cancelled'].includes(s.result.state) ? 'failed' : 'done') : 'running');
export const isStale = (s, now = Date.now()) => statusOf(s) === 'running' && (now - (ms(s.lastSeenAt) || ms(s.updatedAt) || now)) > STALE_MS;

/** Minutes + cost to show: actual when recorded, else the estimate (flagged). */
export function figures(s) {
  const a = s?.actual ?? {}, e = s?.estimate ?? {};
  let minutes = a.minutes ?? null, minutesEstimated = false;
  if (minutes == null && s?.startedAt && s?.finishedAt && s.surface !== 'backfill') minutes = Math.max(0, Math.round((ms(s.finishedAt) - ms(s.startedAt)) / 60000));
  if (minutes == null) { minutes = e.minutes ?? null; minutesEstimated = minutes != null; }
  const costActual = a.costUsd ?? null;
  const cost = costActual ?? e.costUsd ?? null;
  return { minutes, minutesEstimated, cost, costEstimated: costActual == null && cost != null ? true : s?.costEstimated === true && costActual == null, tokens: a.inputTokens != null ? (a.inputTokens + (a.outputTokens ?? 0)) : null };
}

/** Build log entries that are builds (anything with build stats, or kind build/edit/fix/remove). */
const isBuild = (s) => !!(s && (s.buildRef || s.estimate || s.surface || ['build', 'edit', 'fix', 'remove'].includes(s.kind)));

/** The remaining-builds row an entry is about: its buildRef (kind:id or a row id / planId / alias). */
export function rowFor(s, rows) {
  const ref = s?.buildRef;
  if (!ref) return null;
  return rows.find((r) => r.key === `${ref.kind}:${ref.id}`) ?? rows.find((r) => r.id === ref.id || r.planId === ref.id || (r.aliases ?? []).includes(ref.id)) ?? null;
}

/** Everything running or queued right now, from any surface: one Live entry each (elapsed vs estimate, cost, steps). */
export function liveFromChanges(summaries, rows = [], now = Date.now()) {
  const out = [];
  for (const s of summaries ?? []) {
    const st = statusOf(s);
    if (st !== 'running' && st !== 'queued') continue;
    if (!isBuild(s)) continue;
    // Closed in the Codebase changes banner and gone quiet: nobody is building it any more (it never said how it ended),
    // so it isn't live (Brett, Oct 22 2026: a closed, silent launch kept coming back under "No word from").
    if (s.closed && isStale(s, now)) continue;
    const started = ms(s.startedAt) || ms(s.createdAt);
    const est = s.estimate?.minutes ?? null;
    const elapsed = started ? Math.max(0, now - started) : null;
    const stepsTotal = s.steps?.total ?? 0, stepsDone = s.steps?.done ?? 0;
    let progress = typeof s.progress === 'number' ? s.progress : stepsTotal ? stepsDone / stepsTotal : est && elapsed != null ? Math.min(0.99, elapsed / (est * 60000)) : null;
    const stale = isStale(s, now);
    out.push({
      id: `chg:${s.id}`, changeId: s.id, title: str(s.title), state: st, activityState: stale ? 'stale' : st === 'queued' ? 'queued' : 'running',
      startedAt: started, finishedAt: 0, url: '', source: SURFACE_LABEL[s.surface] ?? str(s.surface || s.where || 'session'),
      surface: str(s.surface), host: str(s.host), model: modelOf(s.model), modelRaw: str(s.model), runningStep: str(s.steps?.running), doing: str(s.doing),
      progress, row: rowFor(s, rows), via: s.buildRef ? `${s.buildRef.kind}:${s.buildRef.id}` : '', estimate: est, elapsed,
      currentStep: str(s.doing) || str(s.steps?.running), over: est && elapsed != null ? Math.max(0, Math.round(elapsed / 60000 - est)) : 0,
      costEstimate: s.estimate?.costUsd ?? null, costActual: s.actual?.costUsd ?? null, stepsDone, stepsTotal, stale,
      lastSeenAt: ms(s.lastSeenAt) || ms(s.updatedAt), branch: str(s.branch), areas: s.areas ?? [], parent: str(s.parent),
    });
  }
  return out.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || b.startedAt - a.startedAt);
}

/** Finished builds for the Built view, newest first. */
export function builtRows(summaries) {
  const out = [];
  for (const s of summaries ?? []) {
    const st = statusOf(s);
    if ((st !== 'done' && st !== 'failed') || !isBuild(s)) continue;
    if (s.result?.state === 'cancelled' && !s.estimate && !s.actual) continue; // "question only" entries
    const f = figures(s);
    const at = ms(s.finishedAt) || ms(s.updatedAt) || ms(s.createdAt);
    out.push({
      id: s.id, title: str(s.title), model: modelOf(s.model), modelRaw: str(s.model), status: st, resultState: s.result?.state ?? '',
      at, day: new Date(at).toISOString().slice(0, 10), week: isoWeek(at), surface: str(s.surface), host: str(s.host),
      ...f, branch: str(s.branch), commits: s.commits ?? [], links: s.links ?? {}, ref: s.buildRef ?? null,
      verify: s.verify?.state ?? '', summary: str(s.result?.summary), repos: s.repos ?? [], kind: str(s.kind),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** ISO week label 2026-W43 (Monday-based). */
export function isoWeek(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

const blank = () => ({ count: 0, minutes: 0, cost: 0, estimatedCost: 0, estimatedMinutes: 0 });
function add(t, r) {
  t.count++;
  if (r.minutes != null) { t.minutes += r.minutes; if (r.minutesEstimated) t.estimatedMinutes += r.minutes; }
  if (r.cost != null) { t.cost += r.cost; if (r.costEstimated) t.estimatedCost += r.cost; }
}
/** Totals overall, by model and by week (cost rounded to cents). */
export function builtTotals(rows) {
  const all = blank(), byModel = {}, byWeek = {};
  for (const r of rows) { add(all, r); add((byModel[r.model] ??= blank()), r); add((byWeek[r.week] ??= blank()), r); }
  const round = (t) => ({ ...t, cost: Math.round(t.cost * 100) / 100, estimatedCost: Math.round(t.estimatedCost * 100) / 100 });
  return { all: round(all), byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, round(v)])), byWeek: Object.fromEntries(Object.entries(byWeek).sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => [k, round(v)])) };
}

export const PERIODS = ['all', '7d', '30d', 'week'];
export const PERIOD_LABEL = { all: 'All time', '7d': 'Last 7 days', '30d': 'Last 30 days', week: 'This week' };
/** Built filters: model ('' any), period, cost ('' any | actual | estimated), surface ('' any). */
export function filterBuilt(rows, { model = '', period = 'all', cost = '', surface = '', status = '' } = {}, now = Date.now()) {
  const since = period === '7d' ? now - 7 * 86400000 : period === '30d' ? now - 30 * 86400000 : 0;
  const wk = period === 'week' ? isoWeek(now) : '';
  return rows.filter((r) => (!model || r.model === model) && (!since || r.at >= since) && (!wk || r.week === wk)
    && (!cost || (cost === 'actual' ? !r.costEstimated && r.cost != null : r.costEstimated || r.cost == null))
    && (!surface || r.surface === surface) && (!status || r.status === status));
}

/* ---------------- search (Remaining + Live + Built) ---------------- */

/** Lower-cased words; every word of the query must appear somewhere in the item's text. */
export function searchText(x) {
  return [x.title, x.id, x.key, x.detail, x.model, x.modelRaw, x.branch, x.planId, x.status, x.statusLabel, x.summary, x.surface, x.host, x.changeId, x.source, x.doing, x.runningStep, x.currentStep, x.day,
    ...(x.aliases ?? []), ...(x.steps ?? []).map?.((s) => s?.text ?? '') ?? [], ...(x.ref ? [x.ref.id] : []), ...(x.row ? [x.row.title, x.row.id] : [])].map(str).join(' \n ').toLowerCase();
}
export function matches(query, x) {
  const words = str(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(x);
  return words.every((w) => hay.includes(w));
}

export const money = (v) => (v == null ? '—' : v >= 100 ? `$${Math.round(v)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
