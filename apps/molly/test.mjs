// Molly's own checks (molly-one-shell s14): the CLI maps every verb to the Molly action its UI runs, and sends it as a
// control@1 console action through the host bridge (host:<spec>). `node apps/molly/test.mjs`
import assert from 'node:assert/strict';
import { commandFor, main, specFromArgv } from './cli.mjs';

const spec = (...a) => specFromArgv(a).spec;
assert.equal(spec('open', 'console:screen:plan'), 'shell.open:console:screen:plan');
assert.equal(spec('open', 'console:screen:plan', '--in', 'pane'), 'shell.open:pane:console:screen:plan');
assert.equal(spec('open', 'console:screen:plan', '--in', 'main'), 'shell.open:console:screen:plan');
assert.equal(spec('molly', 'go'), 'shell.go');
assert.equal(spec('go', 'build', 'queue'), 'shell.find:build queue');
assert.equal(spec('mode', 'ide'), 'shell.mode:ide');
assert.equal(spec('layout', 'save', 'Review', 'day'), 'shell.layout.save:Review day');
assert.equal(spec('layout', 'switch', 'review-day'), 'shell.layout.switch:review-day');
assert.equal(spec('pane', '2', 'axhub:screen:home'), 'xlayout.drop:2:axhub:screen:home');
assert.equal(spec('tabs', '1', 'on'), 'xlayout.container.tabs:on:1');
assert.equal(spec('tabs', '3'), 'xlayout.container.tabs:3');
assert.equal(spec('reload'), 'molly.reload');
assert.equal(spec('action', 'settings.open:shell'), 'settings.open:shell');
// modules (convert-every-app-into-a-molly-module) and the Expenses module
assert.equal(spec('modules'), 'molly.modules.list');
assert.equal(spec('module', 'off', 'expenses'), 'molly.modules.disable:expenses');
assert.equal(spec('module', 'on', 'console'), 'molly.modules.enable:console');
assert.equal(spec('module', 'status', 'axhub'), 'molly.modules.status:axhub');
assert.equal(spec('module', 'reload', 'amberx'), 'molly.modules.reload:amberx');
assert.equal(spec('module', 'address', 'console', 'https://localhost:5173/console-surface.js'), 'molly.modules.surface:console:https://localhost:5173/console-surface.js');
assert.equal(spec('expenses', 'list'), 'expenses.list');
assert.equal(spec('expenses', 'list', 'coffee'), 'expenses.list:coffee');
assert.equal(spec('expenses', 'totals'), 'expenses.totals');
assert.equal(spec('expenses', 'add', '12.50:Coffee:Food'), 'expenses.add:12.50:Coffee:Food');
assert.equal(spec('expenses', 'open', 'add'), 'expenses.open:add');
for (const bad of [['module'], ['module', 'off'], ['module', 'address', 'console'], ['expenses'], ['expenses', 'add']]) assert.equal(spec(...bad), null, bad.join(' '));
for (const bad of [[], ['open'], ['mode'], ['layout', 'save'], ['pane', '2'], ['nope']]) assert.equal(spec(...bad), null, bad.join(' '));
assert.deepEqual(commandFor('shell.mode:ide', 'all'), { $axf: 'control@1', op: 'act', target: 'console.actions', path: 'host:shell.mode:ide', action: 'run', input: { to: 'all' }, by: 'cli' });
assert.equal(specFromArgv(['mode', 'ide', '--to', 'all']).to, 'all');

// main(): posts to /api/console with the bearer token; usage exits 2
const sent = [];
const fake = async (url, init) => { sent.push({ url, init }); return { status: 200, text: async () => JSON.stringify({ ok: true }) }; };
const log = console.log; console.log = () => {};
const err = console.error; console.error = () => {};
assert.equal(await main(['mode', 'split'], { base: 'https://c.example/', token: 't', fetch: fake }), 0);
assert.equal(await main([], { base: 'https://c.example', token: 't', fetch: fake }), 2);
console.log = log; console.error = err;
assert.equal(sent.length, 1);
assert.equal(sent[0].url, 'https://c.example/api/console');
assert.equal(sent[0].init.headers.authorization, 'Bearer t');
assert.equal(JSON.parse(sent[0].init.body).path, 'host:shell.mode:split');
console.log('molly: cli checks pass');
