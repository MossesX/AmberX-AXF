#!/usr/bin/env node
/**
 * Systems check uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/systems-check/uninstall.mjs [--data]          settings, the saved AI routine, What's-new summaries, enabled flag
 *   node apps/console-web/plugins/systems-check/uninstall.mjs --all [--publish] + this folder and its doc lines
 *   flags: --dry-run  --no-backup  --json
 * The console's saved credentials (.axf-console/secrets.env) belong to the console core and stay.
 * Then: node framework/cli/plugin-lifecycle.mjs check systems-check --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'systems-check');
