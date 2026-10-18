#!/usr/bin/env node
/**
 * Agent manager uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/agent-manager/uninstall.mjs [--data]          agents, skills, personas, lingo, tools, workflows, training jobs, memory, add-on records, keys (backed up first)
 *   node apps/console-web/plugins/agent-manager/uninstall.mjs --all [--publish]   + this folder (bundled add-ons included) and its doc lines
 *   flags: --dry-run  --no-backup  --json
 * Then: node framework/cli/plugin-lifecycle.mjs check agent-manager --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'agent-manager');
