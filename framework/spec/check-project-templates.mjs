#!/usr/bin/env node
/**
 * Project templates (project-template@1, project-boilerplates@1): the rules (framework/plan/project-templates-core.mjs)
 * and the CLI end to end (framework/cli/project-templates.mjs, projects.mjs duplicate) on scratch data.
 *
 *   - duplicate isolation: a copy gets the source's lists (structure only by default), build rules and setup; it gets
 *     none of its builds; changing either afterwards never shows in the other; the source is untouched
 *   - carry options: items all / none, builds history on request (read-only, the store's builds unchanged)
 *   - boilerplate round trip: save → list → new project from it (same as a copy) → rename → update → delete (id typed)
 *
 *   node framework/spec/check-project-templates.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/project-templates-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let passed = 0;
const fails = [];
const check = (name, cond, detail = '') => { if (cond) passed++; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

/* ---------------- rules ---------------- */
check('carry: defaults are structure only, no builds', JSON.stringify(core.normaliseCarry(undefined)) === JSON.stringify({ items: 'structure', builds: false }));
check('carry: unknown items fall back', core.normaliseCarry({ items: 'some', builds: 'yes' }).items === 'structure' && core.normaliseCarry({ builds: 'yes' }).builds === false);
check('copyName: "<name> copy", then numbered', core.copyName('Garden', ['Garden']) === 'Garden copy' && core.copyName('Garden', ['garden copy']) === 'Garden copy 2');
check('freeId: slug, then numbered', core.freeId('Garden Copy', []) === 'garden-copy' && core.freeId('Garden Copy', ['garden-copy']) === 'garden-copy-2');
const t0 = core.normaliseTemplate({ source: { id: 'g', name: 'G' }, plugins: { 'todo-manager': { label: 'Lists', data: { lists: [] } }, '../evil': { data: 1 } }, history: [{ id: 'b1', title: 'x', secret: 'no' }] });
check('template: bad plugin keys dropped', Object.keys(t0.plugins).join() === 'todo-manager');
check('template: history keeps only what a build was', t0.history[0].id === 'b1' && !('secret' in t0.history[0]));
const ctx = { now: '2026-11-13T00:00:00.000Z', by: 'test' };
const reg0 = core.normaliseBoilerplates(null);
const saved = core.applyBoilerplateChange(reg0, { action: 'save', name: 'Client site', template: t0 }, ctx);
check('boilerplate save: id from the name, owner recorded', saved.boilerplate.id === 'client-site' && saved.boilerplate.owner === 'test' && saved.boilerplate.from.id === 'g');
check('boilerplate save: same name refused', throws(() => core.applyBoilerplateChange(saved.reg, { action: 'save', name: 'client SITE', template: t0 }, ctx), /already exists/));
check('boilerplate save: needs a name', throws(() => core.applyBoilerplateChange(reg0, { action: 'save', template: t0 }, ctx), /needs a name/));
check('boilerplate save: too big refused', throws(() => core.applyBoilerplateChange(reg0, { action: 'save', name: 'Big', template: { plugins: { x1: { data: 'x'.repeat(core.LIMITS.templateBytes + 1) } } } }, ctx), /too big/));
check('boilerplate rename: by name', core.applyBoilerplateChange(saved.reg, { action: 'rename', id: 'Client site', name: 'Site' }, ctx).boilerplate.name === 'Site');
check('boilerplate delete: needs the id typed', throws(() => core.applyBoilerplateChange(saved.reg, { action: 'delete', id: 'client-site' }, ctx), /confirm/));
check('boilerplate delete: with the id', core.applyBoilerplateChange(saved.reg, { action: 'delete', id: 'client-site', confirm: 'client-site' }, ctx).reg.boilerplates.length === 0);
check('boilerplates: damaged entries dropped', core.normaliseBoilerplates({ boilerplates: [{ id: 'Bad Id' }, { id: 'ok' }, { id: 'ok' }] }).boilerplates.length === 1);

/* ---------------- end to end (scratch data; the repo's builds copied in, never written) ---------------- */
const data = mkdtempSync(join(tmpdir(), 'axf-templates-'));
const hub = join(data, 'hub');
const todo = join(data, 'todo');
const plans = join(data, 'plans');
const env = {
  ...process.env, AXF_DATA_DIR: data, AXF_BUILDS_LIVE: '0', AXF_ACTOR: 'check-project-templates', AXHUB_PROJECTS_DIR: hub,
  AXF_TODO_DIR: todo, AXF_PLANS_DIR: plans, AXF_WIZARD_STORE: join(data, 'wizard.json'), AXF_PROJECT_BOILERPLATES_FILE: join(data, 'boilerplates.json'),
};
delete env.AXF_BUILD_PROFILE;
const PROFILES = join(ROOT, '_claude', 'builds', 'profiles'); // profile trackers are repo files: the ones made here are removed after
const profilesBefore = new Set(existsSync(PROFILES) ? readdirSync(PROFILES) : []);
const run = (file, ...a) => {
  let out;
  try { out = execFileSync('node', [join(ROOT, 'framework/cli', file), ...a, '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = e.stdout ?? ''; }
  const j = JSON.parse(String(out).trim().split('\n').pop() || '{"ok":false,"error":"no output"}');
  if (!j.ok) throw new Error(`${file} ${a.join(' ')}: ${j.error}`);
  return j;
};
const projects = (...a) => run('projects.mjs', ...a);
const templates = (...a) => run('project-templates.mjs', ...a);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const todoOf = (id) => join(todo, 'projects', id, 'store.json');
const storeFile = join(data, '_claude/builds/store.json');
const p = `t-src-${process.pid}`;
try {
  // a source project with lists and entries, a notes folder with a note, plan categories and a plan, its own build rules
  const src = projects('new', `Source ${p}`, '--id', p, '--no-select');
  check('setup: source project made', src.project?.id === p);
  writeJson(todoOf(p), { lists: [{ id: 1, parentId: null, title: 'Inbox' }, { id: 2, parentId: 1, title: 'Later' }], entries: [{ id: 3, listId: 1, kind: 'todo', title: 'Water' }], nextId: 4 });
  mkdirSync(join(hub, '_shared/_claude/project-notes', p, 'ideas'), { recursive: true });
  writeFileSync(join(hub, '_shared/_claude/project-notes', p, 'ideas/one.md'), '# One\n');
  writeJson(join(plans, 'projects', p, 'categories.json'), { $axf: 'plan-categories@1', tree: ['Garden'] });
  writeJson(join(plans, 'projects', p, 'plans/beds.json'), { $axf: 'plan@1', id: 'beds', title: 'Beds' });
  const store = readJson(storeFile);
  store.rules[p] = { sameSession: true, maxStepMinutes: 17 };
  writeFileSync(storeFile, JSON.stringify(store));
  const buildsBefore = readJson(storeFile).builds.length;
  const srcStoreBefore = readFileSync(todoOf(p), 'utf8');

  // duplicate (defaults): structure only, no builds history
  const d = projects('duplicate', p, '--id', `${p}-c`, '--no-select');
  const c = `${p}-c`;
  check('duplicate: named "<name> copy"', d.project?.name === `Source ${p} copy`, d.project?.name);
  check('duplicate: the source stays active', d.state.active === 'amberx-axf');
  const ct = readJson(todoOf(c));
  check('duplicate: list structure copied', ct.lists.map((l) => l.title).join() === 'Inbox,Later');
  check('duplicate: no items by default', ct.entries.length === 0);
  check('duplicate: notes folders, no notes', existsSync(join(hub, '_shared/_claude/project-notes', c, 'ideas')) && !existsSync(join(hub, '_shared/_claude/project-notes', c, 'ideas/one.md')));
  check('duplicate: plan categories, no plans', existsSync(join(plans, 'projects', c, 'categories.json')) && !existsSync(join(plans, 'projects', c, 'plans/beds.json')));
  check('duplicate: build rules copied', readJson(storeFile).rules[c]?.maxStepMinutes === 17);
  check('duplicate: wizard setup kept for the copy', !!readJson(join(data, 'wizard.json')).copies?.[c]?.setup);
  check('duplicate: no builds of its own', d.state.projects.find((x) => x.id === c)?.counts?.builds === 0);
  check('duplicate: no builds history by default', !existsSync(join(data, 'framework/plan/profiles', c, 'framework/plan/builds-history.json')));

  // isolation: change the copy, then the source; neither shows in the other
  writeJson(todoOf(c), { ...ct, lists: [...ct.lists, { id: 9, parentId: null, title: 'Copy only' }] });
  check('isolation: the source is untouched by the copy', readFileSync(todoOf(p), 'utf8') === srcStoreBefore);
  writeJson(todoOf(p), { ...readJson(todoOf(p)), lists: [...readJson(todoOf(p)).lists, { id: 8, parentId: null, title: 'Source only' }] });
  check('isolation: the copy is untouched by the source', !readJson(todoOf(c)).lists.some((l) => l.title === 'Source only'));
  check('isolation: no build moved or added', readJson(storeFile).builds.length === buildsBefore);
  writeJson(todoOf(p), JSON.parse(srcStoreBefore));

  // carry: everything, and the builds history
  const all = projects('duplicate', p, '--id', `${p}-a`, '--name', `All ${p}`, '--items', 'all', '--builds', '--no-select');
  const a = `${p}-a`;
  check('items all: entries copied', readJson(todoOf(a)).entries.length === 1);
  check('items all: notes copied', readFileSync(join(hub, '_shared/_claude/project-notes', a, 'ideas/one.md'), 'utf8') === '# One\n');
  check('items all: plans copied', existsSync(join(plans, 'projects', a, 'plans/beds.json')));
  const hist = join(data, 'framework/plan/profiles', a, 'framework/plan/builds-history.json');
  check('builds: history written, read-only list', existsSync(hist) && readJson(hist).$axf === 'builds-history@1' && Array.isArray(readJson(hist).builds));
  check('builds: the store\'s builds unchanged', readJson(storeFile).builds.length === buildsBefore && all.state.projects.find((x) => x.id === a)?.counts?.builds === 0);
  const none = projects('duplicate', p, '--id', `${p}-n`, '--name', `None ${p}`, '--items', 'none', '--no-select');
  check('items none: no lists', readJson(todoOf(none.project.id)).lists.length === 0);
  check('duplicate: an existing name is refused', (() => { try { projects('duplicate', p, '--name', `All ${p}`, '--no-select'); return false; } catch (e) { return /already exists/.test(e.message); } })());

  // boilerplate round trip
  const bp = templates('boilerplate', 'save', p, '--name', `Kit ${p}`, '--description', 'Starter lists');
  const bid = bp.boilerplate.id;
  check('boilerplate: saved with its owner', bp.boilerplate.owner === 'check-project-templates' && bp.boilerplate.from.id === p);
  check('boilerplate: listed', templates('boilerplates').boilerplates.some((b) => b.id === bid));
  check('boilerplate: shared file, not project data', existsSync(join(data, 'boilerplates.json')));
  const used = projects('new', `From kit ${p}`, '--id', `${p}-k`, '--boilerplate', bid, '--no-select');
  const k = used.project.id;
  check('boilerplate use: same lists as a copy', JSON.stringify(readJson(todoOf(k)).lists) === JSON.stringify(readJson(todoOf(c)).lists.filter((l) => l.title !== 'Copy only')));
  check('boilerplate use: build rules too', readJson(storeFile).rules[k]?.maxStepMinutes === 17);
  writeJson(todoOf(p), { ...readJson(todoOf(p)), lists: [...readJson(todoOf(p)).lists, { id: 7, parentId: null, title: 'Added later' }] });
  check('boilerplate: a snapshot (later changes to the project stay out)', !templates('boilerplate', 'show', bid).boilerplate.template.plugins['todo-manager'].data.lists.some((l) => l.title === 'Added later'));
  templates('boilerplate', 'update', bid);
  check('boilerplate update: takes the project again', templates('boilerplate', 'show', bid).boilerplate.template.plugins['todo-manager'].data.lists.some((l) => l.title === 'Added later'));
  check('boilerplate rename', templates('boilerplate', 'rename', bid, '--name', `Renamed ${p}`).boilerplate.name === `Renamed ${p}`);
  check('boilerplate delete: refused without the id', (() => { try { templates('boilerplate', 'delete', bid); return false; } catch (e) { return /confirm/.test(e.message); } })());
  templates('boilerplate', 'delete', bid, '--confirm', bid);
  check('boilerplate delete: gone; projects made from it keep everything', !templates('boilerplates').boilerplates.some((b) => b.id === bid) && readJson(todoOf(k)).lists.length === 2);
} catch (e) {
  fails.push(`CLI run failed: ${e.message.split('\n').slice(0, 3).join(' ')}`);
} finally {
  rmSync(data, { recursive: true, force: true });
  for (const d of existsSync(PROFILES) ? readdirSync(PROFILES) : []) if (!profilesBefore.has(d)) rmSync(join(PROFILES, d), { recursive: true, force: true });
}

console.log(`project templates: ${passed} checks passed${fails.length ? `, ${fails.length} failed` : ''}`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
