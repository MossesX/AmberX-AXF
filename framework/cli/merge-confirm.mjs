#!/usr/bin/env node
/**
 * merge-confirm@1 IO: read a PR back from GitHub and decide whether it is merged (spec: framework/spec/MERGE-CONFIRM.md,
 * state machine: framework/core/merge-confirm.mjs). Every merge path writes its record here and asks `isMerged` before it
 * reports a merge; a merge API 200 is a hint, never proof.
 *
 *   node framework/cli/merge-confirm.mjs confirm <repo> <pr> [--wait] [--path p] [--by who] [--build id] [--json]
 *        read the PR back now (and keep reading with backoff until merged / failed / the deadline with --wait);
 *        exit 0 merged, 3 not confirmed yet (pending / merge-unconfirmed), 4 merge-failed, 1 error
 *   … status <repo> <pr> [--json]       the stored record (no GitHub call)
 *   … list [--state <s>] [--json]       every stored record, newest first
 *   … request <repo> <pr> --path <p> [--by who] [--build id] [--url u] [--json]   a merge call is about to be made
 *   … called <repo> <pr> [--status N] [--merged] [--sha s] [--message m] [--none] [--json]  what the merge call answered
 *   … recheck <repo> <pr> [--by who] [--json]   merge-unconfirmed → pending again, read back now
 *   … tick [--json]                     the poller: read back every record that is due (backoff), time out the rest;
 *        answers { checked, merged, unconfirmed, failed, pending, alert } (the push banner runs it every round)
 *
 * Reads go through the token from framework/cli/github-token.mjs (never printed). Every GET is cached with its ETag
 * (a 304 costs no call against the shared 5000/h limit) and reads are held back below RESERVE calls left.
 * Evidence: GET /repos/<repo>/pulls/<pr> (state, merged, merged_at, merge_commit_sha), then
 * GET /repos/<repo>/compare/<merge_commit_sha>...<base> (ahead | identical = the merge commit is on main).
 *
 * Store: <dir>/records.json (merge-confirm-store@1, one record per PR) and <dir>/gh-cache.json; dir = AXF_MERGE_CONFIRM_DIR,
 * else <AXF_CONSOLE_ROOT, AXF_ROOT or /opt/axf>/.axf-console/merge-confirm. Framework data, shared by every merge path (plugins,
 * deploy scripts, builds-live), so it outlives any one plugin. Environment: AXF_MERGE_CONFIRM_API (https://api.github.com).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../core/merge-confirm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
export const STORE = 'merge-confirm-store@1';
export const RESERVE = 300;
const CACHE_MAX = 1000;
const RECORDS_MAX = 500;

export const storeDir = () => env('AXF_MERGE_CONFIRM_DIR', join(env('AXF_CONSOLE_ROOT', env('AXF_ROOT', '/opt/axf')), '.axf-console', 'merge-confirm'));
const nowIso = () => M.iso(new Date().toISOString());

// ------------------------------------------------------------------ store

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Every record in the store, keyed by id, each in shape. */
export function readStore(dir = storeDir()) {
  const raw = readJson(join(dir, 'records.json'), {}) || {};
  const out = {};
  for (const r of Object.values(raw.records || {})) { const n = M.normRecord(r); if (n) out[n.id] = n; }
  return out;
}
/** Read-modify-write under a lock file (the console container and host jobs share the folder). `fn(records)` mutates or returns a value. */
export function withStore(fn, dir = storeDir()) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, 'records.lock');
  let fd = null;
  for (let i = 0; i < 100 && fd === null; i++) {
    try { fd = openSync(lock, 'wx'); } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 30000) rmSync(lock, { force: true }); } catch { /* gone */ }
      sleepSync(50);
    }
  }
  if (fd === null) throw new Error(`merge-confirm store busy (${lock})`);
  try {
    const recs = readStore(dir);
    const out = fn(recs);
    const keep = Object.values(recs).sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || '')).slice(0, RECORDS_MAX);
    writeJson(join(dir, 'records.json'), { $axf: STORE, updatedAt: nowIso(), records: Object.fromEntries(keep.map((r) => [r.id, r])) });
    return out;
  } finally { closeSync(fd); rmSync(lock, { force: true }); }
}
export const getRecord = (repo, pr, dir = storeDir()) => readStore(dir)[M.recordId(repo, pr)] || null;
export const listRecords = ({ state = '' } = {}, dir = storeDir()) => Object.values(readStore(dir)).filter((r) => !state || r.state === state).sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
/** Store one record (in shape); returns it. */
export function putRecord(rec, dir = storeDir()) { const n = M.normRecord(rec); if (!n) return null; withStore((r) => { r[n.id] = n; }, dir); return n; }

// ------------------------------------------------------------------ GitHub (ETag cached, rate-limit reserve)

export function brokerToken() {
  if (process.env.AXF_MERGE_CONFIRM_TOKEN) return process.env.AXF_MERGE_CONFIRM_TOKEN; // tests and the console (injected, never logged)
  const r = spawnSync(process.execPath, [join(ROOT, 'framework/cli/github-token.mjs'), 'token'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

/** `gh(path)` → JSON; throws { status } on an HTTP error. GETs only: this module never writes to GitHub. */
export function makeGitHub({ dir = storeDir(), api = env('AXF_MERGE_CONFIRM_API', 'https://api.github.com'), token = brokerToken, fetchImpl = fetch } = {}) {
  let tok = null, cache = null, dirty = false, remaining = Infinity;
  const file = join(dir, 'gh-cache.json');
  const gh = async (path) => {
    tok ??= token() || '';
    if (!tok) throw Object.assign(new Error('no GitHub token (framework/cli/github-token.mjs token)'), { status: 401 });
    cache ??= readJson(file, {}) || {};
    const hit = cache[path];
    if (remaining < RESERVE) { if (hit) { gh.cached++; return hit.data; } throw Object.assign(new Error(`GitHub reads held back (${remaining} left, reserve ${RESERVE})`), { status: 429 }); }
    const r = await fetchImpl(`${api}${path}`, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'axf-merge-confirm', ...(hit?.etag ? { 'If-None-Match': hit.etag } : {}) }, signal: AbortSignal.timeout(20000) });
    const left = Number(r.headers.get('x-ratelimit-remaining'));
    if (r.headers.has('x-ratelimit-remaining') && Number.isFinite(left)) remaining = left;
    if (r.status === 304 && hit) { gh.cached++; hit.at = Date.now(); dirty = true; return hit.data; }
    gh.calls++;
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}: ${String(data?.message || text).slice(0, 200)}`), { status: r.status });
    const etag = r.headers.get('etag');
    if (etag) { cache[path] = { etag, data, at: Date.now() }; dirty = true; }
    return data;
  };
  gh.calls = 0; gh.cached = 0; gh.left = () => remaining;
  gh.save = () => {
    if (!dirty || !cache) return;
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) for (const k of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - CACHE_MAX)) delete cache[k];
    try { writeJson(file, cache); dirty = false; } catch { /* the cache is an optimisation only */ }
  };
  return gh;
}

const repoPath = (repo) => M.normRepo(repo).split('/').map(encodeURIComponent).join('/');

/**
 * Read the PR back: `{ prRead, mainRead }` in the shapes `evidence()` takes. A failed PR read is `{ error }`; the main read
 * runs only when GitHub names a merge commit (compare <sha>...<base>: ahead | identical = on main; 404 = not on main).
 */
export async function readBack(gh, repo, pr) {
  const r = M.normRepo(repo); const n = M.prNumber(pr);
  let prRead;
  try { prRead = await gh(`/repos/${repoPath(r)}/pulls/${n}`); } catch (e) { return { prRead: { error: { status: e.status || 0, message: e.message } }, mainRead: null }; }
  const sha = M.normSha(prRead?.merge_commit_sha);
  if (!(prRead?.merged === true || String(prRead?.state).toUpperCase() === 'MERGED') || !sha) return { prRead, mainRead: null };
  const base = String(prRead?.base?.ref || 'main');
  try {
    const c = await gh(`/repos/${repoPath(r)}/compare/${sha}...${encodeURIComponent(base)}`);
    return { prRead, mainRead: { status: String(c?.status || ''), sha: M.normSha(c?.commits?.at?.(-1)?.sha || '') || '' } };
  } catch (e) {
    return { prRead, mainRead: e.status === 404 ? { contains: false } : null };
  }
}

/** One read-back of `rec` at `at` (observe, then the deadline). Returns the new record; the caller stores it. */
export async function confirmOnce(rec, { gh, at = nowIso() } = {}) {
  const cur = M.normRecord(rec);
  if (!cur || cur.state === 'merged' || cur.state === 'merge-failed') return cur;
  const { prRead, mainRead } = await readBack(gh, cur.repo, cur.pr);
  const next = M.observe(cur, prRead, mainRead, at);
  return M.timeout(next, at) || next;
}

// ------------------------------------------------------------------ the flow every merge path runs

/** A merge call is about to be made (or, path reconcile, a merge was seen): write the record first. */
export function requestMerge({ repo, pr, path = 'script', by = '', build = '', url = '', at = nowIso(), call } = {}, dir = storeDir()) {
  return withStore((recs) => {
    const id = M.recordId(repo, pr);
    const rec = M.request({ repo, pr, path, by, build, url, at, call }, recs[id] || null);
    if (rec) recs[rec.id] = rec;
    return rec;
  }, dir);
}
/** What the merge call answered (`null` = no answer). The record goes to pending; nothing is merged from this. */
export function recordCall(repo, pr, call, { at = nowIso() } = {}, dir = storeDir()) {
  return withStore((recs) => {
    const id = M.recordId(repo, pr); if (!recs[id]) return null;
    recs[id] = M.called(recs[id], call, at);
    return recs[id];
  }, dir);
}
/** Recheck: merge-unconfirmed → pending, due now. */
export function recheckRecord(repo, pr, { by = '', at = nowIso() } = {}, dir = storeDir()) {
  return withStore((recs) => {
    const id = M.recordId(repo, pr); if (!recs[id]) return null;
    recs[id] = M.recheck(recs[id], at, by);
    return recs[id];
  }, dir);
}
/** Store a read-back result without losing a concurrent newer attempt (only the same attempt is replaced). */
function storeObserved(rec, dir) {
  return withStore((recs) => {
    const cur = recs[rec.id];
    if (cur && (cur.attempt !== rec.attempt || cur.rechecks !== rec.rechecks)) return cur;
    recs[rec.id] = rec; return rec;
  }, dir);
}

/**
 * Read `repo#pr` back now; with `wait`, keep reading on the backoff schedule until it is merged, failed or past its
 * deadline. A PR with no record gets one (path `path`, default `reconcile`: proving a merge seen elsewhere).
 */
export async function confirm(repo, pr, { wait = false, path = 'reconcile', by = '', build = '', gh = null, dir = storeDir(), now = nowIso, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const client = gh || makeGitHub({ dir });
  let rec = getRecord(repo, pr, dir);
  if (!rec || (rec.state === 'merge-failed' && path !== 'reconcile')) rec = requestMerge({ repo, pr, path, by, build, at: now() }, dir);
  if (!rec) throw new Error(`not a repo and PR: ${repo} ${pr}`);
  if (rec.state === 'merge-unconfirmed' && wait) rec = recheckRecord(repo, pr, { by: by || 'cli', at: now() }, dir) || rec;
  try {
    for (;;) {
      rec = storeObserved(await confirmOnce(rec, { gh: client, at: now() }), dir);
      if (!wait || M.isTerminal(rec.state)) return rec;
      const wake = Date.parse(rec.nextCheckAt || rec.deadlineAt) - Date.parse(now());
      await sleep(Math.max(1000, Math.min(Number.isFinite(wake) ? wake : M.nextDelayMs(rec.checks), 120000)));
    }
  } finally { client.save?.(); }
}

/**
 * The poller: every record that is due (merge-requested past the call timeout, pending at its nextCheckAt) is read back
 * once; anything past its deadline becomes merge-unconfirmed. `alert` lists the unconfirmed records (newest first) for
 * the one banner item; it is empty when there are none.
 */
export async function tick({ gh = null, dir = storeDir(), now = nowIso, max = 20 } = {}) {
  const at = now();
  const t = Date.parse(at);
  // merge-unconfirmed: one more read every TIMEOUT_S for a day, so a merge GitHub confirms late clears the alert by itself
  const late = (r) => r.state === 'merge-unconfirmed' && t - Date.parse(r.endedAt) < 86400000 && t - Date.parse(r.evidence?.readAt || r.endedAt) >= M.TIMEOUT_S * 1000;
  const due = listRecords({}, dir).filter((r) => M.due(r, at) || (!M.isTerminal(r.state) && Date.parse(r.deadlineAt) <= t) || late(r));
  const out = { at, checked: 0, merged: [], unconfirmed: [], failed: [], pending: 0, errors: [], alert: [] };
  const client = due.length ? (gh || makeGitHub({ dir })) : null;
  try {
    for (const r of due.slice(0, max)) {
      try {
        const next = storeObserved(await confirmOnce(r, { gh: client, at: now() }), dir);
        out.checked++;
        if (next.state !== r.state) (next.state === 'merged' ? out.merged : next.state === 'merge-failed' ? out.failed : next.state === 'merge-unconfirmed' ? out.unconfirmed : []).push(next.id);
      } catch (e) { out.errors.push({ id: r.id, error: String(e?.message || e).slice(0, 200) }); }
    }
  } finally { client?.save?.(); }
  const all = listRecords({}, dir);
  out.pending = all.filter((r) => r.state === 'pending-github-confirmation' || r.state === 'merge-requested').length;
  out.alert = all.filter((r) => r.state === 'merge-unconfirmed').map((r) => ({ id: r.id, repo: r.repo, pr: r.pr, url: r.url, path: r.path, why: r.why, since: r.endedAt }));
  return out;
}

// ------------------------------------------------------------------ CLI

const EXIT = { merged: 0, 'merge-failed': 4 };
const line = (r) => `${r.label.padEnd(28)} ${r.id}  ${r.path}${r.by ? ` by ${r.by}` : ''}${r.evidence?.mergeCommitSha ? `  ${r.evidence.mergeCommitSha.slice(0, 7)}` : ''}${r.why ? `  · ${r.why}` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const VALUED = new Set(['path', 'by', 'build', 'url', 'state', 'status', 'sha', 'message']);
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (VALUED.has(k)) opt[k] = argv[++i] ?? ''; else opt[k] = true; } else pos.push(a);
  }
  const [cmd, repo, pr] = pos;
  const json = !!opt.json;
  const say = (v, text) => process.stdout.write(`${json ? JSON.stringify(v) : text}\n`);
  const need = () => { if (!M.normRepo(repo) || !M.prNumber(pr)) throw new Error(`usage: merge-confirm.mjs ${cmd} <owner/repo> <pr>`); };
  switch (cmd) {
    case 'confirm': {
      need();
      const r = await confirm(repo, pr, { wait: !!opt.wait, path: M.PATHS.includes(opt.path) ? opt.path : 'reconcile', by: opt.by || 'cli', build: opt.build || '' });
      say(r, line(r));
      return EXIT[r.state] ?? 3;
    }
    case 'status': {
      need();
      const r = getRecord(repo, pr);
      if (!r) { say({ ok: false, error: 'no record', id: M.recordId(repo, pr) }, `no record for ${M.recordId(repo, pr)} (confirm reads it from GitHub)`); return 1; }
      say(r, `${line(r)}\n${r.history.map((h) => `  ${h.at}  ${h.from || '·'} → ${h.to}  ${h.why}`).join('\n')}`);
      return EXIT[r.state] ?? 3;
    }
    case 'list': {
      const rs = listRecords({ state: opt.state || '' });
      say({ $axf: STORE, records: rs }, rs.length ? rs.map(line).join('\n') : 'no merge-confirm records');
      return 0;
    }
    case 'request': {
      need();
      if (!M.PATHS.includes(opt.path)) throw new Error(`--path must be one of ${M.PATHS.join(', ')}`);
      const r = requestMerge({ repo, pr, path: opt.path, by: opt.by || '', build: opt.build || '', url: opt.url || '' });
      say(r, line(r)); return 0;
    }
    case 'called': {
      need();
      const call = opt.none ? null : { status: Number(opt.status) || 0, merged: !!opt.merged, sha: opt.sha || '', message: opt.message || '' };
      const r = recordCall(repo, pr, call);
      if (!r) { say({ ok: false, error: 'no record (request first)' }, 'no record: run request first'); return 1; }
      say(r, line(r)); return 0;
    }
    case 'recheck': {
      need();
      const r = recheckRecord(repo, pr, { by: opt.by || 'cli' });
      if (!r) { say({ ok: false, error: 'no record' }, `no record for ${M.recordId(repo, pr)}`); return 1; }
      const after = M.isTerminal(r.state) ? r : await confirm(repo, pr, { path: r.path });
      say(after, line(after)); return EXIT[after.state] ?? 3;
    }
    case 'tick': {
      const t = await tick();
      say(t, `checked ${t.checked}: ${t.merged.length} merged, ${t.unconfirmed.length} newly unconfirmed, ${t.failed.length} failed; ${t.pending} pending; ${t.alert.length} unconfirmed in all${t.errors.length ? `; ${t.errors.length} errors` : ''}`);
      return 0;
    }
    default:
      process.stderr.write('usage: merge-confirm.mjs tick | confirm <repo> <pr> [--wait] | status <repo> <pr> | list [--state s] | request <repo> <pr> --path p | called <repo> <pr> [--status N --merged --sha s | --none] | recheck <repo> <pr>  [--json]\n');
      return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => {
    const msg = String(e?.message || e).replace(/gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, '[redacted]');
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ ok: false, error: msg })}\n`); else process.stderr.write(`merge-confirm: ${msg}\n`);
    process.exit(1);
  });
}
