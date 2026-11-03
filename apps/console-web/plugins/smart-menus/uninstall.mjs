#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json. Without the plugin every menu
 * is its plain static menu (the framework drops only conditional items that don't apply).
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'smart-menus');
