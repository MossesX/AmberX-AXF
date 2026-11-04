/** Lifecycle hooks (plugin-lifecycle@1). The Markdown files themselves (repo, hub, notes) are never removed here; only kept versions in the data folder. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const hub = () => process.env.AXHUB_PROJECTS_DIR || '/projects';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (kept versions of repo files); hub files at ${hub()}`); }
export async function onUninstall(ctx) { ctx.log('removing MD Studio; every Markdown file stays where it is (the hub keeps its own history)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'hub', ok: true, detail: existsSync(join(hub(), '_shared', '_claude')) ? hub() : `${hub()} (not mounted on this machine: Claude scope uses the repo's copies)` },
  ];
}
