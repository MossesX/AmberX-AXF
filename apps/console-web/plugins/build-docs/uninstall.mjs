#!/usr/bin/env node
/**
 * Build docs uninstaller (plugin-lifecycle@1). Jobs and videos on the VPS data volume (AXF_BUILD_DOCS_DIR, or
 * /projects/amberx-axf/_data/build-docs) stay unless --data is given; docs already merged stay in the repo.
 *   node apps/console-web/plugins/build-docs/uninstall.mjs [--data]          jobs, scripts, videos, settings
 *   node apps/console-web/plugins/build-docs/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check build-docs --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'build-docs');
