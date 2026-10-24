/** Lifecycle hooks (plugin-lifecycle@1) for axHub connection. Only the badge look (config.json) is stored, in ctx.dataDir. */
export async function onInstall(ctx) { ctx.log('ready: Patches shows the axHub connection on its banner on the next load'); }
export async function onUninstall(ctx) { ctx.log('removing the badge look; Patches shows "No axHub connection" until it is back'); }
export async function checks() { return []; }
