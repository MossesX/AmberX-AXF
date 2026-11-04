#!/usr/bin/env node
/**
 * Auto-land self-test (build auto-land, Nov 3 2026). Three parts:
 *   1. zero tokens: nothing in the merge pipeline imports or launches a model client (the build fails if it does);
 *   2. the pure rules (land-core.mjs);
 *   3. whole rounds on fake builds: a throwaway origin + checkout + worktree, fake GitHub, fake console.
 *   node apps/console-web/plugins/push-banner/land/land.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './land-core.mjs';
import { makeGit, round, control, readState, ciOf } from './land.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
let ok = 0; let bad = 0;
const check = (c, m) => { if (c) { ok++; console.log(`  ✓ ${m}`); } else { bad++; console.log(`  ✗ ${m}`); } };

// ------------------------------------------------------------------ 1. zero tokens
console.log('zero tokens: the merge pipeline never calls a model');
const LLM = [/@anthropic-ai\//, /\banthropic\b/i, /\bopenai\b/i, /claude-agent-sdk/, /\bclaude\s+-p\b/, /['"]claude['"]\s*,/, /claude-headless\.sh/, /axf\.llm@1/, /\bllm\b.*\bimport\b|\bimport\b.*\bllm\b/i, /chat[-_]engine/, /swarm-chat/, /\bgenerativeai\b|\bmistral\b|\bollama\b|\bcohere\b/i];
const landFiles = readdirSync(HERE).filter((f) => /\.(mjs|js|ts|py|sh)$/.test(f) && f !== 'land.test.mjs');
for (const f of landFiles) {
  const text = readFileSync(join(HERE, f), 'utf8');
  const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] || m[2] || m[3]);
  const foreign = imports.filter((i) => !i.startsWith('node:') && i !== './land-core.mjs');
  check(!foreign.length, `${f}: imports only node built-ins and land-core.mjs${foreign.length ? ` (found ${foreign.join(', ')})` : ''}`);
  const code = text.replace(/^\s*(\*|\/\/|#).*$/gm, '');
  const hit = LLM.find((re) => re.test(code));
  check(!hit, `${f}: no model client, chat engine or headless launch${hit ? ` (matches ${hit})` : ''}`);
}
// the only way out to an agent is agent-job.mjs, for a code conflict or red CI
const land = readFileSync(join(HERE, 'land.mjs'), 'utf8');
check((land.match(/agent-job\.mjs/g) || []).length >= 1 && /if \(it\.reason\?\.agent/.test(land), 'land.mjs hands work to an agent only through agent-job.mjs, only when the reason needs a code change');
const server = readFileSync(join(PLUGIN, 'server', '__init__.py'), 'utf8');
const pyImports = [...server.matchAll(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm)].map((m) => m[1] || m[2]);
check(!pyImports.some((m) => /anthropic|openai|llm|chat|swarm/i.test(m)), 'push banner server (auto-merge) imports no model client');
check(/"claudeOnFail": raw.get\("claudeOnFail"\) is True/.test(server), 'Fix with Claude stays off unless switched on (the only Claude path in the banner)');

// ------------------------------------------------------------------ 2. pure rules
console.log('rules (land-core.mjs)');
check(core.classifyPath('_claude/builds/store.json') === 'builds' && core.classifyPath('_claude/builds/journal/2026-11.jsonl') === 'builds', 'builds store + journal = builds files');
check(core.classifyPath('_claude/THREADS.md') === 'union' && core.classifyPath('deploy.log') === 'union', 'THREADS + logs = union');
check(core.classifyPath('tracker.json') === 'generated' && core.classifyPath('changes/2026/11/x.json') === 'generated', 'tracker + hub data copies = generated');
check(core.classifyPath('framework/core/x.ts') === 'code' && core.classifyPath('deploy/claude-headless.sh') === 'code', 'everything else = code');
const sp = core.strayPlan(' M _claude/builds/store.json\n?? .brief.md\n?? auto-land.jsonl\n?? _claude/dup.md\n M framework/core/a.ts\n?? notes.txt\n M changes/2026/11/c.json\n M _claude/shared/x.md', (p) => p === '_claude/dup.md' || p === '_claude/shared/x.md');
check(sp.commit.join() === '_claude/builds/store.json,changes/2026/11/c.json', 'synced data the build wrote is committed on its branch');
check(sp.skip.join() === '.brief.md,auto-land.jsonl', '.brief.md and top-level jsonl/logs are skipped');
check(sp.archive.join() === '_claude/dup.md' && sp.restore.join() === '_claude/shared/x.md', 'copies of hub files are backed up (untracked moved, tracked put back)');
check(sp.code.join() === 'framework/core/a.ts' && sp.keep.join() === 'notes.txt', 'uncommitted code is reported, other untracked files left alone');
check(core.strayPlan(' M _claude/builds/journal/2026-11.jsonl').commit.length === 1, 'a journal deep in _claude/ is data, not a scratch log');

const B = (id, o = {}) => ({ id, title: id, branch: `claude/${id}`, status: 'built', steps: [{ id: 's1', done: true }], notes: [], ...o });
check(core.isCandidate(B('a')) && core.isCandidate(B('b', { status: 'running' })), 'built, or every step done = a candidate');
check(!core.isCandidate(B('c', { mergedAt: 'x' })) && !core.isCandidate(B('d', { status: 'complete' })) && !core.isCandidate(B('e', { branch: '' })) && !core.isCandidate(B('f', { status: 'running', steps: [{ done: false }] })), 'merged, complete, no branch or steps left = not a candidate');
const ub = core.uniqueByBranch([B('one', { branch: 'claude/x' }), B('one-done', { branch: 'claude/x' }), B('two')]);
check(ub.length === 2 && ub[0].alsoBuilds.join() === 'one-done', 'two builds on one branch land once (the first), the other named');
check(core.MAX_MAIN_MERGES >= 1 && core.MAX_MAIN_MERGES <= 5, 'main is merged into a few branches a round, not all at once');
const ids = new Set(['land-everything', 'x', 'y']);
check(core.noteDeps(B('x', { notes: [{ text: "Land after land-everything's other PRs." }] }), ids).join() === 'land-everything', '"Land after X" in a note = a dependency');
check(core.noteDeps(B('x', { detail: 'merge after nobody-knows' }), ids).length === 0, 'unknown ids are ignored');
const ord = core.landOrder([B('new', { builtAt: '2026-11-03' }), B('old', { builtAt: '2026-11-01' }), B('dep', { builtAt: '2026-10-01', notes: [{ text: 'land after new' }] })]);
check(ord.map((o) => o.id).join() === 'old,new,dep' && ord[2].after.join() === 'new', 'oldest first, a dependency goes after what it waits for');
const ord2 = core.landOrder([B('top', { builtAt: '1' }), B('base', { builtAt: '2' })], { contains: (a, b) => a.id === 'top' && b.id === 'base' });
check(ord2.map((o) => o.id).join() === 'base,top', 'a branch built on top of another lands after it');
const cyc = core.landOrder([B('p', { builtAt: '1', notes: [{ text: 'land after q' }] }), B('q', { builtAt: '2', notes: [{ text: 'land after p' }] })], {});
check(cyc.length === 2, 'a cycle still lands both (oldest first)');
check(core.statusOnly(['Builds live: a [skip ci]'], ['_claude/builds/store.json']) && !core.statusOnly(['Fix [skip ci]'], ['framework/x.ts']) && !core.statusOnly(['Fix'], ['_claude/x']), 'status-only = all [skip ci] and all under _claude/');
const kinds = [['held', { held: 'later' }], ['code', { code: ['a.ts'] }], ['conflict', { conflicts: ['a.ts'] }], ['push', { pushError: 'x' }], ['pr', { prError: 'x' }], ['dependency', { deps: ['y'] }], ['ci', { ci: 'failure', failing: ['Gradle'] }], ['ui', { ci: 'success', ui: 'waiting' }], ['running', { ci: 'running' }]];
for (const [k, f] of kinds) check(core.blockReason('b', f)?.kind === k, `reason ${k}: ${core.blockReason('b', f)?.text}`);
check(core.blockReason('b', { ci: 'success', ui: '' }) === null, 'green + UI free = nothing holds it');
check(core.blockReason('b', { ci: 'success', ui: 'waiting', waitUi: false }) === null, 'Wait for UI Review off = UI Review does not hold it');
check(core.blockReason('b', { conflicts: ['a'] }).agent && core.blockReason('b', { ci: 'failure' }).agent && !core.blockReason('b', { ui: 'waiting', ci: 'success' }).agent && !core.blockReason('b', { deps: ['y'] }).agent, 'only a code conflict or red CI asks for an agent');
const r1 = core.blockReason('b', { ui: 'waiting', ci: 'success' });
check(core.shouldPush(null, r1, 'h1') && !core.shouldPush({ kind: 'ui', head: 'h1' }, r1, 'h1') && core.shouldPush({ kind: 'ui', head: 'h1' }, r1, 'h2') && !core.shouldPush(null, core.blockReason('b', { ci: 'running' }), 'h'), 'one push per reason and head; never for a quiet wait');
const al = core.alertFor(core.blockReason('b', { ci: 'failure', failing: ['Gradle'] }), { pr: '#9' });
check(al.key === 'land:b' && al.severity === 'error' && /CI is red \(Gradle\)/.test(al.title) && /PR #9/.test(al.body), 'the alert says what broke in plain words, one key per build');
check(core.agentJobFor(B('b'), core.blockReason('b', { conflicts: ['a'] }))?.type === 'land-build' && core.agentJobFor(B('b'), r1) === null, 'agent job only for conflict / red CI');
let d = core.applyControl(null, 'hold', 'b', { why: 'wait' });
check(d.holds.b.why === 'wait', 'hold');
d = core.applyControl(d, 'now', 'b');
check(!d.holds.b && d.now[0] === 'b', 'now releases a hold and goes first');
d = core.applyControl(d, 'after', 'b', { after: 'a' });
check(d.after.b.join() === 'a', 'after records a dependency');
let threw = false; try { core.applyControl(d, 'hold', '../x'); } catch { threw = true; }
check(threw, 'a bad build id is refused');
check(ciOf([{ name: 'CodeRabbit', app: { slug: 'coderabbitai' }, status: 'completed', conclusion: 'skipped' }]).ci === 'none', 'a skipped CodeRabbit run is not CI');
check(ciOf([{ name: 'Gradle', status: 'completed', conclusion: 'failure' }, { name: 'Web', status: 'completed', conclusion: 'success' }]).failing.join() === 'Gradle', 'failing checks are named');

// commands declared once: CLI, REST routes, plugin.json commands
const manifest = JSON.parse(readFileSync(join(PLUGIN, 'plugin.json'), 'utf8'));
for (const c of core.LAND_COMMANDS) {
  check(server.includes(`@router.${c.method.toLowerCase()}("${c.path}")`), `${c.id}: REST ${c.method} ${c.path} exists`);
  check((manifest.commands?.items || []).some((i) => i.id === c.id && i.route === `${c.method} ${c.path}`), `${c.id}: declared in plugin.json commands (MCP + console commands)`);
  check(land.includes(`cmd === '${c.cli}'`) || land.includes('core.LAND_COMMANDS.find((c) => c.cli === cmd)'), `${c.id}: CLI land.mjs ${c.cli}`);
}

// ------------------------------------------------------------------ 3. whole rounds on fake builds
console.log('rounds on fake builds');
const tmp = mkdtempSync(join(tmpdir(), 'axf-land-test-'));
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const origin = join(tmp, 'origin.git'); const repo = join(tmp, 'repo'); const projects = join(tmp, 'projects');
sh(['init', '-q', '--bare', '-b', 'main', origin], tmp);
sh(['clone', '-q', origin, repo], tmp);
const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const put = (p, t, cwd = repo) => { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), t); };
const commit = (msg, cwd = repo) => { sh(['add', '-A'], cwd); sh([...cfg, 'commit', '-q', '-m', msg], cwd); };
const store = (builds) => `${JSON.stringify({ $axf: 'builds@1', builds }, null, 1)}\n`;
const builds = [
  B('ok', { builtAt: '2026-11-01T00:00:00Z' }),
  B('clash', { builtAt: '2026-11-01T01:00:00Z' }),
  B('logs', { builtAt: '2026-11-01T02:00:00Z' }),
  B('later', { builtAt: '2026-11-01T03:00:00Z', notes: [{ text: 'Land after ok.' }] }),
  B('held', { builtAt: '2026-11-01T04:00:00Z' }),
  B('ui', { builtAt: '2026-11-01T05:00:00Z' }),
  B('green', { builtAt: '2026-11-01T06:00:00Z' }),
  B('wt', { builtAt: '2026-11-01T07:00:00Z' }),
  B('busy', { status: 'running', steps: [{ id: 's1', done: false }] }),
];
put('project.manifest.json', JSON.stringify({ name: 'proj', data: { shared: ['changes/'] } }));
put('_claude/builds/store.json', store(builds)); put('_claude/THREADS.md', '# Threads\n- base\n'); put('shared.ts', 'export const a = 1;\n'); put('app.ts', 'one\n');
commit('base'); sh(['push', '-q', 'origin', 'main'], repo);
const branch = (id, fn) => { sh(['checkout', '-q', '-b', `claude/${id}`, 'main'], repo); fn(); commit(`${id} work`); sh(['push', '-q', 'origin', `claude/${id}`], repo); sh(['checkout', '-q', 'main'], repo); };
branch('clash', () => put('shared.ts', 'export const a = 2; // clash branch\n'));
branch('logs', () => { put('_claude/THREADS.md', '# Threads\n- base\n- logs thread\n'); put('logs.ts', 'x\n'); });
branch('wt', () => put('wt.ts', 'x\n'));
// main moves on in code (clashes with `clash`, a THREADS line); the next builds branch off it; then status-only commits
put('shared.ts', 'export const a = 3; // main\n'); put('_claude/THREADS.md', '# Threads\n- base\n- main thread\n'); commit('main code change');
sh(['push', '-q', 'origin', 'main'], repo);
for (const id of ['ok', 'later', 'held', 'ui', 'green']) branch(id, () => put(`${id}.ts`, `export const ${id} = 1;\n`));
put('_claude/builds/store.json', store(builds.map((b) => (b.id === 'busy' ? { ...b, notes: [{ text: 'tick' }] } : b)))); commit('Builds live: busy note (urgent) [skip ci]');
sh(['push', '-q', 'origin', 'main'], repo);
// the `wt` build's worktree, with what claude-sync and the session left behind
const wtDir = join(tmp, 'wt-wt');
sh(['worktree', 'add', '-q', wtDir, 'claude/wt'], repo);
put('.brief.md', 'brief', wtDir); put('wt.jsonl', '{}\n', wtDir); put('_claude/memory/docs/wt.md', 'report\n', wtDir);
put('_claude/dropped.md', 'hub copy\n', wtDir); put('proj/_claude/dropped.md', 'hub copy\n', projects); // claude-sync's drop
const old = new Date(Date.now() - 3600e3); for (const p of ['_claude/memory/docs/wt.md']) spawnSync('touch', ['-d', old.toISOString(), join(wtDir, p)]);

// fake GitHub + console
const pulls = [{ number: 51, head: { ref: 'claude/ui', repo: { full_name: 'MossesX/AmberX-AXF' } }, base: { ref: 'main' }, html_url: 'u51' },
  { number: 52, head: { ref: 'claude/green', repo: { full_name: 'MossesX/AmberX-AXF' } }, base: { ref: 'main' }, html_url: 'u52' }];
const calls = { gh: [], api: [], jobs: [] };
const headOf = (br) => sh(['rev-parse', `origin/${br}`], repo);
const gh = async (method, path, body) => {
  calls.gh.push(`${method} ${path}`);
  if (method === 'GET' && path.includes('/pulls?state=open')) return pulls;
  if (method === 'GET' && /\/pulls\/\d+$/.test(path)) return { mergeable: true };
  if (method === 'POST' && path.endsWith('/pulls')) { const n = 60 + pulls.length; const p = { number: n, head: { ref: body.head, repo: { full_name: 'MossesX/AmberX-AXF' } }, base: { ref: 'main' }, html_url: `u${n}` }; pulls.push(p); return p; }
  if (method === 'GET' && path.includes('/check-runs')) {
    const sha = path.split('/commits/')[1].split('/')[0];
    if (sha === headOf('claude/ui') || sha === headOf('claude/green')) return { check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }] };
    if (sha === headOf('claude/later')) return { check_runs: [{ name: 'Gradle', status: 'completed', conclusion: 'failure' }] };
    return { check_runs: [{ name: 'CodeRabbit', app: { slug: 'coderabbitai' }, status: 'completed', conclusion: 'skipped' }] };
  }
  if (method === 'POST' && path.includes('/dispatches')) return null;
  throw new Error(`unexpected ${method} ${path}`);
};
const api = async (method, path, body) => { calls.api.push({ method, path, body }); if (path.includes('/ui-hold')) return path.includes('claude%2Fui') ? { hold: 'waiting' } : { hold: '' }; return { ok: true }; };
const s = { repo, slug: 'MossesX/AmberX-AXF', dataDir: join(tmp, 'data'), archive: join(tmp, 'archive'), console: 'off', api: '', workflow: 'android.yml', projects, remote: 'origin', base: 'main' };
mkdirSync(s.dataDir, { recursive: true });
control(s, 'hold', 'held', { why: 'Brett wants to look first' });
const git = makeGit(repo);
const st = await round({ s, git, gh, api, agentJob: (job) => { calls.jobs.push(job); return { job: job.type, exit: 0 }; } });
const by = Object.fromEntries(st.items.map((x) => [x.id, x]));
check(!by.busy, 'a build with steps left is not landed');
check(st.items.map((x) => x.id).indexOf('later') > st.items.map((x) => x.id).indexOf('ok'), 'landing order: `later` after `ok` (its note)');
check(by.ok?.state === 'waiting' && by.ok.reason?.kind === 'running' && by.ok.pr && calls.gh.some((c) => c.startsWith('POST') && c.endsWith('/pulls')), 'ok: behind only by status data = no merge, PR opened, waiting on CI');
check(calls.gh.some((c) => c.includes('/actions/workflows/android.yml/dispatches')) && by.ok.dispatched === headOf('claude/ok'), 'ok: no CI on its head (CodeRabbit skipped only) = CI started once');
check(by.clash?.state === 'blocked' && by.clash.reason.kind === 'conflict' && by.clash.reason.files.join() === 'shared.ts', 'clash: a code conflict blocks it, file named');
check(calls.jobs.some((j) => j.input.build === 'clash' && j.type === 'land-build') && by.clash.agent, 'clash: one agent job for the code conflict');
check(calls.api.some((c) => c.path === '/api/alerts' && c.body.key === 'land:clash' && /conflicts in code \(shared\.ts\)/.test(c.body.title)), 'clash: one push to Brett in plain words');
const logsThreads = sh(['show', 'origin/claude/logs:_claude/THREADS.md'], repo);
check(by.logs?.mergedMain && /logs thread/.test(logsThreads) && /main thread/.test(logsThreads), 'logs: main merged in, THREADS lines from both sides kept (union), pushed');
check(sh(['show', 'origin/claude/logs:shared.ts'], repo).includes('main'), 'logs: it now has main\'s code');
check(by.later?.reason?.kind === 'dependency' && /waits for ok/.test(by.later.reason.text), 'later: waits for its dependency (before its red CI is even looked at)');
check(by.held?.reason?.kind === 'held' && /Brett wants to look first/.test(by.held.reason.text) && !calls.gh.some((c) => c.includes('claude%2Fheld')), 'held: held by hand, nothing done to it');
check(by.ui?.state === 'blocked' && by.ui.reason.kind === 'ui' && by.ui.pr === 51, 'ui: CI green, UI Review waiting = held, says so');
check(by.green?.state === 'ready' && by.green.reason === null && by.green.pr === 52, 'green: CI green, UI free = ready (the push banner merges it)');
check(st.order[0] && st.managed.includes(52), 'land.json gives the push banner the order and the PRs it manages');
check(!existsSync(join(wtDir, '_claude/dropped.md')) && readFileSync(join(s.archive, 'wt/_claude/dropped.md'), 'utf8') === 'hub copy\n', 'wt: claude-sync\'s copy backed up to the archive and removed');
check(existsSync(join(wtDir, '.brief.md')) && sh(['log', '--name-only', '--format=', '-5', 'origin/claude/wt'], repo).includes('_claude/memory/docs/wt.md'), 'wt: the report it left was committed on its branch and pushed; .brief.md skipped');
check(!sh(['log', '--name-only', '--format=', '-5', 'origin/claude/wt'], repo).includes('wt.jsonl'), 'wt: the jsonl log was not committed');
check(existsSync(join(wtDir, '.claude-sync-hold')), 'wt: claude-sync is told to leave the finished worktree alone');
// second round: nothing new = no second push, no second agent job
const pushes = calls.api.filter((c) => c.path === '/api/alerts').length; const jobs = calls.jobs.length; const ghBefore = calls.gh.length;
const st2 = await round({ s, git, gh, api, agentJob: (job) => { calls.jobs.push(job); return { exit: 0 }; } });
check(calls.api.filter((c) => c.path === '/api/alerts').length === pushes && calls.jobs.length === jobs, 'round 2: the same reasons are not pushed again, no second agent job');
check(st2.items.find((x) => x.id === 'clash').since === by.clash.since, 'round 2: "since" stays');
const asked = calls.gh.slice(ghBefore);
check(!asked.some((c) => c.includes(headOf('claude/green')) || c.includes('/pulls/52')), 'round 2: a head whose CI already finished is not asked again (shared token)');
// release the hold; a code change in a worktree blocks it
control(s, 'release', 'held');
put('wt.ts', 'changed but never committed\n', wtDir); spawnSync('touch', ['-d', old.toISOString(), join(wtDir, 'wt.ts')]);
const st3 = await round({ s, git, gh, api, agentJob: () => ({ exit: 0 }) });
check(st3.items.find((x) => x.id === 'held').reason?.kind !== 'held', 'release: the build lands again');
check(st3.items.find((x) => x.id === 'wt').reason?.kind === 'code', 'wt: code changed in the worktree and never committed = it waits and says so');
// once merged it leaves the list and its alert goes
const merged = JSON.parse(readFileSync(join(repo, '_claude/builds/store.json'), 'utf8'));
sh(['checkout', '-q', 'main'], repo); sh(['pull', '-q', 'origin', 'main'], repo);
put('_claude/builds/store.json', store(merged.builds.map((b) => (b.id === 'clash' ? { ...b, status: 'complete', mergedAt: '2026-11-03T00:00:00Z' } : b)))); commit('Builds live: clash merged [skip ci]'); sh(['push', '-q', 'origin', 'main'], repo);
await round({ s, git, gh, api, agentJob: () => ({ exit: 0 }) });
check(!readState(s).items.some((x) => x.id === 'clash') && calls.api.some((c) => c.path === '/api/alerts/resolve' && c.body.keys.includes('land:clash')), 'merged: off the list, its alert resolved');
// switched off: nothing happens
writeFileSync(join(s.dataDir, 'config.json'), JSON.stringify({ autoLand: false }));
const n = calls.gh.length;
const off = await round({ s, git, gh, api });
check(off.on === false && calls.gh.length === n, 'Auto-land finished builds off = the runner does nothing');

rmSync(tmp, { recursive: true, force: true });
console.log(`auto-land: ${ok} checks passed${bad ? `, ${bad} FAILED` : ''}`);
if (bad) process.exitCode = 1;
