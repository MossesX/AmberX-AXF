#!/usr/bin/env node
/** Installer (plugin-lifecycle@1): data folder + hooks.mjs onInstall + enable. API Browser. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'api-browser');
