/**
 * merge-watch@1 host: retries and the alert when sends keep failing.
 *
 * Backoff is the engine's (framework/core/merge-watch.mjs RETRY_MINUTES: 1, 5, 15, 60, then 240 and 1440 minutes;
 * MAX_ATTEMPTS 8, then the entry waits for a hand). Here:
 *
 *   failing(state, now)   entries that failed ALERT_AFTER (3) times or more: what broke, since when, the last error
 *   alertOf(failing)      the console alert (alerts API, notify type `shipped.merge-watch.failed` in
 *                         apps/console-web/plugins/shipped-features/notify.json): pushed once per failing spell
 *   syncAlert(state, ctx) raise it the first time something crosses the line, resolve it when nothing fails; the memo
 *                         (alert.json next to the state) keeps it to one push per spell
 *   retryAll(state, now)  the Auto fix: every failed entry back to pending (MW.reset) so the next send goes now
 *
 * The systems check item (health@1 `shipped-merge-watch`) reads the same state through the plugin server
 * (apps/console-web/plugins/shipped-features/server/health.py); its Auto fix runs `merge-watch.mjs retry`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as MW from '../../core/merge-watch.mjs';
import { mergeWatchDir } from '../merge-watch-files.mjs';

export const ALERT_AFTER = 3;
export const ALERT_KEY = 'shipped:merge-watch:failed';
export const ALERT_SOURCE = 'shipped-features';
export const NOTIFY_TYPE = 'shipped.merge-watch.failed';
export const LINK = '/plugins/gate?tab=rules&rule=after-merge-send-shipped-features';

export function failing(state, now = new Date().toISOString()) {
  const es = Object.values(state?.entries ?? {}).filter((e) => e.state === 'failed' && e.attempts >= ALERT_AFTER);
  return es.sort((a, b) => (a.at < b.at ? -1 : 1)).map((e) => ({
    sha: e.sha, build: e.build || e.guess || '', pr: e.pr, subject: e.subject, attempts: e.attempts, error: e.error,
    since: e.seenAt || e.at, lastAttemptAt: e.lastAttemptAt, nextRetryAt: e.nextRetryAt, gaveUp: !e.nextRetryAt && e.attempts >= MW.MAX_ATTEMPTS,
    overdue: !!e.nextRetryAt && e.nextRetryAt < now,
  }));
}

const one = (f) => `${f.build || f.subject.slice(0, 60)}${f.pr ? ` (#${f.pr})` : ''} ${f.sha.slice(0, 9)}: ${f.attempts} tries, ${f.error.slice(0, 160)}`;
export function alertOf(fs) {
  const since = fs.map((f) => f.since).filter(Boolean).sort()[0] || '';
  return {
    source: ALERT_SOURCE, key: ALERT_KEY, severity: 'error', link: LINK,
    title: `Shipped features: ${fs.length} merge${fs.length === 1 ? '' : 's'} to main not sent`,
    body: [`Merges landed on main but their shipped manifest didn't reach Shipped features${since ? ` (since ${since.slice(0, 16).replace('T', ' ')} UTC)` : ''}.`,
      'Shipped features misses them until they go out. Auto fix resends them now (Retry).', ...fs.slice(0, 6).map(one)].join('\n').slice(0, 1500),
    meta: { kind: 'merge-watch', type: NOTIFY_TYPE, shas: fs.map((f) => f.sha), since },
  };
}

// ------------------------------------------------------------------ the one-push memo

const memoFile = (env) => join(mergeWatchDir(env), 'alert.json');
export const readMemo = (env = process.env) => { try { return JSON.parse(readFileSync(memoFile(env), 'utf8')); } catch { return { raised: false, at: '', shas: [] }; } };
function writeMemo(m, env) { const f = memoFile(env); mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, JSON.stringify(m)); renameSync(t, f); }

/** The console's alerts API from the host: docker exec into the console (the pipeline's way), AXF_CONSOLE_URL otherwise. */
export function consolePost(path, body, env = process.env) {
  if (env.AXF_MERGE_WATCH_ALERTS === 'off') return null;
  if (env.AXF_CONSOLE_URL && env.AXF_TOKEN) {
    const r = spawnSync('curl', ['-s', '-m', '20', '-X', 'POST', '-H', `Authorization: Bearer ${env.AXF_TOKEN}`, '-H', 'Content-Type: application/json', '--data-binary', '@-', `${env.AXF_CONSOLE_URL.replace(/\/$/, '')}${path}`], { input: JSON.stringify(body), encoding: 'utf8', timeout: 30e3 });
    return r.status === 0 ? r.stdout : null;
  }
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}${path}"`;
  const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', cmd], { input: JSON.stringify(body), encoding: 'utf8', timeout: 30e3 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Raise (once per spell) or resolve the alert. Returns { action: raised | resolved | none, failing }.
 * ctx.post = (path, body) => any (tests); ctx.env.
 */
export function syncAlert(state, { env = process.env, now = new Date().toISOString(), post = (p, b) => consolePost(p, b, env) } = {}) {
  const fs = failing(state, now); const memo = readMemo(env);
  if (fs.length && !memo.raised) {
    post('/api/alerts', alertOf(fs));
    writeMemo({ raised: true, at: now, shas: fs.map((f) => f.sha) }, env);
    return { action: 'raised', failing: fs };
  }
  if (!fs.length && memo.raised) {
    post('/api/alerts/resolve', { keys: [ALERT_KEY] });
    writeMemo({ raised: false, at: now, shas: [] }, env);
    return { action: 'resolved', failing: fs };
  }
  return { action: 'none', failing: fs };
}

/** Auto fix / Retry: every failed entry back to pending, due now. */
export function retryAll(state, now = new Date().toISOString(), { only = [] } = {}) {
  let st = state; const reset = [];
  for (const e of Object.values(state.entries)) if (e.state === 'failed' && (!only.length || only.includes(e.sha))) { st = MW.reset(st, e.sha, now); reset.push(e.sha); }
  return { state: st, reset };
}
