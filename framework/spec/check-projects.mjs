#!/usr/bin/env node
/**
 * projects@1: the rules (framework/plan/projects-core.mjs) and the CLI end to end (framework/cli/projects.mjs) on a
 * scratch copy of the data. The build's own test: create a project and it starts empty; switch back to AmberX AXF and
 * everything is there; archive and delete need the id typed; the base project can't go.
 *
 *   node framework/spec/check-projects.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/projects-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let passed = 0;
const fails = [];
const check = (name, cond, detail = '') => { if (cond) passed++; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

/* ---------------- rules ---------------- */
const empty = core.normalizeRegistry(null);
check('base project always there', empty.projects.length === 1 && empty.projects[0].id === 'amberx-axf' && empty.projects[0].base && empty.projects[0].profile === 'all');
check('base project named AmberX AXF', empty.projects[0].name === 'AmberX AXF');
const ctx = { now: '2026-11-12T00:00:00.000Z', by: 'test', activeProfile: 'all', profileIds: ['all'] };
const made = core.applyChange(core.normalizeRegistry(null), { action: 'create', name: 'Garden Planner' }, ctx);
check('create: id from the name', made.project.id === 'garden-planner');
check('create: own profile, selected by default', made.profile?.action === 'create' && made.profile.id === 'garden-planner' && made.profile.select === true);
check('create: duplicate name refused', throws(() => core.applyChange(made.reg, { action: 'create', name: 'garden planner', id: 'other' }, ctx), /already exists/));
check('create: id taken by a build profile refused', throws(() => core.applyChange(core.normalizeRegistry(null), { action: 'create', name: 'X', id: 'all' }, ctx), /already exists|taken/));
check('select: by name', core.applyChange(made.reg, { action: 'select', id: 'Garden Planner' }, ctx).profile.id === 'garden-planner');
check('archive: needs the id typed', throws(() => core.applyChange(made.reg, { action: 'archive', id: 'garden-planner' }, ctx), /confirm/));
check('delete: needs the id typed', throws(() => core.applyChange(made.reg, { action: 'delete', id: 'garden-planner', confirm: 'nope' }, ctx), /confirm/));
check('base: never archived', throws(() => core.applyChange(made.reg, { action: 'archive', id: 'amberx-axf', confirm: 'amberx-axf' }, ctx), /main project/));
check('base: never deleted', throws(() => core.applyChange(made.reg, { action: 'delete', id: 'amberx-axf', confirm: 'amberx-axf' }, ctx), /main project/));
const archived = core.applyChange(made.reg, { action: 'archive', id: 'garden-planner', confirm: 'garden-planner' }, { ...ctx, activeProfile: 'garden-planner' });
check('archive the active project: back to AmberX AXF', archived.profile?.action === 'select' && archived.profile.id === 'all');
check('archived can\'t be selected', throws(() => core.applyChange(archived.reg, { action: 'select', id: 'garden-planner' }, ctx), /archived/));
check('projectDir: base keeps the folder', core.projectDir('/d/todo', empty.projects[0]) === '/d/todo');
check('projectDir: others get projects/<id>', core.projectDir('/d/todo/', made.project) === '/d/todo/projects/garden-planner');
check('projectOfProfile: unknown → base', core.projectOfProfile(made.reg, 'nope').base === true);

/* ---------------- CLI end to end (scratch data; the repo's builds copied in, never written) ---------------- */
const id = `t-proj-${process.pid}`;
const leak = join(ROOT, '_claude', 'builds', 'profiles', id); // profile trackers are repo files: removed after the run
const data = mkdtempSync(join(tmpdir(), 'axf-projects-'));
const env = { ...process.env, AXF_DATA_DIR: data, AXF_BUILDS_LIVE: '0', AXF_ACTOR: 'check-projects', AXHUB_PROJECTS_DIR: join(data, 'no-hub') };
delete env.AXF_BUILD_PROFILE;
const cli = (...a) => JSON.parse(execFileSync('node', [join(ROOT, 'framework/cli/projects.mjs'), ...a, '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop());
const orchList = () => JSON.parse(execFileSync('node', [join(ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs'), 'list', '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop()); // axf-plugin:build-orchestrator
try {
  const before = cli('state');
  const base = before.projects.find((p) => p.base);
  check('state: AmberX AXF active at first', before.active === 'amberx-axf');
  check('state: AmberX AXF holds the existing builds', (base.counts?.builds ?? 0) > 0, JSON.stringify(base.counts));
  const created = cli('new', `Check ${id}`, '--id', id);
  check('new: created and active', created.ok && created.state.active === id);
  const fresh = created.state.projects.find((p) => p.id === id);
  check('new: starts with no builds', fresh.counts?.builds === 0, JSON.stringify(fresh.counts));
  check('new: the orchestrator shows no builds', existsSync(join(ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs')) ? orchList().state.builds.length === 0 : true); // axf-plugin:build-orchestrator
  check('current: the new project', cli('current').project.id === id);
  const back = cli('select', 'amberx-axf');
  check('switch back: AmberX AXF active', back.state.active === 'amberx-axf');
  check('switch back: every build is there', back.state.projects.find((p) => p.base).counts.builds === base.counts.builds);
  let refused = false; try { cli('archive', id); } catch { refused = true; }
  check('archive without confirm refused', refused);
  check('archive with confirm', cli('archive', id, '--confirm', id).state.projects.find((p) => p.id === id).status === 'archived');
  check('unarchive', cli('unarchive', id).state.projects.find((p) => p.id === id).status === 'active');
  check('delete with confirm: off the list', !cli('delete', id, '--confirm', id).state.projects.some((p) => p.id === id));
  check('base untouched after all that', cli('state').projects.find((p) => p.base).counts.builds === base.counts.builds);
} catch (e) {
  fails.push(`CLI run failed: ${e.message.split('\n').slice(0, 3).join(' ')}`);
} finally {
  rmSync(data, { recursive: true, force: true });
  rmSync(leak, { recursive: true, force: true });
}

console.log(`projects: ${passed} checks passed${fails.length ? `, ${fails.length} failed` : ''}`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
