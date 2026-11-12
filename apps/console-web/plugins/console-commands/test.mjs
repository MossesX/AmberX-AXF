#!/usr/bin/env node
/**
 * Console commands plugin: CLI words → control@1 commands, the runner (gate + resolve + deliver), answers as text,
 * sending to a console (fake fetch), the `run` stdin entry the server uses.
 *   node apps/console-web/plugins/console-commands/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.AXF_CONSOLE_COMMANDS_DATA_DIR = mkdtempSync(join(tmpdir(), 'cc-'));
const { commandFromArgv, formatAnswer, runConsole, sendToConsole, confirmSalt } = await import('./console.mjs');

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('CLI words', () => {
  assert.deepEqual(commandFromArgv(['open', 'plan', 'studio']).command, { op: 'act', target: 'console.screens', path: 'plan studio', action: 'open' });
  assert.deepEqual(commandFromArgv(['console', 'settings', 'plugins/sample-tools', '--anchor', 'setting:x', '--to', 'all']).command, { op: 'act', target: 'console.settings', path: 'plugins/sample-tools', action: 'open', input: { to: 'all', anchor: 'setting:x' } });
  assert.deepEqual(commandFromArgv(['action', 'swap', 'color-theme', 'dark', '--confirm', 'c1.x']).command, { op: 'act', target: 'console.actions', path: 'swap', action: 'run', input: { args: ['color-theme', 'dark'] }, confirm: 'c1.x' });
  assert.deepEqual(commandFromArgv(['back']).command, { op: 'act', target: 'console.nav', path: 'here', action: 'back' });
  assert.deepEqual(commandFromArgv(['where']).command, { op: 'get', target: 'console.nav', path: 'here' });
  assert.deepEqual(commandFromArgv(['list', 'actions', 'theme']).command, { op: 'list', target: 'console.actions', select: { q: 'theme' } });
  assert.deepEqual(commandFromArgv(['list', 'plan']).command, { op: 'list', target: 'console.screens', select: { q: 'plan' } });
  assert.deepEqual(commandFromArgv(['clients']).command, { op: 'list', target: 'console.clients' });
  assert.ok(commandFromArgv(['open']).error, 'open without a screen is a usage error');
  assert.ok(commandFromArgv(['explode']).error, 'unknown verb');
});

const NOW = Date.now();
const clients = [{ id: 'tab-1', lastUsed: NOW, lastSeen: NOW, here: { screen: 'home' }, catalog: { items: [
  { kind: 'screen', id: 'plan-studio', label: 'Plan Studio' }, { kind: 'screen', id: 'home', label: 'Home' },
  { kind: 'action', id: 'assets.reset', label: 'Reset to defaults' }, { kind: 'action', id: 'terminal.open', label: 'Open output terminal' },
  { kind: 'bogus', id: 'x' },
] } }];

t('runner: gate, resolve, deliver', () => {
  const r = runConsole({ op: 'act', target: 'console.screens', path: 'plan studio', action: 'open' }, { clients, by: 'claude' });
  assert.ok(r.ok && r.deliver.to[0] === 'tab-1' && r.deliver.message.target === 'plan-studio' && r.audit.by === 'claude', JSON.stringify(r));
  assert.equal(runConsole({ op: 'act', target: 'console.screens', path: 'plan studio', action: 'open' }, { clients, grants: ['control.console.read'] }).code, 'denied', 'navigate needs its permission');
  assert.equal(runConsole({ op: 'list', target: 'tokens.layout' }, { clients }).code, 'invalid', 'only console targets');
  assert.equal(runConsole({ op: 'set', target: 'console.screens', path: 'home', value: 1 }, { clients }).code, 'invalid', 'screens are not set');
  const c1 = runConsole({ op: 'act', target: 'console.actions', path: 'assets.reset', action: 'run' }, { clients });
  assert.equal(c1.code, 'confirmation_required');
  assert.ok(runConsole({ op: 'act', target: 'console.actions', path: 'assets.reset', action: 'run', confirm: c1.confirm }, { clients }).ok, 'confirmed');
  assert.equal(runConsole({ op: 'list', target: 'console.screens' }, { clients }).items.length, 2, 'bogus catalog items dropped');
  const none = runConsole({ op: 'act', target: 'console.nav', path: 'here', action: 'back' }, { clients: [] });
  assert.equal(none.code, 'not_found', 'no console open');
  assert.equal(none.noConsole, true, 'no console open is flagged, so the server queues it (console-wake)');
  assert.ok(!runConsole({ op: 'act', target: 'console.screens', path: 'nothing-here', action: 'open' }, { clients: [{ id: 'tab-1', lastSeen: Date.now(), catalog: { items: [{ kind: 'screen', id: 'home', label: 'Home' }] } }] }).noConsole, 'an unknown screen is not flagged');
  assert.ok(confirmSalt().length >= 32, 'salt kept in the data folder');
});

t('recent = the console in front (Molly)', () => {
  const cat = { items: [{ kind: 'screen', id: 'home', label: 'Home' }] };
  // the console inside Molly was touched last but Molly shows another app now; the phone's console is on screen
  const two = [
    { id: 'in-molly', app: 'molly/console-web', host: 'molly', front: false, lastUsed: NOW, lastSeen: NOW, catalog: cat },
    { id: 'phone-1', front: true, lastUsed: NOW - 60_000, lastSeen: NOW, catalog: cat },
  ];
  const r = runConsole({ op: 'act', target: 'console.screens', path: 'home', action: 'open' }, { clients: two });
  assert.deepEqual(r.deliver.to, ['phone-1'], 'the visible one wins over the one used last');
  two[0].front = true;
  assert.deepEqual(runConsole({ op: 'act', target: 'console.screens', path: 'home', action: 'open' }, { clients: two }).deliver.to, ['in-molly'], 'both in front: used last');
  const list = runConsole({ op: 'list', target: 'console.clients' }, { clients: two });
  const m = list.items.find((c) => c.id === 'in-molly');
  assert.ok(m.app === 'molly/console-web' && m.host === 'molly' && m.front === true, JSON.stringify(m));
  assert.equal(list.items.find((c) => c.id === 'phone-1').host, undefined, 'standalone has no host');
});

t('Molly is its own client: to=molly, recent by catalog, lists span every client', () => {
  const inMolly = { id: 'tab-1', app: 'molly/console-web', host: 'molly', front: true, lastUsed: NOW, lastSeen: NOW, catalog: { items: [{ kind: 'screen', id: 'plan-studio', label: 'Plan Studio' }, { kind: 'action', id: 'terminal.open', label: 'Open output terminal' }] } };
  const molly = { id: 'molly-1', app: 'molly', front: true, lastUsed: NOW - 5_000, lastSeen: NOW, catalog: { items: [{ kind: 'screen', id: 'console/nav:builds', label: 'Builds' }, { kind: 'action', id: 'molly.reload', label: 'Reload this app' }, { kind: 'settings', id: 'xlayout', label: 'xLayout', parent: 'plugins' }] } };
  const both = [inMolly, molly];
  // the console inside Molly was touched last, yet a Molly action goes to Molly and a console screen to the console
  assert.deepEqual(runConsole({ op: 'act', target: 'console.actions', path: 'molly.reload', action: 'run' }, { clients: both }).deliver.to, ['molly-1'], 'recent resolves per catalog');
  assert.deepEqual(runConsole({ op: 'act', target: 'console.screens', path: 'plan studio', action: 'open' }, { clients: both }).deliver.to, ['tab-1']);
  assert.deepEqual(runConsole({ op: 'act', target: 'console.settings', path: 'plugins/xlayout', action: 'open' }, { clients: both }).deliver.to, ['molly-1'], 'a Molly settings sub-tab');
  assert.deepEqual(runConsole({ op: 'act', target: 'console.nav', path: 'here', action: 'home', input: { to: 'molly' } }, { clients: both }).deliver.to, ['molly-1'], 'to=molly names Molly itself');
  assert.deepEqual(runConsole({ op: 'act', target: 'console.nav', path: 'here', action: 'home', input: { to: 'console' } }, { clients: both }).deliver.to, ['tab-1'], 'to=console names a console, inside Molly too');
  assert.equal(runConsole({ op: 'act', target: 'console.nav', path: 'here', action: 'home', input: { to: 'amberx' } }, { clients: both }).code, 'not_found', 'an app with no client');
  const list = runConsole({ op: 'list', target: 'console.actions' }, { clients: both });
  assert.deepEqual(list.items.map((i) => `${i.app}:${i.id}`), ['molly/console-web:terminal.open', 'molly:molly.reload'], 'a list spans every open client, tagged by app');
  assert.deepEqual(runConsole({ op: 'list', target: 'console.actions', select: { client: 'molly' } }, { clients: both }).items.map((i) => i.id), ['molly.reload'], 'select.client takes an app name');
  assert.deepEqual(commandFromArgv(['list', 'actions', '--to', 'molly']).command.select, { client: 'molly' }, 'CLI --to molly on a list');
  assert.deepEqual(commandFromArgv(['action', 'molly.reload', '--to', 'molly']).command.input, { to: 'molly' }, 'CLI --to molly on an action');
});

t('answers as text', () => {
  assert.equal(formatAnswer({ ok: true, op: 'act', action: 'open', target: 'console.screens', item: { id: 'plan-studio', label: 'Plan Studio' }, delivered: [{ client: 'tab-1', ok: true, message: 'opened Plan Studio' }] }), '✓ open Plan Studio (plan-studio) → tab-1: opened Plan Studio');
  assert.ok(formatAnswer({ ok: true, op: 'act', action: 'open', target: 'console.screens', item: { id: 'home', label: 'Home' }, queued: true, message: 'queued, waiting for the console' }).startsWith('queued: open Home'), 'queued');
  assert.ok(formatAnswer({ ok: true, op: 'act', action: 'open', target: 'console.screens', item: { id: 'home', label: 'Home' }, delivery: { how: 'woke via AmberX' }, delivered: [{ client: 'tab-1', ok: true, message: 'opened Home' }] }).includes('(woke via AmberX)'), 'says how');
  assert.ok(formatAnswer({ ok: false, code: 'confirmation_required', message: 'm', confirm: 'c1.abc' }).includes('c1.abc'));
  assert.equal(formatAnswer({ ok: true, op: 'list', target: 'console.clients', items: [] }), 'no console is open right now');
  assert.ok(formatAnswer({ ok: true, op: 'get', target: 'console.nav', value: { screen: 'home' } }).includes('screen home'));
});

let sent = null;
const fakeFetch = async (url, init) => { sent = { url, init }; return { status: 200, text: async () => JSON.stringify({ ok: true, op: 'act', echoed: JSON.parse(init.body) }) }; };
const r = await sendToConsole({ op: 'act', target: 'console.nav', path: 'here', action: 'home' }, { base: 'https://c.example/', token: 'tok', fetch: fakeFetch });
t('sendToConsole', () => {
  assert.equal(sent.url, 'https://c.example/api/console');
  assert.equal(sent.init.headers.authorization, 'Bearer tok');
  assert.equal(r.echoed.$axf, 'control@1');
});
const down = await sendToConsole({ op: 'list', target: 'console.clients' }, { base: 'https://c.example', fetch: async () => { throw new Error('offline'); } });
t('network trouble is an answer', () => assert.equal(down.code, 'unexpected'));

t('run on stdin (what the server calls)', () => {
  const p = spawnSync(process.execPath, [fileURLToPath(new URL('./console.mjs', import.meta.url)), 'run'], { input: JSON.stringify({ command: { op: 'act', target: 'console.screens', path: 'home', action: 'open' }, grants: ['*'], by: 'mcp', clients }), encoding: 'utf8', env: process.env });
  const j = JSON.parse(p.stdout.trim().split('\n').pop());
  assert.ok(j.ok && j.deliver.message.target === 'home', p.stderr || p.stdout);
});

console.log(`✓ console-commands: ${n} tests passed`);
