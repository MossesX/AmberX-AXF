#!/usr/bin/env node
/**
 * Audio Output Recorder installer (plugin-lifecycle@1). Enables it on the console (the axHub recordings list); AmberX
 * loads it by itself through its `amberx-droid` target, and its native half ships in the AmberX APK.
 *   node apps/console-web/plugins/output-recorder/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'output-recorder');
