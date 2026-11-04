#!/usr/bin/env node
/** Installer (plugin-lifecycle@1): data folder + hooks.mjs onInstall + enable. Rename 'settings-placement' to your folder. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'settings-placement');
