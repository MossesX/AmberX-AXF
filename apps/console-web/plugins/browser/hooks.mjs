/** Lifecycle hooks (plugin-lifecycle@1). Profiles and downloads live in the host container's own volume (axf-browser-data). */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}; start the browser host with: sh apps/console-web/plugins/browser/deploy.sh`); }
export async function onUninstall(ctx) { ctx.log('removing the Automated Browser settings; stop the host with: docker rm -f axf-browser (volume axf-browser-data keeps the profiles until you remove it)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
