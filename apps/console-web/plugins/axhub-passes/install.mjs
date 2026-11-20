#!/usr/bin/env node
/** Installer (plugin-lifecycle@1): data folder + enable. axHub passes keeps no data of its own (everything is on axHub). */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'axhub-passes');
