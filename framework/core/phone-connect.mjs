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
  const errorObject = { type: 'object', required: ['code', 'message', 'retryable'], properties: { code: { enum: Object.keys(ERROR_CODES) }, message: { type: 'string', minLength: 1 }, retryable: { type: 'boolean' }, detail: { type: 'object' } } };
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
        by: { type: 'object', required: ['kind'], properties: { kind: { enum: [...BY_KINDS] }, tap: uuid } },
        state: { type: 'object', propertyNames: { pattern: PATTERNS.capability }, additionalProperties: { type: 'object' } },
        deprecated: { type: 'string' },
      },
      allOf: [
        { if: { properties: { stage: { const: 'done' }, ok: { const: false } } }, then: { required: ['error'] } },
        { if: { properties: { stage: { const: 'ack' } } }, then: { required: ['status'] } },
      ],
    },
  };
}
