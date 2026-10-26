#!/usr/bin/env node
// claude-stream.mjs — turns Claude Code's `--output-format stream-json --verbose` lines into readable terminal text
// (used by deploy/claude-headless.sh, so a headless session watched in the console's Terminal reads like a session).
// stdin: one JSON event per line; anything that isn't JSON is passed through unchanged. Never exits on a bad line.
import { createInterface } from 'node:readline';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const one = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** What a tool call is about, in a few words (command, file, pattern, url …). */
export function toolSummary(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  return pick != null ? one(pick, 140) : one(JSON.stringify(i), 140);
}

/** One event → lines to print ([] = nothing to show). Pure, so it can be tested. */
export function render(ev) {
  if (!ev || typeof ev !== 'object') return [];
  if (ev.type === 'system' && ev.subtype === 'init') return [dim(`# model ${ev.model ?? '?'} · ${ev.cwd ?? ''} · ${(ev.tools ?? []).length} tools`)];
  if (ev.type === 'assistant') {
    const out = [];
    for (const b of ev.message?.content ?? []) {
      if (b.type === 'text' && b.text?.trim()) out.push(b.text.trim());
      else if (b.type === 'thinking' && b.thinking?.trim()) out.push(dim(`(thinking) ${one(b.thinking, 200)}`));
      else if (b.type === 'tool_use') out.push(cyan(`▸ ${b.name}: ${toolSummary(b.name, b.input)}`));
    }
    return out;
  }
  if (ev.type === 'user') {
    const out = [];
    for (const b of ev.message?.content ?? []) {
      if (b.type !== 'tool_result') continue;
      const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join(' ') : String(b.content ?? '');
      const first = one(text.split('\n').find((l) => l.trim()) ?? '', 140);
      out.push(b.is_error ? red(`  ↳ error: ${first}`) : dim(`  ↳ ${first || 'done'}`));
    }
    return out;
  }
  if (ev.type === 'result') {
    const secs = ev.duration_ms ? `${Math.round(ev.duration_ms / 1000)} s` : '';
    const cost = typeof ev.total_cost_usd === 'number' ? `$${ev.total_cost_usd.toFixed(2)}` : '';
    const head = ev.is_error || ev.subtype !== 'success' ? red(`■ ${ev.subtype ?? 'ended'}`) : bold('■ done');
    return [head + dim(` · ${[secs, `${ev.num_turns ?? '?'} turns`, cost].filter(Boolean).join(' · ')}`), ...(ev.result ? [String(ev.result).trim()] : [])];
  }
  return [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let ev = null;
    try { ev = JSON.parse(line); } catch { process.stdout.write(`${line}\n`); return; }
    for (const l of render(ev)) process.stdout.write(`${l}\n`);
  });
}
