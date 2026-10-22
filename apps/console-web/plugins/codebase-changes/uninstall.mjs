#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 *
 * The permanent log (changes/ in the shared data folder on axHub, plus the repo's changes/ snapshot) is Brett's record
 * and is never deleted here, not even with --all. To delete it on purpose, remove that folder by hand (deleting files on
 * the hub through axHub needs his approval).
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'codebase-changes');
