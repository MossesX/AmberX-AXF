/**
 * Auto-lander rules (build auto-lander-controls-in-the-gate-plugin, Brett Nov 15 2026: "we need a control for the auto
 * lander"). Pure: no IO, no git, no model. The cron runner (land.mjs run), the REST routes, the CLI, MCP and voice all
 * read these rules and nothing else.
 *
 * Settings (push banner config.json, key `autoLander`):
 *   enabled  one On/Off the cron reads at the start of every run; off = the run ends at once, reason `switched-off`.
 *   mode     serial (default; one PR at a time, tested on the real main it will sit on, then landed) |
 *            merge-queue (the configured queue: batch or stack, queueDepth / batchSize).
 * Before this build the run had no single switch: `autoLand` (off since Nov 4) silenced the builds round while the merge
 * queue ran on its own `mergeQueue` key. A config without `autoLander` keeps working: enabled follows `mergeQueue`.
 *
 * Every run writes a run record (auto-lander-run@1) with one blocking reason from REASONS, or none while it lands.
 */

export const RUN_FRAME = 'auto-lander-run@1';
export const STATUS_FRAME = 'auto-lander-status@1';
export const MODES = Object.freeze(['serial', 'merge-queue']);
export const LANDER_DEFAULTS = Object.freeze({ enabled: true, mode: 'serial' });
/** Why a run lands nothing: a fixed list, so the console, CLI and voice can say it the same way. */
export const REASONS = Object.freeze(['switched-off', 'queue-empty', 'ci-waiting', 'conflict', 'token-missing', 'locked', 'error']);
export const REASON_TEXT = Object.freeze({
  'switched-off': 'The auto-lander is switched off.',
  'queue-empty': 'Nothing is ready to land: no open PR has green checks and nothing holding it.',
  'ci-waiting': 'Waiting for CI on the PR being landed.',
  conflict: 'The next PR conflicts with main in code; it needs main merged in by hand.',
  'token-missing': 'No GitHub token: framework/cli/github-token.mjs token gave nothing.',
  locked: 'Another run still holds the lock.',
  error: 'The run failed.',
});
export const RESULTS = Object.freeze(['landed', 'landing', 'idle', 'skipped', 'error']);
export const RUNS_KEEP = 200;

const num = (n) => Number.isInteger(n) && n > 0;
const str = (v, n = 300) => String(v ?? '').slice(0, n);

/** The lander settings from a push banner config.json document. */
export function readLander(config = {}) {
  const c = config && typeof config === 'object' ? config : {};
  const a = c.autoLander && typeof c.autoLander === 'object' ? c.autoLander : null;
  const enabled = a && typeof a.enabled === 'boolean' ? a.enabled : c.mergeQueue !== false;
  const mode = a && MODES.includes(a.mode) ? a.mode : LANDER_DEFAULTS.mode;
  return { enabled, mode };
}

/** Write one lander setting into a config document (returns a new document). Throws on a bad value. */
export function setLander(config = {}, key, value) {
  const c = { ...(config && typeof config === 'object' ? config : {}) };
  const cur = readLander(c);
  if (key === 'enabled') {
    if (typeof value !== 'boolean') throw new Error('enabled is true or false');
    cur.enabled = value;
  } else if (key === 'mode') {
    const m = value === 'queue' ? 'merge-queue' : value;
    if (!MODES.includes(m)) throw new Error(`mode is one of ${MODES.join(', ')}`);
    cur.mode = m;
  } else throw new Error(`unknown setting ${key}`);
  return { ...c, autoLander: cur };
}

/**
 * The queue settings one run uses, from the lander settings and the configured queue (merge-queue.mjs readQueueConfig).
 * serial = the per-PR stack one deep: one PR is tested on main and landed before the next one starts, and a red one
 * kicks only itself. Off = the queue does not run.
 */
export function queuePlan(lander, queueCfg = {}) {
  const base = { mergeQueue: true, depth: 3, mode: 'batch', batchSize: 8, waitUi: true, ...queueCfg };
  if (!lander.enabled) return { ...base, mergeQueue: false };
  if (lander.mode === 'serial') return { ...base, mergeQueue: true, mode: 'stack', depth: 1 };
  return { ...base, mergeQueue: true };
}

/** What the queue is landing right now: the head of the stack (or the batch), or null. */
export function landingNow(queue = {}) {
  const items = Array.isArray(queue.items) ? queue.items : [];
  const t = items.find((x) => x.state === 'testing' || x.state === 'passed' || x.state === 'merging') || null;
  return t ? { pr: t.pr, title: str(t.title, 200), build: str(t.build, 120), ci: str(t.ci, 20) } : null;
}

/**
 * The one reason a run lands nothing, from REASONS, or '' while it is landing or has landed.
 * facts: { enabled, locked, tokenOk, error, queue, merged }
 */
export function blockingReason({ enabled = true, locked = false, tokenOk = true, error = '', queue = {}, merged = [] } = {}) {
  if (!enabled) return 'switched-off';
  if (locked) return 'locked';
  if (!tokenOk) return 'token-missing';
  if (error) return 'error';
  if (merged.length) return '';
  const items = Array.isArray(queue.items) ? queue.items : [];
  if (items.some((x) => x.state === 'testing' || x.state === 'passed' || x.state === 'merging')) return 'ci-waiting';
  if (items.length && items.every((x) => /conflict/i.test(String(x.why || '')))) return 'conflict';
  if (items.length) return items.some((x) => /conflict/i.test(String(x.why || ''))) ? 'conflict' : 'ci-waiting';
  return 'queue-empty';
}

/** One run's record. */
export function runRecord({ startedAt, finishedAt, mode, enabled = true, locked = false, tokenOk = true, error = '', queue = {}, at = '' } = {}) {
  const merged = (Array.isArray(queue.merged) ? queue.merged : []).filter((m) => m && at && m.at === at).map((m) => m.pr).filter(num);
  const reason = blockingReason({ enabled, locked, tokenOk, error, queue, merged });
  const landing = enabled ? landingNow(queue) : null;
  const result = !enabled || locked ? 'skipped' : error || reason === 'token-missing' ? 'error' : merged.length ? 'landed' : landing ? 'landing' : 'idle';
  return {
    $axf: RUN_FRAME, startedAt: str(startedAt, 40), finishedAt: str(finishedAt, 40), result, mode: MODES.includes(mode) ? mode : LANDER_DEFAULTS.mode, enabled: !!enabled,
    landing, merged, reason, reasonText: reason ? REASON_TEXT[reason] : '', ...(error ? { error: str(error, 400) } : {}),
    waiting: (Array.isArray(queue.items) ? queue.items : []).length,
  };
}

/** Append a record to the runs list, keeping the last `keep`. */
export const trimRuns = (runs, keep = RUNS_KEEP) => (Array.isArray(runs) ? runs : []).slice(-Math.max(1, keep));

/** The status document: the lander settings, the last run, and a few counts. */
export function statusOf({ lander, last = null, runs = [], line = [] } = {}) {
  return {
    $axf: STATUS_FRAME, enabled: !!lander?.enabled, mode: lander?.mode || LANDER_DEFAULTS.mode,
    lastRun: last, lastRunAt: last?.finishedAt || last?.startedAt || '', result: last?.result || '', reason: last?.reason || '',
    reasonText: last?.reasonText || '', landing: last?.landing || null, inLine: line.length, landedRecently: runs.flatMap((r) => r.merged || []).slice(-10),
  };
}

// ------------------------------------------------------------------ the landing line

/**
 * The landing line: every PR the lander will land, in order, one at a time; skipped ones last with their reason.
 * queue = merge-queue.json, control = merge-queue-control.json. Each row: { position, pr, title, build, ci, state,
 * conflict, why, skipped }.
 */
export function line(queue = {}, control = {}) {
  const items = Array.isArray(queue.items) ? queue.items : [];
  const removed = control?.removed || {};
  const rows = items.filter((x) => num(x.pr) && !removed[x.pr]).map((x, i) => ({
    position: i + 1, pr: x.pr, title: str(x.title, 200), build: str(x.build, 120), url: str(x.url, 300), ci: str(x.ci || x.prCi, 20) || 'none',
    state: str(x.state, 20) || 'waiting', conflict: /conflict/i.test(String(x.why || '')), why: str(x.why, 300), skipped: null,
  }));
  const skipped = Object.entries(removed).filter(([n]) => num(Number(n))).map(([n, r]) => {
    const w = [...items, ...(queue.waiting || [])].find((x) => x.pr === Number(n)) || {};
    return { position: 0, pr: Number(n), title: str(w.title, 200), build: str(w.build, 120), url: str(w.url, 300), ci: str(w.ci || w.prCi, 20) || 'none', state: 'skipped', conflict: false, why: str(r?.why, 300), skipped: { why: str(r?.why, 300), at: str(r?.at, 40) } };
  });
  return [...rows, ...skipped];
}

/** The line commands, as one table for REST, MCP, CLI and voice. `queue` = the merge-queue command it maps onto. */
export const LINE_ACTIONS = Object.freeze({
  'move-up': { queue: 'move', confirm: false },
  'move-down': { queue: 'move', confirm: false },
  skip: { queue: 'remove', confirm: true },
  unskip: { queue: 'add', confirm: false },
  'land-now': { queue: 'move', confirm: true },
});

/** The merge-queue control call for a line action: { cmd, pr, to?, why? }. Throws on a bad PR or action. */
export function lineAction(rows, action, pr, { why = '' } = {}) {
  const a = LINE_ACTIONS[action];
  if (!a) throw new Error(`unknown action ${action}: one of ${Object.keys(LINE_ACTIONS).join(', ')}`);
  const n = typeof pr === 'string' ? Number(pr.replace(/^#/, '')) : pr;
  if (!num(n)) throw new Error('send a PR number');
  const live = (rows || []).filter((r) => !r.skipped);
  const i = live.findIndex((r) => r.pr === n);
  if (action === 'unskip') return { cmd: 'add', pr: n };
  if (i < 0) throw new Error(`#${n} is not in the landing line`);
  if (action === 'skip') { if (!str(why).trim()) throw new Error('skip needs a reason'); return { cmd: 'remove', pr: n, why: str(why, 200) }; }
  if (action === 'land-now') return { cmd: 'move', pr: n, to: 0 };
  if (action === 'move-up') return { cmd: 'move', pr: n, to: Math.max(0, i - 1) };
  return { cmd: 'move', pr: n, to: Math.min(live.length - 1, i + 1) };
}

// ------------------------------------------------------------------ the cron's health (systems check)

/** The cron line deploy/install-console.sh installs as /etc/cron.d/axf-auto-land (one copy of it, here). */
export const CRON_NAME = 'axf-auto-land';
export const cronLine = (dir) => `*/3 * * * * root L=${dir}/apps/console-web/plugins/push-banner/land/land.mjs; [ -f $L ] && cd ${dir} && AXF_LAND_REPO=${dir} flock -n /run/axf-auto-land.lock timeout 900 node $L run >> /var/log/axf-auto-land.log 2>&1`;
/** A run every 3 minutes: older than this and the cron is not running. */
export const CRON_STALE_MIN = 10;

/**
 * The live check on the real cron (replaces the old watch on a systemd unit `axf-lander` that never existed):
 * { status: ok | warn | info, summary, autoFix }. last = the newest run record, or null.
 */
export function cronHealth({ last = null, enabled = true, now = Date.now(), healRequested = false } = {}) {
  const at = Date.parse(last?.finishedAt || last?.startedAt || '');
  const age = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 60000)) : null;
  if (healRequested) return { status: 'info', summary: 'cron reinstall asked for: the host doctor puts the line back within 15 minutes', autoFix: false, ageMin: age };
  if (age === null) return { status: 'warn', summary: `no auto-lander run recorded yet: /etc/cron.d/${CRON_NAME} may be missing (Auto fix reinstalls it)`, autoFix: true, ageMin: null };
  if (age > CRON_STALE_MIN) return { status: 'warn', summary: `last auto-lander run ${age} min ago (it runs every 3): the cron isn't running (Auto fix reinstalls /etc/cron.d/${CRON_NAME})`, autoFix: true, ageMin: age };
  if (!enabled) return { status: 'info', summary: `switched off; the cron still checks every 3 minutes (last ${age} min ago)`, autoFix: false, ageMin: age };
  return { status: last.result === 'error' ? 'warn' : 'ok', summary: `last run ${age} min ago: ${last.result}${last.landing ? ` #${last.landing.pr}` : ''}${last.reason ? ` · ${REASON_TEXT[last.reason] || last.reason}` : ''}`, autoFix: false, ageMin: age };
}
