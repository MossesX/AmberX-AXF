#!/usr/bin/env node
/**
 * claude-workers.mjs — headless worker accounts (builds multi-account-headless-workers, Nov 7 2026, and
 * workers-api-routing, Nov 8 2026).
 *
 * The console stays on one Claude subscription (the active account, ~/.claude-accounts/.active). Every other saved
 * subscription login is a worker (Brett, Nov 8 2026: "All subscription logins are workers"; Stop worker takes one out),
 * and the console's own account takes headless jobs too, after the workers (setting interactiveTakesJobs, default on).
 * Each job runs on a private copy of its login (deploy/claude-login.mjs), so several subscriptions work at once without
 * touching the console's login. API-key accounts (~/.claude-accounts/<name>/apikey) work only once they are set up as
 * API workers, and only on the jobs a routing rule sends them (they bill per token), under daily and weekly spend caps.
 * Which account takes a job is deploy/worker-routing.mjs (pure; the console runs the same code for its preview).
 *
 *   node deploy/claude-workers.mjs claim --session s [--name n] [--brief f] [--model m] [--priority p] [--exclude a,b]
 *                                       → "run <account> <kind>" | "queue <account> <position>" | "none <why>"
 *   node deploy/claude-workers.mjs release --session s           the job ended (or moved): its claim goes
 *   node deploy/claude-workers.mjs route [--exclude a,b]         the account a new job would run on now ('' = none)
 *   node deploy/claude-workers.mjs test [--job '{json}' | --name n --model m --priority p --steps n --type t --profile p]
 *   node deploy/claude-workers.mjs limit <name> --kind usage|credits|auth [--log <file>]   take an account out until it can work again
 *   node deploy/claude-workers.mjs clear <name>                 bring it back by hand (its phone alert is resolved)
 *   node deploy/claude-workers.mjs hit --log <file> --exit <n>  prints usage, credits or auth when that log ended on one
 *   node deploy/claude-workers.mjs failover --session s --account a --log f --exit n [--moves n] [--build b] [--name n --brief f --model m]
 *        → "move <account> <kind> <hit>" | "queue <account> <position> <hit>" | "wait <minutes> <hit>" | "stop <hit> <why>" | "none"
 *   node deploy/claude-workers.mjs revive                       accounts that are back leave the limits (minute sweep)
 *   node deploy/claude-workers.mjs events [--max n] [--json]    account events: out, moved, back
 *   node deploy/claude-workers.mjs failover-set enabled|alerts|alertOnLimit on|off · maxMoves N · waitMinutes N
 *   node deploy/claude-workers.mjs status [--json]              every account: role, kind, limit, running/queued, cost, caps
 *   node deploy/claude-workers.mjs alerts [--json]              API accounts near/over a cap or without a key
 *   node deploy/claude-workers.mjs config [--json]              the routing config (defaults filled in)
 *   node deploy/claude-workers.mjs set <key> <value>            interactiveTakesJobs on|off · building N · queue N
 *   node deploy/claude-workers.mjs worker <name> on|off         Make worker / Stop worker (subscription logins)
 *   node deploy/claude-workers.mjs label <name> <text>          a display name (Hulu, Moses X…)
 *   node deploy/claude-workers.mjs api add <name> --label L --daily N --weekly N [--alert 0.8]   an API worker slot
 *   node deploy/claude-workers.mjs api on|off|remove <name>     · api caps <name> --daily N --weekly N (lower only)
 *   node deploy/claude-workers.mjs rule add --json '{rule}' [--at i] · rule update <id> --json '{…}' · rule remove <id>
 *   node deploy/claude-workers.mjs rule move <id> up|down|<index> · rule on|off <id> · rules
 *   node deploy/claude-workers.mjs signin <name> · remove <name> · note <session>
 *
 * A session may lower a spend cap but never raise or remove one: that is Brett's own click in the console (Settings →
 * Plugins → Claude accounts → Job routing), which writes workers.json itself.
 *
 * claude-workers@1 (workers.json, next to the plugin's seen.json; worker-routing.mjs documents every field).
 * worker-state.json (written here, under worker-state.lock): { limits: { name: { at, until, kind, reason } },
 * claims: { session: { account, state: run|queue, at } } }. A limit ends by itself at `until`; a claim goes with its
 * session (release, or the tmux session is gone). Neither file holds a credential, and nothing here prints one.
 * Paths: AXF_CLAUDE_WORKERS (folder of the files), AXF_HEADLESS_DIR (events.jsonl and meters), and claude-login.mjs's
 * AXF_CLAUDE_ACCOUNTS / AXF_CLAUDE_SEEN. AXF_WORKERS_ALIVE (comma list) stands in for tmux in tests.
 * Exit 0 ok, 2 bad usage or refused.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accounts, paths as loginPaths } from './claude-login.mjs';
import { meta as homeMeta, tokenHash } from './claude-home.mjs';
import { readEvents as accountEvents } from './account-alerts.mjs';
import { NAME_RE, SCHEMA, alerts as routingAlerts, decide, normConfig, normJob, normRule, raisedCaps, roster } from './worker-routing.mjs';

export { SCHEMA };
const HERE = dirname(fileURLToPath(import.meta.url));
const HOUR = 3600e3;
const DAY = 24 * HOUR;
/** No reset time in the message: 5 hours (the shortest subscription window). A dead login gets another try sooner. */
const COOLDOWN = { usage: 5 * HOUR, credits: 5 * HOUR, auth: 10 * 60e3 };
/** A dead login that only a new sign-in fixes stays out this long at most (it comes back the moment it is signed in). */
const SIGNIN_HOLD = 30 * DAY;
const LIMIT_RE = /hit your (?:weekly |daily |session |5-hour )?limit|usage limit reached|rate_limit_error.*(?:weekly|daily)/i;
const CREDITS_RE = /out of credits|credit balance is too low|insufficient (?:credit|balance)|no credits left/i;
// Nov 8 2026: Claude Code 2.1.319 says "Failed to authenticate: OAuth session expired and could not be refreshed";
// the old pattern only knew "oauth token expired", so three builds died on account-1 and none moved.
const AUTH_RE = /failed to authenticate|invalid api key|please run \/login|oauth (?:token|session) (?:has )?expired|could not be refreshed|authentication_error|not logged in|invalid_grant|token (?:has been )?revoked/i;
/** Auth failures no retry fixes: the account stays out until it is signed in again. */
const DEAD_LOGIN_RE = /could not be refreshed|oauth (?:token|session) (?:has )?expired|invalid_grant|revoked|please run \/login|not logged in|invalid api key/i;
/** Said at the very start of a run, before any work: an account problem even when claude exits 0. */
const AUTH_START_RE = /^\s*Failed to authenticate:/m;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function paths(env = process.env) {
  const login = loginPaths(env);
  const dir = env.AXF_CLAUDE_WORKERS || dirname(login.seen);
  return { ...login, dir, config: join(dir, 'workers.json'), state: join(dir, 'worker-state.json'), hdir: env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless' };
}

export function loadConfig(env = process.env) {
  return normConfig(readJson(paths(env).config));
}

const atomic = (f, v) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(v, null, 1));
  renameSync(`${f}.${process.pid}.tmp`, f);
};

/** Write the config. A session may never raise or remove a spend cap (`allowRaise` is the console's owner click). */
export function saveConfig(next, env = process.env, { allowRaise = false } = {}) {
  const cfg = normConfig(next);
  const raised = raisedCaps(loadConfig(env), cfg);
  if (raised.length && !allowRaise) throw Object.assign(new Error(`raising a spend cap is Brett's own click in the console (${raised.join('; ')})`), { code: 2 });
  atomic(paths(env).config, cfg);
  return cfg;
}

/** Read the config, change it, write it (under the state lock, so two writers never lose each other's change). */
export function editConfig(fn, env = process.env, opts = {}) {
  return withLock(env, () => { const c = loadConfig(env); const out = fn(c) ?? c; return saveConfig(out, env, opts); });
}

const loadState = (env) => {
  const s = readJson(paths(env).state);
  return { limits: s?.limits && typeof s.limits === 'object' ? s.limits : {}, claims: s?.claims && typeof s.claims === 'object' ? s.claims : {} };
};
const saveState = (state, env) => atomic(paths(env).state, state);

/** One writer at a time on worker-state.json (claims must never hand the last slot to two jobs). Stale after 10 s. */
export function withLock(env, fn) {
  const f = `${paths(env).state}.lock`;
  mkdirSync(dirname(f), { recursive: true });
  const until = Date.now() + 15_000;
  for (;;) {
    try { closeSync(openSync(f, 'wx')); break; } catch {
      try { if (Date.now() - statSync(f).mtimeMs > 10_000) { rmSync(f, { force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw Object.assign(new Error('worker state is locked'), { code: 2 });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    }
  }
  try { return fn(); } finally { rmSync(f, { force: true }); }
}

/** "resets 3pm (UTC)", "resets Nov 10, 2:30am": when the limit ends, ms; 0 when the text doesn't say. Times are UTC. */
export function parseReset(text, now = Date.now()) {
  const m = /resets?\s+(?:at\s+)?(?:([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(String(text ?? ''));
  if (!m) return 0;
  const hour = (Number(m[3]) % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0);
  const d = new Date(now);
  const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (m[1] && month < 0) return 0;
  let at = Date.UTC(d.getUTCFullYear(), m[1] ? month : d.getUTCMonth(), m[2] ? Number(m[2]) : d.getUTCDate(), hour, Number(m[4] ?? 0));
  if (at <= now) at = m[1] ? Date.UTC(d.getUTCFullYear() + 1, month, Number(m[2]), hour, Number(m[4] ?? 0)) : at + DAY;
  return at;
}

/**
 * What stopped a run: 'usage', 'credits', 'auth' or ''. A dead login counts on a failed exit (a build may print those
 * words), or when the run opened with "Failed to authenticate:" before doing anything.
 */
export function hitOf(text, exit = 0) {
  if (CREDITS_RE.test(text)) return 'credits';
  if (LIMIT_RE.test(text)) return 'usage';
  return (exit !== 0 && AUTH_RE.test(text)) || AUTH_START_RE.test(text) ? 'auth' : '';
}

/** The account's login right now, as a hash (OAuth refresh token, saved token or API key): a new sign-in changes it. */
export function loginHashOf(name, env = process.env) {
  const d = join(loginPaths(env).accounts, name);
  const rt = readJson(join(d, '.credentials.json'))?.claudeAiOauth?.refreshToken;
  const t = (f) => { try { return readFileSync(join(d, f), 'utf8').trim(); } catch { return ''; } };
  return tokenHash(rt || t('token') || t('apikey'));
}

const REASONS = { usage: 'hit its usage limit', credits: 'ran out of credits', auth: 'login failed' };

export function markLimit(name, { kind = 'usage', text = '' } = {}, env = process.env, now = Date.now()) {
  if (!NAME_RE.test(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const dead = kind === 'auth' && DEAD_LOGIN_RE.test(text);
  const until = dead ? now + SIGNIN_HOLD : ((kind === 'usage' || kind === 'credits') ? parseReset(text, now) : 0) || now + (COOLDOWN[kind] ?? COOLDOWN.usage);
  const reason = dead ? (/could not be refreshed|expired/i.test(text) ? 'login expired and could not be renewed' : 'signed out') : REASONS[kind] ?? REASONS.usage;
  return withLock(env, () => {
    const state = loadState(env);
    state.limits[name] = { at: new Date(now).toISOString(), until: new Date(until).toISOString(), kind, reason,
      ...(dead ? { untilSignin: true, login: loginHashOf(name, env).slice(0, 16) } : {}) };
    saveState(state, env);
    return state.limits[name];
  });
}

/** Bring an account back by hand (Brett signed it in, or topped it up). */
export function clearLimit(name, env = process.env) {
  return withLock(env, () => { const state = loadState(env); const had = !!state.limits[name]; delete state.limits[name]; saveState(state, env); return had; });
}

/** Out right now: past its time = back; a dead login is back as soon as the account holds a different login. */
const limitOf = (state, name, now, env = process.env) => {
  const l = state.limits[name];
  if (!l || Date.parse(l.until) <= now) return null;
  if (l.untilSignin && l.login && loginHashOf(name, env).slice(0, 16) !== l.login) return null;
  return l;
};

/** Every line of events.jsonl, oldest first. */
function readEvents(env) {
  let t = ''; try { t = readFileSync(join(paths(env).hdir, 'events.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } });
}

function liveSessions() {
  const r = spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' });
  return r.status === 0 ? new Set(r.stdout.split('\n').filter(Boolean)) : null;
}

const meterCost = (env, session) => Number(readJson(join(paths(env).hdir, `${session}.meter.json`))?.costUsd) || 0;

/**
 * Per account: { running: [sessions], runs: [{ session, name, agent, model, at, end, exit, costUsd }] }. A run that moved
 * accounts shows on each one with what it cost there: `session-part` records the meter when it leaves an account.
 */
export function ledger(events, { cost = () => 0, alive = null } = {}) {
  const open = new Map(); const out = {};
  const slot = (a) => (out[a] ??= { running: [], runs: [] });
  const close = (s, e, total) => {
    slot(s.account).runs.push({ session: e.session, name: s.name, agent: s.agent, model: s.model, at: s.at, end: e.at, exit: e.exit ?? null, costUsd: +Math.max(0, total - s.base).toFixed(4) });
    return total;
  };
  for (const e of events) {
    if (e.event === 'session-login' && e.account) {
      const was = open.get(e.session);
      open.set(e.session, { account: e.account, name: e.name, agent: e.agent, model: e.model, at: e.at, base: was?.next ?? 0 });
    } else if (e.event === 'session-part' && open.has(e.session)) {
      const s = open.get(e.session); const total = Number(e.costUsd) || 0;
      close(s, e, total); s.next = total;
    } else if (e.event === 'session-end' && open.has(e.session)) {
      close(open.get(e.session), e, Number(e.costUsd) || cost(e.session)); open.delete(e.session);
    }
  }
  for (const [session, s] of open) if (!alive || alive.has(session)) { slot(s.account).running.push(session); slot(s.account).runs.push({ session, name: s.name, agent: s.agent, model: s.model, at: s.at, end: '', exit: null, costUsd: +Math.max(0, cost(session) - s.base).toFixed(4) }); }
  return out;
}

const emailIn = (p, name) => String(readJson(join(p.accounts, name, '.claude.json'))?.oauthAccount?.emailAddress || '');

function aliveSet(env) {
  if (env.AXF_WORKERS_ALIVE !== undefined) return new Set(env.AXF_WORKERS_ALIVE.split(',').filter(Boolean));
  return liveSessions();
}

/** Claims whose session is still there (no tmux to ask = a claim lives 12 hours). */
function liveClaims(state, alive, now) {
  return Object.entries(state.claims).filter(([s, c]) => c && (alive ? alive.has(s) : now - Date.parse(c.at) < 12 * HOUR));
}

/** Every saved account with its role, kind, limit, jobs, cost and spend caps. No credential. */
export function status(env = process.env, now = Date.now(), { forSession = '' } = {}) {
  const p = paths(env);
  const cfg = loadConfig(env);
  const state = loadState(env);
  const seen = readJson(p.seen) ?? {};
  const alive = aliveSet(env);
  const led = ledger(readEvents(env), { cost: (s) => meterCost(env, s), alive });
  const claims = liveClaims(state, alive, now);
  const mine = state.claims[forSession];
  const sum = (runs, since) => +runs.filter((r) => now - Date.parse(r.end || r.at) < since).reduce((n, r) => n + r.costUsd, 0).toFixed(2);
  const base = accounts(env).map((a) => {
    const l = led[a.name] ?? { running: [], runs: [] };
    const running = [...new Set([...l.running, ...claims.filter(([s, c]) => c.account === a.name && c.state === 'run').map(([s]) => s)])].filter((s) => s !== forSession);
    // a job asking for a slot sees the jobs queued before it as already holding one, so the oldest waiter goes first
    const queue = claims.filter(([s, c]) => c.account === a.name && c.state === 'queue' && s !== forSession);
    const ahead = queue.filter(([, c]) => !mine || mine.state !== 'queue' || Date.parse(c.at) < Date.parse(mine.at)).length;
    return {
      name: a.name, kind: a.kind === 'api' ? 'api' : 'subscription', active: a.active, hasKey: a.kind === 'api' ? true : undefined,
      email: a.email || emailIn(p, a.name), plan: String(seen?.[a.name]?.plan || ''),
      limited: limitOf(state, a.name, now, env), running, ahead, queued: queue.length, runsToday: l.runs.filter((r) => now - Date.parse(r.at) < DAY).length,
      costToday: sum(l.runs, DAY), costWeek: sum(l.runs, 7 * DAY), recent: l.runs.slice(-5).reverse(),
      home: homeOf(a.name, env),
    };
  });
  // API worker slots set up before their key is saved still show (no key yet)
  for (const n of Object.keys(cfg.api)) if (!base.some((a) => a.name === n)) base.push({ name: n, kind: 'api', active: false, hasKey: false, email: '', plan: '', limited: null, running: [], ahead: 0, queued: 0, runsToday: 0, costToday: 0, costWeek: 0, recent: [] });
  const ro = roster(cfg, base);
  const rows = base.map((a, i) => ({ ...a, label: ro[i].label, role: ro[i].role, building: ro[i].building, queue: ro[i].queue, spend: ro[i].spend, takesJobs: ro[i].takesJobs, canRun: ro[i].canRun, why: ro[i].why }));
  const free = ro.filter((r) => r.kind === 'subscription' && r.takesJobs && !r.limited).length;
  return { $axf: SCHEMA, workers: rows.filter((r) => r.role === 'worker').map((r) => r.name), free, config: cfg, accounts: rows, alerts: routingAlerts(cfg, base),
    events: accountEvents(env, 20), at: new Date(now).toISOString() };
}

/** The login's one home (claude-home.mjs): when its token was last renewed and by whom, when it runs out. No credential. */
function homeOf(name, env) {
  try {
    const m = homeMeta(name, env);
    if (!m.current) return null;
    return { lastRefreshAt: m.lastRefreshAt || '', lastRefreshBy: m.lastRefreshBy || '', expiresAt: m.expiresAt ? new Date(m.expiresAt).toISOString() : '' };
  } catch { return null; }
}

/** Rows as the router sees them for one job: queued-ahead jobs count as running. */
const routingRows = (s) => s.accounts.map((a) => ({ ...a, running: a.running.length + (a.ahead || 0) }));

/** Where a job would go right now (nothing recorded). */
export function preview(job = {}, { exclude = [], forSession = '' } = {}, env = process.env, now = Date.now()) {
  const s = status(env, now, { forSession });
  return decide(s.config, routingRows(s).filter((a) => !exclude.includes(a.name)), job);
}

/** The account a new job would run on now, or '' (none free). Kept for older callers. */
export function route({ exclude = [] } = {}, env = process.env, now = Date.now()) {
  const d = preview({}, { exclude }, env, now);
  return d.state === 'run' ? d.account : '';
}

/** Decide and record it: the job holds a slot (run) or a place in line (queue) on that account until release. */
export function claim(session, job = {}, { exclude = [] } = {}, env = process.env, now = Date.now()) {
  if (!session) throw Object.assign(new Error('--session is required'), { code: 2 });
  return withLock(env, () => {
    const d = preview(job, { exclude, forSession: session }, env, now);
    const state = loadState(env);
    const alive = aliveSet(env);
    state.claims = Object.fromEntries(liveClaims(state, alive, now).filter(([s]) => s !== session));
    if (d.state !== 'none') {
      const was = loadState(env).claims[session];
      const at = was && was.state === 'queue' && was.account === d.account && d.state === 'queue' ? was.at : new Date(now).toISOString();
      state.claims[session] = { account: d.account, state: d.state, at, rule: d.rule || undefined };
      if (d.state === 'queue') d.position = Object.values(state.claims).filter((c) => c.account === d.account && c.state === 'queue' && Date.parse(c.at) <= Date.parse(at)).length;
    }
    saveState(state, env);
    return d;
  });
}

export function release(session, env = process.env) {
  return withLock(env, () => {
    const state = loadState(env);
    const had = !!state.claims[session];
    delete state.claims[session];
    saveState(state, env);
    return had;
  });
}

/**
 * A run ended: was it the account (login, limit, credits)? If so the account is taken out, Brett gets a phone alert,
 * and the run is moved (build account-failover-notify, Nov 8 2026: "No build should die and stay dead because of one
 * account."). The next account comes from the same rules as a new job (workers, then the console's account, API
 * accounts only where a rule sends the job). Returns
 *   { action: 'none' }                                  not an account problem: the run ends as it did
 *   { action: 'move', to, kind, hit }                   start again on `to` (a slot there is claimed for this session)
 *   { action: 'queue', to, position, hit }              every account busy: wait in `to`'s queue (claim again to move up)
 *   { action: 'wait', minutes, hit }                    every account out: wait for one to come back (claim again)
 *   { action: 'stop', hit, why }                        failover off, or this run moved too many times
 */
export async function failover({ session, account = '', text = '', exit = 0, moves = 0, build = '', job = {} } = {}, env = process.env, now = Date.now()) {
  const hit = hitOf(text, Number(exit) || 0);
  if (!hit) return { action: 'none' };
  const A = await import('./account-alerts.mjs');
  const cfg = loadConfig(env).failover;
  const named = NAME_RE.test(account) && account !== 'live';
  const l = named ? markLimit(account, { kind: hit, text }, env, now) : { reason: hit, until: '' };
  const row = named ? status(env, now).accounts.find((a) => a.name === account) : null;
  const ev = { account: named ? account : 'live', kind: hit, reason: l.reason, build: build || session, until: l.until, untilSignin: !!l.untilSignin, email: row?.email || '' };
  const stop = (why) => { if (named) A.raise({ ...ev, stopped: true }, env); return { action: 'stop', hit, why }; };
  if (!cfg.enabled) return stop('failover is off (Claude accounts → Job routing → Failover)');
  if (moves >= cfg.maxMoves) return stop(`this run already moved ${moves} times (most ${cfg.maxMoves})`);
  const d = claim(session, job, { exclude: named ? [account] : [] }, env, now);
  if (d.state === 'run') {
    if (named) A.raise({ ...ev, movedTo: `${d.account}${d.label ? ` "${d.label}"` : ''}` }, env);
    A.logEvent({ action: 'move', account: ev.account, to: d.account, kind: hit, build: ev.build, session }, env);
    return { action: 'move', to: d.account, kind: d.kind, hit };
  }
  if (d.state === 'queue') {
    if (named) A.raise({ ...ev, waiting: true }, env);
    return { action: 'queue', to: d.account, position: d.position, hit };
  }
  if (cfg.waitMinutes > 0) {
    if (named) A.raise({ ...ev, waiting: true, stopped: false }, env);
    return { action: 'wait', minutes: cfg.waitMinutes, hit };
  }
  return stop(`no account can take it: ${d.why}`);
}

/**
 * The minute sweep: an account that is back (its time passed, or it was signed in again) leaves the limits and its
 * phone alert is resolved. Returns the names that came back.
 */
export async function revive(env = process.env, now = Date.now()) {
  const back = withLock(env, () => {
    const state = loadState(env); const out = [];
    for (const n of Object.keys(state.limits)) if (!limitOf(state, n, now, env)) { out.push(n); delete state.limits[n]; }
    if (out.length) saveState(state, env);
    return out;
  });
  if (back.length) { const A = await import('./account-alerts.mjs'); for (const n of back) A.resolveAlerts(n, undefined, env); }
  return back;
}

/** Minutes in an estimate: 30, "20 min", "1.5 h". */
const minutesOf = (e) => { const m = /([\d.]+)\s*(h|hour)?/i.exec(String(e ?? '')); return m ? Math.round(Number(m[1]) * (m[2] ? 60 : 1)) || 0 : 0; };

/** The job a launch is, as the rules see it: model, priority, profile, type, and the build's steps / minutes left. */
export async function jobFor({ name = '', brief = '', model = '', priority = '', jobType = '', profile = '' } = {}, env = process.env) {
  const job = { name, model, priority, jobType: jobType || env.AXF_JOB_TYPE || (env.AXF_SURFACE === 'agent-job' ? 'agent-job' : 'build'), profile: profile || env.AXF_BUILD_PROFILE || 'all' };
  try {
    const { resolveBuild } = await import('../framework/core/build-priority.mjs');
    const store = readJson(join(HERE, '..', '_claude', 'builds', 'store.json'));
    let text = ''; try { text = readFileSync(brief, 'utf8'); } catch { /* no brief */ }
    const id = /^\s*(?:build|id)\s*[:=]\s*`?([a-z0-9][a-z0-9-]+)/im.exec(text)?.[1];
    const b = resolveBuild(store?.builds ?? [], id || name.replace(/^axf-/, '').replace(/--.*$/, ''));
    if (b) {
      const left = (b.steps ?? []).filter((x) => !x.done && !x.skip);
      Object.assign(job, { build: b.id, steps: left.length, minutes: left.reduce((n, x) => n + minutesOf(x.estimate), 0) });
      if (!job.priority && b.priority) job.priority = b.priority;
      if (!job.model && left[0]?.model) job.model = left[0].model;
    }
  } catch { /* no store here: the rules see what the launch said */ }
  return normJob(job);
}

/** Sign an account in, in its own folder, so the live login and the console's account are never touched. */
export function signin(name, env = process.env) {
  if (!NAME_RE.test(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const p = paths(env);
  const dir = join(p.accounts, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const session = `axf-signin-${name}`;
  const script = `export PATH="$HOME/.local/bin:$PATH" CLAUDE_CONFIG_DIR='${dir}'; unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY; claude auth login; read -r -t 300 -p 'Enter closes this. ' _`;
  const r = spawnSync('tmux', ['new-session', '-d', '-s', session, '-x', '160', '-y', '40', 'bash', '-c', script], { encoding: 'utf8' });
  if (r.status !== 0) throw Object.assign(new Error(`could not start ${session}: ${(r.stderr || 'tmux is missing').trim().slice(0, 200)}`), { code: 2 });
  spawnSync('tmux', ['set-option', '-t', session, '@axf_kind', 'signin'], { encoding: 'utf8' });
  return session;
}

/** Move a saved account to .removed/ (restorable by hand). The active account and one with a running job stay. */
export function remove(name, env = process.env, now = Date.now()) {
  if (!NAME_RE.test(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const p = paths(env);
  const row = status(env, now).accounts.find((a) => a.name === name);
  if (!row && !existsSync(join(p.accounts, name))) throw Object.assign(new Error(`no saved account ${name}`), { code: 2 });
  if (row?.role === 'interactive') throw Object.assign(new Error(`${name} is the console's account: switch first`), { code: 2 });
  if (row?.running.length) throw Object.assign(new Error(`${name} is running ${row.running.join(', ')}`), { code: 2 });
  const shelf = join(p.accounts, '.removed');
  mkdirSync(shelf, { recursive: true, mode: 0o700 });
  const to = join(shelf, `${name}-${new Date(now).toISOString().replace(/[:.]/g, '-')}`);
  renameSync(join(p.accounts, name), to);
  return to;
}

/** One line for the build's notes: what this session ran on and what it cost there. */
export function noteFor(session, env = process.env) {
  const led = ledger(readEvents(env), { cost: (s) => meterCost(env, s) });
  const parts = Object.entries(led).flatMap(([a, l]) => { const c = l.runs.filter((r) => r.session === session); return c.length ? [`${a}: ${c.length} run${c.length > 1 ? 's' : ''}, $${c.reduce((n, r) => n + r.costUsd, 0).toFixed(2)}`] : []; });
  return parts.length ? `Worker accounts: ${parts.join('; ')}` : '';
}

const tail = (f, lines = 40) => { try { return readFileSync(f, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return ''; } };

const ON = new Set(['on', 'true', '1', 'yes']); const OFF = new Set(['off', 'false', '0', 'no']);
const onOff = (v) => { const x = String(v ?? '').toLowerCase(); if (ON.has(x)) return true; if (OFF.has(x)) return false; throw Object.assign(new Error(`on or off, not "${v}"`), { code: 2 }); };
const nameOk = (n) => { if (!NAME_RE.test(n || '')) throw Object.assign(new Error(`not an account name: ${n}`), { code: 2 }); return n; };
const ruleIdx = (c, id) => { const i = c.rules.findIndex((r) => r.id === id); if (i < 0) throw Object.assign(new Error(`no rule ${id} (rules: ${c.rules.map((r) => r.id).join(', ') || 'none'})`), { code: 2 }); return i; };
const parseJson = (t, what) => { try { return JSON.parse(t); } catch { throw Object.assign(new Error(`${what} is not JSON`), { code: 2 }); } };
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

/** One line per account, for people. */
export function statusLines(s) {
  return s.accounts.map((a) => {
    const lim = a.limited ? ` · out (${a.limited.reason}) ${a.limited.untilSignin ? 'until signed in again' : `until ${a.limited.until}`}` : '';
    const ref = a.home?.lastRefreshAt ? ` · last refresh ${a.home.lastRefreshAt}${a.home.lastRefreshBy ? ` (${a.home.lastRefreshBy})` : ''}` : '';
    const cap = a.spend ? ` · caps ${a.spend.dayCap ? usd(a.spend.dayCap) : 'none'}/day ${a.spend.weekCap ? usd(a.spend.weekCap) : 'none'}/week${a.spend.state !== 'ok' ? ` (${a.spend.state})` : ''}` : '';
    return `${a.role.padEnd(11)} ${a.name}${a.label ? ` "${a.label}"` : ''}${a.email ? ` (${a.email})` : ''}${lim} · ${a.running.length}/${a.building} running · ${a.queued}/${a.queue} queued · ${usd(a.costToday)} today · ${usd(a.costWeek)} week${cap}${a.why && !a.limited ? ` · ${a.why}` : ''}${ref}`;
  });
}

const decisionLine = (d) => `${d.state === 'run' ? `→ ${d.account}${d.label ? ` "${d.label}"` : ''} (${d.kind})` : d.state === 'queue' ? `→ waits for ${d.account} (position ${d.position})` : '→ no account'}: ${d.why}`;

const main = async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const has = (n) => rest.includes(`--${n}`);
  const json = has('json') && !['rule', 'test', 'failover'].includes(cmd);
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const jobArgs = async () => {
    if (flag('job')) return normJob(parseJson(flag('job'), '--job'));
    const j = await jobFor({ name: flag('name'), brief: flag('brief'), model: flag('model'), priority: flag('priority'), jobType: flag('type'), profile: flag('profile') });
    if (flag('steps')) j.steps = Number(flag('steps')) || 0;
    if (flag('minutes')) j.minutes = Number(flag('minutes')) || 0;
    return j;
  };
  const exclude = flag('exclude').split(',').filter(Boolean);
  try {
    if (cmd === 'route') console.log(route({ exclude }));
    else if (cmd === 'claim') {
      const d = claim(flag('session'), await jobArgs(), { exclude });
      console.log(d.state === 'run' ? `run ${d.account} ${d.kind}` : d.state === 'queue' ? `queue ${d.account} ${d.position}` : `none ${d.why}`);
      if (has('why')) console.error(decisionLine(d));
    } else if (cmd === 'release') out({ released: release(flag('session')) }, 'released');
    else if (cmd === 'test' || cmd === 'preview') {
      const d = preview(await jobArgs(), { exclude });
      if (rest.includes('--json')) console.log(JSON.stringify(d));
      else { console.log(decisionLine(d)); for (const c of d.considered) console.log(`  ${c.match ? '✓' : '·'} ${c.name}: ${c.why}`); }
    } else if (cmd === 'hit') console.log(hitOf(tail(flag('log')), Number(flag('exit', '0'))));
    else if (cmd === 'limit') { const kind = flag('kind', 'usage'); const l = markLimit(rest[0], { kind, text: tail(flag('log')) }); console.log(`${rest[0]} out ${l.untilSignin ? 'until it is signed in again' : `until ${l.until}`} (${l.reason})`); }
    else if (cmd === 'clear') { const n = nameOk(rest[0]); const had = clearLimit(n); if (had) { const A = await import('./account-alerts.mjs'); A.resolveAlerts(n); } out({ name: n, cleared: had }, had ? `${n} is back in` : `${n} was not out`); }
    else if (cmd === 'revive') { const b = await revive(); out({ back: b }, b.length ? `back: ${b.join(', ')}` : 'nobody came back'); }
    else if (cmd === 'failover') {
      const r = await failover({ session: flag('session'), account: flag('account'), text: tail(flag('log'), 60), exit: Number(flag('exit', '0')), moves: Number(flag('moves', '0')), build: flag('build'), job: await jobArgs() });
      // one shell-safe line for the launcher
      console.log(r.action === 'move' ? `move ${r.to} ${r.kind} ${r.hit}` : r.action === 'queue' ? `queue ${r.to} ${r.position} ${r.hit}` : r.action === 'wait' ? `wait ${r.minutes} ${r.hit}` : r.action === 'stop' ? `stop ${r.hit} ${r.why}` : 'none');
    }
    else if (cmd === 'events') { const A = await import('./account-alerts.mjs'); const e = A.readEvents(process.env, Number(flag('max', '30')) || 30); out(e, e.map((x) => `${x.at} ${x.action} ${x.account}${x.kind ? ` ${x.kind}` : ''}${x.to ? ` → ${x.to}` : ''}${x.movedTo ? ` → ${x.movedTo}` : ''}${x.build ? ` (${x.build})` : ''}`).join('\n') || 'no account events'); }
    else if (cmd === 'failover-set') {
      const [key, val] = rest;
      const c = editConfig((x) => {
        const f = { ...x.failover };
        if (key === 'enabled' || key === 'alerts' || key === 'alertOnLimit') f[key] = onOff(val);
        else if (key === 'maxMoves' || key === 'waitMinutes') f[key] = Number(val);
        else throw Object.assign(new Error('failover-set enabled|alerts|alertOnLimit on|off · maxMoves N · waitMinutes N'), { code: 2 });
        x.failover = f;
      });
      out(c.failover, `failover ${c.failover.enabled ? 'on' : 'off'} · moves ${c.failover.maxMoves} · waits ${c.failover.waitMinutes} min when every account is out · alerts ${c.failover.alerts ? 'on' : 'off'}${c.failover.alertOnLimit ? '' : ' (not for limits)'}`);
    }
    else if (cmd === 'status') { const s = status(); out(s, statusLines(s).join('\n')); }
    else if (cmd === 'alerts') { const a = status().alerts; out(a, a.map((x) => `${x.level} ${x.text}`).join('\n') || 'no alerts'); }
    else if (cmd === 'config' || cmd === 'rules') {
      const c = loadConfig();
      if (cmd === 'rules') out(c.rules, c.rules.map((r, i) => `${i + 1}. ${r.enabled ? 'on ' : 'off'} ${r.id} → ${r.to}${r.accounts.length ? ` (${r.accounts.join(', ')})` : ''} · ${JSON.stringify(r.when)}`).join('\n') || 'no rules: API accounts take nothing');
      else out(c, JSON.stringify(c, null, 1));
    } else if (cmd === 'set') {
      const [key, val] = rest;
      const c = editConfig((x) => {
        if (key === 'interactiveTakesJobs' || key === 'interactive') x.interactiveTakesJobs = onOff(val);
        else if (key === 'building' || key === 'queue') x.limits[key] = Number(val);
        else throw Object.assign(new Error('set interactiveTakesJobs on|off | building N | queue N'), { code: 2 });
      });
      out(c, `interactive takes jobs: ${c.interactiveTakesJobs ? 'on' : 'off'} · building ${c.limits.building} · queue ${c.limits.queue}`);
    } else if (cmd === 'worker') {
      const n = nameOk(rest[0]); const on = onOff(rest[1] ?? 'on');
      const row = status().accounts.find((a) => a.name === n);
      if (row?.kind === 'api') throw Object.assign(new Error(`${n} is an API key: use "api on|off ${n}"`), { code: 2 });
      editConfig((x) => { x.excluded = on ? x.excluded.filter((y) => y !== n) : [...x.excluded, n]; if (on && !x.workers.includes(n)) x.workers.push(n); });
      out({ name: n, worker: on }, on ? `${n} takes headless jobs` : `${n} no longer takes headless jobs`);
    } else if (cmd === 'label') {
      const n = nameOk(rest[0]); const label = rest.slice(1).join(' ').trim();
      editConfig((x) => { if (x.api[n]) x.api[n].label = label; else { x.perAccount[n] = { ...(x.perAccount[n] ?? {}), label }; } });
      out({ name: n, label }, `${n} is shown as "${label}"`);
    } else if (cmd === 'api') {
      const [op, n0] = rest; const n = nameOk(n0);
      const c = editConfig((x) => {
        if (op === 'add') x.api[n] = { label: flag('label', x.api[n]?.label || n), enabled: true, dailyCapUsd: Number(flag('daily', '0')), weeklyCapUsd: Number(flag('weekly', '0')), alertAt: Number(flag('alert', '0.8')) };
        else if (op === 'on' || op === 'off') { if (!x.api[n]) throw Object.assign(new Error(`${n} is not an API worker (api add first)`), { code: 2 }); x.api[n].enabled = op === 'on'; }
        else if (op === 'remove') delete x.api[n];
        else if (op === 'caps') { if (!x.api[n]) throw Object.assign(new Error(`${n} is not an API worker`), { code: 2 }); if (flag('daily')) x.api[n].dailyCapUsd = Number(flag('daily')); if (flag('weekly')) x.api[n].weeklyCapUsd = Number(flag('weekly')); if (flag('alert')) x.api[n].alertAt = Number(flag('alert')); }
        else throw Object.assign(new Error('api add|on|off|remove|caps <name>'), { code: 2 });
      });
      out(c.api[n] ?? null, c.api[n] ? `${n}: ${c.api[n].enabled ? 'on' : 'off'} · ${usd(c.api[n].dailyCapUsd)}/day · ${usd(c.api[n].weeklyCapUsd)}/week` : `${n} is no longer an API worker`);
    } else if (cmd === 'rule') {
      const [op, id] = rest;
      const c = editConfig((x) => {
        if (op === 'add') { const r = normRule(parseJson(flag('json'), '--json'), x.rules.length); const at = flag('at') === '' ? x.rules.length : Number(flag('at')); x.rules.splice(Math.max(0, Math.min(x.rules.length, at)), 0, r); }
        else if (op === 'update') { const i = ruleIdx(x, id); const p = parseJson(flag('json'), '--json'); x.rules[i] = normRule({ ...x.rules[i], ...p, when: { ...x.rules[i].when, ...(p.when ?? {}) }, id }, i); }
        else if (op === 'remove') x.rules.splice(ruleIdx(x, id), 1);
        else if (op === 'on' || op === 'off' || op === 'enable' || op === 'disable') x.rules[ruleIdx(x, id)].enabled = op === 'on' || op === 'enable';
        else if (op === 'move') { const i = ruleIdx(x, id); const to = rest[2] === 'up' ? i - 1 : rest[2] === 'down' ? i + 1 : Number(rest[2]) - 1; const [r] = x.rules.splice(i, 1); x.rules.splice(Math.max(0, Math.min(x.rules.length, Number.isFinite(to) ? to : i)), 0, r); }
        else throw Object.assign(new Error('rule add|update|remove|move|on|off'), { code: 2 });
      });
      if (rest.includes('--json') && op !== 'add' && op !== 'update') console.log(JSON.stringify(c.rules));
      else console.log(c.rules.map((r, i) => `${i + 1}. ${r.enabled ? 'on ' : 'off'} ${r.id} → ${r.to}`).join('\n') || 'no rules');
    } else if (cmd === 'signin') console.log(`started ${signin(rest[0])}: finish the sign-in in the console's Terminal`);
    else if (cmd === 'remove') console.log(`set aside in ${remove(rest[0])}`);
    else if (cmd === 'note') console.log(noteFor(rest[0]));
    else { console.error('usage: claude-workers.mjs claim|release|route|test|status|alerts|config|rules|set|worker|label|api|rule|limit|clear|revive|failover|failover-set|events|hit|signin|remove|note (see the header)'); process.exit(2); }
  } catch (e) { console.error(`claude-workers: ${e.message}`); process.exit(2); }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
