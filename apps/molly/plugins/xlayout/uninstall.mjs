#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1) for Molly's xLayout plugin. --data (default): data folder + state. --all: + this
 * folder + marked doc lines (Molly then frames each app plainly). --publish, --dry-run, --no-backup, --json.
 */
process.env.AXF_PLUGINS_DIR ||= 'apps/molly/plugins';
const { main } = await import('../../../../framework/cli/plugin-lifecycle.mjs');
await main(['uninstall', ...process.argv.slice(2)], 'xlayout');
