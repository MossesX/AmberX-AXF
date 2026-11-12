#!/usr/bin/env node
/**
 * GitHub client uninstaller (plugin-lifecycle@1). Pull requests, branches and the merge queue on GitHub are untouched;
 * only this plugin's settings, batches, jobs, scratch clones and git log go.
 *   node apps/console-web/plugins/github-client/uninstall.mjs [--data]          settings, batches, jobs, log, clones
 *   node apps/console-web/plugins/github-client/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check github-client --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'github-client');
