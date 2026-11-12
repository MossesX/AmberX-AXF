#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): the data folder (nothing: the settings live in AmberX's document on the
 * hub, see plugin.json keeps). --all: + this folder + marked doc lines. --dry-run, --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'amberx-settings');
