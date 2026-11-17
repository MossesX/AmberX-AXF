#!/usr/bin/env node
/**
 * axf settings — every settings interface and its reset from the command line (plugin-settings@1 + settings-reset@1,
 * framework/spec/PLUGIN-SETTINGS.md). The same routes REST, MCP (settings_interface_get / settings_reset) and voice use.
 *
 *   axf settings open <owner>                         open its own settings window in the open console
 *                                                     (owner = console or a plugin id / folder / name; = settings:plugin/<id>)
 *   axf settings get <owner> [--json]                 the resolved interface, its values and its changed assets
 *                                                     (GET /api/settings/interfaces/<owner>)
 *   axf settings reset <owner> [--include-assets] [--dry-run] [--confirm <token>] [--ask]
 *                                                     POST /api/settings/reset. Destructive: without --confirm it prints the
 *                                                     plan (the changed-assets table) and the token; run it again with
 *                                                     --confirm <token>. --ask opens the confirm dialog in the console instead.
 *   axf settings undo                                 the one undo of the last reset
 *
 * Env: AXF_CONSOLE_URL (default https://console.amberxai.com), AXF_TOKEN.
 */
import { send as sendControl } from './console-control.mjs';

const USAGE = 'usage: axf settings open|get|reset <owner> [--include-assets] [--dry-run] [--confirm <token>] [--ask] [--json] · axf settings undo';

/** argv → { verb, owner, flags } */
export function parse(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--include-assets') flags.includeAssets = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--ask') flags.ask = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--confirm') flags.confirm = argv[++i] ?? '';
    else if (a.startsWith('--confirm=')) flags.confirm = a.slice(10);
    else pos.push(a);
  }
  return { verb: pos[0] ?? '', owner: pos[1] ?? 'console', flags };
}

/** The request one command makes: { api: 'settings' | 'control', method, path, body? }. */
export function request({ verb, owner, flags }) {
  const scope = owner === 'console' || owner === 'app' ? 'console' : owner;
  switch (verb) {
    case 'get': return { api: 'settings', method: 'GET', path: `/interfaces/${encodeURIComponent(scope)}` };
    case 'open': return scope === 'console'
      ? { api: 'control', method: 'POST', path: '/do', body: { verb: 'press', address: 'function:app.settings', by: 'cli' } }
      : { api: 'control', method: 'POST', path: '/do', body: { verb: 'press', address: 'function:plugin.settings.open', value: scope, by: 'cli' } };
    case 'reset':
      if (flags.ask) return { api: 'control', method: 'POST', path: '/do', body: { verb: 'press', address: 'function:settings.reset.ask', value: `${scope}${flags.includeAssets ? ':assets' : ''}`, by: 'cli' } };
      return { api: 'settings', method: 'POST', path: '/reset', body: { scope, includeAssets: flags.includeAssets === true, dryRun: flags.dryRun === true, ...(flags.confirm ? { confirm: flags.confirm } : {}), by: 'cli' } };
    case 'undo': return { api: 'control', method: 'POST', path: '/do', body: { verb: 'press', address: 'function:settings.reset.undo', by: 'cli' } };
    default: throw new Error(USAGE);
  }
}

async function sendSettings(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '' } = {}) {
  const url = `${base.replace(/\/$/, '')}/api/settings${req.path}`;
  try {
    const res = await fetch(url, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    try { return { status: res.status, ...JSON.parse(text) }; } catch { return { ok: false, status: res.status, message: text.slice(0, 200) }; }
  } catch (e) {
    return { ok: false, code: 'unexpected', message: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** A plan's rows as lines (the same table the dialog shows). */
export function planLines(plan) {
  if (!plan) return [];
  const rows = [...(plan.settings ?? []).map((r) => ['Setting', r.label ?? r.key, JSON.stringify(r.current), r.default === null ? 'default' : JSON.stringify(r.default)]),
    ...(plan.assets ?? []).map((r) => [r.kind, r.label, r.current, plan.includeAssets ? r.default : 'kept'])];
  return [`${plan.summary ?? ''}`, ...rows.map((r) => `  ${r[0].padEnd(16)} ${String(r[1]).padEnd(36)} ${String(r[2]).padEnd(18)} → ${r[3]}`)];
}

export async function main(argv) {
  let req;
  try { req = request(parse(argv)); } catch (e) { console.error(String(e.message)); return 2; }
  const { flags, verb } = parse(argv);
  const r = req.api === 'settings' ? await sendSettings(req) : await sendControl(req);
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok || r.status === 428 ? 0 : 1; }
  if (verb === 'get' && r.ok) {
    console.log(`${r.owner} · ${r.id} (${r.source})${r.live === false ? ' · no console open: from files' : ''} · opens ${r.opens}`);
    for (const [k, v] of Object.entries(r.values ?? {})) console.log(`  ${k} = ${JSON.stringify(v)}`);
    if (r.changedAssets?.length) { console.log('changed assets:'); for (const a of r.changedAssets) console.log(`  ${a.label}: ${a.current} (default ${a.default})`); }
    return 0;
  }
  if (verb === 'reset' && !flags.ask) {
    for (const l of planLines(r.plan)) console.log(l);
    if (r.status === 428 || (r.dryRun && r.confirm)) { console.log(`\nDestructive. To run it: axf settings reset ${parse(argv).owner}${flags.includeAssets ? ' --include-assets' : ''} --confirm ${r.confirm}`); return 0; }
    console.log(r.ok ? `✓ reset ${r.scope}. Undo: axf settings undo` : `✗ ${r.code ?? r.status}: ${r.message}`);
    return r.ok ? 0 : 1;
  }
  console.log(r.ok ? `✓ ${r.message ?? verb}` : `✗ ${r.code ?? r.status}: ${r.message}`);
  return r.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
