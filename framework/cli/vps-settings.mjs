#!/usr/bin/env node
/**
 * vps-settings — vps-settings@1: settings that the VPS itself enforces, in one store the host launchers and the console
 * share (Brett, Nov 9 2026: "I need a rule on the VPS that refuses any job that doesn't come from the orchestrator. ...
 * Now how would I manage that setting? I need a console plugin to manage the VPS settings.").
 *
 * The first setting is the orchestrator-only rule. framework/cli/dispatch-gate.mjs reads it on every launch (hot: no
 * restart). On (the default), a headless Claude build launch without the orchestrator dispatcher's token for that build is
 * refused (deploy/claude-headless.sh, agent-slots swarm jobs, axHub vps.build_start, a hand launch). Off, it starts and
 * is logged as "allowed: rule off". Every refusal goes into the refused-jobs log (refused.jsonl) and sends one phone
 * notice per build per notifyEveryMin (a hub-notification@1 file in axHub's shared inbox; the console's VPS Settings
 * plugin also raises a console alert, which AmberX shows).
 *
 * Store: <dir>/settings.json and <dir>/refused.jsonl. <dir> = $AXF_VPS_SETTINGS_DIR, else
 * /projects/amberx-axf/_data/vps-settings where the hub is mounted (host and console container), else ~/.axf/vps-settings.
 *
 *   node framework/cli/vps-settings.mjs get [--json]                       every setting with its default and who changed it
 *   node framework/cli/vps-settings.mjs set key=value… [--by who] [--json]  e.g. orchestratorOnly=false notifyRefused=true
 *   node framework/cli/vps-settings.mjs refused [--limit N] [--json]       the refused-jobs log, newest first
 *   node framework/cli/vps-settings.mjs clear-refused [--by who]           empty the log (one line records who cleared it)
 *
 * Who may loosen the rule: anyone with a shell on the VPS host (this CLI) and Brett's own click in the console. The
 * console's REST route refuses orchestratorOnly=false from a session, MCP or voice (403), since a session must not be
 * able to switch off the guard that holds sessions back; turning it on is open to everyone.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const SCHEMA = 'vps-settings@1';
export const REFUSAL_SCHEMA = 'vps-refusal@1';

/** Every VPS setting: its default, type and the line the console shows. Add new VPS settings here. */
export const SETTINGS = {
  orchestratorOnly: { type: 'bool', default: true, group: 'Launch rules', label: 'Only the orchestrator starts builds',
    hint: 'A headless Claude build launch needs the orchestrator dispatcher\'s token for that build; anything else is refused and logged. Off: it starts and is logged as allowed.' },
  notifyRefused: { type: 'bool', default: true, group: 'Launch rules', label: 'Phone notice on a refused job',
    hint: 'Each refusal sends a notice to the phone (axHub inbox and a console alert).' },
  notifyEveryMin: { type: 'int', default: 10, min: 0, max: 1440, group: 'Launch rules', label: 'One notice per build every (min)',
    hint: 'Repeat refusals of the same build within this time are logged without another notice. 0 = a notice every time.' },
  refusedLogMax: { type: 'int', default: 500, min: 50, max: 10000, group: 'Launch rules', label: 'Refused-jobs log keeps',
    hint: 'Older lines are dropped past this many.' },
};
export const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));

export function settingsDir(env = process.env) {
  if (env.AXF_VPS_SETTINGS_DIR) return env.AXF_VPS_SETTINGS_DIR;
  if (existsSync(join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data'))) return join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data', 'vps-settings');
  return join(homedir(), '.axf', 'vps-settings');
}
const files = (env) => { const d = settingsDir(env); return { dir: d, settings: join(d, 'settings.json'), refused: join(d, 'refused.jsonl') }; };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function writeJson(f, v) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`, { mode: 0o664 });
  renameSync(tmp, f);
}

/** Pure: one value checked against its setting. Returns [ok, value or why]. */
export function coerce(key, raw) {
  const s = SETTINGS[key];
  if (!s) return [false, `unknown setting ${key} (settings: ${Object.keys(SETTINGS).join(', ')})`];
  if (s.type === 'bool') {
    if (raw === true || raw === false) return [true, raw];
    const t = String(raw).trim().toLowerCase();
    if (['true', 'on', '1', 'yes'].includes(t)) return [true, true];
    if (['false', 'off', '0', 'no'].includes(t)) return [true, false];
    return [false, `${key} is on or off`];
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < s.min || n > s.max) return [false, `${key} is a whole number ${s.min}–${s.max}`];
  return [true, n];
}

/** Pure: a stored document → the effective settings (unknown or bad values fall back to the default). */
export function normalize(doc) {
  const out = { ...DEFAULTS };
  const vals = doc && typeof doc.values === 'object' && doc.values ? doc.values : {};
  for (const k of Object.keys(SETTINGS)) if (k in vals) { const [ok, v] = coerce(k, vals[k]); if (ok) out[k] = v; }
  return out;
}

/** Read fresh on every call: a change applies to the next launch. */
export function load(env = process.env) {
  const doc = readJson(files(env).settings) ?? {};
  return { values: normalize(doc), changed: doc.changed && typeof doc.changed === 'object' ? doc.changed : {} };
}

/** Change one or more settings. `patch` = {key: value}. Throws on a bad key or value (nothing is saved then). */
export function save(patch, { by = '', env = process.env, now = Date.now() } = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    const [ok, val] = coerce(k, v);
    if (!ok) throw Object.assign(new Error(val), { code: 2 });
    clean[k] = val;
  }
  if (!Object.keys(clean).length) throw Object.assign(new Error('nothing to change'), { code: 2 });
  const f = files(env);
  const doc = readJson(f.settings) ?? {};
  const values = { ...(doc.values || {}), ...clean };
  const changed = { ...(doc.changed || {}) };
  const at = new Date(now).toISOString();
  for (const k of Object.keys(clean)) changed[k] = { at, by: String(by || 'cli').slice(0, 80) };
  writeJson(f.settings, { $axf: SCHEMA, values, changed });
  return view(env);
}

/** What the console and the CLI show: each setting with its value, default, label and who changed it last. */
export function view(env = process.env) {
  const { values, changed } = load(env);
  return {
    $axf: SCHEMA, ok: true, dir: settingsDir(env), values,
    settings: Object.entries(SETTINGS).map(([key, s]) => ({ key, ...s, value: values[key], changed: changed[key] ?? null })),
  };
}

/* ---------------- refused-jobs log ---------------- */

export function readRefused({ limit = 100, env = process.env } = {}) {
  let text = '';
  try { text = readFileSync(files(env).refused, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* a torn line */ } }
  return rows.reverse().slice(0, Math.max(1, Math.min(10000, Number(limit) || 100)));
}

function trim(env, max) {
  const f = files(env).refused;
  try {
    if (statSync(f).size < max * 200) return;
    const lines = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
    if (lines.length <= max) return;
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, `${lines.slice(-max).join('\n')}\n`, { mode: 0o664 });
    renameSync(tmp, f);
  } catch { /* the log is best effort */ }
}

/** Pure: should this refusal send a phone notice? One per build per notifyEveryMin. */
export function wantsNotice(rows, entry, settings, now = Date.now()) {
  if (!settings.notifyRefused || entry.outcome !== 'refused') return false;
  const gap = settings.notifyEveryMin * 60e3;
  if (!gap) return true;
  return !rows.some((r) => r.notified && r.build === entry.build && r.name === entry.name && now - Date.parse(r.at || 0) < gap);
}

export function notifyInbox(env = process.env) {
  if (env.AXF_NOTIFY_INBOX !== undefined) return env.AXF_NOTIFY_INBOX && env.AXF_NOTIFY_INBOX !== 'off' ? env.AXF_NOTIFY_INBOX : null;
  const shared = join(env.AXHUB_PROJECTS_DIR || '/projects', '_shared', '_data', 'notifications');
  return existsSync(dirname(shared)) ? shared : null;
}

/** The phone notice: one hub-notification@1 file in axHub's shared inbox (best effort; returns what happened). */
export function sendNotice(entry, env = process.env) {
  const dir = notifyInbox(env);
  if (!dir) return 'no axHub inbox mounted here';
  const n = {
    $axf: 'hub-notification@1', id: `vps-refused-${entry.id}`, app: 'axf-console', source: 'vps-settings', about: entry.build || entry.name,
    kind: 'alert', state: 'failed', title: `VPS refused a job: ${entry.build || entry.name}`.slice(0, 160),
    body: `${entry.why}`.slice(0, 500), url: 'settings:vps-settings', priority: 'high', at: entry.at,
  };
  try {
    const folder = join(dir, 'inbox', n.at.slice(0, 4), n.at.slice(5, 7));
    mkdirSync(folder, { recursive: true });
    const p = join(folder, `${n.id}.json`);
    writeFileSync(`${p}.tmp`, JSON.stringify(n), { mode: 0o664 });
    renameSync(`${p}.tmp`, p);
    return 'sent';
  } catch (e) { return `couldn't write to axHub: ${e.code || e.message}`; }
}

/**
 * Log one gate outcome (refused, or allowed only because the rule is off) and send the phone notice when due.
 * `entry` = {outcome: 'refused'|'allowed-off'|'cleared', build, name, why, launcher, by}. Never throws.
 */
export function logRefusal(entry, { env = process.env, now = Date.now(), notify = sendNotice } = {}) {
  try {
    const settings = load(env).values;
    const row = {
      $axf: REFUSAL_SCHEMA, id: `${now.toString(36)}${randomBytes(3).toString('hex')}`, at: new Date(now).toISOString(),
      outcome: entry.outcome || 'refused', build: String(entry.build || '').slice(0, 80), name: String(entry.name || '').slice(0, 80),
      launcher: String(entry.launcher || '').slice(0, 40), by: String(entry.by || '').slice(0, 80), why: String(entry.why || '').slice(0, 600),
      notified: '',
    };
    if (wantsNotice(readRefused({ limit: 200, env }), row, settings, now)) row.notified = notify(row, env);
    const f = files(env).refused;
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, `${JSON.stringify(row)}\n`, { mode: 0o664 });
    trim(env, settings.refusedLogMax);
    return row;
  } catch { return null; }
}

export function clearRefused({ by = '', env = process.env, now = Date.now() } = {}) {
  const f = files(env).refused;
  mkdirSync(dirname(f), { recursive: true });
  const row = { $axf: REFUSAL_SCHEMA, id: `${now.toString(36)}${randomBytes(3).toString('hex')}`, at: new Date(now).toISOString(), outcome: 'cleared', build: '', name: '', launcher: '', by: String(by || 'cli').slice(0, 80), why: 'log cleared', notified: '' };
  writeFileSync(f, `${JSON.stringify(row)}\n`, { mode: 0o664 });
  return { ok: true, cleared: true, by: row.by };
}

/* ---------------- CLI ---------------- */

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const [cmd, ...rest] = args;
  const out = (o, line) => console.log(json ? JSON.stringify(o) : line);
  if (cmd === 'get' || !cmd) {
    const v = view();
    return out(v, v.settings.map((s) => `${s.key} = ${s.value}${s.value === s.default ? '' : ` (default ${s.default})`}${s.changed ? `  · ${s.changed.by} ${s.changed.at}` : ''}`).join('\n'));
  }
  if (cmd === 'set') {
    const patch = {};
    for (const a of rest) { if (a.startsWith('--')) break; const i = a.indexOf('='); if (i > 0) patch[a.slice(0, i)] = a.slice(i + 1); }
    const v = save(patch, { by: opt('by') || process.env.AXF_SESSION || process.env.USER || 'cli' });
    return out(v, `saved: ${Object.keys(patch).map((k) => `${k} = ${v.values[k]}`).join(', ')}`);
  }
  if (cmd === 'refused') {
    const rows = readRefused({ limit: opt('limit') || 50 });
    return out({ ok: true, refused: rows }, rows.map((r) => `${r.at} ${r.outcome} ${r.build || r.name}${r.launcher ? ` via ${r.launcher}` : ''}: ${r.why}${r.notified ? ` [notice: ${r.notified}]` : ''}`).join('\n') || 'no refused jobs');
  }
  if (cmd === 'clear-refused') return out(clearRefused({ by: opt('by') || process.env.USER || 'cli' }), 'refused-jobs log cleared');
  console.error('usage: vps-settings.mjs get | set key=value… [--by who] | refused [--limit N] | clear-refused [--json]');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`vps-settings: ${e.message}`); process.exitCode = e.code === 2 ? 2 : 1; });
}
