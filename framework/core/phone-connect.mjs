/**
 * Phone Connect (phone-connect@1). Build phone-connect-small-android-companion, Brett Nov 15 2026: "We're gonna build
 * phone connect. Plug in, and it's gonna contain these features. Approval page, add it. Monitor yes. … Open pages on phone
 * keep it. Notifications keep it. Audio recorder, remove it out of console and put the whole thing in the phone app."
 *
 * The contract between the small Android companion, axHub and the console's phone-connect plugin. It replaces AmberX's
 * `amberx` device service and carries its security rules over unchanged (HubRules.java, AxppLink.java, OpenUrlRules.java):
 * one hub origin, the phone's own signed-in hub session (never the MCP token), replies capped, redirects refused, starting
 * a recording is never approved by a machine. Pure: no IO, no clock of its own (every function takes `at`), no model.
 *
 * Records:
 *   phone-device@1   one paired phone: deviceId, name, app, capabilities, pairing state (unpaired | pending | paired |
 *                    revoked), owner, pairedAt, lastSeenAt, the state each capability last reported, where it came from
 *   phone-pairing@1  one pairing handshake: the code the console shows, who issued it, when it expires, how it ended
 *   phone-command@1  one command to a phone (phone.open_url, phone.notify, phone.approvals_watch, phone.recorder_start |
 *                    stop | status): id, deviceId, arguments, who asked and through what, the policy it needs
 *   phone-result@1   the phone's answer: ok + data + state, or a wire error code and a message in plain words
 *
 * The AXPP wire (axHub decision #108) stays as it is: `hello` / `next` / `answer` over HTTPS long poll, envelope
 * `{protocol: 'axpp@1', kind, id, correlationId?, payload}`. `toWire` / `fromWire` map a phone-command@1 onto it.
 */

export const SCHEMA = 'phone-connect@1';
export const DEVICE_FRAME = 'phone-device@1';
export const PAIRING_FRAME = 'phone-pairing@1';
export const COMMAND_FRAME = 'phone-command@1';
export const RESULT_FRAME = 'phone-result@1';
export const VERSION = 1;

/** The companion app id a device announces; the AmberX one is read for the migration only. */
export const APP = 'phone-connect-droid';
export const LEGACY_APP = 'amberx-droid';
export const PLATFORMS = Object.freeze(['android']);
/** What a phone can do; a device lists the ones its build has. */
export const CAPABILITIES = Object.freeze(['open-url@1', 'notify@1', 'approvals@1', 'recorder@1']);

/** The pairing state machine. */
export const PAIRING_STATES = Object.freeze(['unpaired', 'pending', 'paired', 'revoked']);
export const PAIRING_EVENTS = Object.freeze(['issue', 'confirm', 'expire', 'cancel', 'revoke', 'forget']);
/**
 * unpaired →issue→ pending →confirm→ paired →revoke→ revoked. A pending code that expires or is cancelled goes back to
 * unpaired; a revoked phone pairs again with a new code (issue) or is forgotten (its record goes).
 */
export const TRANSITIONS = Object.freeze({
  unpaired: Object.freeze({ issue: 'pending' }),
  pending: Object.freeze({ confirm: 'paired', expire: 'unpaired', cancel: 'unpaired' }),
  paired: Object.freeze({ revoke: 'revoked' }),
  revoked: Object.freeze({ issue: 'pending', forget: 'unpaired' }),
});

/** The console-facing tool names: the same on REST, MCP, the CLI and voice. */
export const TOOLS = Object.freeze(['phone.open_url', 'phone.notify', 'phone.approvals_watch', 'phone.recorder_start', 'phone.recorder_stop', 'phone.recorder_status']);
/** What each tool is called on the AXPP wire (the phone answers these). */
export const WIRE_TOOLS = Object.freeze({
  'phone.open_url': 'browser.open', 'phone.notify': 'notify.show', 'phone.approvals_watch': 'approvals.watch',
  'phone.recorder_start': 'recorder.start', 'phone.recorder_stop': 'recorder.stop', 'phone.recorder_status': 'recorder.status',
});
/** The capability a phone must list before a tool is sent to it. */
export const TOOL_CAPABILITY = Object.freeze({
  'phone.open_url': 'open-url@1', 'phone.notify': 'notify@1', 'phone.approvals_watch': 'approvals@1',
  'phone.recorder_start': 'recorder@1', 'phone.recorder_stop': 'recorder@1', 'phone.recorder_status': 'recorder@1',
});
/** allow = runs; confirm = a straight approval on axHub first (explicitApproval: no veto countdown, no auto-approve window). */
export const POLICIES = Object.freeze(['allow', 'confirm']);
export const TOOL_POLICY = Object.freeze({
  'phone.open_url': 'allow', 'phone.notify': 'allow', 'phone.approvals_watch': 'allow',
  'phone.recorder_start': 'confirm', 'phone.recorder_stop': 'allow', 'phone.recorder_status': 'allow',
});
/** Never approved by a machine, hub or phone (axHub decision #108). */
export const NEVER_AUTO = Object.freeze(['phone.recorder_start']);
/** "Approve everything" never covers a root shell on the VPS (Brett, Oct 22 2026). */
export const NOT_IN_ALL = Object.freeze(['vps.run']);
/** Tools that read only. */
export const READ_ONLY = Object.freeze(['phone.recorder_status']);
/** The retired AmberX names. Resolved for one release, answered with `deprecated`, then gone (PHONE-CONNECT.md → Migration). */
export const ALIASES = Object.freeze({
  'amberx.open_url': 'phone.open_url', 'amberx.recorder_start': 'phone.recorder_start',
  'amberx.recorder_stop': 'phone.recorder_stop', 'amberx.recorder_status': 'phone.recorder_status',
});
/** Where a command came from. */
export const VIAS = Object.freeze(['console', 'mcp', 'cli', 'voice', 'hub']);

/** Which pages a phone opens: own = Brett's own sites over https; allowlist = those hosts; any = any http(s) page. */
export const URL_POLICIES = Object.freeze(['own', 'allowlist', 'any']);
export const OWN_DOMAINS = Object.freeze(['amberxai.com']);
export const URL_SCHEMES = Object.freeze(['https', 'http']);
/** Where a page opens on the phone. */
export const OPEN_WHERE = Object.freeze(['overlay', 'browser']);
export const BROWSERS = Object.freeze(['chrome', 'default']);
/** Notification channels, the ones AmberX's watch already has. */
export const NOTIFY_CHANNELS = Object.freeze(['alerts', 'approvals', 'console', 'recorder']);
export const NOTIFY_PRIORITIES = Object.freeze(['normal', 'high']);

/** Wire error codes: INTEROP.md's plus the four phone-connect@1 adds. Unknown codes read as unexpected. */
export const ERROR_CODES = Object.freeze(['invalid', 'denied', 'not_found', 'unavailable', 'validation', 'unexpected', 'timeout', 'confirmation_required', 'offline', 'unpaired', 'revoked', 'consent_required']);
/** A retryable error: the same command may be sent again later unchanged. */
export const RETRYABLE = Object.freeze(['unavailable', 'timeout', 'offline', 'consent_required']);

/** Hub sign-in and session rules, the ones AmberX lives by (HubRules.java, AxppLink.java). */
export const HUB = Object.freeze({
  origin: 'https://axhub.amberxai.com',
  protocol: 'axpp@1',
  header: 'X-AXPP',
  paths: Object.freeze({ hello: '/axpp/v1/hello', next: '/axpp/v1/next', answer: '/axpp/v1/answer', session: '/auth/api/session' }),
  pollSeconds: 25,
  onlineSeconds: 45,
  answerSeconds: 20,
  backoffMs: Object.freeze([5000, 15000, 30000, 60000]),
  authRetryMs: 60000,
  replyMaxBytes: 256 * 1024,
  followRedirects: false,
  pairingTtlMinutes: 10,
});

export const DEVICE_ID_PATTERN = '^[A-Za-z0-9_-]{8,64}$';
export const DEVICE_ID_PREFIX = 'phone-';
/** Eight characters, no 0 / O / 1 / I, shown on the console and typed on the phone. */
export const PAIRING_CODE_PATTERN = '^[A-HJ-NP-Z2-9]{8}$';
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const NAME_MAX = 80;
export const TEXT_MAX = 600;
export const TITLE_MAX = 120;
export const URL_MAX = 2000;
export const SESSION_NAME_MAX = 120;
export const CAPABILITIES_MAX = 16;

const DEVICE_ID_RE = new RegExp(DEVICE_ID_PATTERN);
const CODE_RE = new RegExp(PAIRING_CODE_PATTERN);
const UUID_RE = new RegExp(UUID_PATTERN);
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const oneOf = (l, v, d) => (l.includes(v) ? v : d);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ms = (a) => Date.parse(a);
/** Lowercases A–Z only, the same on every port. */
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// ------------------------------------------------------------------ device record

/** The empty record for a phone nobody has paired. */
export function emptyDevice(at) {
  return { $axf: DEVICE_FRAME, deviceId: '', name: '', app: APP, appVersion: '', platform: 'android', capabilities: [], state: 'unpaired', owner: '', pairedAt: '', lastSeenAt: '', revokedAt: '', capabilityState: {}, updatedAt: iso(at) };
}

/** One device, normalised: bad enums fall to the safe side (unpaired, no capabilities). */
export function normDevice(d, at = '') {
  const x = obj(d);
  const caps = []; for (const c of list(x.capabilities)) if (CAPABILITIES.includes(c) && !caps.includes(c)) caps.push(c);
  const capState = {}; for (const [k, v] of Object.entries(obj(x.capabilityState))) if (caps.includes(k) && isObj(v)) capState[k] = v;
  const out = {
    $axf: DEVICE_FRAME, deviceId: DEVICE_ID_RE.test(String(x.deviceId || '')) ? x.deviceId : '', name: str(x.name, NAME_MAX), app: x.app === LEGACY_APP ? LEGACY_APP : APP,
    appVersion: str(x.appVersion, 40), platform: oneOf(PLATFORMS, x.platform, 'android'), capabilities: caps.slice(0, CAPABILITIES_MAX), state: oneOf(PAIRING_STATES, x.state, 'unpaired'),
    owner: str(x.owner, NAME_MAX), pairedAt: iso(x.pairedAt), lastSeenAt: iso(x.lastSeenAt), revokedAt: iso(x.revokedAt), capabilityState: capState, updatedAt: iso(x.updatedAt) || iso(at),
  };
  if (out.state !== 'paired') out.pairedAt = out.state === 'revoked' ? out.pairedAt : '';
  if (out.state !== 'revoked') out.revokedAt = '';
  if (x.migratedFrom && isObj(x.migratedFrom)) out.migratedFrom = { deviceId: str(x.migratedFrom.deviceId, 64), app: str(x.migratedFrom.app, 40), at: iso(x.migratedFrom.at) };
  if (x.note) out.note = str(x.note, TEXT_MAX);
  return out;
}

/** Errors in one device record (empty = valid). */
export function deviceErrors(d, path = 'device') {
  const out = []; const x = obj(d);
  if (x.$axf !== DEVICE_FRAME) out.push(`${path}.$axf is ${DEVICE_FRAME}`);
  if (!DEVICE_ID_RE.test(String(x.deviceId || ''))) out.push(`${path}.deviceId matches ${DEVICE_ID_PATTERN}`);
  if (typeof x.name !== 'string' || x.name.length > NAME_MAX) out.push(`${path}.name is text up to ${NAME_MAX} characters`);
  if (x.app !== APP && x.app !== LEGACY_APP) out.push(`${path}.app is ${APP} (or ${LEGACY_APP} before the migration)`);
  if (!PLATFORMS.includes(x.platform)) out.push(`${path}.platform is one of ${PLATFORMS.join(', ')}`);
  if (!Array.isArray(x.capabilities)) out.push(`${path}.capabilities is a list`);
  else { x.capabilities.forEach((c, i) => { if (!CAPABILITIES.includes(c)) out.push(`${path}.capabilities[${i}] is one of ${CAPABILITIES.join(', ')}`); }); if (new Set(x.capabilities).size !== x.capabilities.length) out.push(`${path}.capabilities has no repeats`); }
  if (!PAIRING_STATES.includes(x.state)) out.push(`${path}.state is one of ${PAIRING_STATES.join(', ')}`);
  if (x.state === 'paired' && !iso(x.pairedAt)) out.push(`${path}.pairedAt is an ISO date-time when paired`);
  if (x.state === 'paired' && !x.owner) out.push(`${path}.owner names who paired it`);
  if (x.state === 'revoked' && !iso(x.revokedAt)) out.push(`${path}.revokedAt is an ISO date-time when revoked`);
  for (const k of ['pairedAt', 'lastSeenAt', 'revokedAt', 'updatedAt']) if (x[k] !== undefined && x[k] !== '' && !iso(x[k])) out.push(`${path}.${k} is an ISO date-time or empty`);
  if (x.capabilityState !== undefined && !isObj(x.capabilityState)) out.push(`${path}.capabilityState is an object`);
  else for (const k of Object.keys(obj(x.capabilityState))) if (!list(x.capabilities).includes(k)) out.push(`${path}.capabilityState.${k} names a capability the device has`);
  return out;
}

/** True when the phone polled the hub within HUB.onlineSeconds of `at`. A phone that is not paired is never online. */
export function isOnline(device, at) {
  const d = obj(device);
  if (d.state !== 'paired' || !iso(d.lastSeenAt) || !iso(at)) return false;
  const gap = ms(at) - ms(d.lastSeenAt);
  return gap >= 0 && gap <= HUB.onlineSeconds * 1000;
}

/** "online" · "offline: last seen 12 min ago" · "not paired" · "revoked", the words every surface uses. */
export function presence(device, at) {
  const d = obj(device);
  if (d.state === 'revoked') return 'revoked';
  if (d.state !== 'paired') return 'not paired';
  if (isOnline(d, at)) return 'online';
  if (!iso(d.lastSeenAt)) return 'offline: never seen';
  const min = Math.max(0, Math.floor((ms(at) - ms(d.lastSeenAt)) / 60000));
  return min < 1 ? 'offline: last seen under a minute ago' : min < 60 ? `offline: last seen ${min} min ago` : min < 1440 ? `offline: last seen ${Math.floor(min / 60)} h ago` : `offline: last seen ${Math.floor(min / 1440)} d ago`;
}

// ------------------------------------------------------------------ pairing

/** The next state for `event` in `state`, or null when the move is not allowed. */
export function transition(state, event) {
  return TRANSITIONS[state]?.[event] ?? null;
}

/** Issue a pairing: the console shows `code`, the phone has HUB.pairingTtlMinutes to say hello with it. */
export function issuePairing({ code, at, by, deviceId = '' }) {
  const issuedAt = iso(at);
  return {
    $axf: PAIRING_FRAME, code: CODE_RE.test(String(code || '')) ? code : '', state: 'pending', issuedAt, expiresAt: issuedAt ? new Date(ms(issuedAt) + HUB.pairingTtlMinutes * 60000).toISOString() : '',
    by: str(by, NAME_MAX), deviceId: DEVICE_ID_RE.test(String(deviceId || '')) ? deviceId : '', endedAt: '', ended: '',
  };
}

/** Errors in a pairing record (empty = valid). */
export function pairingErrors(p, path = 'pairing') {
  const out = []; const x = obj(p);
  if (x.$axf !== PAIRING_FRAME) out.push(`${path}.$axf is ${PAIRING_FRAME}`);
  if (!CODE_RE.test(String(x.code || ''))) out.push(`${path}.code matches ${PAIRING_CODE_PATTERN}`);
  if (!PAIRING_STATES.includes(x.state) || x.state === 'revoked') out.push(`${path}.state is pending, paired or unpaired`);
  if (!iso(x.issuedAt)) out.push(`${path}.issuedAt is an ISO date-time`);
  if (!iso(x.expiresAt)) out.push(`${path}.expiresAt is an ISO date-time`);
  else if (iso(x.issuedAt) && ms(x.expiresAt) - ms(x.issuedAt) !== HUB.pairingTtlMinutes * 60000) out.push(`${path}.expiresAt is issuedAt + ${HUB.pairingTtlMinutes} min`);
  if (!x.by) out.push(`${path}.by names who issued it`);
  if (x.deviceId && !DEVICE_ID_RE.test(String(x.deviceId))) out.push(`${path}.deviceId matches ${DEVICE_ID_PATTERN} or is empty`);
  if (x.state !== 'pending' && !iso(x.endedAt)) out.push(`${path}.endedAt is an ISO date-time once it ended`);
  if (x.state !== 'pending' && !['confirm', 'expire', 'cancel'].includes(x.ended)) out.push(`${path}.ended is confirm, expire or cancel once it ended`);
  return out;
}

/** True once `at` is past the pairing's expiry. */
export function pairingExpired(pairing, at) {
  const p = obj(pairing);
  return !!iso(p.expiresAt) && !!iso(at) && ms(at) > ms(p.expiresAt);
}

/**
 * The phone's `hello` with a code: the hub confirms the pairing and the device becomes paired. Answers
 * `{ok: true, device, pairing}` or `{ok: false, error: {code, message}}`; nothing is changed on an error.
 *   denied   the code is not the one waiting
 *   timeout  the code expired (the console shows a new one)
 *   invalid  the hello is not a device record the contract knows
 */
export function confirmPairing(pairing, hello, { at, owner }) {
  const p = obj(pairing); const h = obj(hello);
  if (p.state !== 'pending') return fail('not_found', 'No pairing is waiting. Start one on the console.');
  if (pairingExpired(p, at)) return fail('timeout', `The pairing code expired after ${HUB.pairingTtlMinutes} minutes. Start a new one on the console.`);
  if (!CODE_RE.test(String(h.code || '')) || h.code !== p.code) return fail('denied', 'That pairing code is not the one waiting.');
  const device = normDevice({ ...deviceFromHello(h, at), state: 'paired', owner, pairedAt: iso(at), lastSeenAt: iso(at) }, at);
  const errs = deviceErrors(device);
  if (errs.length) return fail('invalid', `The phone's hello is not a device record: ${errs[0]}.`);
  if (p.deviceId && p.deviceId !== device.deviceId) return fail('denied', 'This pairing was started for another phone.');
  return { ok: true, device, pairing: { ...p, state: 'paired', deviceId: device.deviceId, endedAt: iso(at), ended: 'confirm' } };
}

/** The pairing after its code expired or the console cancelled it: back to unpaired, the record says why. */
export function endPairing(pairing, ended, at) {
  const p = obj(pairing);
  if (p.state !== 'pending' || !['expire', 'cancel'].includes(ended)) return p;
  return { ...p, state: 'unpaired', endedAt: iso(at), ended };
}

/** A device record from a phone's hello payload (deviceId, name, app, appVersion, capabilities, state). Not paired yet. */
export function deviceFromHello(payload, at) {
  const h = obj(payload);
  return normDevice({ deviceId: h.deviceId, name: h.name, app: h.app, appVersion: h.appVersion, platform: 'android', capabilities: h.capabilities, capabilityState: h.state, state: 'unpaired', lastSeenAt: iso(at) }, at);
}

/**
 * A paired phone said hello again or answered a poll: lastSeenAt and the capability state move, nothing else does. An
 * unpaired or revoked phone gets the matching error and the record stays.
 */
export function seen(device, payload, at) {
  const d = normDevice(device, at);
  if (d.state === 'revoked') return fail('revoked', 'This phone was revoked. Pair it again from the console.');
  if (d.state !== 'paired') return fail('unpaired', 'This phone is not paired. Pair it from the console.');
  const h = obj(payload);
  const caps = list(h.capabilities).filter((c) => CAPABILITIES.includes(c));
  const next = normDevice({ ...d, name: h.name || d.name, appVersion: h.appVersion || d.appVersion, capabilities: caps.length ? caps : d.capabilities, capabilityState: { ...d.capabilityState, ...obj(h.state) }, lastSeenAt: iso(at), updatedAt: iso(at) }, at);
  return { ok: true, device: next };
}

/** The owner revokes a phone: its session is refused from now on and every command answers `revoked`. */
export function revoke(device, { at, by, why = '' }) {
  const d = normDevice(device, at);
  if (transition(d.state, 'revoke') !== 'revoked') return fail('invalid', `A ${d.state} phone cannot be revoked.`);
  return { ok: true, device: normDevice({ ...d, state: 'revoked', revokedAt: iso(at), updatedAt: iso(at), note: why ? `Revoked by ${by}: ${why}` : `Revoked by ${by}.` }, at) };
}

// ------------------------------------------------------------------ the hub session

/**
 * Errors in one AXPP request as the hub must refuse it (empty = accepted): exactly the hub origin over https, the
 * `X-AXPP: axpp@1` header, a JSON body, the phone's signed-in hub session cookie and never a bearer token.
 */
export function requestErrors(req) {
  const out = []; const r = obj(req);
  const url = str(r.url, URL_MAX);
  if (!url.startsWith(`${HUB.origin}/`)) out.push(`url is on ${HUB.origin} and nowhere else`);
  else if (!Object.values(HUB.paths).some((p) => url === `${HUB.origin}${p}`)) out.push('url is one of the AXPP routes');
  const headers = {}; for (const [k, v] of Object.entries(obj(r.headers))) headers[asciiLower(k)] = String(v);
  if (headers[asciiLower(HUB.header)] !== HUB.protocol) out.push(`${HUB.header} header is ${HUB.protocol}`);
  if (!/^application\/json\b/.test(headers['content-type'] || '')) out.push('body is JSON');
  if (!headers.cookie) out.push('the phone sends its signed-in hub session cookie');
  if (headers.authorization) out.push('an MCP or bearer token never signs a phone in');
  if (r.followRedirects === true) out.push('redirects are never followed');
  if (r.body !== undefined && !isObj(r.body)) out.push('body is a JSON object');
  return out;
}

/** The AXPP envelope for one phone-command@1 (what `next` hands the phone). */
export function toWire(command) {
  const c = normCommand(command);
  return { protocol: HUB.protocol, kind: 'call', id: c.id, payload: { tool: WIRE_TOOLS[c.tool] || c.tool, arguments: c.arguments } };
}

/** How long the phone waits on `next`, how long the hub waits for an answer, and the backoff after `failures` failures. */
export function backoffMs(failures) {
  const n = Math.max(1, Math.min(Number.isInteger(failures) ? failures : 1, HUB.backoffMs.length));
  return HUB.backoffMs[n - 1];
}

/** After an HTTP status on hello / next: say hello again, wait, or carry on. */
export function afterStatus(status, failures = 0) {
  if (status === 200) return { welcomed: true, waitMs: 0, failures: 0 };
  if (status === 204) return { welcomed: true, waitMs: 0, failures: 0 };
  if (status === 401 || status === 403) return { welcomed: false, waitMs: HUB.authRetryMs, failures, signedOut: true };
  if (status === 404) return { welcomed: false, waitMs: 0, failures };
  return { welcomed: false, waitMs: backoffMs(failures + 1), failures: failures + 1 };
}

// ------------------------------------------------------------------ commands

/** `phone.*` as given, an `amberx.*` alias resolved (deprecated: true), or an unknown name (tool: ''). */
export function resolveTool(name) {
  const n = str(name, 80);
  if (TOOLS.includes(n)) return { tool: n, deprecated: false, alias: '' };
  if (ALIASES[n]) return { tool: ALIASES[n], deprecated: true, alias: n };
  return { tool: '', deprecated: false, alias: '' };
}

/** The policy a tool needs: confirm for recorder_start, allow for the rest. */
export function policyOf(tool) {
  return TOOL_POLICY[resolveTool(tool).tool] || 'confirm';
}

/**
 * Whether a machine may approve `tool` on its own: the hub's auto-approve window or the phone's list. Never for NEVER_AUTO;
 * "approve everything" never covers NOT_IN_ALL. The same answer as HubRules.autoApproves in AmberX.
 */
export function autoApproves({ approveAll = false, listOn = false, list: allowed = '' }, tool) {
  const t = resolveTool(tool).tool || str(tool, 80);
  if (NEVER_AUTO.includes(t)) return false;
  if (approveAll && !NOT_IN_ALL.includes(t)) return true;
  if (!listOn) return false;
  const items = String(allowed || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return items.some((p) => p === t || p === '*' || (p.endsWith('.*') && t.startsWith(p.slice(0, -1))));
}

/** Errors in a tool's arguments (empty = valid). */
export function argsErrors(tool, args, path = 'arguments') {
  const out = []; const a = obj(args); const t = resolveTool(tool).tool;
  const known = {
    'phone.open_url': ['url', 'where', 'browser'], 'phone.notify': ['title', 'body', 'url', 'channel', 'priority'], 'phone.approvals_watch': ['on', 'ring'],
    'phone.recorder_start': ['session_name', 'group', 'note', 'mic'], 'phone.recorder_stop': [], 'phone.recorder_status': [],
  }[t];
  if (!known) return [`tool is one of ${TOOLS.join(', ')}`];
  for (const k of Object.keys(a)) if (!known.includes(k)) out.push(`${path}.${k} is not an argument of ${t}`);
  switch (t) {
    case 'phone.open_url':
      if (typeof a.url !== 'string' || !a.url.trim()) out.push(`${path}.url is required`);
      else if (a.url.length > URL_MAX) out.push(`${path}.url is at most ${URL_MAX} characters`);
      if (a.where !== undefined && !OPEN_WHERE.includes(a.where)) out.push(`${path}.where is one of ${OPEN_WHERE.join(', ')}`);
      if (a.browser !== undefined && !BROWSERS.includes(a.browser)) out.push(`${path}.browser is one of ${BROWSERS.join(', ')}`);
      break;
    case 'phone.notify':
      if (typeof a.title !== 'string' || !a.title.trim()) out.push(`${path}.title is required`);
      else if (a.title.length > TITLE_MAX) out.push(`${path}.title is at most ${TITLE_MAX} characters`);
      if (a.body !== undefined && (typeof a.body !== 'string' || a.body.length > TEXT_MAX)) out.push(`${path}.body is text up to ${TEXT_MAX} characters`);
      if (a.url !== undefined && (typeof a.url !== 'string' || a.url.length > URL_MAX)) out.push(`${path}.url is text up to ${URL_MAX} characters`);
      if (a.channel !== undefined && !NOTIFY_CHANNELS.includes(a.channel)) out.push(`${path}.channel is one of ${NOTIFY_CHANNELS.join(', ')}`);
      if (a.priority !== undefined && !NOTIFY_PRIORITIES.includes(a.priority)) out.push(`${path}.priority is one of ${NOTIFY_PRIORITIES.join(', ')}`);
      break;
    case 'phone.approvals_watch':
      if (typeof a.on !== 'boolean') out.push(`${path}.on is true or false`);
      if (a.ring !== undefined && typeof a.ring !== 'boolean') out.push(`${path}.ring is true or false`);
      break;
    case 'phone.recorder_start':
      if (typeof a.session_name !== 'string' || !a.session_name.trim()) out.push(`${path}.session_name is required`);
      else if (a.session_name.length > SESSION_NAME_MAX) out.push(`${path}.session_name is at most ${SESSION_NAME_MAX} characters`);
      if (a.group !== undefined && (typeof a.group !== 'string' || a.group.length > SESSION_NAME_MAX)) out.push(`${path}.group is text up to ${SESSION_NAME_MAX} characters`);
      if (a.note !== undefined && (typeof a.note !== 'string' || a.note.length > TEXT_MAX)) out.push(`${path}.note is text up to ${TEXT_MAX} characters`);
      if (a.mic !== undefined && typeof a.mic !== 'boolean') out.push(`${path}.mic is true or false`);
      break;
    default: break;
  }
  return out;
}

/** One command, normalised: the alias resolved, the policy filled in from the tool, unknown argument keys dropped. */
export function normCommand(c, at = '') {
  const x = obj(c); const r = resolveTool(x.tool);
  const known = { 'phone.open_url': ['url', 'where', 'browser'], 'phone.notify': ['title', 'body', 'url', 'channel', 'priority'], 'phone.approvals_watch': ['on', 'ring'], 'phone.recorder_start': ['session_name', 'group', 'note', 'mic'], 'phone.recorder_stop': [], 'phone.recorder_status': [] }[r.tool] || [];
  const args = {}; for (const k of known) if (obj(x.arguments)[k] !== undefined) args[k] = obj(x.arguments)[k];
  const from = obj(x.from);
  const out = {
    $axf: COMMAND_FRAME, id: UUID_RE.test(String(x.id || '')) ? x.id : '', at: iso(x.at) || iso(at), deviceId: DEVICE_ID_RE.test(String(x.deviceId || '')) ? x.deviceId : '',
    tool: r.tool, arguments: args, policy: r.tool ? TOOL_POLICY[r.tool] : oneOf(POLICIES, x.policy, 'confirm'),
    from: { who: str(from.who, NAME_MAX), via: oneOf(VIAS, from.via, 'console') },
  };
  if (r.deprecated) out.alias = r.alias;
  if (x.correlationId) out.correlationId = str(x.correlationId, 80);
  if (x.approvalId) out.approvalId = str(x.approvalId, 64);
  return out;
}

/** Errors in one command (empty = valid). */
export function commandErrors(c, path = 'command') {
  const out = []; const x = obj(c);
  if (x.$axf !== COMMAND_FRAME) out.push(`${path}.$axf is ${COMMAND_FRAME}`);
  if (!UUID_RE.test(String(x.id || ''))) out.push(`${path}.id is a uuid`);
  if (!iso(x.at)) out.push(`${path}.at is an ISO date-time`);
  if (!DEVICE_ID_RE.test(String(x.deviceId || ''))) out.push(`${path}.deviceId matches ${DEVICE_ID_PATTERN}`);
  const r = resolveTool(x.tool);
  if (!r.tool) out.push(`${path}.tool is one of ${TOOLS.join(', ')}`);
  else {
    if (r.deprecated) out.push(`${path}.tool ${r.alias} is deprecated: use ${r.tool}`);
    if (x.arguments !== undefined && !isObj(x.arguments)) out.push(`${path}.arguments is an object`);
    else out.push(...argsErrors(r.tool, x.arguments, `${path}.arguments`));
    if (x.policy !== undefined && x.policy !== TOOL_POLICY[r.tool]) out.push(`${path}.policy for ${r.tool} is ${TOOL_POLICY[r.tool]}`);
  }
  const from = obj(x.from);
  if (!isObj(x.from)) out.push(`${path}.from says who asked`);
  else { if (!from.who) out.push(`${path}.from.who is required`); if (!VIAS.includes(from.via)) out.push(`${path}.from.via is one of ${VIAS.join(', ')}`); }
  if (x.policy === 'confirm' && x.approvalId !== undefined && !x.approvalId) out.push(`${path}.approvalId names the approval once it was given`);
  return out;
}

/**
 * Whether `command` may be sent to `device` right now. Empty = send it. Otherwise one wire error: unpaired, revoked,
 * offline (retryable), not_found when the phone lacks the capability, confirmation_required until the approval exists.
 */
export function dispatchErrors(command, device, at) {
  const c = normCommand(command, at); const d = normDevice(device, at);
  if (!c.tool) return fail('invalid', `Unknown tool "${str(obj(command).tool, 80)}".`).error;
  if (d.state === 'revoked') return fail('revoked', `${d.name || 'The phone'} was revoked. Pair it again from the console.`).error;
  if (d.state !== 'paired') return fail('unpaired', 'No phone is paired. Pair one from the console.').error;
  if (!d.capabilities.includes(TOOL_CAPABILITY[c.tool])) return fail('not_found', `${d.name || 'The phone'} cannot do ${c.tool} (it lacks ${TOOL_CAPABILITY[c.tool]}). Install the current app.`).error;
  if (c.policy === 'confirm' && !c.approvalId) return fail('confirmation_required', `${c.tool} needs Brett's approval on axHub first.`).error;
  if (!isOnline(d, at)) return fail('offline', `${d.name || 'The phone'} is ${presence(d, at)}. Open the app or switch the watch on.`).error;
  return null;
}

// ------------------------------------------------------------------ open_url

/**
 * The URL the phone may open under `policy`, else the error. Always refused: anything but http(s) (intent:, file:,
 * javascript:), user info in the address, more than URL_MAX characters. `own` is https on OWN_DOMAINS only (default port);
 * `allowlist` is those hosts or their subdomains; `any` is any http(s) page.
 */
export function openUrlAllowed(raw, { policy = 'own', allowlist = [] } = {}) {
  const s = str(raw, URL_MAX + 1);
  if (!s) return { ok: false, error: { code: 'validation', message: 'url is required.' } };
  if (s.length > URL_MAX) return { ok: false, error: { code: 'validation', message: 'url is too long.' } };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: { code: 'validation', message: "url isn't a valid address." } }; }
  const scheme = u.protocol.replace(/:$/, '');
  if (!URL_SCHEMES.includes(scheme)) return { ok: false, error: { code: 'denied', message: `Only http(s) pages can be opened, not ${scheme}:.` } };
  if (u.username || u.password) return { ok: false, error: { code: 'denied', message: "url can't carry a user name or password." } };
  const host = asciiLower(u.hostname);
  if (!HOST_RE.test(host)) return { ok: false, error: { code: 'validation', message: "url isn't a valid address." } };
  const p = oneOf(URL_POLICIES, policy, 'own');
  if (p === 'own') {
    if (scheme !== 'https') return { ok: false, error: { code: 'denied', message: 'Only https pages can be opened.' } };
    if (u.port && u.port !== '443') return { ok: false, error: { code: 'denied', message: "url can't name a port." } };
    if (!ownDomain(host, OWN_DOMAINS)) return { ok: false, error: { code: 'denied', message: `The phone only opens Brett's own sites (${OWN_DOMAINS.join(', ')}), not "${host}".` } };
  } else if (p === 'allowlist' && !ownDomain(host, [...OWN_DOMAINS, ...list(allowlist).map((h) => asciiLower(str(h, 253)))])) {
    return { ok: false, error: { code: 'denied', message: `"${host}" is not on the phone's allowlist.` } };
  }
  return { ok: true, url: u.toString(), host, policy: p };
}

/** True when `host` is one of `domains` or a subdomain of one. */
export function ownDomain(host, domains = OWN_DOMAINS) {
  const h = asciiLower(str(host, 253));
  if (!h || h.endsWith('.')) return false;
  return list(domains).some((d) => d && (h === d || h.endsWith(`.${d}`)));
}

// ------------------------------------------------------------------ results

const fail = (code, message) => ({ ok: false, error: { code: ERROR_CODES.includes(code) ? code : 'unexpected', message: str(message, TEXT_MAX), retryable: RETRYABLE.includes(code) } });

/** A phone-result@1 from the phone's AXPP `result` / `error` envelope answering `command`. */
export function fromWire(envelope, command, at) {
  const e = obj(envelope); const c = normCommand(command, at); const p = obj(e.payload);
  const base = { $axf: RESULT_FRAME, id: c.id, tool: c.tool, deviceId: c.deviceId, at: iso(at) };
  if (e.protocol !== HUB.protocol || (e.correlationId && e.correlationId !== c.id)) return { ...base, ok: false, error: fail('unexpected', 'The phone sent something unexpected.').error };
  if (e.kind === 'result') return { ...base, ok: true, data: isObj(p.data) ? p.data : {}, state: isObj(p.state) ? p.state : {}, ...(c.alias ? { deprecated: `${c.alias} is deprecated: use ${c.tool}` } : {}) };
  if (e.kind === 'error') { const code = ERROR_CODES.includes(p.code) ? p.code : 'unexpected'; return { ...base, ok: false, error: { code, message: str(p.message, TEXT_MAX) || 'The phone could not do that.', retryable: RETRYABLE.includes(code) } }; }
  return { ...base, ok: false, error: fail('unexpected', 'The phone sent something unexpected.').error };
}

/** A phone-result@1 for a command that never reached the phone (the dispatch error). */
export function resultFor(command, error, at) {
  const c = normCommand(command, at);
  return { $axf: RESULT_FRAME, id: c.id, tool: c.tool, deviceId: c.deviceId, at: iso(at), ok: false, error: { code: ERROR_CODES.includes(obj(error).code) ? error.code : 'unexpected', message: str(obj(error).message, TEXT_MAX), retryable: RETRYABLE.includes(obj(error).code) } };
}

/** Errors in a result record (empty = valid). */
export function resultErrors(r, path = 'result') {
  const out = []; const x = obj(r);
  if (x.$axf !== RESULT_FRAME) out.push(`${path}.$axf is ${RESULT_FRAME}`);
  if (!UUID_RE.test(String(x.id || ''))) out.push(`${path}.id is the command's uuid`);
  if (x.tool !== '' && !TOOLS.includes(x.tool)) out.push(`${path}.tool is one of ${TOOLS.join(', ')}`);
  if (!iso(x.at)) out.push(`${path}.at is an ISO date-time`);
  if (typeof x.ok !== 'boolean') out.push(`${path}.ok is true or false`);
  if (x.ok === true) { if (x.data !== undefined && !isObj(x.data)) out.push(`${path}.data is an object`); if (x.error !== undefined) out.push(`${path}.error is absent when ok`); }
  if (x.ok === false) {
    const e = obj(x.error);
    if (!isObj(x.error)) out.push(`${path}.error is required when not ok`);
    else { if (!ERROR_CODES.includes(e.code)) out.push(`${path}.error.code is one of ${ERROR_CODES.join(', ')}`); if (!e.message) out.push(`${path}.error.message says what went wrong in plain words`); if (typeof e.retryable !== 'boolean') out.push(`${path}.error.retryable is true or false`); }
  }
  return out;
}

// ------------------------------------------------------------------ migration from AmberX

/**
 * The phone-connect device for an AmberX device record (the `amberx` service's hello: deviceId, name, app amberx-droid,
 * capabilities recorder@1 / open-url@1, state). Keeps the id (the APK keeps it in its prefs), marks where it came from and
 * leaves it paired when it was: the same phone, the same session, nothing to pair again.
 */
export function deviceFromAmberx(record, { at, owner = '' }) {
  const r = obj(record);
  const stateWord = typeof r.state === 'string' ? r.state : '';
  const wasPaired = stateWord === 'paired' || (!stateWord && !!iso(r.lastSeenAt));
  return normDevice({
    deviceId: r.deviceId, name: r.name, app: APP, appVersion: str(r.appVersion, 40), platform: 'android', capabilities: list(r.capabilities), capabilityState: obj(r.state && isObj(r.state) ? r.state : r.capabilityState),
    state: wasPaired ? 'paired' : 'unpaired', owner: owner || str(r.owner, NAME_MAX), pairedAt: wasPaired ? iso(r.pairedAt) || iso(r.lastSeenAt) || iso(at) : '', lastSeenAt: iso(r.lastSeenAt), updatedAt: iso(at),
    migratedFrom: { deviceId: str(r.deviceId, 64), app: LEGACY_APP, at: iso(at) },
  }, at);
}

/** The alias table as a list for the deprecation note and the console's Settings page. */
export function aliasTable() {
  return Object.entries(ALIASES).map(([from, to]) => ({ from, to, wire: WIRE_TOOLS[to], policy: TOOL_POLICY[to], until: 'one release after phone-connect ships; then the old name answers not_found' }));
}

// ------------------------------------------------------------------ registry + schemas

export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, device: DEVICE_FRAME, pairing: PAIRING_FRAME, command: COMMAND_FRAME, result: RESULT_FRAME,
  app: APP, legacyApp: LEGACY_APP, platforms: PLATFORMS, capabilities: CAPABILITIES, pairingStates: PAIRING_STATES, pairingEvents: PAIRING_EVENTS, transitions: TRANSITIONS,
  tools: TOOLS, wireTools: WIRE_TOOLS, toolCapability: TOOL_CAPABILITY, policies: POLICIES, toolPolicy: TOOL_POLICY, neverAuto: NEVER_AUTO, notInAll: NOT_IN_ALL, readOnly: READ_ONLY, aliases: ALIASES, vias: VIAS,
  urlPolicies: URL_POLICIES, ownDomains: OWN_DOMAINS, urlSchemes: URL_SCHEMES, openWhere: OPEN_WHERE, browsers: BROWSERS, notifyChannels: NOTIFY_CHANNELS, notifyPriorities: NOTIFY_PRIORITIES,
  errorCodes: ERROR_CODES, retryable: RETRYABLE, hub: HUB,
  deviceIdPattern: DEVICE_ID_PATTERN, deviceIdPrefix: DEVICE_ID_PREFIX, pairingCodePattern: PAIRING_CODE_PATTERN, uuidPattern: UUID_PATTERN,
  nameMax: NAME_MAX, textMax: TEXT_MAX, titleMax: TITLE_MAX, urlMax: URL_MAX, sessionNameMax: SESSION_NAME_MAX, capabilitiesMax: CAPABILITIES_MAX,
});

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (n) => `https://amberx.ai/axf/schemas/${n}`;
const dateTime = { type: 'string', format: 'date-time' };
const dateTimeOrEmpty = { type: 'string', description: 'ISO date-time or empty' };
const text = (max) => ({ type: 'string', maxLength: max });

/** Per-tool argument schemas (the same the MCP tools, REST and CLI publish). */
export function argumentSchemas() {
  return {
    'phone.open_url': { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', minLength: 1, maxLength: URL_MAX, description: 'http(s) page; what is allowed follows the owner\'s url policy (own / allowlist / any)' }, where: { enum: OPEN_WHERE, description: 'overlay (default: the always-on toolbar expands into its browser) or the phone\'s browser' }, browser: { enum: BROWSERS } } },
    'phone.notify': { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: TITLE_MAX }, body: text(TEXT_MAX), url: { type: 'string', maxLength: URL_MAX, description: 'opened on tap when the url policy allows it' }, channel: { enum: NOTIFY_CHANNELS }, priority: { enum: NOTIFY_PRIORITIES } } },
    'phone.approvals_watch': { type: 'object', additionalProperties: false, required: ['on'], properties: { on: { type: 'boolean', description: 'the phone watches the hub approvals feed and rings once per new approval' }, ring: { type: 'boolean' } } },
    'phone.recorder_start': { type: 'object', additionalProperties: false, required: ['session_name'], properties: { session_name: { type: 'string', minLength: 1, maxLength: SESSION_NAME_MAX }, group: text(SESSION_NAME_MAX), note: text(TEXT_MAX), mic: { type: 'boolean', description: 'record the mic as a second track too (the approval then reads Playback + MIC)' } } },
    'phone.recorder_stop': { type: 'object', additionalProperties: false, properties: {} },
    'phone.recorder_status': { type: 'object', additionalProperties: false, properties: {} },
  };
}

export function jsonSchemas() {
  const wireError = { type: 'object', required: ['code', 'message', 'retryable'], properties: { code: { enum: ERROR_CODES }, message: { type: 'string', minLength: 1, maxLength: TEXT_MAX }, retryable: { type: 'boolean' } } };
  const args = argumentSchemas();
  return {
    'phone-device.schema.json': {
      $schema, $id: $id('phone-device.schema.json'), title: `${DEVICE_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false,
      required: ['$axf', 'deviceId', 'name', 'app', 'platform', 'capabilities', 'state'],
      properties: {
        $axf: { const: DEVICE_FRAME }, deviceId: { type: 'string', pattern: DEVICE_ID_PATTERN, description: 'kept by the app in its prefs; phone-<16 hex> for new phones, amberx-<16 hex> for a migrated one' },
        name: text(NAME_MAX), app: { enum: [APP, LEGACY_APP] }, appVersion: text(40), platform: { enum: PLATFORMS },
        capabilities: { type: 'array', maxItems: CAPABILITIES_MAX, uniqueItems: true, items: { enum: CAPABILITIES } },
        state: { enum: PAIRING_STATES, description: 'unpaired → pending → paired → revoked' }, owner: text(NAME_MAX),
        pairedAt: dateTimeOrEmpty, lastSeenAt: dateTimeOrEmpty, revokedAt: dateTimeOrEmpty, updatedAt: dateTimeOrEmpty,
        capabilityState: { type: 'object', additionalProperties: { type: 'object' }, description: 'what each capability last reported (recorder@1: running, since, session, parts, queue, mic)' },
        migratedFrom: { type: 'object', required: ['deviceId', 'app', 'at'], properties: { deviceId: { type: 'string' }, app: { const: LEGACY_APP }, at: dateTime } },
        note: text(TEXT_MAX),
      },
    },
    'phone-pairing.schema.json': {
      $schema, $id: $id('phone-pairing.schema.json'), title: `${PAIRING_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false,
      required: ['$axf', 'code', 'state', 'issuedAt', 'expiresAt', 'by'],
      properties: {
        $axf: { const: PAIRING_FRAME }, code: { type: 'string', pattern: PAIRING_CODE_PATTERN }, state: { enum: ['pending', 'paired', 'unpaired'] },
        issuedAt: dateTime, expiresAt: { ...dateTime, description: `issuedAt + ${HUB.pairingTtlMinutes} min` }, by: { type: 'string', minLength: 1, maxLength: NAME_MAX },
        deviceId: { type: 'string', pattern: `(${DEVICE_ID_PATTERN})|^$` }, endedAt: dateTimeOrEmpty, ended: { enum: ['', 'confirm', 'expire', 'cancel'] },
      },
    },
    'phone-command.schema.json': {
      $schema, $id: $id('phone-command.schema.json'), title: `${COMMAND_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false,
      required: ['$axf', 'id', 'at', 'deviceId', 'tool', 'arguments', 'policy', 'from'],
      properties: {
        $axf: { const: COMMAND_FRAME }, id: { type: 'string', pattern: UUID_PATTERN }, at: dateTime, deviceId: { type: 'string', pattern: DEVICE_ID_PATTERN },
        tool: { enum: TOOLS }, alias: { enum: Object.keys(ALIASES), description: 'the deprecated amberx.* name the caller used' },
        arguments: { type: 'object', description: 'per tool; see the argument schemas' }, policy: { enum: POLICIES },
        from: { type: 'object', required: ['who', 'via'], properties: { who: { type: 'string', minLength: 1, maxLength: NAME_MAX }, via: { enum: VIAS } } },
        correlationId: text(80), approvalId: { type: 'string', maxLength: 64, description: 'the axHub approval that let a confirm command run' },
      },
      allOf: TOOLS.map((t) => ({ if: { properties: { tool: { const: t } } }, then: { properties: { arguments: args[t], policy: { const: TOOL_POLICY[t] } } } })),
    },
    'phone-result.schema.json': {
      $schema, $id: $id('phone-result.schema.json'), title: `${RESULT_FRAME} (${SCHEMA})`, type: 'object', additionalProperties: false,
      required: ['$axf', 'id', 'tool', 'deviceId', 'at', 'ok'],
      properties: {
        $axf: { const: RESULT_FRAME }, id: { type: 'string', pattern: UUID_PATTERN }, tool: { enum: [...TOOLS, ''] }, deviceId: { type: 'string' }, at: dateTime, ok: { type: 'boolean' },
        data: { type: 'object' }, state: { type: 'object' }, error: wireError, deprecated: { type: 'string' },
      },
    },
  };
}
