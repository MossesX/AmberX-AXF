/**
 * Project Manager core (project-manager@1). One store for the console routes, the CLI (projects.mjs), MCP (through
 * plugin-commands@1) and voice: every project is its own console instance with its own builds, notes and data folders.
 *
 * Store: <dataDir>/projects.json  { $axf, projects: [...], settings: {...} }
 *        <dataDir>/projects/<id>/{builds,notes,data}/   each project's own data
 *
 * Project types:
 *   framework  developing the console itself or framework tools (the console builds itself); root = the repo
 *   app        a new, real app made with every console tool; root = apps/<id> (a project manifest is written there)
 *
 * A project's console instance is the console opened with ?project=<id>; the multi-project view shows each instance
 * in a tab group (or side by side) and the live preview shows the app being built in a floating or docked window.
 * Plain data, no model, no network.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAME = 'project-manager@1';
export const FOLDER = 'project-manager';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const DATA_DIR = resolve(process.env.AXF_PROJECT_MANAGER_DATA || join(ROOT, '.axf-console', 'plugins', FOLDER));
export const TYPES = ['framework', 'app'];
export const TYPE_LABELS = { framework: 'Framework / self development', app: 'New app' };
export const LAYOUTS = ['tabs', 'split'];
export const PREVIEW_MODES = ['float', 'dock'];
export const DOCK_SIDES = ['right', 'bottom'];
export const PROJECT_DATA = ['builds', 'notes', 'data'];
export const SELF_ID = 'console';
export const DEFAULT_SETTINGS = Object.freeze({
  multiView: false, layout: 'tabs', active: SELF_ID, open: [SELF_ID],
  preview: { open: false, mode: 'float', side: 'right', project: '' },
});

export class ProjectError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const STORE = () => join(DATA_DIR, 'projects.json');
const now = () => new Date().toISOString();

export function slug(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** The project every console has: the console building itself (type framework, root = the repo). */
export function selfProject() {
  return { id: SELF_ID, name: 'Dev Console', type: 'framework', root: '.', description: 'The console and the framework: the console builds itself.', previewUrl: '/', createdAt: '', updatedAt: '', builtIn: true };
}

function normSettings(s) {
  const p = { ...DEFAULT_SETTINGS.preview, ...((s && s.preview) || {}) };
  const out = { ...DEFAULT_SETTINGS, ...(s || {}), preview: p };
  if (!LAYOUTS.includes(out.layout)) out.layout = 'tabs';
  if (!PREVIEW_MODES.includes(p.mode)) p.mode = 'float';
  if (!DOCK_SIDES.includes(p.side)) p.side = 'right';
  out.multiView = !!out.multiView; p.open = !!p.open;
  out.open = Array.isArray(out.open) ? [...new Set(out.open.map(String))] : [SELF_ID];
  return out;
}

export function load() {
  let raw = {};
  try { raw = JSON.parse(readFileSync(STORE(), 'utf8')); } catch { raw = {}; }
  const own = Array.isArray(raw.projects) ? raw.projects.filter((p) => p && p.id && p.id !== SELF_ID && TYPES.includes(p.type)) : [];
  const projects = [selfProject(), ...own];
  const settings = normSettings(raw.settings);
  if (settings.selfPreviewUrl) projects[0].previewUrl = settings.selfPreviewUrl;
  const ids = new Set(projects.map((p) => p.id));
  settings.open = settings.open.filter((id) => ids.has(id));
  if (!settings.open.length) settings.open = [SELF_ID];
  if (!ids.has(settings.active)) settings.active = SELF_ID;
  if (settings.preview.project && !ids.has(settings.preview.project)) settings.preview.project = '';
  return { projects, settings };
}

function save(state) {
  mkdirSync(DATA_DIR, { recursive: true });
  const body = { $axf: FRAME, projects: state.projects.filter((p) => !p.builtIn), settings: state.settings };
  const tmp = `${STORE()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, STORE());
}

export const projectDir = (id) => join(DATA_DIR, 'projects', id);

/** The deep link that opens a project's own console instance (relative to the console's origin). */
export const consoleUrl = (id) => (id === SELF_ID ? '/' : `/?project=${encodeURIComponent(id)}`);

function counts(id) {
  const out = {};
  for (const k of PROJECT_DATA) {
    const d = join(projectDir(id), k);
    try { out[k] = readdirSync(d).length; } catch { out[k] = 0; }
  }
  return out;
}

export function describe(p, settings) {
  return {
    ...p, typeLabel: TYPE_LABELS[p.type], consoleUrl: consoleUrl(p.id), dataDir: relative(ROOT, projectDir(p.id)),
    counts: counts(p.id), active: settings.active === p.id, open: settings.open.includes(p.id),
    rootExists: existsSync(resolve(ROOT, p.root || '.')),
  };
}

export function view() {
  const s = load();
  return { ok: true, frame: FRAME, types: TYPES.map((t) => ({ id: t, label: TYPE_LABELS[t] })), settings: s.settings, projects: s.projects.map((p) => describe(p, s.settings)) };
}

function find(state, id) {
  const p = state.projects.find((x) => x.id === id) || state.projects.find((x) => slug(x.name) === slug(id));
  if (!p) throw new ProjectError('not_found', `No project "${id}". Projects: ${state.projects.map((x) => x.id).join(', ')}`);
  return p;
}

export function get(id) {
  const s = load();
  return { ok: true, project: describe(find(s, id), s.settings) };
}

function cleanUrl(u) {
  const v = String(u ?? '').trim();
  if (!v) return '';
  if (v.startsWith('/') || /^https?:\/\//i.test(v)) return v.slice(0, 500);
  throw new ProjectError('invalid', 'The preview URL starts with http://, https:// or / (a path on the console).');
}

/** A minimal project manifest (project-manifest@1) for a new app, unless the folder already has one. */
function scaffoldApp(p) {
  const dir = resolve(ROOT, p.root);
  if (!dir.startsWith(resolve(ROOT, 'apps') + '/')) return false;
  const file = join(dir, 'project.manifest.json');
  if (existsSync(file)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ $axf: 'project-manifest@1', name: p.id, displayName: p.name, kind: 'app', description: p.description || `${p.name}: an app built in the Dev Console.`, relation: 'built-on' }, null, 2)}\n`);
  return true;
}

export function create({ name, type = 'app', description = '', root = '', previewUrl = '', id = '', scaffold = true } = {}) {
  const s = load();
  const n = String(name ?? '').trim().slice(0, 80);
  if (!n) throw new ProjectError('invalid', 'A project needs a name.');
  if (!TYPES.includes(type)) throw new ProjectError('invalid', `Type is one of: ${TYPES.join(', ')}.`);
  const pid = slug(id || n);
  if (!pid) throw new ProjectError('invalid', 'The name needs at least one letter or digit.');
  if (s.projects.some((p) => p.id === pid)) throw new ProjectError('invalid', `A project "${pid}" already exists.`);
  const r = String(root || (type === 'app' ? `apps/${pid}` : '.')).trim();
  if (r.includes('..') || r.startsWith('/')) throw new ProjectError('invalid', 'The project folder is a path inside the repo (no "..", not absolute).');
  const p = { id: pid, name: n, type, root: r, description: String(description).slice(0, 400), previewUrl: cleanUrl(previewUrl), createdAt: now(), updatedAt: now() };
  for (const k of PROJECT_DATA) mkdirSync(join(projectDir(pid), k), { recursive: true });
  const scaffolded = type === 'app' && scaffold !== false && scaffold !== 'false' ? scaffoldApp(p) : false;
  s.projects.push(p);
  if (!s.settings.open.includes(pid)) s.settings.open.push(pid);
  save(s);
  return { ok: true, project: describe(p, s.settings), scaffolded };
}

export function update(id, patch = {}) {
  const s = load();
  const p = find(s, id);
  if (p.builtIn) {
    if (patch.previewUrl === undefined) throw new ProjectError('invalid', 'The Dev Console project is built in: only its preview URL can change.');
  }
  if (patch.name !== undefined && !p.builtIn) { const n = String(patch.name).trim().slice(0, 80); if (!n) throw new ProjectError('invalid', 'A project needs a name.'); p.name = n; }
  if (patch.description !== undefined && !p.builtIn) p.description = String(patch.description).slice(0, 400);
  if (patch.type !== undefined && !p.builtIn) { if (!TYPES.includes(patch.type)) throw new ProjectError('invalid', `Type is one of: ${TYPES.join(', ')}.`); p.type = patch.type; }
  if (patch.previewUrl !== undefined) p.previewUrl = cleanUrl(patch.previewUrl);
  p.updatedAt = now();
  if (p.builtIn) { s.settings.selfPreviewUrl = p.previewUrl; }
  save(s);
  return { ok: true, project: describe(p, s.settings) };
}

export const rename = (id, name) => update(id, { name });

export function remove(id, { data = false } = {}) {
  const s = load();
  const p = find(s, id);
  if (p.builtIn) throw new ProjectError('invalid', 'The Dev Console project is built in and stays.');
  s.projects = s.projects.filter((x) => x.id !== p.id);
  s.settings.open = s.settings.open.filter((x) => x !== p.id);
  if (s.settings.active === p.id) s.settings.active = SELF_ID;
  if (s.settings.preview.project === p.id) s.settings.preview.project = '';
  save(s);
  if (data === true || data === 'true') rmSync(projectDir(p.id), { recursive: true, force: true });
  return { ok: true, removed: p.id, dataRemoved: data === true || data === 'true' };
}

/** Switch to a project: it becomes the active one (and opens in the multi-project view). */
export function open(id) {
  const s = load();
  const p = find(s, id);
  s.settings.active = p.id;
  if (!s.settings.open.includes(p.id)) s.settings.open.push(p.id);
  save(s);
  return { ok: true, active: p.id, consoleUrl: consoleUrl(p.id), project: describe(p, s.settings) };
}

/** Close a project's tab in the multi-project view (the project and its data stay). */
export function close(id) {
  const s = load();
  const p = find(s, id);
  s.settings.open = s.settings.open.filter((x) => x !== p.id);
  if (!s.settings.open.length) s.settings.open = [SELF_ID];
  if (s.settings.active === p.id) s.settings.active = s.settings.open[0];
  save(s);
  return { ok: true, closed: p.id, settings: s.settings };
}

export function setSettings(patch = {}) {
  const s = load();
  const next = { ...s.settings };
  if (patch.multiView !== undefined) next.multiView = patch.multiView === true || patch.multiView === 'true' || patch.multiView === 'on';
  if (patch.layout !== undefined) { if (!LAYOUTS.includes(patch.layout)) throw new ProjectError('invalid', `Layout is one of: ${LAYOUTS.join(', ')}.`); next.layout = patch.layout; }
  if (patch.active !== undefined) next.active = find(s, patch.active).id;
  if (patch.preview && typeof patch.preview === 'object') next.preview = { ...next.preview, ...patch.preview };
  s.settings = normSettings(next);
  if (s.settings.preview.project) s.settings.preview.project = find(s, s.settings.preview.project).id;
  save(s);
  return { ok: true, settings: load().settings };
}

/** The live preview window: open (float | dock, dock side) on a project, or closed. */
export function preview({ open: o, mode, side, project } = {}) {
  const s = load();
  const p = { ...s.settings.preview };
  if (o !== undefined) p.open = o === true || o === 'true' || o === 'on';
  if (mode !== undefined) { if (!PREVIEW_MODES.includes(mode)) throw new ProjectError('invalid', `Mode is one of: ${PREVIEW_MODES.join(', ')}.`); p.mode = mode; }
  if (side !== undefined) { if (!DOCK_SIDES.includes(side)) throw new ProjectError('invalid', `Side is one of: ${DOCK_SIDES.join(', ')}.`); p.side = side; }
  if (project !== undefined) p.project = project ? find(s, project).id : '';
  const r = setSettings({ preview: p });
  const target = r.settings.preview.project || r.settings.active;
  const tp = load().projects.find((x) => x.id === target);
  return { ok: true, preview: r.settings.preview, project: target, url: tp ? previewUrlOf(tp) : '' };
}

export function previewUrlOf(p) {
  if (p.previewUrl) return p.previewUrl;
  return p.id === SELF_ID ? '/' : '';
}
