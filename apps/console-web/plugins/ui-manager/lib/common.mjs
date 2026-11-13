/** Paths the UI Manager's Node parts share. Data only in the plugin's lifecycle.dataDir (plugin-lifecycle@1). */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_DIR = resolve(HERE, '..');
export const ROOT = resolve(process.env.AXF_ROOT || join(PLUGIN_DIR, '../../../..'));
export const FOLDER = 'ui-manager';
export const DATA_DIR = resolve(process.env.AXF_UI_MANAGER_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER));
