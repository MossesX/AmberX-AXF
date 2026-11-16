#!/usr/bin/env node
/**
 * console-control@1 parity: the same command through REST, MCP, the CLI and the voice intent gives the same answer and
 * leaves the console in the same state.
 *
 *   node apps/console-web/scripts/console-control-parity.mjs        (CC_PARITY_PORT=7097 · PYTHON=python3)
 *
 * The real REST router runs over HTTP (server/tests/console_control_parity.py serve) with a deterministic fake console
 * behind the relay. Each case runs once per channel from a fresh console:
 *   REST   its route (GET /state, POST /focus, /scroll, /search, /do, /plugins/{id}/enable|disable)
 *   CLI    framework/cli/axf.mjs console … --json (AXF_CONSOLE_URL → the server)
 *   MCP    the console_control_* tool through the stdio runner (the REST API, as on a local clone)
 *   voice  the phrase through POST /voice (the AmberX path), where a phrase says the same thing
 * and compares the answer (caller-specific fields dropped: by, client, the voice's heard / intent / command / say), the
 * command the console received and the console state after it.
 */
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PY = process.env.PYTHON || 'python3';
const HARNESS = join(APP, 'server/tests/console_control_parity.py');
const PORT = Number(process.env.CC_PARITY_PORT) || 7097;
const URL_ = `http://127.0.0.1:${PORT}`;
const API = `${URL_}/api/console-control`;

const server = spawn(PY, [HARNESS, 'serve', String(PORT)], { stdio: ['ignore', 'ignore', 'pipe'] });
let serverErr = '';
server.stderr.on('data', (d) => { serverErr += d; });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

const http = async (method, path, body) => {
  const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return r.json();
};
const fakeReset = (open = true) => http('POST', `${URL_}/_fake/reset`, { open });
const fakeSent = () => http('GET', `${URL_}/_fake/sent`);

const channels = {
  rest: ({ rest: [method, path, body] }) => http(method, path, body && { ...body, by: 'parity' }),
  cli: ({ cli }) => {
    let out;
    try { out = execFileSync('node', [join(ROOT, 'framework/cli/axf.mjs'), 'console', ...cli, '--json', '--by', 'parity'], { encoding: 'utf8', env: { ...process.env, AXF_CONSOLE_URL: URL_, AXF_TOKEN: '' } }); }
    catch (e) { out = e.stdout; } // a refusal exits non-zero with the answer on stdout
    return JSON.parse(out);
  },
  mcp: ({ mcp }) => JSON.parse(execFileSync(PY, [HARNESS, 'mcp', URL_], { input: JSON.stringify([mcp]), encoding: 'utf8' }))[0],
  voice: ({ voice }) => http('POST', '/voice', { text: voice, by: 'parity' }),
};

/** The answer without what names the caller or the channel. */
const DROP = new Set(['by', 'client', 'heard', 'intent', 'command', 'say', 'at']);
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
  return v;
}
/**
 * What reached the console: the last command. A phrase that names something ("disable plugin activity") is resolved by a
 * search first; that lookup is the voice path's own, so it is left out unless the case is itself a search.
 */
const lastCommand = (sent, ch, c) => norm(sent.sent.filter((x) => !(ch === 'voice' && x.verb === 'search' && c.rest[1] !== '/search')).at(-1) ?? null);

const free = await (async () => {
  for (let i = 0; i < 60; i++) { try { return await http('GET', `${URL_}/_fake/free-plugin`); } catch { await sleep(250); } }
  throw new Error(`the parity server did not start:\n${serverErr.slice(-2000)}`);
})();

const SETTINGS_TAB = 'view:settings/tab:settings.tabs=plugins';
const cases = [
  { name: 'state', rest: ['GET', '/state'], cli: ['state'], mcp: ['console_control_state', {}] },
  { name: 'focus a settings tab', rest: ['POST', '/focus', { address: SETTINGS_TAB }], cli: ['focus', SETTINGS_TAB], mcp: ['console_control_focus', { address: SETTINGS_TAB }] },
  { name: 'focus a build step (expanded)', rest: ['POST', '/focus', { address: 'row:b1/step:s3', options: { expand: true } }], cli: ['focus', 'row:b1/step:s3', '--expand'], mcp: ['console_control_focus', { address: 'row:b1/step:s3', expand: true }] },
  { name: 'scroll down', rest: ['POST', '/scroll', { scroll: { dir: 'down' } }], cli: ['scroll', 'down'], mcp: ['console_control_scroll', { dir: 'down' }], voice: 'scroll down' },
  { name: 'scroll to the top', rest: ['POST', '/scroll', { scroll: { dir: 'top' } }], cli: ['scroll', 'top'], mcp: ['console_control_scroll', { dir: 'top' }], voice: 'go to the top' },
  { name: 'open settings', rest: ['POST', '/do', { verb: 'open', address: 'view:settings' }], cli: ['do', 'open', 'view:settings'], mcp: ['console_control_do', { verb: 'open', address: 'view:settings' }], voice: 'open settings' },
  { name: 'search', rest: ['POST', '/search', { query: { q: 'snapshot', limit: 10 } }], cli: ['search', 'snapshot', '--limit', '10'], mcp: ['console_control_search', { q: 'snapshot', limit: 10 }] },
  { name: 'press a destructive button without confirm', rest: ['POST', '/do', { verb: 'press', address: 'function:snapshots.delete' }], cli: ['do', 'press', 'function:snapshots.delete'], mcp: ['console_control_do', { verb: 'press', address: 'function:snapshots.delete' }] },
  { name: 'press it with confirm', rest: ['POST', '/do', { verb: 'press', address: 'function:snapshots.delete', confirm: true }], cli: ['do', 'press', 'function:snapshots.delete', '--confirm'], mcp: ['console_control_do', { verb: 'press', address: 'function:snapshots.delete', confirm: true }] },
  { name: 'a deciding press is refused', rest: ['POST', '/do', { verb: 'press', address: 'function:approvals.approve' }], cli: ['do', 'press', 'function:approvals.approve'], mcp: ['console_control_do', { verb: 'press', address: 'function:approvals.approve' }] },
  { name: `disable plugin ${free.folder}`, rest: ['POST', `/plugins/${free.folder}/disable`, {}], cli: ['plugin', 'disable', free.folder], mcp: ['console_control_plugin', { plugin: free.folder, enabled: false }], voice: `disable plugin ${free.label ?? free.folder}` },
  { name: 'no console open', open: false, rest: ['GET', '/state'], cli: ['state'], mcp: ['console_control_state', {}] },
  { name: 'no console open: focus', open: false, rest: ['POST', '/focus', { address: 'view:settings' }], cli: ['focus', 'view:settings'], mcp: ['console_control_focus', { address: 'view:settings' }] },
  { name: 'no console open: open settings', open: false, rest: ['POST', '/do', { verb: 'open', address: 'view:settings' }], cli: ['do', 'open', 'view:settings'], mcp: ['console_control_do', { verb: 'open', address: 'view:settings' }], voice: 'open settings' },
];

let failed = 0;
let compared = 0;
try {
  for (const c of cases) {
    const runs = {};
    for (const ch of Object.keys(channels)) {
      if (!c[ch]) continue;
      await fakeReset(c.open !== false);
      const answer = await channels[ch](c);
      const sent = await fakeSent();
      runs[ch] = { answer: answer?.toolError ? { toolError: true } : norm(answer), command: lastCommand(sent, ch, c), state: norm((await http('GET', '/state')).state ?? null), plugins: sent.enabled, raw: answer };
    }
    const [base, ...rest] = Object.keys(runs);
    // MCP raises a refusal as a tool error: the same refusal when REST refused with the message the error carries
    if (runs.mcp?.answer.toolError) {
      const msg = runs[base].raw.message;
      runs.mcp.answer = runs[base].raw.ok === false && msg && runs.mcp.raw.toolError.includes(msg) ? runs[base].answer : { toolError: runs.mcp.raw.toolError };
    }
    const diffs = [];
    for (const ch of rest) {
      for (const part of ['answer', 'command', 'state', 'plugins']) {
        compared++;
        if (!isDeepStrictEqual(runs[base][part], runs[ch][part])) diffs.push(`${ch} ${part} ≠ ${base}:\n      ${base}: ${JSON.stringify(runs[base][part]).slice(0, 600)}\n      ${ch}: ${JSON.stringify(runs[ch][part]).slice(0, 600)}`);
      }
    }
    const a = runs[base].raw;
    if (diffs.length) { failed++; console.log(`✗ ${c.name}\n    ${diffs.join('\n    ')}`); }
    else console.log(`✓ ${c.name} — ${Object.keys(runs).join(', ')} agree (${a.ok ? 'ok' : a.code}${a.state?.screen ? `, screen ${a.state.screen}` : ''})`);
  }
} catch (e) {
  failed++;
  console.error(e instanceof Error ? e.stack : e);
} finally {
  stop();
}
if (failed) { console.log(`✗ console-control parity — ${failed} of ${cases.length} cases differ`); process.exitCode = 1; }
else console.log(`✓ console-control parity — ${cases.length} cases, ${compared} comparisons (REST, CLI, MCP, voice)`);
