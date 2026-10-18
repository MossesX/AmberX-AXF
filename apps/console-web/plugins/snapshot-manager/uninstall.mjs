#!/usr/bin/env node
/**
 * Snapshot Manager uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/snapshot-manager/uninstall.mjs [--data]          every snapshot, settings, enabled flag (backed up first unless --no-backup)
 *   node apps/console-web/plugins/snapshot-manager/uninstall.mjs --all [--publish] + this folder and its doc lines
 *   flags: --dry-run  --no-backup  --json
 * Without it, Container access refuses every change batch (nothing is written without a snapshot).
 * Then: node framework/cli/plugin-lifecycle.mjs check snapshot-manager --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'snapshot-manager');
