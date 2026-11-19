/** Lifecycle hooks (plugin-lifecycle@1). The merge queue keeps no data: its view reads the builds store. */
export async function onInstall(ctx) { ctx.log('ready: the merge queue reads the builds store; it keeps no data of its own'); }
export async function onUninstall(ctx) { ctx.log('nothing to remove: the merge queue keeps no data'); }
export async function checks() {
  try { const q = (await import('./queue.mjs')).readQueue(); return [{ id: 'reads-the-store', ok: true, detail: `${q.rows.length} build(s) waiting to land` }]; }
  catch (e) { return [{ id: 'reads-the-store', ok: false, detail: String(e.message || e).slice(0, 200) }]; }
}
