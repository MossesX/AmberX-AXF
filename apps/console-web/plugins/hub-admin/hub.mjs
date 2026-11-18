#!/usr/bin/env node
/**
 * `axf hub …` — the Hub plugin's command line (plugin.json "cli": { "hub": "hub.mjs" }). The same REST routes the console
 * screens, the MCP tools and voice use, so a word here answers exactly what they answer (hub-console@1 reaches).
 *
 *   axf hub <screen>                          one screen's state        GET  /api/plugins/hub-admin/<screen>
 *   axf hub <screen> <row>                    one row                   GET  …/<screen>/<row>
 *   axf hub <screen> <action> [<row>] [--k v]…  a command or confirm action  POST …/<screen>[/<row>]/<action>
 *   axf hub table                             the route table
 *   --json on any word prints the answer as one JSON object; --status <s> --page <n> … become query parameters on a read.
 *
 * Person actions (approve, deny, shelve, grant, …) are refused here on purpose: they are Brett's own tap in his signed-in
 * console browser (HUB-CONSOLE.md → who). The console: AXF_CONSOLE_URL (default https://console.amberxai.com) + AXF_TOKEN.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as hc from '../../../../framework/core/hub-console.mjs';

const TABLE_FILE = new URL('../../../../framework/schemas/hub-console.json', import.meta.url);
export const table = JSON.parse(readFileSync(TABLE_FILE, 'utf8'));
export const cliWords = [...hc.screensOf(table).map((s) => s.id), 'table'];

/** Flags → { flags, words } (`--k v`, `--k=v`, `--json`). */
export function parseArgs(argv) {
  const flags = {}; const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else words.push(a);
  }
  return { flags, words };
}

/**
 * The request for one command line: { method, path, query?, body? } or { error }. Pure, so the test pins every shape.
 *   hub approvals → GET /approvals; hub approvals <uuid> → GET /approvals/<uuid>; hub passes revoke p1 → POST /passes/p1/revoke;
 *   hub users delete u1 → DELETE /users/u1 (method: DELETE in the table); hub approvals approve <id> → error (person).
 */
export function plan(argv) {
  const { flags, words } = parseArgs(argv);
  const [screen, second, third] = words;
  if (!screen) return { error: `axf hub <${cliWords.join('|')}> [<row>|<action> [<row>]] [--k v] [--json]` };
  if (screen === 'table') return { method: 'GET', path: '/table', json: !!flags.json };
  const s = hc.screenOf(table, screen);
  if (!s) return { error: `no hub screen "${screen}"; one of ${cliWords.join(', ')}` };
  const { json, ...rest } = flags;
  if (!second) return { method: 'GET', path: `/${screen}`, query: rest, json: !!json };
  const action = hc.actionOf(table, screen, second);
  if (!action) {
    if (!hc.rowIdOk(s, second)) return { error: `"${second}" is neither an action of ${screen} (${s.actions.map((a) => a.id).join(', ')}) nor a row id` };
    return { method: 'GET', path: `/${screen}/${encodeURIComponent(second)}`, query: rest, json: !!json };
  }
  if (action.who === 'person') return { error: `${screen} ${second} is Brett's own tap in his signed-in console browser; it has no command line (HUB-CONSOLE.md → who)` };
  const row = third ?? '';
  if (action.row && !row) return { error: `${screen} ${second} needs a row id: axf hub ${screen} ${second} <row>` };
  if (row && !hc.rowIdOk(s, row)) return { error: `"${row}" is not a ${screen} row id` };
  const body = {};
  for (const [k, v] of Object.entries(rest)) body[k] = v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(String(v)) ? Number(v) : v;
  const method = action.method === 'DELETE' && row ? 'DELETE' : 'POST';
  const path = method === 'DELETE' ? `/${screen}/${encodeURIComponent(row)}` : `/${screen}${row ? `/${encodeURIComponent(row)}` : ''}/${second}`;
  return { method, path, body, json: !!json, confirm: action.who === 'confirm' };
}

export async function send(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const q = req.query && Object.keys(req.query).length ? `?${new URLSearchParams(Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]))).toString()}` : '';
  const url = `${base.replace(/\/$/, '')}/api/plugins/hub-admin${req.path}${q}`;
  const res = await f(url, { method: req.method, headers: { accept: 'application/json', ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { ok: false, code: 'unexpected', message: text.slice(0, 300) }; }
  return { status: res.status, json };
}

/** One line per fact for a phone screen. */
export function describe(json) {
  if (!json || typeof json !== 'object') return String(json);
  if (json.ok === false) return `✗ ${json.code ?? 'error'}: ${json.message ?? ''}${json.proposed ? ` (route to grow on axHub: ${json.proposed})` : ''}`;
  const lines = [];
  for (const [k, v] of Object.entries(json)) {
    if (k === 'ok' || k === 'shape' || k === 'screen' || k === 'hub' || k === 'via') continue;
    if (Array.isArray(v)) lines.push(`${k}: ${v.length} item(s)${v.length ? `\n${v.slice(0, 20).map((x) => `  - ${summary(x)}`).join('\n')}` : ''}`);
    else if (v && typeof v === 'object') lines.push(`${k}: ${summary(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  return lines.join('\n');
}
const summary = (x) => (x && typeof x === 'object' ? Object.entries(x).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, 6).map(([k, v]) => `${k}=${v}`).join(' · ') : String(x));

export async function main(argv) {
  const req = plan(argv);
  if (req.error) { console.error(req.error); return 2; }
  const r = await send(req);
  if (req.json) console.log(JSON.stringify(r.json));
  else console.log(describe(r.json));
  return r.status === 200 && r.json?.ok !== false ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
