#!/usr/bin/env node
/**
 * api-jobs.mjs — the orchestrator's HTTP side for API-key accounts (the shapes and the maths are api-jobs-core.mjs).
 * The dispatcher is synchronous, so it runs these as a child process; the key comes only from ANTHROPIC_API_KEY in the
 * child's environment (a login snapshot of an API account), never from argv, a file in the repo or a log.
 *
 *   node api-jobs.mjs send                 stdin = Messages API body → { ok, message } | { ok:false, error }
 *   node api-jobs.mjs batch-create         stdin = { requests: [...] } → { ok, batch }
 *   node api-jobs.mjs batch-get <id>       → { ok, batch }   (processing_status in_progress | canceling | ended)
 *   node api-jobs.mjs batch-results <id>   → { ok, results: [results JSONL lines] }
 *
 * AXF_ANTHROPIC_BASE points it at another base URL (tests use a local stub). Exit 0 ok, 1 API/network error, 2 usage.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API_VERSION } from './api-jobs-core.mjs';

const base = (env = process.env) => (env.AXF_ANTHROPIC_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');

async function call(method, path, body, env = process.env) {
  const key = env.ANTHROPIC_API_KEY || '';
  if (!key) return { ok: false, error: 'no API key in the environment (ANTHROPIC_API_KEY)' };
  let res;
  try {
    res = await fetch(`${base(env)}${path}`, { method, headers: { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(240e3) });
  } catch (e) { return { ok: false, error: `network: ${e.message}` }; }
  const text = await res.text();
  if (!res.ok) { let msg = text; try { msg = JSON.parse(text)?.error?.message || text; } catch { /* plain */ } return { ok: false, status: res.status, error: `HTTP ${res.status}: ${String(msg).slice(0, 300)}` }; }
  return { ok: true, text };
}

const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

export async function send(body, env) { const r = await call('POST', '/v1/messages', body, env); return r.ok ? { ok: true, message: json(r.text) } : r; }
export async function batchCreate(body, env) { const r = await call('POST', '/v1/messages/batches', body, env); return r.ok ? { ok: true, batch: json(r.text) } : r; }
export async function batchGet(id, env) { const r = await call('GET', `/v1/messages/batches/${encodeURIComponent(id)}`, null, env); return r.ok ? { ok: true, batch: json(r.text) } : r; }
export async function batchResults(id, env) {
  const r = await call('GET', `/v1/messages/batches/${encodeURIComponent(id)}/results`, null, env);
  return r.ok ? { ok: true, results: r.text.split('\n').filter((l) => l.trim()).map(json).filter(Boolean) } : r;
}

async function main(argv) {
  const [cmd, arg] = argv;
  const stdin = () => json(readFileSync(0, 'utf8'));
  let out;
  if (cmd === 'send') out = await send(stdin());
  else if (cmd === 'batch-create') out = await batchCreate(stdin());
  else if (cmd === 'batch-get' && arg) out = await batchGet(arg);
  else if (cmd === 'batch-results' && arg) out = await batchResults(arg);
  else { process.stderr.write('usage: api-jobs.mjs send | batch-create | batch-get <id> | batch-results <id>\n'); return 2; }
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return out.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
