#!/usr/bin/env node
// main-gate@1 self-test (build main-gate-nothing-reaches-main-without-passing): the rules, then the real pre-push hook
// on a real git repo with a fake GitHub (local HTTP, no network, no model). A failing build never reaches main.
// Run: node framework/spec/check-main-gate.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, ciVerdict, decide, install, overrideActive, readLog, rulesetBody, setOverride, state, statusOnly, uninstall } from '../cli/main-gate.mjs';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };
const run = (name, conclusion, status = 'completed') => ({ name, status, conclusion: status === 'completed' ? conclusion : null });

// ------------------------------------------------------------------ rules

await t('status only: every file under _claude/', () => {
  assert.equal(statusOnly(['_claude/builds/store.json', '_claude/THREADS.md']), true);
  assert.equal(statusOnly(['_claude/x', 'apps/a.ts']), false);
  assert.equal(statusOnly([]), true);
});

await t('CI verdict: none, running, failed, skipped-only, light-only, passed', () => {
  assert.equal(ciVerdict([]).state, 'none');
  assert.equal(ciVerdict([run('a', null, 'in_progress')]).state, 'running');
  assert.match(ciVerdict([run('Build engine sweep (Node)', 'failure'), run('b', 'success')]).why, /CI failed: Build engine sweep \(Node\) \(failure\)/);
  assert.equal(ciVerdict([run('a', 'cancelled')]).state, 'failed');
  assert.equal(ciVerdict([run('a', 'skipped')]).state, 'none');
  assert.equal(ciVerdict([run('Light PR checks (full run happens once, in the merge queue)', 'success'), run('Build engine sweep (Node)', 'skipped')]).state, 'light');
  assert.equal(ciVerdict([run('CI scope (what changed)', 'success'), run('Build engine sweep (Node)', 'success'), run('Gradle', 'skipped')]).ok, true);
});

await t('decide: delete, force-push, status, passed, failed, override', () => {
  const green = ciVerdict([run('x', 'success')]); const red = ciVerdict([run('x', 'failure')]);
  const now = Date.parse('2026-11-12T10:00:00Z');
  const ov = { on: true, until: '2026-11-12T10:30:00Z', by: 'Brett' };
  assert.equal(decide({ deleting: true, override: ov }, now).allow, false, 'not even the override deletes main');
  assert.equal(decide({ fastForward: false, override: ov }, now).allow, false, 'not even the override force-pushes');
  assert.equal(decide({ fastForward: true, statusOnly: true }, now).via, 'status');
  assert.equal(decide({ fastForward: true, ci: green, local: [{ id: 'theme', ok: true, why: 'passed' }] }, now).via, 'passed');
  assert.equal(decide({ fastForward: true, ci: green, local: [{ id: 'controls', ok: false, why: 'raw <button>' }] }, now).allow, false);
  assert.equal(decide({ fastForward: true, ci: red, local: [] }, now).allow, false);
  assert.equal(decide({ fastForward: true, ci: red, local: [], override: ov }, now).via, 'override');
  assert.equal(decide({ fastForward: true, ci: red, local: [], override: { ...ov, until: '2026-11-12T09:59:00Z' } }, now).allow, false, 'an expired override is off');
  assert.equal(overrideActive(null), false, 'off by default');
});

await t('override: owner only, 1 to 120 minutes, a reason, off by anyone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mg-ov-'));
  assert.equal(state(dir).override.on, false, 'off by default');
  assert.equal(setOverride(dir, { on: true, minutes: 30, reason: 'x' }).code, 'owner-only');
  assert.equal(setOverride(dir, { on: true, minutes: 500, reason: 'x', owner: { name: 'Brett' } }).code, 'invalid');
  assert.equal(setOverride(dir, { on: true, minutes: 30, reason: '', owner: { name: 'Brett' } }).code, 'invalid');
  assert.equal(setOverride(dir, { on: true, minutes: 30, reason: 'hotfix', owner: { name: 'Brett' } }).ok, true);
  assert.equal(state(dir).override.on, true);
  assert.equal(setOverride(dir, { on: false, by: 'session' }).ok, true);
  assert.equal(state(dir).override.on, false);
  assert.deepEqual(readLog(dir).map((r) => r.via), ['override-on', 'override-off']);
});

await t('GitHub ruleset: no delete, no force-push, a PR, required checks up to date', () => {
  const b = rulesetBody(['CI scope (what changed)']);
  assert.deepEqual(b.rules.map((r) => r.type), ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']);
  assert.equal(b.rules[3].parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(b.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
});

// ------------------------------------------------------------------ the real hook: real git, fake GitHub

const ci = {}; // sha → runs
const remote = { compare: {}, back: {}, contents: false }; // GitHub-only repo (no clone here): main...sha, sha...main
const server = createServer((req, res) => {
  const send = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  const m = req.url.match(/\/commits\/([0-9a-f]{40})\/check-runs/);
  if (m) return send(200, { check_runs: ci[m[1]] || [] });
  const c = req.url.match(/\/commits\/([0-9a-f]{40})$/);
  if (c) return send(200, { sha: c[1] });
  const cm = req.url.match(/\/compare\/main\.\.\.([0-9a-f]{40})$/);
  if (cm) return remote.compare[cm[1]] ? send(200, remote.compare[cm[1]]) : send(404, { message: 'Not Found' });
  const cb = req.url.match(/\/compare\/([0-9a-f]{40})\.\.\.main$/);
  if (cb) return send(200, remote.back[cb[1]] || { files: [] });
  if (/\/contents\//.test(req.url)) return remote.contents ? send(200, {}) : send(404, { message: 'Not Found' });
  return send(200, {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}`;

const root = mkdtempSync(join(tmpdir(), 'mg-e2e-'));
const origin = join(root, 'origin.git'); const repo = join(root, 'repo'); const dir = join(root, 'gate');
const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
sh(root, 'clone', '-q', origin, repo);
const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const commit = (file, text, msg) => { mkdirSync(join(repo, file, '..'), { recursive: true }); writeFileSync(join(repo, file), text); sh(repo, 'add', file); sh(repo, ...cfg, 'commit', '-q', '-m', msg); return sh(repo, 'rev-parse', 'HEAD'); };
commit('a.txt', 'base\n', 'base');
sh(repo, 'push', '-q', 'origin', 'HEAD:main'); // before the hook

const env = { ...process.env, AXF_MAIN_GATE_API: api, AXF_MAIN_GATE_SLUG: 'o/r', AXF_MAIN_GATE_TOKEN: 'test', AXF_MAIN_GATE_CONSOLE: 'off', AXF_MAIN_GATE_DIR: dir };
/** git push, async so the fake GitHub in this process can answer the hook. */
const push = (...a) => new Promise((resolve) => {
  const p = spawn('git', ['push', ...a], { cwd: repo, env }); let err = '';
  p.stderr.on('data', (d) => { err += d; }); p.on('close', (code) => resolve({ code, err }));
});
const main = () => sh(origin, 'rev-parse', 'main');

await t('install: the pre-push hook goes into the shared hooks folder, fail closed', () => {
  const r = install(dir, repo);
  assert.equal(r.ok, true);
  assert.ok(existsSync(join(repo, '.git/hooks/pre-push')));
  assert.match(readFileSync(join(repo, '.git/hooks/pre-push'), 'utf8'), /nothing is pushed to main/);
  assert.deepEqual(state(dir).hooks, [join(repo, '.git')]);
});

await t('a build whose CI failed can not be pushed to main; the refusal is logged', async () => {
  const before = main();
  const sha = commit('app.ts', 'broken\n', 'a failing build');
  ci[sha] = [run('CI scope (what changed)', 'success'), run('Build engine sweep (Node)', 'failure')];
  const r = await push('origin', 'HEAD:main');
  assert.notEqual(r.code, 0); assert.match(r.err, /main gate: refused .*CI failed: Build engine sweep/);
  assert.equal(main(), before, 'main did not move');
  assert.equal(readLog(dir, { refusals: true }).at(-1).sha, sha);
});

await t('nor one CI never ran on, nor one that only ran the light PR checks', async () => {
  const before = main();
  assert.notEqual((await push('origin', 'HEAD:main')).code, 0, 'no CI on the new head');
  const sha = commit('app.ts', 'still light\n', 'light only');
  ci[sha] = [run('Light PR checks (full run happens once, in the merge queue)', 'success')];
  const r = await push('origin', 'HEAD:main');
  assert.notEqual(r.code, 0); assert.match(r.err, /only the light PR checks/);
  assert.equal(main(), before);
});

await t('other branches are never held', async () => {
  assert.equal((await push('origin', 'HEAD:refs/heads/feature')).code, 0);
});

await t('the owner override lets a failing build through, logged; off again, refused again', async () => {
  const before = main();
  setOverride(dir, { on: true, minutes: 10, reason: 'test', owner: { name: 'Brett' } });
  const r = await push('origin', 'HEAD:main');
  assert.equal(r.code, 0, r.err);
  assert.notEqual(main(), before);
  assert.equal(readLog(dir).at(-1).via, 'override');
  setOverride(dir, { on: false, by: 'test' });
  const sha = commit('app.ts', 'broken again\n', 'red again'); ci[sha] = [run('x', 'failure')];
  assert.notEqual((await push('origin', 'HEAD:main')).code, 0);
});

await t('a green full run passes; status-only commits pass without CI', async () => {
  const sha = commit('app.ts', 'fixed\n', 'green'); ci[sha] = [run('CI scope (what changed)', 'success'), run('Build engine sweep (Node)', 'success')];
  assert.equal((await push('origin', 'HEAD:main')).code, 0);
  assert.equal(main(), sha);
  const st = commit('_claude/builds/store.json', '{}\n', 'Builds live [skip ci]');
  assert.equal((await push('origin', 'HEAD:main')).code, 0);
  assert.equal(main(), st);
});

await t('force-push and delete are refused, override or not', async () => {
  setOverride(dir, { on: true, minutes: 5, reason: 'test', owner: { name: 'Brett' } });
  const old = sh(repo, 'rev-parse', 'HEAD~2');
  const before = main();
  assert.notEqual((await push('--force', 'origin', `${old}:refs/heads/main`)).code, 0);
  assert.notEqual((await push('origin', '--delete', 'main')).code, 0);
  assert.equal(main(), before);
  setOverride(dir, { on: false, by: 'test' });
});

await t('a PR merged on GitHub with no clone here: judged from GitHub alone', async () => {
  const o = { repo, slug: 'o/hub', api, token: 'test', dir, console: 'off', github: true, merge: true, source: 'console merge' };
  const red = 'a'.repeat(40); const green = 'b'.repeat(40); const behind = 'c'.repeat(40); const status = 'd'.repeat(40);
  remote.compare[red] = { status: 'ahead', base_commit: { sha: 'f'.repeat(40) }, files: [{ filename: 'src/app.ts' }] };
  ci[red] = [run('build', 'failure')];
  let r = await check(o, red);
  assert.equal(r.allow, false); assert.match(r.why, /CI failed: build/);
  assert.equal(readLog(dir, { refusals: true }).at(-1).sha, red);
  remote.compare[green] = { ...remote.compare[red] }; ci[green] = [run('build', 'success')];
  assert.equal((await check(o, green)).allow, true);
  remote.contents = true; // a repo that carries check-theme / check-controls can't be judged without its tree
  r = await check(o, green); assert.equal(r.allow, false); assert.match(r.why, /merge queue/);
  remote.contents = false;
  remote.compare[behind] = { status: 'diverged', base_commit: { sha: 'f'.repeat(40) }, merge_base_commit: { sha: 'e'.repeat(40) }, files: [{ filename: 'src/app.ts' }] };
  ci[behind] = [run('build', 'success')];
  remote.back[behind] = { files: [{ filename: 'src/other.ts' }] };
  r = await check(o, behind); assert.equal(r.allow, false); assert.match(r.why, /fast-forward/);
  remote.back[behind] = { files: [{ filename: '_claude/builds/store.json' }] };
  assert.equal((await check(o, behind)).allow, true, 'main ahead in status only: GitHub may merge it');
  remote.compare[status] = { status: 'ahead', base_commit: { sha: 'f'.repeat(40) }, files: [{ filename: '_claude/builds/store.json' }] };
  assert.equal((await check(o, status)).via, 'status');
  r = await check(o, '9'.repeat(40)); assert.equal(r.allow, false); assert.match(r.why, /couldn't compare/);
});

await t('uninstall removes only its own hook', () => {
  uninstall(dir, repo);
  assert.ok(!existsSync(join(repo, '.git/hooks/pre-push')));
});

server.close();
console.log(`main gate: ${n} checks passed`);
