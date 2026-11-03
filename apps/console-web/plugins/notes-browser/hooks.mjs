/** Lifecycle hooks (plugin-lifecycle@1). The notes themselves are Brett's (on the hub) and are never removed here. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const notesDir = () => join(process.env.AXHUB_PROJECTS_DIR || '/projects', '_shared', '_claude', 'notes');

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}; notes at ${notesDir()}`); }
export async function onUninstall(ctx) { ctx.log(`removing the notes browser; the notes stay at ${notesDir()}`); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'notes-folder', ok: true, detail: existsSync(notesDir()) ? notesDir() : `${notesDir()} (not mounted on this machine)` },
  ];
}
