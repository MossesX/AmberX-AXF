#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state (the confirm salt, the MCP switches, the audit
 * log; the MCP tools go with the console server's next sync). --all: + this folder + marked doc lines. --dry-run,
 * --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'plugin-commands');
