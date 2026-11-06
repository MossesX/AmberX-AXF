#!/usr/bin/env node
// claude-meter.mjs — live cost meter and context chain for a headless Claude Code session (headless-tabs, Nov 3 2026).
// Fed by deploy/claude-stream.mjs with every `--output-format stream-json --verbose` event; writes two small files the
// console's Terminal reads over ssh (paths are kept as tmux user options @axf_meter / @axf_chain on the session):
//   <session>.meter.json   headless-meter@1  agent, model, status, cost (USD), tokens, turns, chain length
//   <session>.chain.json   context-chain@1   every file the session takes in, in order: the CLAUDE.md load chain Claude
//                          Code uses (user memory, project memory from the outermost folder in, @imports, .claude/rules),
//                          then each file it Reads; each Markdown file carries its rules (headings and list items).
//                          It is a tree (terminal-drag-chain-tree, Nov 3 2026): each item names the item that pulled it
//                          in (`parentI`) and why (`reason`): session-start (Claude Code loads it), import (@path),
//                          reference (a loaded file mentions its path and the session then Read it), session-start rule
//                          (that mention says to read it first / on every load), read (nothing mentions it), nested memory
// Cost = per assistant message (counted once per message id, last usage wins) × the model's price in
// framework/schemas/model-pricing.json (no prices in code); a `result` event's total_cost_usd replaces the estimate for
// that run, so the final value matches what Claude Code reports. Several runs (account switches) add up.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { costUsd, loadPricing, modelKey } from '../framework/cli/model-pricing.mjs';
import { importsOf, listDir, memoryChain, readText } from '../framework/core/memory-chain.mjs';

export { importsOf, memoryChain };

const MAX_RULES = 400;          // per file
const MAX_RULE_CHARS = 600;
const MAX_ITEMS = 600;

/** Rules of a Markdown text: headings and list items in order (code blocks skipped). Pure. */
export function rulesOf(text) {
  const out = [];
  let fence = false;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || !line.trim()) continue;
    let m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m) { out.push({ kind: 'heading', level: m[1].length, text: clip(m[2]) }); }
    else if ((m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line))) { out.push({ kind: 'item', level: Math.floor(m[1].replace(/\t/g, '  ').length / 2), text: clip(m[2]) }); }
    if (out.length >= MAX_RULES) break;
  }
  return out;
}
const clip = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > MAX_RULE_CHARS ? `${t.slice(0, MAX_RULE_CHARS - 1)}…` : t; };

/** Path-like mentions in a Markdown text (`code`, [links](x), bare a/b.md), each with the line it sits on. Pure. */
export function mentionsOf(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const found = new Set();
    for (const m of line.matchAll(/`([^`\s]+)`|\]\(([^)\s#]+)[^)]*\)|(?:^|[\s(@"'])((?:~\/|\.{1,2}\/|\/)?[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)+\.[A-Za-z0-9]{1,8})(?=$|[\s),.;:!?"'])/g)) {
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/^@/, '');
      if (!/[\/.]/.test(raw) || !/\.[A-Za-z0-9]{1,8}$/.test(raw) || /^[a-z]+:\/\//i.test(raw) || found.has(raw)) continue;
      found.add(raw); out.push({ path: raw, line: clip(line).slice(0, 240) });
    }
  }
  return out;
}
/** Does the line that mentions a file say to read it at the start (first, on load, every session…)? Pure. */
export const startRule = (line) => /\b(on (every |each )?(load|start)|first|before (doing )?anything( else)?|every session|session ?start|at (the )?start)\b/i.test(String(line ?? ''));
/** Absolute paths a mention may mean: against the file's folder, the session's folder, home (`~/`). Pure. */
export function mentionTargets(mention, file, cwd, home = homedir()) {
  const p = mention.path;
  if (p.startsWith('~/')) return [join(home, p.slice(2))];
  if (isAbsolute(p)) return [p];
  return [...new Set([resolve(dirname(file), p), resolve(cwd, p)])];
}

/** A live meter for one session. `add(ev)` takes each stream-json event; `snapshot()` / `chain()` give the files' JSON. */
export function createMeter({ session = '', name = '', agent = '', model = '', cwd = process.cwd(), home = homedir(), pricing = loadPricing(), now = () => Date.now(), read = readText, list = listDir, prev = null, prevChain = null, lean = process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS === '1' } = {}) {
  const t0 = now();
  const base = prev && prev.session === session ? prev : null;
  const st = {
    startedAt: base?.startedAt ?? new Date(t0).toISOString(), model: model || base?.model || '', status: 'starting', lastEventAt: t0,
    baseCost: base ? Number(base.costUsd) || 0 : 0, baseTokens: base?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    baseTurns: base?.turns ?? 0, baseTools: base?.tools ?? 0, runs: (base?.runs ?? 0) + 1,
    reported: 0, msgs: new Map(), turns: 0, tools: 0, pendingTools: new Set(), result: null, reportedTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, unpriced: false,
  };
  const items = Array.isArray(prevChain?.items) && prevChain.session === session ? prevChain.items.slice(0, MAX_ITEMS) : [];
  const have = new Set(items.map((i) => i.path));
  const byPath = new Map(items.map((it) => [it.path, it]));
  const rel = (p) => { const r = relative(cwd, p); return r && !r.startsWith('..') ? r : p.startsWith(home) ? `~/${relative(home, p)}` : p; };
  // what each Markdown item mentions: target path → the line (kept in memory only; rebuilt from disk after a resume)
  const mentions = new Map();
  const mentionsFor = (it) => {
    if (!mentions.has(it.i)) {
      const text = /\.(md|mdx|markdown)$/i.test(it.path) ? read(it.path) : null; const exact = new Map(); const raw = mentionsOf(text);
      for (const x of raw) for (const t of mentionTargets(x, it.path, cwd, home)) if (!exact.has(t)) exact.set(t, x.line);
      mentions.set(it.i, { exact, raw });
    }
    return mentions.get(it.i);
  };
  /** The latest loaded file that mentions `path` (its full path first, else a partial one such as memory/decisions.md), with the line, or null. */
  const referrer = (path) => {
    for (let k = items.length - 1; k >= 0; k--) { const it = items[k]; if (it.path === path) continue; const line = mentionsFor(it).exact.get(path); if (line != null) return { it, line }; }
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k]; if (it.path === path) continue;
      const hit = mentionsFor(it).raw.find((x) => x.path.includes('/') && path.endsWith(`/${x.path.replace(/^\.?\//, '')}`));
      if (hit) return { it, line: hit.line };
    }
    return null;
  };
  const push = (path, via, depth = 0, parent = '', reason = via, why = '') => {
    if (have.has(path) || items.length >= MAX_ITEMS) return false;
    have.add(path);
    const md = /\.(md|mdx|markdown)$/i.test(path);
    const text = md ? read(path) : null;
    const up = parent ? byPath.get(parent) : null;
    const it = { i: items.length, path, rel: rel(path), via, reason, depth, parent: parent ? rel(parent) : '', parentI: up ? up.i : -1, ...(why ? { why } : {}), at: new Date(now()).toISOString(), rules: text != null ? rulesOf(text) : [] };
    items.push(it); byPath.set(path, it);
    return true;
  };
  /** A file the session Reads: under the latest loaded file that mentions it (reference / session-start rule), else on its own. */
  const pushRead = (path) => {
    if (have.has(path)) return false;
    const r = referrer(path);
    if (!r) return push(path, 'read', 0, '', 'read');
    return push(path, 'read', Math.min((r.it.depth ?? 0) + 1, 24), r.it.path, startRule(r.line) ? 'session-start rule' : 'reference', r.line);
  };
  let chainVersion = 0;
  if (!items.length && !lean) { for (const m of memoryChain(cwd, { home, read, list })) push(m.path, m.via, m.depth, m.parent, m.reason); chainVersion++; }

  /** A file read inside a folder may bring in that folder's CLAUDE.md (Claude Code loads nested memory on demand). */
  const lazyMemory = (file) => {
    if (lean) return false;
    const root = resolve(cwd); let added = false;
    const dirs = []; for (let d = dirname(file); d.startsWith(root) && d !== root; d = dirname(d)) dirs.unshift(d);
    for (const d of dirs) for (const f of ['CLAUDE.md', join('.claude', 'CLAUDE.md')]) { const p = join(d, f); if (!have.has(p) && read(p) != null) added = push(p, 'nested memory', 0, '', 'nested memory') || added; }
    return added;
  };

  function add(ev) {
    if (!ev || typeof ev !== 'object') return;
    st.lastEventAt = now();
    if (ev.type === 'system' && ev.subtype === 'init') { if (ev.model) st.model = ev.model; st.status = 'working'; return; }
    if (ev.type === 'assistant') {
      st.status = 'working';
      const msg = ev.message ?? {};
      const id = msg.id || `anon-${st.msgs.size}`;
      if (msg.usage) st.msgs.set(id, { model: msg.model || st.model, usage: msg.usage });
      for (const b of msg.content ?? []) {
        if (b.type !== 'tool_use') continue;
        st.tools++; if (b.id) st.pendingTools.add(b.id);
        const fp = b.input?.file_path ?? b.input?.notebook_path;
        if ((b.name === 'Read' || b.name === 'NotebookRead') && typeof fp === 'string' && isAbsolute(fp)) {
          const a = lazyMemory(fp); const r = pushRead(resolve(fp)); if (a || r) chainVersion++;
        }
      }
      return;
    }
    if (ev.type === 'user') { for (const b of ev.message?.content ?? []) if (b.type === 'tool_result' && b.tool_use_id) st.pendingTools.delete(b.tool_use_id); st.turns++; return; }
    if (ev.type === 'result') {
      const tok = runTokens();
      if (typeof ev.total_cost_usd === 'number') { st.reported += ev.total_cost_usd; } else { st.reported += runEstimate(); }
      for (const k of Object.keys(tok)) st.reportedTokens[k] += tok[k];
      st.msgs.clear(); st.pendingTools.clear();
      st.result = { subtype: ev.subtype ?? '', isError: !!ev.is_error, durationMs: ev.duration_ms ?? null, numTurns: ev.num_turns ?? null, costUsd: ev.total_cost_usd ?? null };
      st.status = ev.is_error || (ev.subtype && ev.subtype !== 'success') ? 'failed' : 'done';
    }
  }
  const usageTokens = (u) => ({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
  function runTokens() { const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; for (const m of st.msgs.values()) { const u = usageTokens(m.usage); for (const k of Object.keys(t)) t[k] += u[k]; } return t; }
  function runEstimate() {
    let v = 0;
    for (const m of st.msgs.values()) { const c = costUsd(m.model, usageTokens(m.usage), pricing); if (c == null) st.unpriced = true; else v += c; }
    return v;
  }
  /** The stream ended (claude exited). No result event = it failed. */
  function end(exit = null) {
    if (st.status !== 'done' && st.status !== 'failed') { st.reported += runEstimate(); st.msgs.clear(); st.status = exit === 0 && st.result ? 'done' : 'failed'; }
    st.pendingTools.clear(); st.ended = true; st.exit = exit;
  }
  const r4 = (x) => Math.round(x * 10000) / 10000;
  function snapshot() {
    const est = runEstimate(); const run = runTokens();
    const tokens = {}; for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) tokens[k] = (st.baseTokens[k] ?? 0) + st.reportedTokens[k] + run[k];
    return {
      $axf: 'headless-meter@1', session, name, agent: agent || name, model: st.model, modelKey: modelKey(st.model), cwd,
      startedAt: st.startedAt, updatedAt: new Date(now()).toISOString(), lastEventAt: new Date(st.lastEventAt).toISOString(),
      status: st.status, toolRunning: st.pendingTools.size > 0, ended: !!st.ended, exit: st.exit ?? null,
      costUsd: r4(st.baseCost + st.reported + est), estimatedUsd: r4(est), costEstimated: est > 0, priced: !st.unpriced && !!modelKey(st.model),
      tokens, turns: st.baseTurns + st.turns, tools: st.baseTools + st.tools, runs: st.runs, result: st.result,
      chainCount: items.length, chainVersion,
    };
  }
  const chain = () => ({ $axf: 'context-chain@1', session, cwd, version: chainVersion, items });
  return { add, end, snapshot, chain, get chainVersion() { return chainVersion; } };
}

/** Write JSON atomically (tmp + rename), never throwing: the meter must never stop the session. */
export function writeJson(file, value) {
  if (!file) return;
  try { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(value)}\n`); renameSync(tmp, file); } catch { /* disk full / folder gone: keep going */ }
}
export const readJson = (file) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; } };
