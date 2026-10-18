#!/usr/bin/env node
/**
 * Container access uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/container-access/uninstall.mjs [--data]          settings, audit log, change batches, enabled flag (backed up first)
 *   node apps/console-web/plugins/container-access/uninstall.mjs --all [--publish] + this folder and its marked lines in docs and install-console.sh
 *   flags: --dry-run  --no-backup  --json
 * The next deploy/install-console.sh run on the VPS removes the proxy container, its network and /etc/axf/plugins/container-access.
 * Then: node framework/cli/plugin-lifecycle.mjs check container-access --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'container-access');
