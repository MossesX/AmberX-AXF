// @ts-nocheck: a Node test, not part of the console's build
/** Phone Connect CLI: argv → REST request (pure). node --experimental-strip-types apps/console-web/plugins/phone-connect/test.mts */
import assert from 'node:assert/strict';
import { cliWords, request } from './phone-connect.mjs';

const cases: [string[], object][] = [
  [['status'], { method: 'GET', path: '/status' }],
  [['state'], { method: 'GET', path: '/state' }],
  [['pair'], { method: 'POST', path: '/pair/start', body: {} }],
  [['pair', '--cancel'], { method: 'POST', path: '/pair/cancel', body: {} }],
  [['devices'], { method: 'GET', path: '/devices' }],
  [['revoke', 'phone-0123456789abcdef'], { method: 'POST', path: '/devices/phone-0123456789abcdef/revoke', body: {} }],
  [['open', 'https://console.amberxai.com/x', '--where', 'browser'], { method: 'POST', path: '/open', body: { url: 'https://console.amberxai.com/x', where: 'browser' } }],
  [['notify', 'Build', 'landed', '--body', 'PR 787'], { method: 'POST', path: '/notify', body: { title: 'Build landed', kind: 'fyi', body: 'PR 787' } }],
  [['recorder', 'start', 'Build', 'review', '--approval', 'a'], { method: 'POST', path: '/recorder/start', body: { session: 'Build review', approvalId: 'a' } }],
  [['recorder', 'stop'], { method: 'POST', path: '/recorder/stop', body: {} }],
  [['recorder', 'status', '--ask'], { method: 'GET', path: '/recorder/status?ask=1' }],
  [['voice', 'say', 'hello', 'Brett'], { method: 'POST', path: '/voice', body: { mode: 'say', text: 'hello Brett' } }],
  [['command', 'abc', '--wait', '10'], { method: 'GET', path: '/commands/abc?wait=10' }],
  [['settings', '--off', 'voice'], { method: 'POST', path: '/settings', body: { features: { voice: false } } }],
];
for (const [argv, want] of cases) assert.deepEqual(request(argv), want, argv.join(' '));
assert.throws(() => request(['open']));
assert.throws(() => request(['approve']));
for (const w of ['approve', 'deny', 'decide', 'shelve']) assert.ok(!cliWords.includes(w), `no ${w} word`);
console.log(`phone-connect cli: ${cases.length + 3} checks passed`);
