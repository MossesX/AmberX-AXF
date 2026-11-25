/**
 * pass-voice@1 (build approval-pass-covers-every-call, s9): a spoken pass command, the MCP call, the REST request and
 * the CLI words are the same thing. Checks the engine against framework/spec/fixtures/pass-voice.json and that the
 * console registers the actions and the `#/passes/<id>` page that reach it.
 *
 *   node apps/console-web/plugins/gate/test/test.pass-voice.mjs            check
 *   node apps/console-web/plugins/gate/test/test.pass-voice.mjs --write    regenerate the fixture after changing the engine
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { activePassId, cleanPassPhrase, coversText, passVoiceCli, passVoiceIntent, passVoiceReply, passVoiceRest, voiceCovers, voiceMinutes, PASS_VOICE_FRAME } from '../web/pass-voice.mjs';

const FIXTURE = new URL('../../../../../framework/spec/fixtures/pass-voice.json', import.meta.url);
const web = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
/** The pass a `needsId` intent is filled with in the fixture. */
const ID = '2b0c7c1e-5a0f-4c69-9a55-0d3f6f1f9f10';

const PHRASES = [
  'give me a pass for 30 minutes', 'Pass for an hour.', 'Hey Amber, a 24 hour pass please', 'pass for everything for 2 hours', 'start a pass for half an hour',
  'pass for everything including deletes for half an hour', 'pass for vps and the console for an hour', 'pass for vps run for 30 minutes',
  'pass for vps.run, github for 45 minutes', 'pass for the server commands and session stops for twenty minutes', 'pass for theme changes for 15 minutes',
  'make the pass cover everything', 'the pass covers vps and github', 'make the pass only cover the console', 'make the pass quiet', 'make the pass silent',
  'end the pass', 'revoke my pass', 'turn the pass off', 'pass status', 'what does the pass cover?', 'is a pass on',
  // not pass commands, or not readable: nothing is sent
  'pass for vps including deletes for an hour', 'pass for 3 days', 'pass the salt', 'scroll down', 'make the pass cover ???', 'pass for $$ for 10 minutes', '',
];

const cases = PHRASES.map((phrase) => {
  const intent = passVoiceIntent(phrase);
  return intent ? { phrase, intent, rest: passVoiceRest(intent, ID), cli: passVoiceCli(intent, ID) } : { phrase, intent: null };
});

if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, `${JSON.stringify({ $axf: PASS_VOICE_FRAME, pass: ID, cases }, null, 2)}\n`);
  console.log(`✓ wrote ${cases.length} cases to framework/spec/fixtures/pass-voice.json`);
  process.exit(0);
}

let n = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`✗ ${name}\n  ${e.message}`); } };

test('the engine answers every fixture phrase the same way (intent, REST request, CLI words)', () => {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(fx.$axf, PASS_VOICE_FRAME);
  assert.deepEqual(fx.cases.map((c) => c.phrase), PHRASES, 'the fixture has every phrase (run with --write after changing the list)');
  for (const [i, c] of fx.cases.entries()) assert.deepEqual(cases[i], c, `voice: ${c.phrase}`);
});

test('a grant covers everything unless the phrase names something; lengths are whole minutes up to a day', () => {
  assert.deepEqual(passVoiceIntent('pass for 30 minutes').arguments.covers, 'all');
  assert.equal(passVoiceIntent('a 24 hour pass').arguments.minutes, 1440);
  assert.equal(voiceMinutes('for a day'), 1440);
  assert.equal(voiceMinutes('for 2 days'), null);
  assert.equal(voiceMinutes('for 0 minutes'), null);
  assert.equal(voiceMinutes('soon'), null);
  assert.deepEqual(voiceCovers('the console and vps run'), ['axf-console', 'vps.run']);
  assert.deepEqual(voiceCovers('every tool'), 'all');
  assert.equal(voiceCovers('vps and <script>'), null);
  assert.equal(cleanPassPhrase('  OK Amber, please end the pass now!  '), 'end the pass');
  // only a pass for everything may include irreversible calls
  assert.equal(passVoiceIntent('pass for vps including deletes for an hour'), null);
  assert.equal(passVoiceIntent('pass for everything including deletes for an hour').arguments.include_irreversible, true);
});

test('every intent is one hub call: the MCP tool, its REST twin and its CLI twin', () => {
  const grant = passVoiceIntent('pass for vps run and the console for an hour');
  assert.equal(grant.tool, 'axhub.pass_grant');
  assert.deepEqual(passVoiceRest(grant), { method: 'POST', path: '/auth/api/passes', body: grant.arguments });
  assert.deepEqual(passVoiceCli(grant), ['passes', 'grant', '60', '--covers', 'vps.run,axf-console', '--reason', 'Pass for 60 minutes (voice)']);

  const update = passVoiceIntent('make the pass cover everything');
  assert.deepEqual(update, { tool: 'axhub.pass_update', arguments: { covers: 'all' }, needsId: true });
  assert.equal(passVoiceRest(update), null, 'no request without the pass id');
  assert.equal(passVoiceCli(update), null);
  assert.deepEqual(passVoiceRest(update, ID), { method: 'POST', path: `/auth/api/passes/${ID}/update`, body: { covers: 'all' } });
  assert.deepEqual(passVoiceCli(update, ID), ['passes', 'update', ID, '--covers', 'all']);
  assert.deepEqual(passVoiceRest({ tool: 'axhub.pass_update', arguments: { id: ID, quiet_notice: false } }), { method: 'POST', path: `/auth/api/passes/${ID}/update`, body: { quiet_notice: false } }, 'the id never goes in the body');
  assert.deepEqual(passVoiceCli({ tool: 'axhub.pass_update', arguments: { id: ID, quiet_notice: false } }), ['passes', 'update', ID, '--quiet-notice', 'off']);

  const revoke = passVoiceIntent('end the pass');
  assert.deepEqual(passVoiceRest(revoke, ID), { method: 'POST', path: `/auth/api/passes/${ID}/revoke`, body: {} });
  assert.deepEqual(passVoiceCli(revoke, ID), ['passes', 'revoke', ID]);
  assert.equal(passVoiceRest(revoke, '../users'), null, 'a bad id is never put in a path');

  const status = passVoiceIntent('pass status');
  assert.deepEqual(passVoiceRest(status), { method: 'GET', path: '/auth/api/passes' });
  assert.deepEqual(passVoiceRest(status, 'feed:axf-console:p1'), { method: 'GET', path: '/auth/api/passes/feed%3Aaxf-console%3Ap1' });
  assert.deepEqual(passVoiceCli(status), ['passes', 'list']);
  assert.deepEqual(passVoiceCli(status, ID), ['passes', 'show', ID]);
  assert.equal(passVoiceRest(null), null);
  assert.equal(coversText([{ service: 'vps', tool: 'run' }, { service: '*', scope: 'tokens.theme' }, 'github']), 'vps.run,scope:tokens.theme,github');
});

test('the pass a command is about is the active stored one ending last; replies read the hub answer', () => {
  const passes = [
    { id: 'a', active: true, secondsLeft: 600, expiresAt: '2026-11-25T15:10:00.000Z', grantedVia: 'web' },
    { id: 'b', active: true, secondsLeft: 3600, expiresAt: '2026-11-25T16:00:00.000Z', grantedVia: 'approval' },
    { id: 'feed:axf-console:p1', active: true, secondsLeft: 9000, expiresAt: '2026-11-25T17:30:00.000Z', grantedVia: 'feed' },
    { id: 'c', active: false, secondsLeft: 0, expiresAt: '2026-11-25T18:00:00.000Z', grantedVia: 'web' },
  ];
  assert.equal(activePassId(passes), 'b');
  assert.equal(activePassId([]), '');
  assert.equal(activePassId(null), '');
  assert.equal(passVoiceReply(passVoiceIntent('pass for an hour'), { pass: { scopeLabel: 'everything', secondsLeft: 3600 } }), 'Pass on: everything for 60 minutes.');
  assert.equal(passVoiceReply(passVoiceIntent('make the pass cover vps'), { pass: { scopeLabel: 'vps', secondsLeft: 600 } }), 'The pass now covers vps.');
  assert.equal(passVoiceReply(passVoiceIntent('end the pass'), { pass: {} }), 'The pass has ended.');
  assert.equal(passVoiceReply(passVoiceIntent('pass status'), { active: [] }), 'No pass is on.');
  assert.equal(passVoiceReply(passVoiceIntent('pass status'), { active: [{ scopeLabel: 'everything', secondsLeft: 1500, runs: 3, active: true }] }), 'A pass covers everything for 25 minutes more; 3 calls ran under it.');
  assert.equal(passVoiceReply(passVoiceIntent('pass status'), { pass: { active: false, secondsLeft: 0, runs: 1 } }), 'That pass has ended. 1 call ran under it.');
  assert.equal(passVoiceReply(passVoiceIntent('pass status'), { error: { message: 'Sign in to the hub first.' } }), 'Sign in to the hub first.');
});

test('the console reaches it: actions for every part, the deep link on the page, the hub relay and no token', () => {
  const actions = web('hubPassActions.ts');
  for (const a of ['open', 'status', 'grant', 'update', 'quiet', 'revoke', 'voice']) assert.match(actions, new RegExp(`register\\('axhub\\.passes\\.${a}'`), `action axhub.passes.${a}`);
  assert.match(actions, /passVoiceRest\(intent, pass\)/, 'actions send the REST twin of the intent');
  assert.match(actions, /from '@console\/hubPages\/api'/, 'through the hub relay');
  assert.ok(!/consoleToken|Authorization|Bearer/.test(actions), 'never a token');
  assert.match(web('index.tsx'), /registerHubPassActions\(rt\)/);
  assert.match(web('HubPasses.tsx'), /useRouteParams\('passes'\)/);
  assert.match(web('HubPasses.tsx'), /<HubPassDetail key=\{openId\} id=\{openId\} \/>/);
  assert.match(web('HubPassDetail.tsx'), /\/auth\/api\/passes\/\$\{encodeURIComponent\(id\)\}/);
});

console.log(`${process.exitCode ? '✗' : '✓'} gate pass-voice: ${n} tests passed`);
