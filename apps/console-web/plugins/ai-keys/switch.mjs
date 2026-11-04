#!/usr/bin/env node
/**
 * ai-keys switch — the Claude account running headless builds hit a limit: switch to the next saved account (Brett, Nov 2 2026).
 *
 *   node apps/console-web/plugins/ai-keys/switch.mjs [--reason "<why>"] [--wait <seconds>]
 *
 * Asks the Dev Console's AI keys plugin (POST /api/plugins/ai-keys/switch) to mark the active Claude subscription as
 * limited and make the next saved account that still answers the active one. AI keys then writes that account to
 * Claude Code's credentials on the VPS (directly, or by Vinny after an axHub approval); this waits for that write
 * (GET /api/plugins/ai-keys/vps) up to --wait seconds (default 900).
 *
 * Exit 0 and one line "switched to <label> (<email>)" when the new account is on the VPS; exit 1 (reason on stderr)
 * when no other account could take over, the write failed or timed out, or the console can't be reached.
 * Console: AXF_CONSOLE_URL (default https://console.amberxai.com) + AXF_TOKEN, each from the environment or the
 * console's env file (/opt/axf/.axf-console/env, AXF_CONSOLE_ENV moves it). The token is never printed.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };

function fromEnvFile(name) {
  try {
    const txt = readFileSync(process.env.AXF_CONSOLE_ENV || '/opt/axf/.axf-console/env', 'utf8');
    const m = txt.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch { return ''; }
}

const token = process.env.AXF_TOKEN || fromEnvFile('AXF_TOKEN');
const base = (process.env.AXF_CONSOLE_URL || fromEnvFile('AXF_CONSOLE_URL') || 'https://console.amberxai.com').replace(/\/+$/, '');
const waitMs = Math.max(0, Number(flag('wait', 900)) || 0) * 1000;
const reason = String(flag('reason', 'a headless build hit its limit')).slice(0, 200);
const fail = (msg) => { console.error(`ai-keys switch: ${msg}`); process.exit(1); };

async function call(method, path, body) {
  const r = await fetch(`${base}/api/plugins/ai-keys/${path}`, {
    method, redirect: 'error',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`console answered ${r.status}${typeof j.detail === 'string' ? `: ${j.detail}` : ''}`);
  return j;
}

if (!token) fail('no console token (AXF_TOKEN in the environment or the console env file)');
let res;
try { res = await call('POST', 'switch', { kind: 'claude-code', reason }); } catch (e) { fail(`couldn't reach AI keys: ${e.message}`); }
if (!res.switched) {
  const tried = (res.tried || []).map((t) => `${t.label}: ${t.state}`).join(', ');
  fail(`no other saved Claude account could take over${tried ? ` (${tried})` : ' (only one is saved: add more in AI keys)'}`);
}
const who = `${res.switched.label}${res.account?.email ? ` (${res.account.email})` : ''}`;
const started = Date.now();
for (;;) {
  let vps;
  try { vps = await call('GET', 'vps'); } catch (e) { fail(`switched to ${who}, but couldn't read the VPS write: ${e.message}`); }
  // The write is for the new account once its label shows and it reads done.
  if (vps.state === 'done' && vps.label === res.switched.label && (vps.at || 0) >= started - 5_000) break;
  if (vps.state === 'failed') fail(`switched to ${who}, but writing it to the VPS failed: ${vps.error || 'no reason given'}`);
  if (Date.now() - started > waitMs) fail(`switched to ${who}, but the VPS write didn't finish in time${vps.state === 'waiting' ? ' (it waits for an approval on axHub)' : ''}`);
  await new Promise((ok) => setTimeout(ok, 5_000));
}
console.log(`switched to ${who}`);
