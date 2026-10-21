#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines
 * (the context-menu link, nav entry and settings tab go with the code: they are contributed at runtime, never written
 * into assets). --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * The Fable rebuild (pending item plugin-manager) starts by running `uninstall.mjs --all`.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'plugin-manager');
