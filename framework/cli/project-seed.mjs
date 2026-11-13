#!/usr/bin/env node
/**
 * project-seed — make the test project `test-sandbox` (projects@1) and fill it with sample data, so the project
 * switcher can be tried on something other than AmberX AXF. Everything it writes is marked as test data.
 *
 *   node framework/cli/project-seed.mjs            seed: create the project if missing, then fill every empty store
 *   node framework/cli/project-seed.mjs status     what is there, store by store
 *   node framework/cli/project-seed.mjs purge --confirm test-sandbox
 *                                                  delete the project and remove everything this script made
 *   --json on any command prints one JSON line.
 *
 * Seed makes the project the way the console's New project does (framework/cli/projects.mjs: registry entry + its own
 * build profile, the active project left as it is), then:
 *   hub folder   /projects/test-sandbox/{_claude,_data} with _data/project.manifest.json (project-manifest@1,
 *                validated against the Standards rules in force) and the _claude skeleton claude-project writes;
 *   builds       two sample builds in the project's build profile (one complete = shipped, one pending whose steps
 *                carry no estimate, so the pipeline never splits or auto-queues it);
 *   plans        two Plan Studio plans in the project's copy of the plan-studio folder;
 *   to-dos       two to-do manager lists with groups four levels deep and ten to-dos (open, in progress, blocked,
 *                done; two due today, two overdue; tagged) in the project's todo-store@1;
 *   notes        five notes in the hub's _shared/_claude/project-notes/test-sandbox/ (notes browser).
 * Every step skips what is already there, so a second run changes nothing. Run as root, what it wrote in the hub tree
 * is handed back to the hub's owner (as the builds store does).
 *
 * Where: the hub and the profile registry follow framework/cli/persist.mjs (AXHUB_PROJECTS_DIR, AXF_DATA_DIR); the
 * to-do store is the console's (AXF_TODO_DIR, default <repo>/.axf-console/plugins/todo-manager: point it at the
 * running console's checkout, e.g. /opt/axf/.axf-console/plugins/todo-manager). Build writes go through the
 * orchestrator CLI, so they reach main through builds-live like any other build change.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, persistRoot, readProfiles } from './persist.mjs';
import { loadRules, validateProjectManifest } from './project.mjs';

export const SANDBOX = Object.freeze({
  id: 'test-sandbox',
  name: 'Test Sandbox',
  description: 'TEST DATA: a throwaway workspace for trying projects (its own builds, notes, to-dos and plans). Safe to delete.',
});
const BY = 'project-seed';
const ORCH = join(REPO_ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs');
const STORES_PY = join(REPO_ROOT, 'framework/cli/project_seed_stores.py');
export const BUILD_IDS = Object.freeze({ shipped: `${SANDBOX.id}-sample-shipped-build`, pending: `${SANDBOX.id}-sample-pending-build` });
export const PLAN_IDS = Object.freeze([`${SANDBOX.id}-plan-website-relaunch`, `${SANDBOX.id}-plan-garden-season`]);

/* ─── places ─────────────────────────────────────────────────────────────── */

export const hubProjectsDir = () => process.env.AXHUB_PROJECTS_DIR || '/projects';
export const hubFolder = () => join(hubProjectsDir(), SANDBOX.id);
export const todoFile = () => join(process.env.AXF_TODO_DIR || join(REPO_ROOT, '.axf-console/plugins/todo-manager'), 'projects', SANDBOX.id, 'store.json');
export const notesFolder = () => `project-notes/${SANDBOX.id}`;
export const notesDir = () => join(hubProjectsDir(), '_shared', '_claude', ...notesFolder().split('/'));
export function plansDir() {
  const root = persistRoot();
  return join(root ? join(root, 'plan-studio') : join(REPO_ROOT, '.axf-console/plugins/plan-studio'), 'projects', SANDBOX.id);
}

/* ─── the sample data ────────────────────────────────────────────────────── */

export function manifest(today = new Date().toISOString().slice(0, 10)) {
  return {
    $manifest: 'project-manifest@1',
    name: SANDBOX.id,
    displayName: SANDBOX.name,
    description: SANDBOX.description,
    kind: 'app',
    status: 'active',
    version: '0.0.1',
    platforms: ['web'],
    framework: { relation: 'built-on' },
    repo: { host: 'github', owner: 'MossesX', name: 'AmberX-AXF', exists: true, visibility: 'private' },
    location: { repo: 'MossesX/AmberX-AXF', path: '.' },
    data: { shared: [] },
    owners: ['MossesX'],
    created: today,
    notes: 'Test data only: made by framework/cli/project-seed.mjs to try the project switcher. It has no code of its own. Remove it with `node framework/cli/project-seed.mjs purge --confirm test-sandbox`.',
  };
}

const CLAUDE_FILES = {
  'README.md': `# _claude (axhub-projects@1)\n\nClaude files for **${SANDBOX.id}** (test data), the hub's \`/projects/${SANDBOX.id}/_claude/\`.\nMade by framework/cli/project-seed.mjs. Never store secrets.\n\n| Folder | What goes there |\n| --- | --- |\n| \`rules/\` | Hard rules for this project. |\n| \`instructions/\` | How to work: procedures, checklists, deploy guides. |\n| \`memory/\` | Facts, context and decisions (\`decisions.md\`); \`docs/\` is read on demand. |\n`,
  'rules/RULES.md': `# ${SANDBOX.name} rules\n\nTest project: no rules of its own. Brett's rules for every project are in \`_claude/shared/rules/\`.\n`,
  'instructions/README.md': `# Instructions\n\nTest project: nothing to set up or deploy.\n`,
  'memory/README.md': `# Memory\n\n${SANDBOX.name} is test data for the multi-project system. Delete it whenever it is no longer needed.\n`,
};

export function builds(now = new Date()) {
  const at = now.toISOString();
  const done = (text, i) => ({ id: `s${i + 1}`, text, model: 'Opus', estimate: '10m', done: true, doneAt: at });
  return [
    {
      id: BUILD_IDS.shipped,
      title: '[TEST DATA] Sample shipped build: landing page copy',
      category: 'test data',
      detail: 'TEST DATA for the Test Sandbox project (made by framework/cli/project-seed.mjs). Not real work: nothing was built or merged.',
      steps: ['Write the headline and intro', 'Add the feature list', 'Review and publish'].map(done),
      status: 'complete',
      mergedAt: at,
    },
    {
      id: BUILD_IDS.pending,
      title: '[TEST DATA] Sample pending build: contact form',
      category: 'test data',
      detail: 'TEST DATA for the Test Sandbox project (made by framework/cli/project-seed.mjs). Do not queue it: its steps have no estimates on purpose, so the pipeline never splits or launches it by itself.',
      steps: ['Form fields and validation', 'Send to the inbox', 'Thank-you screen'].map((text, i) => ({ id: `s${i + 1}`, text, model: 'Opus' })),
      status: 'pending',
    },
  ];
}

export function plans() {
  const common = { status: 'draft', priority: 'P3', tags: ['test-data'], category: 'Test data' };
  return [
    {
      ...common,
      id: PLAN_IDS[0],
      title: 'Test plan: website relaunch',
      summary: 'TEST DATA. A sample plan for the Test Sandbox project.',
      goal: 'A refreshed marketing site with a clear home page and a working contact form.',
      why: 'Sample content to check that plans stay inside their project.',
      body: 'Test data made by framework/cli/project-seed.mjs.',
      steps: [
        { text: 'Agree on the page list and copy owners', model: 'Opus', estimate: '10m' },
        { text: 'Design the home page hero and sections', model: 'Opus', estimate: '10m' },
        { text: 'Build the contact form', model: 'Opus', estimate: '10m' },
      ],
    },
    {
      ...common,
      id: PLAN_IDS[1],
      title: 'Test plan: garden season',
      summary: 'TEST DATA. A second sample plan for the Test Sandbox project.',
      goal: 'Vegetable beds planted and a watering routine in place by spring.',
      why: 'Sample content to check that plans stay inside their project.',
      body: 'Test data made by framework/cli/project-seed.mjs.',
      status: 'idea',
      steps: [
        { text: 'Pick the vegetables and order seeds', model: 'Opus', estimate: '10m' },
        { text: 'Prepare and plant the beds', model: 'Opus', estimate: '10m' },
      ],
    },
  ];
}

/** Two lists, groups four levels deep, ten to-dos: open / in progress / blocked / done, two due today, two overdue. */
export function todoLists(now = new Date()) {
  const day = 86400e3;
  const noon = new Date(now); noon.setUTCHours(17, 0, 0, 0);
  const today = noon.getTime(); const yesterday = today - day; const lastWeek = today - 6 * day;
  const nextWeek = today + 7 * day;
  const todo = (title, status, tags, items, extra = {}) => ({
    kind: 'todo', title, status, priority: extra.priority ?? 'normal', tags: ['test-data', ...tags],
    checklist: items.map((text, i) => ({ id: `c${i + 1}`, text, done: status === 'done' || i < (extra.ticked ?? 0) })),
    ...(extra.dueAt ? { dueAt: extra.dueAt } : {}),
    ...(extra.body ? { body: extra.body } : {}),
  });
  return [
    {
      title: 'Test · Website relaunch', tone: 'accent', icon: 'globe',
      entries: [todo('Book the kickoff call', 'done', ['meeting'], ['Pick a time', 'Send the invite'])],
      children: [
        {
          title: 'Design', tone: 'info',
          entries: [todo('Pick the colour palette', 'in_progress', ['design'], ['Three options', 'Choose one'], { ticked: 1, dueAt: today })],
          children: [{
            title: 'Home page',
            entries: [todo('Sketch the page layout', 'open', ['design', 'home'], ['Mobile', 'Desktop'], { dueAt: yesterday, priority: 'high' })],
            children: [{
              title: 'Hero section',
              entries: [todo('Write the hero headline', 'open', ['copy', 'home'], ['Five drafts', 'Pick the best'], { dueAt: today })],
            }],
          }],
        },
        {
          title: 'Content', tone: 'success',
          entries: [
            todo('Collect product photos', 'blocked', ['content'], ['Ask the photographer', 'Sort the shots'], { body: 'Waiting on the photographer.' }),
            todo('Proofread the about page', 'done', ['content', 'copy'], ['Spelling', 'Links']),
          ],
        },
      ],
    },
    {
      title: 'Test · Home and errands', tone: 'warning', icon: 'home',
      entries: [todo('Renew the car insurance', 'open', ['admin'], ['Compare quotes', 'Pay'], { dueAt: lastWeek, priority: 'urgent' })],
      children: [
        {
          title: 'Garden',
          children: [{
            title: 'Vegetable beds',
            entries: [todo('Order seed packets', 'in_progress', ['garden', 'shopping'], ['Tomatoes', 'Beans', 'Lettuce'], { ticked: 2, dueAt: nextWeek })],
            children: [{
              title: 'Tomatoes',
              entries: [todo('Build the tomato cages', 'open', ['garden'], ['Buy stakes', 'Tie the frames'])],
            }],
          }],
        },
        {
          title: 'Shopping',
          entries: [todo('Weekly groceries', 'done', ['shopping'], ['Milk', 'Bread', 'Eggs'])],
        },
      ],
    },
  ];
}

export const NOTES = [
  { path: 'welcome.md', content: '# Welcome to Test Sandbox\n\nTest data. This project exists to try the project switcher: its builds, notes, to-dos and plans are its own and never show in AmberX AXF.\n' },
  { path: 'meetings/kickoff.md', content: '# Kickoff call notes\n\nTest data.\n\n- Relaunch the website before spring\n- Home page first, then the contact form\n- Next check-in in two weeks\n' },
  { path: 'ideas/homepage-ideas.md', content: '# Home page ideas\n\nTest data.\n\n- A short hero line with one button\n- Three feature cards\n- A customer quote\n' },
  { path: 'garden/planting-calendar.md', content: '# Planting calendar\n\nTest data.\n\n| Crop | Sow | Plant out |\n| --- | --- | --- |\n| Tomatoes | March | May |\n| Beans | April | May |\n| Lettuce | March | April |\n' },
  { path: 'reading-list.md', content: '# Reading list\n\nTest data.\n\n1. A book on small-space gardening\n2. A guide to writing web copy\n' },
];

/* ─── steps ──────────────────────────────────────────────────────────────── */

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const fail = (msg) => { throw new Error(msg); };

/** Run a CLI that prints one JSON line with --json; returns that object (throws with its error). */
function cli(file, args, env = {}) {
  const r = spawnSync(process.execPath, [file, ...args, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, AXF_ACTOR: BY, ...env }, timeout: 120e3 });
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  let j = null; try { j = JSON.parse(last ?? ''); } catch { /* not JSON */ }
  if (!j || j.ok === false || r.status !== 0) fail(`${file.replace(`${REPO_ROOT}/`, '')} ${args[0]}: ${j?.error || (r.stderr || r.stdout || '').trim().slice(-400) || `exit ${r.status}`}`);
  return j;
}

async function projectsApi() { return import('./projects.mjs'); }

async function ensureProject(log) {
  const projects = await projectsApi();
  const reg = projects.readProjects();
  const have = reg.projects.find((p) => p.id === SANDBOX.id);
  if (have) {
    if (have.status === 'archived') fail(`${SANDBOX.id} is archived: unarchive it first (node framework/cli/projects.mjs unarchive ${SANDBOX.id})`);
    log.push(`project ${SANDBOX.id}: already there`);
    return have;
  }
  const r = await projects.act({ action: 'create', id: SANDBOX.id, name: SANDBOX.name, description: SANDBOX.description, select: false });
  log.push(...r.log);
  return r.project;
}

function ensureHubFolder(log) {
  if (!existsSync(hubProjectsDir())) { log.push(`hub folder: ${hubProjectsDir()} is not here, skipped`); return; }
  const m = manifest();
  const v = validateProjectManifest(m, loadRules());
  if (!v.ok) fail(`manifest refused by the Standards rules: ${v.errors.map((e) => e.message ?? e).join('; ')}`);
  const dir = hubFolder();
  const made = [];
  for (const d of ['_data', '_claude/rules', '_claude/instructions', '_claude/memory']) mkdirSync(join(dir, d), { recursive: true });
  const write = (rel, text) => { const f = join(dir, rel); if (!existsSync(f)) { writeFileSync(f, text); made.push(rel); } };
  write('_data/project.manifest.json', `${JSON.stringify(m, null, 2)}\n`);
  for (const [rel, text] of Object.entries(CLAUDE_FILES)) write(`_claude/${rel}`, text);
  log.push(`hub folder ${dir}: ${made.length ? `wrote ${made.join(', ')}` : 'already there'} (manifest valid${v.warnings.length ? `, ${v.warnings.length} warning(s)` : ''})`);
}

function storeBuildIds() {
  const j = cli(ORCH, ['list'], { AXF_BUILD_PROFILE: SANDBOX.id });
  return new Set((j.builds ?? j.state?.builds ?? []).map((b) => b.id));
}

function ensureBuilds(log) {
  const env = { AXF_BUILD_PROFILE: SANDBOX.id };
  const have = storeBuildIds();
  for (const b of builds()) {
    if (have.has(b.id)) { log.push(`build ${b.id}: already there`); continue; }
    cli(ORCH, ['act', '--json', JSON.stringify({ action: 'add', id: b.id, title: b.title, detail: b.detail, category: b.category, steps: b.steps, source: BY })], env);
    if (b.status !== 'pending') {
      if (b.mergedAt) cli(ORCH, ['act', '--json', JSON.stringify({ action: 'update', id: b.id, mergedAt: b.mergedAt })], env);
      cli(ORCH, ['act', '--json', JSON.stringify({ action: 'status', id: b.id, status: b.status })], env);
    }
    log.push(`build ${b.id}: added (${b.status}) in profile ${SANDBOX.id}`);
  }
}

async function ensurePlans(log) {
  process.env.AXF_BUILD_PROFILE = SANDBOX.id; // the plans store follows the active project
  try {
    const ps = await import('../../apps/console-web/plugins/plan-studio/plans.mjs');
    for (const p of plans()) {
      if (ps.getPlan(p.id)) { log.push(`plan ${p.id}: already there`); continue; }
      const r = ps.savePlan(p, { by: BY, kind: 'import', note: 'Test data', force: true });
      if (!r.ok) fail(`plan ${p.id} refused`);
      log.push(`plan ${p.id}: added`);
    }
    log.push(`plans in ${ps.storeDir()}`);
  } finally { delete process.env.AXF_BUILD_PROFILE; }
}

function seedStores(log) {
  const req = { todoFile: todoFile(), lists: todoLists(), notesRoot: hubProjectsDir(), notesFolder: notesFolder(), by: BY, notes: NOTES };
  const r = spawnSync('python3', ['-I', STORES_PY], { input: JSON.stringify(req), encoding: 'utf8', timeout: 60e3 });
  let j = null; try { j = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { /* below */ }
  if (!j?.ok) fail(`to-dos and notes: ${j?.error || (r.stderr || '').trim().slice(-400) || `exit ${r.status}`}`);
  const t = j.todos; const n = j.notes;
  log.push(t.seeded ? `to-dos: ${t.lists} lists and groups, ${t.entries} to-dos → ${t.file}` : `to-dos: ${t.why} (${t.file})`);
  log.push(n.seeded ? `notes: ${n.written.length} written → ${n.folder}` : `notes: ${n.why || `all ${n.kept.length} already there`} (${n.folder})`);
}

/**
 * The hub tree belongs to its owner (deploy, group-writable), and axHub writes it as that user. Run as root, this script
 * hands what it wrote there back: the project's folders, its profile data, and the two registries it rewrote.
 */
function matchHubOwner(log) {
  if (process.getuid?.() !== 0 || !existsSync(hubProjectsDir())) return;
  const { uid, gid } = statSync(hubProjectsDir());
  const root = persistRoot();
  const trees = [hubFolder(), plansDir(), notesDir(), ...(root ? [join(root, 'framework/plan/profiles', SANDBOX.id)] : [])];
  const files = root ? ['framework/plan/projects.json', 'framework/plan/profiles.json'].map((r) => join(root, r)) : [];
  let n = 0;
  const own = (p, dir) => { try { chownSync(p, uid, gid); chmodSync(p, dir ? 0o2775 : 0o664); n++; } catch { /* best effort */ } };
  const walk = (p) => {
    if (!existsSync(p)) return;
    const dir = statSync(p).isDirectory();
    own(p, dir);
    if (dir) for (const e of readdirSync(p)) walk(join(p, e));
  };
  for (const t of trees) { walk(t); if (t.split('/').at(-2) === 'projects' || t.split('/').at(-2) === 'project-notes') own(dirname(t), true); }
  for (const f of files) if (existsSync(f)) own(f, false);
  log.push(`hub files: ${n} handed to ${uid}:${gid}`);
}

export async function seed() {
  const log = [];
  await ensureProject(log);
  if (!readProfiles().profiles.some((p) => p.id === SANDBOX.id)) fail(`build profile ${SANDBOX.id} is missing: the project's builds would have nowhere to go`);
  ensureHubFolder(log);
  ensureBuilds(log);
  await ensurePlans(log);
  seedStores(log);
  matchHubOwner(log);
  return { log };
}

export async function status() {
  const projects = await projectsApi();
  const reg = projects.readProjects();
  const p = reg.projects.find((x) => x.id === SANDBOX.id) ?? null;
  const todo = readJson(todoFile());
  const have = p ? storeBuildIds() : new Set();
  const notes = existsSync(notesDir()) ? NOTES.filter((n) => existsSync(join(notesDir(), n.path))).length : 0;
  return {
    project: p, active: projects.activeProject(reg).id,
    hubFolder: existsSync(join(hubFolder(), '_data', 'project.manifest.json')) ? hubFolder() : null,
    builds: Object.values(BUILD_IDS).filter((id) => have.has(id)),
    plans: PLAN_IDS.filter((id) => existsSync(join(plansDir(), 'plans', `${id}.json`))),
    todo: todo ? { file: todoFile(), lists: todo.lists?.length ?? 0, entries: todo.entries?.length ?? 0 } : null,
    notes,
  };
}

/** Delete the project (registry + its build profile) and remove what seed made: builds, plans, to-dos, notes, hub folder. */
export async function purge(confirm) {
  if (confirm !== SANDBOX.id) fail(`type the project id to confirm: --confirm ${SANDBOX.id}`);
  const log = [];
  const projects = await projectsApi();
  const p = projects.readProjects().projects.find((x) => x.id === SANDBOX.id);
  if (p && readProfiles().profiles.some((x) => x.id === SANDBOX.id)) {
    const have = storeBuildIds();
    for (const id of Object.values(BUILD_IDS)) {
      if (!have.has(id)) continue;
      cli(ORCH, ['act', 'remove', id], { AXF_BUILD_PROFILE: SANDBOX.id });
      log.push(`build ${id}: removed (kept in the builds journal)`);
    }
  }
  if (p) log.push(...(await projects.act({ action: 'delete', id: SANDBOX.id, confirm: SANDBOX.id })).log);
  else log.push(`project ${SANDBOX.id}: not on the list`);
  for (const [what, dir] of [['plans', plansDir()], ['to-dos', join(todoFile(), '..')], ['notes', notesDir()], ['hub folder', hubFolder()]]) {
    if (!existsSync(dir)) continue;
    if (!dir.split('/').includes(SANDBOX.id)) fail(`refusing to remove ${dir}: not a ${SANDBOX.id} folder`);
    rmSync(dir, { recursive: true, force: true });
    log.push(`${what}: removed ${dir}`);
  }
  return { log };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const cmd = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--confirm') ?? 'seed';
  process.env.AXF_ACTOR ||= BY; // recorded as createdBy on the project and as who changed the builds
  try {
    let r;
    if (cmd === 'seed') r = await seed();
    else if (cmd === 'status') r = await status();
    else if (cmd === 'purge') r = await purge(flag('--confirm'));
    else fail(`unknown command ${cmd} (seed, status, purge)`);
    console.log(json ? JSON.stringify({ ok: true, ...r }) : r.log ? r.log.join('\n') : JSON.stringify(r, null, 2));
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exit(1);
  }
}
