/** Lifecycle hooks (plugin-lifecycle@1). The builds store (the axf-data tables once cut over) is project data: uninstall never deletes it. */
import { existsSync } from 'node:fs';
import { storeFile, storeMode } from '../../../../framework/cli/builds-store.mjs';

const where = () => (['cutover', 'rollback'].includes(storeMode()) ? 'the axf-data tables (builds/store.json)' : storeFile());
export async function onInstall(ctx) { ctx.log(`builds store: ${where()}`); }
export async function onUninstall(ctx) { ctx.log('Builds page removed; the builds store stays where it is'); }
export async function checks() { return [{ id: 'store', ok: ['cutover', 'rollback'].includes(storeMode()) || existsSync(storeFile()), detail: where() }]; }
