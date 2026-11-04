#!/usr/bin/env node
/**
 * Build optimizer CLI (build-optimize@1, web/optimizer-core.mjs on the packager core). Repacks every waiting step into
 * the fewest builds, applies a confirmed plan in one store write (one undo), and moves steps between builds. Basic mode
 * is plain code (zero tokens). Deep mode's AI call is the server's (axf.llm@1): this CLI gathers the evidence it reads
 * (`evidence`) and checks the AI's answer (`refine`); a bad or missing answer leaves the Basic plan as it is.
 *
 *   node apps/console-web/plugins/build-orchestrator/optimizer.mjs plan [--json '{"settings":{…},"filter":{…},"preset":"safe"}']
 *   … evidence --json '{…same…}'          Deep mode: the plan plus the prompt (briefs, step text, code hits, merged PRs)
 *   … refine --json '{"plan":{…},"ai":{…}}'   lay the AI's answer over the plan (validated), print the new plan
 *   … apply --json '{"packs":[…],"emptied":"archive","mode":"basic"}'   one transaction; prints the run id for undo
 *   … undo [run]                           undo the last run (or that one): new builds go, sources come back
 *   … runs                                 the runs that can be undone
 *   … move --json '{"keys":["<build>/<uid>"…],"to":"<build>","index":0}'   drag steps between builds (one undo)
 *   … settings [--json '{…patch…}']        read or change the settings (presets, notifications, schedule)
 *   … preset save <name> | delete <name>   save the current settings + filter as a named preset
 *
 * Settings live in the plugin's data folder (AXF_OPTIMIZER_FILE overrides): .axf-console/plugins/build-orchestrator/optimizer.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from './web/optimizer-core.mjs';
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { withStore, loadStore } from '../../../../framework/cli/builds-store.mjs';
import { applyOptimize, moveSteps, optimizeRuns, undoOptimize } from '../../../../framework/plan/builds-store-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const FOLDER = HERE.split('/').pop();
export const settingsFile = () => process.env.AXF_OPTIMIZER_FILE || join(ROOT, '.axf-console', 'plugins', FOLDER, 'optimizer.json');
const readJson = (f, d) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d; } catch { return d; } };
const plans = () => readJson(process.env.AXF_PACKAGER_PLANS || '', []);
const pricing = () => readJson(join(ROOT, 'framework', 'schemas', 'model-pricing.json'), null);
const profileOrder = (store) => { const o = {}; for (const b of store.builds) for (const [p, i] of Object.entries(b.order ?? {})) (o[p] ??= {})[b.id] = i; return o; };

// ---------------------------------------------------------------- settings (one small file, written atomically)

export function loadConfig() {
  const j = readJson(settingsFile(), {});
  return { settings: O.normSettings(j.settings), filter: O.normFilter(j.filter), presets: { ...O.PRESETS, ...(j.presets && typeof j.presets === 'object' ? j.presets : {}) }, last: j.last ?? null, scheduled: j.scheduled ?? null };
}
function saveConfig(c) {
  const f = settingsFile(); mkdirSync(dirname(f), { recursive: true });
  const own = Object.fromEntries(Object.entries(c.presets ?? {}).filter(([k]) => !(k in O.PRESETS)));
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify({ $axf: 'build-optimize-settings@1', settings: c.settings, filter: c.filter, presets: own, last: c.last, scheduled: c.scheduled }, null, 1)}\n`); renameSync(tmp, f);
}
/** Change settings: `patch.settings` / `patch.filter` merge in; locked ones stay on whatever is sent. */
export function setConfig(patch = {}) {
  const c = loadConfig();
  if (patch.settings) c.settings = O.normSettings({ ...c.settings, ...patch.settings, rules: { ...c.settings.rules, ...(patch.settings.rules ?? {}) }, safety: { ...c.settings.safety, ...(patch.settings.safety ?? {}) } });
  if (patch.filter) c.filter = O.normFilter({ ...c.filter, ...patch.filter });
  if (patch.last !== undefined) c.last = patch.last;
  if (patch.scheduled !== undefined) c.scheduled = patch.scheduled;
  saveConfig(c); return loadConfig();
}
export function savePreset(name, { label } = {}) {
  const id = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id) throw new Error('a preset needs a name');
  if (id in O.PRESETS) throw new Error(`"${id}" is a built-in preset`);
  const c = loadConfig(); c.presets[id] = { label: label || name, settings: c.settings, filter: c.filter }; saveConfig(c); return loadConfig();
}
export function deletePreset(name) { const c = loadConfig(); if (name in O.PRESETS) throw new Error(`"${name}" is a built-in preset`); delete c.presets[name]; saveConfig(c); return loadConfig(); }

/** Settings + filter for one run: saved ones, a preset over them, then what the caller sends. */
export function runOptions(req = {}) {
  const c = loadConfig();
  const pre = req.preset ? c.presets[req.preset] : null;
  if (req.preset && !pre) throw new Error(`no preset "${req.preset}" (${Object.keys(c.presets).join(', ')})`);
  let settings = pre ? O.withPreset(c.settings, pre) : c.settings;
  if (req.settings) settings = O.normSettings({ ...settings, ...req.settings, rules: { ...settings.rules, ...(req.settings.rules ?? {}) }, safety: { ...settings.safety, ...(req.settings.safety ?? {}) } });
  const filter = O.normFilter({ ...c.filter, ...(pre?.filter ?? {}), ...(req.filter ?? {}) });
  return { settings, filter, config: c };
}

// ---------------------------------------------------------------- plan (Basic), evidence + refine (Deep)

export function scoped(store, settings, filter) { return O.scope(store.builds, { plans: plans(), profileOrder: profileOrder(store), settings, filter }); }

export function makePlan(req = {}, store = loadStore()) {
  const { settings, filter } = runOptions(req);
  const sc = scoped(store, settings, filter);
  const pl = O.plan(sc.items, { settings, builds: store.builds, pricing: pricing() });
  return { plan: { ...pl, filter, out: sc.out, inProgress: sc.inProgress, profile: activeProfile().id }, items: sc.items, facets: O.facets(sc.items), settings, filter };
}

const git = (args, max = 200000) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).slice(0, max); } catch { return ''; } };
/** Words worth grepping for in a step: file paths, ids with dots/dashes/@, camelCase names. */
function needles(text) { return [...new Set((String(text).match(/[A-Za-z0-9_./@-]*[./@-][A-Za-z0-9_./@-]+|[a-z]+[A-Z][A-Za-z0-9]+/g) ?? []).filter((w) => w.length >= 5 && w.length <= 80))].slice(0, 6); }

/**
 * What Deep mode reads before it repacks: every waiting build's brief, Brett's words and addenda, each step's text and
 * the files it names, where in the code those names are (git grep), the merged PRs and reports (already-built work),
 * and the Basic plan. Returns { prompt, system, estimate, plan, items }.
 */
export function evidence(req = {}) {
  const store = loadStore();
  const r = makePlan(req, store);
  const ids = [...new Set(r.items.map((c) => c.build))];
  const builds = ids.map((id) => store.builds.find((b) => b.id === id)).filter(Boolean);
  const hits = {};
  for (const c of r.items) {
    const ns = [...needles(c.fullText || c.text), ...c.files.slice(0, 4)];
    const found = new Set();
    for (const n of ns) for (const f of git(['grep', '-l', '-F', '--', n, '--', ':!_claude', ':!**/node_modules/**', ':!*.json'], 4000).split('\n').filter(Boolean).slice(0, 5)) found.add(f);
    if (found.size) hits[c.key] = [...found].slice(0, 8);
  }
  const merged = git(['log', '--merges', '--first-parent', 'origin/main', '-n', '150', '--format=%s']).split('\n').filter(Boolean);
  const reportsDir = join(ROOT, '_claude', 'builds', 'reports');
  const reports = existsSync(reportsDir) ? readdirSync(reportsDir).filter((f) => f.endsWith('.md')).map((f) => { const t = readFileSync(join(reportsDir, f), 'utf8'); return `${f}: ${(t.match(/^#\s+(.+)$/m)?.[1] ?? '').slice(0, 140)}`; }) : [];
  const finished = store.builds.filter((b) => !b.deleted && ['built', 'complete'].includes(b.status)).slice(-200).map((b) => `${b.id}: ${b.title.slice(0, 120)}${b.pr ? ` (${b.pr})` : ''}`);
  const brief = (b) => [`## ${b.id} (${b.status}) ${b.title}`, b.category && `Category: ${b.category}`, b.origin?.said && `Brett said: ${b.origin.said.slice(0, 1200)}`, ...(b.origin?.addenda ?? []).map((a, i) => `Addendum ${i + 1}: ${String(a.said ?? '').slice(0, 600)}`), b.detail && `Brief: ${b.detail.slice(0, 1500)}`,
    ...r.items.filter((c) => c.build === b.id).map((c) => `- step ${c.key} [${c.model}${c.thinking ? `/${c.thinking}` : ''}${c.estimate ? `, ${c.estimate}` : ''}] ${c.fullText || c.text}${c.files.length ? ` · files: ${c.files.join(', ')}` : ''}${hits[c.key] ? ` · code: ${hits[c.key].join(', ')}` : ''}`)].filter(Boolean).join('\n');
  const basic = r.plan.packs.map((p) => `${p.id} "${p.name}" [${p.model}] ${p.keys.join(', ')}`).join('\n');
  const system = 'You are the AmberX build optimizer\'s Deep mode. You review a deterministic plan that repacks waiting build steps into fewer builds. Investigate thoroughly: hidden dependencies and overlaps between steps of different builds, duplicate or already-built work (compare with the merged PRs, reports and finished builds), steps that should be split or built on another model (Fable for contracts, schemas, engines, cross-app GUI behaviour; Opus for the rest) or thinking level. Answer ONLY with JSON: {"packs":[{"id":"pack-1","name":"short build name","why":"one line"}],"moves":[{"key":"<step key>","to":"pack-N or +","why":"one line"}],"deps":[{"key":"<step key>","needs":"<step key>","why":"one line"}],"drops":[{"key":"<step key>","kind":"built|duplicate","ref":"what it duplicates","why":"one line"}],"notes":[{"key":"<step key>","why":"one line","model":"Fable|Opus","thinking":"low|medium|high|max","split":true}]}. Use only step keys from the input. Never move a step out of order of the steps it needs.';
  const prompt = [`# Waiting builds (${builds.length}) and their steps`, ...builds.map(brief), '', '# Basic plan', basic, '', `# Merged PRs (latest ${merged.length})`, ...merged, '', `# Reports (${reports.length})`, ...reports, '', `# Finished builds (${finished.length})`, ...finished].join('\n');
  return { prompt, system, estimate: O.estimateTokens(system + prompt), plan: r.plan, items: r.items, settings: r.settings, facets: r.facets };
}

/** Parse the AI's answer (it may wrap the JSON in prose or a code fence). */
export function parseAi(text) {
  const t = String(text ?? ''); const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); const body = m ? m[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  const j = JSON.parse(body); if (!j || typeof j !== 'object') throw new Error('the answer is not a JSON object'); return j;
}
export function refine(req) {
  const store = loadStore();
  const { settings, filter } = runOptions({ settings: req.plan?.settings, filter: req.plan?.filter });
  const sc = scoped(store, settings, filter);
  const ai = typeof req.ai === 'string' ? parseAi(req.ai) : req.ai;
  const pl = O.applyAi(req.plan, ai, sc.items, { builds: store.builds, pricing: pricing() });
  return { plan: { ...pl, filter, out: sc.out, inProgress: sc.inProgress, profile: activeProfile().id }, items: sc.items };
}

// ---------------------------------------------------------------- apply, undo, move (one store write each)

export function apply(req, { by = process.env.AXF_ACTOR || 'optimizer' } = {}) {
  const { settings, filter } = runOptions({ settings: req.settings, filter: req.filter });
  let out;
  withStore((s) => {
    const sc = scoped(s, settings, filter); // re-checked under the lock: anything started meanwhile is refused
    const r = applyOptimize(s, { packs: req.packs, emptied: req.emptied ?? settings.safety.emptied }, { items: sc.items, by, mode: req.mode === 'deep' ? 'deep' : 'basic', profile: activeProfile().id });
    out = { created: r.created, emptied: r.emptied, plans: r.plans, run: r.run, log: r.log };
    return r.store;
  }, { by, action: 'optimizer:apply', note: `${(req.packs ?? []).length} pack(s)` });
  return out;
}
export function undo(run, { by = process.env.AXF_ACTOR || 'optimizer' } = {}) {
  let out;
  withStore((s) => { const r = undoOptimize(s, run, { by }); out = { log: r.log, run: r.run }; return r.store; }, { by, action: 'optimizer:undo', note: run ?? 'last' });
  return out;
}
export function move(req, { by = process.env.AXF_ACTOR || 'optimizer' } = {}) {
  let out;
  withStore((s) => { const r = moveSteps(s, req.keys, req.to, { index: Number.isInteger(req.index) ? req.index : null, by }); out = { log: r.log, run: r.run, archived: r.archived }; return r.store; }, { by, action: 'optimizer:move', note: `${(req.keys ?? []).length} → ${req.to}` });
  return out;
}
export const runs = () => optimizeRuns(loadStore());

async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify({ ok: true, ...o }) : text);
  const [cmd = 'plan', ...rest] = args;
  const body = () => { const j = rest.find((a) => a.startsWith('{')); return j ? JSON.parse(j) : {}; };
  if (cmd === 'plan') {
    const r = makePlan(body()); const p = r.plan;
    return out({ plan: p, facets: r.facets, items: r.items }, [`${p.summary.line} · ${p.summary.steps} step(s) · saves ~${p.summary.saved.minutes} min${p.summary.saved.usd ? ` (~$${p.summary.saved.usd})` : ''}`,
      ...p.packs.map((x) => `\n${x.id} ${x.name} [${x.model}, ${x.thinking}, ~${x.minutes} min]${x.after.length ? ` after ${x.after.map((a) => a.id).join(', ')}` : ''}\n${x.keys.map((k, i) => `  ${i + 1}. ${k}${p.flags[k] ? `  ⚑ ${p.flags[k].why}` : ''}`).join('\n')}`),
      ...(p.warnings.length ? ['', 'Warnings:', ...p.warnings.map((w) => `  ${w}`)] : [])].join('\n'));
  }
  if (cmd === 'evidence') { const e = evidence(body()); return out({ system: e.system, prompt: e.prompt, estimate: e.estimate, plan: e.plan }, `${e.prompt}\n\n(~${e.estimate} tokens)`); }
  if (cmd === 'refine') { const r = refine(body()); return out({ plan: r.plan, items: r.items }, r.plan.summary.line); }
  if (cmd === 'apply') { const r = apply(body()); return out(r, [...r.log, `undo: optimizer.mjs undo ${r.run.id}`].join('\n')); }
  if (cmd === 'undo') { const r = undo(rest[0]); return out(r, r.log.join('\n')); }
  if (cmd === 'runs') { const r = runs(); return out({ runs: r }, r.map((x) => `${x.id} ${x.kind} ${x.at}${x.undone ? ' (undone)' : ''}: ${x.created.join(', ') || x.sources.join(', ')}`).join('\n') || 'No runs.'); }
  if (cmd === 'move') { const r = move(body()); return out(r, r.log.join('\n')); }
  if (cmd === 'settings') { const b = body(); const c = Object.keys(b).length ? setConfig(b) : loadConfig(); return out({ config: c, file: settingsFile() }, JSON.stringify(c, null, 1)); }
  if (cmd === 'preset') { const [op, name] = rest; const c = op === 'save' ? savePreset(name) : op === 'delete' ? deletePreset(name) : (() => { throw new Error('preset save|delete <name>'); })(); return out({ config: c }, Object.keys(c.presets).join('\n')); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
