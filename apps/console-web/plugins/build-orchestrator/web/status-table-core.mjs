/**
 * Pipeline 2.0 status table (status-table@1): the pure rules behind the one builds table. No IO, no React.
 *
 * The build orchestrator shows ONE table, driven only by status (Brett, Nov 18-19 2026): builds as rows, expandable to
 * their steps; filters on the toolbar (status, account, model, date), never tabs or locations. The merge queue is the
 * same table filtered to MERGE_QUEUE. The statuses are the Pipeline 2.0 shared contract (forward-only):
 *
 *   build: pending → splitting → split ("Pending") → pulling-main → assigning-models → ready → sending → building →
 *          build-complete → merging-pr → pr-pulling-main → running-ci → merging-main → landed, plus failed (attempt N)
 *   step:  pending → pulling-main → ready → sending → building → completed → in-pr (prNumber), plus failed (attempt N)
 *
 * A record written before Pipeline 2.0 carries an older status (running, built, landing, fixing, complete …): it is
 * read as the contract status it stands for (LEGACY_BUILD), so the table is never empty while the store migrates.
 * Every change records `at` and `by`; the timers tick client-side from the current status's `at` (statusSince).
 *
 * Used by web/StatusTable.tsx (the console) and status-table.mjs (the CLI the server's GET /table runs).
 */

export const BUILD_STATUSES = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed', 'failed']);
export const STEP_STATUSES = Object.freeze(['pending', 'pulling-main', 'ready', 'sending', 'building', 'completed', 'in-pr', 'failed']);

const LABEL = Object.freeze({
  pending: 'Pending', splitting: 'Splitting', split: 'Pending', 'pulling-main': 'Pulling main', 'assigning-models': 'Assigning models',
  ready: 'Ready for build', sending: 'Sending', building: 'Building', 'build-complete': 'Build complete', 'merging-pr': 'Merging to one PR',
  'pr-pulling-main': 'PR pulling main', 'running-ci': 'Running CI', 'merging-main': 'Merging into main', landed: 'Landed',
  completed: 'Completed', 'in-pr': 'In PR', failed: 'Failed',
});

/** The merge queue: a read-only view of the same rows, from merging-pr through merging-main. */
export const MERGE_QUEUE = Object.freeze(['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
/** Statuses whose clock stops: total time is frozen at the moment the build got there. */
export const TERMINAL = Object.freeze(['landed']);

/** An older record's status → the contract status it stands for (null = not on the table: archived / deleted). */
export const LEGACY_BUILD = Object.freeze({ running: 'building', waiting: 'building', queued: 'ready', built: 'build-complete', landing: 'merging-pr', fixing: 'failed', blocked: 'failed', escalated: 'failed', complete: 'landed', archived: null });

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** A status's label; failed carries its attempt ("failed, attempt 2"). */
export function statusLabel(status, attempt = 0) {
  if (status === 'failed') return num(attempt) ? `failed, attempt ${num(attempt)}` : 'failed';
  return LABEL[status] ?? status;
}

/** A build's contract status (null when the build is not on the table: archived, deleted). */
export function buildStatus(b) {
  if (!b || b.deleted) return null;
  const s = str(b.status);
  if (BUILD_STATUSES.includes(s)) return s;
  if (s in LEGACY_BUILD) return LEGACY_BUILD[s];
  return 'pending';
}

/** The attempt a failed build or step is on: `attempt`, else the number of recorded attempts, else 1. */
export function attemptOf(x) {
  return num(x?.attempt) || (Array.isArray(x?.attempts) ? x.attempts.length : 0) || 1;
}

/** The time the build or step entered its current status: `statusAt`, the last matching history entry, else the newest stamp. */
export function statusSince(x) {
  const hist = Array.isArray(x?.statusLog) ? x.statusLog : Array.isArray(x?.history) ? x.history : [];
  const last = [...hist].reverse().find((h) => h && str(h.status) === str(x.status) && str(h.at));
  return str(x?.statusAt) || str(x?.at) || str(last?.at) || str(x?.updatedAt) || str(x?.createdAt);
}
/** Who made the current status (contract `by`). */
export function statusBy(x) {
  const hist = Array.isArray(x?.statusLog) ? x.statusLog : Array.isArray(x?.history) ? x.history : [];
  const last = [...hist].reverse().find((h) => h && str(h.status) === str(x.status));
  return str(x?.statusBy) || str(x?.by) || str(last?.by);
}

/** A step's contract status, from its own `status` or (older records) its done tick and the build's place. */
export function stepStatus(s, build) {
  const own = str(s?.status);
  if (STEP_STATUSES.includes(own)) return own;
  if (own === 'done' || s?.done) return MERGE_QUEUE.includes(build) || build === 'landed' ? 'in-pr' : 'completed';
  if (build === 'building' && s?.current) return 'building';
  if (build === 'failed' && s?.failed) return 'failed';
  return 'pending';
}

/** One step as the table shows it. */
export function stepRow(s, build, b = {}) {
  const status = stepStatus(s, build);
  return {
    id: str(s.id), title: (str(s.title) || str(s.text).split('\n')[0]).slice(0, 100), status, attempt: status === 'failed' ? attemptOf(s) : 0,
    model: str(s.model), account: str(s.account), slot: str(s.slot), prNumber: num(s.prNumber) || (status === 'in-pr' ? prNumber(b) : 0),
    at: statusSince(s) || str(s.doneAt), by: statusBy(s),
  };
}

/** The PR number of a build (`prNumber`, or the number in `pr`: "#123", "123", or a pull URL). */
export function prNumber(b) {
  if (num(b?.prNumber)) return num(b.prNumber);
  const m = /(?:^#?|\/pull\/)(\d+)\b/.exec(str(b?.pr));
  return m ? Number(m[1]) : 0;
}

/** The one value of a field across steps: 'Fable' / 'Opus' when they agree, 'mixed' when not, '' when none is set. */
function common(values) {
  const set = [...new Set(values.filter(Boolean))];
  return set.length === 1 ? set[0] : set.length > 1 ? 'mixed' : '';
}

/** One build as the table shows it (compact: what the toolbar filters and the columns draw, plus its steps). */
export function buildRow(b) {
  const status = buildStatus(b);
  if (!status) return null;
  const raw = (Array.isArray(b.steps) ? b.steps : []).filter((s) => !s.skip);
  // an older record names no step status: the first step not done is the one a building build is on
  const cur = raw.some((s) => STEP_STATUSES.includes(str(s.status))) ? -1 : raw.findIndex((s) => !s.done);
  const steps = raw.map((s, i) => stepRow(i === cur ? { ...s, current: true, failed: true } : s, status, b));
  const done = steps.filter((s) => s.status === 'completed' || s.status === 'in-pr').length;
  const pipe = b.pipeline && typeof b.pipeline === 'object' ? b.pipeline : {};
  return {
    id: str(b.id), title: str(b.title) || str(b.id), status, attempt: status === 'failed' ? attemptOf(b) : 0,
    steps, done, total: steps.length,
    model: common(steps.map((s) => s.model)) || str(pipe.model) || str(pipe.planned?.model),
    account: common(steps.map((s) => s.account)) || str(pipe.account) || str(pipe.planned?.account),
    slot: common(steps.map((s) => s.slot)) || str(pipe.slot),
    prNumber: prNumber(b), branch: str(b.branch),
    at: statusSince(b), by: statusBy(b), createdAt: str(b.createdAt), updatedAt: str(b.updatedAt),
  };
}

/** Every table row of a store (builds@1 or orchestrator@1 state): newest change first. */
export function tableRows(store) {
  const rows = (store?.builds ?? []).map(buildRow).filter(Boolean);
  return rows.sort((a, c) => (c.updatedAt || c.at).localeCompare(a.updatedAt || a.at));
}

/** The values each toolbar filter offers, from the rows (accounts and models as seen on builds and steps). */
export function filterOptions(rows) {
  const accounts = new Set(); const models = new Set(); const counts = Object.fromEntries(BUILD_STATUSES.map((s) => [s, 0]));
  for (const r of rows) {
    counts[r.status] += 1;
    for (const v of [r.account, ...r.steps.map((s) => s.account)]) if (v && v !== 'mixed') accounts.add(v);
    for (const v of [r.model, ...r.steps.map((s) => s.model)]) if (v && v !== 'mixed') models.add(v);
  }
  return { counts, accounts: [...accounts].sort(), models: [...models].sort() };
}

export const DATE_RANGES = Object.freeze({ '': 'Any time', today: 'Today', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' });
const DAY = 86_400_000;
function since(range, now) {
  if (range === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return { '24h': now - DAY, '7d': now - 7 * DAY, '30d': now - 30 * DAY }[range] ?? 0;
}

/**
 * The rows a toolbar filter keeps. `status` is one status, a list, or '' (all but landed unless `landed`); `queue`
 * keeps only the merge queue; `account` / `model` match the build or any of its steps; `date` is a DATE_RANGES key
 * on the last change; `text` matches id, title or branch.
 */
export function filterRows(rows, f = {}, now = Date.now()) {
  const statuses = f.queue ? MERGE_QUEUE : Array.isArray(f.status) ? f.status : f.status ? [f.status] : null;
  const from = since(f.date ?? '', now);
  const text = str(f.text).trim().toLowerCase();
  return rows.filter((r) => {
    if (statuses ? !statuses.includes(r.status) : r.status === 'landed' && !f.landed) return false;
    if (f.account && r.account !== f.account && !r.steps.some((s) => s.account === f.account)) return false;
    if (f.model && r.model !== f.model && !r.steps.some((s) => s.model === f.model)) return false;
    if (from && Date.parse(r.updatedAt || r.at || '') < from) return false;
    if (text && !`${r.id} ${r.title} ${r.branch}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

/** "45s", "12m 05s", "3h 07m", "2d 4h". Negative or unknown = "—". */
export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60); const d = Math.floor(h / 24);
  const p = (n) => String(n).padStart(2, '0');
  if (d) return `${d}d ${h % 24}h`;
  if (h) return `${h}h ${p(m % 60)}m`;
  if (m) return `${m}m ${p(s % 60)}s`;
  return `${s}s`;
}

/** The two clocks of a row: time in the current status and total time (stopped once landed). */
export function timers(r, now = Date.now()) {
  const at = Date.parse(r.at || ''); const start = Date.parse(r.createdAt || r.at || '');
  const end = TERMINAL.includes(r.status) && Number.isFinite(at) ? at : now;
  return {
    inStatus: TERMINAL.includes(r.status) ? null : Number.isFinite(at) ? now - at : null,
    total: Number.isFinite(start) ? end - start : null,
  };
}
