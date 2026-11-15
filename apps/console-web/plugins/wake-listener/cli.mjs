#!/usr/bin/env node
/**
 * `axf voice …` (wake-listener; build voice-listener-use-claude-when-connected). axf routes `voice` here by capability
 * (the plugin that provides service:axf.wake-listener@1 and has cli.mjs), never by folder name.
 *
 *   axf voice claude on | off          Claude mode on / off             POST /api/plugins/wake-listener/claude/on|off
 *   axf voice claude status            the switch, timeout, connected   GET  /api/plugins/wake-listener/claude
 *   axf voice claude timeout <2-30>    seconds to wait for Claude       POST /api/plugins/wake-listener/claude {timeoutSec}
 *   axf voice claude test "<phrase>"   what Claude would pick (dry run) POST /api/plugins/wake-listener/claude/test {text}
 *   axf voice history [claude|scripted]  recent commands with their mode GET  /api/plugins/wake-listener/history?mode=
 *   --json · --local (on / off / status / history against this checkout's store, no console)
 *
 * The same routes as REST and the MCP tools (wake-listener_claude-on, _claude-off, _claude, _claude-set, _claude-test,
 * _history) and the voice commands ("use Claude for voice", "stop using Claude for voice"): one implementation.
 * The console: AXF_CONSOLE_URL (default https://console.amberxai.com), AXF_TOKEN.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDER = 'wake-listener';

/** The words after `axf voice` → the plugin route they call ({ method, path, body? }) or an error. Pure (the parity test reads it). */
export function requestOf(words) {
  const [group, verb = 'status', ...rest] = words;
  if (group === 'history') {
    const mode = verb === 'status' ? '' : verb;
    if (mode && mode !== 'claude' && mode !== 'scripted') return { error: 'axf voice history [claude|scripted]' };
    return { method: 'GET', path: `history${mode ? `?mode=${mode}` : ''}` };
  }
  if (group !== 'claude') return { error: 'axf voice claude on|off|status|timeout <s>|test "<phrase>" · axf voice history [claude|scripted]' };
  if (verb === 'on' || verb === 'off') return { method: 'POST', path: `claude/${verb}` };
  if (verb === 'status') return { method: 'GET', path: 'claude' };
  if (verb === 'timeout') { const n = Number(rest[0]); return Number.isFinite(n) ? { method: 'POST', path: 'claude', body: { timeoutSec: Math.round(n) } } : { error: 'axf voice claude timeout <2-30>' }; }
  if (verb === 'test') { const text = rest.join(' ').trim(); return text ? { method: 'POST', path: 'claude/test', body: { text } } : { error: 'axf voice claude test "<phrase>"' }; }
  return { error: `unknown: claude ${verb} (on, off, status, timeout, test)` };
}

function local(req) {
  const store = join(HERE, 'listener.mjs');
  const run = (...a) => JSON.parse(execFileSync('node', [store, ...a, '--json'], { encoding: 'utf8' }).trim().split('\n').pop());
  if (req.path === 'claude/on' || req.path === 'claude/off') return run('set', `useClaude=${req.path.endsWith('on')}`, '--by', 'cli');
  if (req.path === 'claude' && req.method === 'GET') { const s = run('settings'); return { ok: true, useClaude: s.settings.useClaude, claudeTimeoutSec: s.settings.claudeTimeoutSec, note: 'local store only: connected / mode need the console' }; }
  if (req.path === 'claude' && req.body) return run('set', `claudeTimeoutSec=${req.body.timeoutSec}`, '--by', 'cli');
  if (req.path.startsWith('history')) { const m = new URL(`x:/${req.path}`).searchParams.get('mode'); return run('history', ...(m ? ['--mode', m] : [])); }
  return { ok: false, code: 'invalid', message: 'a dry run needs the console (Claude runs there); drop --local' };
}

async function remote(req) {
  const base = (process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/$/, '');
  const tok = process.env.AXF_TOKEN || '';
  try {
    const res = await fetch(`${base}/api/plugins/${FOLDER}/${req.path}`, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, code: 'unexpected', message: `${res.status}: ${text.slice(0, 300)}` }; }
  } catch (e) {
    return { ok: false, code: 'unavailable', message: `can't reach the console at ${base} (${e?.message ?? e}); set AXF_CONSOLE_URL and AXF_TOKEN, or use --local` };
  }
}

function line(r) {
  if (!r.ok) return `✗ ${r.code ?? 'failed'}: ${r.message ?? ''}`;
  if (r.dryRun) return r.mode === 'claude' ? `Claude would pick ${r.command}${Object.keys(r.args ?? {}).length ? ` ${JSON.stringify(r.args)}` : ''}${r.ask ? ` · asks: ${r.ask}` : r.confirm ? ' · asks to confirm' : ''}` : `offline (${r.reason}): ${r.message}`;
  if (Array.isArray(r.entries)) return r.entries.map((e) => `${new Date(e.at).toISOString().slice(0, 19)}  ${e.mode.padEnd(8)} ${(e.reason || '').padEnd(14)} "${e.heard}" → ${e.command || '–'}`).join('\n') || 'no history yet';
  const s = r.settings ?? r;
  return `Claude mode ${s.useClaude ? 'on' : 'off'} · wait ${s.claudeTimeoutSec} s${'claudeConnected' in r ? ` · Claude ${r.claudeConnected ? 'connected' : 'not connected'} · mode ${r.mode}${r.offline ? ` (offline: ${r.offlineReason})` : ''}` : ''}`;
}

export async function main(argv) {
  const json = argv.includes('--json');
  const useLocal = argv.includes('--local');
  const words = argv.filter((a) => a !== '--json' && a !== '--local');
  if (!words.length || words[0] === 'help' || words[0] === '--help') {
    console.log(['axf voice claude on|off            Claude mode on / off', 'axf voice claude status             switch, timeout, connected, mode', 'axf voice claude timeout <2-30>    seconds to wait for Claude', 'axf voice claude test "<phrase>"   what Claude would pick (dry run)', 'axf voice history [claude|scripted]', '--json · --local'].join('\n'));
    return 0;
  }
  const req = requestOf(words);
  if (req.error) { console.error(req.error); return 2; }
  const r = useLocal ? local(req) : await remote(req);
  console.log(json ? JSON.stringify(r, null, 2) : line(r));
  return r.ok ? 0 : 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(await main(process.argv.slice(2)));
