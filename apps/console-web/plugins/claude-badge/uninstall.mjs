#!/usr/bin/env node
/**
 * Claude badge uninstaller (plugin-lifecycle@1). Removes only the Claude badge: the banner, badge and clock asset types
 * stay in the framework.
 *   node apps/console-web/plugins/claude-badge/uninstall.mjs [--data]          last test result, enabled flag
 *   node apps/console-web/plugins/claude-badge/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check claude-badge --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'claude-badge');
