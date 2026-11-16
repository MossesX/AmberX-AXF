#!/usr/bin/env node
/**
 * merge-watch@1 runner: every merge to main goes to Shipped features as a shipped-manifest@1, once per merge sha.
 * Brett, Nov 15 2026: "the VPS has to send shipped features as soon as a merge to main succeeds since it now controls
 * the orchestrator". Contract: framework/core/merge-watch.mjs; doc: _claude/memory/docs/merge-watch.md.
 *
 *   node framework/cli/merge-watch.mjs tick [--dry] [--no-fetch] [--json]      fetch origin/main, take the new landings
 *                                                                              since the last sha, send what is due
 *   node framework/cli/merge-watch.mjs status [--json]                          counts, last sha, pending / failed, where
 *   node framework/cli/merge-watch.mjs send <sha> [--force] [--dry] [--json]    send one merge now (--force: again)
 *   node framework/cli/merge-watch.mjs backfill --since <date> [--dry] [--json] every landing since the date that has
 *                                                                              no manifest yet; also starts the watch
 *   node framework/cli/merge-watch.mjs retry [<sha>…] [--json]                  failed merges back to pending, sent now
 *   node framework/cli/merge-watch.mjs on | off [--json]                        the watch's switch (off: tick does nothing)
 *   node framework/cli/merge-watch.mjs list [--state pending|sent|failed|skipped] [--since <date>] [--json]
 *
 * One tick at a time: a lock file next to the state (tick.lock; stale after 15 min or when its process is gone).
 * Data: framework/cli/merge-watch-files.mjs (AXF_MERGE_WATCH_DIR, AXF_DATA_DIR, the hub, the repo).
 * Env: AXF_MERGE_WATCH_DATA (data folder), AXF_MERGE_WATCH_REPO (checkout), AXF_MERGE_WATCH_REF (origin/main), AXF_MERGE_WATCH_SEND (local,api), AXF_MERGE_WATCH_ALERTS=off,
 *      AXF_MERGE_WATCH_FETCH=off. Exit 0 ok, 1 failure, 2 bad input, 3 locked (another tick runs).
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MW from '../core/merge-watch.mjs';
import { loadStore, readOrigins } from './builds-store.mjs';
import { mergeWatchDir, readState, whereIs, writeState } from './merge-watch-files.mjs';
import { readMemo, retryAll, syncAlert } from './merge-watch/retry.mjs';
import { sendDue, sendOne } from './merge-watch/send.mjs';
import { gitRoot, mainLines, runGit } from './merge-watch/walk.mjs';

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const LOCK_STALE_MS = 15 * 60e3;

// ------------------------------------------------------------------ switch, lock, log

const settingsFile = (env) => join(mergeWatchDir(env), 'settings.json');
export const readSettings = (env = process.env) => { try { return { enabled: true, ...JSON.parse(readFileSync(settingsFile(env), 'utf8')) }; } catch { return { enabled: true }; } };
export function writeSettings(patch, env = process.env) {
  const f = settingsFile(env); mkdirSync(dirname(f), { recursive: true });
  const next = { ...readSettings(env), ...patch, updatedAt: nowIso() }; const t = `${f}.tmp-${process.pid}`;
  writeFileSync(t, `${JSON.stringify(next, null, 1)}\n`); renameSync(t, f); return next;
}

const lockFile = (env) => join(mergeWatchDir(env), 'tick.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function takeLock(env = process.env) {
  const f = lockFile(env); mkdirSync(dirname(f), { recursive: true });
  for (let i = 0; i < 2; i += 1) {
    try { const fd = openSync(f, 'wx'); writeFileSync(fd, JSON.stringify({ pid: process.pid, at: nowIso() })); closeSync(fd); return () => { try { rmSync(f, { force: true }); } catch { /* gone */ } }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = {}; try { held = JSON.parse(readFileSync(f, 'utf8')); } catch { /* torn: treat as stale */ }
      const old = Date.now() - (statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0) > LOCK_STALE_MS;
      if (!old && held.pid && alive(held.pid)) return null;
      rmSync(f, { force: true });
    }
  }
  return null;
}

const logLine = (o, env) => { try { const f = join(mergeWatchDir(env), 'log.jsonl'); mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, `${JSON.stringify({ at: nowIso(), ...o })}\n`); } catch { /* best effort */ } };

// ------------------------------------------------------------------ the pieces every command shares

function ctxOf(env, now, dry = false) {
  return { store: loadStore(), origins: readOrigins(), env, now, dry };
}

function fetchMain(env, ref) {
  if (env.AXF_MERGE_WATCH_FETCH === 'off') return;
  const [remote, ...rest] = ref.split('/');
  if (remote !== 'origin' || !rest.length) return;
  try { runGit(['fetch', '-q', 'origin', `+refs/heads/${rest.join('/')}:refs/remotes/${ref}`], { cwd: gitRoot(env) }); } catch (e) { logLine({ event: 'fetch-failed', error: e.message.slice(0, 300) }, env); }
}

const tipOf = (ref) => { const out = runGit(['log', '-1', '--format=%H%x1f%cI', ref]).trim().split('\x1f'); return { sha: out[0], at: out[1] }; };

/** New landings since lastSeen (or since `since`) into the state; side lines first so lastSeen ends at main's tip. */
export function takeLandings(state, { ref, since = '', now, env = process.env } = {}) {
  const lines = mainLines({ ref, since, stop: since ? '' : state.lastSeen.sha });
  let st = state; const added = []; const folded = [];
  for (const line of [...lines.slice(1).reverse(), lines[0]].filter(Boolean)) {
    const r = MW.advance(st, line.commits, { now }); st = r.state; added.push(...r.added); folded.push(...r.folded);
  }
  if (lines[0]?.commits.length) { const t = lines[0].commits[0]; st = { ...st, lastSeen: { sha: t.sha, at: MW.normEntry({ sha: t.sha, at: t.at })?.at || '', checkedAt: now } }; }
  else st = { ...st, lastSeen: { ...st.lastSeen, checkedAt: now } };
  logLine({ event: 'walk', added: added.length, folded: folded.length }, env);
  return { state: MW.normState(st, { now }), added, folded };
}

const startAtTip = (ref, now) => MW.startState({ ref, from: tipOf(ref), now });

// ------------------------------------------------------------------ commands

export async function tick({ env = process.env, now = nowIso(), dry = false, fetch = true } = {}) {
  if (!readSettings(env).enabled) return { ok: true, off: true, results: [] };
  const unlock = takeLock(env); if (!unlock) return { ok: false, locked: true, results: [] };
  try {
    const ref = env.AXF_MERGE_WATCH_REF || MW.DEFAULT_REF;
    if (fetch) fetchMain(env, ref);
    let state = readState(env); const fresh = !state;
    if (!state) state = startAtTip(ref, now);
    const took = fresh ? { state, added: [], folded: [] } : takeLandings(state, { ref, now, env });
    const sent = await sendDue(took.state, ctxOf(env, now, dry));
    let st = MW.prune(sent.state, { now });
    if (!dry) { writeState(st, env); const a = syncAlert(st, { env, now }); if (a.action !== 'none') logLine({ event: `alert-${a.action}`, failing: a.failing.length }, env); }
    for (const r of sent.results) if (r.status !== 'skipped' || r.why !== 'already sent') logLine({ event: r.status, sha: r.sha, build: r.build || r.id, pr: r.pr, via: r.via, why: r.why, error: r.error }, env);
    return { ok: true, started: fresh, added: took.added.length, folded: took.folded.length, results: sent.results, summary: MW.summaryOf(st, now) };
  } finally { unlock(); }
}

export function status({ env = process.env, now = nowIso() } = {}) {
  const st = readState(env);
  return { ok: true, enabled: readSettings(env).enabled, where: whereIs(env), summary: st ? MW.summaryOf(st, now) : null, alert: readMemo(env) };
}

/** The landing a sha belongs to: an entry already in the state, else the sha classified on its own. */
function entryFor(state, sha, now) {
  const full = runGit(['rev-parse', '--verify', `${sha}^{commit}`]).trim();
  if (state?.entries[full]) return state.entries[full];
  const out = runGit(['log', '-1', `--format=%H%x1f%P%x1f%cI%x1f%s`, full]).trim().split('\x1f');
  return MW.landingsOf([{ sha: out[0], parents: out[1].split(' ').filter(Boolean), at: out[2], subject: out[3] }], { now }).find((e) => e.sha === full) ?? null;
}

export async function sendSha(sha, { env = process.env, now = nowIso(), dry = false, force = false } = {}) {
  const unlock = takeLock(env); if (!unlock) return { ok: false, locked: true };
  try {
    let st = readState(env) || startAtTip(env.AXF_MERGE_WATCH_REF || MW.DEFAULT_REF, now);
    const e = entryFor(st, sha, now); if (!e) throw Object.assign(new Error(`${sha}: not a landing (a status-only or revert commit)`), { code: 2 });
    if (force && st.entries[e.sha]) st = MW.reset(st, e.sha, now);
    const r = await sendOne(st, force ? { ...e, state: 'pending' } : e, ctxOf(env, now, dry));
    if (!dry) { writeState(r.state, env); syncAlert(r.state, { env, now }); logLine({ event: r.result.status, sha: e.sha, by: 'send', error: r.result.error }, env); }
    return { ok: r.result.status !== 'failed', result: r.result };
  } finally { unlock(); }
}

export async function backfill({ since, env = process.env, now = nowIso(), dry = false } = {}) {
  const from = MW.normEntry({ sha: '0'.repeat(40), at: since })?.at || ''; if (!from) throw Object.assign(new Error('backfill needs --since <YYYY-MM-DD>'), { code: 2 });
  const unlock = takeLock(env); if (!unlock) return { ok: false, locked: true };
  try {
    const ref = env.AXF_MERGE_WATCH_REF || MW.DEFAULT_REF;
    if (!dry) fetchMain(env, ref);
    const base = readState(env) || MW.startState({ ref, now });
    const took = takeLandings(base, { ref, since: from, now, env });
    // a landing that the state had already settled (sent / skipped) is left alone; the new ones go out oldest first
    const want = Object.values(took.state.entries).filter((e) => e.at >= from && (e.state === 'pending' || e.state === 'failed')).sort((a, b) => (a.at < b.at ? -1 : 1));
    let st = took.state; const results = []; const ctx = ctxOf(env, now, dry);
    for (const e of want) { const r = await sendOne(st, { ...e, nextRetryAt: '' }, ctx); st = r.state; results.push(r.result); }
    if (!dry) { writeState(MW.prune(st, { now }), env); syncAlert(st, { env, now }); logLine({ event: 'backfill', since: from, sent: results.filter((r) => r.status === 'sent').length, failed: results.filter((r) => r.status === 'failed').length }, env); }
    return { ok: !results.some((r) => r.status === 'failed'), since: from, dry, landings: want.length, results, summary: MW.summaryOf(st, now) };
  } finally { unlock(); }
}

export async function retry({ shas = [], env = process.env, now = nowIso() } = {}) {
  const unlock = takeLock(env); if (!unlock) return { ok: false, locked: true };
  try {
    const st0 = readState(env); if (!st0) return { ok: true, reset: [], results: [] };
    const { state, reset } = retryAll(st0, now, { only: shas });
    const sent = await sendDue(state, { ...ctxOf(env, now), max: 100 });
    writeState(sent.state, env); syncAlert(sent.state, { env, now });
    logLine({ event: 'retry', reset: reset.length, sent: sent.results.filter((r) => r.status === 'sent').length }, env);
    return { ok: !sent.results.some((r) => r.status === 'failed'), reset, results: sent.results, summary: MW.summaryOf(sent.state, now) };
  } finally { unlock(); }
}

export function list({ state: want = '', since = '', env = process.env } = {}) {
  const st = readState(env); if (!st) return { ok: true, entries: [] };
  const es = Object.values(st.entries).filter((e) => (!want || e.state === want) && (!since || e.at >= since)).sort((a, b) => (a.at < b.at ? 1 : -1));
  return { ok: true, entries: es.map((e) => ({ sha: e.sha, at: e.at, kind: e.kind, pr: e.pr, build: MW.buildIdOf(e), state: e.state, reason: e.reason, attempts: e.attempts, nextRetryAt: e.nextRetryAt, error: e.error, manifest: e.manifest, subject: e.subject })) };
}

// ------------------------------------------------------------------ CLI

const line = (r) => `${{ sent: '✓', skipped: '·', dry: '○', failed: '✗' }[r.status] || '?'} ${r.sha.slice(0, 9)} ${r.build || r.id || ''}${r.pr ? ` #${r.pr}` : ''}${r.why ? ` (${r.why})` : ''}${r.error ? `: ${r.error}` : ''}`;

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? true : null; };
  const has = (n) => args.includes(`--${n}`);
  const out = (o, text) => { console.log(json ? JSON.stringify(o) : text); if (o.locked) process.exitCode = 3; else if (o.ok === false) process.exitCode = 1; };
  const [cmd = 'status', ...rest] = args;
  const VALUED = new Set(['--since', '--state']);
  const pos = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]));
  if (cmd === 'tick') { const r = await tick({ dry: has('dry'), fetch: !has('no-fetch') }); return out(r, r.off ? 'merge watch is off' : r.locked ? 'another tick is running' : `${r.started ? 'started at main\'s tip; ' : ''}${r.added} new landing(s)${r.results.length ? `\n${r.results.map(line).join('\n')}` : ''}`); }
  if (cmd === 'status') {
    const r = status(); const s = r.summary;
    return out(r, s ? `merge watch ${r.enabled ? 'on' : 'off'} · ${r.where.file} (${r.where.via})\nlast sha ${s.lastSeen.sha.slice(0, 9)} at ${s.lastSeen.at} · checked ${s.lastSeen.checkedAt}\nsent ${s.counts.sent} · pending ${s.counts.pending} · failed ${s.counts.failed} · skipped ${s.counts.skipped} · last sent ${s.lastSent || 'never'}${s.failed.length ? `\n${s.failed.map((f) => `✗ ${f.sha.slice(0, 9)} ${f.build} ${f.attempts} tries${f.gaveUp ? ' (gave up)' : ''}: ${f.error}`).join('\n')}` : ''}` : `merge watch ${r.enabled ? 'on' : 'off'}: no state yet (${r.where.file}); run tick or backfill --since <date>`);
  }
  if (cmd === 'send') { if (!pos[0]) throw Object.assign(new Error('send <sha>'), { code: 2 }); const r = await sendSha(pos[0], { dry: has('dry'), force: has('force') }); return out(r, r.locked ? 'another tick is running' : line(r.result)); }
  if (cmd === 'backfill') { const r = await backfill({ since: typeof flag('since') === 'string' ? flag('since') : '', dry: has('dry') }); return out(r, r.locked ? 'another tick is running' : `${r.dry ? 'dry run: ' : ''}${r.landings} landing(s) since ${r.since}\n${r.results.map(line).join('\n')}`); }
  if (cmd === 'retry') { const r = await retry({ shas: pos }); return out(r, r.locked ? 'another tick is running' : `${r.reset.length} reset\n${r.results.map(line).join('\n')}`); }
  if (cmd === 'on' || cmd === 'off') { const s = writeSettings({ enabled: cmd === 'on' }); return out({ ok: true, enabled: s.enabled }, `merge watch ${cmd}`); }
  if (cmd === 'list') { const r = list({ state: typeof flag('state') === 'string' ? flag('state') : '', since: typeof flag('since') === 'string' ? flag('since') : '' }); return out(r, r.entries.map((e) => `${e.at.slice(0, 16)} ${e.state.padEnd(8)} ${e.sha.slice(0, 9)} ${e.build}${e.pr ? ` #${e.pr}` : ''}`).join('\n') || 'nothing yet'); }
  throw Object.assign(new Error('usage: merge-watch.mjs tick|status|send <sha>|backfill --since <date>|retry|on|off|list (see the header)'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = e.code === 2 ? 2 : 1;
  });
}

