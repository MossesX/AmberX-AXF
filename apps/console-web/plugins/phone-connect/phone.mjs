#!/usr/bin/env node
/**
 * `axf phone …` — Phone Connect's word commands. Every word is one of the plugin's commands (the same REST routes the
 * console, MCP and voice use), sent through plugin-commands@1, so auth, gates and confirmations are the same.
 *
 *   axf phone status | devices | device <id>
 *   axf phone pair [cancel]                        a code (10 min); the phone claims it signed in as Brett
 *   axf phone revoke <device-id> [--why "…"]       axf phone forget <device-id>
 *   axf phone open <https://….amberxai.com/…> [--browser chrome|default]
 *   axf phone notify <fyi|fix-update|alert|approval> "<title>" [--body "…"] [--url …]
 *   axf phone recorder start "<session>" [--group …] [--note …] | stop | status | transcripts
 *   axf phone rules list | add <what> [--scope any|project:<id>|agent:<id>|build:<id>] [--expires <iso>] [--note …]
 *                   | remove <id> | enable <id> [--off] | check <tool> [--project …]
 *   axf phone commands | settings [--browser …] [--monitor on|off] [--notify-<kind> on|off]
 *   axf phone overlay [presets | preset <id> | set '<json patch>']
 * Add --json for JSON.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDER = HERE.split(/[\\/]/).pop();
const PLUGINS = dirname(HERE);

export const cliWords = ['status', 'devices', 'device', 'pair', 'revoke', 'forget', 'open', 'notify', 'recorder', 'rules', 'commands', 'settings', 'overlay', 'help'];

const USAGE = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith(' *   axf phone')).map((l) => l.slice(3)).join('\n');

const onOff = (v) => (/^(on|true|yes|1)$/i.test(String(v)) ? 'true' : /^(off|false|no|0)$/i.test(String(v)) ? 'false' : null);

/** Words → [command id, flags]. Throws a usage message on a bad line. */
export function plan(argv) {
  const words = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; } else words.push(argv[i]);
  }
  const [w, a, b] = words; const pass = {}; const json = flags.json ? ['--json'] : [];
  const need = (v, what) => { if (!v) throw new Error(`missing ${what}`); return v; };
  let id;
  switch (w) {
    case 'status': id = 'phone-status'; break;
    case 'devices': id = 'phone-devices'; break;
    case 'device': id = 'phone-device'; pass.device_id = need(a, '<device-id>'); break;
    case 'pair': id = a === 'cancel' ? 'phone-pair-cancel' : a === 'code' ? 'phone-pair-waiting' : 'phone-pair'; break;
    case 'revoke': id = 'phone-revoke'; pass.device_id = need(a, '<device-id>'); if (flags.why) pass.why = flags.why; break;
    case 'forget': id = 'phone-forget'; pass.device_id = need(a, '<device-id>'); break;
    case 'open': id = 'phone-open-url'; pass.url = need(a, '<url>'); if (flags.browser) pass.browser = flags.browser; pass.via = 'cli'; break;
    case 'notify': id = 'phone-notify'; pass.kind = need(a, '<kind>'); pass.title = need(b, '"<title>"'); if (flags.body) pass.body = flags.body; if (flags.url) pass.url = flags.url; pass.via = 'cli'; break;
    case 'recorder':
      if (a === 'start') { id = 'phone-recorder-start'; pass.session_name = need(b, '"<session>"'); if (flags.group) pass.group = flags.group; if (flags.note) pass.note = flags.note; pass.via = 'cli'; }
      else if (a === 'stop') { id = 'phone-recorder-stop'; pass.via = 'cli'; }
      else if (a === 'status' || !a) id = 'phone-recorder-status';
      else if (a === 'transcripts') id = 'phone-recorder-transcripts';
      else throw new Error(`recorder ${a}? start | stop | status | transcripts`);
      break;
    case 'rules':
      if (a === 'list' || !a) id = 'phone-rules-list';
      else if (a === 'add') { id = 'phone-rules-add'; pass.what = need(b, '<what>'); if (flags.scope) pass.scope = flags.scope; if (flags.expires) pass.expiresAt = flags.expires; if (flags.note) pass.note = flags.note; }
      else if (a === 'remove') { id = 'phone-rules-remove'; pass.rule_id = need(b, '<rule-id>'); }
      else if (a === 'enable') { id = 'phone-rules-enable'; pass.rule_id = need(b, '<rule-id>'); pass.on = flags.off ? 'false' : 'true'; }
      else if (a === 'check') { id = 'phone-rules-evaluate'; pass.tool = need(b, '<tool>'); for (const k of ['project', 'agent', 'build']) if (flags[k]) pass[k] = flags[k]; }
      else throw new Error(`rules ${a}? list | add | remove | enable | check`);
      break;
    case 'commands': id = a ? 'phone-command' : 'phone-commands'; if (a) pass.cid = a; break;
    case 'overlay':
      if (!a) id = 'phone-overlay';
      else if (a === 'presets') id = 'phone-overlay-presets';
      else if (a === 'preset') { id = 'phone-overlay-preset'; pass.preset_id = need(b, '<preset-id>'); }
      else if (a === 'set') { id = 'phone-overlay-set'; JSON.parse(need(b, "'<json patch>'")); pass.body = b; }
      else throw new Error(`overlay ${a}? presets | preset <id> | set '<json>'`);
      break;
    case 'settings': {
      const set = {};
      if (flags.browser) set.browser = flags.browser;
      if (flags.monitor !== undefined) set.monitor = onOff(flags.monitor);
      if (flags.mic !== undefined) set.recorderMic = onOff(flags.mic);
      for (const k of ['fyi', 'fix-update', 'alert', 'approval']) if (flags[`notify-${k}`] !== undefined) set[`notify.${k}`] = onOff(flags[`notify-${k}`]);
      if (!Object.keys(set).length) { id = 'phone-settings'; break; }
      id = 'phone-settings-set';
      const body = {}; const notify = {};
      for (const [k, v] of Object.entries(set)) { if (v === null) throw new Error(`${k} is on or off`); const val = v === 'true' ? true : v === 'false' ? false : v; if (k.startsWith('notify.')) notify[k.slice(7)] = val; else body[k] = val; }
      if (Object.keys(notify).length) body.notify = notify;
      pass.body = JSON.stringify(body);
      break;
    }
    default: throw new Error(w ? `unknown word "${w}"` : 'no command');
  }
  return [id, ...Object.entries(pass).flatMap(([k, v]) => [`--${k}`, String(v)]), ...json];
}

function commandsRunner() {
  for (const d of readdirSync(PLUGINS).sort()) {
    try {
      const m = JSON.parse(readFileSync(join(PLUGINS, d, 'plugin.json'), 'utf8'));
      if (m.provides?.includes('service:plugin-commands@1') && existsSync(join(PLUGINS, d, 'commands.mjs'))) return join(PLUGINS, d, 'commands.mjs');
    } catch { /* not a plugin */ }
  }
  return '';
}

export async function main(argv) {
  if (!argv.length || argv[0] === 'help' || argv.includes('--help')) { console.log(`Phone Connect\n${USAGE}`); return 0; }
  let args;
  try { args = plan(argv); } catch (e) { console.error(`axf phone: ${e.message}\n${USAGE}`); return 2; }
  const runner = commandsRunner();
  if (!runner) { console.error('no plugin provides plugin-commands@1 (install the Plugin commands plugin)'); return 1; }
  const { main: run } = await import(pathToFileURL(runner).href);
  return run([FOLDER, ...args]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));
