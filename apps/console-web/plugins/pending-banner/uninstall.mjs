#!/usr/bin/env node
/**
 * Pending banner uninstaller (plugin-lifecycle@1). Removes only this banner; the builds and the orchestrator's Pending
 * tab are untouched.
 *   node apps/console-web/plugins/pending-banner/uninstall.mjs [--data]          the seen-builds file, enabled flag
 *   node apps/console-web/plugins/pending-banner/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check pending-banner --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'pending-banner');
