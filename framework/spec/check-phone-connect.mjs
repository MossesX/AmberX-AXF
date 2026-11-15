#!/usr/bin/env node
/**
 * phone-connect@1 conformance: the device record and command envelope validators, the pairing state machine (unpaired →
 * pending → paired → revoked), the hub session rules carried over from AmberX, open_url policies, dispatch errors, the
 * wire mapping, the AmberX migration and the schema snapshots.
 *   node framework/spec/check-phone-connect.mjs           check
 *   node framework/spec/check-phone-connect.mjs --write   regenerate fixtures/phone-connect.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/phone-connect.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/phone-connect.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-15T14:00:00Z';
const LATER = '2026-11-15T14:00:30Z';
const MUCH_LATER = '2026-11-15T14:12:00Z';
const NEXT_DAY = '2026-11-16T15:00:00Z';
const ID = 'phone-0123456789abcdef';
const CMD = '6f1d2c3b-4a5e-4f60-8a71-9b82c3d4e5f6';

// ------------------------------------------------------------------ inputs

/** The companion's hello, signed in, with the code the console shows. */
const HELLO = { code: 'K7MP3QRX', deviceId: ID, name: 'Google Pixel 8', app: 'phone-connect-droid', appVersion: '1.0.0', capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1'], state: { 'recorder@1': { running: false, parts: 0, queue: 0, mic: false } } };
/** A paired phone as the hub holds it. */
const PAIRED = { $axf: 'phone-device@1', deviceId: ID, name: 'Google Pixel 8', app: 'phone-connect-droid', appVersion: '1.0.0', platform: 'android', capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1'], state: 'paired', owner: 'brett', pairedAt: AT, lastSeenAt: AT, revokedAt: '', capabilityState: { 'recorder@1': { running: false, parts: 0, queue: 0, mic: false } }, updatedAt: AT };
/** An old build without the notify capability. */
const OLD_BUILD = { ...PAIRED, deviceId: 'phone-fedcba9876543210', name: 'Samsung SM-S918B', capabilities: ['open-url@1', 'recorder@1'], capabilityState: {} };
/** The `amberx` service's record on axHub today (its hello plus when it last polled). */
const AMBERX_RECORD = { deviceId: 'amberx-3f9a1c2b4d5e6f70', name: 'Google Pixel 8', app: 'amberx-droid', capabilities: ['recorder@1', 'open-url@1'], state: { 'recorder@1': { running: false, since: '', session: '', parts: 3, queue: 0, mic: false } }, lastSeenAt: '2026-11-15T13:58:40Z' };
const AMBERX_NEVER_SEEN = { deviceId: 'amberx-00000000deadbeef', name: 'Old phone', app: 'amberx-droid', capabilities: ['recorder@1'] };

const COMMANDS = {
  openUrl: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.open_url', arguments: { url: 'https://console.amberxai.com/?axf-cmd=abc' }, policy: 'allow', from: { who: 'brett', via: 'mcp' }, correlationId: 'cc-7f2a' },
  notify: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.notify', arguments: { title: 'CI is red', body: 'android / check-theme failed on #712', url: 'https://console.amberxai.com/builds', channel: 'alerts', priority: 'high' }, policy: 'allow', from: { who: 'console', via: 'console' } },
  watchOn: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.approvals_watch', arguments: { on: true, ring: true }, policy: 'allow', from: { who: 'brett', via: 'voice' } },
  recStart: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.recorder_start', arguments: { session_name: 'Build review', group: 'Nov 15', note: 'phone connect', mic: false }, policy: 'confirm', from: { who: 'claude', via: 'hub' } },
  recStartApproved: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.recorder_start', arguments: { session_name: 'Build review' }, policy: 'confirm', from: { who: 'claude', via: 'hub' }, approvalId: '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9' },
  recStop: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.recorder_stop', arguments: {}, policy: 'allow', from: { who: 'claude', via: 'hub' } },
  recStatus: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.recorder_status', arguments: {}, policy: 'allow', from: { who: 'amber', via: 'cli' } },
  legacyStart: { id: CMD, at: AT, deviceId: ID, tool: 'amberx.recorder_start', arguments: { session_name: 'Old caller' }, from: { who: 'claude', via: 'hub' }, approvalId: '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9' },
  bad: { $axf: 'phone-command@1', id: 'not-a-uuid', at: 'yesterday', deviceId: 'x', tool: 'phone.open_url', arguments: { url: '', browser: 'firefox', extra: 1 }, policy: 'confirm', from: { who: '', via: 'carrier-pigeon' } },
  badNotify: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.notify', arguments: { title: '', body: 'x'.repeat(601), channel: 'spam', priority: 'loud' }, policy: 'allow', from: { who: 'x', via: 'console' } },
  badWatch: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.approvals_watch', arguments: { on: 'yes' }, policy: 'allow', from: { who: 'x', via: 'console' } },
  badStart: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.recorder_start', arguments: { session_name: '', mic: 'on' }, policy: 'allow', from: { who: 'x', via: 'console' } },
  unknownTool: { $axf: 'phone-command@1', id: CMD, at: AT, deviceId: ID, tool: 'phone.selfie', arguments: {}, policy: 'allow', from: { who: 'x', via: 'console' } },
};

const URLS = {
  console: 'https://console.amberxai.com/?axf-cmd=abc', hubPage: 'https://axhub.amberxai.com/auth/admin/approvals/0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9', bare: 'https://amberxai.com',
  lookalike: 'https://amberxai.com.evil.example/', http: 'http://console.amberxai.com/', port: 'https://console.amberxai.com:8443/', userInfo: 'https://brett:pw@console.amberxai.com/',
  github: 'https://github.com/MossesX/AmberX-AXF/pull/712', intent: 'intent://scan/#Intent;scheme=zxing;end', file: 'file:///etc/passwd', js: 'javascript:alert(1)', empty: '', junk: 'not a url', long: `https://console.amberxai.com/?q=${'a'.repeat(2000)}`,
};
const URL_CASES = Object.fromEntries(Object.entries(URLS).flatMap(([k, u]) => [[`own:${k}`, [u, { policy: 'own' }]], [`allowlist:${k}`, [u, { policy: 'allowlist', allowlist: ['github.com'] }]], [`any:${k}`, [u, { policy: 'any' }]]]));

const REQUESTS = {
  good: { url: 'https://axhub.amberxai.com/axpp/v1/hello', headers: { 'X-AXPP': 'axpp@1', 'Content-Type': 'application/json; charset=utf-8', Cookie: 'axhub_session=…' }, body: {} },
  bearer: { url: 'https://axhub.amberxai.com/axpp/v1/next', headers: { 'x-axpp': 'axpp@1', 'content-type': 'application/json', cookie: 'axhub_session=…', authorization: 'Bearer mcp-token' }, body: {} },
  elsewhere: { url: 'https://axhub.amberxai.com.evil.example/axpp/v1/hello', headers: { 'X-AXPP': 'axpp@1', 'Content-Type': 'application/json', Cookie: 's' }, body: {} },
  http: { url: 'http://axhub.amberxai.com/axpp/v1/hello', headers: { 'X-AXPP': 'axpp@1', 'Content-Type': 'application/json', Cookie: 's' }, body: {} },
  wrongRoute: { url: 'https://axhub.amberxai.com/mcp', headers: { 'X-AXPP': 'axpp@1', 'Content-Type': 'application/json', Cookie: 's' }, body: {} },
  noHeader: { url: 'https://axhub.amberxai.com/axpp/v1/answer', headers: { 'Content-Type': 'text/plain' }, body: 'hi', followRedirects: true },
};

const AUTO = {
  startAll: [{ approveAll: true, listOn: true, list: '*' }, 'phone.recorder_start'], startNamed: [{ listOn: true, list: 'phone.recorder_start' }, 'phone.recorder_start'], startWild: [{ listOn: true, list: 'phone.*' }, 'phone.recorder_start'],
  startLegacy: [{ approveAll: true }, 'amberx.recorder_start'], stopListed: [{ listOn: true, list: 'phone.recorder_stop' }, 'phone.recorder_stop'], stopWild: [{ listOn: true, list: 'phone.*' }, 'phone.recorder_stop'],
  stopOff: [{ listOn: false, list: 'phone.recorder_stop' }, 'phone.recorder_stop'], vpsAll: [{ approveAll: true }, 'vps.run'], openAll: [{ approveAll: true }, 'phone.open_url'], openStar: [{ listOn: true, list: '*' }, 'phone.open_url'],
};

const IN = { HELLO, PAIRED, OLD_BUILD, AMBERX_RECORD, AMBERX_NEVER_SEEN, COMMANDS, URL_CASES, REQUESTS, AUTO, AT, LATER, MUCH_LATER, NEXT_DAY };

// ------------------------------------------------------------------ outputs

function run() {
  const pairing = P.issuePairing({ code: 'K7MP3QRX', at: AT, by: 'brett' });
  const confirmed = P.confirmPairing(pairing, HELLO, { at: LATER, owner: 'brett' });
  const revoked = P.revoke(PAIRED, { at: NEXT_DAY, by: 'brett', why: 'phone sold' });
  const machine = {};
  for (const s of P.PAIRING_STATES) for (const e of P.PAIRING_EVENTS) machine[`${s}:${e}`] = P.transition(s, e);
  const wireResult = { protocol: 'axpp@1', kind: 'result', id: 'a1b2c3d4-0000-4000-8000-000000000001', correlationId: CMD, payload: { data: { running: true, since: LATER, session: 'Build review', parts: 0, queue: 0, mic: false, awaitingConsent: false }, state: { 'recorder@1': { running: true } } } };
  const wireError = { protocol: 'axpp@1', kind: 'error', id: 'a1b2c3d4-0000-4000-8000-000000000002', correlationId: CMD, payload: { code: 'consent_required', message: "Android's capture prompt is waiting on the phone." } };
  const wireOddCode = { protocol: 'axpp@1', kind: 'error', id: 'a1b2c3d4-0000-4000-8000-000000000003', correlationId: CMD, payload: { code: 'exploded' } };
  const wireWrongId = { protocol: 'axpp@1', kind: 'result', id: 'a1b2c3d4-0000-4000-8000-000000000004', correlationId: 'someone-else', payload: { data: {} } };
  const offline = { ...PAIRED, lastSeenAt: '2026-11-15T13:47:00Z' };
  return {
    pairing: {
      issued: pairing, confirmed, machine,
      wrongCode: P.confirmPairing(pairing, { ...HELLO, code: 'WRONGCOD' }, { at: LATER, owner: 'brett' }),
      expired: P.confirmPairing(pairing, HELLO, { at: '2026-11-15T14:10:01Z', owner: 'brett' }),
      nothingWaiting: P.confirmPairing(P.endPairing(pairing, 'cancel', LATER), HELLO, { at: LATER, owner: 'brett' }),
      notADevice: P.confirmPairing(pairing, { code: 'K7MP3QRX', deviceId: 'x' }, { at: LATER, owner: 'brett' }),
      otherPhone: P.confirmPairing(P.issuePairing({ code: 'K7MP3QRX', at: AT, by: 'brett', deviceId: 'phone-fedcba9876543210' }), HELLO, { at: LATER, owner: 'brett' }),
      expiredRecord: P.endPairing(pairing, 'expire', '2026-11-15T14:10:01Z'), cancelledRecord: P.endPairing(pairing, 'cancel', LATER), expiredFlag: [P.pairingExpired(pairing, LATER), P.pairingExpired(pairing, MUCH_LATER)],
      seenPaired: P.seen(PAIRED, { capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1'], state: { 'recorder@1': { running: true, parts: 1 } } }, LATER),
      seenUnpaired: P.seen(P.deviceFromHello(HELLO, AT), {}, LATER), seenRevoked: P.seen(revoked.device, {}, NEXT_DAY),
      revoked, revokeTwice: P.revoke(revoked.device, { at: NEXT_DAY, by: 'brett' }), revokeUnpaired: P.revoke(P.emptyDevice(AT), { at: AT, by: 'brett' }),
      fromHello: P.deviceFromHello(HELLO, AT), empty: P.emptyDevice(AT),
    },
    presence: { online: [P.isOnline(PAIRED, LATER), P.presence(PAIRED, LATER)], edge: [P.isOnline(PAIRED, '2026-11-15T14:00:45Z'), P.isOnline(PAIRED, '2026-11-15T14:00:46Z')], offline: P.presence(offline, AT), hours: P.presence(offline, '2026-11-15T16:00:00Z'), days: P.presence(offline, '2026-11-18T16:00:00Z'), neverSeen: P.presence({ ...PAIRED, lastSeenAt: '' }, AT), unpaired: P.presence(P.emptyDevice(AT), AT), revoked: P.presence(revoked.device, NEXT_DAY), clockBack: P.isOnline(PAIRED, '2026-11-15T13:59:00Z') },
    hub: { requests: Object.fromEntries(Object.entries(REQUESTS).map(([k, r]) => [k, P.requestErrors(r)])), backoff: [0, 1, 2, 3, 4, 9].map(P.backoffMs), afterStatus: Object.fromEntries([200, 204, 401, 403, 404, 500, 0].map((s) => [s, P.afterStatus(s, 2)])) },
    commands: {
      norm: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, P.normCommand(c, AT)])),
      errors: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, P.commandErrors(c)])),
      resolve: Object.fromEntries(['phone.open_url', 'amberx.open_url', 'amberx.recorder_status', 'amberx.notify', 'recorder.start', ''].map((x) => [x || '(empty)', P.resolveTool(x)])),
      policy: Object.fromEntries([...P.TOOLS, ...Object.keys(P.ALIASES), 'nope'].map((x) => [x, P.policyOf(x)])),
      autoApproves: Object.fromEntries(Object.entries(AUTO).map(([k, [o, tool]]) => [k, P.autoApproves(o, tool)])),
      wire: Object.fromEntries(Object.entries(COMMANDS).filter(([k]) => !/^bad|unknown/.test(k)).map(([k, c]) => [k, P.toWire(c)])),
      dispatch: {
        ok: P.dispatchErrors(COMMANDS.openUrl, PAIRED, LATER), offline: P.dispatchErrors(COMMANDS.openUrl, offline, AT), unpaired: P.dispatchErrors(COMMANDS.openUrl, P.deviceFromHello(HELLO, AT), AT), revoked: P.dispatchErrors(COMMANDS.openUrl, revoked.device, NEXT_DAY),
        noCapability: P.dispatchErrors(COMMANDS.notify, OLD_BUILD, LATER), needsApproval: P.dispatchErrors(COMMANDS.recStart, PAIRED, LATER), approved: P.dispatchErrors(COMMANDS.recStartApproved, PAIRED, LATER), legacyApproved: P.dispatchErrors(COMMANDS.legacyStart, PAIRED, LATER), unknown: P.dispatchErrors(COMMANDS.unknownTool, PAIRED, LATER),
      },
    },
    results: {
      ok: P.fromWire(wireResult, COMMANDS.recStartApproved, LATER), legacyOk: P.fromWire(wireResult, COMMANDS.legacyStart, LATER), error: P.fromWire(wireError, COMMANDS.recStartApproved, LATER), oddCode: P.fromWire(wireOddCode, COMMANDS.recStop, LATER), wrongId: P.fromWire(wireWrongId, COMMANDS.recStop, LATER), notAxpp: P.fromWire({ kind: 'result' }, COMMANDS.recStop, LATER),
      offline: P.resultFor(COMMANDS.openUrl, P.dispatchErrors(COMMANDS.openUrl, offline, AT), AT),
      errors: { ok: P.resultErrors(P.fromWire(wireResult, COMMANDS.recStartApproved, LATER)), err: P.resultErrors(P.fromWire(wireError, COMMANDS.recStartApproved, LATER)), bad: P.resultErrors({ $axf: 'phone-result@1', id: 'x', tool: 'phone.selfie', at: 'now', ok: false, error: { code: 'kaboom' } }), okWithError: P.resultErrors({ $axf: 'phone-result@1', id: CMD, tool: '', deviceId: ID, at: AT, ok: true, data: [], error: {} }) },
    },
    openUrl: Object.fromEntries(Object.entries(URL_CASES).map(([k, [u, o]]) => [k, P.openUrlAllowed(u, o)])),
    devices: {
      errors: { paired: P.deviceErrors(PAIRED), oldBuild: P.deviceErrors(OLD_BUILD), fromHello: P.deviceErrors(P.deviceFromHello(HELLO, AT)), empty: P.deviceErrors(P.emptyDevice(AT)), bad: P.deviceErrors({ deviceId: 'x!', name: 42, app: 'amberx', platform: 'ios', capabilities: ['recorder@1', 'recorder@1', 'x-ray@1'], state: 'paired', pairedAt: 'never', capabilityState: { 'notify@1': {} } }), revoked: P.deviceErrors(revoked.device), pairedNoOwner: P.deviceErrors({ ...PAIRED, owner: '' }) },
      norm: P.normDevice({ deviceId: ID, name: 'x'.repeat(100), app: 'nope', platform: 'ios', capabilities: ['recorder@1', 'recorder@1', 'nope'], state: 'flying', pairedAt: AT, revokedAt: AT, capabilityState: { 'recorder@1': { running: true }, 'notify@1': {} }, note: 'kept' }, AT),
    },
    migration: { paired: P.deviceFromAmberx(AMBERX_RECORD, { at: AT, owner: 'brett' }), neverSeen: P.deviceFromAmberx(AMBERX_NEVER_SEEN, { at: AT }), pairedErrors: P.deviceErrors(P.deviceFromAmberx(AMBERX_RECORD, { at: AT, owner: 'brett' })), aliasTable: P.aliasTable() },
  };
}
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'phone-connect@1', note: 'Generated by framework/spec/check-phone-connect.mjs --write; every port replays `in` (a hello, devices, commands, URLs, hub requests) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ pairing

const pr = actual.pairing;
t('the state machine: unpaired → pending → paired → revoked, back to unpaired on expire / cancel, a revoked phone pairs again or is forgotten; nothing else moves', () => {
  const allowed = { 'unpaired:issue': 'pending', 'pending:confirm': 'paired', 'pending:expire': 'unpaired', 'pending:cancel': 'unpaired', 'paired:revoke': 'revoked', 'revoked:issue': 'pending', 'revoked:forget': 'unpaired' };
  for (const [k, v] of Object.entries(pr.machine)) assert.equal(v, allowed[k] ?? null, k);
  assert.equal(Object.values(pr.machine).filter(Boolean).length, 7);
});
t('issue: an eight-character code good for ten minutes, pending, no device yet', () => { assert.equal(pr.issued.state, 'pending'); assert.equal(pr.issued.expiresAt, '2026-11-15T14:10:00.000Z'); assert.equal(pr.issued.deviceId, ''); assert.deepEqual(P.pairingErrors(pr.issued), []); });
t("confirm: the right code pairs the phone to the signed-in owner, keeps the hello's capabilities and state, ends the pairing", () => {
  assert.equal(pr.confirmed.ok, true); const d = pr.confirmed.device;
  assert.equal(d.state, 'paired'); assert.equal(d.owner, 'brett'); assert.equal(d.pairedAt, LATER); assert.equal(d.lastSeenAt, LATER); assert.deepEqual(d.capabilities, P.CAPABILITIES); assert.deepEqual(Object.keys(d.capabilityState), ['recorder@1']);
  assert.deepEqual(P.deviceErrors(d), []); assert.equal(pr.confirmed.pairing.state, 'paired'); assert.equal(pr.confirmed.pairing.ended, 'confirm'); assert.equal(pr.confirmed.pairing.deviceId, ID); assert.deepEqual(P.pairingErrors(pr.confirmed.pairing), []);
});
t('confirm refusals: wrong code denied, expired timeout, nothing waiting not_found, not a device invalid, another phone denied', () => {
  assert.equal(pr.wrongCode.error.code, 'denied'); assert.equal(pr.expired.error.code, 'timeout'); assert.match(pr.expired.error.message, /10 minutes/); assert.equal(pr.nothingWaiting.error.code, 'not_found'); assert.equal(pr.notADevice.error.code, 'invalid'); assert.equal(pr.otherPhone.error.code, 'denied');
  assert.deepEqual(pr.expiredFlag, [false, true]); assert.equal(pr.expiredRecord.state, 'unpaired'); assert.equal(pr.expiredRecord.ended, 'expire'); assert.equal(pr.cancelledRecord.ended, 'cancel'); assert.deepEqual(P.pairingErrors(pr.cancelledRecord), []);
});
t('seen: a paired phone moves lastSeenAt and the capability state only; unpaired and revoked phones get their code and stay as they were', () => {
  assert.equal(pr.seenPaired.device.lastSeenAt, LATER); assert.equal(pr.seenPaired.device.capabilityState['recorder@1'].running, true); assert.equal(pr.seenPaired.device.pairedAt, AT); assert.equal(pr.seenPaired.device.owner, 'brett');
  assert.equal(pr.seenUnpaired.error.code, 'unpaired'); assert.equal(pr.seenRevoked.error.code, 'revoked');
});
t('revoke: only a paired phone; it keeps pairedAt, gets revokedAt and the reason; twice is invalid', () => { assert.equal(pr.revoked.device.state, 'revoked'); assert.equal(pr.revoked.device.revokedAt, NEXT_DAY); assert.equal(pr.revoked.device.pairedAt, AT); assert.match(pr.revoked.device.note, /phone sold/); assert.deepEqual(P.deviceErrors(pr.revoked.device), []); assert.equal(pr.revokeTwice.error.code, 'invalid'); assert.equal(pr.revokeUnpaired.error.code, 'invalid'); });
t('a device from a hello is unpaired, with no owner and no pairedAt', () => { assert.equal(pr.fromHello.state, 'unpaired'); assert.equal(pr.fromHello.pairedAt, ''); assert.equal(pr.fromHello.owner, ''); assert.deepEqual(P.deviceErrors(pr.fromHello), []); });

// ------------------------------------------------------------------ presence + hub

t('online means paired and polled within 45 s; the words are the same on every surface', () => {
  assert.deepEqual(actual.presence.online, [true, 'online']); assert.deepEqual(actual.presence.edge, [true, false]); assert.equal(actual.presence.offline, 'offline: last seen 13 min ago'); assert.equal(actual.presence.hours, 'offline: last seen 2 h ago'); assert.equal(actual.presence.days, 'offline: last seen 3 d ago');
  assert.equal(actual.presence.neverSeen, 'offline: never seen'); assert.equal(actual.presence.unpaired, 'not paired'); assert.equal(actual.presence.revoked, 'revoked'); assert.equal(actual.presence.clockBack, false);
});
t('the hub session rules: exactly the hub over https, X-AXPP, JSON, the session cookie, never a bearer token, no redirects', () => {
  const r = actual.hub.requests;
  assert.deepEqual(r.good, []); assert.deepEqual(r.bearer, ['an MCP or bearer token never signs a phone in']); assert.deepEqual(r.elsewhere, ['url is on https://axhub.amberxai.com and nowhere else']); assert.deepEqual(r.http, ['url is on https://axhub.amberxai.com and nowhere else']);
  assert.deepEqual(r.wrongRoute, ['url is one of the AXPP routes']); assert.equal(r.noHeader.length, 5);
  assert.deepEqual(actual.hub.backoff, [5000, 5000, 15000, 30000, 60000, 60000]); assert.equal(actual.hub.afterStatus[401].waitMs, 60000); assert.equal(actual.hub.afterStatus[401].signedOut, true); assert.equal(actual.hub.afterStatus[404].welcomed, false); assert.equal(actual.hub.afterStatus[404].waitMs, 0); assert.equal(actual.hub.afterStatus[500].waitMs, 30000); assert.equal(actual.hub.afterStatus[204].welcomed, true);
  assert.equal(P.HUB.replyMaxBytes, 262144); assert.equal(P.HUB.followRedirects, false); assert.equal(P.HUB.pollSeconds, 25); assert.equal(P.HUB.answerSeconds, 20);
});

// ------------------------------------------------------------------ commands

const c = actual.commands;
t('every well-formed command validates; policy is fixed per tool; from.via is recorded', () => {
  for (const k of ['openUrl', 'notify', 'watchOn', 'recStart', 'recStartApproved', 'recStop', 'recStatus']) assert.deepEqual(c.errors[k], [], k);
  assert.equal(c.norm.recStart.policy, 'confirm'); assert.equal(c.norm.openUrl.policy, 'allow'); assert.deepEqual(new Set(Object.values(c.norm).map((x) => x.from.via).filter((v) => v)), new Set(['mcp', 'console', 'voice', 'hub', 'cli']));
  assert.equal(c.norm.openUrl.correlationId, 'cc-7f2a'); assert.equal(c.norm.recStartApproved.approvalId, '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9');
});
t('validation names every bad field', () => {
  assert.ok(c.errors.bad.length >= 9, c.errors.bad.join('; ')); assert.ok(c.errors.bad.some((e) => /policy for phone.open_url is allow/.test(e))); assert.ok(c.errors.bad.some((e) => /extra is not an argument/.test(e)));
  assert.equal(c.errors.badNotify.length, 4); assert.equal(c.errors.badWatch.length, 1); assert.equal(c.errors.badStart.length, 3); assert.deepEqual(c.errors.unknownTool, [`command.tool is one of ${P.TOOLS.join(', ')}`]);
  assert.deepEqual(c.norm.bad.arguments, { url: '', browser: 'firefox' }); assert.equal(c.norm.bad.from.via, 'console'); assert.equal(c.norm.unknownTool.tool, '');
});
t('the amberx.* aliases resolve with a deprecation; the normalised command carries the alias and the new tool', () => {
  assert.deepEqual(c.resolve['amberx.open_url'], { tool: 'phone.open_url', deprecated: true, alias: 'amberx.open_url' }); assert.deepEqual(c.resolve['amberx.notify'], { tool: '', deprecated: false, alias: '' }); assert.deepEqual(c.resolve['recorder.start'], { tool: '', deprecated: false, alias: '' });
  assert.equal(c.norm.legacyStart.tool, 'phone.recorder_start'); assert.equal(c.norm.legacyStart.alias, 'amberx.recorder_start'); assert.equal(c.norm.legacyStart.policy, 'confirm'); assert.deepEqual(c.errors.legacyStart, ['command.$axf is phone-command@1', 'command.tool amberx.recorder_start is deprecated: use phone.recorder_start']);
  assert.deepEqual(Object.keys(P.ALIASES), ['amberx.open_url', 'amberx.recorder_start', 'amberx.recorder_stop', 'amberx.recorder_status']);
});
t('policies: recorder_start confirms, everything else allows, an unknown tool confirms; recorder_start is never auto-approved and approve-all skips vps.run', () => {
  assert.equal(c.policy['phone.recorder_start'], 'confirm'); assert.equal(c.policy['amberx.recorder_start'], 'confirm'); assert.equal(c.policy['phone.recorder_status'], 'allow'); assert.equal(c.policy.nope, 'confirm');
  assert.deepEqual(c.autoApproves, { startAll: false, startNamed: false, startWild: false, startLegacy: false, stopListed: true, stopWild: true, stopOff: false, vpsAll: false, openAll: true, openStar: true });
});
t('the wire: axpp@1 call envelopes with the wire tool names and the command id', () => {
  assert.deepEqual(c.wire.openUrl, { protocol: 'axpp@1', kind: 'call', id: CMD, payload: { tool: 'browser.open', arguments: { url: 'https://console.amberxai.com/?axf-cmd=abc' } } });
  assert.equal(c.wire.notify.payload.tool, 'notify.show'); assert.equal(c.wire.watchOn.payload.tool, 'approvals.watch'); assert.equal(c.wire.recStart.payload.tool, 'recorder.start'); assert.equal(c.wire.recStop.payload.tool, 'recorder.stop'); assert.equal(c.wire.recStatus.payload.tool, 'recorder.status'); assert.equal(c.wire.legacyStart.payload.tool, 'recorder.start');
});
t('dispatch: revoked, unpaired, missing capability, confirmation_required, offline, in that order; an approved start and a legacy approved start go through', () => {
  assert.equal(c.dispatch.ok, null); assert.equal(c.dispatch.offline.code, 'offline'); assert.equal(c.dispatch.offline.retryable, true); assert.match(c.dispatch.offline.message, /Google Pixel 8 is offline: last seen 13 min ago/);
  assert.equal(c.dispatch.unpaired.code, 'unpaired'); assert.equal(c.dispatch.revoked.code, 'revoked'); assert.equal(c.dispatch.noCapability.code, 'not_found'); assert.match(c.dispatch.noCapability.message, /notify@1/);
  assert.equal(c.dispatch.needsApproval.code, 'confirmation_required'); assert.equal(c.dispatch.approved, null); assert.equal(c.dispatch.legacyApproved, null); assert.equal(c.dispatch.unknown.code, 'invalid');
});

// ------------------------------------------------------------------ results + open_url

const r = actual.results;
t('results: a result envelope becomes ok + data + state; an error keeps its code and retryable; odd codes read as unexpected; the wrong correlation id is unexpected', () => {
  assert.equal(r.ok.ok, true); assert.equal(r.ok.data.session, 'Build review'); assert.deepEqual(r.ok.state, { 'recorder@1': { running: true } }); assert.equal(r.ok.deprecated, undefined); assert.equal(r.legacyOk.deprecated, 'amberx.recorder_start is deprecated: use phone.recorder_start');
  assert.deepEqual(r.error.error, { code: 'consent_required', message: "Android's capture prompt is waiting on the phone.", retryable: true }); assert.equal(r.oddCode.error.code, 'unexpected'); assert.equal(r.oddCode.error.message, 'The phone could not do that.'); assert.equal(r.wrongId.error.code, 'unexpected'); assert.equal(r.notAxpp.error.code, 'unexpected');
  assert.equal(r.offline.error.code, 'offline'); assert.equal(r.offline.id, CMD);
  assert.deepEqual(r.errors.ok, []); assert.deepEqual(r.errors.err, []); assert.ok(r.errors.bad.length >= 5); assert.deepEqual(r.errors.okWithError, ['result.data is an object', 'result.error is absent when ok']);
});
const u = actual.openUrl;
t("open_url under own: Brett's https sites only, default port, no user info, no lookalikes", () => {
  assert.equal(u['own:console'].ok, true); assert.equal(u['own:hubPage'].ok, true); assert.equal(u['own:bare'].ok, true); assert.equal(u['own:lookalike'].error.code, 'denied'); assert.equal(u['own:http'].error.code, 'denied'); assert.equal(u['own:port'].error.code, 'denied'); assert.equal(u['own:userInfo'].error.code, 'denied'); assert.equal(u['own:github'].error.code, 'denied');
});
t('allowlist adds named hosts; any opens every http(s) page; every policy refuses other schemes, user info, junk, empty and too long', () => {
  assert.equal(u['allowlist:github'].ok, true); assert.equal(u['allowlist:console'].ok, true); assert.equal(u['allowlist:lookalike'].error.code, 'denied'); assert.equal(u['any:github'].ok, true); assert.equal(u['any:http'].ok, true); assert.equal(u['any:lookalike'].ok, true); assert.equal(u['any:userInfo'].error.code, 'denied');
  for (const p of ['own', 'allowlist', 'any']) { assert.equal(u[`${p}:intent`].error.code, 'denied', p); assert.equal(u[`${p}:file`].error.code, 'denied'); assert.equal(u[`${p}:js`].error.code, 'denied'); assert.equal(u[`${p}:empty`].error.code, 'validation'); assert.equal(u[`${p}:junk`].error.code, 'validation'); assert.equal(u[`${p}:long`].error.code, 'validation'); }
});

// ------------------------------------------------------------------ devices + migration + snapshots

t('device validation: good records pass, every bad field is named, paired needs an owner and pairedAt', () => {
  const d = actual.devices.errors; assert.deepEqual(d.paired, []); assert.deepEqual(d.oldBuild, []); assert.deepEqual(d.fromHello, []); assert.deepEqual(d.revoked, []); assert.deepEqual(d.pairedNoOwner, ['device.owner names who paired it']);
  assert.deepEqual(d.empty, [`device.deviceId matches ${P.DEVICE_ID_PATTERN}`]); assert.ok(d.bad.length >= 9, d.bad.join('; '));
  const nm = actual.devices.norm; assert.equal(nm.name.length, 80); assert.equal(nm.app, 'phone-connect-droid'); assert.equal(nm.platform, 'android'); assert.deepEqual(nm.capabilities, ['recorder@1']); assert.equal(nm.state, 'unpaired'); assert.equal(nm.pairedAt, ''); assert.equal(nm.revokedAt, ''); assert.deepEqual(Object.keys(nm.capabilityState), ['recorder@1']); assert.equal(nm.note, 'kept');
});
t('migration: an AmberX record becomes a paired phone-device@1 with the same id, migratedFrom set and its recorder state kept; a never-seen one is unpaired', () => {
  const m = actual.migration.paired; assert.equal(m.deviceId, 'amberx-3f9a1c2b4d5e6f70'); assert.equal(m.app, 'phone-connect-droid'); assert.equal(m.state, 'paired'); assert.equal(m.owner, 'brett'); assert.equal(m.pairedAt, '2026-11-15T13:58:40Z'); assert.deepEqual(m.capabilities, ['recorder@1', 'open-url@1']); assert.equal(m.capabilityState['recorder@1'].parts, 3);
  assert.deepEqual(m.migratedFrom, { deviceId: 'amberx-3f9a1c2b4d5e6f70', app: 'amberx-droid', at: AT }); assert.deepEqual(actual.migration.pairedErrors, []); assert.equal(actual.migration.neverSeen.state, 'unpaired'); assert.equal(actual.migration.neverSeen.owner, '');
  assert.deepEqual(actual.migration.aliasTable.map((a) => [a.from, a.to, a.wire, a.policy]), [['amberx.open_url', 'phone.open_url', 'browser.open', 'allow'], ['amberx.recorder_start', 'phone.recorder_start', 'recorder.start', 'confirm'], ['amberx.recorder_stop', 'phone.recorder_stop', 'recorder.stop', 'allow'], ['amberx.recorder_status', 'phone.recorder_status', 'recorder.status', 'allow']]);
});
t('schemas/phone-connect.json + schemas/json/phone-*.schema.json are current (run axf schemas)', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/phone-connect.json')), P.REGISTRY));
  for (const [name, s] of Object.entries(P.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name);
});
t('the spec names every tool, error code and pairing state; PORTING.md and INTEROP.md list the contract', () => {
  const spec = rd('framework/spec/PHONE-CONNECT.md');
  for (const x of [...P.TOOLS, ...P.ERROR_CODES, ...P.PAIRING_STATES, ...Object.keys(P.ALIASES)]) assert.ok(spec.includes(`\`${x}\``), x);
  assert.match(rd('framework/spec/PORTING.md'), /phone-connect@1/); assert.match(rd('framework/spec/INTEROP.md'), /phone-connect@1/);
});
console.log(`check-phone-connect: ${n} checks passed`);
