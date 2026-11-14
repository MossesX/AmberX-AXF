#!/usr/bin/env node
/**
 * Picker CLI (picker@1). Short forms of the plugin's commands; every one runs the same command as
 * `axf picker-dialog <command> --field value`, REST /api/control/picker-dialog/<command>, MCP picker-dialog_<command>
 * and voice: the picker.* console actions in the open console.
 *
 *   node apps/console-web/plugins/picker-dialog/picker.mjs state
 *   … open <picker>                       (its id, label, button:picker-<id> or picker:<id>)
 *   … choose <option> [--in <picker>]     (name, value or "the third one"; no --in = the open picker)
 *   … toggle <option> [--in <picker>]
 *   … search <text> [--in <picker>]
 *   … clear <picker>
 *   … close [<picker>]
 *   … settings                            read them
 *   … set <setting> <value>               enabled | swapSelectFields | swapSelects | searchThreshold | sheetOnPhone | excludeApps
 *   … say "<phrase>"                      a voice phrase ("open the theme picker", "choose dark")
 *   --json prints the raw answer.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(HERE, '..');
const FOLDER = 'picker-dialog';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const inAt = argv.indexOf('--in');
const within = inAt >= 0 ? argv[inAt + 1] ?? '' : '';
const [verb = 'help', ...words] = argv.filter((a, i) => a !== '--json' && i !== inAt && i !== inAt + 1);

/** The command line for the plugin-commands runner: [folder, command, --field, value…]. */
export function toCommand(v, w, target = '') {
  const two = (key) => [...(target ? ['--target', target] : []), `--${key}`, w.join(' ')];
  switch (v) {
    case 'state': case 'list': return [FOLDER, v];
    case 'open': case 'clear': return w.length ? [FOLDER, v, '--target', w.join(' ')] : null;
    case 'close': return [FOLDER, v, ...(w.length ? ['--target', w.join(' ')] : [])];
    case 'choose': case 'toggle': return w.length ? [FOLDER, v, ...two('option')] : null;
    case 'search': return w.length ? [FOLDER, v, ...two('text')] : null;
    case 'settings': return [FOLDER, 'settings'];
    case 'set': return w.length >= 2 ? [FOLDER, 'settings-set', `--${w[0].replace(/^axf\.picker\./, '')}`, w.slice(1).join(' ')] : null;
    case 'say': return w.length ? [FOLDER, 'voice', '--text', w.join(' ')] : null;
    default: return null;
  }
}

async function main() {
  const cmd = toCommand(verb, words, within);
  if (!cmd) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    return verb === 'help' ? 0 : 2;
  }
  const dir = readdirSync(PLUGINS).sort().find((d) => {
    try { return JSON.parse(readFileSync(join(PLUGINS, d, 'plugin.json'), 'utf8')).provides?.includes('service:plugin-commands@1') && existsSync(join(PLUGINS, d, 'commands.mjs')); } catch { return false; }
  });
  if (!dir) { console.error('no plugin provides plugin-commands@1 (install the Plugin commands plugin)'); return 1; }
  const { main: run } = await import(pathToFileURL(join(PLUGINS, dir, 'commands.mjs')).href);
  return run(json ? [...cmd, '--json'] : cmd);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main());
