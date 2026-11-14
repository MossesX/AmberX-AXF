#!/usr/bin/env node
/**
 * themed-controls CLI (themed-controls@1, spec/THEMED-CONTROLS.md → API): the short forms of the plugin's commands.
 * The same commands run as `axf themed-controls <command> --field value` (plugin-commands@1); this file only maps
 * the positional forms onto them, so REST, MCP, the CLI and voice stay one list (plugin.json `commands`).
 *
 *   node apps/console-web/plugins/themed-controls/cli.mjs state
 *   … on | off                         master switch
 *   … family <family> on|off           one family (checkbox radio range number datetime color dialogs file tooltip scrollbar)
 *   … sheet on|off                     bottom sheet on a phone
 *   … controls | pickers | colors      what is themed / open on the console's screen
 *   … set <ref> <value>                set a themed control (a checkbox on/off, a date, a colour …)
 *   … color <ref> <colour>             the same for a colour control (#rrggbb, accent, red …)
 *   … open <ref> | close | pick <value>   open a date / time / colour picker, close it, pick in it
 *   … dialogs | answer ok|cancel [text] [--confirm true]   read / answer the open themed alert, confirm or prompt
 *   … <command> [--field value]…       any other command of the plugin, as `axf themed-controls`
 * Needs the console (AXF_CONSOLE_URL, AXF_TOKEN) like every plugin command.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [cmd = 'help', ...rest] = process.argv.slice(2);
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
const flags = rest.filter((a, i) => a.startsWith('--') || (i > 0 && rest[i - 1].startsWith('--')));

/** Positional short forms → plugin command + fields. */
export function toCommand(c, pos) {
  if (c === 'family' && pos.length) return ['family', '--family', pos[0], '--on', pos[1] ?? 'on'];
  if (c === 'sheet' && pos.length) return ['sheet', '--on', pos[0]];
  if ((c === 'set' || c === 'color') && pos.length >= 2) return ['set', '--ref', pos[0], '--value', pos.slice(1).join(' ')];
  if (c === 'open' && pos.length) return ['open', '--ref', pos.join(' ')];
  if (c === 'close' && pos.length) return ['close', '--ref', pos.join(' ')];
  if (c === 'pick' && pos.length) return ['pick', '--value', pos.join(' ')];
  if (c === 'answer' && pos.length) return ['answer', '--answer', pos[0], ...(pos.length > 1 ? ['--text', pos.slice(1).join(' ')] : [])];
  return null;
}

const mapped = toCommand(cmd, positional);
const argv = ['themed-controls', ...(cmd === 'help' ? [] : mapped ?? [cmd, ...rest]), ...(mapped ? flags : [])];
const { main } = await import(pathToFileURL(join(here, '..', 'plugin-commands', 'commands.mjs')).href).catch(() => ({ main: null }));
if (!main) { console.error('the Plugin commands plugin is not installed: run `axf themed-controls <command>` once it is'); process.exit(1); }
process.exit(await main(argv));
