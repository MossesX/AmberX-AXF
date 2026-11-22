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

/** Sent to emergency by Brett (pipeline-2@1 `emergency: { at, by }`): the row carries the Emergency badge. */
export const isEmergency = (b) => !!b && !!b.emergency && typeof b.emergency === 'object' && !!str(b.emergency.at);
/** May this row still be sent to emergency: a Pipeline 2.0 build that has not landed and is not one already. */
export const canSendEmergency = (r) => !!r && r.flow === 'pipeline-2' && !r.emergency && r.status !== 'landed';

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

/** The PR number of a build (`prNumber`, or the number in `pr`: a bare number, the number after a hash sign, or a pull URL). */
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
    flow: str(b.flow), emergency: isEmergency(b), emergencyBy: isEmergency(b) ? str(b.emergency.by) : '',
    steps, done, total: steps.length,
    model: common(steps.map((s) => s.model)) || str(pipe.model) || str(pipe.planned?.model),
    account: common(steps.map((s) => s.account)) || str(pipe.account) || str(pipe.planned?.account),
    slot: common(steps.map((s) => s.slot)) || str(pipe.slot),
    prNumber: prNumber(b), pr: /^https?:\/\//.test(str(b.pr)) ? str(b.pr) : '', branch: str(b.branch),
    at: statusSince(b), by: statusBy(b), createdAt: str(b.createdAt), updatedAt: str(b.updatedAt),
    parallel: parallelOf(b),
  };
}

/**
 * The build's place in a parallel split (build-pipeline@1 pipeline.parallel, Nov 13 2026): { role: lead | part, lead,
 * part, of, parts, landing } or null. A lead names itself as `lead`.
 */
export function parallelOf(b) {
  const p = b?.pipeline?.parallel;
  if (!p || typeof p !== 'object' || (p.role !== 'lead' && p.role !== 'part')) return null;
  const parts = Array.isArray(p.parts) ? p.parts.map((x) => str(x)).filter(Boolean) : [];
  return { role: p.role, lead: p.role === 'lead' ? str(b.id) : str(p.lead), part: p.role === 'part' ? Math.max(0, Number(p.part) || 0) : 0,
    of: Math.max(0, Number(p.of) || parts.length), parts: p.role === 'lead' ? parts : [], landing: p.landing === 'own' ? 'own' : 'together' };
}

/** A build of a parallel family that is done building (build-complete onwards, landed included). */
export const FAMILY_FINISHED = Object.freeze(BUILD_STATUSES.slice(BUILD_STATUSES.indexOf('build-complete'), BUILD_STATUSES.indexOf('landed') + 1));

/**
 * Parallel families of the table (sub-builds grouped under their parent build): every lead with its parts, in part
 * order, out of `rows` (what the filters keep); the combined progress counts the whole family from `all` (every row,
 * filtered or not), so a filter never changes a parent's numbers. A part whose lead is not in `all` still groups under
 * the lead's id. → { loose: rows in no family, families: [{ id, title, lead (row | null), rows, parts, done, total,
 * percent, partsFinished, of, landing, line }] } (families newest change first, like the rows).
 */
export function familyGroups(rows, all = rows) {
  const every = Array.isArray(all) ? all : [];
  const byLead = new Map();
  const loose = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = r.parallel;
    if (!p || !p.lead) { loose.push(r); continue; }
    if (!byLead.has(p.lead)) byLead.set(p.lead, []);
    byLead.get(p.lead).push(r);
  }
  const families = [...byLead.entries()].map(([id, shown]) => {
    // the server counted the family over every row, landed ones too (tableRows): those numbers win
    const stats = shown.find((x) => x.family)?.family ?? familyStats(id, every.length ? every : shown);
    const order = (x) => (x.id === id ? -1 : x.parallel?.part || 0);
    const lead = shown.find((x) => x.id === id) ?? null;
    return { ...stats, title: lead?.title || stats.title || id, lead, rows: [...shown].sort((a, c) => order(a) - order(c)) };
  });
  families.sort((a, c) => c.updatedAt.localeCompare(a.updatedAt));
  return { loose, families };
}

/**
 * One family's numbers over `all` rows: { id, title, parts, done, total, percent, partsFinished, of, landing,
 * updatedAt, line }. Combined progress = every step of the parent and of every part.
 */
export function familyStats(id, all) {
  const every = Array.isArray(all) ? all : [];
  const lead = every.find((x) => x.id === id) ?? null;
  const named = lead?.parallel?.parts ?? [];
  const kin = every.filter((x) => x.parallel?.role === 'part' && x.parallel.lead === id);
  const parts = [...named.map((pid) => every.find((x) => x.id === pid)).filter(Boolean), ...kin.filter((x) => !named.includes(x.id))]
    .sort((a, c) => (a.parallel?.part || 0) - (c.parallel?.part || 0));
  const members = [...(lead ? [lead] : []), ...parts];
  const done = members.reduce((t, x) => t + (x.done || 0), 0);
  const total = members.reduce((t, x) => t + (x.total || 0), 0);
  const of = Math.max(parts.length, named.length, lead?.parallel?.of || 0, ...kin.map((x) => x.parallel?.of || 0));
  const f = { id, title: lead?.title || id, parts: parts.map((x) => x.id), done, total, percent: total ? Math.round((done / total) * 100) : 0,
    partsFinished: parts.filter((x) => FAMILY_FINISHED.includes(x.status)).length, of,
    landing: lead?.parallel?.landing ?? kin[0]?.parallel?.landing ?? 'together', updatedAt: members.map((x) => x.updatedAt || x.at || '').sort().pop() || '' };
  return { ...f, line: familySummary(f) };
}

/** "3 parts · 2/3 built · 14/30 steps (47%) · lands together". */
export function familySummary(f) {
  if (!f) return '';
  return `${f.of} part${f.of === 1 ? '' : 's'} · ${f.partsFinished}/${f.of} built · ${f.done}/${f.total} steps (${f.percent}%) · ${f.landing === 'own' ? 'lands in order, part by part, then the parent' : 'lands together in one PR'}`;
}

/**
 * Every table row of a store (builds@1 or orchestrator@1 state): emergency builds still in flight first, then newest
 * change first. A row of a parallel family carries `family` (familyStats over every row).
 */
export function tableRows(store) {
  const rows = (store?.builds ?? []).map(buildRow).filter(Boolean);
  // a parallel family's combined progress, counted here over every row (landed parts too) before any filter drops some
  const fams = new Map();
  for (const r of rows) if (r.parallel?.lead) { if (!fams.has(r.parallel.lead)) fams.set(r.parallel.lead, familyStats(r.parallel.lead, rows)); r.family = fams.get(r.parallel.lead); }
  const urgent = (r) => (r.emergency && r.status !== 'landed' ? 1 : 0);
  return rows.sort((a, c) => urgent(c) - urgent(a) || (c.updatedAt || c.at).localeCompare(a.updatedAt || a.at));
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
