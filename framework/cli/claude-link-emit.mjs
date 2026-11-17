#!/usr/bin/env node
/**
 * claude-link-emit.mjs — report a Claude / axHub event to the console's Claude link (claude-link-event@1) from
 * outside the console server: headless launches, worker accounts, agent slots.
 *
 *   import { emit } from './claude-link-emit.mjs';
 *   await emit({ kind: 'launch', source: 'headless', session, account, model, summary, detail });
 *
 *   node framework/cli/claude-link-emit.mjs --kind launch --source headless --summary "…" [--session s] [--account a]
 *        [--model m] [--level info|warn|error] [--detail '{"k":"v"}']
 *   node framework/cli/claude-link-emit.mjs --headless '<events.jsonl line>'   map a claude-headless.sh event line
 *
 * Where it goes (never names a plugin folder):
 *   AXF_CLAUDE_LINK_URL    the ingest URL (default $AXF_CONSOLE_URL/api/claude-link/ingest; the console hands it to
 *                          whichever plugin provides axf.claude-link@1), with AXF_TOKEN as the bearer
 *   AXF_CLAUDE_LINK_SPOOL  where the line is appended when the console can't be reached (default
 *                          <repo>/.axf-console/claude-link-spool.jsonl); the console drains it on its next read
 *   AXF_CLAUDE_LINK=off    send nothing
 * Never throws and never exits non-zero: reporting must not break the run that reports.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const KINDS = ['launch', 'exit', 'account', 'mcp', 'axhub', 'connect', 'disconnect', 'error'];

export function target(env = process.env) {
  if (env.AXF_CLAUDE_LINK_URL) return env.AXF_CLAUDE_LINK_URL;
  return `${(env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/+$/, '')}/api/claude-link/ingest`;
}

export const spoolPath = (env = process.env) => env.AXF_CLAUDE_LINK_SPOOL || join(REPO, '.axf-console', 'claude-link-spool.jsonl');

/** Keep an event to the contract's shape (the console redacts and validates again). */
export function shape(e) {
  const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  if (!KINDS.includes(e?.kind)) return null;
  return { ts: Number(e.ts) > 0 ? Number(e.ts) : Date.now(), kind: e.kind, source: s(e.source, 40) || 'cli', session: s(e.session, 80), account: s(e.account, 40),
    model: s(e.model, 60), summary: s(e.summary, 200) || e.kind, detail: e.detail && typeof e.detail === 'object' ? e.detail : e.detail ? { text: String(e.detail) } : {},
    ...(e.level ? { level: e.level } : {}) };
}

function spool(events, env) {
  try {
    const f = spoolPath(env);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
    return true;
  } catch { return false; }
}

/** Send one event or a list. Resolves {ok, sent, spooled} and never rejects. */
export async function emit(events, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (env.AXF_CLAUDE_LINK === 'off') return { ok: true, sent: 0, spooled: 0, off: true };
  const list = (Array.isArray(events) ? events : [events]).map(shape).filter(Boolean);
  if (!list.length) return { ok: false, sent: 0, spooled: 0, why: 'no valid event' };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetchImpl(target(env), { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(env.AXF_TOKEN ? { authorization: `Bearer ${env.AXF_TOKEN}` } : {}) },
      body: JSON.stringify({ events: list }) }).finally(() => clearTimeout(t));
    if (r.ok) return { ok: true, sent: list.length, spooled: 0 };
    if (r.status === 400) return { ok: false, sent: 0, spooled: 0, why: 'refused (400)' };
    throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    return { ok: spool(list, env), sent: 0, spooled: list.length, why: String(err?.message ?? err).slice(0, 120) };
  }
}

const ERR_LINE = /\b(error|fatal|failed|exception|ECONN\w*|ETIMEDOUT|rate.?limit|hit your .*limit|unauthori[sz]ed|forbidden|overloaded)\b/i;

/** The last few error-looking lines of a run's log (stderr lands there too). */
export function errorLines(file, n = 5) {
  try {
    const text = readFileSync(file, 'utf8').slice(-64 * 1024);
    return text.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => l && ERR_LINE.test(l) && !l.startsWith('{')).slice(-n).map((l) => l.slice(0, 300));
  } catch { return []; }
}

/** A deploy/claude-headless.sh events.jsonl line → Claude link events (launch, account, exit, error). */
export function fromHeadless(line, { readErrors = errorLines } = {}) {
  const e = typeof line === 'string' ? JSON.parse(line) : line;
  const base = { source: 'headless', session: e.session || '', account: e.account || '', model: e.model || '', ts: Date.parse(e.at) || Date.now() };
  const who = e.agent && e.agent !== e.name ? `${e.agent} (${e.name})` : e.name || e.session;
  const d = { name: e.name, agent: e.agent, surface: e.surface, cwd: e.cwd, ...(e.phase ? { phase: e.phase } : {}) };
  switch (e.event) {
    case 'session-start': return [{ ...base, kind: 'launch', summary: `Started ${who}${e.model ? ` on ${e.model}` : ''}`, detail: d }];
    case 'session-login': return [{ ...base, kind: 'account', summary: `${who} runs on account ${e.account || '?'}`, detail: d }];
    case 'session-part': return [{ ...base, kind: 'account', level: 'warn', summary: `${who} hit the limit on ${e.account || 'its account'}: handing off to the next worker`, detail: { ...d, costUsd: e.costUsd } }];
    case 'session-end': {
      const code = Number(e.exit ?? 0); const bad = code !== 0 && e.kind !== 'phase-done';
      const out = [{ ...base, kind: 'exit', level: bad ? 'error' : 'info', summary: `${who} ended: exit ${code}${e.kind ? ` (${e.kind})` : ''}${e.costUsd ? ` · $${Number(e.costUsd).toFixed(2)}` : ''}`, detail: { ...d, exit: code, exitKind: e.kind, costUsd: e.costUsd } }];
      if (bad && e.log) { const lines = readErrors(e.log); if (lines.length) out.push({ ...base, kind: 'error', summary: `${who}: ${lines[lines.length - 1]}`.slice(0, 200), detail: { lines, log: e.log } }); }
      return out;
    }
    default: return [];
  }
}

async function cli(argv) {
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  let events;
  try {
    if (flag('headless')) events = fromHeadless(flag('headless'));
    else events = [{ kind: flag('kind'), source: flag('source') || 'cli', session: flag('session'), account: flag('account'), model: flag('model'), summary: flag('summary'), level: flag('level'), detail: flag('detail') ? JSON.parse(flag('detail')) : {} }];
  } catch (err) { console.error(`claude-link-emit: ${err.message}`); return; }
  if (!events.length) return;
  const r = await emit(events);
  if (argv.includes('--json')) console.log(JSON.stringify(r));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli(process.argv.slice(2));
