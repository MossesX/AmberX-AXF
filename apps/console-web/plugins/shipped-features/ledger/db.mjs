/**
 * Shipped features: the feature ledger (feature-ledger@1) kept in SQLite.
 *
 * One file, <data dir>/ledger.sqlite (AXF_SHIPPED_FEATURES_DIR, default <repo>/.axf-console/plugins/shipped-features).
 * Migrations are the numbered .sql files next to this module, applied in order and recorded in meta.schema_version;
 * the console's Python side (server/__init__.py) reads the same file. Every record goes through the reference
 * normalisers, so what is stored is always the contract's shape; a feature written again is merged (never loses a
 * date, build, PR, prompt or edit) and its previous version is kept in feature_history.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../../framework/core/feature-ledger.mjs';
import { normManifest } from '../../../../../framework/core/shipped-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../../..');
export const dataDir = () => process.env.AXF_SHIPPED_FEATURES_DIR || join(REPO_ROOT, '.axf-console', 'plugins', 'shipped-features');
export const dbFile = () => join(dataDir(), 'ledger.sqlite');

// node:sqlite is stable enough for this and ships with Node 22; keep its experimental notice out of CLI output.
const { DatabaseSync } = await (async () => {
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => { if (String(w?.message ?? w).includes('SQLite')) return; emit.call(process, w, ...rest); };
  try { return await import('node:sqlite'); } finally { process.emitWarning = emit; }
})();

export const MIGRATIONS = readdirSync(join(HERE, 'migrations')).filter((f) => /^\d+_.+\.sql$/.test(f)).sort().map((f) => ({ version: Number(f.split('_')[0]), file: f, sql: readFileSync(join(HERE, 'migrations', f), 'utf8') }));
export const SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

const cache = new Map();
/** Open (and migrate) the ledger. `file` = ':memory:' for tests. */
export function openDb(file = dbFile()) {
  if (cache.has(file)) return cache.get(file);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  migrateDb(db);
  cache.set(file, db);
  return db;
}
export function closeDb(file = dbFile()) { const db = cache.get(file); if (db) { db.close(); cache.delete(file); } }

export function schemaVersion(db) {
  try { return Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value) || 0; } catch { return 0; }
}
export function migrateDb(db) {
  const from = schemaVersion(db); const applied = [];
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    tx(db, () => { db.exec(m.sql); setMeta(db, 'schema_version', String(m.version)); });
    applied.push(m.file);
  }
  return { from, to: schemaVersion(db), applied };
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already gone */ } throw e; }
}
export const getMeta = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? '';
export const setMeta = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

const parse = (row) => (row ? JSON.parse(row.doc) : null);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ------------------------------------------------------------------ features

export const getFeature = (db, id) => parse(db.prepare('SELECT doc FROM features WHERE id = ?').get(id));
export const listFeatures = (db) => db.prepare('SELECT doc FROM features ORDER BY planned_at, id').all().map(parse);
export const featureHistory = (db, id) => db.prepare('SELECT rev, at, why, doc FROM feature_history WHERE feature_id = ? ORDER BY rev').all(id).map((r) => ({ rev: r.rev, at: r.at, why: r.why, doc: JSON.parse(r.doc) }));

/**
 * Write a feature. An existing one is merged (`mergeFeature`) unless `replace`; the version it replaces goes to
 * feature_history with `why`. Returns the stored feature, or null when the record has no name.
 */
export function putFeature(db, feature, { replace = false, why = '', now = nowIso() } = {}) {
  const incoming = L.normFeature(feature, { now }); if (!incoming) return null;
  const old = getFeature(db, incoming.id);
  let f = old && !replace ? L.mergeFeature(old, incoming) : incoming;
  if (old && JSON.stringify({ ...old, rev: 0, updatedAt: '' }) === JSON.stringify({ ...f, rev: 0, updatedAt: '' })) return old;
  if (old) { f = { ...f, createdAt: old.createdAt || f.createdAt, rev: old.rev + 1, updatedAt: now }; db.prepare('INSERT OR REPLACE INTO feature_history (feature_id, rev, at, why, doc) VALUES (?, ?, ?, ?, ?)').run(old.id, old.rev, now, why, JSON.stringify(old)); }
  db.prepare(`INSERT INTO features (id, name, status, type, app, plugin, repo, planned_at, merged_at, first_live_at, last_changed_at, last_edit_at, edit_count, being_edited, source, updated_at, rev, doc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, type = excluded.type, app = excluded.app, plugin = excluded.plugin, repo = excluded.repo,
      planned_at = excluded.planned_at, merged_at = excluded.merged_at, first_live_at = excluded.first_live_at, last_changed_at = excluded.last_changed_at, last_edit_at = excluded.last_edit_at,
      edit_count = excluded.edit_count, being_edited = excluded.being_edited, source = excluded.source, updated_at = excluded.updated_at, rev = excluded.rev, doc = excluded.doc`)
    .run(f.id, f.name, f.status, f.type, f.app, f.plugin, f.repo, f.plannedAt, f.mergedAt, f.firstLiveAt, f.lastChangedAt, f.lastEditAt, f.editCount, f.beingEdited ? 1 : 0, f.source, f.updatedAt, f.rev, JSON.stringify(f));
  for (const b of f.builds) db.prepare('INSERT OR IGNORE INTO feature_builds (feature_id, build_key, step_uid, role) VALUES (?, ?, ?, ?)').run(f.id, L.buildKey(b.profile, b.id), '', b.role);
  return f;
}
/** Link a feature to the build step it came from (planned features: one step → one or more features). */
export const linkStep = (db, featureId, buildKey, stepUid, role = 'added') => db.prepare('INSERT OR IGNORE INTO feature_builds (feature_id, build_key, step_uid, role) VALUES (?, ?, ?, ?)').run(featureId, buildKey, stepUid, role);
export const featuresOfBuild = (db, buildKey) => db.prepare('SELECT DISTINCT f.doc FROM feature_builds fb JOIN features f ON f.id = fb.feature_id WHERE fb.build_key = ?').all(buildKey).map(parse);
export const featuresOfStep = (db, buildKey, stepUid) => db.prepare('SELECT DISTINCT f.doc FROM feature_builds fb JOIN features f ON f.id = fb.feature_id WHERE fb.build_key = ? AND fb.step_uid = ?').all(buildKey, stepUid).map(parse);

// ------------------------------------------------------------------ edits

export const getEdit = (db, id) => parse(db.prepare('SELECT doc FROM edits WHERE id = ?').get(id));
export const listEdits = (db, featureId = '') => (featureId ? db.prepare('SELECT doc FROM edits WHERE feature_id = ? ORDER BY at DESC, id').all(featureId) : db.prepare('SELECT doc FROM edits ORDER BY at DESC, id').all()).map(parse);
export const editsOfBuild = (db, build) => db.prepare('SELECT doc FROM edits WHERE build = ?').all(L.slug(build)).map(parse);

/** Write an edit (merged with the stored one: the status only moves forward) and refresh its feature's edit fields. */
export function putEdit(db, edit, { now = nowIso() } = {}) {
  const incoming = L.normEdit(edit, { now }); if (!incoming) return null;
  const old = getEdit(db, incoming.id);
  const e = old ? L.normEdit({ ...old, ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== '' && v !== 0 && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length))), status: L.laterStatus(old.status, incoming.status), liveAt: { ...old.liveAt, ...incoming.liveAt }, createdAt: old.createdAt, rev: old.rev + 1, updatedAt: now }) : incoming;
  db.prepare(`INSERT INTO edits (id, feature_id, kind, summary, build, profile, pr, repo, commit_sha, prompt, model, agent, session, status, at, merged_at, created_at, updated_at, rev, doc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, summary = excluded.summary, build = excluded.build, profile = excluded.profile, pr = excluded.pr, repo = excluded.repo,
      commit_sha = excluded.commit_sha, prompt = excluded.prompt, model = excluded.model, agent = excluded.agent, session = excluded.session, status = excluded.status,
      at = excluded.at, merged_at = excluded.merged_at, updated_at = excluded.updated_at, rev = excluded.rev, doc = excluded.doc`)
    .run(e.id, e.feature, e.kind, e.summary, e.build, e.profile, e.pr, e.repo, e.commit, e.prompt, e.model, e.agent, e.session, e.status, e.at, e.mergedAt, e.createdAt, e.updatedAt, e.rev, JSON.stringify(e));
  const f = getFeature(db, e.feature);
  if (f) {
    const applied = L.applyEdit(f, e, now);
    const refreshed = L.refreshEdits(applied, listEdits(db, f.id));
    putFeature(db, { ...refreshed, status: applied.status }, { replace: true, why: `edit ${e.id} (${e.status})`, now });
  }
  return e;
}

// ------------------------------------------------------------------ PRs, builds, prompts, deploys

export function putPr(db, pr) {
  const p = L.normPr(pr); if (!p) return null;
  const old = parse(db.prepare('SELECT doc FROM prs WHERE key = ?').get(p.key));
  const m = old ? { ...old, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length))), features: [...new Set([...old.features, ...p.features])] } : p;
  if (old?.mergedAt && !p.mergedAt) m.state = 'merged';
  db.prepare('INSERT OR REPLACE INTO prs (key, repo, number, state, merged_at, merge_commit, build, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(m.key, m.repo, m.number, m.state, m.mergedAt, m.mergeCommit, m.build, JSON.stringify(m));
  return m;
}
export const getPr = (db, key) => parse(db.prepare('SELECT doc FROM prs WHERE key = ?').get(key));
export const listPrs = (db) => db.prepare('SELECT doc FROM prs ORDER BY merged_at DESC, key').all().map(parse);

export function putBuild(db, build) {
  const b = L.normBuildRecord(build); if (!b) return null;
  const old = parse(db.prepare('SELECT doc FROM builds WHERE key = ?').get(b.key));
  const m = old ? { ...old, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '' && v !== 0 && !(Array.isArray(v) && !v.length))), features: [...new Set([...old.features, ...b.features])] } : b;
  db.prepare('INSERT OR REPLACE INTO builds (key, id, profile, title, status, pr, merged_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(m.key, m.id, m.profile, m.title, m.status, m.pr, m.mergedAt, JSON.stringify(m));
  return m;
}
export const getBuild = (db, key) => parse(db.prepare('SELECT doc FROM builds WHERE key = ?').get(key));
export const findBuild = (db, id) => parse(db.prepare('SELECT doc FROM builds WHERE id = ? ORDER BY key LIMIT 1').get(L.slug(id)));
export const listBuilds = (db) => db.prepare('SELECT doc FROM builds ORDER BY key').all().map(parse);

/** A verbatim prompt is never replaced by a paraphrased one. */
export function putPrompt(db, prompt) {
  const p = L.normPrompt(prompt); if (!p) return null;
  const old = parse(db.prepare('SELECT doc FROM prompts WHERE id = ?').get(p.id));
  if (old && old.verbatim && !p.verbatim) return old;
  db.prepare('INSERT OR REPLACE INTO prompts (id, build, kind, idx, at, verbatim, said, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, p.build, p.kind, p.index, p.at, p.verbatim ? 1 : 0, p.said, JSON.stringify(p));
  return p;
}
export const getPrompt = (db, id) => parse(db.prepare('SELECT doc FROM prompts WHERE id = ?').get(id));
export const listPrompts = (db, build = '') => (build ? db.prepare('SELECT doc FROM prompts WHERE build = ? ORDER BY idx').all(L.slug(build)) : db.prepare('SELECT doc FROM prompts ORDER BY build, idx').all()).map(parse);

export function putDeploy(db, deploy) {
  const d = L.normDeploy(deploy); if (!d) return null;
  db.prepare('INSERT OR REPLACE INTO deploys (id, target, sha, at, state, doc) VALUES (?, ?, ?, ?, ?, ?)').run(d.id, d.target, d.sha, d.at, d.state, JSON.stringify(d));
  return d;
}
export const listDeploys = (db) => db.prepare('SELECT doc FROM deploys ORDER BY at').all().map(parse);

// ------------------------------------------------------------------ shipped manifests (shipped-manifest@1)

/** Store a build's manifest (one row per manifest id; an older rev never replaces a newer one). Returns the stored one. */
export function putManifest(db, manifest) {
  const m = normManifest(manifest); if (!m) return null;
  const old = getManifest(db, m.id);
  if (old && old.rev > m.rev) return old;
  db.prepare('INSERT OR REPLACE INTO manifests (id, build, rev, pr, landed_commit, landed_at, shipped_at, source, said, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(m.id, m.build.id, m.rev, m.pr.number, m.landedCommit, m.landedAt, m.shippedAt, m.source, m.said.text, JSON.stringify(m));
  return m;
}
export const getManifest = (db, id) => parse(db.prepare('SELECT doc FROM manifests WHERE id = ?').get(id));
export const manifestsOfBuild = (db, build) => db.prepare('SELECT doc FROM manifests WHERE build = ? ORDER BY rev DESC').all(L.slug(build)).map(parse);
export const listManifests = (db) => db.prepare("SELECT doc FROM manifests ORDER BY CASE landed_at WHEN '' THEN shipped_at ELSE landed_at END DESC, build").all().map(parse);
/** id → rev of every stored manifest (what the sync compares the sidecar against). */
export const manifestRevs = (db) => Object.fromEntries(db.prepare('SELECT id, rev FROM manifests').all().map((r) => [r.id, r.rev]));

// ------------------------------------------------------------------ events + the whole ledger

export const seen = (db, id) => !!db.prepare('SELECT 1 FROM events_seen WHERE id = ?').get(id);
export const markSeen = (db, id, at = nowIso()) => db.prepare('INSERT OR IGNORE INTO events_seen (id, at) VALUES (?, ?)').run(id, at);

/** The ledger as one feature-ledger@1 document (export, the grid's payload, the conformance check). */
export function ledger(db) {
  const doc = { ...L.emptyLedger(getMeta(db, 'updated_at')), since: getMeta(db, 'since'), features: listFeatures(db), edits: listEdits(db), prs: listPrs(db), builds: listBuilds(db), prompts: listPrompts(db), deploys: listDeploys(db) };
  if (!doc.since) { const d = doc.features.map((f) => f.plannedAt).filter(Boolean).sort(); doc.since = d[0] || ''; }
  return doc;
}
export const counts = (db) => Object.fromEntries(['features', 'edits', 'prs', 'builds', 'prompts', 'deploys', 'manifests', 'events_seen', 'feature_history', 'feature_builds'].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
export const exists = () => existsSync(dbFile());
