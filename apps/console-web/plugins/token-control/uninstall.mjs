#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state (the audit log and the confirm salt).
 * --all: + this folder + marked doc lines. Token overrides already in the axHub look stay: they are look settings
 * every app shares (reset them first with `axf token <set> reset` if they should go). --dry-run, --no-backup, --json.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'token-control');
