#!/usr/bin/env node
/** chain-control@1: the registry, its levels and presets, the load plan, handoffs, budgets and the launcher's per-step loop. Scratch folders only; no network, no model. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cc from '../core/chain-control.mjs';
import { createBudget } from '../../deploy/claude-stream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'axf-chain-'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; };
const seed = JSON.parse(readFileSync(join(HERE, '..', 'schemas', 'chain-control.json'), 'utf8'));
const doc = cc.normDoc(null, seed);

/* levels */
eq(doc.preset, 'lean', 'the seed is lean');
eq(Object.keys(doc.presets), ['lean', 'normal', 'full'], 'three built-in presets');
const scoped = cc.applyPatch(cc.applyPatch(doc, { session: { mode: 'per-build' } }, { build: 'b' }), { budget: { stopTokens: 5000 } }, { build: 'b', step: 's2' });
eq(cc.resolve(scoped, {}).config.session.mode, 'per-step', 'the global config is untouched');
eq(cc.resolve(scoped, { build: 'b' }).config.session.mode, 'per-build', 'a build override wins');
eq(cc.resolve(scoped, { build: 'b', step: 's2' }).sources, { 'session.mode': 'build', 'budget.stopTokens': 'step' }, 'sources name the level');
eq(cc.resolve(scoped, { build: 'b', step: 's3' }).config.budget.stopTokens, 0, 'a step override stays on its step');
eq(cc.resolve(cc.clearOverride(scoped, { build: 'b' }), { build: 'b' }).config.session.mode, 'per-step', 'clearing drops it');
eq(cc.applyPatch(doc, { output: { bashChars: 1000 } }).preset, '', 'a hand change leaves the preset');
eq(cc.normConfig({ output: { bashChars: 9e9 } }).output.bashChars, 500000, 'numbers clamp');
eq(cc.normConfig({ session: { mode: 'nope' } }).session.mode, 'per-step', 'a bad choice falls back');
ok(!cc.validPath('../x.md') && cc.validPath('~/.claude/CLAUDE.md'), 'paths stay put');
eq(cc.normPartial({ chain: { files: [{ path: 'a.md', mode: 'never' }, { path: 'b.md', mode: 'wat' }] } }).chain.files, [{ path: 'a.md', mode: 'never' }], 'file modes are checked');

/* the chain */
const found = [{ path: 'CLAUDE.md', chars: 400 }, { path: 'r.md', via: 'import', depth: 1, parent: 'CLAUDE.md', chars: 4000 }, { path: 'p.md', chars: 40 }];
const read = (p) => ({ 'CLAUDE.md': 'x'.repeat(400), 'r.md': 'y'.repeat(4000), 'p.md': 'z'.repeat(40) })[p];
const cfg = (patch) => cc.normConfig(cc.merge(doc.config, patch));
const rows = cc.chainRows(found, cfg({ chain: { files: [{ path: 'p.md', mode: 'always' }, { path: 'r.md', mode: 'never' }] } }));
eq(rows.map((r) => [r.path, r.mode, r.tokens]), [['CLAUDE.md', 'demand', 100], ['r.md', 'never', 1000], ['p.md', 'always', 10]], 'rows in load order with tokens');
const plan = cc.loadPlan(rows, cfg({}), 'BRIEF', read);
ok(!plan.native && plan.append.startsWith('BRIEF') && plan.append.includes('### p.md') && plan.append.includes('- CLAUDE.md (about 100 tokens)'), 'brief, loaded file, on-demand line');
ok(!plan.append.includes('r.md') && plan.dropped.includes('r.md'), 'never = not even named');
const reordered = cc.chainRows(found, cfg({ chain: { defaultMode: 'always', order: ['p.md'] } }));
eq(reordered.map((r) => r.path), ['p.md', 'CLAUDE.md', 'r.md'], 'reorder moves a file up');
ok(!cc.isNative(reordered), 'a reordered chain is composed by us');
const all = cc.chainRows(found, cfg({ chain: { defaultMode: 'always' } }));
ok(cc.isNative(all) && cc.loadPlan(all, cfg({}), 'B', read).native, 'all always, in order = Claude Code loads it');
const tight = cc.loadPlan(cc.chainRows(found, cfg({ chain: { files: [{ path: 'r.md', mode: 'always' }] } })), cfg({ chain: { maxChars: 2000 } }), '', read);
eq(tight.over, ['r.md'], 'over the cap goes on demand, whole');
ok(tight.listed.includes('r.md') && !tight.append.includes('yyy'), 'never cut mid-file');

/* models, files, steps */
eq(cc.suggestModel({ text: 'Add the schema migration' }, doc.config).model, 'fable', 'foundation work suggests Fable');
eq(cc.suggestModel({ text: 'Fix a banner chip' }, doc.config).model, 'opus', 'UI work suggests Opus');
ok(cc.normConfig({ models: { rules: [{ type: 'x', model: 'sonnet', words: ['x'] }] } }).models.rules[0].model !== 'sonnet', 'a Sonnet rule never survives');
eq(cc.stepFiles({ text: 'edit src/a.ts', files: ['src/b.ts'] }, cfg({ scope: { always: ['package.json'] } })), ['src/b.ts', 'src/a.ts', 'package.json'], 'a step lists its files');
eq(cc.stepFiles({ files: ['a'] }, cfg({ scope: { mode: 'off' } })), [], 'scoping off lists nothing');
const b = { id: 'b', steps: [{ id: 's1', text: 'one', model: 'Opus', done: true }, { id: 's2', text: 'two', model: 'Opus' }, { id: 's3', text: 'three', model: 'Opus' }, { id: 's4', text: 'four', model: 'Fable' }] };
const prog = { branch: 'x', steps: [{ id: 's2', state: 'done', at: '2026-11-06T10:00:00Z', text: 'two', note: 'wired it' }], notes: [{ at: '2026-11-06T09:00:00Z', text: 'session abc started' }, { at: '2026-11-06T09:30:00Z', text: 'a thing to know' }] };
eq(cc.openSteps(b, prog).map((s) => s.id), ['s3', 's4'], 'the progress file counts');
eq(cc.nextBatch(cc.openSteps(b, null), 'per-step').map((s) => s.id), ['s2'], 'per-step takes one');
eq(cc.nextBatch(cc.openSteps(b, null), 'per-phase').map((s) => s.id), ['s2', 's3'], 'per-phase runs up to the model change');
const note = cc.handoff(b, prog, 400);
ok(note.includes('2/4 steps done · branch x') && note.includes('s2 done: wired it') && note.includes('a thing to know') && !note.includes('session abc'), 'the handoff tells what happened');
ok(note.indexOf('a thing to know') < note.indexOf('wired it'), 'oldest first');
ok(cc.handoff(b, { ...prog, notes: Array.from({ length: 40 }, (_, i) => ({ at: `2026-11-06T0${i % 9}:00:00Z`, text: 'n'.repeat(150) })) }, 300).length <= 300, 'the handoff keeps its size');
const prompt = cc.stepPrompt({ build: b, batch: [{ id: 's3', text: 'edit src/z.ts', model: 'Opus', checks: ['run it'] }], brief: '## Brett said (verbatim)\n> hi', note: 'NOTE', config: doc.config, total: 4 });
ok(prompt.includes('step s3 of 4') && prompt.includes('- src/z.ts') && prompt.includes('> hi') && prompt.includes('- run it'), 'the prompt has the step, files, checks and his words');

/* budget and caps */
eq(cc.budgetState(10, { warnTokens: 5, stopTokens: 20 }), 'warn', 'warns first');
eq(cc.budgetState(20, { warnTokens: 5, stopTokens: 20 }), 'stop', 'then stops');
eq(cc.budgetState(10, { warnTokens: 0, stopTokens: 0 }), 'ok', '0 = no budget');
eq(cc.budgetTokens({ input: 1, output: 2, cacheWrite: 3, cacheRead: 1000 }), 6, 'cache reads are not counted');
eq(cc.outputEnv(cc.normConfig({ output: { bashChars: 500, mcpTokens: 0, readTokens: 700 } })), { BASH_MAX_OUTPUT_LENGTH: '500', CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS: '700' }, '0 leaves Claude Code alone');
const price = (m, t) => ((t.cacheWrite ?? 0) * 10 + (t.cacheRead ?? 0)) / 1e6;
const c = cc.costPreview({ tokens: 1000, fullTokens: 20000, model: 'opus', sessions: 4, steps: 4, price });
ok(c.priced && c.saved > 0 && c.perBuild < c.fullBuild, 'a lean chain costs less than the full one');
eq(cc.costPreview({ tokens: 1, fullTokens: 2, model: 'x', price: () => null }).priced, false, 'no price, no number');
let tok = 0; const killed = [];
const pidf = join(TMP, 'pid'); writeFileSync(pidf, '4242');
const budget = createBudget({ 'budget-warn': '100', 'budget-stop': '200', 'budget-pid': pidf, 'budget-stopped': join(TMP, 'stopped') }, { snapshot: () => ({ tokens: { input: tok } }) }, (p) => killed.push(p));
eq(budget.check(), '', 'under budget says nothing');
tok = 150; ok(budget.check().includes('warning'), 'warns'); eq(budget.check(), '', 'warns once');
tok = 250; ok(budget.check().includes('stopping'), 'stops'); eq(killed, [4242], 'the session is ended'); ok(existsSync(join(TMP, 'stopped')), 'and it says so');

/* the store and CLI */
const env = { ...process.env, AXF_CHAIN_CONTROL_FILE: join(TMP, 'cc.json'), AXF_RULES_BRIEFS_FILE: join(TMP, 'rb.json'), AXF_CHAIN_HOME: join(TMP, 'home'), AXHUB_PROJECTS_DIR: join(TMP, 'none') };
const cli = (args, input) => { const r = spawnSync('node', [join(HERE, '..', 'cli', 'chain-control.mjs'), ...args, '--json'], { env, input, encoding: 'utf8', cwd: REPO }); return JSON.parse(r.stdout.trim().split('\n').pop() || '{}'); };
const s0 = cli(['state']);
ok(s0.ok && s0.rev === 0 && s0.rows.length > 0 && s0.rows.every((r) => r.tokens >= 0), 'state reads the seed and the chain');
ok(cli(['set', 'session.handoffChars=900', '--by', 'test']).rev === 1, 'a write bumps rev');
eq(cli(['get', 'session.handoffChars']).value, 900, 'it reads back');
cli(['file', 'CLAUDE.md', 'never']);
eq(cli(['chain']).rows.find((r) => r.path === 'CLAUDE.md').mode, 'never', 'a file changes mode');
cli(['set', 'budget.stopTokens=777', '--build', 'bb', '--step', 's1']);
eq(cli(['get', 'budget.stopTokens', '--build', 'bb', '--step', 's1']).value, 777, 'a step override through the CLI');
eq(cli(['get', 'budget.stopTokens', '--build', 'bb']).value, 0, 'not on the build');
cli(['preset', 'save', 'My mix']); ok(cli(['preset', 'list']).presets.some((p) => p.id === 'my-mix' && !p.builtin), 'a preset saves');
cli(['preset', 'apply', 'full']); eq(cli(['get', 'chain.defaultMode']).value, 'always', 'a preset applies');
cli(['preset', 'apply', 'my-mix']); eq(cli(['get', 'session.handoffChars']).value, 900, 'a saved preset comes back');
eq(cli(['preset', 'delete', 'lean']).code, 'invalid', 'built-ins stay');
const events = cli(['events', '--since', '1']);
ok(events.events.length >= 5 && events.events[0].rev === 2 && !('doc' in events.events[0]), 'change events in order');
const h = cli(['history']).history; const first = h[h.length - 1];
eq(first.what, 'set session.handoffChars', 'history says what changed');
cli(['reset']); eq(cli(['get', 'session.handoffChars']).value, 1500, 'reset');
eq(cli(['get', 'budget.stopTokens', '--build', 'bb', '--step', 's1']).value, 0, 'reset drops overrides');
cli(['restore', '1']); eq(cli(['get', 'session.handoffChars']).value, 900, 'history restores');
eq(cli(['read', 'package.json']).code, 'denied', 'only chain files open');
ok(cli(['read', 'CLAUDE.md']).version, 'a chain file opens with a version');
eq(cli(['write', 'CLAUDE.md'], JSON.stringify({ content: 'x', if_version: 'stale' })).code, 'conflict', 'a stale edit is refused');
eq(cli(['state', '--build', 'nope']).suggestions, [], 'an unknown build is harmless');

const logs = join(TMP, 'tokens'); const day = new Date().toISOString().slice(0, 10).split('-');
mkdirSync(join(logs, day[0], day[1]), { recursive: true });
const turn = (build, claudeSession, cacheWrite, costUsd) => JSON.stringify({ build, claudeSession, step: '', input: 1, output: 1, cacheRead: 0, cacheWrite, costUsd, rulesReads: [] });
writeFileSync(join(logs, day[0], day[1], `${day[2]}.jsonl`), `${[turn('a', 'x', 1000, 1), turn('b', 'y', 400, 0.25), turn('b', 'z', 400, 0.25)].join('\n')}\n`);
const cmp = JSON.parse(spawnSync('node', [join(HERE, '..', 'cli', 'chain-control.mjs'), 'compare', '--before', 'build=a', '--after', 'build=b', '--json'], { env: { ...env, AXF_TOKEN_LOG_DIR: logs }, encoding: 'utf8' }).stdout);
eq([cmp.before.sessions, cmp.after.sessions, cmp.before.startPerSession, cmp.saved.costPct], [1, 2, 1001, 50], 'the token log compares before and after');

/* the launcher: a fresh session per step, handoff, caps, stop at a higher pin */
const D = join(TMP, 'run'); const H = join(TMP, 'fakehome'); const bin = join(H, '.local', 'bin');
mkdirSync(join(D, '_claude', 'builds'), { recursive: true }); mkdirSync(bin, { recursive: true });
const FAKE = join(TMP, 'fake.log');
writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash
last="\${@: -1}"; step=$(printf '%s' "$last" | sed -n 's/^# Build [a-z-]*: step \\([a-z0-9]*\\) .*/\\1/p' | head -1)
echo "RUN step=$step bash=\${BASH_MAX_OUTPUT_LENGTH:-} nomd=\${CLAUDE_CODE_DISABLE_CLAUDE_MDS:-} handoff=$(printf '%s' "$last" | grep -c '^Handoff') files=$(printf '%s' "$last" | grep -c '^- src/b.ts')" >> "${FAKE}"
[[ -n "$step" ]] && node "${REPO}/framework/cli/build-progress.mjs" step "$step" done --note "did $step" --build demo >/dev/null
echo '{"type":"result","subtype":"success","total_cost_usd":0.01}'
`);
chmodSync(join(bin, 'claude'), 0o755);
writeFileSync(join(D, '_claude', 'builds', 'store.json'), JSON.stringify({ builds: [{ id: 'demo', title: 'Demo', status: 'running', steps: [{ id: 's1', text: 'one', model: 'Opus', files: ['src/b.ts'] }, { id: 's2', text: 'two', model: 'Opus' }, { id: 's3', text: 'three', model: 'Fable' }] }] }));
writeFileSync(join(D, 'brief.md'), '# brief\n');
const runEnv = { ...env, HOME: H, AXF_CHAIN_CONTROL_FILE: join(TMP, 'cc2.json'), AXF_PROGRESS_DIR: join(TMP, 'prog'), AXF_BUILD_ID: 'demo', AXF_SLOTS: 'off', AXF_OWN_LOGIN: 'off', AXF_AGENT_BOOK: 'off', AXF_WATCH_LIVE: 'off', AXF_LOOK_GATE: 'off', AXF_HEADLESS_DIR: join(TMP, 'h'), AXF_ORIGIN: 'off', AXF_TOKEN_LOG: 'off', TMUX: '' };
const child = spawn('bash', [join(REPO, 'deploy', 'claude-headless.sh'), '--inner', '--name', 'demo', '--brief', 'brief.md', '--log', 'o.log', '--', '--model', 'claude-opus-5-5'], { cwd: D, env: runEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = ''; child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { out += x; });
for (let i = 0; i < 120 && !out.includes('finished (exit'); i += 1) await new Promise((r) => { setTimeout(r, 250); });
try { process.kill(-child.pid, 'SIGKILL'); } catch { /* it ended */ }
ok(out.includes('finished (exit 0)'), `the run finishes\n${out.slice(-600)}`);
const runs = readFileSync(FAKE, 'utf8').trim().split('\n');
eq(runs.map((l) => /step=(\S*)/.exec(l)[1]), ['s1', 's2'], 'one fresh session per step, stopping at the step pinned above the run');
ok(runs.every((l) => l.includes('bash=20000') && l.includes('nomd=1') && l.includes('handoff=1')), 'each session is capped, lean and handed off');
ok(runs[0].includes('files=1'), 'a step lists its exact files');
ok(out.includes('pinned to fable'), 'it says why it stopped');

console.log(`✓ chain-control@1 — ${n} checks`);
