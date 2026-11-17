/**
 * pass-approval@1 — the one contract console, Molly and AmberX share for approving a veto pass from a link or a
 * notification (build pass-approval-hook-deep-link-amberx-notification; Brett, Nov 10 2026: "I'm gonna need a link to
 * the pass, a hook to it."). Spec: docs/contracts/pass-approval.md. Pass records: control-pass@1
 * (framework/core/engines/control-pass.mjs).
 *
 * Pure: no IO, no clock of its own (every function takes `now`), no crypto. Signing lives in ./node.mjs (Node) and in
 * each port's twin; this module fixes the strings they sign and the shapes they exchange, so every port agrees byte for
 * byte (cases.json replays them).
 *
 *   deep link      console_show / console_open target `pass:<id>`; URL `<console>/#/pass/<id>[/approve|/deny]`;
 *                  Molly `<molly>/#/console/pass/<id>[/approve|/deny]`
 *   action token   `pa1.<pass id>.<decision>.<exp ms>.<nonce>.<hex HMAC-SHA256>` over actionTokenMessage(...): short-lived,
 *                  single-use, bound to one pass, one decision, that pass's scope / minutes / irreversible flag
 *   push payload   pass-push@1 `{type: "pass", phase, id, title, body, deep_link, actions: [{id: "pass.approve", token}, …]}`
 *   grant result   pass_grant / POST pass/grant answers gain `deep_link`, `approve_url`, `deny_url` (+ `molly_url`)
 */

export const PASS_APPROVAL_FRAME = 'pass-approval@1';
export const PASS_ACTION_TOKEN_FRAME = 'pass-action@1';
export const PASS_PUSH_FRAME = 'pass-push@1';

/** The two decisions a token or a tap can carry. Nothing else (revoke, undo, grant) ever rides a token. */
export const PASS_DECISIONS = ['approve', 'deny'];

/** Notification action ids (AmberX, web push): the two decisions and "open the pass". */
export const PASS_ACTION_IDS = { approve: 'pass.approve', deny: 'pass.deny', open: 'pass.open' };
/** Phases a pass push goes through: a request waits, then the notice is taken away (decided or lapsed). */
export const PASS_PUSH_PHASES = ['pending', 'cleared'];

/** console_show / console_open target kind ("pass:<id>"), the Follow Amber prefix and the console.screens path. */
export const PASS_TARGET_KIND = 'pass';
/** The console's hash route for a pass and the Molly app id that frames the console. */
export const PASS_ROUTE = 'pass';
export const MOLLY_CONSOLE_APP = 'console';
export const DEFAULT_CONSOLE_URL = 'https://console.amberxai.com';
export const DEFAULT_MOLLY_URL = 'https://molly.amberxai.com';

/** control-pass@1 ids look like `pass-<base36 ms>-<6 hex>` (token-control's newId). */
export const PASS_ID_RE = /^pass-[0-9a-z]{1,16}-[0-9a-f]{6}$/;

/** Token wire format: prefix, nonce size, signature size. */
export const PASS_ACTION_TOKEN_PREFIX = 'pa1';
export const PASS_ACTION_NONCE_HEX = 16;
export const PASS_ACTION_SIG_HEX = 64;
/** A token lives at most this long, and never past the request it belongs to (requests lapse after 15 min too). */
export const PASS_ACTION_TOKEN_TTL_MS = 15 * 60 * 1000;
/** = control-pass@1 PASS_REQUEST_TTL_MS; repeated here so the module stays dependency-free (cases.json pins both). */
export const PASS_REQUEST_TTL_MS = 15 * 60 * 1000;

/** How a decision taken through a token is recorded on the pass (control-pass@1 approvedVia gains this value). */
export const PASS_APPROVED_VIA_PUSH = 'push';

/** Problems verify can answer with (wire codes; the REST route maps them to statuses, see the spec). */
export const PASS_ACTION_CODES = {
  malformed: 'malformed', unknownPass: 'unknown_pass', wrongPass: 'wrong_pass', expired: 'expired', notPending: 'not_pending',
  decided: 'decided', badSignature: 'bad_signature', noSecret: 'no_secret',
};

const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const trimSlash = (u) => str(u).replace(/\/+$/, '');

/* ------------------------------------------------------------------ deep links */

/** Is this a pass id this contract will put in a link or a token? */
export const isPassId = (id) => PASS_ID_RE.test(str(id));
/** Is this one of the two decisions? */
export const isDecision = (d) => PASS_DECISIONS.includes(d);

/** `pass:<id>`: the console_show / console_open / Follow Amber target for a pass. */
export const passTarget = (id) => `${PASS_TARGET_KIND}:${str(id)}`;

/** `pass:<id>` (or a bare id) → the id, or null when it is not a pass target. */
export function parsePassTarget(target) {
  const t = str(target).trim();
  const m = /^pass:(.+)$/i.exec(t);
  const id = m ? m[1].trim() : t;
  return isPassId(id) ? id : null;
}

/** `<console>/#/pass/<id>`: opens the pending pass with Approve and Deny. */
export const passDeepLink = (id, opts = {}) => `${trimSlash(opts.consoleUrl || DEFAULT_CONSOLE_URL)}/#/${PASS_ROUTE}/${str(id)}`;

/** `<console>/#/pass/<id>/approve|deny`: opens the pass with that decision primed; one tap with Brett's session decides. */
export function passDecisionLink(id, decision, opts = {}) {
  if (!isDecision(decision)) throw new RangeError(`decision must be ${PASS_DECISIONS.join(' or ')}`);
  return `${passDeepLink(id, opts)}/${decision}`;
}

/** `<molly>/#/console/pass/<id>[/decision]`: the same route through Molly's frame of the console. */
export function passMollyLink(id, opts = {}, decision = '') {
  const tail = decision ? `/${decision}` : '';
  if (decision && !isDecision(decision)) throw new RangeError(`decision must be ${PASS_DECISIONS.join(' or ')}`);
  return `${trimSlash(opts.mollyUrl || DEFAULT_MOLLY_URL)}/#/${MOLLY_CONSOLE_APP}/${PASS_ROUTE}/${str(id)}${tail}`;
}

/**
 * A hash route (`#/pass/<id>`, `#/pass/<id>/approve`, Molly's `#/console/pass/<id>/deny`, with or without the `#`) →
 * `{ id, decision? }`, or null when it is not a pass route. A route with anything else after the decision is not one.
 */
export function parsePassRoute(hash) {
  const parts = str(hash).replace(/^#?\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[0] === MOLLY_CONSOLE_APP) parts.shift();
  if (parts[0] !== PASS_ROUTE || !isPassId(parts[1]) || parts.length > 3) return null;
  if (parts.length === 3 && !isDecision(parts[2])) return null;
  return { id: parts[1], ...(parts[2] ? { decision: parts[2] } : {}) };
}

/**
 * The link fields every answer about a pending pass carries (pass_grant, POST pass/grant, GET pass/<id>, pass_status
 * entries, the banner): no token in any of them, so an agent that reads them can only open the page, never decide.
 */
export function passLinks(id, opts = {}) {
  return {
    deep_link: passDeepLink(id, opts),
    approve_url: passDecisionLink(id, 'approve', opts),
    deny_url: passDecisionLink(id, 'deny', opts),
    molly_url: passMollyLink(id, opts),
  };
}

/**
 * What pass_grant adds to its result for a request that is waiting: the links, the target for console_show, and a
 * `text` tail Claude can read to Brett. `pass` is the control-pass@1 public view (id, state, minutes, scope...).
 */
export function passGrantResultFields(pass, opts = {}) {
  const p = isObj(pass) ? pass : {};
  if (!isPassId(p.id)) return {};
  const links = passLinks(p.id, opts);
  return {
    ...links,
    target: passTarget(p.id),
    ...(p.state === 'pending' ? { hand_over: `Approve here: ${links.deep_link}` } : {}),
  };
}

/* ------------------------------------------------------------------ action tokens (what is signed, how it travels) */

/** When a token minted at `now` for this pass stops working: 15 min, and never past the request's own lapse. */
export function actionTokenExpiry(pass, now) {
  const p = isObj(pass) ? pass : {};
  const requested = Date.parse(str(p.requestedAt));
  const lapse = Number.isFinite(requested) ? requested + PASS_REQUEST_TTL_MS : now + PASS_ACTION_TOKEN_TTL_MS;
  return Math.min(now + PASS_ACTION_TOKEN_TTL_MS, lapse);
}

/**
 * The message a token signs. Binding: the pass id, the decision, and the request as it was (scope, minutes, the
 * irreversible flag) so a token can't approve a wider or longer pass, plus its expiry and nonce. The same shape as
 * axHub's approval message (CONTROL.md) with the token's own fields on the end.
 *   `pass-action@1.<id>.<decision>.<scope>.<minutes>[.irreversible].<exp>.<nonce>`
 */
export function actionTokenMessage(f) {
  const x = isObj(f) ? f : {};
  if (!isPassId(x.id)) throw new RangeError('id must be a pass id');
  if (!isDecision(x.decision)) throw new RangeError(`decision must be ${PASS_DECISIONS.join(' or ')}`);
  if (typeof x.scope !== 'string' || !x.scope) throw new RangeError('scope is needed');
  if (!Number.isInteger(x.minutes) || x.minutes < 1) throw new RangeError('minutes must be a whole number ≥ 1');
  if (!Number.isInteger(x.exp) || x.exp <= 0) throw new RangeError('exp must be epoch ms');
  if (!new RegExp(`^[0-9a-f]{${PASS_ACTION_NONCE_HEX}}$`).test(str(x.nonce))) throw new RangeError(`nonce must be ${PASS_ACTION_NONCE_HEX} hex characters`);
  return `${PASS_ACTION_TOKEN_FRAME}.${x.id}.${x.decision}.${x.scope}.${x.minutes}${x.includeIrreversible === true ? '.irreversible' : ''}.${x.exp}.${x.nonce}`;
}

/** The fields of a message, read off the pass record it belongs to (scope, minutes, irreversible come from the pass). */
export function actionTokenFields(pass, decision, exp, nonce) {
  const p = isObj(pass) ? pass : {};
  return { id: p.id, decision, scope: p.scope, minutes: p.minutes, includeIrreversible: p.includeIrreversible === true || p.include_irreversible === true, exp, nonce };
}

/** `pa1.<id>.<decision>.<exp>.<nonce>.<sig>`: the token as it travels in a push action or a POST body. */
export function formatActionToken(t) {
  const x = isObj(t) ? t : {};
  if (!isPassId(x.id) || !isDecision(x.decision) || !Number.isInteger(x.exp)) throw new RangeError('id, decision and exp are needed');
  if (!new RegExp(`^[0-9a-f]{${PASS_ACTION_SIG_HEX}}$`).test(str(x.sig))) throw new RangeError(`sig must be ${PASS_ACTION_SIG_HEX} hex characters`);
  if (!new RegExp(`^[0-9a-f]{${PASS_ACTION_NONCE_HEX}}$`).test(str(x.nonce))) throw new RangeError(`nonce must be ${PASS_ACTION_NONCE_HEX} hex characters`);
  return [PASS_ACTION_TOKEN_PREFIX, x.id, x.decision, String(x.exp), x.nonce, x.sig].join('.');
}

const TOKEN_RE = new RegExp(`^${PASS_ACTION_TOKEN_PREFIX}\\.(pass-[0-9a-z]{1,16}-[0-9a-f]{6})\\.(approve|deny)\\.(\\d{1,16})\\.([0-9a-f]{${PASS_ACTION_NONCE_HEX}})\\.([0-9a-f]{${PASS_ACTION_SIG_HEX}})$`);

/** A token string → its fields, or null when it is not one (the spec's wire form is the only one accepted). */
export function parseActionToken(token) {
  const m = TOKEN_RE.exec(str(token).trim());
  return m ? { id: m[1], decision: m[2], exp: Number(m[3]), nonce: m[4], sig: m[5] } : null;
}

/**
 * Everything about a parsed token that can be checked before the signature: the pass it names exists and is the one
 * loaded, the token is not past its expiry, the pass still waits (a decided pass answers `decided`, any other state
 * `not_pending`). Returns null when nothing is wrong, else a code from PASS_ACTION_CODES. `stateAt` is the pass's state
 * at `now` (control-pass@1 passStateAt), so a lapsed request reads lapsed here too.
 */
export function actionTokenProblem(parsed, pass, now, stateAt) {
  if (!parsed) return PASS_ACTION_CODES.malformed;
  if (!isObj(pass) || !isPassId(pass.id)) return PASS_ACTION_CODES.unknownPass;
  if (pass.id !== parsed.id) return PASS_ACTION_CODES.wrongPass;
  if (now >= parsed.exp) return PASS_ACTION_CODES.expired;
  const state = stateAt ?? pass.state;
  if (state === 'active' || state === 'denied' || state === 'revoked' || state === 'expired') return PASS_ACTION_CODES.decided;
  if (state !== 'pending') return PASS_ACTION_CODES.notPending;
  return null;
}

/**
 * Replay guard, second half: the same token used twice answers the same way, without deciding again. `decidedBy` is
 * what the pass recorded when it was decided through a token: `{ nonce, decision }`. True = this exact token already
 * decided this pass (answer `already: true` with the pass as it is).
 */
export const actionTokenAlreadyUsed = (parsed, decidedBy) => !!parsed && isObj(decidedBy) && decidedBy.nonce === parsed.nonce && decidedBy.decision === parsed.decision;

/* ------------------------------------------------------------------ the push */

/** Words for a push: title and body from the pass's public view (control-pass@1 passPublic). */
export function passPushWords(pass) {
  const p = isObj(pass) ? pass : {};
  const scope = str(p.label) || str(p.scope) || 'Everything';
  const who = str(p.requestedBy) || 'an agent';
  const irr = p.include_irreversible === true || p.includeIrreversible === true ? ', irreversible deletes included' : '';
  const reason = str(p.reason) ? ` ${str(p.reason).slice(0, 140)}` : '';
  return {
    title: `Pass: ${scope} for ${Number(p.minutes) || 0} min`,
    body: `${who} asks for a pass${irr}.${reason} Approve or deny.`.trim(),
  };
}

/**
 * pass-push@1: what the console sends a device for a pass. `tokens` = `{ approve, deny }` minted for THIS delivery (the
 * only place tokens ever appear); `cleared` pushes carry no actions and no tokens. `opts.consoleUrl` / `mollyUrl` as above.
 */
export function passPushPayload(pass, phase, tokens, opts = {}) {
  if (!PASS_PUSH_PHASES.includes(phase)) throw new RangeError(`phase must be ${PASS_PUSH_PHASES.join(' or ')}`);
  const p = isObj(pass) ? pass : {};
  if (!isPassId(p.id)) throw new RangeError('pass needs an id');
  const links = passLinks(p.id, opts);
  const words = passPushWords(p);
  const base = {
    $axf: PASS_PUSH_FRAME, type: 'pass', phase, id: p.id, scope: str(p.scope), minutes: Number(p.minutes) || 0,
    include_irreversible: p.include_irreversible === true || p.includeIrreversible === true, requestedBy: str(p.requestedBy), requestedAt: str(p.requestedAt),
    deep_link: links.deep_link, molly_url: links.molly_url, target: passTarget(p.id), title: words.title, body: words.body,
  };
  if (phase === 'cleared') return { ...base, state: str(p.state), actions: [] };
  const t = isObj(tokens) ? tokens : {};
  if (!parseActionToken(t.approve) || !parseActionToken(t.deny)) throw new RangeError('a pending push needs an approve and a deny token');
  return {
    ...base, state: 'pending', expiresAt: new Date(Math.min(parseActionToken(t.approve).exp, parseActionToken(t.deny).exp)).toISOString(),
    actions: [
      { id: PASS_ACTION_IDS.approve, label: 'Approve', token: t.approve, background: true },
      { id: PASS_ACTION_IDS.deny, label: 'Deny', token: t.deny, background: true },
      { id: PASS_ACTION_IDS.open, label: 'Open', url: links.deep_link, background: false },
    ],
  };
}

/** A push (or any JSON) → `{ phase, id, actions }` when it is a pass-push@1 frame, else null. Unknown actions are dropped. */
export function parsePassPush(raw) {
  const j = isObj(raw) ? raw : null;
  if (!j || j.type !== 'pass' || !PASS_PUSH_PHASES.includes(j.phase) || !isPassId(j.id)) return null;
  const known = Object.values(PASS_ACTION_IDS);
  const actions = (Array.isArray(j.actions) ? j.actions : []).filter((a) => isObj(a) && known.includes(a.id) && (a.id === PASS_ACTION_IDS.open ? typeof a.url === 'string' : !!parseActionToken(a.token)));
  return { phase: j.phase, id: j.id, deep_link: str(j.deep_link) || passDeepLink(j.id), title: str(j.title), body: str(j.body), actions };
}

/**
 * The alert@1 input the console raises for a pending pass (source `pass`, one alert per pass, so the bell shows one
 * entry and the notify gate decides channels). The alert itself carries the deep link only: tokens go in the device
 * delivery (passPushPayload), never in the stored alert.
 */
export function passAlertInput(pass, opts = {}) {
  const p = isObj(pass) ? pass : {};
  const words = passPushWords(p);
  return {
    source: 'pass', key: `pass:${str(p.id)}`, severity: 'warning', title: words.title, body: words.body, link: passDeepLink(p.id, opts),
    meta: { pass: str(p.id), scope: str(p.scope), minutes: Number(p.minutes) || 0, requestedBy: str(p.requestedBy), target: passTarget(p.id) },
  };
}

/* ------------------------------------------------------------------ the action result */

/**
 * What POST pass/action (and the owner approve / deny routes) answer: `{ ok, decision, already, pass, text }` on success;
 * `{ ok: false, code, message, pass? }` otherwise. `pass` is the control-pass@1 public view after the call.
 */
export function actionResult(decision, pass, already = false, text = '') {
  return { ok: true, $axf: PASS_APPROVAL_FRAME, decision, already: already === true, pass: isObj(pass) ? pass : null, text: str(text) || (already ? `Already ${decision === 'approve' ? 'approved' : 'denied'}.` : decision === 'approve' ? 'Approved.' : 'Denied.') };
}

/** How a verify code maps to an HTTP status and a plain message. */
export function actionProblem(code, pass = null) {
  const status = { malformed: 400, unknown_pass: 404, wrong_pass: 409, expired: 410, not_pending: 409, decided: 409, bad_signature: 401, no_secret: 503 }[code] ?? 400;
  const message = {
    malformed: 'that is not a pass action token', unknown_pass: 'no such pass', wrong_pass: 'the token names another pass', expired: 'this link has expired: open the pass instead',
    not_pending: 'this pass is not waiting any more', decided: 'this pass was already decided', bad_signature: 'the token does not check out', no_secret: 'the console has no pass secret configured',
  }[code] ?? 'the token was refused';
  return { ok: false, $axf: PASS_APPROVAL_FRAME, code, status, message, ...(isObj(pass) ? { pass } : {}) };
}
