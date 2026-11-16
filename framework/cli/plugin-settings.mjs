#!/usr/bin/env node
/**
 * axf plugin-settings — every plugin's Settings → Plugins sub-tab from the command line (plugin-settings@1).
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface." Each command is the
 * console's REST call (the Plugin Manager's /settings routes, or console control for `open`), so the CLI answers
 * exactly what REST, MCP (plugin-settings-* tools) and voice (plugin.settings.* console actions) answer.
 *
 *   axf plugin-settings list                              every plugin: tab, address, options, gear, on / off
 *   axf plugin-settings get <plugin>                      enabled, info (version, builtWith, dependencies), options + values
 *   axf plugin-settings set <plugin> <key>=<value> …      set its own options (owner-only ones are refused)
 *   axf plugin-settings enable|disable <plugin> [--force] switch it on / off
 *   axf plugin-settings logs <plugin> [--limit n] [--level info|ok|warn|error]
 *   axf plugin-settings open <plugin>                     open its sub-tab in the open console (console control `open`)
 *   --json  the answer as JSON · --remote <url>  another console (AXF_CONSOLE_URL, AXF_TOKEN)
 *
 * <plugin> is its folder under apps/console-web/plugins. Exit codes: 0 ok · 1 failed · 2 usage · 4 no console open.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { settingsAddress, normalizeSettings } from '../core/plugin-settings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGINS = join(ROOT, 'apps', 'console-web', 'plugins');
export const SUBCOMMANDS = ['list', 'get', 'set', 'enable', 'disable', 'logs', 'open'];
const FOLDER = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** The settings routes live in the plugin that provides service:axf.plugin-settings@1 (the Plugin Manager), found by
 *  capability, never by folder name. */
export const CAPABILITY = 'service:axf.plugin-settings@1';
export function provider(plugins = PLUGINS) {
  if (!existsSync(plugins)) return null;
  for (const d of readdirSync(plugins).sort()) {
    try { if (JSON.parse(readFileSync(join(plugins, d, 'plugin.json'), 'utf8')).provides?.includes(CAPABILITY)) return d; } catch { /* not a plugin */ }
  }
  return null;
}

const WITH_VALUE = new Set(['limit', 'level', 'remote']);
/** argv → { words, flags }; --limit, --level and --remote take a value, other flags are switches. */
export function parseArgs(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[k] = inline;
    else if (WITH_VALUE.has(k) && i + 1 < argv.length) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return { words, flags };
}

const value = (v) => { try { return JSON.parse(v); } catch { return v; } };

/** The plugin's sub-tab id from its plugin.json (normalizeSettings), else its folder name. */
export function tabOf(folder, plugins = PLUGINS) {
  const file = join(plugins, folder, 'plugin.json');
  if (!existsSync(file)) return folder;
  try { return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')), { folder }).tab || folder; } catch { return folder; }
}

/** A CLI command → its REST request { method, path, body? } (absolute console paths). Pure but for `open` reading plugin.json. */
export function toRequest(argv, { plugins = PLUGINS } = {}) {
  const { words, flags } = parseArgs(argv);
  const [sub, folder, ...rest] = words;
  if (!SUBCOMMANDS.includes(sub)) throw new Error(`usage: axf plugin-settings ${SUBCOMMANDS.join('|')} <plugin> …`);
  const host = sub === 'open' ? '' : provider(plugins);
  if (sub !== 'open' && !host) throw new Error(`no plugin provides ${CAPABILITY} (install the Plugin Manager)`);
  const PM = `/api/plugins/${host}`;
  if (sub === 'list') return { method: 'GET', path: `${PM}/settings` };
  if (!folder || !FOLDER.test(folder)) throw new Error(`usage: axf plugin-settings ${sub} <plugin folder>`);
  switch (sub) {
    case 'get': return { method: 'GET', path: `${PM}/settings/${folder}` };
    case 'set': {
      const pairs = rest.map((p) => p.split(/=(.*)/s, 2)).filter((p) => p.length === 2 && p[0]);
      if (!pairs.length || pairs.length !== rest.length) throw new Error('usage: axf plugin-settings set <plugin> <key>=<value> …');
      return { method: 'PUT', path: `${PM}/settings/${folder}`, body: { options: Object.fromEntries(pairs.map(([k, v]) => [k, value(v)])) } };
    }
    case 'enable': case 'disable':
      return { method: 'POST', path: `${PM}/settings/${folder}/${sub}`, body: flags.force ? { force: true } : {} };
    case 'logs': {
      const q = new URLSearchParams();
      if (flags.limit) q.set('limit', String(flags.limit));
      if (flags.level) q.set('level', String(flags.level));
      const s = q.toString();
      return { method: 'GET', path: `${PM}/settings/${folder}/logs${s ? `?${s}` : ''}` };
    }
    case 'open':
      return { method: 'POST', path: '/api/console-control/do', body: { verb: 'open', address: settingsAddress(tabOf(folder, plugins)), by: 'cli' } };
    default: throw new Error('unreachable');
  }
}

export async function send(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const url = `${base.replace(/\/$/, '')}${req.path}`;
  try {
    const res = await f(url, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch { return { ok: false, code: 'unexpected', message: `${res.status} from ${url}: ${text.slice(0, 200)}` }; }
    if (!res.ok && j && typeof j === 'object' && j.ok === undefined) return { ok: false, code: String(res.status), message: String(j.detail ?? text).slice(0, 300) };
    return j;
  } catch (e) {
    return { ok: false, code: 'unexpected', message: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** Readable lines for an answer. */
export function describe(sub, r) {
  if (r.ok === false) return [`✗ ${r.code ?? 'failed'}: ${r.message ?? ''}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : [])];
  if (sub === 'list') return (r.items ?? []).map((i) => `${i.enabled ? '●' : '○'} ${i.folder.padEnd(26)} tab ${i.tab}${i.options.length ? ` · ${i.options.length} option${i.options.length > 1 ? 's' : ''}` : ''}${i.gear ? ' · gear' : ''}${i.declared ? '' : ' · default block'}`);
  if (sub === 'get') {
    const out = [`${r.name} (${r.folder}) ${r.enabled ? 'on' : 'off'} · v${r.info?.version ?? '?'}${r.info?.builtWith?.model ? ` · built with ${r.info.builtWith.model}` : ''}`, `  tab ${r.address}`];
    for (const d of r.info?.dependencies ?? []) out.push(`  needs ${d.name} (${d.required ? 'required' : 'optional'}): ${d.status}`);
    for (const o of r.optionSpecs ?? []) out.push(`  ${o.key}${o.label ? ` (${o.label})` : ''}${'value' in o ? ` = ${JSON.stringify(o.value)}` : ''}${o.personOnly ? ' · owner-only' : ''}`);
    return out;
  }
  if (sub === 'logs') return (r.lines ?? []).map((l) => `${new Date(l.at).toISOString()} ${l.level.padEnd(5)} ${l.text}`);
  if (sub === 'set') return Object.entries(r.results ?? {}).map(([k, x]) => (x.ok ? `✓ ${k} = ${JSON.stringify(x.value)}` : `✗ ${k}: ${x.message ?? x.code}`));
  return [`✓ ${r.verb ?? sub}${r.address ? ` ${r.address}` : ''}${r.enabled !== undefined ? ` (${r.enabled ? 'on' : 'off'})` : ''}`];
}

export async function main(argv, io = { log: (s) => console.log(s), error: (s) => console.error(s) }, opts = {}) {
  let req;
  try { req = toRequest(argv); } catch (e) { io.error(String(e.message)); return 2; }
  const { words, flags } = parseArgs(argv);
  const r = await send(req, { ...(typeof flags.remote === 'string' ? { base: flags.remote } : {}), ...opts });
  if (flags.json) io.log(JSON.stringify(r, null, 2));
  else for (const line of describe(words[0], r)) (r.ok === false ? io.error : io.log)(line);
  return r.ok === false ? (r.code === 'unavailable' && r.openUrl ? 4 : 1) : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)));
