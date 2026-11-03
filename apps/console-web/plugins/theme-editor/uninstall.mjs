#!/usr/bin/env node
/**
 * Theme editor uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/theme-editor/uninstall.mjs [--data]          saved themes, enabled flag
 *   node apps/console-web/plugins/theme-editor/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Copy or export any saved theme you want to keep first (they're plain asset@1 files any AXF app can load).
 * Then: node framework/cli/plugin-lifecycle.mjs check theme-editor --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'theme-editor');
