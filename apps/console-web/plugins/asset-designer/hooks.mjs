/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays inside ctx.dataDir (assets/<type>/<id>.json). */
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'assets'), { recursive: true });
  ctx.log(`designed assets live in ${join(ctx.dataDir, 'assets')}`);
}

export async function onUninstall(ctx) {
  ctx.log('removing the designed assets kept by the asset designer (built-in assets are untouched)');
}

/** Health: the data folder exists and the framework validator the server part calls answers. */
export async function checks(ctx) {
  const out = [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }];
  const r = spawnSync(process.execPath, [join(HERE, 'server', 'designer.mjs'), 'types'], { input: '{}', encoding: 'utf8', timeout: 30_000 });
  let ok = false;
  try { ok = r.status === 0 && JSON.parse(r.stdout.trim().split('\n').pop()).ok === true; } catch { ok = false; }
  out.push({ id: 'validator', ok, detail: ok ? 'framework validator reachable (server/designer.mjs)' : (r.stderr || r.stdout || 'no answer').trim().slice(-300) });
  return out;
}
