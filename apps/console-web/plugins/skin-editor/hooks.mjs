/** Lifecycle hooks (plugin-lifecycle@1) for the Skin editor. Everything it keeps stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('ready: nav → Plugins → Skin editor → Checker; REST /api/plugins/skin-editor/checker, CLI axf skin'); }
export async function onUninstall(ctx) { ctx.log('removing checker settings, last results and fixed asset copies'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
    { id: 'checker', ok: existsSync(join(HERE, '../../../../packages/skin-checker/bin/skin-check.mjs')), detail: 'packages/skin-checker/bin/skin-check.mjs' },
  ];
}
