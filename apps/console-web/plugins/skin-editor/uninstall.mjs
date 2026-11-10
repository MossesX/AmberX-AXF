#!/usr/bin/env node
/**
 * Skin editor uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/skin-editor/uninstall.mjs [--data]          settings, last results, fixed asset copies
 *   node apps/console-web/plugins/skin-editor/uninstall.mjs --all [--publish] + this folder and its doc lines
 * The checker itself (packages/skin-checker, `axf skin …`, CI) stays: it is a framework package, not this plugin.
 * Then: node framework/cli/plugin-lifecycle.mjs check skin-editor --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'skin-editor');
