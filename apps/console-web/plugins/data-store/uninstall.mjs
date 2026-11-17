#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): this plugin's own folder (.axf-console/plugins/data-store: caches
 * only) + state. --all: + this folder + marked doc lines. --publish (with --all) commits and pushes the removal.
 *
 * Removing the plugin never touches the console's data: everything stays on axf-data (and in the local files of
 * namespaces still in local or shadow mode), and the mode document stays where the clients read it. Only the screen,
 * the REST routes, the plugin commands and the voice actions go; `axf data …` keeps working.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'data-store');
