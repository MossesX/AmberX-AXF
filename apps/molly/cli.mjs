#!/usr/bin/env node
/**
 * Molly from the command line (build molly-one-shell s12): `axf molly …` (or `node apps/molly/cli.mjs …`).
 *
 * Every app mounted in Molly carries the action `host:<Molly's action spec>` (framework/react/nativeSurface.tsx). The
 * Dev Console mounted in Molly takes remote commands (control@1 console domain, `POST /api/console`, the same channel as
 * the console MCP tools and REST), so each verb below is a console action `host:…` that Molly runs, in the Molly the
 * user used last (`--to all` for every one, or a client id).
 *
 *   axf molly open <ref> [--in main|pane|floating]   open anything: <app>:<kind>:<id> (from `axf molly list` in Go)
 *   axf molly go [words]                             Go to anything, words typed
 *   axf molly mode single|tabs|split|ide             layout mode
 *   axf molly layout save <name> | switch <id> | remove <id>
 *   axf molly pane <n> <ref>                         what dropping a menu item on pane n does
 *   axf molly tabs <n> [on|off]                      pane n as a tab group or not
 *   axf molly favorite <ref> | recents-clear | settings | reload | banners
 *   axf molly action <Molly action spec>             any other Molly action
 *
 * Env: AXF_CONSOLE_URL (default https://console.amberxai.com), AXF_TOKEN. Exit 0 ok · 1 failed · 2 usage.
 */
export const USAGE = 'usage: axf molly open <ref> [--in main|pane|floating] | go [words] | mode <single|tabs|split|ide> | layout save|switch|remove <x> | pane <n> <ref> | tabs <n> [on|off] | favorite <ref> | recents-clear | settings | reload | banners | action <spec>   [--to recent|all|<client>] [--json]';

/** `axf molly …` words → Molly's action spec, or null (usage). */
export function specFromArgv(argv) {
  const words = []; const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split(/=(.*)/s); f[k] = v !== undefined ? v : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else words.push(a);
  }
  const [verb, ...rest] = words[0] === 'molly' ? words.slice(1) : words;
  const r = rest.join(' ').trim();
  let spec = null;
  switch (verb) {
    case 'open': spec = rest[0] ? `shell.open:${typeof f.in === 'string' && f.in !== 'main' ? `${f.in}:` : ''}${rest[0]}` : null; break;
    case 'go': case 'find': spec = r ? `shell.find:${r}` : 'shell.go'; break;
    case 'mode': spec = rest[0] ? `shell.mode:${rest[0]}` : null; break;
    case 'layout': spec = rest[0] === 'save' && rest[1] ? `shell.layout.save:${rest.slice(1).join(' ')}` : rest[0] === 'switch' && rest[1] ? `shell.layout.switch:${rest[1]}` : rest[0] === 'remove' && rest[1] ? `shell.layout.remove:${rest[1]}` : null; break;
    case 'pane': spec = rest[0] && rest[1] ? `xlayout.drop:${rest[0]}:${rest[1]}` : null; break;
    case 'tabs': spec = rest[0] ? `xlayout.container.tabs:${rest[1] === 'on' || rest[1] === 'off' ? `${rest[1]}:` : ''}${rest[0]}` : null; break;
    case 'favorite': spec = rest[0] ? `shell.favorite:${rest[0]}` : null; break;
    case 'recents-clear': spec = 'shell.recents.clear'; break;
    case 'settings': spec = 'shell.settings'; break;
    case 'reload': spec = 'molly.reload'; break;
    case 'banners': spec = 'molly-banners.toggle'; break;
    case 'action': case 'run': spec = r || null; break;
    default: spec = null;
  }
  return { spec, to: typeof f.to === 'string' ? f.to : '', json: f.json === true };
}

/** The control@1 console command that runs `spec` in Molly. */
export const commandFor = (spec, to = '') => ({ $axf: 'control@1', op: 'act', target: 'console.actions', path: `host:${spec}`, action: 'run', ...(to ? { input: { to } } : {}), by: 'cli' });

export async function main(argv, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const { spec, to, json } = specFromArgv(argv);
  if (!spec) { console.error(USAGE); return 2; }
  const url = `${String(base).replace(/\/$/, '')}/api/console`;
  let out;
  try {
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(commandFor(spec, to)) });
    const text = await res.text();
    try { out = JSON.parse(text); } catch { out = { ok: false, code: String(res.status), message: text.slice(0, 200) }; }
  } catch (e) { out = { ok: false, code: 'unexpected', message: `could not reach ${url}: ${e?.message ?? e}` }; }
  console.log(json ? JSON.stringify(out) : out.ok ? `✓ Molly: ${spec}` : `✗ ${out.code ?? 'failed'}: ${out.message ?? ''}`);
  return out.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
