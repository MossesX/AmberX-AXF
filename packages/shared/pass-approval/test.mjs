/** pass-approval@1: replays cases.json (what every port must reproduce) and checks the pure rules. `node --test test.mjs` */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PASS_ACTION_CODES, PASS_ACTION_IDS, PASS_ACTION_TOKEN_TTL_MS, PASS_DECISIONS, PASS_REQUEST_TTL_MS, actionProblem, actionResult, actionTokenExpiry, actionTokenFields,
  actionTokenMessage, formatActionToken, parseActionToken, parsePassPush, parsePassRoute, parsePassTarget, passAlertInput, passDeepLink, passDecisionLink,
  passGrantResultFields, passLinks, passMollyLink, passPushPayload, passPushWords, passTarget,
} from './index.mjs';
import { mintActionToken, mintActionTokens, verifyActionToken } from './node.mjs';

const C = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const passOf = (ref) => (ref === null ? null : typeof ref === 'string' ? C.passes[ref] : ref);
const P = C.passes.all;

test('cases: expiry is 15 min from minting, never past the request lapse', () => {
  assert.equal(actionTokenExpiry(P, C.now), C.expiry.all);
  assert.equal(actionTokenExpiry(P, C.now + 10 * 60 * 1000), C.expiry.lateMint);
  assert.equal(C.expiry.all, Date.parse(P.requestedAt) + PASS_REQUEST_TTL_MS);
  assert.equal(actionTokenExpiry({ ...P, requestedAt: undefined }, C.now), C.expiry.noRequestedAt);
  assert.equal(C.expiry.noRequestedAt, C.now + PASS_ACTION_TOKEN_TTL_MS);
});

test('cases: signed messages and tokens match byte for byte', () => {
  for (const [name, want] of Object.entries(C.messages)) {
    const [passName, decision] = name === 'irreversibleApprove' ? ['irreversible', 'approve'] : name === 'themeApprove' ? ['theme', 'approve'] : ['all', name === 'allDeny' ? 'deny' : 'approve'];
    assert.equal(actionTokenMessage(actionTokenFields(C.passes[passName], decision, C.expiry.all, C.nonce)), want, name);
    assert.equal(mintActionToken(C.passes[passName], decision, { now: C.now, secret: C.secret, nonce: C.nonce }).token, C.tokens[name], name);
  }
  assert.match(C.messages.irreversibleApprove, /\.irreversible\.\d+\./);
  assert.doesNotMatch(C.messages.allApprove, /irreversible/);
});

test('cases: every verify verdict', () => {
  for (const v of C.verify) {
    const got = verifyActionToken(v.token, passOf(v.pass), { now: v.now, secret: v.secret ?? C.secret, stateAt: v.stateAt, decidedBy: v.decidedBy ?? null });
    assert.deepEqual(got.ok ? { ok: true, decision: got.decision, already: got.already } : { ok: false, code: got.code }, v.want, v.name);
  }
});

test('cases: links, routes, targets, grant fields, push, alert, words, problems', () => {
  assert.deepEqual(passLinks(P.id), C.links);
  assert.deepEqual(passLinks(P.id, { consoleUrl: 'http://localhost:7488/', mollyUrl: 'http://localhost:5173' }), C.linksCustom);
  for (const r of C.routes) assert.deepEqual(parsePassRoute(r.hash), r.want, r.hash);
  for (const t of C.targets) assert.equal(parsePassTarget(t.target), t.want, t.target);
  assert.deepEqual(passGrantResultFields(P), C.grantResult.pending);
  assert.deepEqual(passGrantResultFields({ ...P, state: 'active' }), C.grantResult.active);
  assert.deepEqual(passGrantResultFields({ state: 'pending' }), C.grantResult.noId);
  assert.deepEqual(passPushPayload(P, 'pending', { approve: C.tokens.allApprove, deny: C.tokens.allDeny }), C.push.pending);
  assert.deepEqual(passPushPayload({ ...P, state: 'active' }, 'cleared', null), C.push.cleared);
  assert.deepEqual(passAlertInput(C.passes.irreversible), C.alert);
  assert.deepEqual({ all: passPushWords(P), irreversible: passPushWords(C.passes.irreversible), bare: passPushWords({ id: P.id, scope: 'tokens.layout', minutes: 5 }) }, C.words);
  for (const p of C.problems) { const got = actionProblem(p.code); assert.equal(got.status, p.status, p.code); assert.equal(got.message, p.message, p.code); }
});

test('links: no token ever appears in what a bearer caller reads', () => {
  const fields = passGrantResultFields(P);
  for (const v of Object.values(fields)) assert.doesNotMatch(String(v), /pa1\./);
  assert.equal(fields.deep_link, passDeepLink(P.id));
  assert.equal(fields.approve_url, passDecisionLink(P.id, 'approve'));
  assert.equal(fields.target, passTarget(P.id));
  assert.equal(fields.hand_over, `Approve here: ${fields.deep_link}`);
  assert.equal(passMollyLink(P.id, {}, 'deny'), `https://molly.amberxai.com/#/console/pass/${P.id}/deny`);
  assert.throws(() => passDecisionLink(P.id, 'revoke'), RangeError);
  assert.doesNotMatch(JSON.stringify(passAlertInput(P)), /pa1\./);
});

test('routes: a decision route round-trips through Molly and the console', () => {
  for (const d of PASS_DECISIONS) {
    assert.deepEqual(parsePassRoute(new URL(passDecisionLink(P.id, d)).hash), { id: P.id, decision: d });
    assert.deepEqual(parsePassRoute(new URL(passMollyLink(P.id, {}, d)).hash), { id: P.id, decision: d });
  }
  assert.deepEqual(parsePassRoute(new URL(passMollyLink(P.id)).hash), { id: P.id });
});

test('token: wire form parses back to its fields and refuses anything else', () => {
  const m = mintActionToken(P, 'approve', { now: C.now, secret: C.secret });
  const parsed = parseActionToken(m.token);
  assert.deepEqual({ id: parsed.id, decision: parsed.decision, exp: parsed.exp, nonce: parsed.nonce }, { id: P.id, decision: 'approve', exp: m.exp, nonce: m.nonce });
  assert.equal(formatActionToken(parsed), m.token);
  assert.equal(parseActionToken(`${m.token}.extra`), null);
  assert.equal(parseActionToken(m.token.replace('pa1.', 'pa2.')), null);
  assert.equal(parseActionToken(m.token.toUpperCase()), null);
  assert.equal(parseActionToken(''), null);
  assert.match(m.token, /^[A-Za-z0-9.\-]+$/, 'URL-safe without encoding');
});

test('token: minting refuses what must never be minted', () => {
  assert.throws(() => mintActionToken({ ...P, state: 'active' }, 'approve', { secret: C.secret }), /not_pending/);
  assert.throws(() => mintActionToken(P, 'approve', { secret: '' }), /no_secret/);
  assert.throws(() => mintActionToken(P, 'revoke', { secret: C.secret }), RangeError);
  const both = mintActionTokens(P, { now: C.now, secret: C.secret });
  assert.notEqual(parseActionToken(both.approve).nonce, parseActionToken(both.deny).nonce, 'each token has its own nonce');
  assert.equal(parseActionToken(both.approve).exp, parseActionToken(both.deny).exp);
});

test('token: a replay of the deciding token is idempotent, any other token after a decision is refused', () => {
  const both = mintActionTokens(P, { now: C.now, secret: C.secret });
  const first = verifyActionToken(both.deny, P, { now: C.now + 1, secret: C.secret, stateAt: 'pending' });
  assert.deepEqual(first, { ok: true, decision: 'deny', nonce: parseActionToken(both.deny).nonce, already: false });
  const decidedBy = { nonce: first.nonce, decision: 'deny' };
  const denied = { ...P, state: 'denied' };
  assert.deepEqual(verifyActionToken(both.deny, denied, { now: C.now + 2, secret: C.secret, stateAt: 'denied', decidedBy }), { ...first, already: true });
  assert.deepEqual(verifyActionToken(both.approve, denied, { now: C.now + 2, secret: C.secret, stateAt: 'denied', decidedBy }), { ok: false, code: PASS_ACTION_CODES.decided });
  // a forged "replay" with the right nonce but a bad signature is still refused
  const forged = both.deny.slice(0, -2) + (both.deny.endsWith('00') ? '11' : '00');
  assert.deepEqual(verifyActionToken(forged, denied, { now: C.now + 2, secret: C.secret, stateAt: 'denied', decidedBy }), { ok: false, code: PASS_ACTION_CODES.decided });
  // state at now wins over the stored state: a request that lapsed is not pending even if the record still says so
  assert.deepEqual(verifyActionToken(both.approve, P, { now: C.now + 1, secret: C.secret, stateAt: 'lapsed' }), { ok: false, code: PASS_ACTION_CODES.notPending });
});

test('push: payload shape, parse drops unknown and tokenless actions, cleared carries none', () => {
  const push = passPushPayload(P, 'pending', mintActionTokens(P, { now: C.now, secret: C.secret }));
  assert.deepEqual(push.actions.map((a) => a.id), [PASS_ACTION_IDS.approve, PASS_ACTION_IDS.deny, PASS_ACTION_IDS.open]);
  assert.deepEqual(push.actions.map((a) => a.background), [true, true, false]);
  assert.equal(push.expiresAt, new Date(C.expiry.all).toISOString());
  const parsed = parsePassPush({ ...push, actions: [...push.actions, { id: 'pass.revoke', token: 'x' }, { id: 'pass.approve', token: 'not-a-token' }] });
  assert.equal(parsed.actions.length, 3);
  assert.equal(parsePassPush({ type: 'veto', phase: 'held', id: P.id }), null);
  assert.equal(parsePassPush({ type: 'pass', phase: 'pending', id: 'nope' }), null);
  assert.throws(() => passPushPayload(P, 'pending', null), RangeError);
  assert.throws(() => passPushPayload(P, 'held', null), RangeError);
  const cleared = passPushPayload({ ...P, state: 'revoked' }, 'cleared', null);
  assert.deepEqual(cleared.actions, []);
  assert.doesNotMatch(JSON.stringify(cleared), /pa1\./);
});

test('results: ok and problem shapes', () => {
  assert.deepEqual(actionResult('approve', { id: P.id }), { ok: true, $axf: 'pass-approval@1', decision: 'approve', already: false, pass: { id: P.id }, text: 'Approved.' });
  assert.equal(actionResult('deny', null, true).text, 'Already denied.');
  assert.equal(actionProblem('nonsense').status, 400);
  assert.deepEqual(actionProblem('decided', { id: P.id }).pass, { id: P.id });
});
