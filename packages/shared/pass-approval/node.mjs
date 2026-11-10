/**
 * pass-approval@1 on Node: minting and verifying pass action tokens with the pass secret (AXF_PASS_SECRET, else
 * AXF_WALL_SECRET: the same secret token-control already signs its publication and axHub's approvals with). The
 * strings signed come from ./index.mjs; this file only adds HMAC-SHA256, a random nonce and a constant-time compare.
 *
 * Only a server holding the secret can mint. A token is minted for one delivery (a push to Brett's device) and never
 * answered to a bearer-token caller: pass_grant, GET pass/<id> and pass_status carry links without tokens.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PASS_ACTION_CODES, PASS_ACTION_NONCE_HEX, actionTokenAlreadyUsed, actionTokenExpiry, actionTokenFields, actionTokenMessage, actionTokenProblem,
  formatActionToken, isDecision, parseActionToken,
} from './index.mjs';

export const passSecret = () => process.env.AXF_PASS_SECRET || process.env.AXF_WALL_SECRET || '';
export const hmacHex = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');
export const newNonce = () => randomBytes(PASS_ACTION_NONCE_HEX / 2).toString('hex');

/**
 * Mint a token for `decision` on `pass` (a control-pass@1 record or its public view). `opts.now` (ms), `opts.secret`,
 * `opts.nonce` (tests). Throws when the pass is not pending or there is no secret: a token for anything else is a bug.
 */
export function mintActionToken(pass, decision, opts = {}) {
  const secret = opts.secret ?? passSecret();
  if (!secret) throw new Error(PASS_ACTION_CODES.noSecret);
  if (!isDecision(decision)) throw new RangeError('decision must be approve or deny');
  if (pass?.state !== 'pending') throw new Error(PASS_ACTION_CODES.notPending);
  const now = opts.now ?? Date.now();
  const exp = actionTokenExpiry(pass, now);
  const nonce = opts.nonce ?? newNonce();
  const sig = hmacHex(secret, actionTokenMessage(actionTokenFields(pass, decision, exp, nonce)));
  return { token: formatActionToken({ id: pass.id, decision, exp, nonce, sig }), exp, nonce };
}

/** Both tokens a pending push needs, with one expiry. */
export function mintActionTokens(pass, opts = {}) {
  return { approve: mintActionToken(pass, 'approve', opts).token, deny: mintActionToken(pass, 'deny', opts).token };
}

/**
 * Verify a token against the pass it names. `pass` is the record the caller loaded by the parsed id (null when none);
 * `opts.stateAt` is its state at `now` (passStateAt), `opts.decidedBy` what the pass recorded if a token decided it.
 * Answers `{ ok: true, decision, nonce, already }` or `{ ok: false, code }` (PASS_ACTION_CODES). The signature is
 * checked last and in constant time; a replay of the very token that decided the pass answers ok with already: true.
 */
export function verifyActionToken(token, pass, opts = {}) {
  const secret = opts.secret ?? passSecret();
  if (!secret) return { ok: false, code: PASS_ACTION_CODES.noSecret };
  const parsed = parseActionToken(token);
  const now = opts.now ?? Date.now();
  const sigOk = (p) => {
    const want = Buffer.from(hmacHex(secret, actionTokenMessage(actionTokenFields(pass, p.decision, p.exp, p.nonce))), 'hex');
    const got = Buffer.from(p.sig, 'hex');
    return want.length === got.length && timingSafeEqual(want, got);
  };
  const problem = actionTokenProblem(parsed, pass, now, opts.stateAt);
  if (problem === PASS_ACTION_CODES.decided && actionTokenAlreadyUsed(parsed, opts.decidedBy) && sigOk(parsed)) return { ok: true, decision: parsed.decision, nonce: parsed.nonce, already: true };
  if (problem) return { ok: false, code: problem };
  if (!sigOk(parsed)) return { ok: false, code: PASS_ACTION_CODES.badSignature };
  return { ok: true, decision: parsed.decision, nonce: parsed.nonce, already: false };
}
