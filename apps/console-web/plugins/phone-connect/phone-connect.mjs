#!/usr/bin/env node
/**
 * Phone Connect CLI (phone-connect@1): the same routes as Settings → Plugins → Phone Connect, MCP phone_connect_* and
 * voice phone.*. Reaches the console at AXF_CONSOLE_URL (default http://127.0.0.1:8080) with AXF_TOKEN.
 *
 *   axf phone status                         presence, pairing code, features, recorder
 *   axf phone state                          everything the settings tab shows + its console-control addresses
 *   axf phone pair [--cancel]                issue a pairing code (shown once; claim it in the app with your hub sign-in)
 *   axf phone devices                        every phone
 *   axf phone revoke <deviceId>              refused: revoking is the owner's tap in the console (a session can't)
 *   axf phone open <url> [--where browser]   open a page on the phone
 *   axf phone notify <title> [--body …] [--kind fyi|fix|alert] [--url …]
 *   axf phone recorder start <session> --approval <uuid> | stop | status [--ask]
 *   axf phone voice say <text> | listen [--timeout 10]
 *   axf phone command <id> [--wait 20]       one command with its ack and result (an open says: opened, or only notified and why)
 *   axf phone settings [--on <feature>] [--off <feature>]
 * Add --json for the raw answer. Approve / deny is not here, and never will be: only Brett's tap on the phone decides.
 */
import { pathToFileURL } from 'node:url';

export const cliWords = ['status', 'pair', 'devices', 'revoke', 'open', 'notify', 'recorder', 'voice', 'command', 'commands', 'settings', 'state', 'help'];

const BASE = '/api/plugins/phone-connect';

export function parse(argv) {
  const flags = {}; const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2); const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++; }
    } else args.push(a);
  }
  return { flags, args };
}

/** argv → { method, path, body } (pure; the test checks it). Throws on a bad command line. */
export function request(argv) {
  const { flags, args } = parse(argv);
  const [word, a1, ...more] = args;
  const dev = flags.device ? { deviceId: String(flags.device) } : {};
  switch (word) {
    case 'status': return { method: 'GET', path: '/status' };
    case 'state': return { method: 'GET', path: '/state' };
    case 'pair': return flags.cancel ? { method: 'POST', path: '/pair/cancel', body: {} } : { method: 'POST', path: '/pair/start', body: {} };
    case 'devices': return a1 ? { method: 'GET', path: `/devices/${encodeURIComponent(a1)}` } : { method: 'GET', path: '/devices' };
    case 'revoke': if (!a1) throw new Error('axf phone revoke <deviceId>'); return { method: 'POST', path: `/devices/${encodeURIComponent(a1)}/revoke`, body: {} };
    case 'open': if (!a1) throw new Error('axf phone open <url>'); return { method: 'POST', path: '/open', body: { url: a1, ...(flags.where ? { where: String(flags.where) } : {}), ...dev } };
    case 'notify': {
      const title = [a1, ...more].filter(Boolean).join(' ');
      if (!title) throw new Error('axf phone notify <title> [--body …]');
      return { method: 'POST', path: '/notify', body: { title, kind: String(flags.kind || 'fyi'), ...(flags.body ? { body: String(flags.body) } : {}), ...(flags.url ? { url: String(flags.url) } : {}), ...dev } };
    }
    case 'recorder': {
      if (a1 === 'start') {
        const session = more.join(' ');
        if (!session) throw new Error('axf phone recorder start <session> --approval <uuid>');
        return { method: 'POST', path: '/recorder/start', body: { session, ...(flags.group ? { group: String(flags.group) } : {}), ...(flags.approval ? { approvalId: String(flags.approval) } : {}), ...dev } };
      }
      if (a1 === 'stop') return { method: 'POST', path: '/recorder/stop', body: { ...dev } };
      if (a1 === 'status' || !a1) return { method: 'GET', path: `/recorder/status${flags.ask ? '?ask=1' : ''}` };
      throw new Error('axf phone recorder start|stop|status');
    }
    case 'voice': {
      if (a1 === 'say') return { method: 'POST', path: '/voice', body: { mode: 'say', text: more.join(' '), ...dev } };
      if (a1 === 'listen') return { method: 'POST', path: '/voice', body: { mode: 'listen', ...(flags.timeout ? { timeoutSeconds: Number(flags.timeout) } : {}), ...dev } };
      throw new Error('axf phone voice say <text> | listen');
    }
    case 'command': if (!a1) throw new Error('axf phone command <id>'); return { method: 'GET', path: `/commands/${encodeURIComponent(a1)}${flags.wait ? `?wait=${Number(flags.wait)}` : ''}` };
    case 'commands': return { method: 'GET', path: '/commands' };
    case 'settings': {
      const features = {};
      for (const k of [].concat(flags.on ?? [])) if (typeof k === 'string') features[k] = true;
      for (const k of [].concat(flags.off ?? [])) if (typeof k === 'string') features[k] = false;
      return Object.keys(features).length ? { method: 'POST', path: '/settings', body: { features } } : { method: 'GET', path: '/settings' };
    }
    default: throw new Error(`axf phone ${cliWords.filter((w) => w !== 'help' && w !== 'state').join('|')} …`);
  }
}

function say(r) {
  if (r.error) return `✗ ${r.error.code}: ${r.error.message}`;
  if (r.$axf === 'phone-connect-status@1') {
    const p = r.pairing ? `\npairing code ${r.pairing.code} (${r.pairing.secondsLeft} s left)` : '';
    return `${r.device ? r.device.name : 'no phone'}: ${r.presence}${p}\nfeatures: ${Object.entries(r.features).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}\nrecorder: ${r.recorder.running ? `running (${r.recorder.session || ''})` : 'stopped'}`;
  }
  if (r.pairing) return `Pairing code ${r.pairing.code}: enter it in the Phone Connect app within ${Math.round(r.pairing.secondsLeft / 60)} min (your hub sign-in claims it).`;
  if (r.devices) return r.devices.length ? r.devices.map((d) => `${d.deviceId}  ${d.name}  ${d.state}  ${d.presence}`).join('\n') : 'no phones';
  if (r.command) return `${r.command.command} ${r.command.id}: ${r.command.status}${r.command.opened?.answered ? ` (${r.command.opened.opened ? 'opened' : r.command.opened.notified ? 'only notified' : 'nothing opened'}: ${r.command.opened.message})` : ''}${r.command.result?.error ? ` (${r.command.result.error.code}: ${r.command.result.error.message})` : ''}${r.deprecated ? `\n${r.deprecated}` : ''}`;
  return JSON.stringify(r, null, 2);
}

export async function main(argv) {
  const { flags, args } = parse(argv);
  if (!args[0] || args[0] === 'help') { console.log(`axf phone ${cliWords.join('|')} … (see apps/console-web/plugins/phone-connect/phone-connect.mjs)`); return 0; }
  let req;
  try { req = request(argv); } catch (e) { console.error(e.message); return 2; }
  const base = (process.env.AXF_CONSOLE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const tok = process.env.AXF_TOKEN || '';
  let r;
  try {
    const res = await fetch(`${base}${BASE}${req.path}`, {
      method: req.method, redirect: 'error',
      headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), 'content-type': 'application/json', 'x-axf-via': 'cli', 'x-axf-session': process.env.AXF_SESSION || process.env.AXF_BUILD_ID || 'cli' },
      ...(req.body ? { body: JSON.stringify(req.body) } : {}),
    });
    r = await res.json().catch(() => ({ error: { code: 'unexpected', message: `the console answered ${res.status}` } }));
  } catch (e) {
    r = { error: { code: 'unavailable', message: `can't reach the console at ${base} (${e.message})` } };
  }
  console.log(flags.json ? JSON.stringify(r, null, 2) : say(r));
  return r.error ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)));
