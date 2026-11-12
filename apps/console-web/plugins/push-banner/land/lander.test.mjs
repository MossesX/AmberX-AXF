#!/usr/bin/env node
/**
 * Lander self-test (build merge-all-ready-buttons-server-side-lander, Nov 12 2026).
 *   1. the pure rules (lander-core.mjs): readiness, order, the gate, the account chain, commands;
 *   2. whole steps on a throwaway origin with a fake GitHub: a ready PR merges, a failing PR is blocked, a PR behind
 *      main is caught up (merge commit, plain push) and merges after its tests pass, a code conflict is blocked with
 *      the files named, a finished build's PR goes first.
 *   node apps/console-web/plugins/push-banner/land/lander.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as L from './lander-core.mjs';
import { makeGit } from './land.mjs';
import { step, control, readState, readControl, readGateLog, checkAccount } from './lander.mjs';

let ok = 0; let bad = 0;
const check = (c, m) => { if (c) { ok++; console.log(`  ✓ ${m}`); } else { bad++; console.log(`  ✗ ${m}`); } };

// ------------------------------------------------------------------ 1. pure rules
console.log('rules (lander-core.mjs)');
const P = (number, o = {}) => ({ number, head: `h${number}`, createdAt: `2026-11-0${number % 9 + 1}T00:00:00Z`, ...o });
check(L.notReady(P(1)) === '' && /draft/.test(L.notReady(P(1, { draft: true }))), 'a plain PR is ready, a draft is not');
check(/blocked/.test(L.notReady(P(1, { blocked: { head: 'h1', why: 'x' } }))) && L.notReady(P(1, { blocked: { head: 'old', why: 'x' } })) === '', 'blocked holds only at the same head (a new commit rejoins)');
check(/UI Review/.test(L.notReady(P(1, { ui: 'waiting' }))) && L.notReady(P(1, { ui: 'waiting' }), { waitUi: false }) === '', 'UI Review holds it unless that wait is off');
const ord = L.order([P(3), P(1), P(2, { priority: 'P0' }), P(4)], { finished: [4], requested: [3] }).map((p) => p.number);
check(ord.join() === '4,3,2,1', `order: finished build, then Merge requests, then priority, then oldest (${ord.join()})`);
check(L.eligible([P(1), P(2)], { requested: [2] }, { on: false }).map((p) => p.number).join() === '2', 'off: only what Brett asked for merges');
check(L.eligible([P(1), P(2)], { drain: true }, { on: false }).length === 2, 'Merge all ready drains every ready PR even when off');
check(L.gate({ ci: 'success', behind: 0 }).act === 'merge', 'gate: tests green + up to date = merge');
check(L.gate({ ci: 'success', behind: 2 }).act === 'catch-up', 'gate: behind main = catch up first, even when green');
check(L.gate({ ci: 'failure', failing: ['Gradle'] }).act === 'block' && /Gradle/.test(L.gate({ ci: 'failure', failing: ['Gradle'] }).why), 'gate: red tests block with the check named');
check(L.gate({ conflicts: ['a.ts'] }).act === 'block' && /a\.ts/.test(L.gate({ conflicts: ['a.ts'] }).why), 'gate: a code conflict blocks with the file named');
check(L.gate({ ci: 'running' }).act === 'wait' && L.gate({ ci: 'running', testingMin: L.TEST_TIMEOUT_MIN }).act === 'block', 'gate: running waits, a stuck run blocks');
check(L.gate({ behind: 1, catchUps: L.MAX_CATCH_UPS }).act === 'block', 'gate: main moving again and again sends it back in line');
const acc = (name, o = {}) => ({ name, label: name, canRun: true, limited: null, ...o });
check(L.pickAccount([acc('mossesx-max-'), acc('account-5'), acc('account-3')]).account === 'mossesx-max-', 'account: Moses X first');
check(L.pickAccount([acc('mossesx-max-', { limited: { until: 'x' } }), acc('account-5'), acc('account-3')]).account === 'account-5', 'account: Moses X out → Hulu API');
check(L.pickAccount([acc('mossesx-max-', { limited: { until: 'x' } }), acc('account-5', { canRun: false, why: 'cap' }), acc('account-3')]).account === 'account-3', 'account: then Hulu');
check(L.pickAccount([]).account === '' && L.pickAccount([]).why, 'account: none can run = empty, with why');
let d = L.applyControl({}, 'merge', '7'); d = L.applyControl(d, 'merge', 7); d = L.applyControl(d, 'merge-all', null, { at: 't' });
check(d.requested.join() === '7' && d.drain === 't', 'commands: merge is idempotent, merge-all drains');
check(L.applyControl({ ...d, blocked: { 7: { head: 'h' } } }, 'unblock', 7).blocked[7] === undefined, 'commands: unblock clears the mark');
let threw = false; try { L.applyControl({}, 'finish', '../x'); } catch { threw = true; }
check(threw, 'commands: finish takes a build id only');
check(L.LANDER_COMMANDS.every((c) => c.cli && c.title), 'commands declared once for REST, CLI, MCP and voice');

// ------------------------------------------------------------------ 2. whole steps
console.log('steps on a throwaway origin');
const tmp = mkdtempSync(join(tmpdir(), 'axf-lander-test-'));
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const origin = join(tmp, 'origin.git'); const repo = join(tmp, 'repo');
sh(['init', '-q', '--bare', '-b', 'main', origin], tmp);
sh(['clone', '-q', origin, repo], tmp);
const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const put = (p, t) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t); };
const commit = (msg) => { sh(['add', '-A'], repo); sh([...cfg, 'commit', '-q', '-m', msg], repo); };
const B = (id, o = {}) => ({ id, title: id, branch: `claude/${id}`, status: 'built', steps: [], ...o });
put('_claude/builds/store.json', `${JSON.stringify({ $axf: 'builds@1', builds: [B('green'), B('red'), B('behind'), B('clash'), B('fresh')] })}\n`);
put('shared.ts', 'export const a = 1;\n'); commit('base'); sh(['push', '-q', 'origin', 'main'], repo);
const branch = (id, fn) => { sh(['checkout', '-q', '-b', `claude/${id}`, 'main'], repo); fn(); commit(`${id} work`); sh(['push', '-q', 'origin', `claude/${id}`], repo); sh(['checkout', '-q', 'main'], repo); };
branch('behind', () => put('behind.ts', 'x\n'));
branch('clash', () => put('shared.ts', 'export const a = 2; // clash\n'));
put('shared.ts', 'export const a = 3; // main\n'); commit('main moves in code'); sh(['push', '-q', 'origin', 'main'], repo);
for (const id of ['green', 'red', 'fresh']) branch(id, () => put(`${id}.ts`, 'x\n'));
sh(['fetch', '-q', 'origin'], repo);
const headOf = (br) => sh(['rev-parse', `origin/${br}`], repo);

const T = '2026-11-12T00:00:00Z';
const pr = (n, id, created) => ({ number: n, title: id, created_at: created, head: { ref: `claude/${id}`, sha: headOf(`claude/${id}`), repo: { full_name: 'MossesX/AmberX-AXF' } }, base: { ref: 'main' }, html_url: `u${n}` });
let pulls = [pr(1, 'behind', '2026-11-01T00:00:00Z'), pr(2, 'clash', '2026-11-02T00:00:00Z'), pr(3, 'red', '2026-11-03T00:00:00Z'), pr(4, 'green', '2026-11-04T00:00:00Z')];
const calls = []; const merged = [];
const gh = async (method, path, body) => {
  calls.push(`${method} ${path}`);
  if (method === 'GET' && path.includes('/pulls?state=open')) { for (const p of pulls) p.head.sha = headOf(p.head.ref); return pulls; }
  if (method === 'GET' && path.includes('/check-runs')) {
    const sha = path.split('/commits/')[1].split('/')[0];
    if (sha === headOf('claude/red')) return { check_runs: [{ name: 'Gradle', status: 'completed', conclusion: 'failure' }] };
    return { check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }] };
  }
  if (method === 'PUT' && path.endsWith('/merge')) {
    const n = Number(path.split('/pulls/')[1].split('/')[0]); const p = pulls.find((x) => x.number === n);
    if (body.sha !== headOf(p.head.ref)) { const e = new Error('GitHub 409: head moved'); e.status = 409; throw e; }
    // GitHub's merge: main gets a merge commit of the PR head (done here with plain git on the origin)
    sh(['checkout', '-q', 'main'], repo); sh(['pull', '-q', 'origin', 'main'], repo); sh([...cfg, 'merge', '-q', '--no-ff', '-m', `Merge #${n}`, `origin/${p.head.ref}`], repo); sh(['push', '-q', 'origin', 'main'], repo);
    pulls = pulls.filter((x) => x.number !== n); merged.push(n);
    return { merged: true, sha: sh(['rev-parse', 'HEAD'], repo) };
  }
  if (method === 'DELETE') return null;
  if (method === 'POST' && path.endsWith('/pulls')) { const p = { ...pr(9, body.head.replace('claude/', ''), T) }; pulls.push(p); return p; }
  throw new Error(`unexpected ${method} ${path}`);
};
gh.save = () => {};
const api = async (method, path, body) => { calls.push(`api ${method} ${path}${body?.title ? ` ${body.title}` : ''}`); return path.includes('/ui-hold') ? { hold: '' } : { ok: true }; };
const s = { repo, slug: 'MossesX/AmberX-AXF', dataDir: join(tmp, 'data'), console: 'off', api: '', remote: 'origin', base: 'main' };
mkdirSync(s.dataDir, { recursive: true });
const git = makeGit(repo);
const jobs = [];
const run = () => step({ s, git, gh, api, agentJob: (j) => { jobs.push(j); return { exit: 0 }; } });

// the finished build goes first: `fresh` has no PR yet; finish opens one and puts it at the front
control(s, 'finish', 'fresh');
let st = await run();
check(merged[0] === 9 && calls.some((c) => c === 'POST /repos/MossesX/AmberX-AXF/pulls'), 'merge on finish: a PR is opened for the finished build and it merges first');
check(calls.some((c) => c.includes('api POST /api/alerts') && /Merged: fresh/.test(c)), 'merge on finish: AmberX FYI when it is live');
// next step: #1 is oldest but behind main → main merged into its branch (plain push), then its tests run
const before = headOf('claude/behind');
st = await run();
const after = headOf('claude/behind');
check(st.current?.pr === 1 && st.current.phase === 'testing' && after !== before && sh(['merge-base', '--is-ancestor', before, after], repo) === '', 'behind: main is merged in with a new commit on top (no force-push), tests start over');
st = await run();
check(merged.includes(1), 'behind: merges after its tests pass on the caught-up head');
// #2 conflicts in code with main → blocked with the file named, the fixer gets one job; #3 red → blocked; #4 merges
for (let i = 0; i < 8; i++) { st = await run(); if (!st.current && !st.items.some((x) => x.state === 'ready')) break; }
const ctl = readControl(s);
check(/shared\.ts/.test(ctl.blocked?.[2]?.why || '') && jobs.length === 1 && jobs[0].type === 'land-build', 'conflict: blocked with the file named, one fixer job');
check(/Gradle/.test(ctl.blocked?.[3]?.why || ''), 'failing: blocked with the failing check named');
check(merged.includes(4) && !merged.includes(3) && !merged.includes(2), 'ready: the green PR merges; the red and the conflicted one do not');
st = await run();
check(!st.current && st.items.every((x) => x.state === 'blocked'), 'nothing left in flight; the blocked ones stay blocked at the same head');
check(st.progress?.blocked === 2 && st.merged.length === 3, `progress line: ${st.progress?.text}`);
const log = readGateLog(s, 100);
check(log.some((e) => e.did === 'merged' && e.pr === 4) && log.some((e) => e.did === 'blocked' && e.pr === 3) && log.some((e) => e.did === 'caught up with main' && e.pr === 1), 'gate log: every merge, block and catch-up');
check(!calls.some((c) => /force/.test(c)), 'never a force-push');
// account switches are logged once each and sent as an FYI
const n0 = calls.filter((c) => c.includes('Lander: switched')).length;
await checkAccount({ s, api, accounts: [{ name: 'mossesx-max-', label: 'Moses X', canRun: true }] });
await checkAccount({ s, api, accounts: [{ name: 'mossesx-max-', label: 'Moses X', limited: { until: '5am' } }, { name: 'account-5', label: 'Hulu API', canRun: true }] });
await checkAccount({ s, api, accounts: [{ name: 'mossesx-max-', label: 'Moses X', limited: { until: '5am' } }, { name: 'account-5', label: 'Hulu API', canRun: true }] });
await checkAccount({ s, api, accounts: [{ name: 'mossesx-max-', label: 'Moses X', canRun: true }] });
check(readState(s).account?.account === 'mossesx-max-' && calls.filter((c) => c.includes('Lander: switched')).length - n0 === 2, 'account: Moses X → Hulu API → back to Moses X, one FYI per switch');
check(readGateLog(s, 100).filter((e) => e.gate === 'account switch').length === 3, 'account: every switch in the gate log');

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${ok} passed, ${bad} failed`);
process.exitCode = bad ? 1 : 0;
