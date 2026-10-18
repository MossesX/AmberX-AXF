#!/usr/bin/env node
/**
 * AI assistant uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/ai-assistant/uninstall.mjs [--data]        settings, profiles, keys, conversations, usage, enabled flag (backed up first)
 *   node apps/console-web/plugins/ai-assistant/uninstall.mjs --all [--publish]   + this folder and its doc lines (--publish commits + pushes the removal)
 *   flags: --dry-run  --no-backup  --json
 * Then: node framework/cli/plugin-lifecycle.mjs check ai-assistant --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'ai-assistant');
