#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): the plugin's rows in the data store (data-store@1 namespace
 * plugins/claude-handoff, removed row by row in hooks.mjs onUninstall), its data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * The published kit (_claude/handoff/) stays: it is what a new Claude account reads.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'claude-handoff');
