/**
 * API jobs core (pure, IO-free): how the orchestrator talks to the Anthropic API itself when a job runs on an API-key
 * account (Brett, Nov 9 2026: "Build up prompt caching and batch API … it's for the orchestrator, not an agent").
 *
 * The orchestrator's own Claude calls (the split today; any one-shot job tomorrow) go straight to the Messages API when
 * the account they run on is an API key, with:
 *   prompt caching   cache_control (ephemeral) breakpoints on the system prompt, the tool list and the stable context
 *                    block (rules, guides: the part that is the same for every build), so repeat calls read those tokens
 *                    from the cache at a tenth of the input price. At most 3 of the 4 breakpoints the API allows.
 *   Message Batches  non-urgent jobs go to POST /v1/messages/batches (half price, answer within 24 h, usually minutes);
 *                    urgent ones (job.urgent, or a build at an urgent priority, settings.apiUrgent) take the normal path.
 *   cost tracking    every answer's usage → a ledger entry (api-usage@1): what it cost, what it would have cost with no
 *                    cache and no batch, the cache and batch savings, cache hit or miss. summarize() totals the ledger.
 * Headless build sessions run Claude Code, which caches its own prompts; this module covers the calls the orchestrator
 * makes itself. Prices come from model-pricing@1 (framework/cli/model-pricing.mjs costUsd), passed in by the caller.
 */

export const USAGE_SCHEMA = 'api-usage@1';
export const API_VERSION = '2023-06-01';
/** The Batches API charges half of the normal token prices. */
export const BATCH_DISCOUNT = 0.5;
const EPHEMERAL = Object.freeze({ type: 'ephemeral' });

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const textBlocks = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((t) => (typeof t === 'string' ? { type: 'text', text: t } : t)).filter((b) => b && (b.type !== 'text' || b.text));

/**
 * One Messages API request body. `system` / `stable` = string or blocks (stable = the context every call of this kind
 * shares, sent first in the user turn); `prompt` = the part that changes per call. With cache on, the last block of the
 * system prompt, the last tool and the last stable block each carry cache_control, so everything up to them is cached.
 */
export function messageRequest({ model, system = '', tools = [], stable = '', prompt = '', maxTokens = 4096, cache = true } = {}) {
  const sys = textBlocks(system).map((b) => ({ ...b }));
  const tl = list(tools).map((t) => ({ ...t }));
  const st = textBlocks(stable).map((b) => ({ ...b }));
  if (cache) for (const arr of [sys, tl, st]) if (arr.length) arr[arr.length - 1].cache_control = EPHEMERAL;
  const body = { model: str(model, 80), max_tokens: Math.max(1, Math.round(num(maxTokens) || 4096)) };
  if (sys.length) body.system = sys;
  if (tl.length) body.tools = tl;
  body.messages = [{ role: 'user', content: [...st, ...textBlocks(prompt)] }];
  return body;
}

/** How many cache breakpoints a body carries (the API allows 4). */
export function cacheBreakpoints(body) {
  const blocks = [...list(body?.system), ...list(body?.tools), ...list(body?.messages).flatMap((m) => list(m?.content))];
  return blocks.filter((b) => b?.cache_control).length;
}

/** Is this job urgent? job.urgent wins; else the build's priority is in settings.apiUrgent (P0, P1 by default). */
export function isUrgent(job = {}, settings = {}) {
  if (typeof job.urgent === 'boolean') return job.urgent;
  const urgent = list(settings.apiUrgent).length ? settings.apiUrgent : ['P0', 'P1'];
  return urgent.includes(str(job.priority, 4).toUpperCase());
}

/** 'batch' (Message Batches, half price) for non-urgent jobs when batching is on, else 'messages' (the normal path). */
export function pathFor(job = {}, settings = {}) {
  return settings.apiBatch !== false && !isUrgent(job, settings) ? 'batch' : 'messages';
}

/** custom_id rules of the Batches API: 1-64 chars of [a-zA-Z0-9_-]. */
export const customId = (kind, id) => `${str(kind, 16)}-${str(id, 60)}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64);

/** POST /v1/messages/batches body: jobs = [{ customId, body }]. */
export function batchRequest(jobs) {
  return { requests: list(jobs).filter((j) => j?.customId && j?.body).map((j) => ({ custom_id: j.customId, params: j.body })) };
}

/** One results-JSONL line → { customId, ok, text, usage, model, error }. */
export function batchResult(line) {
  const r = line && typeof line === 'object' ? line : {};
  const res = r.result ?? {};
  if (res.type !== 'succeeded') return { customId: str(r.custom_id, 64), ok: false, text: '', usage: {}, model: '', error: str(res.error?.error?.message || res.error?.message || res.type || 'no result', 300) };
  const m = res.message ?? {};
  return { customId: str(r.custom_id, 64), ok: true, text: messageText(m), usage: m.usage ?? {}, model: str(m.model, 80), error: '' };
}

/** The text of a Messages API answer. */
export const messageText = (m) => list(m?.content).filter((b) => b?.type === 'text').map((b) => b.text).join('');

/** API usage → the token shape costUsd() takes. */
export function tokens(u = {}) {
  return { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) };
}

/**
 * What one answer cost and saved. `price(model, tokens)` = USD at normal prices (costUsd), null when unpriced.
 *   usd        what was billed (batch = half price)
 *   fullUsd    the same tokens with no cache and no batch (all input at the input price)
 *   cacheSaved / batchSaved   the two savings; cacheHit = some input was read from the cache
 */
export function jobCost(model, usage, { batch = false, price } = {}) {
  const t = tokens(usage);
  const listUsd = price ? price(model, t) : null;
  const flatUsd = price ? price(model, { input: t.input + t.cacheRead + t.cacheWrite, output: t.output }) : null;
  if (listUsd == null || flatUsd == null) return { ...t, usd: null, fullUsd: null, cacheSaved: null, batchSaved: null, cacheHit: t.cacheRead > 0 };
  const usd = batch ? listUsd * BATCH_DISCOUNT : listUsd;
  return { ...t, usd: r6(usd), fullUsd: r6(flatUsd), cacheSaved: r6(flatUsd - listUsd), batchSaved: r6(listUsd - usd), cacheHit: t.cacheRead > 0 };
}

/** One api-usage@1 ledger line. */
export function ledgerEntry({ at, kind, id, account, model, path, batchId = '', usage, price, error = '' }) {
  const c = jobCost(model, usage, { batch: path === 'batch', price });
  return { $axf: USAGE_SCHEMA, at: str(at, 40), kind: str(kind, 24), id: str(id, 80), account: str(account, 40), model: str(model, 80), path: path === 'batch' ? 'batch' : 'messages', batchId: str(batchId, 80), ...c, error: str(error, 300) };
}

/** Totals over ledger lines (optionally since an ISO time): jobs, paths, tokens, cost, savings, cache hit rate. */
export function summarize(entries, { since = '' } = {}) {
  const rows = list(entries).filter((e) => e?.$axf === USAGE_SCHEMA && (!since || str(e.at) >= since));
  const t = { jobs: rows.length, messages: 0, batch: 0, errors: 0, cacheHits: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, fullUsd: 0, cacheSaved: 0, batchSaved: 0, unpriced: 0 };
  for (const e of rows) {
    t[e.path === 'batch' ? 'batch' : 'messages'] += 1;
    if (e.error) t.errors += 1;
    if (e.cacheHit) t.cacheHits += 1;
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) t[k] += num(e[k]);
    if (e.usd == null) { if (!e.error) t.unpriced += 1; continue; }
    for (const k of ['usd', 'fullUsd', 'cacheSaved', 'batchSaved']) t[k] += Number(e[k]) || 0;
  }
  for (const k of ['usd', 'fullUsd', 'cacheSaved', 'batchSaved']) t[k] = r6(t[k]);
  const allIn = t.input + t.cacheRead + t.cacheWrite;
  t.cacheHitRate = rows.length ? Math.round((t.cacheHits / rows.length) * 1000) / 1000 : 0;
  t.cacheReadShare = allIn ? Math.round((t.cacheRead / allIn) * 1000) / 1000 : 0;
  t.saved = r6(t.cacheSaved + t.batchSaved);
  return t;
}

/** Plain lines for the CLI / voice: "3 jobs (2 batch) · $0.0123 · saved $0.0200 (cache $0.0080, batch $0.0120) · cache hits 2/3". */
export function usageLine(t) {
  const d = (v) => `$${(Number(v) || 0).toFixed(4)}`;
  return `${t.jobs} job${t.jobs === 1 ? '' : 's'} (${t.batch} batch, ${t.messages} direct) · ${d(t.usd)} · saved ${d(t.saved)} (cache ${d(t.cacheSaved)}, batch ${d(t.batchSaved)}) · cache hits ${t.cacheHits}/${t.jobs}${t.errors ? ` · ${t.errors} failed` : ''}`;
}
