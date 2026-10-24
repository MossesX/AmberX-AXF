/** Lifecycle hooks (plugin-lifecycle@1) for Claude connection. Nothing is stored: the check result lives in memory. */
export async function onInstall(ctx) { ctx.log('ready: Patches shows the Claude connection on its banner on the next load'); }
export async function onUninstall(ctx) { ctx.log('nothing stored; Patches shows "No Claude connection" until it is back'); }
export async function checks() { return []; }
