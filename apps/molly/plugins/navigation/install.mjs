#!/usr/bin/env node
/** Installer (plugin-lifecycle@1) for Molly's Navigation plugin: data folder + enable. Molly's plugins live in apps/molly/plugins. */
process.env.AXF_PLUGINS_DIR ||= 'apps/molly/plugins';
const { main } = await import('../../../../framework/cli/plugin-lifecycle.mjs');
await main(['install', ...process.argv.slice(2)], 'navigation');
