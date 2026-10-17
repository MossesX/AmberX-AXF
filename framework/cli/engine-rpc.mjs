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
import { FRAMEWORK_DIR, init, listBoilerplates, listModules, listTemplates, loadBoilerplate, newAsset, newDemoApp, newModule, validateApp } from './build-engine.mjs';
import { installLibrary, listLibraries, writeLibrariesIndex } from './libraries.mjs';
import { importUiLibrary, listPortedKits } from './ui-port.mjs';
import { buildPlan, deleteFeature, loadPlan, saveMedia, upsertFeature } from './plan.mjs';

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
    case 'tracker': return existsSync(join(ROOT, 'tracker.json')) ? readJson(join(ROOT, 'tracker.json')) : { items: [], summary: {} };
    case 'status': { // { id, status, wave?, module?, notes? } → status.json + regenerate tracker.json + libraries.json
      const f = join(FRAMEWORK_DIR, 'catalog/status.json');
      const s = existsSync(f) ? readJson(f) : {};
      s[b.id] = { ...(s[b.id] ?? {}), status: b.status, ...(b.wave ? { wave: b.wave } : {}), ...(b.module ? { module: b.module } : {}), ...(b.notes != null ? { notes: b.notes } : {}) };
      writeFileSync(f, JSON.stringify(s, null, 2) + '\n');
      execFileSync(process.execPath, [join(FRAMEWORK_DIR, 'cli/tracker.mjs')], { stdio: 'pipe' });
      log(`status.json: ${b.id} → ${b.status}; tracker.json regenerated`);
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
    case 'plan': return loadPlan();
    case 'plan-rebuild': { const p = buildPlan(); log(`plan rebuilt: ${p.features.length} features`); return { count: p.features.length }; }
    case 'plan-upsert': { const f = upsertFeature(b.feature, b.note); log(`plan: ${f.id} saved (${f.status})`); return { feature: f }; }
    case 'plan-delete': { deleteFeature(b.id); log(`plan: ${b.id} deleted`); return { id: b.id }; }
    case 'plan-media': return { src: saveMedia(b.id, b.dataUrl) };
    case 'init': { const r = init({ dir: safeDir(b.dir ?? (b.id ?? b.name ?? 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')), name: b.name, id: b.id, template: b.template ?? 'react-ts', modules: b.modules ?? [], boilerplate: b.boilerplate, libraries: b.libraries ?? [], applicationId: b.applicationId, log }); return { dir: relative(ROOT, r.dir), manifest: r.manifest, report: r.report, libraries: r.libraries }; }
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
