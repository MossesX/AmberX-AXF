#!/usr/bin/env node
/**
 * Theme manager uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/theme-manager/uninstall.mjs [--data]          saved themes + presets, enabled flag
 *   node apps/console-web/plugins/theme-manager/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Export any saved theme you want to keep first (they're plain asset@1 files any AXF app can import).
 * Then: node framework/cli/plugin-lifecycle.mjs check theme-manager --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'theme-manager');
