#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder, the marked doc lines,
 * the /sync command and the Claude Code hook. --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'session-sync');
