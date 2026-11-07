#!/usr/bin/env node
/**
 * claude-workers.mjs — headless worker accounts (build multi-account-headless-workers, Nov 7 2026).
 *
 * The console stays on one Claude subscription (the active account, ~/.claude-accounts/.active). Accounts marked as
 * workers are never made active: they only run headless jobs. Each job already runs on a private copy of its login
 * (deploy/claude-login.mjs), so several subscriptions work at once without touching the console's login. This file
 * decides which worker takes a job and keeps what each one did.
 *
 *   node deploy/claude-workers.mjs route [--exclude a,b]       prints the worker for a new job; nothing = no worker free
 *   node deploy/claude-workers.mjs limit <name> --kind usage|auth [--log <file>]   take a worker out until it can work again
 *   node deploy/claude-workers.mjs hit --log <file> --exit <n> prints usage or auth when that log ended on one
 *   node deploy/claude-workers.mjs status [--json]             every account: role, limit, running, runs and cost
 *   node deploy/claude-workers.mjs signin <name>               sign an account in, in its own folder, in a tmux session
 *   node deploy/claude-workers.mjs remove <name>               set a saved account aside (never deleted)
 *   node deploy/claude-workers.mjs note <session>              one line for the build: runs and cost per account
 *
 * claude-workers@1 (workers.json, next to the plugin's seen.json; the console writes it): { workers: [names, in order] }.
 * worker-state.json (written here): { limits: { name: { at, until, kind, reason } } }. A limit ends by itself at `until`.
 * Neither holds a credential, and nothing here prints one.
 *
 * Routing: workers that are saved, not active, not limited; fewest running jobs first, then the order in workers.json.
 * API-key accounts are never workers (they bill per token). Paths: AXF_CLAUDE_WORKERS (folder of the two files),
 * AXF_HEADLESS_DIR (events.jsonl and meters), and claude-login.mjs's AXF_CLAUDE_ACCOUNTS / AXF_CLAUDE_SEEN.
 * Exit 0 ok, 2 bad usage or refused.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accounts, paths as loginPaths } from './claude-login.mjs';

export const SCHEMA = 'claude-workers@1';
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HOUR = 3600e3;
const DAY = 24 * HOUR;
/** No reset time in the message: 5 hours (the shortest subscription window). A dead login gets another try sooner. */
const COOLDOWN = { usage: 5 * HOUR, auth: 10 * 60e3 };
const LIMIT_RE = /hit your (?:weekly |daily |session |5-hour )?limit|usage limit reached|out of credits|credit balance is too low/i;
const AUTH_RE = /invalid api key|please run \/login|oauth token (?:has )?expired|authentication_error|not logged in/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function paths(env = process.env) {
  const login = loginPaths(env);
  const dir = env.AXF_CLAUDE_WORKERS || dirname(login.seen);
  return { ...login, dir, config: join(dir, 'workers.json'), state: join(dir, 'worker-state.json'), hdir: env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless' };
}

export function loadConfig(env = process.env) {
  const c = readJson(paths(env).config);
  const list = Array.isArray(c?.workers) ? c.workers : [];
  return { $axf: SCHEMA, workers: [...new Set(list.filter((n) => typeof n === 'string' && NAME_RE.test(n)))] };
}

const loadState = (env) => { const s = readJson(paths(env).state); return { limits: s?.limits && typeof s.limits === 'object' ? s.limits : {} }; };
function saveState(state, env) {
  const f = paths(env).state;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(state, null, 1));
  renameSync(`${f}.${process.pid}.tmp`, f);
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

/** What stopped a run: 'usage', 'auth' or ''. A dead login only counts on a failed exit: a build may print those words. */
export function hitOf(text, exit = 0) {
  if (LIMIT_RE.test(text)) return 'usage';
  return exit !== 0 && AUTH_RE.test(text) ? 'auth' : '';
}

export function markLimit(name, { kind = 'usage', text = '' } = {}, env = process.env, now = Date.now()) {
  if (!NAME_RE.test(name)) throw Object.assign(new Error(`not an account name: ${name}`), { code: 2 });
  const until = (kind === 'usage' ? parseReset(text, now) : 0) || now + (COOLDOWN[kind] ?? COOLDOWN.usage);
  const state = loadState(env);
  state.limits[name] = { at: new Date(now).toISOString(), until: new Date(until).toISOString(), kind, reason: kind === 'usage' ? 'hit its limit' : 'login failed' };
  saveState(state, env);
  return state.limits[name];
}

const limitOf = (state, name, now) => { const l = state.limits[name]; return l && Date.parse(l.until) > now ? l : null; };

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

/** Every saved account with its role, limit, jobs and cost. No credential. */
export function status(env = process.env, now = Date.now()) {
  const p = paths(env);
  const cfg = loadConfig(env);
  const state = loadState(env);
  const seen = readJson(p.seen) ?? {};
  const led = ledger(readEvents(env), { cost: (s) => meterCost(env, s), alive: liveSessions() });
  const sum = (runs, since) => +runs.filter((r) => now - Date.parse(r.end || r.at) < since).reduce((n, r) => n + r.costUsd, 0).toFixed(2);
  const rows = accounts(env).map((a) => {
    const l = led[a.name] ?? { running: [], runs: [] };
    return {
      name: a.name, role: a.active ? 'interactive' : cfg.workers.includes(a.name) ? 'worker' : 'saved', email: a.email || emailIn(p, a.name), plan: String(seen?.[a.name]?.plan || ''),
      limited: limitOf(state, a.name, now), running: l.running, runsToday: l.runs.filter((r) => now - Date.parse(r.at) < DAY).length,
      costToday: sum(l.runs, DAY), costWeek: sum(l.runs, 7 * DAY), recent: l.runs.slice(-5).reverse(),
    };
  });
  const free = rows.filter((r) => r.role === 'worker' && !r.limited).length;
  return { $axf: SCHEMA, workers: cfg.workers, free, accounts: rows, at: new Date(now).toISOString() };
}

/** The worker for a new job, or '' (no workers set up, or every one is limited or excluded). */
export function route({ exclude = [] } = {}, env = process.env, now = Date.now()) {
  const s = status(env, now);
  const order = (n) => s.workers.indexOf(n);
  const pick = s.accounts.filter((a) => a.role === 'worker' && !a.limited && !exclude.includes(a.name))
    .sort((a, b) => a.running.length - b.running.length || order(a.name) - order(b.name))[0];
  return pick?.name ?? '';
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

const main = () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  try {
    if (cmd === 'route') console.log(route({ exclude: flag('exclude').split(',').filter(Boolean) }));
    else if (cmd === 'hit') console.log(hitOf(tail(flag('log')), Number(flag('exit', '0'))));
    else if (cmd === 'limit') { const kind = flag('kind', 'usage'); const l = markLimit(rest[0], { kind, text: tail(flag('log')) }); console.log(`${rest[0]} out until ${l.until} (${l.reason})`); }
    else if (cmd === 'status') {
      const s = status();
      if (rest.includes('--json')) console.log(JSON.stringify(s));
      else for (const a of s.accounts) console.log(`${a.role.padEnd(11)} ${a.name}${a.email ? ` (${a.email})` : ''}${a.limited ? ` · out until ${a.limited.until}` : ''} · ${a.running.length} running · $${a.costToday} today · $${a.costWeek} week`);
    } else if (cmd === 'signin') console.log(`started ${signin(rest[0])}: finish the sign-in in the console's Terminal`);
    else if (cmd === 'remove') console.log(`set aside in ${remove(rest[0])}`);
    else if (cmd === 'note') console.log(noteFor(rest[0]));
    else { console.error('usage: claude-workers.mjs route [--exclude a,b] | limit <name> --kind usage|auth [--log f] | hit --log f --exit n | status [--json] | signin <name> | remove <name> | note <session>'); process.exit(2); }
  } catch (e) { console.error(`claude-workers: ${e.message}`); process.exit(2); }
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
