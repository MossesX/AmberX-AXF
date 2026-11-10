#!/usr/bin/env node
/**
 * The dispatcher (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, Nov 10 2026): a command
 * ({ id, action, params }), a CLI call (argv) or a phrase → one registry entry, one action and validated parameters,
 * deterministically (exact ids, aliases, synonyms, declared phrases, allowed values: core/engines/control-registry.mjs),
 * and only then, when nothing matched or the action needs a model, Claude as a fallback behind the gate
 * (ai-fallback.mjs: Claude settings' "Make Claude available to the console"). The model proposes, the registry decides:
 * whatever comes back is resolved again like any command, so an answer outside the allowed values is refused.
 *
 * The answer is a resolution, not an execution: `run` is the ref the surface calls (a plugin command, a control@1
 * command, a console open). REST (s4), MCP (s5) and `axf ctl` (s6) wrap this one function.
 *
 *   node apps/console-web/lib/registry/dispatch.mjs "open plan studio"              a phrase
 *   node apps/console-web/lib/registry/dispatch.mjs --cli follow-amber switch --on off   a CLI call
 *   node apps/console-web/lib/registry/dispatch.mjs --command '{"id":"plans","action":"open"}'
 *   [--json] [--fresh]       --fresh builds the index from the sources instead of reading the file
 * Exit codes: 0 resolved · 1 not resolved · 2 usage.
 */
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLVE_CODES, aiFallbackBrief, aiGate, getEntry, resolve, resolveCommand } from '../../../../framework/core/engines/control-registry.mjs';
import { aiAvailable, askClaude } from './ai-fallback.mjs';
import { ControlRegistry } from './index.mjs';

export { aiAvailable, askClaude };
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Resolve `input` against `index`, with the AI gate. opts: { env, ask, available } (available overrides the setting).
 * → the resolution plus `ai: { available, fallback, asked?, answer?, why }`.
 */
export function dispatch(index, input, opts = {}) {
  const avail = typeof opts.available === 'boolean' ? { available: opts.available, source: 'caller' } : aiAvailable({ env: opts.env ?? process.env });
  const first = resolve(index, input, { aiAvailable: avail.available });
  const gate = aiGate(first, { available: avail.available });
  const ai = { available: avail.available, source: avail.source, fallback: gate.fallback, why: gate.why };
  if (!gate.fallback) return { ...first, ai };
  // the action itself needs a model and the gate is open: it may run (the action is what asks the model)
  if (first.code === RESOLVE_CODES.NEEDS_AI) {
    const entry = getEntry(index, first.entry);
    const action = entry?.actions.find((a) => a.id === first.action);
    if (entry && action) return { ok: true, entry: entry.id, action: action.id, params: first.params, effect: action.effect, run: action.run, needsAI: true, ...(action.confirm ? { confirm: true } : {}), how: first.how ?? { kind: 'command' }, open: entry.open ?? null, ai };
    return { ...first, ai };
  }
  // nothing matched: ask, then resolve the answer like any command
  const brief = aiFallbackBrief(index, input, first);
  const answer = askClaude(brief, { ask: opts.ask });
  if (!isObj(answer) || answer.none !== undefined || !answer.id) return { ...first, ai: { ...ai, asked: typeof opts.ask === 'function', answer: isObj(answer) ? String(answer.none ?? 'no entry proposed') : 'no entry proposed' } };
  const second = resolveCommand(index, { id: answer.id, action: answer.action, params: isObj(answer.params) ? answer.params : {} }, { aiAvailable: avail.available });
  const how = { kind: 'ai', from: first.how?.kind ?? (Array.isArray(input) ? 'cli' : isObj(input) && input.phrase === undefined ? 'command' : 'phrase'), proposed: { id: answer.id, action: answer.action ?? '' } };
  return { ...second, how, ai: { ...ai, asked: true, ...(second.ok ? {} : { answer: 'the model proposed something the registry refused' }) }, ...(second.ok ? {} : { candidates: second.candidates ?? first.candidates ?? [], gap: first.gap }) };
}

/* ================================================================== CLI */

export async function main(argv) {
  const json = argv.includes('--json');
  const fresh = argv.includes('--fresh');
  const args = argv.filter((a) => a !== '--json' && a !== '--fresh');
  if (!args.length) { console.error('usage: dispatch.mjs "<phrase>" | --cli <words…> | --command <json>  [--json] [--fresh]'); return 2; }
  let input;
  if (args[0] === '--cli') input = args.slice(1);
  else if (args[0] === '--command') { try { input = JSON.parse(args[1] ?? ''); } catch { console.error('--command needs JSON like {"id":"plans","action":"open"}'); return 2; } }
  else input = args.join(' ');
  const reg = ControlRegistry.load({ prefer: fresh ? 'build' : 'file' });
  const r = dispatch(reg.index, input);
  if (json) { process.stdout.write(`${JSON.stringify(r)}\n`); return r.ok ? 0 : 1; }
  if (r.ok) {
    const e = reg.get(r.entry);
    process.stdout.write(`${e?.label ?? r.entry} · ${r.action}${Object.keys(r.params ?? {}).length ? ` ${JSON.stringify(r.params)}` : ''}\n  entry: ${r.entry}\n  runs:  ${r.run}  (${r.effect}${r.confirm ? ', needs a confirm token' : ''}${r.needsAI ? ', needs a model' : ''})\n${r.open?.target ? `  open:  console_open ${r.open.kind} ${r.open.target}${r.open.deepLink ? `  ·  ${r.open.deepLink}` : ''}\n` : ''}  how:   ${r.how?.kind}${r.how?.matched ? ` (phrase "${r.how.matched}")` : r.how?.verb !== undefined ? ` (verb "${r.how.verb}", name "${r.how.name}")` : ''}${r.ai.fallback ? `  ·  via Claude (${r.ai.why})` : ''}\n`);
    return 0;
  }
  const lines = [`${r.code}: ${r.message}`];
  if (r.errors?.length) lines.push(...r.errors.map((x) => `  ✗ ${x}`));
  if (r.candidates?.length) lines.push('  closest:', ...r.candidates.map((c) => `    ${c.id}  ${c.label}  [${(c.actions ?? []).join(', ')}]`));
  if (r.gap) lines.push(`  gap: ${r.gap.why}${r.gap.declare ? `\n       → ${r.gap.declare}` : ''}`);
  lines.push(`  claude: ${r.ai.available ? 'available' : 'not available'} (${r.ai.source}) · fallback ${r.ai.fallback ? (r.ai.asked ? `asked: ${r.ai.answer ?? 'answered'}` : 'open, no model attached here') : 'closed'} · ${r.ai.why}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 1;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
