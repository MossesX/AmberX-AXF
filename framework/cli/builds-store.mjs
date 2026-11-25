#!/usr/bin/env node
/**
 * builds-store — the IO side of framework/plan/builds-store-core.mjs: the ONE builds store (builds@1), owned by the
 * Build orchestrator. Every builds list (orchestrator, Pending builds, build queue) reads and writes it here.
 *
 * Where the store lives (since the cutover of Nov 18 2026): on axf-data, in the Postgres tables `builds`, `build_steps`,
 * `build_notes` and `journal`, under the keys `builds/store.json` and `builds/journal/<YYYY-MM>`. Nothing in a checkout
 * is the store: no store.json is written, and the old orchestrator.json export in the repo is no longer rewritten.
 * The files below are what a checkout that has NOT moved to axf-data uses (local and shadow mode: tests, a dev machine):
 *
 *   _claude/builds/store.json            the store file (local / shadow mode only)
 *   <journal home>/<YYYY-MM>[-pN].jsonl  every write, append-only: rev, when, who, what, and each changed build. A
 *                                        change to an existing build is a diff, with a full copy every 20 revisions
 *                                        (framework/plan/builds-journal-core.mjs); parts older than 30 days are
 *                                        gzipped (`journal rotate`). Any build can be put back from here.
 *
 *   node framework/cli/builds-store.mjs                    status: builds per profile, rev, draft, journal size
 *   … migrate --dry [--report <file>]                      what the migration would do (report, nothing written)
 *   … migrate --apply                                       build the store from every older data set (once)
 *   … verify                                                every build, step, status and note of the old files is in the store
 *                                                           (plus step dependencies: missing ids and cycles)
 *   … migrate-deps [--dry]                                  step-dependency migration (build-pipeline@1): older builds get
 *                                                           no dependsOn; stamps meta.versions.stepDeps in one journal line
 *   … export                                                regenerate the old files (read-only exports of the store)
 *   … done-means-merged [--apply] [--report <file>]         done-means-merged@1: built / complete records with no merged PR
 *                                                            back to landing / fixing, once (dry run without --apply)
 *   … attempt <build> --attempt <json> | --close ok|failed  done-means-merged@1: add an attempt to the build's one log (an
 *                                                        auto-lander attempt is folded in), or close the open one
 *   … fail <build> --kind k --why "…" [--head sha]        record a failure found outside the dispatcher: status fixing
 *   … set-status <build> <status> [--by who] [--demo]    set a status through the done-means-merged@1 guard: landed / built /
 *                                                        complete without merge + green CI + verify are refused (a note says why)
 *   … flow <build> <status> [--step s] [--by who] [--why w] [--reset] [--account a] [--slot s] [--pr n]   pipeline-2@1:
 *                                                        one status change through the contract (forward-only; exit 1 =
 *                                                        refused). --reset (with --why): out of `failed` past the
 *                                                        attempt ceiling, as attempt 1
 *   … demo <build>                                        demo-build@1 check, exit 1 if not demo (--demo above: a demo action)
 *   … dedupe-steps [--dry-run|--apply] [--from f] [b…]            step-dedupe: collapse repeated steps (done copy wins, collision
 *                                                        ids tidied), one journal revision per build; dry run by default
 *   … numbers [--apply]                                    pipeline-status@1: a build number (B-0123) for every build without
 *                                                        one, oldest first (new and changed builds get theirs on write)
 *   … view <build>                                         pipeline-status@1: the read every screen gets (number, pr, split,
 *                                                        pipelineView, each step's uid / splitBy / model / modelBy / status)
 *   … history <id>                                          every journal revision of one build
 *   … journal status | migrate | verify | rotate [--days n] [--apply]   the journal's home, and gzip of old parts
 *   … repair-mojibake [--apply] [--journal-dir d]           put back characters lost to U+FFFD from the journal (dry run by default)
 *   … restore <id> <rev>                                    put a build back as it was at journal revision <rev>
 *   … progress [profile]                                    progress per build and per profile (the bars)
 *   … draft <profile> | apply <profile> | discard <profile>  the Steps view draft
 *   --json on any command prints JSON.
 *
 * AXF_BUILDS_STORE=<file> points at another store (tests); its journal goes next to it.
 * In a build worktree the store lives on the hub data store (worktreeHome), never in the checkout.
 * Live (Nov 3 2026, orch-live-sync): every write that changes a build is also queued for main (builds-live.mjs) and
 * published there at once as its own status-only commit, whatever branch this checkout is on. AXF_BUILDS_LIVE=0 = off.
 * The old per-profile files (orchestrator.json, pending.json, build-queue.json) are READ-ONLY exports of the store
 * (see exportAll) in local and shadow mode; a direct edit is taken into the store. In cutover the repo's
 * orchestrator.json is not written at all (it only dirtied the live checkout).
 * Old writers (S5-01): a field this checkout's code does not know is kept on every read and write (keepStore), and a
 * checkout whose STORE_VERSION is older than the store's is refused (StoreTooNew) instead of writing it back poorer.
 * Step dependencies (Nov 13 2026, build-pipeline@1): a step's optional `after` list (`dependsOn` on input), `parallel`
 * mode and `claim` record go through normBuild, the orchestrator export / absorb and the newer-wins merge unchanged; a
 * step without `after` stays implicitly sequential (that is the whole migration: nothing is added to older steps).
 * `verify` reports an `after` id that names no step of the build, a stored `dependsOn`, a bad `parallel` value and any
 * dependency cycle (core.validateStore / dependencyCycles).
 *
 * data-store@1 (axf-data, Nov 15 2026: "the builds keep running" with the console down): the store and its journal
 * follow the mode of their keys (`builds/store.json`, `builds/journal/`; framework/core/data-store-mode.mjs, key-level
 * overrides on the `builds` namespace). local = the files, as before. shadow = the files first, then the same write and
 * journal line on axf-data (a failure is a drift line, never an error). cutover (Nov 18 2026, Postgres tables `builds`,
 * `build_steps`, `build_notes`, `journal`) = axf-data only: the read assembles the record from the rows, the write is a
 * data-patch@1 of the builds this write changed, each checked against the rev it was read at and locked row by row
 * (`SELECT … FOR UPDATE`), plus the journal line, in one transaction (writeStoreRemote). A conflict on one build re-reads
 * and re-applies the change, up to 5 times. rollback = writes refused (read_only) until the local copy has caught up.
 * The cut itself: `node framework/cli/builds-data.mjs cutover --apply` (copy, verify counts, flip the keys under the lock).
 * After the cut no store.json is written anywhere (Pipeline 2.0, Nov 19 2026): readers ask the store, never the file.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import { appendFileSync, chmodSync, chownSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import * as merge from '../plan/builds-merge-core.mjs';
import { mergeOrigin } from '../core/build-origin.mjs';
import { migrateDoneStore } from '../core/build-pipeline.mjs';
import { enqueueLive, flushLiveSoon } from './builds-live.mjs';
import { emitChanges } from './build-hooks.mjs';
import { BASE_PROFILE, REPO_ROOT, activeProfile, hasRepoExport, journalHome, journalReadDirs, orchestratorPath, persistRoot, profileRel, readProfiles } from './persist.mjs';
import * as files from '../core/data-files.mjs';
import { DataStoreError } from '../core/data-store.mjs';
import { DemoGuardError, demoGuard } from '../core/demo-build.mjs';
import * as P2 from '../core/pipeline-status.mjs';
import * as JC from '../plan/builds-journal-core.mjs';
import { clip } from '../core/clip.mjs';

export const STORE_REL = '_claude/builds/store.json';
/**
 * A build worktree's data home (stop-auto-lander-committing-tracking s4): in a linked git worktree (`.git` is a file)
 * on a branch other than main, with the hub data store reachable (persist.mjs persistRoot), the store, its sidecars and
 * its orchestrator exports live at <data root>/builds/worktrees/<worktree>/ instead of the checkout, seeded once
 * from the checkout's copy. The checkout's tracking files (framework/core/tracking-paths.mjs) are then never written,
 * so never staged on the build branch. The status-only publish to main (builds-live.mjs) is unchanged: it reads the
 * store wherever it lives. AXF_BUILDS_HOME=repo keeps the store in the checkout; tests (AXF_BUILDS_STORE,
 * AXF_DATA_DIR) are unaffected.
 */
let worktreeHomeMemo;
export function worktreeHome() {
  if (process.env.AXF_BUILDS_STORE || process.env.AXF_DATA_DIR !== undefined || process.env.AXF_BUILDS_HOME === 'repo') return '';
  if (worktreeHomeMemo !== undefined) return worktreeHomeMemo;
  worktreeHomeMemo = '';
  try {
    if (!statSync(join(REPO_ROOT, '.git')).isFile()) return worktreeHomeMemo;
    const head = readFileSync(join(REPO_ROOT, '.git'), 'utf8').match(/gitdir:\s*(.+)/)?.[1]?.trim();
    const ref = head ? readFileSync(join(resolve(REPO_ROOT, head), 'HEAD'), 'utf8').trim() : '';
    if (/^ref: refs\/heads\/main$/.test(ref)) return worktreeHomeMemo;
    const root = persistRoot();
    if (root) worktreeHomeMemo = join(root, 'builds/worktrees', REPO_ROOT.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-'));
  } catch { /* not a worktree */ }
  return worktreeHomeMemo;
}
/**
 * A scratch data folder (AXF_DATA_DIR set to a folder, as tests do), or a build worktree's hub home: the store lives
 * there too, seeded from the repo's.
 */
const scratchDir = () => { const d = process.env.AXF_DATA_DIR; return d && d !== 'off' ? d : d === undefined ? worktreeHome() : ''; };
export const storeFile = () => process.env.AXF_BUILDS_STORE || (scratchDir() ? join(scratchDir(), STORE_REL) : join(REPO_ROOT, STORE_REL));
/**
 * The journal (builds-journal@1, framework/spec/BUILDS.md → Journal home): next to a test store (AXF_BUILDS_STORE),
 * else persist.mjs journalHome(): AXF_BUILDS_JOURNAL, the hub data store (<data root>/builds/journal), or the
 * git-ignored repo spool. Reads also look in the repo folder for parts written before the move (journalReadDirs).
 */
const testJournal = () => (process.env.AXF_BUILDS_STORE ? join(dirname(storeFile()), `${storeFile().replace(/^.*\//, '').replace(/\.json$/, '')}.journal`) : '');
export const journalDir = () => testJournal() || journalHome().dir;
/** test | explicit | hub | spool */
export const journalMode = () => (testJournal() ? 'test' : journalHome().mode);
const journalDirs = () => (testJournal() ? [testJournal()] : journalReadDirs().filter((d) => existsSync(d)));
/** Every journal part by key ('YYYY-MM[-pN]'): the files holding it (home first) and its size (the biggest copy). */
export function journalParts() {
  const out = {};
  for (const d of journalDirs()) {
    let names = []; try { names = readdirSync(d).filter((f) => PART_RE.test(f)); } catch { continue; }
    for (const f of names) { const k = f.replace(PART_RE, ''); const size = statSync(join(d, f)).size; const p = (out[k] ??= { files: [], size: 0 }); p.files.push(join(d, f)); p.size = Math.max(p.size, size); }
  }
  return out;
}
/** A journal part file: `<key>.jsonl`, or `<key>.jsonl.gz` once rotated (rotateJournal). */
const PART_RE = /\.jsonl(\.gz)?$/;
const readPart = (f) => { const buf = readFileSync(f); return f.endsWith('.gz') ? gunzipSync(buf) : buf; };
/** One part's lines: the union of every copy (home and the repo's old one), in order, each line once. */
export function journalPartText(key) {
  const p = journalParts()[key]; if (!p) return '';
  const texts = p.files.map((f) => { try { return readPart(f).toString('utf8'); } catch { return ''; } });
  return texts.length === 1 ? texts[0] : merge.mergeJournalText(...texts);
}

export class StoreLocked extends Error {}
/** cutover: someone else wrote a build we changed (or the store) on axf-data between our read and our write (withStore re-runs). */
export class StoreConflict extends Error {}

// ------------------------------------------------------------------ old writers: unknown fields and the store version (S5-01)
/*
 * normBuild / normStep / normalizeStore (builds-store-core.mjs) are whitelists: a field they do not know is dropped.
 * Every writer normalises with its own copy of that code, so a session on an older checkout read the store, lost a
 * newer field (a Pipeline 2.0 build's `planning`: the plan's steps never reached the splitter) and wrote the build
 * back without it. Two guards, both here in the IO layer:
 *   keepStore       whatever a record holds that this checkout's code does not know is carried through every read and
 *                   every write, on the store, on a build and on a step. Such a field cannot be removed by leaving it
 *                   out; code that knows it sets it to null.
 *   STORE_VERSION   stamped on the store (`storeVersion`) by every write. A checkout whose number is lower than the
 *                   store's is refused (StoreTooNew): pull main, then write. Raise it by one whenever a release
 *                   changes what a stored field means, so that older code must not write at all.
 */
export const STORE_VERSION = 2;
/** This checkout's builds-store code is older than the store it is asked to write (code 'stale_checkout'). */
export class StoreTooNew extends Error { constructor(have, mine = STORE_VERSION) { super(`this checkout's builds store code is version ${mine}, the store is at version ${have}: update the checkout (pull main) before writing builds`); this.code = 'stale_checkout'; this.storeVersion = have; } }
const versionOf = (store) => (Number.isInteger(store?.storeVersion) && store.storeVersion > 0 ? store.storeVersion : 1);
function assertWritable(store) { if (versionOf(store) > STORE_VERSION) throw new StoreTooNew(versionOf(store)); }

/** The field names a normaliser knows: everything it reads from a record or puts on its result, over every status. */
function fieldsOf(norm, samples) {
  const seen = new Set();
  for (const sample of samples) {
    const spy = new Proxy(sample, { get(t, k, r) { if (typeof k === 'string') seen.add(k); return Reflect.get(t, k, r); }, has(t, k) { if (typeof k === 'string') seen.add(k); return Reflect.has(t, k); } });
    try { for (const k of Object.keys(norm(spy) ?? {})) seen.add(k); } catch { /* a sample the normaliser refuses names no fields */ }
  }
  return seen;
}
let knownMemo;
function known() {
  if (knownMemo) return knownMemo;
  const statuses = [...new Set(['', ...core.STATUSES, ...(P2.BUILD_FLOW ?? []), ...(P2.STEP_FLOW ?? []), 'failed', 'archived'])];
  const samples = statuses.flatMap((status) => [{ id: 'sample', status }, { id: 'sample', status, flow: P2.FLOW, deleted: true, done: true, rearranged: true, profiles: ['all'] }]);
  knownMemo = {
    store: new Set(Object.keys(core.emptyStore())),
    // `demo` and `profile` are known to normBuild without being read from the record on every path
    // `pipelineView` is worked out on read (pipeline-status@1) and never stored: known, so it is never carried into a write
    build: new Set([...fieldsOf((b) => core.normBuild(b), samples), 'demo', 'profile', 'defaultSteps', 'pipelineView']),
    step: fieldsOf((x) => core.normStep(x, 0), samples),
  };
  return knownMemo;
}
const unknownOf = (rec, names) => (rec && typeof rec === 'object' && !Array.isArray(rec) ? Object.keys(rec).filter((k) => !names.has(k) && rec[k] !== undefined) : []);
const carry = (from, to, names) => { for (const k of unknownOf(from, names)) if (!(k in to)) to[k] = JSON.parse(JSON.stringify(from[k])); return to; };
const stepsByKey = (list) => { const m = new Map(); for (const x of Array.isArray(list) ? list : []) if (x && typeof x === 'object') for (const k of [x.uid, x.id]) if (k && !m.has(k)) m.set(k, x); return m; };
/** `to` (a normalised build) with every field of `from` (the same build, as stored) that this code does not know. */
export function keepBuild(from, to) {
  if (!from || !to || typeof from !== 'object' || typeof to !== 'object') return to;
  carry(from, to, known().build);
  const old = stepsByKey(from.steps);
  if (old.size) for (const x of to.steps ?? []) { const o = old.get(x.uid) ?? old.get(x.id); if (o) carry(o, x, known().step); }
  return to;
}
/** `to` (a normalised store) with every unknown field of `from` (the store as read): top level, builds by id, steps. */
export function keepStore(from, to) {
  if (!from || !to || typeof from !== 'object' || typeof to !== 'object') return to;
  carry(from, to, known().store);
  const old = new Map((Array.isArray(from.builds) ? from.builds : []).filter((b) => b && typeof b === 'object' && b.id).map((b) => [b.id, b]));
  if (old.size) for (const b of to.builds ?? []) keepBuild(old.get(b.id), b);
  return to;
}
/** normalizeStore that loses nothing it does not know. */
const normKeeping = (raw) => keepStore(raw, core.normalizeStore(raw));
/** The store file's lock (a writer's, or the data cut-over's on the file it names): fn() runs while it is held. */
export function withStoreLock(fn, waitMs, file = storeFile()) { const unlock = lock(file, waitMs); try { return fn(); } finally { unlock(); } }
/**
 * The store's axf-data key. A build worktree's hub home (worktreeHome) is a local copy of the one store, so it maps
 * to the canonical key (builds/store.json), never to a per-worktree key: in cutover nothing is written to the checkout.
 */
const storeKey = () => files.keyFor(worktreeHome() && !process.env.AXF_BUILDS_STORE ? join(REPO_ROOT, STORE_REL) : storeFile());
/** The data-store@1 mode of the builds store: local unless the store maps onto axf-data and `builds` has moved. */
export const storeMode = () => { const k = storeKey(); return k ? files.modeOf(k) : 'local'; };
const remoteOn = () => { const m = storeMode(); return m === 'cutover' || m === 'rollback'; };
let remoteEtag = '';
const shadowCall = (req, what) => { try { return files.callSync(req); } catch (e) { files.logDrift(req.op === 'append' ? 'append' : 'write', req.key, req.op === 'append' ? 'append-failed' : 'write-failed', null, null, `${what}: ${e.code || 'error'}: ${e.message}`); return null; } };
/** The axf-data journal key of an entry: the month part (builds/journal/<YYYY-MM>; parts are a file-size matter, not a key one). */
export const remoteJournalKey = (entry) => `builds/journal/${entry.at.slice(0, 7)}`;
/**
 * The line an entry becomes on axf-data: itself, or (over the 256 KiB entry limit) a pointer line after the whole entry
 * is written as the record builds/journal-large/<rev>-<at>.json. `put` creates that record (idempotent: exists = kept).
 */
export function remoteJournalEntry(entry, put = (key, data) => files.callSync({ op: 'put', key, data, create: true })) {
  if (Buffer.byteLength(files.canonical(entry)) <= 256 * 1024) return entry;
  const big = `builds/journal-large/${entry.rev}-${String(entry.at).replace(/[^0-9]/g, '')}.json`;
  try { put(big, entry); } catch (e) { if (!(e instanceof DataStoreError) || e.code !== 'exists') throw e; }
  return { rev: entry.rev, at: entry.at, by: entry.by, action: entry.action, large: big };
}
/** One journal entry on axf-data (shadow mirror, or the first remote write); the patch path carries its own line. */
function remoteJournal(key, entry, shadow) {
  const call = shadow ? (r) => shadowCall(r, 'journal') : files.callSync;
  return call({ op: 'append', key, entries: [remoteJournalEntry(entry)], idem: `rev-${entry.rev}-${entry.at}` });
}
/** Store write by mode: the local file, plus the shadow mirror (the whole record, as before the cut). */
function writeStoreFile(f, store) {
  const mode = storeMode();
  if (mode === 'rollback') throw new DataStoreError('read_only', 'the builds store is rolling back: writes wait until it is local again');
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, storeText(store)); renameSync(tmp, f);
  if (mode === 'shadow') {
    const cur = shadowCall({ op: 'get', key: storeKey() }, 'store read');
    shadowCall({ op: 'put', key: storeKey(), data: core.compactStore(store), ...(cur ? { ifMatch: cur.etag } : { create: true }) }, 'store');
  }
}
/**
 * The cutover write (data-patch@1, Nov 18 2026): only the builds this write changed go to axf-data, each with the rev it
 * was read at (`ifRev`; a new build passes null), together with the head fields that changed (rev, updatedAt, meta,
 * rules, drafts) and the journal line, in ONE transaction on the server. Postgres locks those rows and no others
 * (`SELECT … FOR UPDATE` in services/axf-data/pg.py), so two sessions ticking two builds never wait on each other, and
 * a session that read a build before someone else changed it gets `conflict` for that build only: withStore re-reads
 * and re-applies (StoreConflict). The first write of a store axf-data has never seen is a whole-record put.
 */
function writeStoreRemote(before, after, changes, entry, { draftChanged, metaChanged }) {
  if (storeMode() === 'rollback') throw new DataStoreError('read_only', 'the builds store is rolling back: writes wait until it is local again');
  const key = storeKey();
  if (!remoteEtag) {
    try { remoteEtag = files.callSync({ op: 'put', key, data: core.compactStore(after), create: true }).etag; }
    catch (e) { if (e instanceof DataStoreError && (e.code === 'conflict' || e.code === 'exists')) throw new StoreConflict(e.message); throw e; }
    remoteJournal(remoteJournalKey(entry), entry, false);
    return;
  }
  const head = { rev: after.rev, updatedAt: after.updatedAt };
  if (metaChanged) { head.meta = after.meta; head.rules = after.rules; }
  if (draftChanged) head.drafts = after.drafts;
  // any other top-level field this write changed (migratedAt, a new field a later version adds) rides along
  for (const [k, v] of Object.entries(core.compactStore(after))) if (!(k in head) && k !== 'builds' && JSON.stringify(v) !== JSON.stringify(before[k])) head[k] = v;
  // every row is stored normalized (rev, dates, lists in shape): a build a caller pushed raw reads back the same as it
  // would from the file, and its stored rev is what the next writer's ifRev will name
  const lists = { builds: changes.map((c) => ({ key: c.id, ifRev: c.before ? c.before.rev : null, item: core.compactBuild(keepBuild(c.after, core.normBuild(c.after))) })) };
  const line = remoteJournalEntry(entry);
  const body = { head, lists, journal: { path: remoteJournalKey(entry).slice('builds/'.length), entry: line, idem: `rev-${entry.rev}-${entry.at}` } };
  try { remoteEtag = files.callSync({ op: 'patch', key, body }).record.etag; }
  catch (e) { if (e instanceof DataStoreError && (e.code === 'conflict' || e.code === 'exists')) throw new StoreConflict(e.message); throw e; }
}
function lock(f, waitMs = 20000) {
  const l = `${f}.lock`; const t0 = Date.now();
  for (;;) {
    try { mkdirSync(dirname(l), { recursive: true }); closeSync(openSync(l, 'wx')); return () => rmSync(l, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(l).mtimeMs > 30000) rmSync(l, { force: true }); } catch { /* gone */ }
      if (Date.now() - t0 > waitMs) throw new StoreLocked(`builds store is locked (${l})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export function storeExists() { return existsSync(storeFile()); }

// ------------------------------------------------------------------ origins sidecar (build-origin@1)
/*
 * What Brett said that started each build lives on the build record (`origin`) AND in this sidecar, keyed by build id.
 * Sessions still running code from before build-origin@1 rewrite the store without the field; they never touch this
 * file, so every read heals the records from it and every write folds the records back into it. Nothing is lost.
 */
export const ORIGINS_REL = '_claude/builds/origins.json';
export const originsFile = () => (process.env.AXF_BUILDS_STORE ? storeFile().replace(/\.json$/, '') + '.origins.json' : join(dirname(storeFile()), 'origins.json'));
export function readOrigins() { try { const j = JSON.parse(readFileSync(originsFile(), 'utf8')); return j?.origins && typeof j.origins === 'object' ? j.origins : {}; } catch { return {}; } }
export const originsText = (origins) => `${JSON.stringify({ $axf: 'build-origins@1', origins: Object.fromEntries(Object.keys(origins).sort().map((k) => [k, origins[k]])) }, null, 1)}\n`;
/** Records ← sidecar (in place). */
function healOrigins(store, side = readOrigins()) {
  for (const b of store.builds) { const og = mergeOrigin(b.origin, side[b.id]); if (og) b.origin = og; }
  return store;
}
/** Sidecar ← records (written only when something new came in). */
function foldOrigins(store) {
  const side = readOrigins(); let changed = false;
  for (const b of store.builds) if (b.origin) { const og = mergeOrigin(b.origin, side[b.id]); if (JSON.stringify(og) !== JSON.stringify(side[b.id] ?? null)) { side[b.id] = og; changed = true; } }
  if (changed) { const f = originsFile(); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, originsText(side)); renameSync(tmp, f); }
  return changed;
}
export const mergeOriginsText = (a, b) => { const pa = (() => { try { return JSON.parse(a || '{}').origins ?? {}; } catch { return {}; } })(); const pb = (() => { try { return JSON.parse(b || '{}').origins ?? {}; } catch { return {}; } })(); const out = { ...pa }; for (const [k, v] of Object.entries(pb)) out[k] = mergeOrigin(out[k], v); return originsText(out); };
function readStore() {
  if (remoteOn()) {
    const r = files.callSync({ op: 'get', key: storeKey() });
    remoteEtag = r ? r.etag : '';
    return healOrigins(normKeeping(r ? r.data : core.emptyStore()));
  }
  const f = storeFile();
  if (!existsSync(f) && scratchDir() && !process.env.AXF_BUILDS_STORE && existsSync(join(REPO_ROOT, STORE_REL))) {
    mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, readFileSync(join(REPO_ROOT, STORE_REL)));
    const o = join(REPO_ROOT, ORIGINS_REL); if (!existsSync(originsFile()) && existsSync(o)) writeFileSync(originsFile(), readFileSync(o));
  }
  if (!existsSync(f)) {
    if (process.env.AXF_BUILDS_STORE) return core.emptyStore();
    // first use on this checkout: migrate from the older files (the dry run is `migrate --dry`)
    return migrateNow({ by: 'auto-migrate' }).store;
  }
  return healOrigins(normKeeping(JSON.parse(readFileSync(f, 'utf8'))));
}
/** The store. If an old file was written directly since the last export, that write is taken into the store first. */
export function loadStore() {
  // A read never fails on the lock (urgent-console-perf, Nov 4 2026): when another process holds it, that writer
  // absorbs the foreign write itself, so the read takes the store as it is instead of waiting 20 s and erroring.
  if (exportsOn() && foreignWrites().length) {
    try { return withView(withStore((s) => s, { by: 'foreign-write', action: 'absorb', lockWaitMs: 2000 }).store); }
    catch (e) { if (!(e instanceof StoreLocked)) throw e; }
  }
  const store = readStore();
  // a one-row write (withBuild) does not hold the whole store, so it leaves the pending / queue exports to the next
  // reader that does: this one. Never fails a read (a read-only mount keeps the older export).
  if (exportsOn() && exportsBehind(store)) { try { exportAll(store); } catch { /* the next writer exports */ } }
  return withView(store);
}

// ------------------------------------------------------------------ pipeline-status@1: the view on read, numbers on write
/*
 * Every read (loadStore) gives each build a computed `pipelineView` (framework/core/pipeline-status.mjs pipelineView:
 * state, label, tone, icon, line, attempt, waitingOn, mergeLine, split), so the orchestrator, Pending, Plan Studio 2.0
 * and the console server show the same thing from the one record. It is worked out when first looked at, shows up in
 * JSON like any field, and is never stored: every write drops it (stripView), and keepBuild never carries it.
 * Stored beside it, and read as they are: the build's `number` (B-0123, given once here: giveNumbers), `pr` / `prUrl`
 * (the draft PR opened when the build starts), `split` (who split it) and `clash`; each step's `uid`, `splitBy`,
 * `model`, `modelBy`, `status` and `waitsFor`.
 */
/** The store with `pipelineView` on every build (in place; computed on first use, one shared context per read). */
export function withView(store) {
  if (!store || !Array.isArray(store.builds)) return store;
  let ctx = null;
  for (const b of store.builds) {
    if (!b || typeof b !== 'object') continue;
    let view;
    Object.defineProperty(b, 'pipelineView', { enumerable: true, configurable: true, get() { return (view ??= P2.pipelineView(b, (ctx ??= P2.pipelineContext(store.builds)))); }, set(v) { view = v; } });
  }
  return store;
}
/** Drop the computed view from every build of a store about to be written (in place). */
function stripView(store) { for (const b of store?.builds ?? []) if (b && typeof b === 'object' && 'pipelineView' in b) delete b.pipelineView; return store; }
/**
 * Build numbers (Brett, Nov 23 2026: "give every build a number too, a unique ID that shows up in the orchestrator and
 * the Plan Studio"): every build this write adds or changes that has none gets the next `B-nnnn`, once. The store's
 * `buildSeq` is the high-water mark, so a number is never used again after its build is deleted. Two writers that
 * numbered two builds at the same moment (the cutover write locks rows, not the head) are put right by the next write:
 * the older build keeps the number. `all`: every build without one (the `numbers --apply` backfill).
 */
function giveNumbers(start, next, { all = false } = {}) {
  const old = new Map((start?.builds ?? []).map((b) => [b.id, b]));
  // only what this write adds or changes (cheap: a build that already has its number is never compared)
  const same = (o, b) => JSON.stringify({ ...o, rev: 0, updatedAt: '' }) === JSON.stringify({ ...b, rev: 0, updatedAt: '' });
  const ids = all ? null : new Set(next.builds.filter((b) => !b.number && !(old.has(b.id) && same(old.get(b.id), b))).map((b) => b.id));
  if (ids && !ids.size) return [];
  const r = P2.assignNumbers(next.builds, { seq: Number(start?.buildSeq) || 0, ids });
  if (r.given.length || r.seq !== (Number(start?.buildSeq) || 0)) next.buildSeq = r.seq;
  return r.given;
}
/** Number every build that has none, oldest first (one write). Dry run unless `apply`. → { given: [{ id, number }], apply } */
export function numberBuildsNow({ apply = false, by = 'numbers' } = {}) {
  if (!apply) { const copy = JSON.parse(JSON.stringify(stripView(readStore()))); return { apply: false, given: P2.assignNumbers(copy.builds, { seq: Number(copy.buildSeq) || 0 }).given }; }
  let given = [];
  withStore((s) => { given = giveNumbers(s, s, { all: true }); return s; }, { by, action: 'numbers', note: 'build numbers for every build without one' });
  return { apply: true, given };
}

// ------------------------------------------------------------------ the old files as read-only exports
/*
 * The pre-store pending and queue files stay where every older reader looks for them (Pending page on the hub, plugins,
 * other sessions' checkouts), but they are generated from the store after every write: read-only exports, like
 * tracker.json. The orchestrator.json status file is not one of them (Nov 25 2026): status lives in the store only.
 * A file changed by anything else since the last export (an old checkout, a hand edit, a git merge) is a foreign write:
 * it is absorbed into the store (journalled as `foreign-write`) before the next export, so it is never overwritten
 * unseen. Exports are off for test stores (AXF_BUILDS_STORE) unless AXF_BUILDS_EXPORT=1; AXF_BUILDS_EXPORT=0 turns them off.
 */
const exportsOn = () => process.env.AXF_BUILDS_EXPORT === '1' || (!process.env.AXF_BUILDS_STORE && process.env.AXF_BUILDS_EXPORT !== '0');
const exportsFile = () => `${storeFile()}.exports.json`; // per machine (paths differ), not committed
export const EXPORT_NOTE = 'builds@1 export (read-only): generated from _claude/builds/store.json after every write. Change builds through the orchestrator, Pending builds, the build queue or the Builds page; a direct edit here is taken into the store, then this file is regenerated.';
function exportTargets() {
  const hub = persistRoot();
  const data = (id, r) => join(hub ?? REPO_ROOT, profileRel(id, r));
  // No status file (Nov 25 2026, framework/spec/DATA-INVENTORY.md → Pipeline status): orchestrator.json is neither
  // written nor read here in any mode. A build's status is its row in the store (readBuild / withBuild), the
  // pipeline's is pipelineSummary().
  return readProfiles().profiles.flatMap((p) => [
    { kind: 'pending', profile: p.id, file: data(p.id, 'framework/plan/pending.json') },
    { kind: 'queue', profile: p.id, file: data(p.id, 'framework/plan/build-queue.json') },
  ]);
}
const sig = (f) => { try { const st = statSync(f); return `${st.size}:${Math.floor(st.mtimeMs)}`; } catch { return ''; } };
const readExports = () => readJson(exportsFile()) ?? {};
const str = (v) => (typeof v === 'string' ? v : '');
/** The exports here were written from an older store than `store` (a one-row write since: withBuild). */
function exportsBehind(store) {
  const revs = Object.values(readExports()).map((e) => e?.rev).filter(Number.isFinite);
  return revs.length > 0 && Math.max(...revs) < (store?.rev ?? 0);
}
/** Old files changed since the last export here, or never exported on this machine (a fresh checkout, a merge). */
function foreignWrites() {
  const ex = readExports();
  return exportTargets().filter((t) => sig(t.file) && (!ex[t.file] || sig(t.file) !== ex[t.file].sig));
}
function absorbForeign(store, log) {
  let s = store;
  const ex = readExports();
  for (const t of foreignWrites()) {
    const j = readJson(t.file); if (!j) continue;
    // our own export from another checkout or machine: a projection of the store, nothing new in it
    if (!ex[t.file] && j.$export) continue;
    // written before the migration: everything in it is in the store already (the migration read every copy)
    if (!(str(j.updatedAt || j.generatedAt) > str(s.migratedAt))) continue;
    // newer-only: a foreign file may be older than the store, so it can add and update builds, never revert or remove
    const before = s;
    if (t.kind === 'pending' && Array.isArray(j.items)) s = core.absorbPending(s, t.profile, j, null, { newerOnly: true });
    if (t.kind === 'queue' && Array.isArray(j.order) && !j.$export) s = core.absorbQueue(s, t.profile, j, epicsOf(t.profile));
    if (core.diffStores(before, core.normalizeStore(JSON.parse(JSON.stringify(s)))).length) log.push(`${rel(t.file)} had newer builds than the store: taken in`);
  }
  return s;
}
function epicsOf(profile) {
  const hub = persistRoot(); const r = profileRel(profile, 'framework/plan/plan.json');
  return ((hub ? readJson(join(hub, r)) : null) ?? readJson(join(REPO_ROOT, r)))?.features ?? [];
}
/** The text of one export (the same bytes on every machine, so main and every checkout agree). */
export function exportText(store, kind, profile) {
  const doc = kind === 'orchestrator' ? core.projectOrchestrator(store, profile) : kind === 'pending' ? core.projectPending(store, profile) : core.projectQueue(store, profile);
  return doc ? { doc, text: `${JSON.stringify({ $export: EXPORT_NOTE, ...doc }, null, 1)}\n` } : null;
}
/**
 * The orchestrator projection as repo-relative paths: [{ rel, text, builds }]. Nothing in this module writes or reads
 * those files any more; builds-live.mjs is the last caller (its publish to main), until it stops carrying status.
 */
export function orchestratorExports(store) {
  return readProfiles().profiles.filter((p) => hasRepoExport(p.id)).map((p) => { const e = exportText(store, 'orchestrator', p.id); return { rel: rel(orchestratorPath(p.id)), text: e.text, builds: e.doc.builds.length }; });
}
/**
 * Repo exports (_claude/builds/profiles/<id>/orchestrator.json) of profiles that are not repo-registered: our own
 * projections an older version wrote (test-sandbox, Nov 13 2026) or a merge brought back. Removed, so the checkout
 * stays clean and check-profiles.mjs passes; only files carrying the $export note are touched, never a hand-made one.
 */
function sweepStaleRepoExports(ex) {
  const root = scratchDir() || REPO_ROOT;
  const dir = join(root, '_claude/builds/profiles');
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const id of readdirSync(dir)) {
    const f = join(dir, id, 'orchestrator.json');
    if (hasRepoExport(id) || !existsSync(f)) continue;
    if (!readJson(f)?.$export) continue;
    rmSync(f, { force: true });
    delete ex[f];
    try { if (!readdirSync(join(dir, id)).length) rmSync(join(dir, id), { recursive: true }); } catch { /* not empty */ }
    removed.push(rel(f));
  }
  return removed;
}
/** The store file's text (compact form), as saveStore writes it. */
export const storeText = (store) => `${JSON.stringify(core.compactStore(store), null, 1)}\n`;
function exportAll(store) {
  const ex = readExports();
  // entries of the retired orchestrator.json export are dropped (the file itself is never touched again)
  for (const [f, e] of Object.entries(ex)) if (e?.kind === 'orchestrator') delete ex[f];
  for (const t of exportTargets()) {
    const e = exportText(store, t.kind, t.profile);
    // Nothing to export (e.g. a profile without a queue) but the file exists: it was absorbed just before this, so
    // record it as seen. Unrecorded, it read as a foreign write forever and every read took the lock to absorb it.
    if (!e) { const s = sig(t.file); if (s) ex[t.file] = { sig: s, kind: t.kind, profile: t.profile, rev: store.rev }; continue; }
    const { text } = e;
    let old = ''; try { old = readFileSync(t.file, 'utf8'); } catch { /* new */ }
    if (old !== text) writeKeepingOwner(t.file, text);
    ex[t.file] = { sig: sig(t.file), kind: t.kind, profile: t.profile, rev: store.rev };
  }
  sweepStaleRepoExports(ex);
  // a build worktree's data home has no store file once the store is on axf-data, so nothing made its folder yet: without
  // it every store read from a new worktree died here (ENOENT) and no hand build could tick a step
  mkdirSync(dirname(exportsFile()), { recursive: true });
  writeFileSync(exportsFile(), `${JSON.stringify(ex, null, 1)}\n`);
}
/**
 * Write in place, so an existing file keeps its owner and mode (the hub's files belong to the console's user; a
 * root session must not lock it out). A new file (and new folders) get the owner of the nearest existing folder.
 */
function writeKeepingOwner(f, text) {
  let d = dirname(f); const made = [];
  while (!existsSync(d)) { made.unshift(d); d = dirname(d); }
  for (const m of made) mkdirSync(m);
  const fresh = !existsSync(f);
  writeFileSync(f, text);
  if (process.getuid?.() === 0) { try { const st = statSync(d); for (const x of [...made, ...(fresh ? [f] : [])]) chownSync(x, st.uid, st.gid); if (fresh) chmodSync(f, 0o664); } catch { /* best effort */ } }
}
/**
 * Fold the retired profiles into `all` in the store file itself (Brett, Nov 7 2026: one profile for everything).
 * Reads are already healed in memory (normBuild); this writes the merge for good, in each old profile's order, with
 * `fromProfile`, a note and `priority: 'P0'` on Urgent's builds. Works on the raw file because a normalized read has
 * already folded the profiles. Idempotent: a store with no retired profile left is not touched.
 */
export function mergeRetiredNow({ by = 'profiles-merge' } = {}) {
  // cutover: the file is no longer the store (and the profiles were merged long before the cut, which copied the result)
  if (remoteOn()) return { changed: 0, report: null };
  const f = storeFile(); const unlock = lock(f);
  try {
    if (!existsSync(f)) return { changed: 0, report: null };
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    const retired = core.RETIRED_PROFILES.filter((p) => (raw.builds ?? []).some((b) => (b.profiles ?? []).includes(p)) || [raw.rules, raw.meta?.queue, raw.meta?.pending, raw.drafts].some((m) => m?.[p] !== undefined));
    if (!retired.length) return { changed: 0, report: null };
    const { store: merged, report } = core.mergeProfiles({ ...raw, builds: (raw.builds ?? []).map((b) => ({ ...b, order: { ...(b.order ?? {}) }, profiles: [...(b.profiles ?? [])], notes: [...(b.notes ?? [])] })) }, core.RETIRED_PROFILES, core.MERGED_PROFILE);
    const before = readStore();
    const after = keepStore(before, healOrigins(core.normalizeStore(merged)));
    const saved = saveStore(before, after, { by, action: 'merge-profiles', note: `${report.from.map((p) => `${p.id} (${p.builds})`).join(', ')} → ${report.into}: ${report.moved} build(s)` });
    if (exportsOn()) exportAll(saved.store);
    return { changed: saved.changes.length, report, store: saved.store };
  } finally { unlock(); flushLiveSoon(); }
}

/**
 * done-means-merged@1 migration (framework/core/build-pipeline.mjs migrateDoneStore), once: built / complete records with
 * no merged PR go back to landing / fixing with a note each; `meta.doneMeansMerged` records the run so a second call is
 * a no-op ({ already }). Dry: nothing written, the report only.
 */
export function migrateDoneNow({ dry = true, by = 'done-means-merged', at = new Date().toISOString() } = {}) {
  if (dry) { const s = loadStore(); const r = migrateDoneStore(s, { at }); return { report: r.report, already: s.meta?.doneMeansMerged ?? null }; }
  let report = null; let already = null;
  const r = withStore((s) => {
    if (s.meta?.doneMeansMerged) { already = s.meta.doneMeansMerged; report = { $axf: 'done-means-merged@1', at, moved: [], unprovable: [] }; return s; }
    const m = migrateDoneStore(s, { at }); report = m.report; return m.store;
  }, { by, action: 'done-means-merged', note: 'built / complete without a merged PR → landing / fixing (done-means-merged@1)' });
  return { report, already, rev: r.rev, changes: r.changes.length };
}

/** Write every export now (after the migration, or by hand: `builds-store.mjs export`). */
/** Regenerate the exports. cutover: from the record the tables assemble, no file lock (the store file is not the store). */
export function exportNow() { if (remoteOn()) { exportAll(readStore()); return; } const f = storeFile(); const unlock = lock(f); try { exportAll(readStore()); } finally { unlock(); } }

/** Bytes a journal file may reach (AXF_BUILDS_JOURNAL_BYTES moves it for tests). */
export const journalMax = () => Number(process.env.AXF_BUILDS_JOURNAL_BYTES) || merge.JOURNAL_PART_BYTES;

/** A folder made with the owner and group of its nearest existing parent (the hub's belong to deploy, not root). */
function ensureDirKeepingOwner(d) {
  if (existsSync(d)) return;
  let p = dirname(d); const made = [];
  for (let x = d; !existsSync(x); x = dirname(x)) made.unshift(x);
  for (const m of made) mkdirSync(m);
  p = dirname(made[0]);
  if (process.getuid?.() === 0) { try { const st = statSync(p); for (const m of made) chownSync(m, st.uid, st.gid); } catch { /* best effort */ } }
}

/** The hash a build's `journalHash` holds: its stored form, without the hash itself. */
const journalHashOf = (b) => { const { journalHash, ...rest } = core.compactBuild(b); return JC.hashOf(rest); };
/** A build's full copy goes into the journal every this many of its revisions (AXF_BUILDS_JOURNAL_FULL moves it; 1 = always whole). */
export const journalFullEvery = () => Number(process.env.AXF_BUILDS_JOURNAL_FULL) || JC.FULL_EVERY;

/** One write's journal line. `entry` is the whole record (published live), `stored` what the journal keeps (slimEntry). */
function journal(entry, stored = entry) {
  const line = `${JSON.stringify(stored)}\n`;
  const mode = storeMode();
  // cutover: the line went with the store write (writeStoreRemote, one transaction); nothing is written here
  if (mode !== 'cutover') {
    const d = journalDir(); ensureDirKeepingOwner(d);
    // one lock per journal folder, shared by every checkout on the machine (the hub home is shared by all of them)
    const unlock = testJournal() ? () => {} : lock(join(d, '.journal'));
    let part;
    try {
      // part sizes count the old repo copies too, so the hub continues the numbering instead of reopening a full part
      const sizes = Object.fromEntries(Object.entries(journalParts()).map(([k, p]) => [k, p.size]));
      part = merge.journalPart(entry.at.slice(0, 7), sizes, Buffer.byteLength(line), journalMax());
      const f = join(d, `${part}.jsonl`);
      const fresh = !existsSync(f);
      if (fresh) writeKeepingOwner(f, line); else appendFileSync(f, line);
      // a new part is the moment old ones are put away (gzip of parts older than 30 days); never fails the write
      if (fresh) { try { rotateJournal({ apply: true, dir: d, locked: true }); } catch { /* next new part tries again */ } }
    } finally { unlock(); }
    // the axf-data key is the part's own (builds/journal/<part>) wherever the part lives (hub home, spool, repo)
    const key = testJournal() ? files.keyFor(join(d, `${part}.jsonl`)) : `builds/journal/${part}`;
    if (mode === 'shadow' && key) remoteJournal(key, stored, true);
  }
  // every change to a build goes live to main (builds-live.mjs); draft-only writes stay local
  if (entry.builds?.length) enqueueLive(entry);
}

/**
 * Put away journal parts older than `days` (B4-07): `<part>.jsonl` → `<part>.jsonl.gz` in the same folder, the copy
 * checked byte for byte before the plain file is removed. A part's age is its newest line (the file's mtime). Readers
 * (history, restore, journalPartText, verifyJournal) read both forms. Dry run unless `apply`. Local files only: on
 * axf-data the journal is rows of the `journal` table. → { apply, days, rotated: [{ part, bytes, gzBytes }], kept }
 */
export function rotateJournal({ apply = false, days = 30, dir = journalDir(), now = Date.now(), locked = false } = {}) {
  const out = { apply, days, dir, rotated: [], kept: 0 };
  if (!existsSync(dir)) return out;
  const unlock = !apply || locked || testJournal() ? () => {} : lock(join(dir, '.journal'), 60000);
  try {
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
      const f = join(dir, name); const st = statSync(f);
      if (now - st.mtimeMs < days * 86400000) { out.kept += 1; continue; }
      const buf = readFileSync(f); const gz = gzipSync(buf, { level: 9 });
      if (apply) {
        const g = `${f}.gz`; const tmp = `${g}.tmp-${process.pid}`;
        writeKeepingOwner(tmp, gz);
        if (!gunzipSync(readFileSync(tmp)).equals(buf)) { rmSync(tmp, { force: true }); throw new Error(`journal rotate: ${name} did not read back the same, left as it was`); }
        renameSync(tmp, g); rmSync(f);
      }
      out.rotated.push({ part: name.slice(0, -6), bytes: buf.length, gzBytes: gz.length });
    }
  } finally { unlock(); }
  return out;
}

/**
 * Take a store that came from main (builds-live pull) without a journal line or a new rev: it is not a change made here,
 * only main's newer builds arriving. `journals` = { 'YYYY-MM': text } replaces those journal files (already the union).
 */
export function adoptStore(next, { journals = {} } = {}) {
  // cutover: axf-data is the store and main's git copy a projection of it. A build main holds NEWER (per build and per
  // step, builds-merge-core) was written by a session on code from before the cut (it still writes its own copy and
  // publishes it to main through builds-live): those builds go into the tables as one row-level patch, so no tick made
  // during the changeover is lost. Nothing older than the tables is ever taken back. rollback: writes wait.
  if (remoteOn()) { if (storeMode() === 'cutover') adoptRemote(next); return; }
  const f = storeFile(); const unlock = lock(f);
  try {
    // build-hook@1: builds changed in another checkout (a build session's worktree) arrive here, not through saveStore;
    // their events fire now, so the ledger hears about ticks, PRs and shipped manifests made elsewhere (ids are the
    // writer's revs, so an event a listener already took is skipped)
    let before = null; try { before = existsSync(f) ? normKeeping(JSON.parse(readFileSync(f, 'utf8'))) : null; } catch { /* unreadable: nothing to compare */ }
    if (before) { assertWritable(before); keepStore(before, next); }
    // done-means-merged@1: a status that arrives as landed / built / complete without the evidence is refused here too
    if (before) next = core.enforceDoneGuard(before, next, { by: 'builds-live' }).store;
    if (before) { const changes = adoptedChanges(before, next); if (changes.length) emitChanges(changes, { at: new Date().toISOString(), by: 'builds-live' }); }
    healOrigins(next);
    const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, storeText(next)); renameSync(tmp, f);
    foldOrigins(next);
    const d = journalDir(); mkdirSync(d, { recursive: true });
    for (const [m, text] of Object.entries(journals)) writeFileSync(join(d, `${m}.jsonl`), text);
    if (exportsOn()) exportAll(next);
  } finally { unlock(); }
}
/*
 * cutover (Pipeline 2.0, Nov 19 2026): there is no store.json projection any more. The console checkout's file is not
 * rewritten after a write; every reader asks the builds store itself (this module's loadStore in Node, the console
 * server's data_store.read_json in Python, both on the axf-data tables). The last copy of the file was kept at
 * /root/axf-backups/store.json.final-20261119T024709Z.
 */
/** cutover adopt: main's newer builds → the tables (withStore: row-level patch, re-read on a conflict). The ids taken. */
export function adoptRemote(next) {
  let taken = [];
  withStore((s) => { const m = merge.mergeStores(s, normKeeping(next)); taken = m.taken; return m.taken.length ? m.store : s; }, { by: 'builds-live', action: 'adopt', note: 'newer on main (a writer from before the cut)' });
  return taken;
}
/** The builds that differ between the store on disk and one taken from elsewhere, as diffStores changes (nothing mutated). */
export function adoptedChanges(before, next) {
  const old = new Map((before?.builds ?? []).map((b) => [b.id, b]));
  const out = [];
  for (const b of next?.builds ?? []) {
    const o = old.get(b.id);
    if (o && JSON.stringify(core.compactBuild(o)) === JSON.stringify(core.compactBuild(b))) continue;
    out.push({ id: b.id, op: !o ? 'add' : b.deleted && !o.deleted ? 'delete' : !b.deleted && o.deleted ? 'restore' : 'change', before: o ?? null, after: b });
  }
  return out;
}
/** The store as it is on disk now (no foreign-write absorb). */
export const readStoreNow = () => readStore();

/** Save a new store state. Every write is versioned: store rev + 1, changed builds rev + 1, one journal line. */
export function saveStore(before, after, { by = 'cli', action = 'write', note = '' } = {}) {
  // step-dedupe guard: whatever wrote a build's steps (absorb, merge, split, add-step), a step is stored once
  { const prev = new Map((before?.builds ?? []).map((b) => [b.id, b]));
    const touched = (after?.builds ?? []).filter((b) => JSON.stringify(b.steps) !== JSON.stringify(prev.get(b.id)?.steps)).map((b) => b.id);
    if (touched.length) { const d = core.dedupeStoreSteps(after, { ids: touched }); for (const r of d.report) process.stderr.write(`builds-store: ${r.id} had repeated steps: ${r.before} → ${r.after}\n`); } }
  // S5-01: a checkout older than the store must not write it (it would write the builds back without what it does not know)
  assertWritable(before);
  const now = new Date().toISOString();
  const changes = core.diffStores(before, after, now);
  const draftChanged = JSON.stringify(before.drafts) !== JSON.stringify(after.drafts);
  const metaChanged = JSON.stringify([before.meta, before.rules]) !== JSON.stringify([after.meta, after.rules]);
  if (!changes.length && !draftChanged && !metaChanged) return { store: before, changes: [], rev: before.rev };
  // each changed build is stored (and journalled) in the shape every later read gives it, so the next write's diff
  // starts from exactly what this journal line holds (B4-07: a journal diff is only as good as its base)
  // `journalHash` on a build = the hash of the record as its last journal line left it. A build whose record no longer
  // matches (changed by a whole-record put, by a writer from before the diffs, by a heal on read) is journalled whole.
  const chained = new Set();
  { const at = new Map(after.builds.map((b, i) => [b, i]));
    for (const c of changes) if (c.after && at.has(c.after)) {
      const shaped = keepBuild(c.after, core.normBuild(c.after, { now }));
      if (c.before?.journalHash && c.before.journalHash === journalHashOf(c.before)) chained.add(c.id);
      shaped.journalHash = journalHashOf(shaped);
      after.builds[at.get(c.after)] = shaped; c.after = shaped;
    } }
  after.rev = (before.rev ?? 0) + 1; after.updatedAt = now; after.storeVersion = STORE_VERSION;
  const entry = { rev: after.rev, at: now, by, action, note, builds: changes.map((c) => ({ id: c.id, op: c.op, rev: c.after?.rev, before: core.compactBuild(c.before), after: core.compactBuild(c.after) })), ...(draftChanged ? { drafts: after.drafts } : {}), ...(metaChanged ? { meta: after.meta, rules: after.rules } : {}) };
  // B4-07: the stored line holds a diff of each changed build (a full copy every FULL_EVERY revisions); `entry` stays
  // whole for the live publish and the hooks
  const line = JC.slimEntry(entry, { fullEvery: journalFullEvery(), chained: (c) => chained.has(c.id) });
  if (remoteOn()) writeStoreRemote(before, after, changes, line, { draftChanged, metaChanged });
  else { const f = storeFile(); mkdirSync(dirname(f), { recursive: true }); writeStoreFile(f, after); }
  foldOrigins(after);
  journal(entry, line);
  // build-hook@1: every creator's write fires the same events (Shipped features ledger and other listeners)
  if (changes.length) emitChanges(changes, { at: now, by });
  return { store: after, changes, rev: after.rev };
}

/** Read, change, save under a lock. fn(store) returns the new store (or { store, ...extra }). */
export function withStore(fn, meta = {}) {
  if (remoteOn()) {
    for (let i = 0; ; i += 1) {
      try { const r = withStoreOnce(fn, meta); flushLiveSoon(); return r; }
      catch (e) { if (!(e instanceof StoreConflict) || i >= 4) throw e; }
    }
  }
  const unlock = lock(storeFile(), meta.lockWaitMs);
  try { return withStoreOnce(fn, meta); } finally { unlock(); flushLiveSoon(); }
}
function withStoreOnce(fn, meta) {
  const before = readStore();
  const foreign = [];
  const base = exportsOn() ? keepStore(before, absorbForeign(normKeeping(JSON.parse(JSON.stringify(before))), foreign)) : before;
  if (foreign.length) saveStore(before, base, { by: 'foreign-write', action: 'absorb', note: foreign.join('; ') });
  const start = foreign.length ? readStore() : before;
  const r = fn(normKeeping(JSON.parse(JSON.stringify(start))));
  return guardAndSave(start, r, meta, { foreign });
}
/** The guards every write passes (done-means-merged@1, pipeline-2@1, the demo guard), then the save. `row`: a one-build store (withBuild). */
function guardAndSave(start, r, meta, { foreign = [], row = false } = {}) {
  const guarded = core.enforceDoneGuard(start, r && r.$axf ? r : r.store, { by: meta.by || 'cli' });
  // pipeline-2@1 (framework/spec/PIPELINE-2.md): the contract on every Pipeline 2.0 build and step (forward-only, the
  // attempt ceiling, the archive rule, fixed steps). A refusal is strict: nothing of this write is kept for that build
  // (the record stays as it was, plus one note), it is logged here and in the journal line, and comes back in `refused`
  // (setFlowStatus throws on it); meta.strict === false keeps the content and drops only the status. A hand-made legal
  // move gets its at / by
  const flowed = P2.enforceFlow(start, guarded.store, { by: meta.by || 'cli', strict: meta.strict !== false });
  // S5-01: whatever fn, the guards or a merge rebuilt, a stored field this checkout does not know stays on its record
  const next = stripView(keepStore(start, flowed.store));
  // numbers come from the store's high-water mark and every other build's number: a whole-store write gives them
  if (!row) giveNumbers(start, next);
  if (flowed.refused.length) {
    const text = flowed.refused.map((x) => `refused ${x.id}${x.step ? `/${x.step}` : ''} ${x.from || '(none)'} → ${x.to || '(none)'}: ${x.why}`);
    process.stderr.write(text.map((t) => `builds-store: ${t}\n`).join(''));
    meta = { ...meta, note: clip([meta.note, ...text].filter(Boolean).join(' · '), 2000) };
  }
  // demo-build@1: a demo write (meta.demo, the live demo's acts) may touch demo builds only; anything else is refused whole
  if (meta.demo === true) { const bad = core.demoViolations(start, next); if (bad.length) throw new DemoGuardError(`demo action refused: ${bad.map((x) => x.id).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not demo build(s) (id prefix ${core.DEMO_PREFIX}, tag demo: true)`, { builds: bad.map((x) => x.id), action: meta.action || '' }); }
  if (guarded.refused.length) process.stderr.write(guarded.refused.map((x) => `builds-store: refused ${x.id} ${x.from} → ${x.to}: ${x.why}\n`).join(''));
  const saved = saveStore(start, next, meta);
  if (exportsOn() && !row) exportAll(saved.store);
  return { ...(r && r.$axf ? {} : r), store: saved.store, changes: saved.changes, rev: saved.rev, foreign, refused: [...guarded.refused, ...flowed.refused], flowRefused: flowed.refused };
}

// ------------------------------------------------------------------ one build as one row (pipeline status, Nov 25 2026)
/*
 * A build's status is its row in the store, and nothing reads the whole record to learn or change one
 * (framework/spec/DATA-INVENTORY.md → Pipeline status). On axf-data (cutover) these are data-store@1 calls on the one
 * row: `item` (data-item@1: the build with its steps and notes, plus the store's scalar head fields) and `patch`
 * (data-patch@1 with that build's ifRev, the head's rev and the journal line, one transaction), and `summary`
 * (pipeline-summary@1: counts by status, the queued build, the running builds, computed in SQL). In local and shadow
 * mode the file is the store, so the same functions answer from it.
 */
/** Statuses of a build somebody is working on right now (services/axf-data/tables.py RUNNING_STATUSES, the same list). */
export const SUMMARY_RUNNING = Object.freeze(['running', 'fixing', 'landing', 'splitting', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']);
const SUMMARY_PIPELINE = ['slot', 'account', 'session', 'model', 'queuedAt', 'queuedBy', 'heldAt', 'heldBy', 'heldWhy'];
/** What a list shows of one build (tables.py summary_row): never steps, notes or the origin. */
export function summaryRow(b) {
  const pl = b?.pipeline && typeof b.pipeline === 'object' ? b.pipeline : {};
  return { id: str(b?.id), number: str(b?.number), title: str(b?.title), status: str(b?.status), priority: str(b?.priority), pr: ['string', 'number'].includes(typeof b?.pr) ? b.pr : '', branch: str(b?.branch), rev: Number.isInteger(b?.rev) ? b.rev : null, updatedAt: str(b?.updatedAt), statusAt: str(b?.statusAt), statusBy: str(b?.statusBy), ...Object.fromEntries(SUMMARY_PIPELINE.map((k) => [k, str(pl[k])])) };
}
/** pipeline-summary@1 from a list of builds: the answer axf-data computes in SQL (tables.py _summary), for a store that is a file. */
export function summaryOf(builds) {
  const items = (builds ?? []).filter((b) => b && typeof b === 'object' && b.deleted !== true);
  const counts = {};
  for (const b of items) counts[str(b.status)] = (counts[str(b.status)] ?? 0) + 1;
  const live = items.filter((b) => b.status === 'queued' || SUMMARY_RUNNING.includes(b.status)).map(summaryRow);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const queued = live.filter((r) => r.status === 'queued').sort((a, b) => cmp(a.queuedAt || a.updatedAt || '~', b.queuedAt || b.updatedAt || '~') || cmp(a.id, b.id));
  const running = live.filter((r) => r.status !== 'queued').sort((a, b) => cmp(a.slot || '~', b.slot || '~') || cmp(a.id, b.id));
  return { $axf: 'pipeline-summary@1', total: items.length, counts: Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]])), queued: queued[0] ?? null, queuedAll: queued, running };
}
/** The pipeline's status: counts by status, the queued build, the running builds with slot and account. No document read on axf-data. */
export function pipelineSummary() {
  if (remoteOn()) return files.callSync({ op: 'summary', key: storeKey() });
  const s = readStore();
  return { ...summaryOf(s.builds), rev: s.rev ?? 0, at: str(s.updatedAt) };
}
/** A one-build store from a data-item@1 answer: the build as every read shapes it, under the store's scalar head. */
function rowStore(r) { return healOrigins(normKeeping({ ...core.emptyStore(), ...(r.head ?? {}), builds: [r.item] })); }
/**
 * One build by its id, as the store holds it (no `pipelineView`: that is worked out over every build), or null.
 * On axf-data: its row with its steps and notes, never the document.
 */
export function readBuild(id) {
  if (!remoteOn()) return readStore().builds.find((b) => b.id === id) ?? null;
  const r = files.callSync({ op: 'item', key: storeKey(), id: String(id ?? '') });
  return r ? rowStore(r).builds[0] ?? null : null;
}
/**
 * Read one build, change it, save it: fn(build) changes it in place or returns the new record. Every guard of a store
 * write applies (done-means-merged@1, pipeline-2@1, the demo guard), the write is versioned and journalled the same.
 * On axf-data the one row is read and patched (ifRev of that build; a conflict re-reads and re-applies); the pending
 * and queue exports follow at the next whole read. The whole store is used instead when the file is the store, when
 * `id` is not a row's own key, and for the one move whose rule looks at other builds (an archived Pipeline 2.0 build
 * coming back). → { build, changes, rev, refused, flowRefused, row }
 */
export function withBuild(id, fn, meta = {}) {
  const whole = () => {
    const r = withStore((s) => {
      const b = core.findBuild(s, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 'not_found' });
      const out = fn(b); if (out && out !== b) s.builds[s.builds.indexOf(b)] = out;
      return s;
    }, meta);
    return { build: core.findBuild(r.store, id), changes: r.changes, rev: r.rev, refused: r.refused, flowRefused: r.flowRefused, row: false };
  };
  if (storeMode() !== 'cutover') return whole();
  for (let i = 0; ; i += 1) {
    try { const r = withBuildOnce(id, fn, meta); if (!r) return whole(); flushLiveSoon(); return r; }
    catch (e) { if (!(e instanceof StoreConflict) || i >= 4) throw e; }
  }
}
function withBuildOnce(id, fn, meta) {
  const got = files.callSync({ op: 'item', key: storeKey(), id: String(id ?? '') });
  if (!got) return null;
  const start = rowStore(got);
  if (start.builds.length !== 1 || start.builds[0].id !== id) return null;
  const copy = normKeeping(JSON.parse(JSON.stringify(start)));
  const out = fn(copy.builds[0]); if (out && out !== copy.builds[0]) copy.builds[0] = out;
  if (copy.builds[0]?.id !== id) throw new Error(`withBuild: ${id} is the build this write changes, not ${copy.builds[0]?.id ?? 'none'}`);
  const was = start.builds[0];
  if ((P2.isP2(was) || P2.isP2(copy.builds[0])) && was.status === P2.EXIT && copy.builds[0].status !== P2.EXIT) return null;
  remoteEtag = `row-${got.rev}`; // the store exists on axf-data: the write is a patch of this row
  const r = guardAndSave(start, copy, meta, { row: true });
  return { build: r.store.builds.find((b) => b.id === id) ?? null, changes: r.changes, rev: r.rev, refused: r.refused, flowRefused: r.flowRefused, row: true };
}

// ------------------------------------------------------------------ pipeline-2@1: one status change, forward-only

export class FlowRefused extends Error { constructor(m, d = {}) { super(m); this.code = 'backward'; Object.assign(this, d); } }
/**
 * Move a Pipeline 2.0 build (or one of its steps, `step` = id or uid) to `to` through the contract, under the store
 * lock: at / by / attempt / log recorded, `extra` merged on success (account, slot, prNumber, worktree…). A move the
 * contract refuses throws FlowRefused (code 'backward') and writes nothing; the refusal is logged on stderr.
 * `mutate(build, store)` may change more of the build in the same write; when the store's guard refuses any of it (a
 * step removed from a split build…) nothing is kept and FlowRefused is thrown as well.
 *   reset: true    leave `failed` past the attempt ceiling, as attempt 1 (needs `why`: Brett's retry, an escalation)
 *   resplit: true  split a waiting build again (`to` = split, no step past pending, needs `why`); `mutate` sets the steps
 * → { build, step, rev }
 */
export function setFlowStatus(id, to, { step = '', by = 'pipeline', why = '', extra = null, mutate = null, action = 'flow-status', reset = false, resplit = false } = {}) {
  let out = null;
  const move = (b, s) => {
    const at = new Date().toISOString();
    if (step) {
      const i = b.steps.findIndex((x) => x.id === step || x.uid === step);
      if (i < 0) throw Object.assign(new Error(`no step "${step}" in ${id}`), { code: 'not_found' });
      const t = P2.transition(b.steps[i], to, { at, by, why, kind: 'step', extra, reset });
      if (!t.ok) { process.stderr.write(`builds-store: refused ${id}/${step} ${b.steps[i].status || '(none)'} → ${to}: ${t.why}\n`); throw new FlowRefused(`${id}/${step}: ${t.why}`, { id, step, from: b.steps[i].status, to }); }
      b.steps[i] = { ...t.rec, ...(t.rec.done && !b.steps[i].doneAt ? { doneAt: at } : {}), updatedAt: at, rev: (b.steps[i].rev ?? 1) + (t.same ? 0 : 1) };
    } else {
      const t = P2.transition(b, to, { at, by, why, kind: 'build', extra, reset, resplit });
      if (!t.ok) { process.stderr.write(`builds-store: refused ${id} ${b.status || '(none)'} → ${to}: ${t.why}\n`); throw new FlowRefused(`${id}: ${t.why}`, { id, from: b.status, to }); }
      for (const k of ['failedFrom', 'archivedFrom']) if (!(k in t.rec)) delete b[k]; // cleared by the move
      Object.assign(b, t.rec);
    }
    if (mutate) mutate(b, s);
    b.updatedAt = at;
  };
  const meta = { by, action, note: clip(`${id}${step ? `/${step}` : ''} → ${to}${why ? `: ${why}` : ''}`, 500) };
  // a status change of one build is a write of its one row; a `mutate` that asks for the store gets the whole of it
  const r = mutate && mutate.length > 1
    ? withStore((s) => { const b = core.findBuild(s, id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 'not_found' }); move(b, s); return s; }, meta)
    : withBuild(id, (b) => { move(b, null); }, meta);
  const b = r.store ? core.findBuild(r.store, id) : r.build;
  const no = (r.flowRefused ?? []).filter((x) => x.id === b?.id);
  if (no.length) throw new FlowRefused(`${id}${step ? `/${step}` : ''}: ${no.map((x) => x.why).join('; ')}`, { id, step, to, refused: no });
  out = { build: b, step: step ? b.steps.find((x) => x.id === step || x.uid === step) : null, rev: r.rev };
  return out;
}

// ------------------------------------------------------------------ migration sources

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const rel = (f) => f.startsWith(REPO_ROOT) ? f.slice(REPO_ROOT.length + 1) : f;
function gitHistoryItems(file, max = 400) {
  try {
    const commits = execFileSync('git', ['log', '--all', '--format=%h', `-n${max}`, '--', file], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
    const seen = new Map();
    for (const c of commits) {
      let j = null; try { j = JSON.parse(execFileSync('git', ['show', `${c}:${file}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { continue; }
      for (const it of j?.items ?? []) if (it?.id && !seen.has(it.id)) seen.set(it.id, { it, commit: c });
    }
    // newest commit first, so each id keeps its latest version
    const byCommit = new Map();
    for (const { it, commit } of seen.values()) { if (!byCommit.has(commit)) byCommit.set(commit, []); byCommit.get(commit).push(it); }
    return [...byCommit.entries()].map(([commit, items]) => ({ file, commit, items }));
  } catch { return []; }
}

/** Every older data set, per registered profile (and every profile folder on disk, registered or not). */
export function gatherSources({ history = true } = {}) {
  const reg = readProfiles();
  const ids = new Set(reg.profiles.map((p) => p.id));
  for (const d of [join(REPO_ROOT, '_claude/builds/profiles'), join(REPO_ROOT, 'framework/plan/profiles')]) if (existsSync(d)) for (const x of readdirSync(d)) if (core.slug(x) === x && !core.RETIRED_PROFILES.includes(x)) ids.add(x);
  // a retired profile's folder that a merge brought back (Nov 10 2026: breakroom, re-added by a leftover-work commit) is
  // not a source: its builds were folded into the base profile, and checking it again failed every PR's light checks
  const hub = persistRoot();
  const profiles = [];
  for (const id of [BASE_PROFILE, ...[...ids].filter((x) => x !== BASE_PROFILE)]) {
    // a build worktree's exports are on the hub with its store (worktreeHome), not the checkout's stale copies
    const orchFile = worktreeHome() && hasRepoExport(id) ? join(worktreeHome(), rel(orchestratorPath(id))) : orchestratorPath(id);
    const pRel = profileRel(id, 'framework/plan/pending.json');
    const qRel = profileRel(id, 'framework/plan/build-queue.json');
    const planRel = profileRel(id, 'framework/plan/plan.json');
    const pending = [];
    for (const f of [join(REPO_ROOT, pRel), ...(hub ? [join(hub, pRel)] : [])]) { const s = readJson(f); if (s) pending.push({ file: f.startsWith(REPO_ROOT) ? `repo:${pRel}` : `hub:${pRel}`, state: s }); }
    const qHub = hub ? readJson(join(hub, qRel)) : null; const qRepo = readJson(join(REPO_ROOT, qRel));
    const queue = (qHub?.order?.length ?? -1) >= (qRepo?.order?.length ?? -1) ? qHub ?? qRepo : qRepo;
    const plan = (hub ? readJson(join(hub, planRel)) : null) ?? readJson(join(REPO_ROOT, planRel));
    profiles.push({
      id, orchFile: rel(orchFile), orch: readJson(orchFile), pending, queue, queueFile: `${queue === qHub ? 'hub' : 'repo'}:${qRel}`,
      features: (plan?.features ?? []).filter((f) => f.kind === 'epic'),
      history: history ? gitHistoryItems(pRel) : [],
      registered: reg.profiles.some((p) => p.id === id),
    });
  }
  return { profiles };
}

export function migrateNow({ dry = false, by = 'migration', sources = gatherSources() } = {}) {
  const { store, report } = core.migrate(sources);
  const checks = core.verifyNothingLost(sources, store);
  report.verify = { total: checks.length, failed: checks.filter((c) => !c.ok) };
  if (!dry) {
    const f = storeFile();
    if (existsSync(f) && !process.env.AXF_BUILDS_STORE) throw new Error(`${STORE_REL} exists already: the migration runs once (use restore/history for changes)`);
    const unlock = lock(f);
    try { const r = saveStore(core.emptyStore(), store, { by, action: 'migrate', note: `migrated ${store.builds.length} builds from ${sources.profiles.length} profiles` }); if (exportsOn()) exportAll(r.store); } finally { unlock(); }
  }
  return { store, report, sources };
}

export function dryRunMarkdown({ store, report, sources }) {
  const L = [];
  L.push('# Urgent master cleanup — migration dry run', '');
  L.push(`Generated ${report.at} by \`node framework/cli/builds-store.mjs migrate --dry\`. Nothing was written. Store: \`${STORE_REL}\` (builds@1).`, '');
  L.push('## What goes in', '', '| Profile | Registered | Orchestrator builds | Pending items (union) | merged into a build | new records | Queue epics | merged | Recovered from git | Records in the profile |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const p of report.profiles) { const src = sources.profiles.find((x) => x.id === p.id); L.push(`| ${p.id} | ${src?.registered ? 'yes' : '**no**'} | ${p.orchestrator} | ${p.pendingItems} | ${p.pendingMerged} | ${p.pendingNew} | ${p.queueEpics} | ${p.queueMerged} | ${p.recovered} | ${report.counts.byProfile[p.id]} |`); }
  L.push('', `**Total: ${report.counts.builds} build records, ${report.counts.steps} step records.** One record per build; a build that was in several profiles is one record tagged with each.`, '');
  L.push('## Files read', '');
  for (const p of sources.profiles) { L.push(`- **${p.id}**: \`${p.orchFile}\` (${p.orch?.builds?.length ?? 'missing'} builds); ${p.pending.map((x) => `\`${x.file}\` (${x.state?.items?.length ?? 0})`).join(', ') || 'no pending list'}; queue \`${p.queueFile}\` (${p.queue?.order?.length ?? 'missing'} in order); ${p.features.length} plan epics; git history: ${p.history.length} commit(s) with items`); }
  L.push('', `## Merges and dedupes (${report.merges.length})`, '');
  for (const m of report.merges) L.push(`- \`${m.id}\`: ${m.what}`);
  L.push('', `## Conflicts (${report.conflicts.length}) — how each is settled`, '');
  for (const c of report.conflicts) L.push(`- \`${c.id}\` (${c.profile}): ${c.what}`);
  L.push('', `## Recovered from git history (${report.recovered.length})`, '', 'Items that existed in an older commit of a Pending list and are in no current list. They come in **archived** with a note, so nothing reappears as active by surprise.', '');
  for (const r of report.recovered) L.push(`- \`${r.id}\` (${r.profile}) “${r.title}” — from \`${r.from}\``);
  L.push('', '## Refactor build queue', '', 'Git history of `framework/plan/profiles/refactor/framework/plan/build-queue.json` was searched commit by commit: it never held a step (order 0 in every commit). Refactor\'s plan.json never held a feature either, so the console\'s boot-time "Build queue created from the plan" re-created an empty queue each time. The Refactor builds themselves are safe: they are the Refactor orchestrator\'s builds and Pending items, all in the store above. The hub copy of the Refactor Pending list was empty (0 items) while the repo copy had them; the union keeps every one.', '');
  L.push(`## Nothing lost — ${report.verify.total} checks, ${report.verify.failed.length} failed`, '');
  if (report.verify.failed.length) for (const f of report.verify.failed.slice(0, 200)) L.push(`- ✗ ${f.what}`);
  else L.push('Every orchestrator build, step, note and status, every Pending item (repo and hub copies), its steps and notes, and every queued epic is in the store, in its profile.');
  L.push('', '## After the migration', '', '- The old files stay **read-only for one release** as they are now; nothing writes them (`orchestrator.mjs`, `pending.mjs`, `build-queue.mjs`, the console and the MCP tools read and write the store through projections).', '- Every write is versioned: store `rev`, record `rev`, and one line per write in `_claude/builds/journal/` with each changed build before and after (`builds-store.mjs history <id>`, `restore <id> <rev>`).', '- The console no longer re-creates the build queue from the plan on start; a queue is only created when none exists.', '- `orch-sync` (the Orchestrator ↔ Pending bridge) is retired: there is one data set, nothing to sync.', '');
  return L.join('\n');
}

// ------------------------------------------------------------------ journal pointer + migration (builds-journal@1)
export const JOURNAL_POINTER_REL = '_claude/builds/journal.json';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const lineAt = (text, last) => { const ls = text.split('\n').filter((l) => l.trim()); const l = last ? ls[ls.length - 1] : ls[0]; try { return String(JSON.parse(l).at || ''); } catch { return ''; } };
/** The open part of each month: the highest pN that exists (only the current month's can still grow). */
function openParts(keys, now = new Date().toISOString().slice(0, 7)) {
  const n = (k) => Number((k.match(/-p(\d+)$/) || [0, 1])[1]);
  const top = {}; for (const k of keys) { const m = k.slice(0, 7); if (!top[m] || n(k) > n(top[m])) top[m] = k; }
  return new Set(Object.entries(top).filter(([m]) => m >= now).map(([, k]) => k));
}
/** The pointer for the hub home's parts: { $axf, home, dir, updatedAt, storeRev, parts }. */
export function journalPointer(dir = journalHome().dir, { storeRev = null } = {}) {
  const keys = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).sort() : [];
  const open = openParts(keys); const parts = {};
  for (const k of keys) { const buf = readFileSync(join(dir, `${k}.jsonl`)); const t = buf.toString('utf8'); parts[k] = { bytes: buf.length, lines: t.split('\n').filter((l) => l.trim()).length, sha256: sha256(buf), sealed: !open.has(k), firstAt: lineAt(t, false), lastAt: lineAt(t, true) }; }
  return { $axf: 'builds-journal@1', home: 'hub', dir: 'builds/journal', updatedAt: new Date().toISOString(), storeRev, parts };
}
/**
 * Check the hub home against a pointer: every part exists, a sealed part hashes exactly, the open part meets its
 * floor (at least `bytes` long, its first `bytes` hash to `sha256`). → { ok, checked, failed: [why], warning }
 */
export function verifyJournal(pointer, dir = journalHome().dir) {
  if (!pointer || pointer.home !== 'hub') return { ok: true, checked: 0, failed: [], warning: 'journal: still in the repo (no hub pointer)' };
  if (journalMode() !== 'hub' && journalMode() !== 'explicit') return { ok: true, checked: 0, failed: [], warning: 'journal: not checked (hub not mounted)' };
  const failed = [];
  for (const [k, e] of Object.entries(pointer.parts || {})) {
    const f = [join(dir, `${k}.jsonl`), join(dir, `${k}.jsonl.gz`)].find((x) => existsSync(x)); // .gz: rotated (rotateJournal)
    if (!f) { failed.push(`${k}: missing on the hub`); continue; }
    const buf = readPart(f);
    if (e.sealed && (buf.length !== e.bytes || sha256(buf) !== e.sha256)) failed.push(`${k}: sealed part changed (${buf.length} bytes, pointer says ${e.bytes})`);
    if (!e.sealed && (buf.length < e.bytes || sha256(buf.subarray(0, e.bytes)) !== e.sha256)) failed.push(`${k}: open part lost lines (below its floor of ${e.bytes} bytes)`);
  }
  return { ok: !failed.length, checked: Object.keys(pointer.parts || {}).length, failed };
}
/**
 * Move the repo's journal parts to the hub home (once; re-running only adds lines the hub lacks): each part is the
 * union of the repo copy, the hub copy and the stale claude-sync copy (<projects>/<name>/_claude/builds/journal),
 * written in place on the hub, then every repo line is checked to be on the hub and the pointer is written.
 * `--apply` also untracks the parts (git rm --cached; the files stay on disk). → { ok, parts, moved, missing, pointer }
 */
export function migrateJournal({ apply = false } = {}) {
  const h = journalHome(); if (h.mode !== 'hub' && h.mode !== 'explicit') throw new Error('the hub data store is not reachable here: run the migration on the VPS');
  const repo = join(REPO_ROOT, '_claude/builds/journal');
  const stale = join(process.env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_claude/builds/journal');
  const keysOf = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)) : []);
  const keys = [...new Set([...keysOf(repo), ...keysOf(h.dir), ...keysOf(stale)])].sort();
  const read = (d, k) => { try { return readFileSync(join(d, `${k}.jsonl`), 'utf8'); } catch { return ''; } };
  const report = []; const missing = [];
  if (apply) ensureDirKeepingOwner(h.dir);
  const unlock = apply ? lock(join(h.dir, '.journal'), 60000) : () => {};
  try {
  for (const k of keys) {
    // the repo's lines first (the older history), then what only the hub or the stale copy has
    const mine = read(repo, k); const hub = read(h.dir, k);
    const next = merge.mergeJournalText(mine, hub, read(stale, k));
    const add = Buffer.byteLength(next) - Buffer.byteLength(hub);
    if (apply && next !== hub) { const f = join(h.dir, `${k}.jsonl`); const tmp = `${f}.tmp-${process.pid}`; writeKeepingOwner(tmp, next); renameSync(tmp, f); }
    const have = new Set((apply ? read(h.dir, k) : next).split('\n'));
    const lost = mine.split('\n').filter((l) => l.trim() && !have.has(l)).length;
    if (lost) missing.push(`${k}: ${lost} repo line(s) not on the hub`);
    report.push({ part: k, repoBytes: Buffer.byteLength(mine), hubBytes: Buffer.byteLength(next), added: Math.max(0, add) });
  }
  } finally { unlock(); }
  if (!apply) return { ok: !missing.length, dry: true, parts: report, missing };
  if (missing.length) return { ok: false, parts: report, missing };
  const pointer = journalPointer(h.dir, { storeRev: readStore().rev ?? null });
  const v = verifyJournal(pointer, h.dir); if (!v.ok) return { ok: false, parts: report, missing: v.failed };
  writeFileSync(join(REPO_ROOT, JOURNAL_POINTER_REL), `${JSON.stringify(pointer, null, 1)}\n`);
  const tracked = execFileSync('git', ['ls-files', '--', '_claude/builds/journal'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  if (tracked.length) {
    execFileSync('git', ['update-index', '--no-skip-worktree', '--', ...tracked], { cwd: REPO_ROOT });
    execFileSync('git', ['rm', '-q', '--cached', '--', ...tracked], { cwd: REPO_ROOT });
  }
  return { ok: true, parts: report, missing: [], untracked: tracked, pointer: { parts: Object.keys(pointer.parts).length } };
}

/** Restore one build to the state it had at journal revision `rev` (itself a new, journalled write). */
export function journalOf(id) {
  if (remoteOn()) return remoteJournalOf(id);
  return JC.expandHistory(localJournalEntries(id), id);
}
/** Every local journal entry that names build `id` (cut to that build), from the parts in `dirs` or the journal's own. */
function localJournalEntries(id, dirs = null) {
  const out = [];
  const texts = dirs
    ? dirs.flatMap((d) => { try { return readdirSync(d).filter((f) => PART_RE.test(f)).sort().map((f) => readPart(join(d, f)).toString('utf8')); } catch { return []; } })
    : Object.keys(journalParts()).sort().map((key) => journalPartText(key));
  for (const text of texts) for (const line of text.split('\n')) {
    // a cheap test first: a part is tens of MB and most lines are about other builds
    if (!line.trim() || !line.includes(JSON.stringify(id))) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const builds = (e.builds ?? []).filter((b) => b.id === id);
    if (builds.length) out.push({ rev: e.rev, at: e.at, by: e.by, action: e.action, builds });
  }
  return out;
}
/** journalOf on axf-data: every builds/journal/* key, oversized entries read from their record. */
function remoteJournalOf(id) {
  const found = [];
  let after = '';
  const keys = [];
  for (;;) { const l = files.callSync({ op: 'list', ns: 'builds', prefix: 'journal/', after }); keys.push(...l.items.filter((i) => i.kind === 'journal').map((i) => i.path)); if (!l.next) break; after = l.next; }
  for (const path of keys) {
    let since = 0;
    for (;;) {
      const r = files.callSync({ op: 'read', key: `builds/${path}`, since, limit: files.SYNC_READ_PAGE });
      for (const x of r.entries) {
        let e = x.entry;
        if (e.large) { const big = files.callSync({ op: 'get', key: e.large }); if (big) e = big.data; }
        const builds = (e.builds ?? []).filter((b) => b.id === id);
        if (builds.length) found.push({ rev: e.rev, at: e.at, by: e.by, action: e.action, builds });
      }
      if (!r.next) break; since = r.next;
    }
  }
  return JC.expandHistory(found, id);
}
export function restoreBuild(id, rev, by = 'cli') {
  const h = journalOf(id).find((x) => x.rev === Number(rev));
  if (h?.broken) throw new Error(`journal revision ${rev} of ${id} is a diff whose base revision is not in the journal: restore the nearest full copy instead (history marks them)`);
  if (!h?.after) throw new Error(`no journal revision ${rev} for ${id}`);
  return withStore((s) => { s.builds = s.builds.filter((b) => b.id !== id); s.builds.push(keepBuild(h.after, core.normBuild(h.after))); return s; }, { by, action: 'restore', note: `${id} restored to journal rev ${rev}` });
}

/**
 * step-dedupe cleanup: every build with repeated steps collapsed (a done copy wins, order of first appearance), the
 * old collision ids (`s65-64`) put back to `s<n>` where free, one journal revision per build. `apply: false` = the dry
 * run (nothing written). `ids` limits it to some builds; `from` reads which builds had repeats from another copy of
 * the store (each named one is still written, with a newer updatedAt, so every copy's newer-wins merge takes it). Returns { apply, builds: [{ id, before, after, renamed }], total }.
 */
export function dedupeStepsNow({ apply = false, ids = null, by = 'dedupe-steps', from = '' } = {}) {
  const want = ids?.length ? new Set(ids) : null;
  const plan = [];
  // as written, not as read: a read already collapses repeats (normBuild), the file may still hold them
  // `from`: an older copy of the store (a snapshot from before a write already collapsed them) names the builds
  const raw = (() => { try { if (from) return JSON.parse(readFileSync(from, 'utf8')); if (remoteOn()) return files.callSync({ op: 'get', key: storeKey() })?.data ?? null; return existsSync(storeFile()) ? JSON.parse(readFileSync(storeFile(), 'utf8')) : null; } catch { return null; } })();
  for (const b of (raw?.builds ?? []).filter((x) => x && typeof x === 'object' && Array.isArray(x.steps))) {
    if (want && !want.has(b.id)) continue;
    const d = core.dedupeSteps(b.steps);
    const dd = core.dedupeSteps(b.defaultSteps);
    if (!d.dropped && !dd.dropped) continue;
    plan.push({ id: b.id, status: b.status ?? '', before: b.steps.length, after: d.steps.length, renamed: 0 });
  }
  if (apply) for (const row of plan) {
    withStore((s) => {
      const b = core.findBuild(s, row.id); if (!b) return s;
      const r = core.dedupeStoreSteps(s, { ids: [row.id] }).report[0];
      if (r) { row.before = r.before; row.after = r.after; }
      row.renamed = core.tidyStepIds(b);
      // newer than every other copy, so a newer-wins merge (builds-live, absorb) takes the cleaned list; the note is the
      // content change that makes it a journalled write (updatedAt alone is not one)
      const at = new Date().toISOString();
      if (!b.notes.some((x) => x.text.startsWith('Repeated steps collapsed:'))) b.notes.push({ text: `Repeated steps collapsed: ${row.before} → ${row.after} (step-dedupe cleanup).`, at });
      b.updatedAt = at;
      return s;
    }, { by, action: 'dedupe-steps', note: `${row.id}: ${row.before} → ${row.after} steps` });
  }
  const total = { before: plan.reduce((n, r) => n + r.before, 0), after: plan.reduce((n, r) => n + r.after, 0) };
  return { apply, builds: plan, total };
}

/**
 * One-off repair of text damaged by B4-01 (a multi-byte character split at a 64 KB pipe boundary, stored as U+FFFD):
 * every string of every build that holds U+FFFD gets its characters back from the newest journal revision of the same
 * field that is clean (framework/plan/builds-journal-core.mjs repairText: matched by the text around the damage, so
 * only the lost characters change). One journalled write per build. `apply: false` = the dry run. `journalDirs` reads
 * local journal parts instead of the store's own journal (the hub's files are faster than paging axf-data).
 * → { apply, builds: [{ id, fields: [{ path, fixed, left, before, after }] }], fixed, left }
 */
export function repairMojibakeNow({ apply = false, by = 'repair-mojibake', ids = null, journalDirs: dirs = null } = {}) {
  const want = ids?.length ? new Set(ids) : null;
  const report = [];
  for (const b of loadStore().builds) {
    if (want && !want.has(b.id)) continue;
    const bad = JC.damagedStrings(core.compactBuild(b)); if (!bad.length) continue;
    const history = (dirs ? JC.expandHistory(localJournalEntries(b.id, dirs), b.id) : journalOf(b.id)).filter((h) => h.after).reverse();
    const fields = bad.map(({ path, value }) => {
      const r = JC.repairText(value, history.map((h) => JC.valueAt(h.after, path)));
      const i = Math.max(0, value.indexOf('\uFFFD') - 30);
      return { path, text: JC.pathText(path), fixed: r.fixed, left: r.left, before: clip(value.slice(i), 80), after: clip(r.text.slice(i), 80), orig: value, value: r.text };
    });
    report.push({ id: b.id, revisions: history.length, fields });
  }
  if (apply) for (const row of report.filter((r) => r.fields.some((f) => f.fixed))) {
    withStore((s) => {
      const b = core.findBuild(s, row.id); if (!b) return s;
      // only a string that is still exactly what the dry run saw is replaced (another writer may have changed it since)
      for (const f of row.fields) if (f.fixed && JC.valueAt(b, f.path) === f.orig) JC.setAt(b, f.path, f.value);
      b.updatedAt = new Date().toISOString();
      return s;
    }, { by, action: 'repair-mojibake', note: `${row.id}: ${row.fields.reduce((n, f) => n + f.fixed, 0)} character(s) put back from the journal` });
  }
  const sum = (k) => report.reduce((n, r) => n + r.fields.reduce((m, f) => m + f[k], 0), 0);
  return { apply, builds: report.map((r) => ({ id: r.id, revisions: r.revisions, fields: r.fields.map(({ path, value, orig, ...f }) => f) })), fixed: sum('fixed'), left: sum('left') };
}

/** Run the step-dependency migration under the store lock (journalled once as `migrate-step-deps`). */
export function migrateStepDepsNow(by = 'migration') {
  let report;
  const r = withStore((s) => { const m = core.migrateStepDeps(s, { by }); report = m.report; return m.store; }, { by, action: 'migrate-step-deps', note: `step dependencies v${core.STEP_DEPS_VERSION} (build-pipeline@1): older builds keep no dependsOn and run one step at a time` });
  return { report, rev: r.rev };
}

export const currentProfile = () => activeProfile().id;

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'status', ...rest] = args;
  if (cmd === 'migrate') {
    const dry = !rest.includes('--apply');
    const r = migrateNow({ dry });
    const i = rest.indexOf('--report');
    if (i >= 0) { const f = resolve(REPO_ROOT, rest[i + 1]); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${dryRunMarkdown(r)}\n`); }
    return out({ ok: r.report.verify.failed.length === 0, report: r.report }, `${dry ? 'dry run' : 'migrated'}: ${r.report.counts.builds} builds, ${r.report.counts.steps} steps; ${r.report.merges.length} merges, ${r.report.conflicts.length} conflicts, ${r.report.recovered.length} recovered; verify ${r.report.verify.total - r.report.verify.failed.length}/${r.report.verify.total}`);
  }
  if (cmd === 'numbers') {
    // pipeline-status@1: numbers [--apply]   every build without a number gets one, oldest first (dry run by default)
    const r = numberBuildsNow({ apply: rest.includes('--apply'), by: process.env.AXF_ACTOR || 'numbers' });
    return out({ ok: true, ...r }, `${r.apply ? 'numbered' : 'dry run (--apply writes)'}: ${r.given.length} build(s)${r.given.length ? ` (${r.given[0].number} … ${r.given[r.given.length - 1].number})` : ''}`);
  }
  if (cmd === 'view') {
    // pipeline-status@1: view <build>   the read every screen gets: number, pr, split, pipelineView and the step view
    const b = core.findBuild(loadStore(), rest[0] || ''); if (!b) throw new Error(`no build "${rest[0] || ''}"`);
    const v = { id: b.id, number: b.number ?? '', title: b.title, status: b.status, pr: b.pr ?? '', prUrl: b.prUrl ?? '', split: P2.normSplit(b.split, b.steps), ...(b.clash ? { clash: b.clash } : {}), pipelineView: b.pipelineView, steps: b.steps.map((s) => ({ ...P2.stepView(s), ...(s.waitsFor ? { waitsFor: s.waitsFor } : {}) })) };
    return out({ ok: true, build: v }, [`${v.number || '(no number)'} ${v.id}: ${v.pipelineView.label}${v.pr ? ` · PR ${v.pr}` : ''}`, v.pipelineView.line, v.split ? `split by ${v.split.by} (${v.split.model || 'no model'}) into ${v.split.stepCount} step(s) at ${v.split.at}` : '', v.pipelineView.mergeLine ? v.pipelineView.mergeLine.text : '', ...v.steps.map((s) => `  ${s.id} ${s.uid} ${s.status} ${s.model}${s.modelBy ? ` (by ${s.modelBy})` : ''}${s.splitBy ? ` · ${s.splitBy}` : ''}${s.waitsFor ? ` · waits for ${s.waitsFor.number || s.waitsFor.buildId}` : ''}`)].filter(Boolean).join('\n'));
  }
  if (cmd === 'dedupe-steps') {
    const fi = rest.indexOf('--from'); const from = fi >= 0 ? resolve(rest[fi + 1] || '') : '';
    const r = dedupeStepsNow({ apply: rest.includes('--apply'), from, ids: rest.filter((a, i) => !a.startsWith('--') && !(fi >= 0 && i === fi + 1)), by: process.env.AXF_ACTOR || 'dedupe-steps' });
    const rows = r.builds.map((b) => `${b.id.padEnd(48)} ${String(b.before).padStart(5)} → ${String(b.after).padStart(3)}${b.renamed ? ` (${b.renamed} ids tidied)` : ''}`);
    return out({ ok: true, ...r }, `${r.apply ? 'deduped' : 'dry run (--apply writes)'}: ${r.builds.length} build(s) with repeated steps, ${r.total.before} → ${r.total.after} steps\n${rows.join('\n')}`);
  }
  if (cmd === 'flow') {
    // pipeline-2@1: flow <build> <status> [--step s] [--by who] [--why w] [--reset] [--account a] [--slot s] [--pr n] [--worktree d]
    const [id, to] = rest; const gi = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] ?? '' : ''; };
    if (!id || !to) { process.exitCode = 2; return out({ ok: false, error: 'usage: flow <build> <status> [--step s] [--by who] [--why w] [--account a] [--slot s] [--pr n] [--worktree d]' }, 'usage: flow <build> <status> [--step s] [--by who] [--why w] [--account a] [--slot s] [--pr n]'); }
    const extra = {}; for (const k of ['account', 'slot', 'worktree', 'branch', 'tmux']) if (gi(`--${k}`)) extra[k] = gi(`--${k}`);
    if (gi('--pr')) extra.prNumber = Number(gi('--pr'));
    try {
      const r = setFlowStatus(id, to, { step: gi('--step'), by: gi('--by') || 'cli', why: gi('--why'), reset: rest.includes('--reset'), extra: Object.keys(extra).length ? extra : null });
      const x = r.step ?? r.build;
      return out({ ok: true, id, step: r.step?.id ?? '', status: x.status, attempt: x.attempt ?? 1, label: P2.labelOf(x.status, x.attempt, r.step ? 'step' : 'build'), rev: r.rev }, `${id}${r.step ? `/${r.step.id}` : ''}: ${P2.labelOf(x.status, x.attempt, r.step ? 'step' : 'build')}`);
    } catch (e) { process.exitCode = e.code === 'backward' ? 1 : 2; return out({ ok: false, error: e.message, code: e.code || '' }, `refused: ${e.message}`); }
  }
  if (cmd === 'set-status') {
    const [id, to] = rest; const bi = rest.indexOf('--by'); const by = (bi >= 0 && rest[bi + 1]) || 'cli';
    const demo = rest.includes('--demo'); // demo-build@1: a demo action, refused on a build without the tag
    if (!id || !core.STATUSES.includes(to)) { process.exitCode = 2; return out({ ok: false, error: `usage: set-status <build> <${core.STATUSES.join('|')}> [--by who] [--demo]` }, `usage: set-status <build> <status> [--by who] [--demo]`); }
    let why = ''; let ok = true;
    const r = withStore((x) => {
      const b = core.findBuild(x, id); if (!b) throw new Error(`no build "${id}"`);
      const g = core.guardedStatus(b, to, { by });
      ok = g.ok; why = g.why;
      Object.assign(b, g.build, { updatedAt: new Date().toISOString() });
      return x;
    }, { by, action: 'set-status', note: `${id} → ${to}`, demo });
    const b = core.findBuild(r.store, id);
    if (!ok) process.exitCode = 1;
    return out({ ok, why, id: b.id, status: b.status }, ok ? `${b.id}: ${b.status}` : `refused: ${b.id} stays ${b.status}: ${why}`);
  }
  if (cmd === 'attempt') {
    // done-means-merged@1: one log. The auto-lander (and a hand) add attempts here: --attempt '<auto-lander-attempt@1 | attempt@1>'
    // (a lander attempt is folded with fromAutoLanderAttempt); --close ok|failed closes the build's open attempt of that source
    const [id] = rest; const gi = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : ''; };
    const by = gi('--by') || 'cli'; const close = gi('--close'); const raw = gi('--attempt');
    if (!id || (!raw && !close)) { process.exitCode = 2; return out({ ok: false, error: 'usage: attempt <build> --attempt <json> | --close ok|failed [--source auto-lander] [--note …] [--by who]' }, 'usage: attempt <build> --attempt <json> | --close ok|failed [--source s] [--note …]'); }
    const BP = await import('../core/build-pipeline.mjs');
    let added = null; let closed = null;
    withStore((x) => {
      const b = core.findBuild(x, id); if (!b) throw new Error(`no build "${id}"`);
      const at = new Date().toISOString(); const list = BP.normAttempts(b.attempts);
      if (raw) {
        const j = JSON.parse(raw);
        const a = j.$axf === 'auto-lander-attempt@1' || ['red-ci', 'land'].includes(j.kind) ? BP.fromAutoLanderAttempt(j) : BP.normAttempt(j);
        // the same try reported twice (one per round) is one attempt: same source, kind, strategy, head and start
        if (!list.some((y) => y.source === a.source && y.kind === a.kind && y.strategy === a.strategy && y.head === a.head && y.startedAt === a.startedAt)) { list.push(a); added = a; }
      }
      if (close) {
        const src = gi('--source') || 'auto-lander';
        const o = [...list].reverse().find((y) => y.result === 'started' && y.source === src);
        if (o) { o.result = close === 'ok' ? 'ok' : 'failed'; o.endedAt = at; o.note = clip(`${o.note ? `${o.note} ` : ''}${gi('--note') || (close === 'ok' ? 'Ok.' : 'Failed.')}`, 600); closed = o; if (close === 'ok' && b.failure && ['clash', 'ci-red'].includes(b.failure.kind)) b.failure = null; }
      }
      b.attempts = BP.normAttempts(list);
      if (added || closed) { b.updatedAt = at; if (added) b.notes.push({ text: `Attempt ${b.attempts.length} (${added.source}): ${added.kind} ${added.strategy}${added.fixStrategy ? ` (${added.fixStrategy})` : ''} → ${added.result}${added.note ? `: ${clip(added.note, 200)}` : ''}`, at }); }
      return x;
    }, { by, action: 'attempt', note: id });
    return out({ ok: true, added, closed }, `${id}: ${added ? `attempt added (${added.kind} ${added.strategy})` : 'nothing new'}${closed ? `; attempt ${closed.n} closed ${closed.result}` : ''}`);
  }
  if (cmd === 'fail') {
    // a failure found outside the dispatcher (the auto-lander: red CI on the merge commit): failure on the build, status fixing
    const [id] = rest; const gi = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : ''; };
    const BP = await import('../core/build-pipeline.mjs');
    const f = BP.normFailure({ kind: gi('--kind'), at: new Date().toISOString(), why: gi('--why'), head: gi('--head'), step: gi('--step') });
    if (!id || !f) { process.exitCode = 2; return out({ ok: false, error: `usage: fail <build> --kind <${BP.FAILURE_KINDS.join('|')}> --why "…" [--head sha] [--step s]` }, 'usage: fail <build> --kind k --why "…" [--head sha]'); }
    let changed = false;
    withStore((x) => {
      const b = core.findBuild(x, id); if (!b) throw new Error(`no build "${id}"`);
      const open = BP.normFailure(b.failure);
      if (b.status === 'fixing' && open && open.kind === f.kind && open.head === f.head) return x;
      b.failure = f; b.status = 'fixing'; b.builtAt = ''; b.updatedAt = f.at; changed = true;
      b.notes.push({ text: `Fixing: ${f.kind}${f.head ? ` at ${f.head.slice(0, 10)}` : ''} (${f.why}). The server retries on its ladder.`, at: f.at });
      return x;
    }, { by: gi('--by') || 'cli', action: 'fail', note: `${id} ${f.kind}` });
    return out({ ok: true, changed, failure: f }, `${id}: ${changed ? `fixing (${f.kind})` : 'already fixing this failure'}`);
  }
  if (cmd === 'journal') {
    const sub = rest[0] || 'status';
    if (sub === 'migrate') { const r = migrateJournal({ apply: argv.includes('--apply') }); if (!r.ok) process.exitCode = 1; return out(r, `${r.dry ? 'dry run: ' : ''}${r.parts.length} part(s)${r.parts.reduce((a, p) => a + p.added, 0) ? `, ${r.parts.reduce((a, p) => a + p.added, 0)} byte(s) added on the hub` : ', the hub has every line'}${r.untracked ? `; ${r.untracked.length} repo part(s) untracked` : ''}${r.missing?.length ? `\n✗ ${r.missing.join('\n✗ ')}` : ''}`); }
    if (sub === 'verify') { const r = verifyJournal(readJson(join(REPO_ROOT, JOURNAL_POINTER_REL))); if (!r.ok) process.exitCode = 1; return out(r, r.warning || (r.ok ? `ok: ${r.checked} part(s) match the pointer` : r.failed.map((f) => `✗ ${f}`).join('\n'))); }
    if (sub === 'rotate') { const di = rest.indexOf('--days'); const r = rotateJournal({ apply: rest.includes('--apply'), days: di >= 0 ? Number(rest[di + 1]) || 30 : 30 }); return out({ ok: true, ...r }, `${r.apply ? 'rotated' : 'dry run (--apply writes)'}: ${r.rotated.length} part(s) older than ${r.days} days${r.rotated.length ? ` (${r.rotated.map((x) => `${x.part} ${x.bytes} → ${x.gzBytes} bytes`).join(', ')})` : ''}, ${r.kept} kept`); }
    if (sub === 'status') { const p = journalParts(); return out({ ok: true, home: journalHome(), mode: journalMode(), parts: p }, `journal home ${journalDir()} (${journalMode()}): ${Object.keys(p).length} part(s)`); }
    throw new Error('journal migrate [--apply] | verify | status | rotate [--days n] [--apply]');
  }
  if (cmd === 'repair-mojibake') {
    const ji = rest.indexOf('--journal-dir'); const dirs = rest.flatMap((a, i) => (a === '--journal-dir' && rest[i + 1] ? [resolve(rest[i + 1])] : []));
    const r = repairMojibakeNow({ apply: rest.includes('--apply'), by: process.env.AXF_ACTOR || 'repair-mojibake', journalDirs: dirs.length ? dirs : null, ids: rest.filter((a, i) => !a.startsWith('--') && !(ji >= 0 && rest[i - 1] === '--journal-dir')) });
    if (r.left) process.exitCode = 1;
    const rows = r.builds.flatMap((b) => b.fields.map((f) => `${b.id} ${f.text}: ${f.fixed} put back${f.left ? `, ${f.left} with no clean copy in the journal` : ''}\n    was  …${f.before}\n    now  …${f.after}`));
    return out({ ok: !r.left, ...r }, `${r.apply ? 'repaired' : 'dry run (--apply writes)'}: ${r.builds.length} build(s) with damaged text, ${r.fixed} character(s) put back, ${r.left} left\n${rows.join('\n')}`);
  }
  if (cmd === 'export') { exportNow(); return out({ ok: true }, 'exports written'); }
  if (cmd === 'migrate-deps') {
    const dry = rest.includes('--dry');
    const r = dry ? core.migrateStepDeps(loadStore()) : migrateStepDepsNow();
    const what = `${r.report.builds} builds, ${r.report.steps} steps; ${r.report.withDeps} with a dependency list (older builds keep none and run in order); ${r.report.aliasMoved} stored dependsOn moved to after`;
    return out({ ok: true, dry, report: r.report, rev: r.rev }, `${dry ? 'dry run' : r.report.stamped ? `step deps v${r.report.version} stamped (rev ${r.rev})` : `step deps already at v${r.report.version}`}: ${what}`);
  }
  if (cmd === 'done-means-merged') {
    // done-means-merged@1 (framework/spec/DONE-MEANS-MERGED.md): built / complete records that cannot prove a merge go back
    // to landing / fixing, once. --dry reports, --apply writes (journalled, live to main like every write); --report <file> writes the list.
    const apply = rest.includes('--apply');
    const r = migrateDoneNow({ dry: !apply });
    const i = rest.indexOf('--report');
    if (i >= 0) { const f = resolve(REPO_ROOT, rest[i + 1]); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(r.report, null, 1)}\n`); }
    const lines = r.report.moved.map((m) => `${m.id}: ${m.from} → ${m.to} (${m.why})`);
    return out({ ok: true, dry: !apply, already: r.already ?? null, report: r.report }, r.already ? `already migrated at ${r.already.at} (${r.already.moved} moved, ${r.already.unprovable} unprovable); nothing written` : `${apply ? 'migrated' : 'dry run'}: ${r.report.moved.length} moved, ${r.report.unprovable.length} unprovable (kept complete, no PR / branch / merge to check)\n${lines.join('\n')}`);
  }
  if (cmd === 'demo') {
    // demo-build@1: the sandbox guard's answer for one build (exit 1 when a demo action would be refused on it)
    const [id] = rest;
    if (!id) { process.exitCode = 2; return out({ ok: false, error: 'usage: demo <build>' }, 'usage: demo <build>'); }
    const b = core.findBuild(loadStore(), id);
    const g = demoGuard(b, 'demo action');
    if (!g.ok) process.exitCode = 1;
    return out({ ok: g.ok, id: b?.id ?? id, demo: !!b && core.isDemo(b), why: g.why }, g.ok ? `${b.id}: demo build (demo actions allowed)` : g.why);
  }
  if (cmd === 'verify') {
    // 1. the store itself is a valid builds@1 (names what is wrong); 2. nothing from the old files is missing
    const store = loadStore();
    const v = core.validateStore(store);
    const checks = core.verifyNothingLost(gatherSources({ history: false }), store);
    const bad = checks.filter((c) => !c.ok);
    if (bad.length || !v.ok) process.exitCode = 1;
    // 3. the journal (builds-journal@1): the hub home against main's pointer (a warning when the hub is not mounted)
    const pointer = readJson(join(REPO_ROOT, JOURNAL_POINTER_REL));
    const jv = process.env.AXF_BUILDS_STORE ? { ok: true, checked: 0, failed: [], warning: '' } : verifyJournal(pointer);
    if (!jv.ok) process.exitCode = 1;
    // 4. step dependencies: an `after` / `dependsOn` id naming no step of its build, and dependency cycles
    const deps = core.stepDepsReport(store);
    if (deps.missing.length || deps.cycles.length) process.exitCode = 1;
    // 5. pipeline-status@1: a build number is B-nnnn and belongs to one build; `pipelineView` is never stored
    const numbered = store.builds.filter((b) => b.number !== undefined && b.number !== '');
    const numberErrors = [...numbered.filter((b) => !P2.NUMBER_RE.test(String(b.number))).map((b) => `${b.id} has the number "${b.number}" (not B-nnnn)`),
      ...[...numbered.reduce((m, b) => m.set(b.number, [...(m.get(b.number) ?? []), b.id]), new Map())].filter(([, ids]) => ids.length > 1).map(([num, ids]) => `${num} is held by ${ids.join(' and ')}`),
      ...readStoreNow().builds.filter((b) => 'pipelineView' in b).map((b) => `${b.id} has a stored pipelineView (it is worked out on read)`)];
    if (numberErrors.length) process.exitCode = 1;
    const lines = [...numberErrors.map((e) => `✗ numbers ${e}`), ...v.errors.map((e) => `✗ store ${e.path} ${e.message}`), ...bad.map((b) => `✗ ${b.what}`), ...jv.failed.map((f) => `✗ journal ${f}`),
      ...deps.missing.map((m) => `✗ deps ${m.build}/${m.step} depends on "${m.missing}", which is not a step of the build`),
      ...deps.cycles.map((c) => `✗ deps ${c.build} dependency cycle: ${c.cycle.join(' → ')}`)];
    const jtext = jv.warning ? `; ${jv.warning}` : jv.checked ? `; journal: ${jv.checked} part(s) on the hub match the pointer` : '';
    // build-watchdog@1: recoveries[] is optional on a build
    const recovered = store.builds.filter((b) => Array.isArray(b.recoveries) && b.recoveries.length);
    const recoveries = { builds: recovered.length, records: recovered.reduce((n, b) => n + b.recoveries.length, 0), without: store.builds.length - recovered.length };
    // demo-build@1: demo builds (tag + demo- id) are counted, never mixed with the rest
    const demo = { builds: store.builds.filter((b) => core.isDemo(b)).map((b) => b.id) };
    const ok = !bad.length && v.ok && jv.ok && !deps.missing.length && !deps.cycles.length && !numberErrors.length;
    const depsLine = `step deps v${store.meta?.versions?.stepDeps?.version ?? 0}: ${deps.withDeps} build(s) with a dependency list, no missing ids, no cycles`;
    return out({ ok, store: v, total: checks.length, failed: bad, journal: jv, recoveries, demo, deps }, lines.length ? lines.join('\n') : `ok: the store is a valid builds@1 (${store.builds.length} records${demo.builds.length ? `, ${demo.builds.length} demo` : ''}); ${checks.length} checks, everything from the old files is in the store${jtext}; watchdog recoveries on ${recoveries.builds} build(s) (${recoveries.records} record(s)), ${recoveries.without} without\n${depsLine}`);
  }
  const s = loadStore();
  if (cmd === 'status') {
    const reg = readProfiles();
    const lines = reg.profiles.map((p) => { const pp = core.profileProgress(s, p.id); return `${p.id.padEnd(16)} ${String(core.buildsOf(s, p.id).length).padStart(4)} builds · ${pp.pct}% (${pp.done}/${pp.total}) · draft ${core.draftOf(s, p.id).ops.length} op(s)`; });
    return out({ ok: true, rev: s.rev, file: storeFile(), profiles: reg.profiles.map((p) => ({ id: p.id, builds: core.buildsOf(s, p.id).length, progress: core.profileProgress(s, p.id) })) }, `${storeFile()} rev ${s.rev} · ${s.builds.length} records\n${lines.join('\n')}`);
  }
  if (cmd === 'history') { const h = journalOf(rest[0]); return out({ ok: true, history: h.map(({ after, ...x }) => x) }, h.map((x) => `rev ${x.rev} ${x.at} ${x.by} ${x.action} ${x.op} (build rev ${x.buildRev})${x.broken ? ' [diff without its base: not restorable]' : ''}`).join('\n') || 'no history'); }
  if (cmd === 'restore') { const r = restoreBuild(rest[0], rest[1]); return out({ ok: true, rev: r.rev }, `${rest[0]} restored (store rev ${r.rev})`); }
  if (cmd === 'progress') {
    const p = rest[0] || currentProfile();
    const builds = core.buildsOf(s, p).map((b) => ({ id: b.id, title: b.title, ...core.buildProgress(b) }));
    return out({ ok: true, profile: core.profileProgress(s, p), builds }, `${p}: ${core.profileProgress(s, p).pct}%\n${builds.map((b) => `${String(b.pct).padStart(3)}% ${b.done}/${b.total} ${b.id}`).join('\n')}`);
  }
  if (cmd === 'draft') { const p = rest[0] || currentProfile(); const d = core.draftOf(s, p); return out({ ok: true, draft: d }, `${p}: ${d.ops.length} unsaved change(s)\n${d.ops.map((o) => JSON.stringify(o)).join('\n')}`); }
  if (cmd === 'apply' || cmd === 'discard') {
    const p = rest[0] || currentProfile();
    const r = cmd === 'apply' ? await applyDraftNow(p, 'cli') : withStore((x) => core.discardDraft(x, p), { by: 'cli', action: 'discard' });
    return out({ ok: true, rev: r.rev, log: r.log ?? [] }, (r.log ?? ['draft discarded']).join('\n'));
  }
  throw new Error(`unknown command ${cmd}`);
}

/** Apply a profile's draft (returns a Promise when the draft renames the profile: the registry is written after). */
export function applyDraftNow(profile, by = 'console') {
  const r = withStore((x) => { const a = core.applyDraft(x, profile, { by }); return { store: a.store, log: a.log, profileName: a.profileName }; }, { by, action: 'apply-draft', note: `Steps view draft applied (${profile})` });
  if (r.profileName) {
    // profiles.mjs owns the registry; imported lazily so the store has no hard dependency on it
    return import('./profiles.mjs').then((m) => { m.act({ action: 'update', id: r.profileName.id, name: r.profileName.name }); return r; });
  }
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
