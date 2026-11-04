/**
 * Claude settings (claude-settings@1; build claude-settings, Brett, Nov 3 2026): settings for Claude itself that every
 * Claude session (voice, chat, Claude Code, headless agents) reads before acting.
 *
 * Registry: open, data only. registry.json here, plus registry.d/*.json next to it, plus the hub's
 * claude/registry.json; later entries with the same key replace earlier ones. No code change to add a setting.
 * Store: one document on axHub, `/projects/_shared/_data/claude/settings.json` (every project, every surface; claude.ai
 * reads it with axhub.memory_read project `shared`, area `data`, path `claude/settings.json`). AXF_CLAUDE_SETTINGS_FILE
 * points elsewhere (tests); without /projects it falls back to the plugin's data folder and says so (`live: false`).
 *
 * Who may change what: `owner: true` settings change only with an owner approval, which the transport derives from
 * Brett's signed-in console session (never from a request body, an MCP call, a CLI flag or the environment);
 * `owner: "raise"` numbers may be lowered by anyone and raised only by the owner; `locked` settings change for nobody.
 * The No wait switch itself does nothing here: the console server turns it into a standing all-scope veto pass
 * (control-pass@1, token-control) with the same owner approval, and revokes it when the switch goes off.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nonHumanSource } from '../../../../framework/core/model-switch.mjs';

export const FRAME = 'claude-settings@1';
export const FOLDER = 'claude-settings';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const DATA_DIR = process.env.AXF_CLAUDE_SETTINGS_DATA || join(ROOT, '.axf-console', 'plugins', FOLDER);
export const KINDS = ['toggle', 'choice', 'number', 'text', 'time'];
export const LEVELS = ['simple', 'basic', 'developer', 'administrator'];
/** Ways an owner approval may arrive (set by the console server from the request, never by a caller). */
export const OWNER_VIA = ['console', 'local'];
/** Pass minutes per No wait duration ("until off" = the pass maximum, renewed before it ends). */
export const NO_WAIT_MINUTES = { '1h': 60, '4h': 240, untilOff: 240 };
/** "Until off" renews the pass when less than this is left. */
export const RENEW_BEFORE_MS = 30 * 60 * 1000;
/** Settings whose change while No wait is on means the pass has to be granted again. */
export const PASS_KEYS = ['noWait.enabled', 'noWait.includeIrreversible', 'noWait.duration'];

export class SettingsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/* ------------------------------------------------------------------ where things are */

/** The hub's shared data folder (/projects/_shared/_data), or null when the hub isn't mounted here. */
export function hubShared() {
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return existsSync(projects) ? join(projects, '_shared', '_data') : null;
}
/** { file, live }: the settings document and whether it is the hub's copy. */
export function storeFile() {
  if (process.env.AXF_CLAUDE_SETTINGS_FILE) return { file: process.env.AXF_CLAUDE_SETTINGS_FILE, live: true };
  const hub = hubShared();
  return hub ? { file: join(hub, 'claude', 'settings.json'), live: true } : { file: join(DATA_DIR, 'settings.json'), live: false };
}

/* ------------------------------------------------------------------ registry */

function normEntry(e) {
  if (!isObj(e) || typeof e.key !== 'string' || !/^[A-Za-z][\w.-]{0,79}$/.test(e.key)) return null;
  if (!KINDS.includes(e.kind)) return null;
  const out = {
    key: e.key, group: typeof e.group === 'string' ? e.group : 'other', label: String(e.label || e.key).slice(0, 80), kind: e.kind,
    description: String(e.description || '').slice(0, 400), default: e.default, level: LEVELS.includes(e.level) ? e.level : 'basic',
    owner: e.owner === true ? true : e.owner === 'raise' ? 'raise' : false, locked: e.locked === true,
  };
  if (e.kind === 'choice') out.options = (Array.isArray(e.options) ? e.options : []).filter((o) => isObj(o) && typeof o.value === 'string').map((o) => ({ value: o.value, label: String(o.label || o.value) }));
  if (e.kind === 'number') for (const k of ['min', 'max', 'step']) if (typeof e[k] === 'number') out[k] = e[k];
  if (typeof e.shared === 'string') out.shared = e.shared;
  if (typeof e.effect === 'string') out.effect = e.effect;
  return valid(out, out.default) ? out : null;
}

/** Every group and setting: registry.json, registry.d/*.json, then the hub's claude/registry.json (same key = replaced). */
export function loadRegistry({ extra = [] } = {}) {
  const sources = [join(HERE, 'registry.json')];
  const dir = join(HERE, 'registry.d');
  if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (f.endsWith('.json')) sources.push(join(dir, f));
  const hub = hubShared();
  if (hub && !process.env.AXF_CLAUDE_SETTINGS_FILE) sources.push(join(hub, 'claude', 'registry.json'));
  const groups = new Map();
  const settings = new Map();
  for (const doc of [...sources.map(readJson), ...extra]) {
    if (!isObj(doc)) continue;
    for (const g of Array.isArray(doc.groups) ? doc.groups : []) if (isObj(g) && typeof g.id === 'string') groups.set(g.id, { id: g.id, label: String(g.label || g.id), icon: g.icon || 'settings', order: Number(g.order) || 100, description: String(g.description || '') });
    for (const e of Array.isArray(doc.settings) ? doc.settings : []) { const n = normEntry(e); if (n) settings.set(n.key, n); }
  }
  for (const s of settings.values()) if (!groups.has(s.group)) groups.set(s.group, { id: s.group, label: s.group, icon: 'settings', order: 900, description: '' });
  return { groups: [...groups.values()].sort((a, b) => a.order - b.order), settings: [...settings.values()] };
}

/* ------------------------------------------------------------------ values */

/** Is `v` a value this setting can hold? */
export function valid(spec, v) {
  switch (spec.kind) {
    case 'toggle': return typeof v === 'boolean';
    case 'choice': return typeof v === 'string' && spec.options.some((o) => o.value === v);
    case 'number': return typeof v === 'number' && Number.isFinite(v) && (spec.min === undefined || v >= spec.min) && (spec.max === undefined || v <= spec.max);
    case 'text': return typeof v === 'string' && v.length <= 300;
    case 'time': return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    default: return false;
  }
}
/** A value as typed (CLI, MCP strings) → the setting's type, or undefined when it can't be. */
export function coerce(spec, v) {
  if (spec.kind === 'toggle' && typeof v === 'string') { const t = v.trim().toLowerCase(); return ['true', 'on', 'yes', '1'].includes(t) ? true : ['false', 'off', 'no', '0'].includes(t) ? false : undefined; }
  if (spec.kind === 'number' && typeof v === 'string' && v.trim() !== '') return Number(v);
  return v;
}

export function emptyDoc() { return { $axf: FRAME, updatedAt: '', values: {}, changed: {} }; }
export function readDoc() {
  const { file } = storeFile();
  const d = readJson(file);
  return isObj(d) && d.$axf === FRAME && isObj(d.values) ? { ...emptyDoc(), ...d, changed: isObj(d.changed) ? d.changed : {} } : emptyDoc();
}
function writeDoc(d) {
  const { file } = storeFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(d, null, 1)}\n`);
  renameSync(tmp, file);
}
function audit(entry) {
  try { mkdirSync(DATA_DIR, { recursive: true }); appendFileSync(join(DATA_DIR, 'audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch { /* audit is best effort */ }
}

/** The value in force: the stored one when it is still valid (and the setting isn't locked), else the default. */
export function valueOf(spec, doc) {
  if (spec.locked) return spec.default;
  const v = doc.values[spec.key];
  return v !== undefined && valid(spec, v) ? v : spec.default;
}

/** Who may change it, in plain words. */
export function whoSentence(spec) {
  if (spec.locked) return 'Locked: nobody changes it.';
  if (spec.owner === true) return "Owner-only: changes only with Brett's own click in the console.";
  if (spec.owner === 'raise') return 'Anyone may lower it; only Brett raises it.';
  return 'Any Claude session may change it (axHub veto).';
}

/** Everything a Claude session needs: every setting with its value, default, who may change it and a plain description. */
export function view({ doc = readDoc(), registry = loadRegistry(), extras = {} } = {}) {
  const { live, file } = storeFile();
  const settings = registry.settings.map((s) => ({
    key: s.key, group: s.group, label: s.label, kind: s.kind, value: valueOf(s, doc), default: s.default, level: s.level,
    owner: s.owner, locked: s.locked, who: whoSentence(s), description: s.description,
    ...(s.options ? { options: s.options } : {}), ...(s.min !== undefined ? { min: s.min, max: s.max, step: s.step } : {}),
    ...(s.shared ? { shared: s.shared } : {}), ...(doc.changed[s.key] ? { changed: doc.changed[s.key] } : {}),
  }));
  const values = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return {
    $axf: FRAME, live, store: live ? (process.env.AXF_CLAUDE_SETTINGS_FILE ? file : 'axHub /projects/_shared/_data/claude/settings.json') : file,
    updatedAt: doc.updatedAt || '', groups: registry.groups, values, settings,
    howToUse: 'Read at session start and before acting; follow every value. Owner-only settings are changed only by Brett in the console.',
    ...extras,
  };
}

/**
 * Change settings. `patch` = { key: value }. `owner` = { via, name } from the transport (Brett's signed-in console
 * session) or null; ignored when this process runs inside a Claude session, headless build or agent. Refuses the whole patch on the first problem (nothing half-applied). Answers { changed, view }.
 */
export function setSettings(patch, { owner = null, by = 'unknown', registry = loadRegistry(), now = new Date(), env = process.env } = {}) {
  if (!isObj(patch) || !Object.keys(patch).length) throw new SettingsError('invalid', 'nothing to change: send { key: value, … }');
  // an owner approval never counts inside a Claude session, headless build or agent, whatever handed it over
  const isOwner = !!(owner && OWNER_VIA.includes(owner.via)) && !nonHumanSource(env);
  const doc = readDoc();
  const next = { ...doc.values };
  const changed = [];
  for (const [key, raw] of Object.entries(patch)) {
    const spec = registry.settings.find((s) => s.key === key);
    if (!spec) throw new SettingsError('not_found', `no Claude setting ${key}`);
    const v = coerce(spec, raw);
    if (!valid(spec, v)) throw new SettingsError('invalid', `${key}: ${JSON.stringify(raw)} is not a valid ${spec.kind}${spec.options ? ` (${spec.options.map((o) => o.value).join(', ')})` : ''}${spec.min !== undefined ? ` (${spec.min}-${spec.max})` : ''}`);
    const before = valueOf(spec, doc);
    if (spec.locked && v !== spec.default) throw new SettingsError('denied', `${key} is locked at ${JSON.stringify(spec.default)}`);
    if (spec.owner === true && !isOwner && v !== before) throw new SettingsError('denied', `${key} is owner-only: only Brett changes it, with his own click in the console (Settings → Plugins → Claude)`);
    if (spec.owner === 'raise' && !isOwner && typeof before === 'number' && v > before) throw new SettingsError('denied', `${key} can only be raised by Brett (console); lowering it is fine`);
    if (v !== before) { next[key] = v; changed.push({ key, from: before, to: v }); }
  }
  if (!changed.length) return { changed: [], view: view({ doc, registry }) };
  const at = now.toISOString();
  const who = isOwner ? { by: owner.name || 'brett', via: owner.via } : { by: String(by || 'unknown').slice(0, 80), via: 'session' };
  const out = { ...doc, updatedAt: at, values: next, changed: { ...doc.changed } };
  for (const c of changed) out.changed[c.key] = { at, ...who };
  writeDoc(out);
  audit({ action: 'set', ...who, changed });
  return { changed, view: view({ doc: out, registry }) };
}

/**
 * Switch a setting back to its safe value without an owner (the server's own clock: No wait off at night or when
 * its pass ended). Only toggles going to false; never reachable from a request, an MCP call or the CLI.
 */
export function systemOff(key, why, { registry = loadRegistry(), now = new Date() } = {}) {
  const spec = registry.settings.find((s) => s.key === key);
  if (!spec || spec.kind !== 'toggle') throw new SettingsError('invalid', `${key} is not a toggle`);
  const doc = readDoc();
  if (valueOf(spec, doc) === false) return { changed: [] };
  const at = now.toISOString();
  const out = { ...doc, updatedAt: at, values: { ...doc.values, [key]: false }, changed: { ...doc.changed, [key]: { at, by: 'system', via: 'system', why: String(why).slice(0, 200) } } };
  writeDoc(out);
  audit({ action: 'system-off', key, why });
  return { changed: [{ key, from: true, to: false }] };
}

/* ------------------------------------------------------------------ No wait ↔ the veto pass */

const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
/** Minutes past midnight in a time zone. */
export function clockMinutes(now, timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}
/** Is `now` inside the window start → end (which may wrap past midnight)? */
export function inWindow(now, start, end, timeZone) {
  const t = clockMinutes(now, timeZone); const a = mins(start); const b = mins(end);
  return a === b ? false : a < b ? t >= a && t < b : t >= a || t < b;
}

/** The pass a No wait setting asks for: { minutes, include_irreversible }. */
export function passFor(values) {
  return { minutes: NO_WAIT_MINUTES[values['noWait.duration']] ?? 60, include_irreversible: values['noWait.includeIrreversible'] === true };
}

/**
 * What the server has to do now (pure). `pass` = the all-scope pass: { active, remainingMs, ended: 'expired'|'revoked'|null }.
 * → { action: 'none' } | { action: 'renew', minutes, include_irreversible } | { action: 'off', why, revoke }
 */
export function noWaitTick(values, pass, now = new Date(), timeZone = 'America/New_York') {
  if (values['noWait.enabled'] !== true) return { action: 'none' };
  if (values['noWait.autoOffAtNight'] === true && inWindow(now, values['noWait.nightStart'], values['noWait.nightEnd'], timeZone)) return { action: 'off', why: 'night: No wait turns off by itself at night', revoke: true };
  const untilOff = values['noWait.duration'] === 'untilOff';
  if (pass?.active) return untilOff && pass.remainingMs < RENEW_BEFORE_MS ? { action: 'renew', ...passFor(values) } : { action: 'none' };
  if (untilOff && pass?.ended === 'expired') return { action: 'renew', ...passFor(values) };
  return { action: 'off', why: pass?.ended === 'revoked' ? 'the No wait pass was revoked' : 'the No wait pass ended', revoke: false };
}

/** After an owner change: what to do with the pass. → 'grant' | 'revoke' | null */
export function passChange(changed, values) {
  const keys = new Set(changed.map((c) => c.key));
  if (keys.has('noWait.enabled')) return values['noWait.enabled'] ? 'grant' : 'revoke';
  return values['noWait.enabled'] && PASS_KEYS.some((k) => keys.has(k)) ? 'grant' : null;
}
