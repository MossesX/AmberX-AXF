#!/usr/bin/env node
/**
 * Project wizard engine (console plugin `project-wizard`). Ported from xGallery's New project wizard
 * (MossesX/xgallery server/src/routes/newproject.ts), rebuilt on AmberX AXF's `claude-project` so the console,
 * the terminal command and this wizard make projects the same way.
 *
 *   node wizard.mjs --json '{"action":"status"}'
 *   actions: status · options · current · draft {set?, reset?} · inspect {source} · check {plan | fromDraft} · list {location}
 *            · run {plan | fromDraft} (alias create) · kit {name} · link {name,url} · forget {name}
 *            · start {startFrom}: what "Start from" (blank, the current project, a saved boilerplate) fills in
 *
 * Start from (plan.startFrom = { kind: blank|current|boilerplate, id?, carry? }): the current project or a saved
 * boilerplate is a project template (framework/cli/project-templates.mjs). Its setup is what the locked optional steps
 * take; its rules, instructions and manifest settings go into the new repo; its lists, notes, plans and build rules
 * go into the new workspace before it becomes the active project. Blank keeps the current project's setup as defaults.
 *
 * A run:
 *   1. gets a working folder from the source: a GitHub or VPS repo (cloned into the workspace), a folder on this
 *      server (inside the allowed roots), or a new AXF app (`axf init` from a template + boilerplate);
 *   2. runs claude-project on it: validated project.manifest.json, _claude/, CLAUDE.md, docs/FIRST_SESSION.md,
 *      commit, then the homes picked in the wizard: GitHub (new or the source repo; Claude app access so Claude.ai
 *      sees it), a git repo on the VPS (/srv/git/<name>.git, new or existing), and the local git folder;
 *   3. writes the Claude.ai project kit in _claude/claude-ai/ (project instructions + context files to upload),
 *      commits it and pushes it to every home.
 * claude.ai has no API for creating Projects, so the kit is pasted/uploaded by Brett (the UI opens the page).
 *
 * Kept in .axf-console/project-wizard.json (0600): the non-secret facts of each project made here.
 * Tokens: GITHUB_TOKEN / GH_TOKEN (or `gh auth token`). GitHub calls and git auth go through the framework's lib-github
 * (framework/cli/github.mjs): API origin only, no redirects, git gets the token through GIT_CONFIG_* environment only.
 * Env: AXF_WIZARD_WORKSPACE (where clones and new apps go, default ~/projects), AXF_WIZARD_ROOTS (colon list of
 * folders a "folder" source may come from; default the workspace and this repo), AXF_VPS_HOST/AXF_VPS_USER (VPS git
 * over SSH; without them /srv/git on this machine is used when it exists), AXF_VPS_GIT_DIR (default /srv/git).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiBaseFromEnv, createGitHub, gitAuthEnv, githubToken, parseRepo, scrub, validName, validOwner } from '../../../../framework/cli/github.mjs';

export const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(PLUGIN_DIR, '../../../..');
const CLI = join(REPO_ROOT, 'framework', 'cli');
const GIT_BASE = () => (process.env.CLAUDE_PROJECT_GIT_BASE || 'https://github.com').replace(/\/+$/, '');
export const CLAUDE_NEW_PROJECT_URL = 'https://claude.ai/projects/new';
export const KIT_DIR = '_claude/claude-ai';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
// owner / repo names: lib-github's validOwner / validName (no leading '.' or '-': git would read '-' as an option;
// no '..': it walks out of /srv/git)
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const ANSI = /\x1b\[[0-9;]*m/g;
const slugOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (msg) => { throw Object.assign(new Error(msg), { user: true }); };

/* ─── places ─────────────────────────────────────────────────────────────── */

export const workspace = () => resolve((process.env.AXF_WIZARD_WORKSPACE || join(homedir(), 'projects')).replace(/^~(?=\/|$)/, homedir()));
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** Folders the wizard may use. Never the console's own clone (it resets every few minutes and holds .axf-console/). */
export function roots() {
  const extra = (process.env.AXF_WIZARD_ROOTS || '').split(':').map((s) => s.trim()).filter((s) => isAbsolute(s));
  const repo = real(REPO_ROOT);
  return [...new Set([workspace(), ...extra].map(real))].filter((r) => r !== repo && !r.startsWith(repo + '/') && r !== '/');
}
/** realpath of the deepest part of `p` that exists, with the missing rest appended (so a symlinked parent can't escape). */
function realish(p) {
  let cur = resolve(p);
  const rest = [];
  while (!existsSync(cur)) { const up = dirname(cur); if (up === cur) break; rest.unshift(basename(cur)); cur = up; }
  return join(real(cur), ...rest);
}
/** A folder path from the browser, only if it sits inside one of the allowed roots (symlinks resolved). */
export function safeFolder(p, { mustExist = true } = {}) {
  const raw = str(p, 1000);
  if (!raw || raw.includes('\0')) fail('Give a folder path');
  const abs = resolve(raw.replace(/^~(?=\/|$)/, homedir()));
  if (mustExist && !existsSync(abs)) fail(`${abs} doesn't exist on the console server`);
  const target = realish(abs);
  const repo = real(REPO_ROOT);
  if (target === repo || target.startsWith(repo + '/')) fail(`${abs} is inside the console's own clone: pick a folder under ${roots().join(', ') || 'the workspace'}`);
  if (target.split('/').includes('.axf-console')) fail('The console\'s private folder (.axf-console) can\'t be used');
  if (roots().includes(target)) fail(`${abs} is a whole workspace folder: pick a project folder inside it`);
  const ok = roots().some((r) => target.startsWith(r + '/'));
  if (!ok) fail(`${abs} is outside the folders the wizard may use (${roots().join(', ')}). Add it to AXF_WIZARD_ROOTS on the server to allow it.`);
  return target;
}

// The plugin's data folder (plugin-lifecycle@1 dataDir); the list was kept at .axf-console/project-wizard.json before.
const STORE = () => process.env.AXF_WIZARD_STORE || join(REPO_ROOT, '.axf-console', 'plugins', 'project-wizard', 'projects.json');
const OLD_STORE = () => (process.env.AXF_WIZARD_STORE ? '' : join(REPO_ROOT, '.axf-console', 'project-wizard.json'));
export function loadStore() { return readJson(STORE()) ?? (OLD_STORE() ? readJson(OLD_STORE()) : null) ?? { $axf: 'project-wizard@1', projects: {} }; }
function saveStore(s) {
  mkdirSync(dirname(STORE()), { recursive: true });
  const tmp = `${STORE()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, STORE());
  try { chmodSync(STORE(), 0o600); } catch { /* best effort */ }
}
function putProject(rec) { const s = loadStore(); s.projects[rec.name] = { ...(s.projects[rec.name] ?? {}), ...rec, updatedAt: new Date().toISOString() }; saveStore(s); return s.projects[rec.name]; }

/* ─── GitHub ─────────────────────────────────────────────────────────────── */

let tokenCache;
function token() {
  if (tokenCache === undefined) tokenCache = githubToken();
  return tokenCache;
}
async function gh(method, path, body) {
  const t = token();
  if (!t) fail('No GitHub token on the console server: set GITHUB_TOKEN (Systems check → GitHub), classic with repo + workflow scopes');
  try {
    return await createGitHub({ token: t, base: apiBaseFromEnv(), userAgent: 'axf-project-wizard', timeoutMs: 20_000 }).json(method, path, body);
  } catch (e) {
    throw Object.assign(new Error(e.message), { status: e.status, user: true });
  }
}
/** free | empty | exists | unknown, with the repo's facts when it exists. */
async function githubState(owner, name) {
  try {
    const r = await gh('GET', `/repos/${owner}/${name}`);
    let empty = false;
    try { const c = await gh('GET', `/repos/${owner}/${name}/commits?per_page=1`); empty = !c?.length; } catch (e) { if (e.status === 409) empty = true; else throw e; }
    return { state: empty ? 'empty' : 'exists', url: r.html_url, private: r.private, description: r.description ?? '', defaultBranch: r.default_branch, fullName: r.full_name };
  } catch (e) {
    if (e.status === 404) return { state: 'free' };
    return { state: 'unknown', note: e.message };
  }
}
/** "owner/name", "https://github.com/owner/name(.git)" or "git@github.com:owner/name.git" → { owner, name } */
export function parseGithub(s) {
  const slug = parseRepo(str(s, 300));
  if (!slug) return null;
  const [owner, name] = slug.split('/');
  return { owner, name };
}

const slugOfRepo = (r) => (r ? `${r.owner}/${r.name}`.toLowerCase() : '');
/** The folder's origin as "owner/name" (lower case) when it points at GitHub, else ''. Credentials in the URL are dropped. */
function originRepo(dir) {
  if (!existsSync(join(dir, '.git'))) return '';
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? slugOfRepo(parseGithub(r.stdout.trim().replace(/\/\/[^@/]+@/, '//'))) : '';
}

/* ─── git + the VPS ──────────────────────────────────────────────────────── */

function git(cwd, args, { auth = false, timeout = 300_000 } = {}) {
  const t = auth ? token() : '';
  // lib-github: header scoped to https://github.com/ + no redirects, through GIT_CONFIG_* (never argv or a URL)
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(t ? gitAuthEnv(t, GIT_BASE()) : {}) };
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout });
  const clean = (s) => scrub(s, t ? [t] : []);
  if (r.status !== 0) fail(clean(`git ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(-800)}`));
  return clean(r.stdout.trim());
}
const gitOk = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0;

export function vpsInfo() {
  const host = str(process.env.AXF_VPS_HOST, 253);
  const user = str(process.env.AXF_VPS_USER, 32) || 'root';
  const dir = str(process.env.AXF_VPS_GIT_DIR, 500) || '/srv/git';
  if (host && (!HOST_RE.test(host) || host.startsWith('-'))) return { mode: 'off', why: 'AXF_VPS_HOST is not a host name', dir };
  if (host && !USER_RE.test(user)) return { mode: 'off', why: 'AXF_VPS_USER is not a user name', dir };
  if (host) return { mode: 'ssh', host, user, dir };
  if (existsSync(dir)) return { mode: 'local', dir };
  return { mode: 'off', dir, why: `no ${dir} on this machine and no AXF_VPS_HOST set` };
}
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function vpsSh(cmd) {
  const v = vpsInfo();
  if (v.mode === 'off') fail(`VPS git isn't reachable from the console: ${v.why}`);
  const r = v.mode === 'ssh'
    ? spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${v.user}@${v.host}`, cmd], { encoding: 'utf8', timeout: 60_000 })
    : spawnSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) fail(`VPS: ${(r.stderr || r.error?.message || 'command failed').trim().slice(-300)}`);
  return r.stdout;
}
const vpsPath = (name) => `${vpsInfo().dir.replace(/\/+$/, '')}/${name}.git`;
const vpsUrl = (name) => { const v = vpsInfo(); return v.mode === 'ssh' ? `ssh://${v.user}@${v.host}${vpsPath(name)}` : vpsPath(name); };
function vpsState(name) {
  if (!validName(name)) return { state: 'unknown', note: 'bad name' };
  try {
    const out = vpsSh(`p=${q(vpsPath(name))}; if [ -d "$p" ]; then if git --git-dir="$p" rev-parse -q --verify HEAD >/dev/null 2>&1 || [ -n "$(git --git-dir="$p" for-each-ref --count=1)" ]; then echo exists; else echo empty; fi; else echo free; fi`).trim();
    return { state: ['free', 'empty', 'exists'].includes(out) ? out : 'unknown', path: vpsPath(name), url: vpsUrl(name) };
  } catch (e) { return { state: 'unknown', note: e.message }; }
}

/* ─── listings for the pickers ───────────────────────────────────────────── */

async function listGithub() {
  const rows = await gh('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return (rows ?? []).map((r) => ({ id: r.full_name, label: r.full_name, note: `${r.private ? 'private' : 'public'}${r.description ? ` · ${String(r.description).slice(0, 80)}` : ''}`, updated: r.pushed_at }));
}
function listVps() {
  const out = vpsSh(`cd ${q(vpsInfo().dir)} 2>/dev/null && for d in *.git; do [ -d "$d" ] && echo "$d"; done; true`);
  return out.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.git')).map((d) => ({ id: d.slice(0, -4), label: d.slice(0, -4), note: `${vpsInfo().dir}/${d}` }));
}
/** Git repos (and project folders) up to two levels below each allowed root. */
function listLocal() {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.git', '.gradle', '.next', '__pycache__', '.venv']);
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || skip.has(e.name)) continue;
      const p = join(dir, e.name);
      const isGit = existsSync(join(p, '.git'));
      const hasManifest = existsSync(join(p, 'project.manifest.json'));
      if (isGit || hasManifest) out.push({ id: p, label: relative(dirname(dir), p) || p, note: [isGit ? 'git' : '', hasManifest ? 'project manifest' : ''].filter(Boolean).join(' · ') });
      if (depth > 0 && !isGit) walk(p, depth - 1);
    }
  };
  for (const r of roots()) { if (existsSync(join(r, '.git'))) out.push({ id: r, label: r, note: 'git' }); walk(r, 1); }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id))).slice(0, 300);
}

/* ─── engine pieces from AmberX AXF ──────────────────────────────────────── */

const cp = () => import(join(CLI, 'claude-project.mjs'));
const be = () => import(join(CLI, 'build-engine.mjs'));
const projectsCli = () => import(join(CLI, 'projects.mjs'));

/* ─── the wizard's steps and their choices ───────────────────────────────── */

/** The steps, in order. `optional` steps start on the current project's value (grayed out) until unlocked. */
export const STEPS = [
  { id: 'name', title: 'Name and description', optional: false },
  { id: 'repo', title: 'Linked repo', optional: false },
  { id: 'starter', title: 'Starter code', optional: true },
  { id: 'framework', title: 'Framework and libraries', optional: true },
  { id: 'skin', title: 'Skin', optional: true },
  { id: 'accounts', title: 'Claude account and models', optional: true },
  { id: 'plan', title: 'First plan', optional: true },
  { id: 'review', title: 'Review and create', optional: false },
];
export const OPTIONAL = STEPS.filter((s) => s.optional && s.id !== 'plan').map((s) => s.id);
/** Step id → the plan field it sets. */
const SETUP_KEY = { starter: 'starter', framework: 'framework', skin: 'skin', accounts: 'claude' };

/** Starter code for a new repo. `console-app` is the default: an app shaped like the console. */
export const STARTERS = [
  {
    id: 'console-app', label: 'Console-style app', template: 'web-fastapi-wall',
    description: 'React + TypeScript + Python (FastAPI) like the console: user accounts, console login and axHub login wired in, and the Claude settings, Claude accounts and axHub plugins preinstalled in its Settings. It gets its own Claude account.',
    features: ['user-accounts', 'console-login', 'axhub-login', 'own-claude-account'],
    plugins: ['claude-settings', 'claude-accounts', 'axhub'],
  },
  { id: 'template', label: 'AXF template', description: 'Any AXF template, with an optional boilerplate.', features: [], plugins: [] },
  { id: 'framework', label: "The framework's boilerplate", description: 'A boilerplate that ships with the framework picked in the Framework step (import a framework first).', features: [], plugins: [] },
  { id: 'none', label: 'No starter code', description: 'An empty repo, or the linked repo exactly as it is.', features: [], plugins: [] },
];
export const FRAMEWORKS = [
  { id: 'axf', label: 'AmberX AXF', description: 'The default: the AXF framework and its shared libraries, with private libraries on top if you want them.' },
  { id: 'own', label: 'Your own framework', description: 'Start a framework of its own for this project (a framework/ folder in the repo, seeded empty).' },
  { id: 'import', label: 'Import a framework', description: 'Another framework from a GitHub repo or a server folder; when it ships boilerplates, one can be the starter.' },
];
/** Models a project's builds may run on (Opus or Fable only). */
export const MODELS = ['opus', 'fable'];
export const MODEL_ROLES = [
  { id: 'plan', label: 'Planning' },
  { id: 'build', label: 'Builds' },
  { id: 'review', label: 'Reviews and fixes' },
];
export const DEFAULT_MODELS = Object.freeze({ plan: 'fable', build: 'opus', review: 'opus' });

const strList = (v, max = 40, each = 100) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, each)).filter(Boolean))].slice(0, max) : []);
const pick = (v, ids, dflt) => (ids.includes(v) ? v : dflt);

/** Normalise the optional parts of a plan (starter, framework, skin, claude, first plan); no IO. */
export function normaliseSetup(raw = {}) {
  const st = raw.starter ?? {};
  const fw = raw.framework ?? {};
  const imp = fw.import ?? {};
  const cl = raw.claude ?? {};
  const fp = raw.firstPlan ?? {};
  const models = {};
  for (const r of MODEL_ROLES) models[r.id] = pick(str(cl.models?.[r.id], 20).toLowerCase(), MODELS, DEFAULT_MODELS[r.id]);
  const builds = (Array.isArray(fp.builds) ? fp.builds : []).map((b) => str(typeof b === 'string' ? b : b?.title, 140)).filter(Boolean).slice(0, 20);
  return {
    starter: { id: pick(st.id, STARTERS.map((s) => s.id), 'console-app'), template: str(st.template, 40) || 'react-ts', boilerplate: str(st.boilerplate, 60) },
    framework: {
      mode: pick(fw.mode, FRAMEWORKS.map((f) => f.id), 'axf'),
      libraries: strList(fw.libraries),
      privateLibraries: strList(fw.privateLibraries, 20, 300),
      name: str(fw.name, 60),
      import: { repo: str(imp.repo, 300), path: str(imp.path, 1000), boilerplate: str(imp.boilerplate, 200).replace(/^\/+|\/+$/g, '') },
    },
    skin: { id: str(raw.skin?.id, 80), color: str(raw.skin?.color, 80) },
    claude: { account: str(cl.account, 80), ownAccount: cl.ownAccount !== false, models },
    firstPlan: { text: str(fp.text, 8000), builds, spoken: fp.spoken === true },
  };
}

/** The wizard's record of a console project (projects@1 entry): made here, or copied here from a template. */
function recordOf(proj) {
  const s = loadStore();
  const rec = Object.values(s.projects).find((r) => r.workspace === proj.id) ?? s.projects[proj.id];
  return { rec, copied: s.copies?.[proj.id] ?? null };
}

/** The folder holding a project's manifest and _claude/ files: its repo when made here, this repo for the base. */
function folderOf(proj, rec) {
  if (rec?.dir && existsSync(join(rec.dir, 'project.manifest.json'))) return rec.dir;
  return proj.base ? REPO_ROOT : '';
}

/** The current (active) project and the values its optional steps start on. */
export async function current() {
  let proj = { id: 'amberx-axf', name: 'AmberX AXF', description: '', base: true };
  try { const p = (await projectsCli()).activeProject(); proj = { id: p.id, name: p.name, description: p.description ?? '', base: !!p.base }; } catch { /* no registry: the base project */ }
  return setupOf(proj);
}

/** A project's setup: the values the wizard's optional steps start on when this project is the starting point. */
export async function setupOf(proj) {
  const { rec, copied } = recordOf(proj);
  let setup = rec?.setup ?? copied?.setup ?? null;
  let repo = rec?.github || rec?.vps || rec?.dir || '';
  if (!setup) {
    // a project not made here (the base project): AXF, the console-style app, its manifest's repo, the hub-wide skin
    const m = readJson(join(REPO_ROOT, 'project.manifest.json')) ?? {};
    repo = repo || m.repo?.url || '';
    let skin = '';
    try { skin = (await import(join(CLI, 'skins.mjs'))).readGlobal()?.skin ?? ''; } catch { /* no hub */ }
    setup = normaliseSetup({ starter: { id: 'console-app' }, framework: { mode: 'axf' }, skin: { id: m.x?.setup?.skin?.id ?? skin }, claude: m.x?.setup?.claude ?? {} });
  }
  const s = normaliseSetup(setup);
  return { project: { ...proj, repo }, values: { starter: s.starter, framework: s.framework, skin: s.skin, claude: s.claude } };
}

/** Everything the steps offer (the Python side adds the Claude accounts from axf.claude-accounts@1). */
export async function options() {
  const b = await be();
  let skins = [];
  try { skins = (await import(join(CLI, 'skins.mjs'))).skinRows().map((x) => ({ id: x.id, name: x.name, kind: x.kind, description: String(x.description ?? '').slice(0, 240) })); } catch { /* none */ }
  let libraries = [];
  try { libraries = (await import(join(CLI, 'libraries.mjs'))).listLibraries().map((l) => ({ id: l.id, name: l.name ?? l.id, description: String(l.description ?? '').slice(0, 200) })); } catch { /* none */ }
  return {
    ok: true,
    steps: STEPS,
    starters: STARTERS,
    frameworks: FRAMEWORKS,
    models: MODELS,
    modelRoles: MODEL_ROLES,
    defaultModels: DEFAULT_MODELS,
    templates: b.listTemplates().filter((t) => !String(t.kind ?? '').includes('module')).map((t) => ({ id: t.id, label: t.label ?? t.id })),
    boilerplates: b.listBoilerplates().map((x) => ({ id: x.id, name: x.name, category: x.category, status: x.status ?? '' })),
    skins,
    libraries,
    accounts: [],
    current: await current(),
    startFrom: { kinds: START_KINDS, boilerplates: (await templates()).listBoilerplates() },
  };
}

/* ─── start from: blank, the current project, or a saved boilerplate (project-template@1) ── */

const SELF = basename(PLUGIN_DIR);
const templates = () => import(join(CLI, 'project-templates.mjs'));
const templatesCore = () => import(join(REPO_ROOT, 'framework', 'plan', 'project-templates-core.mjs'));
const START_KINDS = ['blank', 'current', 'boilerplate'];
/** Manifest keys a copy never takes from its source: who the project is and where it lives. Its setup travels on its own. */
const IDENTITY = ['$axf', 'name', 'displayName', 'description', 'repo', 'location', 'deploy'];
const INSTRUCTION_DIRS = ['_claude/rules', '_claude/instructions'];
const INSTRUCTION_BYTES = 64 * 1024;
const INSTRUCTION_TOTAL = 512 * 1024;

/** A project folder's own rules and instructions (Markdown under _claude/rules and _claude/instructions; READMEs are made fresh). */
function readInstructions(dir) {
  const files = {};
  let total = 0;
  for (const d of INSTRUCTION_DIRS) {
    const abs = join(dir, d);
    if (!existsSync(abs)) continue;
    for (const n of readdirSync(abs).sort()) {
      const f = join(abs, n);
      if (!n.endsWith('.md') || n === 'README.md' || !lstatSync(f).isFile()) continue;
      const size = statSync(f).size;
      if (size > INSTRUCTION_BYTES || total + size > INSTRUCTION_TOTAL) continue;
      files[`${d}/${n}`] = readFileSync(f, 'utf8');
      total += size;
    }
  }
  return files;
}

/** The wizard's part of a project copy: its setup (starter, framework, skin, Claude account and models), manifest and instructions. */
export async function exportPart(proj) {
  const { rec, copied } = recordOf(proj);
  const { values } = await setupOf(proj);
  const dir = folderOf(proj, rec);
  let manifest = copied?.manifest ?? null;
  let instructions = copied?.instructions ?? {};
  if (dir) {
    const m = readJson(join(dir, 'project.manifest.json'));
    if (m) {
      manifest = Object.fromEntries(Object.entries(m).filter(([k]) => !IDENTITY.includes(k)));
      if (manifest.x?.setup) { const { setup, ...x } = manifest.x; manifest.x = x; }
    }
    instructions = readInstructions(dir);
  }
  return { setup: values, manifest, instructions };
}

/** Keep a copied project's part for its workspace (a project made by duplicating has no repo yet; the wizard links one later). */
export function importPart(proj, data) {
  const s = loadStore();
  const { rec } = recordOf(proj);
  s.copies = s.copies ?? {};
  if (rec || s.copies[proj.id]) return { note: 'the project already has its setup: left as it is' };
  const manifest = data?.manifest && typeof data.manifest === 'object' ? { ...data.manifest, name: proj.id, displayName: proj.name, ...(proj.description ? { description: proj.description } : {}) } : null;
  const instructions = Object.fromEntries(Object.entries(data?.instructions ?? {}).filter(([k, v]) => INSTRUCTION_DIRS.some((d) => k.startsWith(`${d}/`)) && !k.split('/').includes('..') && typeof v === 'string'));
  s.copies[proj.id] = { setup: normaliseSetup(data?.setup ?? {}), manifest, instructions, copiedAt: new Date().toISOString() };
  saveStore(s);
  const n = Object.keys(instructions).length;
  return { note: `setup${manifest ? ', manifest' : ''}${n ? `, ${n} rules and instructions file(s)` : ''}` };
}

/** The template a plan starts from (null = blank) and what the steps take from it. */
async function startTemplate(raw) {
  const sf = raw && typeof raw === 'object' ? raw : {};
  const kind = START_KINDS.includes(sf.kind) ? sf.kind : 'blank';
  const T = await templates();
  const carry = (await templatesCore()).normaliseCarry(sf.carry);
  if (kind === 'current') {
    const p = T.findProject();
    const template = await T.capture(p, carry);
    return { kind, id: p.id, label: p.name, carry: template.carry, template };
  }
  if (kind === 'boilerplate') {
    if (!str(sf.id, 80)) fail('Start from: pick a boilerplate');
    const b = T.getBoilerplate(sf.id);
    return { kind, id: b.id, label: b.name, carry: b.template.carry, template: b.template };
  }
  return { kind: 'blank', id: '', label: '', carry: null, template: null };
}

/** What a "Start from" choice fills in: the optional steps' values, a name suggestion, and what it carries. */
export async function start({ startFrom } = {}) {
  const st = await startTemplate(startFrom);
  const T = await templates();
  const C = await templatesCore();
  const cur = await current();
  const part = st.template?.plugins?.[SELF]?.data;
  const values = part?.setup ? (({ starter, framework, skin, claude }) => ({ starter, framework, skin, claude }))(normaliseSetup(part.setup)) : cur.values;
  let display = '';
  if (st.kind === 'current') {
    try { display = C.copyName(st.label, (await projectsCli()).readProjects().projects.map((p) => p.name)); } catch { display = `${st.label} copy`; }
  } else if (st.kind === 'boilerplate') display = st.label;
  return {
    ok: true, kind: st.kind, id: st.id, label: st.label || cur.project.name, carry: st.carry,
    holds: st.template ? C.describeTemplate(st.template) : 'nothing: a blank project',
    values, suggest: { display, description: st.template?.source?.description ?? '' },
    boilerplates: T.listBoilerplates(),
  };
}

/** Write the template's rules and instructions files and manifest keys into the new repo (only what isn't there). */
function writeFromTemplate(dir, template) {
  const part = template?.plugins?.[SELF]?.data;
  if (!part) return [];
  const written = [];
  for (const [rel, text] of Object.entries(part.instructions ?? {})) {
    if (!INSTRUCTION_DIRS.some((d) => rel.startsWith(`${d}/`)) || rel.split('/').includes('..') || typeof text !== 'string') continue;
    const f = join(dir, rel);
    insideOrThrow(dir, f);
    if (existsSync(f)) continue;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
    written.push(rel);
  }
  const mf = join(dir, 'project.manifest.json');
  const m = readJson(mf);
  if (m && isObj(part.manifest)) {
    let added = 0;
    for (const [k, v] of Object.entries(part.manifest)) {
      if (IDENTITY.includes(k) || k in m) continue;
      m[k] = v; added++;
    }
    if (added) { writeFileSync(mf, JSON.stringify(m, null, 2) + '\n'); written.push('project.manifest.json'); }
  }
  return written;
}

/* ─── the draft: build a plan step by step without the UI (REST, MCP, CLI, voice) ── */

const DRAFT_KEYS = ['source', 'display', 'name', 'description', 'kind', 'visibility', 'homes', 'sync', 'commitAll', 'port', 'starter', 'framework', 'skin', 'claude', 'firstPlan', 'inherit', 'switchTo', 'startFrom'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  const out = { ...(isObj(a) ? a : {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out;
}
/** draft {} reads it; draft {set:{…}} merges fields in; draft {reset:true} starts again. Returns the draft and its check. */
export async function draft({ set, reset } = {}) {
  const s = loadStore();
  let d = reset ? {} : (s.draft ?? {});
  if (isObj(set)) {
    const clean = Object.fromEntries(Object.entries(set).filter(([k]) => DRAFT_KEYS.includes(k)));
    d = merge(d, clean);
  }
  if (reset || isObj(set)) { s.draft = { ...d, updatedAt: new Date().toISOString() }; saveStore(s); }
  const { updatedAt, ...plan } = s.draft ?? d;
  const c = Object.keys(plan).length ? await check(plan) : { ok: false, problems: ['The draft is empty'], warnings: [] };
  return { ok: true, draft: plan, updatedAt: updatedAt ?? null, check: { ok: c.ok, problems: c.problems, warnings: c.warnings } };
}

/* ─── actions ────────────────────────────────────────────────────────────── */

export async function status() {
  const v = vpsInfo();
  let github = { token: !!token(), login: '', error: '' };
  if (github.token) { try { github.login = (await gh('GET', '/user')).login; } catch (e) { github.error = e.message; } }
  const b = await be();
  const projects = Object.values(loadStore().projects).sort((a, b2) => String(b2.updatedAt).localeCompare(String(a.updatedAt)));
  return {
    ok: true,
    github,
    vps: { mode: v.mode, dir: v.dir, host: v.host ?? '', why: v.why ?? '' },
    workspace: workspace(),
    roots: roots(),
    templates: b.listTemplates().filter((t) => !String(t.kind ?? '').includes('module')).map((t) => ({ id: t.id, label: t.label ?? t.id, targets: t.targets ?? [] })),
    boilerplates: b.listBoilerplates().map((x) => ({ id: x.id, name: x.name, category: x.category, description: x.description ?? '', status: x.status ?? '' })),
    claudeNewProjectUrl: CLAUDE_NEW_PROJECT_URL,
    projects,
  };
}

/** What the source is, and what the form should start with. */
export async function inspect(src = {}) {
  const kind = src.kind;
  if (kind === 'github') {
    const r = parseGithub(src.repo);
    if (!r) fail('Give the repository as owner/name or its GitHub link');
    const st = await githubState(r.owner, r.name);
    if (st.state === 'free') fail(`${r.owner}/${r.name} doesn't exist on GitHub (or this token can't see it)`);
    if (st.state === 'unknown') fail(st.note ?? 'Could not check the repository');
    return { ok: true, kind, repo: `${r.owner}/${r.name}`, state: st.state, private: st.private, url: st.url, suggest: { display: r.name, name: slugOf(r.name), description: st.description, owner: r.owner, repoName: r.name, visibility: st.private ? 'private' : 'public' } };
  }
  if (kind === 'vps') {
    const name = str(src.repo, 100).replace(/\.git$/, '');
    if (!validName(name)) fail('Pick a repository on the VPS');
    const st = vpsState(name);
    if (st.state === 'free') fail(`${vpsPath(name)} doesn't exist on the VPS`);
    if (st.state === 'unknown') fail(st.note ?? 'Could not check the VPS repository');
    return { ok: true, kind, repo: name, state: st.state, url: st.url, suggest: { display: name, name: slugOf(name), description: '', repoName: name } };
  }
  if (kind === 'folder') {
    const dir = safeFolder(src.path);
    if (!statSync(dir).isDirectory()) fail(`${dir} is not a folder`);
    const { detect } = await cp();
    const d = detect(dir);
    const origin = originRepo(dir);
    const gh2 = parseGithub(origin);
    return {
      ok: true, kind, path: dir, git: d.git, empty: d.empty, stack: d.stack, platforms: d.platforms, relation: d.relation, axfNote: d.axfNote, origin, hasManifest: !!d.manifest, claudeMd: d.claudeMd,
      suggest: { display: d.manifest?.displayName ?? d.name, name: slugOf(d.manifest?.name ?? d.name), description: d.manifest?.description ?? d.description, owner: d.manifest?.repo?.owner ?? gh2?.owner ?? '', repoName: d.manifest?.repo?.name ?? gh2?.name ?? slugOf(d.name), visibility: d.manifest?.repo?.visibility ?? 'private' },
    };
  }
  if (kind === 'new') {
    const b = await be();
    const template = str(src.template, 40) || 'react-ts';
    b.templateInfo(template);
    const boilerplate = str(src.boilerplate, 60);
    if (boilerplate) b.loadBoilerplate(boilerplate);
    return { ok: true, kind, template, boilerplate, relation: 'built-on', suggest: { display: '', name: '', description: '', visibility: 'private' } };
  }
  fail('Pick a source: a GitHub repo, a VPS repo, a folder, or a new AXF app');
}

/** Normalise the wizard's plan and list the problems with it. */
async function normalise(plan = {}) {
  const problems = [];
  const warnings = [];
  const source = plan.source ?? {};
  const display = str(plan.display, 80);
  const name = slugOf(plan.name || display);
  const description = str(plan.description, 300);
  if (display.length < 2) problems.push('Give the project a name (2+ characters)');
  if (!NAME_RE.test(name) || name === 'shared') problems.push('The project id must be a-z, 0-9 and hyphens (it is the hub folder /projects/<id>)');
  const homes = plan.homes ?? {};
  const g = homes.github ?? { mode: 'skip' };
  const v = homes.vps ?? { mode: 'skip' };
  const l = homes.local ?? { mode: 'keep' };
  const out = { source, display, name, description, kind: str(plan.kind, 30) || 'app', visibility: plan.visibility === 'public' ? 'public' : 'private', port: ['bake', 'rebuild', 'no'].includes(plan.port) ? plan.port : 'no', homes: {}, sync: plan.sync !== false };

  // the source itself
  if (source.kind === 'github' && !parseGithub(source.repo)) problems.push('Source: give the GitHub repository as owner/name or its link');
  if (source.kind === 'vps' && !validName(str(source.repo, 100).replace(/\.git$/, ''))) problems.push('Source: pick a repository on the VPS');
  if (!['github', 'vps', 'folder', 'new'].includes(source.kind)) problems.push('Pick a source');
  out.commitAll = plan.commitAll === true;

  // where the working folder will be
  if (source.kind === 'folder') {
    try { out.dir = safeFolder(source.path); } catch (e) { problems.push(e.message); }
    if (out.dir) {
      const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: out.dir, encoding: 'utf8' });
      const isGit = existsSync(join(out.dir, '.git'));
      if (top.status === 0 && real(top.stdout.trim()) !== out.dir) problems.push(`${out.dir} is inside another git repository (${top.stdout.trim()}): pick that repository's folder, or a folder of its own`);
      else if (!isGit && readdirSync(out.dir).length && !out.commitAll) problems.push(`${out.dir} isn't a git repository yet: every file in it will be committed and pushed. Tick "Commit everything in this folder" after checking it holds no secrets.`);
    }
  }
  else {
    const wanted = str(l.path, 1000) || join(workspace(), name || 'project');
    try { out.dir = safeFolder(wanted, { mustExist: false }); } catch (e) { problems.push(e.message); }
    if (out.dir && existsSync(out.dir) && readdirSync(out.dir).length) {
      const same = source.kind === 'github' && !!originRepo(out.dir) && originRepo(out.dir) === slugOfRepo(parseGithub(source.repo));
      if (same) warnings.push(`${out.dir} is already a clone of ${source.repo}: the wizard uses it as it is`);
      else problems.push(`${out.dir} already exists and isn't empty: pick another local folder`);
    }
  }

  // GitHub home
  if (g.mode === 'new' || g.mode === 'existing') {
    const owner = str(g.owner, 39) || (token() ? (await gh('GET', '/user').catch(() => ({}))).login ?? '' : '');
    const repoName = str(g.name, 100) || name;
    if (!validOwner(owner)) problems.push('GitHub: the owner must be a GitHub account or organisation');
    if (!validName(repoName)) problems.push('GitHub: the repository name may use letters, digits, ., - and _');
    if (!token()) problems.push('GitHub: no token on the console server (Systems check → GitHub)');
    else if (validOwner(owner) && validName(repoName)) {
      const st = await githubState(owner, repoName);
      const target = `${owner}/${repoName}`.toLowerCase();
      const isSource = source.kind === 'github' && slugOfRepo(parseGithub(source.repo)) === target;
      const folderOrigin = !!out.dir && (source.kind === 'folder' || source.kind === 'github') && originRepo(out.dir) === target;
      if (st.state === 'unknown') warnings.push(`GitHub: couldn't check ${owner}/${repoName}: ${st.note}`);
      if (g.mode === 'new' && st.state === 'exists' && !isSource && !folderOrigin) problems.push(`GitHub: ${owner}/${repoName} already exists and has commits: pick another name, or pick it as the source`);
      if (g.mode === 'new' && st.state === 'empty') warnings.push(`GitHub: ${owner}/${repoName} exists and is empty: it will be used`);
      if (g.mode === 'existing' && st.state === 'free') problems.push(`GitHub: ${owner}/${repoName} doesn't exist: choose "new" to create it`);
      if (g.mode === 'existing' && st.state === 'exists' && !isSource && !folderOrigin) problems.push(`GitHub: ${owner}/${repoName} has its own history: only the source repo (or the folder's own origin) can be reused; pick an empty repo or a new name`);
      out.homes.github = { owner, name: repoName, state: st.state, isSource: isSource || folderOrigin };
    }
  }
  // VPS home
  if (v.mode === 'new' || v.mode === 'existing') {
    const repoName = str(v.name, 100).replace(/\.git$/, '') || name;
    if (!validName(repoName)) problems.push('VPS: the repository name may use letters, digits, ., - and _');
    else if (vpsInfo().mode === 'off') problems.push(`VPS: ${vpsInfo().why}`);
    else {
      const st = vpsState(repoName);
      const isSource = source.kind === 'vps' && str(source.repo, 100).replace(/\.git$/, '') === repoName;
      if (st.state === 'unknown') problems.push(`VPS: couldn't check ${vpsPath(repoName)}: ${st.note}`);
      if (v.mode === 'new' && st.state === 'exists' && !isSource) problems.push(`VPS: ${vpsPath(repoName)} already has commits: pick another name`);
      if (v.mode === 'existing' && st.state === 'free') problems.push(`VPS: ${vpsPath(repoName)} doesn't exist: choose "new" to create it`);
      if (v.mode === 'existing' && st.state === 'exists' && !isSource) warnings.push(`VPS: ${vpsPath(repoName)} has history: the push fails unless it shares this project's history`);
      out.homes.vps = { name: repoName, path: vpsPath(repoName), state: st.state, isSource };
    }
  }
  out.homes.local = { path: out.dir };
  // the linked repo is required: a GitHub or VPS repo (new or existing), or a git folder on this server
  const linked = !!out.homes.github || !!out.homes.vps || ['github', 'vps', 'folder'].includes(source.kind);
  if (!linked) problems.push('Link a repo: a new or existing GitHub repo, a VPS repo, or a folder on the server');
  else if (!out.homes.github && !out.homes.vps) warnings.push('Only the folder on the server: the project has no remote copy');

  // the optional steps: a step left locked (inherit) takes the current project's value
  // a step the plan doesn't mention follows the current project (API and voice callers name only what changes)
  const raw = { starter: plan.starter, framework: plan.framework, skin: plan.skin, claude: plan.accounts ?? plan.claude };
  // older callers name the template on the source: that is the "AXF template" starter
  if (raw.starter === undefined && source.kind === 'new' && str(source.template, 40)) raw.starter = { id: 'template', template: source.template, boilerplate: source.boilerplate };
  const inherit = { ...Object.fromEntries(OPTIONAL.map((k) => [k, raw[SETUP_KEY[k]] === undefined])),...(isObj(plan.inherit) ? plan.inherit : {}) };
  // start from: a template (the current project or a boilerplate) sets what a locked step takes, instead of the current project
  let start = { kind: 'blank', id: '', label: '', carry: null, template: null };
  try { start = await startTemplate(plan.startFrom); } catch (e) { problems.push(e.message); }
  const startSetup = start.template?.plugins?.[SELF]?.data?.setup;
  let cur = null;
  if (OPTIONAL.some((k) => inherit[k] === true)) cur = startSetup ? normaliseSetup(startSetup) : (await current()).values;
  const given = normaliseSetup({ ...raw, firstPlan: plan.firstPlan });
  const setup = { ...given };
  for (const k of OPTIONAL) {
    const key = SETUP_KEY[k];
    if (inherit[k] === true && cur?.[key]) setup[key] = normaliseSetup({ [key]: cur[key] })[key];
  }
  out.inherit = Object.fromEntries(OPTIONAL.map((k) => [k, inherit[k] === true]));
  out.switchTo = plan.switchTo !== false;
  out.setup = setup;
  out.startFrom = { kind: start.kind, id: start.id, label: start.label, carry: start.carry };
  if (start.template && !Object.keys(start.template.plugins ?? {}).length && !start.template.profile?.rules) warnings.push(`Start from: ${start.label} has nothing to carry over beyond its settings`);

  // the starter only makes code for a new repo; an existing repo or folder is its own starter
  if (source.kind === 'new') {
    const st = setup.starter;
    const fw = setup.framework;
    if (st.id === 'console-app') { out.source = { ...source, template: STARTERS[0].template, boilerplate: '' }; }
    else if (st.id === 'template') { out.source = { ...source, template: st.template, boilerplate: st.boilerplate }; }
    else if (st.id === 'framework') {
      out.source = { ...source, template: '', boilerplate: '' };
      if (fw.mode !== 'import') problems.push("Starter: the framework's boilerplate needs an imported framework (Framework step)");
      else if (!fw.import.boilerplate) problems.push("Starter: name the imported framework's boilerplate folder");
    } else out.source = { ...source, template: '', boilerplate: '' };
    if (out.source.template) {
      try { const b = await be(); b.templateInfo(out.source.template); if (out.source.boilerplate) b.loadBoilerplate(out.source.boilerplate); } catch (e) { problems.push(e.message); }
    }
  } else if (setup.starter.id !== 'none') {
    warnings.push(`Starter: ${source.kind === 'folder' ? 'the folder' : 'the linked repo'} keeps its own code; the ${STARTERS.find((s) => s.id === setup.starter.id)?.label ?? setup.starter.id} starter is only recorded`);
  }
  // framework: an import needs a GitHub repo or a server folder; boilerplate paths stay inside the framework
  const fw = setup.framework;
  if (fw.mode === 'import') {
    if (!fw.import.repo && !fw.import.path) problems.push('Framework: give the framework to import (GitHub owner/name or a folder on the server)');
    if (fw.import.repo && !parseGithub(fw.import.repo)) problems.push('Framework: the import repo must be owner/name or a GitHub link');
    if (fw.import.path) { try { safeFolder(fw.import.path); } catch (e) { problems.push(`Framework: ${e.message}`); } }
    if (fw.import.boilerplate && (fw.import.boilerplate.split('/').includes('..') || isAbsolute(fw.import.boilerplate))) problems.push('Framework: the boilerplate must be a folder inside the framework');
  }
  if (fw.mode === 'own' && fw.name && !NAME_RE.test(slugOf(fw.name))) problems.push('Framework: give your framework a name');
  for (const lib of fw.privateLibraries) if (!parseGithub(lib) && !isAbsolute(lib)) problems.push(`Framework: private library "${lib}" must be a GitHub owner/name or a server folder`);
  return { plan: out, problems, warnings, template: start.template };
}

/** The stored draft as a plan (run/check {fromDraft:true}). */
function draftPlan() {
  const d = loadStore().draft;
  if (!d) fail('There is no draft: set its fields first (draft {set:{…}})');
  const { updatedAt, ...plan } = d;
  return { ...plan, fromDraft: true };
}

export async function check(plan) {
  const { template, ...r } = await normalise(plan);
  return { ok: !r.problems.length, ...r };
}

/** Steps 1-3 (see the header). */
export async function run(plan) {
  const { plan: p, problems, warnings, template } = await normalise(plan);
  if (problems.length) fail(problems.join(' · '));
  const log = [];
  const say = (m) => log.push(String(m).replace(ANSI, ''));
  warnings.forEach((w) => say(`! ${w}`));
  const s = p.source;
  const rec = { name: p.name, display: p.display, description: p.description, source: s.kind === 'folder' ? { kind: 'folder', path: p.dir } : s.kind === 'new' ? { kind: 'new', template: s.template || 'react-ts', boilerplate: s.boilerplate || '' } : { kind: s.kind, repo: s.repo }, dir: p.dir, createdAt: loadStore().projects[p.name]?.createdAt ?? new Date().toISOString(), steps: {} };
  const step = (id, note, ok = true) => { rec.steps[id] = { ok, note: String(note).slice(0, 300), at: new Date().toISOString() }; say(`${ok ? '✓' : '✗'} ${id}: ${note}`); };
  try {
    // 1. the working folder
    if (s.kind === 'github' && !existsSync(join(p.dir, '.git'))) {
      const r = parseGithub(s.repo);
      mkdirSync(dirname(p.dir), { recursive: true });
      git(dirname(p.dir), ['clone', '-q', `${GIT_BASE()}/${r.owner}/${r.name}.git`, p.dir], { auth: GIT_BASE().startsWith('https://') });
      if (GIT_BASE() !== 'https://github.com') git(p.dir, ['remote', 'set-url', 'origin', `https://github.com/${r.owner}/${r.name}.git`]);
      step('source', `cloned ${r.owner}/${r.name} into ${p.dir}`);
    } else if (s.kind === 'vps' && !existsSync(join(p.dir, '.git'))) {
      const name = str(s.repo, 100).replace(/\.git$/, '');
      mkdirSync(dirname(p.dir), { recursive: true });
      git(dirname(p.dir), ['clone', '-q', vpsUrl(name), p.dir]);
      git(p.dir, ['remote', 'rename', 'origin', 'vps']);
      step('source', `cloned VPS ${vpsPath(name)} into ${p.dir}`);
    } else if (s.kind === 'new' && !s.template) {
      startFolder(p, say);
      step('source', p.setup.starter.id === 'framework' ? `starter: boilerplate ${p.setup.framework.import.boilerplate} from the imported framework` : `new empty repo in ${p.dir}`);
    } else if (s.kind === 'new') {
      const b = await be();
      const gh2 = p.homes.github;
      const r = b.init({ dir: p.dir, name: p.display, id: p.name, template: str(s.template, 40) || 'react-ts', boilerplate: str(s.boilerplate, 60) || undefined, project: { description: p.description, kind: p.kind, visibility: p.visibility, ...(gh2 ? { owner: gh2.owner, repoName: gh2.name } : {}) }, log: (m) => say(`  ${m}`) });
      step('source', `new AXF app (${str(s.template, 40) || 'react-ts'}${s.boilerplate ? ` + ${s.boilerplate}` : ''}): ${r.assets} assets, ${r.bakedFiles} baked files`);
    } else step('source', `using ${p.dir}`);

    // 2. claude-project: manifest, _claude/, CLAUDE.md, first-session prompt, commit, homes
    const where = [p.homes.github && 'github', p.homes.vps && 'vps', 'device'].filter(Boolean);
    const args = [p.dir, '--yes', '--display', p.display, '--name', p.name, '--description', p.description || p.display, '--kind', p.kind, '--where', where.join(','), '--visibility', p.visibility, '--port', p.port];
    if (p.homes.github) args.push('--owner', p.homes.github.owner, '--repo', p.homes.github.name);
    if (p.homes.vps) {
      args.push('--vps-git', p.homes.vps.path);
      const vi = vpsInfo();
      // Over SSH the VPS gets its own working folder (~/projects/<name> there); on the VPS itself it is this folder.
      if (vi.mode === 'ssh') args.push('--vps-host', vi.host, '--vps-user', vi.user);
      else args.push('--vps-dir', p.dir);
    }
    if (!p.sync) args.push('--no-sync');
    const { run: claudeProject } = await cp();
    const r = await claudeProject(args, { log: say, interactive: false });
    rec.github = r.github ?? '';
    rec.vps = r.vps?.remote ?? '';
    rec.claudeApp = r.claudeApp ?? null;
    step('claude-project', `manifest, _claude/, CLAUDE.md written; homes: ${where.join(', ')}`);
    for (const n of r.notes ?? []) say(`! ${n}`);
    if (r.claudeApp && !r.claudeApp.ok) step('claude-app', `${r.claudeApp.why}: give it access at ${r.claudeApp.url}`, false);
    else if (r.github) step('claude-app', 'the Claude GitHub app can see the repo (Claude.ai can attach it)');

    // 3. the setup (starter, framework, skin, Claude account and models, first plan) and the Claude.ai project kit
    const written = [...writeSetup(p.dir, p), ...writeFromTemplate(p.dir, template)];
    if (template) step('start-from', `${p.startFrom.kind === 'current' ? 'a copy of' : 'boilerplate'} ${p.startFrom.label}: its rules, instructions and manifest settings`);
    step('setup', `starter ${p.setup.starter.id}, framework ${p.setup.framework.mode}, skin ${p.setup.skin.id || 'default'}, models ${Object.values(p.setup.claude.models).join('/')}${p.setup.firstPlan.text || p.setup.firstPlan.builds.length ? ', first plan' : ''}`);
    const k = writeKit(p.dir, { github: rec.github, vps: rec.vps });
    commitAndPush(p.dir, [KIT_DIR, ...written], `Add the project setup and the Claude.ai project kit for ${p.display}`, { github: rec.github, vps: !!rec.vps });
    step('claude-ai-kit', `${k.files.length} files in ${KIT_DIR}/`);
    rec.kit = { dir: KIT_DIR, files: k.files.map((f) => f.path) };
    rec.setup = p.setup;
    rec.inherit = p.inherit;

    // 4. its own workspace in the console (projects@1), and switch into it
    const ws = await openWorkspace(p, template);
    rec.workspace = ws.id;
    step('workspace', ws.note);
    if (template) {
      rec.startFrom = p.startFrom;
      for (const line of ws.carried ?? []) say(line);
    }
    putProject(rec);
    clearDraftIf(plan);
    return { ok: true, project: rec, log, kit: k, workspace: ws };
  } catch (e) {
    step('error', e.message, false);
    if (rec.steps.source?.ok) putProject({ ...rec, failed: e.message });
    return { ok: false, error: e.message, log, project: rec };
  }
}

/* ─── run helpers: the starter folder, the setup files, the workspace ────── */

/** A new repo without an AXF template: empty, or one boilerplate folder of the imported framework. */
function startFolder(p, say) {
  mkdirSync(p.dir, { recursive: true });
  if (p.setup.starter.id !== 'framework') return;
  const fw = p.setup.framework.import;
  let from = '';
  let tmp = '';
  if (fw.path) from = safeFolder(fw.path);
  else {
    const r = parseGithub(fw.repo);
    tmp = mkdtempSync(join(tmpdir(), 'axf-wizard-fw-'));
    git(tmp, ['clone', '-q', '--depth', '1', `${GIT_BASE()}/${r.owner}/${r.name}.git`, 'fw'], { auth: GIT_BASE().startsWith('https://') });
    from = join(tmp, 'fw');
  }
  try {
    const src = join(from, fw.boilerplate);
    insideOrThrow(from, src);
    if (!existsSync(src) || !statSync(src).isDirectory()) fail(`The framework has no boilerplate folder ${fw.boilerplate}`);
    cpSync(src, p.dir, { recursive: true, filter: (f) => basename(f) !== '.git' && !lstatSync(f).isSymbolicLink() });
    say(`  copied ${fw.boilerplate} from ${fw.repo || fw.path}`);
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

/** The project's setup in project.manifest.json (x.setup), plus framework/README.md (own framework) and docs/FIRST_PLAN.md. */
export function writeSetup(dir, p) {
  const written = [];
  const put = (rel, text) => { const f = join(dir, rel); insideOrThrow(dir, f); if (existsSync(f)) return; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); written.push(rel); };
  const s = p.setup;
  const starter = STARTERS.find((x) => x.id === s.starter.id) ?? STARTERS[0];
  if (s.framework.mode === 'own') put('framework/README.md', `# ${s.framework.name || `${p.display} framework`}\n\nThis project's own framework, started by the AXF project wizard. Engines, assets and libraries the app builds on go here.\n`);
  const fp = s.firstPlan;
  if (fp.text || fp.builds.length) {
    put('docs/FIRST_PLAN.md', `# First plan: ${p.display}\n\n${fp.text ? `${fp.text}\n\n` : ''}${fp.builds.length ? `## Builds\n\n${fp.builds.map((b) => `- [ ] ${b}`).join('\n')}\n\n` : ''}${fp.spoken ? '_Spoken into the wizard._\n' : ''}`);
  }
  const mf = join(dir, 'project.manifest.json');
  insideOrThrow(dir, mf);
  const m = readJson(mf);
  if (m) {
    m.x = { ...(m.x ?? {}), setup: {
      $axf: 'project-setup@1',
      starter: { id: starter.id, ...(starter.id === 'template' ? { template: s.starter.template, boilerplate: s.starter.boilerplate } : {}), features: starter.features, plugins: starter.plugins },
      framework: s.framework,
      skin: s.skin,
      claude: s.claude,
      firstPlan: written.includes('docs/FIRST_PLAN.md') ? 'docs/FIRST_PLAN.md' : null,
      inherited: Object.entries(p.inherit).filter(([, v]) => v).map(([k]) => k),
      ...(p.startFrom && p.startFrom.kind !== 'blank' ? { startedFrom: { kind: p.startFrom.kind, id: p.startFrom.id, name: p.startFrom.label } } : {}),
      madeBy: 'project-wizard',
    } };
    writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
    written.push('project.manifest.json');
  }
  return written;
}

/**
 * Create the project's console workspace (projects@1) and, unless told not to, make it the active project. With a
 * template, the new workspace gets the template's lists, notes, plans and build rules before anyone switches to it.
 */
async function openWorkspace(p, template = null) {
  const P = await projectsCli();
  const id = p.name.slice(0, 40).replace(/-+$/, '');
  const have = P.readProjects().projects.find((x) => x.id === id);
  if (have) {
    if (p.switchTo && have.status !== 'archived') await P.act({ action: 'select', id });
    return { id, created: false, active: p.switchTo && have.status !== 'archived', note: `workspace ${id} already there${p.switchTo ? ', switched to it' : ''}${template ? '; its data was left as it is' : ''}` };
  }
  const made = await P.act({ action: 'create', id, name: p.display, description: p.description, select: p.switchTo && !template });
  const carried = [];
  if (template) {
    // the wizard's own part (setup, manifest, instructions) went into the repo above
    const r = await (await templates()).apply(made.project, template, { skip: [SELF], log: (m) => carried.push(m) });
    for (const x of r.problems) carried.push(`! ${x}`);
    if (p.switchTo) await P.act({ action: 'select', id });
  }
  return { id, created: true, active: p.switchTo, carried, note: `workspace ${id} created${template ? ` from ${p.startFrom.label}` : ''}${p.switchTo ? ' and made the active project' : ''}` };
}

/** A run made from the draft (or one equal to it) clears the draft. */
function clearDraftIf(plan) {
  const s = loadStore();
  if (!s.draft) return;
  if (plan?.fromDraft || (s.draft.name || slugOf(s.draft.display)) === (plan.name || slugOf(plan.display))) { delete s.draft; saveStore(s); }
}

/* ─── the Claude.ai project kit ──────────────────────────────────────────── */

const cap = (s, n = 60_000) => (s.length > n ? `${s.slice(0, n)}\n\n…(cut at ${n} characters)\n` : s);
const readMaybe = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
/** Read a file of the project only if nothing on the way to it is a symlink (a cloned repo could link _claude/ elsewhere). */
const readInside = (dir, f) => { try { insideOrThrow(dir, f); return readMaybe(f); } catch { return ''; } };
function insideOrThrow(dir, f) {
  const root = resolve(dir);
  const rel = relative(root, resolve(f));
  if (rel.startsWith('..') || isAbsolute(rel)) fail(`${f} is outside ${root}`);
  let cur = root;
  for (const part of rel.split('/').filter(Boolean)) {
    cur = join(cur, part);
    let st;
    try { st = lstatSync(cur); } catch { return; }
    if (st.isSymbolicLink()) fail(`${relative(root, cur)} is a symlink: the wizard won't read or write through it`);
  }
}
/** A VPS remote without the user@host part, for files that get committed. */
const vpsLabel = (u) => (u ? `VPS:${String(u).replace(/^ssh:\/\/[^/]+/, '')}` : '');
function tree(dir, depth = 2) {
  const skip = new Set(['node_modules', 'dist', 'build', '.git', '.gradle', '.next', '__pycache__', '.venv', 'shared', '.axf-console']);
  const lines = [];
  const walk = (d, pre, n) => {
    let es = [];
    try { es = readdirSync(d, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') || e.name === '.github').sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)); } catch { return; }
    for (const e of es.slice(0, 40)) {
      if (skip.has(e.name)) continue;
      lines.push(`${pre}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory() && n > 1) walk(join(d, e.name), `${pre}  `, n - 1);
    }
    if (es.length > 40) lines.push(`${pre}… ${es.length - 40} more`);
  };
  walk(dir, '', depth);
  return lines.slice(0, 250).join('\n');
}

/** Writes _claude/claude-ai/: INSTRUCTIONS.md (paste into the project's instructions) + context/ (upload as files). */
export function writeKit(dir, homes = {}) {
  insideOrThrow(dir, join(dir, KIT_DIR, 'x'));
  const m = (readInside(dir, join(dir, 'project.manifest.json')) && readJson(join(dir, 'project.manifest.json'))) || {};
  const display = m.displayName ?? basename(dir);
  const name = m.name ?? slugOf(display);
  const repo = homes.github || m.repo?.url || '';
  const vps = vpsLabel(homes.vps || m.x?.remotes?.vps || '');
  const today = new Date().toISOString().slice(0, 10);
  const shared = readInside(dir, join(dir, '_claude/shared/rules/RULES.md')) || readMaybe(join(REPO_ROOT, '_claude/shared/rules/RULES.md'));
  const projectRules = readInside(dir, join(dir, '_claude/rules/RULES.md'));
  const claudeMd = readInside(dir, join(dir, 'CLAUDE.md'));
  const decisions = readInside(dir, join(dir, '_claude/memory/decisions.md'));
  const memory = readInside(dir, join(dir, `_claude/memory/${name}.md`));
  const first = readInside(dir, join(dir, 'docs/FIRST_SESSION.md'));
  const relation = m.framework?.relation ?? 'none';
  const files = [];
  const add = (path, text) => files.push({ path, text: cap(text) });

  add('INSTRUCTIONS.md', `You are working on **${display}**${m.description ? `: ${m.description}` : ''}.

Where it lives
- ${repo ? `GitHub: ${repo} (attach it to this project from GitHub so you can read the code)` : 'No GitHub repo yet.'}
${vps ? `- VPS git: ${vps} (Claude Code on the VPS works in ~/projects/${name})\n` : ''}- Hub folder: /projects/${name}/ (Claude files in _claude/, shared data in _data/)
- AmberX AXF: ${relation === 'none' ? 'not built on AmberX AXF' : relation === 'built-on' ? 'built on AmberX AXF; every visible piece is an asset@1 asset and the UI reads only engine tokens' : relation}

How to work
- Brett works mostly from his phone: lead with the result, short paragraphs, phone-readable.
- Before building anything, recommend a model (Fable, Opus or Sonnet) and why, and let him pick.
- The repo and _claude/ are the shared memory: Claude Code sessions (phone, VPS, desktop) and this project don't share chat history. Decisions go in _claude/memory/decisions.md.
- No secrets anywhere: tokens and passwords stay in environment variables.

The project files are the context: PROJECT.md (overview and layout), CLAUDE.md (the repo's instructions for Claude Code), RULES.md (Brett's rules), DECISIONS.md and FIRST_SESSION.md. When they disagree with the repo, the repo is newer: say so.
`);
  add('context/PROJECT.md', `# ${display}

${m.description || 'No description yet.'}

| | |
| --- | --- |
| Project id | \`${name}\` (hub folder /projects/${name}/) |
| Kind | ${m.kind ?? 'app'} |
| AmberX AXF | ${relation} |
| Platforms | ${(m.platforms ?? []).join(', ') || '—'} |
| GitHub | ${repo || '—'} |
| VPS git | ${vps || '—'} |
| Visibility | ${m.repo?.visibility ?? '—'} |
| Kit made | ${today} by the AXF Dev Console project wizard |

## Layout (two levels)

\`\`\`
${tree(dir) || '(empty)'}
\`\`\`
${memory ? `\n## Notes\n\n${memory.replace(/^# .*\n+/, '')}` : ''}`);
  if (claudeMd) add('context/CLAUDE.md', claudeMd);
  add('context/RULES.md', `${shared || '# Rules\n\n(no shared rules found)\n'}${projectRules ? `\n---\n\n${projectRules}` : ''}`);
  if (decisions) add('context/DECISIONS.md', decisions);
  if (first) add('context/FIRST_SESSION.md', first);
  add('README.md', `# Claude.ai project kit: ${display}

Made ${today} by the AXF Dev Console project wizard. Regenerate it from the wizard (Projects → Rebuild kit) after big changes.

1. Open https://claude.ai/projects/new and name the project **${display}**${m.description ? ` (description: ${m.description})` : ''}.
2. Paste \`INSTRUCTIONS.md\` into the project's instructions.
3. Upload everything in \`context/\` as project files.
4. ${repo ? `Add ${repo.replace(/^https:\/\/github\.com\//, '')} from GitHub to the project's files (the Claude GitHub app already has access, or the wizard told you how to give it).` : 'Give it a GitHub repo later to attach the code.'}
5. Paste the project's link back into the wizard so it is recorded in project.manifest.json (x.claudeAi.url).
`);
  for (const f of files) { const out = join(dir, KIT_DIR, f.path); insideOrThrow(dir, out); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, f.text); }
  return { dir: join(dir, KIT_DIR), files: files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.text), text: f.text })) };
}

function commitAndPush(dir, paths, message, homes) {
  if (!existsSync(join(dir, '.git'))) return;
  git(dir, ['add', '--', ...paths]);
  if (!spawnSync('git', ['diff', '--cached', '--quiet', '--', ...paths], { cwd: dir }).status) return;
  const identity = gitOk(dir, ['config', 'user.email']) ? [] : ['-c', 'user.name=AXF project wizard', '-c', 'user.email=project-wizard@users.noreply.github.com'];
  git(dir, [...identity, 'commit', '-q', '-m', message, '--', ...paths]);
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (homes.github) {
    const r = parseGithub(homes.github);
    if (r) git(dir, ['push', '-q', `${GIT_BASE()}/${r.owner}/${r.name}.git`, `${branch}:${branch}`], { auth: GIT_BASE().startsWith('https://') });
  }
  if (homes.vps && gitOk(dir, ['remote', 'get-url', 'vps'])) git(dir, ['push', '-q', 'vps', `${branch}:${branch}`]);
}

function projectOf(name) {
  const n = slugOf(name);
  const p = loadStore().projects[n];
  if (!p) fail(`No project ${n} made with the wizard`);
  if (!existsSync(p.dir)) fail(`${p.dir} is gone from the console server`);
  return p;
}

export async function kit({ name, rebuild = false }) {
  const p = projectOf(name);
  const k = rebuild ? writeKit(p.dir, { github: p.github, vps: p.vps }) : null;
  if (rebuild) commitAndPush(p.dir, [KIT_DIR], `Rebuild the Claude.ai project kit for ${p.display}`, { github: p.github, vps: !!p.vps });
  const files = k ? k.files : (p.kit?.files ?? []).map((f) => { const t = readInside(p.dir, join(p.dir, KIT_DIR, f)); return { path: f, bytes: Buffer.byteLength(t), text: t }; });
  if (k) putProject({ name: p.name, kit: { dir: KIT_DIR, files: k.files.map((f) => f.path) } });
  return { ok: true, name: p.name, files, claudeNewProjectUrl: CLAUDE_NEW_PROJECT_URL };
}

/** Record the Claude.ai project's link in the manifest (x.claudeAi.url) and the wizard's list. */
export async function link({ name, url }) {
  const p = projectOf(name);
  const u = str(url, 300);
  if (!/^https:\/\/claude\.ai\/project\/[A-Za-z0-9-]{8,80}\/?$/.test(u)) fail('Paste the project\'s link from claude.ai (https://claude.ai/project/…)');
  const mf = join(p.dir, 'project.manifest.json');
  insideOrThrow(p.dir, mf);
  const m = readJson(mf);
  if (!m) fail('The project has no project.manifest.json');
  m.x = { ...(m.x ?? {}), claudeAi: { ...(m.x?.claudeAi ?? {}), url: u, kit: KIT_DIR } };
  const { validateProjectManifest, loadRules, formatProjectValidation } = await import(join(CLI, 'project.mjs'));
  const v = validateProjectManifest(m, loadRules(), { exists: (rel) => existsSync(join(p.dir, rel)) });
  if (!v.ok) fail(formatProjectValidation(v, 'project.manifest.json'));
  writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
  let pushed = true;
  try { commitAndPush(p.dir, ['project.manifest.json'], `Record the Claude.ai project for ${p.display}`, { github: p.github, vps: !!p.vps }); } catch (e) { pushed = false; }
  return { ok: true, project: putProject({ name: p.name, claudeAi: u }), pushed };
}

/** Forget a project in the wizard's list. Never deletes the folder or any repository. */
export function forget({ name }) {
  const s = loadStore();
  const n = slugOf(name);
  if (!s.projects[n]) fail(`No project ${n}`);
  delete s.projects[n];
  saveStore(s);
  return { ok: true };
}

export async function list({ location }) {
  if (location === 'github') return { ok: true, items: await listGithub() };
  if (location === 'vps') return { ok: true, items: listVps() };
  if (location === 'local') return { ok: true, items: listLocal() };
  fail('location is github, vps or local');
}

export async function handle(req = {}) {
  switch (req.action) {
    case 'status': return status();
    case 'inspect': return inspect(req.source);
    case 'check': return check(req.fromDraft ? draftPlan() : req.plan);
    case 'run': case 'create': return run(req.fromDraft ? draftPlan() : req.plan);
    case 'options': return options();
    case 'start': return start(req);
    case 'current': return { ok: true, ...(await current()) };
    case 'draft': return draft(req);
    case 'list': return list(req);
    case 'kit': return kit(req);
    case 'link': return link(req);
    case 'forget': return forget(req);
    default: fail(`unknown action ${req.action}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--json');
  const raw = i > 0 ? process.argv[i + 1] : readFileSync(0, 'utf8');
  let req;
  try { req = JSON.parse(raw || '{}'); } catch { console.log(JSON.stringify({ ok: false, error: 'bad JSON request' })); process.exit(0); }
  // claude-project prints progress to the console; keep stdout's last line for the JSON answer.
  const realLog = console.log;
  console.log = (...a) => process.stderr.write(a.join(' ') + '\n');
  handle(req).then((r) => realLog(JSON.stringify(r)), (e) => realLog(JSON.stringify({ ok: false, error: e.user ? e.message : `wizard failed: ${e.message}` })));
}
