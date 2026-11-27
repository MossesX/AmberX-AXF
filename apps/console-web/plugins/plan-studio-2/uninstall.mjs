#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state (a tree kept on the hub stays: it is shared
 * data other sessions use). --all: + this folder + marked doc lines. --publish (with --all) commits and pushes the
 * removal. --dry-run, --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'plan-studio-2');
