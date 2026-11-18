#!/usr/bin/env node
/**
 * Banner widgets uninstaller (plugin-lifecycle@1). Removes only the banner widgets: the banner, badge, status, counter and
 * action-button asset types stay in the framework, and the plugins that supply data keep running without them.
 *   node apps/console-web/plugins/banner-widgets/uninstall.mjs [--data]          last test result, usage cache, enabled flag
 *   node apps/console-web/plugins/banner-widgets/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check banner-widgets --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'banner-widgets');
