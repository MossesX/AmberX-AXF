/**
 * The watchdog's FYI to AmberX: one batched alert per run that cleaned something (count + the rows, each with why).
 * Declared in the plugin's notify.json as type watchdog.cleaned (notify-types@1, match source pipeline + key prefix
 * watchdog:cleaned), so the Notifications panel (axf.notify@1) decides whether it shows and pushes; the console's
 * alerts engine (POST /api/alerts) asks that registry. Sent through the same console call the dispatcher uses.
 * The `notify` setting off = nothing is sent. AXF_PIPELINE_CONSOLE=off (tests) = nothing is sent.
 */
export const KEY_PREFIX = 'watchdog:cleaned';
export const LINK = '#/settings/plugins/build-orchestrator?tab=watchdog';
const MAX_LINES = 25;

/** The alert for a run (pure): null when nothing was cleaned. */
export function alertOf(run) {
  const done = (run?.changes ?? []).filter((c) => c.applied);
  if (!done.length) return null;
  const by = {}; for (const c of done) by[c.table] = (by[c.table] ?? 0) + 1;
  const where = Object.entries(by).map(([t, n]) => `${n} ${t === 'builds' ? 'build' : t === 'merge-queue' ? 'merge queue' : 'UI Review'}`).join(', ');
  const lines = done.slice(0, MAX_LINES).map((c) => `• ${c.line}`);
  if (done.length > MAX_LINES) lines.push(`… and ${done.length - MAX_LINES} more in the Cleanups log`);
  return {
    source: 'pipeline', key: `${KEY_PREFIX}:${run.at}`, severity: 'info', link: LINK,
    title: `Watchdog cleaned ${done.length} stale row${done.length === 1 ? '' : 's'} (${where})`,
    body: lines.join('\n').slice(0, 1500),
    meta: { kind: 'watchdog.cleaned', count: done.length, rows: done.slice(0, 100).map((c) => ({ table: c.table, id: c.id, action: c.action, reason: c.reason })) },
  };
}

/** Send it (once per run). `post` overrides the console call (tests). Returns { sent, why? }. */
export async function notifyRun(run, { post, enabled = true } = {}) {
  const a = alertOf(run);
  if (!a) return { sent: false, why: 'nothing cleaned' };
  if (!enabled) return { sent: false, why: 'notify is off' };
  // inside the console container (a Run now from the console): the console's own API on this machine
  const inConsole = process.env.AXF_WATCHDOG_IN_CONSOLE === '1' && process.env.AXF_TOKEN;
  const send = post ?? (inConsole ? null : (await import('../pipeline.mjs')).makeConsole());
  const r = send ? send('POST', '/api/alerts', a) : await fetch(`http://127.0.0.1:${process.env.AXF_CONSOLE_PORT || 7090}/api/alerts`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.AXF_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(a), signal: AbortSignal.timeout(20000),
  }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  return r ? { sent: true, key: a.key } : { sent: false, why: 'the console did not answer' };
}
