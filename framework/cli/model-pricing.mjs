/**
 * model-pricing — one place for token prices (framework/schemas/model-pricing.json, model-pricing@1), shared by the
 * session check-in baseline, the Codebase changes hooks (actual cost from a Claude Code transcript) and the Build
 * manager (estimates). Pure helpers + a tolerant loader; no network.
 *
 *   modelKey('claude-opus-5-5') → 'opus'      costUsd('opus', {input, output, cacheRead, cacheWrite}) → USD
 *   estimateCost('opus', minutes)  → USD from the documented per-minute heuristic
 *   transcriptUsage(text, {since}) → token totals of a Claude Code transcript (JSONL), each message counted once
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRICING_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'model-pricing.json');
const FALLBACK = { models: {}, heuristic: { tokensPerMinute: { input: 5000, output: 3000, cacheRead: 300000, cacheWrite: 0 } } };

export function loadPricing(file = process.env.AXF_PRICING_FILE || PRICING_FILE) {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' && j.models ? j : FALLBACK; } catch { return FALLBACK; }
}

/** 'claude-opus-5-5', 'Opus', 'opus[1m]' → 'opus'; unknown → '' (no price). */
export function modelKey(m) {
  const s = String(m ?? '').toLowerCase();
  for (const k of ['fable', 'opus', 'sonnet', 'haiku']) if (s.includes(k)) return k;
  return '';
}

const r4 = (x) => Math.round(x * 10000) / 10000;

/** USD for token counts on a model, or null when the model has no price. */
export function costUsd(model, t, pricing = loadPricing()) {
  const p = pricing.models?.[modelKey(model)];
  if (!p || p.input == null || p.output == null) return null;
  const v = ((t.input ?? 0) * p.input + (t.output ?? 0) * p.output + (t.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (t.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) / 1e6;
  return r4(v);
}

/** Estimated USD for `minutes` of build work on `model` (documented heuristic in the pricing file). */
export function estimateCost(model, minutes, pricing = loadPricing()) {
  if (!Number.isFinite(minutes) || minutes <= 0) return minutes === 0 ? 0 : null;
  const per = pricing.heuristic?.tokensPerMinute ?? FALLBACK.heuristic.tokensPerMinute;
  const one = costUsd(model, per, pricing);
  return one == null ? null : r4(one * minutes);
}

/**
 * Token totals from a Claude Code transcript (one JSON object per line). Assistant messages carry message.usage
 * {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens} and message.model; a streamed
 * message appears on several lines with the same message.id, so each id is counted once (its last usage wins).
 * `since` (ISO or ms) counts only lines at or after it. Returns {input, output, cacheRead, cacheWrite, model, messages}.
 */
export function transcriptUsage(text, { since } = {}) {
  const from = since == null ? -Infinity : typeof since === 'number' ? since : Date.parse(since);
  const byId = new Map();
  let anon = 0, model = '';
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const msg = j?.message;
    const u = msg?.usage;
    if (!u || typeof u !== 'object') continue;
    const at = Date.parse(j.timestamp ?? '');
    if (Number.isFinite(at) && at < from) continue;
    if (msg.model && msg.model !== '<synthetic>') model = msg.model;
    byId.set(msg.id ?? `anon-${anon++}`, {
      input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0,
      cacheRead: Number(u.cache_read_input_tokens) || 0, cacheWrite: Number(u.cache_creation_input_tokens) || 0,
    });
  }
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const v of byId.values()) for (const k of Object.keys(t)) t[k] += v[k];
  return { ...t, model, messages: byId.size };
}

export const pricingPath = () => join('framework', 'schemas', 'model-pricing.json');
