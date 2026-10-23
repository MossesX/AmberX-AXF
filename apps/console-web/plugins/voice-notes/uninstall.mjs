#!/usr/bin/env node
/**
 * Voice notes uninstaller (plugin-lifecycle@1). Its settings and lists are on axHub (settings/voice-notes.json and
 * voice-notes/ in the amberx-axf hub project) and stay there: they belong to the listener too.
 *   node apps/console-web/plugins/voice-notes/uninstall.mjs [--data]          enabled flag
 *   node apps/console-web/plugins/voice-notes/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check voice-notes --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'voice-notes');
