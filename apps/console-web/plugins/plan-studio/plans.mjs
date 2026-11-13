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
 * The plugin folder's data/plans/*.json are optional seeds: copied in once when missing (none ship today).
 *
 *   node apps/console-web/plugins/plan-studio/plans.mjs list [--status s] [--category c] [--q words]
 *   … show <id> [--md]                one plan (JSON, or Markdown)
 *   … find <words> [--plan w] [--item w] [--kind step|risk|…]   find by content: "the plan about X, the step that mentions Y"
 *                                     → hits with the focus to open (`axf control act console.screens plan-studio --focus <focus>`)
 *   … add "<title>" [--status parked] [--category "A > B"] [--priority P1] [--summary …] [--template feature] [--step "text|Opus|20"]…
 *   … status <id> <status>
 *   … delete <id>… | delete --all [--status s]   delete plans (history kept: api restore brings one back)
 *   … import <file.md|file.json|->    a Markdown plan, a plan@1 JSON, or a JSON array of them (parked unless they say)
 *   … export [<id>…] [--md] [--out file]
 *   … ai "<plain English>" [--plan <id>] [--reply-file f] [--apply]   rules first; --reply-file = a fixed model reply (tests)
 *   … categories                      the category tree
 *   … api '<json {op,…}>'             everything the console page does (the server calls this); also reads stdin
 *   … where                           the store folder
 *   --json on any command prints one JSON line.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pc from './web/plan-core.mjs';
import * as ai from './web/plan-ai.mjs';
import { discover, writeBack } from './catalog.mjs';
import { dataPath, persistRoot, readProfiles, activeProfile } from '../../../../framework/cli/persist.mjs';
import { activeProject, projectDataDir } from '../../../../framework/cli/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'plan-studio';
export const SEED_DIR = join(HERE, 'data/plans');
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

/**
 * Where the plans live: the active project's copy (projects@1). AmberX AXF keeps the plugin folder itself; any other
 * project keeps `<folder>/projects/<id>/` and starts with no plans. AXF_PLANS_DIR (tests) is used as given.
 */
export function storeDir() {
  if (process.env.AXF_PLANS_DIR) return process.env.AXF_PLANS_DIR;
  const root = persistRoot();
  return projectDataDir(root ? join(root, FOLDER) : join(ROOT, '.axf-console/plugins', FOLDER));
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

/**
 * Copy seed plans that are missing (never over a plan that exists, never one deleted on purpose). The seeds are
 * AmberX AXF's plans: a new project starts with none (projects@1).
 */
export function seed() {
  if (!process.env.AXF_PLANS_DIR && !activeProject().base) return [];
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
 * Save one plan (a version is kept). meta: {by, kind: save|autosave|ai|import|restore, note, force}.
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
/**
 * Delete every plan (or every plan with one status). `confirm: 'all'` is required so a stray call can't empty the
 * store. Each plan goes through deletePlan: its history stays and restore brings any one back.
 */
export function deleteAll({ confirm = '', status = '' } = {}) {
  if (confirm !== 'all') throw new Error('delete-all needs confirm: "all"');
  const ids = loadPlans().filter((p) => !status || p.status === status).map((p) => p.id);
  for (const id of ids) deletePlan(id);
  return { ok: true, deleted: ids };
}
export function restore(id, v, by = '') {
  const h = history(id);
  const plan = pc.restoreVersion(h, v, readJson(P('plans', `${id}.json`)));
  const d = readJson(P('deleted.json'), { ids: [] }); if ((d.ids ?? []).includes(id)) { d.ids = d.ids.filter((x) => x !== id); writeJson(P('deleted.json'), d); }
  return savePlan(plan, { by, kind: 'restore', note: `Restored version ${v}`, force: true });
}

/* ------------------------------------------------------------------ build profiles (a plan's optional profile tag) */

/*
 * Plan Studio is a standalone tool (Brett, Nov 12 2026: "I don't want this plan studio to be linked to the build at
 * all"). It never creates, reads, syncs or updates orchestrator builds, and builds never write plans.
 */
export function profiles() { try { return readProfiles().profiles?.map((p) => ({ id: p.id, label: p.label ?? p.name ?? p.id })) ?? []; } catch { return []; } }

/* ------------------------------------------------------------------ catalog */

export async function catalog() {
  const plans = loadPlans();
  const seenFile = P('catalog-seen.json');
  const seen = readJson(seenFile, { keys: [] }).keys ?? [];
  const entries = await discover({ seen, plans });
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
  const ctx = { plan, plans, categories: categories().paths, catalog: await catalog() };
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
    case 'state': return { ok: true, plans: loadPlans(), categories: categories(), templates: { ...templates(), all: pc.allTemplates(templates()) }, views: views(), profiles: profiles(), activeProfile: activeProfile().id, store: storeDir(), onHub: onHub() };
    case 'find': return { ok: true, ...pc.findInPlans(loadPlans(), { q: r.q, plan: r.plan, item: r.item, kind: r.kind }, { limit: r.limit }) };
    case 'get': { const plan = getPlan(r.id); if (!plan) throw new Error(`no plan ${r.id}`); return { ok: true, plan, history: history(r.id) }; }
    case 'save': return savePlan(r.plan, { by, kind: r.kind, note: r.note, force: !!r.force });
    case 'delete': return deletePlan(r.id);
    case 'delete-all': return deleteAll({ confirm: r.confirm, status: r.status });
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
    case 'ai-prompt': { const plans = loadPlans(); return { ok: true, ...ai.modelPrompt(r.text, { plan: plans.find((p) => p.id === r.plan) ?? null, plans, categories: categories().paths, catalog: await catalog() }) }; }
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
  if (cmd === 'find') {
    const r = pc.findInPlans(loadPlans(), { q: rest.join(' '), plan: typeof f.plan === 'string' ? f.plan : '', item: typeof f.item === 'string' ? f.item : '', kind: typeof f.kind === 'string' ? f.kind : '' }, { limit: Number(f.limit) || 10 });
    return out({ ok: true, ...r }, r.hits.map((h) => `${h.focus.padEnd(48)} ${h.plan.title}${h.item ? ` › ${h.item.label}: ${h.item.text}` : ''}`).join('\n') || 'Nothing found.');
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
  if (cmd === 'delete') {
    if (f.all) { const r = deleteAll({ confirm: 'all', status: typeof f.status === 'string' ? f.status : '' }); return out(r, `deleted ${r.deleted.length} plan(s)`); }
    if (!rest.length) throw new Error('delete <id>… | delete --all [--status s]');
    const ids = rest.map((id) => deletePlan(id).id); return out({ ok: true, deleted: ids }, `deleted ${ids.join(', ')}`);
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json') || process.argv[2] === 'api') console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
