#!/usr/bin/env node
/** Installer (plugin-lifecycle@1): data folder + the plan store set up (hooks.mjs onInstall) + enable. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'plan-studio');
