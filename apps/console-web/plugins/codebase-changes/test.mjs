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
import { classify, DirStore, newId, normalize, relPath, titleFrom, upsertStep, resumePrompt } from './changes-core.mjs';
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
const no = ['What does the build engine do?', 'how do I add a plugin', 'explain the remove flow', '/model opus', 'continue', 'thanks!', '', 'Is the fix merged?', '<task-notification> <task-id>b1</task-id> <summary>Background command "Fix the build" completed</summary>', '<system-reminder>build it</system-reminder>'];
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
check(r.status === 0 && r.stdout.includes('Codebase changes] Entry chg-'), 'a change prompt opens an entry and tells Claude its id');
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

console.log('resume details');
check(he.resume?.folder && he.resume.head && typeof he.resume.dirty === 'number' && Array.isArray(he.resume.files), 'the hook records the checkout: folder, last commit, uncommitted count, files');
check(after.resume?.at && after.resume.head === he.resume.head, 'Stop / SessionEnd refresh the git part');
r = run(['resume', hid, '--plan', 'Do it in two passes', '--next', 'Screenshots, then the PR', '--test', 'python3 test.py', '--read', 'CLAUDE.md', '--pr', 'https://github.com/MossesX/AmberX-AXF/pull/1', '--json'], henv);
const rs = JSON.parse(r.stdout);
check(r.status === 0 && rs.plan === 'Do it in two passes' && rs.tests[0] === 'python3 test.py' && rs.read[0] === 'CLAUDE.md' && rs.pr.endsWith('/pull/1') && rs.head === he.resume.head, 'resume adds plan / next / tests / read / pr and keeps the git part');
r = run(['resume', hid, '--prompt'], henv);
check(r.status === 0 && r.stdout.includes(hid) && r.stdout.includes('What is left:') && r.stdout.includes('Screenshots, then the PR') && r.stdout.includes('no new repo, no fork') && !r.stdout.includes('abcdefghijkl'), 'resume --prompt prints a prompt another account can carry on from (secrets hidden)');
check(run(['resume', hid, '--read', '../etc/passwd'], henv).status === 1, 'a path outside the repo is refused');
check(run(['resume', hid, '--pr', 'http://x'], henv).status === 1, 'a non-https PR link is refused');
check(resumePrompt({ id: 'chg-20261025-abcdef1234', title: 't', kind: 'edit', steps: [], result: null, resume: { pushed: false, head: 'abcdef1' } }).includes('NOT pushed'), 'an unpushed head is called out');

console.log('first edit opens an entry');
const fDir = scratch('first');
const fenv = baseEnv({ AXF_CHANGES_DIR: fDir });
const fev = (name, extra = {}) => JSON.stringify({ hook_event_name: name, session_id: 'sess-first', cwd: HERE, ...extra });
r = run(['hook'], fenv, fev('UserPromptSubmit', { prompt: 'The banner looks odd on my phone' }));
check(r.stdout === '' && new DirStore(fDir).all().length === 0, 'a prompt not worded as a change opens nothing yet');
run(['hook'], fenv, fev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/x/a.ts' } }));
check(new DirStore(fDir).all().length === 0, 'reading opens nothing');
run(['hook'], fenv, fev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/x/web/banner.tsx' } }));
const fl = new DirStore(fDir).all();
check(fl.length === 1 && fl[0].kind === 'edit' && fl[0].asked.includes('banner looks odd') && fl[0].who.host && fl[0].who.session === 'sess-first' && fl[0].surface && fl[0].resume?.folder, 'the first edit opens one with the prompt, machine, session, session type and checkout');
run(['hook'], fenv, fev('PreToolUse', { tool_name: 'Write', tool_input: { file_path: '/x/web/b.tsx' } }));
check(new DirStore(fDir).all().length === 1, 'later edits for the same prompt open nothing new');

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

console.log('build stats (Build manager)');
const B0 = { id: 'chg-20261021-abcdef1234', title: 'x' };
check(normalize(B0).entry.status === 'running' && !('estimate' in normalize(B0).entry), 'an old entry gains only the derived status');
check(normalize({ ...B0, result: { state: 'partial', summary: '' } }).entry.status === 'done' && normalize({ ...B0, result: { state: 'cancelled', summary: '' } }).entry.status === 'failed', 'status follows the result (partial → done, cancelled → failed)');
check(normalize({ ...B0, status: 'queued' }).entry.status === 'queued' && !normalize({ ...B0, status: 'weird' }).entry, 'queued can be asked for; unknown statuses are refused');
const bs = normalize({ ...B0, buildRef: { kind: 'pending', id: 'lib-clone' }, surface: 'claude-ai', estimate: { minutes: 90.4, costUsd: 12.345678 }, areas: ['apps/x', 'apps/x', 'framework/core'], branch: 'feat/x', progress: 0.5, lastSeenAt: '2026-10-21T10:00:00.000Z' }).entry;
check(bs.buildRef.id === 'lib-clone' && bs.estimate.minutes === 90 && bs.estimate.costUsd === 12.3457 && bs.areas.length === 2 && bs.costEstimated === true, 'build fields normalised (rounded, areas unique, costEstimated derived)');
check(!normalize({ ...B0, areas: ['../etc'] }).entry && !normalize({ ...B0, areas: ['/abs'] }).entry && !normalize({ ...B0, estimate: { minutes: -1 } }).entry && !normalize({ ...B0, parent: 'x' }).entry, 'bad areas, negative numbers and bad parents are refused');
check(normalize({ ...B0, actual: { costUsd: 3, inputTokens: 10, source: 'transcript' } }).entry.costEstimated === false, 'an actual cost makes costEstimated false');
const { isStale, summary: sumOf } = await import('./changes-core.mjs');
check(isStale({ status: 'running', lastSeenAt: new Date(Date.now() - 11 * 60000).toISOString() }) && !isStale({ status: 'running', lastSeenAt: new Date().toISOString() }) && !isStale({ status: 'done', lastSeenAt: '2020-01-01T00:00:00Z' }), 'running and not seen for 10 min = stale; finished never');
check(sumOf(bs).buildRef.id === 'lib-clone' && sumOf(bs).status === 'running' && sumOf(bs).branch === 'feat/x', 'summaries carry the build stats');

const pr = await import('../../../../framework/cli/model-pricing.mjs');
check(pr.modelKey('claude-opus-5-5') === 'opus' && pr.modelKey('Fable') === 'fable' && pr.modelKey('gpt') === '', 'model ids map to price keys');
check(pr.costUsd('opus', { input: 1e6, output: 1e6 }) === 24 && pr.costUsd('nope', { input: 1 }) === null, 'cost from tokens × the shared prices');
check(pr.estimateCost('opus', 60) > 0 && pr.estimateCost('opus', 120) === Math.round(pr.estimateCost('opus', 60) * 2 * 10000) / 10000, 'estimate cost scales with minutes');
const tr = [
  { timestamp: '2026-10-21T10:00:00Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } },
  { timestamp: '2026-10-21T10:00:01Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 100 } } },
  { timestamp: '2026-10-21T09:00:00Z', message: { id: 'old', usage: { input_tokens: 999, output_tokens: 999 } } },
  { type: 'user', message: { content: 'hi' } },
].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n';
const tu = pr.transcriptUsage(tr, { since: '2026-10-21T09:30:00Z' });
check(tu.input === 10 && tu.output === 50 && tu.cacheRead === 100 && tu.messages === 1 && tu.model === 'claude-opus-5-5', 'transcript usage: each message once (last wins), lines before `since` skipped, junk ignored');

const benv = baseEnv({ AXF_CHANGES_DIR: scratch('build') });
r = run(['open', 'Built with stats', '--kind', 'build', '--ref', 'pending:lib-clone', '--model', 'opus', '--estimate-min', '45', '--areas', 'apps/a,framework/b', '--branch', 'feat/y', '--json'], benv);
let be = JSON.parse(r.stdout);
check(be.buildRef.kind === 'pending' && be.estimate.minutes === 45 && be.estimate.costUsd === pr.estimateCost('opus', 45) && be.costEstimated && be.areas.length === 2 && be.surface && be.who.host, 'open --ref --estimate-min --areas: estimate cost from the shared prices, surface + host recorded');
r = run(['update', 'last', '--estimate-cost', '9.5', '--doing', 'Writing tests', '--json'], benv);
be = JSON.parse(r.stdout);
check(be.estimate.costUsd === 9.5 && be.estimate.minutes === 45 && be.doing === 'Writing tests' && be.lastSeenAt, 'update sets build stats and counts as a heartbeat');
run(['step', 'last', 'one', '--state', 'done'], benv); run(['step', 'last', 'two', '--state', 'running'], benv);
be = JSON.parse(run(['show', 'last', '--json'], benv).stdout);
check(be.progress === 0.5 && be.doing === 'two', 'steps drive progress and the current activity');
r = run(['result', 'last', '--state', 'done', '--summary', 'ok', '--input-tokens', '1000000', '--output-tokens', '1000000', '--json'], benv);
be = JSON.parse(r.stdout);
check(be.status === 'done' && be.actual.costUsd === 24 && be.actual.source === 'manual' && be.costEstimated === false && be.finishedAt && !be.doing && be.progress === 1, 'result with actual tokens: cost from prices, costEstimated false, finished');

console.log('hook: live progress, subagents, transcript cost');
const lenv = baseEnv({ AXF_CHANGES_DIR: scratch('live'), AXF_SURFACE: 'vps-claude-code' });
const tfile = join(scratch('t'), 't.jsonl');
const lev = (name, extra = {}) => JSON.stringify({ hook_event_name: name, session_id: 'sess-live', cwd: HERE, transcript_path: tfile, ...extra });
writeFileSync(tfile, '');
r = run(['hook'], lenv, lev('UserPromptSubmit', { prompt: 'Build the history view' }));
const lid = r.stdout.match(/Entry (chg-\S+)/)[1];
let le = new DirStore(lenv.AXF_CHANGES_DIR).get(lid);
check(le.surface === 'vps-claude-code' && le.status === 'running' && le.startedAt && le.lastSeenAt, 'the hook opens a live entry with surface, start and heartbeat');
check(r.stdout.includes(`update ${lid} --ref`), 'and tells Claude how to record the estimate');
run(['hook'], lenv, lev('PreToolUse', { tool_name: 'Task', tool_input: { description: 'review the diff', prompt: 'secret=abcdefghijk' } }));
le = new DirStore(lenv.AXF_CHANGES_DIR).get(lid);
check(le.steps.some((s) => s.note === 'subagent' && s.state === 'running' && /review the diff/.test(s.text)) && le.doing.startsWith('Subagent'), 'a subagent shows as a running child step');
run(['hook'], lenv, lev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'cat token=zzzzzzzzzz', description: 'run tests' } }));
const le2 = new DirStore(lenv.AXF_CHANGES_DIR).get(lid);
check(le2.doing === le.doing, 'plain tool calls are throttled (one write per 30 s)');
check(!JSON.stringify(le2).includes('zzzzzzzzzz'), 'command arguments are never recorded');
run(['hook'], lenv, lev('SubagentStop'));
le = new DirStore(lenv.AXF_CHANGES_DIR).get(lid);
check(le.steps.find((s) => s.note === 'subagent').state === 'done', 'SubagentStop finishes the child step');
writeFileSync(tfile, JSON.stringify({ timestamp: new Date().toISOString(), message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 2000000, output_tokens: 100000 } } }) + '\n');
run(['hook'], lenv, lev('Stop'));
le = new DirStore(lenv.AXF_CHANGES_DIR).get(lid);
check(le.actual?.source === 'transcript' && le.actual.inputTokens === 2000000 && le.actual.costUsd === 10 && le.costEstimated === false && le.model.includes('opus') && !le.result, 'Stop fills actual tokens + cost from the transcript and keeps the entry running');
check(le.doing === 'Waiting for the next message', 'and says it is waiting');

console.log('axHub backend (fake hub over MCP)');
const HUB_TOKEN = 'hub-token-abcdefghijklmnop';
const files = new Map();
const hubSeen = [];
const hub = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    hubSeen.push(req.headers.authorization);
    if (req.headers.authorization !== `Bearer ${HUB_TOKEN}`) { res.writeHead(401); return res.end(); }
    const m = JSON.parse(body);
    if (m.id === undefined) { res.writeHead(202); return res.end(); }
    const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })); };
    if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {} });
    const { tool, arguments: a } = m.params.arguments;
    const txt = (t, err) => reply({ content: [{ type: 'text', text: t }], ...(err ? { isError: true } : {}) });
    if (a.project !== 'amberx-axf' || a.area !== 'data') return txt('{"error":{"message":"wrong place"}}', true);
    if (tool === 'axhub.memory_write') { files.set(a.path, a.content); return txt(JSON.stringify({ saved: { path: a.path } })); }
    if (tool === 'axhub.memory_read') return files.has(a.path) ? txt(files.get(a.path)) : txt('{"error":{"message":"not found"}}', true);
    if (tool === 'axhub.memory_list') return txt(JSON.stringify({ files: [...files.keys()].map((p) => ({ path: p })) }));
    return txt('{}', true);
  });
});
await new Promise((res) => hub.listen(0, '127.0.0.1', res));
const xenv = baseEnv({ AXHUB_TOKEN: HUB_TOKEN, AXHUB_URL: `http://127.0.0.1:${hub.address().port}/mcp` });
r = await runAsync(['open', 'From another computer', '--kind', 'build', '--estimate-min', '20', '--model', 'sonnet'], xenv);
const xid = r.stdout.trim();
check(r.status === 0 && files.has(`changes/${relPath(xid).split(/[\\/]/).join('/')}`), 'with the hub token, entries go to axHub (amberx-axf / data / changes/<YYYY>/<MM>/<id>.json)');
r = await runAsync(['step', xid, 'first', '--state', 'running'], xenv);
check(JSON.parse(files.get(`changes/${relPath(xid).split(/[\\/]/).join('/')}`)).steps[0].state === 'running', 'steps update the hub copy');
check((await runAsync(['where'], xenv)).stdout.startsWith('axHub'), 'where says axHub');
check(hubSeen.every((a) => a === `Bearer ${HUB_TOKEN}`) && !r.stdout.includes(HUB_TOKEN) && !r.stderr.includes(HUB_TOKEN), 'the hub token is only a header, never printed');
const tokFile = baseEnv({});
const { mkdirSync: mk } = await import('node:fs');
mk(join(tokFile.HOME, '.config', 'axhub'), { recursive: true });
writeFileSync(join(tokFile.HOME, '.config', 'axhub', 'token'), HUB_TOKEN);
r = await runAsync(['open', 'Token from claude-sync login'], { ...tokFile, AXHUB_URL: xenv.AXHUB_URL });
check(r.status === 0 && files.size === 2, 'the token claude-sync login saved (~/.config/axhub/token) works too');
r = await runAsync(['open', 'Hub off'], { ...xenv, AXF_CHANGES_HUB: 'off' });
check(r.status === 0 && files.size === 2, 'AXF_CHANGES_HUB=off skips the hub');
hub.close();
r = await runAsync(['open', 'Hub down'], xenv);
check(r.status === 0 && r.stdout.includes('local queue'), 'hub unreachable → queued, sent on later');
check((await runAsync(['open', 'x'], { ...xenv, AXHUB_URL: 'http://example.com/mcp' })).status === 1, 'a non-https hub address is refused');

console.log('global hooks');
const gs = join(scratch('g'), 'settings.json');
run(['hooks', 'install', '--settings', gs], baseEnv({}));
const g = JSON.parse(readFileSync(gs, 'utf8'));
check(['UserPromptSubmit', 'PreToolUse', 'SubagentStop', 'Notification', 'Stop', 'SessionEnd'].every((k) => g.hooks[k]?.length === 1), 'install registers every live event (prompt, tools, subagents, waiting, stop, end)');

console.log(`\n${ok} checks passed`);
