/**
 * library-config@1 + library-instance@1 — the no-code import wizard contract for every library (Brett, library-harvest
 * addendum 1, Nov 7 2026).
 *
 * Every library ships a configuration manifest. It is **derived** from the library's `library.json` (library@1): parts
 * become capabilities, params become settings (secret ones credentials), dependsOn / provides / placeholders carry over.
 * A library says more in an optional `config` block of its library.json (connections to data sets, registry UIs, plugins,
 * services and actions; credentials; wizard mode and intro). The wizard that runs when a library is imported — today
 * through the CLI (`framework/cli/library-config.mjs`), later in the App Designer, over the API / MCP and by voice — is
 * the same ordered list of steps on every surface: about → capabilities → connections → settings → credentials → review.
 * Its result is a **configured instance asset** (library-instance@1) that can be reconfigured, disabled or removed
 * later, and that `installConfig` turns into the `libraries.<key>` block the existing installer already understands.
 *
 * Pure: no I/O, no Date.now() (callers pass `now`). Credentials are references only (`env:NAME`, `secret:KEY`,
 * `hub:PATH`); a value is refused. Kotlin twin deferred (Android on hold), recorded in spec/PORTING.md.
 * Fixture: spec/fixtures/library-config.json, replayed by spec/check-library-config.mts.
 */

export const LIBRARY_CONFIG = 'library-config@1';
export const LIBRARY_INSTANCE = 'library-instance@1';

export const WIZARD_STEP_IDS = ['about', 'capabilities', 'connections', 'settings', 'credentials', 'review'];
export const WIZARD_MODES = ['scripted', 'assisted', 'both'];
export const CONNECTION_KINDS = ['dataset', 'registry-ui', 'plugin', 'service', 'action', 'asset'];
export const CONNECTION_DIRECTIONS = ['in', 'out', 'both'];
export const INSTANCE_STATUSES = ['configured', 'disabled', 'removed'];
export const PARAM_TYPES = ['text', 'list', 'bool', 'number', 'choice'];
export const CREDENTIAL_SCHEMES = ['env', 'secret', 'hub'];

/** What a connection `ref` must start with, per kind. */
export const CONNECTION_REF_PREFIX = { dataset: 'dataset:', 'registry-ui': 'ui:', plugin: 'plugin:', service: 'service:', action: 'action:', asset: 'asset:' };

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const REF_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9_.:/@-]+$/;
const CRED_REF_RE = new RegExp(`^(${CREDENTIAL_SCHEMES.join('|')}):[A-Za-z0-9_.:/-]+$`);
const VALUE_KEYS = ['value', 'token', 'password', 'secret', 'key', 'apiKey', 'api_key'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const arr = (v) => (Array.isArray(v) ? v : []);

/* ------------------------------------------------------------------ manifest */

/**
 * Secret parameters are credentials: `secret: true`, or a key that *is* one (`token`, `apiToken`, `hubPassword`,
 * `clientSecret`, `apiKey`). A key that only mentions one (`tokenKey` = where a token is stored) is a plain setting.
 */
export const isSecretParam = (p) => !!p && (p.secret === true || /(^|[a-z0-9_-])(token|password|passphrase|secret|apikey|api_key|credential)s?$/i.test(String(p.key ?? '')));

function normParam(p) {
  if (!isObj(p)) return null;
  const type = PARAM_TYPES.includes(p.type) ? p.type : 'text';
  const out = { key: str(p.key), label: str(p.label, str(p.key)), type };
  if (p.required) out.required = true;
  if (p.default !== undefined) out.default = p.default;
  if (p.help) out.help = str(p.help);
  if (Array.isArray(p.choices)) out.choices = p.choices.map(String);
  if (typeof p.min === 'number') out.min = p.min;
  if (typeof p.max === 'number') out.max = p.max;
  return out;
}

function capabilityFromPart(p) {
  return {
    id: str(p.id), label: str(p.label, str(p.id)), description: str(p.description),
    default: p.default !== false, requires: arr(p.requires).map(String), params: arr(p.params).map(normParam).filter(Boolean),
  };
}

function normCapability(c) {
  if (!isObj(c)) return null;
  return {
    id: str(c.id), label: str(c.label, str(c.id)), description: str(c.description),
    default: c.default !== false, requires: arr(c.requires).map(String), params: arr(c.params).map(normParam).filter(Boolean),
  };
}

function normConnection(c) {
  if (!isObj(c)) return null;
  const out = {
    id: str(c.id), label: str(c.label, str(c.id)), kind: CONNECTION_KINDS.includes(c.kind) ? c.kind : 'dataset',
    direction: CONNECTION_DIRECTIONS.includes(c.direction) ? c.direction : 'in', required: c.required === true,
  };
  if (c.description) out.description = str(c.description);
  if (Array.isArray(c.accepts)) out.accepts = c.accepts.map(String);
  if (c.many === true) out.many = true;
  if (c.forCapability) out.forCapability = str(c.forCapability);
  return out;
}

function normCredential(c) {
  if (!isObj(c)) return null;
  const out = { key: str(c.key), label: str(c.label, str(c.key)), required: c.required !== false };
  if (c.help) out.help = str(c.help);
  if (c.env) out.env = str(c.env);
  return out;
}

/**
 * The configuration manifest of a library, derived from its library@1 record (`framework/libs/<x>/library.json`) and
 * its optional `config` block. Every existing library gets one without an edit.
 */
export function manifestFrom(lib) {
  if (!isObj(lib)) throw new Error('manifestFrom: a library@1 record is required');
  const cfg = isObj(lib.config) ? lib.config : {};
  const params = arr(lib.params).map(normParam).filter(Boolean);
  const capabilities = cfg.capabilities ? arr(cfg.capabilities).map(normCapability).filter(Boolean) : arr(lib.parts).map(capabilityFromPart);
  const credentials = [
    ...params.filter(isSecretParam).map((p) => ({ key: p.key, label: p.label, required: !!p.required, ...(p.help && { help: p.help }) })),
    ...arr(cfg.credentials).map(normCredential).filter(Boolean),
  ];
  const seen = new Set();
  const m = {
    $axf: LIBRARY_CONFIG,
    library: str(lib.id), module: str(lib.module), version: str(lib.version, '1.0.0'),
    name: str(lib.name, str(lib.id)), description: str(lib.description),
    manifestKey: str(lib.manifestKey, lib.module ? `libraries.${String(lib.module).replace(/^lib-/, '')}` : ''),
    capabilities,
    settings: params.filter((p) => !isSecretParam(p)),
    connections: arr(cfg.connections).map(normConnection).filter(Boolean),
    credentials: credentials.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true))),
    dependsOn: arr(lib.dependsOn).map(String), provides: arr(lib.provides).map(String),
    ports: Object.keys(isObj(lib.ports) ? lib.ports : {}),
    notYet: arr(lib.placeholders).filter(isObj).map((p) => ({ capability: str(p.capability), note: str(p.note) })),
    wizard: { mode: WIZARD_MODES.includes(cfg.wizard?.mode) ? cfg.wizard.mode : 'both', intro: str(cfg.wizard?.intro, str(lib.description)) },
  };
  m.wizard.steps = wizardSteps(m).map((s) => s.id);
  return m;
}

/** Why a manifest is not acceptable (empty = fine). */
export function manifestErrors(m) {
  const e = [];
  if (!isObj(m)) return ['not an object'];
  if (m.$axf !== LIBRARY_CONFIG) e.push(`$axf must be ${LIBRARY_CONFIG}`);
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(str(m.library))) e.push(`library "${m.library}" is not a dotted library id (ai.amberx.axf.<name>)`);
  if (!/^\d+\.\d+\.\d+/.test(str(m.version))) e.push(`version "${m.version}" is not semver`);
  if (!str(m.name)) e.push('name is required');
  const capIds = new Set();
  for (const c of arr(m.capabilities)) {
    if (!ID_RE.test(str(c.id))) e.push(`capability id "${c.id}" is not kebab-case`);
    if (capIds.has(c.id)) e.push(`capability "${c.id}" is listed twice`); capIds.add(c.id);
    for (const r of arr(c.requires)) if (!arr(m.capabilities).some((x) => x.id === r)) e.push(`capability "${c.id}" requires unknown "${r}"`);
    for (const p of arr(c.params)) if (!ID_RE.test(str(p.key).toLowerCase())) e.push(`capability "${c.id}" param key "${p.key}" is not an id`);
  }
  const connIds = new Set();
  for (const c of arr(m.connections)) {
    if (!ID_RE.test(str(c.id))) e.push(`connection id "${c.id}" is not kebab-case`);
    if (connIds.has(c.id)) e.push(`connection "${c.id}" is listed twice`); connIds.add(c.id);
    if (!CONNECTION_KINDS.includes(c.kind)) e.push(`connection "${c.id}" kind "${c.kind}" is not one of ${CONNECTION_KINDS.join(', ')}`);
    if (!CONNECTION_DIRECTIONS.includes(c.direction)) e.push(`connection "${c.id}" direction "${c.direction}" is not in | out | both`);
    if (c.forCapability && !capIds.has(c.forCapability)) e.push(`connection "${c.id}" is for unknown capability "${c.forCapability}"`);
  }
  const keys = new Set();
  for (const p of [...arr(m.settings), ...arr(m.credentials)]) {
    if (!str(p.key)) e.push('a setting or credential has no key');
    if (keys.has(p.key)) e.push(`setting / credential "${p.key}" is listed twice`); keys.add(p.key);
  }
  for (const c of arr(m.credentials)) for (const k of VALUE_KEYS) if (k !== 'key' && c[k] !== undefined) e.push(`credential "${c.key}" carries a ${k}: credentials are references only`);
  if (!isObj(m.wizard) || !WIZARD_MODES.includes(m.wizard.mode)) e.push('wizard.mode must be scripted | assisted | both');
  return e;
}

/* ------------------------------------------------------------------ wizard */

/** The wizard's steps for a manifest, in order; steps with nothing to ask are left out (about and review always stay). */
export function wizardSteps(m) {
  const caps = arr(m.capabilities);
  const steps = [];
  steps.push({
    id: 'about', title: `About ${m.name}`,
    ask: `${m.name}: ${(m.description || 'no description yet').replace(/\.\s*$/, '')}.${caps.length ? ` It can ${caps.map((c) => c.label.toLowerCase()).join(', ')}.` : ''}${arr(m.dependsOn).length ? ` Needs ${m.dependsOn.join(', ')}.` : ''}`,
    fields: [],
  });
  if (caps.length) {
    steps.push({
      id: 'capabilities', title: 'What do you want it to do?', ask: 'Pick what the library should do for you. Everything on by default stays on unless you turn it off.',
      fields: caps.map((c) => ({ id: c.id, label: c.label, type: 'bool', default: c.default, help: c.description, requires: c.requires, params: c.params })),
    });
  }
  const conns = arr(m.connections);
  if (conns.length) {
    steps.push({
      id: 'connections', title: 'Connect inputs and outputs', ask: 'Say where each input comes from and where each output goes: a data set, a registry UI, a plugin, a service, an action or an asset.',
      fields: conns.map((c) => ({ id: c.id, label: c.label, type: 'ref', kind: c.kind, direction: c.direction, required: c.required, accepts: c.accepts ?? [], many: !!c.many, help: c.description ?? '', forCapability: c.forCapability ?? '' })),
    });
  }
  const settings = arr(m.settings);
  if (settings.length) {
    steps.push({ id: 'settings', title: 'Settings', ask: 'The settings this library needs. Defaults are filled in.', fields: settings.map((p) => ({ id: p.key, label: p.label, type: p.type, default: p.default, required: !!p.required, help: p.help ?? '', choices: p.choices ?? [], min: p.min, max: p.max })) });
  }
  const creds = arr(m.credentials);
  if (creds.length) {
    steps.push({ id: 'credentials', title: 'Credentials', ask: 'Point each credential at where it is kept (an environment variable, the secret store or the hub). Values are never saved here.', fields: creds.map((c) => ({ id: c.key, label: c.label, type: 'credential-ref', required: c.required !== false, help: c.help ?? '', env: c.env ?? '' })) });
  }
  steps.push({ id: 'review', title: 'Review and apply', ask: 'Check what will be set up, then apply. You can reconfigure or remove it later.', fields: [] });
  return steps;
}

/** An empty draft of answers for a manifest (capabilities at their defaults, settings at theirs). */
export function newDraft(m) {
  const d = { capabilities: {}, params: {}, connections: {}, credentials: {} };
  for (const c of arr(m.capabilities)) d.capabilities[c.id] = c.default ? paramDefaults(c.params) : false;
  for (const p of arr(m.settings)) if (p.default !== undefined) d.params[p.key] = p.default;
  return d;
}

function paramDefaults(params) {
  const out = {};
  for (const p of arr(params)) if (p.default !== undefined) out[p.key] = p.default;
  return out;
}

/** Coerce one typed answer (text or JSON) to a param's type; returns { value } or { error }. */
export function coerceParam(p, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (p.required && p.default === undefined) return { error: `"${p.label}" is required` };
    return { value: p.default };
  }
  switch (p.type) {
    case 'bool': return { value: typeof raw === 'boolean' ? raw : /^(true|yes|y|on|1)$/i.test(String(raw)) };
    case 'number': { const n = Number(raw); if (Number.isNaN(n)) return { error: `"${p.label}" must be a number` }; if (p.min != null && n < p.min) return { error: `"${p.label}" must be at least ${p.min}` }; if (p.max != null && n > p.max) return { error: `"${p.label}" must be at most ${p.max}` }; return { value: n }; }
    case 'list': return { value: Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,\n]/).map((s) => s.trim()).filter(Boolean) };
    case 'choice': { const v = String(raw); if (p.choices?.length && !p.choices.includes(v)) return { error: `"${p.label}" must be one of ${p.choices.join(', ')}` }; return { value: v }; }
    default: return { value: String(raw) };
  }
}

/**
 * Apply one step's answers to a draft (scripted config, an AI-assisted dialog or a voice turn all end up here).
 * Returns { draft, errors }. Never mutates.
 *   capabilities: { [capId]: boolean | { [paramKey]: value } }
 *   connections:  { [connId]: "dataset:x" | ["dataset:x", …] }
 *   settings:     { [key]: value }
 *   credentials:  { [key]: "env:NAME" | "secret:KEY" | "hub:PATH" | { ref } }
 */
export function answerStep(m, draft, stepId, answers) {
  const d = structuredClone(draft ?? newDraft(m));
  const errors = [];
  const a = isObj(answers) ? answers : {};
  if (stepId === 'capabilities') {
    for (const [id, v] of Object.entries(a)) {
      const cap = arr(m.capabilities).find((c) => c.id === id);
      if (!cap) { errors.push(`no capability "${id}"`); continue; }
      if (v === false) { d.capabilities[id] = false; continue; }
      const given = isObj(v) ? v : {};
      const cfg = {};
      for (const p of cap.params ?? []) { const r = coerceParam(p, given[p.key]); if (r.error) errors.push(`${cap.label}: ${r.error}`); else if (r.value !== undefined) cfg[p.key] = r.value; }
      d.capabilities[id] = cfg;
    }
    // requires: turning a capability on brings what it needs
    for (const c of arr(m.capabilities)) if (d.capabilities[c.id] !== false) for (const r of c.requires ?? []) if (d.capabilities[r] === false) d.capabilities[r] = paramDefaults(arr(m.capabilities).find((x) => x.id === r)?.params);
  } else if (stepId === 'connections') {
    for (const [id, v] of Object.entries(a)) {
      const conn = arr(m.connections).find((c) => c.id === id);
      if (!conn) { errors.push(`no connection "${id}"`); continue; }
      const refs = (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined && x !== null && x !== '').map(String);
      const prefix = CONNECTION_REF_PREFIX[conn.kind];
      const bad = refs.filter((r) => !REF_RE.test(r) || !r.startsWith(prefix));
      if (bad.length) { errors.push(`${conn.label}: ${bad.join(', ')} should look like ${prefix}<id>`); continue; }
      if (refs.length > 1 && !conn.many) { errors.push(`${conn.label} takes one connection`); continue; }
      if (!refs.length) delete d.connections[id]; else d.connections[id] = conn.many ? refs : refs[0];
    }
  } else if (stepId === 'settings') {
    for (const [key, v] of Object.entries(a)) {
      const p = arr(m.settings).find((x) => x.key === key);
      if (!p) { errors.push(`no setting "${key}"`); continue; }
      const r = coerceParam(p, v); if (r.error) errors.push(r.error); else if (r.value === undefined) delete d.params[key]; else d.params[key] = r.value;
    }
  } else if (stepId === 'credentials') {
    for (const [key, v] of Object.entries(a)) {
      const c = arr(m.credentials).find((x) => x.key === key);
      if (!c) { errors.push(`no credential "${key}"`); continue; }
      if (isObj(v) && VALUE_KEYS.some((k) => k !== 'key' && v[k] !== undefined)) { errors.push(`${c.label}: credentials are references only (env:NAME, secret:KEY, hub:PATH), never a value`); continue; }
      const ref = isObj(v) ? str(v.ref) : str(v);
      if (!ref) { delete d.credentials[key]; continue; }
      if (!CRED_REF_RE.test(ref)) { errors.push(`${c.label}: "${ref}" is not a credential reference (env:NAME, secret:KEY, hub:PATH)`); continue; }
      d.credentials[key] = { ref };
    }
  } else if (stepId !== 'about' && stepId !== 'review') errors.push(`no wizard step "${stepId}"`);
  return { draft: d, errors };
}

/** What still blocks apply (required capability params, connections, settings and credentials). */
export function draftErrors(m, draft) {
  const e = [];
  const d = draft ?? newDraft(m);
  const on = new Set(Object.entries(d.capabilities ?? {}).filter(([, v]) => v !== false).map(([k]) => k));
  for (const c of arr(m.capabilities)) {
    if (!on.has(c.id)) continue;
    for (const r of c.requires ?? []) if (!on.has(r)) e.push(`${c.label} needs ${r}`);
    const cfg = isObj(d.capabilities[c.id]) ? d.capabilities[c.id] : {};
    for (const p of c.params ?? []) if (p.required && cfg[p.key] === undefined && p.default === undefined) e.push(`${c.label}: "${p.label}" is required`);
  }
  for (const c of arr(m.connections)) {
    if (c.forCapability && !on.has(c.forCapability)) continue;
    if (c.required && !d.connections?.[c.id]) e.push(`connect "${c.label}" (${CONNECTION_REF_PREFIX[c.kind]}…)`);
  }
  for (const p of arr(m.settings)) if (p.required && d.params?.[p.key] === undefined && p.default === undefined) e.push(`setting "${p.label}" is required`);
  for (const c of arr(m.credentials)) if (c.required !== false && !d.credentials?.[c.key]?.ref) e.push(`credential "${c.label}" needs a reference`);
  return e;
}

/* ------------------------------------------------------------------ instance */

/** Turn a finished draft into a configured instance asset (library-instance@1). Throws on draft errors. */
export function instanceFrom(m, draft, meta) {
  const errs = [...manifestErrors(m), ...draftErrors(m, draft)];
  if (errs.length) throw new Error(`cannot configure ${m.name}: ${errs.join('; ')}`);
  const now = str(meta?.now); if (!now) throw new Error('instanceFrom: meta.now (ISO) is required');
  const id = str(meta?.id) || `${m.library.split('.').pop()}-${str(meta?.app, 'app')}`;
  if (!ID_RE.test(id)) throw new Error(`instance id "${id}" is not an id`);
  const d = draft ?? newDraft(m);
  return {
    $axf: LIBRARY_INSTANCE, id, library: m.library, version: m.version, app: str(meta?.app), status: 'configured',
    createdAt: now, updatedAt: now,
    capabilities: arr(m.capabilities).filter((c) => d.capabilities?.[c.id] !== false).map((c) => c.id),
    capabilityParams: Object.fromEntries(arr(m.capabilities).filter((c) => isObj(d.capabilities?.[c.id]) && Object.keys(d.capabilities[c.id]).length).map((c) => [c.id, d.capabilities[c.id]])),
    params: { ...(d.params ?? {}) },
    connections: Object.fromEntries(Object.entries(d.connections ?? {}).map(([k, v]) => [k, { kind: arr(m.connections).find((c) => c.id === k)?.kind ?? 'dataset', ref: v }])),
    credentials: Object.fromEntries(Object.entries(d.credentials ?? {}).map(([k, v]) => [k, { ref: v.ref }])),
    history: [{ at: now, by: str(meta?.by, 'wizard'), kind: 'configured', note: str(meta?.note, `Configured through the ${str(meta?.surface, 'wizard')}`) }],
  };
}

/** Why an instance is not acceptable against its manifest (empty = fine). */
export function instanceErrors(m, inst) {
  const e = [];
  if (!isObj(inst)) return ['not an object'];
  if (inst.$axf !== LIBRARY_INSTANCE) e.push(`$axf must be ${LIBRARY_INSTANCE}`);
  if (!ID_RE.test(str(inst.id))) e.push(`id "${inst.id}" is not an id`);
  if (inst.library !== m.library) e.push(`library "${inst.library}" is not ${m.library}`);
  if (!INSTANCE_STATUSES.includes(inst.status)) e.push(`status "${inst.status}" is not configured | disabled | removed`);
  for (const k of ['createdAt', 'updatedAt']) if (Number.isNaN(Date.parse(str(inst[k])))) e.push(`${k} is not an ISO time`);
  for (const c of arr(inst.capabilities)) if (!arr(m.capabilities).some((x) => x.id === c)) e.push(`unknown capability "${c}"`);
  for (const [k, v] of Object.entries(isObj(inst.connections) ? inst.connections : {})) {
    const conn = arr(m.connections).find((c) => c.id === k);
    if (!conn) { e.push(`unknown connection "${k}"`); continue; }
    for (const r of arr(Array.isArray(v?.ref) ? v.ref : [v?.ref])) if (!str(r).startsWith(CONNECTION_REF_PREFIX[conn.kind])) e.push(`connection "${k}" ref "${r}" should start with ${CONNECTION_REF_PREFIX[conn.kind]}`);
  }
  for (const [k, v] of Object.entries(isObj(inst.credentials) ? inst.credentials : {})) {
    if (!arr(m.credentials).some((c) => c.key === k)) e.push(`unknown credential "${k}"`);
    if (!CRED_REF_RE.test(str(v?.ref))) e.push(`credential "${k}" is not a reference`);
    for (const vk of VALUE_KEYS) if (vk !== 'key' && isObj(v) && v[vk] !== undefined) e.push(`credential "${k}" carries a ${vk}: references only`);
  }
  if (inst.status !== 'removed') e.push(...draftErrors(m, draftFromInstance(m, inst)));
  return e;
}

/** The draft that reproduces an instance (what a reconfigure wizard starts from). */
export function draftFromInstance(m, inst) {
  const d = { capabilities: {}, params: { ...(isObj(inst.params) ? inst.params : {}) }, connections: {}, credentials: {} };
  const on = new Set(arr(inst.capabilities));
  for (const c of arr(m.capabilities)) d.capabilities[c.id] = on.has(c.id) ? { ...paramDefaults(c.params), ...(isObj(inst.capabilityParams?.[c.id]) ? inst.capabilityParams[c.id] : {}) } : false;
  for (const [k, v] of Object.entries(isObj(inst.connections) ? inst.connections : {})) if (v?.ref !== undefined) d.connections[k] = v.ref;
  for (const [k, v] of Object.entries(isObj(inst.credentials) ? inst.credentials : {})) if (v?.ref) d.credentials[k] = { ref: v.ref };
  return d;
}

/** Reconfigure: a new draft on an existing instance; keeps id, app, createdAt and history. */
export function reconfigure(m, inst, draft, meta) {
  const next = instanceFrom(m, draft, { ...meta, id: inst.id, app: inst.app });
  return {
    ...next, createdAt: inst.createdAt, status: inst.status === 'removed' ? 'configured' : inst.status,
    history: [...arr(inst.history), { at: str(meta?.now), by: str(meta?.by, 'wizard'), kind: 'reconfigured', note: str(meta?.note, 'Reconfigured') }],
  };
}

/** Disable, enable or remove an instance (removed instances stay as a record; nothing is deleted). */
export function setStatus(inst, status, meta) {
  if (!INSTANCE_STATUSES.includes(status)) throw new Error(`status must be ${INSTANCE_STATUSES.join(' | ')}`);
  const now = str(meta?.now); if (!now) throw new Error('setStatus: meta.now (ISO) is required');
  const kind = status === 'removed' ? 'removed' : status === 'disabled' ? 'disabled' : 'enabled';
  return { ...inst, status, updatedAt: now, history: [...arr(inst.history), { at: now, by: str(meta?.by, 'wizard'), kind, note: str(meta?.note, kind) }] };
}

/**
 * The `libraries.<key>` block the installer writes into an app's axf.manifest.json for this instance: library params at
 * the top level, `parts` = on capabilities with their params (what `core/library.ts` partOn / partParams read), plus
 * `connections` and `credentials` (references only) and the instance id, so a running app can find its way back.
 */
export function installConfig(m, inst) {
  const parts = {};
  for (const id of arr(inst.capabilities)) parts[id] = { ...paramDefaults(arr(m.capabilities).find((c) => c.id === id)?.params), ...(isObj(inst.capabilityParams?.[id]) ? inst.capabilityParams[id] : {}) };
  return { ...(isObj(inst.params) ? inst.params : {}), parts, connections: Object.fromEntries(Object.entries(isObj(inst.connections) ? inst.connections : {}).map(([k, v]) => [k, v.ref])), credentials: Object.fromEntries(Object.entries(isObj(inst.credentials) ? inst.credentials : {}).map(([k, v]) => [k, v.ref])), instance: inst.id };
}

/** Plain words for the review step, a card or a voice read-back. */
export function instanceSummary(m, inst) {
  const on = arr(inst.capabilities).map((id) => arr(m.capabilities).find((c) => c.id === id)?.label ?? id);
  const off = arr(m.capabilities).filter((c) => !arr(inst.capabilities).includes(c.id)).map((c) => c.label);
  const lines = [`${m.name} ${m.version} in ${inst.app || 'this app'} (${inst.status})`];
  if (on.length) lines.push(`Does: ${on.join(', ')}`);
  if (off.length) lines.push(`Off: ${off.join(', ')}`);
  const conns = Object.entries(isObj(inst.connections) ? inst.connections : {});
  if (conns.length) lines.push(`Connected: ${conns.map(([k, v]) => `${arr(m.connections).find((c) => c.id === k)?.label ?? k} → ${Array.isArray(v.ref) ? v.ref.join(', ') : v.ref}`).join('; ')}`);
  const params = Object.entries(isObj(inst.params) ? inst.params : {});
  if (params.length) lines.push(`Settings: ${params.map(([k, v]) => `${arr(m.settings).find((p) => p.key === k)?.label ?? k} = ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('; ')}`);
  const creds = Object.keys(isObj(inst.credentials) ? inst.credentials : {});
  if (creds.length) lines.push(`Credentials: ${creds.map((k) => `${arr(m.credentials).find((c) => c.key === k)?.label ?? k} from ${inst.credentials[k].ref}`).join('; ')}`);
  if (arr(m.notYet).length) lines.push(`Not built yet: ${m.notYet.map((n) => n.capability).join(', ')}`);
  return lines;
}

/* ------------------------------------------------------------------ schema */

const paramSchema = {
  type: 'object', required: ['key', 'label', 'type'], additionalProperties: false,
  properties: { key: { type: 'string' }, label: { type: 'string' }, type: { enum: PARAM_TYPES }, required: { type: 'boolean' }, default: {}, help: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } }, min: { type: 'number' }, max: { type: 'number' } },
};

/** JSON Schemas for both documents (snapshots live in framework/schemas/json/, checked by spec/check-library-config.mts). */
export function jsonSchemas() {
  return {
    'library-config.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/library-config.schema.json',
      title: 'library-config@1: a library\'s no-code configuration manifest', type: 'object', additionalProperties: false,
      required: ['$axf', 'library', 'version', 'name', 'capabilities', 'settings', 'connections', 'credentials', 'wizard'],
      properties: {
        $axf: { const: LIBRARY_CONFIG }, library: { type: 'string', pattern: '^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$' }, module: { type: 'string' },
        version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' }, name: { type: 'string', minLength: 1 }, description: { type: 'string' }, manifestKey: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'object', required: ['id', 'label'], additionalProperties: false, properties: { id: { type: 'string', pattern: ID_RE.source }, label: { type: 'string' }, description: { type: 'string' }, default: { type: 'boolean' }, requires: { type: 'array', items: { type: 'string' } }, params: { type: 'array', items: paramSchema } } } },
        settings: { type: 'array', items: paramSchema },
        connections: { type: 'array', items: { type: 'object', required: ['id', 'label', 'kind', 'direction'], additionalProperties: false, properties: { id: { type: 'string', pattern: ID_RE.source }, label: { type: 'string' }, description: { type: 'string' }, kind: { enum: CONNECTION_KINDS }, direction: { enum: CONNECTION_DIRECTIONS }, required: { type: 'boolean' }, accepts: { type: 'array', items: { type: 'string' } }, many: { type: 'boolean' }, forCapability: { type: 'string' } } } },
        credentials: { type: 'array', items: { type: 'object', required: ['key', 'label'], additionalProperties: false, properties: { key: { type: 'string' }, label: { type: 'string' }, required: { type: 'boolean' }, help: { type: 'string' }, env: { type: 'string' } } } },
        dependsOn: { type: 'array', items: { type: 'string' } }, provides: { type: 'array', items: { type: 'string' } }, ports: { type: 'array', items: { type: 'string' } },
        notYet: { type: 'array', items: { type: 'object', required: ['capability'], properties: { capability: { type: 'string' }, note: { type: 'string' } } } },
        wizard: { type: 'object', required: ['mode', 'steps'], additionalProperties: false, properties: { mode: { enum: WIZARD_MODES }, intro: { type: 'string' }, steps: { type: 'array', items: { enum: WIZARD_STEP_IDS } } } },
      },
    },
    'library-instance.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/library-instance.schema.json',
      title: 'library-instance@1: a configured library in one app', type: 'object', additionalProperties: false,
      required: ['$axf', 'id', 'library', 'version', 'status', 'createdAt', 'updatedAt', 'capabilities'],
      properties: {
        $axf: { const: LIBRARY_INSTANCE }, id: { type: 'string', pattern: ID_RE.source }, library: { type: 'string' }, version: { type: 'string' }, app: { type: 'string' },
        status: { enum: INSTANCE_STATUSES }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        capabilities: { type: 'array', items: { type: 'string' } }, capabilityParams: { type: 'object', additionalProperties: { type: 'object' } }, params: { type: 'object' },
        connections: { type: 'object', additionalProperties: { type: 'object', required: ['kind', 'ref'], properties: { kind: { enum: CONNECTION_KINDS }, ref: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] } } } },
        credentials: { type: 'object', additionalProperties: { type: 'object', required: ['ref'], additionalProperties: false, properties: { ref: { type: 'string', pattern: CRED_REF_RE.source } } } },
        history: { type: 'array', items: { type: 'object', required: ['at', 'kind'], properties: { at: { type: 'string' }, by: { type: 'string' }, kind: { enum: ['configured', 'reconfigured', 'disabled', 'enabled', 'removed'] }, note: { type: 'string' } } } },
      },
    },
  };
}

/** The registry snapshot (framework/schemas/library-config.json). */
export const REGISTRY = {
  $axf: 'library-config-registry@1',
  wizardSteps: WIZARD_STEP_IDS, wizardModes: WIZARD_MODES, connectionKinds: CONNECTION_KINDS, connectionRefPrefix: CONNECTION_REF_PREFIX,
  connectionDirections: CONNECTION_DIRECTIONS, instanceStatuses: INSTANCE_STATUSES, credentialSchemes: CREDENTIAL_SCHEMES, paramTypes: PARAM_TYPES,
};
