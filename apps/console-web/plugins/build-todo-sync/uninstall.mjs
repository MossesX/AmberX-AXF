#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state + the store-event subscription. --all: + this
 * folder + marked doc lines. --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * The to-do lists it made stay in the to-do manager (they are Brett's lists now); the sync note says they stopped syncing.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'build-todo-sync');
