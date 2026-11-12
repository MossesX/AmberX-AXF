#!/usr/bin/env node
/**
 * Tests for the control registry's surfaces (build full-api-cli-control-of-everything-plus-an-offli, s17): the
 * committed index validates and matches the sources, the dispatcher's no-AI paths and the AI gate on / off, the
 * planner (refs → control@1 commands, provider calls, URL and command templates), confirm tokens, the CLI (validation,
 * offline runs, completion), the coverage check and every app / provider declaration. No network, no model.
 *
 *   node apps/console-web/lib/registry/test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './collect.mjs';
import { ControlRegistry, checkIndex, changes, readIndex } from './index.mjs';
import { dispatch } from './dispatch.mjs';
import { CALL_PARAMS, consoleSyncProblems, consoleTargets, fill, parseRef, planRef, planState, shellFill, shellQuote } from './execute.mjs';
import { confirmToken, handle, useRegistry } from './rpc.mjs';
import { complete, parse } from './cli.mjs';
import { compare, findings, readBaseline } from './coverage.mjs';
import { conventionFor, generatePhrases, settingParam } from './console-entries.mjs';

let n = 0;
const ok = (v, what) => { assert.ok(v, what); n++; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };
process.env.AXF_CLAUDE_AVAILABLE = '0';

/* ---------------------------------------------------------------- the index */
const index = readIndex();
ok(index, 'the committed index reads');
ok(checkIndex(index).ok, `the committed index validates against the schema: ${checkIndex(index).errors.slice(0, 3).join('; ')}`);
ok(!changes().stale, 'the committed index matches the sources (node apps/console-web/lib/registry/index.mjs build --write)');
const reg = new ControlRegistry(index);
useRegistry(reg);
for (const owner of ['console-web', 'molly', 'axhub-web', 'hostinger', 'coolify', 'vps', 'amberx-droid', 'moshi']) ok(reg.list({ owner, limit: 1 }).total > 0, `${owner} has entries`);
ok(reg.list({ type: 'setting', limit: 1 }).total >= 40, 'settings are registered');
ok(reg.get('console-web/page/registry'), 'the Registry page is in the registry itself');

/* ---------------------------------------------------------------- dispatcher: deterministic, gate closed */
const r1 = dispatch(index, 'open plan studio');
eq([r1.ok, r1.entry, r1.action, r1.ai.fallback], [true, 'console-web/page/plan-studio', 'open', false], 'a phrase resolves with no model');
const r2 = dispatch(index, ['console-web/display/tokens.layout', 'set', '--path', 'navWidth', '--value', '200']);
eq([r2.ok, r2.params], [true, { path: 'navWidth', value: 200 }], 'a CLI argv resolves and coerces');
const r3 = dispatch(index, { id: 'console-web/setting/claude-settings/noWait.duration', action: 'set', params: { value: '9h' } });
eq([r3.ok, r3.code], [false, 'validation'], 'a value outside the allowed values is refused');
const r4 = dispatch(index, 'make me a sandwich');
eq([r4.ok, r4.code, r4.ai.fallback], [false, 'not_found', false], 'nothing matched and the gate is closed: no model');
eq(dispatch(index, 'add a todo buy milk').params, { kind: 'todo', title: 'buy milk' }, "a phrase's last slot takes the rest of the sentence");

/* ---------------------------------------------------------------- the AI gate on */
let asked = null;
const r5 = dispatch(index, 'make me a sandwich', { available: true, ask: (brief) => { asked = brief; return { id: 'console-web/page/plan-studio', action: 'open' }; } });
ok(asked && asked.$axf === 'control-registry-fallback@1', 'gate open: the model is asked with the fallback brief');
eq([r5.ok, r5.entry, r5.how.kind], [true, 'console-web/page/plan-studio', 'ai'], "the model's proposal is resolved again by the registry");
const r6 = dispatch(index, 'make me a sandwich', { available: true, ask: () => ({ id: 'console-web/display/tokens.layout', action: 'set', params: { path: 'nope', value: 1 } }) });
eq(r6.ok, false, 'a proposal outside the allowed values is refused');
const rpcOpen = handle({ op: 'resolve', input: 'make me a sandwich', available: true });
ok(rpcOpen.brief && !rpcOpen.ok, 'rpc hands the brief back when the gate is open and no model answered');
const rpcAns = handle({ op: 'resolve', input: 'make me a sandwich', available: true, answer: { id: 'console-web/page/builds', action: 'open' } });
eq([rpcAns.ok, rpcAns.entry, rpcAns.plan.via], [true, 'console-web/page/builds', 'console'], "rpc resolves the caller's model answer and plans it");

/* ---------------------------------------------------------------- planner */
eq(planRef('view:plan-studio', {}).command, { $axf: 'control@1', op: 'act', target: 'console.screens', path: 'plan-studio', action: 'open', input: {}, by: 'registry' }, 'view → console.screens open');
eq(planRef('settings:plugins/x', { anchor: 'setting:a' }).command.input, { anchor: 'setting:a' }, 'settings → console.settings with the anchor');
eq(planRef('action:swap:color-theme', { asset: 'dark' }).command.input, { args: ['color-theme', 'dark'] }, 'action args: fixed then named params');
eq(planRef('control:tokens.layout/set', { path: 'navWidth', value: 3 }).command, { $axf: 'control@1', op: 'set', target: 'tokens.layout', path: 'navWidth', value: 3, by: 'registry' }, 'control set');
eq(planRef('control:amberx.items/list', { kind: 'todo' }).command.select, { kind: 'todo' }, 'control list → select');
eq(planRef('foo/bar', { q: 1 }, { effect: 'read' }).command.target, 'plugins.reads', 'a plugin read → plugins.reads');
eq(planRef('foo/bar', { q: 1 }).command.target, 'plugins.commands', 'a plugin command → plugins.commands');
eq(planRef('value:a.b', { value: true }, { plugin: 'claude-settings' }).command.input, { values: { 'a.b': true } }, 'a setting value → its plugin PUT settings');
eq(planRef('provider:hostinger/DNS_getDNSRecordsV1', { domain: 'x.com' }, { effect: 'read' }), { via: 'provider', provider: 'hostinger', op: 'DNS_getDNSRecordsV1', params: { domain: 'x.com' }, effect: 'read', by: 'registry' }, 'provider plan');
eq(planRef('provider:vps/run#journalctl -u {unit} -n {lines}', { unit: "a'; rm -rf /", lines: 5 }).params.command, `journalctl -u 'a'\\''; rm -rf /' -n '5'`, 'command templates shell-quote every value');
eq(planRef('provider:vps/run#systemctl restart {unit}', {}).via, 'none', 'a template with a missing value plans nothing');
eq(shellQuote("it's"), `'it'\\''s'`, 'shell quoting');
eq(shellFill('a {x}', { x: 'b c' }), "a 'b c'", 'shellFill');
eq(fill('moshi://tmux?session={session}&window={window}', { session: 'my project' }), 'moshi://tmux?session=my%20project', 'query values encoded, empty ones dropped');
eq(fill('https://m.example/#/{app}/{route}', { app: 'console' }), 'https://m.example/#/console', 'empty path slots drop out');
eq(parseRef('channel:molly/x').kind, 'channel', 'refs parse');
ok(CALL_PARAMS.includes('confirm'), 'call params are not passed to the thing called');
eq(planState(index, 'console-web/display/tokens.layout').plan.command.op, 'list', 'state read plan');
eq(consoleTargets(reg.get('console-web/page/plan-studio')), { tool: 'console_open', args: { screen: 'plan-studio' }, show: 'screen:plan-studio', deepLink: '?axf-view=plan-studio', kind: 'screen' }, 'console_open / console_show targets match the entry');
eq(consoleSyncProblems(index), [], 'every console target agrees with its deep link');

/* ---------------------------------------------------------------- rpc: invoke, value checks, confirm tokens, channel gaps */
const inv = handle({ op: 'invoke', id: 'console-web/display/tokens.layout', action: 'set', params: { path: 'navWidth', value: 99999 } });
eq([inv.ok, inv.code], [false, 'validation'], 'a token value is checked against its own field range');
const d1 = handle({ op: 'invoke', id: 'vps/tool/maintenance', action: 'reboot', params: {} });
eq([d1.ok, d1.code], [false, 'confirmation_required'], 'a destructive provider action needs the confirm token');
const d2 = handle({ op: 'invoke', id: 'vps/tool/maintenance', action: 'reboot', params: {}, confirm: d1.confirm });
eq([d2.ok, d2.plan.via, d2.plan.params.command], [true, 'provider', 'systemctl reboot'], 'with the token it plans the axHub call');
ok(d1.confirm === confirmToken({ entry: 'vps/tool/maintenance', action: 'reboot', params: {} }), 'the token is bound to the exact call');
const mo = handle({ op: 'invoke', id: 'molly/tool/xlayout/xlayout.ide', action: 'run', params: {} });
eq([mo.ok, mo.plan.via], [true, 'none'], 'a Molly in-window action plans nothing and says why');
eq(handle({ op: 'invoke', id: 'moshi/tool/tmux', action: 'resume', params: { session: 'a b', window: 2 } }).plan.url, 'moshi://tmux?session=a%20b&window=2', 'Moshi deep link');
eq(handle({ op: 'invoke', id: 'moshi/tool/tmux', action: 'resume', params: { session: 'a', window: 12 } }).code, 'validation', 'Moshi window is 0-9');
eq(handle({ op: 'get', id: 'nope/page/x' }).code, 'not_found', 'unknown id');
const hostingerOps = handle({ op: 'providerOps' }).providers;
for (const p of ['hostinger', 'coolify', 'vps', 'amberx']) ok(hostingerOps[p]?.length, `${p} declares provider ops`);

/* ---------------------------------------------------------------- CLI */
eq(parse(['do', 'x', '--a', '1', '--json', '--confirm', 't']).flags, { json: true, confirm: 't' }, 'CLI flags are separated from params');
eq(parse(['do', 'x', '--a', '1']).raw, ['--a', '1'], 'params pass through');
ok(complete(['do', 'vps/tool/sys']).includes('vps/tool/systemd'), 'completion: entry ids');
ok(complete(['do', 'vps/tool/systemd', '']).includes('restart'), 'completion: actions');
ok(complete(['do', 'vps/tool/logs', 'system', '--priority', '']).includes('warning'), 'completion: allowed values');
const cli = (args) => JSON.parse(execFileSync('node', [join(ROOT, 'bin/axf-ctl.mjs'), ...args, '--json', '--offline'], { encoding: 'utf8', env: { ...process.env, AXF_TOKEN: '' } }).trim().split('\n').pop());
const c1 = cli(['do', 'console-web/display/tokens.layout', 'set', '--path', 'navWidth', '--value', '200', '--dry']);
eq([c1.ok, c1.plan.command.value], [true, 200], 'axf ctl do --dry plans offline');
let c2;
try { cli(['set', 'console-web/setting/claude-settings/noWait.duration', '9h']); } catch (e) { c2 = JSON.parse(String(e.stdout).trim()); }
eq(c2?.code, 'validation', 'axf ctl refuses a value outside the allowed values before sending anything');
const c3 = cli(['do', 'molly/app/molly', 'open', '--app', 'console']);
eq(c3.result?.handoff?.url, 'https://molly.amberxai.com/#/console', 'axf ctl hands back a URL to open');

/* ---------------------------------------------------------------- parity: REST, MCP, CLI and voice plan the same call */
const viaCommand = handle({ op: 'invoke', id: 'console-web/page/plan-studio', action: 'open', params: {}, by: 'x' }).plan;
const viaPhrase = handle({ op: 'resolve', input: 'open plan studio', by: 'x' }).plan;
const viaArgv = handle({ op: 'resolve', input: ['console-web/page/plan-studio', 'open'], by: 'x' }).plan;
eq([viaPhrase, viaArgv], [viaCommand, viaCommand], 'a command, a phrase and a CLI call plan the identical control@1 command');

/* ---------------------------------------------------------------- conventions, settings, phrases */
eq(conventionFor({ name: 'limit', type: 'integer' }), { min: 1, max: 2000 }, 'limit convention');
eq(conventionFor({ name: 'q', type: 'string' }), { maxLength: 20000 }, 'text convention');
eq(conventionFor({ name: 'x', type: 'string', enum: ['a'] }), null, 'a declared parameter keeps its values');
eq(settingParam({ key: 'k', kind: 'choice', options: [{ value: 'a', label: 'A' }] }).enum, ['a'], 'choice settings → enum');
const ents = [{ id: 'a/page/x', type: 'page', label: 'Thing', actions: [{ id: 'open', effect: 'navigate' }, { id: 'close', effect: 'navigate' }] }, { id: 'a/plugin/x', type: 'plugin', label: 'Thing', actions: [{ id: 'open', effect: 'navigate' }] }];
generatePhrases(ents);
eq([ents[0].actions[0].phrases, ents[0].actions[1].phrases, ents[1].actions[0].phrases], [['open thing'], ['close thing'], ['open thing settings']], 'generated phrases: page first, plugin settings, open / close distinct');

/* ---------------------------------------------------------------- coverage */
const all = findings(index);
const { fresh } = compare(all, readBaseline());
eq(fresh, [], `no coverage finding beyond the baseline: ${fresh.slice(0, 3).map((f) => f.why).join('; ')}`);
const broken = { ...index, entries: [...index.entries, { ...index.entries.find((e) => e.id === 'console-web/display/tokens.layout'), id: 'console-web/tool/zz-test', surfaces: { rest: false, mcp: true, cli: true, voice: false }, gaps: [], actions: [{ id: 'run', effect: 'write', run: 'zz/run', params: [{ name: 'free', type: 'string' }] }] }] };
const kinds = new Set(findings(broken).filter((f) => f.entry === 'console-web/tool/zz-test').map((f) => `${f.kind}:${f.what}`));
ok(kinds.has('surface:rest') && kinds.has('surface:voice') && kinds.has('params:run.free'), 'coverage finds a missing surface and a parameter with no allowed values');

console.log(`✓ control registry surfaces — ${n} checks`);
