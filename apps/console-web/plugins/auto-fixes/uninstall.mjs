#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * The Auto-fixes ledger itself belongs to the framework (axf_server.retry / retry-runner.mjs) and stays.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'auto-fixes');
