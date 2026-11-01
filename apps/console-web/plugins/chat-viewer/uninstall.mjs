#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder (the store, settings, keys, the Piper venv) + state.
 * --all: + this folder + marked doc lines. --publish (with --all) commits and pushes the removal. --dry-run, --no-backup,
 * --json. Audio exports on the hub (<hub data>/chat-viewer/audio) and the hub drop folder stay: they are Brett's files.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'chat-viewer');
