#!/usr/bin/env node
/**
 * axf banner widget — banner widget shape and icon from the command line (widget-shape@1, build
 * banner-widget-shapes-plus-change-icon). Every command is the console's REST call (/api/console-control/banner-widgets,
 * AXF_CONSOLE_URL + AXF_TOKEN), so the CLI answers exactly what REST, the MCP tool console_control_banner_widget, the
 * console actions banner.widget.shape|icon|reset and voice ("make the clock a hexagon") answer.
 *
 *   axf banner widget list                               every widget: shape, icon, custom outline, addresses
 *   axf banner widget get <widget>                       one widget (<type>:<id>, e.g. clock:digital-12h; a type, id or label works too)
 *   axf banner widget shape <widget> <circle|square|rounded|pill|hexagon>
 *   axf banner widget shape <widget> --path "<svg>"      a custom outline: one closed SVG path in a 0..100 square (M L H V C S Q T Z)
 *   axf banner widget icon <widget> <pack>/<glyph>|own   another icon pack's glyph, or its own icon back
 *   axf banner widget reset <widget> [--confirm]         every choice of that widget back to default (without --confirm
 *                                                        the console answers confirmation_required, exit 3)
 *   axf banner widget open [<widget>] [settings|shape|icon]
 *                                                        deep link: the Banners settings, the custom shape editor or the
 *                                                        Change icon picker in the open console
 *   --reason "…" · --to recent|all|<client> · --json · --remote <url>
 *
 * Exit codes as `axf console`: 0 ok · 1 failed · 2 usage · 3 confirmation_required · 4 no console open (openUrl printed).
 */
import { pathToFileURL } from 'node:url';
import { exitCode, parseArgs, send } from './console-control.mjs';

export const BANNER_WIDGET_SUBCOMMANDS = ['list', 'get', 'shape', 'icon', 'reset', 'open'];
const SHAPES = ['circle', 'square', 'rounded', 'pill', 'hexagon'];
const USAGE = `usage: axf banner widget list | get <widget> | shape <widget> <${SHAPES.join('|')}> | shape <widget> --path "<svg>" | icon <widget> <pack>/<glyph>|own | reset <widget> [--confirm] | open [<widget>] [settings|shape|icon]`;

/** argv (after `banner widget`) → { method, path, body? } on /api/console-control. */
export function toRequest(argv) {
  const { words, flags } = parseArgs(argv);
  const [sub, widget, arg] = words;
  const extra = { by: typeof flags.by === 'string' ? flags.by : 'cli', ...(flags.reason ? { reason: String(flags.reason) } : {}), ...(flags.to ? { to: String(flags.to) } : {}) };
  const at = (w) => `/banner-widgets/${encodeURIComponent(w).replace(/%3A/gi, ':')}`;
  switch (sub) {
    case 'list': return { method: 'GET', path: '/banner-widgets' };
    case 'get': if (widget) return { method: 'GET', path: at(widget) }; break;
    case 'shape': {
      const path = typeof flags.path === 'string' ? flags.path : '';
      if (widget && path) return { method: 'POST', path: `${at(widget)}/shape`, body: { path, ...extra } };
      if (widget && SHAPES.includes(arg)) return { method: 'POST', path: `${at(widget)}/shape`, body: { shape: arg, ...extra } };
      break;
    }
    case 'icon': if (widget && arg) return { method: 'POST', path: `${at(widget)}/icon`, body: { icon: arg, ...extra } }; break;
    case 'reset': if (widget) return { method: 'POST', path: `${at(widget)}/reset`, body: { ...(flags.confirm ? { confirm: true } : {}), ...extra } }; break;
    case 'open': {
      const what = ['settings', 'shape', 'icon'].includes(widget) ? widget : arg ?? 'settings';
      const w = ['settings', 'shape', 'icon'].includes(widget) ? '' : widget ?? '';
      if (!w) return { method: 'POST', path: '/do', body: { verb: 'open', address: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=banners', ...extra } };
      return { method: 'POST', path: `${at(w)}/open`, body: { what, ...extra } };
    }
    default: break;
  }
  throw new Error(USAGE);
}

/** A few readable lines for an answer. */
export function describe(r) {
  if (!r.ok) return [`✗ ${r.code}: ${r.message}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : [])];
  if (Array.isArray(r.widgets)) return r.widgets.map((w) => `${w.widget}  ${w.label}: ${w.shape ?? '?'}${w.path ? ` (${w.path})` : ''} · icon ${w.icon ?? 'own'}`);
  return [`✓ ${r.verb ?? 'ok'}${r.address ? ` ${r.address}` : ''}${r.value !== undefined ? ` = ${JSON.stringify(r.value)}` : ''}`];
}

export async function main(argv, io = { log: (s) => console.log(s), error: (s) => console.error(s) }, opts = {}) {
  if (argv.includes('--help') || argv.includes('-h') || !argv.length) { io.log(USAGE); return argv.length ? 0 : 2; }
  let req;
  try { req = toRequest(argv); } catch (e) { io.error(String(e.message)); return 2; }
  const { flags } = parseArgs(argv);
  const r = await send(req, { ...(typeof flags.remote === 'string' ? { base: flags.remote } : {}), ...opts });
  if (flags.json) io.log(JSON.stringify(r, null, 2));
  else for (const line of describe(r)) (r.ok ? io.log : io.error)(line);
  return exitCode(r);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)));
