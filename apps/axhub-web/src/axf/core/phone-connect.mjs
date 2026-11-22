/**
 * phone-connect@1 — the phone as a paired device: one small Android companion (approvals, watch, open pages,
 * notifications, output recorder, one voice line) and the console plugin that owns it. Brett, Nov 17 2026: "What's up
 * with the new phone connection? You gonna build it or what?" Contract: framework/spec/PHONE-CONNECT.md.
 *
 * Pure and dependency-free (no DOM, no Node APIs) so the plugin's server (Python port, read from the snapshot
 * framework/schemas/phone-connect.json), the console's web side, the hub's relay and the Kotlin twin (deferred,
 * PORTING.md) give the same answers. `axf schemas` writes the snapshot and the four JSON Schemas (phone-device,
 * phone-pairing, phone-command, phone-result) from REGISTRY below; framework/spec/check-phone-connect.mjs keeps them
 * in step and replays framework/spec/fixtures/phone-connect.json.
 *
 * Records: phone-device@1 (one phone), phone-pairing@1 (a one-time code that becomes a device token), phone-command@1
 * (the envelope the console queues), phone-result@1 (ack, then result or error).
 */

import { sha256hex } from './session-schema.mjs';

export const TAG = 'phone-connect@1';

export const FRAMES = Object.freeze({
  device: 'phone-device@1',
  pairing: 'phone-pairing@1',
  command: 'phone-command@1',
  result: 'phone-result@1',
});

/** Link timings, shared by the console (server), the phone (client) and every check. Seconds unless named. */
export const HUB = Object.freeze({
  onlineSeconds: 45, // paired and polled within this = online
  pairingSeconds: 600, // a pairing code lives 10 minutes
  pollWaitSeconds: 25, // long poll `next` holds this long (204 = nothing)
  ackSeconds: 20, // a command not acked within this is `timeout` (retryable)
  backoffSeconds: [5, 15, 30, 60], // the phone's retry ladder on failures
  replyBytes: 262144, // replies are capped at 256 KB; redirects are never followed
  codeLength: 8,
  tokenPrefixChars: 8, // the console keeps the first 8 characters of a token as its prefix (+ the SHA-256 hash)
});

export const PATTERNS = Object.freeze({
  deviceId: '^[A-Za-z0-9_-]{8,64}$',
  code: '^[A-HJ-NP-Z2-9]{8}$', // no 0 / O / 1 / I
  token: '^tok_[A-Za-z0-9_-]{32}$',
  tokenPrefix: '^tok_[A-Za-z0-9_-]{4}$',
  sha256: '^[0-9a-f]{64}$',
  uuid: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  iso: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,6})?)?(Z|[+-]\\d{2}:\\d{2})$',
  host: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\\d{1,5})?$',
  capability: '^[a-z][a-z0-9-]*@[0-9]+$',
});

/** What a companion build may do; a command is never sent to a phone that lacks its capability. Open: a later app build adds one here. */
export const CAPABILITIES = Object.freeze(['open-url@1', 'notify@1', 'approvals@1', 'recorder@1', 'voice@1']);

export const DEVICE_STATES = Object.freeze(['unpaired', 'pending', 'paired', 'revoked']);
export const PAIRING_STATES = Object.freeze(['pending', 'claimed', 'expired', 'cancelled']);
export const PLATFORMS = Object.freeze(['android']);
export const APPS = Object.freeze(['phone-connect-droid', 'amberx-droid']); // amberx-droid only on a migrated record not yet updated
export const URL_MODES = Object.freeze(['own', 'allowlist', 'any']);
export const FROM_KINDS = Object.freeze(['person', 'session', 'agent', 'service']);
export const VIAS = Object.freeze(['console', 'mcp', 'cli', 'voice', 'hub']);
export const POLICIES = Object.freeze(['allow', 'confirm']);
export const STAGES = Object.freeze(['ack', 'done']);
export const ACK_STATUSES = Object.freeze(['queued', 'shown', 'running']);
export const BY_KINDS = Object.freeze(['device', 'person']);
export const AUTH_KINDS = Object.freeze(['device', 'person', 'session', 'agent', 'service', 'none']);
export const APPROVAL_ACTIONS = Object.freeze(['approve', 'deny', 'shelve']);
export const NEVER_AUTO = Object.freeze(['recorder.start', 'vps.run']); // never auto-approved by the phone's own rules
export const NOT_IN_ALL = Object.freeze(['vps.run']); // "approve all" never covers these

export const LIMITS = Object.freeze({
  name: 80, url: 2000, title: 120, body: 600, summary: 600, text: 600, session: 120, group: 120, note: 600,
  tool: 120, allowlist: 64, who: 160, listenMin: 1, listenMax: 30, listenDefault: 10, ttlMax: 3600,
});

/** Every command: argument shapes, policy (fixed per command), the capability it needs, the AXPP tool on the wire, the default ttl (seconds). */
export const COMMANDS = Object.freeze({
  open_url: {
    label: 'Open a page on the phone', policy: 'allow', capability: 'open-url@1', wire: 'browser.open', ttl: 60,
    required: ['url'],
    arguments: { url: { type: 'url' }, where: { enum: ['overlay', 'browser'], default: 'overlay' }, browser: { enum: ['chrome', 'default'], default: 'default' } },
  },
  notify: {
    label: 'Show a notification', policy: 'allow', capability: 'notify@1', wire: 'notify.show', ttl: 60,
    required: ['kind', 'title', 'notifyId'],
    arguments: { kind: { enum: ['fyi', 'fix', 'alert'] }, title: { type: 'string', max: 'title' }, body: { type: 'string', max: 'body' }, url: { type: 'url' }, notifyId: { type: 'string', max: 'tool' }, priority: { enum: ['normal', 'high'], default: 'normal' } },
  },
  approval: {
    label: 'Show an approval prompt', policy: 'allow', capability: 'approvals@1', wire: 'approval.show', ttl: 600,
    required: ['approvalId', 'kind'],
    arguments: { approvalId: { type: 'uuid' }, kind: { enum: ['approval', 'veto'] }, tool: { type: 'string', max: 'tool' }, summary: { type: 'string', max: 'summary' }, url: { type: 'url' }, secondsLeft: { type: 'integer', min: 0, max: 86400 }, actions: { type: 'list', items: APPROVAL_ACTIONS, default: ['approve', 'deny'] } },
  },
  'recorder.start': {
    label: 'Start recording the phone\'s audio output', policy: 'confirm', capability: 'recorder@1', wire: 'recorder.start', ttl: 120,
    required: ['session'],
    arguments: { session: { type: 'string', max: 'session' }, group: { type: 'string', max: 'group' }, note: { type: 'string', max: 'note' } },
  },
  'recorder.stop': { label: 'Stop recording', policy: 'allow', capability: 'recorder@1', wire: 'recorder.stop', ttl: 30, required: [], arguments: {} },
  'recorder.status': { label: 'Read the recorder state', policy: 'allow', capability: 'recorder@1', wire: 'recorder.status', ttl: 30, required: [], arguments: {}, readOnly: true },
  voice: {
    label: 'Say a line or listen once', policy: 'allow', capability: 'voice@1', wire: { say: 'voice.say', listen: 'voice.listen' }, ttl: 20,
    required: ['mode'],
    arguments: { mode: { enum: ['say', 'listen'] }, text: { type: 'string', max: 'text' }, timeoutSeconds: { type: 'integer', min: 'listenMin', max: 'listenMax', default: 'listenDefault' } },
  },
});

/** Three things a command can never carry: a decision, a mic switch, a url outside policy. Named here so every port refuses the same keys. */
export const FORBIDDEN_ARGUMENTS = Object.freeze({ approval: ['decision', 'decide'], 'recorder.start': ['mic'] });
export const URL_SCHEMES = Object.freeze(['https:']);

/** AmberX tool names that resolve for one release (answered normally, plus `deprecated`); after that `not_found`. */
export const ALIASES = Object.freeze({
  'amberx.open_url': 'open_url', 'amberx.recorder_start': 'recorder.start', 'amberx.recorder_stop': 'recorder.stop', 'amberx.recorder_status': 'recorder.status',
  'phone.open_url': 'open_url', 'phone.notify': 'notify', 'phone.approval': 'approval', 'phone.recorder_start': 'recorder.start', 'phone.recorder_stop': 'recorder.stop', 'phone.recorder_status': 'recorder.status', 'phone.voice': 'voice',
});
export const DEPRECATED_PREFIX = 'amberx.';

/**
 * Wire error codes: INTEROP.md's plus five phone-connect@1 adds. Frozen: a code never changes meaning (the check script
 * fails on a change). `retryable` is what the phone and every caller do about it. Unknown codes read as `unexpected`.
 */
export const ERROR_CODES = Object.freeze({
  invalid: { retryable: false, doc: 'the request is malformed (bad JSON, missing envelope)' },
  denied: { retryable: false, doc: 'refused: a session claiming a code, a decision from anything but Brett\'s tap, a url outside the device\'s policy or scheme' },
  not_found: { retryable: false, doc: 'unknown command, device or capability ("install the current app")' },
  unavailable: { retryable: true, doc: 'the console or the hub relay cannot answer right now' },
  validation: { retryable: false, doc: 'an envelope field is wrong (shape, length, enum, fixed policy)' },
  unexpected: { retryable: false, doc: 'an unknown failure; also what an unknown code reads as' },
  timeout: { retryable: true, doc: 'not acked within 20 s, not answered within its ttl, or a ttl already passed' },
  confirmation_required: { retryable: false, doc: 'a confirm command (recorder.start) with no approvalId' },
  offline: { retryable: true, doc: 'the phone is paired but has not polled within 45 s' },
  unpaired: { retryable: false, doc: 'no phone is paired (or this device is not)' },
  revoked: { retryable: false, doc: 'the owner revoked this phone; its token is dead' },
  consent_required: { retryable: true, doc: 'the phone needs its own yes first (Android\'s capture prompt on a recorder start)' },
  expired: { retryable: false, doc: 'the pairing code is past its 10 minutes' },
});

/** Where the records live in data-store@1 (namespace `phone`, the plugin's data folder `phone-connect` maps there). */
export const DATA = Object.freeze({
  namespace: 'phone', pluginFolder: 'phone-connect',
  keys: { device: 'phone/devices/<deviceId>.json', pairing: 'phone/pairings/<code>.json', command: 'phone/commands/<id>.json', log: 'phone/log' },
});

/** The link the phone keeps: one origin, the device token, the loop. Carried over from AmberX's AXPP with the credential changed. */
export const LINK = Object.freeze({
  protocol: 'axpp@1', header: 'X-AXPP', auth: 'Bearer', scheme: 'https:',
  calls: ['hello', 'next', 'ack', 'answer', 'rotate'],
  noContent: 204, restarted: 404,
});

export const DEVICE_REQUIRED = Object.freeze(['$axf', 'deviceId', 'name', 'app', 'appVersion', 'platform', 'capabilities', 'state', 'owner', 'token', 'watch', 'urlPolicy', 'pairedAt', 'lastSeenAt', 'revokedAt', 'updatedAt', 'capabilityState']);
export const DEVICE_OPTIONAL = Object.freeze(['migratedFrom']);
export const PAIRING_REQUIRED = Object.freeze(['$axf', 'code', 'issuedAt', 'expiresAt', 'issuedBy', 'state', 'deviceId', 'claimedAt', 'claimedBy', 'ended', 'endedAt']);
export const COMMAND_REQUIRED = Object.freeze(['$axf', 'id', 'at', 'deviceId', 'command', 'arguments', 'policy', 'ttl', 'from', 'correlationId', 'approvalId']);
export const RESULT_REQUIRED = Object.freeze(['$axf', 'id', 'deviceId', 'command', 'at', 'stage', 'ok']);
export const RESULT_OPTIONAL = Object.freeze(['status', 'data', 'error', 'by', 'state', 'deprecated']);

/** The registry snapshot `axf schemas` writes to framework/schemas/phone-connect.json (what the Python port reads). */
export const REGISTRY = Object.freeze({
  $id: 'axf/phone-connect', tag: TAG, frames: FRAMES, hub: HUB, patterns: PATTERNS, capabilities: CAPABILITIES,
  deviceStates: DEVICE_STATES, pairingStates: PAIRING_STATES, platforms: PLATFORMS, apps: APPS, urlModes: URL_MODES,
  fromKinds: FROM_KINDS, vias: VIAS, policies: POLICIES, stages: STAGES, ackStatuses: ACK_STATUSES, byKinds: BY_KINDS,
  authKinds: AUTH_KINDS, approvalActions: APPROVAL_ACTIONS, neverAuto: NEVER_AUTO, notInAll: NOT_IN_ALL, limits: LIMITS,
  commands: COMMANDS, forbiddenArguments: FORBIDDEN_ARGUMENTS, urlSchemes: URL_SCHEMES, aliases: ALIASES, deprecatedPrefix: DEPRECATED_PREFIX,
  errors: ERROR_CODES, data: DATA, link: LINK,
  required: { device: DEVICE_REQUIRED, pairing: PAIRING_REQUIRED, command: COMMAND_REQUIRED, result: RESULT_REQUIRED },
  optional: { device: DEVICE_OPTIONAL, result: RESULT_OPTIONAL },
});

/* ------------------------------------------------------------------ */
/* JSON Schemas (generated into framework/schemas/json by `axf schemas`) */
/* ------------------------------------------------------------------ */

const lim = (v) => (typeof v === 'number' ? v : LIMITS[v]);

/** One argument's JSON Schema from the COMMANDS table. */
function argumentSchema(a) {
  if (a.enum) return { enum: [...a.enum], ...(a.default !== undefined ? { default: a.default } : {}) };
  if (a.type === 'url') return { type: 'string', minLength: 1, maxLength: LIMITS.url, pattern: '^https://' };
  if (a.type === 'uuid') return { type: 'string', pattern: PATTERNS.uuid };
  if (a.type === 'string') return { type: 'string', maxLength: lim(a.max) };
  if (a.type === 'integer') return { type: 'integer', minimum: lim(a.min), maximum: lim(a.max), ...(a.default !== undefined ? { default: lim(a.default) } : {}) };
  if (a.type === 'list') return { type: 'array', items: { enum: [...a.items] }, uniqueItems: true, ...(a.default ? { default: [...a.default] } : {}) };
  return {};
}

/** The `arguments` object schema for one command: its fields, required ones, nothing else (the forbidden keys included). */
export function argumentsSchema(command) {
  const c = COMMANDS[command];
  return { type: 'object', required: [...c.required], properties: Object.fromEntries(Object.entries(c.arguments).map(([k, a]) => [k, argumentSchema(a)])), additionalProperties: false };
}

export function jsonSchemas() {
  const $schema = 'https://json-schema.org/draft/2020-12/schema';
  const ts = { type: 'string', format: 'date-time', pattern: PATTERNS.iso };
  const tsOrBlank = { anyOf: [ts, { const: '' }] };
  const deviceId = { type: 'string', pattern: PATTERNS.deviceId };
  const uuid = { type: 'string', pattern: PATTERNS.uuid };
  const who = { type: 'string', maxLength: LIMITS.who };
  const actor = (kinds) => ({ type: 'object', required: ['kind', 'who'], properties: { kind: { enum: [...kinds] }, who, via: { enum: [...VIAS] } } });
  const errorObject = {
    type: 'object', required: ['code', 'message', 'retryable'],
    properties: { code: { enum: Object.keys(ERROR_CODES) }, message: { type: 'string', minLength: 1 }, retryable: { type: 'boolean' }, detail: { type: 'object' } },
    allOf: Object.entries(ERROR_CODES).map(([code, e]) => ({ if: { properties: { code: { const: code } } }, then: { properties: { retryable: { const: e.retryable } } } })),
  };
  const commandNames = Object.keys(COMMANDS);
  return {
    'phone-device.schema.json': {
      $schema, $id: 'axf/phone-device.schema.json', title: `AmberX AXF paired phone (${FRAMES.device})`,
      description: 'Generated from framework/core/phone-connect.mjs. One phone the console knows: its app, capabilities, pairing state, token at rest (never the token), watch and url policy.',
      type: 'object', required: [...DEVICE_REQUIRED],
      properties: {
        $axf: { const: FRAMES.device }, deviceId, name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
        app: { enum: [...APPS] }, appVersion: { type: 'string' }, platform: { enum: [...PLATFORMS] },
        capabilities: { type: 'array', items: { enum: [...CAPABILITIES] }, uniqueItems: true },
        state: { enum: [...DEVICE_STATES] },
        owner: { anyOf: [{ const: '' }, { type: 'object', required: ['kind', 'who'], properties: { kind: { const: 'person' }, who }, additionalProperties: false }] },
        token: { anyOf: [{ const: null }, { type: 'object', required: ['prefix', 'hash', 'issuedAt', 'rotatedAt'], properties: { prefix: { type: 'string', pattern: PATTERNS.tokenPrefix }, hash: { type: 'string', pattern: PATTERNS.sha256 }, issuedAt: ts, rotatedAt: tsOrBlank }, additionalProperties: false }] },
        watch: { type: 'object', required: ['on', 'ring'], properties: { on: { type: 'boolean' }, ring: { type: 'boolean' } } },
        urlPolicy: { type: 'object', required: ['mode', 'allowlist'], properties: { mode: { enum: [...URL_MODES] }, allowlist: { type: 'array', items: { type: 'string', pattern: PATTERNS.host }, maxItems: LIMITS.allowlist } } },
        pairedAt: tsOrBlank, lastSeenAt: tsOrBlank, revokedAt: tsOrBlank, updatedAt: tsOrBlank,
        capabilityState: { type: 'object', propertyNames: { pattern: PATTERNS.capability }, additionalProperties: { type: 'object' } },
        migratedFrom: { type: 'object', required: ['deviceId', 'app', 'at'], properties: { deviceId, app: { type: 'string' }, at: ts } },
      },
      allOf: [{ if: { properties: { state: { const: 'paired' } } }, then: { properties: { owner: { type: 'object' } } } }],
    },
    'phone-pairing.schema.json': {
      $schema, $id: 'axf/phone-pairing.schema.json', title: `AmberX AXF pairing code (${FRAMES.pairing})`,
      description: 'Generated from framework/core/phone-connect.mjs. A one-time code the console shows; claimed by a person on the phone it becomes a device token.',
      type: 'object', required: [...PAIRING_REQUIRED],
      properties: {
        $axf: { const: FRAMES.pairing }, code: { type: 'string', pattern: PATTERNS.code }, issuedAt: ts, expiresAt: ts,
        issuedBy: actor(FROM_KINDS), state: { enum: [...PAIRING_STATES] },
        deviceId: { anyOf: [deviceId, { const: '' }] }, claimedAt: tsOrBlank,
        claimedBy: { anyOf: [{ const: null }, { type: 'object', required: ['kind', 'who'], properties: { kind: { const: 'person' }, who }, additionalProperties: false }] },
        ended: { enum: ['', 'claimed', 'expired', 'cancelled'] }, endedAt: tsOrBlank,
      },
      allOf: [
        ...PAIRING_STATES.map((s) => ({ if: { properties: { state: { const: s } } }, then: { properties: { ended: { const: s === 'pending' ? '' : s } } } })),
        { if: { properties: { state: { const: 'claimed' } } }, then: { properties: { claimedBy: { type: 'object' }, deviceId, claimedAt: ts } } },
      ],
    },
    'phone-command.schema.json': {
      $schema, $id: 'axf/phone-command.schema.json', title: `AmberX AXF phone command envelope (${FRAMES.command})`,
      description: 'Generated from framework/core/phone-connect.mjs. One command the console queues for a phone; policy is fixed per command and the arguments are exactly that command\'s.',
      type: 'object', required: [...COMMAND_REQUIRED],
      properties: {
        $axf: { const: FRAMES.command }, id: uuid, at: ts, deviceId, command: { enum: commandNames },
        arguments: { type: 'object' }, policy: { enum: [...POLICIES] }, ttl: { type: 'integer', minimum: 1, maximum: LIMITS.ttlMax },
        from: actor(FROM_KINDS), correlationId: { type: 'string', maxLength: LIMITS.who }, approvalId: { anyOf: [uuid, { const: '' }] },
      },
      allOf: commandNames.map((name) => ({ if: { properties: { command: { const: name } } }, then: { properties: { arguments: argumentsSchema(name), policy: { const: COMMANDS[name].policy } } } })),
    },
    'phone-result.schema.json': {
      $schema, $id: 'axf/phone-result.schema.json', title: `AmberX AXF phone ack / result (${FRAMES.result})`,
      description: 'Generated from framework/core/phone-connect.mjs. The phone\'s ack (it took the command) and then its result or error; by.kind says whether the app answered or Brett tapped.',
      type: 'object', required: [...RESULT_REQUIRED],
      properties: {
        $axf: { const: FRAMES.result }, id: uuid, deviceId, command: { enum: commandNames }, at: ts, stage: { enum: [...STAGES] }, ok: { type: 'boolean' },
        status: { enum: [...ACK_STATUSES] }, data: { type: 'object' }, error: errorObject,
        by: { type: 'object', required: ['kind'], properties: { kind: { enum: [...BY_KINDS] }, tap: uuid }, allOf: [{ if: { properties: { kind: { const: 'person' } } }, then: { required: ['tap'] } }] },
        state: { type: 'object', propertyNames: { pattern: PATTERNS.capability }, additionalProperties: { type: 'object' } },
        deprecated: { type: 'string' },
      },
      allOf: [
        { if: { properties: { stage: { const: 'done' }, ok: { const: false } } }, then: { required: ['error'] } },
        { if: { properties: { stage: { const: 'ack' } } }, then: { required: ['status'], properties: { ok: { const: true }, state: false } } },
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Engine: validation                                                   */
/* ------------------------------------------------------------------ */


const RE = Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, new RegExp(v)]));
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const err = (field, code, message) => ({ field, code, message });
export const isTimestamp = (v) => typeof v === 'string' && RE.iso.test(v) && !Number.isNaN(Date.parse(v));
export const isUuid = (v) => typeof v === 'string' && RE.uuid.test(v);
export const isDeviceId = (v) => typeof v === 'string' && RE.deviceId.test(v);
export const isCode = (v) => typeof v === 'string' && RE.code.test(v);
export const isToken = (v) => typeof v === 'string' && RE.token.test(v);
const ms = (v) => Date.parse(v);

const checkTs = (out, o, f, { required = true, orBlank = true } = {}) => {
  const v = o[f];
  if (v === undefined || v === null) { if (required) out.push(err(f, 'missing', `${f} is missing — an ISO timestamp${orBlank ? ' or ""' : ''}`)); return; }
  if (typeof v !== 'string' || (v === '' ? !orBlank : !isTimestamp(v))) out.push(err(f, 'invalid', `${f} "${v}" is not an ISO timestamp${orBlank ? ' or ""' : ''}`));
};
const checkEnum = (out, o, f, list, { required = true } = {}) => {
  if (o[f] === undefined) { if (required) out.push(err(f, 'missing', `${f} is missing — one of ${list.join(', ')}`)); return; }
  if (!list.includes(o[f])) out.push(err(f, 'invalid', `${f} "${o[f]}" is not one of ${list.join(', ')}`));
};
const checkActor = (out, o, f, kinds, { required = true, personOnly = false } = {}) => {
  const a = o[f];
  if (a === undefined || a === null) { if (required) out.push(err(f, 'missing', `${f} is missing — { kind, who }`)); return; }
  if (!isObj(a)) { out.push(err(f, 'invalid', `${f} must be { kind, who }`)); return; }
  if (personOnly ? a.kind !== 'person' : !kinds.includes(a.kind)) out.push(err(`${f}.kind`, 'invalid', personOnly ? `${f}.kind must be "person"` : `${f}.kind must be one of ${kinds.join(', ')}`));
  if (typeof a.who !== 'string' || !a.who.trim() || a.who.length > LIMITS.who) out.push(err(`${f}.who`, blank(a.who) ? 'missing' : 'invalid', `${f}.who is missing or too long`));
  if (a.via !== undefined && !VIAS.includes(a.via)) out.push(err(`${f}.via`, 'invalid', `${f}.via must be one of ${VIAS.join(', ')}`));
};

/** phone-device@1 record check. Returns { ok, errors: [{ field, code: missing|invalid, message }] }. */
export function validateDevice(d) {
  if (!isObj(d)) return { ok: false, errors: [err('device', 'invalid', 'the device must be a JSON object')] };
  const out = [];
  if (d.$axf !== FRAMES.device) out.push(err('$axf', d.$axf === undefined ? 'missing' : 'invalid', `$axf must be "${FRAMES.device}"`));
  if (blank(d.deviceId)) out.push(err('deviceId', 'missing', 'deviceId is missing'));
  else if (!isDeviceId(d.deviceId)) out.push(err('deviceId', 'invalid', `deviceId must match ${PATTERNS.deviceId}`));
  if (blank(d.name)) out.push(err('name', 'missing', 'name is missing (manufacturer + model)'));
  else if (typeof d.name !== 'string' || d.name.length > LIMITS.name) out.push(err('name', 'invalid', `name is longer than ${LIMITS.name}`));
  checkEnum(out, d, 'app', APPS);
  if (typeof d.appVersion !== 'string') out.push(err('appVersion', 'missing', 'appVersion is missing (a string, "" if unknown)'));
  checkEnum(out, d, 'platform', PLATFORMS);
  if (!Array.isArray(d.capabilities)) out.push(err('capabilities', 'missing', `capabilities must be a list from ${CAPABILITIES.join(', ')}`));
  else if (d.capabilities.some((c) => !CAPABILITIES.includes(c)) || new Set(d.capabilities).size !== d.capabilities.length) out.push(err('capabilities', 'invalid', `capabilities must be distinct entries of ${CAPABILITIES.join(', ')}`));
  checkEnum(out, d, 'state', DEVICE_STATES);
  if (d.owner === undefined) out.push(err('owner', 'missing', 'owner is missing ("" until paired)'));
  else if (d.owner !== '') checkActor(out, d, 'owner', ['person'], { personOnly: true });
  if (d.state === 'paired' && (d.owner === '' || !isObj(d.owner))) out.push(err('owner', 'invalid', 'a paired device has an owner (a person)'));
  if (d.token === undefined) out.push(err('token', 'missing', 'token is missing (null until paired; the token at rest, never the token)'));
  else if (d.token !== null) {
    if (!isObj(d.token)) out.push(err('token', 'invalid', 'token must be null or { prefix, hash, issuedAt, rotatedAt }'));
    else {
      if (!RE.tokenPrefix.test(String(d.token.prefix))) out.push(err('token.prefix', 'invalid', 'token.prefix is the first 8 characters of the token'));
      if (!RE.sha256.test(String(d.token.hash))) out.push(err('token.hash', 'invalid', 'token.hash is the SHA-256 hex of the token'));
      if (isToken(d.token.hash) || isToken(d.token.prefix)) out.push(err('token', 'invalid', 'the token itself is never stored'));
      checkTs(out, d.token, 'issuedAt', { orBlank: false }); checkTs(out, d.token, 'rotatedAt');
    }
  }
  if (!isObj(d.watch) || typeof d.watch.on !== 'boolean' || typeof d.watch.ring !== 'boolean') out.push(err('watch', d.watch === undefined ? 'missing' : 'invalid', 'watch must be { on, ring } booleans'));
  if (!isObj(d.urlPolicy)) out.push(err('urlPolicy', d.urlPolicy === undefined ? 'missing' : 'invalid', 'urlPolicy must be { mode, allowlist }'));
  else {
    checkEnum(out, d.urlPolicy, 'mode', URL_MODES);
    if (!Array.isArray(d.urlPolicy.allowlist) || d.urlPolicy.allowlist.length > LIMITS.allowlist || d.urlPolicy.allowlist.some((h) => !RE.host.test(String(h)))) out.push(err('urlPolicy.allowlist', 'invalid', `urlPolicy.allowlist is a list of up to ${LIMITS.allowlist} host names`));
  }
  for (const f of ['pairedAt', 'lastSeenAt', 'revokedAt', 'updatedAt']) checkTs(out, d, f);
  if (!isObj(d.capabilityState)) out.push(err('capabilityState', d.capabilityState === undefined ? 'missing' : 'invalid', 'capabilityState is an object keyed by capability'));
  else for (const k of Object.keys(d.capabilityState)) if (!RE.capability.test(k) || !isObj(d.capabilityState[k])) out.push(err(`capabilityState.${k}`, 'invalid', 'capabilityState entries are objects keyed by capability'));
  if (d.migratedFrom !== undefined) {
    if (!isObj(d.migratedFrom) || !isDeviceId(d.migratedFrom.deviceId) || typeof d.migratedFrom.app !== 'string' || !isTimestamp(d.migratedFrom.at)) out.push(err('migratedFrom', 'invalid', 'migratedFrom is { deviceId, app, at }'));
  }
  return { ok: !out.length, errors: out };
}

/** phone-pairing@1 record check. */
export function validatePairing(p) {
  if (!isObj(p)) return { ok: false, errors: [err('pairing', 'invalid', 'the pairing must be a JSON object')] };
  const out = [];
  if (p.$axf !== FRAMES.pairing) out.push(err('$axf', p.$axf === undefined ? 'missing' : 'invalid', `$axf must be "${FRAMES.pairing}"`));
  if (blank(p.code)) out.push(err('code', 'missing', 'code is missing'));
  else if (!isCode(p.code)) out.push(err('code', 'invalid', `code must match ${PATTERNS.code}`));
  checkTs(out, p, 'issuedAt', { orBlank: false }); checkTs(out, p, 'expiresAt', { orBlank: false });
  if (isTimestamp(p.issuedAt) && isTimestamp(p.expiresAt) && ms(p.expiresAt) - ms(p.issuedAt) !== HUB.pairingSeconds * 1000) out.push(err('expiresAt', 'invalid', `expiresAt is issuedAt + ${HUB.pairingSeconds} s`));
  checkActor(out, p, 'issuedBy', FROM_KINDS);
  checkEnum(out, p, 'state', PAIRING_STATES);
  if (p.deviceId === undefined) out.push(err('deviceId', 'missing', 'deviceId is missing ("" until claimed)'));
  else if (p.deviceId !== '' && !isDeviceId(p.deviceId)) out.push(err('deviceId', 'invalid', `deviceId must match ${PATTERNS.deviceId}`));
  checkTs(out, p, 'claimedAt');
  if (p.claimedBy === undefined) out.push(err('claimedBy', 'missing', 'claimedBy is missing (null until claimed)'));
  else if (p.claimedBy !== null) checkActor(out, p, 'claimedBy', ['person'], { personOnly: true });
  if (p.state === 'claimed' && (p.claimedBy === null || p.deviceId === '' || p.claimedAt === '')) out.push(err('state', 'invalid', 'a claimed pairing carries claimedBy (a person), deviceId and claimedAt'));
  checkEnum(out, p, 'ended', ['', 'claimed', 'expired', 'cancelled']);
  checkTs(out, p, 'endedAt');
  if (p.state !== 'pending' && p.ended !== p.state) out.push(err('ended', 'invalid', 'ended names the end state once the pairing is over'));
  if (p.state === 'pending' && p.ended !== '') out.push(err('ended', 'invalid', 'a pending pairing has not ended'));
  return { ok: !out.length, errors: out };
}

/** Resolve a command name through ALIASES. Returns { command, deprecated } or null when unknown. */
export function resolveCommand(name) {
  if (COMMANDS[name]) return { command: name, deprecated: '' };
  const to = ALIASES[name];
  if (!to) return null;
  const deprecated = name.startsWith(DEPRECATED_PREFIX) ? `${name} is deprecated: use phone.${to.replace('.', '_')}` : '';
  return { command: to, deprecated };
}

const lenOf = (a, k) => (typeof a[k] === 'number' ? a[k] : LIMITS[a[k]]);

/** The arguments check for one command: shape, lengths, enums, required, forbidden, nothing extra. */
export function argumentErrors(command, args) {
  const c = COMMANDS[command];
  if (!c) return [err('command', 'invalid', `unknown command "${command}"`)];
  if (!isObj(args)) return [err('arguments', 'invalid', 'arguments must be an object')];
  const out = [];
  for (const k of FORBIDDEN_ARGUMENTS[command] ?? []) if (k in args) out.push(err(`arguments.${k}`, 'invalid', `${command} never carries ${k}`));
  for (const k of Object.keys(args)) if (!(k in c.arguments) && !(FORBIDDEN_ARGUMENTS[command] ?? []).includes(k)) out.push(err(`arguments.${k}`, 'invalid', `${command} does not take ${k}`));
  for (const k of c.required) if (args[k] === undefined || args[k] === null || args[k] === '') out.push(err(`arguments.${k}`, 'missing', `${command} needs ${k}`));
  for (const [k, a] of Object.entries(c.arguments)) {
    const v = args[k];
    if (v === undefined) continue;
    const f = `arguments.${k}`;
    if (a.enum) { if (!a.enum.includes(v)) out.push(err(f, 'invalid', `${f} must be one of ${a.enum.join(', ')}`)); }
    else if (a.type === 'url') { if (typeof v !== 'string' || !v || v.length > LIMITS.url) out.push(err(f, 'invalid', `${f} is a url up to ${LIMITS.url} characters`)); }
    else if (a.type === 'uuid') { if (!isUuid(v)) out.push(err(f, 'invalid', `${f} is a uuid`)); }
    else if (a.type === 'string') { if (typeof v !== 'string' || v.length > lenOf(a, 'max')) out.push(err(f, 'invalid', `${f} is a string up to ${lenOf(a, 'max')} characters`)); }
    else if (a.type === 'integer') { if (!Number.isInteger(v) || v < lenOf(a, 'min') || v > lenOf(a, 'max')) out.push(err(f, 'invalid', `${f} is a whole number ${lenOf(a, 'min')}–${lenOf(a, 'max')}`)); }
    else if (a.type === 'list') { if (!Array.isArray(v) || v.some((x) => !a.items.includes(x)) || new Set(v).size !== v.length) out.push(err(f, 'invalid', `${f} is a list from ${a.items.join(', ')}`)); }
  }
  if (command === 'voice' && args.mode === 'say' && blank(args.text)) out.push(err('arguments.text', 'missing', 'voice say needs text'));
  return out;
}

/** The default ttl for a command (seconds), from its arguments where the spec says so. */
export function ttlFor(command, args = {}) {
  const c = COMMANDS[command];
  if (!c) return 0;
  if (command === 'approval' && Number.isInteger(args.secondsLeft) && args.secondsLeft > 0) return Math.min(args.secondsLeft, LIMITS.ttlMax);
  if (command === 'voice') return Math.min((Number.isInteger(args.timeoutSeconds) ? args.timeoutSeconds : LIMITS.listenDefault) + 10, LIMITS.ttlMax);
  return c.ttl;
}

/** phone-command@1 envelope check (shape only; dispatch rules are dispatchErrors). */
export function validateCommand(c) {
  if (!isObj(c)) return { ok: false, errors: [err('command', 'invalid', 'the command must be a JSON object')] };
  const out = [];
  if (c.$axf !== FRAMES.command) out.push(err('$axf', c.$axf === undefined ? 'missing' : 'invalid', `$axf must be "${FRAMES.command}"`));
  if (blank(c.id)) out.push(err('id', 'missing', 'id is missing (a uuid)'));
  else if (!isUuid(c.id)) out.push(err('id', 'invalid', 'id must be a uuid'));
  checkTs(out, c, 'at', { orBlank: false });
  if (blank(c.deviceId)) out.push(err('deviceId', 'missing', 'deviceId is missing'));
  else if (!isDeviceId(c.deviceId)) out.push(err('deviceId', 'invalid', `deviceId must match ${PATTERNS.deviceId}`));
  const known = !!COMMANDS[c.command];
  if (blank(c.command)) out.push(err('command', 'missing', `command is missing — one of ${Object.keys(COMMANDS).join(', ')}`));
  else if (!known) out.push(err('command', 'invalid', `command "${c.command}" is not one of ${Object.keys(COMMANDS).join(', ')}`));
  if (c.arguments === undefined) out.push(err('arguments', 'missing', 'arguments is missing (an object, {} when the command takes none)'));
  else if (known) out.push(...argumentErrors(c.command, c.arguments));
  if (c.policy === undefined) out.push(err('policy', 'missing', 'policy is missing (fixed per command)'));
  else if (!POLICIES.includes(c.policy)) out.push(err('policy', 'invalid', `policy must be one of ${POLICIES.join(', ')}`));
  else if (known && c.policy !== COMMANDS[c.command].policy) out.push(err('policy', 'invalid', `${c.command} is always policy "${COMMANDS[c.command].policy}"`));
  if (c.ttl === undefined) out.push(err('ttl', 'missing', 'ttl is missing (seconds)'));
  else if (!Number.isInteger(c.ttl) || c.ttl < 1 || c.ttl > LIMITS.ttlMax) out.push(err('ttl', 'invalid', `ttl is a whole number of seconds 1–${LIMITS.ttlMax}`));
  checkActor(out, c, 'from', FROM_KINDS);
  if (typeof c.correlationId !== 'string' || c.correlationId.length > LIMITS.who) out.push(err('correlationId', c.correlationId === undefined ? 'missing' : 'invalid', 'correlationId is a string ("" when none)'));
  if (c.approvalId === undefined) out.push(err('approvalId', 'missing', 'approvalId is missing ("" when none)'));
  else if (c.approvalId !== '' && !isUuid(c.approvalId)) out.push(err('approvalId', 'invalid', 'approvalId is a uuid or ""'));
  return { ok: !out.length, errors: out };
}

/** phone-result@1 check (ack or done). */
export function validateResult(r) {
  if (!isObj(r)) return { ok: false, errors: [err('result', 'invalid', 'the result must be a JSON object')] };
  const out = [];
  if (r.$axf !== FRAMES.result) out.push(err('$axf', r.$axf === undefined ? 'missing' : 'invalid', `$axf must be "${FRAMES.result}"`));
  if (blank(r.id)) out.push(err('id', 'missing', 'id is missing (the command id)'));
  else if (!isUuid(r.id)) out.push(err('id', 'invalid', 'id must be the command\'s uuid'));
  if (blank(r.deviceId)) out.push(err('deviceId', 'missing', 'deviceId is missing'));
  else if (!isDeviceId(r.deviceId)) out.push(err('deviceId', 'invalid', `deviceId must match ${PATTERNS.deviceId}`));
  checkEnum(out, r, 'command', Object.keys(COMMANDS));
  checkTs(out, r, 'at', { orBlank: false });
  checkEnum(out, r, 'stage', STAGES);
  if (typeof r.ok !== 'boolean') out.push(err('ok', r.ok === undefined ? 'missing' : 'invalid', 'ok is a boolean'));
  if (r.stage === 'ack') {
    if (r.status === undefined) out.push(err('status', 'missing', `an ack carries status — one of ${ACK_STATUSES.join(', ')}`));
    else if (!ACK_STATUSES.includes(r.status)) out.push(err('status', 'invalid', `status must be one of ${ACK_STATUSES.join(', ')}`));
    if (r.ok === false) out.push(err('ok', 'invalid', 'an ack is never a failure (answer with stage done + error)'));
    if (r.state !== undefined) out.push(err('state', 'invalid', 'an ack never changes state'));
  }
  if (r.stage === 'done') {
    if (r.ok === false) out.push(...errorErrors(r.error, 'error'));
    if (r.ok === true && r.error !== undefined) out.push(err('error', 'invalid', 'a successful result carries no error'));
    if (r.ok === true && r.data !== undefined && !isObj(r.data)) out.push(err('data', 'invalid', 'data is an object'));
  }
  if (r.by !== undefined) {
    if (!isObj(r.by) || !BY_KINDS.includes(r.by.kind)) out.push(err('by', 'invalid', `by.kind must be one of ${BY_KINDS.join(', ')}`));
    else if (r.by.kind === 'person' && !isUuid(r.by.tap)) out.push(err('by.tap', 'invalid', 'by.tap is the tap\'s uuid when a person answered'));
  }
  if (r.state !== undefined && r.stage === 'done') {
    if (!isObj(r.state)) out.push(err('state', 'invalid', 'state is an object keyed by capability'));
    else for (const k of Object.keys(r.state)) if (!RE.capability.test(k) || !isObj(r.state[k])) out.push(err(`state.${k}`, 'invalid', 'state entries are objects keyed by capability'));
  }
  if (r.deprecated !== undefined && typeof r.deprecated !== 'string') out.push(err('deprecated', 'invalid', 'deprecated is a string'));
  return { ok: !out.length, errors: out };
}

function errorErrors(e, f) {
  if (!isObj(e)) return [err(f, e === undefined ? 'missing' : 'invalid', `${f} is { code, message, retryable }`)];
  const out = [];
  if (!ERROR_CODES[e.code]) out.push(err(`${f}.code`, 'invalid', `${f}.code must be one of ${Object.keys(ERROR_CODES).join(', ')}`));
  if (typeof e.message !== 'string' || !e.message.trim()) out.push(err(`${f}.message`, 'missing', `${f}.message says what happened in plain words`));
  if (typeof e.retryable !== 'boolean') out.push(err(`${f}.retryable`, 'missing', `${f}.retryable is a boolean`));
  else if (ERROR_CODES[e.code] && e.retryable !== ERROR_CODES[e.code].retryable) out.push(err(`${f}.retryable`, 'invalid', `${e.code} is ${ERROR_CODES[e.code].retryable ? '' : 'not '}retryable`));
  return out;
}

/** One line naming every problem, for refusals. */
export const rejection = (errors) => errors.map((e) => e.message).join('; ');

/* ------------------------------------------------------------------ */
/* Engine: wire errors, commands, routing                               */
/* ------------------------------------------------------------------ */

/** A wire error. Unknown codes read as `unexpected`; `retryable` always follows the code. */
export function wireError(code, message, detail) {
  const c = ERROR_CODES[code] ? code : 'unexpected';
  return { code: c, message: message || ERROR_CODES[c].doc, retryable: ERROR_CODES[c].retryable, ...(detail ? { detail } : {}) };
}

/**
 * Make a phone-command@1 envelope: resolves aliases, fills policy and ttl, validates. Returns
 * { ok: true, command, deprecated } or { ok: false, error } (`not_found` for an unknown name, `validation` otherwise).
 */
export function makeCommand({ command, arguments: args = {}, deviceId, from, id, at, approvalId = '', correlationId = '', ttl } = {}) {
  const r = resolveCommand(String(command ?? ''));
  if (!r) return { ok: false, error: wireError('not_found', `unknown command "${command}"`, { command }) };
  const c = COMMANDS[r.command];
  const filled = {};
  for (const [k, a] of Object.entries(c.arguments)) if (a.default !== undefined && (args ?? {})[k] === undefined) filled[k] = Array.isArray(a.default) ? [...a.default] : typeof a.default === 'string' && a.type === 'integer' ? LIMITS[a.default] : a.default;
  const envelope = {
    $axf: FRAMES.command, id, at, deviceId, command: r.command, arguments: { ...filled, ...(isObj(args) ? args : {}) },
    policy: c.policy, ttl: Number.isInteger(ttl) ? ttl : ttlFor(r.command, isObj(args) ? args : {}), from, correlationId, approvalId,
  };
  const v = validateCommand(envelope);
  if (!v.ok) return { ok: false, error: wireError('validation', rejection(v.errors), { fields: v.errors.map((e) => e.field) }) };
  return { ok: true, command: envelope, deprecated: r.deprecated };
}

/** The AXPP call the phone receives for a command. */
export function toWire(command) {
  const c = COMMANDS[command.command];
  const tool = typeof c.wire === 'string' ? c.wire : c.wire[command.arguments.mode];
  return { protocol: LINK.protocol, kind: 'call', id: command.id, payload: { tool, arguments: { ...command.arguments } } };
}

/** The phone's AXPP ack / result / error message → phone-result@1 (correlationId = the command id). */
export function fromWire(msg, command, at) {
  const base = { $axf: FRAMES.result, id: command.id, deviceId: command.deviceId, command: command.command, at: at || msg.at };
  if (!isObj(msg) || msg.protocol !== LINK.protocol || msg.correlationId !== command.id) return { ...base, stage: 'done', ok: false, error: wireError('invalid', 'the reply is not an axpp@1 message for this command') };
  const by = isObj(msg.by) && msg.by.kind === 'person' ? { kind: 'person', tap: msg.by.tap } : { kind: 'device' };
  if (msg.kind === 'ack') return { ...base, stage: 'ack', ok: true, status: ACK_STATUSES.includes(msg.status) ? msg.status : 'queued', by };
  if (msg.kind === 'result') return { ...base, stage: 'done', ok: true, data: isObj(msg.payload) ? msg.payload : {}, by, ...(isObj(msg.state) ? { state: msg.state } : {}) };
  if (msg.kind === 'error') return { ...base, stage: 'done', ok: false, error: wireError(msg.error?.code, msg.error?.message, msg.error?.detail), by };
  return { ...base, stage: 'done', ok: false, error: wireError('invalid', `unknown reply kind "${msg.kind}"`) };
}

/** `online` · `offline: last seen 12 min ago` · `not paired` · `revoked`. */
export function isOnline(device, at) {
  return device?.state === 'paired' && isTimestamp(device.lastSeenAt) && ms(at) - ms(device.lastSeenAt) <= HUB.onlineSeconds * 1000 && ms(at) >= ms(device.lastSeenAt);
}
export function ago(from, to) {
  const s = Math.max(0, Math.round((ms(to) - ms(from)) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
export function presence(device, at) {
  if (!device || device.state === 'unpaired' || device.state === 'pending') return 'not paired';
  if (device.state === 'revoked') return 'revoked';
  if (isOnline(device, at)) return 'online';
  return isTimestamp(device.lastSeenAt) ? `offline: last seen ${ago(device.lastSeenAt, at)}` : 'offline: never seen';
}

/** The url rule: https only, no user info, ≤ 2000, host inside the device's policy (`own` = the console origin's host). */
export function urlErrors(url, device, origin) {
  if (typeof url !== 'string' || !url || url.length > LIMITS.url) return wireError('validation', `url is a string up to ${LIMITS.url} characters`);
  let u;
  try { u = new URL(url); } catch { return wireError('validation', `"${url.slice(0, 80)}" is not a url`); }
  if (!URL_SCHEMES.includes(u.protocol)) return wireError('denied', `${u.protocol} links never open on the phone (https only)`, { scheme: u.protocol });
  if (u.username || u.password) return wireError('denied', 'a link with user info never opens on the phone');
  const mode = device?.urlPolicy?.mode ?? 'own';
  if (mode === 'any') return null;
  const own = (() => { try { return new URL(origin).host; } catch { return ''; } })();
  const allowed = mode === 'own' ? [own] : [own, ...(device?.urlPolicy?.allowlist ?? [])];
  if (!allowed.includes(u.host)) return wireError('denied', `${u.host} is outside this phone's url policy (${mode})`, { host: u.host, mode });
  return null;
}

/**
 * Everything checked before a command is queued, in this order: unknown → malformed → revoked → not paired → no capability →
 * confirm without approvalId → url outside policy → offline → ttl passed. Returns the first wire error or null.
 */
export function dispatchErrors(command, device, at, { origin = '' } = {}) {
  if (!isObj(command) || !COMMANDS[command.command]) return wireError('not_found', `unknown command "${command?.command}"`);
  const v = validateCommand(command);
  if (!v.ok) return wireError('validation', rejection(v.errors), { fields: v.errors.map((e) => e.field) });
  if (!device || device.state === 'revoked') return wireError('revoked', `${device?.name || 'this phone'} was revoked; pair it again`);
  if (device.state !== 'paired') return wireError('unpaired', 'no phone is paired: open Settings → Plugins → Phone Connect for a code');
  if (command.deviceId !== device.deviceId) return wireError('not_found', `no device ${command.deviceId}`);
  const cap = COMMANDS[command.command].capability;
  if (!(device.capabilities ?? []).includes(cap)) return wireError('not_found', `${device.name} cannot ${command.command} (${cap}): install the current app`, { capability: cap });
  if (COMMANDS[command.command].policy === 'confirm' && !command.approvalId) return wireError('confirmation_required', `${command.command} needs Brett's confirm first`);
  if (command.arguments.url) { const e = urlErrors(command.arguments.url, device, origin); if (e) return e; }
  if (!isOnline(device, at)) return wireError('offline', `${device.name} is offline: ${presence(device, at).replace(/^offline: /, '')}. Open the app or switch the watch on.`);
  if (ms(at) > ms(command.at) + command.ttl * 1000) return wireError('timeout', `${command.command} expired before it was sent (ttl ${command.ttl} s)`);
  return null;
}

/**
 * personOnly: an approval decision counts only when all hold — the result is for an `approval` command, by.kind is
 * `person` with a tap uuid, auth.kind is `device` (it arrived over the device token) and the decision is one of the
 * command's actions. Otherwise `denied` and the decision is dropped.
 */
export function decisionErrors(result, command, auth) {
  const decision = result?.data?.decision;
  if (decision === undefined) return null;
  if (!command || command.command !== 'approval' || result.command !== 'approval') return wireError('denied', 'only an approval prompt carries a decision');
  if (result.stage !== 'done' || result.ok !== true) return wireError('denied', 'a decision comes with a finished result');
  if (!isObj(result.by) || result.by.kind !== 'person' || !isUuid(result.by.tap)) return wireError('denied', 'an approval is decided only by Brett\'s own tap on the phone');
  if (!isObj(auth) || auth.kind !== 'device') return wireError('denied', `a decision over ${auth?.kind || 'no'} credentials is dropped: only the paired phone's token carries one`);
  const actions = command.arguments.actions ?? ['approve', 'deny'];
  if (!actions.includes(decision)) return wireError('denied', `"${decision}" is not one of this prompt's actions (${actions.join(', ')})`);
  return null;
}

/** The phone's own auto-approval rules never cover these tools (NEVER_AUTO, NOT_IN_ALL). */
export function autoApprovable(tool, { all = false } = {}) {
  if (NEVER_AUTO.includes(tool)) return false;
  if (all && NOT_IN_ALL.includes(tool)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Engine: pairing, tokens, device lifecycle (time and randomness injected) */
/* ------------------------------------------------------------------ */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const pick = (alphabet, n, random) => Array.from({ length: n }, () => alphabet[Math.floor(random() * alphabet.length) % alphabet.length]).join('');
const iso = (t) => new Date(t).toISOString();

/** A pairing code from a random source (`random()` → [0, 1)). */
export const makeCode = (random) => pick(CODE_ALPHABET, HUB.codeLength, random);
/** A device token from a random source: `tok_` + 32 base64url characters. */
export const makeToken = (random) => `tok_${pick(TOKEN_ALPHABET, 32, random)}`;
/** The token at rest: prefix + SHA-256, never the token. */
export const tokenAtRest = (token, at, rotatedAt = '') => ({ prefix: token.slice(0, HUB.tokenPrefixChars), hash: sha256hex(token), issuedAt: at, rotatedAt });

/** issue: a new pending pairing. Anyone may issue, a session included. */
export function issuePairing({ at, by, random }) {
  return { $axf: FRAMES.pairing, code: makeCode(random), issuedAt: at, expiresAt: iso(ms(at) + HUB.pairingSeconds * 1000), issuedBy: by, state: 'pending', deviceId: '', claimedAt: '', claimedBy: null, ended: '', endedAt: '' };
}
export const expirePairing = (p, at) => (p.state === 'pending' ? { ...p, state: 'expired', ended: 'expired', endedAt: at } : p);
export const cancelPairing = (p, at) => (p.state === 'pending' ? { ...p, state: 'cancelled', ended: 'cancelled', endedAt: at } : p);
export const pairingExpired = (p, at) => ms(at) >= ms(p.expiresAt);

/** A fresh (unpaired) device record from the phone's hello. */
export function newDevice(hello, at) {
  const d = isObj(hello?.device) ? hello.device : {};
  return {
    $axf: FRAMES.device, deviceId: d.deviceId, name: String(d.name ?? '').slice(0, LIMITS.name), app: d.app, appVersion: String(d.appVersion ?? ''), platform: d.platform ?? 'android',
    capabilities: Array.isArray(d.capabilities) ? [...new Set(d.capabilities)] : [], state: 'unpaired', owner: '', token: null, watch: { on: false, ring: true },
    urlPolicy: { mode: 'own', allowlist: [] }, pairedAt: '', lastSeenAt: '', revokedAt: '', updatedAt: at, capabilityState: isObj(d.capabilityState) ? d.capabilityState : {},
  };
}

/**
 * claim (personOnly): the phone's hello `{ code, device, person }`. Right pending code from a person → the device is
 * paired, the pairing claimed, and the token is returned exactly once. Returns { ok, pairing, device, token } or
 * { ok: false, error } with nothing changed: `denied` (no person / wrong code), `expired`, `validation`.
 */
export function claimPairing(pairing, hello, { at, random, device: existing } = {}) {
  if (!isObj(hello) || !isObj(hello.device)) return { ok: false, error: wireError('validation', 'hello carries { code, device, person }') };
  if (!isObj(pairing) || pairing.state !== 'pending' || !isCode(hello.code) || hello.code !== pairing.code) return { ok: false, error: wireError('denied', 'wrong or unknown pairing code') };
  if (pairingExpired(pairing, at)) return { ok: false, error: wireError('expired', `the code is past its ${HUB.pairingSeconds / 60} minutes: the console shows a new one`) };
  const person = hello.person;
  if (!isObj(person) || person.kind !== 'person' || blank(person.who)) return { ok: false, error: wireError('denied', 'a pairing is claimed only by Brett\'s own signed-in session on the phone, never a session, agent, service or token') };
  const base = existing && existing.deviceId === hello.device.deviceId ? existing : newDevice(hello, at);
  const token = makeToken(random);
  const device = { ...base, ...newDevice(hello, at), state: 'paired', owner: { kind: 'person', who: person.who }, token: tokenAtRest(token, at), watch: base.watch, urlPolicy: base.urlPolicy, pairedAt: at, lastSeenAt: at, revokedAt: '', updatedAt: at, ...(base.migratedFrom ? { migratedFrom: base.migratedFrom } : {}) };
  const v = validateDevice(device);
  if (!v.ok) return { ok: false, error: wireError('validation', rejection(v.errors), { fields: v.errors.map((e) => e.field) }) };
  const claimed = { ...pairing, state: 'claimed', deviceId: device.deviceId, claimedAt: at, claimedBy: { kind: 'person', who: person.who }, ended: 'claimed', endedAt: at };
  return { ok: true, pairing: claimed, device, token };
}

/** A call's device token against the record: null when it matches, else `revoked` · `unpaired` · `denied`. */
export function verifyToken(device, token) {
  if (!device) return wireError('unpaired', 'no phone is paired');
  if (device.state === 'revoked') return wireError('revoked', `${device.name} was revoked; pair it again`);
  if (device.state !== 'paired' || !device.token) return wireError('unpaired', `${device.name} is not paired: open the console for a code`);
  if (!isToken(token) || sha256hex(token) !== device.token.hash) return wireError('denied', 'bad device token');
  return null;
}

/** revoke (a person's confirm; a session cannot): the token dies at once. */
export function revokeDevice(device, by, at) {
  if (!isObj(by) || by.kind !== 'person') return { ok: false, error: wireError('denied', 'only the owner revokes a phone (a person\'s confirm, never a session)') };
  if (!device || device.state !== 'paired') return { ok: false, error: wireError('unpaired', 'nothing to revoke: no phone is paired') };
  return { ok: true, device: { ...device, state: 'revoked', token: null, revokedAt: at, updatedAt: at } };
}

/** rotate: a paired phone gets a new token with its current one; the old one dies when the new one is acknowledged (the caller swaps on ack). */
export function rotateToken(device, token, { at, random }) {
  const e = verifyToken(device, token);
  if (e) return { ok: false, error: e };
  const fresh = makeToken(random);
  return { ok: true, token: fresh, device: { ...device, token: { ...tokenAtRest(fresh, device.token.issuedAt, at) }, updatedAt: at } };
}

/** A poll touched the device. */
export const seen = (device, at, capabilityState) => ({ ...device, lastSeenAt: at, updatedAt: at, ...(isObj(capabilityState) ? { capabilityState: { ...device.capabilityState, ...capabilityState } } : {}) });

/** An AmberX phone record becomes a phone-device@1 that is paired with no token: its next hello is answered `unpaired` with reason `pair`. */
export function migrateDevice(old, at) {
  const deviceId = isDeviceId(old?.deviceId) ? old.deviceId : `amberx-${sha256hex(String(old?.deviceId ?? old?.name ?? '')).slice(0, 16)}`;
  return {
    $axf: FRAMES.device, deviceId, name: String(old?.name ?? 'AmberX phone').slice(0, LIMITS.name), app: 'amberx-droid', appVersion: String(old?.appVersion ?? ''), platform: 'android',
    capabilities: ['open-url@1', 'notify@1', 'approvals@1', 'recorder@1'], state: 'paired', owner: { kind: 'person', who: String(old?.owner ?? 'brett') }, token: null,
    watch: { on: !!old?.watch, ring: old?.ring !== false }, urlPolicy: { mode: 'own', allowlist: [] }, pairedAt: at, lastSeenAt: '', revokedAt: '', updatedAt: at, capabilityState: {},
    migratedFrom: { deviceId: String(old?.deviceId ?? ''), app: 'amberx-droid', at },
  };
}
/** What a hello from a migrated (token-less) record gets: `unpaired` with reason `pair`. */
export const helloErrors = (device) => (device?.state === 'paired' && !device.token ? wireError('unpaired', 'this phone moved from AmberX: pair it once with the code the console shows', { reason: 'pair' }) : null);
