#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder (Apply reports + the mirror) + state. --all: + this
 * folder + marked doc lines. --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * The matrices files (_claude/builds/[profiles/<id>/]matrices.json) are project files: never deleted.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'feature-matrix');
