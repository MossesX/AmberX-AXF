#!/usr/bin/env node
/**
 * claude-project — make any folder a Claude project and give it a home.
 *
 *   claude-project [dir] [--name my-app] [--display "My App"] [--description "…"] [--kind app]
 *                  [--where github,vps,device] [--owner MossesX] [--repo my-app] [--visibility private]
 *                  [--port bake|rebuild|no] [--vps-host host --vps-user root] [--vps-git /srv/git/<name>.git]
 *                  [--vps-dir ~/projects/<name>] [--no-sync] [--yes] [--dry-run]
 *   (also: axf claude-project …, and /claude-project in any Claude Code session)
 *
 * Run it in a folder (an existing codebase or an empty one). It asks what it can't work out, then:
 *   1. looks at the code: stack, build commands, whether it is built on AmberX AXF;
 *   2. writes what makes it a Claude project, never overwriting what is there: project.manifest.json
 *      (project-manifest@1, validated), _claude/ (rules, instructions, memory, plus Brett's shared files),
 *      CLAUDE.md (or adds the rules import to an existing one) and docs/FIRST_SESSION.md;
 *   3. commits it (a new repository gets a .gitignore first and never commits .env files or keys);
 *   4. gives it a home, any of:
 *        github  creates the repository (or uses an empty one), pushes, and gives the Claude GitHub app access so
 *                it shows up in Claude.ai and Claude Code on the web (a link to do it by hand when that fails);
 *        vps     a private git remote on the VPS (/srv/git/<name>.git) plus a working folder (~/projects/<name>)
 *                where Claude Code opens it through Moshi; on the VPS itself, or over SSH with --vps-host;
 *        device  nothing more: the project stays in this folder;
 *   5. when the app isn't built on AXF, asks how to port it (bake AXF into it, or rebuild it from a boilerplate)
 *      and parks the port on the pending build list for Fable, with the choice recorded in the manifest;
 *   6. syncs _claude/ with the hub when claude-sync is installed.
 *
 * Tokens: GITHUB_TOKEN / GH_TOKEN or `gh auth token`; passed to git through the environment, never written down.
 * GITHUB_API_URL and CLAUDE_PROJECT_GIT_BASE point it at other servers (tests).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { draftManifest, formatProjectValidation, loadRules, PROJECT_MANIFEST_FILE, validateProjectManifest } from './project.mjs';
import { actPending, loadPending } from './pending.mjs';
import { REPO_ROOT } from './persist.mjs';

export const CLAUDE_APP_URL = 'https://github.com/apps/claude/installations/select_target';
const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const GIT_BASE = () => (process.env.CLAUDE_PROJECT_GIT_BASE || 'https://github.com').replace(/\/+$/, '');
const WHERE = ['github', 'vps', 'device'];
const PORT_MODES = ['bake', 'rebuild', 'no'];
const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, bad: (s) => `\x1b[31m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/* ─── what is in the folder ───────────────────────────────────────────────── */

export function detect(dir) {
  const has = (f) => existsSync(join(dir, f));
  const pkg = readJson(join(dir, 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const stack = [];
  const platforms = new Set();
  if (pkg) {
    stack.push('Node');
    if (deps.typescript || has('tsconfig.json')) stack.push('TypeScript');
    for (const [d, label] of [['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['vite', 'Vite'], ['express', 'Express'], ['fastify', 'Fastify'], ['electron', 'Electron']]) if (deps[d]) stack.push(label);
    if (deps.react || deps.next || deps.vue || deps.svelte || deps.vite) platforms.add('web');
    if (deps.express || deps.fastify || deps.next) platforms.add('server');
    if (deps.electron) platforms.add('desktop');
    if (pkg.bin) platforms.add('cli');
  }
  const gradle = ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle', 'app/build.gradle.kts'].some(has) || has('android');
  if (gradle) { stack.push('Kotlin/Android (Gradle)'); platforms.add('android'); }
  const py = ['pyproject.toml', 'requirements.txt', 'setup.py'].find(has);
  if (py) {
    const t = readFileSync(join(dir, py), 'utf8');
    stack.push(/pyqt6|pyside6/i.test(t) ? 'Python (PyQt6)' : /fastapi|flask|django/i.test(t) ? 'Python web' : 'Python');
    platforms.add(/pyqt6|pyside6/i.test(t) ? 'desktop' : 'python');
  }
  for (const [f, label] of [['go.mod', 'Go'], ['Cargo.toml', 'Rust'], ['composer.json', 'PHP'], ['Gemfile', 'Ruby'], ['pubspec.yaml', 'Flutter']]) if (has(f)) stack.push(label);
  if (has('Dockerfile') || ['docker-compose.yml', 'compose.yaml', 'docker-compose.yaml'].some(has)) { stack.push('Docker'); platforms.add('server'); }
  // AmberX AXF: the framework itself, an app made by `axf init` (axf.manifest.json / axf.lock.json), or one using its packages.
  let relation = 'none';
  let axfNote = '';
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  if (real(dir) === real(REPO_ROOT)) { relation = 'core'; axfNote = 'this is AmberX AXF itself'; }
  else if (has('axf.manifest.json') || has('axf.lock.json') || has('src/axf/core')) { relation = 'built-on'; axfNote = 'made with axf init'; }
  else if (Object.keys(deps).some((d) => d.startsWith('@axf/') || d.startsWith('ai.amberx'))) { relation = 'built-on'; axfNote = 'uses AXF packages'; }
  const scripts = pkg?.scripts ? Object.keys(pkg.scripts).filter((s) => /^(dev|start|build|test|typecheck|lint|server|preview)(:|$)/.test(s)).map((s) => `npm run ${s}`) : [];
  if (gradle) scripts.push('gradle assembleDebug');
  if (py && has('requirements.txt')) scripts.unshift('pip install -r requirements.txt');
  let files = 0;
  try { files = readdirSync(dir).filter((f) => !f.startsWith('.')).length; } catch { /* empty */ }
  return {
    stack, platforms: [...platforms], relation, axfNote, scripts,
    git: has('.git'), empty: files === 0,
    name: pkg?.name && !pkg.name.startsWith('@') ? pkg.name : basename(resolve(dir)),
    description: typeof pkg?.description === 'string' ? pkg.description : '',
    manifest: readJson(join(dir, PROJECT_MANIFEST_FILE)),
    claudeMd: has('CLAUDE.md'),
  };
}

/* ─── GitHub ──────────────────────────────────────────────────────────────── */

export function githubToken() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) return t.trim();
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim(); } catch { return ''; }
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'axf-claude-project', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error(`GitHub ${res.status}: ${data?.message ?? text.slice(0, 200)}`); e.status = res.status; throw e; }
  return data;
}

/** Create the repository unless it exists; an existing one with commits is refused unless it is already this project's origin. */
async function githubRepo(token, { owner, name, visibility, description, allowExisting }, log) {
  const me = await gh(token, 'GET', '/user');
  let repo;
  try {
    repo = await gh(token, 'GET', `/repos/${owner}/${name}`);
    let empty = false;
    try { const commits = await gh(token, 'GET', `/repos/${owner}/${name}/commits?per_page=1`); empty = !commits?.length; } catch (e) { if (e.status === 409) empty = true; else throw e; }
    if (!empty && !allowExisting) throw new Error(`${owner}/${name} already exists and has commits: pick another --repo name (or run this inside a clone of it)`);
    log(`GitHub: ${owner}/${name} already exists${empty ? ' (empty)' : ''}, using it`);
  } catch (e) {
    if (e.status !== 404) throw e;
    const body = { name, description: description.slice(0, 300), private: visibility !== 'public', has_wiki: false, auto_init: false };
    repo = await gh(token, 'POST', owner.toLowerCase() === me.login.toLowerCase() ? '/user/repos' : `/orgs/${owner}/repos`, body);
    log(`GitHub: created ${repo.full_name} (${body.private ? 'private' : 'public'})`);
  }
  return { repo, me };
}

/** Give the Claude GitHub app access to the repository; returns a link for Brett when the token can't. */
async function claudeAppAccess(token, owner, repo, log) {
  let inst;
  try {
    const r = await gh(token, 'GET', '/user/installations?per_page=100');
    inst = (r?.installations ?? []).find((i) => i.app_slug === 'claude' && i.account?.login?.toLowerCase() === owner.toLowerCase());
  } catch (e) {
    return { ok: false, url: CLAUDE_APP_URL, why: `this token can't list GitHub app installations (${e.message})` };
  }
  if (!inst) return { ok: false, url: CLAUDE_APP_URL, why: `the Claude GitHub app isn't installed on ${owner}` };
  const manage = inst.account.type === 'Organization' ? `https://github.com/organizations/${inst.account.login}/settings/installations/${inst.id}` : `https://github.com/settings/installations/${inst.id}`;
  if (inst.repository_selection === 'all') { log('Claude app: already has access to every repository'); return { ok: true }; }
  try {
    await gh(token, 'PUT', `/user/installations/${inst.id}/repositories/${repo.id}`);
    log(`Claude app: ${repo.full_name} added`);
    return { ok: true };
  } catch (e) {
    return { ok: false, url: manage, why: `the token couldn't add it (${e.message})` };
  }
}

/* ─── git ─────────────────────────────────────────────────────────────────── */

function git(dir, args, { token, env } = {}) {
  const e = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    Object.assign(e, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` });
  }
  const r = spawnSync('git', args, { cwd: dir, env: e, encoding: 'utf8', timeout: 300_000 });
  const scrub = (s) => (token ? String(s).split(token).join('***') : String(s));
  if (r.status !== 0) throw new Error(scrub(`git ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(-800)}`));
  return scrub(r.stdout.trim());
}
const gitOk = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).status === 0;

const GITIGNORE = `node_modules/
dist/
build/
out/
.next/
coverage/
*.log
.DS_Store
.env
.env.*
!.env.example
*.pem
*.key
id_rsa*
id_ed25519*
__pycache__/
.venv/
venv/
.gradle/
local.properties
*.keystore
*.jks
`;
const SECRET_FILE = /(^|\/)(\.env(\..+)?|id_(rsa|ed25519|ecdsa)(\.pub)?|[^/]+\.(pem|key|p12|pfx|keystore|jks))$/i;

/* ─── files that make it a Claude project ─────────────────────────────────── */

function writeIfMissing(file, text, made) {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  made.push(file);
  return true;
}

const workingWithBrett = () => {
  const t = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const i = t.indexOf('## Working with Brett');
  return i < 0 ? '' : t.slice(i).trimEnd() + '\n';
};
const RULES_IMPORT = '**Brett\'s rules (always loaded):**\n\n@_claude/shared/rules/RULES.md\n@_claude/rules/RULES.md\n';

function claudeMd(p, d) {
  const build = d.scripts.length ? d.scripts.map((s) => `${s}`).join('\n') : '# not recorded yet: the first session fills this in';
  return `# ${p.display}

${p.description || `${p.display}: describe in one sentence what this project is for.`}

${RULES_IMPORT}
Everything else Claude should know is in \`_claude/\` (axhub-projects@1): \`rules/\`, \`instructions/\`, \`memory/\`
(decisions in \`memory/decisions.md\`) and \`shared/\` for all projects, synced with the hub's \`/projects/${p.name}/_claude/\`.

## Status (as of ${new Date().toISOString().slice(0, 10)})

- **Made a Claude project** with \`claude-project\` (AmberX AXF). Home: ${p.where.join(', ')}.
- **Stack:** ${d.stack.length ? d.stack.join(', ') : 'nothing detected yet (empty or new folder)'}.
- **AmberX AXF:** ${d.relation === 'none' ? (p.port !== 'no' ? `not built on it; port requested (${p.port}), parked for Fable on the AXF pending list as \`port-${p.name}\`` : 'not built on it') : `${d.relation}${d.axfNote ? ` (${d.axfNote})` : ''}`}.
- **Next:** run the first session (\`docs/FIRST_SESSION.md\`).

## Build, run, test

\`\`\`
${build}
\`\`\`

---

${workingWithBrett()}`;
}

function firstSession(p, d) {
  return `# First session: ${p.display}

Paste this as the first message of a Claude Code session opened on this project.

---

This is ${p.display}, just made a Claude project with \`claude-project\`. Before building anything:

1. Read \`CLAUDE.md\` and everything in \`_claude/\` (shared rules first).
2. Look through the code and tell me in a few lines what it is, what works and what looks unfinished.
   Detected so far: ${d.stack.length ? d.stack.join(', ') : 'an empty folder'}.
3. Find the real build, run and test commands, try them, and write them into CLAUDE.md → "Build, run, test".
4. Fill in CLAUDE.md → Status (built, next) and \`_claude/memory/${p.name}.md\`.
${d.relation === 'none' && p.port !== 'no' ? `5. A port to AmberX AXF is requested (${p.port === 'bake' ? 'bake AXF into this codebase' : 'rebuild from an AXF boilerplate'}): read \`_claude/memory/docs/port-to-axf.md\`. Don't start it: it is parked for Fable as \`port-${p.name}\` on the AXF pending list.\n6.` : '5.'} Ask me what to build first, and recommend a model for it (Fable, Opus or Sonnet) before starting.
`;
}

function portDoc(p, d) {
  const how = p.port === 'bake'
    ? `**Bake AXF into it.** Keep this codebase. Run \`axf init\` into it (react-ts or next-ts for web, android-compose for
Android), then move its look and chrome into \`asset@1\` assets step by step: colours and type → colour/style themes,
menus, toolbars, nav and dialogs → their asset types, layout → a layout asset with region slots. Every UI piece then reads
engine-compiled tokens only (framework/spec/THEMING.md). The old styles go as each piece moves over.`
    : `**Rebuild it from a boilerplate.** Start a fresh AXF app with \`axf init --boilerplate <closest>\` (see
\`axf boilerplates\`), keep this codebase alongside as the reference, and rebuild feature by feature on AXF assets,
libraries and plugins. The old app keeps running until the new one covers it.`;
  return `# Port ${p.display} to AmberX AXF

Requested ${new Date().toISOString().slice(0, 10)} with \`claude-project\`. Status: **parked for Fable** (AXF pending list,
item \`port-${p.name}\`). Nothing has been ported yet.

## What was found
- Stack: ${d.stack.join(', ') || 'unknown'}
- Platforms: ${d.platforms.join(', ') || 'unknown'}

## The chosen way
${how}

## Rules that apply
- The project keeps a valid \`project.manifest.json\`; when the port starts, \`framework.relation\` becomes \`built-on\`.
- Everything visible becomes an asset; nothing hardcodes colours or sizes.
- Port engines live in AmberX-AXF (\`framework/spec/PORTING.md\` covers porting the framework; app ports follow this file).
`;
}

/* ─── the run ─────────────────────────────────────────────────────────────── */

/** Line reader that keeps answers typed (or pasted) ahead of their question. */
function asker() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : queue.push(l)));
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
  return {
    question(q) { process.stdout.write(q); return queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve(null) : new Promise((r) => waiting.push(r)); },
    close() { rl.close(); },
  };
}

async function ask(rl, q, def) {
  if (!rl) return def;
  const a = ((await rl.question(`${q}${def ? c.dim(` [${def}]`) : ''}: `)) ?? '').trim();
  return a || def;
}

export async function run(argv = process.argv.slice(2), { log = (m) => console.log(m), interactive = process.stdin.isTTY && process.stdout.isTTY } = {}) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { args.push(argv[i]); continue; }
    const k = argv[i].slice(2);
    if (['yes', 'dry-run', 'no-sync', 'help'].includes(k)) flags[k] = true;
    else flags[k] = argv[++i];
  }
  if (flags.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '')); return { ok: true }; }
  const dir = resolve(args[0] ?? '.');
  mkdirSync(dir, { recursive: true });
  const d = detect(dir);
  const rl = interactive && !flags.yes ? asker() : null;
  try {
    log(c.b(`claude-project · ${dir}`));
    log(c.dim(`  found: ${d.empty ? 'an empty folder' : d.stack.join(', ') || 'files, no known stack'} · AXF: ${d.relation}${d.axfNote ? ` (${d.axfNote})` : ''}${d.manifest ? ' · has a project manifest' : ''}${d.git ? ' · git' : ''}`));

    // Answers: flags, else the manifest, else questions (or defaults with --yes / no terminal).
    const display = flags.display ?? d.manifest?.displayName ?? await ask(rl, 'Project name', d.manifest?.displayName ?? d.name);
    const name = slugOf(flags.name ?? d.manifest?.name ?? display);
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name) || name === 'shared') throw new Error(`"${name}" can't be a project name: use a-z, 0-9 and hyphens`);
    const description = flags.description ?? d.manifest?.description ?? await ask(rl, 'What is it for (one sentence)', d.description);
    const whereRaw = flags.where ?? await ask(rl, 'Where should the repo live? github, vps, device (comma for several)', 'github');
    const where = [...new Set(String(whereRaw).split(/[\s,]+/).map((w) => w.toLowerCase()).filter(Boolean))];
    const bad = where.filter((w) => !WHERE.includes(w));
    if (!where.length || bad.length) throw new Error(`--where takes github, vps and/or device (got ${whereRaw})`);
    let token = '';
    let me = null;
    if (where.includes('github')) {
      token = githubToken();
      if (!token) throw new Error('No GitHub token: set GITHUB_TOKEN (classic, repo + workflow) or sign in with gh auth login');
      me = await gh(token, 'GET', '/user');
    }
    const owner = flags.owner ?? d.manifest?.repo?.owner ?? me?.login ?? 'MossesX';
    const repoName = flags.repo ?? d.manifest?.repo?.name ?? name;
    const visibility = flags.visibility ?? (where.includes('github') ? await ask(rl, 'Visibility: private or public', d.manifest?.repo?.visibility ?? 'private') : 'private');
    let port = 'no';
    if (d.relation === 'none') {
      port = flags.port ?? await ask(rl, 'Not built on AmberX AXF. Port it? bake (AXF into this code), rebuild (from a boilerplate), no', 'no');
      if (!PORT_MODES.includes(port)) throw new Error(`--port takes bake, rebuild or no (got ${port})`);
    }
    const p = { name, display, description, where, owner, repoName, visibility, port };
    if (flags['dry-run']) { log(JSON.stringify({ plan: p, found: { ...d, manifest: !!d.manifest } }, null, 2)); return { ok: true, plan: p }; }

    const made = [];
    const notes = [];

    // 1. manifest (kept if present; repo and x fields filled in as homes are made)
    const mfile = join(dir, PROJECT_MANIFEST_FILE);
    const m = d.manifest ?? draftManifest({ name, displayName: display, description, kind: flags.kind ?? 'app', relation: d.relation, owner, repoName, exists: false, visibility, path: '.', locationRepo: `${owner}/${repoName}`, platforms: d.platforms });
    m.x = { ...(m.x ?? {}), claudeProject: { created: new Date().toISOString().slice(0, 10), where } };
    if (d.relation === 'none' && port !== 'no') m.x.port = { mode: port, status: 'parked', pending: `port-${name}`, model: 'Fable' };

    // 2. Claude files
    const cl = join(dir, '_claude');
    writeIfMissing(join(cl, 'README.md'), `# _claude (axhub-projects@1)\n\nClaude files for **${name}**, synced with the hub's \`/projects/${name}/_claude/\` (\`shared/\` ↔ \`/projects/_shared/_claude/\`).\nRun \`claude-sync sync\` after editing. Never store secrets.\n\n| Folder | What goes there |\n| --- | --- |\n| \`rules/\` | Hard rules for this project. |\n| \`instructions/\` | How to work: procedures, checklists, deploy guides. |\n| \`memory/\` | Facts, context and decisions (\`decisions.md\`); \`docs/\` is read on demand. |\n| \`shared/\` | Brett's files for every project. |\n`, made);
    writeIfMissing(join(cl, 'rules', 'RULES.md'), `# ${display} rules\n\nProject rules go here. Brett's rules for every project are in \`_claude/shared/rules/\`.\n`, made);
    writeIfMissing(join(cl, 'instructions', 'README.md'), `# Instructions\n\nProcedures for ${display}: setup, deploy, recurring tasks.\n`, made);
    writeIfMissing(join(cl, 'memory', 'README.md'), `# Memory\n\nFacts and decisions about ${display}. Decisions go in \`decisions.md\`.\n`, made);
    writeIfMissing(join(cl, 'memory', 'decisions.md'), `# Decisions\n\n- ${new Date().toISOString().slice(0, 10)}: made a Claude project with \`claude-project\`; home: ${where.join(', ')}${d.relation === 'none' && port !== 'no' ? `; port to AXF requested (${port}), parked for Fable` : ''}.\n`, made);
    writeIfMissing(join(cl, 'memory', `${name}.md`), `# ${display}\n\n${description || 'What it is: to be written by the first session.'}\n\n- Stack: ${d.stack.join(', ') || 'none detected'}\n- Platforms: ${d.platforms.join(', ') || 'none detected'}\n- AmberX AXF: ${d.relation}\n`, made);
    if (!existsSync(join(cl, 'shared')) && existsSync(join(REPO_ROOT, '_claude', 'shared'))) {
      cpSync(join(REPO_ROOT, '_claude', 'shared'), join(cl, 'shared'), { recursive: true });
      made.push(join(cl, 'shared') + '/');
    }
    if (d.relation === 'none' && port !== 'no') writeIfMissing(join(cl, 'memory', 'docs', 'port-to-axf.md'), portDoc(p, d), made);

    // 3. CLAUDE.md and the first-session prompt
    if (!writeIfMissing(join(dir, 'CLAUDE.md'), claudeMd(p, d), made)) {
      const t = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
      if (!t.includes('_claude/shared/rules/RULES.md')) {
        const lines = t.split('\n');
        const at = lines[0].startsWith('#') ? 1 : 0;
        lines.splice(at, 0, '', RULES_IMPORT.trimEnd());
        writeFileSync(join(dir, 'CLAUDE.md'), lines.join('\n'));
        made.push(`${join(dir, 'CLAUDE.md')} (rules import added)`);
      }
    }
    writeIfMissing(join(dir, 'docs', 'FIRST_SESSION.md'), firstSession(p, d), made);

    // 4. the port request on the AXF pending list
    if (d.relation === 'none' && port !== 'no') {
      const id = `port-${name}`;
      if (!loadPending().items.some((i) => i.id === id)) {
        actPending({ action: 'add', id, title: `Port ${display} to AmberX AXF (${port === 'bake' ? 'bake AXF into it' : 'rebuild from a boilerplate'})`, detail: `Requested with claude-project for ${dir}.\nStack: ${d.stack.join(', ') || 'unknown'}.\nPlan: ${dir}/_claude/memory/docs/port-to-axf.md. Needs the app-port engine (pending item app-port-engine).`, model: 'Fable', source: 'chat' });
        notes.push(`Port parked for Fable on the AXF pending list as ${id} (commit AmberX-AXF or run claude-sync sync to share it).`);
      }
    }

    // 5. git: a new repository commits everything except secrets; an existing one only gets our files.
    const identity = [];
    const ensureIdentity = (who) => { if (!gitOk(dir, ['config', 'user.email'])) identity.push('-c', `user.name=${who?.name || 'claude-project'}`, '-c', `user.email=${who?.email || 'claude-project@users.noreply.github.com'}`); };
    const fresh = !d.git;
    if (fresh) {
      git(dir, ['init', '-q', '-b', 'main']);
      writeIfMissing(join(dir, '.gitignore'), GITIGNORE, made);
    }
    writeFileSync(mfile, JSON.stringify(m, null, 2) + '\n');
    const v = validateProjectManifest(m, loadRules(), { exists: (rel) => existsSync(join(dir, rel)) });
    if (!v.ok) throw new Error(`project.manifest.json fails validation:\n${formatProjectValidation(v, PROJECT_MANIFEST_FILE)}`);
    ensureIdentity(me ? { name: me.name || me.login, email: `${me.id}+${me.login}@users.noreply.github.com` } : null);
    const ours = ['project.manifest.json', '_claude', 'CLAUDE.md', 'docs/FIRST_SESSION.md', '.gitignore'].filter((f) => existsSync(join(dir, f)));
    git(dir, ['add', ...(fresh ? ['-A'] : ['--', ...ours])]);
    const staged = git(dir, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    const secrets = staged.filter((f) => SECRET_FILE.test(f));
    if (secrets.length) { git(dir, ['rm', '-q', '--cached', '--', ...secrets]); notes.push(`Not committed (look like secrets): ${secrets.join(', ')}`); }
    if (staged.length > secrets.length) git(dir, [...identity, 'commit', '-q', '-m', fresh ? `Start ${display} as a Claude project` : `Make ${display} a Claude project`]);
    const hasCommit = gitOk(dir, ['rev-parse', '--verify', 'HEAD']);
    const branch = hasCommit ? git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) : 'main';

    // 6. homes
    const result = { ok: true, name, dir, where, github: null, vps: null, claudeApp: null, made, notes };
    if (where.includes('github')) {
      const origin = gitOk(dir, ['remote', 'get-url', 'origin']) ? git(dir, ['remote', 'get-url', 'origin']) : '';
      const sameOrigin = origin.toLowerCase().replace(/\.git$/, '').endsWith(`/${owner}/${repoName}`.toLowerCase());
      const { repo } = await githubRepo(token, { owner, name: repoName, visibility, description: description || display, allowExisting: sameOrigin }, log);
      const url = `${GIT_BASE()}/${repo.full_name}.git`;
      // A folder cloned from somewhere else keeps its origin; the new repository becomes the "github" remote.
      const remote = !origin || sameOrigin ? 'origin' : 'github';
      if (!origin || (remote === 'github' && !gitOk(dir, ['remote', 'get-url', 'github']))) git(dir, ['remote', 'add', remote, `https://github.com/${repo.full_name}.git`]);
      if (hasCommit) git(dir, ['push', '-q', url, `${branch}:${branch}`], { token: GIT_BASE().startsWith('https://') ? token : '' });
      if (hasCommit && remote === 'origin') { git(dir, ['fetch', '-q', url, `+${branch}:refs/remotes/origin/${branch}`], { token: GIT_BASE().startsWith('https://') ? token : '' }); gitOk(dir, ['branch', `--set-upstream-to=origin/${branch}`]); }
      if (remote === 'github') notes.push(`origin still points at ${origin}; the new repository is the remote "github"`);
      log(c.ok(`  ✓ GitHub: ${repo.html_url}${hasCommit ? ` (${branch} pushed)` : ''}`));
      Object.assign(m.repo, { host: 'github', owner: repo.owner?.login ?? owner, name: repo.name, exists: true, visibility: repo.private ? 'private' : 'public', defaultBranch: branch, url: repo.html_url });
      result.github = repo.html_url;
      result.claudeApp = await claudeAppAccess(token, repo.owner?.login ?? owner, repo, log);
      if (result.claudeApp.ok) log(c.ok('  ✓ Claude app can see it: it shows up in Claude.ai and Claude Code on the web'));
      else notes.push(`Claude app: ${result.claudeApp.why}. Give it access to ${repo.full_name}: ${result.claudeApp.url}`);
    }
    if (where.includes('vps')) {
      const host = flags['vps-host'] ?? process.env.AXF_VPS_HOST ?? '';
      const user = flags['vps-user'] ?? process.env.AXF_VPS_USER ?? 'root';
      const home = host ? (user === 'root' ? '/root' : `/home/${user}`) : homedir();
      const bare = flags['vps-git'] ?? `/srv/git/${name}.git`;
      const work = (flags['vps-dir'] ?? `${home}/projects/${name}`).replace(/^~(?=\/)/, home);
      const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
      if (host) {
        const ssh = (cmd) => { const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `${user}@${host}`, cmd], { encoding: 'utf8', timeout: 120_000 }); if (r.status !== 0) throw new Error(`ssh ${user}@${host}: ${(r.stderr || r.error?.message || '').trim().slice(-400)}`); return r.stdout; };
        ssh(`mkdir -p ${q(dirname(bare))} && (test -d ${q(bare)} || git init -q --bare -b main ${q(bare)})`);
        const url = `ssh://${user}@${host}${bare}`;
        if (gitOk(dir, ['remote', 'get-url', 'vps'])) git(dir, ['remote', 'set-url', 'vps', url]); else git(dir, ['remote', 'add', 'vps', url]);
        if (hasCommit) git(dir, ['push', '-q', 'vps', `${branch}:${branch}`]);
        ssh(`test -d ${q(work)} || (mkdir -p ${q(dirname(work))} && git clone -q ${q(bare)} ${q(work)})`);
        result.vps = { remote: url, folder: `${user}@${host}:${work}` };
      } else {
        mkdirSync(dirname(bare), { recursive: true });
        if (!existsSync(bare)) git(dirname(bare), ['init', '-q', '--bare', '-b', 'main', bare]);
        if (gitOk(dir, ['remote', 'get-url', 'vps'])) git(dir, ['remote', 'set-url', 'vps', bare]); else git(dir, ['remote', 'add', 'vps', bare]);
        if (hasCommit) git(dir, ['push', '-q', 'vps', `${branch}:${branch}`]);
        const same = (() => { try { return realpathSync(work) === realpathSync(dir); } catch { return false; } })();
        if (!same && !existsSync(work)) { mkdirSync(dirname(work), { recursive: true }); git(dirname(work), ['clone', '-q', bare, work]); }
        result.vps = { remote: bare, folder: same ? dir : work };
      }
      log(c.ok(`  ✓ VPS: git remote "vps" → ${result.vps.remote}; working folder ${result.vps.folder}`));
      m.x.remotes = { ...(m.x.remotes ?? {}), vps: result.vps.remote };
      if (!where.includes('github')) Object.assign(m.repo, { host: 'other', exists: true });
    }
    if (where.includes('device')) log(c.ok(`  ✓ This device: ${dir}`));

    // 7. record the homes in the manifest and commit that
    writeFileSync(mfile, JSON.stringify(m, null, 2) + '\n');
    const v2 = validateProjectManifest(m, loadRules(), { exists: (rel) => existsSync(join(dir, rel)) });
    if (!v2.ok) throw new Error(`project.manifest.json fails validation:\n${formatProjectValidation(v2, PROJECT_MANIFEST_FILE)}`);
    if (git(dir, ['status', '--porcelain', '--', PROJECT_MANIFEST_FILE])) {
      git(dir, ['add', '--', PROJECT_MANIFEST_FILE]);
      git(dir, [...identity, 'commit', '-q', '-m', `Record where ${display} lives`]);
      if (result.github) git(dir, ['push', '-q', `${GIT_BASE()}/${m.repo.owner}/${m.repo.name}.git`, `${branch}:${branch}`], { token: GIT_BASE().startsWith('https://') ? token : '' });
      if (result.vps) git(dir, ['push', '-q', 'vps', `${branch}:${branch}`]);
    }

    // 8. hub sync (best effort)
    if (!flags['no-sync'] && spawnSync('sh', ['-c', 'command -v claude-sync'], { encoding: 'utf8' }).status === 0) {
      const s = spawnSync('claude-sync', ['sync'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
      notes.push(s.status === 0 ? `Hub: _claude/ synced to /projects/${name}/` : `Hub sync didn't finish: ${(s.stderr || s.stdout || '').trim().slice(-200)} (run claude-sync sync later)`);
    }

    log('');
    for (const f of made) log(c.dim(`  + ${relative(dir, f) || f}`));
    for (const n of notes) log(c.warn(`  ! ${n}`));
    log(`\n  Next: ${result.vps && result.vps.folder !== dir ? `cd ${result.vps.folder.replace(/^.*:/, '')}` : `cd ${dir}`} && claude, then paste docs/FIRST_SESSION.md${result.github ? `\n        or on Claude.ai / Claude Code on the web pick ${m.repo.owner}/${m.repo.name}` : ''}`);
    return result;
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((e) => { console.error(c.bad(`\n  ✗ ${e.message}\n`)); process.exit(1); });
}
