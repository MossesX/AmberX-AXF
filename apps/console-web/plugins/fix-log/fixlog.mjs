#!/usr/bin/env node
/**
 * fixlog — log one step of a fix and tell Brett on his phone (FYI, never an approval). fix-log@1.
 *
 *   node apps/console-web/plugins/fix-log/fixlog.mjs found  "<what needs fixing>"   [--detail d] [--build b]
 *   node apps/console-web/plugins/fix-log/fixlog.mjs trying "<what you are trying>"  [--issue id] [--detail d]
 *   node apps/console-web/plugins/fix-log/fixlog.mjs failed "<what failed>"          [--issue id] [--detail d]
 *   node apps/console-web/plugins/fix-log/fixlog.mjs fixed  "<what fixed it>"        [--issue id]
 *   node apps/console-web/plugins/fix-log/fixlog.mjs list [--outcome o] [--session s] [--build b] [--q text] [--limit n] [--json]
 *   node apps/console-web/plugins/fix-log/fixlog.mjs issues [--state open] [--json]
 *
 * Without --issue a line joins this session's open fix (AXF_SESSION). Send once and keep working: no polling.
 * Reaches the console with AXF_CONSOLE_URL + AXF_TOKEN, else through `docker exec axf-console` on the VPS. Before the
 * plugin is deployed (404), a log line still goes out as a plain console alert so Brett hears it.
 * Same as `axf fix-log log --text … --outcome …` and MCP `fix_log_log`. Exit 0 ok · 1 failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';

const FOLDER = 'fix-log';
const OUTCOMES = ['found', 'trying', 'failed', 'fixed'];
const TITLE = { found: 'Needs fixing', trying: 'Trying', failed: 'Failed', fixed: 'Fixed' };
const SEVERITY = { found: 'info', trying: 'info', failed: 'warning', fixed: 'success' };

export function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; } } else out._.push(a);
  }
  return out;
}

/** One console call: { status, json }. */
export async function consoleCall(method, path, body, env = process.env) {
  const url = env.AXF_CONSOLE_URL, tok = env.AXF_TOKEN;
  if (url && tok) {
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20e3), headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch (e) { return { status: 0, json: null, error: String(e?.message || e).slice(0, 200) }; }
  }
  const sh = `curl -s -m 20 -o - -w '\\n%{http_code}' -X ${method} -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" ${body ? '--data-binary @-' : ''} "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}${path}"`;
  return finish(spawnSync('docker', ['exec', '-i', env.AXF_CONSOLE_CONTAINER || 'axf-console', 'sh', '-c', sh], { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', timeout: 30e3 }));
}

function finish(r) {
  if (r.error || r.status !== 0) return { status: 0, json: null, error: (r.stderr || r.error?.message || 'console unreachable').trim().slice(0, 200) };
  const out = String(r.stdout).replace(/\n$/, ''); const i = out.lastIndexOf('\n');
  const status = Number(out.slice(i + 1)) || 0; const text = i < 0 ? '' : out.slice(0, i);
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON (the SPA page on an unknown route) */ }
  return { status, json };
}

export async function logLine(outcome, text, flags = {}, env = process.env, call = consoleCall) {
  const body = { outcome, text, session: flags.session || env.AXF_SESSION || '', agent: flags.agent || env.AXF_AGENT_NAME || env.AXF_AGENT || '', build: flags.build || env.AXF_BUILD || '' };
  if (flags.detail) body.detail = String(flags.detail);
  if (flags.issue) body.issue = String(flags.issue);
  const r = await call('POST', `/api/plugins/${FOLDER}/log`, body, env);
  if (r.status === 200 && r.json?.ok) return { ok: true, via: 'fix-log', issue: r.json.issue, notified: r.json.notified };
  if (r.status === 400) return { ok: false, error: r.json?.detail || 'refused' };
  // the plugin isn't there yet (or is off): still tell Brett, as a plain console alert
  const who = [body.build || body.session, body.agent].filter(Boolean).join(' · ');
  const a = { source: FOLDER, severity: SEVERITY[outcome], key: `fix-log:${Date.now()}`, title: `${TITLE[outcome]}: ${text}`.slice(0, 200), body: `FYI, nothing to approve. ${who}${body.detail ? `. ${body.detail}` : ''}`.slice(0, 1000) };
  const f = await call('POST', '/api/alerts', a, env);
  if (f.status === 200) return { ok: true, via: 'alert', issue: '', notified: true, note: 'Fix log not deployed yet: sent as a plain alert, not logged' };
  return { ok: false, error: r.error || f.error || `console answered ${r.status || f.status}` };
}

async function main(argv) {
  const f = parse(argv);
  const [cmd, ...rest] = f._;
  if (OUTCOMES.includes(cmd)) {
    const text = rest.join(' ').trim();
    if (!text) { console.error(`usage: fixlog.mjs ${cmd} "<one short line>" [--issue id] [--detail d]`); return 2; }
    const r = await logLine(cmd, text, f);
    if (f.json) console.log(JSON.stringify(r));
    else if (r.ok) console.log(`${TITLE[cmd]}: logged${r.notified ? ' and sent' : ''}${r.issue ? ` · issue ${r.issue}` : ''}${r.note ? ` · ${r.note}` : ''}`);
    else console.error(`fix log failed: ${r.error}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'list' || cmd === 'issues') {
    const p = new URLSearchParams();
    for (const k of ['outcome', 'session', 'build', 'issue', 'agent', 'since', 'q', 'limit', 'state']) if (typeof f[k] === 'string') p.set(k, f[k]);
    const r = await consoleCall('GET', `/api/plugins/${FOLDER}/${cmd === 'list' ? 'entries' : 'issues'}?${p}`);
    if (r.status !== 200 || !r.json) { console.error(`fix log unavailable (${r.status || r.error})`); return 1; }
    if (f.json) { console.log(JSON.stringify(r.json, null, 1)); return 0; }
    if (cmd === 'list') for (const e of r.json.entries) console.log(`${e.at.slice(0, 16).replace('T', ' ')}  ${TITLE[e.outcome].padEnd(12)} ${e.text}  [${e.build || e.session}] ${e.issue}`);
    else for (const i of r.json.issues) console.log(`${i.lastAt.slice(0, 16).replace('T', ' ')}  ${TITLE[i.state].padEnd(12)} ${i.title} (tries ${i.tries}, failed ${i.failures})  ${i.issue}`);
    return 0;
  }
  console.error('usage: fixlog.mjs found|trying|failed|fixed "<one short line>" [--issue id] [--detail d] [--build b] · list · issues');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
