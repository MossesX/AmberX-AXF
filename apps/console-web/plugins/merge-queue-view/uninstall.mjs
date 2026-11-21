#!/usr/bin/env node
/** Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'merge-queue-view');
