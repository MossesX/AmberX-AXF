#!/usr/bin/env node
/**
 * plan — the framework's feature plan (framework/plan/plan.json, plan@1).
 *
 *   node framework/cli/plan.mjs            rebuild plan.json from seed.json + the feature catalog, keeping every edit
 *   node framework/cli/plan.mjs --stats    print counts
 *
 * Sources
 *   framework/plan/seed.json         curated framework epics (kernel, ports, engines, console, deploy, showcase…)
 *   framework/catalog/catalog.json   every catalog feature + its suggestions (status from catalog/status.json)
 *   framework/plan/plan.json         the plan itself: entries edited in the console (`edited: true`) or added
 *                                    there (`source: "user"`) are never overwritten by a rebuild
 * Media (screenshots) live in framework/plan/media and are referenced as `media/<file>`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_DIR = join(FRAMEWORK_DIR, 'plan');
const PLAN = join(PLAN_DIR, 'plan.json');
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const today = () => new Date().toISOString().slice(0, 10);
export const STATUSES = ['built', 'partial', 'in-progress', 'placeholder', 'planned', 'blocked', 'dropped'];
const CATALOG_STATUSES = new Set(['built', 'partial', 'placeholder', 'planned']);

function fromCatalog() {
  const catalog = readJson(join(FRAMEWORK_DIR, 'catalog/catalog.json'), { tabs: [] });
  const status = readJson(join(FRAMEWORK_DIR, 'catalog/status.json'), {});
  const out = [];
  for (const tab of catalog.tabs) for (const g of tab.groups) for (const it of g.items) {
    const s = status[it.id] ?? {};
    const mod = s.module ?? null;
    const port = mod && /^(axf|lib|kit)-/.test(mod) ? { android: { status: s.status ?? 'planned', where: mod } } : {};
    out.push({
      id: it.id, title: it.title, area: tab.label, group: g.label, kind: 'feature', status: s.status ?? 'planned',
      priority: it.recommended ? 'P1' : 'P3', wave: s.wave ?? (it.recommended ? 1 : 3), effort: '', summary: it.note || '',
      ports: port, capabilities: [], dependsOn: [], catalog: [it.id], modules: mod ? [mod] : [], files: [], acceptance: [], warnings: [],
      recommendations: (it.suggests ?? []).map((x) => `Bundle with: ${x.title} (${x.id})`), previews: [], screenshots: [], links: [],
      tags: [tab.id, it.tag].filter(Boolean), notes: s.notes ?? '', source: 'catalog', history: [{ at: today(), text: 'Imported from the feature catalog' }],
    });
    for (const sg of it.suggests ?? []) {
      const ss = status[sg.id] ?? {};
      out.push({
        id: sg.id, title: sg.title, area: tab.label, group: g.label, kind: 'task', parent: it.id, status: ss.status ?? 'planned', priority: 'P3', wave: ss.wave ?? 3, effort: '',
        summary: `Suggested together with ${it.title}.`, ports: {}, capabilities: [], dependsOn: [it.id], catalog: [sg.id], modules: [], files: [], acceptance: [], warnings: [],
        recommendations: [], previews: [], screenshots: [], links: [], tags: [tab.id, 'suggested'], notes: ss.notes ?? '', source: 'catalog', history: [{ at: today(), text: 'Imported from the feature catalog (suggestion)' }],
      });
    }
  }
  return out;
}

/** Rebuild plan.json: seed epics + catalog features, keeping every console edit and user-added feature. */
export function buildPlan() {
  const prev = readJson(PLAN, { features: [] });
  const prevById = new Map(prev.features.map((f) => [f.id, f]));
  const seed = readJson(join(PLAN_DIR, 'seed.json'), { features: [] }).features;
  const generated = [...seed, ...fromCatalog()];
  // link catalog features to the epic that lists them
  const epicOf = new Map();
  for (const e of seed) for (const c of e.catalog ?? []) epicOf.set(c, e.id);
  const features = [];
  const seen = new Set();
  for (const f of generated) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (epicOf.has(f.id) && f.source === 'catalog') f.epic = epicOf.get(f.id);
    const old = prevById.get(f.id);
    if (old?.edited) { features.push(f.source === 'catalog' && !old.statusEdited ? { ...old, status: f.status } : old); continue; }
    if (old) f.history = old.history?.length ? old.history : f.history;
    features.push(f);
  }
  for (const old of prev.features) if (!seen.has(old.id) && old.source === 'user') features.push(old);
  const plan = { $axf: 'plan@1', generatedAt: new Date().toISOString(), statuses: STATUSES, features };
  mkdirSync(PLAN_DIR, { recursive: true });
  writeFileSync(PLAN, JSON.stringify(plan, null, 1) + '\n');
  return plan;
}

export function loadPlan() { return existsSync(PLAN) ? readJson(PLAN) : buildPlan(); }

/** Insert or replace one feature (from the console); catalog status edits also update status.json + tracker.json. */
export function upsertFeature(feature, note) {
  if (!feature?.id || !feature?.title) throw new Error('feature needs id and title');
  const plan = loadPlan();
  const i = plan.features.findIndex((f) => f.id === feature.id);
  const old = i >= 0 ? plan.features[i] : null;
  const f = { ...feature, edited: true, source: old?.source ?? feature.source ?? 'user' };
  if (old && old.status !== f.status) f.statusEdited = true;
  f.history = [...(feature.history ?? old?.history ?? []), { at: new Date().toISOString(), text: note || (old ? 'Edited in the console' : 'Added in the console') }].slice(-100);
  if (i >= 0) plan.features[i] = f; else plan.features.push(f);
  writeFileSync(PLAN, JSON.stringify(plan, null, 1) + '\n');
  if (f.source === 'catalog' && old && old.status !== f.status && CATALOG_STATUSES.has(f.status)) {
    const sf = join(FRAMEWORK_DIR, 'catalog/status.json');
    const s = readJson(sf, {});
    s[f.id] = { ...(s[f.id] ?? {}), status: f.status };
    writeFileSync(sf, JSON.stringify(s, null, 2) + '\n');
    try { execFileSync(process.execPath, [join(FRAMEWORK_DIR, 'cli/tracker.mjs')], { stdio: 'pipe' }); } catch { /* tracker is best effort */ }
  }
  return f;
}

export function deleteFeature(id) {
  const plan = loadPlan();
  const f = plan.features.find((x) => x.id === id);
  if (!f) throw new Error(`no feature ${id}`);
  if (f.source !== 'user') throw new Error('only features added in the console can be deleted; set status "dropped" instead');
  plan.features = plan.features.filter((x) => x.id !== id);
  writeFileSync(PLAN, JSON.stringify(plan, null, 1) + '\n');
  return { id };
}

/** Save a screenshot sent as a data URL → framework/plan/media/<id>-<n>.<ext>; returns the `media/…` path. */
export function saveMedia(featureId, dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(String(dataUrl));
  if (!m) throw new Error('expected a base64 image data URL (png, jpg, webp or gif)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('image larger than 8 MB');
  mkdirSync(join(PLAN_DIR, 'media'), { recursive: true });
  const name = `${String(featureId).replace(/[^a-z0-9.-]+/gi, '-')}-${Date.now().toString(36)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  writeFileSync(join(PLAN_DIR, 'media', name), buf);
  return `media/${name}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = buildPlan();
  const by = (k) => Object.entries(plan.features.reduce((a, f) => ((a[f[k]] = (a[f[k]] ?? 0) + 1), a), {})).map(([a, b]) => `${a} ${b}`).join(' · ');
  console.log(`plan.json: ${plan.features.length} features`);
  if (process.argv.includes('--stats')) { console.log('status:', by('status')); console.log('area:', by('area')); console.log('kind:', by('kind')); }
}
