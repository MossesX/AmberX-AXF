#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * Paired phones keep their app; their device tokens die with the data (every call answers `unpaired`).
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'phone-connect');
