/**
 * project-seed — writes a seed data set (framework/plan/project-seed-core.mjs) into one project's own stores, and
 * only that project's (projects@1 isolation: never the active project's, never AmberX AXF's):
 *
 *   lists + to-dos  todo-manager's todo-store@1 for the project:
 *                   <AXF_TODO_DIR or .axf-console/plugins/todo-manager>/projects/<id>/store.json
 *   notes           the hub's project notes, /projects/_shared/_claude/project-notes/<id>/Demo data/*.md (the Notes
 *                   browser's folder for the project; skipped where the hub's shared Claude folder isn't mounted)
 *   plans           Plan Studio's store for the project (plans.mjs storeDir() under the project's build profile)
 *   builds          the builds store, through the Build orchestrator, under the project's build profile
 *
 * A store that already has data is left alone (a re-created project keeps what it had). A store whose plugin is not
 * installed is skipped. Returns { counts, skipped, log }.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROJECTS_DIR, REPO_ROOT } from './persist.mjs';
import { PROJECTS_SUBDIR } from '../plan/projects-core.mjs';
import { demoSeed } from '../plan/project-seed-core.mjs';

const PLUGINS = join(REPO_ROOT, 'apps', 'console-web', 'plugins');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function writeJson(f, v, mode) {
  mkdirSync(join(f, '..'), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`, mode ? { mode } : undefined);
  renameSync(tmp, f);
  if (mode) chmodSync(f, mode);
}
const dueMs = (d) => (d ? Date.parse(`${d}T17:00:00Z`) : null);

/** Run `fn` with the project's build profile in force for this process (the stores follow it), then put it back. */
async function inProfile(profile, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'AXF_BUILD_PROFILE');
  const was = process.env.AXF_BUILD_PROFILE;
  process.env.AXF_BUILD_PROFILE = profile;
  try { return await fn(); } finally { if (had) process.env.AXF_BUILD_PROFILE = was; else delete process.env.AXF_BUILD_PROFILE; }
}

/* ---------------- stores ---------------- */

export const todoStoreFile = (id) => join(process.env.AXF_TODO_DIR || join(REPO_ROOT, '.axf-console', 'plugins', 'todo-manager'), PROJECTS_SUBDIR, id, 'store.json');
export const notesDir = (id) => join(process.env.AXHUB_PROJECTS_DIR || DEFAULT_PROJECTS_DIR, '_shared', '_claude', 'project-notes', id);

/** todo-store@1 (todo-manager/server/model.py Store): lists with parentId, to-do entries with checklists. */
function seedTodos(project, set) {
  const f = todoStoreFile(project.id);
  const cur = readJson(f);
  if (cur && ((cur.lists ?? []).length || (cur.entries ?? []).length)) return { skipped: `to-dos: ${f} already has data` };
  const now = Date.now();
  let next = 1;
  const ids = new Map();
  const order = new Map();
  const sort = (k) => { const n = (order.get(k) ?? 0) + 1; order.set(k, n); return n; };
  const lists = set.lists.map((l) => {
    const id = next++; ids.set(l.key, id);
    const parentId = l.parent ? ids.get(l.parent) : null;
    return { id, parentId, title: l.title, tone: l.tone, icon: l.icon, sortOrder: sort(`l:${parentId}`), createdAt: now, updatedAt: now };
  });
  const entries = set.todos.map((t) => {
    const listId = ids.get(t.list);
    return {
      kind: t.kind, title: t.title, body: t.body, status: t.status, priority: t.priority, dueAt: dueMs(t.due), tags: t.tags,
      checklist: t.checklist, fields: {}, id: next++, listId, parentId: null, sortOrder: sort(`e:${listId}`),
      createdAt: now, updatedAt: now, completedAt: t.status === 'done' ? now : null,
    };
  });
  writeJson(f, { $axf: 'todo-store@1', lists, entries, nextId: next }, 0o600);
  return { lists: lists.length, todos: entries.length };
}

/** Markdown notes in the project's notes folder (notes-browser store.py layout; no history needed for new files). */
function seedNotes(project, set) {
  const shared = join(process.env.AXHUB_PROJECTS_DIR || DEFAULT_PROJECTS_DIR, '_shared', '_claude');
  if (!existsSync(shared)) return { skipped: `notes: no hub notes folder here (${shared})` };
  const dir = notesDir(project.id);
  let n = 0;
  for (const note of set.notes) {
    const f = join(dir, note.path);
    if (existsSync(f)) continue;
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, note.content, { mode: 0o660 });
    n++;
  }
  return { notes: n };
}

async function seedPlans(project, set, by) {
  const mod = join(PLUGINS, 'plan-studio', 'plans.mjs'); // axf-plugin:plan-studio
  if (!existsSync(mod)) return { skipped: 'plans: Plan Studio is not installed' };
  const ps = await import(mod);
  return inProfile(project.profile, () => {
    let n = 0;
    for (const p of set.plans) {
      if (ps.getPlan(p.id)) continue;
      const r = ps.savePlan({ $axf: 'plan@1', ...p, steps: p.steps.map((s, i) => ({ id: `s${i + 1}`, ...s })), createdBy: by }, { by, kind: 'import', note: 'Demo data', force: true });
      if (r.ok !== false) n++;
    }
    return { plans: n };
  });
}

async function seedBuilds(project, set, by) {
  const mod = join(PLUGINS, 'build-orchestrator', 'orchestrator.mjs'); // axf-plugin:build-orchestrator
  if (!existsSync(mod)) return { skipped: 'builds: the Build orchestrator is not installed' };
  const orch = await import(mod);
  return inProfile(project.profile, () => {
    const have = new Set(orch.load().builds.map((b) => b.id));
    let n = 0;
    for (const b of set.builds) {
      if (have.has(b.id)) continue;
      orch.act({ action: 'add', id: b.id, title: b.title, detail: b.detail, category: b.category, steps: b.steps.map(({ done: _d, ...s }) => s) }, by);
      b.steps.forEach((s, i) => { if (s.done) orch.act({ action: 'step', id: b.id, step: `s${i + 1}`, done: true }, by); });
      orch.act({ action: 'status', id: b.id, status: b.status }, by);
      orch.act({ action: 'note', id: b.id, text: b.note }, by);
      n++;
    }
    return { builds: n };
  });
}

/**
 * Seed `project` (a registry entry: { id, name, profile, base }) with `kind` ('demo'). The base project is never
 * seeded. `today` (YYYY-MM-DD) defaults to the current UTC day.
 */
export async function seedProject(project, { kind = 'demo', by = 'projects', today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!project || project.base) throw new Error('the main project is never seeded');
  if (kind !== 'demo') return { counts: {}, skipped: [], log: [] };
  const set = demoSeed(project, { today });
  const counts = {}; const skipped = []; const log = [];
  for (const [what, step] of [['to-dos', () => seedTodos(project, set)], ['notes', () => seedNotes(project, set)], ['plans', () => seedPlans(project, set, by)], ['builds', () => seedBuilds(project, set, by)]]) {
    try {
      const r = await step();
      if (r.skipped) { skipped.push(r.skipped); log.push(`seed: ${r.skipped}`); continue; }
      Object.assign(counts, r);
    } catch (e) {
      skipped.push(`${what}: ${e.message}`); log.push(`seed: ${what} failed: ${e.message}`);
    }
  }
  log.unshift(`seed: demo data for ${project.name} — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing written'}`);
  return { counts, skipped, log };
}
