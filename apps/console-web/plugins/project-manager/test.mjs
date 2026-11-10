#!/usr/bin/env node
/** Self-test of the Project Manager (core.mjs + the CLI the console routes run), on a scratch data folder and repo root. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'pm-test-'));
process.env.AXF_PROJECT_MANAGER_DATA = join(tmp, 'data');
process.env.AXF_ROOT = join(tmp, 'repo');
const core = await import('./core.mjs');
const HERE = new URL('.', import.meta.url).pathname;
const cli = (...a) => JSON.parse(execFileSync('node', [join(HERE, 'projects.mjs'), ...a, '--json'], { env: process.env, encoding: 'utf8' }).trim().split('\n').pop());
const cliIn = (op, input) => {
  let out;
  try { out = execFileSync('node', [join(HERE, 'projects.mjs'), 'json', op, '--json'], { env: process.env, input: JSON.stringify(input), encoding: 'utf8' }); } catch (e) { out = e.stdout; }
  return JSON.parse(out.trim().split('\n').pop());
};
let n = 0;
const t = (name, f) => { f(); n += 1; console.log(`ok ${n} ${name}`); };

try {
  t('the Dev Console is always a project (framework, built in)', () => {
    const v = core.view();
    assert.equal(v.projects[0].id, 'console');
    assert.equal(v.projects[0].type, 'framework');
    assert.equal(v.settings.multiView, false);
    assert.throws(() => core.remove('console'), /built in/);
  });
  t('create an app project: own data folders, a manifest, its console link', () => {
    const r = core.create({ name: 'Recipe Box', type: 'app', previewUrl: 'http://localhost:5199' });
    assert.equal(r.project.id, 'recipe-box');
    assert.equal(r.project.root, 'apps/recipe-box');
    assert.equal(r.project.consoleUrl, '/?project=recipe-box');
    assert.ok(r.scaffolded);
    const m = JSON.parse(readFileSync(join(process.env.AXF_ROOT, 'apps/recipe-box/project.manifest.json'), 'utf8'));
    assert.equal(m.kind, 'app');
    for (const k of ['builds', 'notes', 'data']) assert.ok(existsSync(join(core.projectDir('recipe-box'), k)));
    assert.throws(() => core.create({ name: 'Recipe Box' }), /already exists/);
    assert.throws(() => core.create({ name: 'x', type: 'game' }), /Type is one of/);
    assert.throws(() => core.create({ name: 'y', root: '../etc' }), /inside the repo/);
    assert.throws(() => core.create({ name: 'z', previewUrl: 'javascript:alert(1)' }), /preview URL/);
  });
  t('create a framework project through the CLI', () => {
    const r = cli('create', 'Theme', 'tools', '--type', 'framework', '--no-scaffold');
    assert.equal(r.project.type, 'framework');
    assert.equal(r.project.root, '.');
  });
  t('rename, switch, close', () => {
    assert.equal(cli('rename', 'recipe-box', 'Recipe', 'Book').project.name, 'Recipe Book');
    assert.equal(cliIn('open', { id: 'recipe-box' }).active, 'recipe-box');
    assert.equal(core.view().projects.find((p) => p.id === 'recipe-box').active, true);
    const c = core.close('recipe-box');
    assert.ok(!c.settings.open.includes('recipe-box'));
    assert.equal(c.settings.active, 'console');
  });
  t('multi-project view setting and layout', () => {
    assert.equal(cli('multi', 'on', '--layout', 'split').settings.multiView, true);
    assert.equal(core.load().settings.layout, 'split');
    assert.throws(() => core.setSettings({ layout: 'grid' }), /Layout/);
    assert.equal(cliIn('settings', { multiView: false }).settings.multiView, false);
  });
  t('live preview: float, dock, the active project by default', () => {
    core.open('recipe-box');
    const p = cli('preview', 'on', '--mode', 'dock', '--side', 'bottom');
    assert.deepEqual([p.preview.open, p.preview.mode, p.preview.side, p.project, p.url], [true, 'dock', 'bottom', 'recipe-box', 'http://localhost:5199']);
    const q = core.preview({ mode: 'float', project: 'console' });
    assert.equal(q.url, '/');
    assert.throws(() => core.preview({ mode: 'tab' }), /Mode/);
    assert.equal(core.preview({ open: false }).preview.open, false);
  });
  t('the Dev Console project keeps a preview URL', () => {
    core.update('console', { previewUrl: '/demo' });
    assert.equal(core.get('console').project.previewUrl, '/demo');
    assert.throws(() => core.update('console', { name: 'x' }), /built in/);
  });
  t('remove (with its data) leaves the app folder', () => {
    core.preview({ project: 'recipe-box' });
    const r = cliIn('delete', { id: 'recipe-box', data: true });
    assert.equal(r.dataRemoved, true);
    assert.ok(!existsSync(core.projectDir('recipe-box')));
    assert.ok(existsSync(join(process.env.AXF_ROOT, 'apps/recipe-box/project.manifest.json')));
    assert.equal(core.load().settings.preview.project, '');
    assert.equal(core.load().settings.active, 'console');
  });
  t('unknown project and bad input fail plainly', () => {
    const r = cliIn('open', { id: 'nope' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not_found');
  });
  console.log(`project-manager: ${n} passed`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
