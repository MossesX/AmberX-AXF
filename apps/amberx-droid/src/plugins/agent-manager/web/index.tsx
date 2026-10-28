/* The console's agent-manager plugin, unchanged (apps/console-web/plugins/agent-manager/web). Its `@console/*` imports resolve to
 * AmberX's bridge (src/console/, see vite.config.ts), so its server calls go through /api/console/plugins/agent-manager/. */
export { plugin as library } from '../../../../../console-web/plugins/agent-manager/web/index';
