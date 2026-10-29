#!/usr/bin/env node
/**
 * Feature matrix CLI + store (feature-matrix@1). Every build profile keeps its matrices next to its orchestrator
 * tracker, a repo file that claude-sync keeps in step with the hub and that the claude.ai page and other sessions
 * read: main framework = `_claude/builds/matrices.json`, other profiles `_claude/builds/profiles/<id>/matrices.json`.
 * Every save is also mirrored into the plugin's data folder through persist (on the VPS that is the hub's projects
 * tree), and is the fallback when the project file is missing. The draft (feature-matrix@0) is read and converted on
 * load; the first save writes it as feature-matrix@1. The page shows every profile's matrices as ONE dataset.
 *
 *   node apps/console-web/plugins/feature-matrix/matrix.mjs                list (one line per matrix, every profile)
 *   … state                            the whole dataset (every profile) + grid rows
 *   … get <matrix id>                  one matrix + totals (+ "missing" when the build has none yet)
 *   … act '<json change>'              any feature-matrix-core apply() change (no delete: refused by the contract)
 *   … seed '<json {ref, profile?}>'    a matrix for a build from the table it lives in (idempotent; only adds)
 *   … apply '<json {matrix, change?}>' push the matrix to every table the build lives in; writes the files and records
 *                                      the version as applied (a change-log entry is passed in and handed back: the
 *                                      server saves it through axf.changes@1)
 *   … import                           the draft as the first matrix + a matrix for every open build of the profile
 *   … where                            the files in use
 *   --json on any command prints one JSON line (the console server uses this).
 * Env: AXF_FM_DIR=<dir> keeps every profile's file as <dir>/<profile>.json (tests); AXF_ORCH_FILE = the tracker.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fm from './web/fm-core.mjs';
import * as ap from './web/fm-apply.mjs';
import * as dr from './web/draft.mjs';
import { activeProfile, baseDataPath, dataPath, orchestratorPath, readProfiles } from '../../../../framework/cli/persist.mjs';

export const FOLDER = 'feature-matrix';
export const DATA_REL = `.axf-console/plugins/${FOLDER}`;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); };
const withProfile = (id, fn) => { const prev = process.env.AXF_BUILD_PROFILE; process.env.AXF_BUILD_PROFILE = id; try { return fn(); } finally { if (prev === undefined) delete process.env.AXF_BUILD_PROFILE; else process.env.AXF_BUILD_PROFILE = prev; } };

export const profileIds = () => readProfiles().profiles.map((p) => p.id);
export const activeId = () => activeProfile().id;
/** The profile's matrices file (next to its orchestrator tracker). */
export function matricesFile(profile = activeId()) {
  if (process.env.AXF_FM_DIR) return join(process.env.AXF_FM_DIR, `${profile}.json`);
  return join(dirname(orchestratorPath(profile)), 'matrices.json');
}
/** Where the plugin's mirror of a profile's file lives (the plugin data folder, on the hub when /projects is mounted). */
export const mirrorFile = (profile) => (process.env.AXF_FM_DIR ? join(process.env.AXF_FM_DIR, 'mirror', `${profile}.json`) : baseDataPath(`${DATA_REL}/matrices/${profile}.json`));
const reportsFile = () => (process.env.AXF_FM_DIR ? join(process.env.AXF_FM_DIR, 'reports.json') : baseDataPath(`${DATA_REL}/reports.json`));
export const trackerFile = (profile) => (process.env.AXF_ORCH_FILE && profile === activeId() ? process.env.AXF_ORCH_FILE : orchestratorPath(profile));

// ---- the tables a build lives in (raw files: the plugin never imports another plugin's code)
export function readTables(profile) {
  return withProfile(profile, () => {
    const orch = readJson(trackerFile(profile));
    const pending = readJson(dataPath('framework/plan/pending.json'));
    const plan = readJson(dataPath('framework/plan/plan.json'));
    const queue = readJson(dataPath('framework/plan/build-queue.json'));
    return { builds: Array.isArray(orch?.builds) ? orch.builds : [], pending: Array.isArray(pending?.items) ? pending.items : [], features: Array.isArray(plan?.features) ? plan.features : [], queue: queue && typeof queue === 'object' ? queue : null };
  });
}

/** One profile's matrices (feature-matrix@1; the draft is converted in memory). */
export function loadProfile(profile) {
  const raw = readJson(matricesFile(profile)) ?? readJson(mirrorFile(profile));
  if (!raw) return fm.emptyState();
  const st = raw.$axf === fm.SCHEMA ? fm.normalizeState(raw) : dr.fromDraft(raw, readTables(profile).builds);
  return st;
}
export function saveProfile(profile, state) {
  const errors = fm.validate(state); if (errors.length) throw new Error(`refused: ${errors.slice(0, 3).join('; ')}`);
  writeJson(matricesFile(profile), state);
  try { writeJson(mirrorFile(profile), state); } catch { /* the mirror is a copy; the project file is the record */ }
}
/** Every profile's matrices as one dataset (a matrix's id carries its profile). */
export function loadAll() {
  const files = {}; const all = fm.emptyState(''); let updatedAt = '';
  for (const p of profileIds()) {
    const f = matricesFile(p); const st = loadProfile(p);
    if (!st.matrices.length && !existsSync(f)) continue;
    files[p] = f; all.matrices.push(...st.matrices); if (st.updatedAt > updatedAt) updatedAt = st.updatedAt;
  }
  all.updatedAt = updatedAt;
  return { state: all, files };
}
const profileOf = (matrixId) => String(matrixId ?? '').split(':')[0];

/** Apply one contract change to the profile its matrix belongs to. */
export function act(change) {
  const c = change && typeof change === 'object' ? change : {};
  const profile = ['add', 'seed'].includes(c.action) ? fm.slug(c.profile) || activeId() : profileOf(c.matrix);
  if (!profileIds().includes(profile)) throw new Error(`no build profile "${profile}"`);
  const r = fm.apply(loadProfile(profile), { ...c, ...(['add', 'seed'].includes(c.action) ? { profile } : {}) });
  saveProfile(profile, r.state);
  return { ...r, profile };
}

/** A matrix for a build from the table it lives in (adds the matrix when missing; never touches existing items). */
export function seed({ ref, profile, change } = {}) {
  const r = fm.normRef(ref); if (!r) throw new Error('a build reference { kind, id } is needed');
  const p = fm.slug(profile) || activeId();
  const t = { ...readTables(p), ...(change ? { change } : {}) };
  // an item already tied to a row (by its source) covers that row: seeding never adds it twice under another id
  const have = fm.findMatrix(loadProfile(p), r, p);
  const covered = new Set((have?.items ?? []).filter((it) => it.source.kind !== 'manual').map((it) => `${it.source.kind}:${it.source.id}`));
  const items = dr.seedItems(r, t).filter((it) => !covered.has(`${it.source?.kind}:${it.source?.id}`));
  const title = dr.titleFor(r, t) || r.id;
  return act({ action: 'seed', ref: r, profile: p, title, items, by: 'feature-matrix' });
}

/** Push a matrix to every table its build lives in, then record its version as applied. */
export function applyMatrix({ matrix, change } = {}, now = new Date().toISOString()) {
  const profile = profileOf(matrix);
  const st = loadProfile(profile); const m = fm.findMatrix(st, matrix); if (!m) throw new Error(`no matrix "${matrix}"`);
  const t = { ...readTables(profile), ...(change ? { change } : {}) };
  const targets = dr.targetsFor(m.ref, t);
  const { targets: out, report } = ap.applyAll(m, targets, now);
  withProfile(profile, () => {
    if (out.build) { const f = trackerFile(profile); const o = readJson(f); const i = o.builds.findIndex((b) => b.id === out.build.id); if (i >= 0 && JSON.stringify(o.builds[i]) !== JSON.stringify(out.build)) { o.builds[i] = out.build; o.updatedAt = now; writeJson(f, o); } }
    if (out.pending) { const f = dataPath('framework/plan/pending.json'); const o = readJson(f); const i = o.items.findIndex((x) => x.id === out.pending.id); if (i >= 0 && JSON.stringify(o.items[i]) !== JSON.stringify(out.pending)) { o.items[i] = out.pending; o.updatedAt = now; writeJson(f, o); } }
    if (out.queue && m.ref.kind === 'queue') { const f = dataPath('framework/plan/build-queue.json'); const o = readJson(f); if (JSON.stringify(o.steps?.[m.ref.id] ?? {}) !== JSON.stringify(out.queue)) { o.steps = { ...(o.steps ?? {}), [m.ref.id]: out.queue }; o.updatedAt = now; writeJson(f, o); } }
    if (out.feature) { const f = dataPath('framework/plan/plan.json'); const o = readJson(f); const i = o.features.findIndex((x) => x.id === out.feature.id); if (i >= 0 && JSON.stringify(o.features[i]) !== JSON.stringify(out.feature)) { o.features[i] = out.feature; o.updatedAt = now; writeJson(f, o); } }
  });
  const r = fm.apply(st, { action: 'applied', matrix: m.id, version: m.version, by: 'feature-matrix' }, now);
  saveProfile(profile, r.state);
  const reports = readJson(reportsFile()) ?? { $axf: 'feature-matrix-reports@1', reports: [] };
  reports.reports = [report, ...(reports.reports ?? [])].slice(0, 50);
  try { writeJson(reportsFile(), reports); } catch { /* reports are a convenience */ }
  return { state: r.state, matrix: r.matrix, report, change: out.change ?? null, log: [...r.log, report.summary] };
}

/** The draft as the first matrix, then a matrix for every open build of the profile (idempotent). */
export function importAll(profile = activeId()) {
  const log = [];
  const f = matricesFile(profile); const raw = readJson(f);
  let st = loadProfile(profile);
  if (raw && raw.$axf !== fm.SCHEMA) { saveProfile(profile, st); log.push(`${f}: draft ${raw.$axf ?? '?'} → ${fm.SCHEMA} (${st.matrices.length} matrices)`); }
  for (const b of dr.openBuilds(readTables(profile).builds)) {
    const before = fm.findMatrix(st, { kind: 'orchestrator', id: b.id }, profile);
    const r = seed({ ref: { kind: 'orchestrator', id: b.id }, profile });
    st = r.state; log.push(before ? `${r.matrix.id}: kept as it is (${r.log.length ? r.log.join('; ') : 'nothing new'})` : `${r.matrix.id}: seeded from ${b.steps?.length ?? 0} steps`);
  }
  return { state: st, log };
}

export const reports = () => readJson(reportsFile())?.reports ?? [];

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'list', ...rest] = args;
  const arg = () => { const a = rest.join(' ').trim(); return a ? JSON.parse(a) : {}; };
  if (cmd === 'where') { const files = Object.fromEntries(profileIds().map((p) => [p, matricesFile(p)])); return out({ ok: true, active: activeId(), files }, Object.entries(files).map(([p, f]) => `${p.padEnd(18)} ${f}`).join('\n')); }
  if (cmd === 'list' || cmd === 'state') {
    const { state, files } = loadAll(); const rows = fm.grid(state);
    return out({ ok: true, active: activeId(), profiles: readProfiles().profiles.map((p) => ({ id: p.id, name: p.name })), files, state, rows, reports: reports().slice(0, 10) },
      rows.map((r) => `${r.id.padEnd(48)} ${String(r.kept).padStart(3)} kept ${(r.cost || '0 min').padStart(7)} · ${r.skipped} skipped${r.dirty ? ' · needs apply' : ''}`).join('\n') || 'No matrices.');
  }
  if (cmd === 'get') {
    const id = rest[0] ?? ''; const st = loadProfile(profileOf(id)); const m = fm.findMatrix(st, id);
    return out({ ok: true, matrix: m, totals: m ? fm.totals(m) : null, missing: !m, reports: reports().filter((r) => r.matrix === id).slice(0, 10) }, m ? `${m.title}: ${fm.totals(m).kept} kept` : `no matrix ${id}`);
  }
  if (cmd === 'act') { const r = act(arg()); return out({ ok: true, matrix: r.matrix, item: r.item, log: r.log }, r.log.join('\n')); }
  if (cmd === 'seed') { const r = seed(arg()); return out({ ok: true, matrix: r.matrix, log: r.log }, r.log.join('\n') || 'nothing new'); }
  if (cmd === 'apply') { const r = applyMatrix(arg()); return out({ ok: true, matrix: r.matrix, report: r.report, change: r.change, log: r.log }, r.log.join('\n')); }
  if (cmd === 'import') { const r = importAll(rest[0] || activeId()); return out({ ok: true, log: r.log, count: r.state.matrices.length }, r.log.join('\n') || 'nothing to import'); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
