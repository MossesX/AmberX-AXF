#!/usr/bin/env node
/**
 * host-services — the console's host services from the shell (host-service@1, framework/spec/HOST-SERVICES.md).
 * Same answers as Settings → Plugins → Host services, REST /api/host-services, the MCP tools host_services_* and
 * voice (host.status / host.restart / host.rollback): one host API behind all of them.
 *
 *   node framework/cli/host-services.mjs list [--json]             every service: status, since, mode, unit
 *   … status <id> [--json]                                         one service (state, heartbeat, last run, reason)
 *   … restart <id> | start <id> | stop <id> | run <id>             unit verbs (restart and stop are destructive: --yes)
 *   … action <id> <action> [--args '{…}'] [--yes]                  one of the service's declared actions
 *   … mode [<id> <container|shadow|host>] [--why "…"] [--yes]      the mode document, or move one service (back: --yes)
 *   … rollback <id> [--to shadow] [--why "…"] --yes                give the part back to the console's copy
 *   … logs <id> [--lines n]                                        journal lines
 *   … settings <id> [key=value …]                                  read, or set key by key
 *   axf host …                                                     the same (framework/cli/axf.mjs)
 *
 * Where it asks, in order: the host API's unix socket (AXF_HOST_API, default /run/axf-host/api.sock; on the VPS as
 * root or axf-host), the loopback listener with AXF_HOST_TOKEN (read from /etc/axf-host/env when it is not set), then
 * the console's REST (AXF_CONSOLE_URL, default https://console.amberxai.com, with AXF_TOKEN). Exit codes follow the
 * engine (consoleAnswer): 3 = host_service_down, 4 = confirm needed, 5 = retry later, 2 = anything else wrong.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as H from '../core/host-services.mjs';

const SELF = fileURLToPath(import.meta.url);

function hostToken() {
  if (process.env.AXF_HOST_TOKEN) return process.env.AXF_HOST_TOKEN.trim();
  try { return (readFileSync('/etc/axf-host/env', 'utf8').match(/^AXF_HOST_TOKEN=(.*)$/m)?.[1] || '').trim(); } catch { return ''; }
}

function callHost(ep, method, path, body, token) {
  return new Promise((res) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = H.requestFor(ep, path, { token });
    const u = ep.kind === 'http' ? new URL(req.url) : null;
    const r = request({ ...(ep.kind === 'socket' ? { socketPath: ep.path } : { host: u.hostname, port: u.port || 80 }), method, path: req.path, headers: { ...req.headers, ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) }, timeout: 120000 }, (x) => {
      let s = ''; x.on('data', (c) => { s += c; }); x.on('end', () => { let b = s; try { b = JSON.parse(s); } catch { /* text */ } res({ status: x.statusCode, body: b }); });
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    r.on('error', (error) => res({ error }));
    if (data) r.write(data);
    r.end();
  });
}

/** One call: the host API first (socket, loopback), then the console REST. Returns the body or throws HostServiceError. */
export async function call(method, path, body, { fetch: f = globalThis.fetch, env = process.env } = {}) {
  const token = hostToken();
  const { endpoints } = H.resolveEndpoints({ ...env, AXF_HOST_API_FALLBACK: env.AXF_HOST_API_FALLBACK ?? `http://${H.DEFAULTS.loopbackHost}:${H.DEFAULTS.loopbackPort}`, AXF_HOST_TOKEN: token });
  let last = null;
  for (const ep of endpoints) {
    const r = await callHost(ep, method, path, body, token);
    if (r.error) { last = H.toHostError(r, { endpoint: ep.url }); continue; }
    const err = H.toHostError(r);
    if (err && err.code === 'unauthorized' && ep.kind === 'http') { last = err; continue; }
    if (err) throw err;
    return r.body;
  }
  // the console's REST: same paths under /api/host-services (no /v1), console token
  const base = (env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/$/, '');
  if (env.AXF_CONSOLE_URL || env.AXF_TOKEN) {
    try {
      const p = path.replace(/^\/services(?=\/|$)/, '').replace(/^\/mode$/, '/mode');
      const r = await f(`${base}/api/host-services${p === '' ? '' : p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AXF_TOKEN || ''}`, 'x-axf-by': 'cli' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let b = text; try { b = JSON.parse(text); } catch { /* text */ }
      const frame = b && typeof b === 'object' && b.$axf === H.ERROR_FRAME ? b : b?.detail?.$axf === H.ERROR_FRAME ? b.detail : null;
      if (r.ok) return b;
      throw H.toHostError({ status: r.status, body: frame || b });
    } catch (e) { if (e instanceof H.HostServiceError) throw e; last = H.toHostError({ error: e }, { endpoint: base }); }
  }
  throw last || new H.HostServiceError('host_service_down', 'no host API endpoint and no console to ask', { service: H.DEFAULTS.hostApiId });
}

const ago = (iso) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
const line = (s) => `${s.id.padEnd(20)} ${String(s.status).padEnd(9)} ${String(s.mode || '').padEnd(10)} ${(s.since ? `for ${ago(s.since)}` : '').padEnd(10)} ${s.unit || ''}${s.reason ? `  (${s.reason})` : ''}`;

async function main(argv) {
  const json = argv.includes('--json');
  const yes = argv.includes('--yes') || argv.includes('--confirm');
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--args', '--why', '--to', '--lines'].includes(argv[i - 1]));
  const [cmd = 'list', id = '', a2 = ''] = pos;
  const enc = encodeURIComponent;
  const by = 'svc:cli';
  const reason = (title) => ({ title, description: 'axf host (framework/cli/host-services.mjs)' });
  const confirmNeeded = (what) => { if (!yes) throw new H.HostServiceError('confirm_required', `${what} is destructive: run it again with --yes`, { service: id }); };
  const need = () => { if (!id) throw new H.HostServiceError('invalid_body', `usage: host-services ${cmd} <id>`); };
  let out;
  switch (cmd) {
    case 'list': {
      out = await call('GET', '/services');
      if (!json) { console.log((out.services || []).map(line).join('\n')); if (out.errors?.length) console.log(`manifest errors:\n  ${out.errors.join('\n  ')}`); return; }
      break;
    }
    case 'status': need(); out = await call('GET', `/services/${enc(id)}`);
      if (!json) { console.log(line(out)); console.log(`  unit ${out.unitState}${out.timerState ? `, timer ${out.timerState}` : ''}, heartbeat ${out.heartbeat?.at ? `${ago(out.heartbeat.at)} ago` : '—'}, last run ${out.lastRun ? `${out.lastRun.result} ${ago(out.lastRun.at)} ago${out.lastRun.message ? `: ${out.lastRun.message}` : ''}` : '—'}`); return; }
      break;
    case 'restart': case 'stop': need(); confirmNeeded(cmd); out = await call('POST', `/services/${enc(id)}/unit/${cmd}`, { by, reason: reason(`${cmd} ${id}`) }); break;
    case 'start': case 'run': need(); out = await call('POST', `/services/${enc(id)}/unit/${cmd}`, { by, reason: reason(`${cmd} ${id}`) }); break;
    case 'action': {
      need(); if (!a2) throw new H.HostServiceError('invalid_body', 'usage: host-services action <id> <action> [--args json] [--yes]');
      out = await call('POST', `/services/${enc(id)}/actions/${enc(a2)}`, { args: opt('--args') ? JSON.parse(opt('--args')) : {}, confirm: yes, by, reason: reason(`${a2} on ${id}`) });
      break;
    }
    case 'mode': {
      if (!id) { out = await call('GET', '/mode'); break; }
      if (!a2) { out = await call('GET', `/services/${enc(id)}/mode`); break; }
      const cur = (await call('GET', `/services/${enc(id)}/mode`)).mode;
      if (H.MODES.indexOf(a2) < H.MODES.indexOf(cur)) confirmNeeded(`Moving ${id} back to ${a2}`);
      out = await call('PUT', `/services/${enc(id)}/mode`, { to: a2, by, why: opt('--why') || '', reason: reason(`${id}: ${cur} → ${a2}`), confirm: yes });
      break;
    }
    case 'rollback': need(); confirmNeeded('Rollback'); out = await call('POST', `/services/${enc(id)}/rollback`, { to: opt('--to') === 'shadow' ? 'shadow' : 'container', by, why: opt('--why') || 'axf host rollback', reason: reason(`Roll back ${id}`), confirm: true }); break;
    case 'logs': need(); out = await call('GET', `/services/${enc(id)}/logs?lines=${Number(opt('--lines')) || 200}`);
      if (!json) { console.log((out.lines || []).map((l) => `${l.at} ${l.line}`).join('\n')); return; }
      break;
    case 'settings': {
      need();
      const sets = pos.slice(2).filter((x) => x.includes('='));
      if (!sets.length) { out = await call('GET', `/services/${enc(id)}/settings`); break; }
      const set = Object.fromEntries(sets.map((kv) => { const [k, ...v] = kv.split('='); const raw = v.join('='); let val = raw; try { val = JSON.parse(raw); } catch { /* a string */ } return [k, val]; }));
      out = await call('PUT', `/services/${enc(id)}/settings`, { set, by, reason: reason(`Settings of ${id}`) });
      break;
    }
    case 'help': case '-h': case '--help':
      console.log(readFileSync(SELF, 'utf8').split('\n').slice(2, 20).map((l) => l.replace(/^ \* ?/, '')).join('\n')); return;
    default: throw new H.HostServiceError('invalid_body', `unknown command ${cmd} (list, status, restart, start, stop, run, action, mode, rollback, logs, settings)`);
  }
  console.log(JSON.stringify(out, null, json ? 2 : 1));
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).catch((e) => {
    const a = H.consoleAnswer(e instanceof H.HostServiceError ? e : new H.HostServiceError('internal', e?.message || String(e)));
    console.error(a.cli.line);
    process.exit(a.cli.exit);
  });
}
