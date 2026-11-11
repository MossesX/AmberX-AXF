#!/usr/bin/env node
/**
 * One JSON request in, one JSON answer out (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli,
 * s4). The console server (REST and MCP) and `axf ctl` call the registry through this, so every surface answers from the
 * same index, the same dispatcher and the same planner:
 *
 *   echo '{"op":"list","filter":{"owner":"console-web","type":"page"}}' | node apps/console-web/lib/registry/rpc.mjs
 *
 * ops: list {filter} · get {id} · search {q, limit, type, owner} · export · stats · owners · gaps {what, owner}
 *      state {id, params} · invoke {id, action, params, confirm, reason, by, answer?} · resolve {input, answer?, …}
 * `invoke` and `resolve` answer the resolution plus `plan` (what to run: execute.mjs). When the AI fallback is open and
 * no model answered yet, the answer carries `brief`: the caller asks its model and sends the reply back as `answer`;
 * the reply is resolved again like any command (the registry decides, the model only proposes).
 * `available` (true/false) overrides the Claude-available setting for one call (tests). No AI runs here.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiFallbackBrief, getEntry } from '../../../../framework/core/engines/control-registry.mjs';
import { dispatch } from './dispatch.mjs';
import { planResolution, planState, providerIds } from './execute.mjs';
import { ControlRegistry } from './index.mjs';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (v === undefined || v === null ? '' : String(v));

/** The registry for this process (the index file, or a fresh build when there is none or `fresh`). */
let reg = null;
export function registry({ fresh = false } = {}) { if (!reg || fresh) reg = ControlRegistry.load({ prefer: fresh ? 'build' : 'file' }); return reg; }
export const useRegistry = (r) => { reg = r; };

/** A brief summary of an entry for lists. */
export const summary = (e) => ({ id: e.id, type: e.type, owner: e.owner, label: e.label, actions: e.actions.map((a) => a.id), ...(e.open?.target ? { open: e.open } : {}), ...(e.needsAI ? { needsAI: true } : {}), ...(e.gaps?.length ? { gaps: e.gaps.length } : {}) });

function resolution(r, input, req) {
  const opts = { confirm: str(req.confirm), reason: str(req.reason), by: str(req.by) || 'registry' };
  const answer = isObj(req.answer) ? req.answer : null;
  const res = dispatch(r.index, input, { ask: answer ? () => answer : null, ...(typeof req.available === 'boolean' ? { available: req.available } : {}) });
  const out = { ...res, plan: planResolution(res, opts) };
  if (!res.ok && res.ai?.fallback && !res.ai.asked) out.brief = aiFallbackBrief(r.index, input, res);
  return out;
}

/** Handle one request. → a JSON-able answer (always has `ok`). */
export function handle(req) {
  if (!isObj(req) || typeof req.op !== 'string') return { ok: false, code: 'validation', message: 'send { "op": … }' };
  const r = registry({ fresh: req.fresh === true });
  switch (req.op) {
    case 'list': {
      const f = isObj(req.filter) ? req.filter : {};
      const l = r.list({ owner: str(f.owner), type: str(f.type), tag: str(f.tag), surface: str(f.surface), plugin: str(f.plugin), q: str(f.q), limit: Number(f.limit) || 50, offset: Number(f.offset) || 0, ...(f.needsAI !== undefined && f.needsAI !== '' ? { needsAI: f.needsAI === true || f.needsAI === 'true' } : {}) });
      return { ok: true, total: l.total, items: (f.full ? l.items : l.items.map(summary)), hash: r.hash };
    }
    case 'get': { const e = r.get(str(req.id)); return e ? { ok: true, entry: e, text: r.describe(e.id) } : { ok: false, code: 'not_found', message: `no registry entry "${str(req.id)}"`, candidates: r.search(str(req.id).replace(/[/._:-]/g, ' '), { limit: 6 }).map((h) => summary(h.entry)) }; }
    case 'search': { const hits = r.search(str(req.q), { limit: Number(req.limit) || 20, type: str(req.type), owner: str(req.owner) }); return { ok: true, items: hits.map((h) => ({ ...summary(h.entry), score: h.score })) }; }
    case 'export': return { ok: true, index: { ...r.index, exportedAt: new Date().toISOString() } };
    case 'stats': return { ok: true, ...r.stats(), providers: providerIds() };
    case 'owners': return { ok: true, owners: r.owners() };
    case 'gaps': return { ok: true, gaps: r.gaps({ what: str(req.what), owner: str(req.owner) }) };
    case 'state': {
      const s = planState(r.index, str(req.id), isObj(req.params) ? req.params : {}, { by: str(req.by) || 'registry' });
      return s ? { ok: true, ...s } : { ok: false, code: 'not_found', message: `no registry entry "${str(req.id)}"` };
    }
    case 'invoke': {
      if (!getEntry(r.index, str(req.id))) return { ok: false, code: 'not_found', message: `no registry entry "${str(req.id)}"`, plan: { via: 'none', why: 'not resolved' } };
      return resolution(r, { id: str(req.id), action: str(req.action) || undefined, params: isObj(req.params) ? req.params : {} }, req);
    }
    case 'resolve': {
      const input = typeof req.input === 'string' || Array.isArray(req.input) || isObj(req.input) ? req.input : str(req.phrase);
      if (!input || (Array.isArray(input) && !input.length)) return { ok: false, code: 'validation', message: 'send input: a phrase, a CLI argv array or { id, action, params }' };
      return resolution(r, input, req);
    }
    default: return { ok: false, code: 'validation', message: `unknown op "${req.op}" (list, get, search, export, stats, owners, gaps, state, invoke, resolve)` };
  }
}

export async function main() {
  let req;
  try { req = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch (e) { process.stdout.write(`${JSON.stringify({ ok: false, code: 'validation', message: `bad JSON: ${e.message}` })}\n`); return 2; }
  const out = handle(req);
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
