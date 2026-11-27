#!/usr/bin/env node
/** Uninstaller (plugin-lifecycle@1): `--data` removes the data folder, `--all` the code and doc lines too. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'skin-editor');
