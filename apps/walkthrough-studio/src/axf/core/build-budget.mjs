/**
 * build-budget@1 — the two build budgets, decided in one place (Brett, Nov 23 2026: "a build that reaches its cap
 * stops and tells Brett; same for the daily cap"). Pure: no IO, no clock unless one is passed.
 *
 * The caps are the Claude settings `builds.budgetPerBuildUsd` and `builds.budgetDailyUsd` (owner raises, anyone
 * lowers; 0 = no cap). Until Nov 23 2026 they were shown but read by no code, with defaults (15 and 60) far below what
 * a build costs. The value in force is the stored one; with nothing stored there is no cap (the registry default is 0,
 * so the settings screen shows the same thing), and the first number Brett saves is enforced from the next tick.
 *
 * Spend comes from the headless meters (headless-meter@1, one per session: `costUsd`, `name`, `startedAt`):
 *   a build's spend   every session of the build, over its whole life: its steps (`<build>--<step>`), its own
 *                     session (a hand build), and the lander's fix sessions for it
 *   the day's spend   every metered session that started today (the VPS's local day), build or not
 *
 * decide() answers for the builds that have a session out (a step sending or building):
 *   stop   kind `build`: the build's spend reached the per-build cap. kind `daily`: the day's spend reached the
 *          daily cap. The build's sessions are stopped, `budgetStop` is set on its record and Brett is told once.
 *   clear  a stopped build whose cap allows it again (raised, set to 0, or a new day for a daily stop). A pipeline
 *          build then carries on by itself; a hand build is started again by hand.
 * While the daily cap is reached nothing new starts (`daily.reached`).
 */

export const SCHEMA = 'build-budget@1';
export const KEYS = Object.freeze({ perBuild: 'builds.budgetPerBuildUsd', daily: 'builds.budgetDailyUsd' });
/** With nothing stored there is no cap (the registry default of both settings is 0 too). */
export const DEFAULTS = Object.freeze({ perBuildUsd: 0, dailyUsd: 0 });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const usd = (v) => Math.round((Number(v) || 0) * 100) / 100;
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

/** The caps in force from the Claude settings values: { perBuildUsd, dailyUsd, stored: { perBuild, daily } }. 0 = no cap. */
export function capsOf(values = {}) {
  const v = values && typeof values === 'object' ? values : {};
  const one = (key, d) => { const n = num(v[key]); return n >= 0 ? n : d; };
  return {
    perBuildUsd: one(KEYS.perBuild, DEFAULTS.perBuildUsd), dailyUsd: one(KEYS.daily, DEFAULTS.dailyUsd),
    stored: { perBuild: num(v[KEYS.perBuild]) >= 0, daily: num(v[KEYS.daily]) >= 0 },
  };
}

/**
 * The build a session belongs to, from its name (`axf-<build>--<step>--<agent>`, `<build>--<step>`, `<build>`) or
 * its worktree folder (`<build>--<step>`, `lander-fix-<build>`: a fix session's name holds only its PR number): the
 * longest known build id it starts with, cut at a `--`. '' = no known build.
 */
export function buildOfSession(name, ids) {
  const known = ids instanceof Set ? ids : new Set(ids ?? []);
  let bare = str(name, 300).replace(/^axf-/, '').replace(/^lander-fix-/, '');
  for (;;) {
    if (known.has(bare)) return bare;
    const i = bare.lastIndexOf('--');
    if (i <= 0) return '';
    bare = bare.slice(0, i);
  }
}

/**
 * Spend from the meters → { byBuild: { id: usd }, dayUsd, sessions }. `meters` = [{ name, session, build, costUsd,
 * startedAt }]; `ids` = the known build ids; `dayStart` = the start of today (ms).
 */
export function spendOf(meters = [], { ids = [], dayStart = 0 } = {}) {
  const known = ids instanceof Set ? ids : new Set(ids);
  const byBuild = {}; let dayUsd = 0; let sessions = 0;
  for (const m of meters) {
    const cost = Math.max(0, Number(m?.costUsd) || 0);
    if (!cost) continue;
    sessions += 1;
    const id = (known.has(str(m.build)) && str(m.build)) || buildOfSession(m.name || m.session, known) || buildOfSession(str(m.cwd, 400).split('/').filter(Boolean).pop() ?? '', known);
    if (id) byBuild[id] = (byBuild[id] ?? 0) + cost;
    const at = Date.parse(m.startedAt || '');
    if (Number.isFinite(at) && at >= dayStart) dayUsd += cost;
  }
  for (const k of Object.keys(byBuild)) byBuild[k] = usd(byBuild[k]);
  return { byBuild, dayUsd: usd(dayUsd), sessions };
}

const stopOf = (b) => { const x = b?.budgetStop; return x && typeof x === 'object' && str(x.at) && ['build', 'daily'].includes(x.kind) ? x : null; };
/** Has the build a session out: a step being sent or built, or a builds@1 build that is running? Never an archived or finished build. */
export const hasSessionOut = (b) => !!b && !b.deleted && !['archived', 'landed', 'complete', 'built'].includes(b.status) && ((b.steps ?? []).some((s) => ['sending', 'building'].includes(s?.status)) || b.status === 'running');

/**
 * What to stop and what to release. → { stops: [{ id, kind, spentUsd, capUsd }], clears: [{ id, kind }],
 * daily: { reached, spentUsd, capUsd }, perBuildUsd }
 */
export function decide({ builds = [], caps = capsOf(), spend = { byBuild: {}, dayUsd: 0 } } = {}) {
  const dailyReached = caps.dailyUsd > 0 && spend.dayUsd >= caps.dailyUsd;
  const over = (b) => caps.perBuildUsd > 0 && (spend.byBuild[b.id] ?? 0) >= caps.perBuildUsd;
  const stops = []; const clears = [];
  for (const b of builds) {
    if (!b || b.deleted) continue;
    const cur = stopOf(b);
    if (cur) {
      const still = cur.kind === 'build' ? over(b) : dailyReached;
      if (!still) clears.push({ id: b.id, kind: cur.kind });
      continue;
    }
    if (!hasSessionOut(b)) continue;
    if (over(b)) stops.push({ id: b.id, kind: 'build', spentUsd: usd(spend.byBuild[b.id]), capUsd: caps.perBuildUsd });
    else if (dailyReached) stops.push({ id: b.id, kind: 'daily', spentUsd: usd(spend.dayUsd), capUsd: caps.dailyUsd });
  }
  return { stops, clears, daily: { reached: dailyReached, spentUsd: usd(spend.dayUsd), capUsd: caps.dailyUsd }, perBuildUsd: caps.perBuildUsd };
}

const money = (n) => `$${usd(n).toFixed(2)}`;
/** The line Brett reads for one stop: what stopped, the numbers, the one switch that moves it. */
export function stopLine(stop, { title = '' } = {}) {
  const what = title && title !== stop.id ? `${stop.id} (${str(title, 80)})` : stop.id;
  return stop.kind === 'build'
    ? `${what} reached its budget: ${money(stop.spentUsd)} of ${money(stop.capUsd)} per build. Its sessions were stopped; the work so far is in its worktree. To let it go on, raise "Budget per build (USD)" in Settings → Claude settings → Builds (only Brett raises it; 0 = no cap), or cancel the build.`
    : `${what} was stopped: the day's builds reached the daily budget, ${money(stop.spentUsd)} of ${money(stop.capUsd)}. Nothing new starts until tomorrow, or until "Daily budget (USD)" is raised in Settings → Claude settings → Builds (only Brett raises it; 0 = no cap).`;
}
/** The alert for a set of stops made in one pass (one alert per pass, never one per build). */
export function alertOf(stops = [], daily = { reached: false }) {
  if (!stops.length) return null;
  const builds = stops.filter((s) => s.kind === 'build'); const day = stops.filter((s) => s.kind === 'daily');
  const title = day.length ? `Daily build budget reached: ${money(daily.spentUsd)} of ${money(daily.capUsd)}` : builds.length === 1 ? `Build stopped at its budget: ${builds[0].id}` : `${builds.length} builds stopped at their budget`;
  return { key: day.length ? `budget:daily:${new Date().toISOString().slice(0, 10)}` : `budget:build:${builds.map((s) => s.id).join(',').slice(0, 120)}`, severity: 'error', title, body: stops.map((s) => stopLine(s)).join('\n').slice(0, 1500) };
}
