#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder (every project's builds/notes/data) + state.
 * --all: + this folder + marked doc lines. --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * App folders a project made under apps/ stay: they are real apps in the repo.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'project-manager');
