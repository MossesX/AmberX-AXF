#!/usr/bin/env node
/**
 * `axf demo orchestrator start [--pause|--no-pause] | open | pause | resume | next | skip | stop | state | summary
 *  | pause-between-steps on|off | settings [--json] [--url <console>]`
 * `axf demo selftest [--last]`   the lander self-test (demo-selftest@1): POST /selftest, or the saved result
 *
 * The Orchestrator demo from a terminal. Every word is one call to the plugin's REST routes on the console
 * (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN), the same routes the console UI, the MCP tools and
 * voice use, so what the CLI does is exactly what a click does. Reached through plugin.json "cli": { "demo": "cli.mjs" }.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const cliWords = ['orchestrator', 'selftest'];
const BASE = '/api/plugins/orchestrator-demo';

/** word → [method, path, body?]. */
export function requestFor(word, argv = []) {
  const has = (f) => argv.includes(f);
  const why = (() => { const i = argv.indexOf('--why'); return i >= 0 ? argv[i + 1] : undefined; })();
  switch (word) {
    case 'state': return ['GET', '/state'];
    case 'summary': return ['GET', '/summary'];
    case 'settings': return ['GET', '/settings'];
    case 'deps': return ['GET', '/deps'];
    case 'selftest': return has('--last') ? ['GET', '/selftest'] : ['POST', '/selftest', {}];
    case 'start': return ['POST', '/start', has('--pause') ? { pause: true } : has('--no-pause') ? { pause: false } : {}];
    case 'open': return ['POST', '/open', has('--pause') ? { pause: true } : has('--no-pause') ? { pause: false } : {}];
    case 'pause': return ['POST', '/pause', {}];
    case 'resume': return ['POST', '/resume', {}];
    case 'next': return ['POST', '/next', {}];
    case 'skip': return ['POST', '/skip', why ? { why } : {}];
    case 'stop': return ['POST', '/stop', why ? { why } : {}];
    case 'pause-between-steps': {
      const v = argv.find((a) => /^(on|off|true|false)$/i.test(a));
      if (!v) return null;
      return ['PUT', '/pause-between-steps', { pause: /^(on|true)$/i.test(v) }];
    }
    default: return null;
  }
}

export const USAGE = 'axf demo orchestrator start [--pause|--no-pause] | open | pause | resume | next | skip [--why …] | stop [--why …] | state | summary | deps | pause-between-steps on|off | settings  [--json] [--url <console>]\naxf demo selftest [--last]   the lander self-test now (the real gate verdict, review lookup and queue check), or the saved result';

/** One plain line for a person (the --json flag prints the whole answer instead). */
export function describe(word, r) {
  if (r.summary !== undefined && word === 'summary') {
    const s = r.summary;
    if (!s) return 'No demo has run yet.';
    const lines = [`${s.state}: ${s.pass} passed · ${s.fail} failed · ${s.skipped} skipped of ${s.total}`];
    for (const a of s.acts ?? []) lines.push(`  ${({ pass: '✓', fail: '✗', skipped: '–' })[a.result] ?? '·'} ${a.title}${a.error ? `: ${a.error}` : ''}`);
    return lines.join('\n');
  }
  if (word === 'deps') return r.deps?.ok ? `All there${r.deps.skipped ? ` (${r.deps.skipped})` : ''}.` : `${r.deps?.reason ?? ''}`;
  if (word === 'selftest') { const t = r.selftest; if (!t) return 'No self-test has run yet.'; return [`${t.ok ? '✓ passed' : '✗ FAILED'} ${t.at} (${t.durationMs} ms)`, ...(t.checks ?? []).map((c) => `  ${c.ok ? '✓' : '✗'} ${c.id}: ${c.detail}`)].join('\n'); }
  if (r.settings && !r.state) return `Pause between steps: ${r.settings.pauseBetweenSteps ? 'on' : 'off'} · minimum gap ${Math.round(r.settings.minGapMs / 1000)} s`;
  const st = r.state;
  if (!st?.run) return 'No demo run.';
  const cap = st.caption;
  const lines = [`${st.run.id}: ${st.held ? 'paused' : st.run.state}${cap ? ` · act ${cap.n}/${cap.of} ${cap.title}${cap.state === 'cooldown' ? ` · next in ${Math.ceil(cap.countdownMs / 1000)} s` : ''}` : ''} · pause between steps ${st.run.pause ? 'on' : 'off'}`];
  for (const c of st.checklist ?? []) lines.push(`  ${c.mark} ${c.title}${c.result === 'fail' ? `: ${c.error || c.observed}` : ''}`);
  return lines.join('\n');
}

export async function call(method, path, body, { url, token = process.env.AXF_TOKEN || '', fetchFn = fetch } = {}) {
  const base = (url || process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/$/, '');
  let res;
  try {
    res = await fetchFn(`${base}${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
  } catch (e) {
    return { ok: false, status: 0, error: `can't reach the console at ${base} (${e?.message ?? e}); set AXF_CONSOLE_URL and AXF_TOKEN` };
  }
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = null; }
  if (!res.ok) return { ok: false, status: res.status, error: typeof j?.detail === 'string' ? j.detail : res.status === 404 && !j ? 'the Orchestrator demo is off or its server part is not running' : text.slice(0, 300) };
  return { ...(j ?? {}), ok: true, status: res.status };
}

export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error, fetchFn } = {}) {
  const args = argv[0] === 'orchestrator' ? argv.slice(1) : argv;
  const word = args[0] || 'state';
  if (word === 'help' || word === '--help') { log(USAGE); return 0; }
  const req = requestFor(word, args.slice(1));
  if (!req) { err(`usage: ${USAGE}`); return 2; }
  const ui = args.indexOf('--url');
  const r = await call(req[0], req[1], req[2], { url: ui >= 0 ? args[ui + 1] : undefined, fetchFn });
  if (args.includes('--json')) log(JSON.stringify(r, null, 2));
  else if (!r.ok) err(`✗ ${r.error}`);
  else log(describe(word, r));
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
