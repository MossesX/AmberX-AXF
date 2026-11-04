#!/usr/bin/env node
/** Installer (plugin-lifecycle@1): data folder + hooks.mjs onInstall (the /sync command, the CLAUDE.md line, the Claude Code hook) + enable. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'session-sync');
