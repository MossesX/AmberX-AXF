#!/usr/bin/env node
/**
 * account-alerts.mjs — a phone alert for every Claude account problem (build account-failover-notify, Nov 8 2026,
 * Brett: "Phone notification (AmberX) on every such problem: which account, what failed (expired login / limit / no
 * credits), which build moved where, and what Brett needs to do (e.g. sign account-1 in).").
 *
 * Alerts go into the console's alert hub (POST /api/alerts from inside the axf-console container, the same way the
 * backup and nightly scripts raise theirs), which asks axf.notify@1 and pushes to AmberX. Type `claude-accounts.problem`
 * (the plugin's notify.json) matches source `claude-accounts`, key prefix `claude-accounts:account:`. One key per
 * account and problem, so a second build dying on the same account updates that alert instead of buzzing again, and it
 * is resolved when the account works again. When the console can't be reached the alert waits in an outbox and goes
 * with the next one (or the minute sweep).
 *
 *   node deploy/account-alerts.mjs raise --account a --kind auth|usage|credits [--reason r] [--build b] [--moved-to x] [--until iso] [--stopped]
 *   node deploy/account-alerts.mjs resolve --account a [--kind k]
 *   node deploy/account-alerts.mjs flush                    send what waits in the outbox
 *
 * AXF_ACCOUNT_ALERTS: unset = the console container (AXF_CONSOLE_CONTAINER, default axf-console); `file:<path>` writes
 * the requests as JSON lines there (tests); `off` sends nothing. The outbox and the account events log live in the
 * workers folder (AXF_CLAUDE_WORKERS). Never carries a credential: names, emails, kinds and times only.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'claude-accounts';
const KEY_PREFIX = 'claude-accounts:account:';
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KINDS = { auth: 'login expired', usage: 'hit its limit', credits: 'out of credits' };

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const workersDir = (env) => env.AXF_CLAUDE_WORKERS || dirname(env.AXF_CLAUDE_SEEN || '/opt/axf/.axf-console/plugins/claude-accounts/seen.json');  // axf-plugin:claude-accounts
const outboxFile = (env) => join(workersDir(env), 'alerts-outbox.jsonl');
export const eventsFile = (env = process.env) => join(workersDir(env), 'account-events.jsonl');

const when = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/** What Brett has to do, in one line. */
export function todo({ account, kind, until = '', untilSignin = false, email = '' }) {
  if (kind === 'auth') return `Sign ${account} in again: console → Builds → Claude accounts → ${account} → Sign in (or tell Amber "sign ${account} in").`;
  if (kind === 'credits') return `Top up credits for ${email || account}${until ? `, or wait: it comes back ${when(until)}` : ''}.`;
  return untilSignin ? `Sign ${account} in again.` : `Nothing: ${account} comes back by itself${until ? ` ${when(until)}` : ''}.`;
}

/** The alert for one account problem (alert-hub RaiseReq). */
export function alertFor({ account, kind, reason = '', build = '', movedTo = '', until = '', untilSignin = false, email = '', stopped = false, waiting = false }) {
  const what = reason || KINDS[kind] || kind;
  const who = `${account}${email ? ` (${email})` : ''}`;
  const where = !build ? '' : movedTo ? `Build ${build} moved to ${movedTo}.` : waiting ? `Build ${build} is waiting for an account to come back.` : stopped ? `Build ${build} stopped: no account left to take it.` : `Build ${build} was on it.`;
  const severity = kind === 'auth' || stopped ? 'error' : 'warning';
  return {
    source: SOURCE, severity,
    title: `Claude ${who}: ${what}`.slice(0, 120),
    body: [where, todo({ account, kind, until, untilSignin, email })].filter(Boolean).join(' ').slice(0, 900),
    key: `${KEY_PREFIX}${account}:${kind}`,
    link: 'view:claude-accounts',
    meta: { account, kind, ...(build ? { build } : {}), ...(movedTo ? { movedTo } : {}), ...(until ? { until } : {}), stopped: !!stopped },
  };
}

/** Post one request to the console's alert hub. Returns true when the console took it. */
function post(path, payload, env) {
  const mode = env.AXF_ACCOUNT_ALERTS || '';
  if (mode === 'off') return true;
  if (mode.startsWith('file:')) { appendFileSync(mode.slice(5), JSON.stringify({ path, payload }) + '\n'); return true; }
  const name = env.AXF_CONSOLE_CONTAINER || 'axf-console';
  const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c',
    `curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:7090${path}`],
  { input: JSON.stringify(payload), encoding: 'utf8', timeout: 20_000 });
  return r.status === 0 && /^2\d\d$/.test((r.stdout || '').trim());
}

/** Send what waits in the outbox (oldest first); what still fails stays. */
export function flush(env = process.env) {
  const f = outboxFile(env);
  let lines = []; try { lines = readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return 0; }
  const tmp = `${f}.${process.pid}`;
  try { renameSync(f, tmp); } catch { return 0; }
  let sent = 0; const left = [];
  for (const l of lines) { let o; try { o = JSON.parse(l); } catch { continue; } if (post(o.path, o.payload, env)) sent++; else left.push(l); }
  if (left.length) appendFileSync(f, left.join('\n') + '\n', { mode: 0o600 });
  rmSync(tmp, { force: true });
  return sent;
}

function send(path, payload, env) {
  flush(env);
  if (post(path, payload, env)) return true;
  mkdirSync(workersDir(env), { recursive: true });
  appendFileSync(outboxFile(env), JSON.stringify({ path, payload, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  return false;
}

/**
 * Any alert from the claude-accounts source (the account health check's before / after notifications, type
 * account-status). Same delivery as the problem alerts: the console's alert hub, or the outbox when it can't be reached.
 */
export function postAlert(alert, env = process.env) {
  if (!alert || alert.source !== SOURCE) throw Object.assign(new Error(`source must be ${SOURCE}`), { code: 2 });
  return send('/api/alerts', alert, env);
}
export const resolveKeys = (keys, env = process.env) => send('/api/alerts/resolve', { keys }, env);

/** One line in the account events log (the console's Claude accounts screen shows them). */
export function logEvent(ev, env = process.env) {
  try {
    mkdirSync(workersDir(env), { recursive: true });
    appendFileSync(eventsFile(env), JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n');
  } catch { /* never stops a run */ }
}

export function readEvents(env = process.env, max = 50) {
  let t = ''; try { t = readFileSync(eventsFile(env), 'utf8'); } catch { return []; }
  return t.split('\n').filter(Boolean).slice(-max).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).reverse();
}

/** Raise (or update) the alert for an account problem, and log it. Returns { sent, alert }. */
export function raise(ev, env = process.env) {
  if (!NAME_RE.test(ev.account || '')) throw Object.assign(new Error(`not an account name: ${ev.account}`), { code: 2 });
  const alert = alertFor(ev);
  logEvent({ action: 'out', account: ev.account, kind: ev.kind, reason: ev.reason || '', build: ev.build || '', movedTo: ev.movedTo || '', until: ev.until || '', stopped: !!ev.stopped, waiting: !!ev.waiting }, env);
  const settings = readJson(join(workersDir(env), 'workers.json'))?.failover;
  if (settings && settings.alerts === false) return { sent: false, muted: true, alert };
  if (settings && settings.alertOnLimit === false && ev.kind === 'usage' && !ev.stopped) return { sent: false, muted: true, alert };
  return { sent: send('/api/alerts', alert, env), alert };
}

/** The account works again: its alerts close. */
export function resolveAlerts(account, kinds = Object.keys(KINDS), env = process.env) {
  logEvent({ action: 'back', account }, env);
  return send('/api/alerts/resolve', { keys: kinds.map((k) => `${KEY_PREFIX}${account}:${k}`) }, env);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  try {
    if (cmd === 'raise') {
      const r = raise({ account: flag('account'), kind: flag('kind', 'auth'), reason: flag('reason'), build: flag('build'), movedTo: flag('moved-to'), until: flag('until'), stopped: rest.includes('--stopped') });
      console.log(r.muted ? 'muted (failover alerts are off)' : r.sent ? `sent: ${r.alert.title}` : `console not reachable: kept in the outbox (${r.alert.title})`);
    } else if (cmd === 'resolve') console.log(resolveAlerts(flag('account'), flag('kind') ? [flag('kind')] : undefined) ? 'resolved' : 'kept in the outbox');
    else if (cmd === 'flush') console.log(`sent ${flush()}`);
    else { console.error('usage: account-alerts.mjs raise|resolve|flush (see the header)'); process.exit(2); }
  } catch (e) { console.error(`account-alerts: ${e.message}`); process.exit(e.code || 1); }
}
