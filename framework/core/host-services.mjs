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

// ------------------------------------------------------------------ errors

export class HostServiceError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'HostServiceError';
    this.code = ERRORS[code] ? code : 'internal';
    this.status = ERRORS[this.code].http;
    this.console = ERRORS[this.code].console;
    for (const k of ['service', 'action', 'unit', 'retryAfterMs', 'requestId']) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') this[k] = extra[k];
  }
  frame() { return errorFrame(this.code, this.message, this); }
}
/** host-error@1 body. */
export function errorFrame(code, message, extra = {}) {
  const f = { $axf: ERROR_FRAME, code: ERRORS[code] ? code : 'internal', message: String(message || code) };
  for (const k of ['service', 'action', 'unit', 'retryAfterMs', 'requestId']) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') f[k] = extra[k];
  return f;
}
const fail = (code, message, extra) => { throw new HostServiceError(code, message, extra); };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso = (v, fallback = '') => (typeof v === 'string' && ISO.test(v) ? v : fallback);
const re = (p) => new RegExp(p);

// ------------------------------------------------------------------ manifests

/** Everything that follows from an id: unit, timer, socket, state folder, log, sudoers file, console-control root. */
export function derived(id) {
  return {
    unit: `${DEFAULTS.unitPrefix}${id}.service`, timer: `${DEFAULTS.unitPrefix}${id}.timer`, socket: `${DEFAULTS.socketDir}/${id}.sock`,
    dataDir: `${DEFAULTS.stateDir}/${id}`, log: `${DEFAULTS.logDir}/${DEFAULTS.unitPrefix}${id}.log`, sudoers: `/etc/sudoers.d/${DEFAULTS.unitPrefix}${id}`,
    control: `host:${id}`, stateFile: `${DEFAULTS.stateDir}/${id}/state.json`, settingsFile: `${DEFAULTS.stateDir}/${id}/settings.json`,
  };
}

/** The host API's own manifest: the one service the console must find; `plugin: console`. */
export const HOST_API_MANIFEST = Object.freeze({
  $axf: MANIFEST_FRAME, id: DEFAULTS.hostApiId, title: 'Host API', kind: 'daemon', unit: `${DEFAULTS.unitPrefix}${DEFAULTS.hostApiId}.service`, plugin: 'console',
  runner: 'deploy/host-api/host-api.mjs', socket: DEFAULTS.apiSocket,
  description: `Serves ${DEFAULTS.apiSocket} and ${DEFAULTS.loopbackHost}:${DEFAULTS.loopbackPort}: every host service's state, health, actions, settings, logs and mode.`,
  sudo: [
    { cmd: '/usr/bin/systemctl start axf-*', why: 'unit actions: start a service or run a tick now' },
    { cmd: '/usr/bin/systemctl stop axf-*', why: 'unit actions: stop a service' },
    { cmd: '/usr/bin/systemctl restart axf-*', why: 'unit actions: restart a service (the Auto fix of host-service:<id>)' },
    { cmd: '/usr/bin/journalctl -u axf-* *', why: 'the Logs route' },
  ],
  health: { path: '/health' },
  actions: [{ id: 'reload', title: 'Reload manifests', description: 'Re-read deploy/*/host-service.json without a restart (SIGHUP).' }],
});

/**
 * Validation errors of one manifest, as `path: message` strings; [] when it is sound. Mirrors host-service.schema.json
 * and adds what a schema cannot say (a tick has no socket, a daemon has a health path, sudo lines are absolute).
 */
export function manifestErrors(m, path = 'manifest') {
  const errs = [];
  const e = (p, msg) => errs.push(`${path}.${p}: ${msg}`);
  if (!isObj(m)) return [`${path}: not an object`];
  if (m.$axf !== MANIFEST_FRAME) e('$axf', `must be ${MANIFEST_FRAME}`);
  if (typeof m.id !== 'string' || !re(ID_PATTERN).test(m.id)) e('id', `must match ${ID_PATTERN}`);
  if (typeof m.title !== 'string' || !m.title.trim() || m.title.length > LIMITS.titleMax) e('title', `1-${LIMITS.titleMax} chars`);
  if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > LIMITS.textMax)) e('description', `≤ ${LIMITS.textMax} chars`);
  if (!KINDS.includes(m.kind)) e('kind', `one of ${KINDS.join(', ')}`);
  if (typeof m.unit !== 'string' || !re(UNIT_PATTERN).test(m.unit) || !m.unit.endsWith('.service')) e('unit', `axf-<name>.service`);
  if (m.timer !== undefined && (typeof m.timer !== 'string' || !re(UNIT_PATTERN).test(m.timer) || !m.timer.endsWith('.timer'))) e('timer', 'axf-<name>.timer');
  if (m.kind === 'tick' && m.socket !== undefined) e('socket', 'a tick serves no socket');
  if (m.kind === 'daemon' && m.timer !== undefined) e('timer', 'a daemon has no timer');
  if (typeof m.plugin !== 'string' || !re(PLUGIN_PATTERN).test(m.plugin)) e('plugin', 'the owning plugin folder, or console');
  if (typeof m.runner !== 'string' || !m.runner || m.runner.length > 200 || m.runner.startsWith('/') || m.runner.includes('..')) e('runner', 'repo-relative path (deploy/<service>/…)');
  if (m.user !== undefined && (typeof m.user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(m.user))) e('user', 'a unix account name');
  if (m.user === 'root') e('user', 'never root: the sudo whitelist is the only way up');
  if (m.socket !== undefined && (typeof m.socket !== 'string' || !re(PATH_PATTERN).test(m.socket) || !m.socket.startsWith(`${DEFAULTS.socketDir}/`))) e('socket', `an absolute path under ${DEFAULTS.socketDir}/`);
  if (m.sudo !== undefined) {
    if (!Array.isArray(m.sudo) || m.sudo.length > LIMITS.sudoMax) e('sudo', `an array of ≤ ${LIMITS.sudoMax} lines`);
    else m.sudo.forEach((s, i) => {
      if (!isObj(s)) return e(`sudo[${i}]`, 'object { cmd, why }');
      if (typeof s.cmd !== 'string' || !s.cmd.startsWith('/') || s.cmd.length > 400 || /[;&|<>`$\n]/.test(s.cmd)) e(`sudo[${i}].cmd`, 'an absolute program with fixed arguments, no shell syntax');
      if (typeof s.why !== 'string' || !s.why.trim() || s.why.length > LIMITS.textMax) e(`sudo[${i}].why`, 'say what the line is for');
      if (s.as !== undefined && !SUDO_AS.includes(s.as)) e(`sudo[${i}].as`, `one of ${SUDO_AS.join(', ')}`);
    });
  }
  if (m.health !== undefined) {
    if (!isObj(m.health)) e('health', 'object');
    else {
      if (m.health.path !== undefined && (typeof m.health.path !== 'string' || !re(PATH_PATTERN).test(m.health.path))) e('health.path', 'an absolute route path');
      if (m.kind === 'tick' && m.health.path !== undefined) e('health.path', 'a tick has no health route: its last run is its health');
      const rng = (k, lo, hi) => { if (m.health[k] !== undefined && (!Number.isInteger(m.health[k]) || m.health[k] < lo || m.health[k] > hi)) e(`health.${k}`, `integer ${lo}-${hi}`); };
      rng('intervalSec', 5, 3600); rng('timeoutMs', 200, 60000); rng('staleSec', 10, 86400);
    }
  }
  const seen = new Set();
  if (m.actions !== undefined) {
    if (!Array.isArray(m.actions) || m.actions.length > LIMITS.actionsMax) e('actions', `an array of ≤ ${LIMITS.actionsMax}`);
    else m.actions.forEach((a, i) => {
      if (!isObj(a)) return e(`actions[${i}]`, 'object');
      if (typeof a.id !== 'string' || !re(ID_PATTERN).test(a.id)) e(`actions[${i}].id`, `must match ${ID_PATTERN}`);
      else if (UNIT_ACTIONS.includes(a.id)) e(`actions[${i}].id`, `${a.id} is a built-in unit action`);
      else if (seen.has(a.id)) e(`actions[${i}].id`, 'duplicate'); else seen.add(a.id);
      if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > LIMITS.titleMax) e(`actions[${i}].title`, `1-${LIMITS.titleMax} chars`);
      if (a.confirm !== undefined && typeof a.confirm !== 'boolean') e(`actions[${i}].confirm`, 'boolean');
      if (a.modes !== undefined && (!Array.isArray(a.modes) || !a.modes.length || a.modes.some((x) => !MODES.includes(x)))) e(`actions[${i}].modes`, `a non-empty list of ${MODES.join(', ')}`);
      if (a.timeoutMs !== undefined && (!Number.isInteger(a.timeoutMs) || a.timeoutMs < 200 || a.timeoutMs > 1800000)) e(`actions[${i}].timeoutMs`, 'integer 200-1800000');
      if (a.args !== undefined) {
        if (!isObj(a.args) || Object.keys(a.args).length > LIMITS.argsMax) e(`actions[${i}].args`, `an object of ≤ ${LIMITS.argsMax} arguments`);
        else for (const [k, v] of Object.entries(a.args)) { if (!isObj(v) || !SETTING_TYPES.includes(v.type)) e(`actions[${i}].args.${k}.type`, `one of ${SETTING_TYPES.join(', ')}`); else if (v.type === 'enum' && (!Array.isArray(v.values) || !v.values.length)) e(`actions[${i}].args.${k}.values`, 'an enum needs values'); }
      }
    });
  }
  if (m.settings !== undefined) {
    if (!isObj(m.settings) || Object.keys(m.settings).length > LIMITS.settingsMax) e('settings', `an object of ≤ ${LIMITS.settingsMax} keys`);
    else for (const [k, s] of Object.entries(m.settings)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,60}$/.test(k)) e(`settings.${k}`, 'a plain key');
      if (!isObj(s) || !SETTING_TYPES.includes(s.type)) { e(`settings.${k}.type`, `one of ${SETTING_TYPES.join(', ')}`); continue; }
      if (s.default === undefined) e(`settings.${k}.default`, 'every setting has a default');
      else if (valueError(s, s.default)) e(`settings.${k}.default`, valueError(s, s.default));
      if (s.type === 'enum' && (!Array.isArray(s.values) || !s.values.length)) e(`settings.${k}.values`, 'an enum needs values');
    }
  }
  if (m.replaces !== undefined) {
    if (!Array.isArray(m.replaces)) e('replaces', 'array');
    else m.replaces.forEach((r, i) => { if (!isObj(r) || !['cron', 'thread', 'loop'].includes(r.kind) || typeof r.name !== 'string' || !r.name) e(`replaces[${i}]`, '{ kind: cron|thread|loop, name, where? }'); });
  }
  if (m.dataDir !== undefined && (typeof m.dataDir !== 'string' || m.dataDir.startsWith('/') || m.dataDir.includes('..') || m.dataDir.length > 200)) e('dataDir', 'repo-relative');
  if (m.log !== undefined && (typeof m.log !== 'string' || !re(PATH_PATTERN).test(m.log))) e('log', 'an absolute path');
  return errs;
}

/** Is `value` right for a declared setting / argument? '' when fine, else the reason. */
export function valueError(decl, value) {
  switch (decl?.type) {
    case 'boolean': return typeof value === 'boolean' ? '' : 'boolean';
    case 'integer': if (!Number.isInteger(value)) return 'integer'; break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) return 'number'; break;
    case 'string': return typeof value === 'string' ? (value.length > LIMITS.textMax ? `≤ ${LIMITS.textMax} chars` : '') : 'string';
    case 'enum': return Array.isArray(decl.values) && decl.values.includes(value) ? '' : `one of ${(decl.values || []).join(', ')}`;
    default: return 'unknown type';
  }
  if (decl.min !== undefined && value < decl.min) return `≥ ${decl.min}`;
  if (decl.max !== undefined && value > decl.max) return `≤ ${decl.max}`;
  return '';
}

/** A manifest with every default filled (unit, timer, socket, user, health, dataDir, log, sudo.as, action modes); throws invalid_manifest. */
export function normManifest(m) {
  const errs = manifestErrors(m);
  if (errs.length) fail('invalid_manifest', errs.join('; '), { service: isObj(m) && typeof m.id === 'string' ? m.id : '' });
  const d = derived(m.id);
  const health = { intervalSec: DEFAULTS.healthIntervalSec, timeoutMs: DEFAULTS.healthTimeoutMs, staleSec: DEFAULTS.staleSec, ...(m.kind === 'daemon' ? { path: '/health' } : {}), ...(m.health || {}) };
  return {
    $axf: MANIFEST_FRAME, id: m.id, title: m.title, description: m.description || '', kind: m.kind, unit: m.unit, ...(m.kind === 'tick' ? { timer: m.timer || d.timer } : {}),
    plugin: m.plugin, runner: m.runner, user: m.user || DEFAULTS.user, sudo: (m.sudo || []).map((s) => ({ cmd: s.cmd, why: s.why, as: s.as || 'root' })),
    ...(m.kind === 'daemon' ? { socket: m.socket || d.socket } : {}), health,
    actions: (m.actions || []).map((a) => ({ id: a.id, title: a.title, description: a.description || '', confirm: a.confirm === true, modes: a.modes || ['shadow', 'host'], args: a.args || {}, timeoutMs: a.timeoutMs || health.timeoutMs })),
    settings: Object.fromEntries(Object.entries(m.settings || {}).map(([k, s]) => [k, { type: s.type, default: s.default, ...(s.values ? { values: s.values } : {}), ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), title: s.title || k, description: s.description || '' }])),
    replaces: (m.replaces || []).map((r) => ({ kind: r.kind, name: r.name, where: r.where || '' })),
    dataDir: m.dataDir || d.dataDir, log: m.log || d.log,
  };
}

/** Validate a set of manifests together: duplicates of id, unit, socket are errors; the host API is added when missing. */
export function normManifests(list) {
  const out = [];
  const errs = [];
  const seen = { id: new Map(), unit: new Map(), socket: new Map() };
  const all = [...(Array.isArray(list) ? list : [])];
  if (!all.some((m) => isObj(m) && m.id === DEFAULTS.hostApiId)) all.unshift(HOST_API_MANIFEST);
  all.forEach((m, i) => {
    let n;
    try { n = normManifest(m); } catch (e) { if (!(e instanceof HostServiceError)) throw e; errs.push(`[${i}] ${e.message}`); return; }
    for (const k of ['id', 'unit', 'socket']) { if (!n[k]) continue; if (seen[k].has(n[k])) errs.push(`[${i}] ${k} ${n[k]} already used by ${seen[k].get(n[k])}`); else seen[k].set(n[k], n.id); }
    out.push(n);
  });
  return { manifests: out, errors: errs };
}

/** The sudoers file for one service: one line per whitelist entry, no password, the exact command. */
export function sudoersLines(manifest) {
  const m = normManifest(manifest);
  return m.sudo.map((s) => `${m.user} ALL=(${s.as}) NOPASSWD: ${s.cmd}`);
}

/** Console-control addresses a service contributes (host:<id>, its unit verbs, actions and settings) with the verbs each takes. */
export function controlTargets(manifest) {
  const m = normManifest(manifest);
  const root = derived(m.id).control;
  const out = [{ address: root, kind: 'row', label: m.title, verbs: ['open', 'read'] }];
  for (const v of UNIT_ACTIONS) if (v !== 'run' || m.kind === 'tick') out.push({ address: `${root}/unit:${v}`, kind: 'button', label: `${v[0].toUpperCase()}${v.slice(1)} ${m.title}`, verbs: ['press'], confirm: v === 'stop' || v === 'restart' });
  for (const a of m.actions) out.push({ address: `${root}/action:${a.id}`, kind: 'button', label: a.title, verbs: ['press'], confirm: a.confirm, args: Object.keys(a.args) });
  for (const [k, s] of Object.entries(m.settings)) out.push({ address: `${root}/setting:${k}`, kind: 'setting', label: s.title, verbs: ['read', 'set'], type: s.type });
  return out;
}

// ------------------------------------------------------------------ endpoints

/**
 * Where the console reaches the host API, in order: env AXF_HOST_API (default the unix socket), then AXF_HOST_API_FALLBACK
 * (default http://host.docker.internal:7788) with AXF_HOST_TOKEN. `unix:/path`, `unix:///path` and `/path` are sockets;
 * http(s) URLs are loopback. A blank value removes that endpoint; an unparseable one is dropped with a note.
 */
export function resolveEndpoints(env = {}) {
  const primary = env[DEFAULTS.envApi] === undefined ? `unix:${DEFAULTS.apiSocket}` : String(env[DEFAULTS.envApi]).trim();
  const fallback = env[DEFAULTS.envFallback] === undefined ? DEFAULTS.fallbackUrl : String(env[DEFAULTS.envFallback]).trim();
  const token = typeof env[DEFAULTS.envToken] === 'string' ? env[DEFAULTS.envToken].trim() : '';
  const out = [];
  const notes = [];
  for (const [role, v] of [['primary', primary], ['fallback', fallback]]) {
    if (!v) continue;
    const e = parseEndpoint(v, token);
    if (!e) { notes.push(`${role}: cannot read "${v}"`); continue; }
    if (out.some((x) => x.url === e.url)) continue;
    out.push({ role, ...e });
  }
  if (out.some((e) => e.kind === 'http') && !token) notes.push(`${DEFAULTS.envToken} is not set: the loopback endpoint will answer unauthorized`);
  return { endpoints: out, token: token ? 'set' : '', notes };
}
/** One endpoint from a string, or null. */
export function parseEndpoint(v, token = '') {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.startsWith('unix:')) { const p = s.replace(/^unix:(\/\/)?/, ''); return p.startsWith('/') && re(PATH_PATTERN).test(p) ? { kind: 'socket', path: p, url: `unix:${p}`, auth: 'file-mode' } : null; }
  if (s.startsWith('/')) return re(PATH_PATTERN).test(s) ? { kind: 'socket', path: s, url: `unix:${s}`, auth: 'file-mode' } : null;
  if (/^https?:\/\/[^/\s]+$/.test(s) || /^https?:\/\/[^/\s]+\/?$/.test(s)) return { kind: 'http', url: s.replace(/\/$/, ''), auth: token ? 'bearer' : 'missing-token' };
  return null;
}
/** The HTTP request for a route on an endpoint: path (with the /v1 prefix), headers; sockets get a Host header the server ignores. */
export function requestFor(endpoint, route, { token = '' } = {}) {
  const path = `${DEFAULTS.apiPrefix}${route.startsWith('/') ? route : `/${route}`}`;
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (endpoint.kind === 'http' && token) headers.authorization = `Bearer ${token}`;
  if (endpoint.kind === 'socket' && token) headers.authorization = `Bearer ${token}`;
  return endpoint.kind === 'socket' ? { socketPath: endpoint.path, path, headers, url: `${endpoint.url}${path}` } : { path, headers, url: `${endpoint.url}${path}` };
}

// ------------------------------------------------------------------ state

/** A blank `facts` block: what the host API collects per service before `serviceState` reads it. */
export const EMPTY_FACTS = Object.freeze({ unitState: 'unknown', timerState: 'unknown', enabled: false, pid: 0, restarts: 0, activeSince: null, health: null, lastRun: null, mode: 'container', reachable: true });

/**
 * The state the UI reads for one service, from its manifest, the facts the host API collected (`unitState`, `timerState`,
 * `enabled`, `pid`, `restarts`, `activeSince`, `health`, `lastRun`, `mode`, `reachable`), the previous state (for
 * `since` and restart growth) and the clock. Pure: see HOST-SERVICES.md → "The state the UI reads" for the table.
 */
export function serviceState(manifest, facts = {}, previous = null, now = new Date().toISOString()) {
  const m = normManifest(manifest);
  const f = { ...EMPTY_FACTS, ...(isObj(facts) ? facts : {}) };
  const at = iso(now) || fail('invalid_body', 'serviceState needs `now` (ISO UTC)');
  const t = Date.parse(at);
  const age = (s) => { const v = Date.parse(iso(s)); return Number.isFinite(v) ? Math.max(0, t - v) : Infinity; };
  const unitState = UNIT_STATES.includes(f.unitState) ? f.unitState : 'unknown';
  const timerState = UNIT_STATES.includes(f.timerState) ? f.timerState : 'unknown';
  const mode = MODES.includes(f.mode) ? f.mode : 'container';
  let status = 'down', reason = '', code = '';
  if (f.reachable === false) { status = 'unknown'; code = 'host_service_down'; reason = 'the host API cannot be reached'; }
  else if (f.manifestError) { status = 'down'; code = 'invalid_manifest'; reason = String(f.manifestError).slice(0, LIMITS.textMax); }
  else if (mode === 'container') { status = 'down'; reason = 'mode container: the host copy is off, the console still runs this part'; }
  else if (m.kind === 'daemon') {
    if (unitState !== 'active' && unitState !== 'reloading') { status = unitState === 'activating' ? 'degraded' : 'down'; code = status === 'down' ? 'host_service_down' : ''; reason = `unit ${unitState}`; }
    else if (!f.health) { status = 'degraded'; reason = 'no health probe yet'; }
    else if (f.health.ok !== true) { status = 'degraded'; reason = f.health.message ? `health: ${f.health.message}` : 'health probe failed'; code = f.health.code && ERRORS[f.health.code] ? f.health.code : ''; if (code === 'host_service_down') status = 'down'; }
    else if (age(f.health.at) > m.health.intervalSec * 2000) { status = 'degraded'; reason = `last health answer ${Math.round(age(f.health.at) / 1000)} s ago, interval ${m.health.intervalSec} s`; }
    else if (previous && Number.isInteger(previous.restarts) && f.restarts > previous.restarts) { status = 'degraded'; reason = `restarted ${f.restarts - previous.restarts} time(s) since the last look`; }
    else { status = 'up'; }
  } else {
    if (timerState !== 'active' && timerState !== 'activating') { status = 'down'; code = 'host_service_down'; reason = `timer ${timerState}`; }
    else if (unitState === 'failed') { status = 'down'; code = 'host_service_down'; reason = 'last run failed (unit failed)'; }
    else if (!f.lastRun) { status = 'degraded'; reason = 'no run recorded yet'; }
    else if (f.lastRun.result === 'error' || f.lastRun.result === 'timeout') { status = 'degraded'; reason = `last run ${f.lastRun.result}${f.lastRun.message ? `: ${f.lastRun.message}` : ''}`; }
    else if (age(f.lastRun.at) > m.health.staleSec * 1000) { status = 'degraded'; reason = `last run ${Math.round(age(f.lastRun.at) / 60000)} min ago, stale after ${Math.round(m.health.staleSec / 60)} min`; }
    else if (unitState === 'activating' && age(f.lastRun.at) > m.health.timeoutMs) { status = 'degraded'; reason = 'a run is taking longer than its timeout'; }
    else { status = 'up'; }
  }
  const since = previous && previous.status === status && iso(previous.since) ? previous.since : at;
  return {
    $axf: STATE_FRAME, id: m.id, unit: m.unit, kind: m.kind, plugin: m.plugin, status, since, at, reason, code,
    unitState, ...(m.kind === 'tick' ? { timerState } : {}), enabled: f.enabled === true, pid: Number.isInteger(f.pid) && f.pid > 0 ? f.pid : 0,
    restarts: Number.isInteger(f.restarts) && f.restarts >= 0 ? f.restarts : 0, activeSince: iso(f.activeSince) || null,
    health: f.health && isObj(f.health) ? { ok: f.health.ok === true, at: iso(f.health.at) || at, message: String(f.health.message || '').slice(0, LIMITS.textMax), latencyMs: Number.isInteger(f.health.latencyMs) ? f.health.latencyMs : 0 } : null,
    lastRun: f.lastRun && isObj(f.lastRun) ? { at: iso(f.lastRun.at) || at, result: RUN_RESULTS.includes(f.lastRun.result) ? f.lastRun.result : 'error', durationMs: Number.isInteger(f.lastRun.durationMs) ? f.lastRun.durationMs : 0, message: String(f.lastRun.message || '').slice(0, LIMITS.textMax) } : null,
    mode, reachable: f.reachable !== false,
  };
}

/** Every service as `unknown` when the host API did not answer: what the console shows from the manifests it knows (plugin.json hostServices). */
export function unreachableStates(manifests, previous = [], now = new Date().toISOString()) {
  const prev = new Map((previous || []).map((p) => [p.id, p]));
  return normManifests(manifests).manifests.map((m) => serviceState(m, { reachable: false, mode: prev.get(m.id)?.mode }, prev.get(m.id), now));
}

/** The health@1 item a state turns into, or null when nothing needs the banner. */
export function healthItem(state) {
  if (!state || state.status === 'up') return null;
  const fix = state.kind === 'tick' && state.timerState !== 'active' ? 'start' : 'restart';
  const push = state.status === 'down' || state.status === 'unknown';
  return {
    id: `host-service:${state.id}`, severity: push ? 'error' : 'warn', push,
    title: `${state.unit} is ${state.status}`,
    message: `${state.reason || state.status}${state.since ? `, since ${state.since}` : ''}. The ${state.plugin === 'console' ? 'console' : `${state.plugin} plugin`} part that runs on the host is ${state.status === 'degraded' ? 'limping' : 'not running'}.`,
    fix: state.status === 'unknown' ? { kind: 'unit', service: DEFAULTS.hostApiId, verb: 'restart', label: 'Restart the host API' } : state.mode === 'container' ? null : { kind: 'unit', service: state.id, verb: fix, label: `${fix[0].toUpperCase()}${fix.slice(1)} ${state.unit}` },
  };
}

/** One plain line per service for Amber, the CLI and the banner. */
export function summary(states) {
  return (states || []).map((s) => `${s.id}: ${s.status}${s.since ? ` since ${s.since}` : ''}${s.mode ? `, ${s.mode}` : ''}${s.reason ? ` (${s.reason})` : ''}`);
}

// ------------------------------------------------------------------ call results → errors

const DOWN_ERRNOS = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'ETIMEDOUT', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/**
 * What the console makes of one call to the host API. `result` is `{ error }` (a thrown transport error: code or name)
 * or `{ status, body }` (an HTTP answer, body parsed or a string). Returns null when the call succeeded (2xx), else a
 * HostServiceError: a transport failure or a timeout is host_service_down for host-api; a host-error@1 body passes
 * through; a non-2xx without a frame is internal (or host_service_down for 502/503/504 from a proxy).
 */
export function toHostError(result, { service = '', action = '', endpoint = '' } = {}) {
  if (!isObj(result)) return new HostServiceError('internal', 'no answer', { service });
  if (result.error !== undefined) {
    const err = result.error;
    const c = typeof err === 'string' ? err : err?.code || err?.cause?.code || err?.name || '';
    const msg = typeof err === 'string' ? err : err?.message || String(c || 'transport error');
    const where = endpoint ? ` at ${endpoint}` : '';
    if (c === 'ETIMEDOUT' || c === 'AbortError' || c === 'TimeoutError' || /timeout/i.test(c)) return new HostServiceError('host_service_down', `the host API did not answer in time${where}`, { service: DEFAULTS.hostApiId, action });
    if (!c || DOWN_ERRNOS.has(c) || /^E[A-Z]+$/.test(c)) return new HostServiceError('host_service_down', `the host API cannot be reached${where}: ${msg}`, { service: DEFAULTS.hostApiId, action });
    return new HostServiceError('internal', msg, { service: service || DEFAULTS.hostApiId, action });
  }
  const status = Number(result.status) || 0;
  if (status >= 200 && status < 300) return null;
  const body = isObj(result.body) ? result.body : null;
  if (body && body.$axf === ERROR_FRAME && ERRORS[body.code]) return new HostServiceError(body.code, body.message, { service: body.service || service, action: body.action || action, unit: body.unit, retryAfterMs: body.retryAfterMs, requestId: body.requestId });
  if (status === 502 || status === 503 || status === 504) return new HostServiceError('host_service_down', `the host API answered ${status} without a frame`, { service: DEFAULTS.hostApiId, action });
  if (status === 401 || status === 403) return new HostServiceError('unauthorized', `the host API refused the token (${status})`, { service: DEFAULTS.hostApiId });
  return new HostServiceError('internal', `the host API answered ${status}${typeof result.body === 'string' && result.body ? `: ${result.body.slice(0, 200)}` : ''}`, { service: service || DEFAULTS.hostApiId, action });
}

/** How each console surface answers a HostServiceError: REST status + body, MCP tool error text, CLI exit code, voice line. */
export function consoleAnswer(err) {
  const e = err instanceof HostServiceError ? err : new HostServiceError('internal', String(err?.message || err));
  const down = e.console === 'down';
  return {
    rest: { status: e.status, body: e.frame() },
    mcp: { isError: true, text: `${e.code}: ${e.message}` },
    cli: { exit: down ? 3 : e.console === 'confirm' ? 4 : e.console === 'retry' ? 5 : 2, line: `${e.code}: ${e.message}` },
    voice: down ? `${e.service === DEFAULTS.hostApiId ? 'The host API' : `The ${e.service} service`} is down. ${e.message}` : e.message,
    state: down ? 'down' : '',
  };
}

/** Check an action call before it leaves the console: unknown action, args against their declaration, confirm and mode. */
export function actionCallErrors(manifest, actionId, { args = {}, confirm = '', mode = 'host' } = {}) {
  const m = normManifest(manifest);
  if (UNIT_ACTIONS.includes(actionId)) return actionId === 'run' && m.kind !== 'tick' ? [new HostServiceError('unknown_action', `${m.id} is a daemon: run is for ticks`, { service: m.id, action: actionId })] : [];
  const a = m.actions.find((x) => x.id === actionId);
  if (!a) return [new HostServiceError('unknown_action', `${m.id} has no action ${actionId}`, { service: m.id, action: actionId })];
  const errs = [];
  if (!isObj(args)) errs.push(new HostServiceError('invalid_body', 'args must be an object', { service: m.id, action: actionId }));
  else {
    for (const [k, d] of Object.entries(a.args)) { if (args[k] === undefined) { if (d.required) errs.push(new HostServiceError('invalid_body', `args.${k} is required`, { service: m.id, action: actionId })); continue; } const v = valueError(d, args[k]); if (v) errs.push(new HostServiceError('invalid_body', `args.${k}: ${v}`, { service: m.id, action: actionId })); }
    for (const k of Object.keys(args)) if (!a.args[k]) errs.push(new HostServiceError('invalid_body', `args.${k} is not declared`, { service: m.id, action: actionId }));
  }
  if (!a.modes.includes(MODES.includes(mode) ? mode : 'container')) errs.push(new HostServiceError('mode_refused', `${m.id} is in ${mode}: ${actionId} runs in ${a.modes.join(' or ')}`, { service: m.id, action: actionId }));
  if (a.confirm && !confirm) errs.push(new HostServiceError('confirm_required', `${a.title} needs a confirm token`, { service: m.id, action: actionId }));
  return errs;
}
