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
 *   axf console plugin-settings <plugin> [--get|--open|--set key=value|--enable|--disable]
 *                                                       one plugin's Settings → Plugins sub-tab: read it (default), open it
 *                                                       in the console (= its screen's settings gear), set one setting, on/off
 *   axf console chrome get|set|reset|open <type> <id> [key] [value]
 *                                                       one tab group / toolbar / banner / nav / menu's own settings (the
 *                                                       keys its Settings → Interface tab writes, axf.chrome.<type>.<id>):
 *                                                       get [key] · set <key> <value> (asset = the asset it uses; reset or
 *                                                       '' drops it) · reset [key] (all of them: --confirm) · open [tab]
 *   axf console voice "<phrase>"                       what AmberX does with a spoken phrase ("scroll down", "disable plugin skins")
 *   axf console do <verb> [address] [--value v] [--confirm] [--reason "…"] [--to recent|all|<client>]
 *   --json  the answer as JSON · --remote <url>  another console
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (send again with --confirm) · 4 no console open (openUrl printed).
 */
import { pathToFileURL } from 'node:url';

export const CONTROL_SUBCOMMANDS = new Set(['do', 'state', 'targets', 'search', 'focus', 'scroll', 'plugin', 'voice', 'plugin-settings', 'toolbar', 'chrome']);
/** The chrome kinds with a settings dialog (chrome-settings@1 CHROME_TYPES). */
const CHROME_KINDS = ['tab-group', 'toolbar', 'banner', 'nav-menu', 'app-menu', 'context-menu'];
/** One chrome instance setting's address: the same key its Settings → Interface tab writes. */
export const chromeSettingAddress = (type, id, key) => `setting:chrome.${type}.${id}.${key}`;
const VERBS = ['open', 'state', 'press', 'set', 'scroll', 'focus', 'search', 'list', 'plugin.enable', 'plugin.disable'];
const SCROLL_DIRS = ['up', 'down', 'page-up', 'page-down', 'top', 'bottom', 'to'];
const FLAGS_WITH_VALUE = new Set(['value', 'reason', 'to', 'kinds', 'limit', 'under', 'source', 'amount', 'address', 'remote', 'by', 'set']);

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
    case 'plugin-settings': {
      const id = args[0];
      if (!id) throw new Error('usage: axf console plugin-settings <plugin> [--get|--open|--set key=value|--enable|--disable]');
      const at = `/plugins/${encodeURIComponent(id)}`;
      if (flags.enable || flags.disable) return { method: 'POST', path: `${at}/${flags.enable ? 'enable' : 'disable'}`, body: { ...(flags.force ? { force: true } : {}), ...extra } };
      if (typeof flags.set === 'string') {
        const [key, v] = flags.set.split(/=(.*)/s, 2);
        if (!key || v === undefined) throw new Error('usage: axf console plugin-settings <plugin> --set key=value');
        return { method: 'POST', path: `${at}/settings/set`, body: { key, value: value(v), ...extra } };
      }
      if (flags.open) return { method: 'POST', path: `${at}/settings/open`, body: { ...extra } };
      return { method: 'GET', path: `${at}/settings` };
    }
    case 'chrome': {
      const [op, type, id, key, ...rest] = args;
      const usage = `usage: axf console chrome get|set|reset|open <${CHROME_KINDS.join('|')}> <id> [key] [value]`;
      if (!['get', 'set', 'reset', 'open'].includes(op) || !CHROME_KINDS.includes(type) || !id) throw new Error(usage);
      if (op === 'get') return key ? { method: 'GET', path: `/state?address=${encodeURIComponent(chromeSettingAddress(type, id, key))}` } : { method: 'POST', path: '/search', body: { query: { q: `chrome.${type}.${id}`, kinds: ['setting'], limit: 60 }, ...extra } };
      if (op === 'set') {
        if (!key || (!rest.length && flags.value === undefined)) throw new Error(`usage: axf console chrome set ${type} ${id} <key> <value>`);
        return { method: 'POST', path: '/do', body: { verb: 'set', address: chromeSettingAddress(type, id, key), value: value(flags.value !== undefined ? flags.value : rest.join(' ')), ...extra } };
      }
      if (op === 'reset') return key
        ? { method: 'POST', path: '/do', body: { verb: 'set', address: chromeSettingAddress(type, id, key), value: 'reset', ...extra } }
        : { method: 'POST', path: '/do', body: { verb: 'press', address: 'function:chrome.reset', value: `${type}:${id}`, ...(flags.confirm ? { confirm: true } : {}), ...extra } };
      return { method: 'POST', path: '/do', body: { verb: 'press', address: 'function:chrome.settings', value: `${type}:${id}:${key || 'interface'}`, ...extra } };
    }
    case 'toolbar': {
      // page toolbars (page-toolbar@1): list the toolbars on screen, read one, press one of its buttons
      const [op, id, button] = args;
      if (op === 'list') return { method: 'GET', path: `/toolbars${flags.view ? `?view=${encodeURIComponent(String(flags.view))}` : ''}` };
      if (op === 'get' && id) return { method: 'GET', path: `/toolbars/${encodeURIComponent(id)}` };
      if (op === 'press' && id && button) return { method: 'POST', path: `/toolbars/${encodeURIComponent(id)}/press`, body: { button, ...(flags.value !== undefined ? { value: flags.value } : {}), ...(flags.confirm ? { confirm: true } : {}) } };
      throw new Error('usage: axf console toolbar list [--view <view>] | get <toolbar id> | press <toolbar id> <button> [--value v] [--confirm]');
    }
    case 'voice': {
      const text = args.join(' ').trim();
      if (!text) throw new Error('usage: axf console voice "<phrase>"');
      return { method: 'POST', path: '/voice', body: { text, ...extra } };
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
  if (r.tab !== undefined && r.folder) {
    out.push(`  ${r.label}: ${r.enabled ? 'on' : 'off'} · sub-tab ${r.tab?.address ?? '(none)'}${r.gear ? ` · gear ${r.gear}` : ''}`);
    for (const x of r.settings ?? []) out.push(`  ${x.key} = ${x.value === undefined ? '(read live: axf console state ' + x.address + ')' : JSON.stringify(x.value)}  · ${x.label}`);
  }
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
