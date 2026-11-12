/**
 * projects-core — projects (projects@1): the pure rules. No IO; framework/cli/projects.mjs reads and writes.
 *
 * A project is one workspace with its own builds, notes, to-dos, tasks, lists and plans. Exactly one project is
 * active; everything that holds work data reads and writes the active project's copy:
 *
 *   builds store, orchestrator, Pending, build queue, plan, catalog status  → the project's build profile
 *                                                                            (build-profiles@1, persist.mjs dataPath)
 *   plugin data (to-do manager, Plan Studio, …)                             → projectDir(project, <plugin data dir>)
 *   notes (the hub's shared Claude notes)                                    → notesFolder(project)
 *
 * The base project, AmberX AXF, owns the base build profile (`all`) and keeps every original path: the migration
 * into it moves nothing and deletes nothing (Brett, Nov 12 2026: "Move all current builds, notes, to-dos and plans
 * into a project called AmberX AXF. Nothing deleted."). Every other project starts empty.
 *
 * Registry (framework/plan/projects.json, shared data on axHub, never profiled):
 *   { $axf: 'projects@1', updatedAt, active: <id>, migratedAt,
 *     projects: [{ id, name, description, profile, status: active|archived, base, createdAt, updatedAt, archivedAt, by }] }
 */

export const SCHEMA = 'projects@1';
export const PROJECTS_REL = 'framework/plan/projects.json';
export const BASE_PROJECT_ID = 'amberx-axf';
export const BASE_PROFILE_ID = 'all';
export const STATUSES = ['active', 'archived'];
export const ACTIONS = ['select', 'create', 'rename', 'archive', 'unarchive', 'delete'];
/** Same shape as a build profile id (a project owns the profile with its own id). */
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Ids a new project can't take: the base profile, the retired build profiles and folder names the scoping uses. */
export const RESERVED_IDS = ['all', 'current', 'urgent', 'angel', 'big-dog', 'breakroom', 'refactor', 'main-framework', 'projects', 'profiles', 'shared', '_shared'];

export const BASE_PROJECT = Object.freeze({
  id: BASE_PROJECT_ID,
  name: 'AmberX AXF',
  description: 'The AmberX framework, console, axHub and apps: every build, note, to-do and plan made before projects existed.',
  profile: BASE_PROFILE_ID,
  status: 'active',
  base: true,
  createdAt: '2026-11-12T00:00:00.000Z',
});

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const nowIso = () => new Date().toISOString();

export const slugId = (name) => str(name, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

function normProject(p) {
  const id = str(p?.id, 40);
  if (!PROJECT_ID.test(id)) return null;
  const base = id === BASE_PROJECT_ID;
  return {
    id,
    name: str(p.name, 80) || (base ? BASE_PROJECT.name : id),
    description: str(p.description, 500),
    profile: base ? BASE_PROFILE_ID : (PROJECT_ID.test(str(p.profile, 40)) && p.profile !== BASE_PROFILE_ID ? p.profile : id),
    status: base ? 'active' : (STATUSES.includes(p.status) ? p.status : 'active'),
    base,
    createdAt: str(p.createdAt, 40) || (base ? BASE_PROJECT.createdAt : ''),
    updatedAt: str(p.updatedAt, 40),
    ...(str(p.archivedAt, 40) && !base ? { archivedAt: str(p.archivedAt, 40) } : {}),
    ...(str(p.by, 80) ? { by: str(p.by, 80) } : {}),
  };
}

/** Any registry (missing, damaged, older) → a valid one: the base project first, ids unique, a known active project. */
export function normalizeRegistry(reg) {
  const seen = new Set(); const projects = [];
  for (const raw of Array.isArray(reg?.projects) ? reg.projects : []) {
    const p = normProject(raw);
    if (p && !seen.has(p.id)) { seen.add(p.id); projects.push(p); }
  }
  if (!seen.has(BASE_PROJECT_ID)) projects.unshift({ ...BASE_PROJECT, updatedAt: BASE_PROJECT.createdAt });
  else projects.sort((a, b) => (b.base ? 1 : 0) - (a.base ? 1 : 0));
  const want = str(reg?.active, 40);
  const active = projects.some((p) => p.id === want && p.status === 'active') ? want : BASE_PROJECT_ID;
  return { $axf: SCHEMA, updatedAt: str(reg?.updatedAt, 40), active, migratedAt: str(reg?.migratedAt, 40), projects };
}

/** The project in force: `override` (AXF_PROJECT) when it names a known, open project, else the saved pick. */
export function activeProject(reg, override = '') {
  const r = normalizeRegistry(reg);
  const id = override && r.projects.some((p) => p.id === override && p.status === 'active') ? override : r.active;
  return r.projects.find((p) => p.id === id);
}

export const findProject = (reg, id) => normalizeRegistry(reg).projects.find((p) => p.id === id) ?? null;
/** The project that owns build profile `profile` (a build's project). Unknown profiles belong to the base project. */
export const projectOfProfile = (reg, profile) => normalizeRegistry(reg).projects.find((p) => p.profile === profile) ?? normalizeRegistry(reg).projects[0];

/**
 * Where a project keeps a plugin's data: the base project keeps the plugin's own folder; any other project gets
 * `<dir>/projects/<id>` (same plugin, same data dir, so uninstalling the plugin still takes every project's data).
 */
export function projectDir(project, dir) {
  const d = String(dir).replace(/\/+$/, '');
  return !project || project.base ? d : `${d}/projects/${project.id}`;
}

/** The notes folder of a project, relative to the hub's shared Claude files (`_shared/_claude/`). */
export const notesFolder = (project) => (!project || project.base ? 'notes' : `project-notes/${project.id}`);

export class ProjectError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * One change to the registry: { action, id?, name?, description?, confirm? }. Returns { registry, project, log, effects }:
 * effects tell the IO side what else to do (create / select the build profile, keep the data). Throws ProjectError.
 *
 *   create   {name, id?, description?, select?}   a new empty project (select: true makes it active)
 *   select   {id}                                 make it the active project (archived ones can't be)
 *   rename   {id, name?, description?}
 *   archive  {id}  / unarchive {id}               off the switcher, data kept; the active project can't be archived
 *   delete   {id, confirm: <id>}                  off the registry; its data stays on disk (create it again to get it back)
 */
export function applyAction(reg, change, { now = nowIso(), by = '' } = {}) {
  const r = normalizeRegistry(reg);
  const action = str(change?.action, 20);
  if (!ACTIONS.includes(action)) throw new ProjectError(`action must be one of ${ACTIONS.join(', ')}`);
  const log = []; const effects = [];
  const touch = () => { r.updatedAt = now; };
  if (action === 'create') {
    const name = str(change.name, 80);
    if (!name) throw new ProjectError('a new project needs a name');
    const id = str(change.id, 40) || slugId(name);
    if (!PROJECT_ID.test(id)) throw new ProjectError(`project id "${id}" must be lowercase letters, digits and dashes (max 40)`);
    if (RESERVED_IDS.includes(id)) throw new ProjectError(`project id "${id}" is reserved`);
    if (r.projects.some((p) => p.id === id)) throw new ProjectError(`there is already a project "${id}"`, 409);
    const p = normProject({ id, name, description: change.description, profile: id, status: 'active', createdAt: now, updatedAt: now, by: str(change.by, 80) || by });
    r.projects.push(p); touch();
    effects.push({ kind: 'profile.create', id: p.profile, name: p.name });
    log.push(`Project "${p.name}" (${p.id}) created, empty.`);
    if (change.select) { r.active = p.id; effects.push({ kind: 'profile.select', id: p.profile }); log.push(`Active project: ${p.name}.`); }
    return { registry: r, project: p, log, effects };
  }
  const id = str(change?.id, 40);
  const p = r.projects.find((x) => x.id === id);
  if (!p) throw new ProjectError(`no project "${id}"`, 404);
  if (action === 'select') {
    if (p.status !== 'active') throw new ProjectError(`project "${p.name}" is archived: unarchive it first`);
    r.active = p.id; touch();
    effects.push({ kind: 'profile.select', id: p.profile });
    log.push(`Active project: ${p.name}.`);
  } else if (action === 'rename') {
    const name = str(change.name, 80); const description = typeof change.description === 'string' ? str(change.description, 500) : null;
    if (!name && description === null) throw new ProjectError('rename needs a name or a description');
    if (name) p.name = name; if (description !== null) p.description = description;
    p.updatedAt = now; touch(); log.push(`Project ${p.id} renamed "${p.name}".`);
  } else if (action === 'archive') {
    if (p.base) throw new ProjectError('AmberX AXF is the base project: it can\'t be archived');
    if (r.active === p.id) throw new ProjectError('switch to another project before archiving this one');
    p.status = 'archived'; p.archivedAt = now; p.updatedAt = now; touch(); log.push(`Project "${p.name}" archived (data kept).`);
  } else if (action === 'unarchive') {
    p.status = 'active'; delete p.archivedAt; p.updatedAt = now; touch(); log.push(`Project "${p.name}" back on the list.`);
  } else if (action === 'delete') {
    if (p.base) throw new ProjectError('AmberX AXF is the base project: it can\'t be deleted');
    if (r.active === p.id) throw new ProjectError('switch to another project before deleting this one');
    if (str(change.confirm, 40) !== p.id) throw new ProjectError(`deleting needs confirm: "${p.id}"`, 428);
    r.projects = r.projects.filter((x) => x.id !== p.id); touch();
    effects.push({ kind: 'profile.remove', id: p.profile });
    log.push(`Project "${p.name}" deleted from the list; its data stays on disk (create "${p.id}" again to get it back).`);
  }
  return { registry: r, project: p, log, effects };
}

/** The migration (once): the registry with AmberX AXF in it, stamped, plus what it now holds (counts). */
export function migrate(reg, counts = {}, { now = nowIso() } = {}) {
  const r = normalizeRegistry(reg);
  const already = !!r.migratedAt;
  if (!already) { r.migratedAt = now; r.updatedAt = now; }
  const base = r.projects.find((p) => p.base);
  return { registry: r, already, log: [already ? `Already migrated (${r.migratedAt}).` : `Every current build, note, to-do and plan is now in project "${base.name}" (nothing moved, nothing deleted).`, ...Object.entries(counts).map(([k, v]) => `${base.name}: ${v} ${k}`)] };
}
