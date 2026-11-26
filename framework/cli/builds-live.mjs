#!/usr/bin/env node
/**
 * builds-live — the builds store's projection on main (build orch-live-sync, Nov 3 2026), published as one snapshot
 * when a build lands, not once per store write (audit finding B4-06, Nov 21 2026: a push per write put 896 status-only
 * commits on main in 24 hours, so main moved about every 90 seconds and every PR was always behind it).
 *
 *   1. every store write that changes a build is queued here (an outbox next to the store: one journal entry per line).
 *      The store is the live copy and is written at once as before; with a file store the console's checkout on this
 *      machine takes the changed builds right away (a file copy, no commit, no push). Only a real change is queued
 *      (builds-merge-core realChanges): stamps, the dispatcher's run bookkeeping, a repeated note, or a shipped build
 *      touched without moving forward queue nothing, and a publish that would not really change main makes no commit
 *      (Nov 23 2026: a failed launch repeating every minute put "Builds live" commits for shipped builds on main);
 *   2. the outbox is due on main when a build in it lands, when it has held changes for a day (the daily snapshot)
 *      or when it has grown past its size cap. Everything queued rides along in the same commit. `flush` and
 *      `sync --now` publish at once;
 *   3. a flush publishes the outbox to main as ONE small status-only commit, made with git plumbing on origin/main
 *      (a private index, never this checkout's working tree or branch): fetch, take main's store, merge this
 *      checkout's changed builds into it (per build and per step, newer wins: builds-merge-core.mjs), append the journal
 *      lines, one line per change in THREADS.md's live log, regenerate the orchestrator exports, commit with
 *      `[skip ci]`, push. Rejected because main moved: fetch again and re-apply (bounded); never a force push;
 *   4. main's newer builds come back into this checkout (pull), and into the console's checkout (AXF_CONSOLE_ROOT,
 *      default /opt/axf, mounted live into the console) so the banners show the change now, not at the next update.
 *
 * Code still goes through the feature branch and its PR; only status data goes straight to main. A flush that can't reach GitHub keeps the outbox and says why (`status`); the next due write or `flush` retries.
 *
 *   node framework/cli/builds-live.mjs status [--json]   outbox size, whether it is due, last publish, last error
 *   … flush                                              publish the outbox now (waits for it)
 *   … pull                                               take main's newer builds into this checkout
 *   … sync [--now]                                       take main's newer builds; due or --now: publish first
 *   … link <build> [--branch b] [--pr n|url] [--merged [iso]] [--sha <merge commit>] [--ci success|failure|running]
 *         [--ci-run url] [--verified check|playwright|deploy|hand]   a build's branch / PR / merged + landed evidence
 *   … run-end <build> --exit n [--signal TERM] [--kind k] [--limit usage|auth] [--account a] [--session s] [--phase p]
 *                                                        how a session ended, on the build (pipeline.runEnd)
 *   … install                                            git merge driver for the builds files (this clone)
 *   … merge-driver <base> <ours> <theirs> <path>         (git calls it) newer-wins merge of a builds file
 *   … heal <branch>                                      merge main into a branch whose PR conflicts only in builds files
 *
 * Environment: AXF_BUILDS_LIVE=0 off | 1 on even for a test store; AXF_BUILDS_LIVE_GIT the checkout to run git in
 * (default the repo); AXF_BUILDS_LIVE_PUSH=landed (default) | every (a push per write); AXF_BUILDS_LIVE_SNAPSHOT_HOURS
 * (24; 0 = no daily snapshot); AXF_BUILDS_LIVE_OUTBOX_MAX_MB (16); AXF_BUILDS_LIVE_PUSH_CONFIG (the snapshot's push
 * target on a protected main, see pushTarget); AXF_BUILDS_LIVE_REMOTE (origin) / AXF_BUILDS_LIVE_BRANCH (main);
 * AXF_BUILDS_LIVE_SYNC=1 flush in the writing process, not a background one (tests); AXF_CONSOLE_ROOT (/opt/axf; "off" = none).
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import * as merge from '../plan/builds-merge-core.mjs';
import { REPO_ROOT } from './persist.mjs';
import { gitAuthEnv, githubToken, scrub } from './github.mjs';
import { adoptStore, adoptedChanges, journalDir, journalMax, journalMode, mergeOriginsText, orchestratorExports, originsFile, readStoreNow, storeFile, storeMode, storeText, withStore } from './builds-store.mjs';
import { emitChangesTo } from './build-hooks.mjs';
import { readManifest } from './shipped-files.mjs';
import { normRunEnd } from '../core/build-pipeline.mjs';
import { containerRuns } from './host-mode.mjs';
import * as dataFiles from '../core/data-files.mjs';

const SELF = fileURLToPath(import.meta.url);
const STORE_REL = '_claude/builds/store.json'; // = builds-store STORE_REL (not imported: the two modules import each other)
const JOURNAL_REL = '_claude/builds/journal';
/** data-store@1: the store is on axf-data's tables (cutover, or rolling back from them): no checkout file is the store. */
const storeOnTables = () => ['cutover', 'rollback'].includes(storeMode());
/**
 * builds-journal@1: the journal's home is the hub data store, not main. With the hub (or an explicit folder) as home,
 * or once main's pointer (_claude/builds/journal.json) says `home: 'hub'`, no journal line goes to main and none is
 * pulled from it; a test store (AXF_BUILDS_STORE) and a spool before the migration keep the old path.
 */
export const JOURNAL_POINTER_REL = '_claude/builds/journal.json';
const journalOffMain = (base) => {
  const m = journalMode();
  if (m === 'hub' || m === 'explicit') return true;
  if (m === 'test') return false;
  try { return JSON.parse(show(base, JOURNAL_POINTER_REL) ?? '{}').home === 'hub'; } catch { return false; }
};
const ORIGINS_REL = '_claude/builds/origins.json'; // = builds-store ORIGINS_REL (build-origin@1 sidecar)
const SHIPPED_DIR_REL = '_claude/builds/shipped'; // shipped-manifest@1 sidecars (framework/cli/shipped-files.mjs)
const THREADS_REL = '_claude/THREADS.md';
export const LIVE_HEAD = '## Live build log';
const LIVE_NOTE = '<!-- builds-live.mjs appends one line per build change as it reaches main (newest last, last 400 kept). Do not edit by hand. -->';
const LIVE_KEEP = 400;
const ATTEMPTS = 6;
/** Files a builds-only conflict may touch (heal) and the merge driver handles. */
export const BUILDS_PATHS = [STORE_REL, ORIGINS_REL, `${JOURNAL_REL}/`, `${SHIPPED_DIR_REL}/`, '_claude/builds/orchestrator.json', '_claude/builds/profiles/', THREADS_REL];

const env = (k, d = '') => process.env[k] ?? d;
const remote = () => env('AXF_BUILDS_LIVE_REMOTE', 'origin');
const branch = () => env('AXF_BUILDS_LIVE_BRANCH', 'main');
const gitRoot = () => env('AXF_BUILDS_LIVE_GIT') || REPO_ROOT;
const testStore = () => !!process.env.AXF_BUILDS_STORE || !!(process.env.AXF_DATA_DIR && process.env.AXF_DATA_DIR !== 'off');
/** On unless switched off; a test or scratch store only when asked for (AXF_BUILDS_LIVE=1). */
export const liveOn = () => env('AXF_BUILDS_LIVE') === '1' || (env('AXF_BUILDS_LIVE') !== '0' && !testStore());
/** When the outbox goes to main: `landed` (a build landed, the daily snapshot or a full outbox; the default) or `every` (each write). */
export const pushMode = () => (env('AXF_BUILDS_LIVE_PUSH') === 'every' ? 'every' : 'landed');
/** Statuses of a build that is on main (done-means-merged@1: merged, CI green; `built` is the legacy word for landed). */
export const LANDED_STATUSES = ['landed', 'built', 'complete'];
/** Does this journal entry land a build: its status moved into LANDED_STATUSES (landed → complete is not a second landing). */
export function landsBuild(entry) {
  return (entry?.builds ?? []).some((b) => LANDED_STATUSES.includes(b.after?.status) && !LANDED_STATUSES.includes(b.before?.status));
}
const num = (k, d) => { const n = Number(env(k)); return env(k) !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
const snapshotMs = () => num('AXF_BUILDS_LIVE_SNAPSHOT_HOURS', 24) * 3600000;
const outboxMax = () => num('AXF_BUILDS_LIVE_OUTBOX_MAX_MB', 16) * 1024 * 1024;
export const outboxFile = () => `${storeFile()}.live-outbox.jsonl`;
/** Marks the outbox as holding a landing (written with the entry, so no write has to re-read the whole outbox). */
const dueFile = () => `${outboxFile()}.due`;
/** When the oldest line still in the outbox was queued (the daily snapshot counts from here). */
const sinceFile = () => `${outboxFile()}.since`;
const statusFile = () => `${storeFile()}.live.json`;
const readJson = (f) => dataFiles.readJsonSync(f, null);
/**
 * Where the snapshot is pushed when main is protected (deploy/branch-protection.mjs status-key): a deploy key that is
 * the ruleset's only bypass, so the status-only commit still reaches main while every other change needs a green PR.
 * { url, key } from AXF_BUILDS_LIVE_PUSH_CONFIG, else `.axf-console/builds-live-push.json` in this checkout or the
 * console's (`key` is a path next to that file). None (null): the push goes to the remote like the fetch. Never read
 * for a test store unless the config is named, and never when AXF_BUILDS_LIVE_REMOTE names the remote.
 */
export function pushTarget() {
  const named = env('AXF_BUILDS_LIVE_PUSH_CONFIG');
  if (!named && (testStore() || env('AXF_BUILDS_LIVE_REMOTE'))) return null;
  const consoleRoot = env('AXF_CONSOLE_ROOT', '/opt/axf');
  const files = named ? [named] : [REPO_ROOT, consoleRoot === 'off' ? '' : consoleRoot].filter(Boolean).map((r) => join(r, '.axf-console', 'builds-live-push.json'));
  for (const f of files) {
    const c = readJson(f);
    if (typeof c?.url === 'string' && c.url) return { url: c.url, key: typeof c.key === 'string' && c.key ? resolve(dirname(f), c.key) : '' };
  }
  return null;
}

// ------------------------------------------------------------------ outbox

/**
 * Queue one journal entry for main (called by builds-store for every write that changes a build). Only builds that
 * really changed are queued (builds-merge-core realChanges): a write that moved nothing but stamps, run bookkeeping or
 * a repeated note, or that touched a shipped build without moving it forward, is not a change and queues nothing.
 */
export function enqueueLive(entry) {
  if (!liveOn()) return;
  entry = merge.realEntry(entry);
  if (!entry) return;
  try {
    // axf-data: not data (publish spool: journal lines waiting for the next push to main; the builds journal has them)
    appendFileSync(outboxFile(), `${JSON.stringify(entry)}\n`);
    if (!existsSync(sinceFile())) writeFileSync(sinceFile(), `${new Date().toISOString()}\n`, { flag: 'wx' });
  } catch { /* the journal has it; status shows the outbox */ }
  try { if (landsBuild(entry)) writeFileSync(dueFile(), `${new Date().toISOString()}\n`); } catch { /* the daily snapshot takes it */ }
}
function readOutbox() {
  try { return readFileSync(outboxFile(), 'utf8').split('\n').filter((l) => l.trim()); } catch { return []; }
}
/** Drop published lines; lines queued while the publish ran stay for the next round. */
function dropFromOutbox(lines) {
  const done = new Set(lines);
  const left = readOutbox().filter((l) => !done.has(l));
  if (left.length) writeFileSync(outboxFile(), `${left.join('\n')}\n`); else rmSync(outboxFile(), { force: true });
  // what is left was queued while the publish ran: due again only when it holds a landing of its own
  const landing = left.some((l) => { try { return landsBuild(JSON.parse(l)); } catch { return false; } });
  if (!landing) rmSync(dueFile(), { force: true });
  if (left.length) { try { writeFileSync(sinceFile(), `${new Date().toISOString()}\n`); } catch { /* best effort */ } } else rmSync(sinceFile(), { force: true });
}
/**
 * Why the outbox should go to main now ('' = it waits): `every` (push mode every), `landed` (a build in it landed),
 * `snapshot` (it has held changes for the snapshot period) or `full` (it passed the size cap).
 */
export function outboxDue() {
  let size = 0; try { size = statSync(outboxFile()).size; } catch { return ''; }
  if (!size) return '';
  if (pushMode() === 'every') return 'every';
  if (existsSync(dueFile())) return 'landed';
  if (size > outboxMax()) return 'full';
  const every = snapshotMs();
  if (every > 0) {
    let since = NaN; try { since = Date.parse(readFileSync(sinceFile(), 'utf8').trim()); } catch { /* no mark: the outbox file's own age */ }
    if (!Number.isFinite(since)) { try { since = statSync(outboxFile()).birthtimeMs || statSync(outboxFile()).mtimeMs; } catch { since = Date.now(); } }
    if (Date.now() - since >= every) return 'snapshot';
  }
  return '';
}
function setStatus(patch) {
  const s = { ...(readJson(statusFile()) ?? {}), ...patch };
  try { dataFiles.writeJsonSync(statusFile(), s, 1); } catch { /* best effort */ }
  return s;
}
export function liveStatus() {
  const s = readJson(statusFile()) ?? {};
  const queued = readOutbox().length;
  return { on: liveOn(), remote: remote(), branch: branch(), push: pushMode(), pushVia: pushTarget() ? 'deploy-key' : 'remote', queued, due: outboxDue(), ...s, stuck: queued > 0 && !!s.lastError && (!s.lastOk || s.lastOk < s.lastError) };
}

/**
 * After a write: when the outbox is due (outboxDue), publish in a background process (the writer returns at once) or
 * inline with AXF_BUILDS_LIVE_SYNC=1. Otherwise the change waits in the outbox: no commit, no push. With a file store
 * the console's checkout on this machine takes the changed builds now (a file copy); on the tables it already has them.
 */
export function flushLiveSoon() {
  if (!liveOn()) return;
  if (!outboxDue()) {
    if (existsSync(outboxFile()) && !storeOnTables()) { try { toConsole({ [STORE_REL]: storeText(readStoreNow()) }); } catch { /* the next publish brings it */ } }
    return;
  }
  // host-service builds-live (HOST-SERVICES.md): in host mode the host runner publishes the outbox; this copy only queues.
  if (!containerRuns('builds-live')) return;
  if (env('AXF_BUILDS_LIVE_SYNC') === '1') { flushLive(); return; }
  try {
    const c = spawn(process.execPath, [SELF, 'flush', '--quiet'], { cwd: REPO_ROOT, detached: true, stdio: 'ignore', env: process.env });
    c.unref();
  } catch { /* the next write or `flush` publishes it */ }
}

function tryLock(f, staleMs = 120000) {
  try { closeSync(openSync(f, 'wx')); return () => rmSync(f, { force: true }); } catch (e) {
    if (e.code !== 'EEXIST') return null;
    try { if (Date.now() - statSync(f).mtimeMs > staleMs) { rmSync(f, { force: true }); closeSync(openSync(f, 'wx')); return () => rmSync(f, { force: true }); } } catch { /* raced */ }
    return null;
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Publish everything in the outbox (one commit per round; a round picks up what was queued meanwhile). One flush per
 * checkout at a time: a second one finds the lock and leaves (the holder takes its lines in the next round).
 */
export function flushLive({ pull = true } = {}) {
  if (!liveOn()) return { ok: true, skipped: 'off' };
  const unlock = tryLock(`${outboxFile()}.lock`);
  if (!unlock) return { ok: true, skipped: 'busy' };
  const commits = [];
  try {
    for (let round = 0; round < 4; round += 1) {
      const lines = readOutbox();
      if (!lines.length) break;
      const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      setStatus({ lastTry: new Date().toISOString() });
      const r = publish(entries);
      if (!r.ok) { setStatus({ lastError: new Date().toISOString(), error: r.error }); return { ok: false, error: r.error, commits }; }
      dropFromOutbox(lines);
      if (r.sha) commits.push(r.sha);
      setStatus({ lastOk: new Date().toISOString(), error: '', skipped: r.skipped ?? [], lastSha: r.sha || readJson(statusFile())?.lastSha || '', published: (readJson(statusFile())?.published ?? 0) + entries.length });
      if (pull) { pullFrom(r.files); toConsole(r.files); }
    }
    return { ok: true, commits };
  } finally { unlock(); }
}

// ------------------------------------------------------------------ git

function git(args, { input, cwd = gitRoot(), envx = {}, timeout = 60000 } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...authEnv(), ...envx } });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: scrub((r.stderr ?? '').trim() || (r.error ? String(r.error.message) : '')) };
}
let auth = null;
/** No credential helper here (the console container): the GitHub App / GITHUB_TOKEN through GIT_CONFIG_* env (github.mjs). */
function authEnv() {
  if (auth) return auth;
  auth = {};
  const helper = spawnSync('git', ['config', '--get-all', 'credential.helper'], { cwd: gitRoot(), encoding: 'utf8' }).stdout?.trim();
  if (!helper && /github\.com/.test(spawnSync('git', ['remote', 'get-url', remote()], { cwd: gitRoot(), encoding: 'utf8' }).stdout ?? '')) auth = gitAuthEnv(githubToken());
  return auth;
}
/** A file's exact bytes at a revision (null when it isn't there). */
const show = (rev, path) => { const r = spawnSync('git', ['show', `${rev}:${path}`], { cwd: gitRoot(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };

/** The latest version of each build in the outbox (later entries win). */
function recordsOf(entries) {
  const by = new Map();
  for (const e of entries) for (const b of e.builds ?? []) if (b.after) by.set(b.id, b.after);
  return [...by.values()];
}

/** THREADS.md with the live lines appended to its live log section (made at the end when missing; last LIVE_KEEP kept). */
export function appendThreads(text, lines) {
  if (!lines.length) return text;
  let t = text ?? '';
  const i = t.indexOf(`\n${LIVE_HEAD}\n`);
  if (i < 0) { t = `${t.replace(/\s*$/, '')}\n\n${LIVE_HEAD}\n\n${LIVE_NOTE}\n\n`; }
  const at = t.indexOf(`\n${LIVE_HEAD}\n`) + 1;
  const next = t.indexOf('\n## ', at + LIVE_HEAD.length);
  const head = t.slice(0, at); const tail = next >= 0 ? t.slice(next) : '';
  const body = (next >= 0 ? t.slice(at, next) : t.slice(at)).split('\n');
  const log = body.filter((l) => l.startsWith('- '));
  const all = [...log, ...lines.filter((l) => !log.includes(l))].slice(-LIVE_KEEP);
  return `${head}${LIVE_HEAD}\n\n${LIVE_NOTE}\n\n${all.join('\n')}\n${tail}`;
}

/**
 * One publish: main's store + this checkout's changed builds → one commit on main. Returns { ok, sha, files } where
 * files = { rel: text } is what main holds now for every builds file (for the pull), or { ok: false, error }.
 */
export function publish(entries, { journalExtra = {} } = {}) {
  // lines queued by an older version (or by hand) get the same rule as enqueueLive: no real change, nothing published
  entries = entries.map((e) => merge.realEntry(e)).filter(Boolean);
  const records = recordsOf(entries);
  const ids = records.map((r) => r.id);
  if (!records.length && !Object.keys(journalExtra).length) return { ok: true, sha: '', files: {}, skipped: [] };
  const ref = `refs/remotes/${remote()}/${branch()}`;
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const f = git(['fetch', '-q', remote(), `+refs/heads/${branch()}:${ref}`], { timeout: 45000 });
    if (f.code !== 0) return { ok: false, error: `fetch ${remote()}/${branch()} failed: ${f.err.slice(-300)}` };
    const base = git(['rev-parse', ref]).out;
    const mainText = show(base, STORE_REL);
    const mainStore = mainText ? core.normalizeStore(JSON.parse(mainText)) : core.emptyStore();
    let { store: merged, taken } = merge.mergeStores(mainStore, { ...core.emptyStore(), builds: records }, { ids });
    let v = core.validateStore(merged);
    // a bad record stays out of this commit; the rest of the batch still goes (one poisoned copy used to stop every build)
    const skipped = v.ok ? [] : [...new Set(v.errors.map((e) => /^builds\[\d+\]\(([^)]+)\)/.exec(e.path)?.[1]))].filter((id) => ids.includes(id));
    if (skipped.length) {
      const kept = records.filter((r) => !skipped.includes(r.id));
      ({ store: merged, taken } = merge.mergeStores(mainStore, { ...core.emptyStore(), builds: kept }, { ids: kept.map((r) => r.id) }));
      v = core.validateStore(merged);
    }
    if (!v.ok) return { ok: false, error: `the merged store is not valid builds@1, nothing pushed: ${v.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}` };
    if (skipped.length && !taken.length) return { ok: true, sha: '', files: allFiles(base, { [STORE_REL]: mainText }), skipped };
    const now = new Date().toISOString();
    // the builds whose record on main really moves (realChanges against main's own copy). With none, main's store,
    // exports and live log stay byte for byte as they are: a newer stamp alone is never a commit
    const real = taken.filter((id) => merge.realChanges(mainStore.builds.find((b) => b.id === id), merged.builds.find((b) => b.id === id)).length);
    if (real.length) { merged.rev = (mainStore.rev ?? 0) + 1; merged.updatedAt = now; }
    const files = {};
    if (real.length || mainText === null) files[STORE_REL] = storeText(merged);
    const months = new Map();
    for (const e of entries) { const m = String(e.at ?? now).slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(JSON.stringify(e)); }
    for (const [m, lines] of Object.entries(journalExtra)) { if (!months.has(m)) months.set(m, []); months.get(m).unshift(...lines); }
    const sizes = journalOffMain(base) ? null : journalSizes(base);
    if (sizes) for (const [m, lines] of months) { const text = lines.join('\n'); const rel = `${JOURNAL_REL}/${merge.journalPart(m, sizes, Buffer.byteLength(text), journalMax())}.jsonl`; files[rel] = merge.mergeJournalText(show(base, rel) ?? '', text); }
    const threadLines = entries.flatMap((e) => merge.changeLines({ ...e, builds: (e.builds ?? []).filter((b) => real.includes(b.id)) }));
    const threads = show(base, THREADS_REL);
    if (threads !== null && threadLines.length) files[THREADS_REL] = appendThreads(threads, threadLines);
    if (real.length) for (const x of orchestratorExports(merged)) { const old = show(base, x.rel); if (old !== null || x.builds) files[x.rel] = x.text; }
    // One profile (Brett, Nov 7 2026): an orchestrator export of a profile that is not registered any more (a retired
    // profile's file an older checkout or a merge brought back) is taken off main, never rewritten. The same for a
    // profile registered only on the hub (test-sandbox, Nov 13 2026): orchestratorExports lists repo-registered
    // profiles only, so its folder leaves main with the next publish instead of failing check-profiles.mjs there.
    if (real.length) for (const rel of staleProfileExports(base, files)) files[rel] = null;
    // what Brett said (build-origin@1): main's sidecar + every origin on the merged records, never fewer
    { let mine = ''; try { mine = readFileSync(originsFile(), 'utf8'); } catch { /* none yet */ }
      const fromRecords = JSON.stringify({ origins: Object.fromEntries(merged.builds.filter((b) => b.origin).map((b) => [b.id, b.origin])) });
      const text = mergeOriginsText(mergeOriginsText(show(base, ORIGINS_REL) ?? '', mine), fromRecords);
      if (text !== mergeOriginsText('', '') || show(base, ORIGINS_REL) !== null) files[ORIGINS_REL] = text; }
    // shipped-manifest@1: the manifest of every build in this batch that has one here (main's copy stays when it is newer)
    for (const id of ids) {
      const m = readManifest(id); if (!m) continue;
      const rel = `${SHIPPED_DIR_REL}/${m.build.id}.json`; let mainRev = 0;
      try { mainRev = Number(JSON.parse(show(base, rel) ?? '{}').rev) || 0; } catch { /* unreadable on main: ours replaces it */ }
      if (mainRev <= m.rev) files[rel] = `${JSON.stringify(m, null, 1)}\n`;
    }
    // what actually differs from main
    const changed = Object.entries(files).filter(([rel, text]) => show(base, rel) !== text);
    if (!changed.length) return { ok: true, sha: '', files: allFiles(base, { [STORE_REL]: mainText, ...files }), skipped };
    const sha = commitOnto(base, changed, message(entries, real, changed.map(([rel]) => rel)));
    if (!sha.ok) return sha;
    const to = pushTarget();
    const p = git(['push', '-q', to?.url ?? remote(), `${sha.sha}:refs/heads/${branch()}`], { timeout: 60000, envx: to?.key ? { GIT_SSH_COMMAND: `ssh -i "${to.key}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` } : {} });
    if (p.code === 0) { git(['update-ref', ref, sha.sha]); return { ok: true, sha: sha.sha, files: allFiles(sha.sha, { [STORE_REL]: mainText, ...files }), skipped }; }
    last = p.err;
    // main moved under us: fetch and apply again; anything else (protection, auth) is not retried
    if (!pushRetryable(p.err)) return { ok: false, error: `push to ${branch()} refused: ${p.err.slice(-400)}` };
    sleep(200 * attempt + Math.floor(Math.random() * 400));
  }
  return { ok: false, error: `main kept moving: gave up after ${ATTEMPTS} tries (${last.slice(-200)})` };
}
/**
 * Is a refused push worth another try: main moved under us (yes), or the remote refuses us whatever main holds
 * (protection, auth: no). The refusals are matched as whole words: git's "cannot lock ref" message quotes commit ids,
 * and an id with 403 in it must not read as an HTTP 403.
 */
export function pushRetryable(err) {
  const text = String(err ?? '');
  return /non-fast-forward|fetch first|stale info|failed to update ref|cannot lock ref|rejected/i.test(text)
    && !/protected branch|permission|denied|\b403\b|\bGH006\b|\bGH013\b/i.test(text);
}
/** { fileKey: bytes } of the journal files at a revision. */
function journalSizes(rev) {
  const out = {};
  for (const l of git(['ls-tree', '-l', rev, `${JOURNAL_REL}/`]).out.split('\n')) { const m = /\s(\d+)\t.*\/([^/]+)\.jsonl$/.exec(l); if (m) out[m[2]] = Number(m[1]); }
  return out;
}
/** Orchestrator exports on `rev` under _claude/builds/profiles/ that no registered profile writes (null = remove). */
export function staleProfileExports(rev, files) {
  return git(['ls-tree', '-r', '--name-only', rev, '--', '_claude/builds/profiles']).out.split('\n')
    .filter((rel) => rel.endsWith('/orchestrator.json') && !(rel in files));
}
function allFiles(rev, files) {
  const out = { ...files };
  const ls = git(['ls-tree', '-r', '--name-only', rev, '--', '_claude/builds/profiles', '_claude/builds/orchestrator.json']).out.split('\n').filter((x) => x.endsWith('orchestrator.json'));
  for (const rel of ls) if (!(rel in out) || out[rel] === null) out[rel] = show(rev, rel) ?? '';
  return out;
}
/**
 * The commit message: the one change, or how many builds changed and which. A commit with no build change (a shipped
 * manifest, an origin or a journal line on its own) names its files; the subject never ends in an empty list.
 */
export function message(entries, real, rels = []) {
  const ids = [...new Set(real)];
  const lines = entries.flatMap((e) => merge.changeLines({ ...e, builds: (e.builds ?? []).filter((b) => ids.includes(b.id)) })).map((l) => l.replace(/^- [^·]*· /, '').replace(/ · [^·]*$/, ''));
  const names = rels.map((r) => r.replace(/^_claude\/(builds\/)?/, ''));
  const head = lines.length === 1 ? lines[0]
    : ids.length ? `${ids.length} build change(s): ${ids.slice(0, 4).join(', ')}${ids.length > 4 ? ` +${ids.length - 4}` : ''}`
      : `${names.length} status file(s): ${names.slice(0, 3).join(', ') || 'none'}`;
  return `Builds live: ${head.replace(/`/g, '').slice(0, 140)} [skip ci]\n\n${lines.slice(0, 40).join('\n')}\n\nStatus-only commit from framework/cli/builds-live.mjs (store, journal, exports, THREADS live log).`;
}
/** A commit on `base` with the given files replaced, through a private index (no working tree is touched). */
function commitOnto(base, files, msg) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-live-'));
  const envx = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    let r = git(['read-tree', base], { envx }); if (r.code) return { ok: false, error: `read-tree: ${r.err}` };
    for (const [rel, text] of files) {
      if (text === null) { r = git(['update-index', '--force-remove', '--', rel], { envx }); if (r.code) return { ok: false, error: `update-index: ${r.err}` }; continue; } // a file taken off main
      const h = git(['hash-object', '-w', '--stdin'], { input: text }); if (h.code) return { ok: false, error: `hash-object: ${h.err}` };
      r = git(['update-index', '--add', '--cacheinfo', `100644,${h.out},${rel}`], { envx }); if (r.code) return { ok: false, error: `update-index: ${r.err}` };
    }
    const tree = git(['write-tree'], { envx }); if (tree.code) return { ok: false, error: `write-tree: ${tree.err}` };
    const who = { GIT_AUTHOR_NAME: env('GIT_AUTHOR_NAME') || gitCfg('user.name') || 'AXF builds live', GIT_AUTHOR_EMAIL: env('GIT_AUTHOR_EMAIL') || gitCfg('user.email') || 'builds-live@amberxai.com' };
    const c = git(['commit-tree', tree.out, '-p', base, '-F', '-'], { input: msg, envx: { ...who, GIT_COMMITTER_NAME: who.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: who.GIT_AUTHOR_EMAIL } });
    return c.code ? { ok: false, error: `commit-tree: ${c.err}` } : { ok: true, sha: c.out };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const gitCfg = (k) => spawnSync('git', ['config', '--get', k], { cwd: gitRoot(), encoding: 'utf8' }).stdout?.trim() || '';

// ------------------------------------------------------------------ pull (main → this checkout, main → the console)

/** Take main's newer builds into this checkout's store (no journal line: nothing changed here). */
export function pullFrom(files) {
  const text = files?.[STORE_REL]; if (!text) return { ok: false };
  const main = core.normalizeStore(JSON.parse(text));
  const local = readStoreNow();
  const { store, taken } = merge.mergeStores(local, main);
  // nothing here newer than main: take main's bytes, so the branch and main hold the same file (clean merges later)
  const localOnly = merge.mergeStores(main, local).taken;
  const next = localOnly.length ? store : main;
  const journals = {};
  const offMain = ['hub', 'explicit'].includes(journalMode());
  for (const [rel, t] of Object.entries(files)) if (!offMain && rel.startsWith(`${JOURNAL_REL}/`)) {
    const m = rel.slice(JOURNAL_REL.length + 1, -'.jsonl'.length);
    let mine = ''; try { mine = readFileSync(join(journalDir(), `${m}.jsonl`), 'utf8'); } catch { /* new month */ }
    journals[m] = merge.mergeJournalText(t, mine);
  }
  if (files[ORIGINS_REL]) { let mine = ''; try { mine = readFileSync(originsFile(), 'utf8'); } catch { /* none yet */ } const t = mergeOriginsText(files[ORIGINS_REL], mine); if (t !== mine) writeFileSync(originsFile(), t); }
  if (!taken.length && !Object.keys(journals).length && storeText(local) === storeText(next)) return { ok: true, taken: [] };
  adoptStore(next, { journals });
  return { ok: true, taken };
}

/** The console's checkout (mounted live into the console): its store and exports follow main now. */
function toConsole(files) {
  const root = env('AXF_CONSOLE_ROOT', '/opt/axf');
  if (!root || root === 'off' || !files?.[STORE_REL]) return;
  try {
    if (realpathSync(root) === realpathSync(REPO_ROOT) || !existsSync(join(root, STORE_REL))) return;
    const main = core.normalizeStore(JSON.parse(files[STORE_REL]));
    const theirs = core.normalizeStore(JSON.parse(readFileSync(join(root, STORE_REL), 'utf8')));
    const { store, taken } = merge.mergeStores(theirs, main);
    for (const [rel, t] of Object.entries(files)) if (rel.startsWith(`${SHIPPED_DIR_REL}/`) && t) { mkdirSync(join(root, SHIPPED_DIR_REL), { recursive: true }); writeFileSync(join(root, rel), t); }
    if (!taken.length) return;
    // cutover: the console's store is the tables (this process's pullFrom already merged main into them); its checkout
    // file is no longer read, and its exports are regenerated by the console's own writes from the record
    if (storeOnTables()) return;
    const consoleOnly = merge.mergeStores(main, theirs).taken.length;
    const next = consoleOnly ? store : main;
    // build-hook@1: these builds changed in this checkout, not in the console's; their events go to the console's outbox
    // (its Shipped features sync delivers them), or the ledger never hears of ticks, PRs and manifests made in a worktree
    const hooks = join(root, '.axf-console', 'build-hooks');
    if (existsSync(hooks)) emitChangesTo(hooks, adoptedChanges(theirs, next), { at: new Date().toISOString(), by: 'builds-live' });
    writeFileSync(join(root, STORE_REL), consoleOnly ? storeText(store) : files[STORE_REL]);
    for (const x of orchestratorExports(consoleOnly ? store : main)) if (existsSync(join(root, x.rel)) || x.builds) writeFileSync(join(root, x.rel), x.text);
    for (const [rel, t] of Object.entries(files)) if (rel.startsWith(`${JOURNAL_REL}/`)) {
      let mine = ''; try { mine = readFileSync(join(root, rel), 'utf8'); } catch { /* new */ }
      writeFileSync(join(root, rel), merge.mergeJournalText(t, mine));
    }
  } catch { /* the console's own update brings main in within 5 minutes */ }
}

/**
 * `sync`: both ways at once. Builds this checkout has newer than main (written before live existed, offline, or
 * queued and lost) go to main in one commit with the journal lines main lacks; then main's newer builds come back.
 */
export function syncAll({ now = false } = {}) {
  if (!liveOn()) return { ok: true, skipped: 'off' };
  // a session start or the reconciler only takes main's builds; what is queued here goes with the next landing or snapshot
  if (!now && !outboxDue()) { const p = pullMain(); return { ...p, pushed: [], held: readOutbox().length }; }
  const flushed = flushLive();
  if (!flushed.ok) return flushed;
  const ref = `refs/remotes/${remote()}/${branch()}`;
  const f = git(['fetch', '-q', remote(), `+refs/heads/${branch()}:${ref}`], { timeout: 45000 });
  if (f.code !== 0) return { ok: false, error: f.err.slice(-300) };
  const rev = git(['rev-parse', ref]).out;
  const mainText = show(rev, STORE_REL);
  const main = mainText ? core.normalizeStore(JSON.parse(mainText)) : core.emptyStore();
  const local = readStoreNow();
  // newer here in a way that matters (realChanges): a copy that differs from main only by stamps or run bookkeeping is not sent
  const ahead = merge.mergeStores(main, local);
  const ids = ahead.taken.filter((id) => merge.realChanges(main.builds.find((x) => x.id === id), ahead.store.builds.find((x) => x.id === id)).length);
  if (!ids.length) return { ...pullMain(), pushed: [] };
  const journalExtra = {};
  const mainKeys = Object.keys(journalSizes(rev));
  const onMain = new Map();   // month → every line main holds in any part of that month
  for (const key of journalOffMain(rev) ? [] : localJournalMonths()) {
    const m = key.slice(0, 7);
    if (!onMain.has(m)) onMain.set(m, new Set(mainKeys.filter((k) => k.slice(0, 7) === m).flatMap((k) => (show(rev, `${JOURNAL_REL}/${k}.jsonl`) ?? '').split('\n'))));
    let mine = ''; try { mine = readFileSync(join(journalDir(), `${key}.jsonl`), 'utf8'); } catch { continue; }
    const extra = mine.split('\n').filter((l) => l.trim() && !onMain.get(m).has(l));
    if (extra.length) journalExtra[m] = [...(journalExtra[m] ?? []), ...extra];
  }
  const at = new Date().toISOString();
  const entry = { rev: local.rev, at, by: 'builds-live', action: 'sync', note: `newer here than on ${branch()}: ${ids.join(', ')}`, builds: ids.map((id) => { const b = local.builds.find((x) => x.id === id); const o = main.builds.find((x) => x.id === id); return { id, op: o ? 'change' : 'add', rev: b.rev, before: o ? core.compactBuild(o) : null, after: core.compactBuild(b) }; }) };
  const r = publish([entry], { journalExtra });
  if (!r.ok) return r;
  pullFrom(r.files); toConsole(r.files);
  if (r.sha) setStatus({ lastOk: at, error: '', lastSha: r.sha });
  return { ok: true, pushed: ids, sha: r.sha, taken: [] };
}
function localJournalMonths() {
  try { return readdirSync(journalDir()).filter((x) => x.endsWith('.jsonl')).map((x) => x.slice(0, -6)); } catch { return []; }
}

/** `pull`: fetch main and take its newer builds (session start, before reading). */
export function pullMain() {
  if (!liveOn()) return { ok: true, skipped: 'off' };
  const ref = `refs/remotes/${remote()}/${branch()}`;
  const f = git(['fetch', '-q', remote(), `+refs/heads/${branch()}:${ref}`], { timeout: 45000 });
  if (f.code !== 0) return { ok: false, error: f.err.slice(-300) };
  const rev = git(['rev-parse', ref]).out;
  const files = {};
  const t = show(rev, STORE_REL); if (!t) return { ok: false, error: `${STORE_REL} is not on ${branch()}` };
  files[STORE_REL] = t;
  for (const rel of git(['ls-tree', '--name-only', rev, `${JOURNAL_REL}/`]).out.split('\n').filter(Boolean)) files[rel] = show(rev, rel) ?? '';
  return pullFrom(files);
}

// ------------------------------------------------------------------ link (s2)

/** Set a build's branch / PR / merged time in whatever profile it is in; status follows (built ↔ complete). */
export function linkBuild(id, { branch: br, pr, mergedAt, landed } = {}, by = 'builds-live') {
  let found = null;
  const r = withStore((s) => {
    const b = core.findBuild(s, id); if (!b) throw new Error(`no build "${id}"`);
    found = b;
    if (typeof br === 'string' && br) b.branch = br;
    if (pr !== undefined && pr !== null && String(pr)) b.pr = normPr(pr);
    if (typeof mergedAt === 'string') b.mergedAt = mergedAt;
    // done-means-merged@1 evidence: the merge commit, CI on it, the verify (landed / complete need them; the store guard refuses without)
    if (landed && typeof landed === 'object') {
      const prN = Number(String(b.pr || '').replace(/\D/g, '')) || 0;
      b.landed = { ...(b.landed ?? {}), ...Object.fromEntries(Object.entries(landed).filter(([, v]) => v !== undefined && v !== '')), pr: prN || b.landed?.pr || 0, mergedAt: b.mergedAt || b.landed?.mergedAt || '' };
      if (landed.ci && !landed.ciAt) b.landed.ciAt = new Date().toISOString();
      if (landed.verifyHow && !landed.verifiedAt) b.landed.verifiedAt = new Date().toISOString();
    }
    b.updatedAt = new Date().toISOString();
    merge.settleStatus(b, b.updatedAt);
    return s;
  }, { by, action: 'link', note: id });
  return { build: r.store.builds.find((b) => b.id === found.id), changes: r.changes, refused: r.refused ?? [] };
}
/**
 * How a session ended, on the build's run record (pipeline.runEnd; build-pipeline@1): exit code, signal, exit kind, the
 * account stop (usage | auth), account, session, phase, time. Written the moment claude exits so a killed (143) or failed
 * (1) run leaves evidence the watchdog (build-watchdog@1) reads even when nothing after it runs. Live like every write.
 */
export function recordRunEnd(id, end = {}, by = 'claude-headless') {
  const rec = normRunEnd({ at: new Date().toISOString(), ...end });
  if (!rec) throw new Error('run-end needs a time');
  let found = null;
  const r = withStore((s) => {
    const b = core.findBuild(s, id); if (!b) throw new Error(`no build "${id}"`);
    found = b;
    b.pipeline = { ...(b.pipeline ?? {}), runEnd: rec };
    b.updatedAt = rec.at;
    return s;
  }, { by, action: 'run-end', note: `${id}: exit ${rec.exit ?? '?'}${rec.signal ? ` (SIG${rec.signal})` : ''}${rec.kind ? ` ${rec.kind}` : ''}${rec.limit ? ` ${rec.limit}` : ''}${rec.account ? ` on ${rec.account}` : ''}` });
  return { build: r.store.builds.find((b) => b.id === found.id), runEnd: rec, changes: r.changes };
}
/** "#245", "245" and a PR URL all become "#245" (the form the orchestrator shows); other text is kept. */
export function normPr(pr) {
  const t = String(pr).trim();
  const m = /^#?(\d+)$/.exec(t) || /\/pull\/(\d+)/.exec(t);
  return m ? `#${m[1]}` : t.slice(0, 200);
}

// ------------------------------------------------------------------ merge driver + heal

const DRIVER = 'axf-builds';
/** Register the merge driver in this clone's git config (.gitattributes names it for the builds files). */
export function install() {
  const cmd = `node "$(git rev-parse --show-toplevel)/framework/cli/builds-live.mjs" merge-driver %O %A %B %P`;
  git(['config', `merge.${DRIVER}.name`, 'AXF builds store: newer wins per build and step (builds-live.mjs)']);
  const r = git(['config', `merge.${DRIVER}.driver`, cmd]);
  return { ok: r.code === 0, driver: cmd };
}
/** Merge one builds file in place (git's %A). Returns true when merged cleanly. */
export function mergeFile(oursPath, theirsPath, path) {
  const ours = readFileSync(oursPath, 'utf8'); const theirs = readFileSync(theirsPath, 'utf8');
  // axf-data: not data (git merge driver: the merged file git asked for, in its working tree)
  if (path.endsWith('.jsonl')) { writeFileSync(oursPath, merge.mergeJournalText(ours, theirs)); return true; }
  if (path.endsWith(ORIGINS_REL)) { writeFileSync(oursPath, mergeOriginsText(theirs, ours)); return true; }
  if (path.endsWith(STORE_REL.split('/').pop()) && path.includes('_claude/builds/') && !path.includes('/profiles/')) {
    writeFileSync(oursPath, storeText(merge.mergeStoreFiles(ours, theirs))); return true;
  }
  if (path.endsWith('orchestrator.json')) {
    const a = JSON.parse(ours); const b = JSON.parse(theirs);
    const m = merge.mergeOrchestratorDocs(a, b);
    // axf-data: not data (git merge driver: the merged file git asked for, in its working tree)
    writeFileSync(oursPath, `${JSON.stringify(m, null, 1)}\n`); return true;
  }
  return false;
}

/**
 * Merge main into a branch whose only conflicts are builds files (the store went live on main while the branch kept
 * its own copy). Uses a temporary worktree and the merge driver; pushes the merge commit (never forced). Anything else
 * conflicting is left for a person (or Claude) and reported.
 */
export function heal(br) {
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(br) || br === branch()) return { ok: false, error: 'not a branch that can be healed' };
  const dir = mkdtempSync(join(tmpdir(), 'axf-heal-'));
  const wt = join(dir, 'wt');
  try {
    let r = git(['fetch', '-q', remote(), `+refs/heads/${branch()}:refs/remotes/${remote()}/${branch()}`, `+refs/heads/${br}:refs/remotes/${remote()}/${br}`], { timeout: 60000 });
    if (r.code) return { ok: false, error: `fetch: ${r.err.slice(-300)}` };
    r = git(['worktree', 'add', '--detach', wt, `refs/remotes/${remote()}/${br}`]); if (r.code) return { ok: false, error: `worktree: ${r.err.slice(-300)}` };
    const drv = ['-c', `merge.${DRIVER}.driver=node "${SELF}" merge-driver %O %A %B %P`];
    const m = git([...drv, 'merge', '--no-edit', '-m', `Merge ${branch()} into ${br} (builds files merged newer-wins by builds-live.mjs)`, `refs/remotes/${remote()}/${branch()}`], { cwd: wt, timeout: 120000 });
    if (m.code) {
      const left = git(['diff', '--name-only', '--diff-filter=U'], { cwd: wt }).out.split('\n').filter(Boolean);
      git(['merge', '--abort'], { cwd: wt });
      return { ok: false, conflicts: left, error: `conflicts outside the builds files: ${left.join(', ') || m.err.slice(-200)}` };
    }
    const p = git(['push', '-q', remote(), `HEAD:refs/heads/${br}`], { cwd: wt, timeout: 60000 });
    return p.code ? { ok: false, error: `push: ${p.err.slice(-300)}` } : { ok: true, sha: git(['rev-parse', 'HEAD'], { cwd: wt }).out };
  } finally { git(['worktree', 'remove', '--force', wt]); rmSync(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json'); const quiet = argv.includes('--quiet');
  const args = argv.filter((a) => !['--json', '--quiet'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined; };
  const out = (o, text) => { if (!quiet) console.log(json ? JSON.stringify(o) : text); };
  const [cmd = 'status', ...rest] = args;
  if (cmd === 'status') { const s = liveStatus(); return out({ ok: !s.stuck, ...s }, `live ${s.on ? 'on' : 'off'} → ${s.remote}/${s.branch} (push ${s.push === 'every' ? 'every write' : 'when a build lands'}) · ${s.queued} queued${s.due ? ` (due: ${s.due})` : ''} · last publish ${s.lastOk || 'never'}${s.lastSha ? ` (${s.lastSha.slice(0, 8)})` : ''}${s.error ? `\nlast error ${s.lastError}: ${s.error}` : ''}${s.skipped?.length ? `\nleft out as not valid: ${s.skipped.join(', ')}` : ''}`); }
  if (cmd === 'flush') { const r = flushLive(); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? `flush skipped (${r.skipped})` : `published ${r.commits.length} commit(s) ${r.commits.map((c) => c.slice(0, 8)).join(' ')}`) : `not published: ${r.error}`); }
  if (cmd === 'sync') { const r = syncAll({ now: argv.includes('--now') }); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? 'live is off' : `synced: sent ${r.pushed?.length ?? 0} build(s)${r.pushed?.length ? ` (${r.pushed.join(', ')})` : ''}${r.held ? `, ${r.held} change(s) held for the next landing or snapshot` : ''}, took ${r.taken?.length ?? 0} from main${r.taken?.length ? ` (${r.taken.join(', ')})` : ''}`) : `sync failed: ${r.error}`); }
  if (cmd === 'pull') { const r = pullMain(); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? 'live is off' : `pulled: ${r.taken.length} build(s) newer on main${r.taken.length ? ` (${r.taken.join(', ')})` : ''}`) : `pull failed: ${r.error}`); }
  if (cmd === 'link') {
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error('link <build> [--branch b] [--pr n] [--merged [iso]]');
    const merged = opt('merged');
    const sv = (k) => (typeof opt(k) === 'string' ? opt(k) : undefined);
    const landed = sv('sha') || sv('ci') || sv('verified') ? { sha: sv('sha'), ci: sv('ci'), ciRun: sv('ci-run'), verifyHow: sv('verified'), verifyLog: sv('verify-log') } : undefined;
    const r = linkBuild(id, { branch: sv('branch'), pr: sv('pr'), mergedAt: merged === true ? new Date().toISOString() : typeof merged === 'string' ? merged : undefined, landed });
    const refused = r.refused?.find((x) => x.id === r.build.id);
    return out({ ok: true, build: { id: r.build.id, status: r.build.status, branch: r.build.branch, pr: r.build.pr, mergedAt: r.build.mergedAt, landed: r.build.landed ?? null }, ...(refused ? { refused } : {}) }, `${r.build.id}: ${r.build.status} · branch ${r.build.branch || '-'} · PR ${r.build.pr || '-'}${r.build.mergedAt ? ` · merged ${r.build.mergedAt}` : ''}${refused ? `\nrefused ${refused.from} → ${refused.to}: ${refused.why}` : ''}`);
  }
  if (cmd === 'run-end') {
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error('run-end <build> --exit n [--signal s] [--kind k] [--limit usage|auth] [--account a] [--session s] [--phase p]');
    const s = (n) => (typeof opt(n) === 'string' ? opt(n) : '');
    const r = recordRunEnd(id, { exit: s('exit'), signal: s('signal'), kind: s('kind'), limit: s('limit'), account: s('account'), session: s('session'), phase: s('phase') });
    return out({ ok: true, build: r.build.id, runEnd: r.runEnd }, `${r.build.id}: run ended exit ${r.runEnd.exit ?? '?'}${r.runEnd.signal ? ` (SIG${r.runEnd.signal})` : ''}${r.runEnd.kind ? ` · ${r.runEnd.kind}` : ''}${r.runEnd.limit ? ` · ${r.runEnd.limit}` : ''}`);
  }
  if (cmd === 'install') { const r = install(); return out(r, r.ok ? `merge driver ${DRIVER} registered` : 'git config failed'); }
  if (cmd === 'merge-driver') {
    const [, a, b, p] = rest;
    let ok = false; try { ok = mergeFile(a, b, p || ''); } catch (e) { console.error(`builds-live merge-driver: ${e.message}`); }
    process.exitCode = ok ? 0 : 1; return undefined;
  }
  if (cmd === 'heal') { const r = heal(rest[0] ?? ''); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? `healed ${rest[0]} (${r.sha.slice(0, 8)})` : `not healed: ${r.error}`); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
