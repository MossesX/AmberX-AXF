#!/usr/bin/env node
/**
 * project — project manifests (project.manifest.json, project-manifest@1) for the build engine, CLI and console.
 *
 * Runs framework/core/project-check.mjs (the JavaScript copy of the reference validator in core/project.ts; the
 * Kotlin kernel mirrors it too) with the rules in force: framework/schemas/project-rules.json, read through
 * dataPath() so the rules edited in the Dev Console (Standards) are the ones the build engine enforces. Locked rules can never be removed or loosened: a rules file
 * that tries is refused and the framework's own copy is used instead.
 *
 * The build engine's rule: no project is loaded or compiled without a validated manifest (requireProject).
 *
 *   node framework/cli/project.mjs validate [dir ...]   validate manifests (default: this folder); --all = every project in the repo
 *   node framework/cli/project.mjs init [dir] [--name n] [--display "Name"] [--kind app] [--relation built-on]
 *                                      [--repo owner/name] [--exists] [--visibility private] [--path apps/x]
 *   node framework/cli/project.mjs list                 every project in the repo (and projects/ registry) with its status
 *   node framework/cli/project.mjs rules                the rules in force
 *   node framework/cli/project.mjs schema [out]         write the JSON Schema generated from the rules
 *   --json  machine-readable output
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, dataPath } from './persist.mjs';

import {
  PROJECT_MANIFEST_FILE, PROJECT_MANIFEST_TAG, PROJECT_RULES_TAG, RULE_OPS, formatProjectValidation, jsonSchema as jsonSchemaFor,
  manifestValue, ruleSeverity, validateProjectManifest as validateWith, validateProjectRules as validateRulesWith,
} from '../core/project-check.mjs';

export { PROJECT_MANIFEST_FILE, PROJECT_MANIFEST_TAG, PROJECT_RULES_TAG, RULE_OPS, formatProjectValidation, manifestValue, ruleSeverity };
export const RULES_REL = 'framework/schemas/project-rules.json';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Validates against the rules in force unless others are given. */
export const validateProjectManifest = (raw, rules = loadRules(), opts = {}) => validateWith(raw, rules, opts);
/** Problems with a rules file; locked rules are checked against the framework's own. */
export const validateProjectRules = (raw, base = baseRules()) => validateRulesWith(raw, base);
export const jsonSchema = (rules = baseRules()) => jsonSchemaFor(rules);

/** The framework's own rules (the repo copy): the base locked rules are checked against. */
export function baseRules() { return readJson(join(REPO_ROOT, RULES_REL)); }

/** The rules in force: the shared copy (hub or repo) when it is valid, else the framework's own. */
export function loadRules() {
  const base = baseRules();
  let live;
  try { live = readJson(dataPath(RULES_REL)); } catch { return base; }
  const problems = validateProjectRules(live, base);
  if (problems.length) {
    process.emitWarning(`project rules at ${dataPath(RULES_REL)} were refused (${problems[0]}); using the framework's own`);
    return base;
  }
  return live;
}

/** Reads and validates the manifest in `dir`. Never throws. */
export function checkProject(dir = '.', { rules = loadRules() } = {}) {
  const root = resolve(dir);
  const file = join(root, PROJECT_MANIFEST_FILE);
  const base = { dir: root, file, rel: relative(REPO_ROOT, root) || '.' };
  if (!existsSync(file)) return { ...base, exists: false, manifest: null, validation: { ok: false, errors: [{ rule: 'manifest-missing', path: '', message: `no ${PROJECT_MANIFEST_FILE}` }], warnings: [] } };
  let manifest;
  try { manifest = readJson(file); } catch (e) {
    return { ...base, exists: true, manifest: null, validation: { ok: false, errors: [{ rule: 'manifest-json', path: '', message: `not valid JSON (${e.message})` }], warnings: [] } };
  }
  const validation = validateProjectManifest(manifest, rules, { exists: (p) => existsSync(join(root, p)) });
  return { ...base, exists: true, manifest, validation };
}

/**
 * The build engine's gate: returns the manifest, or throws when the project in `dir` has no manifest or it fails
 * validation. `what` names what was refused ("loaded", "compiled", ...).
 */
export function requireProject(dir = '.', what = 'loaded or compiled') {
  const r = checkProject(dir);
  if (r.validation.ok) return r.manifest;
  const how = r.exists ? 'Fix it (Dev Console → Standards lists the rules)' : `Create one: node framework/cli/project.mjs init ${r.rel === '.' ? '' : r.rel}`.trim();
  const err = new Error(`AXF: ${r.rel} can't be ${what}: ${r.exists ? 'its project manifest failed validation' : `it has no ${PROJECT_MANIFEST_FILE}`}.\n${formatProjectValidation(r.validation, join(r.rel, PROJECT_MANIFEST_FILE))}\n${how}.`);
  err.code = 'axf_project_invalid';
  err.project = r;
  throw err;
}

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '.gradle', 'target', 'out', '_claude', '_data', 'src', 'templates', 'boilerplates', 'library-templates']);
/** Every folder in the repo with a manifest (root, apps, libraries), plus the projects/ registry. */
export function findProjects(root = REPO_ROOT) {
  const out = [];
  const visit = (d, depth) => {
    if (existsSync(join(d, PROJECT_MANIFEST_FILE))) out.push(d);
    if (depth >= 4) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) visit(join(d, e.name), depth + 1);
  };
  visit(root, 0);
  return out;
}

/** A new manifest from options (used by `axf init` and `project init`). */
export function draftManifest({ name, displayName, description = '', kind = 'app', relation = 'built-on', version, platforms, owner = 'MossesX', repoName, exists = false, visibility = 'private', path, locationRepo, appManifest, template, frameworkVersion, shared = [] } = {}) {
  const slug = String(name ?? 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'project';
  const m = {
    $manifest: PROJECT_MANIFEST_TAG,
    name: slug,
    displayName: displayName ?? name ?? slug,
    description,
    kind,
    status: 'active',
    ...(version ? { version } : {}),
    ...(platforms?.length ? { platforms } : {}),
    framework: { relation, ...(frameworkVersion ? { version: frameworkVersion } : {}), ...(template ? { template } : {}), ...(appManifest ? { appManifest } : {}) },
    repo: { host: 'github', owner, name: repoName ?? slug, exists, visibility, ...(exists ? { defaultBranch: 'main', url: `https://github.com/${owner}/${repoName ?? slug}` } : {}) },
    ...(locationRepo || path ? { location: { repo: locationRepo ?? `${owner}/${repoName ?? slug}`, path: path ?? '.' } } : {}),
    data: { shared },
    owners: [owner],
    created: new Date().toISOString().slice(0, 10),
  };
  return m;
}

/** JSON Schema (2020-12) for editors, generated from the rules so it never drifts from them. */
// ─── CLI ────────────────────────────────────────────────────────────────────
function cli() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const bool = (n) => { const i = argv.indexOf(`--${n}`); if (i < 0) return false; argv.splice(i, 1); return true; };
  const json = bool('json'), all = bool('all');
  const [cmd = 'help', ...rest] = argv;
  if (cmd === 'validate') {
    const dirs = all ? findProjects() : rest.length ? rest : ['.'];
    const rules = loadRules();
    const results = dirs.map((d) => checkProject(d, { rules }));
    if (json) { console.log(JSON.stringify(results.map(({ manifest, ...r }) => ({ ...r, name: manifest?.name ?? null })), null, 2)); }
    else for (const r of results) {
      console.log(`${r.validation.ok ? '✓' : '✗'} ${r.rel}${r.manifest?.name ? ` (${r.manifest.name})` : ''}: ${r.validation.errors.length} error(s), ${r.validation.warnings.length} warning(s)`);
      const lines = formatProjectValidation(r.validation, join(r.rel, PROJECT_MANIFEST_FILE));
      if (lines) console.log(lines.replace(/^/gm, '    '));
    }
    process.exit(results.every((r) => r.validation.ok) ? 0 : 1);
  }
  if (cmd === 'init') {
    const dir = resolve(rest[0] ?? '.');
    const file = join(dir, PROJECT_MANIFEST_FILE);
    if (existsSync(file)) { console.log(`${relative(process.cwd(), file) || file} already exists`); process.exit(0); }
    const [owner, repoName] = (flag('repo') ?? '').split('/');
    const m = draftManifest({ name: flag('name') ?? basename(dir), displayName: flag('display'), kind: flag('kind'), relation: flag('relation'), owner: owner || undefined, repoName: repoName || undefined, exists: bool('exists'), visibility: flag('visibility'), path: flag('path') });
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
    const v = validateProjectManifest(m, loadRules(), { exists: (p) => existsSync(join(dir, p)) });
    console.log(`Wrote ${file}${v.ok ? '' : `\n${formatProjectValidation(v)}`}`);
    process.exit(v.ok ? 0 : 1);
  }
  if (cmd === 'list') {
    const rules = loadRules();
    const rows = findProjects().map((d) => checkProject(d, { rules }));
    if (json) return console.log(JSON.stringify(rows.map(({ manifest, ...r }) => ({ ...r, name: manifest?.name ?? null, displayName: manifest?.displayName ?? null, kind: manifest?.kind ?? null, repo: manifest?.repo ?? null })), null, 2));
    for (const r of rows) console.log(`${r.validation.ok ? '✓' : '✗'} ${(r.manifest?.name ?? '?').padEnd(22)} ${r.rel}  → /projects/${r.manifest?.name ?? '?'}`);
    return;
  }
  if (cmd === 'rules') {
    const rules = loadRules();
    if (json) return console.log(JSON.stringify(rules, null, 2));
    console.log(`Rules in force: ${dataPath(RULES_REL)}`);
    for (const r of rules.rules) console.log(`${ruleSeverity(r).padEnd(5)} ${r.locked ? '🔒' : '  '} ${r.id.padEnd(22)} ${r.title}`);
    return;
  }
  if (cmd === 'schema') {
    const out = resolve(rest[0] ?? join(REPO_ROOT, 'framework/schemas/json/project-manifest.schema.json'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(jsonSchema(), null, 2) + '\n');
    return console.log(`Wrote ${out}`);
  }
  process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
