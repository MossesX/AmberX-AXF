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
 *   axf console voice "<phrase>"                       what AmberX does with a spoken phrase ("scroll down", "disable plugin skins")
 *   axf console read [--no-text]                         what is on screen: dialog, fields with values, buttons (and a line to say)
 *   axf console fields                                   the fields and buttons of the open dialog / screen
 *   axf console fill "Project name=My app" "Template=Blank" [--submit Create] [--reason "…"]   type into fields, press submit
 *   axf console press <button label or address>         press a button on the screen in front ("Create", "button:next")
 *   axf console type <field label or address> <text…>   type into one field
 *   axf console audit [--limit 30] [--all] [--by name]  who did what and why (newest first)
 *   axf console do <verb> [address] [--value v] [--confirm] [--reason "…"] [--to recent|all|<client>]
 *   --json  the answer as JSON · --remote <url>  another console
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (send again with --confirm) · 4 no console open (openUrl printed).
 */
import { pathToFileURL } from 'node:url';

export const CONTROL_SUBCOMMANDS = new Set(['do', 'state', 'targets', 'search', 'focus', 'scroll', 'plugin', 'voice', 'read', 'fields', 'fill', 'press', 'type', 'audit']);
const VERBS = ['open', 'state', 'press', 'set', 'scroll', 'focus', 'search', 'list', 'plugin.enable', 'plugin.disable'];
const SCROLL_DIRS = ['up', 'down', 'page-up', 'page-down', 'top', 'bottom', 'to'];
const FLAGS_WITH_VALUE = new Set(['value', 'reason', 'to', 'kinds', 'limit', 'under', 'source', 'amount', 'address', 'remote', 'by', 'submit']);

/** A label as an address id (= controlSlug in framework/react/controlTargets.ts, slug in server/console_control.py). */
export const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
/** A field / button named by label or by address (the same rule as field_address / button_address on the server). */
export const fieldAddress = (k) => (String(k).includes(':') ? String(k) : `setting:field.${slug(k)}`);
export const buttonAddress = (k) => (String(k).includes(':') ? String(k) : `button:${slug(k)}`);

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
    case 'voice': {
      const text = args.join(' ').trim();
      if (!text) throw new Error('usage: axf console voice "<phrase>"');
      return { method: 'POST', path: '/voice', body: { text, ...extra } };
    }
    case 'read': return { method: 'GET', path: `/screen${flags['no-text'] ? '?text=false' : ''}${flags.to ? `${flags['no-text'] ? '&' : '?'}to=${encodeURIComponent(String(flags.to))}` : ''}` };
    case 'fields': return { method: 'GET', path: `/fields${flags.to ? `?to=${encodeURIComponent(String(flags.to))}` : ''}` };
    case 'fill': {
      const values = {};
      for (const a of args) { const eq = a.indexOf('='); if (eq <= 0) throw new Error('usage: axf console fill "<field>=<value>" … [--submit <button>]'); values[a.slice(0, eq).trim()] = value(a.slice(eq + 1)); }
      if (!Object.keys(values).length && typeof flags.submit !== 'string') throw new Error('usage: axf console fill "<field>=<value>" … [--submit <button>]');
      return { method: 'POST', path: '/fill', body: { values, ...(typeof flags.submit === 'string' ? { submit: flags.submit } : {}), ...extra } };
    }
    case 'press': {
      const name = args.join(' ').trim();
      if (!name) throw new Error('usage: axf console press <button label or address> [--confirm]');
      return { method: 'POST', path: '/do', body: { verb: 'press', address: buttonAddress(name), ...(flags.value !== undefined ? { value: value(flags.value) } : {}), ...(flags.confirm ? { confirm: true } : {}), ...extra } };
    }
    case 'type': {
      const [field, ...text] = args;
      if (!field || !text.length) throw new Error('usage: axf console type <field label or address> <text…>');
      return { method: 'POST', path: '/fill', body: { values: { [field]: text.join(' ') }, ...extra } };
    }
    case 'audit': {
      const q = new URLSearchParams();
      q.set('limit', String(flags.limit ?? 30));
      if (!flags.all) q.set('writes', 'true');
      if (typeof flags.by === 'string') q.set('by', flags.by);
      return { method: 'GET', path: `/audit?${q}` };
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
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object' && j.ok === undefined && !res.ok) return { ok: false, code: res.status === 401 || res.status === 403 ? 'denied' : 'unexpected', message: `${res.status}: ${j.detail ?? text.slice(0, 200)}${res.status === 401 ? ' (set AXF_TOKEN)' : ''}` };
      return j;
    } catch { return { ok: false, code: 'unexpected', message: `${res.status} from ${url}: ${text.slice(0, 200)}` }; }
  } catch (e) {
    return { ok: false, code: 'unexpected', message: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** A few readable lines for an answer. */
export function describe(r) {
  if (!r.ok && Array.isArray(r.filled)) return [...r.filled.map((f) => `${f.ok ? '✓' : '✗'} ${f.field} → ${f.address}${f.ok ? '' : `: ${f.message}`}`), `✗ ${r.code}: ${r.message}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : [])];
  if (!r.ok) return [`✗ ${r.code}: ${r.message}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : []), ...(r.nearest?.length ? [`  nearest: ${r.nearest.join(', ')}`] : [])];
  const out = [];
  if (r.screen && typeof r.screen === 'object') {
    const sc = r.screen;
    out.push(`${sc.title ?? sc.view}${sc.dialog ? ` › ${sc.dialog.title} (dialog)` : ''}`);
    for (const f of sc.fields ?? []) out.push(`  ${f.address}  ${f.label} [${f.type}${f.required ? ', required' : ''}${f.disabled ? ', disabled' : ''}] = ${JSON.stringify(f.value)}${f.options ? `  options: ${f.options.map((o) => o.label ?? o).join(' | ')}` : ''}`);
    for (const b of sc.buttons ?? []) out.push(`  ${b.address}  ${b.label}${b.disabled ? ' (disabled)' : ''}`);
    if (r.say) out.unshift(`🗣 ${r.say}`);
    return out;
  }
  if (Array.isArray(r.filled)) {
    for (const f of r.filled) out.push(`${f.ok ? '✓' : '✗'} ${f.field} → ${f.address}${f.ok ? ` = ${JSON.stringify(f.value)}` : `: ${f.message}`}`);
    if (r.pressed) out.push(`${r.pressed.ok ? '✓' : '✗'} pressed ${r.pressed.button}${r.pressed.ok ? '' : `: ${r.pressed.message}`}`);
    if (r.screen) out.push(`  now: ${r.screen.title ?? r.screen.view}${r.screen.dialog ? ` › ${r.screen.dialog.title}` : ''}`);
    return out;
  }
  if (Array.isArray(r.lines)) { for (const l of r.lines) out.push(`${l.at}  ${l.by}  ${l.verb} ${l.address ?? l.query ?? ''}${l.value !== undefined ? ` = ${l.value}` : ''}  · ${l.reason ?? ''}  [${l.policy}${l.decidedBy ? `, ${l.decidedBy}` : ''}] ${l.ok ? 'ok' : l.code}`); return out; }
  if (Array.isArray(r.hits)) for (const h of r.hits) out.push(`${h.address}  ${h.label}${h.detail ? `  · ${h.detail}` : ''}`);
  else if (Array.isArray(r.targets)) { out.push(`${r.targets.length} targets (${r.source ?? 'console'})`); for (const t of r.targets.slice(0, 200)) out.push(`${t.address}  ${t.label}`); }
  else out.push(`✓ ${r.verb ?? 'ok'}${r.address ? ` ${r.address}` : ''}${r.value !== undefined ? ` = ${JSON.stringify(r.value)}` : ''}${r.enabled !== undefined ? ` (${r.enabled ? 'on' : 'off'})` : ''}`);
  const st = r.state && typeof r.state === 'object' && 'screen' in r.state ? r.state : null;
  if (st) out.push(`  screen ${st.screenLabel ?? st.screen}${st.focused ? ` · focused ${st.focused}` : ''}${st.scroll ? ` · scroll ${Math.round(st.scroll.fraction * 100)}%` : ''}`);
  if (r.effects?.stopsWorking?.length) out.push(`  stops working: ${r.effects.stopsWorking.map((d) => d.name).join(', ')}`);
  if (r.say) out.unshift(`🗣 ${r.say}`);
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
