/**
 * project-templates-core — the pure side of project templates (no IO): a project captured as a reusable template
 * (project-template@1), the options for what a copy carries over, and the registry of saved boilerplates
 * (project-boilerplates@1). framework/cli/project-templates.mjs does the IO.
 *
 * A template is what a new project starts from: the source project's name and description, its build profile setup
 * (orchestrator rules, catalog), optionally its builds history, and each plugin's own part (lists, to-dos, notes,
 * plans, the wizard's setup: manifest, skin, Claude accounts, rules and instructions), exported and imported by the
 * plugin's lifecycle hooks (hooks.mjs exportProjectData / importProjectData). The framework never reads a plugin's
 * data itself: `plugins` is keyed by whatever folders answered, and each part goes back to the plugin that made it.
 *
 *   { $axf: 'project-template@1', capturedAt, source: { id, name, description, base },
 *     carry: { items: 'structure'|'all'|'none', builds: bool },
 *     profile: { rules: {…}|null, catalog: bool },
 *     history: [ { id, title, status, branch, pr, createdAt, updatedAt } ] | null,
 *     plugins: { <folder>: { label, data } } }
 *
 * Boilerplates (shared across projects, kept on the hub):
 *   { $axf: 'project-boilerplates@1', updatedAt, boilerplates: [
 *       { id, name, description, from: { id, name }, owner, createdAt, updatedAt, template } ] }
 */
export const TEMPLATE_SCHEMA = 'project-template@1';
export const BOILERPLATES_SCHEMA = 'project-boilerplates@1';
export const BOILERPLATE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** What lists, to-dos, notes and plans carry: their structure only (lists, folders, categories), everything, or nothing. */
export const ITEMS = ['structure', 'all', 'none'];
/** The defaults (the build brief): list structure without items, no builds history. */
export const DEFAULT_CARRY = Object.freeze({ items: 'structure', builds: false });
/** Where a new project starts from in the wizard. */
export const START_FROM = ['blank', 'current', 'boilerplate'];

export const LIMITS = Object.freeze({
  boilerplates: 100,
  templateBytes: 4 * 1024 * 1024,
  history: 2000,
  name: 80,
  description: 600,
});

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const slugId = (s) => str(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/** Carry options from anything (a request, a CLI flag set) → { items, builds }. */
export function normaliseCarry(raw) {
  const c = isObj(raw) ? raw : {};
  return {
    items: ITEMS.includes(c.items) ? c.items : DEFAULT_CARRY.items,
    builds: c.builds === true,
  };
}

/** "Garden" → "Garden copy", then "Garden copy 2", … : the first name not in `taken` (compared case-insensitively). */
export function copyName(name, taken = []) {
  const have = new Set(taken.map((t) => String(t).toLowerCase()));
  const base = `${str(name, LIMITS.name - 8) || 'Project'} copy`;
  if (!have.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) { const n = `${base} ${i}`; if (!have.has(n.toLowerCase())) return n; }
  return `${base} ${Date.now()}`;
}

/** The first free id for `name` (slug, then slug-2, …), skipping `taken` ids. */
export function freeId(name, taken = []) {
  const have = new Set(taken);
  const base = slugId(name) || 'project';
  if (!have.has(base)) return base;
  for (let i = 2; i < 1000; i++) { const id = `${base.slice(0, 40 - String(i).length - 1)}-${i}`; if (!have.has(id)) return id; }
  throw new Error(`no free id for "${name}"`);
}

/** A template as read (a stored boilerplate, a request) → a clean one. Plugin parts are kept as given (their own format). */
export function normaliseTemplate(raw) {
  const t = isObj(raw) ? raw : {};
  const src = isObj(t.source) ? t.source : {};
  const prof = isObj(t.profile) ? t.profile : {};
  const plugins = {};
  for (const [folder, part] of Object.entries(isObj(t.plugins) ? t.plugins : {})) {
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(folder) || !isObj(part)) continue;
    plugins[folder] = { label: str(part.label, 80) || folder, data: part.data ?? null };
  }
  const history = Array.isArray(t.history) ? t.history.filter(isObj).slice(0, LIMITS.history).map(historyRow) : null;
  return {
    $axf: TEMPLATE_SCHEMA,
    capturedAt: str(t.capturedAt, 40),
    source: { id: str(src.id, 40), name: str(src.name, LIMITS.name), description: str(src.description, LIMITS.description), base: src.base === true },
    carry: normaliseCarry(t.carry),
    profile: { rules: isObj(prof.rules) ? prof.rules : null, catalog: prof.catalog === true },
    history,
    plugins,
  };
}

/** One build as history: what it was, not a live build (a copy never shares or moves the source's builds). */
export function historyRow(b) {
  return {
    id: str(b.id, 120), title: str(b.title, 300), status: str(b.status, 30), branch: str(b.branch, 200), pr: str(b.pr, 20),
    createdAt: str(b.createdAt, 40), updatedAt: str(b.updatedAt, 40),
  };
}

/** What a template holds, in words (the console, MCP and voice answers). */
export function describeTemplate(t) {
  const parts = Object.values(t.plugins ?? {}).map((p) => p.label);
  if (t.profile?.rules) parts.push('build rules');
  if (t.history?.length) parts.push(`${t.history.length} past build(s)`);
  const items = { structure: 'structure only', all: 'with their items', none: 'left out' }[t.carry?.items ?? 'structure'];
  return `${parts.length ? parts.join(', ') : 'settings only'}; lists, notes and plans ${items}`;
}

/* ------------------------------------------------------------------ boilerplates */

function normaliseBoilerplate(b) {
  if (!isObj(b)) return null;
  const id = str(b.id, 40);
  if (!BOILERPLATE_ID.test(id)) return null;
  const from = isObj(b.from) ? b.from : {};
  return {
    id,
    name: str(b.name, LIMITS.name) || id,
    description: str(b.description, LIMITS.description),
    from: { id: str(from.id, 40), name: str(from.name, LIMITS.name) },
    owner: str(b.owner, 80),
    createdAt: str(b.createdAt, 40),
    updatedAt: str(b.updatedAt, 40) || str(b.createdAt, 40),
    template: normaliseTemplate(b.template),
  };
}

/** The boilerplates file as read (anything) → a clean registry. */
export function normaliseBoilerplates(raw) {
  const seen = new Set();
  const boilerplates = [];
  for (const b of Array.isArray(raw?.boilerplates) ? raw.boilerplates : []) {
    const n = normaliseBoilerplate(b);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    boilerplates.push(n);
  }
  return { $axf: BOILERPLATES_SCHEMA, updatedAt: str(raw?.updatedAt, 40), boilerplates };
}

/** A boilerplate without its template (lists). */
export const boilerplateSummary = (b) => ({
  id: b.id, name: b.name, description: b.description, from: b.from, owner: b.owner, createdAt: b.createdAt, updatedAt: b.updatedAt,
  carry: b.template.carry, holds: describeTemplate(b.template),
});

/**
 * One change to the boilerplates (pure). `ctx` = { now, by }. Returns { reg, boilerplate, log }.
 *   save   { name, description?, id?, template }       a new boilerplate
 *   update { id, template, description? }              take a project's current state again (name and owner kept)
 *   rename { id, name?, description? }
 *   delete { id, confirm }                             confirm = the id typed; the owner can veto (the command is destructive)
 */
export function applyBoilerplateChange(reg, change, ctx) {
  const c = isObj(change) ? change : {};
  const now = ctx.now;
  const find = (id) => {
    const want = str(id, 80);
    const b = reg.boilerplates.find((x) => x.id === want) ?? reg.boilerplates.find((x) => x.name.toLowerCase() === want.toLowerCase());
    if (!b) throw new Error(`no boilerplate "${want}"`);
    return b;
  };
  const nameFree = (name, self) => {
    if (reg.boilerplates.some((x) => x !== self && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`a boilerplate called "${name}" already exists`);
  };
  const sizeOk = (t) => {
    const bytes = JSON.stringify(t).length;
    if (bytes > LIMITS.templateBytes) throw new Error(`the project is too big to keep as a boilerplate (${Math.round(bytes / 1024)} KB, at most ${LIMITS.templateBytes / 1024} KB): carry the structure only`);
  };
  switch (c.action) {
    case 'save': {
      const name = str(c.name, LIMITS.name);
      if (!name) throw new Error('a boilerplate needs a name');
      const id = c.id ? str(c.id, 40) : freeId(name, reg.boilerplates.map((b) => b.id));
      if (!BOILERPLATE_ID.test(id)) throw new Error('id: lowercase letters, digits and dashes, up to 40');
      if (reg.boilerplates.some((b) => b.id === id)) throw new Error(`boilerplate "${id}" already exists`);
      nameFree(name);
      if (reg.boilerplates.length >= LIMITS.boilerplates) throw new Error(`at most ${LIMITS.boilerplates} boilerplates: delete one first`);
      const template = normaliseTemplate(c.template);
      sizeOk(template);
      const b = { id, name, description: str(c.description, LIMITS.description) || template.source.description, from: { id: template.source.id, name: template.source.name }, owner: str(ctx.by, 80), createdAt: now, updatedAt: now, template };
      reg.boilerplates.push(b);
      return { reg, boilerplate: b, log: [`boilerplate "${name}" (${id}) saved from ${template.source.name || 'a project'}: ${describeTemplate(template)}`] };
    }
    case 'update': {
      const b = find(c.id);
      const template = normaliseTemplate(c.template);
      sizeOk(template);
      b.template = template;
      b.from = { id: template.source.id, name: template.source.name };
      if (typeof c.description === 'string') b.description = str(c.description, LIMITS.description);
      b.updatedAt = now;
      return { reg, boilerplate: b, log: [`boilerplate "${b.name}" updated from ${template.source.name || 'a project'}: ${describeTemplate(template)}`] };
    }
    case 'rename': {
      const b = find(c.id);
      if (typeof c.name === 'string') {
        const name = str(c.name, LIMITS.name);
        if (!name) throw new Error('a boilerplate needs a name');
        nameFree(name, b);
        b.name = name;
      }
      if (typeof c.description === 'string') b.description = str(c.description, LIMITS.description);
      b.updatedAt = now;
      return { reg, boilerplate: b, log: [`boilerplate ${b.id} renamed to "${b.name}"`] };
    }
    case 'delete': {
      const b = find(c.id);
      if (c.confirm !== b.id) throw new Error(`type the boilerplate id (${b.id}) to confirm deleting "${b.name}"`);
      reg.boilerplates = reg.boilerplates.filter((x) => x !== b);
      return { reg, boilerplate: b, log: [`boilerplate "${b.name}" (${b.id}) deleted`] };
    }
    default: throw new Error(`unknown boilerplate action "${c.action}" (save, update, rename, delete)`);
  }
}

/** The registry as written. */
export const boilerplatesOut = (reg, now) => ({ $axf: BOILERPLATES_SCHEMA, updatedAt: now, boilerplates: reg.boilerplates });
