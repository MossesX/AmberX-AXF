#!/usr/bin/env node
/**
 * axf drag — drag anything on the open console from the command line (drag-move@1, framework/spec/DRAG-MOVE.md). Every
 * command is the console's REST call (/api/drag/*; AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN), so
 * the CLI answers exactly what REST, the console_drag_* MCP tools and voice answer.
 *
 *   axf drag list [kind] [container]                     every draggable host on the page and its items in order
 *   axf drag zones <kind> <container> <item>             where that item may land (each line a ready target)
 *   axf drag move <kind> <container> <item> before|after <ref>        reorder next to another item
 *   axf drag move <kind> <container> <item> into [index]              at a position (0 = first; none = last)
 *   axf drag move <kind> <container> <item> side <side> [index]       to a side (banner left|center|right, toolbar start|end, dock left|right|top|bottom)
 *        … add --to <container> to land in another container (a tab in another stack, a widget on another host)
 *   axf drag add <kind> <item> <container> [before|after <ref> | into [index] | side <side> [index]] [--from <catalogue>] [--type <type>]
 *   axf drag remove <kind> <container> <item> [--confirm]
 *   axf drag preview <same as move>                      highlight where it would land, move nothing
 *   axf drag show <kind> <container> [item]              open its page and highlight it and its drop zones (= drag:<kind>:<container>:<item>)
 *   axf drag voice "<phrase>"                           what AmberX does with it ("drag the Logs tab first")
 *   axf drag <move|add|remove|preview> --json-command '{…drag-move@1…}'                   any command as JSON
 *   --reason "…"  why (kept in the activity log) · --by <who> · --to-console recent|all|<client> · --json · --remote <url>
 *
 * Kinds: banner-widget, toolbar-item, tab, dock-pane, grid-column, grid-row, list-item, layout-slot.
 * Examples:
 *   axf drag list banner-widget
 *   axf drag move banner-widget banner clock:main side left 0 --reason "clock first"
 *   axf drag move tab settings.tabs plugins before appearance
 *   axf drag move grid-column queue model into 0
 *   axf drag remove banner-widget banner cpu:main
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 confirmation_required (send again with --confirm) · 4 no console open.
 */
import { pathToFileURL } from 'node:url';

export const DRAG_SUBCOMMANDS = ['list', 'zones', 'show', 'move', 'add', 'remove', 'preview', 'voice'];
const FLAGS_WITH_VALUE = new Set(['reason', 'by', 'to', 'to-console', 'from', 'type', 'remote', 'json-command']);
const ZONES = ['before', 'after', 'into', 'side'];

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

const int = (s, what) => {
  if (s === undefined) return undefined;
  if (!/^-?\d+$/.test(s)) throw new Error(`usage: ${what} must be a whole number, not ${s}`);
  return Number(s);
};

/** `before <ref>` | `after <ref>` | `into [index]` | `side <side> [index]` → a drag-move@1 target (container filled in). */
export function parseTarget(container, words) {
  const [zone, a, b] = words;
  if (zone === undefined) return { container, zone: 'into' };
  if (!ZONES.includes(zone)) throw new Error(`usage: the drop is before|after <ref>, into [index] or side <side> [index], not ${zone}`);
  if (zone === 'before' || zone === 'after') { if (!a) throw new Error(`usage: ${zone} needs the item it lands next to`); return { container, zone, ref: a }; }
  if (zone === 'into') return { container, zone, ...(a !== undefined ? { index: int(a, 'index') } : {}) };
  if (!a) throw new Error('usage: side needs a side name');
  return { container, zone, side: a, ...(b !== undefined ? { index: int(b, 'index') } : {}) };
}

/**
 * A CLI command → the REST request it is: { method, path, body? }. Throws Error('usage: …') on bad input. Pure, so the
 * parity test checks the CLI sends the same command as the MCP tools.
 */
export function toRequest(argv) {
  const { words, flags } = parseArgs(argv);
  const [sub, ...w] = words;
  const extra = { ...(typeof flags.reason === 'string' ? { reason: flags.reason } : {}), by: typeof flags.by === 'string' ? flags.by : 'cli', ...(typeof flags['to-console'] === 'string' ? { to: flags['to-console'] } : {}) };
  const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
  switch (sub) {
    case 'list': return { method: 'GET', path: `/hosts${w.length ? `?${q({ kind: w[0], container: w[1] })}` : ''}` };
    case 'show': {
      const [kind, container, id] = w;
      if (!kind || !container) throw new Error('usage: axf drag show <kind> <container> [item]');
      return { method: 'GET', path: `/show?${q({ kind, container, id })}` };
    }
    case 'voice': {
      if (!w.length) throw new Error('usage: axf drag voice "move the clock widget to the left of the banner"');
      return { method: 'POST', path: '/voice', body: { text: w.join(' '), ...extra } };
    }
    case 'zones': {
      const [kind, container, id] = w;
      if (!kind || !container || !id) throw new Error('usage: axf drag zones <kind> <container> <item>');
      return { method: 'GET', path: `/zones?${q({ kind, container, id })}` };
    }
    case 'move': case 'preview': case 'add': case 'remove': {
      if (typeof flags['json-command'] === 'string') {
        let cmd; try { cmd = JSON.parse(flags['json-command']); } catch (e) { throw new Error(`usage: --json-command is not JSON (${e.message})`); }
        return { method: 'POST', path: `/${sub}`, body: { ...extra, ...cmd } };
      }
      if (sub === 'remove') {
        const [kind, container, id] = w;
        if (!kind || !container || !id) throw new Error('usage: axf drag remove <kind> <container> <item> [--confirm]');
        return { method: 'POST', path: '/remove', body: { kind, source: { container, id }, ...(flags.confirm ? { confirm: true } : {}), ...extra } };
      }
      if (sub === 'add') {
        const [kind, id, container, ...drop] = w;
        if (!kind || !id || !container) throw new Error('usage: axf drag add <kind> <item> <container> [drop]');
        const source = { id, ...(typeof flags.from === 'string' ? { container: flags.from } : {}), ...(typeof flags.type === 'string' ? { type: flags.type } : {}) };
        return { method: 'POST', path: '/add', body: { kind, source, target: parseTarget(container, drop), ...extra } };
      }
      const [kind, container, id, ...drop] = w;
      if (!kind || !container || !id) throw new Error(`usage: axf drag ${sub} <kind> <container> <item> before|after <ref> | into [index] | side <side> [index] [--to <container>]`);
      const to = typeof flags.to === 'string' ? flags.to : container;
      return { method: 'POST', path: `/${sub}`, body: { kind, source: { container, id }, target: parseTarget(to, drop), ...extra } };
    }
    default: throw new Error(`usage: axf drag ${DRAG_SUBCOMMANDS.join('|')} … (see the header of framework/cli/drag.mjs)`);
  }
}

/** Send a request to the console's REST API → the answer (also on an HTTP error status). */
export async function send(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const url = `${base.replace(/\/$/, '')}/api/drag${req.path}`;
  try {
    const res = await f(url, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, code: 'failed', message: `${res.status} from ${url}: ${text.slice(0, 200)}` }; }
  } catch (e) {
    return { ok: false, code: 'unavailable', message: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

const orderLine = (c, o) => `  ${c}: ${Array.isArray(o) ? o.join(', ') : Object.entries(o).map(([s, l]) => `${s} [${l.join(', ')}]`).join(' ')}`;

/** A few readable lines for an answer. */
export function describe(r) {
  if (!r.ok) return [`✗ ${r.code}: ${r.message}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : []), ...(r.nearest?.length ? [`  nearest: ${r.nearest.join(', ')}`] : [])];
  if (r.$axf === 'drag-list@1') {
    const out = [`${r.hosts.length} draggable hosts on ${r.view}`];
    for (const h of r.hosts) {
      out.push(`${h.kind} ${h.container}${h.label ? `  · ${h.label}` : ''}`);
      if (h.sides?.length) for (const s of h.sides) out.push(`  ${s}: ${h.items.filter((i) => i.side === s).map((i) => i.id).join(', ') || '(empty)'}`);
      else out.push(`  ${h.items.map((i) => `${i.id}${i.locked ? ' (locked)' : ''}`).join(', ') || '(empty)'}`);
    }
    return out;
  }
  if ('say' in r && r.say) return [`🗣 ${r.say}`];
  if (r.$axf === 'drag-show@1') return [`✓ showing ${r.kind} ${r.id ?? r.container} on ${r.view}${r.zones ? ` · ${r.zones} drop zones` : ''}`, orderLine(r.container, r.host.order)];
  if (r.$axf === 'drag-zones@1') return [`${r.targets.length}${r.more ? '+' : ''} places for ${r.kind} ${r.id} (from ${r.container})`, ...r.targets.map((t) => `  ${t.container} ${t.zone}${t.ref ? ` ${t.ref}` : ''}${t.side ? ` ${t.side}` : ''}${t.index !== undefined ? ` ${t.index}` : ''}`)];
  const head = !r.to ? `✓ removed ${r.item.id} from ${r.from?.container}` : `✓ ${r.op === 'add' ? 'added' : r.from ? 'moved' : 'previewed'} ${r.item.id} → ${r.to.container}${r.to.side ? ` ${r.to.side}` : ''} place ${r.to.index + 1}`;
  return [head, ...Object.entries(r.order ?? {}).map(([c, o]) => orderLine(c, o))];
}

export const exitCode = (r) => (r.ok ? 0 : r.code === 'confirmation_required' ? 3 : r.code === 'unavailable' ? 4 : 1);

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
