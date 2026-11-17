#!/usr/bin/env node
/** Installer (plugin-lifecycle@1): data folder (hooks.mjs onInstall; the tree starts empty) + enable. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'plan-studio-2');
