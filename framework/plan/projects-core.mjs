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
 *         owns?: [scope…], ownedAt?: { scope: iso }, accounts?: { members, active }, repo?, hub?, clonedFrom? } ] }
 *
 * What a project owns (framework/spec/PROJECTS.md): a project shares every scope (SCOPES) with the base project until
 * it flips one to its own copy, which lives in `<shared location>/projects/<id>/` (scopeDir). The base project IS the
 * shared set: it never owns anything.
 *
 * The active pick is not stored here: it is the build profile registry's `active` (one switch, nothing to drift).
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
/** What a project can take as its own, in display order (anything else in `owns` is dropped). */
export const SCOPES = Object.freeze(['claude-accounts', 'credentials', 'plugins', 'console', 'hub']);
export const SCOPE_LABELS = Object.freeze({
  'claude-accounts': 'Claude accounts', credentials: 'Credentials', plugins: 'Plugins and their settings', console: 'Console settings and look', hub: 'axHub connection',
});
const ACCOUNT_NAME = /^[a-z0-9-]{1,32}$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const slugId = (s) => str(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

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
      ...ownedFields(p),
    });
  }
  let base = projects.find((p) => p.id === BASE_PROJECT.id);
  if (!base) { base = { ...BASE_PROJECT, profile: baseProfile, updatedAt: BASE_PROJECT.createdAt }; projects.unshift(base); }
  base.profile = baseProfile; base.status = 'active'; delete base.archivedAt;
  base.owns = []; base.ownedAt = {};
  for (const p of projects) p.base = p === base;
  projects.sort((a, b) => (b.base - a.base));
  return { $axf: SCHEMA, updatedAt: str(raw?.updatedAt, 40), projects };
}

/** The "owns" side of a stored project, cleaned: known scopes only, in SCOPES order. */
function ownedFields(p) {
  const want = new Set(Array.isArray(p?.owns) ? p.owns : []);
  const owns = SCOPES.filter((s) => want.has(s));
  const ownedAt = {};
  for (const s of owns) ownedAt[s] = str(p?.ownedAt?.[s], 40);
  const out = { owns, ownedAt };
  const acc = p?.accounts;
  if (acc && typeof acc === 'object') {
    const members = [...new Set((Array.isArray(acc.members) ? acc.members : []).map((m) => str(m, 32)).filter((m) => ACCOUNT_NAME.test(m)))];
    const active = members.includes(str(acc.active, 32)) ? str(acc.active, 32) : '';
    out.accounts = { members, active };
  }
  const repo = p?.repo;
  if (repo && typeof repo === 'object') out.repo = { owner: str(repo.owner, 80), name: str(repo.name, 100), url: str(repo.url, 300), path: str(repo.path, 300) };
  const hub = p?.hub;
  if (hub && typeof hub === 'object') out.hub = { url: str(hub.url, 300), project: str(hub.project, 80) };
  if (p?.clonedFrom && typeof p.clonedFrom === 'object') out.clonedFrom = { id: str(p.clonedFrom.id, 40), at: str(p.clonedFrom.at, 40) };
  return out;
}

/** Does project `p` keep its own copy of `scope`? (The base project never does: it is the shared set.) */
export const ownsScope = (p, scope) => !!p && !p.base && Array.isArray(p.owns) && p.owns.includes(scope);

/** THE resolution rule for every shareable store: `baseDir` (the shared location) unless `p` owns `scope`. */
export function scopeDir(baseDir, p, scope) {
  return ownsScope(p, scope) ? projectDir(baseDir, p) : baseDir;
}

/** The Claude accounts project `p` may use: null = every saved one (it shares), else its own set's members. */
export function accountSet(p) {
  return ownsScope(p, 'claude-accounts') ? { members: [...(p.accounts?.members ?? [])], active: p.accounts?.active ?? '' } : null;
}

/** `carry` as given ('all', a list or a comma string) → the scopes carried over to a clone, in SCOPES order. */
export function carryList(carry) {
  if (carry === undefined || carry === null || carry === 'all') return [...SCOPES];
  const want = new Set((Array.isArray(carry) ? carry : String(carry).split(',')).map((x) => str(x, 40)));
  const bad = [...want].filter((x) => x && !SCOPES.includes(x));
  if (bad.length) throw new Error(`unknown scope "${bad[0]}" (${SCOPES.join(', ')})`);
  return SCOPES.filter((x) => want.has(x));
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
      if (reg.projects.some((p) => p.id === id)) throw new Error(`project "${id}" already exists`);
      if ((ctx.profileIds ?? []).includes(id)) throw new Error(`"${id}" is taken by a build profile; pick another id`);
      if (reg.projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`a project called "${name}" already exists`);
      const p = { id, name, description: str(c.description, 600), profile: id, status: 'active', createdAt: now, updatedAt: now, ...(ctx.by ? { createdBy: str(ctx.by, 80) } : {}), owns: [], ownedAt: {}, base: false };
      // Clone (PROJECTS.md): by default the new project carries over every setting of the project you're in; its
      // builds, notes, to-dos, tasks, lists and plans always start empty (its build profile is new).
      const plain = c.from === null || c.from === 'none';
      const source = plain ? null : (c.from ? find(c.from) : activeProject);
      const carry = carryList(c.carry);
      const copies = [];
      if (source) {
        for (const scope of SCOPES) {
          if (carry.includes(scope)) {
            if (!ownsScope(source, scope)) continue;              // the source shares it: so does the clone
            p.owns.push(scope); p.ownedAt[scope] = now;
            if (scope === 'claude-accounts') p.accounts = accountSet(source);
            copies.push({ scope, from: source.id });
          } else {                                                 // not carried: the clone's own, starting empty
            p.owns.push(scope); p.ownedAt[scope] = now;
            if (scope === 'claude-accounts') p.accounts = { members: [], active: '' };
          }
        }
        if (source.repo) p.repo = { ...source.repo };
        if (source.hub) p.hub = { ...source.hub };
        p.clonedFrom = { id: source.id, at: now };
      }
      for (const k of ['repo', 'hub']) if (c[k] && typeof c[k] === 'object') p[k] = ownedFields({ [k]: c[k] })[k];
      reg.projects.push(p);
      const select = c.select !== false;
      const fresh = SCOPES.filter((sc) => !carry.includes(sc));
      log.push(source
        ? `project "${name}" (${id}) created from ${source.name} (carried: ${carry.join(', ') || 'nothing'}${fresh.length ? `; its own, empty: ${fresh.join(', ')}` : ''}; builds, notes, to-dos and plans start empty)${select ? ' and made active' : ''}`
        : `project "${name}" (${id}) created, empty${select ? ' and made active' : ''}`);
      return { reg, project: p, log, copies, profile: { action: 'create', id, name, description: `Project ${name}`, select } };
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
    case 'own': {
      const p = find(c.id);
      const scope = str(c.scope, 40);
      if (!SCOPES.includes(scope)) throw new Error(`unknown scope "${scope}" (${SCOPES.join(', ')})`);
      if (p.base) throw new Error(`${p.name} is the main project: its settings are the shared ones`);
      const fromId = c.from && c.from !== 'shared' ? find(c.from).id : 'shared';
      if (fromId === p.id) throw new Error('a project can\'t copy a scope from itself');
      const already = p.owns.includes(scope);
      if (already && !c.reseed) { log.push(`project ${p.id} already has its own ${scope}`); return { reg, project: p, log }; }
      if (!already) { p.owns = SCOPES.filter((s) => s === scope || p.owns.includes(s)); }
      p.ownedAt = { ...p.ownedAt, [scope]: now };
      if (scope === 'claude-accounts') {
        const src = fromId === 'shared' ? null : reg.projects.find((x) => x.id === fromId);
        const set = src ? accountSet(src) : null;
        p.accounts = set ?? { members: [...(ctx.accounts?.members ?? [])], active: ctx.accounts?.active ?? '' };
      }
      p.updatedAt = now;
      log.push(`project ${p.id} now has its own ${scope} (copied from ${fromId === 'shared' ? 'shared' : fromId})`);
      return { reg, project: p, log, copy: { scope, from: fromId } };
    }
    case 'share': {
      const p = find(c.id);
      const scope = str(c.scope, 40);
      if (!SCOPES.includes(scope)) throw new Error(`unknown scope "${scope}" (${SCOPES.join(', ')})`);
      if (!p.owns.includes(scope)) { log.push(`project ${p.id} already shares ${scope}`); return { reg, project: p, log }; }
      p.owns = p.owns.filter((s) => s !== scope);
      delete p.ownedAt[scope];
      p.updatedAt = now;
      log.push(`project ${p.id} shares ${scope} again (its own copy stays in …/${PROJECTS_SUBDIR}/${p.id}/)`);
      return { reg, project: p, log, release: { scope } };
    }
    case 'accounts': {
      // Edit an owning project's Claude account set: add / remove members, pick its active one.
      const p = find(c.id);
      if (!ownsScope(p, 'claude-accounts')) throw new Error(`${p.name} shares the Claude accounts: give it its own first (own ${p.id} claude-accounts)`);
      const set = { members: [...(p.accounts?.members ?? [])], active: p.accounts?.active ?? '' };
      for (const n of [].concat(c.add ?? [])) { const m = str(n, 32); if (ACCOUNT_NAME.test(m) && !set.members.includes(m)) set.members.push(m); }
      for (const n of [].concat(c.remove ?? [])) set.members = set.members.filter((m) => m !== str(n, 32));
      if (typeof c.active === 'string') {
        const a = str(c.active, 32);
        if (a && !set.members.includes(a)) throw new Error(`${a} isn't in ${p.name}'s Claude accounts`);
        set.active = a;
      }
      if (!set.members.includes(set.active)) set.active = '';
      p.accounts = set; p.updatedAt = now;
      log.push(`project ${p.id} Claude accounts: ${set.members.join(', ') || 'none'}${set.active ? ` (active ${set.active})` : ''}`);
      return { reg, project: p, log };
    }
    default: throw new Error(`unknown project action "${c.action}" (select, create, update, archive, unarchive, delete, own, share, accounts)`);
  }
}
