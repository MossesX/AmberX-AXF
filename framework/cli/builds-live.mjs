#!/usr/bin/env node
/**
 * builds-live — every builds store write reaches main at once (Brett, Nov 3 2026: "every completed step, no matter how
 * small, must reach the orchestrator and appear on main immediately"; build orch-live-sync).
 *
 * The store (_claude/builds/store.json, builds@1) is a repo file, so until now a session's step ticks, statuses, notes,
 * branch and PR fields sat on its feature branch and main (and every banner reading main) only saw them if and when
 * that branch merged. Now:
 *
 *   1. every store write that changes a build is queued here (an outbox next to the store: one journal entry per line);
 *   2. a flush publishes the outbox to main as ONE small status-only commit, made with git plumbing on origin/main
 *      (a private index, never this checkout's working tree or branch): fetch, take main's store, merge this
 *      checkout's changed builds into it (per build and per step, newer wins: builds-merge-core.mjs), append the journal
 *      lines (union), append one line per change to THREADS.md's live log, regenerate the orchestrator exports, commit
 *      with `[skip ci]`, push. Rejected because main moved: fetch again and re-apply (bounded); never a force push;
 *   3. main's newer builds come back into this checkout (pull), and into the console's checkout (AXF_CONSOLE_ROOT,
 *      default /opt/axf, mounted live into the console) so the banners show the change now, not at the next update.
 *
 * Code still goes through the feature branch and its PR as before; only status data goes straight to main.
 * A flush that can't reach GitHub keeps the outbox and says why (`status`; the systems check shows it red after 15 min);
 * the next write or `flush` retries.
 *
 *   node framework/cli/builds-live.mjs status [--json]        outbox size, last publish, last error
 *   … flush                                                   publish the outbox now (waits for it)
 *   … pull                                                    take main's newer builds into this checkout
 *   … sync                                                    flush, send builds newer here than on main, then pull (session start)
 *   … link <build> [--branch b] [--pr n|url] [--merged [iso]]  set a build's branch / PR / merged (live)
 *   … install                                                 git merge driver for the builds files (this clone)
 *   … merge-driver <base> <ours> <theirs> <path>              (git calls it) newer-wins merge of a builds file
 *   … heal <branch>                                           merge main into a branch whose PR conflicts only in builds files
 *
 * Environment: AXF_BUILDS_LIVE=0 off | 1 on even for a test store; AXF_BUILDS_LIVE_GIT the checkout to run git in
 * (default the repo); AXF_BUILDS_LIVE_REMOTE (origin) / AXF_BUILDS_LIVE_BRANCH (main); AXF_BUILDS_LIVE_SYNC=1 flush in
 * the writing process instead of a background one (tests); AXF_CONSOLE_ROOT (default /opt/axf; "off" = none).
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
import { adoptStore, adoptedChanges, journalDir, journalMax, mergeOriginsText, orchestratorExports, originsFile, readStoreNow, storeFile, storeText, withStore } from './builds-store.mjs';
import { emitChangesTo } from './build-hooks.mjs';
import { readManifest } from './shipped-files.mjs';

const SELF = fileURLToPath(import.meta.url);
const STORE_REL = '_claude/builds/store.json'; // = builds-store STORE_REL (not imported: the two modules import each other)
const JOURNAL_REL = '_claude/builds/journal';
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
export const outboxFile = () => `${storeFile()}.live-outbox.jsonl`;
const statusFile = () => `${storeFile()}.live.json`;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

// ------------------------------------------------------------------ outbox

/** Queue one journal entry for main (called by builds-store for every write that changes a build). */
export function enqueueLive(entry) {
  if (!liveOn()) return;
  try { appendFileSync(outboxFile(), `${JSON.stringify(entry)}\n`); } catch { /* the journal has it; status shows the outbox */ }
}
function readOutbox() {
  try { return readFileSync(outboxFile(), 'utf8').split('\n').filter((l) => l.trim()); } catch { return []; }
}
/** Drop published lines; lines queued while the publish ran stay for the next round. */
function dropFromOutbox(lines) {
  const done = new Set(lines);
  const left = readOutbox().filter((l) => !done.has(l));
  if (left.length) writeFileSync(outboxFile(), `${left.join('\n')}\n`); else rmSync(outboxFile(), { force: true });
}
function setStatus(patch) {
  const s = { ...(readJson(statusFile()) ?? {}), ...patch };
  try { writeFileSync(statusFile(), `${JSON.stringify(s, null, 1)}\n`); } catch { /* best effort */ }
  return s;
}
export function liveStatus() {
  const s = readJson(statusFile()) ?? {};
  const queued = readOutbox().length;
  return { on: liveOn(), remote: remote(), branch: branch(), queued, ...s, stuck: queued > 0 && !!s.lastError && (!s.lastOk || s.lastOk < s.lastError) };
}

/** After a write: publish in a background process (the writer returns at once) or inline with AXF_BUILDS_LIVE_SYNC=1. */
export function flushLiveSoon() {
  if (!liveOn() || !readOutbox().length) return;
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
  const records = recordsOf(entries);
  const ids = records.map((r) => r.id);
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
    if (taken.length) { merged.rev = (mainStore.rev ?? 0) + 1; merged.updatedAt = now; }
    const files = {};
    files[STORE_REL] = taken.length ? storeText(merged) : mainText ?? storeText(merged);
    const months = new Map();
    for (const e of entries) { const m = String(e.at ?? now).slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(JSON.stringify(e)); }
    for (const [m, lines] of Object.entries(journalExtra)) { if (!months.has(m)) months.set(m, []); months.get(m).unshift(...lines); }
    const sizes = journalSizes(base);
    for (const [m, lines] of months) { const text = lines.join('\n'); const rel = `${JOURNAL_REL}/${merge.journalPart(m, sizes, Buffer.byteLength(text), journalMax())}.jsonl`; files[rel] = merge.mergeJournalText(show(base, rel) ?? '', text); }
    const threadLines = entries.flatMap((e) => merge.changeLines({ ...e, builds: (e.builds ?? []).filter((b) => !skipped.includes(b.id)) }));
    const threads = show(base, THREADS_REL);
    if (threads !== null && threadLines.length) files[THREADS_REL] = appendThreads(threads, threadLines);
    for (const x of orchestratorExports(merged)) { const old = show(base, x.rel); if (old !== null || x.builds) files[x.rel] = x.text; }
    // One profile (Brett, Nov 7 2026): an orchestrator export of a profile that is not registered any more (a retired
    // profile's file an older checkout or a merge brought back) is taken off main, never rewritten.
    for (const rel of staleProfileExports(base, files)) files[rel] = null;
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
    if (!changed.length) return { ok: true, sha: '', files: allFiles(base, files), skipped };
    const sha = commitOnto(base, changed, message(entries, taken));
    if (!sha.ok) return sha;
    const p = git(['push', '-q', remote(), `${sha.sha}:refs/heads/${branch()}`], { timeout: 60000 });
    if (p.code === 0) { git(['update-ref', ref, sha.sha]); return { ok: true, sha: sha.sha, files: allFiles(sha.sha, files), skipped }; }
    last = p.err;
    // main moved under us: fetch and apply again; anything else (protection, auth) is not retried
    if (!/non-fast-forward|fetch first|stale info|failed to update ref|cannot lock ref|rejected/i.test(p.err) || /protected branch|permission|denied|403|GH006|GH013/i.test(p.err)) return { ok: false, error: `push to ${branch()} refused: ${p.err.slice(-400)}` };
    sleep(200 * attempt + Math.floor(Math.random() * 400));
  }
  return { ok: false, error: `main kept moving: gave up after ${ATTEMPTS} tries (${last.slice(-200)})` };
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
function message(entries, taken) {
  const lines = entries.flatMap((e) => merge.changeLines(e)).map((l) => l.replace(/^- [^·]*· /, '').replace(/ · [^·]*$/, ''));
  const head = lines.length === 1 ? lines[0] : `${taken.length || entries.length} build change(s): ${[...new Set(taken)].slice(0, 4).join(', ')}`;
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
  for (const [rel, t] of Object.entries(files)) if (rel.startsWith(`${JOURNAL_REL}/`)) {
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
export function syncAll() {
  if (!liveOn()) return { ok: true, skipped: 'off' };
  const flushed = flushLive();
  if (!flushed.ok) return flushed;
  const ref = `refs/remotes/${remote()}/${branch()}`;
  const f = git(['fetch', '-q', remote(), `+refs/heads/${branch()}:${ref}`], { timeout: 45000 });
  if (f.code !== 0) return { ok: false, error: f.err.slice(-300) };
  const rev = git(['rev-parse', ref]).out;
  const mainText = show(rev, STORE_REL);
  const main = mainText ? core.normalizeStore(JSON.parse(mainText)) : core.emptyStore();
  const local = readStoreNow();
  const ids = merge.mergeStores(main, local).taken;
  if (!ids.length) return { ...pullMain(), pushed: [] };
  const journalExtra = {};
  const mainKeys = Object.keys(journalSizes(rev));
  const onMain = new Map();   // month → every line main holds in any part of that month
  for (const key of localJournalMonths()) {
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
export function linkBuild(id, { branch: br, pr, mergedAt } = {}, by = 'builds-live') {
  let found = null;
  const r = withStore((s) => {
    const b = core.findBuild(s, id); if (!b) throw new Error(`no build "${id}"`);
    found = b;
    if (typeof br === 'string' && br) b.branch = br;
    if (pr !== undefined && pr !== null && String(pr)) b.pr = normPr(pr);
    if (typeof mergedAt === 'string') b.mergedAt = mergedAt;
    b.updatedAt = new Date().toISOString();
    merge.settleStatus(b, b.updatedAt);
    return s;
  }, { by, action: 'link', note: id });
  return { build: r.store.builds.find((b) => b.id === found.id), changes: r.changes };
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
  if (path.endsWith('.jsonl')) { writeFileSync(oursPath, merge.mergeJournalText(ours, theirs)); return true; }
  if (path.endsWith(ORIGINS_REL)) { writeFileSync(oursPath, mergeOriginsText(theirs, ours)); return true; }
  if (path.endsWith(STORE_REL.split('/').pop()) && path.includes('_claude/builds/') && !path.includes('/profiles/')) {
    writeFileSync(oursPath, storeText(merge.mergeStoreFiles(ours, theirs))); return true;
  }
  if (path.endsWith('orchestrator.json')) {
    const a = JSON.parse(ours); const b = JSON.parse(theirs);
    const m = merge.mergeOrchestratorDocs(a, b);
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
  if (cmd === 'status') { const s = liveStatus(); return out({ ok: !s.stuck, ...s }, `live ${s.on ? 'on' : 'off'} → ${s.remote}/${s.branch} · ${s.queued} queued · last publish ${s.lastOk || 'never'}${s.lastSha ? ` (${s.lastSha.slice(0, 8)})` : ''}${s.error ? `\nlast error ${s.lastError}: ${s.error}` : ''}${s.skipped?.length ? `\nleft out as not valid: ${s.skipped.join(', ')}` : ''}`); }
  if (cmd === 'flush') { const r = flushLive(); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? `flush skipped (${r.skipped})` : `published ${r.commits.length} commit(s) ${r.commits.map((c) => c.slice(0, 8)).join(' ')}`) : `not published: ${r.error}`); }
  if (cmd === 'sync') { const r = syncAll(); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? 'live is off' : `synced: sent ${r.pushed?.length ?? 0} build(s)${r.pushed?.length ? ` (${r.pushed.join(', ')})` : ''}, took ${r.taken?.length ?? 0} from main${r.taken?.length ? ` (${r.taken.join(', ')})` : ''}`) : `sync failed: ${r.error}`); }
  if (cmd === 'pull') { const r = pullMain(); if (!r.ok) process.exitCode = 1; return out(r, r.ok ? (r.skipped ? 'live is off' : `pulled: ${r.taken.length} build(s) newer on main${r.taken.length ? ` (${r.taken.join(', ')})` : ''}`) : `pull failed: ${r.error}`); }
  if (cmd === 'link') {
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error('link <build> [--branch b] [--pr n] [--merged [iso]]');
    const merged = opt('merged');
    const r = linkBuild(id, { branch: typeof opt('branch') === 'string' ? opt('branch') : undefined, pr: typeof opt('pr') === 'string' ? opt('pr') : undefined, mergedAt: merged === true ? new Date().toISOString() : typeof merged === 'string' ? merged : undefined });
    return out({ ok: true, build: { id: r.build.id, status: r.build.status, branch: r.build.branch, pr: r.build.pr, mergedAt: r.build.mergedAt } }, `${r.build.id}: ${r.build.status} · branch ${r.build.branch || '-'} · PR ${r.build.pr || '-'}${r.build.mergedAt ? ` · merged ${r.build.mergedAt}` : ''}`);
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
