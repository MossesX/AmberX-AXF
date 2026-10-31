#!/usr/bin/env node
/**
 * Audio Extract installer (plugin-lifecycle@1). Enables it on the console (where it only shows a note); AmberX loads
 * it by itself through its `amberx-droid` target, and its native half ships in the AmberX APK.
 *   node apps/console-web/plugins/audio-extract/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'audio-extract');
