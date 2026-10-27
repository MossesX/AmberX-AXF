#!/usr/bin/env node
/**
 * builds — IO for the one builds dataset (builds@1, spec framework/spec/BUILDS.md). The pure logic is
 * framework/plan/builds-core.mjs; this module reads and writes the files:
 *
 *   plan.json (dataPath)                       the dataset, once migrated (`builds` block present)
 *   pending.json, build-queue.json (dataPath)  generated exports, rewritten on every save
 *   _claude/builds/orchestrator.json (repo)    generated export (AXF_ORCH_FILE overrides)
 *
 * Before the migration has run, the plan has no `builds` block: `loadBuilds()` then derives the dataset from the
 * old files read-only, and the older CLIs keep writing their own files, so nothing changes until `migrate --write`.
 *
 *   node framework/cli/builds.mjs                     counts per view + where the files live
 *   node framework/cli/builds.mjs migrate [--write]   the four files → one plan (dry run prints the report)
 *   node framework/cli/builds.mjs exports             rewrite the export files from the plan
 *   node framework/cli/builds.mjs rows <view> [--json]
 *   node framework/cli/builds.mjs tracker             compare tracker.json with the plan's tracker export
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-core.mjs';
import { dataPath, REPO_ROOT } from './persist.mjs';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLAN_FILE = () => dataPath('framework/plan/plan.json');
export const PENDING_FILE = () => dataPath('framework/plan/pending.json');
export const QUEUE_FILE = () => dataPath('framework/plan/build-queue.json');
export const ORCH_FILE = () => process.env.AXF_ORCH_FILE || join(REPO_ROOT, '_claude', 'builds', 'orchestrator.json');
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const writeJson = (f, v, indent = 1) => { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, indent)}\n`); renameSync(tmp, f); };

/** The raw plan file (plan@1), {features: []} when missing. */
export function readPlanFile() { return readJson(PLAN_FILE(), { $axf: 'plan@1', features: [] }); }
export function isMigrated() { return core.isMigrated(readPlanFile()); }

/**
 * The dataset. Migrated: the plan as is. Not yet: the plan plus the old files, merged in memory (read-only; a dry
 * migration each time, so every view is right before the switch-over too).
 */
export function loadBuilds() {
  const plan = readPlanFile();
  if (core.isMigrated(plan)) return { plan: core.normalizePlan(plan), migrated: true };
  const { plan: merged } = core.migrate({ plan, pending: readJson(PENDING_FILE(), null), queue: readJson(QUEUE_FILE(), null), orchestrator: readJson(ORCH_FILE(), null), status: readJson(dataPath('framework/catalog/status.json'), null) });
  return { plan: merged, migrated: false };
}

/** Write the plan and regenerate the exports (pending, build queue, orchestrator). Only for a migrated dataset. */
export function saveBuilds(plan, { exports = true } = {}) {
  const p = core.normalizePlan(plan);
  if (!core.isMigrated(p)) throw new Error('saveBuilds: the plan has no builds@1 block (run `builds.mjs migrate --write` first)');
  writeJson(PLAN_FILE(), p);
  if (exports) writeExports(p);
  return p;
}
export function writeExports(plan = loadBuilds().plan) {
  const p = core.normalizePlan(plan);
  writeJson(PENDING_FILE(), core.pendingState(p));
  writeJson(QUEUE_FILE(), core.queueState(p));
  writeJson(ORCH_FILE(), core.orchestratorState(p));
  return { pending: PENDING_FILE(), queue: QUEUE_FILE(), orchestrator: ORCH_FILE() };
}

/* ---- what the older CLIs call (their state shapes, read from / written into the dataset) ---- */
export const readPendingState = () => core.pendingState(loadBuilds().plan);
export const readQueueState = () => core.queueState(loadBuilds().plan);
export const readOrchestratorState = () => core.orchestratorState(loadBuilds().plan);
/** Each writer re-reads the plan from disk first, so a plan write made a moment ago (plan.mjs setStatuses) is kept. */
export function writePendingState(state, now = new Date().toISOString()) { return saveBuilds(core.pendingIntoPlan(readPlanFile(), state, now)); }
export function writeQueueState(state, now = new Date().toISOString()) { return saveBuilds(core.queueIntoPlan(readPlanFile(), state, now)); }
export function writeOrchestratorState(state, now = new Date().toISOString()) { return saveBuilds(core.orchestratorIntoPlan(readPlanFile(), state, now)); }

/** Migration. Dry run returns the report; --write writes plan.json, keeps *.pre-builds.json copies and regenerates the exports. */
export function migrateFiles({ write = false, now = new Date().toISOString() } = {}) {
  const plan = readPlanFile();
  if (core.isMigrated(plan)) return { already: true, report: null };
  const files = { pending: PENDING_FILE(), queue: QUEUE_FILE(), orchestrator: ORCH_FILE() };
  const { plan: merged, report } = core.migrate({ plan, pending: readJson(files.pending, null), queue: readJson(files.queue, null), orchestrator: readJson(files.orchestrator, null), status: readJson(dataPath('framework/catalog/status.json'), null), now });
  if (write) {
    for (const f of Object.values(files)) if (existsSync(f)) copyFileSync(f, f.replace(/\.json$/, '.pre-builds.json'));
    copyFileSync(PLAN_FILE(), PLAN_FILE().replace(/\.json$/, '.pre-builds.json'));
    saveBuilds(merged);
  }
  return { already: false, report, files, written: write };
}

export function trackerCheck() {
  const { plan } = loadBuilds();
  const catalog = readJson(join(FRAMEWORK_DIR, 'catalog/catalog.json'), { tabs: [] });
  const want = core.trackerState(plan, catalog);
  const have = readJson(dataPath('tracker.json'), { items: [] });
  const byId = new Map((have.items ?? []).map((i) => [i.id, i]));
  const diffs = [];
  for (const it of want.items) { const h = byId.get(it.id); if (!h) diffs.push(`${it.id}: not in tracker.json`); else for (const k of ['tab', 'group', 'status', 'wave', 'module', 'title']) if (JSON.stringify(h[k] ?? null) !== JSON.stringify(it[k] ?? null)) diffs.push(`${it.id}.${k}: tracker ${JSON.stringify(h[k])} ≠ plan ${JSON.stringify(it[k])}`); }
  return { items: want.items.length, trackerItems: (have.items ?? []).length, diffs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  const json = rest.includes('--json');
  if (cmd === 'migrate') {
    const r = migrateFiles({ write: rest.includes('--write') });
    if (r.already) { console.log('already migrated: plan.json carries builds@1'); process.exit(0); }
    if (json) { console.log(JSON.stringify(r.report, null, 1)); process.exit(0); }
    const rp = r.report;
    console.log(`${r.written ? 'migrated' : 'dry run'}: ${rp.attached.length} attached, ${rp.created.length} new entries, ${rp.statusChanges.length} status change(s), ${rp.stepsMerged.length} step-list merge(s), ${rp.titles.length} title difference(s), ${rp.orphans.length} orphan(s), ${rp.catalogFilled} catalog feature(s) filled from status.json`);
    for (const c of rp.statusChanges) console.log(`  status ${c.id}: ${c.from} → ${c.to}  (${c.by})`);
    for (const c of rp.stepsMerged) console.log(`  steps  ${c.id}: ${JSON.stringify(c)}`);
    for (const c of rp.titles) console.log(`  title  ${c.id}: plan "${c.plan}" · pending "${c.pending}" (plan kept)`);
    for (const c of rp.orphans) console.log(`  orphan ${c.from} ${c.id}: ${c.why}`);
    console.log(`  counts ${JSON.stringify(rp.counts)}`);
    if (r.written) console.log(`  written ${PLAN_FILE()} + exports; *.pre-builds.json copies kept beside the originals`);
    else console.log('  nothing written (add --write)');
  } else if (cmd === 'exports') { if (!isMigrated()) { console.error('not migrated yet'); process.exit(1); } console.log(JSON.stringify(writeExports(), null, 1)); }
  else if (cmd === 'rows') { const view = rest.find((a) => !a.startsWith('--')) || 'plan'; const rows = core.rows(loadBuilds().plan, { view }); if (json) console.log(JSON.stringify(rows, null, 1)); else for (const r of rows) console.log(`${r.status.padEnd(12)} ${r.model.padEnd(6)} ${String(r.done)}/${r.total} ${r.title}  [${r.views.join(' ')}]`); }
  else if (cmd === 'tracker') { const r = trackerCheck(); console.log(`tracker export: ${r.items} item(s) from the plan, tracker.json has ${r.trackerItems}; ${r.diffs.length} difference(s)`); for (const d of r.diffs.slice(0, 40)) console.log(`  ${d}`); process.exit(r.diffs.length && rest.includes('--strict') ? 1 : 0); }
  else { const { plan, migrated } = loadBuilds(); console.log(`builds@1 ${migrated ? 'migrated' : 'NOT migrated (views derived from the old files)'} · ${JSON.stringify(core.countsByView(plan))}`); console.log(`  plan ${PLAN_FILE()}\n  pending ${PENDING_FILE()}\n  queue ${QUEUE_FILE()}\n  orchestrator ${ORCH_FILE()}`); }
}
