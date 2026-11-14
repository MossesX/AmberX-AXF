/** Lifecycle hooks (plugin-lifecycle@1). The plugin keeps nothing locally: the waitlist lives on the AmberX site. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}; set AMBERX_SITE_URL and AMBERX_SITE_ADMIN_TOKEN on the console`); }
export async function onUninstall(ctx) { ctx.log('removing the launch waitlist plugin (the site and its waitlist stay)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'site-url', ok: Boolean(process.env.AMBERX_SITE_URL), detail: process.env.AMBERX_SITE_URL || 'AMBERX_SITE_URL is not set (defaults to https://amberxai.com)' },
    { id: 'admin-token', ok: Boolean(process.env.AMBERX_SITE_ADMIN_TOKEN), detail: process.env.AMBERX_SITE_ADMIN_TOKEN ? 'set' : 'AMBERX_SITE_ADMIN_TOKEN is not set' },
  ];
}
