#!/usr/bin/env node
/** Uninstaller (plugin-lifecycle@1): `--data` removes the data folder, `--all` the code + doc lines too. Data set bar. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'data-set-bar');
