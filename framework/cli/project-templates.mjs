#!/usr/bin/env node
/**
 * project-templates — duplicate a project, and keep projects as reusable boilerplates (project-template@1,
 * project-boilerplates@1). Rules: framework/plan/project-templates-core.mjs. Projects: framework/cli/projects.mjs.
 *
 * A copy starts from a template captured from the source project:
 *   - its build profile setup: the orchestrator rules (builds store) and the catalog switch;
 *   - its builds history, when asked (a read-only list in the new project's profile folder; the builds themselves
 *     stay the source's: a copy never shares or moves a build);
 *   - each plugin's own part, through its lifecycle hooks (hooks.mjs exportProjectData / importProjectData): lists
 *     and to-dos, notes, plans, and the project setup (manifest with the new name, skin, Claude accounts, plugin
 *     setup, rules and instructions). The framework never reads a plugin's data itself.
 * Lists, to-dos, notes and plans carry their structure only by default (lists, folders, categories, no items);
 * `items: all` copies the items too, `items: none` leaves them out. Builds history is off by default.
 *
 * Boilerplates are templates kept by name, shared across projects: on the hub at
 * /projects/_shared/_data/projects/boilerplates.json (AXF_PROJECT_BOILERPLATES_FILE elsewhere; else the scratch data
 * folder, else the repo's .axf-console/).
 *
 *   node framework/cli/project-templates.mjs duplicate [<project>] [--name "…"] [--id x] [--description "…"]
 *        [--items structure|all|none] [--builds] [--no-select]            a copy of the project (default: the active one)
 *   … boilerplates                                                         the saved boilerplates
 *   … boilerplate show <id>                                                one, with what it holds
 *   … boilerplate save [<project>] --name "…" [--description "…"] [--items …] [--builds]
 *   … boilerplate update <id> [--from <project>] [--items …] [--builds]   take the project's current state again
 *   … boilerplate rename <id> [--name "…"] [--description "…"]
 *   … boilerplate delete <id> --confirm <id>
 *   … boilerplate use <id> [--name "…"] [--id x] [--no-select]             a new project from a boilerplate
 *   … capture [<project>] [--items …] [--builds]                           the template a copy would start from
 *   … act '{"action":"duplicate", …}'                                      any of the above as JSON (console, MCP, voice)
 *   --json on any command prints one JSON line.
 *
 * Who: AXF_ACTOR (else "cli") is recorded as the boilerplate owner.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/project-templates-core.mjs';
import { projectDir as projectDirOf } from '../plan/projects-core.mjs';
import { DEFAULT_PROJECTS_DIR, REPO_ROOT, persistRoot, profileRel, readProfiles } from './persist.mjs';
import { act as projectsAct, readProjects, activeProject, state as projectsState } from './projects.mjs';

export const HISTORY_REL = 'framework/plan/builds-history.json';
const now = () => new Date().toISOString();
const by = () => process.env.AXF_ACTOR || 'cli';
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`);
  renameSync(tmp, f);
}

/* ------------------------------------------------------------------ where things are */

/** The boilerplates file: the hub's cross-project shared data where /projects is mounted. */
export function boilerplatesFile() {
  if (process.env.AXF_PROJECT_BOILERPLATES_FILE) return process.env.AXF_PROJECT_BOILERPLATES_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || DEFAULT_PROJECTS_DIR;
  if (existsSync(projects)) return join(projects, '_shared', '_data', 'projects', 'boilerplates.json');
  const scratch = process.env.AXF_DATA_DIR;
  if (scratch && scratch !== 'off') return join(scratch, 'project-boilerplates.json');
  return join(REPO_ROOT, '.axf-console', 'project-boilerplates.json');
}

/** A project's builds history file (inside its build profile's data folder). */
export const historyFile = (project) => join(persistRoot() ?? REPO_ROOT, profileRel(project.profile, HISTORY_REL));

/** A project by id or name (default: the active one). */
export function findProject(ref) {
  const reg = readProjects();
  if (!ref) return activeProject(reg);
  const want = String(ref).trim();
  const p = reg.projects.find((x) => x.id === want) ?? reg.projects.find((x) => x.name.toLowerCase() === want.toLowerCase());
  if (!p) throw new Error(`no project "${want}"`);
  return p;
}

/* ------------------------------------------------------------------ capture and apply */

async function dataPlugins() {
  const { projectDataPlugins } = await import('./plugin-lifecycle.mjs');
  return projectDataPlugins();
}

function hookCtx(plugin, project, carry, log) {
  return { ...plugin.ctx(log), project: { ...project }, projectDir: (dir) => projectDirOf(dir, project), carry: { ...carry }, persistRoot: persistRoot() };
}

/** The template a copy of `project` (id, name or entry; default the active one) starts from. */
export async function capture(projectRef, carryRaw, { log = () => {} } = {}) {
  const project = typeof projectRef === 'object' && projectRef ? projectRef : findProject(projectRef);
  const carry = core.normaliseCarry(carryRaw);
  const { loadStore } = await import('./builds-store.mjs');
  const store = loadStore();
  const rules = store.rules?.[project.profile] ?? null;
  const profile = readProfiles().profiles.find((p) => p.id === project.profile);
  const history = carry.builds
    ? store.builds.filter((b) => !b.deleted && (b.profiles ?? []).includes(project.profile)).map(core.historyRow)
    : null;
  const plugins = {};
  for (const pl of await dataPlugins()) {
    try {
      const data = await pl.exportProjectData(hookCtx(pl, project, carry, log));
      if (data !== null && data !== undefined) plugins[pl.folder] = { label: pl.label, data: JSON.parse(JSON.stringify(data)) };
    } catch (e) { log(`! ${pl.name}: not captured (${e.message})`); }
  }
  return core.normaliseTemplate({
    capturedAt: now(),
    source: { id: project.id, name: project.name, description: project.description, base: !!project.base },
    carry,
    // the base project's catalog switch comes with being the base: a copy builds its own plan
    profile: { rules, catalog: !project.base && profile?.catalog === true },
    history,
    plugins,
  });
}

/**
 * Put a template into `project` (a projects@1 entry, normally just made). Adds only: nothing the project already has
 * is overwritten. `skip` = plugin folders whose part the caller puts in itself.
 */
export async function apply(project, templateRaw, { skip = [], log = () => {} } = {}) {
  const t = core.normaliseTemplate(templateRaw);
  const out = { parts: [], problems: [] };
  const say = (m) => { log(m); };
  if (t.profile.rules) {
    const { withStore } = await import('./builds-store.mjs');
    let set = false;
    withStore((s) => { if (!s.rules[project.profile]) { s.rules[project.profile] = JSON.parse(JSON.stringify(t.profile.rules)); set = true; } return s; }, { by: by(), action: 'project-template', note: `build rules for ${project.id} from ${t.source.id || 'a template'}` });
    if (set) { out.parts.push('build rules'); say('  build rules copied'); }
  }
  if (t.profile.catalog) {
    const profiles = await import('./profiles.mjs');
    profiles.act({ action: 'update', id: project.profile, catalog: true });
    out.parts.push('catalog');
  }
  if (t.history) {
    const f = historyFile(project);
    if (!existsSync(f)) {
      writeJson(f, { $axf: 'builds-history@1', from: { id: t.source.id, name: t.source.name }, copiedAt: now(), builds: t.history });
      out.parts.push(`${t.history.length} past build(s)`);
      say(`  builds history: ${t.history.length} build(s) of ${t.source.name}`);
    }
  }
  const plugins = await dataPlugins();
  for (const [folder, part] of Object.entries(t.plugins)) {
    if (skip.includes(folder)) continue;
    const pl = plugins.find((p) => p.folder === folder);
    if (!pl) { out.problems.push(`${part.label}: the plugin isn't installed here, its part was left out`); continue; }
    try {
      const r = await pl.importProjectData(hookCtx(pl, project, t.carry, log), part.data);
      out.parts.push(part.label);
      say(`  ${part.label}${r?.note ? `: ${r.note}` : ''}`);
    } catch (e) { out.problems.push(`${part.label}: ${e.message}`); say(`! ${part.label}: ${e.message}`); }
  }
  return out;
}

/** The builds history a copy brought along (null when none). */
export function readHistory(project) {
  return readJson(historyFile(project));
}

/* ------------------------------------------------------------------ duplicate and new from a boilerplate */

function newIdentity(reg, { name, id }, fallbackName) {
  const nm = String(name ?? '').trim() || core.copyName(fallbackName, reg.projects.map((p) => p.name));
  const taken = [...reg.projects.map((p) => p.id), ...readProfiles().profiles.map((p) => p.id)];
  return { name: nm, id: id ? String(id).trim() : core.freeId(nm, taken) };
}

async function createWith(template, c, fallbackName) {
  const reg = readProjects();
  const who = newIdentity(reg, c, fallbackName);
  const description = typeof c.description === 'string' ? c.description : template.source.description;
  // made inactive, filled, then switched to: nothing opens the new project before its data is in place
  const made = await projectsAct({ action: 'create', name: who.name, id: who.id, description, select: false });
  const log = [...made.log];
  const applied = await apply(made.project, template, { skip: c.skip ?? [], log: (m) => log.push(m) });
  log.push(`${made.project.name} (${made.project.id}) starts from ${template.source.name || 'a template'}: ${applied.parts.length ? applied.parts.join(', ') : 'settings only'}`);
  for (const p of applied.problems) log.push(`! ${p}`);
  if (c.select !== false) log.push(...(await projectsAct({ action: 'select', id: made.project.id })).log);
  return { project: made.project, log, parts: applied.parts, problems: applied.problems, state: await projectsState() };
}

/** A copy of a project as a new project: { from?, name?, id?, description?, items?, builds?, select? }. */
export async function duplicate(c = {}) {
  const src = findProject(c.from ?? c.project);
  const carry = core.normaliseCarry(c.carry ?? c);
  const template = await capture(src, carry);
  return { ...(await createWith(template, c, src.name)), from: { id: src.id, name: src.name }, carry };
}

/** A new project from a saved boilerplate: { boilerplate, name?, id?, description?, select? }. */
export async function createFromBoilerplate(c = {}) {
  const b = getBoilerplate(c.boilerplate);
  return { ...(await createWith(b.template, { ...c, name: c.name || '' }, b.name)), boilerplate: core.boilerplateSummary(b) };
}

/* ------------------------------------------------------------------ boilerplates */

export function readBoilerplates() { return core.normaliseBoilerplates(readJson(boilerplatesFile())); }

export function listBoilerplates() { return readBoilerplates().boilerplates.map(core.boilerplateSummary); }

export function getBoilerplate(ref) {
  const want = String(ref ?? '').trim();
  const reg = readBoilerplates();
  const b = reg.boilerplates.find((x) => x.id === want) ?? reg.boilerplates.find((x) => x.name.toLowerCase() === want.toLowerCase());
  if (!b) throw new Error(`no boilerplate "${want}"`);
  return b;
}

function changeBoilerplates(change) {
  const r = core.applyBoilerplateChange(readBoilerplates(), change, { now: now(), by: by() });
  writeJson(boilerplatesFile(), core.boilerplatesOut(r.reg, now()));
  return { boilerplate: core.boilerplateSummary(r.boilerplate), log: r.log, boilerplates: r.reg.boilerplates.map(core.boilerplateSummary) };
}

/** Save a project (default the active one) as a boilerplate: { from?, name, description?, id?, items?, builds? }. */
export async function saveBoilerplate(c = {}) {
  const src = findProject(c.from ?? c.project);
  const template = await capture(src, core.normaliseCarry(c.carry ?? c));
  return changeBoilerplates({ action: 'save', name: c.name, description: c.description, id: c.id, template });
}

/** Take a project's current state into a boilerplate again: { id, from?, items?, builds?, description? }. */
export async function updateBoilerplate(c = {}) {
  const b = getBoilerplate(c.id ?? c.boilerplate);
  const src = findProject(c.from ?? c.project ?? b.from.id ?? undefined);
  const carry = c.items || c.builds !== undefined || c.carry ? core.normaliseCarry(c.carry ?? c) : b.template.carry;
  const template = await capture(src, carry);
  return changeBoilerplates({ action: 'update', id: b.id, template, description: c.description });
}

export const renameBoilerplate = (c = {}) => changeBoilerplates({ action: 'rename', id: c.id ?? c.boilerplate, name: c.name, description: c.description });
export const deleteBoilerplate = (c = {}) => changeBoilerplates({ action: 'delete', id: c.id ?? c.boilerplate, confirm: c.confirm });

/* ------------------------------------------------------------------ one entry point (console, MCP, voice) */

export async function act(c = {}) {
  switch (c.action) {
    case 'duplicate': return duplicate(c);
    case 'capture': { const t = await capture(c.from ?? c.project, c.carry ?? c); return { template: t, holds: core.describeTemplate(t) }; }
    case 'boilerplates': return { boilerplates: listBoilerplates(), file: boilerplatesFile() };
    case 'boilerplate': { const b = getBoilerplate(c.id ?? c.boilerplate); return { boilerplate: { ...core.boilerplateSummary(b), template: b.template } }; }
    case 'boilerplate-save': return saveBoilerplate(c);
    case 'boilerplate-update': return updateBoilerplate(c);
    case 'boilerplate-rename': return renameBoilerplate(c);
    case 'boilerplate-delete': return deleteBoilerplate(c);
    case 'boilerplate-use': return createFromBoilerplate(c);
    default: throw new Error(`unknown action "${c.action}" (duplicate, capture, boilerplates, boilerplate, boilerplate-save, boilerplate-update, boilerplate-rename, boilerplate-delete, boilerplate-use)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const VALUED = ['--name', '--id', '--description', '--items', '--confirm', '--from'];
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1])));
  const carry = { ...(flag('--items') ? { items: flag('--items') } : {}), ...(args.includes('--builds') ? { builds: true } : {}) };
  const out = (v, text) => console.log(json ? JSON.stringify({ ok: true, ...v }) : text ?? JSON.stringify(v, null, 2));
  try {
    const [cmd = 'boilerplates', a1, a2] = pos;
    let r;
    if (cmd === 'act') r = await act(JSON.parse(a1 ?? '{}'));
    else if (cmd === 'duplicate') r = await duplicate({ from: a1, name: flag('--name'), id: flag('--id'), description: flag('--description'), select: !args.includes('--no-select'), ...carry });
    else if (cmd === 'capture') r = await act({ action: 'capture', from: a1, ...carry });
    else if (cmd === 'boilerplates') r = await act({ action: 'boilerplates' });
    else if (cmd === 'boilerplate') {
      const sub = a1;
      if (sub === 'show') r = await act({ action: 'boilerplate', id: a2 });
      else if (sub === 'save') r = await saveBoilerplate({ from: a2, name: flag('--name'), description: flag('--description'), id: flag('--id'), ...carry });
      else if (sub === 'update') r = await updateBoilerplate({ id: a2, from: flag('--from'), description: flag('--description'), ...carry });
      else if (sub === 'rename') r = renameBoilerplate({ id: a2, name: flag('--name'), description: flag('--description') });
      else if (sub === 'delete') r = deleteBoilerplate({ id: a2, confirm: flag('--confirm') });
      else if (sub === 'use') r = await createFromBoilerplate({ boilerplate: a2, name: flag('--name'), id: flag('--id'), select: !args.includes('--no-select') });
      else throw new Error('boilerplate show | save | update | rename | delete | use');
    } else throw new Error(`unknown command ${cmd}`);
    const text = r.log ? r.log.join('\n') : r.boilerplates ? (r.boilerplates.length ? r.boilerplates.map((b) => `${b.id.padEnd(24)} ${b.name} · ${b.holds}`).join('\n') : 'No boilerplates yet.') : undefined;
    out(r, text);
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exit(1);
  }
}
