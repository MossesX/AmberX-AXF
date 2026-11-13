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
import { makeGit, round, control, readState, readControl, ciOf, reasonEvent, badJson, takeLandLock, dropLandLock, serial, lockOwner, requestFix, refreshRunning, sweep, readFixes } from './land.mjs';
import { finishedBy, onBuildEvents } from './hook.mjs';
process.env.AXF_CREW_SAY = 'off'; // group-chat posts (crew-say.mjs) stay out of the real Breakroom

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = dirname(HERE);
let ok = 0; let bad = 0;
const check = (c, m) => { if (c) { ok++; console.log(`  ✓ ${m}`); } else { bad++; console.log(`  ✗ ${m}`); } };

// ------------------------------------------------------------------ 1. zero tokens
console.log('zero tokens: the merge pipeline never calls a model');
const LLM = [/@anthropic-ai\//, /\banthropic\b/i, /\bopenai\b/i, /claude-agent-sdk/, /\bclaude\s+-p\b/, /['"]claude['"]\s*,/, /claude-headless\.sh/, /axf\.llm@1/, /\bllm\b.*\bimport\b|\bimport\b.*\bllm\b/i, /chat[-_]engine/, /swarm-chat/, /\bgenerativeai\b|\bmistral\b|\bollama\b|\bcohere\b/i];
const landFiles = readdirSync(HERE).filter((f) => /\.(mjs|js|ts|py|sh)$/.test(f) && !/\.test\.mjs$/.test(f));
// the generated-files manifest (generated-files@1) is data, not code: the one import from outside this folder
const LOCAL = new Set(['./land-core.mjs', './land.mjs', './merge-queue-core.mjs', './merge-queue.mjs', '../../../../../framework/spec/generated-files.json']);
for (const f of landFiles) {
  const text = readFileSync(join(HERE, f), 'utf8');
  const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] || m[2] || m[3]);
  const foreign = imports.filter((i) => !i.startsWith('node:') && !LOCAL.has(i));
  check(!foreign.length, `${f}: imports only node built-ins and this folder${foreign.length ? ` (found ${foreign.join(', ')})` : ''}`);
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
// generated-files@1 (build lander-regenerates-generated-files-clash, Nov 13 2026): the Nov 13 land failures were all in these
const GEN = ['apps/console-web/src/control/inventory.json', 'apps/console-web/src/assets/help/framework.json', 'apps/axhub-web/src/axf/assets/help/framework.json', 'apps/molly/src/axf/core/runtime.ts', 'apps/console-web/axf.lock.json', 'framework/spec/fixtures/theme.json'];
check(GEN.every((p) => core.classifyPath(p) === 'generated'), 'control inventory, baked help, baked framework copies, locks, fixtures = generated');
check(core.classifyPath('framework/assets/help/framework.json') === 'union-json' && core.classifyPath('framework/catalog/status.json') === 'union-json', 'help packs + catalog status = union by key');
check(core.classifyPath('framework/spec/PORTING.md') === 'union', 'PORTING.md = union of lines');
check(core.regenFor('apps/console-web/src/control/inventory.json')?.join(' ') === 'node apps/console-web/scripts/control-inventory.mjs', 'the control inventory regenerates with its script');
check(core.regenFor('apps/molly/src/axf/core/runtime.ts')?.join(' ') === 'node framework/cli/rebake.mjs apply apps/molly' && core.regenFor('apps/demo/axf.lock.json')?.join(' ') === 'node framework/cli/rebake.mjs apply apps/demo', 'a baked copy or lock re-bakes its own app');
check(core.regenFor('framework/spec/fixtures/theme.json')?.join(' ') === 'npx -y tsx framework/spec/gen-fixtures.mts' && core.regenFor('apps/axhub-web/src/assets/help/framework.json')?.join(' ') === 'node framework/cli/help-coverage.mjs --sync', 'fixtures and baked help have their generators');
check(core.regenFor('changes/2026/11/x.json') === null && core.regenFor('framework/core/x.ts') === null, "main's copy is enough for hub data copies; code has no generator");
{
  const plan = core.regenPlan(['apps/molly/src/axf/core/a.ts', 'apps/molly/axf.lock.json', 'apps/molly/src/axf/ui/axf.css', 'apps/demo/axf.lock.json', 'framework/spec/fixtures/a.json', 'framework/spec/fixtures/b.json', 'changes/2026/11/x.json']);
  check(plan.map((g) => g.id).join(' ') === 'rebake:molly rebake:demo fixtures', `each generator once, per app for re-bakes (${plan.map((g) => g.id).join(' ')})`);
  check(plan[0].outputs.join(' ') === 'apps/molly/src/axf apps/molly/axf.lock.json' && plan[2].timeoutMs === 300000 && Array.isArray(plan[2].check), 'a generator knows its outputs, check and time limit');
  const pc = core.planConflicts(['framework/catalog/status.json', 'framework/spec/PORTING.md', 'apps/console-web/src/control/inventory.json', 'framework/core/x.ts', '_claude/builds/store.json']);
  check(pc.unionJson.length === 1 && pc.union.length === 1 && pc.generated.length === 1 && pc.code.length === 1 && pc.builds.length === 1, 'planConflicts sorts every kind');
  check(core.landTests().length >= 1 && core.landTests().every((t) => Array.isArray(t) && t[0] === 'node'), 'tests after regenerating are node commands from the manifest');
}
// 3-way JSON merge by key: both sides' additions kept, a deletion on one side holds, main wins a scalar clash
{
  const base = { a: { status: 'planned' }, b: { status: 'built' }, c: { status: 'built' } };
  const ours = { a: { status: 'built' }, b: { status: 'built' }, d: { status: 'partial' } };
  const theirs = { a: { status: 'partial' }, b: { status: 'built' }, c: { status: 'built' }, e: { status: 'built' } };
  const m = core.mergeJson3(base, ours, theirs, 'theirs');
  check(m.d?.status === 'partial' && m.e?.status === 'built' && !('c' in m) && m.a.status === 'partial' && m.b.status === 'built', `catalog status unions by key (${JSON.stringify(m)})`);
  const lists = core.mergeJson3({ items: [{ id: 'x', n: 1 }] }, { items: [{ id: 'x', n: 2 }, { id: 'y' }] }, { items: [{ id: 'x', n: 1 }, { id: 'z' }] }, 'theirs');
  check(lists.items.map((i) => i.id).join('') === 'xyz' && lists.items[0].n === 2, 'id lists merge by id; an unchanged side yields to the changed one');
  check(core.mergeJson3(undefined, { k: 1 }, { k: 2 }, 'ours').k === 1 && core.mergeJson3(undefined, [1, 2], [2, 3]).join('') === '123', 'no base: prefer picks a scalar, plain lists union');
}
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
// these rounds check auto-land's own main merging; with the merge queue on, main is combined in on queue branches instead (merge-queue.test.mjs)
writeFileSync(join(s.dataDir, 'config.json'), JSON.stringify({ mergeQueue: false, autoLand: true }));
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
writeFileSync(join(s.dataDir, 'config.json'), JSON.stringify({ autoLand: false, autoLandRev: core.AUTO_LAND_REV }));
const n = calls.gh.length;
const off = await round({ s, git, gh, api });
check(off.on === false && calls.gh.length === n, 'Auto-land finished builds off = the runner does nothing');
writeFileSync(join(s.dataDir, 'config.json'), JSON.stringify({}));
const dflt = await round({ s, git, gh, api, agentJob: () => ({ exit: 0 }) });
check(dflt.on === true, 'Auto-land is on by default for every build (Nov 13 2026)');
writeFileSync(join(s.dataDir, 'config.json'), JSON.stringify({ autoLand: false }));
check((await round({ s, git, gh, api, agentJob: () => ({ exit: 0 }) })).on === true, 'an off written before autoLandRev 2 (the Nov 4 off) reads as on');

// running builds: main merged in every 30 minutes, in their own clean worktree
{
  sh(['checkout', '-q', 'main'], repo); sh(['pull', '-q', 'origin', 'main'], repo);
  branch('run', () => put('run.ts', 'x\n'));
  branch('dirty', () => put('dirty.ts', 'x\n'));
  const runWt = join(tmp, 'wt-run'); const dirtyWt = join(tmp, 'wt-dirty');
  sh(['worktree', 'add', '-q', runWt, 'claude/run'], repo); sh(['worktree', 'add', '-q', dirtyWt, 'claude/dirty'], repo);
  put('dirty.ts', 'session mid-edit\n', dirtyWt);
  put('main2.ts', 'new main code\n'); commit('main moves in code again'); sh(['push', '-q', 'origin', 'main'], repo);
  git(['fetch', '-q', 'origin']);
  const running = [{ id: 'run', status: 'running', branch: 'claude/run', steps: [{ id: 's1', done: true }, { id: 's2', done: false }] },
    { id: 'dirty', status: 'running', branch: 'claude/dirty', steps: [{ id: 's1', done: false }] }];
  check(core.refreshDue(running, {}, Date.now()).length === 2 && core.refreshDue(running, { run: { at: new Date().toISOString() } }, Date.now()).map((b) => b.id).join() === 'dirty', 'refresh due: never refreshed, or 30 min ago');
  const r = refreshRunning({ s, git, builds: running });
  check(r.builds.run?.state === 'merged' && existsSync(join(runWt, 'main2.ts')) && sh(['show', 'origin/claude/run:main2.ts'], repo) === 'new main code', 'run: main merged into its own worktree and pushed');
  check(r.builds.dirty?.state === 'skipped' && /uncommitted/.test(r.builds.dirty.why) && !existsSync(join(dirtyWt, 'main2.ts')), 'dirty: a session mid-edit is left alone until next turn');
  const r2 = refreshRunning({ s, git, builds: running });
  check(r2.builds.run.at === r.builds.run.at, 'not again within 30 minutes');
  const r3 = refreshRunning({ s, git, builds: [] });
  check(!Object.keys(r3.builds).length, 'a build that stopped running is forgotten');
}
rmSync(tmp, { recursive: true, force: true });
console.log('per-build switch: on unless switched off');
{
  let d = core.applyControl({}, 'off', 'feat-x', { why: 'not yet', at: 't1' });
  check(!core.buildOn(d, 'feat-x') && core.buildOn(d, 'feat-y') && d.off['feat-x'].why === 'not yet', 'off switches one build off, the rest stay on');
  d = core.applyControl(d, 'on', 'feat-x');
  check(core.buildOn(d, 'feat-x'), 'on switches it back on');
  check(core.autoLandOn({}) && core.autoLandOn({ autoLand: false }) && !core.autoLandOn({ autoLand: false, autoLandRev: core.AUTO_LAND_REV }), 'autoLandOn: default on; only an off at rev 2 counts');
}
console.log('finish hook: a build lands the moment it finishes');
{
  const steps = (d) => d.map((x, i) => ({ id: `s${i + 1}`, done: x }));
  const builds = [{ id: 'fin', branch: 'claude/fin', status: 'running', steps: steps([true, true]) }, { id: 'half', branch: 'claude/half', status: 'running', steps: steps([true, false]) }, { id: 'nob', status: 'built', steps: [] }];
  const ev = (event, id, extra = {}) => ({ event, build: { id, branch: builds.find((b) => b.id === id)?.branch }, ...extra });
  check(JSON.stringify(finishedBy([ev('step-done', 'fin'), ev('step-done', 'half')], builds)) === '["fin"]', 'the step that leaves every step done finishes the build; one with steps left does not');
  check(JSON.stringify(finishedBy([ev('status', 'half', { to: 'built' }), ev('status', 'nob', { to: 'built' })], builds)) === '["half"]', 'status → built finishes it; a build with no branch has nothing to land');
  const dd = mkdtempSync(join(tmpdir(), 'axf-land-hook-'));
  const was = process.env.AXF_PUSH_BANNER_DIR; process.env.AXF_PUSH_BANNER_DIR = dd;
  const started = [];
  const r1 = onBuildEvents([ev('status', 'half', { to: 'built' })], { env: { ...process.env }, builds, start: (id) => { started.push(id); return true; } });
  check(r1.landing[0] === 'half' && started[0] === 'half' && readControl({ dataDir: dd }).now[0] === 'half', 'finished: first in the landing line (now) and a round started for it');
  const r2 = onBuildEvents([ev('status', 'half', { to: 'built' })], { env: { ...process.env }, builds, start: (id) => { started.push(id); return true; } });
  check(r2.landing.length === 0 && started.length === 1, 'a replayed event is not asked twice');
  writeFileSync(join(dd, 'land-control.json'), JSON.stringify({ off: { half: { why: 'x' } } }));
  check(readControl({ dataDir: dd }).off.half.why === 'x', 'per-build off is read by the hook');
  writeFileSync(join(dd, 'config.json'), JSON.stringify({ autoLand: false, autoLandRev: core.AUTO_LAND_REV }));
  check(onBuildEvents([ev('status', 'half', { to: 'built' })], { env: { ...process.env }, start: () => true }).off === true, 'auto-land off: the hook does nothing');
  check(onBuildEvents([], { env: { AXF_LAND_HOOK: 'off' } }).landing.length === 0, 'AXF_LAND_HOOK=off: nothing');
  if (was === undefined) delete process.env.AXF_PUSH_BANNER_DIR; else process.env.AXF_PUSH_BANNER_DIR = was;
  mkdirSync(join(dd, 'j'), { recursive: true }); writeFileSync(join(dd, 'j/a.json'), '{"ok":1}'); writeFileSync(join(dd, 'j/b.json'), '{"ok":');
  check(JSON.stringify(badJson(dd, ['j/a.json', 'j/b.json', 'j/c.md'])) === '["j/b.json"]', 'check JSON: a settled file that does not parse is found');
  rmSync(dd, { recursive: true, force: true });
}
console.log('serial landing line: two landings never race');
{
  const ld = mkdtempSync(join(tmpdir(), 'axf-land-lock-'));
  process.env.AXF_LAND_LOCK = join(ld, 'lock.d');
  check(await takeLandLock({ who: 'first' }), 'the first landing takes the line');
  check(!(await takeLandLock({ wait: 0 })) && lockOwner().includes('first'), 'a second one finds it busy and sees who lands');
  const order = [];
  const second = serial(async () => { order.push('second'); }, { wait: 3000, who: 'second' });
  await new Promise((r) => setTimeout(r, 200)); order.push('first done'); dropLandLock();
  const r = await second;
  check(r.ran && order.join(',') === 'first done,second', 'a waiting landing goes once the line is free, never alongside');
  check(!lockOwner(), 'the line is free again after it');
  mkdirSync(process.env.AXF_LAND_LOCK);
  check(await takeLandLock({ stale: 0 }), 'a lock left by a killed run is taken over');
  dropLandLock();
  check(core.REF_LOCK_ERR.test("error: cannot lock ref 'refs/remotes/origin/main': is at 1a2b but expected 3c4d") && !core.REF_LOCK_ERR.test('fatal: not a git repository'), 'a lost ref lock is recognised (retried, not reported)');
  delete process.env.AXF_LAND_LOCK; rmSync(ld, { recursive: true, force: true });
}
console.log('fix builds: a clash or red tests gets a P0 "merge main and land" build, again until it lands');
{
  const B = { id: 'feat-z', title: 'Feat Z', branch: 'claude/feat-z' };
  const clash = core.blockReason('feat-z', { conflicts: ['a.ts', 'b.py'] });
  const fb = core.fixBuildFor(B, clash, { attempt: 2, pr: 77 });
  check(fb.priority === 'P0' && /Merge main and land feat-z \(attempt 2\)/.test(fb.title) && /a\.ts, b\.py/.test(fb.detail) && /claude\/feat-z` \(PR #77\)/.test(fb.detail), 'the fix build: P0, names the files, works on the build\'s own branch and PR');
  check(core.fixDue(null, clash, 'h1') && !core.fixDue({ attempt: 1, head: 'h1', at: new Date().toISOString() }, clash, 'h1'), 'first attempt at once; not again at the same head right away');
  check(core.fixDue({ attempt: 1, head: 'h1', at: new Date().toISOString() }, clash, 'h2'), 'the head moved and it still clashes: next attempt');
  check(core.fixDue({ attempt: 1, head: 'h1', at: new Date(Date.now() - core.FIX_RETRY_MS - 1000).toISOString() }, clash, 'h1') && !core.fixDue({ attempt: 3, head: 'h1', at: new Date(Date.now() - core.FIX_RETRY_MS * 2).toISOString() }, clash, 'h1'), 'a quiet attempt is retried after 90 min, backing off per attempt');
  check(!core.fixDue(null, core.blockReason('feat-z', { ui: 'waiting', ci: 'success' }), 'h1'), 'only a clash or red tests get a fix build');
  const fyi = core.fixFyi(B, clash, { attempt: 2, fixId: 'merge-main-and-land-feat-z' });
  check(fyi.severity === 'info' && /^FYI:/.test(fyi.title) && /Nothing to do/.test(fyi.body), 'Brett gets an FYI, not a question');
  const sent = []; const fapi = async (m, p, b) => { sent.push({ p, b }); return p.endsWith('/land/fix') ? { ok: true, id: 'merge-main-and-land-feat-z', status: 'queued' } : { ok: true }; };
  const sd = { repo: process.cwd(), dataDir: tmpdir() };
  const r = await requestFix({ s: sd, api: fapi, b: B, reason: clash, head: 'h1', pr: 77, prev: null, at: 't', agentJob: () => { throw new Error('no agent when the build is filed'); } });
  check(r.via === 'build' && r.id === 'merge-main-and-land-feat-z' && r.attempt === 1 && sent[0].p === '/api/plugins/push-banner/land/fix' && sent[0].b.priority === 'P0', 'filed through the console as a P0 build');
  check(sent.some((x) => x.p === '/api/alerts' && x.b.severity === 'info'), 'and an FYI alert went out');
  const again = await requestFix({ s: sd, api: fapi, b: B, reason: clash, head: 'h1', pr: 77, prev: r, at: 't' });
  check(again === null, 'not filed twice for the same head');
  const jobs = []; const down = async () => null;
  const fb2 = await requestFix({ s: sd, api: down, b: B, reason: clash, head: 'h2', pr: 77, prev: r, at: 't', agentJob: (j) => { jobs.push(j); return { exit: 0 }; } });
  check(fb2.via === 'agent' && fb2.attempt === 2 && jobs[0].type === 'land-build', 'console down: the agent job takes attempt 2');
}
console.log('sweeper: every 10 minutes, each finished build not on main is landed or gets its fix build');
{
  const kr = core.kickReason('k', 'kicked out: PR 7001 conflicts with main in code (deploy/claude-workers.mjs, a.ts). Merge main in and fix them.');
  check(kr.kind === 'conflict' && kr.files.join() === 'deploy/claude-workers.mjs,a.ts', 'kicked for a clash: the files are read back');
  const kc = core.kickReason('k', 'kicked out: PR 7002 broke CI when tested on top of main (failed: Web Dev Console (React/TS) + Python API, Build engine sweep (Node)). Run: u');
  check(kc.kind === 'ci' && kc.agent, 'kicked for red CI: a code fix');
  check(core.kickReason('k', 'its PR checks are red') === null, 'not kicked: no kick reason');
  const T = Date.parse('2026-11-13T20:00:00Z');
  const items = [{ id: 'kicked', branch: 'claude/kicked', head: 'h', pr: 581, since: '2026-11-13T19:00:00Z', reason: { kind: 'running', quiet: true, text: 'kicked: CI' } },
    { id: 'pushfail', branch: 'claude/pushfail', since: '2026-11-13T19:00:00Z', reason: { kind: 'push', text: 'pushfail: push failed' } },
    { id: 'fresh', branch: 'claude/fresh', since: '2026-11-13T19:55:00Z', reason: { kind: 'push', text: 'fresh: push failed' } },
    { id: 'uiwait', branch: 'claude/uiwait', since: '2026-11-13T18:00:00Z', state: 'blocked', reason: { kind: 'ui', text: 'uiwait: screenshots waiting' } }];
  const waiting = [{ build: 'kicked', pr: 581, head: 'h', why: 'kicked out: PR 7001 conflicts with main in code (a.ts). Merge main in.' }];
  const plan = core.sweepPlan(items, waiting, T);
  check(plan.find((p) => p.id === 'kicked')?.act === 'fix' && plan.find((p) => p.id === 'pushfail')?.act === 'retry' && !plan.some((p) => p.id === 'fresh') && !plan.some((p) => p.id === 'uiwait'), 'plan: kicked → fix build; push failing 30 min → retry; fresh and UI waits left alone');
  const stuck = core.stuckItems(items.map((x) => ({ ...x, state: 'blocked' })), T);
  check(stuck.some((x) => x.id === 'uiwait') && !stuck.some((x) => x.id === 'fresh'), 'stuck over 30 minutes: listed for the banner');
  const sd = { repo: process.cwd(), dataDir: mkdtempSync(join(tmpdir(), 'axf-sweep-')) };
  writeFileSync(join(sd.dataDir, 'land.json'), JSON.stringify({ on: true, items }));
  writeFileSync(join(sd.dataDir, 'merge-queue.json'), JSON.stringify({ waiting }));
  writeFileSync(join(sd.dataDir, 'land.json.tmp-123'), ''); spawnSync('touch', ['-d', '2026-11-01T00:00:00Z', join(sd.dataDir, 'land.json.tmp-123')]);
  const sent = []; const fapi = async (m, p, b) => { sent.push({ p, b }); return p.endsWith('/land/fix') ? { ok: true, id: 'merge-main-and-land-kicked' } : { ok: true }; };
  const r = await sweep({ s: sd, api: fapi, nowMs: T });
  check(r.acted.some((a) => a.id === 'kicked' && a.fix === 'merge-main-and-land-kicked') && readFixes(sd).kicked?.attempt === 1, 'sweep: the kicked build got its P0 fix build, recorded');
  check(readControl(sd).now.includes('pushfail'), 'sweep: the stuck push is first in line again');
  check(r.tmpCleared === 1 && !existsSync(join(sd.dataDir, 'land.json.tmp-123')), 'sweep: leftover .tmp files cleared');
  check((await sweep({ s: sd, api: fapi, nowMs: T + 60000 })).skipped, 'not again within 10 minutes');
  const again = await sweep({ s: sd, api: fapi, nowMs: T + core.SWEEP_MS, force: true });
  check(!again.acted.some((a) => a.act === 'fix'), 'the same kick at the same head is not filed twice');
  rmSync(sd.dataDir, { recursive: true, force: true });
}
console.log('group chat: a landing reason is Brett\'s move, a code fix, or something in the way');
check(['held', 'ui', 'code'].every((k) => reasonEvent(k) === 'waiting'), 'held, UI Review and uncommitted code wait for Brett');
check(['conflict', 'ci', 'error'].every((k) => reasonEvent(k) === 'failed') && ['push', 'pr', 'dependency'].every((k) => reasonEvent(k) === 'blocked'), 'conflicts and red CI failed; push, PR and dependencies blocked');
console.log(`auto-land: ${ok} checks passed${bad ? `, ${bad} FAILED` : ''}`);
if (bad) process.exitCode = 1;
