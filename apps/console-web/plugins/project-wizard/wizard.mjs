#!/usr/bin/env node
/**
 * Project wizard engine (console plugin `project-wizard`). Ported from xGallery's New project wizard
 * (MossesX/xgallery server/src/routes/newproject.ts), rebuilt on AmberX AXF's `claude-project` so the console,
 * the terminal command and this wizard make projects the same way.
 *
 *   node wizard.mjs --json '{"action":"status"}'
 *   actions: status · inspect {source} · check {plan} · list {location} · run {plan} · kit {name} · link {name,url} · forget {name}
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
 * Tokens: GITHUB_TOKEN / GH_TOKEN (or `gh auth token`), passed to git through the environment only.
 * Env: AXF_WIZARD_WORKSPACE (where clones and new apps go, default ~/projects), AXF_WIZARD_ROOTS (colon list of
 * folders a "folder" source may come from; default the workspace and this repo), AXF_VPS_HOST/AXF_VPS_USER (VPS git
 * over SSH; without them /srv/git on this machine is used when it exists), AXF_VPS_GIT_DIR (default /srv/git).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(PLUGIN_DIR, '../../../..');
const CLI = join(REPO_ROOT, 'framework', 'cli');
const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const GIT_BASE = () => (process.env.CLAUDE_PROJECT_GIT_BASE || 'https://github.com').replace(/\/+$/, '');
export const CLAUDE_NEW_PROJECT_URL = 'https://claude.ai/projects/new';
export const KIT_DIR = '_claude/claude-ai';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// no leading '.' or '-', no '..' (git would read a leading '-' as an option; '..' walks out of /srv/git)
const REPO_RE = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
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

const STORE = () => process.env.AXF_WIZARD_STORE || join(REPO_ROOT, '.axf-console', 'project-wizard.json');
export function loadStore() { return readJson(STORE()) ?? { $axf: 'project-wizard@1', projects: {} }; }
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
  if (tokenCache !== undefined) return tokenCache;
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) return (tokenCache = t.trim());
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10_000 });
  return (tokenCache = r.status === 0 ? r.stdout.trim() : '');
}
async function gh(method, path, body) {
  const t = token();
  if (!t) fail('No GitHub token on the console server: set GITHUB_TOKEN (Systems check → GitHub), classic with repo + workflow scopes');
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'axf-project-wizard', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status}: ${data?.message ?? String(text).slice(0, 200)}`), { status: res.status, user: true });
  return data;
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
  const t = str(s, 300).replace(/\.git$/, '').replace(/\/+$/, '');
  const m = t.match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([^/\s:]+)\/([^/\s]+)$/i);
  if (!m || !OWNER_RE.test(m[1]) || !REPO_RE.test(m[2])) return null;
  return { owner: m[1], name: m[2] };
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
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const t = auth ? token() : '';
  const basic = t ? Buffer.from(`x-access-token:${t}`).toString('base64') : '';
  if (basic) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` });
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout });
  const scrub = (s) => (t ? String(s).split(t).join('***').split(basic).join('***') : String(s));
  if (r.status !== 0) fail(scrub(`git ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(-800)}`));
  return scrub(r.stdout.trim());
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
  if (!REPO_RE.test(name)) return { state: 'unknown', note: 'bad name' };
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
    if (!REPO_RE.test(name)) fail('Pick a repository on the VPS');
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
  if (source.kind === 'vps' && !REPO_RE.test(str(source.repo, 100).replace(/\.git$/, ''))) problems.push('Source: pick a repository on the VPS');
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
    if (!OWNER_RE.test(owner)) problems.push('GitHub: the owner must be a GitHub account or organisation');
    if (!REPO_RE.test(repoName)) problems.push('GitHub: the repository name may use letters, digits, ., - and _');
    if (!token()) problems.push('GitHub: no token on the console server (Systems check → GitHub)');
    else if (OWNER_RE.test(owner) && REPO_RE.test(repoName)) {
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
    if (!REPO_RE.test(repoName)) problems.push('VPS: the repository name may use letters, digits, ., - and _');
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
  if (!out.homes.github && !out.homes.vps) warnings.push('Only the local folder: the project has no remote copy');
  if (source.kind === 'new') {
    try { const b = await be(); b.templateInfo(str(source.template, 40) || 'react-ts'); if (source.boilerplate) b.loadBoilerplate(str(source.boilerplate, 60)); } catch (e) { problems.push(e.message); }
  }
  return { plan: out, problems, warnings };
}

export async function check(plan) {
  const r = await normalise(plan);
  return { ok: !r.problems.length, ...r };
}

/** Steps 1-3 (see the header). */
export async function run(plan) {
  const { plan: p, problems, warnings } = await normalise(plan);
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

    // 3. the Claude.ai project kit
    const k = writeKit(p.dir, { github: rec.github, vps: rec.vps });
    commitAndPush(p.dir, [KIT_DIR], `Add the Claude.ai project kit for ${p.display}`, { github: rec.github, vps: !!rec.vps });
    step('claude-ai-kit', `${k.files.length} files in ${KIT_DIR}/`);
    rec.kit = { dir: KIT_DIR, files: k.files.map((f) => f.path) };
    putProject(rec);
    return { ok: true, project: rec, log, kit: k };
  } catch (e) {
    step('error', e.message, false);
    if (rec.steps.source?.ok) putProject({ ...rec, failed: e.message });
    return { ok: false, error: e.message, log, project: rec };
  }
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
    case 'check': return check(req.plan);
    case 'run': return run(req.plan);
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
