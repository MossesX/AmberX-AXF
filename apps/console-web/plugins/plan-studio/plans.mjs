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
 *   … mirror-builds [<build id>…]     build-mirror@1: make / update the stepped plan of these builds (none = backfill every open build)
 *   … check-builds [--all]            every open build has a plan whose steps match its split exactly (exit 1 + the mismatches)
 *   … where                           the store folder
 *   --json on any command prints one JSON line.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pc from './web/plan-core.mjs';
import * as ai from './web/plan-ai.mjs';
import { discover, readMatrices, writeBack } from './catalog.mjs';
import * as bm from './web/build-mirror.mjs';
import { dataPath, orchestratorPath, persistRoot, readProfiles, activeProfile } from '../../../../framework/cli/persist.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';
import { absorbOrchestrator, projectOrchestrator } from '../../../../framework/plan/builds-store-core.mjs';

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
  // build-mirror@1: an edit of a build's plan (anything but the mirror itself) flows back to the builds store
  let toBuild = null;
  if (plan.build?.id && !MIRROR_KINDS.has(meta.kind) && process.env.AXF_PLANS_WRITEBACK !== 'off') {
    try { toBuild = pushToBuild(plan, { by: meta.by || 'plan-studio' }); } catch (e) { toBuild = { ok: false, error: e.message }; }
  }
  return { ok: true, plan, created: !before, wroteBack, ...(toBuild ? { toBuild } : {}) };
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

/* ------------------------------------------------------------------ build-mirror@1: the builds store ↔ Plan Studio */

/** Saves that come from the mirror (or replay history) never flow back to the store. */
const MIRROR_KINDS = new Set(['build', 'seed', 'restore']);
const storeBuilds = () => (loadStore().builds ?? []).filter((b) => b && b.id);

/**
 * Bring the plans of these builds (ids; null = every build that needs one) up to date with the builds store.
 * A build without a plan gets one while it is open (named builds; `backfill` = every open build already there).
 * Returns { created, updated, unchanged }.
 */
export function mirrorBuilds(ids = null, { backfill = false, by = 'orchestrator' } = {}) {
  const want = ids ? new Set(ids) : null;
  const plans = loadPlans();
  const out = { created: [], updated: [], unchanged: 0 };
  for (const b of storeBuilds()) {
    if (want && !want.has(b.id)) continue;
    const existing = bm.findPlan(plans, b);
    // a build without a plan gets one while it is open (a new build always is; a catch-up replay of old events never
    // fills Plan Studio with long-finished builds); the full backfill (`mirror-builds`) does every open build
    if (!existing && (!(want || backfill) || !bm.BACKFILL_STATUSES.includes(b.status) || b.deleted || b.hidden)) continue;
    const r = savePlan(bm.planFromBuild(b, existing), { by, kind: 'build', note: existing ? `Build ${b.id}: ${b.status}` : `Stepped plan for build ${b.id}`, force: true });
    if (r.unchanged) out.unchanged += 1; else (r.created ? out.created : out.updated).push(r.plan.id);
  }
  return out;
}
/** Every build whose plan's steps don't match its split exactly: [{ build, plan, problems }]. */
export function checkBuilds({ all = false } = {}) {
  const plans = loadPlans();
  const out = [];
  for (const b of storeBuilds()) {
    const p = bm.findPlan(plans, b);
    if (!p && !(bm.BACKFILL_STATUSES.includes(b.status) && !b.deleted && !b.hidden) && !all) continue;
    if (!p && b.deleted) continue;
    const problems = bm.compare(p, b);
    if (problems.length) out.push({ build: b.id, plan: p?.id ?? null, problems });
  }
  return out;
}
/** A Plan Studio edit of a build's plan, written to the builds store (the mirror then brings the plan back in line). */
export function pushToBuild(plan, { by = 'plan-studio' } = {}) {
  const b = storeBuilds().find((x) => x.id === plan.build.id);
  if (!b) return { ok: false, error: `no build ${plan.build.id}` };
  const edits = bm.editsFor(plan, b);
  if (!bm.hasEdits(edits)) return { ok: true, unchanged: true };
  const prof = activeProfile().id;
  withStore((s) => {
    const state = projectOrchestrator(s, prof);
    state.builds = (state.builds ?? []).map((x) => (x.id === b.id ? bm.applyEdits(x, edits) : x));
    return absorbOrchestrator(s, prof, state, { by });
  }, { by, action: 'plan-studio:edit', note: b.id });
  return { ok: true, build: b.id, edits };
}

/** Turn a plan into a build: preview (no write) or add it to the profile's orchestrator and link both ways. */
export function turnIntoBuild(id, { profile, buildId, preview = false, by = '', said = '' } = {}) {
  const plan = getPlan(id);
  if (!plan) throw new Error(`no plan ${id}`);
  const prof = profile || plan.profile || activeProfile().id;
  const change = pc.toBuild(plan, { profile: prof, id: buildId, said, by });
  if (preview) return { ok: true, preview: true, change, profile: prof, minutes: change.steps.reduce((m, s) => m + pc.minutesOf(s.estimate), 0) };
  if (storeBuilds().some((b) => b.id === change.id)) throw new Error(`"${change.id}" is already in the orchestrator: pick another build id`);
  // one source of truth: the build goes into the builds store (the orchestrator file is a read-only export)
  const now = new Date().toISOString();
  withStore((store) => {
    const st = projectOrchestrator(store, prof);
    st.builds = st.builds ?? [];
    st.builds.push({
    id: change.id, title: change.title, category: change.category, detail: change.detail, status: 'pending', hidden: false, source: 'plan-studio', pendingId: '', branch: '', pr: '',
    createdAt: now, updatedAt: now, builtAt: '', notes: [{ text: `Plan Studio plan: ${plan.id} (${plan.title})`, at: now }], approvals: [], ...(change.origin ? { origin: change.origin } : {}),
    steps: change.steps.map((s, i) => ({ id: `s${i + 1}`, text: s.text, model: s.model, why: '', phase: s.phase, group: '', estimate: s.estimate, files: [], checks: [], session: 'same', agent: false, skip: false, done: false, doneAt: '', note: '' })),
  });
    return absorbOrchestrator(store, prof, st, { by: by || 'plan-studio' });
  }, { by: by || 'plan-studio', action: 'plan-studio:build', note: change.id });
  const saved = savePlan(pc.linkBuild(plan, { profile: prof, id: change.id }), { by, kind: 'build', note: `Turned into build ${prof}:${change.id}`, force: true });
  return { ok: true, build: { profile: prof, id: change.id }, plan: saved.plan };
}
/** Live progress: every plan with a build is mirrored from the builds store (build-mirror@1); returns the changed plan ids. */
export function syncBuilds() {
  const r = mirrorBuilds(null);
  return [...r.created, ...r.updated];
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
    case 'mirror-builds': return { ok: true, ...mirrorBuilds(Array.isArray(r.ids) && r.ids.length ? r.ids : null, { backfill: r.backfill !== false, by: by || 'orchestrator' }) };
    case 'check-builds': { const bad = checkBuilds({ all: !!r.all }); return { ok: !bad.length, mismatches: bad }; }
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
  if (cmd === 'mirror-builds') {
    const r = mirrorBuilds(rest.length ? rest : null, { backfill: true, by: 'cli' });
    return out({ ok: true, ...r }, `created ${r.created.length}${r.created.length ? ` (${r.created.join(', ')})` : ''} · updated ${r.updated.length} · unchanged ${r.unchanged}`);
  }
  if (cmd === 'check-builds') {
    const bad = checkBuilds({ all: !!f.all });
    if (bad.length) process.exitCode = 1;
    return out({ ok: !bad.length, mismatches: bad }, bad.length ? bad.map((m) => `✗ ${m.build} → ${m.plan ?? '(no plan)'}: ${m.problems.slice(0, 4).map((p) => `${p.step || '-'} ${p.field} (plan ${JSON.stringify(p.plan)} ≠ build ${JSON.stringify(p.build)})`).join('; ')}${m.problems.length > 4 ? ` +${m.problems.length - 4}` : ''}`).join('\n') : 'every build has its plan, steps in sync');
  }
  if (cmd === 'sync-builds') { const c = syncBuilds(); return out({ ok: true, changed: c }, c.length ? `updated ${c.join(', ')}` : 'nothing changed'); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json') || process.argv[2] === 'api') console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
