#!/usr/bin/env node
/**
 * builds-store — the IO side of framework/plan/builds-store-core.mjs: the ONE builds store (builds@1), owned by the
 * Build orchestrator. Every builds list (orchestrator, Pending builds, build queue) reads and writes it here.
 *
 *   _claude/builds/store.json            the store (repo file, synced with the hub by claude-sync, committed)
 *   _claude/builds/journal/<YYYY-MM>.jsonl  every write, append-only: rev, when, who, what, and each changed build
 *                                        before and after. Nothing can vanish: any build can be put back from here.
 *
 *   node framework/cli/builds-store.mjs                    status: builds per profile, rev, draft, journal size
 *   … migrate --dry [--report <file>]                      what the migration would do (report, nothing written)
 *   … migrate --apply                                       build the store from every older data set (once)
 *   … verify                                                every build, step, status and note of the old files is in the store
 *   … export                                                regenerate the old files (read-only exports of the store)
 *   … history <id>                                          every journal revision of one build
 *   … restore <id> <rev>                                    put a build back as it was at journal revision <rev>
 *   … progress [profile]                                    progress per build and per profile (the bars)
 *   … draft <profile> | apply <profile> | discard <profile>  the Steps view draft
 *   --json on any command prints JSON.
 *
 * AXF_BUILDS_STORE=<file> points at another store (tests); its journal goes next to it.
 * The old per-profile files (orchestrator.json, pending.json, build-queue.json) stay for one release as READ-ONLY
 * exports of the store (see exportAll); nothing but the store writes them, and a direct edit is taken into the store.
 */
import { appendFileSync, chmodSync, chownSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import { BASE_PROFILE, REPO_ROOT, activeProfile, orchestratorPath, persistRoot, profileRel, readProfiles } from './persist.mjs';

export const STORE_REL = '_claude/builds/store.json';
/** A scratch data folder (AXF_DATA_DIR set to a folder, as tests do): the store lives there too, seeded from the repo's. */
const scratchDir = () => { const d = process.env.AXF_DATA_DIR; return d && d !== 'off' ? d : ''; };
export const storeFile = () => process.env.AXF_BUILDS_STORE || (scratchDir() ? join(scratchDir(), STORE_REL) : join(REPO_ROOT, STORE_REL));
export const journalDir = () => join(dirname(storeFile()), process.env.AXF_BUILDS_STORE ? `${storeFile().replace(/^.*\//, '').replace(/\.json$/, '')}.journal` : 'journal');

function lock(f) {
  const l = `${f}.lock`; const t0 = Date.now();
  for (;;) {
    try { mkdirSync(dirname(l), { recursive: true }); closeSync(openSync(l, 'wx')); return () => rmSync(l, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(l).mtimeMs > 30000) rmSync(l, { force: true }); } catch { /* gone */ }
      if (Date.now() - t0 > 20000) throw new Error(`builds store is locked (${l})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export function storeExists() { return existsSync(storeFile()); }
function readStore() {
  const f = storeFile();
  if (!existsSync(f) && scratchDir() && !process.env.AXF_BUILDS_STORE && existsSync(join(REPO_ROOT, STORE_REL))) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, readFileSync(join(REPO_ROOT, STORE_REL))); }
  if (!existsSync(f)) {
    if (process.env.AXF_BUILDS_STORE) return core.emptyStore();
    // first use on this checkout: migrate from the older files (the dry run is `migrate --dry`)
    return migrateNow({ by: 'auto-migrate' }).store;
  }
  return core.normalizeStore(JSON.parse(readFileSync(f, 'utf8')));
}
/** The store. If an old file was written directly since the last export, that write is taken into the store first. */
export function loadStore() {
  if (exportsOn() && foreignWrites().length) return withStore((s) => s, { by: 'foreign-write', action: 'absorb' }).store;
  return readStore();
}

// ------------------------------------------------------------------ the old files as read-only exports
/*
 * The pre-store files stay where every older reader looks for them (Pending page on the hub, plugins, other sessions'
 * checkouts), but they are generated from the store after every write: read-only exports, like tracker.json.
 * A file changed by anything else since the last export (an old checkout, a hand edit, a git merge) is a foreign write:
 * it is absorbed into the store (journalled as `foreign-write`) before the next export, so it is never overwritten
 * unseen. Exports are off for test stores (AXF_BUILDS_STORE) unless AXF_BUILDS_EXPORT=1; AXF_BUILDS_EXPORT=0 turns them off.
 */
const exportsOn = () => process.env.AXF_BUILDS_EXPORT === '1' || (!process.env.AXF_BUILDS_STORE && process.env.AXF_BUILDS_EXPORT !== '0');
const exportsFile = () => `${storeFile()}.exports.json`; // per machine (paths differ), not committed
const EXPORT_NOTE = 'builds@1 export (read-only): generated from _claude/builds/store.json after every write. Change builds through the orchestrator, Pending builds, the build queue or the Builds page; a direct edit here is taken into the store, then this file is regenerated.';
function exportTargets() {
  const hub = persistRoot();
  const data = (id, r) => join(hub ?? REPO_ROOT, profileRel(id, r));
  return readProfiles().profiles.flatMap((p) => [
    { kind: 'orchestrator', profile: p.id, file: scratchDir() ? join(scratchDir(), rel(orchestratorPath(p.id))) : orchestratorPath(p.id) },
    { kind: 'pending', profile: p.id, file: data(p.id, 'framework/plan/pending.json') },
    { kind: 'queue', profile: p.id, file: data(p.id, 'framework/plan/build-queue.json') },
  ]);
}
const sig = (f) => { try { const st = statSync(f); return `${st.size}:${Math.floor(st.mtimeMs)}`; } catch { return ''; } };
const readExports = () => readJson(exportsFile()) ?? {};
const str = (v) => (typeof v === 'string' ? v : '');
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
    if (t.kind === 'orchestrator' && Array.isArray(j.builds)) s = core.absorbOrchestrator(s, t.profile, j, { by: 'foreign-write', newerOnly: true });
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
function exportAll(store) {
  const ex = readExports();
  for (const t of exportTargets()) {
    const doc = t.kind === 'orchestrator' ? core.projectOrchestrator(store, t.profile) : t.kind === 'pending' ? core.projectPending(store, t.profile) : core.projectQueue(store, t.profile);
    if (!doc) continue;
    if (t.kind === 'orchestrator' && !doc.builds.length && !existsSync(t.file)) continue;
    const text = `${JSON.stringify({ $export: EXPORT_NOTE, ...doc }, null, 1)}\n`;
    let old = ''; try { old = readFileSync(t.file, 'utf8'); } catch { /* new */ }
    if (old !== text) writeKeepingOwner(t.file, text);
    ex[t.file] = { sig: sig(t.file), kind: t.kind, profile: t.profile, rev: store.rev };
  }
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
/** Write every export now (after the migration, or by hand: `builds-store.mjs export`). */
export function exportNow() { const f = storeFile(); const unlock = lock(f); try { exportAll(readStore()); } finally { unlock(); } }

function journal(entry) {
  const d = journalDir(); mkdirSync(d, { recursive: true });
  appendFileSync(join(d, `${entry.at.slice(0, 7)}.jsonl`), `${JSON.stringify(entry)}\n`);
}

/** Save a new store state. Every write is versioned: store rev + 1, changed builds rev + 1, one journal line. */
export function saveStore(before, after, { by = 'cli', action = 'write', note = '' } = {}) {
  const now = new Date().toISOString();
  const changes = core.diffStores(before, after, now);
  const draftChanged = JSON.stringify(before.drafts) !== JSON.stringify(after.drafts);
  const metaChanged = JSON.stringify([before.meta, before.rules]) !== JSON.stringify([after.meta, after.rules]);
  if (!changes.length && !draftChanged && !metaChanged) return { store: before, changes: [], rev: before.rev };
  after.rev = (before.rev ?? 0) + 1; after.updatedAt = now;
  const f = storeFile(); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(core.compactStore(after), null, 1)}\n`); renameSync(tmp, f);
  journal({ rev: after.rev, at: now, by, action, note, builds: changes.map((c) => ({ id: c.id, op: c.op, rev: c.after?.rev, before: core.compactBuild(c.before), after: core.compactBuild(c.after) })), ...(draftChanged ? { drafts: after.drafts } : {}), ...(metaChanged ? { meta: after.meta, rules: after.rules } : {}) });
  return { store: after, changes, rev: after.rev };
}

/** Read, change, save under a lock. fn(store) returns the new store (or { store, ...extra }). */
export function withStore(fn, meta = {}) {
  const f = storeFile();
  const unlock = lock(f);
  try {
    const before = readStore();
    const foreign = [];
    const base = exportsOn() ? absorbForeign(core.normalizeStore(JSON.parse(JSON.stringify(before))), foreign) : before;
    if (foreign.length) saveStore(before, base, { by: 'foreign-write', action: 'absorb', note: foreign.join('; ') });
    const start = foreign.length ? readStore() : before;
    // nothing new from outside, but the files still differ from the store (e.g. older): the export below rewrites them
    const r = fn(core.normalizeStore(JSON.parse(JSON.stringify(start))));
    const next = r && r.$axf ? r : r.store;
    const saved = saveStore(start, next, meta);
    if (exportsOn()) exportAll(saved.store);
    return { ...(r && r.$axf ? {} : r), store: saved.store, changes: saved.changes, rev: saved.rev, foreign };
  } finally { unlock(); }
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
  for (const d of [join(REPO_ROOT, '_claude/builds/profiles'), join(REPO_ROOT, 'framework/plan/profiles')]) if (existsSync(d)) for (const x of readdirSync(d)) if (core.slug(x) === x) ids.add(x);
  const hub = persistRoot();
  const profiles = [];
  for (const id of [BASE_PROFILE, ...[...ids].filter((x) => x !== BASE_PROFILE)]) {
    const orchFile = orchestratorPath(id);
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

/** Restore one build to the state it had at journal revision `rev` (itself a new, journalled write). */
export function journalOf(id) {
  const d = journalDir(); if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d).filter((x) => x.endsWith('.jsonl')).sort()) for (const line of readFileSync(join(d, f), 'utf8').split('\n')) {
    if (!line.trim()) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    for (const b of e.builds ?? []) if (b.id === id) out.push({ rev: e.rev, at: e.at, by: e.by, action: e.action, op: b.op, buildRev: b.rev, after: b.after });
  }
  return out;
}
export function restoreBuild(id, rev, by = 'cli') {
  const h = journalOf(id).find((x) => x.rev === Number(rev));
  if (!h?.after) throw new Error(`no journal revision ${rev} for ${id}`);
  return withStore((s) => { s.builds = s.builds.filter((b) => b.id !== id); s.builds.push(core.normBuild(h.after)); return s; }, { by, action: 'restore', note: `${id} restored to journal rev ${rev}` });
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
  if (cmd === 'export') { exportNow(); return out({ ok: true }, 'exports written'); }
  if (cmd === 'verify') {
    const checks = core.verifyNothingLost(gatherSources({ history: false }), loadStore());
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) process.exitCode = 1;
    return out({ ok: !bad.length, total: checks.length, failed: bad }, bad.length ? bad.map((b) => `✗ ${b.what}`).join('\n') : `ok: ${checks.length} checks, everything from the old files is in the store`);
  }
  const s = loadStore();
  if (cmd === 'status') {
    const reg = readProfiles();
    const lines = reg.profiles.map((p) => { const pp = core.profileProgress(s, p.id); return `${p.id.padEnd(16)} ${String(core.buildsOf(s, p.id).length).padStart(4)} builds · ${pp.pct}% (${pp.done}/${pp.total}) · draft ${core.draftOf(s, p.id).ops.length} op(s)`; });
    return out({ ok: true, rev: s.rev, file: storeFile(), profiles: reg.profiles.map((p) => ({ id: p.id, builds: core.buildsOf(s, p.id).length, progress: core.profileProgress(s, p.id) })) }, `${storeFile()} rev ${s.rev} · ${s.builds.length} records\n${lines.join('\n')}`);
  }
  if (cmd === 'history') { const h = journalOf(rest[0]); return out({ ok: true, history: h.map(({ after, ...x }) => x) }, h.map((x) => `rev ${x.rev} ${x.at} ${x.by} ${x.action} ${x.op} (build rev ${x.buildRev})`).join('\n') || 'no history'); }
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
