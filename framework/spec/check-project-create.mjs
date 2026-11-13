#!/usr/bin/env node
/**
 * Creating projects (projects@1 create + hub home + demo seed) end to end, on scratch copies of every store:
 * the demo data set's rules, create with and without seed data, switch, delete (needs the id typed), re-create, the
 * engine ops the console MCP calls (project-create / project-switch / project-delete), and isolation (a project's data
 * never lands in another project's stores, and AmberX AXF keeps every build).
 *
 *   node framework/spec/check-project-create.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/projects-core.mjs';
import { DEMO_PREFIX, DEMO_TAG, TODO_STATUS, demoSeed, listDepth, shiftDay } from '../plan/project-seed-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let passed = 0;
const fails = [];
const check = (name, cond, detail = '') => { if (cond) passed++; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/* ---------------- the demo data set (pure) ---------------- */
const today = '2026-11-13';
const set = demoSeed({ id: 'garden-demo', name: 'Garden demo' }, { today });
check('seed: same project + day → same set', JSON.stringify(set) === JSON.stringify(demoSeed({ id: 'garden-demo', name: 'Garden demo' }, { today })));
check('seed: lists nest at least 3 levels', listDepth(set.lists) >= 3, `depth ${listDepth(set.lists)}`);
check('seed: every list parent exists', set.lists.every((l) => !l.parent || set.lists.some((x) => x.key === l.parent)));
check('seed: about 10 to-dos', set.todos.length >= 8 && set.todos.length <= 12, String(set.todos.length));
for (const [word, st] of Object.entries(TODO_STATUS)) check(`seed: a to-do ${word}`, set.todos.some((t) => t.status === st));
check('seed: a to-do due today', set.todos.some((t) => t.due === today));
check('seed: an overdue to-do', set.todos.some((t) => t.due && t.due < today && t.status !== 'done'));
check('seed: to-dos have tags besides the demo tag', set.todos.every((t) => t.tags.includes(DEMO_TAG) && t.tags.length > 1));
check('seed: to-dos sit in known lists', set.todos.every((t) => set.lists.some((l) => l.key === t.list)));
check('seed: to-dos have a checklist (todo-manager needs one)', set.todos.every((t) => t.checklist.length > 0));
check('seed: ~5 notes', set.notes.length === 5);
check('seed: 2 plans, 2 builds', set.plans.length === 2 && set.builds.length === 2);
check('seed: every title marked as demo data', [...set.todos, ...set.notes, ...set.plans, ...set.builds].every((x) => x.title.startsWith(DEMO_PREFIX)) && set.lists.filter((l) => !l.parent).every((l) => l.title.startsWith(DEMO_PREFIX)));
check('seed: notes say they are demo data', set.notes.every((n) => /Demo data for/.test(n.content)));
check('seed: sample builds never dispatch', set.builds.every((b) => ['complete', 'blocked'].includes(b.status) && b.steps.length > 0));
check('seed: ids carry the project id', [...set.plans, ...set.builds].every((x) => x.id.includes('garden-demo')));
check('shiftDay: back across a month', shiftDay('2026-12-01', -1) === '2026-11-30');

/* ---------------- create rules (pure) ---------------- */
check('repo: owner/name', core.repoRef('MossesX/garden') === 'MossesX/garden');
check('repo: a GitHub URL', core.repoRef('https://github.com/MossesX/garden.git') === 'MossesX/garden');
check('repo: junk refused', throws(() => core.repoRef('not a repo'), /repo/));
check('seed: none by default, demo, true = demo', core.seedKind(undefined) === 'none' && core.seedKind('demo') === 'demo' && core.seedKind(true) === 'demo');
check('seed: unknown refused', throws(() => core.seedKind('lots'), /seed/));
const ctx = { now: '2026-11-13T00:00:00.000Z', by: 'test', activeProfile: 'all', profileIds: ['all'] };
check('create: a hub folder name refused', throws(() => core.applyChange(core.normalizeRegistry(null), { action: 'create', name: 'Shared' }, ctx), /hub keeps/));
const made = core.applyChange(core.normalizeRegistry(null), { action: 'create', name: 'Garden', repo: 'MossesX/garden', skin: 'atelier', seed: 'demo' }, ctx);
check('create: repo, skin and seed kept', made.project.repo === 'MossesX/garden' && made.project.skin === 'atelier' && made.project.seed === 'demo');
check('registry: the new fields survive a read', (() => { const p = core.normalizeRegistry(core.registryOut(made.reg, ctx.now)).projects.find((x) => x.id === 'garden'); return p.repo === 'MossesX/garden' && p.skin === 'atelier' && p.seed === 'demo'; })());

/* ---------------- end to end (scratch data, hub and stores; the repo's builds copied in, never written) ---------------- */
const tag = `t${process.pid}`;
const A = `${tag}-alpha`; const B = `${tag}-beta`; const C = `${tag}-rpc`; const X = `${tag}-taken`;
const leaks = [A, B, C, X].map((id) => join(ROOT, '_claude', 'builds', 'profiles', id)); // profile trackers are repo files
const tmp = mkdtempSync(join(tmpdir(), 'axf-project-create-'));
const data = join(tmp, 'data'); const hub = join(tmp, 'hub'); const todo = join(tmp, 'todo');
mkdirSync(join(hub, '_shared', '_claude'), { recursive: true });
const env = { ...process.env, AXF_DATA_DIR: data, AXHUB_PROJECTS_DIR: hub, AXF_TODO_DIR: todo, AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0', AXF_ACTOR: 'check-project-create' };
delete env.AXF_BUILD_PROFILE;
const last = (s) => JSON.parse(s.trim().split('\n').pop());
const cli = (...a) => last(execFileSync('node', [join(ROOT, 'framework/cli/projects.mjs'), ...a, '--json'], { env, encoding: 'utf8' }));
const cliFails = (...a) => { try { execFileSync('node', [join(ROOT, 'framework/cli/projects.mjs'), ...a, '--json'], { env, encoding: 'utf8', stdio: 'pipe' }); return ''; } catch (e) { return last(e.stdout).error ?? 'failed'; } };
const rpc = (op, args) => { try { return last(execFileSync('node', [join(ROOT, 'framework/cli/engine-rpc.mjs'), op, JSON.stringify(args)], { env, encoding: 'utf8', stdio: 'pipe' })); } catch (e) { return last(e.stdout); } };
const todoStore = (id) => readJson(join(todo, 'projects', id, 'store.json'));
const notesOf = (id) => { const d = join(hub, '_shared', '_claude', 'project-notes', id, 'Demo data'); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')) : []; };
const plansOf = (id) => { const d = join(data, 'plan-studio', 'projects', id, 'plans'); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')) : []; };
const count = (s, id) => s.projects.find((p) => p.id === id)?.counts;

try {
  const before = cli('state');
  const baseBuilds = count(before, 'amberx-axf')?.builds ?? 0;
  check('e2e: AmberX AXF active at first', before.active === 'amberx-axf');

  // create with seed data, a linked repo and a skin
  const a = cli('new', `Alpha ${tag}`, '--id', A, '--seed', 'demo', '--repo', 'MossesX/alpha', '--skin', 'atelier');
  check('create: made active', a.ok && a.state.active === A);
  check('create: home in the hub', a.home?.dir === join(hub, A) && existsSync(join(hub, A, '_data', 'project.manifest.json')));
  check('create: manifest passes the Standards rules', a.home?.validation?.ok === true && a.home.validation.errors.length === 0, JSON.stringify(a.home?.validation));
  const manifest = readJson(join(hub, A, '_data', 'project.manifest.json'));
  check('create: manifest names the project, repo and skin', manifest?.name === A && manifest.repo.owner === 'MossesX' && manifest.repo.name === 'alpha' && manifest.repo.exists === true && manifest.x.project.skin === 'atelier');
  const v = execFileSync('node', [join(ROOT, 'framework/cli/project.mjs'), 'validate', join(hub, A, '_data'), '--json'], { env, encoding: 'utf8' });
  check('create: project.mjs validate agrees', JSON.parse(v)[0]?.validation?.ok === true);
  for (const f of ['README.md', 'rules/RULES.md', 'instructions/README.md', 'memory/README.md', 'memory/decisions.md', `memory/${A}.md`]) check(`create: _claude/${f}`, existsSync(join(hub, A, '_claude', f)));
  check('create: seed counts reported', a.seed?.counts?.lists === set.lists.length && a.seed.counts.todos === set.todos.length && a.seed.counts.notes === 5 && a.seed.counts.plans === 2 && a.seed.counts.builds === 2, JSON.stringify(a.seed));

  // seeded stores
  const ts = todoStore(A);
  check('seed: todo-store@1 written', ts?.$axf === 'todo-store@1' && ts.lists.length === set.lists.length && ts.entries.length === set.todos.length);
  const depth = (() => { const by = new Map(ts.lists.map((l) => [l.id, l])); const d = (l) => (l.parentId ? 1 + d(by.get(l.parentId)) : 1); return Math.max(...ts.lists.map(d)); })();
  check('seed: lists nest 3+ levels in the store', depth >= 3, String(depth));
  check('seed: entries point at real lists', ts.entries.every((e) => ts.lists.some((l) => l.id === e.listId)));
  check('seed: ids unique and below nextId', new Set([...ts.lists, ...ts.entries].map((x) => x.id)).size === ts.lists.length + ts.entries.length && ts.nextId > Math.max(...ts.entries.map((e) => e.id)));
  check('seed: done entries have completedAt', ts.entries.filter((e) => e.status === 'done').every((e) => e.completedAt));
  check('seed: 5 notes in the project notes folder', notesOf(A).length === 5);
  check('seed: 2 plans in the project plan store', plansOf(A).length === 2);
  check('seed: 2 builds in the project profile', count(a.state, A)?.builds === 2, JSON.stringify(count(a.state, A)));

  // a second project, empty, stays empty; Alpha's data stays Alpha's
  const b = cli('new', `Beta ${tag}`, '--id', B);
  check('create (no seed): active, empty', b.state.active === B && count(b.state, B)?.builds === 0 && !b.seed);
  check('isolation: no to-dos for Beta', todoStore(B) === null);
  check('isolation: no notes for Beta', notesOf(B).length === 0);
  check('isolation: no plans for Beta', plansOf(B).length === 0);
  check('isolation: Alpha keeps its builds', count(b.state, A)?.builds === 2);
  check('isolation: AmberX AXF keeps every build', count(b.state, 'amberx-axf')?.builds === baseBuilds);
  check('isolation: AmberX AXF\'s to-dos untouched', !existsSync(join(todo, 'store.json')));
  check('isolation: AmberX AXF\'s notes untouched', !existsSync(join(hub, '_shared', '_claude', 'notes')));

  // switch
  check('switch: by name', cli('select', `Alpha ${tag}`).state.active === A);
  check('switch: current', cli('current').project.id === A);
  check('switch: back to AmberX AXF', cli('select', 'amberx-axf').state.active === 'amberx-axf');

  // delete keeps the veto: the id must be typed; the data stays; a re-create adopts its home
  check('delete: refused without the id typed', /confirm/.test(cliFails('delete', A)));
  check('delete: main project refused', /main project/.test(cliFails('delete', 'amberx-axf', '--confirm', 'amberx-axf')));
  const d = cli('delete', A, '--confirm', A);
  check('delete: off the list', !d.state.projects.some((p) => p.id === A));
  check('delete: home and data stay on disk', existsSync(join(hub, A, '_data', 'project.manifest.json')) && todoStore(A)?.entries.length === set.todos.length);
  const again = cli('new', `Alpha ${tag}`, '--id', A, '--seed', 'demo', '--no-select');
  check('re-create: adopts its own home', again.ok && again.home?.dir === join(hub, A));
  check('re-create: seed never doubles data', todoStore(A)?.entries.length === set.todos.length && notesOf(A).length === 5 && plansOf(A).length === 2 && count(again.state, A)?.builds === 2, JSON.stringify(again.seed));
  check('re-create: --no-select keeps the active project', again.state.active === 'amberx-axf');

  // refused before anything is written
  mkdirSync(join(hub, X, '_data'), { recursive: true });
  writeFileSync(join(hub, X, '_data', 'project.manifest.json'), JSON.stringify({ name: 'someone-else' }));
  check('conflict: another hub project\'s folder refused', /already has a folder/.test(cliFails('new', `Taken ${tag}`, '--id', X)));
  check('conflict: nothing recorded', !cli('state').projects.some((p) => p.id === X));
  check('skin: unknown skin refused', /no skin/.test(cliFails('new', `Skin ${tag}`, '--skin', 'no-such-skin')));
  check('seed: unknown seed refused', /seed/.test(cliFails('new', `Seed ${tag}`, '--seed', 'lots')));

  // the console MCP's engine ops
  const rc = rpc('project-create', { name: `Rpc ${tag}`, id: C, seed: 'demo' });
  check('rpc create: ok, active, seeded', rc.ok && rc.active === C && rc.seed?.counts?.todos === set.todos.length, rc.error);
  check('rpc create: log lines for the console', Array.isArray(rc.log) && rc.log.some((l) => /created, with demo data/.test(l)));
  check('rpc create: answers a short project list', Array.isArray(rc.projects) && rc.projects.every((p) => !('profile' in p)));
  check('rpc switch', rpc('project-switch', { project: 'amberx-axf' }).active === 'amberx-axf');
  check('rpc delete: needs the id typed', rpc('project-delete', { project: C }).ok === false);
  check('rpc delete', rpc('project-delete', { project: C, confirm: C }).projects.every((p) => p.id !== C));
  check('end: AmberX AXF has every build', count(cli('state'), 'amberx-axf')?.builds === baseBuilds);
} catch (e) {
  fails.push(`end-to-end run failed: ${e.message.split('\n').slice(0, 4).join(' ')}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  for (const l of leaks) rmSync(l, { recursive: true, force: true });
}

console.log(`project create: ${passed} checks passed${fails.length ? `, ${fails.length} failed` : ''}`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
