/**
 * host-service@1 — the console's server-side parts running on the VPS host as systemd services, with the UI left in the
 * console (build move-server-side-console-parts-onto-vps; Brett, Nov 17 2026: "move everything to the VPS except for the
 * UI itself"). Spec: framework/spec/HOST-SERVICES.md. Pure and IO-free: the host API, the console server and the CLI
 * pass manifests, unit facts, health answers and clocks in; this module answers with validated manifests, resolved
 * endpoints, the state the UI reads and the wire errors.
 *
 * Frames:
 *   host-service@1        a service manifest (deploy/host-services/services/<id>.json): id, unit, owning plugin, sudo
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
/**
 * Migration modes (s5). The document is host-service-mode@1 at `<data>/host-services/mode.json`; both sides read it
 * before every tick.
 *   container  the in-container copy does the work; the unit is installed but stopped (timer disabled)
 *   shadow     both run: the container copy does the work, the host copy runs the same tick in dry-run and logs what it
 *              would have done; the host API compares the two (host-shadow-drift@1)
 *   host       the host copy does the work; the container copy sees the mode and skips, cron files named in `replaces`
 *              are removed, the console's routes read through the host API
 */
export const MODES = Object.freeze(['container', 'shadow', 'host']);
export const DRIFT_FRAME = 'host-shadow-drift@1';
export const MODE_EVENTS = Object.freeze(['start-shadow', 'back-to-container', 'cut-over', 'step-back', 'roll-back']);
/** event → [from, to]. There is no container → host: shadow first. roll-back and back-to-container are always allowed. */
export const MODE_TRANSITIONS = Object.freeze({
  'start-shadow': ['container', 'shadow'],
  'back-to-container': ['shadow', 'container'],
  'cut-over': ['shadow', 'host'],
  'step-back': ['host', 'shadow'],
  'roll-back': ['host', 'container'],
});
/** What cut-over needs: shadow this long, this many clean host runs, no unaccepted drift, health up, every `after` in host. */
export const MODE_GUARDS = Object.freeze({ minShadowMs: 30 * 60 * 1000, minRuns: 3, maxDrift: 0 });
export const DRIFT_KINDS = Object.freeze(['effect-differs', 'result-differs', 'host-error', 'container-error', 'host-missing', 'container-missing']);
/**
 * The order to cut over (report § 1e): a tier at a time, every service of a tier in host mode before the next starts.
 * Services not listed here sit in the `rest` tier; `after` on a manifest adds finer ordering inside a tier.
 */
export const CUTOVER_TIERS = Object.freeze([
  { tier: 1, name: 'gateway', why: 'nothing else is reachable without it', services: ['host-api'] },
    { tier: 2, name: 'publishers', why: 'everything else reads what they keep current (main, the hub)', services: ['builds-live', 'hub-sync'] },
  { tier: 3, name: 'independent loops', why: 'no console coupling beyond their own data folder', services: ['maintenance', 'shipped-features'] },
  { tier: 4, name: 'host actions', why: 'they start sessions and run fixes, so the publishers go first', services: ['systems-check', 'agent-swarm'] },
  { tier: 5, name: 'rest', why: 'anything a later build adds and does not place', services: [] },
]);

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
  manifestGlob: 'deploy/host-services/services/*.json',
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
/** An adopted cron schedule: the file name in /etc/cron.d. */
export const CRON_PATTERN = '^axf-[a-z0-9][a-z0-9-]{0,60}$';
export const CRON_DIR = '/etc/cron.d';
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
  { method: 'POST', path: '/services/{id}/shadow', auth: 'token', answers: '{ ok, drift } the console reports what its in-container copy did (shadow mode); the host API compares with the host run and logs host-shadow-drift@1' },
  { method: 'GET', path: '/services/{id}/shadow?since=', auth: 'token', answers: '{ runs, drift: [host-shadow-drift@1] } the shadow log' },
  { method: 'POST', path: '/services/{id}/rollback', auth: 'token', answers: '{ ok, steps } mode → container, unit stopped, timer disabled, cron restored; body { by, reason, why }' },
]);

/** The snapshot framework/schemas/host-service.json carries, for Python readers (the console server) and ports. */
export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, manifest: MANIFEST_FRAME, state: STATE_FRAME, error: ERROR_FRAME, mode: MODE_FRAME, list: LIST_FRAME,
  kinds: KINDS, statuses: STATUSES, unitStates: UNIT_STATES, unitActions: UNIT_ACTIONS, runResults: RUN_RESULTS, sudoAs: SUDO_AS,
  settingTypes: SETTING_TYPES, modes: MODES, modeEvents: MODE_EVENTS, modeTransitions: MODE_TRANSITIONS, modeGuards: MODE_GUARDS, cutoverTiers: CUTOVER_TIERS, driftKinds: DRIFT_KINDS, drift: DRIFT_FRAME,
  errors: ERRORS, defaults: DEFAULTS, routes: ROUTES,
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
      freshness: { type: 'boolean', description: 'tick: false when the schedule leaves no trace of a quiet run (its log is only written when something happens); only "is it still scheduled" is checked then' },
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
    unit: { type: 'string', pattern: `${UNIT_PATTERN}|^cron:axf-[a-z0-9][a-z0-9-]{0,60}$`, description: 'the systemd unit (axf-<id>.service unless the manifest says otherwise); a filled-in cron tick reads cron:<file>' },
    timer: { type: 'string', pattern: UNIT_PATTERN, description: 'tick: the timer that starts the unit' },
    cron: { type: 'string', pattern: CRON_PATTERN, description: `tick: the ${CRON_DIR} file that starts it instead of a unit and timer (adopted schedules only)` },
    adopted: { type: 'boolean', description: 'already runs on the host from its own installer: listed and health-checked here, never installed, stopped or migrated; its mode is always host' },
    plugin: { type: 'string', pattern: PLUGIN_PATTERN, description: "the console plugin folder that owns it ('console' for core parts like alert delivery)" },
    runner: { type: 'string', maxLength: 200, description: 'repo-relative entry the unit runs (deploy/<service>/…); an adopted schedule may leave it out (its own installer says what runs)' },
    user: { type: 'string', pattern: '^[a-z_][a-z0-9_-]{0,31}$', description: `the host account; default ${DEFAULTS.user}` },
    sudo: sudoSchema(),
    socket: { type: 'string', pattern: PATH_PATTERN, description: `daemon: the unix socket the service serves; default ${DEFAULTS.socketDir}/<id>.sock` },
    health: healthSchema(),
    actions: { type: 'array', maxItems: LIMITS.actionsMax, items: actionSchema() },
    settings: { type: 'object', maxProperties: LIMITS.settingsMax, additionalProperties: settingSchema() },
    replaces: { type: 'array', items: { type: 'object', required: ['kind', 'name'], properties: { kind: { enum: ['cron', 'thread', 'loop'] }, name: { type: 'string' }, where: { type: 'string' } } }, description: 'what in the container or in cron this service takes over (the migration turns these off in host mode)' },
    after: { type: 'array', items: { type: 'string', pattern: ID_PATTERN }, description: 'services that must be in host mode before this one may cut over (host-api is implied)' },
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
    cron: { type: 'string', pattern: CRON_PATTERN, description: 'set when cron starts it: timerState then says whether the cron file is there' }, adopted: { type: 'boolean' },
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
      required: ['$axf', 'id', 'title', 'kind', 'plugin'], allOf: [{ anyOf: [{ required: ['unit'] }, { required: ['cron'] }] }, { anyOf: [{ required: ['runner'] }, { required: ['adopted'] }] }], properties: manifestProps(),
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
  runner: 'deploy/host-services/axf-hostd.mjs', socket: DEFAULTS.apiSocket,
  description: `Serves ${DEFAULTS.apiSocket} and ${DEFAULTS.loopbackHost}:${DEFAULTS.loopbackPort}: every host service's state, health, actions, settings, logs and mode.`,
  sudo: [
    { cmd: '/usr/bin/systemctl start axf-*', why: 'unit actions: start a service or run a tick now' },
    { cmd: '/usr/bin/systemctl stop axf-*', why: 'unit actions: stop a service' },
    { cmd: '/usr/bin/systemctl restart axf-*', why: 'unit actions: restart a service (the Auto fix of host-service:<id>)' },
    { cmd: '/usr/bin/journalctl -u axf-* -n 500 -o short-iso --no-pager', why: 'the Logs route when the journal group read is refused' },
  ],
  health: { path: '/health' },
  actions: [{ id: 'reload', title: 'Reload manifests', description: 'Re-read deploy/host-services/services/*.json without a restart (SIGHUP).' }],
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
  if (m.cron !== undefined) {
    if (typeof m.cron !== 'string' || !re(CRON_PATTERN).test(m.cron)) e('cron', `a file name in ${CRON_DIR} (axf-<name>)`);
    if (m.kind !== 'tick') e('cron', 'only a tick is started by cron');
    if (m.adopted !== true) e('cron', 'a cron schedule is adopted (adopted: true): new services get a unit');
    if ((m.unit !== undefined && m.unit !== `cron:${m.cron}`) || m.timer !== undefined) e('cron', 'a cron tick names no unit or timer');
  } else if (typeof m.unit !== 'string' || !re(UNIT_PATTERN).test(m.unit) || !m.unit.endsWith('.service')) e('unit', `axf-<name>.service`);
  if (m.adopted !== undefined && typeof m.adopted !== 'boolean') e('adopted', 'true or false');
  if (m.adopted === true && ((m.sudo || []).length || (m.actions || []).length || (m.settings && Object.keys(m.settings).length))) e('adopted', 'an adopted schedule declares no sudo, actions or settings: its own installer and plugin own those');
  if (m.timer !== undefined && (typeof m.timer !== 'string' || !re(UNIT_PATTERN).test(m.timer) || !m.timer.endsWith('.timer'))) e('timer', 'axf-<name>.timer');
  if (m.kind === 'tick' && m.socket !== undefined) e('socket', 'a tick serves no socket');
  if (m.kind === 'daemon' && m.timer !== undefined) e('timer', 'a daemon has no timer');
  if (typeof m.plugin !== 'string' || !re(PLUGIN_PATTERN).test(m.plugin)) e('plugin', 'the owning plugin folder, or console');
  if (!(m.adopted === true && (m.runner === undefined || m.runner === '')) && (typeof m.runner !== 'string' || !m.runner || m.runner.length > 200 || m.runner.startsWith('/') || m.runner.includes('..'))) e('runner', 'repo-relative path (deploy/<service>/…); only an adopted schedule may leave it out');
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
      if (m.health.freshness !== undefined && (typeof m.health.freshness !== 'boolean' || m.kind !== 'tick')) e('health.freshness', 'true or false, ticks only');
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
  if (m.after !== undefined && (!Array.isArray(m.after) || m.after.some((x) => typeof x !== 'string' || !re(ID_PATTERN).test(x) || x === m.id))) e('after', 'a list of other service ids');
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
    $axf: MANIFEST_FRAME, id: m.id, title: m.title, description: m.description || '', kind: m.kind, unit: m.cron ? `cron:${m.cron}` : m.unit, ...(m.cron ? { cron: m.cron } : m.kind === 'tick' ? { timer: m.timer || d.timer } : {}), ...(m.adopted === true ? { adopted: true } : {}),
    plugin: m.plugin, runner: m.runner || '', user: m.user || DEFAULTS.user, sudo: (m.sudo || []).map((s) => ({ cmd: s.cmd, why: s.why, as: s.as || 'root' })),
    ...(m.kind === 'daemon' ? { socket: m.socket || d.socket } : {}), health,
    actions: (m.actions || []).map((a) => ({ id: a.id, title: a.title, description: a.description || '', confirm: a.confirm === true, modes: a.modes || ['shadow', 'host'], args: a.args || {}, timeoutMs: a.timeoutMs || health.timeoutMs })),
    settings: Object.fromEntries(Object.entries(m.settings || {}).map(([k, s]) => [k, { type: s.type, default: s.default, ...(s.values ? { values: s.values } : {}), ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), title: s.title || k, description: s.description || '' }])),
    replaces: (m.replaces || []).map((r) => ({ kind: r.kind, name: r.name, where: r.where || '' })),
    after: [...new Set(m.after || [])].filter((x) => x !== DEFAULTS.hostApiId),
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
  for (const n of out) for (const a of n.after) if (!seen.id.has(a)) errs.push(`${n.id}: after names unknown service ${a}`);
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
  for (const v of UNIT_ACTIONS) if (!m.cron && !(m.adopted && v === 'stop') && (v !== 'run' || m.kind === 'tick')) out.push({ address: `${root}/unit:${v}`, kind: 'button', label: `${v[0].toUpperCase()}${v.slice(1)} ${m.title}`, verbs: ['press'], confirm: v === 'stop' || v === 'restart' });
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
  const mode = m.adopted ? 'host' : MODES.includes(f.mode) ? f.mode : 'container';
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
    if (timerState !== 'active' && timerState !== 'activating') { status = 'down'; code = 'host_service_down'; reason = m.cron ? `${CRON_DIR}/${m.cron} is missing` : `timer ${timerState}`; }
    else if (unitState === 'failed') { status = 'down'; code = 'host_service_down'; reason = 'last run failed (unit failed)'; }
    else if (m.health.freshness === false) { status = 'up'; }
    else if (!f.lastRun) { status = 'degraded'; reason = 'no run recorded yet'; }
    else if (f.lastRun.result === 'error' || f.lastRun.result === 'timeout') { status = 'degraded'; reason = `last run ${f.lastRun.result}${f.lastRun.message ? `: ${f.lastRun.message}` : ''}`; }
    else if (age(f.lastRun.at) > m.health.staleSec * 1000) { status = 'degraded'; reason = `last run ${Math.round(age(f.lastRun.at) / 60000)} min ago, stale after ${Math.round(m.health.staleSec / 60)} min`; }
    else if (unitState === 'activating' && age(f.lastRun.at) > m.health.timeoutMs) { status = 'degraded'; reason = 'a run is taking longer than its timeout'; }
    else { status = 'up'; }
  }
  const since = previous && previous.status === status && iso(previous.since) ? previous.since : at;
  return {
    $axf: STATE_FRAME, id: m.id, unit: m.unit, kind: m.kind, plugin: m.plugin, status, since, at, reason, code,
    unitState, ...(m.kind === 'tick' ? { timerState } : {}), ...(m.cron ? { cron: m.cron } : {}), ...(m.adopted ? { adopted: true } : {}), enabled: f.enabled === true, pid: Number.isInteger(f.pid) && f.pid > 0 ? f.pid : 0,
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
  // A cron schedule has no unit to start: the fix is the console installer, which writes every schedule again.
  const cronFix = { kind: 'action', service: 'systems-check', action: 'fix', args: { check: 'host-update-cron' }, label: 'Re-install the host schedules' };
  const push = state.status === 'down' || state.status === 'unknown';
  return {
    id: `host-service:${state.id}`, severity: push ? 'error' : 'warn', push,
    title: `${state.unit} is ${state.status}`,
    message: `${state.reason || state.status}${state.since ? `, since ${state.since}` : ''}. The ${state.plugin === 'console' ? 'console' : `${state.plugin} plugin`} part that runs on the host is ${state.status === 'degraded' ? 'limping' : 'not running'}.`,
    fix: state.status === 'unknown' ? { kind: 'unit', service: DEFAULTS.hostApiId, verb: 'restart', label: 'Restart the host API' } : state.mode === 'container' ? null : state.cron ? cronFix : { kind: 'unit', service: state.id, verb: fix, label: `${fix[0].toUpperCase()}${fix.slice(1)} ${state.unit}` },
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
  if (UNIT_ACTIONS.includes(actionId) && m.cron) return [new HostServiceError('unknown_action', `${m.id} is started by cron (${CRON_DIR}/${m.cron}): it has no unit to ${actionId}`, { service: m.id, action: actionId })];
  if (UNIT_ACTIONS.includes(actionId) && m.adopted && actionId === 'stop') return [new HostServiceError('unknown_action', `${m.id} is adopted: its own plugin switches it off`, { service: m.id, action: actionId })];
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

// ------------------------------------------------------------------ migration modes (s5)

/** A fresh mode document: everything in the container. */
export function initialModeState(at, by = 'svc:cli') {
  return { $axf: MODE_FRAME, rev: 0, at: iso(at, '1970-01-01T00:00:00.000Z'), by, default: 'container', services: {} };
}
/** A document from disk with every field in shape (unknown modes fall back to container; a wrong frame is refused). */
export function normModeState(v, at) {
  if (!isObj(v) || (v.$axf && v.$axf !== MODE_FRAME)) fail('invalid_body', `not a ${MODE_FRAME} document`);
  const s = initialModeState(at);
  s.rev = Number.isInteger(v.rev) && v.rev >= 0 ? v.rev : 0; s.at = iso(v.at, s.at); s.by = typeof v.by === 'string' ? v.by : s.by;
  s.default = v.default === 'container' ? 'container' : 'container';
  for (const [id, e] of Object.entries(isObj(v.services) ? v.services : {})) {
    if (!isObj(e) || !re(ID_PATTERN).test(id)) continue;
    s.services[id] = {
      mode: MODES.includes(e.mode) ? e.mode : 'container', since: iso(e.since, s.at), by: typeof e.by === 'string' ? e.by : s.by,
      runs: Number.isInteger(e.runs) && e.runs >= 0 ? e.runs : 0, drift: Number.isInteger(e.drift) && e.drift >= 0 ? e.drift : 0, lastDriftAt: iso(e.lastDriftAt, ''),
      rollbackOf: isObj(e.rollbackOf) && MODES.includes(e.rollbackOf.from) ? { from: e.rollbackOf.from, at: iso(e.rollbackOf.at, ''), by: String(e.rollbackOf.by || ''), why: String(e.rollbackOf.why || '').slice(0, LIMITS.textMax) } : null,
    };
  }
  return s;
}
const modeEntry = (state, id) => state?.services?.[id] || { mode: 'container', since: state?.at || '', by: '', runs: 0, drift: 0, lastDriftAt: '', rollbackOf: null };
/** The mode of one service: its own entry, else the document default (container). The host API is always host once it answers. */
export function modeOf(state, id) { return id === DEFAULTS.hostApiId ? 'host' : modeEntry(state, id).mode; }

/** What each side does in a mode: the one table both the console and the host runner read. */
export const MODE_PLAN = Object.freeze({
  container: { containerRuns: true, hostRuns: false, hostDryRun: false, unitEnabled: false, cronPresent: true, readsFrom: 'container', actionsOn: 'container' },
  shadow: { containerRuns: true, hostRuns: true, hostDryRun: true, unitEnabled: true, cronPresent: true, readsFrom: 'container', actionsOn: 'container' },
  host: { containerRuns: false, hostRuns: true, hostDryRun: false, unitEnabled: true, cronPresent: false, readsFrom: 'host', actionsOn: 'host' },
});
/** The plan for one service in a mode, with the concrete things to switch (its unit, timer, cron files, container loops). */
export function modePlan(manifest, mode) {
  const m = normManifest(manifest);
  const p = MODE_PLAN[MODES.includes(mode) ? mode : 'container'];
  return {
    id: m.id, mode: MODES.includes(mode) ? mode : 'container', ...p,
    unit: m.unit, timer: m.kind === 'tick' ? m.timer : '', units: p.unitEnabled ? [m.kind === 'tick' ? m.timer : m.unit] : [],
    cron: m.replaces.filter((r) => r.kind === 'cron').map((r) => r.name), cronFiles: m.replaces.filter((r) => r.kind === 'cron').map((r) => `/etc/cron.d/${r.name}`),
    containerLoops: m.replaces.filter((r) => r.kind !== 'cron').map((r) => ({ kind: r.kind, name: r.name, where: r.where, runs: p.containerRuns })),
    env: { AXF_HOST_MODE: p.hostRuns ? (p.hostDryRun ? 'shadow' : 'host') : 'off' },
  };
}

/**
 * May `id` go `to`? ctx = { now (ISO), state (host-service-state@1 of this service now), modes (id → mode of the others,
 * for `after`), unitInstalled, hostApiUp, acceptDrift: [ids…], minShadowMs?, minRuns? }. Answers { ok, event, reason }.
 */
export function canChangeMode(modeState, manifest, to, ctx = {}) {
  const m = normManifest(manifest);
  if (m.id === DEFAULTS.hostApiId) return { ok: false, event: '', reason: 'host-api has no mode: it is the host side' };
  if (m.adopted) return { ok: false, event: '', reason: `${m.id} is adopted: it already runs on the host and has no mode` };
  const from = modeOf(modeState, m.id);
  if (!MODES.includes(to)) return { ok: false, event: '', reason: `unknown mode "${to}"` };
  const event = Object.keys(MODE_TRANSITIONS).find((e) => MODE_TRANSITIONS[e][0] === from && MODE_TRANSITIONS[e][1] === to) || '';
  if (!event) return { ok: false, event, reason: from === to ? `${m.id} is already ${to}` : `no way from ${from} to ${to}${from === 'container' && to === 'host' ? ': shadow first' : ''}` };
  if (event === 'roll-back' || event === 'back-to-container') return { ok: true, event, reason: '' };
  if (ctx.hostApiUp === false) return { ok: false, event, reason: 'the host API is down' };
  if (event === 'start-shadow' && ctx.unitInstalled === false) return { ok: false, event, reason: `${m.unit} is not installed (run the host services installer)` };
  if (event === 'cut-over') {
    const e = modeEntry(modeState, m.id);
    const now = Date.parse(iso(ctx.now, '')) || 0;
    const minMs = Number.isFinite(ctx.minShadowMs) ? ctx.minShadowMs : MODE_GUARDS.minShadowMs;
    const minRuns = Number.isInteger(ctx.minRuns) ? ctx.minRuns : MODE_GUARDS.minRuns;
    const accepted = Array.isArray(ctx.acceptDrift) ? ctx.acceptDrift.length : 0;
    for (const a of m.after) if ((ctx.modes || {})[a] !== 'host') return { ok: false, event, reason: `${a} must be in host first (it is ${(ctx.modes || {})[a] || 'container'})` };
    if (!now) return { ok: false, event, reason: 'cut-over needs the clock (ctx.now)' };
    if (e.drift > accepted + MODE_GUARDS.maxDrift) return { ok: false, event, reason: `${e.drift} shadow drift entr${e.drift === 1 ? 'y' : 'ies'} (accepted ${accepted}): read the shadow log first` };
    const quietFrom = Math.max(Date.parse(e.since) || 0, Date.parse(e.lastDriftAt) || 0);
    if (now - quietFrom < minMs) return { ok: false, event, reason: `shadow has been quiet for ${Math.max(0, Math.round((now - quietFrom) / 60000))} min, needs ${Math.round(minMs / 60000)}` };
    if (e.runs < minRuns) return { ok: false, event, reason: `${e.runs} clean host run${e.runs === 1 ? '' : 's'} in shadow, needs ${minRuns}` };
    if (!ctx.state || ctx.state.status !== 'up') return { ok: false, event, reason: `the host copy is ${ctx.state?.status || 'unknown'}${ctx.state?.reason ? ` (${ctx.state.reason})` : ''}, needs up` };
  }
  return { ok: true, event, reason: '' };
}

/** Move one service (or `ids`) to `to`; returns the new document and the changes; throws invalid_body when a guard refuses. */
export function changeMode(modeState, manifests, { id, ids, to, at, by = 'svc:cli', why = '', ctx = {} }) {
  const when = iso(at, '') || fail('invalid_body', 'changeMode needs `at` (ISO UTC)');
  const set = normManifests(manifests).manifests;
  const byId = new Map(set.map((m) => [m.id, m]));
  const next = JSON.parse(JSON.stringify(modeState));
  const list = Array.isArray(ids) ? ids : [id];
  const changes = [];
  for (const sid of list) {
    const m = byId.get(sid) || fail('unknown_service', `no manifest for ${sid}`, { service: sid });
    const modes = Object.fromEntries(set.map((x) => [x.id, modeOf(next, x.id)]));
    const can = canChangeMode(next, m, to, { ...ctx, now: ctx.now || when, modes: { ...modes, ...(ctx.modes || {}) } });
    if (!can.ok) fail('invalid_body', `${sid}: ${can.reason}`, { service: sid });
    const prev = modeEntry(next, sid);
    const rollback = can.event === 'roll-back' || can.event === 'step-back' || can.event === 'back-to-container';
    next.services[sid] = {
      mode: to, since: when, by, runs: 0, drift: 0, lastDriftAt: '',
      rollbackOf: rollback ? { from: prev.mode, at: when, by, why: String(why || '').slice(0, LIMITS.textMax) } : null,
    };
    changes.push({ id: sid, from: prev.mode, to, event: can.event, at: when, by, why: String(why || '') });
  }
  next.rev = (Number.isInteger(next.rev) ? next.rev : 0) + 1; next.at = when; next.by = by;
  return { state: next, changes };
}

/** Count a clean host run (shadow) or a drift entry on the service's mode entry. */
export function recordShadowRun(modeState, id, { at, drift = null }) {
  const next = JSON.parse(JSON.stringify(modeState));
  const e = { ...modeEntry(next, id) };
  if (drift) { e.drift += 1; e.lastDriftAt = iso(drift.at, iso(at, e.lastDriftAt)); } else e.runs += 1;
  next.services[id] = e;
  return next;
}
/** host-shadow-drift@1: the host's dry run and the container's real run disagree; null when they agree. */
export function shadowDrift(id, host, container, at) {
  const base = { $axf: DRIFT_FRAME, at: iso(at, '') || fail('invalid_body', 'drift needs `at`'), service: id };
  const eff = (r) => JSON.stringify(Array.isArray(r?.effects) ? r.effects : []);
  if (host && host.error) return { ...base, kind: 'host-error', host: { error: String(host.error).slice(0, 300) }, container: container ? { result: container.result } : null };
  if (container && container.error) return { ...base, kind: 'container-error', host: host ? { result: host.result } : null, container: { error: String(container.error).slice(0, 300) } };
  if (!host && container) return { ...base, kind: 'host-missing', host: null, container: { result: container.result } };
  if (host && !container) return { ...base, kind: 'container-missing', host: { result: host.result }, container: null };
  if (!host && !container) return null;
  if (host.result !== container.result) return { ...base, kind: 'result-differs', host: { result: host.result }, container: { result: container.result } };
  if (eff(host) !== eff(container)) return { ...base, kind: 'effect-differs', host: { effects: host.effects || [] }, container: { effects: container.effects || [] } };
  return null;
}

/** The services in the order to cut them over: tier, then `after` (topological), then id; host-api first. */
export function cutoverOrder(manifests) {
  const set = normManifests(manifests).manifests;
  const tierOf = (id) => { const t = CUTOVER_TIERS.find((x) => x.services.includes(id)); return t ? t.tier : CUTOVER_TIERS.find((x) => x.name === 'rest').tier; };
  const ids = new Set(set.map((m) => m.id));
  const byId = new Map(set.map((m) => [m.id, m]));
  const out = [];
  const seen = new Set();
  const visit = (m, trail = []) => {
    if (seen.has(m.id)) return;
    if (trail.includes(m.id)) fail('invalid_manifest', `after cycle: ${[...trail, m.id].join(' → ')}`, { service: m.id });
    for (const a of m.after) if (ids.has(a)) visit(byId.get(a), [...trail, m.id]);
    seen.add(m.id); out.push(m);
  };
  for (const m of [...set].sort((a, b) => tierOf(a.id) - tierOf(b.id) || a.after.length - b.after.length || a.id.localeCompare(b.id))) visit(m);
  return out.map((m, i) => ({ position: i + 1, id: m.id, tier: tierOf(m.id), tierName: CUTOVER_TIERS.find((x) => x.tier === tierOf(m.id)).name, kind: m.kind, plugin: m.plugin, after: m.after, replaces: m.replaces.map((r) => `${r.kind}:${r.name}`) }));
}
/** The next sensible step for each service: what the CLI and the console's Migration card offer. */
export function migrationNext(modeState, manifests, ctxById = {}) {
  const all = normManifests(manifests).manifests;
  return cutoverOrder(manifests).filter((r) => r.id !== DEFAULTS.hostApiId && !all.find((x) => x.id === r.id)?.adopted).map((r) => {
    const m = all.find((x) => x.id === r.id);
    const mode = modeOf(modeState, r.id);
    const ctx = ctxById[r.id] || {};
    if (mode === 'container') { const c = canChangeMode(modeState, m, 'shadow', ctx); return { ...r, mode, next: c.ok ? 'shadow' : 'install', ...c }; }
    if (mode === 'shadow') { const c = canChangeMode(modeState, m, 'host', ctx); return { ...r, mode, next: c.ok ? 'host' : 'wait', ...c }; }
    return { ...r, mode, next: 'done', ok: true, event: '', reason: '' };
  });
}

/**
 * Rollback, in the order the host API runs it: flip the mode first (both sides read it before every tick, so the
 * container copy resumes on its next tick and the host copy exits `skipped`), then stop the unit and disable the timer,
 * then put the cron files back, then verify the container copy ran. Every step is idempotent; a failed step leaves
 * mode = container (nothing runs twice, the systems check shows what is still off).
 */
export function rollbackSteps(manifest, { to = 'container', by = 'svc:cli', why = '' } = {}) {
  const m = normManifest(manifest);
  const plan = modePlan(m, to);
  const steps = [{ step: 1, do: 'mode', detail: `PUT /v1/services/${m.id}/mode { to: ${to}, by: ${by}${why ? `, why: ${JSON.stringify(why)}` : ''} }`, verify: `GET /v1/services/${m.id}/mode → ${to}` }];
  if (to === 'container') {
    if (m.kind === 'tick') steps.push({ step: 2, do: 'unit', detail: `systemctl disable --now ${m.timer}; systemctl stop ${m.unit}`, verify: `timerState inactive, unitState inactive` });
    else steps.push({ step: 2, do: 'unit', detail: `systemctl stop ${m.unit}`, verify: 'unitState inactive' });
  } else steps.push({ step: 2, do: 'unit', detail: m.kind === 'tick' ? `${m.timer} stays enabled; the next tick runs dry (AXF_HOST_MODE=shadow)` : `systemctl reload-or-restart ${m.unit} (reads the mode, serves dry-run)`, verify: 'health up, shadow log growing' });
  if (plan.cronPresent && plan.cronFiles.length) steps.push({ step: 3, do: 'cron', detail: `restore ${plan.cronFiles.join(', ')} from deploy/install-console.sh (axf_cron_file)`, verify: `${plan.cronFiles.length} cron file(s) present` });
  if (plan.containerLoops.length) steps.push({ step: steps.length + 1, do: 'container', detail: `the console's ${plan.containerLoops.map((l) => `${l.name} (${l.kind})`).join(', ')} read mode ${to} and run again`, verify: `console GET /api/host-services/${m.id} → container.lastRun younger than ${m.health.staleSec} s` });
  steps.push({ step: steps.length + 1, do: 'record', detail: `history.jsonl: roll-back ${m.id} ${by}${why ? `: ${why}` : ''}; health@1 item host-service:${m.id} cleared`, verify: 'the Migration card shows container' });
  return { id: m.id, to, steps };
}
/** One plain line per service for Amber and the CLI. */
export function modeSummary(modeState, manifests) {
  return cutoverOrder(manifests).map((r) => { const e = modeEntry(modeState, r.id); const mode = modeOf(modeState, r.id); return `${r.position}. ${r.id}: ${mode}${r.id === DEFAULTS.hostApiId ? '' : ` since ${e.since || modeState.at}`}${mode === 'shadow' ? `, ${e.runs} clean run${e.runs === 1 ? '' : 's'}${e.drift ? `, ${e.drift} drift` : ''}` : ''}${e.rollbackOf ? ` (rolled back from ${e.rollbackOf.from}${e.rollbackOf.why ? `: ${e.rollbackOf.why}` : ''})` : ''}`; });
}

/** The JSON Schema of the mode file, written to framework/schemas/host-service-mode.json by `axf schemas`. */
export function modeJsonSchema() {
  const entry = {
    type: 'object', required: ['mode', 'since'], additionalProperties: false,
    properties: {
      mode: { enum: MODES }, since: dateTime, by: { type: 'string', maxLength: 80 },
      runs: { type: 'integer', minimum: 0, description: 'shadow: clean host dry-runs since the mode changed' },
      drift: { type: 'integer', minimum: 0, description: `shadow: ${DRIFT_FRAME} entries since the mode changed` }, lastDriftAt: { type: 'string' },
      rollbackOf: { type: ['object', 'null'], required: ['from', 'at'], properties: { from: { enum: MODES }, at: dateTime, by: { type: 'string' }, why: text() }, description: 'set by roll-back, step-back and back-to-container; cleared by the next forward move' },
    },
  };
  return {
    $schema, $id: $id('host-service-mode.json'), title: `${MODE_FRAME} (${SCHEMA}) — where each host service runs today`, type: 'object', additionalProperties: false,
    required: ['$axf', 'rev', 'at', 'default', 'services'],
    properties: {
      $axf: { const: MODE_FRAME }, rev: { type: 'integer', minimum: 0 }, at: dateTime, by: { type: 'string', maxLength: 80 },
      default: { const: 'container', description: 'a service with no entry is in the container; the default never moves (every cut-over is per service, by hand or by the migration CLI)' },
      services: { type: 'object', propertyNames: { pattern: ID_PATTERN }, additionalProperties: entry },
    },
    $defs: { events: { enum: MODE_EVENTS }, transitions: { const: MODE_TRANSITIONS }, guards: { const: MODE_GUARDS }, tiers: { const: CUTOVER_TIERS.map((t) => ({ tier: t.tier, name: t.name, services: t.services })) } },
  };
}
