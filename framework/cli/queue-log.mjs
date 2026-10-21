#!/usr/bin/env node
/**
 * queue-log — the recorder for queue-log@1 (logic: framework/plan/queue-log-core.mjs).
 *
 * Every write to the pending list, the build queue or the plan goes through `logged(kind, doc, write)`: it first
 * catches anything changed outside the tools since the last look (axHub direct writes from claude.ai, git syncs,
 * hand edits: logged as source "outside"), then writes, then logs what this write changed with who, where, why and
 * the prompt behind it.
 *
 * Where: shared data, framework/plan/queue-log/ (on the hub: /projects/amberx-axf/_data/framework/plan/queue-log/):
 *   <YYYY>/<MM>/<YYYY-MM-DD>.json   {$axf: 'queue-log@1', day, batches: [...]}   one file per day (UTC), newest last
 *   state.json                      the last snapshot of each list (what the next diff compares against)
 *
 * Who / why come from (first wins): setLogContext() (engine-rpc sets op, by, reason from the request), the environment
 * AXF_QUEUE_BY, AXF_QUEUE_SURFACE, AXF_QUEUE_REASON, AXF_CHANGE_ID, then the Claude Code session's open Codebase
 * changes entry (AXF_CHANGES_HOME, default ~/.axf-changes: sessions/<CLAUDE_CODE_SESSION_ID>.json, else `last` when
 * fresh) whose `asked` is the prompt. Without any of it the batch still logs, as "unknown".
 *
 *   node framework/cli/queue-log.mjs                       last 30 events, newest first
 *   node framework/cli/queue-log.mjs --item lib-mcp        one item's whole history
 *   node framework/cli/queue-log.mjs --json [--days 90] [--kind queue] [--op moved] [--q text]
 *   node framework/cli/queue-log.mjs sweep                 log changes made outside the tools now
 *   node framework/cli/queue-log.mjs why <batch id> "<reason>"   add the why to a batch afterwards
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './persist.mjs';
import { LOG_KINDS, batchId, cleanMeta, describe, diff, filterEvents, flatten, hash, itemHistory, snapshotOf, summarize } from '../plan/queue-log-core.mjs';

export const LOG_REL = 'framework/plan/queue-log/';
export const FILES = { pending: 'framework/plan/pending.json', queue: 'framework/plan/build-queue.json', plan: 'framework/plan/plan.json' };
const logDir = () => process.env.AXF_QUEUE_LOG_DIR || dataPath(LOG_REL);
const statePath = () => join(logDir(), 'state.json');
const dayPath = (day) => join(logDir(), day.slice(0, 4), day.slice(5, 7), `${day}.json`);
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
function writeAtomic(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  renameSync(tmp, p);
}

/* ---------------- lock (two writers at once: the console and a CLI) ---------------- */

function withLock(fn) {
  const lock = join(logDir(), '.lock');
  mkdirSync(logDir(), { recursive: true });
  const until = Date.now() + 3000;
  for (;;) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 15_000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { /* gone */ }
      if (Date.now() > until) break; // never block a real write for the log: go on without the lock
      const t = Date.now() + 25; while (Date.now() < t) { /* spin briefly */ }
    }
  }
  try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* fine */ } }
}

/* ---------------- who / why ---------------- */

let ctx = {};
/** Set by engine-rpc (and the CLIs) before a write: {op, by, surface, reason, prompt, changeId}. */
export function setLogContext(c = {}) { ctx = { ...ctx, ...c }; }

function currentChange(env = process.env) {
  const home = env.AXF_CHANGES_HOME || join(homedir(), '.axf-changes');
  const sid = String(env.CLAUDE_CODE_SESSION_ID ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 36);
  if (sid) { const ids = readJson(join(home, 'sessions', `${sid}.json`), {}).ids; if (Array.isArray(ids) && ids.length) return { id: String(ids[ids.length - 1]), session: sid }; }
  try { const p = join(home, 'last'); if (Date.now() - statSync(p).mtimeMs < 3 * 3600_000) return { id: readFileSync(p, 'utf8').trim(), session: '' }; } catch { /* none */ }
  return null;
}
/** The prompt behind a change entry: its `asked` (already redacted by the change log). */
function promptOf(changeId) {
  const m = /^chg-(\d{4})(\d{2})\d{2}-[0-9a-f]+$/.exec(changeId ?? '');
  if (!m) return '';
  return String(readJson(dataPath(`changes/${m[1]}/${m[2]}/${changeId}.json`), {}).asked ?? '');
}
export function meta(env = process.env) {
  const cur = ctx.changeId || env.AXF_CHANGE_ID ? null : currentChange(env);
  const changeId = ctx.changeId || env.AXF_CHANGE_ID || cur?.id || '';
  let by = ctx.by || env.AXF_QUEUE_BY || '';
  if (!by) { try { by = env.CLAUDECODE ? 'Claude Code' : userInfo().username; } catch { by = 'unknown'; } }
  const surface = ctx.surface || env.AXF_QUEUE_SURFACE || (env.CLAUDE_CODE_REMOTE === 'true' ? 'claude-code-cloud' : env.CLAUDECODE ? 'claude-code' : 'cli');
  return cleanMeta({ by, surface, reason: ctx.reason || env.AXF_QUEUE_REASON || '', changeId, prompt: ctx.prompt || promptOf(changeId), op: ctx.op || '', session: cur?.session || '' });
}

/* ---------------- state + batches ---------------- */

function loadState() { const s = readJson(statePath(), null); return s && s.$axf === 'queue-log-state@1' ? s : { $axf: 'queue-log-state@1', snapshots: {}, hashes: {}, titles: {} }; }
function planTitles(planSnap) { return Object.fromEntries(Object.entries(planSnap?.items ?? {}).map(([id, f]) => [id, f.title])); }

function appendBatch(batch) {
  const day = batch.at.slice(0, 10);
  const p = dayPath(day);
  const doc = readJson(p, null) ?? { $axf: 'queue-log@1', day, batches: [] };
  doc.batches.push(batch);
  writeAtomic(p, doc);
}

/** Compare one list on disk with the last snapshot; log the difference as an outside change. Returns the batch or null. */
function sweepOne(st, kind, now) {
  const doc = readJson(dataPath(FILES[kind]), null);
  if (!doc) return null;
  const snap = snapshotOf(kind, doc), h = hash(snap);
  if (st.hashes[kind] === h) return null;
  const prev = st.snapshots[kind];
  if (kind === 'plan') st.titles = planTitles(snap);
  st.snapshots[kind] = snap; st.hashes[kind] = h;
  const events = diff(kind, prev, snap, st.titles);
  if (!prev || !events.length) return null; // first sighting = the baseline
  const b = { id: batchId(now, kind), at: now, source: 'outside', by: 'unknown', surface: 'outside', files: [FILES[kind]], op: 'changed outside the tools',
    reason: 'Changed without the console, CLI or MCP (an axHub direct write, a git sync or a hand edit): who and why are unknown', events };
  appendBatch(b);
  return b;
}

/** Log changes made outside the tools since the last look (every list, or the ones given). */
export function sweep(kinds = LOG_KINDS, now = new Date().toISOString()) {
  try {
    return withLock(() => { const st = loadState(); const out = kinds.map((k) => sweepOne(st, k, now)).filter(Boolean); writeAtomic(statePath(), st); return out; });
  } catch { return []; }
}

/**
 * Write one list and log what changed. `write()` does the real write; the log never stops it (a failing log is
 * reported on stderr and skipped).
 */
export function logged(kind, doc, write) {
  let st = null;
  try { st = withLock(() => { const s = loadState(); sweepOne(s, kind, new Date().toISOString()); writeAtomic(statePath(), s); return s; }); } catch { /* log is best effort */ }
  write();
  try {
    withLock(() => {
      const s = loadState();
      const now = new Date().toISOString();
      const snap = snapshotOf(kind, doc), prev = s.snapshots[kind] ?? st?.snapshots?.[kind];
      if (kind === 'plan') s.titles = planTitles(snap);
      const events = diff(kind, prev, snap, s.titles);
      s.snapshots[kind] = snap; s.hashes[kind] = hash(snap);
      if (events.length) appendBatch({ id: batchId(now, kind), at: now, source: 'tool', files: [FILES[kind]], ...meta(), events });
      writeAtomic(statePath(), s);
    });
  } catch (e) { process.stderr.write(`queue-log: not logged (${e.message})\n`); }
}

/* ---------------- reading ---------------- */

/** Batches from the last `days` days (newest day files first), optionally only since an ISO time. */
export function readBatches({ days = 30, since = '' } = {}) {
  const root = logDir();
  if (!existsSync(root)) return [];
  const cut = since || new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const files = [];
  for (const y of readdirSync(root).filter((d) => /^\d{4}$/.test(d))) for (const m of readdirSync(join(root, y)).filter((d) => /^\d{2}$/.test(d)))
    for (const f of readdirSync(join(root, y, m)).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) if (f.slice(0, 10) >= cut.slice(0, 10)) files.push(join(root, y, m, f));
  return files.sort().reverse().flatMap((p) => (readJson(p, {}).batches ?? []).slice().reverse()).filter((b) => !since || b.at >= since);
}

/** The browser's one call: filtered events, counts, and the item's history when an item is asked for. */
export function view(f = {}) {
  const batches = readBatches({ days: Math.min(Math.max(Number(f.days) || 30, 1), 3650) });
  const all = flatten(batches);
  const events = filterEvents(all, f);
  const limit = Math.min(Math.max(Number(f.limit) || 300, 1), 5000);
  return { $axf: 'queue-log@1', events: events.slice(0, limit), more: Math.max(0, events.length - limit), summary: summarize(events), totals: summarize(all),
    item: f.item ? itemHistory(all, f.item, f.kind) : undefined, days: f.days ?? 30 };
}

/** Add (or replace) the why on a batch after the fact. */
export function addReason(id, reason, by = 'console') {
  const m = /^q-(\d{4})(\d{2})(\d{2})\d*-[0-9a-f]+$/.exec(String(id ?? ''));
  if (!m) throw new Error(`"${id}" is not a batch id`);
  const text = cleanMeta({ reason }).reason;
  if (!text) throw new Error('reason is empty');
  return withLock(() => {
    const p = dayPath(`${m[1]}-${m[2]}-${m[3]}`);
    const doc = readJson(p, null);
    const b = doc?.batches?.find((x) => x.id === id);
    if (!b) throw new Error(`no batch ${id}`);
    b.reason = text; b.reasonBy = cleanMeta({ by }).by ?? 'console'; b.reasonAt = new Date().toISOString();
    writeAtomic(p, doc);
    return b;
  });
}

/* ---------------- CLI ---------------- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  if (cmd === 'sweep') { const b = sweep(); console.log(b.length ? b.map((x) => `${x.id}: ${x.events.length} outside change(s) in ${x.files.join(', ')}`).join('\n') : 'nothing changed outside the tools'); }
  else if (cmd === 'why') { const b = addReason(argv[1], argv.slice(2).join(' '), meta().by); console.log(`${b.id}: why = ${b.reason}`); }
  else {
    const f = { days: flag('days'), item: flag('item'), kinds: flag('kind') ? [flag('kind')] : [], ops: flag('op') ? [flag('op')] : [], q: flag('q'), limit: flag('limit') ?? (argv.includes('--json') ? 300 : 30) };
    sweep();
    const v = view(f);
    if (argv.includes('--json')) console.log(JSON.stringify(v, null, 1));
    else {
      for (const e of f.item ? v.item : v.events) console.log(`${e.at.slice(0, 16).replace('T', ' ')}  ${e.kind.padEnd(7)} ${describe(e)}  — ${e.by ?? '?'}${e.surface ? ` (${e.surface})` : ''}${e.reason ? ` · why: ${e.reason}` : ''}${e.changeId ? ` · ${e.changeId}` : ''}`);
      if (!v.events.length) console.log('No queue activity logged yet.');
    }
  }
}
