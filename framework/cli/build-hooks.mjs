#!/usr/bin/env node
/**
 * build-hooks — the IO side of framework/core/build-hook.mjs (build-hook@1).
 *
 * Every builds store write (builds-store.mjs saveStore) calls `emitChanges`: the changes become build events, which
 * are appended to the outbox (<dir>/events.jsonl, one event per line) and handed to every listener right away in a
 * detached `build-hooks.mjs deliver`, so the writer never waits on a listener.
 *
 * Listeners are plugins: plugin.json → "buildHooks": "<module relative to the plugin folder>" whose default export
 * (or `onBuildEvents`) takes an array of build-event@1 and may be async. Each listener has a cursor (the count of
 * outbox lines it has taken), so a listener that was down catches up on its next delivery, and listeners must be
 * idempotent on event id (replays happen).
 *
 *   node framework/cli/build-hooks.mjs deliver            hand new events to every listener
 *   node framework/cli/build-hooks.mjs listeners          who listens
 *   node framework/cli/build-hooks.mjs tail [n]           last n events
 *   node framework/cli/build-hooks.mjs replay [--to <listener>]   rebuild every event from the builds journal and deliver it (backfill)
 *
 * Env: AXF_BUILD_HOOKS_DIR (outbox, default <repo>/.axf-console/build-hooks), AXF_BUILD_HOOKS=off (no outbox, no
 * delivery; a scratch AXF_BUILDS_STORE is off unless AXF_BUILD_HOOKS=on), AXF_BUILD_HOOKS_SYNC=1 (deliver in-process instead of detached).
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eventsFromChange, eventsFromJournal, normEvent } from '../core/build-hook.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PLUGINS = join(REPO_ROOT, 'apps/console-web/plugins');
export const hooksDir = () => process.env.AXF_BUILD_HOOKS_DIR || join(REPO_ROOT, '.axf-console', 'build-hooks');
const outbox = () => join(hooksDir(), 'events.jsonl');
const cursors = () => join(hooksDir(), 'cursors.json');
const lockDir = () => join(hooksDir(), 'deliver.lock');
/** A delivery older than this holds no lock any more (a killed process). */
export const LOCK_STALE_MS = 10 * 60 * 1000;
/** One delivery at a time per outbox (mkdir is atomic); false when another one runs. A stale lock is taken over. */
export function takeLock(stale = LOCK_STALE_MS) {
  mkdirSync(hooksDir(), { recursive: true });
  try { mkdirSync(lockDir()); writeFileSync(join(lockDir(), 'pid'), `${process.pid}\n`); return true; } catch { /* held */ }
  try { if (Date.now() - statSync(lockDir()).mtimeMs >= stale) { rmSync(lockDir(), { recursive: true, force: true }); return takeLock(stale); } } catch { /* gone meanwhile */ }
  return false;
}
export const dropLock = () => { try { rmSync(lockDir(), { recursive: true, force: true }); } catch { /* already gone */ } };
// a scratch store (AXF_BUILDS_STORE, the store's own tests) fires nothing unless AXF_BUILD_HOOKS=on
const off = () => process.env.AXF_BUILD_HOOKS === 'off' || (!!process.env.AXF_BUILDS_STORE && process.env.AXF_BUILD_HOOKS !== 'on');

let listenerCache = null;
/** Plugins that declare "buildHooks" in plugin.json: [{ name, module }]. */
export function listeners() {
  if (listenerCache) return listenerCache;
  const out = [];
  let dirs = []; try { dirs = readdirSync(PLUGINS, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch { /* no plugins */ }
  for (const d of dirs.sort()) {
    try { const j = JSON.parse(readFileSync(join(PLUGINS, d, 'plugin.json'), 'utf8')); if (typeof j.buildHooks === 'string' && j.buildHooks) out.push({ name: d, module: join(PLUGINS, d, j.buildHooks) }); } catch { /* not a plugin */ }
  }
  listenerCache = out; return out;
}

export function readOutbox() {
  try { return readFileSync(outbox(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return normEvent(JSON.parse(l)); } catch { return null; } }); } catch { return []; }
}
const readCursors = () => { try { return JSON.parse(readFileSync(cursors(), 'utf8')); } catch { return {}; } };
const writeCursors = (c) => { mkdirSync(hooksDir(), { recursive: true }); writeFileSync(cursors(), `${JSON.stringify(c, null, 1)}\n`); };

/** Append events to the outbox (`dir`: another checkout's outbox, e.g. the console's). Returns the events written. */
export function appendEvents(events, { dir = '' } = {}) {
  const ev = events.map(normEvent).filter(Boolean); if (!ev.length || off()) return ev;
  const d = dir || hooksDir();
  mkdirSync(d, { recursive: true });
  appendFileSync(join(d, 'events.jsonl'), ev.map((e) => `${JSON.stringify(e)}\n`).join(''));
  return ev;
}
/** A builds store change list → events in another checkout's outbox (its own listeners deliver them). */
export function emitChangesTo(dir, changes, { at = '', by = 'builds-live' } = {}) {
  if (off() || !dir) return [];
  try { return appendEvents(changes.flatMap((c) => eventsFromChange(c, { at, by })), { dir }); } catch { return []; }
}

/** Called by saveStore with diffStores' changes: append the events, then deliver without blocking the writer. */
export function emitChanges(changes, { at = '', by = 'cli' } = {}) {
  if (off()) return [];
  let ev = [];
  try { ev = appendEvents(changes.flatMap((c) => eventsFromChange(c, { at, by }))); } catch { return []; }
  if (ev.length && listeners().length) {
    if (process.env.AXF_BUILD_HOOKS_SYNC === '1') { deliver().catch(() => {}); }
    else { try { spawn(process.execPath, [fileURLToPath(import.meta.url), 'deliver'], { cwd: REPO_ROOT, detached: true, stdio: 'ignore', env: { ...process.env, AXF_BUILD_HOOKS_SYNC: '' } }).unref(); } catch { /* the next delivery catches up */ } }
  }
  return ev;
}

/**
 * Hand every listener the events after its cursor. A listener that throws keeps its cursor and gets them again.
 * One delivery runs at a time per outbox (the lock); events appended while it runs are taken in the next round, so
 * a second writer's detached `deliver` may find the lock held and leave: nothing is lost.
 *   only:   one listener name
 *   events: deliver these instead of the outbox (replay; cursors untouched)
 *   to:     the listeners (default: every plugin.json with `buildHooks`)
 *   rounds: how many times to look for new outbox lines after a round (default 20)
 */
export async function deliver({ only = '', events = null, to = null, rounds = 20 } = {}) {
  if (!takeLock()) return { locked: true };
  const report = {};
  try {
    const ls = (to || listeners()).filter((l) => !only || l.name === only);
    for (let round = 0; round < Math.max(1, rounds); round += 1) {
      const all = events || readOutbox(); const cur = readCursors(); let delivered = 0;
      for (const l of ls) {
        const from = events ? 0 : (Number(cur[l.name]) || 0); const batch = all.slice(from).filter(Boolean);
        if (!batch.length) { report[l.name] ??= 0; continue; }
        try {
          const m = await import(pathToFileURL(l.module).href); const fn = m.onBuildEvents || m.default;
          if (typeof fn !== 'function') throw new Error(`${l.module} exports no onBuildEvents`);
          await fn(batch);
          if (!events) cur[l.name] = all.length;
          report[l.name] = (typeof report[l.name] === 'number' ? report[l.name] : 0) + batch.length; delivered += batch.length;
        } catch (e) { report[l.name] = `error: ${e.message}`; }
      }
      if (!events) writeCursors(cur);
      if (events || !delivered || readOutbox().length === all.length) break;
    }
  } finally { dropLock(); }
  return report;
}

/** Every event since the store began, rebuilt from the builds journal (_claude/builds/journal/*.jsonl). */
export function journalEvents(dir = join(REPO_ROOT, '_claude/builds/journal')) {
  const lines = [];
  let files = []; try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return []; }
  for (const f of files) for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) { if (!l.trim()) continue; try { lines.push(JSON.parse(l)); } catch { /* torn line */ } }
  lines.sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0) || String(a.at).localeCompare(String(b.at)));
  return eventsFromJournal(lines);
}

async function main(argv) {
  const [cmd = 'deliver', ...rest] = argv;
  if (cmd === 'deliver') {
    // another delivery may hold the lock for a moment: try again a few times so a write's events don't wait for the next write
    let r = { locked: true };
    for (let i = 0; i < 5 && r.locked; i += 1) { if (i) await new Promise((ok) => setTimeout(ok, 1500)); r = await deliver({ only: rest[0] || '' }); }
    console.log(JSON.stringify(r)); return 0;
  }
  if (cmd === 'listeners') { for (const l of listeners()) console.log(`${l.name}\t${l.module.slice(REPO_ROOT.length + 1)}`); return 0; }
  if (cmd === 'tail') { const n = Number(rest[0]) || 20; for (const e of readOutbox().slice(-n)) console.log(`${e.at}  ${e.event.padEnd(11)} ${e.build.id}${e.steps.length ? ` (${e.steps.length} step${e.steps.length > 1 ? 's' : ''})` : ''}`); return 0; }
  if (cmd === 'replay') { const i = rest.indexOf('--to'); const ev = journalEvents(); console.log(`${ev.length} events from the journal`); console.log(JSON.stringify(await deliver({ only: i >= 0 ? rest[i + 1] : '', events: ev }))); return 0; }
  console.error('usage: build-hooks.mjs deliver [listener] | listeners | tail [n] | replay [--to <listener>]'); return 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
