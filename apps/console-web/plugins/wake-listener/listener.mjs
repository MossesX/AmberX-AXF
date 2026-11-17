#!/usr/bin/env node
/**
 * Wake listener store + CLI (wake-listener@1). The settings (wake phrases, the off switch, the engine) and the last
 * state the open console reported live in the plugin's data folder, so the page, REST (/api/plugins/wake-listener),
 * the MCP tools (wake-listener_*), `axf wake-listener …` and this CLI share one copy.
 *
 *   node listener.mjs settings                      the settings
 *   node listener.mjs set <key>=<value>…            change settings (on, phrases, engine, awakeSec, answerSec, speak, chime, indicator, pauseHidden, useClaude, claudeTimeoutSec)
 *   node listener.mjs on | off                      the switch
 *   node listener.mjs phrases [add|remove <phrase>] the wake phrases
 *   node listener.mjs state                         the last state the console reported (phase, engine, mic, last heard)
 *   node listener.mjs report                        the console reports its state (JSON on stdin)
 *   node listener.mjs hear "<text>"                 dry run: what the matcher makes of a phrase against the stored state
 *   node listener.mjs match "<text>"                dry run of the command catalog (catalog.mjs): the entry and its fields
 *   node listener.mjs catalog [words]               the voice command catalog (every entry, or those matching words)
 *   node listener.mjs history [--mode claude|scripted] [--limit n]   recent commands, newest first, with who understood them
 *   node listener.mjs record                        add a history entry (JSON on stdin: heard, command, reply, ok, mode, reason)
 *   --json · --by <who>
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, FOLDER, FRAME, HISTORY_MAX, HISTORY_MODES, ListenerError, applyPatch, filterHistory, normalizeHistoryEntry, hear, initialState, normalizePhrases, normalizeSettings, stateLine, switched } from './core.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const DATA_DIR = process.env.AXF_WAKE_LISTENER_DATA_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER);
const SETTINGS = () => join(DATA_DIR, 'settings.json');
const STATE = () => join(DATA_DIR, 'state.json');
const HISTORY = () => join(DATA_DIR, 'history.jsonl');
/** A state older than this is stale: no console is listening right now. */
export const STATE_STALE_MS = 90_000;

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function writeJson(f, v) {
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
}

/* ------------------------------------------------------------------ settings */

export function readSettings() {
  const raw = readJson(SETTINGS());
  return { ...normalizeSettings(raw?.values ?? raw), updatedAt: raw?.updatedAt ?? '', updatedBy: raw?.updatedBy ?? '' };
}
export function writeSettings(patch, by = 'console') {
  const cur = readSettings();
  const values = applyPatch(cur, patch);
  const doc = { $axf: FRAME, values, updatedAt: new Date().toISOString(), updatedBy: String(by || 'console').slice(0, 60) };
  writeJson(SETTINGS(), doc);
  return { ...values, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
}

/* ------------------------------------------------------------------ state (what the console reports) */

export function readState(now = Date.now()) {
  const s = readSettings();
  const raw = readJson(STATE());
  const st = raw && raw.$axf === FRAME ? { ...initialState(s, now), ...raw } : initialState(s, now);
  const fresh = !!raw && now - (raw.updatedAt || 0) <= STATE_STALE_MS;
  // the switch is the settings' word, whatever the last report said
  const merged = switched(st, s.on, st.updatedAt);
  return { ...merged, listening: fresh && merged.listening, micOpen: fresh && merged.micOpen, fresh, reportedAt: raw?.updatedAt ? new Date(raw.updatedAt).toISOString() : '', line: stateLine(merged, s) };
}
export function writeState(report) {
  const r = report && typeof report === 'object' ? report : {};
  const s = readSettings();
  const base = initialState(s);
  const keep = {};
  for (const k of Object.keys(base)) if (k in r) keep[k] = r[k];
  const st = { ...base, ...keep, $axf: FRAME, updatedAt: Date.now() };
  writeJson(STATE(), st);
  return st;
}

/* ------------------------------------------------------------------ history (every command: who understood it) */

export function readHistory(opts = {}) {
  let lines = [];
  try { lines = readFileSync(HISTORY(), 'utf8').split('\n'); } catch { /* none yet */ }
  const raw = [];
  for (const l of lines) { if (!l.trim()) continue; try { raw.push(JSON.parse(l)); } catch { /* a torn line */ } }
  return filterHistory(raw, opts);
}
export function appendHistory(entry) {
  const e = normalizeHistoryEntry({ at: Date.now(), ...entry });
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  appendFileSync(HISTORY(), `${JSON.stringify(e)}\n`, { mode: 0o600 });
  // keep the newest HISTORY_MAX
  const all = readFileSync(HISTORY(), 'utf8').split('\n').filter((l) => l.trim());
  if (all.length > HISTORY_MAX + 100) { const tmp = `${HISTORY()}.${process.pid}.tmp`; writeFileSync(tmp, `${all.slice(-HISTORY_MAX).join('\n')}\n`, { mode: 0o600 }); renameSync(tmp, HISTORY()); }
  return e;
}

/* ------------------------------------------------------------------ CLI */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const byAt = argv.indexOf('--by');
  const by = byAt >= 0 ? argv[byAt + 1] : 'cli';
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] ?? '' : ''; };
  const valued = new Set(['--by', '--mode', '--limit']);
  const args = argv.filter((a, i) => a !== '--json' && !valued.has(a) && !valued.has(argv[i - 1]));
  const [cmd = 'state', ...rest] = args;
  const out = (o, text) => { if (json) console.log(JSON.stringify({ ok: true, ...o })); else console.log(text ?? JSON.stringify(o, null, 2)); };
  const parseValue = (v) => (v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  try {
    if (cmd === 'settings') { const s = readSettings(); out({ settings: s, defaults: DEFAULTS }, Object.entries(s).map(([k, v]) => `${k.padEnd(12)} ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')); }
    else if (cmd === 'set') {
      const patch = {};
      for (const kv of rest) { const i = kv.indexOf('='); if (i < 1) throw new ListenerError('invalid', `expected key=value, got ${kv}`); patch[kv.slice(0, i)] = kv.slice(i + 1).includes(',') && kv.slice(0, i) === 'phrases' ? kv.slice(i + 1) : parseValue(kv.slice(i + 1)); }
      if (!Object.keys(patch).length) throw new ListenerError('invalid', 'usage: listener.mjs set key=value…');
      const s = writeSettings(patch, by); out({ settings: s }, `saved: ${Object.keys(patch).join(', ')}`);
    }
    else if (cmd === 'on' || cmd === 'off') { const s = writeSettings({ on: cmd === 'on' }, by); out({ settings: s, on: s.on }, `wake listener ${cmd}`); }
    else if (cmd === 'phrases') {
      const [verb, ...words] = rest;
      let s = readSettings();
      if (verb === 'add') s = writeSettings({ addPhrase: words.join(' ') }, by);
      else if (verb === 'remove') s = writeSettings({ removePhrase: words.join(' ') }, by);
      else if (verb) s = writeSettings({ phrases: normalizePhrases(rest.join(' ')) }, by);
      out({ phrases: s.phrases }, s.phrases.map((p) => `"${p}"`).join(', '));
    }
    else if (cmd === 'state') { const st = readState(); out({ state: st }, st.line); }
    else if (cmd === 'report') {
      const raw = readFileSync(0, 'utf8');
      const st = writeState(JSON.parse(raw || '{}'));
      out({ state: st }, 'reported');
    }
    else if (cmd === 'history') {
      const mode = opt('--mode');
      if (mode && !HISTORY_MODES.includes(mode)) throw new ListenerError('invalid', `--mode is ${HISTORY_MODES.join(' or ')}`);
      const entries = readHistory({ mode, limit: Number(opt('--limit')) || 100 });
      out({ count: entries.length, mode: mode || 'all', entries }, entries.map((e) => `${new Date(e.at).toISOString().slice(0, 19)}  ${e.mode.padEnd(8)} ${(e.reason || '').padEnd(14)} "${e.heard}" → ${e.command || '–'}`).join('\n') || 'no history yet');
    }
    else if (cmd === 'record') {
      const e = appendHistory(JSON.parse(readFileSync(0, 'utf8') || '{}'));
      out({ entry: e }, 'recorded');
    }
    else if (cmd === 'hear') {
      const s = readSettings();
      const st = readState();
      const r = hear(st, s, rest.join(' '));
      out({ event: r.event, command: r.command ?? '', phase: r.state.phase, wake: r.state.lastWake }, `${r.event}${r.command ? `: "${r.command}"` : ''} (phase ${r.state.phase})`);
    }
    else if (cmd === 'match' || cmd === 'catalog') {
      const cat = await import('./catalog.mjs');
      const { registry } = await import('../../../../framework/cli/plugin-commands.mjs');
      const { CONTROL_TARGETS } = await import('../../../../framework/core/engines/control-rules.mjs');
      const catalog = cat.buildCatalog({ registry: registry({ apps: ['console-web'] }), targets: CONTROL_TARGETS });
      if (cmd === 'catalog') {
        const q = rest.join(' ').trim();
        const list = q ? cat.searchCatalog(catalog, q) : catalog.entries;
        out({ count: list.length, entries: list }, list.map((e) => `${e.id.padEnd(44)} ${e.say[0] ?? ''}${e.fields.length ? `  [${e.fields.map((f) => f.name).join(', ')}]` : ''}`).join('\n'));
      } else {
        const m = cat.matchCommand(catalog, rest.join(' '));
        if (!m) out({ match: null }, 'no command matches');
        else out({ match: m }, `${m.entry.id} (${m.entry.title}) score ${m.score}${Object.keys(m.slots).length ? `  slots ${JSON.stringify(m.slots)}` : ''}${m.missing.length ? `  asks: ${m.missing.join(', ')}` : ''}`);
      }
    }
    else { console.error('usage: listener.mjs settings | set k=v… | on | off | phrases [add|remove <p>] | state | report | hear "<text>" | match "<text>" | catalog [words] | history [--mode claude|scripted] [--limit n] | record'); process.exit(2); }
  } catch (e) {
    const code = e instanceof ListenerError ? e.code : 'failed';
    if (json) console.log(JSON.stringify({ ok: false, code, message: e.message })); else console.error(e.message);
    process.exit(1);
  }
}
