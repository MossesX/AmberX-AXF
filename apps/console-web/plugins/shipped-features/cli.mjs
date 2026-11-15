#!/usr/bin/env node
/**
 * Shipped features from the command line: open a feature in the live console, or ask where it would open. Every
 * command is the REST call of the console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN), so the
 * CLI answers exactly what REST, MCP (shipped_features_open, shipped_features_open_target) and voice answer.
 *
 *   axf feature open <id|words…> [--to recent|all|<client>]   open its screen in the console the person used last
 *   axf feature target <id|words…>                           where it opens (address + label) or why it can't
 *   axf feature find <words…>                                the best match and close alternatives
 *   (also `axf shipped-features open|target|find …`)          --json  the answer as JSON · --remote <url>  another console
 *
 * Exit codes: 0 ok · 1 failed · 2 usage · 3 it has no screen (the reason is printed) · 4 no console open.
 */
import { pathToFileURL } from 'node:url';

export const cliWords = ['open', 'target', 'find'];
const FOLDER = 'shipped-features';

/** argv → { words, flags }. */
export function parseArgs(argv) {
  const words = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const k = a.slice(2);
    if (['to', 'remote', 'by'].includes(k) && i + 1 < argv.length) flags[k] = argv[++i]; else flags[k] = true;
  }
  return { words, flags };
}

/** A command → the REST request it is: { method, path, body? }. Throws Error('usage: …'). Pure (the parity test checks it). */
export function toRequest(argv) {
  const { words, flags } = parseArgs(argv);
  const [sub, ...rest] = words;
  const ref = rest.join(' ').trim();
  if (!cliWords.includes(sub) || !ref) throw new Error('usage: axf feature open|target|find <id or words…> [--to <client>] [--json]');
  const by = typeof flags.by === 'string' ? flags.by : 'cli';
  if (sub === 'open') return { method: 'POST', path: '/features/open', body: { feature: ref, by, ...(typeof flags.to === 'string' ? { to: flags.to } : {}) } };
  if (sub === 'target') return { method: 'GET', path: `/features/open-target?feature=${encodeURIComponent(ref)}` };
  return { method: 'GET', path: `/features/find?q=${encodeURIComponent(ref)}` };
}

export async function send(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const url = `${base.replace(/\/$/, '')}/api/plugins/${FOLDER}${req.path}`;
  try {
    const res = await f(url, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { return { ok: false, http: res.status, code: 'unexpected', message: `${res.status} from ${url}: ${text.slice(0, 200)}` }; }
    if (!res.ok) { const d = j.detail; return { ok: false, http: res.status, ...(d && typeof d === 'object' ? d : { message: String(d ?? res.status) }) }; }
    return { ok: true, http: res.status, ...j };
  } catch (e) {
    return { ok: false, code: 'unexpected', message: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** A few readable lines for an answer. */
export function describe(r) {
  if (!r.ok) return [`✗ ${r.message || r.reason || r.code}`];
  if ('match' in r && !('target' in r) && !r.openTarget) {
    if (!r.match) return [`no feature matches "${r.q}"`];
    return [`${r.match.id}  ${r.match.name}  (${r.match.status})`, ...r.alternatives.map((a) => `  also: ${a.id}  ${a.name}  (${a.status})`)];
  }
  const t = r.openTarget ?? r;
  const alts = (r.lookup?.alternatives ?? []).map((a) => `  also close: ${a.name} (${a.id})`);
  if (!t.target) return [`${t.name || t.feature}: can't be opened: ${t.reason}`, ...alts];
  if (r.openTarget) return [`${r.status === 'delivered' ? '✓ opened' : r.status === 'pending' ? '… waiting for a console' : '✗ not opened'} ${t.name}: ${t.label}  ${t.target}`, ...(r.openUrl ? [`  open the console: ${r.openUrl}`] : []), ...alts];
  return [`${t.name}: ${t.label}  ${t.target}  (via ${t.via})`, ...alts];
}

export const exitCode = (r) => (r.ok ? (r.openTarget && r.status === 'pending' ? 4 : ('target' in r && !r.target ? 3 : 0)) : r.http === 409 ? 3 : r.http === 400 ? 2 : 1);

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
