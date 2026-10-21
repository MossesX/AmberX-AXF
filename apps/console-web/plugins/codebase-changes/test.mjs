#!/usr/bin/env node
/**
 * Tests for changes.mjs + changes-core.mjs: the record rules, the prompt classifier, the CLI on a scratch folder, the
 * Claude Code hook (opens once per session + prompt, never blocks, fills in on Stop / SessionEnd), the queue fallback
 * and flush, the console-API backend against a fake console (token never printed), and hooks install/remove.
 *
 *   node apps/console-web/plugins/codebase-changes/test.mjs
 */
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, DirStore, newId, normalize, relPath, titleFrom, upsertStep } from './changes-core.mjs';
import { parseTest, withOurHooks, withoutOurHooks } from './changes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'changes.mjs');
let ok = 0;
const check = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };
const scratch = (p) => mkdtempSync(join(tmpdir(), `axf-changes-${p}-`));
const baseEnv = (extra) => ({ PATH: process.env.PATH, HOME: scratch('h'), AXF_DATA_DIR: 'off', AXHUB_PROJECTS_DIR: '/nonexistent-projects', USER: 'tester', ...extra });
const run = (args, env, input) => spawnSync('node', [CLI, ...args], { env, input, encoding: 'utf8', timeout: 20000 });
const runAsync = (args, env, input) => new Promise((res) => { const p = spawn('node', [CLI, ...args], { env }); let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; }); p.on('close', (status) => res({ status, stdout: out, stderr: err })); p.stdin.end(input ?? ''); });

console.log('record rules');
check(/^chg-\d{8}-[0-9a-f]{10}$/.test(newId()), 'new ids look like chg-YYYYMMDD-<10 hex>');
check(newId('a') === newId('a') && newId('a') !== newId('b'), 'a seed gives the same id (same day), another seed another id');
check(relPath('chg-20261021-abcdef1234') === join('2026', '10', 'chg-20261021-abcdef1234.json'), 'the path comes from the id date');
let threw = false; try { relPath('../x'); } catch { threw = true; }
check(threw, 'a bad id never becomes a path');
const n = normalize({ id: 'chg-20261021-abcdef1234', title: 'x', result: { state: 'done', summary: 'Bearer abcdefghijklmnopqrstuvwxyz' } });
check(n.entry && n.entry.result.summary === '[hidden]' && n.entry.state === 'done', 'bearer tokens are hidden; state follows the result');
check(!normalize({ id: 'chg-20261021-abcdef1234', title: 'x', result: { state: 'done', summary: '', links: { r: 'file:///etc/passwd' } } }).entry, 'file: links are refused');
const st = upsertStep(upsertStep([], { text: 'a', state: 'running' }, '2026-10-21T00:00:00.000Z'), { index: 0, state: 'done' }, '2026-10-21T00:01:00.000Z');
check(st[0].startedAt === '2026-10-21T00:00:00.000Z' && st[0].finishedAt === '2026-10-21T00:01:00.000Z', 'step times are stamped on state changes');
check(JSON.stringify(parseTest('web=0→12')) === '["web",{"before":"0","after":"12"}]' && parseTest('py=pass')[1].state === 'pass' && parseTest('x=3/3')[1].after === '3/3', '--test parses before→after, pass/fail and plain values');
check(titleFrom('Fix the banner. Then more.') === 'Fix the banner.' && titleFrom('') === 'Untitled change', 'titles are the first sentence');

console.log('classifier');
const yes = [['Add another banner to the console', 'build'], ['please remove the old toolbar', 'remove'], ['fix the CI build', 'fix'], ['Rename the plugin', 'edit'],
  ['Can you build the settings tab?', 'build'], ['Remove the stale doc and build a new one', 'remove'], ['Add a remove button', 'build'], ['the login page is broken', 'fix']];
for (const [p, k] of yes) { const c = classify(p); check(c.change && c.kind === k, `"${p}" → ${k}`); }
const no = ['What does the build engine do?', 'how do I add a plugin', 'explain the remove flow', '/model opus', 'continue', 'thanks!', '', 'Is the fix merged?'];
for (const p of no) check(!classify(p).change, `"${p}" → not a change`);

console.log('CLI on a folder');
const dir = scratch('dir');
const env = baseEnv({ AXF_CHANGES_DIR: dir });
let r = run(['open', 'Codebase changes plugin', '--kind', 'build', '--repo', 'MossesX/AmberX-AXF', '--step', 'record format', '--step', 'server'], env);
const id = r.stdout.trim();
check(r.status === 0 && /^chg-/.test(id), 'open prints the id');
check(run(['step', 'last', 'record format', '--state', 'done'], env).status === 0, 'step on `last`');
r = run(['step', id, 'banner', '--state', 'running'], env);
check(r.status === 0 && r.stdout.includes('(1/3 steps)'), 'a new step is added and the count shows');
check(run(['step', id, 'x', '--state', 'odd'], env).status === 1, 'a bad step state is refused');
r = run(['result', id, '--state', 'done', '--summary', 'built it', '--commit', 'abc1234', '--files', '12', '--test', 'test.py=0→80', '--link', 'report=_claude/memory/docs/x.md', '--branch', 'feat/x'], env);
check(r.status === 0, 'result records branch, commits, files, tests and links');
const e = JSON.parse(run(['show', id, '--json'], env).stdout);
check(e.result.filesChanged === 12 && e.result.tests['test.py'].after === '80' && e.result.links.report && e.steps.find((s) => s.text === 'banner').state === 'done', 'running steps finish with the result');
check(run(['result', id, '--state', 'great'], env).status === 1, 'a bad result state is refused');
check(JSON.parse(run(['close', id, '--json'], env).stdout).closed.by === 'cli:tester', 'close records who');
check(JSON.parse(run(['list', '--open', '--json'], env).stdout).length === 0, 'closed entries leave list --open');
check(JSON.parse(run(['reopen', id, '--json'], env).stdout).closed === null, 'reopen');
const file = join(dir, relPath(id));
check(existsSync(file) && (statSync(file).mode & 0o777) === 0o600, 'one 0600 file per entry');
check(!readdirSync(dirname(file)).some((f) => f.endsWith('.tmp')), 'no temp files left');
check(run(['step', 'chg-20991231-0000000000', 'x'], env).status === 1, 'an unknown entry is an error');

console.log('hook');
const hookDir = scratch('hook');
const henv = baseEnv({ AXF_CHANGES_DIR: hookDir });
const ev = (name, extra = {}) => JSON.stringify({ hook_event_name: name, session_id: 'sess-1234', cwd: HERE, ...extra });
r = run(['hook'], henv, ev('UserPromptSubmit', { prompt: 'Add a codebase changes banner. token=abcdefghijkl' }));
check(r.status === 0 && r.stdout.includes('[Codebase changes] Entry chg-'), 'a change prompt opens an entry and tells Claude its id');
const hid = r.stdout.match(/Entry (chg-\S+)/)[1];
const he = new DirStore(hookDir).get(hid);
check(he.kind === 'build' && he.asked.includes('[hidden]') && !he.asked.includes('abcdefghijkl') && he.who.session === 'sess-1234', 'the entry has the kind, the redacted request and the session');
check(he.repos.length === 1 && he.repos[0].includes('/'), 'the repo comes from the git remote');
r = run(['hook'], henv, ev('UserPromptSubmit', { prompt: 'Add a codebase changes banner. token=abcdefghijkl' }));
check(r.stdout.includes(hid) && new DirStore(hookDir).all().length === 1, 'the same session + prompt opens nothing new (idempotent)');
r = run(['hook'], henv, ev('UserPromptSubmit', { prompt: 'What does it do?' }));
check(r.status === 0 && r.stdout === '' && new DirStore(hookDir).all().length === 1, 'a question opens nothing and prints nothing');
check(run(['hook'], henv, 'not json').status === 0, 'garbage on stdin still exits 0');
check(run(['hook'], baseEnv({ AXF_CHANGES_DIR: '/proc/forbidden/x' }), ev('UserPromptSubmit', { prompt: 'fix it' })).status === 0, 'an unwritable log still exits 0');
run(['step', hid, 'write banner', '--state', 'running'], henv);
run(['step', hid, 'screenshots'], henv);
run(['step', hid, 'screenshots', '--state', 'queued'], henv);
run(['hook'], henv, ev('Stop'));
let after = new DirStore(hookDir).get(hid);
check(after.steps[0].state === 'done' && /turn ended/.test(after.steps[0].note) && after.steps[1].state === 'queued' && !after.result, 'Stop finishes running steps, leaves queued ones and the result open');
run(['hook'], henv, ev('SessionEnd'));
after = new DirStore(hookDir).get(hid);
check(after.steps[1].state === 'skipped' && after.result?.state === 'partial', 'SessionEnd skips queued steps and marks a result-less entry partial');
check(!existsSync(join(henv.HOME, '.axf-changes', 'sessions', 'sess-1234.json')), 'SessionEnd forgets the session');

console.log('queue fallback + flush');
const qenv = baseEnv({});
r = run(['open', 'Offline change', '--kind', 'fix'], qenv);
const qid = r.stdout.trim().split(/\s/)[0];
check(r.status === 0 && existsSync(join(qenv.HOME, '.axf-changes', 'queue', relPath(qid))), 'with nowhere to write, the entry waits in ~/.axf-changes/queue');
check((statSync(join(qenv.HOME, '.axf-changes', 'queue')).mode & 0o777) === 0o700, 'the queue folder is 0700');
check(run(['step', 'last', 'offline step', '--state', 'done'], qenv).status === 0, 'steps work on a queued entry');
check(run(['where'], qenv).stdout.includes('local queue'), 'where says so');
const target = scratch('target');
r = run(['list', '--json'], { ...qenv, AXF_CHANGES_DIR: target });
check(r.status === 0 && new DirStore(target).get(qid)?.steps[0].text === 'offline step', 'the next run that can write sends the queue on');
check(!existsSync(join(qenv.HOME, '.axf-changes', 'queue', relPath(qid))), 'and empties it');

console.log('console API backend (fake console)');
const TOKEN = 'secret-console-token-1234567890';
const db = new Map();
const seen = [];
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { detail: 'token' });
    const m = req.url.match(/^\/api\/plugins\/codebase-changes\/entries(?:\/([^/?]+))?(?:\/(close|reopen))?/);
    if (!m) return send(404, {});
    const b = body ? JSON.parse(body) : {};
    if (req.method === 'POST' && !m[1]) { if (db.has(b.id)) return send(200, { ...db.get(b.id), existed: true }); const x = normalize(b).entry; db.set(x.id, x); return send(200, x); }
    if (req.method === 'GET' && !m[1]) return send(200, { items: [...db.values()], total: db.size });
    const cur = db.get(m[1]);
    if (!cur) return send(404, { detail: 'no entry' });
    if (req.method === 'GET') return send(200, cur);
    if (req.method === 'PATCH') { const x = normalize({ ...cur, ...b }).entry; db.set(x.id, x); return send(200, x); }
    if (m[2] === 'close') { const x = { ...cur, closed: { at: new Date().toISOString(), by: 'api' } }; db.set(x.id, x); return send(200, x); }
    return send(400, {});
  });
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const aenv = baseEnv({ AXF_TOKEN: TOKEN, AXF_CONSOLE_URL: `http://127.0.0.1:${srv.address().port}` });
r = await runAsync(['open', 'Through the API', '--kind', 'edit'], aenv);
const aid = r.stdout.trim();
check(r.status === 0 && db.has(aid), 'with AXF_TOKEN the entry goes to the console');
r = await runAsync(['step', aid, 'one', '--state', 'done'], aenv);
check(db.get(aid).steps[0].state === 'done', 'steps go through PATCH');
r = await runAsync(['close', aid], aenv);
check(db.get(aid).closed?.by === 'api', 'close goes through the close route');
check(seen.every((s) => s.auth === `Bearer ${TOKEN}`) && !`${r.stdout}${r.stderr}`.includes(TOKEN), 'the token is only sent as a header, never printed');
r = await runAsync(['open', 'Bad token'], { ...aenv, AXF_TOKEN: 'wrong' });
check(r.status === 1 && /401/.test(r.stderr) && !r.stderr.includes('wrong'), 'a refused token is an error (not queued), without echoing it');
srv.close();
r = await runAsync(['open', 'Console down'], aenv);
check(r.status === 0 && r.stdout.includes('local queue'), 'console unreachable → queued');
r = await runAsync(['open', 'Plain http'], { ...aenv, AXF_CONSOLE_URL: 'http://example.com' });
check(r.status === 1 && /https/.test(r.stderr), 'a non-https console address is refused');

console.log('hooks install / remove');
const settings = join(scratch('s'), 'settings.json');
writeFileSync(settings, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }));
check(run(['hooks', 'install', '--settings', settings], baseEnv({})).status === 0, 'install');
let s = JSON.parse(readFileSync(settings, 'utf8'));
check(s.hooks.UserPromptSubmit.length === 1 && s.hooks.Stop.length === 2 && s.hooks.SessionEnd.length === 1 && s.model === 'opus', 'adds UserPromptSubmit/Stop/SessionEnd and keeps everything else');
run(['hooks', 'install', '--settings', settings], baseEnv({}));
s = JSON.parse(readFileSync(settings, 'utf8'));
check(s.hooks.Stop.length === 2, 'installing twice doesn\'t double up');
check(run(['hooks', 'status', '--settings', settings], baseEnv({})).stdout.startsWith('installed'), 'status');
run(['hooks', 'remove', '--settings', settings], baseEnv({}));
s = JSON.parse(readFileSync(settings, 'utf8'));
check(JSON.stringify(s) === JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }), 'remove leaves exactly what was there');
check(JSON.stringify(withoutOurHooks(withOurHooks({}, '/x/changes.mjs'))) === '{}', 'with/without round-trips');

console.log(`\n${ok} checks passed`);
