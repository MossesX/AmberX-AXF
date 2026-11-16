/**
 * axf-molly entry stub for merge-watch@1 (vps-sends-shipped-features-every-merge s10).
 *
 * When the orchestrator moves into axf-molly (build move-build-orchestrator-to-axhub; molly already runs tick, lander,
 * reconcile and lease as shadow jobs, /projects/amberx-axf/_data/pipeline/molly/status.json), this job runs the merge
 * watch there instead of the VPS cron (deploy/cron/axf-merge-watch). The runner needs nothing repo-relative:
 *
 *   AXF_MERGE_WATCH_DATA   molly's data folder for the watch (state.json, tick.lock, alert.json, github-cache.json, log.jsonl)
 *   AXF_MERGE_WATCH_REPO   molly's clone of MossesX/AmberX-AXF (git fetch / log / diff run there; reports are read there)
 *   AXF_SHIPPED_DIR        where sidecars go (default <repo>/_claude/builds/shipped)
 *   AXF_SHIPPED_FEATURES_DIR  the ledger folder, read-only, for "already in the ledger"
 *   AXF_MERGE_WATCH_SEND   api  in molly: POST the console's ledger API (AXF_CONSOLE_URL + AXF_TOKEN), no local store
 *
 * Contract (the shape molly's job table takes; kept minimal until molly's job API is in this repo):
 *   { id, everySec, run({ env, shadow }) → { ok, line, result } }
 * Shadow (molly doesn't own the orchestrator yet, lease.json): a dry tick, so the shadow log shows what it would send.
 */
export const id = 'merge-watch';
export const everySec = 60;

export async function run({ env = process.env, shadow = true } = {}) {
  const { tick } = await import('../../framework/cli/merge-watch.mjs');
  const r = await tick({ env, dry: shadow });
  const sent = (r.results ?? []).filter((x) => x.status === (shadow ? 'dry' : 'sent')).length;
  const failed = (r.results ?? []).filter((x) => x.status === 'failed').length;
  const line = r.off ? 'off' : r.locked ? 'another tick runs' : `${shadow ? 'shadow: would send' : 'sent'} ${sent}${failed ? `, ${failed} failed` : ''}`;
  return { ok: !failed && !r.locked, line, result: r };
}

export default { id, everySec, run };
