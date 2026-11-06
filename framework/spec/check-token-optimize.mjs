#!/usr/bin/env node
/** Rules briefs, token log and the API-run gate (build token-optimize). Scratch folders only; no network, no model. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rb from '../core/rules-brief.mjs';
import * as tl from '../core/token-log.mjs';
import * as ar from '../core/api-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'axf-token-opt-'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; };
const human = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AXF_CLAUDE_AUTH'].includes(k)));
const run = (script, args, env = {}, input) => spawnSync('node', [join(HERE, '..', 'cli', script), ...args], { env: { ...human, ...env }, input, encoding: 'utf8' });

/* rules briefs */
const seed = JSON.parse(readFileSync(join(HERE, '..', 'schemas', 'rules-briefs.json'), 'utf8'));
const doc = rb.normDoc(null, seed);
ok(doc.lean && doc.briefs.length >= 3, 'the seed loads');
const core = doc.briefs.find((b) => b.id === 'core');
ok(rb.tokensOf(core.text) < 800, 'the core brief stays short');
const plain = rb.compose(doc, rb.launchContext({ task: 'fix the merge queue retry' }));
eq(plain.picked.map((p) => p.id), ['core'], 'only core on a plain task');
const ui = rb.compose(doc, rb.launchContext({ task: 'add a dialog to apps/console-web/plugins/foo' }));
eq(ui.picked.map((p) => p.id), ['core', 'ui', 'plugins'], 'conditions pick UI and plugin briefs');
const b = rb.normBrief({ name: 'Fable only', when: { model: ['fable'], build: ['x-*'], ui: false }, text: 't' });
ok(!rb.whyNot(b, rb.launchContext({ model: 'claude-fable-5-1', build: 'x-1', task: 'merge' })), 'every condition matches');
ok(rb.whyNot(b, rb.launchContext({ model: 'opus', build: 'x-1' })), 'model mismatch');
ok(rb.whyNot(b, rb.launchContext({ model: 'fable', build: 'y' })), 'prefix mismatch');
ok(rb.whyNot({ ...b, enabled: false }, rb.launchContext({ model: 'fable', build: 'x-1' })), 'switched off');
const gen = rb.normBrief({ name: 'Live', mode: 'generate', maxChars: 400 });
const rules = '- **Merge queue rule (Nov 4):** Only the merge queue merges a PR, always, in every repo there is.\n- **Theme rule:** Colours come from tokens only, never literals in any file.\n';
const made = rb.compose({ ...doc, briefs: [gen] }, rb.launchContext({ task: 'land the merge queue' }), () => rules);
ok(made.text.includes('merge queue merges') && !made.text.includes('Colours'), 'generated from the rules closest to the task');
ok(made.text.length <= 400, 'a generated brief keeps its cap');
eq(rb.compose({ ...doc, briefs: [gen] }, rb.launchContext({ task: 'zzz' }), () => rules).text, '', 'nothing related = nothing sent');
const capped = rb.compose({ ...doc, maxChars: 2200 }, rb.launchContext({ task: 'a dialog' }));
ok(capped.chars <= 2200 && capped.skipped.some((s) => /cap/.test(s.why)), 'the cap leaves a brief out whole');
ok(rb.normDoc({ $axf: 'wrong' }, seed).briefs.length === doc.briefs.length, 'a broken document falls back to the seed');

/* the CLI: lean off or no brief means exit 3, which sends the launcher back to the full chain */
const briefFile = join(TMP, 'brief.md'); writeFileSync(briefFile, 'fix the merge queue');
const store = join(TMP, 'briefs.json'); const env = { AXF_RULES_BRIEFS_FILE: store };
eq(run('rules-brief.mjs', ['compose', '--brief', briefFile], env).status, 0, 'the seed composes');
eq(run('rules-brief.mjs', ['settings', 'lean=off'], env).status, 0, 'lean off saves');
eq(run('rules-brief.mjs', ['compose', '--brief', briefFile], env).status, 3, 'lean off = full chain');
run('rules-brief.mjs', ['settings', 'lean=on'], env);
const saved = run('rules-brief.mjs', ['save', '--json'], env, JSON.stringify({ name: 'Mine', text: 'hello', when: { keywords: 'merge' } }));
ok(JSON.parse(saved.stdout).ok, 'a brief saves');
ok(run('rules-brief.mjs', ['compose', '--brief', briefFile], env).stdout.includes('hello'), 'a saved brief runs when its condition matches');
eq(run('rules-brief.mjs', ['save'], env, '{"name":"Empty"}').status, 1, 'a saved brief needs text');

/* the launcher wires it */
const sh = readFileSync(join(HERE, '..', '..', 'deploy', 'claude-headless.sh'), 'utf8');
ok(sh.includes('export CLAUDE_CODE_DISABLE_CLAUDE_MDS=1') && sh.includes('--append-system-prompt'), 'the launcher drops the chain and sends the brief');
ok(sh.indexOf('[[ -n "$text" ]] || return 0') < sh.indexOf('export CLAUDE_CODE_DISABLE_CLAUDE_MDS=1'), 'the chain is only dropped once a brief exists');

/* token log */
const u = (i, o) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 });
const out = [];
const log = tl.createTurnLog({ ctx: { session: 's', build: 'b', account: 'a', step: () => 's3' }, cost: () => 0.5, emit: (r) => out.push(r), now: () => 0 });
log.add({ type: 'system', session_id: 'c1' });
log.add({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: u(1, 2), content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/CLAUDE.md' } }] } });
log.add({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: u(1, 9), content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/app.ts' } }] } });
log.add({ type: 'assistant', message: { id: 'm2', model: '<synthetic>', usage: u(0, 0) } });
log.add({ type: 'assistant', message: { id: 'm3', model: 'claude-opus-5-5', usage: u(5, 5), content: [{ type: 'tool_use', name: 'Bash', input: { command: "cat > x <<'EOF'\ncat CLAUDE.md\nEOF\necho _claude/rules/RULES.md" } }, { type: 'tool_use', name: 'Bash', input: { command: 'sed -n 1,9p _claude/rules/RULES.md | head' } }] } });
log.add({ type: 'result' }); log.end();
eq(out.length, 2, 'one record per message id');
eq([out[0].output, out[0].step, out[0].build, out[0].account], [9, 's3', 'b', 'a'], 'last usage wins, tags carried');
eq(out[0].rulesReads, ['/x/CLAUDE.md'], 'a CLAUDE.md read is flagged');
eq(out[1].rulesReads, ['_claude/rules/RULES.md'], 'a shell read is flagged, a heredoc or echo is not');
const est = tl.chatTurns({ uuid: 'u', source: 'claude-ai-voice', messages: [{ role: 'user', text: 'x'.repeat(40) }, { role: 'assistant', text: 'y'.repeat(80), at: '2026-11-06T00:00:00Z' }, { role: 'user', text: 'z' }, { role: 'assistant', text: 'w' }] });
eq([est[0].estimated, est[0].source, est[0].input, est[0].output, est[1].cacheRead], [true, 'voice', 10, 20, 30], 'chat turns are estimates');
eq(tl.chatTurns({ uuid: 'u', messages: [{ role: 'assistant', text: 'a' }, { role: 'assistant', text: 'b' }] }, { from: 1 }).length, 1, 'only new chat turns');
const a = { id: '1', at: '2026-11-05T01:00:00Z', source: 'headless', session: 's', build: 'b', model: 'claude-opus-5-5', account: 'x', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 2, rulesReads: ['CLAUDE.md'] };
const s = tl.summarize([a, { ...a, source: 'vps', build: '' }, { ...a, id: '2', at: '2026-11-06T01:00:00Z', session: 't', estimated: true, costUsd: 1 }], {});
eq([s.count, s.totals.costUsd, s.byDay.length, s.byBuild[0].key, s.byModel[0].key, s.totals.rulesReads], [2, 3, 2, 'b', 'opus', 2], 'dedupe keeps the live record, groups add up');
eq(tl.summarize([a], { build: 'other' }).count, 0, 'filters apply');
eq(tl.summarize([a], { estimated: 'yes' }).count, 0, 'estimated filter');

/* store + scan, offsets keep it single */
const logDir = join(TMP, 'log'); const rootDir = join(TMP, 'tr', 'proj'); mkdirSync(rootDir, { recursive: true });
const line = (id) => `${JSON.stringify({ type: 'assistant', sessionId: 'sess', timestamp: '2026-11-06T10:00:00Z', message: { id, model: 'claude-opus-5-5', usage: u(3, 4), content: [] } })}\n`;
writeFileSync(join(rootDir, 'sess.jsonl'), line('a') + line('b'));
const tenv = { AXF_TOKEN_LOG_DIR: logDir, AXF_TOKEN_LOG_ROOTS: join(TMP, 'tr'), AXF_TOKEN_LOG_CHATS: join(TMP, 'none') };
const J = (r) => JSON.parse(r.stdout);
eq(J(run('token-log.mjs', ['scan', '--json'], tenv)).turns, 2, 'a scan reads new turns');
eq(J(run('token-log.mjs', ['scan', '--json'], tenv)).turns, 0, 'a second scan reads none');
ok(J(run('token-log.mjs', ['check', '--json'], tenv)).tally.$axf === 'token-tally@1', 'the check writes a tally');
ok(J(run('token-log.mjs', ['tally', '--json'], tenv)).tally.at, 'the tally reads back');
eq(J(run('token-log.mjs', ['query', '--from', '2026-11-06', '--to', '2026-11-06', '--json'], tenv)).count, 2, 'query reads the store');

/* API runs: a confirm, never a veto */
ok(!ar.isApiRun({ AXF_CLAUDE_AUTH: 'plan' }) && ar.isApiRun({ AXF_CLAUDE_AUTH: 'api' }) && ar.isApiRun({ AXF_CLAUDE_AUTH: 'plan', ANTHROPIC_API_KEY: 'k' }), 'any key means an API run');
eq(ar.minutesLeft({ steps: [{ estimate: '10m' }, { estimate: '1.5h' }, { estimate: '5m', done: true }] }), 100, 'open steps add up');
const rec = ar.newRun({ id: 'r', name: 'n', at: '2026-11-06T00:00:00Z' });
assert.throws(() => ar.decide(rec, 'approve', { owner: { via: 'token', name: 'x' }, at: 'now' })); n += 1;
assert.throws(() => ar.decide(rec, 'approve', { owner: { via: 'console', name: 'b' }, source: 'a session', at: 'now' })); n += 1;
eq(ar.decide(rec, 'approve', { owner: { via: 'console', name: 'brett' }, at: 'now' }).status, 'approved', "Brett's click approves");
ok(ar.expired(rec, Date.parse('2026-11-08T00:00:00Z')) && !['approved', 'running'].includes(ar.owed([rec])[0].status), 'waiting too long expires, it never runs');
const aenv = { AXF_API_RUNS_DIR: join(TMP, 'runs') };
eq(run('api-run.mjs', ['gate', '--name', 'x', '--brief', briefFile, '--model', 'opus'], aenv).status, 0, 'a plan run passes');
const g = run('api-run.mjs', ['gate', '--name', 'x', '--brief', briefFile, '--model', 'opus'], { ...aenv, AXF_CLAUDE_AUTH: 'api' });
eq(g.status, 4, 'an API run waits');
const id = /run=(\S+)/.exec(g.stdout)[1];
eq(run('api-run.mjs', ['decide', id, 'approve'], { ...aenv, CLAUDECODE: '1' }, '{"owner":{"via":"console","name":"b"}}').status, 1, 'a session cannot approve');
eq(run('api-run.mjs', ['decide', id, 'approve'], aenv, '{}').status, 1, 'no owner, no approval');
eq(run('api-run.mjs', ['gate', '--name', 'x', '--brief', briefFile, '--model', 'opus'], { ...aenv, AXF_CLAUDE_AUTH: 'api' }).status, 4, 'still waiting, same request');
eq(run('api-run.mjs', ['decide', id, 'approve'], aenv, '{"owner":{"via":"console","name":"brett"}}').status, 0, "Brett's approval lands");
eq(run('api-run.mjs', ['gate', '--name', 'x', '--brief', briefFile, '--model', 'opus'], { ...aenv, AXF_CLAUDE_AUTH: 'api' }).status, 0, 'an approved run goes');
run('api-run.mjs', ['finish', id, '--cost', '3.25'], aenv);
const fin = J(run('api-run.mjs', ['list', '--json'], aenv));
eq([fin.runs[0].status, fin.runs[0].finalUsd, fin.owed], ['done', 3.25, [id]], 'the final cost is owed to Brett');
run('api-run.mjs', ['ack', id], aenv);
eq(J(run('api-run.mjs', ['list', '--json'], aenv)).owed, [], 'seen');
console.log(`✓ token-optimize: ${n} checks`);
