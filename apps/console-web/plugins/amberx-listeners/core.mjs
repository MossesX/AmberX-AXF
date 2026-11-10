/**
 * AmberX listeners (console side, listener@1; build gizmo-rebuild-fable, Nov 6 2026): every AmberX device's background
 * listeners and their policies, read and written where they live on the hub, so the console page, the REST routes,
 * the MCP tools and the CLI share one implementation.
 *
 * - **Devices:** each AmberX device publishes a listener-state@1 document into the hub table
 *   `/projects/amberx-axf/_data/listeners/devices` (lib-hubstore table: head.json + rows-N.json chunks, one row per
 *   device). This reads the chunks and marks a device stale when its last report is older than DEVICE_STALE_MS.
 * - **Policies:** the per-listener switches are AmberX app settings (`amberx.listeners.<id>.<field>`) in the hub's
 *   settings document `/projects/_shared/_data/settings/apps/amberx-droid.json` (hub-settings@1), the same document
 *   lib-hubsync mirrors onto every device. Writing a value here reaches every phone on its next refresh.
 * - **Restart:** a restart request is the synced key `amberx.listeners.<id>.restart` = now (ISO); the phone's
 *   Listeners plugin restarts the listener when it changes.
 * The registry (ids, labels, defaults) is `framework/libs/listeners/registry.json`; the normalising rules here mirror
 * core.ts (framework/spec/check-listeners.mts compares them).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAME = 'listener-state@1';
export const SETTINGS_FORMAT = 'hub-settings@1';
export const FOLDER = 'amberx-listeners';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const DEVICE_STALE_MS = 10 * 60_000;
export const APP = 'amberx-droid';

export class ListenersError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/* ------------------------------------------------------------------ where things are */

/** The hub's /projects mount (AXF_AMBERX_LISTENERS_PROJECTS or AXHUB_PROJECTS_DIR override it; tests point it at a temp dir). */
export function projectsDir() { return process.env.AXF_AMBERX_LISTENERS_PROJECTS || process.env.AXHUB_PROJECTS_DIR || '/projects'; }
export const live = () => existsSync(projectsDir());
export const devicesDir = () => join(projectsDir(), 'amberx-axf', '_data', 'listeners', 'devices');
export const settingsFile = () => join(projectsDir(), '_shared', '_data', 'settings', 'apps', `${APP}.json`);

/* ------------------------------------------------------------------ registry */

let reg = null;
export function registry() {
  reg ??= readJson(join(ROOT, 'framework', 'libs', 'listeners', 'registry.json')) ?? { defaults: {}, retryChoices: [], micPriority: [], listeners: [] };
  return reg;
}
export const POLICY_FIELDS = ['on', 'pauseOnCall', 'pauseForOtherApps', 'sound', 'retries', 'backoffMs', 'maxBackoffMs', 'cooldownMs'];
export const listenerDef = (id) => registry().listeners.find((l) => l.id === id) ?? { id, label: id, kind: 'mic', side: 'page', about: '' };
export const listenerLabel = (id) => listenerDef(id).label;
export const policyKey = (id, field) => `amberx.listeners.${id}.${field}`;
export const restartKey = (id) => `amberx.listeners.${id}.restart`;
export const validId = (id) => typeof id === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(id);

const bool = (v, d) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d);
const int = (v, d, min, max) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d; };

/** Same clamps as framework/libs/listeners/core.ts normalizePolicy. */
export function normalizePolicy(raw, id = '') {
  const d = { ...registry().defaults, ...(listenerDef(id).defaults ?? {}) };
  const r = raw ?? {};
  const backoff = int(r.backoffMs, d.backoffMs, 100, 600_000);
  return {
    on: bool(r.on, d.on), pauseOnCall: bool(r.pauseOnCall, d.pauseOnCall), pauseForOtherApps: bool(r.pauseForOtherApps, d.pauseForOtherApps), sound: bool(r.sound, d.sound),
    retries: int(r.retries, d.retries, -1, 100), backoffMs: backoff, maxBackoffMs: Math.max(int(r.maxBackoffMs, d.maxBackoffMs, 100, 3_600_000), backoff), cooldownMs: int(r.cooldownMs, d.cooldownMs, 0, 86_400_000),
  };
}
/** The fields a listener's panel shows (what the registry says it is without). */
export function policyFieldsFor(id) {
  const w = new Set(listenerDef(id).without ?? []);
  return ['on', 'pauseOnCall', 'pauseForOtherApps', 'sound', 'retries'].filter((f) => !w.has(f));
}

/* ------------------------------------------------------------------ the settings document (policies) */

export function readSettings() {
  const raw = readJson(settingsFile());
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.$axf === SETTINGS_FORMAT && raw.values && typeof raw.values === 'object' ? raw : null;
  return o ? { $axf: SETTINGS_FORMAT, values: { ...o.values }, updatedAt: String(o.updatedAt ?? ''), updatedBy: String(o.updatedBy ?? '') } : { $axf: SETTINGS_FORMAT, values: {}, updatedAt: '', updatedBy: '' };
}

function writeSettings(doc) {
  const f = settingsFile();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, f);
}

/** A listener's policy from the hub's settings values. */
export function policyOf(values, id) {
  const raw = {};
  for (const f of POLICY_FIELDS) { const v = values[policyKey(id, f)]; if (v !== undefined && v !== null && v !== '') raw[f] = v; }
  return normalizePolicy(raw, id);
}

/** Every known listener's policy (+ any listener id that has keys in the document) and the raw values. */
export function policies() {
  const doc = readSettings();
  const ids = new Set(registry().listeners.map((l) => l.id));
  for (const k of Object.keys(doc.values)) { const m = /^amberx\.listeners\.([a-z0-9-]+)\./.exec(k); if (m) ids.add(m[1]); }
  const out = {};
  for (const id of ids) out[id] = { ...policyOf(doc.values, id), label: listenerLabel(id), fields: policyFieldsFor(id), restartAskedAt: typeof doc.values[restartKey(id)] === 'string' ? doc.values[restartKey(id)] : '' };
  return { ok: true, live: live(), file: settingsFile(), updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, policies: out, publish: doc.values['amberx.listeners.publish'] !== false };
}

/**
 * Set a listener's policy on the hub (some or all fields; strings for numbers are fine). Every phone picks it up on
 * its next settings refresh. Returns the policy as it now stands.
 */
export function setPolicy(id, patch, by = 'console') {
  if (!validId(id)) throw new ListenersError('invalid', 'not a listener id (letters, digits, dashes)');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ListenersError('invalid', 'send { id, policy: { field: value } }');
  const unknown = Object.keys(patch).filter((k) => !POLICY_FIELDS.includes(k));
  if (unknown.length) throw new ListenersError('invalid', `unknown policy field(s): ${unknown.join(', ')} (allowed: ${POLICY_FIELDS.join(', ')})`);
  const doc = readSettings();
  const next = normalizePolicy({ ...policyOf(doc.values, id), ...patch }, id);
  for (const f of Object.keys(patch)) {
    const v = next[f];
    doc.values[policyKey(id, f)] = typeof v === 'boolean' ? v : f === 'retries' ? String(v) : v;
  }
  doc.updatedAt = new Date().toISOString();
  doc.updatedBy = by;
  writeSettings(doc);
  return { ok: true, id, label: listenerLabel(id), policy: next, file: settingsFile(), live: live() };
}

/** Ask every phone to restart a listener (the synced restart key = now). */
export function requestRestart(id, by = 'console') {
  if (!validId(id)) throw new ListenersError('invalid', 'not a listener id');
  const def = listenerDef(id);
  if (def.side !== 'native' || (def.without ?? []).includes('on')) throw new ListenersError('invalid', `${listenerLabel(id)} can't be restarted from here`);
  const doc = readSettings();
  const at = new Date().toISOString();
  doc.values[restartKey(id)] = at;
  doc.updatedAt = at;
  doc.updatedBy = by;
  writeSettings(doc);
  return { ok: true, id, label: listenerLabel(id), restartAskedAt: at };
}

/* ------------------------------------------------------------------ devices (the hub table) */

/** The words people see for a yield reason (= core.ts yieldLabel). */
export function yieldLabel(reason) {
  switch (reason) {
    case null: case undefined: case '': return 'Listening';
    case 'mic-off': return 'Mic off';
    case 'call': return 'Paused: a call is using the microphone';
    case 'other-app': case 'silenced': return 'Paused: another app is using the microphone';
    default: return 'Paused';
  }
}
/** = core.ts stateLabel. */
export function stateLabel(l) {
  switch (l.state) {
    case 'off': return l.policy?.on === false ? 'Not allowed' : 'Off';
    case 'starting': return 'Starting…';
    case 'on': return l.detail || 'Listening';
    case 'paused': return l.detail ? `Paused: ${l.detail}` : 'Paused';
    case 'yielded': return yieldLabel(l.detail || 'other-app');
    case 'error': return l.detail ? `Stopped: ${l.detail}` : 'Stopped after errors';
    case 'unavailable': return l.detail || 'Not available here';
    default: return String(l.state ?? '');
  }
}
/** = core.ts deviceSummary. */
export function deviceSummary(d) {
  const n = (s) => (d.listeners ?? []).filter((l) => l.state === s).length;
  const parts = [];
  if (d.micOff) parts.push('Mic off');
  if (n('on')) parts.push(`${n('on')} listening`);
  if (n('yielded') + n('paused')) parts.push(`${n('yielded') + n('paused')} paused`);
  if (n('error')) parts.push(`${n('error')} stopped on errors`);
  if (!n('on') && !n('yielded') && !n('paused') && !n('error')) parts.push('nothing listening');
  if (d.micHolder) parts.push(`mic: ${listenerLabel(d.micHolder)}`);
  return parts.join(' · ');
}

/** The raw device rows from the hub table's chunks (any file rows-*.json; the head is not needed to read). */
export function readDeviceRows() {
  const dir = devicesDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => /^rows-\d+\.json$/.test(n)).sort()) {
    const chunk = readJson(join(dir, f));
    if (chunk && typeof chunk === 'object' && !Array.isArray(chunk)) for (const row of Object.values(chunk)) out.push(row);
  }
  return out;
}

/** Every device, newest first, each listener row filled with its state words and the hub's policy; stale marked. */
export function devices(now = Date.now()) {
  const values = readSettings().values;
  const list = [];
  for (const d of readDeviceRows()) {
    if (!d || d.$axf !== FRAME || typeof d.device !== 'string' || !Array.isArray(d.listeners) || typeof d.at !== 'number') continue;
    const listeners = d.listeners.filter((l) => l && typeof l.id === 'string').map((l) => {
      const policy = policyOf(values, l.id);
      const row = { ...l, label: l.label || listenerLabel(l.id), policy, fields: policyFieldsFor(l.id) };
      row.stateLabel = stateLabel(row);
      return row;
    });
    list.push({ ...d, listeners, stale: now - d.at > DEVICE_STALE_MS, summary: deviceSummary({ ...d, listeners }) });
  }
  list.sort((a, b) => b.at - a.at);
  return { ok: true, live: live(), dir: devicesDir(), count: list.length, devices: list };
}

/** Everything at once (the MCP read): devices + policies + the registry. */
export function state(now = Date.now()) {
  const d = devices(now);
  const p = policies();
  return { ok: true, live: d.live, devices: d.devices, policies: p.policies, registry: registry().listeners, updatedAt: p.updatedAt, updatedBy: p.updatedBy };
}
