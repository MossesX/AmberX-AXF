/* The console's ai-assistant plugin, unchanged (apps/console-web/plugins/ai-assistant/web). Its `@console/*` imports resolve to
 * AmberX's bridge (src/console/, see vite.config.ts), so its server calls go through /api/console/plugins/ai-assistant/. */
export { plugin as library } from '../../../../../console-web/plugins/ai-assistant/web/index';
