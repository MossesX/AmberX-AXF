/**
 * host-service@1 — the console's server-side parts running on the VPS host as systemd services, with the UI left in the
 * console (build move-server-side-console-parts-onto-vps; Brett, Nov 17 2026: "move everything to the VPS except for the
 * UI itself"). Spec: framework/spec/HOST-SERVICES.md. Pure and IO-free: the host API, the console server and the CLI
 * pass manifests, unit facts, health answers and clocks in; this module answers with validated manifests, resolved
 * endpoints, the state the UI reads and the wire errors.
 *
 * Frames:
 *   host-service@1        a service manifest (deploy/<service>/host-service.json): id, unit, owning plugin, sudo
 *                         whitelist, health, actions, settings
 *   host-service-state@1  what the console reads for one service: up / degraded / down / unknown, since, unit facts,
 *                         health, last run, mode
 *   host-error@1          the body of every non-2xx answer of the host API, and what the console throws
 *   host-service-mode@1   the per-service migration mode document (container / shadow / host), s5
 */

export const SCHEMA = 'host-services@1';
export const VERSION = 1;
export const MANIFEST_FRAME = 'host-service@1';
export const STATE_FRAME = 'host-service-state@1';
export const ERROR_FRAME = 'host-error@1';
export const MODE_FRAME = 'host-service-mode@1';
export const LIST_FRAME = 'host-service-list@1';

/** `tick` = Type=oneshot started by a timer (a tick holds its own lock); `daemon` = Type=simple, Restart=always, owns a socket. */
export const KINDS = Object.freeze(['tick', 'daemon']);
/** What the console shows. `unknown` only while the host API itself cannot be reached. */
export const STATUSES = Object.freeze(['up', 'degraded', 'down', 'unknown']);
/** systemd ActiveState values the host API passes through. */
export const UNIT_STATES = Object.freeze(['active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating', 'unknown']);
/** Built-in unit actions every service has; `run` is for ticks (systemctl start <unit>), the rest for both kinds. */
export const UNIT_ACTIONS = Object.freeze(['start', 'stop', 'restart', 'run']);
/** The result of one tick or one health probe. */
export const RUN_RESULTS = Object.freeze(['ok', 'error', 'skipped', 'timeout']);
/** Who may run a sudo line: a service's whitelist entry says which `as` the command runs under. */
export const SUDO_AS = Object.freeze(['root']);
/** Setting value kinds a manifest may declare (settings are plain JSON, merged key by key, last save wins). */
export const SETTING_TYPES = Object.freeze(['boolean', 'integer', 'number', 'string', 'enum']);
/** Migration modes (s5). The document is host-service-mode@1 at `<data>/host-services/mode.json`. */
export const MODES = Object.freeze(['container', 'shadow', 'host']);

/**
 * Wire errors. `http` is the status the host API answers with; `console` says what the console does with it: `down`
 * = this is the host_service_down state the UI shows; `retry` = try the next endpoint / later; `caller` = the caller's
 * own mistake, surfaced as is; `confirm` = ask for the confirm token (destructive press).
 */
export const ERRORS = Object.freeze({
  host_service_down: { http: 503, console: 'down', when: "the unit is not active, its socket refused or timed out, or the host API itself cannot be reached (service = 'host-api')" },
  unknown_service: { http: 404, console: 'caller', when: 'no manifest with that id' },
  unknown_action: { http: 404, console: 'caller', when: 'the manifest declares no such action and it is not a unit action' },
  unknown_setting: { http: 404, console: 'caller', when: 'the manifest declares no such setting' },
  invalid_body: { http: 400, console: 'caller', when: 'not JSON, a bad frame, an argument outside its declared type or range' },
  invalid_manifest: { http: 500, console: 'caller', when: 'a manifest on disk fails validation; the host API lists the service as down with this code' },
  unauthorized: { http: 401, console: 'caller', when: 'loopback call without the bearer token, or a wrong one (the socket is authorised by its file mode)' },
  confirm_required: { http: 428, console: 'confirm', when: 'the action is marked confirm and the body has no valid confirm token' },
  forbidden_command: { http: 403, console: 'caller', when: 'a service asked the host to run a command outside its sudo whitelist; logged and refused' },
  mode_refused: { http: 409, console: 'caller', when: 'the action is not allowed in the service\'s current migration mode (container = the host copy is off)' },
  busy: { http: 409, console: 'retry', when: 'the action or tick is already running (its lock is held)' },
  timeout: { http: 504, console: 'retry', when: 'the service did not answer within health.timeoutMs' },
  internal: { http: 500, console: 'retry', when: 'anything else; message carries a request id' },
});

/** Where the host API listens, how the console finds it, and the host account. Overridable by env, never by a manifest. */
export const DEFAULTS = Object.freeze({
  user: 'axf-host',
  group: 'axf-host',
  socketDir: '/run/axf-host',
  apiSocket: '/run/axf-host/api.sock',
  socketMode: '0660',
  loopbackHost: '127.0.0.1',
  loopbackPort: 7788,
  /** The fallback the console container uses when the socket is not mounted (docker's host alias, bridge-bound listener). */
  fallbackUrl: 'http://host.docker.internal:7788',
  apiPrefix: '/v1',
  unitPrefix: 'axf-',
  manifestGlob: 'deploy/*/host-service.json',
  stateDir: '_data/host-services',
  modeFile: '_data/host-services/mode.json',
  logDir: '/var/log',
  hostApiId: 'host-api',
  healthIntervalSec: 30,
  healthTimeoutMs: 5000,
  staleSec: 180,
  envApi: 'AXF_HOST_API',
  envFallback: 'AXF_HOST_API_FALLBACK',
  envToken: 'AXF_HOST_TOKEN',
});

export const ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,40}$';
export const UNIT_PATTERN = '^axf-[a-z0-9][a-z0-9-]{0,60}\\.(service|timer)$';
export const PLUGIN_PATTERN = '^(console|[a-z0-9][a-z0-9-]{0,60})$';
export const PATH_PATTERN = '^/[A-Za-z0-9._/-]*$';
export const LIMITS = Object.freeze({ textMax: 600, titleMax: 120, sudoMax: 40, actionsMax: 60, settingsMax: 80, logLinesMax: 2000, argsMax: 20 });

/** The host API routes (relative to DEFAULTS.apiPrefix). `{id}` is a service id; `auth: none` is open on both listeners. */
export const ROUTES = Object.freeze([
  { method: 'GET', path: '/health', auth: 'none', answers: 'the host API itself: { ok, service: host-api, at, version }' },
  { method: 'GET', path: '/services', auth: 'token', answers: `${LIST_FRAME}: every service (${STATE_FRAME}) with its manifest` },
  { method: 'GET', path: '/services/{id}', auth: 'token', answers: `${STATE_FRAME} + manifest` },
  { method: 'GET', path: '/services/{id}/health', auth: 'token', answers: 'the service\'s own health answer (daemon: forwarded; tick: the last run)' },
  { method: 'POST', path: '/services/{id}/unit/{start|stop|restart|run}', auth: 'token', answers: '{ ok, unit, state } after systemctl; run = start a tick now' },
  { method: 'POST', path: '/services/{id}/actions/{action}', auth: 'token', answers: '{ ok, result, at, durationMs }; body { args, by, reason, confirm? }' },
  { method: 'GET', path: '/services/{id}/settings', auth: 'token', answers: '{ settings, declared } current values + the manifest\'s declarations' },
  { method: 'PUT', path: '/services/{id}/settings', auth: 'token', answers: '{ ok, settings } merged key by key (last save wins); body { set: {…}, by, reason }' },
  { method: 'GET', path: '/services/{id}/logs?lines=&since=', auth: 'token', answers: '{ lines: [{ at, line }] } from journalctl -u <unit>' },
  { method: 'GET', path: '/services/{id}/mode', auth: 'token', answers: `the service's entry of ${MODE_FRAME}` },
  { method: 'PUT', path: '/services/{id}/mode', auth: 'token', answers: `{ ok, mode, changes } body { to: container|shadow|host, by, reason, confirm? } (s5)` },
  { method: 'GET', path: '/mode', auth: 'token', answers: `${MODE_FRAME}: the whole document` },
]);

/** The snapshot framework/schemas/host-service.json carries, for Python readers (the console server) and ports. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, manifest: MANIFEST_FRAME, state: STATE_FRAME, error: ERROR_FRAME, mode: MODE_FRAME, list: LIST_FRAME,
  kinds: KINDS, statuses: STATUSES, unitStates: UNIT_STATES, unitActions: UNIT_ACTIONS, runResults: RUN_RESULTS, sudoAs: SUDO_AS,
  settingTypes: SETTING_TYPES, modes: MODES, errors: ERRORS, defaults: DEFAULTS, routes: ROUTES,
  idPattern: ID_PATTERN, unitPattern: UNIT_PATTERN, pluginPattern: PLUGIN_PATTERN, pathPattern: PATH_PATTERN, limits: LIMITS,
});

const $schema = 'https://json-schema.org/draft/2020-12/schema';
const $id = (n) => `https://amberx.ai/axf/schemas/${n}`;
const dateTime = { type: 'string', format: 'date-time' };
const text = (max = LIMITS.textMax) => ({ type: 'string', maxLength: max });

function sudoSchema() {
  return {
    type: 'array', maxItems: LIMITS.sudoMax, description: 'exact command lines the host may run for this service as root; the installer writes them to /etc/sudoers.d/axf-<id>; anything else is forbidden_command',
    items: { type: 'object', required: ['cmd', 'why'], additionalProperties: false, properties: { cmd: { type: 'string', minLength: 1, maxLength: 400, description: 'absolute program path and fixed arguments; a trailing " *" allows arguments' }, why: text(), as: { enum: SUDO_AS } } },
  };
}
function healthSchema() {
  return {
    type: 'object', additionalProperties: false, description: 'how the host API decides up / degraded / down for this service',
    properties: {
      path: { type: 'string', pattern: PATH_PATTERN, description: 'daemon: the GET on the service socket that answers { ok, message? }' },
      intervalSec: { type: 'integer', minimum: 5, maximum: 3600 }, timeoutMs: { type: 'integer', minimum: 200, maximum: 60000 },
      staleSec: { type: 'integer', minimum: 10, maximum: 86400, description: 'tick: a last run older than this is degraded' },
    },
  };
}
function actionSchema() {
  return {
    type: 'object', required: ['id', 'title'], additionalProperties: false,
    properties: {
      id: { type: 'string', pattern: ID_PATTERN }, title: text(LIMITS.titleMax), description: text(),
      confirm: { type: 'boolean', description: 'destructive: the call needs a confirm token (console-control confirm)' },
      modes: { type: 'array', items: { enum: MODES }, description: 'migration modes the action may run in; default shadow + host' },
      args: { type: 'object', maxProperties: LIMITS.argsMax, additionalProperties: { type: 'object', required: ['type'], properties: { type: { enum: SETTING_TYPES }, required: { type: 'boolean' }, values: { type: 'array', items: { type: 'string' } }, min: { type: 'number' }, max: { type: 'number' }, description: text() } } },
      timeoutMs: { type: 'integer', minimum: 200, maximum: 1800000 },
    },
  };
}
function settingSchema() {
  return {
    type: 'object', required: ['type', 'default'], additionalProperties: false,
    properties: { type: { enum: SETTING_TYPES }, default: {}, values: { type: 'array', items: { type: 'string' } }, min: { type: 'number' }, max: { type: 'number' }, title: text(LIMITS.titleMax), description: text() },
  };
}

function manifestProps() {
  return {
    $axf: { const: MANIFEST_FRAME },
    id: { type: 'string', pattern: ID_PATTERN, description: 'the service id; unit, socket, state folder and console-control addresses derive from it' },
    title: text(LIMITS.titleMax), description: text(),
    kind: { enum: KINDS },
    unit: { type: 'string', pattern: UNIT_PATTERN, description: 'the systemd unit (axf-<id>.service unless the manifest says otherwise)' },
    timer: { type: 'string', pattern: UNIT_PATTERN, description: 'tick: the timer that starts the unit' },
    plugin: { type: 'string', pattern: PLUGIN_PATTERN, description: "the console plugin folder that owns it ('console' for core parts like alert delivery)" },
    runner: { type: 'string', minLength: 1, maxLength: 200, description: 'repo-relative entry the unit runs (deploy/<service>/…)' },
    user: { type: 'string', pattern: '^[a-z_][a-z0-9_-]{0,31}$', description: `the host account; default ${DEFAULTS.user}` },
    sudo: sudoSchema(),
    socket: { type: 'string', pattern: PATH_PATTERN, description: `daemon: the unix socket the service serves; default ${DEFAULTS.socketDir}/<id>.sock` },
    health: healthSchema(),
    actions: { type: 'array', maxItems: LIMITS.actionsMax, items: actionSchema() },
    settings: { type: 'object', maxProperties: LIMITS.settingsMax, additionalProperties: settingSchema() },
    replaces: { type: 'array', items: { type: 'object', required: ['kind', 'name'], properties: { kind: { enum: ['cron', 'thread', 'loop'] }, name: { type: 'string' }, where: { type: 'string' } } }, description: 'what in the container or in cron this service takes over (the migration turns these off in host mode)' },
    dataDir: { type: 'string', maxLength: 200, description: `repo-relative state folder; default ${DEFAULTS.stateDir}/<id>` },
    log: { type: 'string', pattern: PATH_PATTERN, description: `default ${DEFAULTS.logDir}/axf-<id>.log` },
  };
}

function stateProps() {
  return {
    $axf: { const: STATE_FRAME },
    id: { type: 'string', pattern: ID_PATTERN }, unit: { type: 'string' }, kind: { enum: KINDS }, plugin: { type: 'string' },
    status: { enum: STATUSES }, since: dateTime, at: dateTime,
    reason: text(), code: { enum: ['', ...Object.keys(ERRORS)], description: 'the error behind down / unknown, when there is one' },
    unitState: { enum: UNIT_STATES }, timerState: { enum: UNIT_STATES }, enabled: { type: 'boolean' },
    pid: { type: 'integer', minimum: 0 }, restarts: { type: 'integer', minimum: 0 }, activeSince: { type: ['string', 'null'] },
    health: { type: ['object', 'null'], required: ['ok', 'at'], properties: { ok: { type: 'boolean' }, at: dateTime, message: text(), latencyMs: { type: 'integer', minimum: 0 } } },
    lastRun: { type: ['object', 'null'], required: ['at', 'result'], properties: { at: dateTime, result: { enum: RUN_RESULTS }, durationMs: { type: 'integer', minimum: 0 }, message: text() } },
    mode: { enum: MODES }, reachable: { type: 'boolean', description: 'false only when the host API could not be reached' },
  };
}

/** The JSON Schemas written to framework/schemas/json by `axf schemas`. */
export function jsonSchemas() {
  return {
    'host-service.schema.json': {
      $schema, $id: $id('host-service.schema.json'), title: `${MANIFEST_FRAME} (${SCHEMA}) — a host service manifest`, type: 'object', additionalProperties: false,
      required: ['$axf', 'id', 'title', 'kind', 'unit', 'plugin', 'runner'], properties: manifestProps(),
    },
    'host-service-state.schema.json': {
      $schema, $id: $id('host-service-state.schema.json'), title: `${STATE_FRAME} (${SCHEMA}) — what the console reads`, type: 'object', additionalProperties: true,
      required: ['$axf', 'id', 'status', 'since', 'at', 'reachable'], properties: stateProps(),
    },
    'host-error.schema.json': {
      $schema, $id: $id('host-error.schema.json'), title: `${ERROR_FRAME} (${SCHEMA}) — the body of every non-2xx host API answer`, type: 'object', additionalProperties: false,
      required: ['$axf', 'code', 'message'],
      properties: { $axf: { const: ERROR_FRAME }, code: { enum: Object.keys(ERRORS) }, message: { type: 'string', minLength: 1 }, service: { type: 'string' }, action: { type: 'string' }, unit: { type: 'string' }, retryAfterMs: { type: 'integer', minimum: 0 }, requestId: { type: 'string' } },
    },
  };
}
