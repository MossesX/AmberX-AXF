#!/usr/bin/env node
/**
 * Toolbar widgets from the command line (toolbar-widgets@1): attach any widget to any toolbar, banner style, and move,
 * style or detach it. Every command is one console-control@1 command to Brett's open console, the same body the REST
 * routes (/api/plugins/toolbar-widgets/widgets…, apps/console-web/plugins/toolbar-widgets/server `plan`), the MCP tools
 * toolbar_widgets_* and voice send, so all four reach the same thing.
 *
 *   axf toolbar widgets list [<toolbar>]                                    every widget row of one toolbar (or every toolbar's widget targets)
 *   axf toolbar widgets attach <toolbar> <type:id> [--side start|end] [--size icon|compact|normal|wide] [--shape <id>]
 *   axf toolbar widgets detach <toolbar> <type:id> --confirm                 destructive: without --confirm it answers confirmation_required
 *   axf toolbar widgets move   <toolbar> <type:id> <start|end> [<index|prev|next>]
 *   axf toolbar widgets style  <toolbar> <type:id> <field> [<value>]        field size|show|priority|hideWhenEmpty|overflow|hidden|shape|label; no value = default
 *   axf toolbar widgets open   <toolbar> [<type:id>]                        deep link: the Toolbar widgets dialog
 *   … [--to recent|all|<client>] [--reason "…"] [--json]
 *
 * AXF_CONSOLE_URL (default https://console.amberxai.com) and AXF_TOKEN reach the console. Exit codes: 0 ok, 1 failed,
 * 2 usage, 3 confirmation_required, 4 no console open.
 */
import { pathToFileURL } from 'node:url';
import { describe, exitCode, parseArgs, send } from './console-control.mjs';

const INSTANCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const WIDGET = /^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;
const SIDES = ['start', 'end'];
const SIZES = ['icon', 'compact', 'normal', 'wide'];
export const WIDGET_FIELDS = ['size', 'show', 'priority', 'hideWhenEmpty', 'overflow', 'hidden', 'shape', 'label'];
export const WIDGET_OPS = ['list', 'attach', 'detach', 'move', 'style', 'open'];

const usage = (m) => { const e = new Error(`usage: ${m}`); e.usage = true; return e; };
const toolbarOf = (v) => {
  let t = String(v ?? 'app').trim() || 'app';
  if (t.startsWith('toolbar:')) t = t.slice('toolbar:'.length);
  if (!INSTANCE.test(t)) throw usage(`toolbar must be a toolbar settings id (app, gate.auto-lander), not "${t}"`);
  return t;
};
const widgetOf = (v) => { const w = String(v ?? '').trim(); if (!WIDGET.test(w)) throw usage('widget must be <type>:<id> (status:cpu, clock:digital-12h)'); return w; };
export const listAddress = (t) => `toolbar:${t}/widget:all`;
export const widgetAddress = (t, w) => `toolbar:${t}/widget:${w}`;
export const detachAddress = (t, w) => `${widgetAddress(t, w)}/button:detach`;

/**
 * One operation with its fields → the console-control@1 body (verb, address, value?, confirm?). The JS twin of the
 * toolbar-widgets plugin server's `plan`: the parity test checks both give the same body for the same call.
 */
export function widgetCommand(op, b = {}) {
  const extra = Object.fromEntries(['to', 'reason', 'by'].filter((k) => typeof b[k] === 'string' && b[k]).map((k) => [k, b[k]]));
  if (op === 'list') return b.toolbar ? { verb: 'state', address: listAddress(toolbarOf(b.toolbar)), ...extra } : { verb: 'list', kinds: ['widget'], ...extra };
  const toolbar = toolbarOf(b.toolbar);
  if (op === 'open') return { verb: 'open', address: b.widget ? widgetAddress(toolbar, widgetOf(b.widget)) : listAddress(toolbar), ...extra };
  const widget = widgetOf(b.widget);
  if (op === 'detach') return { verb: 'press', address: detachAddress(toolbar, widget), ...extra, ...(b.confirm ? { confirm: true } : {}) };
  if (op === 'attach') {
    const side = String(b.side || 'end');
    if (!SIDES.includes(side)) throw usage('side must be start or end');
    const size = String(b.size || '');
    if (size && !SIZES.includes(size)) throw usage(`size must be one of ${SIZES.join(', ')}`);
    const shape = String(b.shape || '');
    if (shape && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(shape)) throw usage('shape must be a shape asset id (circle, pill, squircle, …)');
    return { verb: 'press', address: widgetAddress(toolbar, widget), value: ['attach', side, size, shape].join(':').replace(/:+$/, ''), ...extra };
  }
  if (op === 'move') {
    const side = String(b.side || '');
    if (!SIDES.includes(side)) throw usage('side must be start or end');
    const i = b.index;
    if (i !== undefined && i !== null && !['prev', 'next'].includes(String(i)) && !/^-?\d+$/.test(String(i))) throw usage('index must be a number, prev or next');
    return { verb: 'press', address: widgetAddress(toolbar, widget), value: `move:${side}${i !== undefined && i !== null ? `:${i}` : ''}`, ...extra };
  }
  if (op === 'style') {
    const field = String(b.field || '');
    if (!WIDGET_FIELDS.includes(field)) throw usage(`field must be one of ${WIDGET_FIELDS.join(', ')}`);
    const v = b.value === undefined || b.value === null || b.value === '' ? 'default' : b.value === true ? 'true' : b.value === false ? 'false' : String(b.value);
    return { verb: 'press', address: widgetAddress(toolbar, widget), value: `style:${field}:${v}`, ...extra };
  }
  throw usage(`axf toolbar widgets ${WIDGET_OPS.join('|')} …`);
}

/** argv (after `toolbar widgets`) → the REST request on /api/console-control: { method, path, body? }. */
const VALUE_FLAGS = new Set(['side', 'size', 'shape', 'value']);
/** This command's own value flags: `--side end` is read as `--side=end` (console-control's parser knows only its own). */
export function toRequest(argv) {
  const joined = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && !a.includes('=') && VALUE_FLAGS.has(a.slice(2)) && i + 1 < argv.length) { joined.push(`${a}=${argv[++i]}`); continue; }
    joined.push(a);
  }
  const { words, flags } = parseArgs(joined);
  const [op, toolbar, widget, a, b] = words;
  const extra = { by: typeof flags.by === 'string' ? flags.by : 'cli', ...(flags.reason ? { reason: String(flags.reason) } : {}), ...(flags.to ? { to: String(flags.to) } : {}) };
  const fields = {
    list: { toolbar },
    attach: { toolbar, widget, side: flags.side, size: flags.size, shape: flags.shape },
    detach: { toolbar, widget, confirm: !!flags.confirm },
    move: { toolbar, widget, side: a, index: b },
    style: { toolbar, widget, field: a, value: flags.value !== undefined ? flags.value : b },
    open: { toolbar, widget },
  }[op];
  if (!fields) throw usage(`axf toolbar widgets ${WIDGET_OPS.join('|')} <toolbar> …`);
  const cmd = widgetCommand(op, { ...fields, ...extra });
  if (cmd.verb === 'list') return { method: 'GET', path: '/targets?kinds=widget&source=console' };
  if (cmd.verb === 'state') return { method: 'GET', path: `/state?address=${encodeURIComponent(cmd.address)}` };
  return { method: 'POST', path: '/do', body: cmd };
}

export async function main(argv, io = { log: (s) => console.log(s), error: (s) => console.error(s) }, opts = {}) {
  let req;
  try { req = toRequest(argv); } catch (e) { io.error(e.message); return 2; }
  const json = argv.includes('--json');
  const r = await send(req, opts);
  io.log(json ? JSON.stringify(r, null, 2) : describe(r));
  return exitCode(r);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)));
