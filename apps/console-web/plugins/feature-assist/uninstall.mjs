#!/usr/bin/env node
/**
 * Feature assistant uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/feature-assist/uninstall.mjs [--data]          its history (builds.jsonl), enabled flag
 *   node apps/console-web/plugins/feature-assist/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Features it added to the plan and the pending list stay (they're yours now).
 * Then: node framework/cli/plugin-lifecycle.mjs check feature-assist --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'feature-assist');
