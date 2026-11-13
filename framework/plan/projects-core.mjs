/**
 * projects-core — the pure side of projects@1 (no IO): the project registry, its rules and every change to it.
 * framework/cli/projects.mjs does the IO; the console server mirrors the read side (server/projects.py).
 *
 * A project is one workspace with its own builds, notes, to-dos, tasks, lists and plans (Brett, Nov 2026: "New
 * project: start fresh with its own builds, notes, to-dos and plans"). Each project owns one build profile
 * (build-profiles@1): the builds store, the orchestrator, the build queue, pending and the plan already follow the
 * active profile, so the active project IS the active profile's project. The base project, AmberX AXF, owns the base
 * profile (`all`) and keeps every original path: the work that was there before projects is that project's, in place.
 * Plugins keep a project's own data in `<their data folder>/projects/<id>/` (the base project: the folder itself).
 *
 *   { $axf: 'projects@1', updatedAt, projects: [
 *       { id, name, description, profile, status: 'active'|'archived', createdAt, updatedAt, archivedAt?, createdBy?,
 *         repo?: 'owner/name', skin?: '<skin id>', seed?: 'demo' } ] }
 *
 * The active pick is not stored here: it is the build profile registry's `active` (one switch, nothing to drift).
 *
 * A new project also gets a home in the hub's projects tree, `/projects/<id>/` with `_claude/` and
 * `_data/project.manifest.json` (framework/cli/project-home.mjs), so its id must not be a folder the hub keeps for
 * itself (RESERVED_IDS). `seed: 'demo'` fills it with clearly marked test data (framework/plan/project-seed-core.mjs).
 */
export const SCHEMA = 'projects@1';
export const PROJECTS_REL = 'framework/plan/projects.json';
export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const STATUSES = ['active', 'archived'];
/** The base project: everything that was there before projects (builds, notes, to-dos, plans) is its. */
export const BASE_PROJECT = Object.freeze({
  id: 'amberx-axf',
  name: 'AmberX AXF',
  description: 'The AmberX framework, its apps and the console: every build, note, to-do and plan from before projects.',
  profile: 'all',
  status: 'active',
  createdAt: '2026-11-12T00:00:00.000Z',
});
/** Folder name plugins keep non-base projects under (`<data folder>/projects/<id>/`). */
export const PROJECTS_SUBDIR = 'projects';
/** Ids that are folders the hub keeps for itself (or the manifest rules reserve), never a project's home. */
export const RESERVED_IDS = Object.freeze(['shared', 'projects', 'axhub']);
/** What a new project can start with: nothing, or the demo data set (project-seed-core.mjs). */
export const SEEDS = Object.freeze(['none', 'demo']);
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const slugId = (s) => str(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * A linked repository as typed ("owner/name", "github.com/owner/name", "https://github.com/owner/name.git") →
 * "owner/name"; '' for none. Throws on anything else (same owner / name rules as the project manifest).
 */
export function repoRef(v) {
  const s = str(v, 300);
  if (!s) return '';
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com[/:])?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(s);
  if (!m || m[2] === '.' || m[2] === '..') throw new Error(`repo: "${s}" is not a GitHub repository (owner/name)`);
  return `${m[1]}/${m[2]}`;
}

/** The seed kind asked for ('none' when left out); throws on an unknown one. */
export function seedKind(v) {
  if (v === undefined || v === null || v === '' || v === false) return 'none';
  if (v === true) return 'demo';
  const s = str(v, 20).toLowerCase();
  if (!SEEDS.includes(s)) throw new Error(`seed: one of ${SEEDS.join(', ')} (got "${s}")`);
  return s;
}

/** A skin id ('' for none); whether the skin exists is checked by the IO side against the skin assets. */
export function skinId(v) {
  const s = str(v, 63).toLowerCase();
  if (s && !SKIN_ID.test(s)) throw new Error(`skin: "${s}" is not a skin id`);
  return s;
}

/** The optional fields of a stored project (repo, skin, seed), each kept only when it is well formed. */
function optional(p) {
  const out = {};
  try { const r = repoRef(p.repo); if (r) out.repo = r; } catch { /* dropped */ }
  try { const s = skinId(p.skin); if (s) out.skin = s; } catch { /* dropped */ }
  if (p.seed === 'demo') out.seed = 'demo';
  return out;
}

/** A registry as read from disk (anything) → a clean one; the base project is always there and first. */
export function normalizeRegistry(raw, { baseProfile = BASE_PROJECT.profile } = {}) {
  const listed = Array.isArray(raw?.projects) ? raw.projects : [];
  const seen = new Set();
  const projects = [];
  for (const p of listed) {
    const id = str(p?.id, 40);
    if (!PROJECT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    projects.push({
      id,
      name: str(p.name, 80) || id,
      description: str(p.description, 600),
      profile: PROJECT_ID.test(str(p.profile, 40)) ? str(p.profile, 40) : id,
      status: STATUSES.includes(p.status) ? p.status : 'active',
      createdAt: str(p.createdAt, 40) || BASE_PROJECT.createdAt,
      updatedAt: str(p.updatedAt, 40) || str(p.createdAt, 40) || BASE_PROJECT.createdAt,
      ...(p.archivedAt ? { archivedAt: str(p.archivedAt, 40) } : {}),
      ...(p.createdBy ? { createdBy: str(p.createdBy, 80) } : {}),
      ...optional(p),
    });
  }
  let base = projects.find((p) => p.id === BASE_PROJECT.id);
  if (!base) { base = { ...BASE_PROJECT, profile: baseProfile, updatedAt: BASE_PROJECT.createdAt }; projects.unshift(base); }
  base.profile = baseProfile; base.status = 'active'; delete base.archivedAt;
  for (const p of projects) p.base = p === base;
  projects.sort((a, b) => (b.base - a.base));
  return { $axf: SCHEMA, updatedAt: str(raw?.updatedAt, 40), projects };
}

/** The registry as written (no derived fields). */
export const registryOut = (reg, now) => ({ $axf: SCHEMA, updatedAt: now, projects: reg.projects.map(({ base, active, ...p }) => p) });

/** The project owning build profile `profileId` (the base project when none does). */
export function projectOfProfile(reg, profileId) {
  return reg.projects.find((p) => p.profile === profileId) ?? reg.projects.find((p) => p.base);
}

/** Where a plugin keeps project `p`'s data, given its own data folder (POSIX join; the base project = the folder). */
export function projectDir(baseDir, p) {
  return !p || p.base ? baseDir : `${String(baseDir).replace(/\/+$/, '')}/${PROJECTS_SUBDIR}/${p.id}`;
}

/**
 * One change to the registry (pure). `ctx` = { now, by, activeProfile, profileIds }. Returns
 * { reg, project, log, profile?: { action, … } } where `profile` is the build-profile change the IO side must make
 * first (create / select / remove), so the project and its profile never disagree.
 */
export function applyChange(reg, change, ctx) {
  const c = change && typeof change === 'object' ? change : {};
  const now = ctx.now; const log = [];
  const find = (id) => {
    const want = str(id, 80);
    const p = reg.projects.find((x) => x.id === want) ?? reg.projects.find((x) => x.name.toLowerCase() === want.toLowerCase());
    if (!p) throw new Error(`no project "${want}"`);
    return p;
  };
  const activeProject = projectOfProfile(reg, ctx.activeProfile);
  const base = reg.projects.find((p) => p.base);
  switch (c.action) {
    case 'select': {
      const p = find(c.id);
      if (p.status === 'archived') throw new Error(`"${p.name}" is archived: unarchive it first`);
      log.push(`active project → ${p.name} (${p.id})`);
      return { reg, project: p, log, profile: { action: 'select', id: p.profile } };
    }
    case 'create': {
      const name = str(c.name, 80);
      if (!name) throw new Error('a project needs a name');
      const id = c.id ? str(c.id, 40) : slugId(name);
      if (!PROJECT_ID.test(id)) throw new Error('id: lowercase letters, digits and dashes, up to 40');
      if (RESERVED_IDS.includes(id)) throw new Error(`"${id}" is a folder the hub keeps for itself; pick another id`);
      if (reg.projects.some((p) => p.id === id)) throw new Error(`project "${id}" already exists`);
      if ((ctx.profileIds ?? []).includes(id)) throw new Error(`"${id}" is taken by a build profile; pick another id`);
      if (reg.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`a project called "${name}" already exists`);
      const repo = repoRef(c.repo); const skin = skinId(c.skin); const seed = seedKind(c.seed);
      const p = { id, name, description: str(c.description, 600), profile: id, status: 'active', createdAt: now, updatedAt: now, ...(ctx.by ? { createdBy: str(ctx.by, 80) } : {}),
        ...(repo ? { repo } : {}), ...(skin ? { skin } : {}), ...(seed !== 'none' ? { seed } : {}), base: false };
      reg.projects.push(p);
      const select = c.select !== false;
      log.push(`project "${name}" (${id}) created, ${seed === 'demo' ? 'with demo data' : 'empty'}${select ? ' and made active' : ''}`);
      return { reg, project: p, log, profile: { action: 'create', id, name, description: `Project ${name}`, select } };
    }
    case 'update': case 'rename': {
      const p = find(c.id);
      if (typeof c.name === 'string') {
        const name = str(c.name, 80);
        if (!name) throw new Error('a project needs a name');
        if (reg.projects.some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`a project called "${name}" already exists`);
        p.name = name;
      }
      if (typeof c.description === 'string') p.description = str(c.description, 600);
      p.updatedAt = now;
      log.push(`project ${p.id} updated`);
      return { reg, project: p, log };
    }
    case 'archive': case 'unarchive': {
      const p = find(c.id);
      if (p.base) throw new Error(`${p.name} is the main project: it can't be archived`);
      if (c.action === 'archive') {
        if (c.confirm !== p.id) throw new Error(`type the project id (${p.id}) to confirm archiving "${p.name}"`);
        p.status = 'archived'; p.archivedAt = now;
      } else { p.status = 'active'; delete p.archivedAt; }
      p.updatedAt = now;
      const leaving = c.action === 'archive' && activeProject === p;
      log.push(`project "${p.name}" ${c.action}d${leaving ? `; active project → ${base.name}` : ''}`);
      return { reg, project: p, log, ...(leaving ? { profile: { action: 'select', id: base.profile } } : {}) };
    }
    case 'delete': {
      const p = find(c.id);
      if (p.base) throw new Error(`${p.name} is the main project: it can't be deleted`);
      if (c.confirm !== p.id) throw new Error(`type the project id (${p.id}) to confirm deleting "${p.name}"`);
      reg.projects = reg.projects.filter((x) => x !== p);
      const leaving = activeProject === p;
      log.push(`project "${p.name}" deleted (off the list; its data folders stay on disk until someone removes them)${leaving ? `; active project → ${base.name}` : ''}`);
      return { reg, project: p, log, profile: { action: 'remove', id: p.profile, confirm: p.profile, selectFirst: leaving ? base.profile : null } };
    }
    default: throw new Error(`unknown project action "${c.action}" (select, create, update, archive, unarchive, delete)`);
  }
}
