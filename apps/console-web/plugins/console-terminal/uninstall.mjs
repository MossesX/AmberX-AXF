#!/usr/bin/env node
/**
 * Terminal uninstaller (plugin-lifecycle@1). Leaves nothing behind.
 *   node apps/console-web/plugins/console-terminal/uninstall.mjs [--data]          settings, the VPS SSH key, the Claude Code token, the session log
 *   node apps/console-web/plugins/console-terminal/uninstall.mjs --all [--publish] + this folder (vendored xterm included) and its doc lines
 *   flags: --dry-run  --no-backup  --json
 * Remove the key's line from ~/.ssh/authorized_keys on the VPS too (it ends with "axf-console-terminal").
 * Then: node framework/cli/plugin-lifecycle.mjs check console-terminal --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'console-terminal');
