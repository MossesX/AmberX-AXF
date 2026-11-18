#!/usr/bin/env node
/**
 * phone-connect@1 conformance (PHONE-CONNECT.md; Brett, Nov 17 2026: "You gonna build it or what?").
 *   1. the engine replays fixtures/phone-connect.json: record validation (device, pairing, command, result), makeCommand
 *      (aliases, fixed policy, ttl, forbidden arguments), toWire / fromWire, the dispatch order, personOnly decisions,
 *      presence words, the url rule, the pairing flow (issue → claim → rotate → revoke; a session never claims),
 *      the AmberX migration
 *   2. the wire error codes are frozen: the fixture's `errors` table never changes meaning (a changed or dropped code fails)
 *   3. the registry snapshot (schemas/phone-connect.json) and the four JSON Schemas (schemas/json/phone-*.schema.json)
 *      match framework/core/phone-connect.mjs (run `node framework/cli/axf.mjs schemas` after changing it), and every
 *      fixture record that validates also passes its JSON Schema (a small draft 2020-12 subset evaluator below)
 *
 *   node framework/spec/check-phone-connect.mjs            check
 *   node framework/spec/check-phone-connect.mjs --write    regenerate the fixture's expected outputs (review the diff)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/phone-connect.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/phone-connect.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let failed = 0, passed = 0;
const ok = (cond, what, detail = '') => { if (cond) passed++; else { failed++; console.error(`✗ ${what}${detail ? `\n  ${detail}` : ''}`); } };

/* ── inputs (the fixture's `cases`; outputs are generated with --write) ───────────────────────────────────────────── */

const T0 = '2026-11-17T17:00:00.000Z';
const at = (s) => new Date(Date.parse(T0) + s * 1000).toISOString();
const ORIGIN = 'https://console.amberxai.com';
const ID = 'phone-0123456789abcdef';
const CMD = '5c2a9d1e-3b4f-4a6c-8d7e-9f0a1b2c3d4e';
const APPR = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TAP = '9f8e7d6c-5b4a-4f3e-8d2c-1b0a9f8e7d6c';
const PERSON = { kind: 'person', who: 'brett' };
const SESSION = { kind: 'session', who: 'axf-build-x', via: 'mcp' };
const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

const device = (over = {}) => ({
  $axf: 'phone-device@1', deviceId: ID, name: 'samsung SM-S938B', app: 'phone-connect-droid', appVersion: '1.0.0', platform: 'android',
  capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1', 'voice@1'], state: 'paired', owner: PERSON,
  token: { prefix: 'tok_AbCd', hash: 'a'.repeat(64), issuedAt: at(-3600), rotatedAt: '' }, watch: { on: true, ring: true },
  urlPolicy: { mode: 'own', allowlist: [] }, pairedAt: at(-3600), lastSeenAt: at(-10), revokedAt: '', updatedAt: at(-10), capabilityState: { 'recorder@1': { running: false } }, ...over,
});
const pairing = (over = {}) => ({ $axf: 'phone-pairing@1', code: 'K7M3R9XP', issuedAt: T0, expiresAt: at(600), issuedBy: SESSION, state: 'pending', deviceId: '', claimedAt: '', claimedBy: null, ended: '', endedAt: '', ...over });
const command = (over = {}) => ({ $axf: 'phone-command@1', id: CMD, at: T0, deviceId: ID, command: 'open_url', arguments: { url: `${ORIGIN}/?x=1`, where: 'overlay', browser: 'default' }, policy: 'allow', ttl: 60, from: SESSION, correlationId: '', approvalId: '', ...over });
const result = (over = {}) => ({ $axf: 'phone-result@1', id: CMD, deviceId: ID, command: 'open_url', at: at(1), stage: 'ack', ok: true, status: 'shown', by: { kind: 'device' }, ...over });

export const CASES = {
  devices: {
    'paired phone': device(),
    'unpaired fresh record': device({ state: 'unpaired', owner: '', token: null, pairedAt: '', lastSeenAt: '', capabilityState: {} }),
    'migrated AmberX record (paired, no token)': { ...device({ deviceId: 'amberx-0123456789abcdef', app: 'amberx-droid', token: null, capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1'] }), migratedFrom: { deviceId: 'amberx-0123456789abcdef', app: 'amberx-droid', at: T0 } },
    'paired without an owner': device({ owner: '' }),
    'owner is a session': device({ owner: SESSION }),
    'token stored in clear': device({ token: { prefix: 'tok_AbCd', hash: `tok_${'A'.repeat(32)}`, issuedAt: T0, rotatedAt: '' } }),
    'unknown capability and bad allowlist host': device({ capabilities: ['open-url@1', 'wake-word@1'], urlPolicy: { mode: 'allowlist', allowlist: ['axhub.amberxai.com', 'http://bad'] } }),
    'bad id, name too long, bad app, no watch': device({ deviceId: 'short', name: 'x'.repeat(81), app: 'amberx-web', watch: undefined }),
    'not an object': 'nope',
  },
  pairings: {
    'pending code': pairing(),
    'claimed by a person': pairing({ state: 'claimed', deviceId: ID, claimedAt: at(30), claimedBy: PERSON, ended: 'claimed', endedAt: at(30) }),
    'expired': pairing({ state: 'expired', ended: 'expired', endedAt: at(600) }),
    'claimed by a session': pairing({ state: 'claimed', deviceId: ID, claimedAt: at(30), claimedBy: SESSION, ended: 'claimed', endedAt: at(30) }),
    'claimed with nothing filled': pairing({ state: 'claimed' }),
    'ambiguous code (0 and O), wrong lifetime': pairing({ code: 'K0M3R9XO', expiresAt: at(300) }),
    'pending but ended': pairing({ ended: 'cancelled', endedAt: at(1) }),
  },
  make: {
    'open_url fills where, browser, ttl': { command: 'open_url', arguments: { url: `${ORIGIN}/?x=1` }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'amberx.open_url alias is deprecated': { command: 'amberx.open_url', arguments: { url: `${ORIGIN}/?x=1` }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'phone.recorder_start alias (not deprecated)': { command: 'phone.recorder_start', arguments: { session: 'Build review' }, deviceId: ID, from: PERSON, id: CMD, at: T0, approvalId: APPR },
    'approval ttl = secondsLeft': { command: 'approval', arguments: { approvalId: APPR, kind: 'veto', tool: 'vps.run', summary: 'restart the console', secondsLeft: 90 }, deviceId: ID, from: { kind: 'service', who: 'axhub', via: 'hub' }, id: CMD, at: T0 },
    'approval default actions and ttl': { command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, deviceId: ID, from: { kind: 'service', who: 'axhub', via: 'hub' }, id: CMD, at: T0 },
    'voice listen ttl = timeout + 10': { command: 'voice', arguments: { mode: 'listen', timeoutSeconds: 5 }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'voice say': { command: 'voice', arguments: { mode: 'say', text: 'Build landed.' }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'voice say without text': { command: 'voice', arguments: { mode: 'say' }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'notify needs notifyId': { command: 'notify', arguments: { kind: 'fyi', title: 'PR #787 landed' }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'notify full': { command: 'notify', arguments: { kind: 'fix', title: 'CI red on main', body: 'check-theme failed', url: `${ORIGIN}/builds`, notifyId: 'builds.ci-red', priority: 'high' }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'unknown command': { command: 'amberx.wake_word', arguments: {}, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'approval with a decision is refused': { command: 'approval', arguments: { approvalId: APPR, kind: 'approval', decision: 'approve' }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'recorder.start with mic is refused': { command: 'recorder.start', arguments: { session: 'x', mic: true }, deviceId: ID, from: PERSON, id: CMD, at: T0, approvalId: APPR },
    'recorder.status takes no arguments': { command: 'recorder.status', arguments: { verbose: true }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'open_url url too long': { command: 'open_url', arguments: { url: `${ORIGIN}/?${'x'.repeat(2000)}` }, deviceId: ID, from: SESSION, id: CMD, at: T0 },
    'from a session with no who': { command: 'recorder.stop', arguments: {}, deviceId: ID, from: { kind: 'session' }, id: CMD, at: T0 },
  },
  commands: {
    'valid open_url': command(),
    'policy lies (recorder.start as allow)': command({ command: 'recorder.start', arguments: { session: 'x' }, policy: 'allow', approvalId: APPR }),
    'ttl too long, bad id, missing from': command({ ttl: 7200, id: 'cmd-1', from: undefined }),
    'approvalId not a uuid': command({ approvalId: 'abc' }),
  },
  results: {
    'ack shown': result(),
    'done with data and state': result({ command: 'recorder.status', stage: 'done', status: undefined, data: { running: true, since: T0, session: 'Build review', parts: 2, queue: 0, mic: false }, state: { 'recorder@1': { running: true } } }),
    'done by a person (decision)': result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'approve' }, by: { kind: 'person', tap: TAP } }),
    'done error offline': result({ stage: 'done', status: undefined, ok: false, error: { code: 'offline', message: 'samsung SM-S938B is offline: last seen 12 min ago. Open the app or switch the watch on.', retryable: true } }),
    'ack cannot fail': result({ ok: false }),
    'ack with state': result({ state: { 'recorder@1': {} } }),
    'error with wrong retryable and unknown code': result({ stage: 'done', status: undefined, ok: false, error: { code: 'offline', message: 'x', retryable: false } }),
    'done ok missing data is fine, person without tap is not': result({ stage: 'done', status: undefined, by: { kind: 'person' } }),
    'unknown error code': result({ stage: 'done', status: undefined, ok: false, error: { code: 'boom', message: 'x', retryable: false } }),
  },
  wire: {
    open_url: command(),
    'voice say': command({ command: 'voice', arguments: { mode: 'say', text: 'Build landed.', timeoutSeconds: 10 }, ttl: 20 }),
    'voice listen': command({ command: 'voice', arguments: { mode: 'listen', timeoutSeconds: 5 }, ttl: 15 }),
    'recorder.start': command({ command: 'recorder.start', arguments: { session: 'Build review' }, policy: 'confirm', ttl: 120, approvalId: APPR }),
  },
  fromWire: {
    ack: { protocol: 'axpp@1', kind: 'ack', correlationId: CMD, status: 'shown' },
    'ack bad status falls to queued': { protocol: 'axpp@1', kind: 'ack', correlationId: CMD, status: 'later' },
    result: { protocol: 'axpp@1', kind: 'result', correlationId: CMD, payload: { opened: true }, state: { 'open-url@1': { last: `${ORIGIN}/?x=1` } } },
    'result by person': { protocol: 'axpp@1', kind: 'result', correlationId: CMD, payload: { decision: 'deny' }, by: { kind: 'person', tap: TAP } },
    error: { protocol: 'axpp@1', kind: 'error', correlationId: CMD, error: { code: 'consent_required', message: 'Android asks first' } },
    'error unknown code': { protocol: 'axpp@1', kind: 'error', correlationId: CMD, error: { code: 'kaboom', message: 'x' } },
    'wrong correlation': { protocol: 'axpp@1', kind: 'result', correlationId: APPR, payload: {} },
    'wrong protocol': { protocol: 'axpp@2', kind: 'ack', correlationId: CMD },
    'unknown kind': { protocol: 'axpp@1', kind: 'ping', correlationId: CMD },
  },
  dispatch: {
    'ok': { command: command(), device: device(), at: at(1) },
    '1 unknown command': { command: command({ command: 'wake_word' }), device: device(), at: at(1) },
    '2 malformed envelope': { command: command({ ttl: 0 }), device: device(), at: at(1) },
    '3 revoked': { command: command(), device: device({ state: 'revoked', token: null, revokedAt: T0 }), at: at(1) },
    '3 no device': { command: command(), device: null, at: at(1) },
    '4 not paired': { command: command(), device: device({ state: 'pending', owner: '', token: null }), at: at(1) },
    '5 lacks capability': { command: command({ command: 'voice', arguments: { mode: 'say', text: 'hi', timeoutSeconds: 10 }, ttl: 20 }), device: device({ capabilities: ['open-url@1'] }), at: at(1) },
    '6 confirm without approvalId': { command: command({ command: 'recorder.start', arguments: { session: 'x' }, policy: 'confirm', ttl: 120 }), device: device(), at: at(1) },
    '7 url outside policy': { command: command({ arguments: { url: 'https://evil.example/?x', where: 'overlay', browser: 'default' } }), device: device(), at: at(1) },
    '7 url scheme': { command: command({ arguments: { url: 'intent://scan/#Intent;scheme=zxing;end', where: 'overlay', browser: 'default' } }), device: device(), at: at(1) },
    '8 offline': { command: command(), device: device({ lastSeenAt: at(-120) }), at: at(1) },
    '9 ttl passed': { command: command(), device: device({ lastSeenAt: at(100) }), at: at(100) },
    'other device': { command: command({ deviceId: 'phone-fedcba9876543210' }), device: device(), at: at(1) },
  },
  decisions: {
    'brett tapped over the device token': { result: result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'approve' }, by: { kind: 'person', tap: TAP } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval', actions: ['approve', 'deny'] }, ttl: 600 }), auth: { kind: 'device', deviceId: ID } },
    'no decision is fine': { result: result({ command: 'approval', stage: 'done', status: undefined, data: {} }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, ttl: 600 }), auth: { kind: 'device' } },
    'the device on its own': { result: result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'approve' }, by: { kind: 'device' } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, ttl: 600 }), auth: { kind: 'device' } },
    'a session over MCP': { result: result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'approve' }, by: { kind: 'person', tap: TAP } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, ttl: 600 }), auth: { kind: 'session', who: 'axf-build-x' } },
    'a person over the console (not the phone)': { result: result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'deny' }, by: { kind: 'person', tap: TAP } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, ttl: 600 }), auth: { kind: 'person', who: 'brett' } },
    'no tap uuid': { result: result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'approve' }, by: { kind: 'person' } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, ttl: 600 }), auth: { kind: 'device' } },
    'shelve not offered': { result: result({ command: 'approval', stage: 'done', status: undefined, data: { decision: 'shelve' }, by: { kind: 'person', tap: TAP } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'veto', actions: ['deny'] }, ttl: 600 }), auth: { kind: 'device' } },
    'decision on an open_url': { result: result({ stage: 'done', status: undefined, data: { decision: 'approve' }, by: { kind: 'person', tap: TAP } }), command: command(), auth: { kind: 'device' } },
    'decision on an ack': { result: result({ command: 'approval', data: { decision: 'approve' }, by: { kind: 'person', tap: TAP } }), command: command({ command: 'approval', arguments: { approvalId: APPR, kind: 'approval' }, ttl: 600 }), auth: { kind: 'device' } },
  },
  presence: {
    online: { device: device(), at: at(1) },
    'edge 45 s': { device: device({ lastSeenAt: T0 }), at: at(45) },
    'offline 46 s': { device: device({ lastSeenAt: T0 }), at: at(46) },
    'offline 12 min': { device: device({ lastSeenAt: at(-720) }), at: T0 },
    'offline 3 h': { device: device({ lastSeenAt: at(-10800) }), at: T0 },
    'offline 4 days': { device: device({ lastSeenAt: at(-345600) }), at: T0 },
    'never seen': { device: device({ lastSeenAt: '' }), at: T0 },
    'not paired': { device: device({ state: 'unpaired', owner: '', token: null }), at: T0 },
    pending: { device: device({ state: 'pending', owner: '', token: null }), at: T0 },
    revoked: { device: device({ state: 'revoked', token: null }), at: T0 },
    'no device': { device: null, at: T0 },
  },
  urls: {
    'own origin': { url: `${ORIGIN}/builds?x=1`, device: device() },
    'own origin, other host': { url: 'https://axhub.amberxai.com/approvals/1', device: device() },
    'allowlist hit': { url: 'https://axhub.amberxai.com/approvals/1', device: device({ urlPolicy: { mode: 'allowlist', allowlist: ['axhub.amberxai.com'] } }) },
    'allowlist miss': { url: 'https://evil.example/', device: device({ urlPolicy: { mode: 'allowlist', allowlist: ['axhub.amberxai.com'] } }) },
    'any': { url: 'https://evil.example/', device: device({ urlPolicy: { mode: 'any', allowlist: [] } }) },
    'http is denied even on any': { url: 'http://console.amberxai.com/', device: device({ urlPolicy: { mode: 'any', allowlist: [] } }) },
    'intent scheme': { url: 'intent://scan/#Intent;scheme=zxing;end', device: device({ urlPolicy: { mode: 'any', allowlist: [] } }) },
    'javascript scheme': { url: 'javascript:alert(1)', device: device() },
    'file scheme': { url: 'file:///sdcard/x', device: device() },
    'user info': { url: `https://brett:pw@console.amberxai.com/`, device: device() },
    'not a url': { url: 'console', device: device() },
    'empty': { url: '', device: device() },
    'too long': { url: `${ORIGIN}/?${'x'.repeat(2000)}`, device: device() },
  },
  migration: {
    'AmberX phone with its id': { old: { deviceId: 'amberx-0123456789abcdef', name: 'samsung SM-S938B', appVersion: '2.4.1', owner: 'brett', watch: true, ring: true } },
    'AmberX phone with no id': { old: { name: 'Galaxy' } },
  },
  autoApprove: ['recorder.start', 'vps.run', 'open_url', 'github.create_pr'],
};

/** The pairing flow with a seeded random source: every output is reproducible. */
export function pairingFlow() {
  const random = seeded(20261117);
  const steps = {};
  const issued = P.issuePairing({ at: T0, by: SESSION, random });
  steps.issued = issued;
  const hello = (person, code = issued.code) => ({ code, device: { deviceId: ID, name: 'samsung SM-S938B', app: 'phone-connect-droid', appVersion: '1.0.0', platform: 'android', capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1', 'voice@1'], capabilityState: { 'recorder@1': { running: false } } }, person });
  steps.claimBySession = P.claimPairing(issued, hello(SESSION), { at: at(30), random });
  steps.claimByToken = P.claimPairing(issued, hello({ kind: 'service', who: 'tok_x' }), { at: at(30), random });
  steps.claimNoPerson = P.claimPairing(issued, hello(undefined), { at: at(30), random });
  steps.claimWrongCode = P.claimPairing(issued, hello(PERSON, 'AAAAAAAA'), { at: at(30), random });
  steps.claimMalformed = P.claimPairing(issued, { code: issued.code }, { at: at(30), random });
  steps.claimExpired = P.claimPairing(issued, hello(PERSON), { at: at(600), random });
  const claim = P.claimPairing(issued, hello(PERSON), { at: at(30), random });
  steps.claim = claim;
  steps.tokenShape = { isToken: P.isToken(claim.token), prefixMatches: claim.device?.token?.prefix === claim.token?.slice(0, 8), hashMatches: claim.device?.token?.hash === P.tokenAtRest(claim.token, T0).hash, tokenNotInDevice: !JSON.stringify(claim.device).includes(claim.token) };
  steps.deviceValid = P.validateDevice(claim.device);
  steps.pairingValid = P.validatePairing(claim.pairing);
  steps.verifyOk = P.verifyToken(claim.device, claim.token);
  steps.verifyBad = P.verifyToken(claim.device, `tok_${'B'.repeat(32)}`);
  steps.verifyMalformed = P.verifyToken(claim.device, 'tok_short');
  steps.claimAgain = P.claimPairing(claim.pairing, hello(PERSON), { at: at(31), random });
  const rot = P.rotateToken(claim.device, claim.token, { at: at(60), random });
  steps.rotate = { ok: rot.ok, newTokenDiffers: rot.token !== claim.token, issuedAtKept: rot.device?.token?.issuedAt === claim.device.token.issuedAt, rotatedAt: rot.device?.token?.rotatedAt, oldTokenAfterSwap: P.verifyToken(rot.device, claim.token), newTokenAfterSwap: P.verifyToken(rot.device, rot.token) };
  steps.rotateWithBadToken = P.rotateToken(claim.device, `tok_${'C'.repeat(32)}`, { at: at(60), random });
  steps.revokeBySession = P.revokeDevice(rot.device, SESSION, at(90));
  const rev = P.revokeDevice(rot.device, PERSON, at(90));
  steps.revoke = rev;
  steps.verifyRevoked = P.verifyToken(rev.device, rot.token);
  steps.revokeTwice = P.revokeDevice(rev.device, PERSON, at(91));
  steps.rotateRevoked = P.rotateToken(rev.device, rot.token, { at: at(92), random });
  steps.expire = P.expirePairing(P.issuePairing({ at: T0, by: PERSON, random }), at(600));
  steps.cancel = P.cancelPairing(P.issuePairing({ at: T0, by: PERSON, random }), at(5));
  steps.cancelClaimedIsNoop = P.cancelPairing(claim.pairing, at(5)) === claim.pairing;
  steps.seen = P.seen(rev.device, at(100), { 'recorder@1': { running: true } });
  const migrated = P.migrateDevice(CASES.migration['AmberX phone with its id'].old, T0);
  steps.migratedHello = P.helloErrors(migrated);
  steps.migratedClaim = P.claimPairing(P.issuePairing({ at: T0, by: PERSON, random }), { ...hello(PERSON), code: undefined }, { at: at(1), random, device: migrated });
  const p2 = P.issuePairing({ at: T0, by: PERSON, random });
  steps.migratedClaimOk = P.claimPairing(p2, { ...hello(PERSON, p2.code), device: { ...hello(PERSON).device, deviceId: migrated.deviceId } }, { at: at(1), random, device: migrated });
  return steps;
}

/* ── a draft 2020-12 subset evaluator: enough for the four generated schemas ─────────────────────────────────────── */
export function schemaErrors(schema, value, path = '$') {
  if (schema === false) return [`${path}: not allowed`];
  if (schema === true || !schema) return [];
  const out = [];
  const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (schema.const !== undefined && !same(schema.const, value)) out.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, value))) out.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const want = schema.type === 'integer' ? (Number.isInteger(value) ? 'integer' : t) : t;
    if (want !== schema.type) out.push(`${path}: must be ${schema.type}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) out.push(`${path}: items repeat`);
    if (schema.items) value.forEach((v, i) => out.push(...schemaErrors(schema.items, v, `${path}[${i}]`)));
  }
  if (isObj(value)) {
    for (const r of schema.required ?? []) if (value[r] === undefined) out.push(`${path}.${r}: required`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) out.push(...schemaErrors(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}.${k}: not allowed`);
      else if (isObj(schema.additionalProperties)) out.push(...schemaErrors(schema.additionalProperties, v, `${path}.${k}`));
      if (schema.propertyNames) out.push(...schemaErrors(schema.propertyNames, k, `${path}.${k} (name)`));
    }
  }
  if (schema.anyOf && !schema.anyOf.some((s) => !schemaErrors(s, value, path).length)) out.push(`${path}: matches none of anyOf`);
  for (const s of schema.allOf ?? []) {
    if (s.if) { if (!schemaErrors(s.if, value, path).length) out.push(...schemaErrors(s.then ?? {}, value, path)); else if (s.else) out.push(...schemaErrors(s.else, value, path)); }
    else out.push(...schemaErrors(s, value, path));
  }
  return out;
}

/* ── generate ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const fields = (v) => ({ ok: v.ok, errors: v.errors.map((e) => `${e.field}:${e.code}`) });
export function generate() {
  const out = { $axf: 'fixture', schema: P.TAG, note: 'Generated by framework/spec/check-phone-connect.mjs --write from CASES (inputs) and the engine (outputs); replayed there and by the phone-connect plugin\'s Python port.', origin: ORIGIN, at: T0 };
  out.devices = Object.fromEntries(Object.entries(CASES.devices).map(([n, d]) => [n, { device: d, ...fields(P.validateDevice(d)) }]));
  out.pairings = Object.fromEntries(Object.entries(CASES.pairings).map(([n, p]) => [n, { pairing: p, ...fields(P.validatePairing(p)) }]));
  out.make = Object.fromEntries(Object.entries(CASES.make).map(([n, i]) => [n, { input: i, ...P.makeCommand(i) }]));
  out.commands = Object.fromEntries(Object.entries(CASES.commands).map(([n, c]) => [n, { command: c, ...fields(P.validateCommand(c)) }]));
  out.results = Object.fromEntries(Object.entries(CASES.results).map(([n, r]) => [n, { result: r, ...fields(P.validateResult(r)) }]));
  out.wire = Object.fromEntries(Object.entries(CASES.wire).map(([n, c]) => [n, { command: c, wire: P.toWire(c) }]));
  out.fromWire = Object.fromEntries(Object.entries(CASES.fromWire).map(([n, m]) => [n, { message: m, result: P.fromWire(m, command(), at(2)), valid: fields(P.validateResult(P.fromWire(m, command(), at(2)))) }]));
  out.dispatch = Object.fromEntries(Object.entries(CASES.dispatch).map(([n, c]) => [n, { ...c, error: P.dispatchErrors(c.command, c.device, c.at, { origin: ORIGIN }) }]));
  out.decisions = Object.fromEntries(Object.entries(CASES.decisions).map(([n, c]) => [n, { ...c, error: P.decisionErrors(c.result, c.command, c.auth) }]));
  out.presence = Object.fromEntries(Object.entries(CASES.presence).map(([n, c]) => [n, { ...c, online: P.isOnline(c.device, c.at), presence: P.presence(c.device, c.at) }]));
  out.urls = Object.fromEntries(Object.entries(CASES.urls).map(([n, c]) => [n, { ...c, error: P.urlErrors(c.url, c.device, ORIGIN) }]));
  out.migration = Object.fromEntries(Object.entries(CASES.migration).map(([n, c]) => [n, { ...c, device: P.migrateDevice(c.old, T0), valid: fields(P.validateDevice(P.migrateDevice(c.old, T0))), hello: P.helloErrors(P.migrateDevice(c.old, T0)) }]));
  out.autoApprove = Object.fromEntries(CASES.autoApprove.map((t) => [t, { alone: P.autoApprovable(t), inAll: P.autoApprovable(t, { all: true }) }]));
  out.pairingFlow = pairingFlow();
  out.errors = P.ERROR_CODES;
  out.aliases = P.ALIASES;
  out.ttl = Object.fromEntries(Object.keys(P.COMMANDS).map((c) => [c, P.ttlFor(c)]));
  return JSON.parse(JSON.stringify(out));
}

/* ── check ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const want = generate();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify(want, null, 2)}\n`); console.log(`wrote ${FIX}`); }
ok(existsSync(FIX), 'fixtures/phone-connect.json exists (run --write)');
const fx = existsSync(FIX) ? JSON.parse(readFileSync(FIX, 'utf8')) : {};

// 1. the engine replays the fixture, section by section
for (const section of ['devices', 'pairings', 'make', 'commands', 'results', 'wire', 'fromWire', 'dispatch', 'decisions', 'presence', 'urls', 'migration', 'autoApprove', 'ttl']) {
  for (const [name, c] of Object.entries(fx[section] ?? {})) ok(same(c, want[section]?.[name]), `${section} "${name}"`, `fixture: ${JSON.stringify(c).slice(0, 300)}\n  engine:  ${JSON.stringify(want[section]?.[name]).slice(0, 300)}`);
  ok(same(Object.keys(fx[section] ?? {}), Object.keys(want[section] ?? {})), `${section}: same cases`);
}
for (const [step, v] of Object.entries(fx.pairingFlow ?? {})) ok(same(v, want.pairingFlow[step]), `pairingFlow ${step}`, `fixture: ${JSON.stringify(v).slice(0, 300)}\n  engine:  ${JSON.stringify(want.pairingFlow[step]).slice(0, 300)}`);

// the rules the spec names, asserted outright (so a fixture regenerated from a broken engine still fails)
const pf = want.pairingFlow;
ok(pf.claimBySession.ok === false && pf.claimBySession.error.code === 'denied', 'a session never claims a code');
ok(pf.claimByToken.ok === false && pf.claimNoPerson.ok === false, 'a service or a bare token never claims a code');
ok(pf.claimWrongCode.error?.code === 'denied' && pf.claimExpired.error?.code === 'expired' && pf.claimMalformed.error?.code === 'validation', 'wrong → denied, late → expired, malformed → validation');
ok(pf.claim.ok && pf.tokenShape.isToken && pf.tokenShape.tokenNotInDevice && pf.tokenShape.hashMatches, 'a person\'s claim pairs the device; the token is returned once and never stored');
ok(pf.verifyOk === null && pf.verifyBad?.code === 'denied' && pf.claimAgain.ok === false, 'the token verifies; a claimed code is spent');
ok(pf.rotate.ok && pf.rotate.oldTokenAfterSwap?.code === 'denied' && pf.rotate.newTokenAfterSwap === null, 'rotate: the old token dies on swap');
ok(pf.revokeBySession.ok === false && pf.revoke.ok && pf.verifyRevoked?.code === 'revoked', 'only a person revokes; every call with the dead token answers revoked');
ok(pf.migratedHello?.code === 'unpaired' && pf.migratedHello.detail?.reason === 'pair' && pf.migratedClaimOk.ok && pf.migratedClaimOk.device.migratedFrom, 'a migrated AmberX phone is told to pair and keeps migratedFrom');
const codes = Object.entries(want.dispatch).map(([n, c]) => [n, c.error?.code ?? null]);
ok(same(codes, [['ok', null], ['1 unknown command', 'not_found'], ['2 malformed envelope', 'validation'], ['3 revoked', 'revoked'], ['3 no device', 'revoked'], ['4 not paired', 'unpaired'], ['5 lacks capability', 'not_found'], ['6 confirm without approvalId', 'confirmation_required'], ['7 url outside policy', 'denied'], ['7 url scheme', 'denied'], ['8 offline', 'offline'], ['9 ttl passed', 'timeout'], ['other device', 'not_found']]), 'dispatch order', JSON.stringify(codes));
const dec = Object.entries(want.decisions).map(([n, c]) => [n, c.error?.code ?? null]);
ok(dec.every(([n, c]) => (n === 'brett tapped over the device token' || n === 'no decision is fine' ? c === null : c === 'denied')), 'personOnly: only Brett\'s tap over the device token decides', JSON.stringify(dec));
ok(want.make['approval with a decision is refused'].ok === false && want.make['recorder.start with mic is refused'].ok === false, 'a command never carries a decision or a mic switch');
ok(want.make['amberx.open_url alias is deprecated'].deprecated === 'amberx.open_url is deprecated: use phone.open_url' && want.make['phone.recorder_start alias (not deprecated)'].deprecated === '', 'aliases: amberx.* deprecated, phone.* current');
ok(want.make['unknown command'].error?.code === 'not_found', 'an unknown command is not_found');
ok(want.commands['policy lies (recorder.start as allow)'].ok === false, 'policy is fixed per command');
ok(want.autoApprove['recorder.start'].alone === false && want.autoApprove['vps.run'].inAll === false && want.autoApprove.open_url.inAll === true, 'NEVER_AUTO / NOT_IN_ALL');
for (const [n, c] of Object.entries(want.urls)) ok(/^(own origin|allowlist hit|any)$/.test(n) ? c.error === null : c.error?.code === (/^(not a url|empty|too long)$/.test(n) ? 'validation' : 'denied'), `url rule "${n}"`, JSON.stringify(c.error));

// 2. wire error codes are frozen
const FROZEN = { invalid: false, denied: false, not_found: false, unavailable: true, validation: false, unexpected: false, timeout: true, confirmation_required: false, offline: true, unpaired: false, revoked: false, consent_required: true, expired: false };
ok(same(Object.fromEntries(Object.entries(P.ERROR_CODES).map(([k, v]) => [k, v.retryable])), FROZEN), 'ERROR_CODES frozen (names and retryable)', JSON.stringify(Object.keys(P.ERROR_CODES)));
ok(Object.isFrozen(P.ERROR_CODES) && Object.isFrozen(P.COMMANDS) && Object.isFrozen(P.REGISTRY), 'registry objects are frozen');
ok(P.wireError('kaboom').code === 'unexpected' && P.wireError('offline').retryable === true, 'unknown codes read as unexpected; retryable follows the code');
ok(same(fx.errors, want.errors), 'fixture errors table = engine');

// 3. snapshot + JSON Schemas current; valid fixture records pass their schema, invalid ones fail it
const SNAP = 'framework/schemas/phone-connect.json';
ok(existsSync(join(ROOT, SNAP)) && same(rd(SNAP), JSON.parse(JSON.stringify(P.REGISTRY))), `${SNAP} matches core/phone-connect.mjs (run: node framework/cli/axf.mjs schemas)`);
const schemas = P.jsonSchemas();
for (const [file, schema] of Object.entries(schemas)) {
  const p = `framework/schemas/json/${file}`;
  ok(existsSync(join(ROOT, p)) && same(rd(p), JSON.parse(JSON.stringify(schema))), `${p} is current (run: node framework/cli/axf.mjs schemas)`);
  ok(schema.$schema === 'https://json-schema.org/draft/2020-12/schema' && schema.$id && schema.title && schema.type === 'object' && Array.isArray(schema.required) && schema.properties, `${file} is a well-formed draft 2020-12 schema`);
  for (const r of schema.required) ok(schema.properties[r] !== undefined, `${file}: required "${r}" is a property`);
  for (const [k, v] of Object.entries(schema.properties)) {
    const walk = (s, path) => { if (s.pattern) { try { new RegExp(s.pattern); } catch { ok(false, `${file}: ${path} pattern compiles`); } } for (const key of ['properties', 'additionalProperties', 'items', 'anyOf', 'allOf', 'then', 'propertyNames']) { const sub = s[key]; if (Array.isArray(sub)) sub.forEach((x, i) => walk(x, `${path}.${key}[${i}]`)); else if (sub && typeof sub === 'object') { if (key === 'properties') for (const [pk, pv] of Object.entries(sub)) walk(pv, `${path}.${pk}`); else walk(sub, `${path}.${key}`); } } };
    walk(v, k);
  }
}
const pairs = [['devices', 'device', 'phone-device.schema.json'], ['pairings', 'pairing', 'phone-pairing.schema.json'], ['commands', 'command', 'phone-command.schema.json'], ['results', 'result', 'phone-result.schema.json']];
for (const [section, key, file] of pairs) for (const [n, c] of Object.entries(want[section])) {
  const errs = schemaErrors(schemas[file], c[key]);
  if (c.ok) ok(!errs.length, `${file} accepts "${n}"`, errs.join('; '));
  else ok(errs.length > 0 || typeof c[key] !== 'object', `${file} rejects "${n}" too`, 'the engine refuses it but the schema does not');
}
for (const [n, c] of Object.entries(want.make)) if (c.ok) ok(!schemaErrors(schemas['phone-command.schema.json'], c.command).length, `phone-command schema accepts made "${n}"`, schemaErrors(schemas['phone-command.schema.json'], c.command).join('; '));
for (const [n, c] of Object.entries(want.fromWire)) ok(!schemaErrors(schemas['phone-result.schema.json'], c.result).length && c.valid.ok, `fromWire "${n}" gives a valid phone-result@1`, schemaErrors(schemas['phone-result.schema.json'], c.result).join('; '));
ok(!schemaErrors(schemas['phone-device.schema.json'], pf.claim.device).length && !schemaErrors(schemas['phone-pairing.schema.json'], pf.claim.pairing).length, 'the claimed device and pairing pass their schemas');

console.log(`phone-connect@1: ${passed} checks ok${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
