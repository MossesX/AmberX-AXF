#!/usr/bin/env node
/**
 * axf console — console-control@1 from the command line (framework/spec/CONSOLE-CONTROL.md). Every command is the REST
 * call of the console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN), so the CLI answers exactly what
 * REST, MCP and voice answer.
 *
 *   axf console state [address]                         where the console is (screen, tabs, scroll, focus), or one target
 *   axf console targets [--under <address>] [--kinds setting,plugin] [--source auto|console|inventory]
 *   axf console search <words…> [--kinds k,k] [--limit n]
 *   axf console focus <address> [--select] [--expand]
 *   axf console scroll up|down|page-up|page-down|top|bottom [--amount 0.5] [--address <pane>] · scroll to <address>
 *   axf console plugin enable|disable <plugin> [--force]
 *   axf console do <verb> [address] [--value v] [--confirm] [--reason "…"] [--to recent|all|<client>]
 *   --json  the answer as JSON · --remote <url>  another console
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (send again with --confirm) · 4 no console open (openUrl printed).
 */
import { pathToFileURL } from 'node:url';

export const CONTROL_SUBCOMMANDS = new Set(['do', 'state', 'targets', 'search', 'focus', 'scroll', 'plugin']);
const VERBS = ['open', 'state', 'press', 'set', 'scroll', 'focus', 'search', 'list', 'plugin.enable', 'plugin.disable'];
const SCROLL_DIRS = ['up', 'down', 'page-up', 'page-down', 'top', 'bottom', 'to'];
const FLAGS_WITH_VALUE = new Set(['value', 'reason', 'to', 'kinds', 'limit', 'under', 'source', 'amount', 'address', 'remote', 'by']);

/** argv → { words, flags }. */
export function parseArgs(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[k] = inline;
    else if (FLAGS_WITH_VALUE.has(k) && i + 1 < argv.length) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return { words, flags };
}

const value = (v) => {
  if (v === undefined || v === true) return v;
  try { return JSON.parse(v); } catch { return v; }
};

/**
 * A CLI command → the REST request it is: { method, path, body? }. Throws Error('usage: …') on bad input.
 * Pure, so the parity test can check the CLI maps to the same command as MCP and voice.
 */
export function toRequest(argv) {
  const { words, flags } = parseArgs(argv);
  const [sub, ...args] = words;
  const by = typeof flags.by === 'string' ? flags.by : 'cli';
  const extra = { by, ...(flags.reason ? { reason: String(flags.reason) } : {}), ...(flags.to ? { to: String(flags.to) } : {}) };
  switch (sub) {
    case 'state': return args[0] ? { method: 'GET', path: `/state?address=${encodeURIComponent(args[0])}` } : { method: 'GET', path: '/state' };
    case 'targets': {
      const q = new URLSearchParams();
      for (const k of ['under', 'kinds', 'source']) if (typeof flags[k] === 'string') q.set(k, flags[k]);
      if (args[0] && !flags.under) q.set('under', args[0]);
      const s = q.toString();
      return { method: 'GET', path: `/targets${s ? `?${s}` : ''}` };
    }
    case 'search': {
      const q = args.join(' ').trim();
      if (!q) throw new Error('usage: axf console search <words…>');
      return { method: 'POST', path: '/search', body: { query: { q, ...(flags.kinds ? { kinds: String(flags.kinds).split(',').filter(Boolean) } : {}), ...(flags.limit ? { limit: Number(flags.limit) } : {}) }, ...extra } };
    }
    case 'focus': {
      if (!args[0]) throw new Error('usage: axf console focus <address>');
      const options = { ...(flags.select ? { select: true } : {}), ...(flags.expand ? { expand: true } : {}) };
      return { method: 'POST', path: '/focus', body: { address: args[0], ...(Object.keys(options).length ? { options } : {}), ...extra } };
    }
    case 'scroll': {
      const dir = args[0] ?? 'down';
      if (!SCROLL_DIRS.includes(dir)) throw new Error(`usage: axf console scroll ${SCROLL_DIRS.join('|')}`);
      if (dir === 'to' && !args[1]) throw new Error('usage: axf console scroll to <address>');
      const scroll = { dir, ...(flags.amount ? { amount: Number(flags.amount) } : {}), ...(dir === 'to' ? { to: args[1] } : {}) };
      return { method: 'POST', path: '/scroll', body: { scroll, ...(flags.address ? { address: String(flags.address) } : {}), ...extra } };
    }
    case 'plugin': {
      const [op, id] = args;
      if (!['enable', 'disable'].includes(op) || !id) throw new Error('usage: axf console plugin enable|disable <plugin> [--force]');
      return { method: 'POST', path: `/plugins/${encodeURIComponent(id)}/${op}`, body: { ...(flags.force ? { force: true } : {}), ...extra } };
    }
    case 'do': {
      const [verb, address] = args;
      if (!VERBS.includes(verb)) throw new Error(`usage: axf console do <${VERBS.join('|')}> [address] [--value v] [--confirm]`);
      const body = { verb, ...(address ? { address } : {}), ...extra };
      if (flags.value !== undefined) body.value = value(flags.value);
      if (flags.confirm) body.confirm = true;
      if (verb === 'search') body.query = { q: [address, ...args.slice(2)].filter(Boolean).join(' ') };
      if (verb === 'scroll') { body.scroll = { dir: address ?? 'down', ...(flags.amount ? { amount: Number(flags.amount) } : {}) }; delete body.address; }
      return { method: 'POST', path: '/do', body };
    }
    default: throw new Error(`usage: axf console ${[...CONTROL_SUBCOMMANDS].join('|')} …`);
  }
}

/** Send a request to the console's REST API. → the answer (also on an HTTP error status). */
export async function send(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const url = `${base.replace(/\/$/, '')}/api/console-control${req.path}`;
  try {
    const res = await f(url, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, code: 'unexpected', message: `${res.status} from ${url}: ${text.slice(0, 200)}` }; }
  } catch (e) {
    return { ok: false, code: 'unexpected', message: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** A few readable lines for an answer. */
export function describe(r) {
  if (!r.ok) return [`✗ ${r.code}: ${r.message}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : []), ...(r.nearest?.length ? [`  nearest: ${r.nearest.join(', ')}`] : [])];
  const out = [];
  if (Array.isArray(r.hits)) for (const h of r.hits) out.push(`${h.address}  ${h.label}${h.detail ? `  · ${h.detail}` : ''}`);
  else if (Array.isArray(r.targets)) { out.push(`${r.targets.length} targets (${r.source ?? 'console'})`); for (const t of r.targets.slice(0, 200)) out.push(`${t.address}  ${t.label}`); }
  else out.push(`✓ ${r.verb ?? 'ok'}${r.address ? ` ${r.address}` : ''}${r.value !== undefined ? ` = ${JSON.stringify(r.value)}` : ''}${r.enabled !== undefined ? ` (${r.enabled ? 'on' : 'off'})` : ''}`);
  const st = r.state && typeof r.state === 'object' && 'screen' in r.state ? r.state : null;
  if (st) out.push(`  screen ${st.screenLabel ?? st.screen}${st.focused ? ` · focused ${st.focused}` : ''}${st.scroll ? ` · scroll ${Math.round(st.scroll.fraction * 100)}%` : ''}`);
  if (r.effects?.stopsWorking?.length) out.push(`  stops working: ${r.effects.stopsWorking.map((d) => d.name).join(', ')}`);
  if (r.source && !Array.isArray(r.targets)) out.push(`  (${r.source}${r.console === false ? ', no console open' : ''})`);
  return out;
}

export const exitCode = (r) => (r.ok ? 0 : r.code === 'confirmation_required' ? 3 : r.code === 'unavailable' && r.openUrl ? 4 : 1);

export async function main(argv, io = { log: (s) => console.log(s), error: (s) => console.error(s) }, opts = {}) {
  let req;
  try { req = toRequest(argv); } catch (e) { io.error(String(e.message)); return 2; }
  const { flags } = parseArgs(argv);
  const r = await send(req, { ...(typeof flags.remote === 'string' ? { base: flags.remote } : {}), ...opts });
  if (flags.json) io.log(JSON.stringify(r, null, 2));
  else for (const line of describe(r)) (r.ok ? io.log : io.error)(line);
  return exitCode(r);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)));
