#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state (plans kept on the hub stay there: they are
 * shared data other sessions use). --all: + this folder (seed plans, schema, fixtures) + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'plan-studio');
