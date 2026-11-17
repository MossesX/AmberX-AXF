/**
 * pass-approval@1 service (docs/contracts/pass-approval.md): read a veto pass by id with its links, list the waiting
 * ones, and approve or deny one by id. Two ways to decide, both through the existing pass.scopes approve / deny
 * (control.mjs runControl → lib/pass.mjs runPass), so the gate, the store, the audit row and the THREADS line are the
 * ones the banner already uses:
 *
 *   owner   the transport's own approval (Brett's signed-in console session, a local console, a terminal): `approver`
 *   token   a signed pass action token (pa1.…) from a device notification: verified here, recorded `approvedVia: push`
 *
 * Idempotent: the same token again answers ok with `already: true`; the owner deciding a pass that already went the
 * same way answers `already: true` too; the other decision after one is `decided` (409). Every call, refused or not,
 * leaves an audit row (op `pass-approval`).
 */
import {
  PASS_APPROVED_VIA_PUSH, PASS_DECISIONS, actionProblem, actionResult, isDecision, isPassId, parseActionToken, passAlertInput, passGrantResultFields, passTarget,
} from '../../../../../packages/shared/pass-approval/index.mjs';
import { mintActionTokens, verifyActionToken } from '../../../../../packages/shared/pass-approval/node.mjs';
import { passPending, passPublic, passStateAt } from '../../../../../framework/core/engines/control-pass.mjs';
import { audit } from './common.mjs';
import { linkOpts, loadPasses, passSettings } from './pass.mjs';

export { linkOpts };

const OWNER = () => process.env.AXF_OWNER || 'brett';

/** A pass record by id (store brought up to `now`), or null. */
export function findPass(id, now = Date.now()) {
  if (!isPassId(id)) return null;
  return loadPasses(now).passes.find((p) => p.id === id) ?? null;
}

/** The public view of a pass plus its links (no token, ever), or null. */
export function passView(p, now = Date.now()) {
  if (!p) return null;
  return { ...passPublic(p, now, passSettings().timeZone), ...passGrantResultFields({ ...p, state: passStateAt(p, now) }, linkOpts()) };
}

/** GET pass/<id>: `{ ok, pass, text }` or a not-found problem. */
export function getPass(id, now = Date.now()) {
  const p = findPass(id, now);
  if (!p) return actionProblem('unknown_pass');
  const view = passView(p, now);
  return { ok: true, $axf: 'pass-approval@1', pass: view, target: passTarget(p.id), text: view.text };
}

/** GET pass/pending: every waiting request, newest first, with its links. */
export function listPending(now = Date.now()) {
  const items = loadPasses(now).passes.filter((p) => passPending(p, now)).map((p) => passView(p, now));
  return { ok: true, $axf: 'pass-approval@1', items, total: items.length, text: items.length ? items.map((x) => `${x.id}: ${x.text}`).join(' ') : 'No pass is waiting for Brett.' };
}

/**
 * The alert@1 input for a pass (pass-approval@1 passAlertInput: source pass, key pass:<id>, link = deep link, no token)
 * and, once it is no longer waiting, the follow-up words: approved / denied / lapsed. null = no such pass.
 */
export function alertFor(id, now = Date.now()) {
  const p = findPass(id, now);
  if (!p) return null;
  const v = passView(p, now);
  const base = passAlertInput(v, linkOpts());
  if (v.state === 'pending') return { ...base, phase: 'pending', state: v.state };
  const word = { active: 'approved', denied: 'denied', lapsed: 'lapsed (not approved in time)', revoked: 'withdrawn', expired: 'ended' }[v.state] ?? v.state;
  const how = v.approvedVia === 'push' ? ' from the notification' : v.approvedBy ? ` by ${v.approvedBy}` : '';
  return { ...base, phase: 'cleared', state: v.state, severity: v.state === 'active' ? 'success' : 'info', title: `Pass ${word}${v.state === 'active' ? how : ''}: ${v.label} for ${v.minutes} min`.slice(0, 200), body: v.text };
}

/** The tokens for a device delivery of a pending pass (only ever put into a push, never into an API answer). */
export function tokensFor(id, now = Date.now()) {
  const p = findPass(id, now);
  if (!p || !passPending(p, now)) return null;
  return mintActionTokens({ ...p, state: 'pending' }, { now });
}

/** Did this pass already go the way `decision` asks (approved = it went active; denied)? */
const wentWay = (p, decision) => !!p && (decision === 'approve' ? !!p.approvedBy && ['active', 'expired', 'revoked'].includes(p.state) : p.state === 'denied');

function logCall(entry) { audit({ op: 'pass-approval', target: 'pass.scopes', ...entry }); }

/**
 * Approve or deny pass `id`. `how` = { approver } (the transport's owner approval, never from a body) or { token }.
 * `proof` = axHub's signed approval headers (checked by runPass). `runControl` is control.mjs's (passed in so this module does not import the runner). Answers actionResult or
 * actionProblem (with `status`).
 */
export async function decidePass(id, decision, how, runControl, now = Date.now()) {
  const { approver = null, proof = null, token = '', by = '' } = how ?? {};
  if (token) {
    const parsed = parseActionToken(token);
    if (parsed && !id) id = parsed.id;
    if (parsed && !decision) decision = parsed.decision;
  }
  if (!isDecision(decision)) return actionProblem('malformed');
  const p = findPass(id, now);
  const fail = (code, extra = {}) => {
    logCall({ by: by || (token ? 'action-token' : approver?.name || 'unknown'), action: decision, pass: String(id || ''), path: p?.scope ?? '', result: code, ...extra });
    if (code === 'owner_required') return { ...actionProblem('bad_signature', p ? passView(p, now) : null), code, status: 403, message: 'only Brett can decide a pass: from his signed-in console session, a terminal, or the notification\'s Approve / Deny' };
    return actionProblem(code, p ? passView(p, now) : null);
  };
  if (!p) return fail('unknown_pass');

  let decidedBy = null;
  let owner = approver;
  if (token) {
    const parsed = parseActionToken(token);
    if (parsed && parsed.decision !== decision) return fail('wrong_pass', { nonce: parsed.nonce });
    const v = verifyActionToken(token, p, { now, stateAt: passStateAt(p, now), decidedBy: p.decidedBy });
    if (!v.ok) return fail(v.code, parsed ? { nonce: parsed.nonce } : {});
    if (v.already) {
      logCall({ by: OWNER(), action: decision, pass: p.id, path: p.scope, result: 'already', via: PASS_APPROVED_VIA_PUSH, nonce: v.nonce });
      return actionResult(decision, passView(p, now), true);
    }
    decidedBy = { nonce: v.nonce, decision };
    owner = { via: PASS_APPROVED_VIA_PUSH, name: OWNER() };
  } else {
    if (!owner && !proof) return fail('owner_required');
    if (!passPending(p, now)) {
      if (wentWay(p, decision) && owner) {
        logCall({ by: owner.name, action: decision, pass: p.id, path: p.scope, result: 'already', via: owner.via });
        return actionResult(decision, passView(p, now), true);
      }
      return fail(passStateAt(p, now) === 'lapsed' ? 'not_pending' : 'decided');
    }
  }

  const who = owner?.name || String(proof?.approver || 'axhub');
  const r = await runControl({ op: 'act', target: 'pass.scopes', path: p.scope, action: decision, input: { request: p.id }, by: who, reason: token ? 'pass action token' : 'pass approval view' }, { grants: ['*'], approver: owner, proof: owner ? null : proof, decidedBy, now });
  const after = findPass(p.id, now);
  if (!r.ok) {
    if (r.code === 'denied') return fail('owner_required');
    logCall({ by: who, action: decision, pass: p.id, path: p.scope, result: r.code, via: owner?.via ?? 'axhub' });
    return { ...actionProblem(r.code === 'not_found' ? 'not_pending' : 'decided', after ? passView(after, now) : null), message: r.message };
  }
  logCall({ by: who, action: decision, pass: p.id, path: p.scope, result: 'ok', via: owner?.via ?? 'axhub', ...(decidedBy ? { nonce: decidedBy.nonce } : {}) });
  const view = passView(after, now);
  return actionResult(decision, view, false, view?.text ? `${decision === 'approve' ? 'Approved' : 'Denied'}. ${view.text}` : '');
}

export { PASS_DECISIONS };
