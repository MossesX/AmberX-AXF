#!/usr/bin/env node
/**
 * Plan Studio CLI + store (plan@1, capability plans@1). One plan = one JSON file, so sessions anywhere can read and
 * write single plans through axHub without touching the rest:
 *
 *   <store>/plans/<id>.json        plan@1 (Markdown body inside)
 *   <store>/history/<id>.json      plan-history@1 (every saved version, newest last)
 *   <store>/categories.json        plan-categories@1 · templates.json (user templates) · views.json (saved views)
 *   <store>/catalog-seen.json      catalog keys found before (missing ones show as "gone")
 *
 * <store> is the hub's shared data where /projects is mounted (the console container): /projects/amberx-axf/_data/
 * plan-studio/ = axhub.memory_read/memory_write project "amberx-axf", area "data", path "plan-studio/plans/<id>.json".
 * Elsewhere it is the plugin's data folder (.axf-console/plugins/plan-studio). AXF_PLANS_DIR overrides (tests).
 * The plugin folder's data/plans/*.json are seeds (the imported parked plans): copied in once when missing.
 *
 *   node apps/console-web/plugins/plan-studio/plans.mjs list [--status s] [--category c] [--q words]
 *   … show <id> [--md]                one plan (JSON, or Markdown)
 *   … add "<title>" [--status parked] [--category "A > B"] [--priority P1] [--summary …] [--template feature] [--step "text|Opus|20"]…
 *   … status <id> <status>
 *   … import <file.md|file.json|->    a Markdown plan, a plan@1 JSON, or a JSON array of them (parked unless they say)
 *   … export [<id>…] [--md] [--out file]
 *   … ai "<plain English>" [--plan <id>] [--reply-file f] [--apply]   rules first; --reply-file = a fixed model reply (tests)
 *   … categories                      the category tree
 *   … api '<json {op,…}>'             everything the console page does (the server calls this); also reads stdin
 *   … where                           the store folder
 *   … shipped <build | file.json | ->  receive a shipped-manifest@1 for a build (the sidecar _claude/builds/shipped/<build>.json,
 *                                     a file, or stdin): the build's plan is created / updated with every field; an
 *                                     invalid one is refused with the field errors and flagged on the plan (exit 2)
 *   … shipped backfill [--since d]     every sidecar manifest the plans have not taken yet (tonight's landed builds)
 *   … shipped show <build>             the manifest a plan carries (+ its flag)
 *   … shipped log [n]                  the last n receipts (ok / refused, with the reason)
 *   … check-builds                     every shipped manifest has its plan, at the manifest's rev, valid and matching (exit 1 if not)
 *   --json on any command prints one JSON line.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pc from './web/plan-core.mjs';
import * as ai from './web/plan-ai.mjs';
import * as ps from './web/plan-shipped.mjs';
import { discover, readMatrices, writeBack } from './catalog.mjs';
import { dataPath, orchestratorPath, persistRoot, readProfiles, activeProfile } from '../../../../framework/cli/persist.mjs';
import * as SM from '../../../../framework/core/shipped-manifest.mjs';
import { listManifests as sidecarManifests, readManifest as readSidecar } from '../../../../framework/cli/shipped-files.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'plan-studio';
export const SEED_DIR = join(HERE, 'data/plans');
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

export function storeDir() {
  if (process.env.AXF_PLANS_DIR) return process.env.AXF_PLANS_DIR;
  const root = persistRoot();
  return root ? join(root, FOLDER) : join(ROOT, '.axf-console/plugins', FOLDER);
}
const P = (...x) => join(storeDir(), ...x);
export const onHub = () => !process.env.AXF_PLANS_DIR && !!persistRoot();

/** Per-minute prices from framework/schemas/model-pricing.json (the plan totals use them). */
export function prices() {
  const j = readJson(join(ROOT, 'framework/schemas/model-pricing.json'));
  if (!j?.models || !j.heuristic?.tokensPerMinute) return pc.PRICE_PER_MIN;
  const t = j.heuristic.tokensPerMinute;
  const per = (m) => ((t.input ?? 0) * (m.input ?? 0) + (t.output ?? 0) * (m.output ?? 0) + (t.cacheRead ?? 0) * (m.cacheRead ?? 0) + (t.cacheWrite ?? 0) * (m.cacheWrite ?? 0)) / 1e6;
  return { Fable: per(j.models.fable ?? {}), Opus: per(j.models.opus ?? {}), Sonnet: per(j.models.sonnet ?? {}) };
}

/* ------------------------------------------------------------------ store */

/** Copy seed plans that are missing (never over a plan that exists, never one deleted on purpose). */
export function seed() {
  const deleted = new Set(readJson(P('deleted.json'), { ids: [] }).ids ?? []);
  const added = [];
  for (const f of existsSync(SEED_DIR) ? readdirSync(SEED_DIR).filter((x) => x.endsWith('.json')) : []) {
    const raw = readJson(join(SEED_DIR, f));
    if (!raw?.id || deleted.has(raw.id) || existsSync(P('plans', `${raw.id}.json`))) continue;
    const plan = pc.normalize(raw, { prices: prices() });
    writeJson(P('plans', `${plan.id}.json`), plan);
    writeJson(P('history', `${plan.id}.json`), pc.addVersion(null, plan, { by: 'seed', note: raw.source ? `Imported from ${raw.source}` : 'Imported', kind: 'import', at: plan.createdAt }));
    added.push(plan.id);
  }
  if (!existsSync(P('categories.json'))) writeJson(P('categories.json'), pc.normCategories({ paths: ['Console > Plugins', 'Framework > Docs', 'Framework > Libraries', 'Product > Installer', 'Apps'] }));
  return added;
}

export function loadPlans() {
  seed();
  const dir = P('plans');
  const px = prices();
  return (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []).map((f) => readJson(join(dir, f))).filter(Boolean).map((p) => pc.normalize(p, { prices: px }));
}
export function getPlan(id) { if (!ID_RE.test(id ?? '')) throw new Error(`bad plan id "${id}"`); seed(); const p = readJson(P('plans', `${id}.json`)); return p ? pc.normalize(p, { prices: prices() }) : null; }
export function history(id) { return readJson(P('history', `${id}.json`), pc.emptyHistory(id)); }
export const categories = () => pc.normCategories(readJson(P('categories.json'), {}));
export const templates = () => pc.normTemplates(readJson(P('templates.json'), {}));
export const views = () => pc.normViews(readJson(P('views.json'), {}));

/**
 * Save one plan (a version is kept). meta: {by, kind: save|autosave|ai|import|restore|build, note, force}.
 * A new plan whose title looks like an existing one is refused with the matches unless `force` (duplicate check).
 */
export function savePlan(raw, meta = {}) {
  const at = new Date().toISOString();
  const before = raw?.id && ID_RE.test(raw.id) ? readJson(P('plans', `${raw.id}.json`)) : null;
  const plan = pc.normalize({ ...raw, updatedAt: at, version: (before?.version ?? 0) + 1, createdBy: raw?.createdBy || before?.createdBy || meta.by || '' }, { now: at, prices: prices() });
  const problems = pc.validate(plan);
  if (problems.length) throw new Error(`not a valid plan: ${problems.join('; ')}`);
  if (!before && !meta.force) {
    const dups = pc.duplicates(plan, loadPlans());
    if (dups.length) return { ok: false, duplicates: dups.map((d) => ({ id: d.plan.id, title: d.plan.title, status: d.plan.status, score: d.score })), plan };
  }
  if (before && meta.kind !== 'autosave' && !pc.diff(pc.normalize(before), plan).length) return { ok: true, plan: pc.normalize(before), unchanged: true };
  writeJson(P('plans', `${plan.id}.json`), plan);
  writeJson(P('history', `${plan.id}.json`), pc.addVersion(history(plan.id), plan, { by: meta.by, note: meta.note, kind: meta.kind || 'save', at }));
  if (plan.category && !categories().paths.includes(plan.category)) writeJson(P('categories.json'), pc.normCategories({ ...categories(), paths: [...categories().paths, plan.category] }));
  let wroteBack = [];
  try { if (plan.features.length) wroteBack = writeBack(plan, dataPath('framework/catalog/status.json')); } catch { /* the tracker path is optional */ }
  return { ok: true, plan, created: !before, wroteBack };
}
export function deletePlan(id) {
  if (!getPlan(id)) throw new Error(`no plan ${id}`);
  rmSync(P('plans', `${id}.json`), { force: true });
  const d = readJson(P('deleted.json'), { ids: [] }); d.ids = [...new Set([...(d.ids ?? []), id])]; writeJson(P('deleted.json'), d);
  return { ok: true, id }; // history stays: restore brings it back
}
export function restore(id, v, by = '') {
  const h = history(id);
  const plan = pc.restoreVersion(h, v, readJson(P('plans', `${id}.json`)));
  const d = readJson(P('deleted.json'), { ids: [] }); if ((d.ids ?? []).includes(id)) { d.ids = d.ids.filter((x) => x !== id); writeJson(P('deleted.json'), d); }
  return savePlan(plan, { by, kind: 'restore', note: `Restored version ${v}`, force: true });
}

/* ------------------------------------------------------------------ orchestrator (orchestrator@1, the tracker file) */

const orchFile = (profile) => (process.env.AXF_ORCH_FILE ? process.env.AXF_ORCH_FILE : orchestratorPath(profile || activeProfile().id));
export function profiles() { try { return readProfiles().profiles?.map((p) => ({ id: p.id, label: p.label ?? p.name ?? p.id })) ?? []; } catch { return []; } }
export function orchBuilds(profile) { return readJson(orchFile(profile), { builds: [] }).builds ?? []; }

/** Turn a plan into a build: preview (no write) or add it to the profile's orchestrator and link both ways. */
export function turnIntoBuild(id, { profile, buildId, preview = false, by = '', said = '' } = {}) {
  const plan = getPlan(id);
  if (!plan) throw new Error(`no plan ${id}`);
  const prof = profile || plan.profile || activeProfile().id;
  const change = pc.toBuild(plan, { profile: prof, id: buildId, said, by });
  if (preview) return { ok: true, preview: true, change, profile: prof, minutes: change.steps.reduce((m, s) => m + pc.minutesOf(s.estimate), 0) };
  const f = orchFile(prof);
  const st = readJson(f, { $axf: 'orchestrator@1', builds: [] });
  st.builds = st.builds ?? [];
  if (st.builds.some((b) => b.id === change.id)) throw new Error(`"${change.id}" is already in the ${prof} orchestrator: pick another build id`);
  const now = new Date().toISOString();
  st.builds.push({
    id: change.id, title: change.title, category: change.category, detail: change.detail, status: 'pending', hidden: false, source: 'plan-studio', pendingId: '', branch: '', pr: '',
    createdAt: now, updatedAt: now, builtAt: '', notes: [{ text: `Plan Studio plan: ${plan.id} (${plan.title})`, at: now }], approvals: [], ...(change.origin ? { origin: change.origin } : {}),
    steps: change.steps.map((s, i) => ({ id: `s${i + 1}`, text: s.text, model: s.model, why: '', phase: s.phase, group: '', estimate: s.estimate, files: [], checks: [], session: 'same', agent: false, skip: false, done: false, doneAt: '', note: '' })),
  });
  writeJson(f, st);
  const saved = savePlan(pc.linkBuild(plan, { profile: prof, id: change.id }), { by, kind: 'build', note: `Turned into build ${prof}:${change.id}`, force: true });
  return { ok: true, build: { profile: prof, id: change.id }, plan: saved.plan };
}
/** Live progress: every plan with a build reads its build; changed plans are saved. */
export function syncBuilds() {
  const changed = [];
  const cache = new Map();
  for (const p of loadPlans()) {
    if (!p.build) continue;
    if (!cache.has(p.build.profile)) cache.set(p.build.profile, orchBuilds(p.build.profile));
    const b = cache.get(p.build.profile).find((x) => x.id === p.build.id);
    const r = pc.syncBuild(p, b);
    if (r.changed) { savePlan(r.plan, { by: 'orchestrator', kind: 'build', note: b?.status === 'complete' ? 'Build complete' : 'Build progress', force: true }); changed.push(p.id); }
  }
  return changed;
}

/* ------------------------------------------------------------------ shipped manifests (shipped-manifest@1 → the build's plan) */

const planIdOk = (id) => ID_RE.test(id ?? '');
const logShipped = (entry) => { try { mkdirSync(storeDir(), { recursive: true }); appendFileSync(P('shipped-log.jsonl'), `${JSON.stringify(entry)}\n`); } catch { /* the log is a convenience */ } };
/** The last n receipts (newest last). */
export function shippedLog(n = 50) {
  let lines = []; try { lines = readFileSync(P('shipped-log.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  return lines.slice(-Math.max(1, n)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Receive one shipped-manifest@1 (what the orchestrator sends Shipped features when a build lands): validated against
 * the shared schema module first. Valid → the build's plan (plan id = build id) is created or updated with every field
 * (plan-shipped.mjs applyManifest), a version kept, the receipt logged. Invalid → refused: the manifest is not stored,
 * the plan is flagged with the field errors (created with only the flag when the build has no plan yet), the receipt
 * logged, and { ok: false, refused: true, reason, errors } comes back so the caller (CLI, hook, API) can say why.
 * A manifest with no build id cannot be attached to anything and throws (exit 2 on the CLI).
 */
export function receiveManifest(raw, { by = 'orchestrator', source = '', now = new Date().toISOString(), why = '' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const v = SM.validateManifest(r);
  const id = ps.planIdFor(r);
  if (!v.ok) {
    const reason = SM.rejection(v.errors);
    if (!id || !planIdOk(id)) throw Object.assign(new Error(`shipped-manifest@1 refused: ${reason}`), { code: 2, errors: v.errors, refused: true });
    const before = getPlan(id);
    const flagged = ps.flagManifest(before, r, v.errors, { now, source: source || r.source, by });
    const saved = savePlan(flagged, { by, kind: 'shipped', note: `Shipped manifest refused: ${reason}`.slice(0, 300), force: true });
    logShipped({ at: now, build: id, plan: saved.plan.id, ok: false, refused: true, id: String(r.id ?? ''), rev: Number(r.rev) || 0, source: String(source || r.source || ''), by, reason, why });
    return { ok: false, refused: true, reason, errors: v.errors, plan: saved.plan, created: !before };
  }
  const m = SM.normManifest(r, { now });
  const before = getPlan(m.build.id);
  const applied = ps.applyManifest(before, m, { now });
  if (!applied.changed) return { ok: true, plan: before, unchanged: true, stale: applied.stale, created: false, manifest: SM.summaryOf(m) };
  const landed = m.landedCommit ? `landed ${m.landedCommit.slice(0, 9)}` : m.pr.number ? `PR #${m.pr.number}` : m.mergedAt ? `merged ${m.mergedAt}` : 'not landed';
  const note = `Shipped manifest ${m.id} rev ${m.rev} (${m.source}): ${landed}, ${m.steps.filter((s) => s.done).length}/${m.steps.length} steps, ${m.files.length} file(s), ${m.tests.length} test line(s), ${m.open.length} open.`;
  const saved = savePlan(applied.plan, { by, kind: 'shipped', note, force: true });
  logShipped({ at: now, build: m.build.id, plan: saved.plan.id, ok: true, id: m.id, rev: m.rev, source: m.source, by, created: !before, why });
  return { ok: true, plan: saved.plan, created: !before, manifest: SM.summaryOf(m) };
}
/** The sidecar manifest of a build (framework/cli/shipped-files.mjs), or null. */
export const sidecarOf = (buildId) => readSidecar(buildId);
/** Every sidecar manifest the plans have not taken yet (or have an older rev of) → received. `since`: landings from that date. */
export function backfillShipped({ since = '', by = 'backfill', dry = false } = {}) {
  const from = SM.iso(since) || '';
  const out = [];
  for (const m of sidecarManifests()) {
    if (from && (m.landedAt || m.shippedAt) < from) continue;
    const plan = planIdOk(m.build.id) ? getPlan(m.build.id) : null;
    const have = plan?.shipped;
    if (have && have.id === m.id && Number(have.rev) >= m.rev) { out.push({ build: m.build.id, plan: plan.id, ok: true, unchanged: true }); continue; }
    if (dry) { out.push({ build: m.build.id, plan: plan?.id ?? '', ok: true, would: plan ? 'update' : 'create', rev: m.rev }); continue; }
    try { const r = receiveManifest(m, { by, source: m.source, why: 'backfill' }); out.push({ build: m.build.id, plan: r.plan?.id ?? '', ok: r.ok, refused: r.refused, reason: r.reason, created: r.created, rev: m.rev }); }
    catch (e) { out.push({ build: m.build.id, ok: false, error: e.message }); }
  }
  return { ok: true, since: from, dry, found: out.length, received: out };
}
/**
 * check-builds: every shipped manifest (sidecar) has its plan, at the manifest's rev, the manifest the plan carries is
 * a valid shipped-manifest@1 and the plan agrees with it (plan-shipped.mjs checkPlanAgainstManifest), and every plan
 * is a valid plan@1. Flagged plans (a refused manifest) are listed as warnings. { ok, checked, problems, warnings }.
 */
export function checkBuilds() {
  const problems = []; const warnings = []; let checked = 0;
  const plans = loadPlans();
  for (const m of sidecarManifests()) {
    checked += 1;
    const plan = plans.find((p) => p.id === m.build.id) ?? plans.find((p) => p.build?.id === m.build.id);
    if (!plan) { problems.push({ build: m.build.id, problem: `no plan for shipped build ${m.build.id} (plans.mjs shipped ${m.build.id})` }); continue; }
    const v = plan.shipped ? SM.validateManifest(plan.shipped) : { ok: false, errors: [{ field: 'shipped', message: 'the plan carries no manifest' }] };
    if (!v.ok) problems.push({ build: m.build.id, plan: plan.id, problem: `the plan's manifest is not a valid shipped-manifest@1: ${SM.rejection(v.errors)}` });
    for (const x of ps.checkPlanAgainstManifest(plan, m)) problems.push({ build: m.build.id, plan: plan.id, problem: x });
    const bad = pc.validate(plan); if (bad.length) problems.push({ build: m.build.id, plan: plan.id, problem: `not a valid plan@1: ${bad.join('; ')}` });
  }
  for (const p of plans) {
    if (p.shippedProblem) warnings.push({ plan: p.id, build: p.build?.id ?? p.id, warning: `flagged: a shipped manifest was refused ${p.shippedProblem.at}: ${p.shippedProblem.reason}` });
    if (p.shipped && p.shipped.build?.id !== p.id) problems.push({ plan: p.id, build: p.shipped.build?.id ?? '', problem: `plan ${p.id} carries the manifest of build ${p.shipped.build?.id}` });
  }
  return { ok: !problems.length, checked, plans: plans.filter((p) => p.shipped).length, problems, warnings };
}

/* ------------------------------------------------------------------ catalog */

export async function catalog() {
  const plans = loadPlans();
  const seenFile = P('catalog-seen.json');
  const seen = readJson(seenFile, { keys: [] }).keys ?? [];
  const entries = await discover({ seen, matrices: readMatrices(), plans });
  const keys = entries.filter((e) => e.status !== 'gone').map((e) => e.key);
  const all = [...new Set([...seen, ...keys])].sort();
  if (JSON.stringify(all) !== JSON.stringify(seen)) writeJson(seenFile, { keys: all });
  return pc.overlayCatalog(entries, plans);
}

/* ------------------------------------------------------------------ import / export */

export function importText(text, { by = '', status = 'parked', force = true } = {}) {
  const t = String(text ?? '').trim();
  let items;
  if (t.startsWith('{') || t.startsWith('[')) { const j = JSON.parse(t); items = (Array.isArray(j) ? j : j.plans ?? [j]).map((x) => pc.normalize({ status, ...x })); }
  else items = t.split(/\n(?=# )/).filter((x) => x.trim()).map((md) => { const p = pc.fromMarkdown(md); if (!/\*\*Status:\*\*/.test(md) && !md.includes('plan@1')) p.status = status; return p; });
  const out = [];
  for (const p of items) {
    if (existsSync(P('plans', `${p.id}.json`)) && !p.$axf) p.id = `${pc.slug(p.title)}-${pc.rid(4)}`;
    out.push(savePlan(p, { by, kind: 'import', note: 'Imported', force }));
  }
  return { ok: true, imported: out.filter((r) => r.ok).map((r) => r.plan.id), duplicates: out.filter((r) => !r.ok) };
}
export function exportPlans(ids, format = 'json') {
  const ps = (ids?.length ? ids.map(getPlan).filter(Boolean) : loadPlans());
  return format === 'md' ? ps.map(pc.toMarkdown).join('\n\n---\n\n') : JSON.stringify({ $axf: 'plan-export@1', exportedAt: new Date().toISOString(), plans: ps }, null, 1);
}

/* ------------------------------------------------------------------ AI (rules here; the model through the server) */

export async function aiTurn(text, { planId, reply = null, apply = false, by = 'AI' } = {}) {
  const plans = loadPlans();
  const plan = planId ? plans.find((p) => p.id === planId) ?? null : null;
  const ctx = { plan, plans, categories: categories().paths, catalog: await catalog(), builds: orchBuilds() };
  const complete = reply == null ? null : async () => reply;
  const r = await ai.interpret(text, ctx, complete);
  let res;
  try { res = ai.applyOps(r.ops, { plan, plans }); } catch (e) { return { ok: false, error: e.message, ops: r.ops, via: r.via }; }
  const out = { ok: true, via: r.via, ops: r.ops, summary: res.summary, answer: res.answer || r.reply, ask: res.ask, say: ai.speakable({ ...res, answer: res.answer || (res.summary.length ? '' : r.reply) }), plan: res.plan, others: [...res.others.values()], created: res.created, needsAi: !!r.needsAi };
  if (apply && res.changed) {
    const note = `AI, from: ${String(text).slice(0, 240)}`;
    if (res.plan && plan) savePlan(res.plan, { by, kind: 'ai', note, force: true });
    for (const p of res.others.values()) savePlan(p, { by, kind: 'ai', note, force: true });
    for (const p of res.created) savePlan(p, { by, kind: 'ai', note, force: true });
    out.applied = true;
  }
  return out;
}

/* ------------------------------------------------------------------ the console API (one dispatcher) */

export async function api(req) {
  const r = req && typeof req === 'object' ? req : {};
  const by = String(r.by ?? '');
  switch (r.op) {
    case 'state': {
      let synced = [];
      try { synced = syncBuilds(); } catch { /* the orchestrator file is optional */ }
      return { ok: true, plans: loadPlans(), categories: categories(), templates: { ...templates(), all: pc.allTemplates(templates()) }, views: views(), profiles: profiles(), activeProfile: activeProfile().id, store: storeDir(), onHub: onHub(), synced };
    }
    case 'get': { const plan = getPlan(r.id); if (!plan) throw new Error(`no plan ${r.id}`); return { ok: true, plan, history: history(r.id) }; }
    case 'save': return savePlan(r.plan, { by, kind: r.kind, note: r.note, force: !!r.force });
    case 'delete': return deletePlan(r.id);
    case 'restore': return restore(r.id, r.v, by);
    case 'bulk': { const changed = pc.bulk(loadPlans(), r.ids ?? [], r.change ?? {}); for (const p of changed) savePlan(p, { by, kind: 'save', note: 'Bulk change', force: true }); return { ok: true, changed: changed.map((p) => p.id) }; }
    case 'category': {
      const res = pc.categoryOp(categories().paths, loadPlans(), r.change ?? {});
      writeJson(P('categories.json'), pc.normCategories({ ...categories(), paths: res.paths }));
      for (const p of res.plans) savePlan(p, { by, kind: 'save', note: res.log.join('; '), force: true });
      return { ok: true, categories: categories(), log: res.log, moved: res.plans.map((p) => p.id) };
    }
    case 'template-save': { const t = templates(); const it = { ...r.template, id: pc.slug(r.template?.id || r.template?.label) }; t.items = [...t.items.filter((x) => x.id !== it.id), it]; writeJson(P('templates.json'), pc.normTemplates(t)); return { ok: true, templates: { ...templates(), all: pc.allTemplates(templates()) } }; }
    case 'template-delete': { const t = templates(); t.items = t.items.filter((x) => x.id !== r.id); writeJson(P('templates.json'), t); return { ok: true, templates: { ...templates(), all: pc.allTemplates(templates()) } }; }
    case 'view-save': { const v = views(); const it = { ...r.view, id: pc.slug(r.view?.id || r.view?.label) }; v.items = [...v.items.filter((x) => x.id !== it.id), it]; writeJson(P('views.json'), pc.normViews(v)); return { ok: true, views: views() }; }
    case 'view-delete': { const v = views(); v.items = v.items.filter((x) => x.id !== r.id); writeJson(P('views.json'), v); return { ok: true, views: views() }; }
    case 'import': return importText(r.text, { by, status: r.status || 'parked' });
    case 'export': return { ok: true, text: exportPlans(r.ids, r.format), format: r.format === 'md' ? 'md' : 'json' };
    case 'catalog': return { ok: true, entries: await catalog() };
    case 'feature': {
      const plan = getPlan(r.plan); if (!plan) throw new Error(`no plan ${r.plan}`);
      const res = ai.applyOps([{ op: 'feature', entry: r.entry, feature: r.feature, title: r.title, state: r.state }], { plan, plans: [plan] });
      return savePlan(res.plan, { by, kind: 'save', note: `Catalog: ${r.title} → ${r.state}`, force: true });
    }
    case 'plan-feature': { // "Plan this" on a catalog feature
      const e = (await catalog()).find((x) => x.key === r.entry); if (!e) throw new Error(`no catalog entry ${r.entry}`);
      const f = e.features.find((x) => x.id === r.feature) ?? { id: r.feature || pc.slug(r.title), title: r.title || r.feature, state: 'idea' };
      return { ok: true, plan: pc.planFromFeature(e, f) };
    }
    case 'build': return turnIntoBuild(r.id, { profile: r.profile, buildId: r.buildId, preview: !!r.preview, by, said: typeof r.said === 'string' ? r.said : '' });
    case 'sync-builds': return { ok: true, changed: syncBuilds() };
    case 'shipped': { // a shipped-manifest@1 for a build (the manifest given, else the build's sidecar)
      const m = r.manifest && typeof r.manifest === 'object' ? r.manifest : r.build ? sidecarOf(r.build) : null;
      if (!m) throw new Error(r.build ? `no shipped manifest for build "${r.build}" yet (the orchestrator sends one when it lands)` : 'give a manifest or a build id');
      return receiveManifest(m, { by: by || 'api', source: typeof r.source === 'string' && r.source ? r.source : (r.manifest ? 'api' : m.source), why: 'api' });
    }
    case 'shipped-get': {
      const id = String(r.id ?? r.build ?? '');
      const plan = planIdOk(id) ? getPlan(id) ?? loadPlans().find((p) => p.build?.id === id) ?? null : loadPlans().find((p) => p.build?.id === id) ?? null;
      if (!plan) throw new Error(`no plan for ${id}`);
      return { ok: true, plan: plan.id, title: plan.title, status: plan.status, shipped: plan.shipped ?? null, problem: plan.shippedProblem ?? null, summary: ps.shippedSummary(plan), actual: plan.actual ?? null };
    }
    case 'shipped-backfill': return backfillShipped({ since: typeof r.since === 'string' ? r.since : '', by: by || 'backfill', dry: !!r.dry });
    case 'shipped-log': return { ok: true, entries: shippedLog(Number(r.n) || 50) };
    case 'check-builds': return checkBuilds();
    case 'ai': return aiTurn(r.text, { planId: r.plan, reply: r.reply ?? null, apply: !!r.apply, by: by || 'AI' });
    case 'ai-apply': { // apply edits the page already showed as a diff
      const plans = loadPlans(); const plan = r.plan ? plans.find((p) => p.id === r.plan) ?? null : null;
      const res = ai.applyOps(r.ops ?? [], { plan, plans });
      const note = `AI, from: ${String(r.text ?? '').slice(0, 240)}`;
      const saved = [];
      if (res.plan && plan) saved.push(savePlan(res.plan, { by: by || 'AI', kind: 'ai', note, force: true }).plan);
      for (const p of res.others.values()) saved.push(savePlan(p, { by: by || 'AI', kind: 'ai', note, force: true }).plan);
      for (const p of res.created) saved.push(savePlan(p, { by: by || 'AI', kind: 'ai', note, force: true }).plan);
      return { ok: true, saved, summary: res.summary, say: ai.speakable(res) };
    }
    case 'ai-prompt': { const plans = loadPlans(); return { ok: true, ...ai.modelPrompt(r.text, { plan: plans.find((p) => p.id === r.plan) ?? null, plans, categories: categories().paths, catalog: await catalog(), builds: orchBuilds() }) }; }
    default: throw new Error(`unknown op "${r.op}"`);
  }
}

/* ------------------------------------------------------------------ CLI */

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; out[k] = out[k] === undefined ? v : [].concat(out[k], v); }
    else out._.push(a);
  }
  return out;
}
const line = (p) => `${p.id.padEnd(40)} ${p.status.padEnd(9)} ${p.priority} ${(pc.fmtMinutes(p.effort.minutes) || '–').padEnd(10)} ${p.category ? `[${p.category}] ` : ''}${p.title}`;

async function main(argv) {
  const json = argv.includes('--json');
  const f = flags(argv.filter((a) => a !== '--json'));
  const [cmd = 'list', ...rest] = f._;
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'where') return out({ ok: true, store: storeDir(), onHub: onHub() }, `${storeDir()}${onHub() ? ' (hub shared data)' : ''}`);
  if (cmd === 'api') {
    let body = rest[0];
    if (!body) body = readFileSync(0, 'utf8');
    return console.log(JSON.stringify(await api(JSON.parse(body))));
  }
  if (cmd === 'list') {
    const ps = pc.sortPlans(pc.filterPlans(loadPlans(), { q: f.q, statuses: f.status ? [].concat(f.status) : [], categories: f.category ? [].concat(f.category) : [] }), 'priority');
    return out({ ok: true, plans: ps.map(({ body, ...p }) => p), counts: pc.counts(ps) }, ps.map(line).join('\n') || 'No plans.');
  }
  if (cmd === 'show') { const p = getPlan(rest[0]); if (!p) throw new Error(`no plan ${rest[0]}`); return out({ ok: true, plan: p }, f.md ? pc.toMarkdown(p) : JSON.stringify(p, null, 1)); }
  if (cmd === 'add') {
    const title = rest.join(' ').trim(); if (!title) throw new Error('add "<title>"');
    const tpl = f.template ? pc.allTemplates(templates()).find((t) => t.id === f.template) : null;
    const steps = [].concat(f.step ?? []).filter((x) => typeof x === 'string').map((s) => { const [text, model, mins] = s.split('|'); return { text, model, minutes: mins }; });
    const fields = { title, status: typeof f.status === 'string' ? f.status : 'parked', ...(typeof f.category === 'string' && { category: f.category }), ...(typeof f.priority === 'string' && { priority: f.priority }), ...(typeof f.summary === 'string' && { summary: f.summary }), ...(typeof f.profile === 'string' && { profile: f.profile }), ...(steps.length && { steps }) };
    const p = tpl ? pc.fromTemplate(tpl, fields) : pc.normalize(fields);
    const r = savePlan(p, { by: process.env.USER || 'cli', kind: 'save', note: 'Added from the CLI', force: !!f.force });
    if (!r.ok) return out(r, `Looks like: ${r.duplicates.map((d) => `${d.id} (${d.title})`).join(', ')}. Add --force to save anyway.`);
    return out(r, `added ${r.plan.id}`);
  }
  if (cmd === 'status') { const p = getPlan(rest[0]); if (!p) throw new Error(`no plan ${rest[0]}`); if (!pc.STATUS_IDS.includes(rest[1])) throw new Error(`status: ${pc.STATUS_IDS.join(' | ')}`); const r = savePlan({ ...p, status: rest[1] }, { by: 'cli', note: `Status → ${rest[1]}`, force: true }); return out(r, `${p.id} → ${rest[1]}`); }
  if (cmd === 'import') { const src = rest[0] ?? '-'; const r = importText(readFileSync(src === '-' ? 0 : src, 'utf8'), { by: 'cli', status: typeof f.status === 'string' ? f.status : 'parked' }); return out(r, `imported ${r.imported.join(', ') || 'nothing'}`); }
  if (cmd === 'export') { const text = exportPlans(rest, f.md ? 'md' : 'json'); if (typeof f.out === 'string') { writeFileSync(f.out, text); return out({ ok: true, file: f.out }, `wrote ${f.out}`); } return console.log(text); }
  if (cmd === 'categories') { const tree = pc.categoryTree(categories().paths, loadPlans()); const pr = (ns, d = 0) => ns.flatMap((n) => [`${'  '.repeat(d)}${n.name} (${n.total})`, ...pr(n.children, d + 1)]); return out({ ok: true, tree }, pr(tree).join('\n')); }
  if (cmd === 'catalog') { const es = await catalog(); return out({ ok: true, entries: es }, es.map((e) => `${e.key.padEnd(48)} ${e.status.padEnd(7)} ${String(e.total).padStart(4)} features · ${e.progress}% · ${e.counts.planned} planned`).join('\n')); }
  if (cmd === 'ai') {
    const reply = typeof f['reply-file'] === 'string' ? readFileSync(f['reply-file'], 'utf8') : null;
    const r = await aiTurn(rest.join(' '), { planId: typeof f.plan === 'string' ? f.plan : '', reply, apply: !!f.apply, by: 'AI (cli)' });
    return out(r, r.ok ? `${r.say}${r.applied ? ' (applied)' : r.ops?.some((o) => !['answer', 'ask'].includes(o.op)) ? ' (not applied: add --apply)' : ''}` : `✗ ${r.error}`);
  }
  if (cmd === 'sync-builds') { const c = syncBuilds(); return out({ ok: true, changed: c }, c.length ? `updated ${c.join(', ')}` : 'nothing changed'); }
  if (cmd === 'shipped') {
    const [what = '', arg] = rest;
    const receiptLine = (x) => `${x.ok ? (x.unchanged ? '·' : '✓') : '✗'} ${x.build}${x.plan ? ` → plan ${x.plan}` : ''}${x.created ? ' [created]' : ''}${x.unchanged ? ' (already at this rev)' : ''}${x.would ? ` (would ${x.would}, rev ${x.rev})` : ''}${x.refused ? ` refused: ${x.reason}` : ''}${x.error ? `: ${x.error}` : ''}`;
    if (what === 'backfill') { const r = backfillShipped({ since: typeof f.since === 'string' ? f.since : '', by: 'cli', dry: !!f.dry }); return out(r, r.received.length ? r.received.map(receiptLine).join('\n') : 'no shipped manifests found'); }
    if (what === 'show') { const r = await api({ op: 'shipped-get', id: arg }); return out(r, r.shipped ? JSON.stringify({ plan: r.plan, problem: r.problem, shipped: r.shipped }, null, 1) : `plan ${r.plan} carries no shipped manifest${r.problem ? `; flagged ${r.problem.at}: ${r.problem.reason}` : ''}`); }
    if (what === 'log') { const es = shippedLog(Number(arg) || 30); return out({ ok: true, entries: es }, es.map((e) => `${e.at}  ${e.ok ? '✓' : '✗'} ${e.build} ${e.id || ''}${e.rev ? ` rev ${e.rev}` : ''} ${e.source || ''}${e.refused ? `  refused: ${e.reason}` : e.created ? '  [created]' : ''}`).join('\n') || 'no receipts yet'); }
    if (!what) throw new Error('shipped <build | file.json | -> | backfill [--since d] | show <build> | log [n]');
    const m = what === '-' ? JSON.parse(readFileSync(0, 'utf8')) : /\.json$/i.test(what) || what.includes('/') ? JSON.parse(readFileSync(what, 'utf8')) : sidecarOf(what);
    if (!m) throw Object.assign(new Error(`no shipped manifest for build "${what}" yet (the orchestrator sends one when it lands; or give a manifest file)`), { code: 2 });
    const r = receiveManifest(m, { by: process.env.AXF_ACTOR || 'cli', source: typeof f.source === 'string' ? f.source : (what === '-' || what.includes('.json') ? 'manual' : m.source), why: 'cli' });
    if (!r.ok) process.exitCode = 2;
    return out(r, r.ok ? `${r.unchanged ? 'already there' : 'received'}: plan ${r.plan.id}${r.created ? ' created' : ''}${r.manifest ? ` ← ${r.manifest.id} rev ${r.plan.shipped?.rev ?? 1}${r.manifest.landedCommit ? `, landed ${r.manifest.landedCommit.slice(0, 9)}` : ''}, ${r.manifest.steps.done}/${r.manifest.steps.total} steps, ${r.manifest.files} files, $${r.manifest.costUsd}` : ''}` : `✗ shipped-manifest@1 refused for plan ${r.plan.id} (flagged):\n${r.errors.map((e) => `  ${e.field}: ${e.message}`).join('\n')}`);
  }
  if (cmd === 'check-builds') {
    const r = checkBuilds(); if (!r.ok) process.exitCode = 1;
    return out(r, [`${r.ok ? '✓' : '✗'} ${r.checked} shipped manifest(s), ${r.plans} plan(s) carry one`, ...r.problems.map((p) => `  ✗ ${p.build || p.plan}: ${p.problem}`), ...r.warnings.map((w) => `  ! ${w.plan}: ${w.warning}`)].join('\n'));
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json') || process.argv[2] === 'api') console.log(JSON.stringify({ ok: false, error: e.message, ...(e.errors ? { errors: e.errors, refused: true } : {}) })); else console.error(e.message);
    process.exitCode = e.code === 2 ? 2 : 1;
  });
}
