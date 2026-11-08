#!/usr/bin/env node
/**
 * What a session loads at start (memory-load@1). CLAUDE.md is tiny; this prints the rest a session needs to begin:
 *
 *   1. the builds the orchestrator says were started in the last 24 h and stopped unfinished (not built or complete,
 *      and not still running: no store update in the last 30 min), each with its next step, branch, PR and the memory
 *      chunks that mention it;
 *   2. how to reach everything else: the chunk index (`_claude/chunks/INDEX.md`, one line per chunk), and whether the
 *      chunks are behind their sources.
 *
 * Builds data belongs to the orchestrator (the builds store), not to Claude memory: this only reads it.
 *
 *   node framework/cli/memory-load.mjs [--hours 24] [--json]
 *
 * The project SessionStart hook (.claude/settings.json) runs it. AXF_ROOT / AXF_BUILDS_STORE point elsewhere (tests).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStoreNow } from './builds-store.mjs';
import { CHUNKS_REL, diff, find, readIndex, root } from './memory-chunks.mjs';

const FINISHED = new Set(['built', 'complete', 'archived']);
export const STALE_MS = 30 * 60 * 1000; // a running build with no store write for this long has stopped

const ms = (t) => { const n = Date.parse(t || ''); return Number.isFinite(n) ? n : NaN; };

/** When a build started: its first finished step, else (once it left pending) its last update, else never. */
export function startedAt(b) {
  const done = (b.steps || []).map((s) => ms(s.doneAt)).filter(Number.isFinite);
  if (done.length) return Math.min(...done);
  if (b.status && b.status !== 'pending') return ms(b.updatedAt);
  if (b.branch) return ms(b.updatedAt);
  return NaN;
}

/** Builds started within `hours` of `now` that stopped unfinished, newest first. */
export function recentUnfinished(store, { now = Date.now(), hours = 24 } = {}) {
  const since = now - hours * 3600 * 1000;
  const out = [];
  for (const b of store?.builds || []) {
    if (b.deleted || b.hidden || FINISHED.has(b.status)) continue;
    const at = startedAt(b);
    if (!Number.isFinite(at) || at < since) continue;
    const last = ms(b.updatedAt);
    if (b.status === 'running' && Number.isFinite(last) && now - last < STALE_MS) continue; // still going
    const steps = b.steps || [];
    const next = steps.find((s) => !s.done && !s.skip);
    out.push({
      id: b.id, title: b.title, status: b.status, startedAt: new Date(at).toISOString(), updatedAt: b.updatedAt || '',
      done: steps.filter((s) => s.done).length, total: steps.length,
      next: next ? { id: next.id, model: next.model, text: next.title || next.text } : null,
      branch: b.branch || '', pr: b.pr || '',
    });
  }
  return out.sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
}

export function load({ hours = 24, now = Date.now(), dir = root(), store } = {}) {
  let s = store;
  if (!s) { try { s = readStoreNow(); } catch { s = { builds: [] }; } }
  const builds = recentUnfinished(s, { now, hours }).map((b) => ({ ...b, chunks: find(b.id, dir).slice(0, 4).map((c) => c.id) }));
  const idx = readIndex(dir);
  let current = null;
  try { current = diff(dir).current; } catch { /* no sources */ }
  return { $axf: 'memory-load@1', hours, builds, index: idx ? { file: `${CHUNKS_REL}/INDEX.md`, count: idx.count, sources: idx.sources.length } : null, current };
}

export function text(r) {
  const L = ['## Session start (memory-load@1)', ''];
  if (r.builds.length) {
    L.push(`Builds started in the last ${r.hours} h that stopped unfinished (from the orchestrator):`);
    for (const b of r.builds) {
      L.push(`- \`${b.id}\` ${b.title} — ${b.status}, ${b.done}/${b.total} steps${b.next ? `, next ${b.next.id} [${b.next.model}] ${b.next.text.slice(0, 100)}` : ''}${b.branch ? `, branch \`${b.branch}\`` : ''}${b.pr ? `, PR ${b.pr}` : ''}`);
      if (b.chunks.length) L.push(`  memory: ${b.chunks.map((c) => `\`${c}\``).join(', ')}`);
    }
  } else L.push(`No build started in the last ${r.hours} h stopped unfinished.`);
  L.push('');
  if (r.index) L.push(`Memory: ${r.index.count} chunks from ${r.index.sources} files, one line each in \`${r.index.file}\`. Grep it (or \`node framework/cli/memory-chunks.mjs find <text>\`) and read only the chunks you need: \`_claude/chunks/<id>.md\`.`);
  else L.push('Memory: the chunk store is missing; run `node framework/cli/memory-chunks.mjs build`.');
  if (r.current === false) L.push('The chunks are behind their sources: `node framework/cli/memory-chunks.mjs build` (then commit) refreshes them.');
  return `${L.join('\n')}\n`;
}

function main(argv) {
  const i = argv.indexOf('--hours');
  const hours = i >= 0 ? Math.max(1, Number(argv[i + 1]) || 24) : 24;
  const r = load({ hours });
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(r)}\n` : text(r));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
