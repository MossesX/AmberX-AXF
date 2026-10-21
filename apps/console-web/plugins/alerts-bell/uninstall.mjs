#!/usr/bin/env node
/**
 * Alerts bell uninstaller (plugin-lifecycle@1). Removes only the bell on the banner: the alerts library (Alerts view,
 * Settings → Alerts, delivery) stays in the framework. Afterwards the bell shows nowhere; open alerts from the nav.
 *   node apps/console-web/plugins/alerts-bell/uninstall.mjs [--data]          enabled flag
 *   node apps/console-web/plugins/alerts-bell/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check alerts-bell --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'alerts-bell');
