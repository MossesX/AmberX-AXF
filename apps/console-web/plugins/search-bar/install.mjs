#!/usr/bin/env node
/** Search bar installer (plugin-lifecycle@1): data folder + hooks.mjs onInstall + enable. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'search-bar');
