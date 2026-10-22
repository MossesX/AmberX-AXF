#!/usr/bin/env node
/**
 * engine-rpc — one-shot JSON interface to the build engine for other languages (the console's Python API).
 *
 *   echo '{"op":"libraries"}' | node framework/cli/engine-rpc.mjs
 *   node framework/cli/engine-rpc.mjs install '{"dir":"apps/x","library":"browser","params":{}}'
 *
 * Reads { op, ...args } from argv[3] or stdin, prints { ok, log, ...result } (errors → { ok:false, error }).
 * Every op mirrors serve.mjs so the Python backend and the Node HTTP driver stay interchangeable.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describeOptions } from './build-options.mjs';
import { FRAMEWORK_DIR, appOptions, init, listBoilerplates, listFrameworkAssets, listModules, listTemplates, loadBoilerplate, newAsset, newDemoApp, newModule, validateApp, appDefaults, spec as assetSpec } from './build-engine.mjs';
import { installLibrary, listLibraries, writeLibrariesIndex } from './libraries.mjs';
import { importUiLibrary, listPortedKits } from './ui-port.mjs';
import { compileLibrary, listLibraryTemplates, newLibrary, portLibrary, removeLibrary } from './library-templates.mjs';
import { buildPlan, deleteFeature, loadPlan, saveMedia, upsertFeature } from './plan.mjs';
import { queueView, reorderQueue, reprocessQueue, stepQueue, stepsQueue, syncBuildQueue } from './build-queue.mjs';
import { actPending, loadPending } from './pending.mjs';
import { dataPath } from './persist.mjs';
import { RULES_REL, baseRules, checkProject, findProjects, loadRules, validateProjectManifest, validateProjectRules } from './project.mjs';
const syncAfter = () => { try { syncBuildQueue({ by: 'feature-tracker', log: (m) => log(`build queue: ${m}`) }); } catch (e) { log(`build queue sync failed: ${e.message}`); } };

const ROOT = resolve(FRAMEWORK_DIR, '..');
const safeDir = (d) => { const p = resolve(ROOT, d ?? ''); if (!p.startsWith(ROOT)) throw new Error('dir must be inside the repo'); return p; };
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

const op = process.argv[2] && !process.argv[2].startsWith('{') ? process.argv[2] : undefined;
const argJson = process.argv.find((a, i) => i >= 2 && a.startsWith('{'));
const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };
const raw = argJson ?? (op && process.argv.length === 3 ? '{}' : readStdin() || '{}');
const req = JSON.parse(raw);
const b = { ...req, op: op ?? req.op };
const lines = [];
/** What a new app starts with besides its slots (framework/app-defaults.json) plus what the chrome can do: for designers (Build Pilot). */
function appDefaultsView() {
  const types = assetSpec.types;
  const widgetTypes = Object.keys(types).filter((t) => types[t].widget === true);
  const attachableTypes = Object.keys(types).filter((t) => types[t].attachable === true);
  const hosts = {};
  for (const [t, ts] of Object.entries(types)) {
    // Same rule as the engines: an `attach` block without `types` takes every attachable type, `widgets` every widget type.
    if (ts.attach) hosts[t] = { field: 'attach', types: ts.attach.types ?? attachableTypes, sides: ts.attach.sides ?? [] };
    else if (ts.widgets) hosts[t] = { field: 'widgets', types: widgetTypes, sides: ts.widgets.sides ?? [] };
  }
  return { $axf: 'app-defaults@1', hidden: appDefaults.hidden ?? [], hideable: Object.keys(types).filter((t) => types[t].hideable), hosts,
    widgets: widgetTypes, attachable: attachableTypes,
    typeLabels: Object.fromEntries(Object.entries(types).filter(([, ts]) => ts.label).map(([t, ts]) => [t, ts.label])),
    typeIcons: Object.fromEntries(Object.entries(types).filter(([, ts]) => ts.icon).map(([t, ts]) => [t, ts.icon])),
    enums: Object.fromEntries(Object.entries(types).filter(([, ts]) => ts.enums).map(([t, ts]) => [t, ts.enums])) };
}

const log = (m) => lines.push(m);

function run() {
  switch (b.op) {
    case 'health': return { axf: 'engine-rpc@1', root: ROOT };
    case 'templates': return { templates: listTemplates() };
    case 'modules': return { modules: listModules() };
    case 'libraries': return { items: listLibraries() };
    case 'ported-kits': return { kits: listPortedKits() };
    case 'boilerplates': return readJson(join(FRAMEWORK_DIR, 'boilerplates/index.json'));
    case 'boilerplate-items': return { items: listBoilerplates().map((i) => loadBoilerplate(i.id)) };
    case 'catalog': return readJson(join(FRAMEWORK_DIR, 'catalog/catalog.json'));
    case 'tracker': return existsSync(dataPath('tracker.json')) ? readJson(dataPath('tracker.json')) : { items: [], summary: {} };
    case 'status': { // { id, status, wave?, module?, notes? } → status.json + regenerate tracker.json + libraries.json
      const f = dataPath('framework/catalog/status.json');
      const s = existsSync(f) ? readJson(f) : {};
      s[b.id] = { ...(s[b.id] ?? {}), status: b.status, ...(b.wave ? { wave: b.wave } : {}), ...(b.module ? { module: b.module } : {}), ...(b.notes != null ? { notes: b.notes } : {}) };
      writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
      execFileSync(process.execPath, [join(FRAMEWORK_DIR, 'cli/tracker.mjs')], { stdio: 'pipe' });
      log(`status.json: ${b.id} → ${b.status}; tracker.json regenerated`);
      syncAfter();
      return { id: b.id, status: b.status };
    }
    case 'boilerplate-save': { // a boilerplate@1 object → framework/boilerplates/<id>/boilerplate.json + index
      const dir = join(FRAMEWORK_DIR, 'boilerplates', String(b.boilerplate?.id ?? b.id));
      mkdirSync(dir, { recursive: true });
      const data = { $axf: 'boilerplate@1', ...(b.boilerplate ?? b) }; delete data.op;
      writeFileSync(join(dir, 'boilerplate.json'), JSON.stringify(data, null, 2) + '\n');
      execFileSync(process.execPath, [join(FRAMEWORK_DIR, 'cli/boilerplates.mjs')], { stdio: 'pipe' });
      log(`boilerplate ${data.id} saved; index regenerated`);
      return { id: data.id, file: relative(ROOT, join(dir, 'boilerplate.json')) };
    }
    case 'library-templates': return { items: listLibraryTemplates() };
    case 'new-library': { const r = newLibrary({ name: b.name, label: b.label, description: b.description, template: b.template, ports: b.ports, features: b.features ?? [], params: b.params ?? {}, log }); writeLibrariesIndex(); return r; }
    case 'compile-library': return compileLibrary({ slug: b.slug, ports: b.ports, log });
    case 'port-library': { const r = portLibrary({ slug: b.slug, to: b.to, log }); writeLibrariesIndex(); return r; }
    case 'remove-library': { const r = removeLibrary({ slug: b.slug, log }); writeLibrariesIndex(); return r; }
    // Standards → project manifests (project.manifest.json, project-manifest@1) and their rules.
    case 'projects': {
      const rules = loadRules();
      return { rulesFile: relative(ROOT, dataPath(RULES_REL)) || dataPath(RULES_REL), items: findProjects(ROOT).map((d) => { const r = checkProject(d, { rules }); return { dir: r.rel, exists: r.exists, manifest: r.manifest, validation: r.validation }; }) };
    }
    case 'project-rules': return { rules: loadRules(), base: baseRules(), file: dataPath(RULES_REL) };
    case 'project-rules-save': { // { rules } → validated, then written to the shared copy (hub or repo)
      const problems = validateProjectRules(b.rules);
      if (problems.length) throw new Error(`rules refused: ${problems.join('; ')}`);
      const out = { ...b.rules, updatedAt: new Date().toISOString() };
      writeFileSync(dataPath(RULES_REL), JSON.stringify(out, null, 2) + '\n');
      log(`project rules saved (${out.rules.length} rules) → ${dataPath(RULES_REL)}`);
      return { rules: out };
    }
    case 'project-validate': { // { dir } (a project in the repo) or { manifest } (an edited one, checked without file access)
      if (b.manifest !== undefined) return { validation: validateProjectManifest(b.manifest, b.rules ?? loadRules()) };
      const r = checkProject(safeDir(b.dir ?? '.'));
      return { dir: r.rel, manifest: r.manifest, validation: r.validation };
    }
    case 'pending': return loadPending();
    case 'pending-act': { const r = actPending(b.change ?? {}); r.log.forEach(log); return { state: r.state, item: r.item }; }
    case 'plan': return loadPlan();
    case 'plan-rebuild': { const p = buildPlan(); log(`plan rebuilt: ${p.features.length} features`); return { count: p.features.length }; }
    case 'plan-upsert': { const f = upsertFeature(b.feature, b.note); log(`plan: ${f.id} saved (${f.status})`); syncAfter(); return { feature: f }; }
    case 'plan-delete': { deleteFeature(b.id); log(`plan: ${b.id} deleted`); return { id: b.id }; }
    case 'plan-media': return { src: saveMedia(b.id, b.dataUrl) };
    case 'build-queue': return queueView();
    case 'build-sync': return syncBuildQueue({ by: b.by ?? 'console:init', log });
    case 'build-reorder': return reorderQueue({ order: b.order, by: b.by ?? 'console', log });
    case 'build-reprocess': return reprocessQueue({ apply: !!b.apply, by: b.by ?? 'console', log });
    case 'build-step': return stepQueue({ id: b.id, action: b.action, status: b.status, note: b.note, by: b.by ?? 'console', log });
    case 'build-steps': { const { by, ...edit } = b; return stepsQueue({ ...edit, by: by ?? 'console', log }); } // estimate + small steps of one queue step (Oct 21 2026)
    case 'init': { const r = init({ dir: safeDir(b.dir ?? (b.id ?? b.name ?? 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')), name: b.name, id: b.id, template: b.template ?? 'react-ts', modules: b.modules ?? [], boilerplate: b.boilerplate, libraries: b.libraries ?? [], applicationId: b.applicationId, options: b.options ?? {}, slots: b.slots ?? {}, hidden: b.hidden, assets: b.assets, developer: b.developer, log }); return { dir: relative(ROOT, r.dir), manifest: r.manifest, report: r.report, libraries: r.libraries }; }
    case 'build-options': return { options: describeOptions() };
    case 'app-defaults': return appDefaultsView();
    case 'framework-assets': return { template: b.template ?? null, assets: listFrameworkAssets(b.template) };
    case 'options': { const r = appOptions({ dir: b.framework ? '.' : safeDir(b.dir ?? '.'), framework: !!b.framework, options: b.options ?? {}, log }); return r; }
    case 'validate': return { dir: b.dir, report: validateApp(safeDir(b.dir)) };
    case 'new-asset': return { file: relative(ROOT, newAsset({ dir: safeDir(b.dir), type: b.type, id: b.id, from: b.from, name: b.name })) };
    case 'new-module': { const r = newModule({ name: b.name, label: b.label, capabilities: b.capabilities ?? [], dependsOn: b.dependsOn ?? [], compose: b.compose !== false, log }); return { ...r, dir: relative(ROOT, r.dir) }; }
    case 'new-demo': { const r = newDemoApp({ library: b.library, name: b.name, dir: b.dir ? safeDir(b.dir) : undefined, log }); return { dir: relative(ROOT, r.dir), manifest: r.manifest, report: r.report }; }
    case 'install': { const r = installLibrary({ dir: safeDir(b.dir), library: b.library, params: b.params ?? {}, log }); return { dir: relative(ROOT, r.dir), library: r.library, config: r.config, changed: r.changed, script: r.script }; }
    case 'import-ui': { const r = importUiLibrary({ name: b.name, kitId: b.kitId, library: b.library, version: b.version, source: b.source, covers: b.covers, dir: b.dir ? safeDir(b.dir) : undefined, overwrite: !!b.overwrite, log }); writeLibrariesIndex(); return { module: r.module, kitId: r.kitId, report: r.report }; }
    default: throw new Error(`unknown op "${b.op}"`);
  }
}

try { const result = run(); process.stdout.write(JSON.stringify({ ok: true, log: lines, ...result }) + '\n'); }
catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: e.message, log: lines }) + '\n'); process.exitCode = 1; }
