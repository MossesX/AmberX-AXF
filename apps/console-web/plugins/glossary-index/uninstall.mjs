#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder (the built catalog and its change log) + state.
 * --all: + this folder + marked doc lines. --publish (with --all) commits and pushes the removal. --dry-run, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'glossary-index');
