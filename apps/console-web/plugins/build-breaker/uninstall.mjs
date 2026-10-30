#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder (the live asks copy) + state. --all: + this folder
 * (with the seed, data/asks.jsonl) + marked doc lines. --publish (with --all) commits and pushes the removal.
 * --dry-run, --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'build-breaker');
