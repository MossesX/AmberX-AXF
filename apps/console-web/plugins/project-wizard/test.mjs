#!/usr/bin/env node
// Self-test for the project wizard (CI: node apps/console-web/plugins/project-wizard/test.mjs).
// A fake GitHub API + bare repos in a throwaway folder stand in for GitHub and the VPS; nothing real is touched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'axf-wizard-'));
const gitBase = join(tmp, 'github');   // <owner>/<name>.git bare repos = "GitHub"
const vpsGit = join(tmp, 'srv-git');   // the VPS's /srv/git
const ws = join(tmp, 'projects');      // the wizard's workspace
mkdirSync(gitBase, { recursive: true }); mkdirSync(vpsGit); mkdirSync(ws);
const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); };
const bare = (o, n) => join(gitBase, o, `${n}.git`);
const hasCommits = (p) => spawnSync('git', ['--git-dir', p, 'rev-parse', '-q', '--verify', 'HEAD']).status === 0;

// fake GitHub REST API
let nextId = 1;
const server = createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== 'Bearer test-token') return send(401, { message: 'Bad credentials' });
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const repoInfo = (o, n) => ({ id: nextId++, name: n, full_name: `${o}/${n}`, html_url: `https://github.com/${o}/${n}`, private: true, description: 'fake', default_branch: 'main', owner: { login: o } });
    let m;
    if (u.pathname === '/user') return send(200, { login: 'MossesX', id: 7, name: 'Brett' });
    if (u.pathname === '/user/repos' && req.method === 'GET') return send(200, [{ full_name: 'MossesX/source-app', private: true, description: 'src', pushed_at: '2026-10-18' }]);
    if (u.pathname === '/user/repos' && req.method === 'POST') { const b = JSON.parse(body); mkdirSync(bare('MossesX', b.name), { recursive: true }); g(bare('MossesX', b.name), 'init', '-q', '--bare', '-b', 'main'); return send(201, repoInfo('MossesX', b.name)); }
    if (u.pathname === '/user/installations') return send(200, { installations: [{ id: 1, app_slug: 'claude', repository_selection: 'all', account: { login: 'MossesX', type: 'User' } }] });
    if ((m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/commits$/))) return existsSync(bare(m[1], m[2])) ? (hasCommits(bare(m[1], m[2])) ? send(200, [{ sha: 'x' }]) : send(409, { message: 'Git Repository is empty.' })) : send(404, { message: 'Not Found' });
    if ((m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/))) return existsSync(bare(m[1], m[2])) ? send(200, repoInfo(m[1], m[2])) : send(404, { message: 'Not Found' });
    send(404, { message: `fake: no route ${req.method} ${u.pathname}` });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = {
  ...process.env, GITHUB_TOKEN: 'test-token', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_PROJECT_GIT_BASE: gitBase,
  AXF_WIZARD_WORKSPACE: ws, AXF_WIZARD_ROOTS: tmp, AXF_WIZARD_STORE: join(tmp, 'store.json'), AXF_VPS_GIT_DIR: vpsGit, AXF_VPS_HOST: '',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', HOME: tmp,
};
// the wizard runs as a child process, like the console's server part runs it
const callP = async (req) => {
  const { spawn } = await import('node:child_process');
  return new Promise((resolveP) => {
    const p = spawn(process.execPath, [join(HERE, 'wizard.mjs'), '--json', JSON.stringify(req)], { env });
    let out = ''; let err = '';
    p.stdout.on('data', (c) => (out += c)); p.stderr.on('data', (c) => (err += c));
    p.on('close', () => { const last = out.trim().split('\n').pop(); try { resolveP(JSON.parse(last)); } catch { resolveP({ ok: false, error: `no JSON: ${out} ${err}` }); } });
  });
};

try {
  const st = await callP({ action: 'status' });
  assert.equal(st.ok, true); assert.equal(st.github.login, 'MossesX'); assert.equal(st.vps.mode, 'local');
  assert.ok(st.templates.some((t) => t.id === 'react-ts') && !st.templates.some((t) => t.id === 'android-module'), 'app templates only');

  // 1. a new AXF app → new GitHub repo + new VPS repo + local folder
  const plan1 = { source: { kind: 'new', template: 'react-ts', boilerplate: 'blank' }, display: 'Notes Pad', description: 'Quick notes', homes: { github: { mode: 'new', owner: 'MossesX', name: 'notes-pad' }, vps: { mode: 'new' }, local: { mode: 'keep' } }, sync: false };
  const c1 = await callP({ action: 'check', plan: plan1 });
  assert.equal(c1.ok, true, JSON.stringify(c1.problems)); assert.equal(c1.plan.name, 'notes-pad'); assert.equal(c1.plan.dir, join(ws, 'notes-pad'));
  const r1 = await callP({ action: 'run', plan: plan1 });
  assert.equal(r1.ok, true, `${r1.error}\n${(r1.log ?? []).join('\n')}`);
  const dir1 = join(ws, 'notes-pad');
  const m1 = JSON.parse(readFileSync(join(dir1, 'project.manifest.json'), 'utf8'));
  assert.equal(m1.name, 'notes-pad'); assert.equal(m1.framework.relation, 'built-on'); assert.equal(m1.repo.exists, true);
  assert.ok(existsSync(join(dir1, '_claude/claude-ai/INSTRUCTIONS.md')) && existsSync(join(dir1, '_claude/claude-ai/context/PROJECT.md')));
  assert.match(readFileSync(join(dir1, '_claude/claude-ai/INSTRUCTIONS.md'), 'utf8'), /Notes Pad/);
  assert.ok(hasCommits(bare('MossesX', 'notes-pad')), 'pushed to "GitHub"');
  assert.ok(hasCommits(join(vpsGit, 'notes-pad.git')), 'pushed to the VPS repo');
  assert.match(g(dir1, '--git-dir', join(vpsGit, 'notes-pad.git'), 'log', '--format=%s', '-1'), /Claude\.ai project kit/, 'kit commit reached the VPS');
  assert.equal(r1.project.steps['claude-app'].ok, true);

  // the same GitHub name again is refused (it has commits now and isn't the source)
  const c1b = await callP({ action: 'check', plan: { ...plan1, display: 'Notes Two', homes: { github: { mode: 'new', owner: 'MossesX', name: 'notes-pad' } } } });
  assert.equal(c1b.ok, false); assert.ok(c1b.problems.some((p) => /already exists and has commits/.test(p)));

  // 2. an existing GitHub repo as the source, kept as the GitHub home
  const seed = join(tmp, 'seed'); mkdirSync(seed); g(seed, 'init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ name: 'source-app', description: 'An app', dependencies: { react: '18', vite: '5' } }));
  g(seed, 'add', '-A'); g(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
  mkdirSync(join(gitBase, 'MossesX'), { recursive: true }); g(tmp, 'clone', '-q', '--bare', seed, bare('MossesX', 'source-app'));
  const ins = await callP({ action: 'inspect', source: { kind: 'github', repo: 'https://github.com/MossesX/source-app' } });
  assert.equal(ins.ok, true); assert.equal(ins.suggest.repoName, 'source-app');
  const plan2 = { source: { kind: 'github', repo: 'MossesX/source-app' }, display: 'Source App', homes: { github: { mode: 'existing', owner: 'MossesX', name: 'source-app' }, vps: { mode: 'skip' } }, sync: false };
  const r2 = await callP({ action: 'run', plan: plan2 });
  assert.equal(r2.ok, true, `${r2.error}\n${(r2.log ?? []).join('\n')}`);
  assert.match(g(seed, '--git-dir', bare('MossesX', 'source-app'), 'log', '--format=%s', '-3'), /Claude\.ai project kit/);
  assert.equal(JSON.parse(readFileSync(join(ws, 'source-app/project.manifest.json'), 'utf8')).framework.relation, 'none');

  // 3. folders: outside the allowed roots is refused; inside, local only
  const out = await callP({ action: 'inspect', source: { kind: 'folder', path: '/etc' } });
  assert.equal(out.ok, false); assert.match(out.error, /outside the folders/);
  const folder = join(tmp, 'loose'); mkdirSync(folder); writeFileSync(join(folder, 'main.py'), 'print(1)\n');
  const r3 = await callP({ action: 'run', plan: { source: { kind: 'folder', path: folder }, display: 'Loose Script', homes: {}, sync: false } });
  assert.equal(r3.ok, true, `${r3.error}\n${(r3.log ?? []).join('\n')}`);
  assert.ok(existsSync(join(folder, '.git')) && existsSync(join(folder, '_claude/claude-ai/README.md')));

  // listings
  assert.ok((await callP({ action: 'list', location: 'vps' })).items.some((i) => i.id === 'notes-pad'));
  assert.ok((await callP({ action: 'list', location: 'local' })).items.some((i) => i.id === dir1));
  assert.equal((await callP({ action: 'list', location: 'github' })).items[0].id, 'MossesX/source-app');

  // kit rebuild, link, forget
  const k = await callP({ action: 'kit', name: 'notes-pad', rebuild: true });
  assert.ok(k.ok && k.files.some((f) => f.path === 'INSTRUCTIONS.md' && f.text.includes('Notes Pad')));
  assert.equal((await callP({ action: 'link', name: 'notes-pad', url: 'https://evil.example/project/x' })).ok, false);
  const ln = await callP({ action: 'link', name: 'notes-pad', url: 'https://claude.ai/project/0123abcd-4567-89ef' });
  assert.equal(ln.ok, true, ln.error);
  assert.equal(JSON.parse(readFileSync(join(dir1, 'project.manifest.json'), 'utf8')).x.claudeAi.url, 'https://claude.ai/project/0123abcd-4567-89ef');
  const store = JSON.parse(readFileSync(join(tmp, 'store.json'), 'utf8'));
  assert.ok(!JSON.stringify(store).includes('test-token'), 'no token in the store');
  assert.equal((await callP({ action: 'forget', name: 'loose-script' })).ok, true);
  assert.ok(existsSync(folder), 'forget never deletes the folder');
  console.log('project-wizard: all checks passed');
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
