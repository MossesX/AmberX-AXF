#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * Removing it removes the accounts list, the Terminal column, the banner widget and the floating overlay. The account
 * order stays with the build orchestrator, the logins with the VPS host.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'claude-accounts-manager');
