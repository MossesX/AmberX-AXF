/** Lifecycle hooks (plugin-lifecycle@1). The builds store (_claude/builds/store.json) is project data: uninstall never deletes it. */
import { existsSync } from 'node:fs';
import { storeFile } from '../../../../framework/cli/builds-store.mjs';

export async function onInstall(ctx) { ctx.log(`builds store: ${storeFile()}`); }
export async function onUninstall(ctx) { ctx.log('Builds page removed; the builds store stays in _claude/builds/'); }
export async function checks() { return [{ id: 'store', ok: existsSync(storeFile()), detail: storeFile() }]; }
