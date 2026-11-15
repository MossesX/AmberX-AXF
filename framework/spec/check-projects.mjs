#!/usr/bin/env node
/**
 * projects@1: the rules (framework/plan/projects-core.mjs) and the CLI end to end (framework/cli/projects.mjs) on a
 * scratch copy of the data. The build's own test: create a project and it starts empty; switch back to AmberX AXF and
 * everything is there; archive and delete need the id typed; the base project can't go. What a project owns
 * (PROJECTS.md): own copies then diverges, share keeps the folder, a clone carries settings but never builds, notes,
 * to-dos or plans, and a pinned build profile resolves its own project's scopes.
 *
 *   node framework/spec/check-projects.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/* ---------------- what a project owns (rules) ---------------- */
const octx = { ...ctx, accounts: { members: ['alpha', 'beta'], active: 'beta' } };
const r0 = core.applyChange(core.normalizeRegistry(null), { action: 'create', name: 'Owner', id: 'owner', select: false }, octx).reg;
check('own: base refused', throws(() => core.applyChange(r0, { action: 'own', id: 'amberx-axf', scope: 'credentials' }, octx), /main project/));
check('own: unknown scope refused', throws(() => core.applyChange(r0, { action: 'own', id: 'owner', scope: 'everything' }, octx), /unknown scope/));
const o1 = core.applyChange(r0, { action: 'own', id: 'owner', scope: 'credentials' }, octx);
check('own: recorded with a copy from shared', o1.project.owns.includes('credentials') && o1.copy?.from === 'shared' && !!o1.project.ownedAt.credentials);
check('own: twice is a no-op', !core.applyChange(o1.reg, { action: 'own', id: 'owner', scope: 'credentials' }, octx).copy);
const o2 = core.applyChange(o1.reg, { action: 'own', id: 'owner', scope: 'claude-accounts' }, octx);
check('own claude-accounts: starts as every saved login', JSON.stringify(core.accountSet(o2.project)) === JSON.stringify({ members: ['alpha', 'beta'], active: 'beta' }));
check('accounts: not in the set refused', throws(() => core.applyChange(o2.reg, { action: 'accounts', id: 'owner', active: 'gamma' }, octx), /isn't in/));
const o3 = core.applyChange(o2.reg, { action: 'accounts', id: 'owner', remove: ['beta'] }, octx);
check('accounts: removing the active one clears it', JSON.stringify(core.accountSet(o3.project)) === JSON.stringify({ members: ['alpha'], active: '' }));
check('scopeDir: own → projects/<id>, shared → the folder', core.scopeDir('/c', o3.project, 'credentials') === '/c/projects/owner' && core.scopeDir('/c', o3.project, 'plugins') === '/c');
check('scopeDir: base is always the shared folder', core.scopeDir('/c', o3.reg.projects[0], 'credentials') === '/c');
const s1 = core.applyChange(structuredClone(o3.reg), { action: 'share', id: 'owner', scope: 'credentials' }, octx);
check('share: off owns, release returned', !s1.project.owns.includes('credentials') && s1.release?.scope === 'credentials');
const cOwner = { ...octx, activeProfile: 'owner' };
const cl = core.applyChange(o3.reg, { action: 'create', name: 'Clone', id: 'clone' }, cOwner);
check('clone: from the active project by default', cl.project.clonedFrom?.id === 'owner');
check('clone: owned scopes copied from the source', cl.copies.some((x) => x.scope === 'credentials' && x.from === 'owner') && JSON.stringify(core.accountSet(cl.project)) === JSON.stringify({ members: ['alpha'], active: '' }));
check('clone: shared scopes stay shared', !cl.project.owns.includes('plugins') && !cl.copies.some((x) => x.scope === 'plugins'));
check('clone: a new, empty build profile', cl.profile.action === 'create' && cl.profile.id === 'clone');
const part = core.applyChange(o3.reg, { action: 'create', name: 'Part', id: 'part', carry: ['plugins'] }, cOwner);
check('clone: scopes left out start as its own, empty', part.project.owns.includes('credentials') && !part.copies.length && JSON.stringify(core.accountSet(part.project)) === JSON.stringify({ members: [], active: '' }));
const plain = core.applyChange(o3.reg, { action: 'create', name: 'Plain', id: 'plain', from: 'none' }, cOwner);
check('clone: from none = plain, shares everything', plain.project.owns.length === 0 && !plain.project.clonedFrom);
const withLoc = core.applyChange(o3.reg, { action: 'create', name: 'Loc', id: 'loc' }, { ...cOwner, locations: () => ({ repo: { owner: 'o', name: 'n', url: 'u', path: '/p' }, hub: { url: 'h', project: 'hp' } }) });
check('clone: repo and axHub folders carried over', withLoc.project.repo?.path === '/p' && withLoc.project.hub?.project === 'hp');
const changed = core.applyChange(o3.reg, { action: 'create', name: 'Loc2', id: 'loc2', repo: { owner: 'x', name: 'y', url: '', path: '/q' } }, { ...cOwner, locations: () => ({ repo: { owner: 'o', name: 'n', url: 'u', path: '/p' } }) });
check('clone: the repo can be changed', changed.project.repo?.path === '/q');
check('carry: unknown scope refused', throws(() => core.carryList('plugins,nope'), /unknown scope/));

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

  // own / share / clone on scratch console + accounts folders
  const cons = join(data, 'console'); const acc = join(data, 'accounts');
  mkdirSync(cons, { recursive: true }); mkdirSync(join(acc, 'alpha'), { recursive: true }); mkdirSync(join(acc, 'beta'), { recursive: true });
  writeFileSync(join(cons, 'secrets.env'), 'GITHUB_TOKEN=shared\n');
  Object.assign(env, { AXF_CONSOLE_DIR: cons, AXF_CLAUDE_ACCOUNTS_HOME: acc });
  const src = `${id}-src`; const cln = `${id}-cln`;
  cli('new', `Src ${id}`, '--id', src, '--no-select');
  cli('own', src, 'credentials'); cli('own', src, 'claude-accounts'); cli('accounts', src, '--remove', 'beta');
  const own = join(cons, 'projects', src, 'secrets.env');
  check('own: the vault copied, 0600', readFileSync(own, 'utf8').includes('GITHUB_TOKEN=shared') && (statSync(own).mode & 0o777) === 0o600);
  writeFileSync(join(cons, 'secrets.env'), 'GITHUB_TOKEN=changed\n');
  check('own: a change in shared does not reach the own copy', readFileSync(own, 'utf8').includes('GITHUB_TOKEN=shared'));
  check('owns: where points at the own vault', cli('owns', src).where.credentials[0] === own);
  const made2 = cli('select', src) && cli('new', `Cln ${id}`, '--id', cln);
  const c2 = made2.state.projects.find((p) => p.id === cln);
  check('clone: carries the settings', c2.owns.includes('credentials') && c2.owns.includes('claude-accounts') && JSON.stringify(c2.accounts) === JSON.stringify({ members: ['alpha'], active: '' }) && existsSync(join(cons, 'projects', cln, 'secrets.env')));
  check('clone: no builds, notes, to-dos or plans', c2.counts?.builds === 0 && made2.log.some((l) => /builds, notes, to-dos and plans start empty/.test(l)));
  check('clone: repo location carried over', c2.repo?.path === ROOT && c2.hub?.project);
  const pinned = JSON.parse(execFileSync('node', [join(ROOT, 'framework/cli/projects.mjs'), 'owns', '--json'], { env: { ...env, AXF_BUILD_PROFILE: src }, encoding: 'utf8' }).trim().split('\n').pop());
  check('pinned build profile resolves its own project, not the active one', pinned.project === src && pinned.accounts?.members?.join() === 'alpha');
  check('share: the own copy stays', cli('share', src, 'credentials').ok && existsSync(own));
  cli('select', 'amberx-axf');
  for (const x of [cln, src]) { cli('delete', x, '--confirm', x); rmSync(join(ROOT, '_claude', 'builds', 'profiles', x), { recursive: true, force: true }); }
} catch (e) {
  fails.push(`CLI run failed: ${e.message.split('\n').slice(0, 3).join(' ')}`);
} finally {
  rmSync(data, { recursive: true, force: true });
  rmSync(leak, { recursive: true, force: true });
}

console.log(`projects: ${passed} checks passed${fails.length ? `, ${fails.length} failed` : ''}`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
