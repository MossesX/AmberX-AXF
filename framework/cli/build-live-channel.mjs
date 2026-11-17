#!/usr/bin/env node
/**
 * build-live-channel — the IO side of build-live@1 (framework/core/engines/build-live.mjs, spec/BUILD-LIVE.md).
 *
 * The console live channel on disk: <root>/.axf-console/build-live/
 *   events.jsonl   every build-live-event@1, one per line, newest last (trimmed to the last LIVE_RING frames)
 *   state.json     build-live-snapshot@1 of the fold (+ lastTick: the 15-second pass's heartbeat summary)
 *   lock/          one writer at a time (mkdir is atomic; a stale lock is taken over)
 *
 * The console's build-orchestrator server tails events.jsonl and pushes each new line on its SSE stream
 * (GET /api/plugins/build-orchestrator/live/stream) and answers GET …/live from state.json, so the UI never polls.
 * Writers:
 *   - every builds store write (builds-store.mjs saveStore → publishChanges): status, step, note, branch, PR, …
 *   - the console's copy of main taking a worktree's write (builds-live.mjs toConsole → publishChanges to its root)
 *   - the 15-second liveness pass (recovery-watchdog.mjs liveness → publish with livenessEvent)
 *   - the recovery watchdog when it acts (watchdogEvent)
 * A checkout without .axf-console (a build worktree) publishes nothing: its writes reach the console through builds-live.
 *
 *   node framework/cli/build-live-channel.mjs state [--json]       the snapshot
 *   node framework/cli/build-live-channel.mjs tail [n]             the last n events
 *   node framework/cli/build-live-channel.mjs resync               a snapshot event per build (clients re-read)
 *
 * Env: AXF_BUILD_LIVE_DIR (the channel folder; tests), AXF_BUILD_LIVE=off (publish nothing).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EVERY_SEC, LIVE_RING, changeEvent, emptyState, fold, snapshot, snapshotEvent } from '../core/engines/build-live.mjs';
import { eventsFromChange } from '../core/build-hook.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const LIVE_REL = '.axf-console/build-live';
export const channelDir = (root = '') => process.env.AXF_BUILD_LIVE_DIR || join(root || REPO_ROOT, LIVE_REL);
// a scratch store (AXF_BUILDS_STORE / a scratch AXF_DATA_DIR: tests) publishes nothing unless it names its own channel
const scratch = () => !process.env.AXF_BUILD_LIVE_DIR && (!!process.env.AXF_BUILDS_STORE || (!!process.env.AXF_DATA_DIR && process.env.AXF_DATA_DIR !== 'off'));
const off = () => process.env.AXF_BUILD_LIVE === 'off' || scratch();
/** A channel exists where the console runs: its .axf-console folder (or an explicit AXF_BUILD_LIVE_DIR). */
export const channelOn = (root = '') => !off() && (!!process.env.AXF_BUILD_LIVE_DIR || existsSync(join(root || REPO_ROOT, '.axf-console')));

const LOCK_STALE_MS = 30_000;
function lock(dir) {
  mkdirSync(dir, { recursive: true });
  const l = join(dir, 'lock');
  for (let i = 0; i < 200; i += 1) {
    try { mkdirSync(l); return () => { try { rmSync(l, { recursive: true, force: true }); } catch { /* gone */ } }; } catch { /* held */ }
    try { if (Date.now() - Math.floor(statSync(l).mtimeMs) > LOCK_STALE_MS) { rmSync(l, { recursive: true, force: true }); continue; } } catch { /* gone meanwhile */ }
    const until = Date.now() + 25; while (Date.now() < until) { /* short spin: writers hold the lock for a few ms */ }
  }
  return null;
}

/** The channel's state document (build-live-snapshot@1 + lastTick); an empty one when none yet. */
export function readState(root = '') {
  try {
    const j = JSON.parse(readFileSync(join(channelDir(root), 'state.json'), 'utf8'));
    if (j?.$axf === 'build-live-snapshot@1' && Array.isArray(j.builds)) return j;
  } catch { /* none yet */ }
  return { ...snapshot([], { at: new Date().toISOString(), seq: 0 }), lastTick: null };
}
function writeState(dir, doc) {
  const f = join(dir, 'state.json'); const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`); renameSync(tmp, f);
}
function trim(dir) {
  const f = join(dir, 'events.jsonl');
  try {
    if (statSync(f).size < 600_000) return;
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= LIVE_RING) return;
    const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${lines.slice(-LIVE_RING).join('\n')}\n`); renameSync(tmp, f);
  } catch { /* nothing to trim */ }
}

/** Listeners called after every publish with { published, changed, transitions, state } (the broke alert). */
const afterPublish = new Set();
export const onPublish = (fn) => { afterPublish.add(fn); return () => afterPublish.delete(fn); };

/**
 * Publish events: `makers` are functions (seq) → build-live-event@1 | null, called under the lock with the next seq,
 * folded into state.json and appended to events.jsonl. `tick` (the liveness pass) is stored as state.lastTick.
 * Returns { published: events, changed: [build ids whose row changed], transitions: [{ build, from, to, state, seq }], state }.
 */
export function publish(makers, { root = '', tick = null, everySec = 0 } = {}) {
  if (!channelOn(root)) return { published: [], changed: [], state: null, off: true };
  const dir = channelDir(root);
  const unlock = lock(dir);
  if (!unlock) return { published: [], changed: [], state: null, locked: true };
  try {
    const doc = readState(root);
    const states = new Map(doc.builds.map((s) => [s.build, s]));
    let seq = doc.seq || 0;
    const out = []; const changed = []; const transitions = [];
    for (const make of makers) {
      let ev = null; try { ev = make(seq + 1); } catch { ev = null; }
      if (!ev) continue;
      const prev = states.get(ev.build) ?? emptyState(ev.build);
      const r = fold(prev, ev);
      if (r.dropped) continue;
      seq = ev.seq; states.set(ev.build, r.state); out.push(ev);
      if (r.changed) changed.push(ev.build);
      if (prev.state !== r.state.state) transitions.push({ build: ev.build, from: prev.state, to: r.state.state, state: r.state, seq: ev.seq });
    }
    const next = { ...snapshot(states, { at: new Date().toISOString(), seq, everySec: everySec || doc.everySec || DEFAULT_EVERY_SEC }), lastTick: tick ?? doc.lastTick ?? null };
    // the liveness pass's heartbeat summary rides on the channel too (build-live-tick@1, no seq: never replayed)
    const lines = [...out, ...(tick ? [{ ...tick, $axf: 'build-live-tick@1', seq: 0 }] : [])];
    if (lines.length) appendFileSync(join(dir, 'events.jsonl'), lines.map((e) => `${JSON.stringify(e)}\n`).join(''));
    writeState(dir, next);
    trim(dir);
    const res = { published: out, changed, transitions, state: next };
    for (const fn of afterPublish) { try { fn(res, { root }); } catch { /* a listener never fails a publish */ } }
    return res;
  } finally { unlock(); }
}

/** Which build-hook@1 event a store change is ('' for a write the hook has no name for: a note, a branch, a field). */
export function changeKind(change, { at = '', by = '' } = {}) {
  try { return eventsFromChange(change, { at, by })[0]?.event ?? ''; } catch { return ''; }
}

/** builds store changes (diffStores / adoptedChanges: { id, op, before, after }) → one `change` event per build. */
export function publishChanges(changes, { at = '', by = 'cli', root = '' } = {}) {
  if (!Array.isArray(changes) || !changes.length || !channelOn(root)) return { published: [], changed: [] };
  const when = at || new Date().toISOString();
  const makers = changes.filter((c) => c?.after && c.after.id).map((c) => (seq) => changeEvent(c.after.deleted ? { ...c.after, status: 'archived' } : c.after, { event: changeKind(c, { at: when, by }), at: when, by }, { seq }));
  try { return publish(makers, { root }); } catch { return { published: [], changed: [] }; }
}

/** One snapshot event per build (a resync for clients that missed frames). */
export function resync({ root = '' } = {}) {
  const doc = readState(root);
  return publish(doc.builds.map((s) => (seq) => snapshotEvent(s, { seq, at: new Date().toISOString(), everySec: doc.everySec })), { root });
}

/** The last n events. */
export function tail(n = 50, { root = '' } = {}) {
  try { return readFileSync(join(channelDir(root), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; }
}

async function main(argv) {
  const [cmd = 'state', ...rest] = argv;
  const json = rest.includes('--json');
  if (cmd === 'state') { const s = readState(); if (json) console.log(JSON.stringify(s)); else { for (const b of s.builds) console.log(b.line || `${b.build} · ${b.state}`); console.log(`seq ${s.seq} · last tick ${s.lastTick?.at || 'never'}`); } return 0; }
  if (cmd === 'tail') { for (const e of tail(Number(rest[0]) || 20)) console.log(JSON.stringify(e)); return 0; }
  if (cmd === 'resync') { const r = resync(); console.log(json ? JSON.stringify({ ok: true, published: r.published.length }) : `${r.published.length} snapshot event(s)`); return 0; }
  console.error('usage: build-live-channel.mjs state [--json] | tail [n] | resync'); return 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
