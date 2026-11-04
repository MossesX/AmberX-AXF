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

t('CLI words: every app (apps-control-surface)', () => {
  assert.deepEqual(commandFromArgv(['app', 'amberx', 'open', 'to-dos']).command, { op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'amberx' } });
  assert.deepEqual(commandFromArgv(['app', 'molly', 'action', 'xlayout.ide', '--to', 'all']).command, { op: 'act', target: 'apps.actions', path: 'xlayout.ide', action: 'run', input: { to: 'all', app: 'molly' } });
  assert.deepEqual(commandFromArgv(['app', 'hub', 'where']).command, { op: 'get', target: 'apps.nav', path: 'here', input: { app: 'hub' } });
  assert.deepEqual(commandFromArgv(['app', 'hub', 'list', 'settings', 'pass']).command, { op: 'list', target: 'apps.settings', select: { app: 'hub', q: 'pass' } });
  assert.deepEqual(commandFromArgv(['app', 'amberx', 'clients']).command, { op: 'list', target: 'apps.clients', select: { app: 'amberx' } });
  assert.deepEqual(commandFromArgv(['app', 'amberx', 'back']).command, { op: 'act', target: 'apps.nav', path: 'here', action: 'back', input: { app: 'amberx' } });
  assert.deepEqual(commandFromArgv(['apps']).command, { op: 'list', target: 'apps.list' });
  assert.deepEqual(commandFromArgv(['apps', 'amber', '--online']).command, { op: 'list', target: 'apps.list', select: { q: 'amber', online: true } });
  assert.ok(commandFromArgv(['app']).error, 'app without a name is a usage error');
  assert.ok(commandFromArgv(['app', 'amberx']).error, 'app without a verb is a usage error');
  const apps = formatAnswer({ ok: true, op: 'list', target: 'apps.list', items: [{ id: 'amberx-droid', label: 'AmberX', online: 1, screens: 3, settings: 1, dialogs: 0, actions: 2, here: { screenLabel: 'Inbox' }, url: 'https://amberx.amberxai.com' }] });
  assert.ok(apps.includes('amberx-droid') && apps.includes('1 online') && apps.includes('Inbox'), `apps rows (${apps})`);
  const r = runConsole({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'amberx' } }, { clients: [{ id: 'amber-1', app: 'amberx-droid', lastUsed: NOW, lastSeen: NOW, catalog: { items: [{ kind: 'screen', id: 'todos', label: 'To-dos' }] } }] });
  assert.ok(r.ok && r.deliver.to.join() === 'amber-1' && r.deliver.message.app === 'amberx-droid' && r.app === 'amberx-droid', `runner: apps domain through the gate (${JSON.stringify(r)})`);
  const denied = runConsole({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'amberx' } }, { grants: ['control.console.navigate'], clients: [] });
  assert.ok(!denied.ok && denied.code === 'denied' && denied.requires === 'control.apps.navigate', 'the console grant does not cover other apps');
  const none = runConsole({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'amberx' } }, { clients: [] });
  assert.ok(!none.ok && none.noConsole === true && none.url === 'https://amberx.amberxai.com' && none.label === 'AmberX', `no AmberX open: noConsole with its address from framework/schemas/apps.json (${JSON.stringify(none)})`);
  assert.ok(!runConsole({ op: 'list', target: 'tokens.theme' }).ok, 'other domains are refused here');
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
