#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder (demos, pitch facts, recordings, settings) + state.
 * --all: + this folder + marked doc lines. --publish (with --all) commits and pushes the removal. --dry-run, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'demonstration-designer');
